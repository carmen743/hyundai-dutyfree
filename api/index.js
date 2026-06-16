import https from 'node:https';
import { SYSTEM_PROMPT, buildUserMessage, buildImagePrompt } from './prompts.js';

// --- 서버 고정 상수 (클라이언트가 변경 불가) ---
const TEXT_MODEL = 'gpt-4o';
const TEXT_MAX_TOKENS = 1200;
const IMAGE_MODEL = 'gpt-image-1';
const IMAGE_SIZE = '1024x1024';
const IMAGE_QUALITY = 'medium';
const ALLOWED_GENDERS = ['남성', '여성'];

// 유료 API 호출 전에 입력을 검증한다. 통과 못 하면 비용 발생 없이 400.
function validateFields(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const birth = typeof body.birth === 'string' ? body.birth.trim() : '';
  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const gender = typeof body.gender === 'string' ? body.gender : '';
  if (!name || name.length > 20) return null;
  if (!birth || birth.length > 10 || !/^[0-9.\-/\s]+$/.test(birth)) return null;
  if (!destination || destination.length > 40) return null;
  if (!ALLOWED_GENDERS.includes(gender)) return null;
  return { name, birth, destination, gender };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Origin 화이트리스트: ALLOWED_ORIGIN(쉼표구분) 설정 시 그 목록만 허용, 미설정 시 * (개발 호환)
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length) {
    if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  // 허용 목록이 있으면 목록 밖 브라우저 origin 차단 (curl 등 origin 없는 요청은 rate-limit/캡차로 별도 보강 필요)
  if (allowed.length && origin && !allowed.includes(origin)) {
    res.status(403).json({ error: 'FORBIDDEN_ORIGIN' });
    return;
  }

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
  const stabilityKey = process.env.STABILITY_API_KEY;

  // JSON API 호출. timeoutMs 지정 시 무응답 타임아웃 → 폴백/실패 트리거
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

  // Stability AI 이미지 생성 (multipart/form-data) → { image, finish_reason, seed }
  const makeStabilityRequest = (prompt, apiKey, timeoutMs) => {
    return new Promise((resolve, reject) => {
      const formData = `--boundary\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n--boundary\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng\r\n--boundary--`;
      const options = {
        hostname: 'api.stability.ai',
        path: '/v2beta/stable-image/generate/core',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'multipart/form-data; boundary=boundary',
          'Content-Length': Buffer.byteLength(formData),
        },
      };
      if (timeoutMs) options.timeout = timeoutMs;
      const request = https.request(options, (response) => {
        response.setEncoding('utf8');
        let result = '';
        response.on('data', (chunk) => (result += chunk));
        response.on('end', () => {
          try { resolve(JSON.parse(result)); }
          catch (e) { reject(new Error('stability parse error')); }
        });
      });
      if (timeoutMs) request.on('timeout', () => request.destroy(new Error('stability timeout')));
      request.on('error', reject);
      request.write(formData);
      request.end();
    });
  };

  try {
    if (type === 'text') {
      // 모델/토큰/시스템프롬프트는 서버 고정. 사용자 입력은 user 메시지에만 들어간다.
      const payload = {
        model: TEXT_MODEL,
        max_tokens: TEXT_MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(fields) },
        ],
      };
      const result = await makeJsonRequest('api.openai.com', '/v1/chat/completions', payload, openaiKey, 25000);
      const content = result?.choices?.[0]?.message?.content;
      if (!content) {
        console.error('[api/text] no content:', JSON.stringify(result).slice(0, 500));
        res.status(502).json({ error: 'TEXT_GENERATION_FAILED' });
        return;
      }
      res.status(200).json({ text: content });
      return;
    }

    // type === 'image' — 모델/크기/품질 서버 고정. 1차 OpenAI(30s) → 실패 시 Stability(18s) 폴백
    const imagePrompt = buildImagePrompt(fields);
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

    if (!stabilityKey) {
      res.status(502).json({ error: 'IMAGE_GENERATION_FAILED' });
      return;
    }
    try {
      const stab = await makeStabilityRequest(imagePrompt, stabilityKey, 18000);
      if (stab?.image) {
        res.status(200).json({ image: stab.image, provider: 'stability' });
        return;
      }
      console.error('[api/image] stability failed:', JSON.stringify(stab).slice(0, 500));
      res.status(502).json({ error: 'IMAGE_GENERATION_FAILED' });
    } catch (e) {
      console.error('[api/image] stability error:', e.message);
      res.status(502).json({ error: 'IMAGE_GENERATION_FAILED' });
    }
  } catch (e) {
    console.error('[api] internal error:', e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}
