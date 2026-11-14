import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // La démo lit `sim-core`, `render`, `input` et `fighters` dans leurs sources, par leurs points d'entrée
    // publics : une valeur de gameplay modifiée est visible au rechargement, sans recompiler.
    alias: [
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../../packages/sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../../packages/sim-core/src/index.ts') },
      { find: /^@game\/render$/, replacement: source('../../packages/render/src/index.ts') },
      { find: /^@game\/input$/, replacement: source('../../packages/input/src/index.ts') },
      { find: /^@game\/fighters$/, replacement: source('../../packages/fighters/src/index.ts') },
    ],
  },
});
