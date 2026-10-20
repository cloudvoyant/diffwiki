/**
 * Authoring-template seeding.
 *
 * The wiki authoring templates ship bundled with the CLI and are seeded into
 * `~/.diffwiki/templates` (user-overridable) by `diffwiki templates init`.
 * The dw-* skills/agents then resolve templates from there. This module owns
 * the copy logic; the CLI supplies the bundled source directory.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { templatesDir } from './paths';
import { parseFrontmatter } from './frontmatter';

export interface SeedResult {
  /** Files copied into the templates dir this run. */
  seeded: string[];
  /** Files skipped because a (user-owned) copy already existed. */
  skipped: string[];
  /** Absolute templates directory that was seeded. */
  dir: string;
}

/**
 * Copy bundled template files (`*.md`) from `srcDir` into `~/.diffwiki/templates`,
 * **never overwriting** an existing file — a user's own template always wins.
 * Creates the destination directory if needed.
 */
export async function seedTemplates(srcDir: string): Promise<SeedResult> {
  const dir = templatesDir();
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md')).sort();
  const seeded: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const dest = path.join(dir, file);
    try {
      await fs.access(dest);
      skipped.push(file); // already present — user override wins
      continue;
    } catch {
      /* not present — seed it */
    }
    await fs.copyFile(path.join(srcDir, file), dest);
    seeded.push(file);
  }
  return { seeded, skipped, dir };
}

/** The template shape names bundled at `srcDir`, e.g. `['guide', 'recipe', …]`. */
export async function listTemplateShapes(srcDir: string): Promise<string[]> {
  return (await listTemplates(srcDir)).map((info) => info.shape).sort();
}

export type TemplateCategory = 'article' | 'meta';

/** A template's self-describing metadata, read from its frontmatter. */
export interface TemplateInfo {
  /** The shape id (frontmatter `shape:`, else the filename stem). */
  shape: string;
  /** One-line description of when to use this template (frontmatter `purpose:`). */
  purpose: string;
  /** Token budget `[min, max]` from frontmatter `budget:`, when present. */
  budget?: [number, number];
  /** The template file name. */
  file: string;
  /** Effective user override or bundled file. */
  path: string;
  category: TemplateCategory;
}

/**
 * List the templates bundled at `srcDir` with their self-describing metadata
 * (`shape`, `purpose`, `budget`) read from each file's frontmatter. This is the
 * discovery API: skills call it (via `diffwiki templates list`) instead of
 * hard-coding shape names, so dropping in a template with frontmatter
 * makes it discoverable. Falls back to the filename stem when `shape:` is absent.
 */
export async function listTemplates(
  srcDir: string,
  category: TemplateCategory | 'all' = 'article',
): Promise<TemplateInfo[]> {
  const files = new Map<string, string>();
  for (const dir of [srcDir, templatesDir()]) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    for (const name of names.filter((name) => name.endsWith('-template.md')).sort())
      files.set(name, path.resolve(dir, name));
  }
  const out: TemplateInfo[] = [];
  for (const [file, filePath] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    let data: Record<string, unknown> = {};
    try {
      ({ data } = parseFrontmatter(await fs.readFile(filePath, 'utf8')));
    } catch {
      /* unreadable — fall back to filename-derived shape */
    }
    const shape = typeof data.shape === 'string' && data.shape ? data.shape : file.replace(/-template\.md$/, '');
    const purpose = typeof data.purpose === 'string' ? data.purpose : '';
    const budget =
      Array.isArray(data.budget) && data.budget.length === 2
        ? ([Number(data.budget[0]), Number(data.budget[1])] as [number, number])
        : undefined;
    const templateCategory = data.category === 'meta' ? 'meta' : 'article';
    if (category === 'all' || category === templateCategory)
      out.push({ shape, purpose, budget, file, path: filePath, category: templateCategory });
  }
  return out;
}
