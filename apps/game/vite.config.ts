import { defineConfig } from 'vite';
import { aliases } from './aliases.ts';
import { gameDevPlugin } from './dev-plugin.ts';

export default defineConfig({
  plugins: [gameDevPlugin()],
  resolve: { alias: aliases },
  build: {
    // Pas de carte des sources servie au public ; noms de fichiers à empreinte (défaut de Vite).
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
