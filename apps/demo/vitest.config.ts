import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Le test du panneau Compte démarre un vrai serveur des comptes, lu dans ses sources.
    alias: [
      { find: /^@game\/accounts$/, replacement: source('../../packages/accounts/src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // La mesure de performance a sa propre commande : `pnpm --filter @game/demo perf`.
    exclude: ['test/perf.test.ts'],
  },
});
