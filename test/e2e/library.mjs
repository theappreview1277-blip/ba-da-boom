// The sample browser's own folders and favourites, and the resizable panels,
// through the real UI: add a folder (subfolders, only WAVs), audition without
// changing the project, assign by double-click and by drag, a broken WAV, the
// filter, favourites, only files inside added folders can be read, drag and
// keyboard resizing, everything remembered after a restart, small windows,
// removing a folder and a folder that has gone missing.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

function wav(freq) {
  const n = 4410;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / 44100) * 20000 * (1 - i / n)), 44 + i * 2);
  return buf;
}

function makeFolder() {
  const base = newProfile();
  const root = join(base, 'My Samples');
  const put = (rel, data) => {
    const f = join(root, ...rel.split('/'));
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, data);
  };
  put('Kicks/Kick 01.wav', wav(60));
  put('Kicks/Kick 02.wav', wav(70));
  put('Snares/Snare A.wav', wav(220));
  put('Loose.wav', wav(440));
  put('Fake.wav', Buffer.from('this is not audio'));
  put('readme.txt', 'not a sample');
  put('.hidden/Secret.wav', wav(500));
  writeFileSync(join(base, 'outside.wav'), wav(330));
  return { base, root };
}

export async function run(t) {
  const { base, root } = makeFolder();
  const profile = newProfile();
  let { app, win, pageErrors } = await launchApp(profile);
  try {
    const project = () => win.evaluate(() => window.__engine['project']);
    const group = (title) => win.locator('.browser-group', { has: win.locator(`h4:text-is("${title}")`) });
    const folderGroup = () => win.locator(`.browser-group.folder[data-folder="${root.replace(/\\/g, '\\\\')}"]`);
    const toast = () => win.textContent('.toast').catch(() => '');

    // --- Folders ---
    await stubDialogs(app, { openPath: root });
    await win.click('button:has-text("Add folder…")');
    await folderGroup().waitFor({ timeout: 10000 }).catch(() => {});
    const names = await folderGroup().locator('li .name').allTextContents();
    t.check('Add folder lists the sound files in it and its subfolders', JSON.stringify(names) === JSON.stringify(['Fake', 'Kicks/Kick 01', 'Kicks/Kick 02', 'Loose', 'Snares/Snare A']), names.join(', '));
    t.check('the folder group is named after the folder', (await folderGroup().locator('h4').textContent()) === 'My Samples');
    t.check('the message says how many files were found', /My Samples: 5 sound files/.test(await toast()), await toast());

    const before = await project();
    await folderGroup().locator('li:has-text("Kicks/Kick 01")').click();
    await win.waitForFunction(() => window.__lastPreview, null, { timeout: 10000 }).catch(() => {});
    const preview = await win.evaluate(() => window.__lastPreview);
    const previewOk = await win.evaluate((id) => window.__engine.sampleStatus(id) === 'ok', preview?.id);
    const after = await project();
    t.check('clicking a folder file plays it without changing the project', previewOk && JSON.stringify(after) === JSON.stringify(before) && !(await win.textContent('.statusbar')).includes('unsaved'), preview?.name);

    await folderGroup().locator('li:has-text("Kicks/Kick 01")').dblclick();
    await win.waitForFunction((n) => Object.keys(window.__engine['project'].samples).length > n, Object.keys(before.samples).length, { timeout: 10000 }).catch(() => {});
    let p = await project();
    let ref = p.samples[p.tracks[0].sound.sampleId];
    t.check('double-click puts it on the selected track', ref?.name === 'Kick 01' && ref.source === 'user' && ref.originalName === 'Kick 01.wav', ref && `${ref.name} (${ref.originalName})`);
    t.check('the track takes the sample name, as with other samples', p.tracks[0].name === 'Kick 01', p.tracks[0].name);
    await win.keyboard.press('Control+z');
    p = await project();
    t.check('one undo takes it off again', p.tracks[0].sound.sampleId === 'factory:kick' && p.tracks[0].name === 'Kick' && !p.samples[ref.id]);

    await folderGroup().locator('li:has-text("Snares/Snare A")').dragTo(win.locator('.row[role=row] >> nth=2'));
    await win.waitForFunction(() => window.__engine['project'].tracks[2].sound.sampleId.startsWith('user:'), null, { timeout: 10000 }).catch(() => {});
    p = await project();
    t.check('dragging a folder file onto a track assigns it', p.samples[p.tracks[2].sound.sampleId]?.name === 'Snare A');
    await win.waitForFunction((id) => window.__engine.sampleStatus(id) === 'ok', p.tracks[2].sound.sampleId, { timeout: 10000 }).catch(() => {});
    t.check('the assigned folder sample loads in the engine', await win.evaluate((id) => window.__engine.sampleStatus(id) === 'ok', p.tracks[2].sound.sampleId));

    const snap = JSON.stringify(await project());
    await folderGroup().locator('li:has-text("Fake")').dblclick();
    await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Fake.wav'), null, { timeout: 10000 }).catch(() => {});
    t.check('a file that is not really a WAV is refused with a message', /Could not use Fake\.wav: Fake\.wav is not a WAV file/.test(await toast()) && JSON.stringify(await project()) === snap, await toast());

    await win.fill('input[aria-label="Filter samples"]', 'snare');
    const filtered = await folderGroup().locator('li .name').allTextContents();
    t.check('the filter searches folder files too', JSON.stringify(filtered) === JSON.stringify(['Snares/Snare A']), filtered.join(', '));
    await win.fill('input[aria-label="Filter samples"]', '');

    // Only files inside an added folder can be read.
    const refused = await win.evaluate(async ([root, base]) => {
      const tryRead = (f, file) => window.bdb.folderRead(f, file).then(() => 'read', () => 'refused');
      return [await tryRead(root, '../outside.wav'), await tryRead(root, 'Kicks/../../outside.wav'), await tryRead(base, 'outside.wav'), await tryRead(root, 'readme.txt')];
    }, [root, base]);
    t.check('files outside the added folders cannot be read', refused.every((r) => r === 'refused'), refused.join(', '));
    const together = await win.evaluate(async (root) => {
      const r = await Promise.allSettled(Array.from({ length: 4 }, () => window.bdb.folderRead(root, 'Kicks/Kick 02.wav')));
      return r.map((x) => (x.status === 'fulfilled' ? x.value.file : `failed: ${x.reason}`));
    }, root);
    t.check('the same file read several times at once (click + double-click) all succeed', together.every((f) => f === together[0] && !f.startsWith('failed')), together[0]);

    // --- Favourites ---
    const beforeFav = JSON.stringify(await project());
    await folderGroup().locator('li:has-text("Loose")').hover();
    await folderGroup().locator('li:has-text("Loose") .star').click();
    await group('Factory kit').locator('li:has-text("Clap")').hover();
    await group('Factory kit').locator('li:has-text("Clap") .star').click();
    let favs = await group('Favourites').locator('li .name').allTextContents().catch(() => []);
    t.check('starred samples appear under Favourites', JSON.stringify(favs) === JSON.stringify(['Clap', 'Loose']), favs.join(', '));
    t.check('starring does not change the project', JSON.stringify(await project()) === beforeFav);
    await group('Favourites').locator('li:has-text("Loose")').dblclick();
    await win.waitForFunction(() => window.__engine['project'].samples[window.__engine['project'].tracks[0].sound.sampleId]?.name === 'Loose', null, { timeout: 10000 }).catch(() => {});
    p = await project();
    t.check('a favourite can be assigned straight from Favourites (to the selected track)', p.samples[p.tracks[0].sound.sampleId]?.name === 'Loose', p.samples[p.tracks[0].sound.sampleId]?.name);

    await group('Factory kit').locator('h4').click();
    t.check('clicking a group title folds it away', (await group('Factory kit').locator('li').count()) === 0);
    await group('Factory kit').locator('h4').click();
    t.check('and clicking again opens it', (await group('Factory kit').locator('li').count()) === 16);

    // --- Resizing (in a 1600 px wide window: room for 840 px of panels next to the grid) ---
    const width = (sel) => win.evaluate((s) => document.querySelector(s).getBoundingClientRect().width, sel);
    const size = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
      await win.waitForFunction((w) => innerWidth === w, w, { timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(200);
    };
    await size(1600, 900);
    // The window may be smaller than asked on a small screen; work from the width it got.
    const W = await win.evaluate(() => innerWidth);
    const room = W - (W > 1320 ? 760 : 640);
    const defaults = W > 1320 ? [220, 330] : W > 1100 ? [170, 280] : [130, 240];
    const left0 = await width('aside.left');
    const right0 = await width('aside.right');
    const drag = async (nth, dx) => {
      const b = await win.locator('.splitter').nth(nth).boundingBox();
      await win.mouse.move(b.x + b.width / 2, b.y + 200);
      await win.mouse.down();
      await win.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 200, { steps: 4 });
      await win.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 4 });
      await win.mouse.up();
    };
    // Grow both by up to 80 px, within the room there is.
    const grow = Math.max(10, Math.min(80, Math.floor((room - left0 - right0 - 10) / 2)));
    await drag(0, grow);
    await drag(1, -grow);
    const left1 = await width('aside.left');
    const right1 = await width('aside.right');
    t.check('dragging the handles resizes the sample list and the inspector', Math.abs(left1 - left0 - grow) <= 2 && Math.abs(right1 - right0 - grow) <= 2, `window ${W}: ${left0}→${left1}, ${right0}→${right1}`);
    await win.focus('.splitter >> nth=0');
    await win.keyboard.press('ArrowRight');
    const left2 = await width('aside.left');
    t.check('arrow keys on a handle resize by 10', Math.abs(left2 - left1 - 10) <= 1, `${left1}→${left2}`);
    await drag(1, -600);
    const right2 = await width('aside.right');
    t.check('a handle stops where the grid would get too narrow', Math.abs(left2 + right2 - room) <= 2 || right2 === 600, `${left2} + ${right2} (room ${room})`);
    await win.focus('.splitter >> nth=1');
    for (let i = 0; i < 5; i++) await win.keyboard.press('ArrowRight');
    const right2b = await width('aside.right');
    t.check('the inspector can be made narrower again with the keys', Math.abs(right2 - right2b - 50) <= 2, `${right2}→${right2b}`);
    t.check('a bar of 16 steps still fits next to wider panels', await win.evaluate(() => {
      const g = document.querySelector('.grid').parentElement.getBoundingClientRect();
      const c = document.querySelector('[data-cell="t1:15"]').getBoundingClientRect();
      return c.right <= g.right + 0.5;
    }));

    // --- Remembered after a restart ---
    await closeApp(app, win);
    ({ app, win, pageErrors } = await launchApp(profile));
    await size(1600, 900);
    await folderGroup().waitFor({ timeout: 10000 }).catch(() => {});
    t.check('after a restart the folder is still in the list', (await folderGroup().locator('li').count()) === 5);
    favs = await group('Favourites').locator('li .name').allTextContents().catch(() => []);
    t.check('favourites are remembered (the factory Clap and the folder file)', JSON.stringify(favs) === JSON.stringify(['Clap', 'Loose']), favs.join(', '));
    const left3 = await width('aside.left');
    const right3 = await width('aside.right');
    t.check('panel widths are remembered', Math.abs(left3 - left2) <= 1 && Math.abs(right3 - right2b) <= 1, `${left3}, ${right3}`);

    // Small window: the panels give way so a whole bar stays visible.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 640));
    await win.waitForTimeout(400);
    t.check('in a small window wide panels shrink to keep a whole bar visible', await win.evaluate(() => {
      const g = document.querySelector('.grid').parentElement.getBoundingClientRect();
      const c = document.querySelector('[data-cell="t1:15"]').getBoundingClientRect();
      return c.right <= g.right + 0.5 && document.documentElement.scrollWidth <= innerWidth;
    }));
    await size(1600, 900);
    await win.dblclick('.splitter >> nth=0');
    await win.dblclick('.splitter >> nth=1');
    const left4 = await width('aside.left');
    const right4 = await width('aside.right');
    t.check('double-clicking a handle puts the default width back', Math.abs(left4 - defaults[0]) <= 1 && Math.abs(right4 - defaults[1]) <= 1, `${left4}, ${right4}`);

    // A folder that has gone (moved, or a drive unplugged).
    renameSync(root, `${root} moved`);
    await win.click('button:has-text("Refresh")');
    await win.waitForTimeout(500);
    t.check('a folder that has gone says so after Refresh', (await folderGroup().locator('.empty').textContent().catch(() => '')).includes('Folder not found'));
    renameSync(`${root} moved`, root);
    await win.click('button:has-text("Refresh")');
    await win.waitForTimeout(500);
    t.check('and its files come back when it is there again', (await folderGroup().locator('li').count()) === 5);

    await win.click('[aria-label="Remove folder My Samples"]');
    await win.waitForTimeout(300);
    t.check('removing a folder takes it off the list and leaves the files', (await folderGroup().count()) === 0 && existsSync(join(root, 'Loose.wav')));
    await closeApp(app, win);
    ({ app, win, pageErrors } = await launchApp(profile));
    t.check('a removed folder stays removed after a restart', (await win.locator('.browser-group.folder').count()) === 0);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Sample folders, favourites and panels', run);
