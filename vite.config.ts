import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        hunt: resolve(__dirname, 'hunt/index.html'),
        ar: resolve(__dirname, 'ar/index.html'),
      },
    }
  },
  server: {
    host: true, // Listen on all addresses
  }
});
