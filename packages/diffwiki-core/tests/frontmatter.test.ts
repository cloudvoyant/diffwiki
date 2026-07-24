import { describe, expect, it } from 'vitest';
import { parseArticle, serializeArticle } from '../src/frontmatter';

describe('parseArticle', () => {
  it('parses well-formed frontmatter normally', () => {
    const raw = '---\ntitle: Hello World\ntags:\n  - alpha\n  - beta\ncreated: "2026-01-01"\n---\n\n# Body\n';
    const result = parseArticle(raw);
    expect(result.title).toBe('Hello World');
    expect(result.tags).toEqual(['alpha', 'beta']);
    expect(result.created).toBe('2026-01-01');
    expect(result.body).toBe('# Body\n');
  });

  it('does not throw on a title with an unquoted colon (malformed YAML)', () => {
    const raw =
      '---\ntitle: TanStack Router: Protecting Routes with Auth Guards\ntags:\n  - react\n---\n\n# body content\n';
    const result = parseArticle(raw);
    expect(result.title).toBe('TanStack Router: Protecting Routes with Auth Guards');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('# body content\n');
  });

  it('handles a file with no frontmatter fence at all', () => {
    const raw = '# Just a heading\n\nSome paragraph text.\n';
    const result = parseArticle(raw);
    expect(result.title).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('# Just a heading\n\nSome paragraph text.\n');
  });

  it('handles an empty string', () => {
    const result = parseArticle('');
    expect(result.title).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('');
  });

  it('extracts a quoted title from malformed frontmatter', () => {
    const raw = '---\ntitle: "Quoted: Title"\ntags: [broken\n---\n\n# body\n';
    const result = parseArticle(raw);
    expect(result.title).toBe('Quoted: Title');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('# body\n');
  });

  it('returns empty title when malformed frontmatter has no title line', () => {
    const raw = '---\nauthor: someone\ntags: [broken\n---\n\nBody here.\n';
    const result = parseArticle(raw);
    expect(result.title).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('Body here.\n');
  });
});

describe('serializeArticle', () => {
  it('writes only title and tags — never created/updated', () => {
    const out = serializeArticle({ title: 'Hello', tags: ['a', 'b'], body: '# Body\n' });
    expect(out).toContain('title: Hello');
    expect(out).not.toMatch(/^created:/m);
    expect(out).not.toMatch(/^updated:/m);
    // Round-trips through the parser.
    const back = parseArticle(out);
    expect(back.title).toBe('Hello');
    expect(back.tags).toEqual(['a', 'b']);
    expect(back.body).toBe('# Body\n');
  });
});
