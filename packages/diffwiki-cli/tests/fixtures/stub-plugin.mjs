#!/usr/bin/env node
// A one-shot subprocess plugin implementing the diffwiki protocol, for e2e tests.
// Reads one JSON request on stdin, writes one JSON response on stdout, exits.
// Env flags flip failure modes:
//   DIFFWIKI_FIXTURE_TOOL_MISSING=1     -> health reports its dependency absent
//   DIFFWIKI_FIXTURE_SETUP_NOT_READY=1  -> setup reports not-ready
const toolMissing = process.env.DIFFWIKI_FIXTURE_TOOL_MISSING === '1';

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
  const msg = JSON.parse(line);
  const result = handle(msg.op, msg.params || {});
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  process.exit(0);
});

function handle(op, params) {
  switch (op) {
    case 'describe':
      return {
        name: 'stub',
        kind: 'search',
        version: '0.0.1',
        capabilities: { searchTypes: ['stub'], collectionFilter: true, events: true },
      };
    case 'setup':
      if (process.env.DIFFWIKI_FIXTURE_SETUP_NOT_READY === '1') {
        return { ready: false, steps: [{ step: 'verify-tool', ok: false, message: 'stub dep unresolved — install it' }] };
      }
      return { ready: true, steps: [{ step: 'stub-setup', ok: true }] };
    case 'index': {
      const n = Array.isArray(params.collections) ? params.collections.length : 0;
      return { indexed: n };
    }
    case 'event':
      return { accepted: true };
    case 'search':
      return {
        hits: [
          {
            collection: 'stub',
            relPath: 'canned.md',
            title: 'stub hit for ' + (params.term || ''),
            snippet: 'a canned snippet',
            score: 1,
            docid: 'stub-1',
            tags: ['stub'],
          },
        ],
      };
    case 'health':
      if (toolMissing) {
        return {
          ready: false,
          readiness: {
            toolInstalled: false,
            modelsPresent: false,
            indexBuilt: false,
            docsIndexed: 0,
            embeddingsPending: 0,
            firstSearchCost: 'model-download',
          },
          diagnostics: [{ level: 'error', message: 'stub tool missing — install it' }],
        };
      }
      return {
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
    default:
      throw new Error('unknown op ' + op);
  }
}
