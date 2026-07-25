import { afterEach, describe, expect, it } from 'vitest';
import { renderArticle } from '../src/render';

/** Extract the collected internal link node ids for a body under a render context. */
async function links(body: string, ctx: { coll: string; slug: string; base?: string }): Promise<string[]> {
  const { links } = await renderArticle(body, ctx);
  return links;
}

describe('resolveHref (via renderArticle link collection)', () => {
  afterEach(() => {
    delete process.env.DIFFWIKI_BASE;
  });

  it('resolves same- and cross-collection absolute route links (bare base)', async () => {
    const out = await links('[a](/notes/guide/setup) and [b](/refs/spec)', { coll: 'notes', slug: 'intro' });
    expect(out.sort()).toEqual(['notes/guide/setup', 'refs/spec']);
  });

  it('does not mis-slice an absolute id whose slug segment matches the current collection', async () => {
    // From an article in `notes`, a cross-collection link `/refs/notes/page` must
    // resolve to `refs/notes/page` — NOT be truncated to `notes/page` by a stray
    // ctx.coll-boundary scan just because a later segment equals `notes`.
    const out = await links('[x](/refs/notes/page)', { coll: 'notes', slug: 'intro' });
    expect(out).toEqual(['refs/notes/page']);
    expect(out).not.toContain('notes/page');
  });

  it('bails on relative `..` underflow past the collection root instead of clamping to a sibling', async () => {
    // From a top-level article, `../../x` pops below root — must resolve to nothing,
    // NOT to `notes/x` (which would be a spurious sibling edge).
    const out = await links('[bad](../../x) and [ok](./sibling)', { coll: 'notes', slug: 'intro' });
    expect(out).toEqual(['notes/sibling']);
    expect(out).not.toContain('notes/x');
  });

  it('strips a non-trivial base prefix so cross-collection links resolve correctly', async () => {
    // Under base `/my-repo/`, a link `/my-repo/other/page` must resolve to
    // `other/page`, not the mis-parsed `my-repo/other/page`.
    const out = await links('[x](/my-repo/other/page)', { coll: 'notes', slug: 'intro', base: '/my-repo/' });
    expect(out).toEqual(['other/page']);
  });

  it('reads DIFFWIKI_BASE from the env when ctx.base is omitted', async () => {
    process.env.DIFFWIKI_BASE = '/my-repo/';
    const out = await links('[x](/my-repo/other/page)', { coll: 'notes', slug: 'intro' });
    expect(out).toEqual(['other/page']);
  });
});
