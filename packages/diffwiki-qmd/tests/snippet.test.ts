import { describe, expect, it } from 'vitest';
import { sanitizeSnippet, DEFAULT_SNIPPET_MAX } from '../src/snippet.js';

describe('sanitizeSnippet', () => {
  it('returns undefined for empty, undefined, or whitespace-only input', () => {
    expect(sanitizeSnippet(undefined)).toBeUndefined();
    expect(sanitizeSnippet('')).toBeUndefined();
    expect(sanitizeSnippet('   \n\t  ')).toBeUndefined();
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeSnippet('the intro chunk')).toBe('the intro chunk');
  });

  it('removes fenced code markers but keeps the code lines', () => {
    const raw = 'Run this:\n```ts\nconst x = 1;\n```\ndone';
    expect(sanitizeSnippet(raw)).toBe('Run this: const x = 1; done');
  });

  it('removes tilde fences too', () => {
    const raw = '~~~\nplain code\n~~~';
    expect(sanitizeSnippet(raw)).toBe('plain code');
  });

  it('strips inline code backticks, keeping content', () => {
    expect(sanitizeSnippet('use `npm install` first')).toBe('use npm install first');
  });

  it('strips ATX heading markers', () => {
    expect(sanitizeSnippet('# Title\n## Subtitle\nbody')).toBe('Title Subtitle body');
  });

  it('strips emphasis and strong markers', () => {
    expect(sanitizeSnippet('a **bold** and *italic* and ~~struck~~ word')).toBe('a bold and italic and struck word');
  });

  it('preserves literal underscores and asterisks that are not emphasis', () => {
    expect(sanitizeSnippet('use snake_case not camelCase')).toBe('use snake_case not camelCase');
    expect(sanitizeSnippet('the a_b_c value')).toBe('the a_b_c value');
    expect(sanitizeSnippet('rename file_name here')).toBe('rename file_name here');
    expect(sanitizeSnippet('compute 2*3 quickly')).toBe('compute 2*3 quickly');
  });

  it('strips emphasis adjacent to literal marker prose', () => {
    expect(sanitizeSnippet('set *value* on snake_case')).toBe('set value on snake_case');
    expect(sanitizeSnippet('a __bold__ file_name entry')).toBe('a bold file_name entry');
  });

  it('keeps link text and drops the url', () => {
    expect(sanitizeSnippet('see [the docs](https://example.com/x) now')).toBe('see the docs now');
  });

  it('keeps reference-style link text', () => {
    expect(sanitizeSnippet('see [the docs][ref] now')).toBe('see the docs now');
  });

  it('drops images entirely', () => {
    expect(sanitizeSnippet('before ![alt text](img.png) after')).toBe('before after');
  });

  it('strips blockquote markers', () => {
    expect(sanitizeSnippet('> quoted line\n> second')).toBe('quoted line second');
  });

  it('strips unordered and ordered list bullets', () => {
    expect(sanitizeSnippet('- one\n- two\n1. three\n2) four')).toBe('one two three four');
  });

  it('strips raw html tags', () => {
    expect(sanitizeSnippet('a <mark>match</mark> here <br/>next')).toBe('a match here next');
  });

  it('drops a leading yaml frontmatter block', () => {
    const raw = '---\ntitle: Foo\ntags: [a, b]\n---\nactual body text';
    expect(sanitizeSnippet(raw)).toBe('actual body text');
  });

  it('collapses newlines and repeated whitespace into single spaces', () => {
    expect(sanitizeSnippet('line one\n\n\nline   two\t\tthree')).toBe('line one line two three');
  });

  it('flattens a simple markdown table to spaced cells', () => {
    const raw = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(sanitizeSnippet(raw)).toBe('A B 1 2');
  });

  it('truncates long text on a word boundary with an ellipsis', () => {
    const word = 'lorem ';
    const raw = word.repeat(100); // 600 chars
    const out = sanitizeSnippet(raw);
    expect(out).toBeDefined();
    expect(out!.endsWith('…')).toBe(true);
    // Length is at most maxLength + the ellipsis char.
    expect(out!.length).toBeLessThanOrEqual(DEFAULT_SNIPPET_MAX + 1);
    // Truncation lands on a word boundary — no partial "lore" fragment.
    expect(
      out!
        .slice(0, -1)
        .trim()
        .split(' ')
        .every((w) => w === 'lorem'),
    ).toBe(true);
  });

  it('respects a custom maxLength', () => {
    const out = sanitizeSnippet('one two three four five six', 8);
    expect(out).toBe('one two…');
  });

  it('handles a realistic mixed-markdown chunk', () => {
    const raw =
      '## Installation\n\nInstall with `npm i foo`, then see [setup](./setup.md):\n\n```bash\nfoo init\n```\n\n> Note: **required** for v2.';
    expect(sanitizeSnippet(raw)).toBe(
      'Installation Install with npm i foo, then see setup: foo init Note: required for v2.',
    );
  });

  // qmd wraps every snippet in a diff-style locator. These cases mirror the
  // actual `snippet`/`bestChunk` strings qmd returns (captured from the CLI).
  describe('qmd chunk-locator decoration', () => {
    it('strips a plain hunk header (default, no line numbers)', () => {
      const raw = '@@ -13,4 @@ (12 before, 172 after)\n\nSvelteKit has two classic ways to run server-side code.';
      expect(sanitizeSnippet(raw)).toBe('SvelteKit has two classic ways to run server-side code.');
    });

    it('strips the header AND the line-number gutter (warm MCP path)', () => {
      const raw =
        '14: @@ -13,4 @@ (12 before, 172 after)\n15: \n16: SvelteKit has two classic ways to run server-side code.';
      expect(sanitizeSnippet(raw)).toBe('SvelteKit has two classic ways to run server-side code.');
    });

    it('strips a line-numbered gutter whose body is prose', () => {
      const raw = '5: Form actions only work with HTML form submits.\n6: Route handlers work with any request.';
      // The gutter is only stripped under the qmd signature; here there is no
      // `@@` header, so the leading digits must NOT be treated as a gutter.
      expect(sanitizeSnippet(raw)).toBe(
        '5: Form actions only work with HTML form submits. 6: Route handlers work with any request.',
      );
    });

    it('does NOT touch ordinary prose that starts with a time like 12:30', () => {
      expect(sanitizeSnippet('12:30 PM — standup notes')).toBe('12:30 PM — standup notes');
    });

    it('drops a chunk that is only a hunk header over frontmatter', () => {
      const raw =
        '@@ -1,4 @@ (0 before, 184 after)\n---\ntitle: "Server-Side Remote Functions"\ntags: [svelte, sveltekit, remote-functions, server]\ncreated: \'2026-07-21T12:00:00.000Z\'';
      // Header + unterminated frontmatter leaves nothing renderable → undefined.
      expect(sanitizeSnippet(raw)).toBeUndefined();
    });

    it('strips a line-numbered hunk header over frontmatter, then the prose survives', () => {
      const raw =
        '1: @@ -1,6 @@ (0 before, 184 after)\n2: ---\n3: title: "Remote Functions"\n4: ---\n5: \n6: Remote functions are experimental.';
      expect(sanitizeSnippet(raw)).toBe('Remote functions are experimental.');
    });
  });

  // qmd may start a chunk on line 2 — just after the opening `---` — so the
  // snippet is a bare YAML field run with no delimiter to anchor on.
  describe('undelimited leading frontmatter (chunk starts after opening ---)', () => {
    it('drops a bare frontmatter body that runs to the end of the snippet', () => {
      const raw =
        "title: \"Typing Form Action Results\"\ntags: [svelte, sveltekit, forms, typescript]\ncreated: '2026-07-21T12:00:00.000Z'\nupdated: '2026-07-21T12:00:00.000Z'";
      expect(sanitizeSnippet(raw)).toBeUndefined();
    });

    it('drops the bare frontmatter body but keeps the prose after it', () => {
      const raw =
        'title: "Typing Form Action Results"\ntags: [svelte, sveltekit, forms]\nupdated: \'2026-07-21T12:00:00.000Z\'\n\nWhen a SvelteKit form action returns data, it flows back as the form prop.';
      expect(sanitizeSnippet(raw)).toBe('When a SvelteKit form action returns data, it flows back as the form prop.');
    });

    it('handles the qmd hunk header + undelimited frontmatter body together', () => {
      const raw =
        "@@ -2,5 @@ (1 before, 115 after)\ntitle: \"Typing Form Action Results\"\ntags: [svelte, sveltekit, forms, typescript]\ncreated: '2026-07-21T12:00:00.000Z'\nupdated: '2026-07-21T12:00:00.000Z'";
      expect(sanitizeSnippet(raw)).toBeUndefined();
    });

    it('does NOT strip a single prose line that starts like a key (Note:)', () => {
      expect(sanitizeSnippet('Note: this behaviour is intentional and documented.')).toBe(
        'Note: this behaviour is intentional and documented.',
      );
    });

    it('does NOT strip colon-led prose that is not frontmatter (unknown keys)', () => {
      const raw = 'Input: the raw request body\nOutput: the parsed view model';
      expect(sanitizeSnippet(raw)).toBe('Input: the raw request body Output: the parsed view model');
    });
  });
});
