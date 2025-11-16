import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.', // Keep root at project root
  publicDir: 'public',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        'ai-viewing-overlay': resolve(__dirname, 'src/overlay/ai-viewing-indicator.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Allow serving files from anywhere in the project
    fs: {
      strict: false,
      allow: ['.']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@overlay': resolve(__dirname, 'src/overlay'),
    },
  },
});
