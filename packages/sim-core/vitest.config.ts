import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/testing/**'],
      // Critère de la spec : 90 % des lignes de src/, hors données de test.
      thresholds: { lines: 90 },
    },
  },
});
