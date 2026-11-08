// The note that a new version is out, in the corner of the window, and the
// update line in About. The main process does the checking and downloading.
import type { UpdateState } from '../main/ipc';

export function UpdateBanner({ update, onDownload, onRestart, onLater }: { update: UpdateState; onDownload(): void; onRestart(): void; onLater(): void }) {
  if (update.state !== 'available' && update.state !== 'downloading' && update.state !== 'ready') return null;
  return (
    <div className="update-banner" role="status" data-state={update.state}>
      {update.state === 'available' && (
        <>
          <span>Ba-da-boom {update.version} is out.</span>
          <button className="primary" onClick={onDownload}>Download</button>
          <button onClick={onLater}>Later</button>
        </>
      )}
      {update.state === 'downloading' && (
        <>
          <span>Downloading {update.version}…</span>
          <progress max={100} value={update.percent} aria-label="Download progress" />
          <span className="update-pct">{update.percent}%</span>
        </>
      )}
      {update.state === 'ready' && (
        <>
          <span>Version {update.version} is ready. It goes in when the app restarts.</span>
          <button className="primary" onClick={onRestart}>Restart now</button>
          <button onClick={onLater}>Later</button>
        </>
      )}
    </div>
  );
}

export function updateText(u: UpdateState): string {
  switch (u.state) {
    case 'off':
      return 'Updates work in the installed app.';
    case 'idle':
      return '';
    case 'checking':
      return 'Checking for updates…';
    case 'none':
      return 'You have the latest version.';
    case 'available':
      return `Version ${u.version} is available.`;
    case 'downloading':
      return `Downloading version ${u.version} (${u.percent}%).`;
    case 'ready':
      return `Version ${u.version} is downloaded and goes in when the app restarts.`;
    case 'error':
      return u.message;
  }
}
