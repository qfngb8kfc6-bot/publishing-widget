import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/embed.ts',
      name: 'PublisherContentDiscoveryWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
});
