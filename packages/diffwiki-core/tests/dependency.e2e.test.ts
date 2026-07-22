// Real-filesystem e2e for the SDK's dependency resolver. Builds a throwaway
// node_modules tree with a package that has an `exports` map (the case that
// breaks require.resolve('<pkg>/package.json')) and proves resolveDependency
// finds the npm-local bin by walking node_modules — then the PATH fallback and
// the unresolved case. No network, no real tools beyond `node` itself.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveDependency } from '../src/plugin.js';

describe('resolveDependency (real filesystem)', () => {
  let root: string;
  let consumerUrl: string;
  let localBin: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'diffwiki-dep-e2e-'));
    // <root>/node_modules/@acme/tool with an `exports` map (blocks
    // require.resolve of package.json) and a bin at bin/tool.
    const pkgDir = join(root, 'node_modules', '@acme', 'tool');
    await mkdir(join(pkgDir, 'bin'), { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@acme/tool',
        version: '1.0.0',
        exports: { '.': './index.js' },
        bin: { tool: 'bin/tool' },
      }),
      'utf8',
    );
    localBin = join(pkgDir, 'bin', 'tool');
    await writeFile(localBin, '#!/usr/bin/env node\nconsole.log("acme-tool");\n', 'utf8');
    await chmod(localBin, 0o755);
    // A consumer module deeper in the tree — resolution must walk up to find it.
    const consumerDir = join(root, 'node_modules', 'consumer', 'dist');
    await mkdir(consumerDir, { recursive: true });
    consumerUrl = pathToFileURL(join(consumerDir, 'bin.js')).href;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves the npm-local bin by walking node_modules (exports map notwithstanding)', async () => {
    const r = await resolveDependency({ command: 'tool', npm: '@acme/tool' }, consumerUrl);
    expect(r.source).toBe('npm');
    expect(r.command).toEqual([localBin]);
  });

  it('falls back to PATH when the npm package is not installed locally', async () => {
    // `node` is guaranteed on PATH in the test runner; no local package for it.
    const r = await resolveDependency({ command: 'node', npm: '@acme/not-installed' }, consumerUrl);
    expect(r.source).toBe('path');
    expect(r.command).toEqual(['node']);
  });

  it('reports missing when neither the npm-local bin nor PATH resolves', async () => {
    const r = await resolveDependency({ command: 'diffwiki-nonexistent-xyz', npm: '@acme/not-installed' }, consumerUrl);
    expect(r.source).toBe('missing');
    expect(r.command).toBeNull();
  });
});
