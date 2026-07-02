import https from 'node:https';
import { SYSTEM_PROMPT, CATEGORIES, buildGenerationContext, buildUserMessage, buildImagePrompt, enforceImagePromptSafety } from './prompts.js';

// --- 서버 고정 상수 (클라이언트가 변경 불가) ---
const TEXT_MODEL = 'gpt-5.4-mini';
const TEXT_MAX_COMPLETION_TOKENS = 2200;
const IMAGE_MODEL = 'gpt-image-2';
const IMAGE_SIZE = '1024x1024';
const IMAGE_QUALITY = 'low';
const IMAGE_TIMEOUT_MS = 120000;
const ALLOWED_GENDERS = ['남성', '여성'];
const CATEGORY_NAMES = CATEGORIES.map((category) => category.ko);
// Origin 은 경로 없는 scheme://host 이므로 임베드 페이지(예:
// https://www.hddfs.com/event/op/evnt/evntShop.do)는 'https://www.hddfs.com' 로 허용된다.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://hyundai-dutyfree.vercel.app',
  'https://hddfs.com',
  'https://www.hddfs.com',
  'https://en.hddfs.com',
  'https://men.hddfs.com',
  'https://m.hddfs.com',
  // srcdoc/sandbox iframe 임베드는 Origin: null 을 보내므로 허용한다(다른 명시 도메인은 계속 차단).
  'null',
];
// 임베드 파일의 업로드 위치를 사전에 알 수 없다(www/image/cdn 등 혼용). hddfs.com 계열 https 서브도메인은 전체 허용한다.
const HDDFS_ORIGIN_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)*hddfs\.com$/i;

// 유료 API 호출 전에 입력을 검증한다. 통과 못 하면 비용 발생 없이 400.
function validateFields(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const birth = typeof body.birth === 'string' ? body.birth.trim() : '';
  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const gender = typeof body.gender === 'string' ? body.gender : '';
  const resultSeed = typeof body.resultSeed === 'string' ? body.resultSeed.trim().slice(0, 80) : '';
  if (!name || name.length > 20) return null;
  if (!birth || birth.length > 10 || !/^[0-9.\-/\s]+$/.test(birth)) return null;
  if (!destination || destination.length > 40) return null;
  if (!ALLOWED_GENDERS.includes(gender)) return null;
  return { name, birth, destination, gender, resultSeed };
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function rememberEthnicity(res, ethnicityId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `hdf_last_ethnicity=${encodeURIComponent(ethnicityId)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`);
}

function parseModelJson(content) {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeArray(value, limit) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit);
  if (typeof value === 'string') return value.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, limit);
  return [];
}

