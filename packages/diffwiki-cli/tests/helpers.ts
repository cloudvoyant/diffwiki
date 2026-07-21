import { vi } from 'vitest';
import { createProgram } from '../src/cli';

export interface RunResult {
  ok: boolean;
  out: string;
  err: string;
}

/** Run the CLI programmatically against a fresh program, capturing stdout/stderr. */
export async function run(args: string[]): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...parts: unknown[]) => out.push(parts.map(String).join(' ')));
  const errSpy = vi
    .spyOn(console, 'error')
    .mockImplementation((...parts: unknown[]) => err.push(parts.map(String).join(' ')));
  const previousExit = process.exitCode;
  process.exitCode = 0;
  try {
    await createProgram().parseAsync(['node', 'diffwiki', ...args]);
    const ok = !process.exitCode;
    return { ok, out: out.join('\n'), err: err.join('\n') };
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}
