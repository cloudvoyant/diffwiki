import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const binPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const built = existsSync(binPath);

describe.skipIf(!built)('packaged binary smoke test', () => {
  it('prints its version', () => {
    const out = execFileSync('node', [binPath, '--version'], { encoding: 'utf8' });
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('prints help listing subcommands', () => {
    const out = execFileSync('node', [binPath, '--help'], { encoding: 'utf8' });
    expect(out).toContain('collection');
    expect(out).toContain('article');
    expect(out).toContain('config');
  });
});
