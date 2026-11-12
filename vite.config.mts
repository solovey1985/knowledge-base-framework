import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

const root = path.resolve(import.meta.dirname, 'client');
const outputDir = path.resolve(import.meta.dirname, 'templates', 'default', 'assets');

export default defineConfig({
  root,
  plugins: [tailwindcss()],
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        app: path.resolve(root, 'main.ts'),
        ...Object.fromEntries(['work-manager', 'interview-prep', 'tech-memory', 'three-d-viewer']
          .map(name => [`icons-${name}`, path.resolve(root, `plugins/${name}/icons.css`)])),
        'work-manager': path.resolve(root, 'plugins/work-manager/index.tsx'),
        'three-d-viewer': path.resolve(root, 'plugins/three-d-viewer/index.tsx'),
        'interview-prep': path.resolve(root, 'plugins/interview-prep/index.tsx'),
        'tech-memory': path.resolve(root, 'plugins/tech-memory/index.tsx'),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'app' ? 'kb-app.js' : 'kb-plugin-[name].js',
        chunkFileNames: 'kb-[name]-chunk.js',
        assetFileNames: (assetInfo: { name?: string }) => {
          if (assetInfo.name?.endsWith('.css')) {
            return assetInfo.name === 'app.css' || assetInfo.name === 'main.css'
              ? 'kb-app.css' : 'kb-[name][extname]';
          }
          return 'kb-[name][extname]';
        }
      }
    }
  }
});
