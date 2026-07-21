import { DiffwikiError } from 'diffwiki-core';

/**
 * Wrap an async Commander action: expected DiffwikiErrors become a clean stderr
 * line + non-zero exit; anything unexpected is rethrown so it surfaces loudly.
 */
export function withErrors<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof DiffwikiError) {
        console.error(`✖ ${error.message}`);
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
