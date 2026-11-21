import { defineConfig } from 'vitest/config';
import { aliases } from './aliases.ts';

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['test/**/*.test.ts'],
    // Parcours dans Edge et mesure de performance : `test:e2e` et `perf`.
    exclude: ['test/e2e/**', 'test/perf/**'],
  },
});
