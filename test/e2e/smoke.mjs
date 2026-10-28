// Browser smoke test of the renderer (no Electron): loads the built app,
// plays, edits during playback, switches patterns, and exports a WAV.
// Usage: node test/e2e/smoke.mjs  (expects `npx vite preview --port 4173` running)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFileSync } from 'node:fs';

const url = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__engine && [...document.querySelectorAll('.sample')].length >= 16, null, { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.badge') || ![...document.querySelectorAll('.badge')].some((b) => b.textContent === '…'));
const status = await page.evaluate(() => {
  const e = window.__engine;
  return Object.fromEntries([...e['status'].entries()]);
});
console.log('sample status', status);

await page.screenshot({ path: 'test/e2e/out-initial.png' });
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
const playing = await page.evaluate(() => window.__engine.isPlaying);
console.log('playing', playing, 'cycle', await page.evaluate(() => window.__engine.audibleCycle()));
await page.screenshot({ path: 'test/e2e/out-playing.png' });

// Edit during playback: add a snare on step 3 (track 3)
await page.click('[data-cell="t3:2"]');
await page.waitForTimeout(500);
// Switch to pattern B (key 2) and check it becomes audible at a bar line
const before = await page.evaluate(() => window.__engine.audibleCycle());
await page.keyboard.press('2');
const queued = await page.evaluate(() => window.__engine.queued);
console.log('queued at', queued, 'from cycle', before);
await page.waitForTimeout(2600);
console.log('audible pattern after switch', await page.evaluate(() => window.__engine.audiblePatternId), 'cycle', await page.evaluate(() => window.__engine.audibleCycle()));
await page.keyboard.press('1');
await page.waitForTimeout(2200);
// Repeated transport actions
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(30 + Math.random() * 120);
}
await page.waitForTimeout(300);
console.log('after 10 toggles playing=', await page.evaluate(() => window.__engine.isPlaying));
if (await page.evaluate(() => window.__engine.isPlaying)) await page.keyboard.press('Space');

// Export
await page.keyboard.press('Control+e');
await page.click('.modal button.primary');
await page.waitForFunction(() => window.__lastExportInfo, null, { timeout: 30000 });
const info = await page.evaluate(() => window.__lastExportInfo);
console.log('export', info);
const bytes = await page.evaluate(() => Array.from(window.__lastExport));
writeFileSync('test/e2e/out-export.wav', Buffer.from(bytes));
console.log('errors/warnings:', errors.length ? errors.join('\n') : 'none');
await browser.close();
