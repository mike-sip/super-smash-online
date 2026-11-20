import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Les tests lisent les modules du jeu dans leurs sources : pas de recompilation.
    alias: [
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../sim-core/src/index.ts') },
      { find: /^@game\/fighters$/, replacement: source('../fighters/src/index.ts') },
      { find: /^@game\/match-rules$/, replacement: source('../match-rules/src/index.ts') },
      { find: /^@game\/stages-items$/, replacement: source('../stages-items/src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
