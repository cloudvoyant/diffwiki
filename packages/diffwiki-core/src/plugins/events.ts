/**
 * Plugin lifecycle event emission.
 *
 * Fires a lifecycle event at the active search plugin -- best-effort and
 * non-blocking. diffwiki emits events on every content mutation (article
 * create/update/remove, collection add/remove). A plugin's `onEvent`
 * handler can self-manage in response (e.g. incremental reindex).
 *
 * Events are an optimisation, not the correctness path: the mtime-staleness
 * lazy reindex on `search` remains the guarantee, so a dropped event only
 * costs a later lazy rebuild, never wrong results.
 *
 * @module
 */

import { listCollections } from '../collections';
import { findEnabledPlugin } from './registry';
import { invokePlugin } from './host';
import type { PluginEvent } from '../types';

/**
 * Emit a lifecycle event to the active search plugin.
 *
 * This function is designed to be called fire-and-forget: `void emitPluginEvent(...)`.
 * It only invokes the plugin when the plugin has `capabilities.events === true`.
 * Every error is swallowed -- a slow or absent plugin can neither stall nor
 * fail a content mutation.
 */
export async function emitPluginEvent(event: PluginEvent, collection: string, relPath?: string): Promise<void> {
  try {
    const record = await findEnabledPlugin('search');
    if (!record) return;
    if (!record.capabilities?.events) return;

    const collections = await listCollections();
    const entry = collections.find((c) => c.name === collection);
    await invokePlugin(
      record.command,
      'event',
      {
        event,
        collection: entry ? { name: entry.name, path: entry.path } : { name: collection, path: '' },
        relPath,
        collections: collections.map((c) => ({ name: c.name, path: c.path })),
      },
      { name: record.name },
    );
  } catch {
    /* swallow -- events are an optimisation, never the correctness path */
  }
}
