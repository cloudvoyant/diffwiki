import { NATIVE_ENGINE } from '../types';
import type { SearchMode, SearchProvider } from '../types';
import { findEnabledPlugin, listEnabledPlugins } from './registry';
import { spawnPluginClient } from './client';

export async function loadSearchProvider(name?: string): Promise<SearchProvider | null> {
  const record = await findEnabledPlugin('search', name);
  if (!record) return null;
  try {
    return await spawnPluginClient(record);
  } catch {
    return null;
  }
}

export async function listSearchModes(): Promise<SearchMode[]> {
  const modes: SearchMode[] = [{ plugin: NATIVE_ENGINE, type: 'basic', label: 'native · bm25' }];
  const plugins = await listEnabledPlugins('search');
  for (const record of plugins) {
    let provider: SearchProvider | null = null;
    try {
      provider = await spawnPluginClient(record);
      for (const type of provider.capabilities.searchTypes) {
        modes.push({ plugin: record.name, type, label: `${record.name} · ${type}` });
      }
    } catch {
      // a plugin that fails to spawn/handshake simply contributes no modes
    } finally {
      if (provider) {
        try {
          await provider.close();
        } catch {
          // ignore close failures
        }
      }
    }
  }
  return modes;
}
