import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildNavTree, buildSearchIndex, buildLinkGraph, metaDir, templatesDir } from 'diffwiki-core';
import { run } from './helpers';

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-cli-meta-'));
  process.env.DIFFWIKI_HOME = home;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('metadata CLI', () => {
  it('captures collection and page sources through updates, with usable JSON paths', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    const article = await run(['article', 'create', 'notes:Setup', '-b', 'Public article', '--status', 'draft']);

    // Act
    const source = await run(['meta', 'new', 'notes', '--template', 'external-source-extract', '--json']);
    const shared = JSON.parse(source.out);
    const event = await run(['meta', 'new', 'notes:setup.md', '--template', 'history', '--json']);
    const history = JSON.parse(event.out);
    const original = await fs.readFile(history.path, 'utf8');
    const literal = '\n## Exact request\n\n> Keep  two spaces.\n\n```ts\nconst raw = "source-only-marker-729";\n```\n';
    await fs.appendFile(history.path, literal);
    await fs.appendFile(shared.path, '\nURL: https://example.test/paper\n');
    const updated = await run(['article', 'update', 'notes:setup', '-b', 'Revised article']);
    const dream = JSON.parse(
      (await run(['meta', 'new', 'notes:setup.md', '--template', 'dream-learning', '--json'])).out,
    );
    await fs.appendFile(dream.path, `\nSource: [original](./${path.basename(history.path)})\n`);
    const indexed = await run(['meta', 'reindex', '--json']);

    // Assert
    expect(article.ok).toBe(true);
    expect(source.ok).toBe(true);
    expect(event.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(indexed.ok).toBe(true);
    expect(history.mirror_path).toBe(path.join(metaDir(), 'notes/setup.md'));
    expect(history.index_paths).toContain(path.join(metaDir(), 'META.md'));
    expect(original).not.toContain('category: meta');
    expect(original).not.toContain('shape: history');
    expect(await fs.readFile(history.path, 'utf8')).toBe(original + literal);
    const collectionIndex = await fs.readFile(path.join(metaDir(), 'notes/.meta/META.md'), 'utf8');
    for (const id of [shared.id, history.id, dream.id]) expect(collectionIndex).toContain(id);
  });

  it('excludes raw sources from navigation, search, and graphs', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    await run(['article', 'create', 'notes:Setup', '-b', 'Public article']);
    const history = JSON.parse((await run(['meta', 'new', 'notes:setup.md', '--template', 'history', '--json'])).out);
    await fs.appendFile(history.path, '\nsource-only-marker-729\n');

    // Act
    const outputs = [await buildNavTree(), await buildSearchIndex(), await buildLinkGraph()];

    // Assert
    for (const output of outputs) {
      expect(JSON.stringify(output)).not.toContain('source-only-marker-729');
    }
  }, 20_000);

  it('removes a manually deleted learning from generated page links', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    await run(['article', 'create', 'notes:Setup']);
    const dream = JSON.parse(
      (await run(['meta', 'new', 'notes:setup.md', '--template', 'dream-learning', '--json'])).out,
    );
    await fs.rm(dream.path);

    // Act
    const indexed = await run(['meta', 'reindex', 'notes']);

    // Assert
    expect(indexed.ok).toBe(true);
    expect(await fs.readFile(path.join(metaDir(), 'notes/setup.md'), 'utf8')).not.toContain(dream.id);
  });

  it('keeps metadata templates out of the default article template list', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);

    // Act
    const articleTemplates = JSON.parse((await run(['templates', 'list', '--json'])).out);
    const metaTemplates = JSON.parse((await run(['templates', 'list', '--category', 'meta', '--json'])).out);

    // Assert
    expect(articleTemplates.some((t: { shape: string }) => t.shape === 'history')).toBe(false);
    expect(metaTemplates).toHaveLength(3);
  });

  it('keeps and uses the effective user template override', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    await fs.mkdir(templatesDir(), { recursive: true });
    const custom = path.join(templatesDir(), 'history-template.md');
    await fs.writeFile(
      custom,
      '---\nshape: history\ncategory: meta\npurpose: Local history\n---\n\n## My local capture\n',
    );

    // Act
    await run(['templates', 'init']);
    const templates = JSON.parse((await run(['templates', 'list', '--category', 'meta', '--json'])).out);
    const record = JSON.parse((await run(['meta', 'new', 'notes', '--template', 'history', '--json'])).out);

    // Assert
    expect(templates.find((t: { shape: string }) => t.shape === 'history').path).toBe(custom);
    expect(await fs.readFile(record.path, 'utf8')).toContain('## My local capture');
  });

  it.each(['missing', 'notes:missing.md', 'notes:../escape.md', 'notes:guide'])(
    'rejects invalid target %s without allocating records',
    async (target) => {
      // Arrange
      await run(['collection', 'create', 'notes']);

      // Act
      const result = await run(['meta', 'new', target, '--template', 'history', '--json']);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.out).toBe('');
      await expect(fs.access(path.join(metaDir(), 'notes/.meta/records'))).rejects.toThrow();
    },
  );

  it('initializes existing collections through the CLI', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);

    // Act
    const initialized = JSON.parse((await run(['meta', 'init', '--json'])).out);

    // Assert
    expect(initialized.errors).toEqual([]);
  });
});
