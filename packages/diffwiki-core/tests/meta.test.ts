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
    // Arrange
    const entry = { name: 'repo', path: outside, type: 'external' as const, createdAt: 'now' };
    await fs.mkdir(path.join(outside, 'guide'));
    for (const file of ['index.md', 'README.md', 'guide/index.md', 'guide/a.md', 'guide/a.mdx']) {
      await fs.writeFile(path.join(outside, file), '---\naudience: system\nstatus: draft\n---\nraw article');
    }
    await registerCollection(entry);

    // Act
    const result = await initMeta([entry]);

    // Assert
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(5);
    const mirror = await fs.readFile(path.join(metaDir(), 'repo/guide/a.mdx'), 'utf8');
    expect(mirror).toContain('No page source history captured');
    expect(mirror).not.toContain('raw article');
    expect(await fs.readFile(path.join(metaDir(), 'META.md'), 'utf8')).toContain('repo/.meta/META.md');
  });

  it('keeps existing manifests when initialization is repeated', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Page', tags: [] });
    const mirror = path.join(metaDir(), 'notes/page.md');
    await fs.appendFile(mirror, '\nHuman note.\n');
    const original = await fs.readFile(mirror, 'utf8');

    // Act
    const result = await initMeta([entry]);

    // Assert
    expect(result.created).toEqual([]);
    expect(result.kept).toEqual([mirror]);
    expect(await fs.readFile(mirror, 'utf8')).toBe(original);
  });

  it('creates mirrors through article writes, preserving original records after updates and removals', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Setup', tags: [], body: 'before' });
    const body = '\n## User request\n\n    exact indentation\n```ts\nconst x = 1;\n```\n';
    const record = await createMetaRecord(entry, 'setup.md', 'history', body);
    const original = await fs.readFile(record.path, 'utf8');

    // Act
    await updateArticleBody('notes:setup', 'after');
    await removeArticle('notes:setup');
    await removeCollection('notes');
    const indexed = await reindexMeta();

    // Assert
    expect(original.endsWith(body)).toBe(true);
    expect(await fs.readFile(record.path, 'utf8')).toBe(original);
    expect(indexed.errors).toEqual([]);
    expect(await fs.readFile(path.join(metaDir(), 'notes/setup.md'), 'utf8')).toContain(record.id);
  });

  it('reindexes edits without replacing evidence or human notes', async () => {
    // Arrange
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

    // Act
    await reindexMeta('notes');

    // Assert
    expect(await fs.readFile(learning.path, 'utf8')).toBe(edited);
    expect(await fs.readFile(mirror, 'utf8')).toContain('Human notes stay here.');
    expect(await fs.readFile(shared.path, 'utf8')).toContain('https://example.test/doc');
  });

  it('removes deleted learnings from listings without recreating their records', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Page', tags: [] });
    const learning = await createMetaRecord(entry, 'page.md', 'dream-learning', 'Original evidence.');
    await fs.rm(learning.path);

    // Act
    await reindexMeta('notes');

    // Assert
    expect(await fs.readFile(path.join(metaDir(), 'notes/page.md'), 'utf8')).not.toContain(learning.id);
    await expect(fs.access(learning.path)).rejects.toThrow();
  });

  it('reports bad records', async () => {
    // Arrange
    const entry = await createCollection('notes');
    const record = await createMetaRecord(entry, undefined, 'history', 'original');
    await fs.writeFile(record.path, 'not a record header');

    // Act
    const result = await reindexMeta('notes');

    // Assert
    expect(result.warnings[0]).toContain('missing record header');
  });

  it('reports unreadable roots instead of treating them as empty', async () => {
    // Arrange
    const entry = { name: 'missing', path: path.join(outside, 'absent') };

    // Act
    const result = await initMeta([entry]);

    // Assert
    expect(result.errors[0]).toContain('ENOENT');
  });

  it.each([
    ['../escape.md', 'traversal'],
    ['/escape.md', 'relative'],
  ])('rejects invalid metadata path %s', async (file, message) => {
    // Arrange
    const entry = await createCollection('notes');

    // Act
    const result = await ensureArticleMeta(entry, file).catch((error: Error) => error);

    // Assert
    expect(result).toMatchObject({ message: expect.stringContaining(message) });
  });

  it('rejects metadata symlinks before writing outside the store', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await fs.symlink(outside, path.join(metaDir(), 'notes/linked'));

    // Act
    const result = await ensureArticleMeta(entry, 'linked/escape.md').catch((error: Error) => error);

    // Assert
    expect(result).toMatchObject({ message: expect.stringContaining('symlink') });
    await expect(fs.access(path.join(outside, 'escape.md'))).rejects.toThrow();
  });

  it('rejects article symlinks that escape the source collection', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await fs.symlink(path.join(outside, 'outside.md'), path.join(entry.path, 'outside.md'));
    await fs.writeFile(path.join(outside, 'outside.md'), 'external');

    // Act
    const result = await createMetaRecord(entry, 'outside.md', 'history', 'raw').catch((error: Error) => error);

    // Assert
    expect(result).toMatchObject({ message: expect.stringContaining('within its collection') });
  });

  it('keeps saved article content on metadata failure', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await fs.writeFile(path.join(metaDir(), 'notes/blocked'), 'a path conflict');

    // Act
    const result = await createArticle({ target: 'notes:Blocked/Page', tags: [], body: 'saved content' }).catch(
      (error: Error) => error,
    );

    // Assert
    expect(result).toMatchObject({ message: expect.stringContaining('Article saved at') });
    expect(await fs.readFile(path.join(entry.path, 'blocked/page.md'), 'utf8')).toContain('saved content');
  });

  it('repairs a missing manifest through init after a path conflict is removed', async () => {
    // Arrange
    const entry = await createCollection('notes');
    await fs.writeFile(path.join(metaDir(), 'notes/blocked'), 'a path conflict');
    await createArticle({ target: 'notes:Blocked/Page', tags: [], body: 'saved content' }).catch(() => {});
    await fs.rm(path.join(metaDir(), 'notes/blocked'));

    // Act
    const result = await initMeta([entry]);

    // Assert
    expect(result.errors).toEqual([]);
    expect(await fs.readFile(path.join(metaDir(), 'notes/blocked/page.md'), 'utf8')).toContain('No page source');
  });

  it('keeps an allocated record if index refresh fails', async () => {
    // Arrange
    const entry = await createCollection('notes');
    const index = path.join(metaDir(), 'notes/.meta/META.md');
    await fs.writeFile(index, '# Sources\n<!-- diffwiki:meta:start -->\n');

    // Act
    const result = await createMetaRecord(entry, undefined, 'history', '\nOriginal bytes.\n').catch(
      (error: Error) => error,
    );

    // Assert
    expect(result).toMatchObject({ message: expect.stringContaining('Record saved at') });
    const records = path.join(metaDir(), 'notes/.meta/records');
    const record = path.join(records, (await fs.readdir(records))[0]);
    const raw = await fs.readFile(record, 'utf8');
    expect(raw).toContain('\nOriginal bytes.\n');
  });

  it('reindexes retained records after an incomplete index is repaired', async () => {
    // Arrange
    const entry = await createCollection('notes');
    const index = path.join(metaDir(), 'notes/.meta/META.md');
    await fs.writeFile(index, '# Sources\n<!-- diffwiki:meta:start -->\n');
    await createMetaRecord(entry, undefined, 'history', '\nOriginal bytes.\n').catch(() => {});
    const records = path.join(metaDir(), 'notes/.meta/records');
    const record = path.join(records, (await fs.readdir(records))[0]);
    const raw = await fs.readFile(record, 'utf8');
    await fs.writeFile(index, '# Sources\nUser note.\n');

    // Act
    const result = await reindexMeta('notes');

    // Assert
    expect(result.errors).toEqual([]);
    expect(await fs.readFile(record, 'utf8')).toBe(raw);
    expect(await fs.readFile(index, 'utf8')).toContain(path.basename(record, '.md'));
    expect(await fs.readFile(index, 'utf8')).toContain('User note.');
  });
});
