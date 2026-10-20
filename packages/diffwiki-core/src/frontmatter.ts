import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml, parseDocument, isScalar } from 'yaml';
import { DiffwikiError } from './errors';
import type { Audience, PublishStatus } from './types';

export interface ParsedArticle {
  title: string;
  tags: string[];
  created?: string;
  audience: Audience;
  status: PublishStatus;
  body: string;
}

export interface SerializableArticle {
  title: string;
  tags: string[];
  audience?: Audience;
  status?: PublishStatus;
  body: string;
}

/**
 * gray-matter defaults to js-yaml's `safeLoad`, which is removed in js-yaml 4 —
 * a bundler that resolves js-yaml 4 (instead of gray-matter's nested 3.x) makes
 * frontmatter parsing throw at runtime. Pin gray-matter to the `yaml` package
 * (already a core dependency) so parsing is bundler-independent.
 */
const YAML_ENGINE = {
  parse: (input: string): Record<string, unknown> => {
    // gray-matter can leave the closing CR of a CRLF fence in the YAML input.
    const data = parseYaml(input.replace(/\r\n?/g, '\n')) as unknown;
    // A bare scalar (e.g. `--- true ---`) parses to a non-object; treat as empty.
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  },
  stringify: (data: object): string => stringifyYaml(data),
};
const MATTER_OPTS = { engines: { yaml: YAML_ENGINE } } as const;

/** Coerce a frontmatter `audience` value; 'private'/'system' pass through, else → 'public'. */
function coerceAudience(value: unknown): Audience {
  return value === 'private' || value === 'system' ? value : 'public';
}

/** Coerce a frontmatter `status` value; 'draft'/'deprecated' pass through, else → 'published'. */
function coerceStatus(value: unknown): PublishStatus {
  return value === 'draft' || value === 'deprecated' ? value : 'published';
}

/**
 * Best-effort fallback when the YAML engine rejects the frontmatter block
 * (e.g. an unquoted colon in the title). Strips the `---…---` fence via
 * regex, extracts a bare `title:` line if present, and returns the rest of
 * the file as the body. Tags are not recoverable without a real YAML parse,
 * so they default to [].
 */
function parseFallback(raw: string): ParsedArticle {
  const fenceRe = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n/;
  const fenceMatch = fenceRe.exec(raw);
  let title = '';
  let audience: Audience = 'public';
  let status: PublishStatus = 'published';
  let body: string;
  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, '');
  if (fenceMatch) {
    const inner = fenceMatch[1];
    const titleMatch = /^title:\s*(.+)$/m.exec(inner);
    if (titleMatch) {
      title = clean(titleMatch[1]);
    }
    const audienceMatch = /^audience:\s*(.+)$/m.exec(inner);
    if (audienceMatch) {
      audience = coerceAudience(clean(audienceMatch[1]));
    }
    const statusMatch = /^status:\s*(.+)$/m.exec(inner);
    if (statusMatch) {
      status = coerceStatus(clean(statusMatch[1]));
    }
    body = raw.slice(fenceMatch[0].length);
  } else {
    body = raw;
  }
  return { title, tags: [], audience, status, body: body.replace(/^\n+/, '') };
}

/**
 * A leading YAML frontmatter block: optional BOM/indent, an opening `---` fence,
 * the YAML body, a closing `---`, and an optional trailing newline. The canonical
 * shape {@link serializeArticle} writes.
 */
const FRONTMATTER_BLOCK_RE = /^\uFEFF?[ \t]*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Remove a leading frontmatter block, returning the body **verbatim** — unlike
 * {@link parseArticle}, no leading-whitespace trimming — so a caller that needs
 * the body's original line offsets (e.g. a search index that blanks frontmatter
 * to keep source line numbers aligned) can reconstruct them from the removed
 * span. Returns the input unchanged when there is no frontmatter.
 */
export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_BLOCK_RE, '');
}

/** Edit requested fields while preserving unknown YAML keys, comments, and the untouched body. */
export function patchArticle(raw: string, fields: Record<string, unknown>, body?: string): string {
  const fence = /^(\uFEFF?[ \t]*---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(raw);
  if (Object.keys(fields).length === 0) return fence ? fence[0] + (body ?? raw.slice(fence[0].length)) : (body ?? raw);
  const originalYaml = fence?.[2] ?? '';
  const doc = parseDocument(originalYaml);
  if (doc.errors.length)
    throw new DiffwikiError('Cannot update article with invalid YAML frontmatter. Fix its header first.');
  // A title-only edit can preserve the rest of the header byte-for-byte too.
  const titleNode = doc.get('title', true);
  if (
    fence &&
    body === undefined &&
    Object.keys(fields).length === 1 &&
    typeof fields.title === 'string' &&
    !/[\r\n]/.test(fields.title) &&
    isScalar(titleNode) &&
    titleNode.range
  ) {
    const [start, end] = titleNode.range;
    if (!/[\r\n]/.test(originalYaml.slice(start, end))) {
      const scalar = stringifyYaml(fields.title, { lineWidth: 0 }).trimEnd();
      return (
        fence[1] +
        originalYaml.slice(0, start) +
        scalar +
        originalYaml.slice(end) +
        fence[3] +
        raw.slice(fence[0].length)
      );
    }
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  const newline = fence?.[1].endsWith('\r\n') ? '\r\n' : '\n';
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\n$/, '').replace(/\r?\n/g, newline);
  const content = body ?? (fence ? raw.slice(fence[0].length) : raw);
  const close = fence?.[3] ?? `${newline}---${newline}`;
  // A header closed at EOF needs a newline before a newly supplied body.
  return (fence?.[1] ?? `---${newline}`) + yaml + close + (body && !close.endsWith('\n') ? newline : '') + content;
}

/**
 * Parse a document's YAML frontmatter into a raw key/value object (every key,
 * not just the article axes), plus the body. Bundler-safe via the pinned `yaml`
 * engine. Use this for metadata files (e.g. template frontmatter carrying
 * `shape`/`purpose`) where {@link parseArticle}'s fixed fields don't fit.
 */
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  try {
    const { data, content } = matter(raw, MATTER_OPTS);
    return { data: (data ?? {}) as Record<string, unknown>, body: content };
  } catch {
    return { data: {}, body: raw };
  }
}

export function parseArticle(raw: string): ParsedArticle {
  try {
    const { data, content } = matter(raw, MATTER_OPTS);
    const title = typeof data.title === 'string' ? data.title : '';
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [];
    const created = typeof data.created === 'string' ? data.created : undefined;
    const audience = coerceAudience(data.audience);
    const status = coerceStatus(data.status);
    return { title, tags, created, audience, status, body: content.replace(/^\n+/, '') };
  } catch {
    return parseFallback(raw);
  }
}

export function serializeArticle(article: SerializableArticle): string {
  const front: Record<string, unknown> = { title: article.title, tags: article.tags };
  // Only non-default axes are written, keeping public/published files clean.
  if (article.audience === 'private' || article.audience === 'system') front.audience = article.audience;
  if (article.status === 'draft' || article.status === 'deprecated') front.status = article.status;
  return matter.stringify(article.body, front, MATTER_OPTS);
}
