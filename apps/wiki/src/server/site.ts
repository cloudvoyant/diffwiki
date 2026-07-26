import { createServerFn } from '@tanstack/react-start';
import { buildSiteConfig } from 'diffwiki-core';

export const getSite = createServerFn({ method: 'GET' }).handler(() => buildSiteConfig());
