import { describe, expect, it } from 'vitest';
import { lintArticle } from '../src/lint';

describe('lintArticle', () => {
  it('flags missing title, template-tag leak, no references, and draft', () => {
    const findings = lintArticle({
      title: '',
      tags: ['diffwiki-template', 'recipe'],
      status: 'draft',
      body: 'text with no link',
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('frontmatter-title');
    expect(rules).toContain('template-tag-leak');
    expect(rules).toContain('no-references');
    expect(rules).toContain('status-draft');
  });

  it('passes a tight published recipe with an inline link', () => {
    const findings = lintArticle({
      title: 'Argument Parsing',
      tags: ['recipe', 'bash'],
      status: 'published',
      body: 'A pattern. See [ref](https://example.com).\n',
    });
    expect(findings.filter((f) => f.level === 'error')).toHaveLength(0);
  });

  it('errors when a guide blows the token budget', () => {
    const findings = lintArticle({
      title: 'Big',
      tags: ['guide'],
      status: 'published',
      body: 'x'.repeat(25000) + ' [r](https://e.com)',
    });
    expect(findings.some((f) => f.rule === 'token-budget' && f.level === 'error')).toBe(true);
  });

  it('applies the generic architecture fallback budget (1000–6000)', () => {
    const body = 'x'.repeat(16000) + ' [r](https://e.com)'; // ~4000 tokens
    const arch = lintArticle({ title: 'System', tags: ['architecture'], status: 'published', body });
    expect(arch.some((f) => f.rule === 'token-budget')).toBe(false); // within 1000–6000
  });

  it('collection-index: passes with bullet links and no refs section', () => {
    const findings = lintArticle({
      title: 'My Collection',
      tags: ['collection-index', 'typescript'],
      status: 'published',
      body: '## Topic\n\n- [Foo](./foo.md) — does foo.\n- [Bar](./bar.md) — does bar.\n',
    });
    expect(findings.filter((f) => f.level === 'error')).toHaveLength(0);
    expect(findings.map((f) => f.rule)).not.toContain('no-references');
  });

  it('collection-index: errors when body exceeds 500-tok max', () => {
    const findings = lintArticle({
      title: 'Big Index',
      tags: ['collection-index'],
      status: 'published',
      body: '- [x](./x.md) — desc.\n'.repeat(100),
    });
    expect(findings.some((f) => f.rule === 'token-budget')).toBe(true);
  });
});
