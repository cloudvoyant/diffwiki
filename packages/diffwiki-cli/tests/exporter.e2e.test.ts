import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let outDir: string;
let fakeExportScript: string;

/**
 * A fake "export.mjs" that:
 * 1. Captures argv to a JSON file so the test can assert which args were passed.
 * 2. Exits 0 without doing actual work — so the test is fast.
 */
const FAKE_EXPORT_BODY = `
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const outDir = process.argv[process.argv.indexOf('--out') + 1];
await writeFile(path.join(outDir, '_args.json'), JSON.stringify(process.argv.slice(2)));
console.log('fake export done');
`;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  outDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-out-')));
  process.env.DIFFWIKI_HOME = home;

  // Write fake export script
  fakeExportScript = path.join(home, 'fake-export.mjs');
  await fs.writeFile(fakeExportScript, FAKE_EXPORT_BODY, 'utf8');
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  delete process.env.DIFFWIKI_APP_CMD;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('diffwiki export (CLI orchestration)', () => {
  it('passes --out and --base to the export script via DIFFWIKI_APP_CMD', async () => {
    process.env.DIFFWIKI_APP_CMD = `node ${fakeExportScript}`;

    const res = await run(['site', 'export', '-o', outDir, '-b', '/my-repo/']);
    expect(res.ok, `stderr: ${res.err}`).toBe(true);

    const argsFile = path.join(outDir, '_args.json');
    const args: string[] = JSON.parse(await fs.readFile(argsFile, 'utf8'));

    // The fake script receives: export --out <outDir> --base /my-repo/
    expect(args).toContain('export');
    expect(args).toContain('--out');
    expect(args[args.indexOf('--out') + 1]).toBe(outDir);
    expect(args).toContain('--base');
    expect(args[args.indexOf('--base') + 1]).toBe('/my-repo/');
  });

  it('defaults --base to / when not provided', async () => {
    process.env.DIFFWIKI_APP_CMD = `node ${fakeExportScript}`;

    await run(['site', 'export', '-o', outDir]);

    const args: string[] = JSON.parse(await fs.readFile(path.join(outDir, '_args.json'), 'utf8'));
    expect(args[args.indexOf('--base') + 1]).toBe('/');
  });

  it('surfaces a non-zero exit as an error', async () => {
    // Script that exits 1
    const failScript = path.join(home, 'fail.mjs');
    await fs.writeFile(failScript, 'process.exit(1);\n', 'utf8');
    process.env.DIFFWIKI_APP_CMD = `node ${failScript}`;

    // runExport throws a plain Error (not a DiffwikiError), so withErrors rethrows it.
    // That means parseAsync rejects — await to assert the error message.
    await expect(run(['site', 'export', '-o', outDir])).rejects.toThrow(/export failed/);
  });

  it('rejects a bad --filter glob BEFORE spawning the export script', async () => {
    // Seed a registry so listCollections() has names to match against.
    await fs.writeFile(
      path.join(home, 'registry.json'),
      JSON.stringify({
        version: '1',
        collections: [
          { name: 'notes', type: 'global', path: path.join(home, 'notes'), createdAt: new Date().toISOString() },
        ],
      }),
      'utf8',
    );
    // Point at the fake script: if selection validation did NOT fail fast, the
    // script would run and write _args.json.
    process.env.DIFFWIKI_APP_CMD = `node ${fakeExportScript}`;

    const res = await run(['site', 'export', '-o', outDir, '--filter', 'nope-*']);

    // withErrors turns the DiffwikiError into a clean stderr + exit 1 (no throw).
    expect(res.ok).toBe(false);
    expect(res.err).toMatch(/selection problem/i);
    expect(res.err).toMatch(/nope-\*/);

    // The child must never have spawned — no _args.json artifact.
    await expect(fs.access(path.join(outDir, '_args.json'))).rejects.toThrow();
  });
});
