import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/server/production.ts', formats: ['es'], fileName: () => 'server.mjs' },
  },
});
