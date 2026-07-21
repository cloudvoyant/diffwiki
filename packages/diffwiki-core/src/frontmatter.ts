import matter from 'gray-matter';

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

export function parseArticle(raw: string): ParsedArticle {
  const { data, content } = matter(raw);
  const title = typeof data.title === 'string' ? data.title : '';
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [];
  const created = typeof data.created === 'string' ? data.created : undefined;
  return { title, tags, created, body: content.replace(/^\n+/, '') };
}

export function serializeArticle(article: SerializableArticle): string {
  const front: Record<string, unknown> = { title: article.title, tags: article.tags };
  if (article.created) front.created = article.created;
  if (article.updated) front.updated = article.updated;
  return matter.stringify(article.body, front);
}
