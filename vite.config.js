import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import apiHandler from './api/index.js';

const widgetHtml = fileURLToPath(new URL('./widget.html', import.meta.url));

// .env 를 process.env 로 로드 (dev 미들웨어에서 API 키 사용)
try { process.loadEnvFile(); } catch { /* .env 없음 → 외부 환경변수 사용 */ }

// 개발 서버에서 /api 요청을 Vercel 서버리스 함수(api/index.js)로 그대로 처리한다.
// 배포 시에는 Vercel 이 api/ 디렉토리를 함수로 인식하므로 이 미들웨어는 dev 전용이다.
function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
          // Vercel 런타임이 주입하는 res.status()/res.json() polyfill
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
            return res;
          };
          try {
            await apiHandler(req, res);
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: widgetHtml,
    },
  },
  plugins: [react(), apiDevMiddleware()],
});
