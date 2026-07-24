import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addTags,
  createArticle,
  createCollection,
  doctor,
  findCollection,
  initRepoWiki,
  listCollections,
  parseAddTarget,
  parsePathTarget,
  query,
  readRepoConfig,
  removeArticle,
  removeCollection,
  removeTags,
  setConfigValue,
  setTags,
  slugify,
  updateArticleBody,
  CollectionExistsError,
  CollectionNotFoundError,
  NoDefaultCollectionError,
  ArticleNotFoundError,
  InvalidTargetError,
} from '../src/index';
import { parseArticle } from '../src/frontmatter';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-'));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('slugify', () => {
  it('slugs headings and titles', () => {
    expect(slugify('# Hello, World!')).toBe('hello-world');
    expect(slugify('   ')).toBe('untitled');
  });
});

describe('target parsing', () => {
  it('parses add targets with optional collection', () => {
    expect(parseAddTarget('notes:My Title')).toEqual({ collection: 'notes', title: 'My Title' });
    expect(parseAddTarget('My Title')).toEqual({ title: 'My Title' });
  });
  it('requires both parts for path targets', () => {
    expect(parsePathTarget('notes:a.md')).toEqual({ collection: 'notes', file: 'a.md' });
    expect(() => parsePathTarget('a.md')).toThrow();
  });
  it('rejects an empty title on add targets', () => {
    expect(() => parseAddTarget('notes:')).toThrow(InvalidTargetError);
  });
  it('rejects an empty collection on path targets', () => {
    expect(() => parsePathTarget(':title')).toThrow(InvalidTargetError);
  });
});

describe('collections & articles', () => {
  it('rejects duplicate collections', async () => {
    await createCollection('notes');
    await expect(createCollection('notes')).rejects.toBeInstanceOf(CollectionExistsError);
  });

  it('creates, updates, tags, and removes an article', async () => {
    await createCollection('notes');
    const article = await createArticle({ target: 'notes:Hello World', tags: ['a', 'b'], body: '# Hi\n\nbody' });
    expect(article.path.endsWith('hello-world.md')).toBe(true);

    const onDisk = parseArticle(await fs.readFile(article.path, 'utf8'));
    expect(onDisk.title).toBe('Hello World');
    expect(onDisk.tags).toEqual(['a', 'b']);

    await updateArticleBody('notes:hello-world', '# Hi\n\nchanged');
    expect(parseArticle(await fs.readFile(article.path, 'utf8')).body).toContain('changed');

    await addTags('notes:hello-world', ['c']);
    await removeTags('notes:hello-world', ['a']);
    await setTags('notes:hello-world', ['x', 'y', 'x']);
    expect(parseArticle(await fs.readFile(article.path, 'utf8')).tags).toEqual(['x', 'y']);

    const removed = await removeArticle('notes:hello-world');
    expect(removed).toBe(article.path);
    await expect(removeArticle('notes:hello-world')).rejects.toBeInstanceOf(ArticleNotFoundError);
  });

  it('never writes created/updated frontmatter on create, body, or tag edits', async () => {
    await createCollection('notes');
    const article = await createArticle({ target: 'notes:Timestamped', tags: ['a'], body: '# x' });
    const noTimestamps = async () => {
      const raw = await fs.readFile(article.path, 'utf8');
      expect(raw).not.toMatch(/^created:/m);
      expect(raw).not.toMatch(/^updated:/m);
    };
    await noTimestamps();

    await updateArticleBody('notes:timestamped', '# x\n\nedited');
    await noTimestamps();

    await addTags('notes:timestamped', ['b']);
    await noTimestamps();
  });

  it('resolves title-based lookups the same way add slugifies them', async () => {
    await createCollection('notes');
    const article = await createArticle({ target: 'notes:My Title', tags: [], body: '# x' });
    expect(article.path.endsWith('my-title.md')).toBe(true);

    // The natural update mirrors the add target (original title, not the slug).
    await updateArticleBody('notes:My Title', '# x\n\nchanged');
    expect(parseArticle(await fs.readFile(article.path, 'utf8')).body).toContain('changed');
  });

  it('uses the default collection when none is given', async () => {
    await createCollection('notes');
    await setConfigValue('defaultCollection', 'notes');
    const article = await createArticle({ target: 'Just a title', tags: [] });
    expect(article.collection).toBe('notes');
  });

  it('errors without a default collection', async () => {
    await expect(createArticle({ target: 'Orphan', tags: [] })).rejects.toBeInstanceOf(NoDefaultCollectionError);
  });
});

