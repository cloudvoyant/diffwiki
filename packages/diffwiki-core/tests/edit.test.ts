import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCollection, resolveEditTarget, resolveEditorCommand, setConfigValue } from '../src/index';

let home: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  delete process.env.EDITOR;
  delete process.env.VISUAL;
  await fs.rm(home, { recursive: true, force: true });
});

describe('resolveEditTarget', () => {
  it('opens a collection directory for a bare collection name', async () => {
    const c = await createCollection('notes');
    const t = await resolveEditTarget('notes', '/tmp');
    expect(t).toEqual({ path: c.path, kind: 'collection' });
  });

  it('opens a single article file for "collection:slug"', async () => {
    const c = await createCollection('notes');
    await fs.writeFile(path.join(c.path, 'hello.md'), '---\ntitle: Hello\n---\n# Hello\n');
    const t = await resolveEditTarget('notes:hello', '/tmp');
    expect(t.kind).toBe('article');
    expect(t.path).toBe(path.join(c.path, 'hello.md'));
  });

  it('throws for an unknown collection', async () => {
    await expect(resolveEditTarget('ghost', '/tmp')).rejects.toThrow();
  });

  it('falls back to the collections root when cwd is not a collection', async () => {
    const t = await resolveEditTarget(undefined, os.tmpdir());
    expect(t.kind).toBe('root');
    expect(t.path).toBe(path.join(home, 'collections'));
  });
});

describe('resolveEditorCommand', () => {
  it('prefers the explicit flag over everything', async () => {
    process.env.EDITOR = 'vim';
    await setConfigValue('editor', 'nano');
    expect(await resolveEditorCommand('code -w')).toEqual(['code', '-w']);
  });

  it('uses config `editor` when no flag is given', async () => {
    process.env.EDITOR = 'vim';
    await setConfigValue('editor', 'hx');
    expect(await resolveEditorCommand()).toEqual(['hx']);
  });

  it('falls back to $VISUAL then $EDITOR', async () => {
    process.env.EDITOR = 'vim';
    expect(await resolveEditorCommand()).toEqual(['vim']);
    process.env.VISUAL = 'nvim';
    expect(await resolveEditorCommand()).toEqual(['nvim']);
  });

  it('returns undefined when nothing is configured', async () => {
    expect(await resolveEditorCommand()).toBeUndefined();
  });
});
