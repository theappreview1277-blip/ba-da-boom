import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { noticesPlugin } from './scripts/notices-plugin';

// Renderer build. The factory samples and legal notices are served from the
// app bundle (bdb://app/samples/...), so `resources` is the public dir.
export default defineConfig({
  plugins: [react(), noticesPlugin()],
  base: './',
  root: '.',
  publicDir: 'resources',
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', sourcemap: true },
  server: { port: 5173, strictPort: true },
});
