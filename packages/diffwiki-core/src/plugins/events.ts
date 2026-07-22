import { loadSearchProvider } from './loader';
import { listCollections } from '../collections';
import type { PluginEvent } from '../types';

/**
 * Fire a lifecycle hook at the active search plugin -- best-effort and
 * non-blocking. Callers invoke this as `void emitPluginEvent(...)` and never
 * await it, so a slow or absent plugin can neither stall nor fail a content
 * mutation. Every error is swallowed; the lazy mtime-staleness reindex on
 * `search` remains the correctness guarantee, so a dropped hook only costs a
 * later lazy rebuild, never wrong results.
 */
export async function emitPluginEvent(event: PluginEvent, collection: string, relPath?: string): Promise<void> {
  try {
    const provider = await loadSearchProvider();
    try {
      if (provider?.capabilities.hooks) {
        await provider.notify(event, collection, relPath, await listCollections());
      }
    } finally {
      await provider?.close();
    }
  } catch {
    /* swallow -- hooks are an optimisation, never the correctness path */
  }
}
