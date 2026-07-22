import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readState, isAlive, openCommand } from '../src/ui-server';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-ui-'));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('ui-server', () => {
  it('returns undefined state when no ui.json exists', async () => {
    expect(await readState()).toBeUndefined();
  });

  it('reads a written ui.json', async () => {
    await fs.writeFile(
      path.join(home, 'ui.json'),
      JSON.stringify({ pid: 123, port: 4321, url: 'http://127.0.0.1:4321', startedAt: 'x' }),
    );
    expect((await readState())?.port).toBe(4321);
  });

  it('isAlive is false for an unused pid', () => {
    expect(isAlive(2 ** 30)).toBe(false);
  });

  it('isAlive is true for the current process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('picks a platform open command', () => {
    expect(openCommand().cmd).toMatch(/open|xdg-open|cmd/);
  });
});
