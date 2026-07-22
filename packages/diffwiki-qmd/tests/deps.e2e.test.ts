// Real subprocess e2e for the qmd plugin's declared-and-resolved dependency.
// Spawns the built dist/bin.js and drives the protocol over stdio to prove:
//   1. `describe` advertises qmd as a declared dependency (npm @tobilu/qmd).
//   2. the plugin resolves qmd from its OWN node_modules — even with PATH
//      stripped, so it works without any global qmd (the whole point of
//      declaring it as an npm dependency).
//
// Gated on @tobilu/qmd being installed locally (a declared dependency, so it is
// after `pnpm install`); skips otherwise instead of failing on a fresh checkout.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN_PATH = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const LOCAL_QMD = fileURLToPath(new URL('../node_modules/@tobilu/qmd/bin/qmd', import.meta.url));
const qmdInstalled = existsSync(LOCAL_QMD);

interface PluginResponse {
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

/**
 * Spawn the plugin as a one-shot subprocess. `env` overrides are merged over the
 * current env; `process.execPath` is used (not `'node'`) so the spawn works even
 * when the override strips PATH.
 */
async function invokePlugin(
  op: string,
  params: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<PluginResponse> {
  return new Promise<PluginResponse>((resolve, reject) => {
    const proc = spawn(process.execPath, [BIN_PATH], { stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    proc.on('error', reject);
    proc.on('close', (code) => {
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        reject(new Error(`plugin exited ${code}, no output. stderr: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(lines[lines.length - 1]) as PluginResponse);
      } catch {
        reject(new Error(`unparseable plugin response: ${lines[lines.length - 1]}`));
      }
    });
    proc.stdin.write(JSON.stringify({ op, params }) + '\n', () => proc.stdin.end());
  });
}

describe.skipIf(!qmdInstalled)('qmd plugin dependency e2e (real subprocess)', () => {
  it('describe advertises qmd as a declared npm dependency', async () => {
    const res = await invokePlugin('describe', {}, process.env);
    expect(res.ok).toBe(true);
    const deps = (res.result as { dependencies?: Array<Record<string, unknown>> }).dependencies ?? [];
    const qmd = deps.find((d) => d.command === 'qmd');
    expect(qmd).toBeDefined();
    expect(qmd?.npm).toBe('@tobilu/qmd');
  });

  it('resolves qmd from node_modules even with PATH stripped (no global qmd needed)', async () => {
    // PATH='' means a bare `qmd` would NOT be found — only npm-local resolution
    // can succeed. Warm mode off so health takes the cold path.
    const env = { ...process.env, PATH: '', DIFFWIKI_QMD_WARM: '0' };
    const res = await invokePlugin('health', { collections: [] }, env);
    expect(res.ok).toBe(true);
    const readiness = (res.result as { readiness?: { toolInstalled?: boolean } }).readiness;
    expect(readiness?.toolInstalled).toBe(true);
  });
});
