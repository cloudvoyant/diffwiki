import { DiffwikiError, SyncConflictError } from 'diffwiki-core';

// api -------------------------------------------------------------------------

/**
 * Wrap an async Commander action: expected DiffwikiErrors become a clean stderr
 * line + non-zero exit; anything unexpected is rethrown so it surfaces loudly.
 */
export function withErrors<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof SyncConflictError) {
        console.error(formatSyncConflictError(error));
        process.exitCode = 1;
        return;
      }
      if (error instanceof DiffwikiError) {
        const prefix = error.name === 'DiffwikiError' ? '' : `${error.name}: `;
        console.error(`✖ ${prefix}${error.message}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  };
}

/** Commander variadic collector: `-t a -t b` → ["a", "b"]. */
export const collect = (value: string, previous: string[]): string[] => previous.concat([value]);

/** Comma-split collected tag values: ["a,b", "c d"] → ["a", "b", "c d"]. */
export const splitTags = (raw: string[]): string[] =>
  raw
    .flatMap((t) => t.split(','))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

// helpers ---------------------------------------------------------------------

function formatSyncConflictError(error: SyncConflictError): string {
  const lines = ['✖ SyncConflictError: rebase stopped with unresolved conflict(s):'];
  if (error.conflicts.length > 0) {
    for (const file of error.conflicts) {
      lines.push(`  - ${file}`);
    }
  } else {
    lines.push(`  ${error.message}`);
  }
  lines.push(
    'Resolve conflicted files, run `git add`, then run `diffwiki pull --continue` or `diffwiki pull --abort`.',
  );
  return lines.join('\n');
}
