// Static download website only. The Windows desktop app runs locally in Electron.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DOWNLOAD_URL = `https://github.com/rishusaw0/bob/releases/latest/download/JEEVA.AI.Setup.${APP_VERSION}.exe`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    return send(res, 405, 'Method Not Allowed');
  }

  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    return send(res, 200, req.method === 'HEAD' ? '' : 'ok');
  }
  if (url.pathname === '/download' || url.pathname === '/download/') {
    res.writeHead(302, { Location: DOWNLOAD_URL, 'Cache-Control': 'no-store' });
    return res.end();
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.includes('\\') || pathname.includes('\0')) {
    return send(res, 400, 'Bad Request');
  }
  const relative = pathname === '/' ? 'landing.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(DIST, relative);
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not Found');
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Length': stat.size,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JEEVA AI download website listening on port ${PORT}`);
  });
}

export { server };
