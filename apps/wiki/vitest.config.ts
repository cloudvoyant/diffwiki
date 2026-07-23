// apps/wiki/vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  // React plugin so component tests (e.g. GitBadge) can render real .tsx.
  plugins: [react()],
  // Mirror tsconfig paths so imports like `@/components/ui/sidebar` resolve.
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      { find: /^#\//, replacement: `${src}/` },
    ],
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/e2e/**/*.test.ts'],
    // Default node; files that render React opt into jsdom via a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    passWithNoTests: true,
  },
});
