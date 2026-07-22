import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  clean: true,
  target: 'es2022',
  banner: { js: '#!/usr/bin/env node' },
});
