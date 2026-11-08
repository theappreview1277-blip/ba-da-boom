import { buildSync } from 'esbuild';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { noticesPlugin } from './scripts/notices-plugin';
import { superdoughPatchPlugin } from './scripts/superdough-patch-plugin';

// Packages bundled into the Electron main process (such as electron-updater), so
// their licences are listed in NOTICES.txt alongside the renderer's.
function mainPackages(): string[] {
  const { metafile } = buildSync({ entryPoints: ['src/main/main.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false, metafile: true, logLevel: 'silent' });
  const roots = new Set<string>();
  for (const input of Object.keys(metafile!.inputs)) {
    const m = input.replace(/\\/g, '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m) roots.add(m[1]);
  }
  return [...roots];
}

// Renderer build. The factory samples and legal notices are served from the
// app bundle (bdb://app/samples/...), so `resources` is the public dir.
export default defineConfig({
  plugins: [superdoughPatchPlugin(), react(), noticesPlugin(mainPackages())],
  base: './',
  root: '.',
  publicDir: 'resources',
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', sourcemap: true },
  server: { port: 5173, strictPort: true },
});
