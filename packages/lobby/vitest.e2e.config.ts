import { defineConfig } from 'vitest/config';
import { aliases } from './vitest.config.ts';

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
