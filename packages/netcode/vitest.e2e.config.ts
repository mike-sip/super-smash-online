import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Les tests lisent `sim-core` dans ses sources, par ses deux points d'entrée publics :
    // pas besoin de le recompiler après chaque modification.
    alias: [
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../sim-core/src/index.ts') },
    ],
  },
  test: {
    include: ['test/e2e/**/*.test.ts'],
  },
});
