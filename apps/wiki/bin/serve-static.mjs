#!/usr/bin/env node
// Minimal static file server for the exported bundle (dist-site). Used by the
// Playwright static-export webServer so browser tests can load the real, served
// export — no extra dependency, no SPA rewrite magic: every route is prerendered
// to `<route>/index.html`, so directory-index resolution is all that's needed.
//
// Usage: node bin/serve-static.mjs <dir> [--port N]
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};
const root = path.resolve(argv.find((a) => !a.startsWith('--')) ?? 'dist-site');
const port = Number(flag('--port', process.env.PORT ?? '5055'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveFile(urlPath) {
  // Strip query/hash; decode; prevent path traversal outside root.
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(root)) return null;

  const candidates = [];
  const ext = path.extname(abs);
  if (ext) {
    candidates.push(abs);
  } else {
    // Directory / extensionless route → its prerendered index.html.
    candidates.push(path.join(abs, 'index.html'));
    candidates.push(`${abs}.html`);
  }
  for (const c of candidates) {
    try {
      const s = await stat(c);
      if (s.isFile()) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  const isMain = fileURLToPath(import.meta.url) === process.argv[1];
  if (isMain) console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
