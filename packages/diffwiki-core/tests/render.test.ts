import { describe, expect, it } from 'vitest';
import { renderArticle } from '../src/render';

/** Extract all `<a href="…">` values from rendered HTML, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
}

const ctx = (slug: string) => ({ coll: 'docs', slug });

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

  it('leaves a link that escapes the collection root unchanged', async () => {
    const { html } = await renderArticle('[up](../../outside.md)', ctx('intro'));
    expect(hrefs(html)).toEqual(['../../outside.md']);
  });
});
