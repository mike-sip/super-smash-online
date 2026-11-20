import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { aliases } from './aliases.ts';
import { gameDevPlugin } from './dev-plugin.ts';

export default defineConfig({
  plugins: [gameDevPlugin()],
  resolve: { alias: aliases },
  // Assets libres du dépôt (assets/SOURCES.md), servis à la racine : /textures, /hdri, /fonts.
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  build: {
    // Pas de carte des sources servie au public ; noms de fichiers à empreinte (défaut de Vite).
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
