// Updates, through the real UI. A stand-in updater (BDB_UPDATE_FAKE) offers a
// new version without any network, so the whole flow runs anywhere: the note in
// the corner, "Later", downloading, asking about unsaved work, and restarting.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, usingInstalledApp } from './lib.mjs';

export async function run(t) {
  // 1. Without a stand-in: the development build says updates need the installed app;
  //    the installed app offers to check.
  {
    const { app, win, pageErrors } = await launchApp();
    try {
      await win.click('button.about');
      const line = (await win.textContent('.modal .about-update')) ?? '';
      if (usingInstalledApp()) t.check('the installed app offers "Check for updates" in About', line.includes('Check for updates'), line);
      else t.check('the development build says updates work in the installed app', line.includes('Updates work in the installed app'), line);
      t.check('no update note appears by itself', (await win.locator('.update-banner').count()) === 0);
      t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
    } finally {
      await closeApp(app, win);
    }
  }

  // 2. Nothing newer: "Check for updates" says so.
  {
    const { app, win } = await launchApp(newProfile(), [], { BDB_UPDATE_FAKE: 'none', BDB_UPDATE_DELAY: '60000' });
    try {
      await win.click('button.about');
      await win.click('.modal button:has-text("Check for updates")');
      await win.waitForSelector('.modal .update-text:has-text("latest version")', { timeout: 5000 }).catch(() => {});
      const line = (await win.textContent('.modal .update-text')) ?? '';
      t.check('"Check for updates" says when this is the latest version', line.includes('You have the latest version'), line);
    } finally {
      await closeApp(app, win);
    }
  }

  // 3. A new version is out.
  const profile = newProfile();
  const { app, win, pageErrors } = await launchApp(profile, [], { BDB_UPDATE_FAKE: '9.9.9', BDB_UPDATE_DELAY: '500' });
  win.setDefaultTimeout(15000);
  let exited = false;
  const gone = new Promise((r) => app.process().once('exit', () => r((exited = true))));
  try {
    const banner = win.locator('.update-banner');
    await banner.waitFor({ timeout: 10000 }).catch(() => {});
    const text = (await banner.textContent().catch(() => '')) ?? '';
    t.check('the app says when a new version is out, shortly after starting', text.includes('9.9.9 is out'), text || 'no note');
    await banner.locator('button:has-text("Later")').click();
    t.check('"Later" puts the note away', (await banner.count()) === 0);

    await win.click('button.about');
    const download = win.locator('.modal button:has-text("Download 9.9.9")');
    t.check('About still offers the new version', await download.waitFor({ timeout: 5000 }).then(() => true, () => false));
    await download.click();
    await win.click('.modal button:has-text("Close")');
    let sawProgress = false;
    for (let i = 0; i < 40 && !(await win.locator('.update-banner[data-state="ready"]').count()); i++) {
      if (await win.locator('.update-banner[data-state="downloading"] progress').count()) sawProgress = true;
      await win.waitForTimeout(50);
    }
    t.check('downloading shows its progress', sawProgress);
    const ready = (await win.textContent('.update-banner[data-state="ready"]').catch(() => '')) ?? '';
    t.check('once downloaded it offers to restart', ready.includes('9.9.9 is ready') && ready.includes('Restart now'), ready || 'no note');

    // Unsaved work is dealt with first, as when closing.
    await win.click('[data-cell^="t1:"][data-step="2"]');
    await win.click('.update-banner button:has-text("Restart now")');
    const asked = await win.waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 3000 }).then(() => true, () => false);
    t.check('restarting asks about unsaved changes first', asked);
    await win.click('.modal button:has-text("Cancel")');
    t.check('"Cancel" keeps the app open', !exited && (await win.locator('.update-banner[data-state="ready"]').count()) === 1);
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');

    await win.click('.update-banner button:has-text("Restart now")');
    await win.waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 3000 });
    await win.click('.modal button:has-text("Don\'t save")').catch(() => {});
    await Promise.race([gone, new Promise((r) => setTimeout(r, 10000))]);
    t.check('"Don\'t save" closes the app to install the update', exited);
    const logPath = join(profile, 'logs', 'badaboom.log');
    const appLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    t.check('the update is installed as the app closes', appLog.includes('Fake install of 9.9.9'), appLog.split('\n').filter((l) => l.includes('update')).slice(-3).join(' | ') || 'nothing logged');
    t.check('the close counts as a normal one (no recovery offered next time)', appLog.includes('Closed normally'));
  } finally {
    if (!exited) await closeApp(app, win).catch(() => {});
  }
}

await runStandalone(import.meta.url, 'Updates', run);
