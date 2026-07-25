import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
    const data = parseYaml(input) as unknown;
    // A bare scalar (e.g. `--- true ---`) parses to a non-object; treat as empty.
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  },
  stringify: (data: object): string => stringifyYaml(data),
};
const MATTER_OPTS = { engines: { yaml: YAML_ENGINE } } as const;

/** Coerce a frontmatter `audience` value; anything but 'private' → 'public'. */
function coerceAudience(value: unknown): Audience {
  return value === 'private' ? 'private' : 'public';
}

/** Coerce a frontmatter `status` value; anything but 'draft' → 'published'. */
function coerceStatus(value: unknown): PublishStatus {
  return value === 'draft' ? 'draft' : 'published';
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
  if (article.audience === 'private') front.audience = 'private';
  if (article.status === 'draft') front.status = 'draft';
  return matter.stringify(article.body, front, MATTER_OPTS);
}
