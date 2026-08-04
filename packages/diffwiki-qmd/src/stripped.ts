/**
 * Frontmatter-stripped mirror indexing for qmd.
 *
 * qmd indexes markdown files as-is and chunks the YAML frontmatter as its own
 * top-of-file chunk — so a query matching a doc's title/tags surfaces that
 * metadata block as the "best chunk" (useless as a snippet, and it crowds real
 * body matches). qmd offers no frontmatter-exclusion option, so instead of
 * pointing qmd at the source files we point it at a **stripped mirror**: a
 * parallel tree where each file's frontmatter block is replaced with blank lines
 * (blanked, not deleted, so qmd's absolute `line` numbers stay aligned with the
 * source). The title survives as a searchable field via the doc's H1, and the
 * title + tags are re-attached to results as qmd **context** (metadata that
 * supplements ranking without becoming a body chunk).
 *
 * @module
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { parseArticle, stripFrontmatter } from 'diffwiki-core/plugin';
import type { StatMtimeFn } from './types.js';

/** Title + tags parsed from a file's frontmatter, for qmd context. */
export interface ArticleMeta {
  title?: string;
  tags: string[];
}

/** Count newline characters in `s` (used to preserve source line offsets). */
function countNewlines(s: string): number {
  return (s.match(/\n/g) ?? []).length;
}

/**
 * Parse `title` and `tags` from a file's frontmatter, for qmd context. Delegates
 * to core's canonical frontmatter parser, so the plugin does not hard-code the
 * frontmatter format (and inherits real YAML parsing — block-sequence tags and
 * quoting are handled by core, not a local regex).
 */
export function parseArticleMeta(content: string): ArticleMeta {
  const { title, tags } = parseArticle(content);
  return { title: title || undefined, tags };
}

/**
 * Replace a leading frontmatter block with the SAME number of blank lines, so
 * the frontmatter text is gone from the indexed body while every following line
 * keeps its original source line number (qmd's `line` field stays correct).
 * Locates the block via core's {@link stripFrontmatter} (which returns the body
 * verbatim), then restores the removed newlines. No-op when there is no
 * frontmatter.
 */
export function blankFrontmatter(content: string): string {
  const body = stripFrontmatter(content);
  if (body === content) return content; // no frontmatter block
  const removedNewlines = countNewlines(content) - countNewlines(body);
  return '\n'.repeat(removedNewlines) + body;
}

/** The qmd-context string for a file, or undefined when there is nothing to add. */
export function contextText(meta: ArticleMeta): string | undefined {
  const parts: string[] = [];
  if (meta.title) parts.push(`Title: ${meta.title}`);
  if (meta.tags.length > 0) parts.push(`Tags: ${meta.tags.join(', ')}`);
  return parts.length > 0 ? parts.join('. ') : undefined;
}

/** Root of all stripped mirrors under the diffwiki home. */
export function mirrorRoot(home: string): string {
  return join(home, 'stripped');
}

/** The stripped-mirror directory for one collection. */
export function mirrorDir(home: string, name: string): string {
  return join(mirrorRoot(home), name);
}

/** Marker recording that a collection's qmd registration was re-pointed at its mirror. */
export function registeredMarker(home: string, name: string): string {
  return join(mirrorRoot(home), `.registered-${name}`);
}

/** A qmd:// URI for a file within a named collection (forward slashes always). */
export function qmdUri(name: string, relPath: string): string {
  return `qmd://${name}/${relPath.split(sep).join('/')}`;
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out;
}

/** Write one source file's blanked content into the mirror, returning its meta. */
export async function syncStrippedFile(srcFile: string, mirrorFile: string): Promise<ArticleMeta> {
  const content = await readFile(srcFile, 'utf8');
  await mkdir(dirname(mirrorFile), { recursive: true });
  await writeFile(mirrorFile, blankFrontmatter(content), 'utf8');
  return parseArticleMeta(content);
}

/**
 * Incrementally sync a collection's stripped mirror: rewrite only the files
 * whose source is newer than (or missing from) the mirror. Cheap enough for the
 * on-search freshness path. Does not prune deletions (a full rebuild does).
 */
export async function syncStrippedContent(srcRoot: string, mirror: string, statMtime: StatMtimeFn): Promise<void> {
  const files = await walkMarkdown(srcRoot);
  for (const srcFile of files) {
    const rel = relative(srcRoot, srcFile);
    const mirrorFile = join(mirror, rel);
    const srcMt = await statMtime(srcFile);
    const mirMt = await statMtime(mirrorFile);
    if (mirMt === 0 || mirMt < srcMt) {
      await syncStrippedFile(srcFile, mirrorFile);
    }
  }
}

/**
 * Remove a single file from the stripped mirror when the source article has
 * been deleted. Best-effort: no-ops silently when the mirror file is already
 * absent. Called by `onEvent` for `article-removed` events so deleted articles
 * don't linger in qmd's index until the next full rebuild.
 */
export async function pruneMirrorFile(mirror: string, relPath: string): Promise<void> {
  await rm(join(mirror, relPath), { force: true });
}

/**
 * Fully rebuild a collection's stripped mirror from scratch (clears the mirror
 * first, so deleted source files are pruned), returning per-file `{ relPath,
 * meta }` for context attachment. Used by the deliberate setup/index reindex.
 */
export async function rebuildStrippedMirror(
  srcRoot: string,
  mirror: string,
): Promise<Array<{ relPath: string; meta: ArticleMeta }>> {
  await rm(mirror, { recursive: true, force: true });
  const files = await walkMarkdown(srcRoot);
  const entries: Array<{ relPath: string; meta: ArticleMeta }> = [];
  for (const srcFile of files) {
    const rel = relative(srcRoot, srcFile);
    const meta = await syncStrippedFile(srcFile, join(mirror, rel));
    entries.push({ relPath: rel, meta });
  }
  return entries;
}
