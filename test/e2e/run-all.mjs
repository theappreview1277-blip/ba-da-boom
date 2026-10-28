// Runs every test: the unit tests, then each end-to-end suite against the real
// app (the installed one when ELECTRON_EXE is set). Prints PASS/FAIL per check
// and writes the full report to test-results/ (results.txt and results.json).
// Exit code 0 only when every check in every suite passed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLeftovers, failedRun, suite, usingInstalledApp } from './lib.mjs';

const lines = [];
const origLog = console.log;
console.log = (...a) => {
  const s = a.join(' ');
  lines.push(s);
  origLog(s);
};

const started = new Date();
console.log(`Ba-da-boom full test run, ${started.toISOString()}`);
console.log(usingInstalledApp() ? `App under test: installed app at ${process.env.ELECTRON_EXE}` : 'App under test: development build');

const results = [];

// Unit tests (vitest), run as a child process so its output is captured too.
{
  const s = suite('Unit tests');
  console.log(`\n${s.name}`);
  const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=verbose'], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(/^\s*([✓×])\s+(.*?)(?:\s+\d+ms)?$/);
    if (m) s.check(m[2], m[1] === '✓');
  }
  const summary = out.match(/Tests\s+.*$/m)?.[0]?.trim();
  s.check('vitest exited cleanly', r.status === 0, summary ?? `exit ${r.status}`);
  if (r.status !== 0) lines.push(out);
  results.push(s);
}

const suites = [
  ['./electron.mjs', 'Desktop security and services'],
  ['./smoke.mjs', 'Playback, editing and export'],
  ['./electron-files.mjs', 'Projects, missing samples and recovery'],
  ['./generate.mjs', 'Pattern generators'],
  ['./song.mjs', 'Song mode'],
  ['./timing.mjs', 'Timing and reproducibility'],
];
for (const [file, name] of suites) {
  const s = suite(name);
  console.log(`\n${name}`);
  const t0 = Date.now();
  try {
    const { run } = await import(file);
    await run(s);
  } catch (e) {
    failedRun(s, e);
  }
  checkLeftovers(s);
  s.note('seconds', Math.round((Date.now() - t0) / 1000));
  results.push(s);
}

const total = results.reduce((n, s) => n + s.checks.length, 0);
const failed = results.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => `${s.name}: ${c.label}`));
console.log('\n==== Summary ====');
for (const s of results) console.log(`${s.passed ? 'PASS' : 'FAIL'}  ${s.name}  (${s.checks.filter((c) => c.ok).length}/${s.checks.length} checks)`);
console.log(failed.length ? `\n${failed.length} of ${total} checks FAILED:\n  ${failed.join('\n  ')}` : `\nALL ${total} CHECKS PASSED`);

const dir = 'test-results';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'results.txt'), lines.join('\n') + '\n');
writeFileSync(
  join(dir, 'results.json'),
  JSON.stringify({ started, finished: new Date(), installedApp: process.env.ELECTRON_EXE ?? null, suites: results.map(({ name, checks, info }) => ({ name, checks, info })) }, null, 2),
);
process.exit(failed.length ? 1 : 0);
