// Writes build/icon.svg and a 512 px build/icon.png (the app and installer icon)
// from the logo in src/ui/Logo.tsx. Uses the Chromium that Playwright drives.
import { rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/ui/Logo.tsx'], bundle: true, format: 'esm', write: false, platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
// Load the bundle from a file inside the project, so it can find react.
const tmp = 'build/.logo.mjs';
writeFileSync(tmp, out.outputFiles[0].text);
const mod = await import(`../${tmp}`);
rmSync(tmp);
const svg = mod.logoSvg();
writeFileSync('build/icon.svg', svg);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', 'width="512" height="512"')}</body></html>`);
await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
console.log('build/icon.svg and build/icon.png (512 px) written');
