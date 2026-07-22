import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedArticle {
  title: string;
  tags: string[];
  created?: string;
  body: string;
}

export interface SerializableArticle {
  title: string;
  tags: string[];
  created?: string;
  updated?: string;
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

export function parseArticle(raw: string): ParsedArticle {
  const { data, content } = matter(raw, MATTER_OPTS);
  const title = typeof data.title === 'string' ? data.title : '';
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [];
  const created = typeof data.created === 'string' ? data.created : undefined;
  return { title, tags, created, body: content.replace(/^\n+/, '') };
}

export function serializeArticle(article: SerializableArticle): string {
  const front: Record<string, unknown> = { title: article.title, tags: article.tags };
  if (article.created) front.created = article.created;
  if (article.updated) front.updated = article.updated;
  return matter.stringify(article.body, front, MATTER_OPTS);
}
