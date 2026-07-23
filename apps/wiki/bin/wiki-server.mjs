#!/usr/bin/env node
// Boots the built TanStack Start server. `vite build` emits a Web `fetch`
// handler (dist/server/server.js) plus a dist/client/ dir of static assets. We
// serve the static files ourselves and fall back to the fetch handler for
// routes, all via `serve` (srvx, re-exported by h3-v2) which adapts a fetch
// handler to Node. There is no standalone server in the build to `node` directly.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { serve } from 'h3-v2/node';

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
if (portFlag !== -1 && argv[portFlag + 1]) {
  process.env.PORT = argv[portFlag + 1];
}

// `diffwiki-app export …` delegates to the static exporter (no server).
if (argv[0] === 'export') {
  await import(new URL('./export.mjs', import.meta.url));
  process.exit(0);
}

const port = Number(process.env.PORT || '4321');
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid port: ${JSON.stringify(process.env.PORT)}`);
}
const hostname = process.env.HOST || '127.0.0.1';

const pkgRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const clientDir = path.join(pkgRoot, 'dist', 'client');
const { default: serverEntry } = await import(path.join(pkgRoot, 'dist', 'server', 'server.js'));

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Serve a file from dist/client/ if the path resolves to one (jailed, no traversal). */
async function serveStatic(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(clientDir, rel);
  if (filePath !== clientDir && !filePath.startsWith(clientDir + path.sep)) return null;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return null;
    const ext = path.extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    // Build assets are content-hashed → cache forever; other files short-cache.
    const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
    return new Response(body, {
      headers: {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': immutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate',
      },
    });
  } catch {
    return null;
  }
}

serve({
  port,
  hostname,
  fetch: async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const staticResponse = await serveStatic(new URL(request.url).pathname);
      if (staticResponse) {
        // HEAD carries the same headers as GET but no body (RFC 9110 §9.3.2).
        return request.method === 'HEAD'
          ? new Response(null, { status: staticResponse.status, headers: staticResponse.headers })
          : staticResponse;
      }
    }
    return serverEntry.fetch(request);
  },
});
console.log(`diffwiki-app listening on http://${hostname}:${port}`);
