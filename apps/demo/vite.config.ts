import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Assets libres du dépôt (assets/SOURCES.md), servis à la racine : /textures, /hdri, /fonts.
  publicDir: source('../../assets'),
  resolve: {
    // La démo lit `sim-core`, `render`, `input`, `fighters` et les autres modules dans leurs sources, par
    // leurs points d'entrée publics : une valeur modifiée est visible au rechargement, sans recompiler.
    alias: [
      {
        find: /^@game\/sim-core\/testing$/,
        replacement: source('../../packages/sim-core/src/testing/fixtures.ts'),
      },
      { find: /^@game\/sim-core$/, replacement: source('../../packages/sim-core/src/index.ts') },
      { find: /^@game\/render$/, replacement: source('../../packages/render/src/index.ts') },
      { find: /^@game\/input$/, replacement: source('../../packages/input/src/index.ts') },
      {
        find: /^@game\/accounts-client$/,
        replacement: source('../../packages/accounts-client/src/index.ts'),
      },
      {
        find: /^@game\/accounts\/protocol$/,
        replacement: source('../../packages/accounts/src/protocol.ts'),
      },
      {
        find: /^@game\/ranking\/client$/,
        replacement: source('../../packages/ranking/src/client.ts'),
      },
      {
        find: /^@game\/match-rules$/,
        replacement: source('../../packages/match-rules/src/index.ts'),
      },
      {
        find: /^@game\/stages-items$/,
        replacement: source('../../packages/stages-items/src/index.ts'),
      },
      { find: /^@game\/fighters$/, replacement: source('../../packages/fighters/src/index.ts') },
    ],
  },
  server: {
    proxy: {
      // Le serveur des comptes (`pnpm --filter @game/accounts dev`) répond sous la même origine que
      // la démo, comme le fera le proxy inverse en production : le cookie de session reste sur un
      // seul site. L'en-tête Host est conservé, ce qui permet au serveur de reconnaître l'origine.
      '/api/accounts': { target: process.env.ACCOUNTS_URL ?? 'http://127.0.0.1:8787' },
      // Le classement est servi par le même processus (`pnpm --filter @game/ranking dev`).
      '/api/ranking': { target: process.env.ACCOUNTS_URL ?? 'http://127.0.0.1:8787' },
    },
  },
});
