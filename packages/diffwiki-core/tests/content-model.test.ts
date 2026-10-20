import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArticle, serializeArticle, patchArticle, parseFrontmatter } from '../src/frontmatter';
import { slugifyPath } from '../src/slugify';
import { readContextCollections } from '../src/project';
import { setConfigValue, showSystemEnabled } from '../src/config';

describe('status + audience round-trip', () => {
  it('serializes/re-parses deprecated and system', () => {
    const a = serializeArticle({ title: 'X', tags: ['t'], status: 'deprecated', body: 'hi\n' });
    expect(a).toContain('status: deprecated');
    expect(parseArticle(a).status).toBe('deprecated');
    const b = serializeArticle({ title: 'Y', tags: [], audience: 'system', body: 'hi\n' });
    expect(b).toContain('audience: system');
    expect(parseArticle(b).audience).toBe('system');
  });
  it('omits defaults (published/public)', () => {
    const raw = serializeArticle({ title: 'Z', tags: [], status: 'published', audience: 'public', body: 'hi\n' });
    expect(raw).not.toContain('status:');
    expect(raw).not.toContain('audience:');
  });
});

describe('slugifyPath', () => {
  it('preserves subdir separators, slugs each segment', () => {
    expect(slugifyPath('My Project/Session 1')).toBe('my-project/session-1');
    expect(slugifyPath('  ')).toBe('untitled');
  });
});

describe('preserving article edits', () => {
  const raw =
    '---\r\n# Keep this comment\r\ntitle: index # title note\r\ntags: [react]\r\ncustom: { owner: human }\r\nstatus: draft\r\n---\r\n\r\n  Body bytes  \r\n';

  it('changes only the scalar title, retaining comments, fields, CRLF, and body bytes', () => {
    expect(patchArticle(raw, { title: 'React' })).toBe(raw.replace('title: index', 'title: React'));
  });

  it('retains unknown fields/comments through combined edits and preserves untouched bodies', () => {
    const next = patchArticle(raw, { title: 'React: Patterns', tags: ['react', 'guide'], status: 'deprecated' });
    expect(parseArticle(next)).toMatchObject({
      title: 'React: Patterns',
      tags: ['react', 'guide'],
      status: 'deprecated',
    });
    expect(parseFrontmatter(next).data.custom).toEqual({ owner: 'human' });
    expect(next).toContain('# Keep this comment');
    expect(next.endsWith('\r\n\r\n  Body bytes  \r\n')).toBe(true);
    const replaced = patchArticle(raw, { title: 'New' }, 'replacement\n');
    expect(parseFrontmatter(replaced).data.custom).toEqual({ owner: 'human' });
    expect(replaced.endsWith('replacement\n')).toBe(true);
  });

  it('does not rebuild frontmatter during body-only edits or add null headers to plain files', () => {
    expect(patchArticle(raw, {}, 'new')).toBe(raw.slice(0, raw.indexOf('\r\n\r\n  Body') + 2) + 'new');
    expect(patchArticle('plain text', {}, 'new')).toBe('new');
  });
});

describe('diffwiki.yaml context + showSystem config', () => {
  let dir: string;
  let home: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-proj-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-'));
    process.env.DIFFWIKI_HOME = home;
  });
  afterEach(async () => {
    delete process.env.DIFFWIKI_HOME;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('reads context.collections', async () => {
    await fs.writeFile(path.join(dir, 'diffwiki.yaml'), 'collections: []\ncontext:\n  collections: [a, kb]\n', 'utf8');
    expect(await readContextCollections(dir)).toEqual(['a', 'kb']);
  });
  it('showSystemEnabled reflects config', async () => {
    expect(await showSystemEnabled()).toBe(false);
    await setConfigValue('showSystem', 'true');
    expect(await showSystemEnabled()).toBe(true);
  });
});
