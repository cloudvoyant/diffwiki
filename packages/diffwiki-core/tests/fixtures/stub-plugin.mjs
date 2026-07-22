// A minimal but real protocol plugin, spawned as `node <file>`. It speaks the
// one-shot JSON-over-stdio protocol: read one JSON request from stdin, write one
// JSON response to stdout, then exit.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
});
process.stdin.on('end', () => {
  const line = buffer.trim();
  if (!line) {
    process.exit(1);
    return;
  }
  const req = JSON.parse(line);
  const { op, params } = req;
  let result;
  if (op === 'describe') {
    result = {
      name: 'stub-plugin',
      kind: 'search',
      version: '0.0.0',
      capabilities: { searchTypes: ['stub'], collectionFilter: true, events: false },
    };
  } else if (op === 'search') {
    const first = (params.collections || [])[0];
    const collection = first ? first.name : 'unknown';
    result = { hits: [{ collection, relPath: 'a.md', title: 'Alpha', tags: [] }] };
  } else if (op === 'health') {
    result = {
      ready: true,
      readiness: {
        toolInstalled: true,
        modelsPresent: true,
        indexBuilt: true,
        docsIndexed: 1,
        embeddingsPending: 0,
        firstSearchCost: 'instant',
      },
      diagnostics: [{ level: 'ok', message: 'stub ready' }],
    };
  } else if (op === 'setup') {
    result = { ready: true, steps: [] };
  } else if (op === 'index') {
    result = { indexed: 0 };
  } else if (op === 'event') {
    result = { accepted: true };
  } else {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: 'unknown op: ' + op } }) + '\n');
    process.exit(1);
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  process.exit(0);
});
