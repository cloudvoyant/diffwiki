/**
 * Minimal MCP Streamable-HTTP client for the qmd warm daemon.
 *
 * Two round-trips: `initialize` (captures `mcp-session-id`) then
 * `tools/call name=query` with the mapped `searches`/`rerank` pair.
 * `fetch` is injected for testability.
 *
 * @module
 */

import type { FetchFn, McpSearchArgs, QmdRow } from './types.js';

// Re-export so existing imports from mcp.js continue to resolve.
export type { McpSearchArgs } from './types.js';

/** One entry of the `searches` array in a qmd `query` tool call. */
interface QmdSearchSpec {
  type: 'lex' | 'vec' | 'hyde';
  query: string;
}

/**
 * The `searches`/`rerank` pair a diffwiki `type` maps to.
 *
 * Semantic and hybrid include a `hyde` sub-query (hypothetical-document
 * expansion) to match qmd's cold `query`/`vsearch` pipeline. Providing explicit
 * `searches` makes qmd skip its internal `expandQuery()` step, and without the
 * hyde variant the reranker is fed a thin candidate set and floats loosely
 * related chunks to the top (e.g. a "context, context, context" heading for a
 * CLI query). Keyword stays pure BM25 (no expansion, no rerank), matching
 * `qmd search`.
 */
export function searchesForType(type: string, query: string): { searches: QmdSearchSpec[]; rerank: boolean } {
  switch (type) {
    case 'semantic':
      return {
        searches: [
          { type: 'vec', query },
          { type: 'hyde', query },
        ],
        rerank: false,
      };
    case 'hybrid':
      return {
        searches: [
          { type: 'lex', query },
          { type: 'vec', query },
          { type: 'hyde', query },
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
  line?: unknown;
}

/**
 * Parse an MCP JSON-RPC response. Handles both bare JSON and SSE `data:` frames.
 * Throws on JSON-RPC error or unparseable body.
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
 * Throws on HTTP/JSON-RPC failure so the caller can fall back to the cold CLI.
 *
 * @param baseUrl  Daemon base URL (`http://host:port`).
 * @param args     Search arguments.
 * @param fetchFn  Injected fetch.
 */
export async function mcpSearch(baseUrl: string, args: McpSearchArgs, fetchFn: FetchFn): Promise<QmdRow[]> {
  // 1. initialize — capture the session-id header.
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

  // 2. tools/call name=query
  // When the caller supplied expanded variants (an upstream LLM did the query
  // expansion), use those as the qmd `searches`; otherwise derive them from the
  // bare term. `rerank` still follows the search type.
  const derived = searchesForType(args.type, args.term);
  const searches = args.expansions && args.expansions.length > 0 ? args.expansions : derived.searches;
  const rerank = derived.rerank;
  const queryArgs: Record<string, unknown> = {
    searches,
    intent: args.term,
    limit: args.limit,
    minScore: args.minScore ?? 0,
    rerank,
  };
  if (args.collection && args.collection.length > 0) {
    // `collections` (plural array) — a singular `collection` key is silently ignored.
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
      line: typeof row.line === 'number' ? row.line : undefined,
    };
  });
}
