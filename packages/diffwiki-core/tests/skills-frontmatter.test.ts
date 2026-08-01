import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

// Repo root: tests -> diffwiki-core -> packages -> <root>.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

/**
 * The agentskills installer parses each shipped skill's YAML frontmatter and
 * SILENTLY SKIPS any file it cannot parse — so a malformed `SKILL.md` never
 * installs, with no error (this is exactly how `dw-dream` shipped in 0.13.0 but
 * failed to install: an unquoted inline colon in its `description` parsed as a
 * nested mapping). These tests fail loudly on that class of bug instead.
 *
 * `yaml.parse` is the strict parser the installer uses; js-yaml (gray-matter's
 * default) is more lenient and would not catch the same error.
 */
function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (e.isFile() && match(e.name)) out.push(full);
  }
  return out;
}

function extractFrontmatter(raw: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  return m ? m[1] : null;
}

const skillManifests = fs.existsSync(SKILLS_DIR) ? walk(SKILLS_DIR, (n) => n === 'SKILL.md') : [];
const allMarkdown = fs.existsSync(SKILLS_DIR) ? walk(SKILLS_DIR, (n) => n.endsWith('.md')) : [];

describe('skills frontmatter is installer-parseable', () => {
  it('finds the shipped SKILL.md manifests (guards against a broken scan)', () => {
    expect(skillManifests.length).toBeGreaterThanOrEqual(6);
  });

  it.each(skillManifests.map((f) => [path.relative(REPO_ROOT, f), f] as const))(
    '%s: frontmatter parses with a string name + description',
    (_label, file) => {
      const fm = extractFrontmatter(fs.readFileSync(file, 'utf8'));
      expect(fm, 'SKILL.md must start with a YAML frontmatter block').not.toBeNull();
      const data = parseYaml(fm as string) as Record<string, unknown> | null;
      expect(data && typeof data === 'object').toBe(true);
      const { name, description } = data as Record<string, unknown>;
      expect(typeof name === 'string' && name.trim().length > 0).toBe(true);
      expect(typeof description === 'string' && description.trim().length > 0).toBe(true);
    },
  );

  it.each(allMarkdown.map((f) => [path.relative(REPO_ROOT, f), f] as const))(
    '%s: any frontmatter block is valid YAML',
    (_label, file) => {
      const fm = extractFrontmatter(fs.readFileSync(file, 'utf8'));
      if (fm === null) return; // prose-only file — nothing to parse
      expect(() => parseYaml(fm)).not.toThrow();
    },
  );
});
