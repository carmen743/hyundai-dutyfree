import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const htmlPath = path.join(distDir, 'index.html');
const outPath = path.join(distDir, 'hyundai-dutyfree-embed.html');

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8');
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  throw new Error(`Unsupported asset type: ${file}`);
}

function dataUrlFor(publicPath) {
  const filePath = path.join(root, 'public', publicPath.replace(/^\//, ''));
  const bytes = fs.readFileSync(filePath);
  return `data:${mimeFor(filePath)};base64,${bytes.toString('base64')}`;
}

function inlineStyles(html) {
  return html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_tag, href) => {
    const cssPath = path.join(distDir, href.replace(/^\//, ''));
    const css = readUtf8(cssPath);
    return `<style>\n${css}\n</style>`;
  });
}

function inlineScripts(html) {
  const runtimeConfig = `<script>\nwindow.HDDFS_API_BASE = window.HDDFS_API_BASE || 'https://hyundai-dutyfree.vercel.app';\nwindow.HDDFS_EVENT_URL = window.HDDFS_EVENT_URL || 'https://hyundai-dutyfree.vercel.app/';\n</script>`;
  return html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_tag, src) => {
    const jsPath = path.join(distDir, src.replace(/^\//, ''));
    let js = readUtf8(jsPath);
    const replacements = {
      '/logo.png': dataUrlFor('/logo.png'),
      '/hyundai-dutyfree-wordmark-white.png': dataUrlFor('/hyundai-dutyfree-wordmark-white.png'),
    };
    for (const [from, to] of Object.entries(replacements)) {
      js = js.replaceAll(JSON.stringify(from), JSON.stringify(to));
      js = js.replaceAll(`'${from}'`, JSON.stringify(to));
    }
    return `${runtimeConfig}\n<script type="module">\n${js}\n</script>`;
  });
}

if (!fs.existsSync(htmlPath)) {
  throw new Error('dist/index.html not found. Run `npm run build` before this script.');
}

let html = readUtf8(htmlPath);
html = inlineStyles(html);
html = inlineScripts(html);
html = html.replace(/\n\s*<link rel="modulepreload"[^>]+>/g, '');

fs.writeFileSync(outPath, html);
console.log(`single html: ${outPath}`);
console.log(`bytes: ${fs.statSync(outPath).size}`);
