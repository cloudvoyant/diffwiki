/**
 * diffwiki-qmd MCP-client unit tests.
 *
 * A fake `fetch` records the initialize + tools/call requests and returns a
 * canned qmd response — never a real daemon. Asserts the per-type
 * searches/rerank mapping, session-id capture/reuse, and result mapping.
 */
import { describe, expect, it } from 'vitest';
import { mcpSearch, searchesForType, type McpSearchArgs } from '../src/mcp.js';
import type { FetchFn } from '../src/daemon.js';

interface RecordedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body: unknown;
}

/**
 * A fake fetch: the first call (initialize) returns an `mcp-session-id` header;
 * the second call (tools/call) returns the canned structuredContent results.
 */
function fakeMcpFetch(results: unknown[]): { fetchFn: FetchFn; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchFn: FetchFn = async (url, init) => {
    requests.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    call += 1;
    if (call === 1) {
      // initialize response
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n.toLowerCase() === 'mcp-session-id' ? 'sess-123' : null) },
        text: async () => '{"jsonrpc":"2.0","id":1,"result":{}}',
        json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
      };
    }
    // tools/call response
    const payload = {
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'Found results' }], structuredContent: { results } },
    };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };
  return { fetchFn, requests };
}

describe('searchesForType', () => {
  it('keyword -> lex, no rerank', () => {
    expect(searchesForType('keyword', 'conan')).toEqual({ searches: [{ type: 'lex', query: 'conan' }], rerank: false });
  });
  it('semantic -> vec, no rerank', () => {
    expect(searchesForType('semantic', 'conan')).toEqual({
      searches: [{ type: 'vec', query: 'conan' }],
      rerank: false,
    });
  });
  it('hybrid -> lex + vec, rerank', () => {
    expect(searchesForType('hybrid', 'conan')).toEqual({
      searches: [
        { type: 'lex', query: 'conan' },
        { type: 'vec', query: 'conan' },
      ],
      rerank: true,
    });
  });
  it('unknown type defaults to keyword/lex', () => {
    expect(searchesForType('whatever', 'x')).toEqual({ searches: [{ type: 'lex', query: 'x' }], rerank: false });
  });
});

const CANNED_ROWS = [
  {
    docid: '#c7e969',
    file: 'knowledge-base/cpp/ci-conan-cache.md',
    title: 'Why this matters',
    score: 1,
    snippet: 'the conan snippet',
  },
];

describe('mcpSearch', () => {
  it('sends initialize then tools/call with the captured session id', async () => {
    const { fetchFn, requests } = fakeMcpFetch(CANNED_ROWS);
    const args: McpSearchArgs = { term: 'conan', type: 'keyword', limit: 20, minScore: 0 };
    await mcpSearch('http://127.0.0.1:8181', args, fetchFn);

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('http://127.0.0.1:8181/mcp');
    expect((requests[0].body as { method: string }).method).toBe('initialize');
    // no session header on initialize
    expect(requests[0].headers?.['mcp-session-id']).toBeUndefined();

    expect((requests[1].body as { method: string }).method).toBe('tools/call');
    expect(requests[1].headers?.['mcp-session-id']).toBe('sess-123');
    const callParams = (requests[1].body as { params: { name: string; arguments: Record<string, unknown> } }).params;
    expect(callParams.name).toBe('query');
    expect(callParams.arguments.searches).toEqual([{ type: 'lex', query: 'conan' }]);
    expect(callParams.arguments.rerank).toBe(false);
    expect(callParams.arguments.intent).toBe('conan');
    expect(callParams.arguments.limit).toBe(20);
  });

  it('maps hybrid to lex+vec+rerank and includes a collection filter', async () => {
    const { fetchFn, requests } = fakeMcpFetch(CANNED_ROWS);
    await mcpSearch(
      'http://127.0.0.1:8181',
      { term: 'physics', type: 'hybrid', collection: 'knowledge-base', limit: 5, minScore: 0 },
      fetchFn,
    );
    const callParams = (requests[1].body as { params: { arguments: Record<string, unknown> } }).params;
    expect(callParams.arguments.searches).toEqual([
      { type: 'lex', query: 'physics' },
      { type: 'vec', query: 'physics' },
    ]);
    expect(callParams.arguments.rerank).toBe(true);
    expect(callParams.arguments.collection).toBe('knowledge-base');
  });

  it('parses structuredContent.results into QmdRows (snippet -> bestChunk)', async () => {
    const { fetchFn } = fakeMcpFetch(CANNED_ROWS);
    const rows = await mcpSearch('http://127.0.0.1:8181', { term: 'conan', type: 'keyword', limit: 20 }, fetchFn);
    expect(rows).toEqual([
      {
        file: 'knowledge-base/cpp/ci-conan-cache.md',
        title: 'Why this matters',
        score: 1,
        bestChunk: 'the conan snippet',
        docid: '#c7e969',
      },
    ]);
  });

  it('throws when initialize returns no session-id header', async () => {
    const fetchFn: FetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{}',
      json: async () => ({}),
    });
    await expect(
      mcpSearch('http://127.0.0.1:8181', { term: 'x', type: 'keyword', limit: 20 }, fetchFn),
    ).rejects.toThrow(/mcp-session-id/);
  });

  it('throws when tools/call returns a JSON-RPC error', async () => {
    let call = 0;
    const fetchFn: FetchFn = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n.toLowerCase() === 'mcp-session-id' ? 's' : null) },
          text: async () => '{}',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{"jsonrpc":"2.0","id":2,"error":{"message":"bad query"}}',
        json: async () => ({ jsonrpc: '2.0', id: 2, error: { message: 'bad query' } }),
      };
    };
    await expect(
      mcpSearch('http://127.0.0.1:8181', { term: 'x', type: 'keyword', limit: 20 }, fetchFn),
    ).rejects.toThrow(/bad query/);
  });
});
