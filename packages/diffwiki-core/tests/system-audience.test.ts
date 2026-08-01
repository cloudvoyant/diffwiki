import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCollection } from '../src/collections';
import { buildCollections } from '../src/site';

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-'));
  process.env.DIFFWIKI_HOME = home;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('buildCollections + system audience', () => {
  it('hides system collections by default, shows them with showSystem', async () => {
    await createCollection('kb');
    await createCollection('transcripts', { audience: 'system' });
    const hidden = await buildCollections();
    expect(hidden.map((c) => c.name)).toContain('kb');
    expect(hidden.map((c) => c.name)).not.toContain('transcripts');
    const shown = await buildCollections({ showSystem: true });
    expect(shown.map((c) => c.name)).toContain('transcripts');
  });
});
