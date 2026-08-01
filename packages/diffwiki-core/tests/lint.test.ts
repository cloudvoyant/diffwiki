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

  it('enforces the tighter component-design budget vs system-design', () => {
    const body = 'x'.repeat(16000) + ' [r](https://e.com)'; // ~4000 tokens
    const component = lintArticle({ title: 'Widget', tags: ['component-design'], status: 'published', body });
    expect(component.some((f) => f.rule === 'token-budget' && f.level === 'error')).toBe(true); // > 3000 cap
    const system = lintArticle({ title: 'System', tags: ['system-design'], status: 'published', body });
    expect(system.some((f) => f.rule === 'token-budget')).toBe(false); // within 2000–6000
  });
});
