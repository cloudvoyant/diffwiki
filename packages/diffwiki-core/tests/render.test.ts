import { describe, expect, it } from 'vitest';
import { renderArticle } from '../src/render';

/** Extract all `<a href="…">` values from rendered HTML, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
}

const ctx = (slug: string) => ({ coll: 'docs', slug });
/** Context for a folder-index source page (`<slug>/index.md`, route slug `<slug>`). */
const indexCtx = (slug: string) => ({ coll: 'docs', slug, isIndex: true });

describe('renderArticle link rewriting', () => {
  it('rewrites a sibling .md link to a route path', async () => {
    const { html } = await renderArticle('[setup](./setup.md)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/docs/setup']);
  });

  it('rewrites a sibling .mdx link', async () => {
    const { html } = await renderArticle('[x](./x.mdx)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/docs/x']);
  });

  it('resolves ../ against the article directory', async () => {
    const { html } = await renderArticle('[deep](../a/b/deep.md)', ctx('guide/setup'));
    expect(hrefs(html)).toEqual(['/docs/a/b/deep']);
  });

  it('drops a trailing index/readme for folder-index links', async () => {
    const both = await renderArticle('[f](./guide/) and [i](./guide/index.md)', ctx('intro'));
    expect(hrefs(both.html)).toEqual(['/docs/guide', '/docs/guide']);
  });

  it('preserves a #hash suffix on a rewritten link', async () => {
    const { html } = await renderArticle('[s](./setup.md#install)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/docs/setup#install']);
  });

  it('leaves anchor-only, external, and root-absolute links unchanged', async () => {
    const md = '[a](#top) [b](https://example.com) [c](/already/abs) [d](mailto:x@y.z)';
    const { html } = await renderArticle(md, ctx('intro'));
    expect(hrefs(html)).toEqual(['#top', 'https://example.com', '/already/abs', 'mailto:x@y.z']);
  });

  it('maps a one-level escape to a sibling collection route (from a root article)', async () => {
    const { html } = await renderArticle('[x](../other/qmd/x.md)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/other/qmd/x']);
  });

  it('maps a sibling-collection link from a folder-index page', async () => {
    // `diffwiki/index.md` (route slug "diffwiki") linking `../../devtools/qmd/x.md`
    // normalizes to one level above the collection root → the devtools collection.
    const { html } = await renderArticle('[x](../../devtools/qmd/x.md)', indexCtx('diffwiki'));
    expect(hrefs(html)).toEqual(['/devtools/qmd/x']);
  });

  it('drops a trailing index/readme on a sibling-collection link', async () => {
    const { html } = await renderArticle('[c](../devtools/qmd/index.md) [r](../devtools/)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/devtools/qmd', '/devtools']);
  });

  it('preserves a #hash on a sibling-collection link', async () => {
    const { html } = await renderArticle('[x](../devtools/qmd/x.md#run)', ctx('intro'));
    expect(hrefs(html)).toEqual(['/devtools/qmd/x#run']);
  });

  it('leaves a link that escapes beyond the sibling level unchanged', async () => {
    const { html } = await renderArticle('[up](../../outside.md)', ctx('intro'));
    expect(hrefs(html)).toEqual(['../../outside.md']);
  });

  it('resolves relative links against the folder for a folder-index source page', async () => {
    // `guide/index.md` has route slug "guide"; `./setup.md` must resolve inside
    // the folder (/docs/guide/setup), not the parent (/docs/setup).
    const { html } = await renderArticle('[s](./setup.md)', indexCtx('guide'));
    expect(hrefs(html)).toEqual(['/docs/guide/setup']);
  });

  it('resolves a bare filename against the folder for a folder-index source page', async () => {
    const { html } = await renderArticle('[s](setup.md)', indexCtx('guide'));
    expect(hrefs(html)).toEqual(['/docs/guide/setup']);
  });

  it('resolves ../ against the folder for a nested folder-index source page', async () => {
    // `a/b/index.md` (slug "a/b"): ../c.md → /docs/a/c.
    const { html } = await renderArticle('[c](../c.md)', indexCtx('a/b'));
    expect(hrefs(html)).toEqual(['/docs/a/c']);
  });
});
