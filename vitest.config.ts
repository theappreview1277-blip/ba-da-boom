import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // @kabelsalat/web's "main" is a CommonJS build that Node cannot import named exports from.
    alias: { '@kabelsalat/web': fileURLToPath(new URL('./node_modules/@kabelsalat/web/dist/index.mjs', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'], server: { deps: { inline: [/@strudel/, /superdough/, /@kabelsalat/] } } },
});
