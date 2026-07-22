import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { getLogger, resolveLogLevel } from '../src/logger';

/** Configure LogTape with an in-memory sink capturing `['diffwiki']` records. */
function captureDiffwiki(records: LogRecord[]): void {
  configureSync({
    sinks: { mem: (record: LogRecord) => records.push(record) },
    loggers: [
      { category: ['diffwiki'], lowestLevel: 'trace', sinks: ['mem'] },
      { category: [], lowestLevel: 'fatal', sinks: [] },
    ],
  });
}

describe('getLogger', () => {
  afterEach(() => {
    resetSync();
  });

  it('nests scopes under the shared ["diffwiki", ...] category root', () => {
    const records: LogRecord[] = [];
    captureDiffwiki(records);
    getLogger('query').info('hello');
    expect(records).toHaveLength(1);
    expect(records[0].category).toEqual(['diffwiki', 'query']);
    expect(records[0].message.join('')).toBe('hello');
  });

  it('accepts an array scope as a nested category path', () => {
    const records: LogRecord[] = [];
    captureDiffwiki(records);
    getLogger(['plugin', 'diffwiki-qmd']).warn('stale');
    expect(records[0].category).toEqual(['diffwiki', 'plugin', 'diffwiki-qmd']);
    expect(records[0].level).toBe('warning');
  });

  it('is a safe no-op before any configure (libraries stay silent)', () => {
    // No configure(): getLogger + emit must not throw.
    expect(() => getLogger('query').error('no sink yet')).not.toThrow();
  });
});

describe('resolveLogLevel', () => {
  const saved = process.env.DIFFWIKI_LOG;

  beforeEach(() => {
    delete process.env.DIFFWIKI_LOG;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DIFFWIKI_LOG;
    else process.env.DIFFWIKI_LOG = saved;
  });

  it('defaults to "warning" when DIFFWIKI_LOG is unset', () => {
    expect(resolveLogLevel({})).toBe('warning');
  });

  it('defaults to "warning" for an unrecognized level', () => {
    expect(resolveLogLevel({ DIFFWIKI_LOG: 'loud' })).toBe('warning');
  });

  it('parses each valid level (case-insensitively)', () => {
    expect(resolveLogLevel({ DIFFWIKI_LOG: 'debug' })).toBe('debug');
    expect(resolveLogLevel({ DIFFWIKI_LOG: 'INFO' })).toBe('info');
    expect(resolveLogLevel({ DIFFWIKI_LOG: 'error' })).toBe('error');
    expect(resolveLogLevel({ DIFFWIKI_LOG: 'fatal' })).toBe('fatal');
  });

  it('reads process.env by default', () => {
    process.env.DIFFWIKI_LOG = 'trace';
    expect(resolveLogLevel()).toBe('trace');
  });
});
