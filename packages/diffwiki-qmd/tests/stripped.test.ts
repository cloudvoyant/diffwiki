import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseArticleMeta,
  blankFrontmatter,
  contextText,
  qmdUri,
  mirrorDir,
  registeredMarker,
  syncStrippedContent,
  rebuildStrippedMirror,
} from '../src/stripped.js';

const FM =
  '---\ntitle: "Server-Side Remote Functions"\ntags: [svelte, sveltekit, remote-functions]\ncreated: \'2026-07-21T12:00:00.000Z\'\n---\n\n# Server-Side Remote Functions\n\nBody prose about running server code.\n';

describe('parseArticleMeta', () => {
  it('extracts an unquoted title and inline tags', () => {
    expect(parseArticleMeta(FM)).toEqual({
      title: 'Server-Side Remote Functions',
      tags: ['svelte', 'sveltekit', 'remote-functions'],
    });
  });

  it('returns empty tags and no title when there is no frontmatter', () => {
    expect(parseArticleMeta('# Just a heading\n\nbody')).toEqual({ tags: [] });
  });

  it('handles a title with no tags', () => {
    expect(parseArticleMeta('---\ntitle: Solo\n---\nbody')).toEqual({ title: 'Solo', tags: [] });
  });
});

describe('blankFrontmatter', () => {
  it('replaces the frontmatter block with the same number of newlines (line-aligned)', () => {
    const out = blankFrontmatter(FM);
    expect(out).not.toContain('title:');
    expect(out).not.toContain('tags:');
    expect(out).not.toContain('---');
    // The H1 must remain on its original source line so qmd's `line` stays correct.
    expect(FM.split('\n').indexOf('# Server-Side Remote Functions')).toBe(
      out.split('\n').indexOf('# Server-Side Remote Functions'),
    );
  });

  it('is a no-op when there is no frontmatter', () => {
    expect(blankFrontmatter('# Heading\n\nbody')).toBe('# Heading\n\nbody');
  });
});

describe('contextText', () => {
  it('joins title and tags', () => {
    expect(contextText({ title: 'A', tags: ['x', 'y'] })).toBe('Title: A. Tags: x, y');
  });
  it('title only', () => {
    expect(contextText({ title: 'A', tags: [] })).toBe('Title: A');
  });
  it('undefined when nothing to add', () => {
    expect(contextText({ tags: [] })).toBeUndefined();
  });
});

describe('qmdUri / path helpers', () => {
  it('builds a forward-slash qmd:// uri', () => {
    expect(qmdUri('kb', 'svelte/remote.md')).toBe('qmd://kb/svelte/remote.md');
  });
  it('mirrorDir and registeredMarker live under <home>/stripped', () => {
    expect(mirrorDir('/home/.diffwiki', 'kb')).toBe('/home/.diffwiki/stripped/kb');
    expect(registeredMarker('/home/.diffwiki', 'kb')).toBe('/home/.diffwiki/stripped/.registered-kb');
  });
});

describe('rebuildStrippedMirror', () => {
  it('writes blanked copies and returns per-file meta', async () => {
    const base = await mkdtemp(join(tmpdir(), 'qmd-strip-'));
    const src = join(base, 'src');
    const mirror = join(base, 'mirror');
    await mkdir(join(src, 'svelte'), { recursive: true });
    await writeFile(join(src, 'svelte', 'remote.md'), FM, 'utf8');
    await writeFile(join(src, 'plain.md'), '# Plain\n\nno frontmatter here', 'utf8');

    const entries = await rebuildStrippedMirror(src, mirror);

    expect(entries.map((e) => e.relPath).sort()).toEqual([join('svelte', 'remote.md'), 'plain.md'].sort());
    const remoteEntry = entries.find((e) => e.relPath.includes('remote'));
    expect(remoteEntry?.meta.title).toBe('Server-Side Remote Functions');

    const mirrored = await readFile(join(mirror, 'svelte', 'remote.md'), 'utf8');
    expect(mirrored).not.toContain('title:');
    expect(mirrored).toContain('# Server-Side Remote Functions');

    await rm(base, { recursive: true, force: true });
  });

  it('prunes files deleted from source on rebuild', async () => {
    const base = await mkdtemp(join(tmpdir(), 'qmd-prune-'));
    const src = join(base, 'src');
    const mirror = join(base, 'mirror');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.md'), '# A\n\nbody', 'utf8');
    await rebuildStrippedMirror(src, mirror);
    // Stale mirror file with no source counterpart.
    await writeFile(join(mirror, 'ghost.md'), 'stale', 'utf8');

    await rebuildStrippedMirror(src, mirror);
    await expect(readFile(join(mirror, 'ghost.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(mirror, 'a.md'), 'utf8')).toContain('# A');

    await rm(base, { recursive: true, force: true });
  });
});

describe('syncStrippedContent (incremental)', () => {
  it('writes only files whose source is newer than the mirror', async () => {
    const base = await mkdtemp(join(tmpdir(), 'qmd-incr-'));
    const src = join(base, 'src');
    const mirror = join(base, 'mirror');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.md'), FM, 'utf8');
    await writeFile(join(src, 'b.md'), '# B\n\nbody', 'utf8');

    // Mirror mtimes: a is up to date (source older), b is missing.
    const now = 2000;
    const statMtime = async (p: string): Promise<number> => {
      if (p === join(src, 'a.md')) return 1000;
      if (p === join(mirror, 'a.md')) return 1500; // newer than source → skip
      if (p === join(src, 'b.md')) return now;
      return 0; // mirror b missing
    };

    await mkdir(mirror, { recursive: true });
    await writeFile(join(mirror, 'a.md'), 'PRE-EXISTING', 'utf8'); // must NOT be overwritten
    await syncStrippedContent(src, mirror, statMtime);

    expect(await readFile(join(mirror, 'a.md'), 'utf8')).toBe('PRE-EXISTING'); // skipped
    expect(await readFile(join(mirror, 'b.md'), 'utf8')).toContain('# B'); // written

    await rm(base, { recursive: true, force: true });
  });
});
