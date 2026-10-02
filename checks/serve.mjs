// A static server for dist/, as the live site serves the pages: /banks and /banks/ give banks.html,
// /aws and /aws/ give aws.html, and /banks/<file> or /aws/<file> gives <file>. Text goes out gzipped
// unless told otherwise.
//   node checks/serve.mjs [port]        then open http://127.0.0.1:8765/banks/ or http://127.0.0.1:8765/aws/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf' };

export function serve(dir, port, { gzip = true } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/banks.html';
    for (const page of ['banks', 'aws']) {
      if (p === `/${page}` || p === `/${page}/`) p = `/${page}.html`;
      else if (p.startsWith(`/${page}/`)) p = p.slice(page.length + 1);
    }
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const type = TYPES[path.extname(f)] || 'application/octet-stream';
    const body = fs.readFileSync(f);
    if (gzip && /text/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': 'no-cache' });
      res.end(zlib.gzipSync(body));
    } else {
      res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-cache' });
      res.end(body);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8765);
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  await serve(dist, port);
  console.log(`serving ${dist} at http://127.0.0.1:${port}/banks/`);
}
