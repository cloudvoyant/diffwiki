import { createServerFn } from '@tanstack/react-start';
import { buildCollections, buildNavTree, showSystemEnabled } from 'diffwiki-core';

export const getCollections = createServerFn({ method: 'GET' }).handler(async () =>
  buildCollections({ showSystem: await showSystemEnabled() }),
);
export const getNavTree = createServerFn({ method: 'GET' }).handler(async () =>
  buildNavTree({ showSystem: await showSystemEnabled() }),
);