describe('query (dummy)', () => {
  it('matches on title and tags', async () => {
    await createCollection('notes');
    await createArticle({ target: 'notes:Rebasing safely', tags: ['git'], body: '# x' });
    await createArticle({ target: 'notes:Groceries', tags: ['home'], body: '# y' });
    expect((await query('rebasing')).map((h) => h.title)).toEqual(['Rebasing safely']);
    expect(await query('')).toHaveLength(2);
  });

  it('errors on an unregistered explicit collection instead of returning nothing', async () => {
    await expect(query('anything', { collection: 'ghost' })).rejects.toBeInstanceOf(CollectionNotFoundError);
  });
});

describe('config validation', () => {
  it('rejects a defaultCollection that is not registered', async () => {
    await expect(setConfigValue('defaultCollection', 'ghost')).rejects.toBeInstanceOf(CollectionNotFoundError);
  });
  it('accepts a defaultCollection that exists', async () => {
    await createCollection('notes');
    await expect(setConfigValue('defaultCollection', 'notes')).resolves.toBeUndefined();
  });
});

describe('readRepoConfig', () => {
  it('reads back the diffwiki.yaml that init wrote', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    try {
      await initRepoWiki({ cwd: repo, collection: 'my-wiki', wikiPath: 'docs/wiki' });
      const cfg = await readRepoConfig(repo);
      expect(cfg).toEqual({ collection: 'my-wiki', path: 'docs/wiki' });
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
  it('returns undefined when no diffwiki.yaml is present', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    try {
      expect(await readRepoConfig(repo)).toBeUndefined();
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});

describe('init & doctor', () => {
  it('initializes a repo wiki, writes diffwiki.yaml, and registers it', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    try {
      const entry = await initRepoWiki({ cwd: repo, collection: 'my-wiki', wikiPath: 'docs/wiki' });
      expect(entry.type).toBe('repo');
      expect(entry.path).toBe(path.join(repo, 'docs/wiki'));
      const yaml = await fs.readFile(path.join(repo, 'diffwiki.yaml'), 'utf8');
      expect(yaml).toContain('collection: my-wiki');
      expect(yaml).toContain('path: docs/wiki');

      const diagnostics = await doctor();
      expect(diagnostics.some((d) => d.message.includes('my-wiki'))).toBe(true);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('disambiguates a name that a different path already owns', async () => {
    const repoA = await fs.mkdtemp(path.join(os.tmpdir(), 'repoA-'));
    const repoB = await fs.mkdtemp(path.join(os.tmpdir(), 'repoB-'));
    try {
      const a = await initRepoWiki({ cwd: repoA, collection: 'shared' });
      const b = await initRepoWiki({ cwd: repoB, collection: 'shared' });
      expect(a.name).toBe('shared');
      expect(b.name).toBe('shared-2');
    } finally {
      await fs.rm(repoA, { recursive: true, force: true });
      await fs.rm(repoB, { recursive: true, force: true });
    }
  });
});

describe('removeCollection', () => {
  it('deletes a global collection directory and deregisters it', async () => {
    const entry = await createCollection('notes');
    await createArticle({ target: 'notes:Hello', tags: [], body: '# Hi' });
    await fs.access(entry.path);

    const removed = await removeCollection('notes');
    expect(removed.name).toBe('notes');
    await expect(fs.access(entry.path)).rejects.toBeTruthy();
    expect(await findCollection('notes')).toBeUndefined();
    expect(await listCollections()).toHaveLength(0);
  });

  it('deregisters a repo wiki without deleting its files', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    try {
      const entry = await initRepoWiki({ cwd: repo, collection: 'repo-wiki', wikiPath: 'wiki' });
      await removeCollection('repo-wiki');
      expect(await findCollection('repo-wiki')).toBeUndefined();
      // Repo files are the user's — left intact.
      await fs.access(entry.path);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('throws when the collection does not exist', async () => {
    await expect(removeCollection('missing')).rejects.toBeInstanceOf(CollectionNotFoundError);
  });
});
