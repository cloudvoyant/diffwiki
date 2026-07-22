import { describe, it, expect } from 'vitest';
import { toTreeNodes } from '../../src/lib/tree';
import type { ArticleNode } from 'diffwiki-core';

describe('toTreeNodes', () => {
  it('maps leaves to route paths and preserves nesting', () => {
    const input: ArticleNode[] = [
      {
        name: 'guide',
        title: 'guide',
        children: [{ name: 'setup', title: 'Setup', slug: 'guide/setup' }],
      },
      { name: 'intro', title: 'Intro', slug: 'intro' },
    ];
    const out = toTreeNodes('notes', input);
    expect(out[0].children?.[0].path).toBe('/notes/guide/setup');
    expect(out[1].path).toBe('/notes/intro');
    expect(out[0].path).toBeUndefined(); // branch has no route path
  });

  it('returns [] for an empty list', () => {
    expect(toTreeNodes('x', [])).toEqual([]);
  });
});
