import { describe, expect, it } from 'vitest';
import { ensureTool } from '../src/plugins/sdk';

const SPEC = { command: 'fzf', mise: 'fzf', brew: 'fzf', apt: 'fzf', manual: 'see https://github.com/junegunn/fzf' };

/** Build an `exists` probe from a set of present commands (mutable so installs can flip it). */
function existsFrom(present: Set<string>) {
  return async (cmd: string) => present.has(cmd);
}

describe('ensureTool', () => {
  it('returns present without installing when the tool already exists', async () => {
    const runs: string[][] = [];
    const res = await ensureTool(SPEC, {
      install: true,
      exists: existsFrom(new Set(['fzf'])),
      run: async (file, args) => runs.push([file, ...args]),
    });
    expect(res).toMatchObject({ present: true, installed: false });
    expect(runs).toHaveLength(0);
  });

  it('does not install when install is not requested (reports manual hint)', async () => {
    const res = await ensureTool(SPEC, { exists: existsFrom(new Set()) });
    expect(res.present).toBe(false);
    expect(res.installed).toBe(false);
    expect(res.message).toContain('github.com/junegunn/fzf');
  });

  it('installs via mise (preferred) and reports present after', async () => {
    const present = new Set(['mise']); // mise available, fzf not yet
    const runs: string[][] = [];
    const res = await ensureTool(SPEC, {
      install: true,
      exists: existsFrom(present),
      run: async (file, args) => {
        runs.push([file, ...args]);
        if (file === 'mise') present.add('fzf'); // install succeeds
      },
    });
    expect(res).toMatchObject({ present: true, installed: true, method: 'mise' });
    expect(runs).toEqual([['mise', 'use', '-g', 'fzf']]);
  });

  it('falls back to brew when mise is unavailable', async () => {
    const present = new Set(['brew']);
    const runs: string[][] = [];
    const res = await ensureTool(SPEC, {
      install: true,
      exists: existsFrom(present),
      run: async (file, args) => {
        runs.push([file, ...args]);
        if (file === 'brew') present.add('fzf');
      },
    });
    expect(res).toMatchObject({ present: true, installed: true, method: 'brew' });
    expect(runs).toEqual([['brew', 'install', 'fzf']]);
  });

  it('reports installed-but-not-on-PATH when the binary still is not found', async () => {
    const present = new Set(['mise']); // install "succeeds" but fzf never appears (shim not active)
    const res = await ensureTool(SPEC, {
      install: true,
      exists: existsFrom(present),
      run: async () => {},
    });
    expect(res).toMatchObject({ present: false, installed: true, method: 'mise' });
    expect(res.message).toMatch(/isn't on PATH/);
  });

  it('cannot auto-install with no manager, and surfaces the apt hint', async () => {
    const res = await ensureTool(SPEC, {
      install: true,
      exists: existsFrom(new Set()), // no mise, no brew
      run: async () => {
        throw new Error('should not run');
      },
    });
    expect(res).toMatchObject({ present: false, installed: false });
    expect(res.message).toContain('could not auto-install');
    expect(res.message).toContain('apt-get install -y fzf');
  });
});
