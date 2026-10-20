import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createArticle,
  createCollection,
  createMetaRecord,
  ensureArticleMeta,
  initMeta,
  metaDir,
  registerCollection,
  reindexMeta,
  removeArticle,
  removeCollection,
  updateArticleBody,
} from '../src/index';

let home: string;
let outside: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-meta-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-source-'));
  process.env.DIFFWIKI_HOME = home;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await Promise.all([fs.rm(home, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]);
});

describe('source metadata', () => {
  it('mirrors actual file identities, including indexes, MDX, and hidden-audience articles outside home', async () => {
    const entry = { name: 'repo', path: outside, type: 'external' as const, createdAt: 'now' };
    await fs.mkdir(path.join(outside, 'guide'));
    for (const file of ['index.md', 'README.md', 'guide/index.md', 'guide/a.md', 'guide/a.mdx']) {
      await fs.writeFile(path.join(outside, file), '---\naudience: system\nstatus: draft\n---\nraw article');
    }
    await registerCollection(entry);
    const result = await initMeta([entry]);
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(5);
    expect((await initMeta([entry])).kept).toHaveLength(5);
    const mirror = await fs.readFile(path.join(metaDir(), 'repo/guide/a.mdx'), 'utf8');
    expect(mirror).toContain('No page source history captured');
    expect(mirror).not.toContain('raw article');
    expect(await fs.readFile(path.join(metaDir(), 'META.md'), 'utf8')).toContain('repo/.meta/META.md');
  });

  it('creates mirrors through article writes, preserving original records after updates and removals', async () => {
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Setup', tags: [], body: 'before' });
    const body = '\n## User request\n\n    exact indentation\n```ts\nconst x = 1;\n```\n';
    const record = await createMetaRecord(entry, 'setup.md', 'history', body);
    const original = await fs.readFile(record.path, 'utf8');
    expect(original.endsWith(body)).toBe(true);
    await updateArticleBody('notes:setup', 'after');
    await removeArticle('notes:setup');
    await removeCollection('notes');
    expect(await fs.readFile(record.path, 'utf8')).toBe(original);
    expect((await reindexMeta()).errors).toEqual([]);
    expect(await fs.readFile(path.join(metaDir(), 'notes/setup.md'), 'utf8')).toContain(record.id);
  });

  it('reindexes edits and deletions without replacing evidence or human notes', async () => {
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Page', tags: [] });
    const shared = await createMetaRecord(
      entry,
      undefined,
      'external-source-extract',
      'URL: https://example.test/doc\n',
    );
    const learning = await createMetaRecord(
      entry,
      'page.md',
      'dream-learning',
      `Source: [doc](./${path.basename(shared.path)})\n`,
    );
    await fs.appendFile(learning.path, '\nHuman correction: exact text.\n');
    const edited = await fs.readFile(learning.path, 'utf8');
    const mirror = path.join(metaDir(), 'notes/page.md');
    await fs.appendFile(mirror, '\nHuman notes stay here.\n');
    await reindexMeta('notes');
    expect(await fs.readFile(learning.path, 'utf8')).toBe(edited);
    expect(await fs.readFile(mirror, 'utf8')).toContain('Human notes stay here.');
    await fs.rm(learning.path);
    await reindexMeta('notes');
    expect(await fs.readFile(mirror, 'utf8')).not.toContain(learning.id);
    expect(await fs.readFile(shared.path, 'utf8')).toContain('https://example.test/doc');
  });

  it('reports bad records and unreadable roots, rather than treating them as empty', async () => {
    const entry = await createCollection('notes');
    const record = await createMetaRecord(entry, undefined, 'history', 'original');
    await fs.writeFile(record.path, 'not a record header');
    expect((await reindexMeta('notes')).warnings[0]).toContain('missing record header');
    expect((await initMeta([{ name: 'missing', path: path.join(outside, 'absent') }])).errors[0]).toContain('ENOENT');
  });

  it('rejects traversal and symlinks before writing outside the metadata store', async () => {
    const entry = await createCollection('notes');
    await expect(ensureArticleMeta(entry, '../escape.md')).rejects.toThrow('traversal');
    await expect(ensureArticleMeta(entry, '/escape.md')).rejects.toThrow('relative');
    await fs.symlink(outside, path.join(metaDir(), 'notes/linked'));
    await expect(ensureArticleMeta(entry, 'linked/escape.md')).rejects.toThrow('symlink');
    await expect(fs.access(path.join(outside, 'escape.md'))).rejects.toThrow();
    await fs.symlink(path.join(outside, 'outside.md'), path.join(entry.path, 'outside.md'));
    await fs.writeFile(path.join(outside, 'outside.md'), 'external');
    await expect(createMetaRecord(entry, 'outside.md', 'history', 'raw')).rejects.toThrow('within its collection');
  });

  it('keeps saved content on metadata failure and recovers through init', async () => {
    const entry = await createCollection('notes');
    await fs.writeFile(path.join(metaDir(), 'notes/blocked'), 'a path conflict');
    await expect(createArticle({ target: 'notes:Blocked/Page', tags: [], body: 'saved content' })).rejects.toThrow(
      'Article saved at',
    );
    expect(await fs.readFile(path.join(entry.path, 'blocked/page.md'), 'utf8')).toContain('saved content');
    await fs.rm(path.join(metaDir(), 'notes/blocked'));
    expect((await initMeta([entry])).errors).toEqual([]);
    expect(await fs.readFile(path.join(metaDir(), 'notes/blocked/page.md'), 'utf8')).toContain('No page source');
  });

  it('keeps an allocated record if index refresh fails and reindexes it after repair', async () => {
    const entry = await createCollection('notes');
    const index = path.join(metaDir(), 'notes/.meta/META.md');
    await fs.writeFile(index, '# Sources\n<!-- diffwiki:meta:start -->\n');
    await expect(createMetaRecord(entry, undefined, 'history', '\nOriginal bytes.\n')).rejects.toThrow(
      'Record saved at',
    );
    const records = path.join(metaDir(), 'notes/.meta/records');
    const record = path.join(records, (await fs.readdir(records))[0]);
    const raw = await fs.readFile(record, 'utf8');
    await fs.writeFile(index, '# Sources\nUser note.\n');
    expect((await reindexMeta('notes')).errors).toEqual([]);
    expect(await fs.readFile(record, 'utf8')).toBe(raw);
    expect(await fs.readFile(index, 'utf8')).toContain(path.basename(record, '.md'));
    expect(await fs.readFile(index, 'utf8')).toContain('User note.');
  });
});
