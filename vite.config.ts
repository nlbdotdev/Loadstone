import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { bundleNotices } from './scripts/bundle-notices.mjs';
export default defineConfig({
  plugins: [svelte(), bundleNotices()],
  base: './',
});
