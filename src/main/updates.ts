// Updates: the installed app looks for a newer release on GitHub a little after
// it starts, says so in the window, downloads it when asked, and installs it
// on restart. Nothing is downloaded without the user saying yes.
//
// Only the installed app updates. Two settings exist for testing:
// - BDB_UPDATE_URL: look for updates in a folder served over HTTP (an
//   electron-builder "generic" feed: latest.yml plus the installer) instead of GitHub.
// - BDB_UPDATE_FAKE=<version>: pretend <version> is available, without any network,
//   so the whole flow can be tested anywhere. "Installing" just closes the app.

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from './ipc';
import { log } from './log';

/** The parts of electron-updater the app uses, so a stand-in can replace it in tests. */
interface Updater {
  check(): Promise<string | null>;
  download(onPercent: (p: number) => void): Promise<void>;
  install(): void;
}

function realUpdater(feedUrl: string | undefined): Updater {
  autoUpdater.autoDownload = false;
  // A downloaded update also goes in when the app is closed normally.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => log('info', 'update', m),
    warn: (m: unknown) => log('warn', 'update', m),
    error: (m: unknown) => log('error', 'update', m),
    debug: () => {},
  };
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    // Lets a build that isn't installed try the test feed too.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  }
  let onPercent: ((p: number) => void) | null = null;
  autoUpdater.on('download-progress', (p) => onPercent?.(p.percent));
  return {
    async check() {
      const r = await autoUpdater.checkForUpdates();
      return r?.isUpdateAvailable ? r.updateInfo.version : null;
    },
    async download(cb) {
      onPercent = cb;
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        onPercent = null;
      }
    },
    // Silent install (the installer's pages were seen the first time), then start the new version.
    install: () => autoUpdater.quitAndInstall(true, true),
  };
}

function fakeUpdater(version: string): Updater {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    async check() {
      await wait(300);
      return version === 'none' ? null : version;
    },
    async download(cb) {
      for (const p of [10, 40, 75, 100]) {
        await wait(150);
        cb(p);
      }
    },
    install() {
      log('info', 'update', `Fake install of ${version}`);
      app.quit();
    },
  };
}

export class Updates {
  private updater: Updater | null;
  private current: UpdateState;
  private found: string | null = null;

  constructor(private send: (s: UpdateState) => void) {
    const fake = process.env.BDB_UPDATE_FAKE;
    const url = process.env.BDB_UPDATE_URL;
    this.updater = fake ? fakeUpdater(fake) : app.isPackaged || url ? realUpdater(url) : null;
    this.current = this.updater ? { state: 'idle' } : { state: 'off' };
  }

  get state() {
    return this.current;
  }

  private set(s: UpdateState) {
    this.current = s;
    this.send(s);
  }

  /** Looks for a newer version. A check the user didn't ask for stays quiet when it fails (offline, say). */
  async check(quiet = false): Promise<UpdateState> {
    if (!this.updater) return this.current;
    const busy = this.current.state === 'checking' || this.current.state === 'downloading' || this.current.state === 'ready';
    if (busy) return this.current;
    this.set({ state: 'checking' });
    try {
      this.found = await this.updater.check();
      this.set(this.found ? { state: 'available', version: this.found } : { state: 'none' });
    } catch (e) {
      log('warn', 'update', `Update check failed: ${String(e)}`);
      this.set(quiet ? { state: 'idle' } : { state: 'error', message: 'Could not check for updates. Is the computer online?' });
    }
    return this.current;
  }

  async download() {
    const version = this.found;
    if (!this.updater || !version || this.current.state !== 'available') return;
    this.set({ state: 'downloading', version, percent: 0 });
    try {
      await this.updater.download((p) => this.set({ state: 'downloading', version, percent: Math.round(p) }));
      log('info', 'update', `Downloaded ${version}`);
      this.set({ state: 'ready', version });
    } catch (e) {
      log('error', 'update', `Update download failed: ${String(e)}`);
      this.set({ state: 'error', message: 'The update could not be downloaded. Try again later.' });
    }
  }

  /** Called once the window has closed: installs the downloaded version and starts it. */
  install() {
    if (this.current.state === 'ready') this.updater?.install();
  }
}
