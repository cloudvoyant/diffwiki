#!/usr/bin/env node
// A fake diffwiki-app for e2e tests. Binds the requested port and serves a stub
// response — or, if the port is already taken (EADDRINUSE), exits non-zero just
// like the real app does on a bind failure. Args: --port <port>.
import http from 'node:http';

const i = process.argv.indexOf('--port');
const port = i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 4321;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>fake diffwiki-app</title>');
});

server.on('error', (err) => {
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1);
});

server.listen(port, '127.0.0.1');
