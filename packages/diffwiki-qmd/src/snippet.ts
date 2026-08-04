/**
 * Snippet processing for qmd search results — sanitizing raw chunks into
 * readable plain-text snippets, mapping qmd rows into diffwiki hits, and
 * deriving a body-preview fallback when a hit's chunk is metadata-only.
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArticle, stripFrontmatter } from 'diffwiki-core/plugin';
import type { QmdRow, Hit, Collection } from './types.js';

/** Default maximum snippet length, in characters, before truncation. */
export const DEFAULT_SNIPPET_MAX = 200;

/**
 * Convert a raw markdown chunk into a compact, readable plain-text snippet.
 *
 * The output is plain text (no markdown), single-line, trimmed, and at most
 * `maxLength` characters (truncated on a word boundary with an ellipsis).
 * Returns `undefined` for empty, missing, or whitespace-only input so callers
 * can omit the snippet field entirely.
 *
 * @param raw        The raw markdown chunk (qmd `bestChunk`), or undefined.
 * @param maxLength  Max output length in characters. Defaults to {@link DEFAULT_SNIPPET_MAX}.
 */
export function sanitizeSnippet(raw: string | undefined, maxLength = DEFAULT_SNIPPET_MAX): string | undefined {
  if (!raw) return undefined;

  let text = raw;

  // 0. Strip qmd's chunk-locator decoration. qmd prefixes each snippet with a
  //    diff-style hunk header \u2014 `@@ -<start>,<count> @@ (<n> before, <m> after)`
  //    \u2014 and, in line-numbered modes (the warm MCP path), a `14: ` gutter on
  //    every line. Only strip when qmd's signature is actually present, so
  //    ordinary prose that happens to start with e.g. `12:30` is never touched.
  if (/^\s*(?:\d+:[ \t]?)?@@ -\d+,\d+ @@/.test(text)) {
    text = text.replace(/^[ \t]*\d+:[ \t]?/gm, ''); // drop the "14: " line-number gutter
    text = text.replace(/^[ \t]*@@ -\d+,\d+ @@[^\n]*(?:\r?\n|$)/, ''); // drop the hunk header line
  }

  // 1. Drop a leading YAML frontmatter block. Handles both a complete
  //    `--- ... ---` block and an *unterminated* one \u2014 a chunk that begins with
  //    the opening `---`, which qmd emits when the best chunk is the top of a file.
  text = text.replace(/^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // complete block
  text = text.replace(/^\uFEFF?\s*---\r?\n(?:[^\n]*:[^\n]*\r?\n?)*/, ''); // unterminated, leading ---

  // 1b. Drop an *undelimited* leading frontmatter body. When qmd's chunk starts
  //    just after the opening `---` (chunk begins on line 2), the snippet is a
  //    bare run of YAML `key: value` lines with no `---` to anchor on. Strip a
  //    leading run of such lines, but only when it opens with a known
  //    frontmatter key \u2014 so ordinary prose starting with e.g. "Note:" survives.
  {
    const FM_KEY =
      /^(?:title|tags?|date|created|updated|author|authors|description|summary|draft|status|audience|slug|categor(?:y|ies)|layout|permalink|keywords|image|cover):/i;
    const FIELD = /^[A-Za-z_][\w-]*:(?:\s|$)/;
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && FM_KEY.test(lines[0].trim())) {
      let i = 0;
      while (i < lines.length && FIELD.test(lines[i].trim())) i++;
      if (i >= 2) {
        while (i < lines.length && (lines[i].trim() === '' || lines[i].trim() === '---')) i++;
        text = lines.slice(i).join('\n');
      }
    }
  }

  // 2. Remove fenced code-block markers (``` or ~~~, with optional info string),
  //    keeping the code lines themselves as plain text.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '');

  // 3. Inline code: strip the backticks, keep the content.
  text = text.replace(/`+([^`]*)`+/g, '$1');

  // 4. Images: drop entirely (alt text is rarely useful in a snippet).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // 5. Inline links [text](url) -> text; reference links [text][ref] -> text.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');

  // 6. Strip raw HTML tags (e.g. qmd highlight markers, embedded html).
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // 7. Line-level markers: headings, blockquotes, list bullets, table pipes.
  text = text
    .split('\n')
    .map((line) => {
      let l = line;
      l = l.replace(/^\s{0,3}#{1,6}\s+/, ''); // ATX headings
      l = l.replace(/^\s*>+\s?/, ''); // blockquotes
      l = l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''); // list bullets
      l = l.replace(/^\s*\|?[\s:|-]*\|?\s*$/, (m) => (/[-:]/.test(m) ? '' : m)); // table divider rows
      l = l.replace(/\s*\|\s*/g, ' '); // table cell pipes -> space
      return l;
    })
    .join('\n');

  // 8. Emphasis / strong / strikethrough markers. Only strip markers that
  //    actually delimit an emphasis span (a paired run of the same marker
  //    wrapping non-space content), so literal prose survives:
  //    `snake_case`, `file_name`, and `2*3` keep their markers.
  //    Each pattern requires the content immediately inside the markers to be
  //    non-whitespace, and `_` runs additionally require a non-word char (or
  //    string boundary) just outside, matching CommonMark's rule that `_` does
  //    not open/close emphasis intra-word.
  text = text
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '$1') // ***bold italic***
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1') // **bold**
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1') // *italic*
    .replace(/(^|[^\w])___(?=\S)([\s\S]*?\S)___(?![\w])/g, '$1$2') // ___bold italic___
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?![\w])/g, '$1$2') // __bold__
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?![\w])/g, '$1$2') // _italic_
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1'); // ~~struck~~

  // 9. Setext underlines and horizontal rules -> blank lines.
  text = text.replace(/^\s*(?:={3,}|-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // 10. Collapse all whitespace (including newlines) to single spaces; trim.
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length === 0) return undefined;

  // 11. Truncate on a word boundary and append an ellipsis.
  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
    text = base.trimEnd() + '…';
  }

  return text;
}

/** Derive collection + relPath from a qmd row's `file` (strip `qmd://`) or `displayPath`. */
export function splitQmdPath(row: QmdRow): { collection: string; relPath: string } {
  let raw = '';
  if (typeof row.file === 'string' && row.file.length > 0) {
    raw = row.file.replace(/^qmd:\/\//, '');
  } else if (typeof row.displayPath === 'string') {
    raw = row.displayPath;
  }
  raw = raw.replace(/[?#].*$/, '');
  raw = raw.replace(/^\/+/, '');
  const slash = raw.indexOf('/');
  if (slash === -1) return { collection: raw, relPath: '' };
  return { collection: raw.slice(0, slash), relPath: raw.slice(slash + 1) };
}

/** Map an array of qmd rows to diffwiki hits. Shared by the warm and cold paths. */
export function rowsToHits(rows: QmdRow[]): Hit[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const { collection, relPath } = splitQmdPath(row);
    return {
      collection,
      relPath,
      title: typeof row.title === 'string' ? row.title : relPath,
      snippet: sanitizeSnippet(row.bestChunk),
      rawChunk: typeof row.bestChunk === 'string' && row.bestChunk.length > 0 ? row.bestChunk : undefined,
      cleanedChunk: sanitizeSnippet(row.bestChunk, Number.MAX_SAFE_INTEGER),
      line: typeof row.line === 'number' ? row.line : undefined,
      score: typeof row.score === 'number' ? row.score : undefined,
      docid: typeof row.docid === 'string' ? row.docid : undefined,
    };
  });
}

/**
 * Derive a clean body preview from raw markdown source — frontmatter stripped
 * (via core's parser), a leading H1 dropped (it almost always duplicates the
 * title already shown on the row), then flattened and truncated so the preview
 * opens on real content. Returns undefined when nothing readable remains.
 */
export function previewFromMarkdown(raw: string): string | undefined {
  const body = stripFrontmatter(raw).replace(/^\s*#\s+[^\n]*(?:\r?\n)+/, '');
  return sanitizeSnippet(body);
}

/**
 * Read a source markdown file and derive a body preview. Best-effort: returns
 * undefined if the file can't be read.
 */
export async function bodyPreview(absPath: string): Promise<string | undefined> {
  try {
    return previewFromMarkdown(await readFile(absPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Enrich hits from their source file (best-effort, one read each, in parallel):
 *
 *  - **Title** — qmd indexes a frontmatter-stripped mirror, so the title it
 *    returns is the body's first heading (e.g. "Recipe"); the real title lives
 *    only in the frontmatter. Read it back so results show the authoritative
 *    title, falling back to qmd's title when the source has none. (ripgrep
 *    already reads titles from source; this keeps qmd consistent.)
 *  - **Snippet** — when qmd's chunk sanitized to nothing (the match was the
 *    frontmatter/metadata block), fill a body preview and flag it via
 *    `snippetFromBody` so the UI can label it.
 *
 * Hits in an unknown collection or with an unreadable source are left as-is.
 */
export async function enrichHits(hits: Hit[], collections: Collection[]): Promise<void> {
  const byName = new Map(collections.map((c) => [c.name, c.path]));
  await Promise.all(
    hits.map(async (hit) => {
      const base = byName.get(hit.collection);
      if (!base || !hit.relPath) return;
      let raw: string;
      try {
        raw = await readFile(join(base, hit.relPath), 'utf8');
      } catch {
        return;
      }
      const { title } = parseArticle(raw);
      if (title) hit.title = title;
      if (!hit.snippet) {
        const preview = previewFromMarkdown(raw);
        if (preview) {
          hit.snippet = preview;
          hit.snippetFromBody = true;
        }
      }
    }),
  );
}
