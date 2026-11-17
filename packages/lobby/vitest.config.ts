import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Les tests lisent les autres modules dans leurs sources, par leurs points d'entrée publics. */
export const aliases = [
  {
    find: /^@game\/sim-core\/testing$/,
    replacement: source('../sim-core/src/testing/fixtures.ts'),
  },
  { find: /^@game\/sim-core$/, replacement: source('../sim-core/src/index.ts') },
  { find: /^@game\/match-rules$/, replacement: source('../match-rules/src/index.ts') },
  { find: /^@game\/netcode\/server$/, replacement: source('../netcode/src/server/index.ts') },
  { find: /^@game\/netcode\/testing$/, replacement: source('../netcode/src/testing/network.ts') },
  { find: /^@game\/netcode$/, replacement: source('../netcode/src/index.ts') },
  { find: /^@game\/accounts\/ticket$/, replacement: source('../accounts/src/ticket.ts') },
  { find: /^@game\/accounts\/protocol$/, replacement: source('../accounts/src/protocol.ts') },
  { find: /^@game\/accounts-client$/, replacement: source('../accounts-client/src/index.ts') },
  { find: /^@game\/ranking\/protocol$/, replacement: source('../ranking/src/protocol.ts') },
  { find: /^@game\/ranking\/report$/, replacement: source('../ranking/src/report.ts') },
  { find: /^@game\/accounts$/, replacement: source('../accounts/src/index.ts') },
];

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['test/**/*.test.ts'],
    // Les vrais serveurs ont leur commande : `pnpm --filter @game/lobby test:e2e`.
    exclude: ['test/e2e/**'],
  },
});
