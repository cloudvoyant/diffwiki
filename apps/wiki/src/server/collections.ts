import { createServerFn } from '@tanstack/react-start';
import { buildCollections, buildNavTree } from 'diffwiki-core';

export const getCollections = createServerFn({ method: 'GET' }).handler(() => buildCollections());
export const getNavTree = createServerFn({ method: 'GET' }).handler(() => buildNavTree());