const UNSAFE_RESULT_TEXT = /섹시|관능|도발|야한|노출|가슴|글래머/i;
const SAFE_PERSONALITY_FALLBACKS = ['다정함', '여유로움', '센스있음'];
const KOREAN_NAME_PATTERN = /^[가-힣][가-힣\s·.'-]{0,30}$/;
const FALLBACK_KOREAN_NAMES = {
  남성: ['아드리앙 로랑', '루카 마르탱', '마테오 리치', '노아 베넷', '레오 하르트'],
  여성: ['소피아 로시', '엘라 마르탱', '미아 베넷', '리나 바이스', '클라라 로랑'],
};

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackKoreanName(fields) {
  const list = FALLBACK_KOREAN_NAMES[fields?.gender] || FALLBACK_KOREAN_NAMES.여성;
  const seed = `${fields?.resultSeed || ''}|${fields?.name || ''}|${fields?.birth || ''}|${fields?.destination || ''}|${fields?.gender || ''}`;
  return list[hashString(seed) % list.length];
}

function sanitizeKoreanName(value, fields) {
  const normalized = normalizeString(value, '').replace(/\s+/g, ' ').trim();
  if (!normalized || !KOREAN_NAME_PATTERN.test(normalized)) return fallbackKoreanName(fields);
  return normalized;
}

function sanitizeResultText(value, fallback = '') {
  const normalized = normalizeString(value, fallback);
  if (!normalized || UNSAFE_RESULT_TEXT.test(normalized)) return fallback;
  return normalized;
}

function normalizePersonality(value) {
  const safe = normalizeArray(value, 3).filter((item) => !UNSAFE_RESULT_TEXT.test(item));
  for (const fallback of SAFE_PERSONALITY_FALLBACKS) {
    if (safe.length >= 3) break;
    if (!safe.includes(fallback)) safe.push(fallback);
  }
  return safe.slice(0, 3);
}

function normalizeResult(raw, fields, generationContext) {
  const category = CATEGORY_NAMES.includes(raw?.category) ? raw.category : generationContext.category.ko;
  const fallbackImagePrompt = buildImagePrompt({ ...fields, generationContext });
  const imagePrompt = enforceImagePromptSafety(
    normalizeString(raw?.imagePrompt, fallbackImagePrompt),
    { ...fields, ethnicityInstruction: generationContext.ethnicity?.image },
  ).slice(0, 2200);
  const personality = normalizePersonality(raw?.personality);
  const story = normalizeArray(raw?.story, 7);

  return {
    tagline: `${fields.name}님의 운명이 ${fields.destination}에서 기다리고 있습니다.`,
    name: sanitizeKoreanName(raw?.name, fields),
    nationality: normalizeString(raw?.nationality, `${fields.destination}의 여행자`),
    job: normalizeString(raw?.job, '여행자'),
    personality,
    style: sanitizeResultText(raw?.style, generationContext.archetype),
    quote: normalizeString(raw?.quote, '오늘은 그냥 지나치지 말아요.'),
    story,
    category,
    imagePrompt,
    isComic: generationContext.isComic,
  };
}

export default async function handler(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Origin 화이트리스트: 브라우저 XHR/fetch는 아래 Origin에서 온 요청만 허용한다.
  // ALLOWED_ORIGIN(쉼표구분) 설정 시 기본 Origin에 추가로 병합한다.
  const configuredOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins])];
  const origin = req.headers.origin;
  if (!origin || !(allowed.includes(origin) || HDDFS_ORIGIN_PATTERN.test(origin))) {
    res.status(403).json({ error: 'FORBIDDEN_ORIGIN' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  const body = req.body || {};
  const { type } = body;
  if (type !== 'text' && type !== 'image') {
    res.status(400).json({ error: 'UNKNOWN_TYPE' });
    return;
  }

  const fields = validateFields(body);
  if (!fields) {
    res.status(400).json({ error: 'INVALID_INPUT' });
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;

  // JSON API 호출. timeoutMs 지정 시 무응답 타임아웃 → 실패 트리거
  const makeJsonRequest = (hostname, path, payload, apiKey, timeoutMs) => {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const options = {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(data),
        },
      };
      if (timeoutMs) options.timeout = timeoutMs;
      const request = https.request(options, (response) => {
        response.setEncoding('utf8');
        let result = '';
        response.on('data', (chunk) => (result += chunk));
        response.on('end', () => {
          try { resolve(JSON.parse(result)); }
          catch (e) { reject(e); }
        });
      });
      if (timeoutMs) request.on('timeout', () => request.destroy(new Error('upstream timeout')));
      request.on('error', reject);
      request.write(data);
      request.end();
    });
  };

  try {
    if (type === 'text') {
      if (!openaiKey) {
        res.status(500).json({ error: 'OPENAI_API_KEY_MISSING' });
        return;
      }
      const previousEthnicity = parseCookies(req.headers.cookie).hdf_last_ethnicity || '';
      const generationContext = buildGenerationContext(fields, { previousEthnicity });
      const payload = {
        model: TEXT_MODEL,
        max_completion_tokens: TEXT_MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage({ ...fields, generationContext }) },
        ],
      };
      const result = await makeJsonRequest('api.openai.com', '/v1/chat/completions', payload, openaiKey, 25000);
      const content = result?.choices?.[0]?.message?.content;
      const parsed = parseModelJson(content);
      if (!parsed) {
        console.error('[api/text] invalid JSON:', String(content || JSON.stringify(result)).slice(0, 500));
        res.status(502).json({ error: 'TEXT_GENERATION_FAILED' });
        return;
      }
      rememberEthnicity(res, generationContext.ethnicity.id);
      res.status(200).json({ result: normalizeResult(parsed, fields, generationContext) });
      return;
    }

    // type === 'image' — 텍스트 JSON의 imagePrompt를 우선 사용하고, 없으면 서버 fallback 프롬프트 사용.
    if (!openaiKey) {
      res.status(500).json({ error: 'OPENAI_API_KEY_MISSING' });
      return;
    }
    const generationContext = buildGenerationContext(fields);
    const suppliedPrompt = typeof body.imagePrompt === 'string' ? body.imagePrompt.trim() : '';
    const imagePrompt = enforceImagePromptSafety(
      suppliedPrompt && suppliedPrompt.length <= 2200
        ? suppliedPrompt
        : buildImagePrompt({ ...fields, generationContext }),
      fields,
    );
    const imagePayload = { model: IMAGE_MODEL, prompt: imagePrompt, n: 1, size: IMAGE_SIZE, quality: IMAGE_QUALITY };

    let openaiResult = null;
    let openaiErr = null;
    try {
      openaiResult = await makeJsonRequest('api.openai.com', '/v1/images/generations', imagePayload, openaiKey, IMAGE_TIMEOUT_MS);
    } catch (e) {
      openaiErr = e.message;
    }
    const b64 = openaiResult?.data?.[0]?.b64_json;
    if (b64) {
      res.status(200).json({ image: b64, provider: 'openai' });
      return;
    }
    console.error('[api/image] openai failed:', openaiErr || JSON.stringify(openaiResult?.error || openaiResult).slice(0, 500));
    res.status(502).json({ error: 'IMAGE_GENERATION_FAILED' });
  } catch (e) {
    console.error('[api] internal error:', e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}
