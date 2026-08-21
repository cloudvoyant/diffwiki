import fs from 'node:fs/promises';
import { collectionsDir, configPath, pluginsDir, registryPath, resolveHome, templatesDir } from './paths';

/** Write `contents()` to `file` only when the file does not yet exist. Atomic
 * (O_EXCL) so two concurrent first invocations can't both write the same file. */
async function seedIfAbsent(file: string, contents: () => string): Promise<void> {
  try {
    await fs.writeFile(file, contents(), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

/**
 * Initialize the global diffwiki home (`~/.diffwiki` or `DIFFWIKI_HOME`).
 * Creates the directory tree and seeds empty-but-valid registry/config when
 * absent. Idempotent — the CLI calls this at startup so the first command
 * leaves a fully initialized home behind.
 */
export async function ensureHome(): Promise<void> {
  await fs.mkdir(resolveHome(), { recursive: true });
  await Promise.all([
    fs.mkdir(collectionsDir(), { recursive: true }),
    fs.mkdir(pluginsDir(), { recursive: true }),
    fs.mkdir(templatesDir(), { recursive: true }),
  ]);
  await seedIfAbsent(registryPath(), () => `${JSON.stringify({ version: 1, collections: [] }, null, 2)}\n`);
  await seedIfAbsent(configPath(), () => '{}\n');
}
