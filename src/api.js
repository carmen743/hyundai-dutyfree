// 백엔드 서버리스 함수(/api) 호출 헬퍼.
// 폼 값/resultSeed를 전송하고, 이미지 요청에는 텍스트 JSON의 imagePrompt를 함께 전달한다.
// model/size/quality는 서버가 결정한다.
function getApiEndpoint() {
  const base = globalThis.HDDFS_API_BASE || import.meta.env.VITE_API_BASE_URL || '';
  return base ? new URL('/api', base).toString() : '/api';
}

export async function callAPI(type, fields) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(getApiEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...fields }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      try {
        const j = await res.json();
        if (j && j.error) code = j.error;
      } catch {
        /* 비JSON 에러 응답 무시 */
      }
      throw new Error(code);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('UNEXPECTED_RESPONSE');
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
