// Real update test, Windows only, run after scripts\windows-test.cmd has
// installed the app. Builds the same app as the next version, serves it from
// this PC like a release, and lets the installed app find it, download it,
// restart and install it through its own UI. Then puts the current version back.
//
//   node test\e2e\update-real.mjs
//
// Writes test-results\update-real.txt. Exit code 0 only when every check passed.
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { launchApp, newProfile, suite } from './lib.mjs';

const exe = process.env.ELECTRON_EXE || join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ba-da-boom', 'Ba-da-boom.exe');
process.env.ELECTRON_EXE = exe;
const t = suite('Real update');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const installedVersion = () => {
  try {
    return ps(`(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`);
  } catch {
    return '';
  }
};
/** Ba-da-boom processes not started by this test (none of our test profiles on the command line). */
const otherApps = () =>
  ps(`Get-CimInstance Win32_Process -Filter "Name='Ba-da-boom.exe'" | Where-Object { $_.CommandLine -notlike '*bdb-test-*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`)
    .split(/\s+/)
    .filter(Boolean);

async function main() {
  if (process.platform !== 'win32' || !existsSync(exe)) throw new Error(`Needs Windows and the installed app at ${exe}`);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const current = pkg.version;
  const [a, b, c] = current.split('.').map(Number);
  const next = `${a}.${b}.${c + 1}`;
  const original = readdirSync('release').find((f) => f === `Ba-da-boom-Setup-${current}-x64-unsigned.exe`);
  if (!original) throw new Error(`release\\Ba-da-boom-Setup-${current}-x64-unsigned.exe not found; run scripts\\windows-test.cmd first`);
  t.check(`the installed app is version ${current}`, installedVersion() === current, installedVersion());

  // 1. The "new release": the same build, numbered as the next version.
  const out = 'release-update';
  rmSync(out, { recursive: true, force: true });
  console.log(`Building version ${next} (a few minutes)...`);
  const build = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', `-c.extraMetadata.version=${next}`, `-c.directories.output=${out}`], { shell: true, encoding: 'utf8' });
  t.check(`a ${next} installer and latest.yml were built`, build.status === 0 && existsSync(join(out, 'latest.yml')), build.status === 0 ? 'ok' : (build.stdout + build.stderr).slice(-400));

  // 2. Served from this PC, like GitHub serves a release.
  const server = createServer((req, res) => {
    const f = join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''));
    if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-length': statSync(f).size });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  try {
    // 3. The installed app finds it, downloads it and restarts into it.
    const { app, win } = await launchApp(newProfile(), [], { BDB_UPDATE_URL: url, BDB_UPDATE_DELAY: '1000' });
    let exited = false;
    app.process().once('exit', () => (exited = true));
    const note = (await win.waitForSelector('.update-banner[data-state="available"]', { timeout: 30000 }).then((e) => e.textContent(), () => '')) ?? '';
    t.check(`the app finds version ${next}`, note.includes(`${next} is out`), note || 'no note');
    await win.click('.update-banner button:has-text("Download")');
    const ready = await win.waitForSelector('.update-banner[data-state="ready"]', { timeout: 300000 }).then(() => true, () => false);
    t.check('it downloads the update', ready, ready ? 'ok' : (await win.textContent('body').catch(() => '')).slice(-200));
    await win.click('.update-banner button:has-text("Restart now")').catch(() => {});
    for (let i = 0; i < 50 && !exited; i++) await sleep(200);
    t.check('"Restart now" closes the app', exited);
    let version = '';
    for (let i = 0; i < 90 && (version = installedVersion()) !== next; i++) await sleep(2000);
    t.check(`the installer puts version ${next} in`, version === next, version);
    let restarted = [];
    for (let i = 0; i < 30 && !(restarted = otherApps()).length; i++) await sleep(1000);
    t.check('the updated app starts again by itself', restarted.length > 0);
    // Close it like a user would, so it shuts down normally.
    spawnSync('taskkill', ['/IM', 'Ba-da-boom.exe'], { stdio: 'ignore' });
    for (let i = 0; i < 20 && otherApps().length; i++) await sleep(500);
    if (otherApps().length) spawnSync('taskkill', ['/IM', 'Ba-da-boom.exe', '/T', '/F'], { stdio: 'ignore' });

    // 4. The new version runs and reports its number.
    const second = await launchApp(newProfile(), [], { BDB_UPDATE_URL: url, BDB_UPDATE_DELAY: '600000' });
    const info = await second.win.evaluate(() => window.bdb.appInfo());
    t.check(`the app now says it is version ${next}`, info.version === next, info.version);
    await second.app.close();
  } finally {
    server.close();
    // 5. Back to the real current version.
    await sleep(2000);
    spawnSync(join('release', original), ['/S'], { stdio: 'ignore' });
    for (let i = 0; i < 60 && installedVersion() !== current; i++) await sleep(1000);
    t.check(`version ${current} is put back afterwards`, installedVersion() === current, installedVersion());
    rmSync(out, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (e) {
  t.check('the test ran to the end', false, String(e?.stack ?? e));
}
mkdirSync('test-results', { recursive: true });
const failed = t.checks.filter((c) => !c.ok);
const report = t.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  (${c.detail})` : ''}`).join('\n');
writeFileSync(join('test-results', 'update-real.txt'), `${report}\n\n${failed.length ? `${failed.length} FAILED` : 'ALL PASSED'}\n`);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASSED');
process.exit(failed.length ? 1 : 0);
