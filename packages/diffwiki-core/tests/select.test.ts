import { describe, expect, it } from 'vitest';
import { resolveCollectionSelection } from '../src/select';

const all = ['docs-public', 'docs-internal', 'knowledge-base', 'devtools'];

describe('resolveCollectionSelection', () => {
  it('includes all collections when no filter/exclude is given', () => {
    const r = resolveCollectionSelection(all, {});
    expect(r.included).toEqual(all);
    expect(r.errors).toEqual([]);
  });

  it('filters by exact name', () => {
    expect(resolveCollectionSelection(all, { filter: ['devtools'] }).included).toEqual(['devtools']);
  });

  it('filters by a * glob', () => {
    expect(resolveCollectionSelection(all, { filter: ['docs-*'] }).included).toEqual(['docs-public', 'docs-internal']);
  });

  it('supports the ? single-character glob', () => {
    expect(resolveCollectionSelection(['a1', 'a2', 'abc'], { filter: ['a?'] }).included).toEqual(['a1', 'a2']);
  });

  it('excludes by glob', () => {
    const r = resolveCollectionSelection(all, { exclude: ['docs-internal', 'dev*'] });
    expect(r.included).toEqual(['docs-public', 'knowledge-base']);
    expect(r.errors).toEqual([]);
  });

  it('composes filter then exclude', () => {
    expect(resolveCollectionSelection(all, { filter: ['docs-*'], exclude: ['*-internal'] }).included).toEqual([
      'docs-public',
    ]);
  });

  it('errors when a --filter pattern matches nothing', () => {
    const r = resolveCollectionSelection(all, { filter: ['nope-*'] });
    expect(r.errors).toContain('--filter "nope-*" matched no collections');
  });

  it('errors when a --exclude pattern matches nothing', () => {
    const r = resolveCollectionSelection(all, { exclude: ['ghost'] });
    expect(r.errors).toContain('--exclude "ghost" matched no collections');
  });

  it('errors when the selection ends up empty', () => {
    const r = resolveCollectionSelection(all, { filter: ['*'], exclude: ['*'] });
    expect(r.errors.some((e) => e.includes('no collections left'))).toBe(true);
  });

  it('does not error on an empty registry when no filter/exclude is given', () => {
    const r = resolveCollectionSelection([], {});
    expect(r.included).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('still errors on an empty registry when a filter is supplied', () => {
    const r = resolveCollectionSelection([], { filter: ['notes'] });
    expect(r.errors).toContain('--filter "notes" matched no collections');
  });
});
