// 사주 결과 텍스트의 마크다운(볼드/링크)을 안전하게 HTML 문자열로 변환한다.
// (HTML 이스케이프 후 볼드·링크·줄바꿈을 처리 — 기존 로직 유지)
export function renderResultHtml(text) {
  const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  const boldRegex = /\*\*([^*]+)\*\*/g;

  // 링크 텍스트/URL 재삽입 시 HTML/속성 이스케이프 (XSS 방지)
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const links = [];
  let linkIndex = 0;
  const processed = text.replace(urlRegex, (match, linkText, url) => {
    links.push({ linkText, url });
    return `%%LINK${linkIndex++}%%`;
  });

  let html = processed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(boldRegex, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');

  // hddfs.com(및 서브도메인) https 링크만 실제 <a>로, 그 외는 텍스트로 강등 (피싱/인젝션 링크 차단)
  const isAllowed = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (u.hostname === 'hddfs.com' || u.hostname.endsWith('.hddfs.com'));
    } catch {
      return false;
    }
  };

  links.forEach((link, i) => {
    const safe = isAllowed(link.url)
      ? `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer nofollow" style="color:#1a73e8;text-decoration:underline;display:block;margin-top:6px;">${esc(link.linkText)}</a>`
      : esc(link.linkText);
    // 콜백형 replace: 반환 문자열의 $ 토큰이 특수 치환으로 해석되지 않음
    html = html.replace(`%%LINK${i}%%`, () => safe);
  });

  return html;
}
