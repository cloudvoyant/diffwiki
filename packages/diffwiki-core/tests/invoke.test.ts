import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { invokePlugin } from '../src/plugins/host';

/**
 * A minimal protocol plugin that emits a structured `{log}` line on stderr and
 * then a valid JSON response on stdout — exercising the host's stderr log
 * forwarding while still resolving the response.
 */
const LOGGING_PLUGIN = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  const req = JSON.parse(buffer.trim());
  // Emit a plugin diagnostic on stderr (as the SDK's log() does).
  process.stderr.write(JSON.stringify({ log: { level: 'info', message: 'index stale — running qmd update' } }) + '\\n');
  // Also emit a non-JSON stderr line, which must be ignored by the forwarder.
  process.stderr.write('some raw progress noise\\n');
  process.stdout.write(JSON.stringify({ ok: true, result: { echoed: req.op } }) + '\\n');
});
`;

let scratchDir: string;
let records: LogRecord[];

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-invoke-test-'));
  records = [];
  // Capture the whole ['diffwiki'] tree so forwarded plugin logs are visible.
  configureSync({
    sinks: { mem: (record: LogRecord) => records.push(record) },
    loggers: [
      { category: ['diffwiki'], lowestLevel: 'trace', sinks: ['mem'] },
      { category: [], lowestLevel: 'fatal', sinks: [] },
    ],
  });
});

afterEach(async () => {
  resetSync();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe('invokePlugin log forwarding', () => {
  it('forwards a plugin {log} line under ["diffwiki","plugin",name] and still resolves', async () => {
    const binPath = path.join(scratchDir, 'plugin.mjs');
    await fs.writeFile(binPath, LOGGING_PLUGIN, 'utf8');

    const result = await invokePlugin<{ echoed: string }>(['node', binPath], 'search', {}, { name: 'diffwiki-qmd' });

    expect(result).toEqual({ echoed: 'search' });
    const forwarded = records.filter((r) => r.category.join('.') === 'diffwiki.plugin.diffwiki-qmd');
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].level).toBe('info');
    expect(forwarded[0].message.join('')).toBe('index stale — running qmd update');
  });

  it('defaults the log scope to the binary basename when no name is given', async () => {
    const binPath = path.join(scratchDir, 'my-adapter.mjs');
    await fs.writeFile(binPath, LOGGING_PLUGIN, 'utf8');

    await invokePlugin(['node', binPath], 'search', {});

    const forwarded = records.filter((r) => r.category.join('.') === 'diffwiki.plugin.my-adapter.mjs');
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].message.join('')).toBe('index stale — running qmd update');
  });
});
