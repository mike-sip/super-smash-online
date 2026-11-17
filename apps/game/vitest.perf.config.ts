import { defineConfig } from 'vitest/config';
import { aliases } from './aliases.ts';

export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['test/perf/**/*.test.ts'], testTimeout: 180_000, hookTimeout: 120_000 },
});
