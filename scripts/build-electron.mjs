// Bundles the Electron main and preload scripts (CommonJS, Node target).
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'] };
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.js' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist-electron/preload.js' });
console.log('built dist-electron/');
