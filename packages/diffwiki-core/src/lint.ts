/**
 * Article linter -- checks wiki entries against the template shapes (recipe,
 * recipe-with-steps, guide, reference; plus a generic `architecture` fallback
 * budget). Pure rules in `lintArticle`; `lintCollections` walks registry
 * collections and aggregates.
 *
 * @module
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { listCollections } from './collections';
import { resolveCwdCollection } from './repo';
import { parseArticle, type ParsedArticle } from './frontmatter';
import { CollectionNotFoundError } from './errors';
import type { CollectionEntry } from './types';

export type LintLevel = 'error' | 'warn';
export interface LintFinding {
  level: LintLevel;
  rule: string;
  message: string;
}
export interface LintFileResult {
  /** `<collection>/<relative-path>` label. */
  path: string;
  findings: LintFinding[];
}
export interface LintResult {
  files: LintFileResult[];
  fileCount: number;
  errorCount: number;
  warnCount: number;
}

type Shape = 'recipe' | 'recipe-steps' | 'guide' | 'reference' | 'architecture' | 'collection-index';
const BUDGETS: Record<Shape, { min: number; max: number }> = {
  recipe: { min: 50, max: 1000 },
  'recipe-steps': { min: 100, max: 1500 },
  guide: { min: 1500, max: 5000 },
  reference: { min: 300, max: 2000 },
  // Generic fallback budget for a bare `architecture` tag (no dedicated template).
  architecture: { min: 1000, max: 6000 },
  // Index pages: headings + bullet links only, no prose.
  'collection-index': { min: 100, max: 500 },
};

/** ~4 chars per token -- a deliberate over-estimate that matches the shape budgets. */
function estimateTokens(body: string): number {
  return Math.ceil(body.trim().length / 4);
}

function inferShape(tags: string[], body: string): Shape {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  if (t.has('collection-index')) return 'collection-index';
  if (t.has('guide')) return 'guide';
  if (t.has('reference')) return 'reference';
  if (t.has('architecture')) return 'architecture';
  if (t.has('recipe-with-steps')) return 'recipe-steps';
  if (/^###\s+Step\b/im.test(body)) return 'recipe-steps';
  return 'recipe';
}

/** Stateless rules over a parsed article. */
export function lintArticle(article: Pick<ParsedArticle, 'title' | 'tags' | 'status' | 'body'>): LintFinding[] {
  const findings: LintFinding[] = [];
  const { title, tags, status, body } = article;
  const shape = inferShape(tags, body);
  const tokens = estimateTokens(body);
  const budget = BUDGETS[shape];

  if (!title || !title.trim()) {
    findings.push({ level: 'error', rule: 'frontmatter-title', message: 'missing frontmatter title' });
  }
  if (tags.map((x) => x.toLowerCase()).includes('diffwiki-template')) {
    findings.push({
      level: 'error',
      rule: 'template-tag-leak',
      message: 'instance still tagged diffwiki-template',
    });
  }
  if (tags.length === 0) {
    findings.push({ level: 'warn', rule: 'no-tags', message: 'no tags -- add topic tags for recall' });
  }

  const hasRefsSection = /^##\s+References\b/im.test(body);
  const hasInlineLink = /\]\([^)]+\)/.test(body);
  // collection-index pages ARE the references (link lists) — skip reference rules entirely.
  if (shape !== 'collection-index') {
    if (!hasRefsSection && !hasInlineLink) {
      findings.push({
        level: 'error',
        rule: 'no-references',
        message: 'has no ## References section and no inline links',
      });
    }
    if ((shape === 'guide' || shape === 'architecture') && !hasRefsSection) {
      findings.push({
        level: 'warn',
        rule: 'missing-references-section',
        message: `${shape} should end with a ## References section`,
      });
    }
  }

  if (tokens > budget.max) {
    findings.push({
      level: 'error',
      rule: 'token-budget',
      message: `body ~${tokens} tokens exceeds ${shape} budget (${budget.max})`,
    });
  } else if (tokens < budget.min) {
    findings.push({
      level: 'warn',
      rule: 'token-thin',
      message: `body ~${tokens} tokens is thin for ${shape} (min ${budget.min})`,
    });
  }

  if (status === 'draft') {
    findings.push({ level: 'warn', rule: 'status-draft', message: 'status is still draft' });
  }
  if (/\*\*Load when:\*\*/i.test(body)) {
    findings.push({
      level: 'warn',
      rule: 'load-when-prefix',
      message: 'remove the **Load when:** prefix (implicit trigger)',
    });
  }
  if (/^[A-Za-z0-9][\w .+-]*:\s/.test(title)) {
    findings.push({ level: 'warn', rule: 'title-prefix', message: `title "${title}" repeats a path-like prefix` });
  }
  return findings;
}

async function walkMarkdown(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMarkdown(full)));
    else if (e.isFile() && /\.mdx?$/.test(e.name) && !/-template\.mdx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Resolve the lint scope string to concrete collections. `all` skips system collections
 *  (transcripts etc. are not template-linted); an explicit name still lints a system one. */
async function resolveScope(scope: string): Promise<CollectionEntry[]> {
  const all = await listCollections();
  if (scope === 'all') return all.filter((c) => c.audience !== 'system');
  if (scope === 'current') {
    const cur = await resolveCwdCollection(process.cwd());
    if (!cur) throw new Error('No collection for the current directory -- pass -c <name> or -c all.');
    return [cur];
  }
  const names = scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const chosen: CollectionEntry[] = [];
  for (const n of names) {
    const hit = all.find((c) => c.name === n);
    if (!hit) throw new CollectionNotFoundError(n);
    chosen.push(hit);
  }
  return chosen;
}

/** Lint every article in the resolved scope. `scope` = 'current' | 'all' | 'a,b,c'. */
export async function lintCollections(scope: string): Promise<LintResult> {
  const collections = await resolveScope(scope);
  const files: LintFileResult[] = [];
  let errorCount = 0;
  let warnCount = 0;
  for (const coll of collections) {
    for (const full of await walkMarkdown(coll.path)) {
      const rel = path.relative(coll.path, full);
      const label = `${coll.name}/${rel}`;
      let findings: LintFinding[] = [];
      try {
        const parsed = parseArticle(await fs.readFile(full, 'utf8'));
        findings = lintArticle(parsed);
      } catch (err) {
        findings = [{ level: 'error', rule: 'parse', message: `could not parse: ${(err as Error).message}` }];
      }
      for (const f of findings) {
        if (f.level === 'error') errorCount++;
        else warnCount++;
      }
      files.push({ path: label, findings });
    }
  }
  return { files, fileCount: files.length, errorCount, warnCount };
}
