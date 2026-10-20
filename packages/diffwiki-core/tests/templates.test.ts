import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedTemplates, listTemplateShapes, listTemplates, templatesDir } from '../src';

let home: string;
let src: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-'));
  process.env.DIFFWIKI_HOME = home;
  // A fake "bundled" template dir.
  src = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-bundled-'));
  await fs.writeFile(path.join(src, 'guide-template.md'), 'GUIDE', 'utf8');
  await fs.writeFile(path.join(src, 'recipe-template.md'), 'RECIPE', 'utf8');
  await fs.writeFile(path.join(src, 'ignore.txt'), 'nope', 'utf8'); // non-md ignored
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(src, { recursive: true, force: true });
});

describe('seedTemplates', () => {
  it('copies bundled *.md into ~/.diffwiki/templates and reports them', async () => {
    const res = await seedTemplates(src);
    expect(res.dir).toBe(templatesDir());
    expect(res.seeded.sort()).toEqual(['guide-template.md', 'recipe-template.md']);
    expect(res.skipped).toEqual([]);
    expect(await fs.readFile(path.join(templatesDir(), 'guide-template.md'), 'utf8')).toBe('GUIDE');
    // non-markdown is not copied
    await expect(fs.access(path.join(templatesDir(), 'ignore.txt'))).rejects.toThrow();
  });

  it('never overwrites an existing (user-owned) template', async () => {
    await fs.mkdir(templatesDir(), { recursive: true });
    await fs.writeFile(path.join(templatesDir(), 'guide-template.md'), 'MINE', 'utf8');
    const res = await seedTemplates(src);
    expect(res.skipped).toContain('guide-template.md');
    expect(res.seeded).not.toContain('guide-template.md');
    // the user's version is preserved
    expect(await fs.readFile(path.join(templatesDir(), 'guide-template.md'), 'utf8')).toBe('MINE');
  });

  it('is idempotent — a second run seeds nothing new', async () => {
    await seedTemplates(src);
    const res2 = await seedTemplates(src);
    expect(res2.seeded).toEqual([]);
    expect(res2.skipped.length).toBe(2);
  });
});

describe('listTemplateShapes', () => {
  it('lists shape names from *-template.md files', async () => {
    expect(await listTemplateShapes(src)).toEqual(['guide', 'recipe']);
  });
});

describe('listTemplates', () => {
  it('filters metadata shapes and resolves user templates over bundled defaults', async () => {
    await fs.writeFile(path.join(src, 'history-template.md'), '---\nshape: history\ncategory: meta\n---\nRaw');
    expect(await listTemplateShapes(src)).toEqual(['guide', 'recipe']);
    await fs.mkdir(templatesDir(), { recursive: true });
    const file = path.join(templatesDir(), 'history-template.md');
    await fs.writeFile(file, '---\nshape: history\ncategory: meta\npurpose: My history\n---\nCustom');
    expect(await listTemplates(src, 'meta')).toEqual([
      {
        shape: 'history',
        category: 'meta',
        purpose: 'My history',
        budget: undefined,
        file: 'history-template.md',
        path: file,
      },
    ]);
    expect(await listTemplates(src, 'all')).toHaveLength(3);
  });
  it('reads shape/purpose/budget from each template frontmatter', async () => {
    await fs.writeFile(
      path.join(src, 'guide-template.md'),
      '---\nshape: guide\npurpose: Ties patterns together.\nbudget: [1500, 5000]\n---\n\n## Body\n',
      'utf8',
    );
    const infos = await listTemplates(src);
    const guide = infos.find((t) => t.file === 'guide-template.md');
    expect(guide).toMatchObject({ shape: 'guide', purpose: 'Ties patterns together.', budget: [1500, 5000] });
  });

  it('falls back to the filename stem when frontmatter has no shape', async () => {
    // recipe-template.md was written as plain 'RECIPE' (no frontmatter) in beforeEach.
    const infos = await listTemplates(src);
    const recipe = infos.find((t) => t.file === 'recipe-template.md');
    expect(recipe?.shape).toBe('recipe');
    expect(recipe?.purpose).toBe('');
    expect(recipe?.budget).toBeUndefined();
  });
});
