// 백엔드 서버리스 함수(/api) 호출 헬퍼.
// 폼 값만 전송한다 — model/size/quality/프롬프트는 서버가 결정한다.
export async function callAPI(type, fields) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch('/api', {
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
