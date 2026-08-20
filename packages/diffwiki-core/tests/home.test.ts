import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureHome } from '../src/home';
import { resolveHome } from '../src/paths';

let home: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-init-')));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('ensureHome', () => {
  it('creates the home tree and seeds registry + config on a fresh home', async () => {
    await ensureHome();
    expect(resolveHome()).toBe(home);
    for (const dir of ['collections', 'plugins', 'templates']) {
      await expect(fs.access(path.join(home, dir))).resolves.toBeUndefined();
    }
    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    expect(registry).toEqual({ version: 1, collections: [] });
    const config = JSON.parse(await fs.readFile(path.join(home, 'config.json'), 'utf8'));
    expect(config).toEqual({});
  });

  it('never clobbers existing user data', async () => {
    await fs.mkdir(path.join(home, 'collections'), { recursive: true });
    await fs.writeFile(
      path.join(home, 'registry.json'),
      JSON.stringify({ version: 1, collections: [{ name: 'x', type: 'global', path: '/tmp/x' }] }),
      'utf8',
    );
    await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ editor: 'code' }), 'utf8');

    await ensureHome();

    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    expect(registry.collections).toEqual([{ name: 'x', type: 'global', path: '/tmp/x' }]);
    const config = JSON.parse(await fs.readFile(path.join(home, 'config.json'), 'utf8'));
    expect(config).toEqual({ editor: 'code' });
  });

  it('is idempotent', async () => {
    await ensureHome();
    await ensureHome();
    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    expect(registry.collections).toEqual([]);
  });
});
