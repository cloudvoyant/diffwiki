import { createServerFn } from '@tanstack/react-start';
import { buildLinkGraph } from 'diffwiki-core';

export const getLinkGraph = createServerFn({ method: 'GET' }).handler(() => buildLinkGraph());
