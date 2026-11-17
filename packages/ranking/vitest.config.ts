import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Les tests lisent les comptes et les règles de match dans leurs sources : pas de recompilation.
    alias: [
      { find: /^@game\/accounts\/protocol$/, replacement: source('../accounts/src/protocol.ts') },
      { find: /^@game\/accounts\/ticket$/, replacement: source('../accounts/src/ticket.ts') },
      { find: /^@game\/accounts$/, replacement: source('../accounts/src/index.ts') },
      { find: /^@game\/match-rules$/, replacement: source('../match-rules/src/index.ts') },
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../sim-core/src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
