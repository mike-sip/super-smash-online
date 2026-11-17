import { defineConfig } from 'vitest/config';
import { aliases } from './aliases.ts';

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // Un seul navigateur et des serveurs à la fois.
    fileParallelism: false,
  },
});
