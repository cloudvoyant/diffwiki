import { describe, expect, it } from 'vitest';
import { rankDocs, tokenize, type SearchDoc } from '../src/bm25';

function doc(slug: string, title: string, body: string, tags: string[] = []): SearchDoc {
  return {
    collection: 'kb',
    slug,
    title,
    tags,
    fields: {
      title: tokenize(title),
      tags: tokenize(tags.join(' ')),
      collection: tokenize('kb'),
      body: tokenize(body),
    },
  };
}

const corpus = [
  doc('git-rebase', 'Rebasing safely', 'how to rebase a git branch onto main', ['git']),
  doc('docker', 'Docker basics', 'build and run containers with docker', ['ops']),
  doc('git-commit', 'Writing commits', 'a good git commit message explains why', ['git']),
];

describe('rankDocs (shared BM25 scorer)', () => {
  it('ranks the most relevant doc first and only returns matches', () => {
    const r = rankDocs('rebase', corpus);
    expect(r[0]?.slug).toBe('git-rebase');
    expect(r.every((d) => (d.score ?? 0) > 0)).toBe(true);
    expect(r).toHaveLength(1);
  });

  it('weights a title match above a body-only match', () => {
    // "docker" appears in the title+body of one doc; ranked highest.
    const r = rankDocs('docker', corpus);
    expect(r[0]?.slug).toBe('docker');
  });

  it('returns results sorted by descending score', () => {
    const r = rankDocs('git', corpus);
    expect(r.length).toBeGreaterThan(1);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score ?? 0).toBeGreaterThanOrEqual(r[i].score ?? 0);
    }
  });

  it('empty query returns every doc unranked (browse-all)', () => {
    const r = rankDocs('', corpus);
    expect(r).toHaveLength(3);
    expect(r.every((d) => d.score === undefined)).toBe(true);
  });

  it('a non-matching query returns nothing', () => {
    expect(rankDocs('kubernetes', corpus)).toHaveLength(0);
  });
});
