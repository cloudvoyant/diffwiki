import type { Readable, Writable } from 'node:stream';

export type LogLevel = 'info' | 'warn' | 'error';

export interface PluginRequest {
  id: number;
  op: string;
  params?: Record<string, unknown>;
}

export interface PluginResponseOk {
  id: number;
  ok: true;
  result: unknown;
}

export interface PluginResponseErr {
  id: number;
  ok: false;
  error: { message: string };
}

export type PluginResponse = PluginResponseOk | PluginResponseErr;

export interface PluginLog {
  log: { level: LogLevel; message: string };
}

/** Emits a `{log}` line to the host (diagnostic, no `id`). */
export type LogFn = (level: LogLevel, message: string) => void;

/** A single op handler: receives the request params and a log emitter, returns the op result. */
export type Handler = (params: Record<string, unknown>, log: LogFn) => unknown | Promise<unknown>;

export type HandlerMap = Record<string, Handler>;

export interface ServeIO {
  input?: Readable;
  output?: Writable;
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Runs the newline-delimited JSON protocol server: reads one request object per
 * line from `input`, dispatches to `handlers`, and writes exactly one response
 * line per request to `output`. Resolves when `input` ends.
 */
export function serve(handlers: HandlerMap, io: ServeIO = {}): Promise<void> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;

  const write = (obj: PluginResponse | PluginLog): void => {
    output.write(`${JSON.stringify(obj)}\n`);
  };

  const log: LogFn = (level, message) => {
    write({ log: { level, message } });
  };

  const dispatch = async (line: string): Promise<void> => {
    let req: PluginRequest;
    try {
      req = JSON.parse(line) as PluginRequest;
    } catch {
      process.stderr.write(`diffwiki-qmd: skipping malformed line: ${line}\n`);
      return;
    }
    const handler = handlers[req.op];
    if (!handler) {
      write({ id: req.id, ok: false, error: { message: `unknown op: ${req.op}` } });
      return;
    }
    try {
      const result = await handler(req.params ?? {}, log);
      write({ id: req.id, ok: true, result });
    } catch (err) {
      write({ id: req.id, ok: false, error: { message: toMessage(err) } });
    }
  };

  return new Promise<void>((resolve) => {
    let buffer = '';
    let chain: Promise<void> = Promise.resolve();

    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) {
          chain = chain.then(() => dispatch(line));
        }
        nl = buffer.indexOf('\n');
      }
    });
    input.on('end', () => {
      const tail = buffer.trim();
      if (tail.length > 0) chain = chain.then(() => dispatch(tail));
      chain.then(resolve);
    });
  });
}
