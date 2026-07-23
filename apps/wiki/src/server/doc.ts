import { createServerFn } from '@tanstack/react-start';
import { resolvePage } from 'diffwiki-core';

export const readPage = createServerFn({ method: 'GET' })
  .validator((d: { coll: string; slug: string }) => d)
  .handler(({ data }) => resolvePage(data.coll, data.slug));
