import fs from 'node:fs/promises';
import { configPath, resolveHome } from './paths';
import { findCollection } from './collections';
import { CollectionNotFoundError } from './errors';
import { listEnabledPlugins } from './plugins/registry';
import { NATIVE_ENGINE } from './types';
import type { Config } from './types';

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await fs.readFile(configPath(), 'utf8')) as Config;
  } catch (err) {
    if (isMissing(err)) return {};
    throw err;
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await fs.mkdir(resolveHome(), { recursive: true });
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  // Fail fast: a defaultCollection must point at a registered collection, otherwise the
  // mistake only surfaces later at `add` time (or via `doctor`).
  if (key === 'defaultCollection' && !(await findCollection(value))) {
    throw new CollectionNotFoundError(value);
  }
  // defaultSearch is stored unconditionally (a user may set the default before installing
  // the plugin, and `native` is always a safe runtime fallback), but we warn when it names
  // an engine that is neither `native` nor a currently-enabled plugin.
  if (key === 'defaultSearch') {
    const engine = value.split(':')[0];
    if (engine !== NATIVE_ENGINE) {
      const enabled = await listEnabledPlugins('search');
      if (!enabled.some((p) => p.name === engine)) {
        console.warn(
          `! defaultSearch "${value}" names an engine that is not installed/enabled — native will be used until it is`,
        );
      }
    }
  }
  const config = (await readConfig()) as Record<string, unknown>;
  config[key] = value;
  await writeConfig(config as Config);
}

export async function getConfigValue(key: string): Promise<string | undefined> {
  const config = (await readConfig()) as Record<string, unknown>;
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}
