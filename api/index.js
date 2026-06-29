import https from 'node:https';
import { SYSTEM_PROMPT, CATEGORIES, buildGenerationContext, buildUserMessage, buildImagePrompt } from './prompts.js';

// --- 서버 고정 상수 (클라이언트가 변경 불가) ---
const TEXT_MODEL = 'gpt-4o';
const TEXT_MAX_TOKENS = 2200;
const IMAGE_MODEL = 'gpt-image-1';
const IMAGE_SIZE = '1024x1024';
const IMAGE_QUALITY = 'medium';
const ALLOWED_GENDERS = ['남성', '여성'];
const CATEGORY_NAMES = CATEGORIES.map((category) => category.ko);
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'https://hyundai-dutyfree.vercel.app'];

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

function normalizeResult(raw, fields, generationContext) {
  const category = CATEGORY_NAMES.includes(raw?.category) ? raw.category : generationContext.category.ko;
  const fallbackImagePrompt = buildImagePrompt({ ...fields, generationContext });
  const imagePrompt = normalizeString(raw?.imagePrompt, fallbackImagePrompt).slice(0, 2200);
  const personality = normalizeArray(raw?.personality, 3);
  const story = normalizeArray(raw?.story, 7);

  return {
    tagline: `${fields.name}님의 운명이 ${fields.destination}에서 기다리고 있습니다.`,
    name: normalizeString(raw?.name, '운명의 인연'),
    nationality: normalizeString(raw?.nationality, `${fields.destination}의 여행자`),
    job: normalizeString(raw?.job, '여행자'),
    personality,
    style: normalizeString(raw?.style, generationContext.archetype),
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
  // ALLOWED_ORIGIN(쉼표구분) 설정 시 그 목록을 사용하고, 미설정 시 기본 2개만 허용한다.
  const configuredOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) {
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
        max_tokens: TEXT_MAX_TOKENS,
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
    const imagePrompt = suppliedPrompt && suppliedPrompt.length <= 2200
      ? suppliedPrompt
      : buildImagePrompt({ ...fields, generationContext });
    const imagePayload = { model: IMAGE_MODEL, prompt: imagePrompt, n: 1, size: IMAGE_SIZE, quality: IMAGE_QUALITY };

    let openaiResult = null;
    let openaiErr = null;
    try {
      openaiResult = await makeJsonRequest('api.openai.com', '/v1/images/generations', imagePayload, openaiKey, 30000);
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
