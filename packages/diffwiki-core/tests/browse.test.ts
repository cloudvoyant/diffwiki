import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildArticleTree,
  listArticleTree,
  readArticle,
  createCollection,
  registerCollection,
  CollectionNotFoundError,
  ArticleNotFoundError,
  InvalidTargetError,
} from '../src/index';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-'));
  process.env.DIFFWIKI_HOME = home;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('buildArticleTree (pure)', () => {
  it('nests dirs, dirs-first + alpha, slugs on leaves', () => {
    const tree = buildArticleTree(['b.md', 'a/inner.md', 'a/deep/x.mdx']);
    expect(tree.map((n) => n.name)).toEqual(['a', 'b']); // branch before leaf
    const a = tree[0];
    expect(a.children?.map((n) => n.name)).toEqual(['deep', 'inner']);
    const inner = a.children?.find((n) => n.name === 'inner');
    expect(inner?.slug).toBe('a/inner');
    const x = a.children?.find((n) => n.name === 'deep')?.children?.[0];
    expect(x?.slug).toBe('a/deep/x');
  });

  it('drops index/README files and gives folders a navigable slug', () => {
    const tree = buildArticleTree(['index.md', 'a/README.md', 'a/x.md']);
    // Root index is dropped → only the branch remains at top level.
    expect(tree.map((n) => n.name)).toEqual(['a']);
    expect(tree[0].slug).toBe('a'); // folder is navigable to its index
    // a/README is dropped → only the real article shows under the folder.
    expect(tree[0].children?.map((n) => n.name)).toEqual(['x']);
  });
});

describe('listArticleTree', () => {
  it('reads titles from frontmatter and nests', async () => {
    const c = await createCollection('notes');
    await fs.mkdir(path.join(c.path, 'guide'), { recursive: true });
    await fs.writeFile(path.join(c.path, 'intro.md'), '---\ntitle: Intro\n---\n# hi');
    await fs.writeFile(path.join(c.path, 'guide', 'setup.mdx'), '---\ntitle: Setup\n---\n# s');
    const tree = await listArticleTree('notes');
    expect(tree.find((n) => n.name === 'guide')?.children?.[0].title).toBe('Setup');
    expect(tree.find((n) => n.name === 'intro')?.title).toBe('Intro');
  });

  it('handles a collection registered OUTSIDE ~/.diffwiki/collections', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    try {
      const wiki = path.join(repo, 'docs', 'wiki');
      await fs.mkdir(wiki, { recursive: true });
      await fs.writeFile(path.join(wiki, 'a.md'), '# a');
      await registerCollection({ name: 'ext', type: 'repo', path: wiki, createdAt: 'x' });
      const tree = await listArticleTree('ext');
      expect(tree.map((n) => n.slug)).toEqual(['a']);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('throws for an unknown collection', async () => {
    await expect(listArticleTree('ghost')).rejects.toBeInstanceOf(CollectionNotFoundError);
  });
});

describe('readArticle', () => {
  it('resolves .md/.mdx, strips frontmatter, returns tags', async () => {
    const c = await createCollection('notes');
    await fs.writeFile(path.join(c.path, 'hello.md'), '---\ntitle: Hi\ntags: [x, y]\n---\n# body\ntext');
    const art = await readArticle('notes', 'hello');
    expect(art.title).toBe('Hi');
    expect(art.tags).toEqual(['x', 'y']);
    expect(art.body).toContain('body');
  });

  it('rejects path traversal and missing files', async () => {
    await createCollection('notes');
    await expect(readArticle('notes', '../secret')).rejects.toBeInstanceOf(InvalidTargetError);
    await expect(readArticle('notes', 'nope')).rejects.toBeInstanceOf(ArticleNotFoundError);
  });

  it('resolves a folder index and the collection-root index', async () => {
    const c = await createCollection('notes');
    await fs.writeFile(path.join(c.path, 'index.md'), '---\ntitle: Home\n---\n# home');
    await fs.mkdir(path.join(c.path, 'guide'), { recursive: true });
    await fs.writeFile(path.join(c.path, 'guide', 'index.md'), '---\ntitle: Guide\n---\n# g');

    const root = await readArticle('notes', ''); // collection root index
    expect(root.title).toBe('Home');

    const guide = await readArticle('notes', 'guide'); // folder index
    expect(guide.title).toBe('Guide');
    expect(guide.slug).toBe('guide');
  });
});
