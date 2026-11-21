import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Les tests lisent le serveur des comptes dans ses sources : pas besoin de le recompiler.
    alias: [
      {
        find: /^@game\/accounts\/protocol$/,
        replacement: source('../accounts/src/protocol.ts'),
      },
      { find: /^@game\/accounts$/, replacement: source('../accounts/src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
