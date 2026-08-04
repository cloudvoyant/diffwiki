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
  const files = await fs.readdir(srcDir);
  return files
    .filter((f) => f.endsWith('-template.md'))
    .map((f) => f.replace(/-template\.md$/, ''))
    .sort();
}

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
}

/**
 * List the templates bundled at `srcDir` with their self-describing metadata
 * (`shape`, `purpose`, `budget`) read from each file's frontmatter. This is the
 * discovery API: skills call it (via `diffwiki templates list`) instead of
 * hard-coding shape names, so dropping in a template with frontmatter
 * makes it discoverable. Falls back to the filename stem when `shape:` is absent.
 */
export async function listTemplates(srcDir: string): Promise<TemplateInfo[]> {
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('-template.md')).sort();
  const out: TemplateInfo[] = [];
  for (const file of files) {
    let data: Record<string, unknown> = {};
    try {
      ({ data } = parseFrontmatter(await fs.readFile(path.join(srcDir, file), 'utf8')));
    } catch {
      /* unreadable — fall back to filename-derived shape */
    }
    const shape = typeof data.shape === 'string' && data.shape ? data.shape : file.replace(/-template\.md$/, '');
    const purpose = typeof data.purpose === 'string' ? data.purpose : '';
    const budget =
      Array.isArray(data.budget) && data.budget.length === 2
        ? ([Number(data.budget[0]), Number(data.budget[1])] as [number, number])
        : undefined;
    out.push({ shape, purpose, budget, file });
  }
  return out;
}
