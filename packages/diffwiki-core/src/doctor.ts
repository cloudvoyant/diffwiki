import fs from 'node:fs/promises';
import { registryPath, resolveHome } from './paths';
import { readRegistry } from './registry';
import { readConfig } from './config';

export type DiagnosticLevel = 'ok' | 'warn' | 'error';

export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function doctor(): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const home = resolveHome();

  out.push(
    (await exists(home))
      ? { level: 'ok', message: `home directory present: ${home}` }
      : { level: 'warn', message: `home directory missing (created on first write): ${home}` },
  );

  out.push(
    (await exists(registryPath()))
      ? { level: 'ok', message: `registry present: ${registryPath()}` }
      : { level: 'warn', message: `registry missing: ${registryPath()}` },
  );

  const registry = await readRegistry();
  for (const c of registry.collections) {
    out.push(
      (await exists(c.path))
        ? { level: 'ok', message: `collection "${c.name}" → ${c.path}` }
        : { level: 'error', message: `collection "${c.name}" points to missing path: ${c.path}` },
    );
  }

  const config = await readConfig();
  if (config.defaultCollection) {
    const found = registry.collections.some((c) => c.name === config.defaultCollection);
    out.push(
      found
        ? { level: 'ok', message: `default collection: ${config.defaultCollection}` }
        : {
            level: 'error',
            message: `default collection "${config.defaultCollection}" is not registered`,
          },
    );
  } else {
    out.push({ level: 'warn', message: 'no default collection set' });
  }

  return out;
}
