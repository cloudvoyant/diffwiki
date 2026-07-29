import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-dep-')));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('deprecated aliases still work and warn', () => {
  it('create / config-set / add-article / list / query / update-article / tags / remove-article', async () => {
    const create = await run(['create', 'notes']);
    expect(create.ok).toBe(true);
    expect(create.err).toContain('is deprecated');

    const cfg = await run(['config-set', 'defaultCollection', 'notes']);
    expect(cfg.ok).toBe(true);
    expect(cfg.err).toContain('is deprecated');

    const added = await run(['add-article', '-p', 'notes:Legacy Note', '-t', 'a,b', '# Hi']);
    expect(added.ok).toBe(true);
    expect(added.err).toContain('is deprecated');
    const articlePath = added.out.trim();
    expect(articlePath.endsWith('legacy-note.md')).toBe(true);
    await fs.access(articlePath);

    const list = await run(['list']);
    expect(list.ok).toBe(true);
    expect(list.err).toContain('is deprecated');
    expect(list.out).toContain('notes');

    const q = await run(['query', 'legacy']);
    expect(q.ok).toBe(true);
    expect(q.err).toContain('is deprecated');
    expect(q.out).toContain('Legacy Note');

    expect((await run(['update-article', '-p', 'notes:legacy-note', '# Hi again'])).err).toContain('is deprecated');
    expect((await run(['add-tags', '-p', 'notes:legacy-note', 'c'])).err).toContain('is deprecated');
    expect((await run(['remove-tags', '-p', 'notes:legacy-note', 'a'])).err).toContain('is deprecated');
    const setTags = await run(['update-tags', '-p', 'notes:legacy-note', 'only']);
    expect(setTags.err).toContain('is deprecated');
    expect(setTags.out).toContain('only');

    const removed = await run(['remove-article', '-p', 'notes:legacy-note']);
    expect(removed.ok).toBe(true);
    expect(removed.err).toContain('is deprecated');
    await expect(fs.access(articlePath)).rejects.toBeTruthy();
  });

  it('config-get deprecated alias returns the value on stdout', async () => {
    await run(['collection', 'create', 'notes']);
    await run(['config', 'set', 'defaultCollection', 'notes']);
    const got = await run(['config-get', 'defaultCollection']);
    expect(got.ok).toBe(true);
    expect(got.err).toContain('is deprecated');
    expect(got.out.trim()).toBe('notes');
  });

  it('deprecation notice goes to stderr only, keeping stdout machine-readable', async () => {
    await run(['collection', 'create', 'notes']);
    await run(['config', 'set', 'defaultCollection', 'notes']);
    const added = await run(['add-article', '-p', 'notes:Clean Stdout', '# Body']);
    // stdout is exactly the article path — no deprecation text leaked in.
    expect(added.out.trim().endsWith('clean-stdout.md')).toBe(true);
    expect(added.out).not.toContain('is deprecated');
  });

  it('legacy alias data-payload stdout is byte-identical to the new command', async () => {
    // The parity guarantee is about the machine-readable DATA payload (article
    // paths, query result rows, config values) — NOT human-facing guidance hints,
    // which are intentionally updated to the new command spellings. These cases
    // pick handlers whose stdout is pure data so the diff must be exactly empty.
    await run(['collection', 'create', 'notes']);

    // article create → prints the created article path
    const legacyAdd = await run(['add-article', '-p', 'notes:Parity One', '# Body']);
    const newAdd = await run(['article', 'create', 'notes:Parity Two', '# Body']);
    // Normalize the title-derived slug so we compare the payload SHAPE, not the name.
    const normalize = (s: string): string => s.replace(/parity-\w+\.md$/, 'parity.md');
    expect(normalize(legacyAdd.out)).toBe(normalize(newAdd.out));
    expect(legacyAdd.err).toContain('is deprecated');
    expect(newAdd.err).not.toContain('is deprecated');

    // config get → prints the raw value, identical on both forms
    await run(['config', 'set', 'defaultCollection', 'notes']);
    const legacyGet = await run(['config-get', 'defaultCollection']);
    const newGet = await run(['config', 'get', 'defaultCollection']);
    expect(legacyGet.out).toBe(newGet.out);
    expect(legacyGet.out.trim()).toBe('notes');

    // search query → prints the result count + result rows, identical on both forms
    const legacyQuery = await run(['query', 'parity']);
    const newQuery = await run(['search', 'query', 'parity']);
    expect(legacyQuery.out).toBe(newQuery.out);
  });
});
