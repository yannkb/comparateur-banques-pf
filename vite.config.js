import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import cbpfData from './scripts/vite-data-plugin.mjs';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  // Données découpées par catalogue (chargées à la demande) : voir scripts/vite-data-plugin.mjs.
  plugins: [react(), cbpfData(fileURLToPath(new URL('./data/banks.json', import.meta.url)))],
  build: {
    rollupOptions: {
      output: {
        // React et ReactDOM dans leur propre fichier (mis en cache indépendamment du code et des données).
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
  server: { port: 5173 },
});
