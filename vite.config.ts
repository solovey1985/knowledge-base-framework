import { defineConfig } from 'vite';
import path from 'path';

const root = path.resolve(__dirname, 'client');
const outputDir = path.resolve(__dirname, 'templates', 'default', 'assets');

export default defineConfig({
  root,
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(root, 'main.ts'),
      output: {
        entryFileNames: 'kb-app.js',
        chunkFileNames: 'kb-[name]-chunk.js',
        assetFileNames: (assetInfo: { name?: string }) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'kb-app.css';
          }
          return 'kb-[name][extname]';
        }
      }
    }
  }
});
