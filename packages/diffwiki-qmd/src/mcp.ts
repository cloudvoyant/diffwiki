/**
 * Minimal MCP Streamable-HTTP client for the qmd warm daemon.
 *
 * Implements exactly the two round-trips verified in
 * `.codevoyant/plans/plugin-sdk-refactor/research/qmd-daemon-http.md`:
 *
 *   1. `POST /mcp` `initialize` — establishes a session; the daemon returns a
 *      `mcp-session-id` response header we capture and reuse. Models are NOT
 *      loaded here, so it is fast. `notifications/initialized` is NOT required.
 *   2. `POST /mcp` `tools/call name=query` — the actual search, sent with the
 *      captured session-id header. The diffwiki `type` maps to `searches` /
 *      `rerank` (keyword→lex, semantic→vec, hybrid→lex+vec+rerank).
 *
 * The response `result.structuredContent.results[]` is parsed into `QmdRow[]`
 * with a clean `<collection>/<relPath>` `file` (no `qmd://`, no `?index=`),
 * which `bin.ts` splits via `splitQmdPath` exactly as the cold path does.
 *
 * `fetch` is injected (`FetchFn`) so unit tests never touch the network.
 *
 * @module
 */

import type { FetchFn } from './daemon.js';
import type { QmdRow } from './bin.js';

/** Arguments for a warm MCP search. */
export interface McpSearchArgs {
  /** The user's search term / query string. */
  term: string;
  /** diffwiki search type: `keyword` | `semantic` | `hybrid`. */
  type: string;
  /** Optional single-collection filter (qmd collection name). */
  collection?: string;
  /** Max results. */
  limit: number;
  /** Minimum score filter (0 disables). */
  minScore?: number;
}

/** One entry of the `searches` array in a qmd `query` tool call. */
interface QmdSearchSpec {
  type: 'lex' | 'vec';
  query: string;
}

/** The `searches`/`rerank` pair a diffwiki `type` maps to. */
export function searchesForType(type: string, query: string): { searches: QmdSearchSpec[]; rerank: boolean } {
  switch (type) {
    case 'semantic':
      return { searches: [{ type: 'vec', query }], rerank: false };
    case 'hybrid':
      return {
        searches: [
          { type: 'lex', query },
          { type: 'vec', query },
        ],
        rerank: true,
      };
    case 'keyword':
    default:
      return { searches: [{ type: 'lex', query }], rerank: false };
  }
}

const MCP_HEADERS_BASE: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

/** Shape of one row inside `result.structuredContent.results[]`. */
interface McpResultRow {
  file?: unknown;
  title?: unknown;
  score?: unknown;
  snippet?: unknown;
  docid?: unknown;
}

/**
 * Parse an MCP JSON-RPC response body. qmd's Streamable-HTTP may return either
 * a bare JSON object or an SSE `data: {…}` frame; handle both. Throws on a
 * JSON-RPC error or an unparseable body.
 */
function parseJsonRpc(text: string): { result?: unknown; error?: { message?: string } } {
  const trimmed = text.trim();
  let payload = trimmed;
  if (payload.startsWith('event:') || payload.startsWith('data:')) {
    const dataLine = payload.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) throw new Error('mcp: no data frame in SSE response');
    payload = dataLine.slice('data:'.length).trim();
  }
  const parsed = JSON.parse(payload) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) {
    throw new Error(`mcp: JSON-RPC error: ${parsed.error.message ?? 'unknown'}`);
  }
  return parsed;
}

/**
 * Run a warm search against the qmd MCP daemon at `baseUrl`.
 *
 * Sends `initialize` (capturing the `mcp-session-id` header), then
 * `tools/call name=query` with the mapped `searches`/`rerank`, `collection`,
 * `limit`, `minScore`, and an `intent` (the term — qmd recommends always
 * sending one). Returns the parsed rows. Throws on any HTTP/JSON-RPC failure so
 * the caller can fall back to the cold CLI.
 *
 * @param baseUrl  The daemon base URL (`http://host:port`).
 * @param args     Search arguments.
 * @param fetchFn  Injected fetch.
 */
export async function mcpSearch(baseUrl: string, args: McpSearchArgs, fetchFn: FetchFn): Promise<QmdRow[]> {
  // 1. initialize — establish a session and capture the session-id header.
  const initRes = await fetchFn(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS_BASE,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'diffwiki', version: '1' },
      },
    }),
  });
  if (!initRes.ok) {
    throw new Error(`mcp: initialize failed with HTTP ${initRes.status}`);
  }
  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('mcp: initialize returned no mcp-session-id header');
  }
  // Drain the body so the connection can be reused / closed cleanly.
  await initRes.text();

  // 2. tools/call name=query — reuse the session id in a request header.
  const { searches, rerank } = searchesForType(args.type, args.term);
  const queryArgs: Record<string, unknown> = {
    searches,
    intent: args.term,
    limit: args.limit,
    minScore: args.minScore ?? 0,
    rerank,
  };
  if (args.collection && args.collection.length > 0) {
    // qmd's `query` tool filters via `collections` (a plural array). A singular
    // `collection` key is silently ignored, so results leak from every
    // collection — the filter must be sent as a one-element array.
    queryArgs.collections = [args.collection];
  }

  const callRes = await fetchFn(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS_BASE, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'query', arguments: queryArgs },
    }),
  });
  if (!callRes.ok) {
    throw new Error(`mcp: tools/call failed with HTTP ${callRes.status}`);
  }
  const parsed = parseJsonRpc(await callRes.text());
  const result = parsed.result as { structuredContent?: { results?: unknown } } | undefined;
  const rawRows = result?.structuredContent?.results;
  if (!Array.isArray(rawRows)) {
    return [];
  }

  return rawRows.map((raw): QmdRow => {
    const row = raw as McpResultRow;
    return {
      file: typeof row.file === 'string' ? row.file : undefined,
      title: typeof row.title === 'string' ? row.title : undefined,
      score: typeof row.score === 'number' ? row.score : undefined,
      bestChunk: typeof row.snippet === 'string' ? row.snippet : undefined,
      docid: typeof row.docid === 'string' ? row.docid : undefined,
    };
  });
}
