import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // La mesure de performance a sa propre commande : `pnpm --filter @game/demo perf`.
    exclude: ['test/perf.test.ts'],
  },
});
