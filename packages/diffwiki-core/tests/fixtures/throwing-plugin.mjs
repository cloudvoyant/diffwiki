// A protocol plugin whose `search` handler fails — it writes `{ ok:false, error }`,
// the host's invoke rejects, and `search()` must capture the message and fall
// back to native.
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
  const { op } = req;
  if (op === 'describe') {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        result: {
          name: 'boom-plugin',
          kind: 'search',
          version: '0.0.0',
          capabilities: { searchTypes: ['boom'], collectionFilter: true, events: false },
        },
      }) + '\n',
    );
    process.exit(0);
    return;
  }
  if (op === 'search') {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: 'engine exploded' } }) + '\n');
    process.exit(1);
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, result: {} }) + '\n');
  process.exit(0);
});
