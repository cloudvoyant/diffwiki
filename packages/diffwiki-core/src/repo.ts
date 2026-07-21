import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { findCollection } from './collections';
import { registerCollection } from './registry';
import type { CollectionEntry, RepoConfig } from './types';

const execFileAsync = promisify(execFile);

export const REPO_CONFIG_FILE = 'diffwiki.yaml';

async function detectRepoName(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    return path.basename(stdout.trim());
  } catch {
    return path.basename(path.resolve(cwd));
  }
}

export async function readRepoConfig(cwd: string): Promise<RepoConfig | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, REPO_CONFIG_FILE), 'utf8');
    const parsed = (parseYaml(raw) ?? {}) as Partial<RepoConfig>;
    if (!parsed.path) return undefined;
    return {
      collection: parsed.collection ?? path.basename(path.resolve(cwd)),
      path: parsed.path,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export interface InitOptions {
  cwd: string;
  collection?: string;
  wikiPath?: string;
}

export async function initRepoWiki(opts: InitOptions): Promise<CollectionEntry> {
  const cwd = path.resolve(opts.cwd);
  const wikiPath = opts.wikiPath ?? 'wiki';
  const absWiki = path.join(cwd, wikiPath);

  let name = opts.collection ?? (await detectRepoName(cwd));
  const existing = await findCollection(name);
  if (existing && existing.path !== absWiki) {
    let n = 2;
    for (;;) {
      const candidate = `${name}-${n}`;
      const clash = await findCollection(candidate);
      if (!clash || clash.path === absWiki) {
        name = candidate;
        break;
      }
      n += 1;
    }
  }

  await fs.mkdir(absWiki, { recursive: true });
  const config: RepoConfig = { collection: name, path: wikiPath };
  await fs.writeFile(path.join(cwd, REPO_CONFIG_FILE), stringifyYaml(config), 'utf8');

  const entry: CollectionEntry = {
    name,
    type: 'repo',
    path: absWiki,
    createdAt: new Date().toISOString(),
  };
  await registerCollection(entry);
  return entry;
}
