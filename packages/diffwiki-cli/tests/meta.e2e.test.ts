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
    expect((await run(['collection', 'create', 'notes'])).ok).toBe(true);
    const article = await run(['article', 'create', 'notes:Setup', '-b', 'Public article', '--status', 'draft']);
    expect(article.ok).toBe(true);
    const source = await run(['meta', 'new', 'notes', '--template', 'external-source-extract', '--json']);
    expect(source.ok).toBe(true);
    const shared = JSON.parse(source.out);
    const event = await run(['meta', 'new', 'notes:setup.md', '--template', 'history', '--json']);
    const history = JSON.parse(event.out);
    expect(history.mirror_path).toBe(path.join(metaDir(), 'notes/setup.md'));
    expect(history.index_paths).toContain(path.join(metaDir(), 'META.md'));
    const original = await fs.readFile(history.path, 'utf8');
    expect(original).not.toContain('category: meta');
    expect(original).not.toContain('shape: history');
    const literal = '\n## Exact request\n\n> Keep  two spaces.\n\n```ts\nconst raw = "source-only-marker-729";\n```\n';
    await fs.appendFile(history.path, literal);
    await fs.appendFile(shared.path, '\nURL: https://example.test/paper\n');
    expect((await run(['article', 'update', 'notes:setup', '-b', 'Revised article'])).ok).toBe(true);
    const dream = JSON.parse(
      (await run(['meta', 'new', 'notes:setup.md', '--template', 'dream-learning', '--json'])).out,
    );
    await fs.appendFile(dream.path, `\nSource: [original](./${path.basename(history.path)})\n`);
    expect((await run(['meta', 'reindex', '--json'])).ok).toBe(true);
    expect(await fs.readFile(history.path, 'utf8')).toBe(original + literal);
    const collectionIndex = await fs.readFile(path.join(metaDir(), 'notes/.meta/META.md'), 'utf8');
    for (const id of [shared.id, history.id, dream.id]) expect(collectionIndex).toContain(id);
    for (const output of [await buildNavTree(), await buildSearchIndex(), await buildLinkGraph()]) {
      expect(JSON.stringify(output)).not.toContain('source-only-marker-729');
    }
    await fs.rm(dream.path);
    await run(['meta', 'reindex', 'notes']);
    expect(await fs.readFile(path.join(metaDir(), 'notes/setup.md'), 'utf8')).not.toContain(dream.id);
  }, 20_000);

  it('keeps metadata templates separate and uses the effective user override', async () => {
    await run(['collection', 'create', 'notes']);
    const articleTemplates = JSON.parse((await run(['templates', 'list', '--json'])).out);
    expect(articleTemplates.some((t: { shape: string }) => t.shape === 'history')).toBe(false);
    expect(JSON.parse((await run(['templates', 'list', '--category', 'meta', '--json'])).out)).toHaveLength(3);
    await fs.mkdir(templatesDir(), { recursive: true });
    const custom = path.join(templatesDir(), 'history-template.md');
    await fs.writeFile(
      custom,
      '---\nshape: history\ncategory: meta\npurpose: Local history\n---\n\n## My local capture\n',
    );
    await run(['templates', 'init']);
    const templates = JSON.parse((await run(['templates', 'list', '--category', 'meta', '--json'])).out);
    expect(templates.find((t: { shape: string }) => t.shape === 'history').path).toBe(custom);
    const record = JSON.parse((await run(['meta', 'new', 'notes', '--template', 'history', '--json'])).out);
    expect(await fs.readFile(record.path, 'utf8')).toContain('## My local capture');
  });

  it('rejects unknown collections, non-file targets, and traversal without allocating records', async () => {
    await run(['collection', 'create', 'notes']);
    for (const target of ['missing', 'notes:missing.md', 'notes:../escape.md', 'notes:guide']) {
      const result = await run(['meta', 'new', target, '--template', 'history', '--json']);
      expect(result.ok, target).toBe(false);
      expect(result.out, target).toBe('');
    }
    await expect(fs.access(path.join(metaDir(), 'notes/.meta/records'))).rejects.toThrow();
    const initialized = JSON.parse((await run(['meta', 'init', '--json'])).out);
    expect(initialized.errors).toEqual([]);
  });
});
