import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { relayPlugin } from './src/relay-plugin.ts';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [relayPlugin()],
  resolve: {
    // Comme apps/demo : les modules sont lus dans leurs sources, par leurs points d'entrée publics.
    alias: [
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../../packages/sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../../packages/sim-core/src/index.ts') },
      { find: /^@game\/render$/, replacement: source('../../packages/render/src/index.ts') },
      { find: /^@game\/input$/, replacement: source('../../packages/input/src/index.ts') },
      { find: /^@game\/netcode$/, replacement: source('../../packages/netcode/src/index.ts') },
    ],
  },
});
