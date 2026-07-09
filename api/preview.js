import https from 'node:https';

const DEFAULT_EVENT_ID = '0007638';
const HYUNDAI_MOBILE_ORIGIN = 'https://m.hddfs.com';
const PREVIEW_SOURCE_PATH = '/event/op/evnt/evntDetail.do';
const WIDGET_HEIGHT = 844;

function getEventId(req) {
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl, 'https://hyundai-dutyfree.vercel.app');
  const value = (url.searchParams.get('evntId') || DEFAULT_EVENT_ID).trim();
  return /^[0-9A-Za-z_-]{1,20}$/.test(value) ? value : DEFAULT_EVENT_ID;
}

function getPublicOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'hyundai-dutyfree.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.5,en;q=0.3',
      },
    }, (response) => {
      if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
        response.resume();
        resolve(fetchHtml(new URL(response.headers.location, url).toString()));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HYUNDAI_PREVIEW_HTTP_${response.statusCode}`));
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    });
    request.setTimeout(15000, () => request.destroy(new Error('HYUNDAI_PREVIEW_TIMEOUT')));
    request.on('error', reject);
  });
}

function ensureMobileBase(html) {
  if (/<base\b/i.test(html)) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${HYUNDAI_MOBILE_ORIGIN}/">`);
}

function replaceEmbedIframe(html, widgetUrl) {
  const iframe = `<iframe title="여행자 인연 미리보기" style="BORDER-TOP: 0px; HEIGHT: ${WIDGET_HEIGHT}px; BORDER-RIGHT: 0px; WIDTH: 100%; BORDER-BOTTOM: 0px; BORDER-LEFT: 0px; MARGIN: 0px auto; DISPLAY: block; overflow: hidden;" src="${widgetUrl}" allow="web-share; clipboard-write"></iframe>`;
  const titleIframePattern = /<iframe\b[^>]*title=["']여행자 인연 미리보기["'][^>]*>\s*(?:<\/iframe>)?/i;
  if (titleIframePattern.test(html)) return html.replace(titleIframePattern, iframe);

  const srcIframePattern = /<iframe\b[^>]*hyundai-dutyfree[^>]*>\s*(?:<\/iframe>)?/i;
  if (srcIframePattern.test(html)) return html.replace(srcIframePattern, iframe);

  return html.replace(/<\/article>/i, `${iframe}\n</article>`);
}

function injectPreviewMarker(html, eventId) {
  return html.replace(/<\/head>/i, `<meta name="robots" content="noindex,nofollow">\n<meta name="hdf-preview-event-id" content="${eventId}">\n</head>`);
}

export default async function handler(req, res) {
  try {
    const eventId = getEventId(req);
    const sourceUrl = `${HYUNDAI_MOBILE_ORIGIN}${PREVIEW_SOURCE_PATH}?evntId=${encodeURIComponent(eventId)}`;
    const widgetUrl = `${getPublicOrigin(req)}/widget?evntId=${encodeURIComponent(eventId)}`;
    const sourceHtml = await fetchHtml(sourceUrl);
    const previewHtml = injectPreviewMarker(
      replaceEmbedIframe(ensureMobileBase(sourceHtml), widgetUrl),
      eventId,
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self' https: data: blob:",
      "img-src 'self' https: data: blob:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "connect-src 'self' https:",
      "font-src 'self' https: data:",
      "frame-src 'self' https://hyundai-dutyfree.vercel.app https://*.vercel.app https://*.hddfs.com https://www.googletagmanager.com",
      "base-uri https://m.hddfs.com",
      "object-src 'none'",
    ].join('; '));
    res.status(200).send(previewHtml);
  } catch (error) {
    res.status(502).json({ error: error.message || 'HYUNDAI_PREVIEW_FAILED' });
  }
}
