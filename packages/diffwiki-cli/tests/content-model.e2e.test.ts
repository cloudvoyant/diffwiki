import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let originalCwd: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  process.env.DIFFWIKI_HOME = home;
  originalCwd = process.cwd();
});
afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('article lifecycle, audience, paths, and title updates', () => {
  it('updates a title in place and retains custom metadata through combined updates', async () => {
    await run(['collection', 'create', 'kb']);
    const created = await run(['article', 'create', 'kb:Index', '--status', 'draft', '-b', 'original body']);
    const file = created.out.trim();
    const raw = (await fs.readFile(file, 'utf8')).replace(
      'title: Index',
      'title: index\n# Preserve metadata\ncustom: human',
    );
    await fs.writeFile(file, raw);
    const title = await run(['article', 'update', 'kb:index.md', '--title', 'Knowledge Base']);
    expect(title.ok).toBe(true);
    expect(title.out).toContain(file);
    expect(await fs.readFile(file, 'utf8')).toBe(raw.replace('title: index', 'title: Knowledge Base'));
    const combined = await run([
      'article',
      'update',
      'kb:index.md',
      '--title',
      'Updated: KB',
      '-b',
      'new body',
      '--status',
      'deprecated',
    ]);
    expect(combined.ok).toBe(true);
    const next = await fs.readFile(file, 'utf8');
    expect(next).toContain('custom: human');
    expect(next).toContain('# Preserve metadata');
    expect(next).toContain('status: deprecated');
    expect(next).toContain('new body');
    expect((await run(['article', 'update', 'kb:index.md', '--title', '   '])).ok).toBe(false);
  });
  it('writes status: deprecated', async () => {
    await run(['collection', 'create', 'kb']);
    const res = await run(['article', 'create', 'kb:Old Thing', '--status', 'deprecated', '-b', 'body']);
    expect(await fs.readFile(res.out.trim(), 'utf8')).toContain('status: deprecated');
  });
  it('creates nested article subpaths', async () => {
    await run(['collection', 'create', 'transcripts']);
    const res = await run(['article', 'create', 'transcripts:demo/Session One', '-b', 'x', '--audience', 'system']);
    const file = res.out.trim();
    expect(file.replace(/\\/g, '/')).toContain('/transcripts/demo/session-one.md');
    expect(await fs.readFile(file, 'utf8')).toContain('audience: system');
  });
  it('creates a hidden collection (audience: system in registry)', async () => {
    await run(['collection', 'create', 'secret', '--hidden']);
    const reg = await fs.readFile(path.join(home, 'registry.json'), 'utf8');
    expect(reg).toContain('"name": "secret"');
    expect(reg).toContain('"audience": "system"');
  });

  it('updates a nested article by its original (unslugged) target', async () => {
    await run(['collection', 'create', 'transcripts']);
    const created = await run([
      'article',
      'create',
      'transcripts:Demo/Session One',
      '-b',
      'first',
      '--audience',
      'system',
    ]);
    expect(created.ok).toBe(true);
    const upd = await run([
      'article',
      'update',
      'transcripts:Demo/Session One',
      '-b',
      'second',
      '--audience',
      'system',
    ]);
    expect(upd.ok).toBe(true);
    expect(await fs.readFile(created.out.trim(), 'utf8')).toContain('second');
  });

  it('hides a hidden collection from search by default, reveals via -c and showSystem', async () => {
    await run(['collection', 'create', 'kb']);
    await run(['collection', 'create', 'transcripts', '--hidden']);
    await run(['article', 'create', 'kb:Note', '-b', 'needle in kb']);
    await run(['article', 'create', 'transcripts:demo/S1', '-b', 'needle in transcript', '--audience', 'system']);

    const def = await run(['search', 'query', 'needle']);
    expect(def.out).toContain('\tkb\t');
    expect(def.out).not.toContain('\ttranscripts\t');

    const explicit = await run(['search', 'query', 'needle', '-c', 'transcripts']);
    expect(explicit.out).toContain('\ttranscripts\t');

    await run(['config', 'set', 'showSystem', 'true']);
    const shown = await run(['search', 'query', 'needle']);
    expect(shown.out).toContain('\ttranscripts\t');
  });
});

describe('search query -c comma set', () => {
  it('limits to the named set', async () => {
    await run(['collection', 'create', 'a']);
    await run(['collection', 'create', 'b']);
    await run(['collection', 'create', 'c']);
    await run(['article', 'create', 'a:Alpha', '-b', 'needle alpha']);
    await run(['article', 'create', 'b:Beta', '-b', 'needle beta']);
    await run(['article', 'create', 'c:Gamma', '-b', 'needle gamma']);
    const set = await run(['search', 'query', 'needle', '-c', 'a,b']);
    expect(set.out).toContain('\ta\t');
    expect(set.out).toContain('\tb\t');
    expect(set.out).not.toContain('\tc\t');
  });
});
