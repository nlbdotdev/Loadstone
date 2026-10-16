import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { bundleNotices } from '../scripts/bundle-notices.mjs';
import { writeHandbook } from '../scripts/handbook.mjs';
import { pages } from './catalog.mjs';
import path from 'node:path';
const sources = new Set(
  pages.map((page) => path.resolve(import.meta.dirname, '..', page.file)),
);
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [
    svelte(),
    bundleNotices(),
    {
      name: 'handbook-source-refresh',
      configureServer(server) {
        server.watcher.add([...sources]);
        server.watcher.on('change', (file) => {
          if (sources.has(path.resolve(file))) {
            try {
              writeHandbook();
              server.ws.send({ type: 'full-reload' });
            } catch (error) {
              server.config.logger.error(String(error));
            }
          }
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
