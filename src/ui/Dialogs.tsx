// The app's dialogs: recovery, "save changes?", remove pattern, export, welcome, shortcuts,
// settings and About.
import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeWav24, renderPattern, renderStems } from '../engine/audio/exportWav';
import { exportMidi } from '../engine/strudel/midi';
import { currentPattern, patternUsage, songBars } from '../model/ops';
import { STEPS_PER_BAR, type Project } from '../model/types';
import type { UpdateState } from '../main/ipc';
import { db } from './controls';
import { desktop, inElectron } from './desktop';
import { KeyboardMap } from './KeyboardMap';
import { Logo } from './Logo';
import { updateText } from './Updates';
import type { AppCtx } from './appContext';

export type Modal =
  | { kind: 'recover'; text: string; missing: string[]; launch: string | null }
  | { kind: 'export' }
  | { kind: 'settings' }
  | { kind: 'welcome' }
  | { kind: 'keys' }
  | { kind: 'removePattern'; id: string }
  | { kind: 'about'; notices: string; version: string; platform: string; logFile: string }
  | { kind: 'unsaved'; then: 'close' | 'new' | 'open' | 'update'; path?: string }
  | null;

export function Dialog({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button.primary, button')?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const fileName = (path: string) => path.split(/[\\/]/).pop();

export function RecoverDialog({ modal, onClose, onOpen, onRecover }: {
  modal: Extract<Modal, { kind: 'recover' }>;
  onClose: () => void;
  onOpen: (path: string) => void;
  onRecover: () => void;
}) {
  return (
    <Dialog title="Recover unsaved work?">
      <p>Ba-da-boom did not close normally last time. Your most recent autosave can be restored.</p>
      {modal.missing.length > 0 && <p className="warn">{modal.missing.length} imported sample(s) from that session could not be found.</p>}
      {modal.launch && <p>Or open {fileName(modal.launch)}, the project you double-clicked, and leave the unsaved work.</p>}
      <div className="actions">
        {modal.launch ? (
          <button onClick={() => { const f = modal.launch!; onClose(); onOpen(f); }}>Open {fileName(modal.launch)}</button>
        ) : (
          <button onClick={onClose}>Start fresh</button>
        )}
        <button className="primary" onClick={() => { onRecover(); onClose(); }}>Recover</button>
      </div>
    </Dialog>
  );
}

export function UnsavedDialog({ modal, onClose, save, proceed }: {
  modal: Extract<Modal, { kind: 'unsaved' }>;
  onClose: () => void;
  save: (saveAs?: boolean) => Promise<boolean>;
  proceed: (then: 'close' | 'new' | 'open' | 'update', path?: string) => Promise<void>;
}) {
  return (
    <Dialog title="Save changes?">
      <p>This project has unsaved changes.{modal.then === 'open' && modal.path ? ` Save them before opening ${fileName(modal.path)}?` : ''}</p>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={async () => {
          const { then, path } = modal;
          onClose();
          await proceed(then, path);
        }}>Don't save</button>
        <button className="primary" onClick={async () => {
          const { then, path } = modal;
          if (!(await save(false))) return;
          onClose();
          await proceed(then, path);
        }}>Save</button>
      </div>
    </Dialog>
  );
}

export function RemovePatternDialog({ project, id, onClose, onRemove }: { project: Project; id: string; onClose: () => void; onRemove: (id: string) => void }) {
  const pt = project.patterns.find((x) => x.id === id);
  const u = patternUsage(project, id);
  return (
    <Dialog title={`Remove pattern ${pt?.name}?`}>
      <p>
        Pattern {pt?.name} has {u.hits} step{u.hits === 1 ? '' : 's'} switched on
        {u.songEntries ? ` and is used ${u.songEntries} time${u.songEntries === 1 ? '' : 's'} in the song. Those song entries are removed too` : ''}.
      </p>
      <p>You can undo this with Ctrl+Z.</p>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary danger" onClick={() => { onClose(); onRemove(id); }}>Remove</button>
      </div>
    </Dialog>
  );
}

/** Export choices, kept while the app is open so the dialog opens as it was left. */
export interface ExportPrefs {
  bars: number;
  song: boolean;
  format: 'wav' | 'stems' | 'midi';
}

export function ExportDialog({ ctx, project, prefs, setPrefs, stop, onClose }: {
  ctx: AppCtx;
  project: Project;
  prefs: ExportPrefs;
  setPrefs: (p: ExportPrefs) => void;
  /** Stops playback before rendering. */
  stop: () => Promise<void>;
  onClose: () => void;
}) {
  const { notify, fail, projectRef, engineRef } = ctx;
  const [progress, setProgress] = useState('');
  const [exporting, setExporting] = useState(false);
  const pattern = currentPattern(project);
  const defaultBars = Math.max(1, Math.ceil(Math.max(...project.tracks.map((t) => pattern.lanes[t.id].length)) / STEPS_PER_BAR));
  const { bars: exportBars, song: exportSong, format } = prefs;

  const doExport = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setExporting(true);
    try {
      await stop();
      const p = projectRef.current;
      const missing = new Set(Object.keys(p.samples).filter((id) => engine.sampleStatus(id) !== 'ok'));
      const song = exportSong && p.song.length > 0;
      const bars = song ? songBars(p) : exportBars || defaultBars;
      const t0 = performance.now();
      const patternId = song ? 'song' : p.currentPatternId;
      const name = `${p.name} - ${song ? 'song' : currentPattern(p).name}`.replace(/[\\/:*?"<>|]/g, '_');
      if (format === 'midi') {
        const midi = exportMidi(p, patternId, bars);
        const path = await desktop.saveMidi(name, midi.bytes);
        (window as any).__lastExportInfo = { format: 'midi', notes: midi.notes, bytes: midi.bytes.length };
        if (path) {
          notify(`Exported ${midi.notes} notes (${bars} bar${bars === 1 ? '' : 's'}) as MIDI → ${path}`);
          onClose();
        }
        return;
      }
      if (format === 'stems') {
        const stems = await renderStems(p, { patternId, bars, missingSamples: missing }, (done, total) => setProgress(`${done} / ${total}`));
        if (!stems.length) throw new Error('No audible track has hits in this range');
        const files = stems.map((s) => ({ name: `${String(s.trackIndex + 1).padStart(2, '0')} ${s.name}.wav`.replace(/[\\/:*?"<>|]/g, '_'), bytes: encodeWav24(s.buffer) }));
        const path = await desktop.saveStems(name, files);
        (window as any).__lastExportInfo = { format: 'stems', stems: stems.map((s) => ({ track: s.trackIndex, events: s.events, frames: s.buffer.length, peak: s.peak })), files: files.map((f) => f.name) };
        if (path) {
          notify(`Exported ${stems.length} stems → ${path}`);
          onClose();
        }
        return;
      }
      const res = await renderPattern(p, { patternId, bars, missingSamples: missing });
      const wav = encodeWav24(res.buffer);
      const path = await desktop.saveWav(name, wav);
      (window as any).__lastExportInfo = { ...res, buffer: undefined, seconds: res.buffer.duration, ms: performance.now() - t0 };
      if (path) {
        notify(`Exported ${bars} bar(s), ${res.buffer.duration.toFixed(2)} s incl. tail, peak ${db(res.peak)} → ${path}`);
        onClose();
      }
    } catch (e) {
      fail(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
      setProgress('');
    }
  }, [defaultBars, exportBars, exportSong, format, notify, fail, stop, onClose, engineRef, projectRef]);

  const set = (patch: Partial<ExportPrefs>) => setPrefs({ ...prefs, ...patch });
  return (
    <Dialog title={`Export ${exportSong && project.song.length ? 'song' : `pattern ${pattern.name}`}`}>
      <div className="export-what" role="radiogroup" aria-label="Format">
        <label className="check">
          <input type="radio" name="export-format" checked={format === 'wav'} onChange={() => set({ format: 'wav' })} /> WAV mix
        </label>
        <label className="check">
          <input type="radio" name="export-format" checked={format === 'stems'} onChange={() => set({ format: 'stems' })} /> Stems (one WAV per track)
        </label>
        <label className="check">
          <input type="radio" name="export-format" checked={format === 'midi'} onChange={() => set({ format: 'midi' })} /> MIDI
        </label>
      </div>
      {format === 'midi' ? (
        <p>A Standard MIDI File with one track per drum track on channel 10, using General MIDI drum notes. Ratchets, microtiming and swing are included.</p>
      ) : (
        <p>
          Renders offline at 44.1 kHz, 24-bit stereo, through the same sounds, effects and master chain as playback. Effect tails ring out after the last bar and are trimmed once silent. The metronome is not included.
          {format === 'stems' && ' Each audible track (mute and solo are respected) gets its own file with its own delay and reverb. All stems have the same length, so they line up in a DAW.'}
        </p>
      )}
      <p>Probability uses the project seed ({project.seed}), so the same project always exports the same result, matching playback from the start.</p>
      {project.song.length > 0 && (
        <div className="export-what" role="radiogroup" aria-label="What to export">
          <label className="check">
            <input type="radio" name="export-what" checked={!exportSong} onChange={() => set({ song: false })} /> Pattern {pattern.name}
          </label>
          <label className="check">
            <input type="radio" name="export-what" checked={exportSong} onChange={() => set({ song: true })} /> Song ({songBars(project)} bars, played once)
          </label>
        </div>
      )}
      <label className="num" hidden={exportSong && project.song.length > 0}>
        Bars
        <select value={exportBars || defaultBars} onChange={(e) => set({ bars: Number(e.target.value) })}>
          {[1, 2, 4, 8, 16, 32].concat(defaultBars).sort((a, b) => a - b).filter((v, i, a) => a.indexOf(v) === i).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="actions">
        <button onClick={onClose} disabled={exporting}>Cancel</button>
        <button className="primary" onClick={doExport} disabled={exporting}>{exporting ? `Rendering… ${progress}` : 'Export'}</button>
      </div>
    </Dialog>
  );
}

export function WelcomeDialog({ onClose, onOpen, onLibrary }: { onClose: () => void; onOpen: () => void; onLibrary: () => void }) {
  return (
    <Dialog title="Welcome to Ba-da-boom" wide>
      <div className="welcome">
        <Logo size={72} />
        <div>
          <p className="welcome-lead">Make drum beats: pick one, press play, then make it yours.</p>
          <ol className="welcome-steps">
            <li>
              <strong>Pick a beat</strong> from the Beat library under the grid (Amen, Funky Drummer, house, trap and more), or click and drag on the grid to paint your own.
            </li>
            <li>
              <strong>Press Space</strong> to play and stop. Number keys 1–8 switch patterns.
            </li>
            <li>
              <strong>Shape the sound</strong> with the knobs on the right, balance it in the Mixer, and play along on the Pads. Ctrl+Z undoes anything.
            </li>
          </ol>
        </div>
      </div>
      <div className="actions">
        <button onClick={() => { onClose(); onOpen(); }}>Open a project…</button>
        <button onClick={onClose}>Start with this beat</button>
        <button className="primary" onClick={() => { onClose(); onLibrary(); }}>Browse the Beat library</button>
      </div>
    </Dialog>
  );
}

export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" wide>
      <KeyboardMap />
      <div className="actions">
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function AboutDialog({ modal, update, setUpdate, onClose, onRestart, onWelcome }: {
  modal: Extract<Modal, { kind: 'about' }>;
  update: UpdateState;
  setUpdate: (u: UpdateState) => void;
  onClose: () => void;
  onRestart: () => void;
  onWelcome: () => void;
}) {
  return (
    <Dialog title="About Ba-da-boom" wide>
      <p>Version {modal.version} · {modal.platform}</p>
      <div className="about-update">
        {update.state === 'ready' ? (
          <button className="primary" onClick={() => { onClose(); onRestart(); }}>Restart to update</button>
        ) : update.state === 'available' ? (
          <button className="primary" onClick={() => desktop.updateDownload()}>Download {update.version}</button>
        ) : (
          update.state !== 'off' && (
            <button disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => desktop.updateCheck().then(setUpdate)}>Check for updates</button>
          )
        )}
        <span className="update-text" role="status">{updateText(update)}</span>
      </div>
      <p>
        Ba-da-boom is free software under the GNU Affero General Public License v3.0 or later. Its pattern engine and audio
        engine are <strong>Strudel</strong> (strudel.cc), © Strudel contributors, also AGPL-3.0-or-later. You can get the
        complete source code of this version at https://github.com/theappreview1277-blip/ba-da-boom.
      </p>
      <p>Factory sounds are synthesised by the project and released under CC0 1.0. The Acoustic Kit is from Virtuosity Drums (Austin McMahon, Virtuosity Musical Instruments, with percussion from VSCO 2), also CC0 1.0.</p>
      <pre className="notices">{modal.notices || 'Third-party notices are included with the installed app.'}</pre>
      <div className="actions">
        <button onClick={onWelcome}>Welcome screen</button>
        {inElectron && <button onClick={() => desktop.showLog()} title={modal.logFile}>Show error log</button>}
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
