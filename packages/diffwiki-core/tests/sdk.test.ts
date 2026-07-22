/**
 * SDK unit tests for definePlugin, invokePlugin, runProcess, runProcessJson,
 * and commandExists.
 *
 * These tests exercise the authoring SDK (exported from diffwiki-core/plugin)
 * and the host-side one-shot invokePlugin helper. They spawn real node
 * processes via temp scripts to prove the full stdin/stdout contract.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, runProcess, runProcessJson, commandExists } from '../src/plugin';
import { invokePlugin } from '../src/plugins/invoke';

let scratch: string[];

beforeEach(() => {
  scratch = [];
});

afterEach(async () => {
  for (const dir of scratch) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Write a one-shot plugin script to a temp dir and return the path. */
async function writeScript(code: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-test-'));
  scratch.push(dir);
  const file = path.join(dir, 'plugin.mjs');
  await fs.writeFile(file, code, 'utf8');
  return file;
}

describe('runProcess', () => {
  it('runs a command and returns stdout/stderr', async () => {
    const { stdout } = await runProcess('node', ['-e', 'console.log("hello")']);
    expect(stdout.trim()).toBe('hello');
  });

  it('throws on a failing command', async () => {
    await expect(runProcess('node', ['-e', 'process.exit(1)'])).rejects.toThrow();
  });
});

describe('runProcessJson', () => {
  it('parses JSON from stdout', async () => {
    const result = await runProcessJson<{ x: number }>('node', ['-e', 'console.log(JSON.stringify({x:42}))']);
    expect(result).toEqual({ x: 42 });
  });

  it('throws on non-JSON stdout', async () => {
    await expect(runProcessJson('node', ['-e', 'console.log("not json")'])).rejects.toThrow(/valid JSON/);
  });
});

describe('commandExists', () => {
  it('returns true for node (which is definitely available)', async () => {
    expect(await commandExists('node')).toBe(true);
  });

  it('returns false for a non-existent command', async () => {
    expect(await commandExists('zzz_nonexistent_command_zzz')).toBe(false);
  });
});

describe('definePlugin', () => {
  it('creates a DefinedPlugin with the correct definition', () => {
    const plugin = definePlugin({
      name: 'test-plugin',
      kind: 'search',
      version: '1.0.0',
      capabilities: { searchTypes: ['text'], collectionFilter: true, events: false },
      handlers: {
        search: async () => ({ hits: [] }),
      },
    });
    expect(plugin.definition.name).toBe('test-plugin');
    expect(plugin.definition.kind).toBe('search');
    expect(plugin.definition.version).toBe('1.0.0');
    expect(typeof plugin.run).toBe('function');
  });
});

describe('invokePlugin (one-shot)', () => {
  it('invokes describe and gets the plugin metadata', async () => {
    const script = await writeScript(`
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => buf += c);
      process.stdin.on('end', () => {
        const req = JSON.parse(buf.trim());
        if (req.op === 'describe') {
          process.stdout.write(JSON.stringify({
            ok: true,
            result: { name: 'test', kind: 'search', capabilities: { searchTypes: ['x'], collectionFilter: false, events: false } }
          }) + '\\n');
        }
        process.exit(0);
      });
    `);

    const result = await invokePlugin<{ name: string; kind: string }>([process.execPath, script], 'describe', {});
    expect(result.name).toBe('test');
    expect(result.kind).toBe('search');
  });

  it('rejects when the plugin returns ok: false', async () => {
    const script = await writeScript(`
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => buf += c);
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ ok: false, error: { message: 'boom' } }) + '\\n');
        process.exit(1);
      });
    `);

    await expect(invokePlugin([process.execPath, script], 'search', {})).rejects.toThrow('boom');
  });

  it('rejects on timeout', async () => {
    const script = await writeScript(`
      // hang forever
      setTimeout(() => {}, 60000);
    `);

    await expect(invokePlugin([process.execPath, script], 'describe', {}, { timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    );
  });

  it('rejects when the plugin produces no output', async () => {
    const script = await writeScript(`
      process.stdin.resume();
      process.stdin.on('end', () => process.exit(0));
    `);

    await expect(invokePlugin([process.execPath, script], 'describe', {})).rejects.toThrow(/no output/);
  });
});
