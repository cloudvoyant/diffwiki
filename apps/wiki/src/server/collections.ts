import { createServerFn } from '@tanstack/react-start';
import { listCollections, listArticleTree } from 'diffwiki-core';
import type { CollectionInfo, CollectionTree } from '../lib/types';
import { toTreeNodes } from '../lib/tree';

export const getCollections = createServerFn({ method: 'GET' }).handler(async (): Promise<CollectionInfo[]> => {
  const entries = await listCollections();
  return entries.map((e) => ({ name: e.name, type: e.type, path: e.path }));
});

export const getNavTree = createServerFn({ method: 'GET' }).handler(async (): Promise<CollectionTree[]> => {
  const entries = await listCollections();
  return Promise.all(
    entries.map(async (e): Promise<CollectionTree> => ({
      collection: { name: e.name, type: e.type, path: e.path },
      nodes: toTreeNodes(e.name, await listArticleTree(e.name)),
    })),
  );
});
