import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: { rollupOptions: { input: 'index.html' } },
});
