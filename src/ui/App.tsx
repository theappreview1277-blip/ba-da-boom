import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../engine/audio/engine';
import { encodeWav24, renderPattern, renderStems } from '../engine/audio/exportWav';
import { exportMidi } from '../engine/strudel/midi';
import { trackControls } from '../engine/strudel/fromModel';
import { emptyPattern, newProject } from '../model/defaults';
import {
  addVariation,
  clearLane,
  clearPattern,
  currentLane,
  currentPattern,
  duplicatePattern,
  pasteLane,
  pastePattern,
  patternBars,
  setLane,
  setLaneLength,
  setPatternLength,
  setStep,
  setTrack,
  setTrackSound,
  movePattern,
  patternUsage,
  removePattern,
  songAdd,
  songBars,
  songMove,
  songRemove,
  songSetBars,
  toggleStep,
} from '../model/ops';
import { applySteps, randomiseLane } from '../model/generate';
import { parseProject, serializeProject } from '../model/serialize';
import { STEPS_PER_BAR, type Project, type SampleRef } from '../model/types';
import { Slider, db } from './controls';
import { desktop, inElectron, sampleUrl } from './desktop';
import { Grid } from './Grid';
import { Generate } from './Generate';
import { Inspector } from './Inspector';
import { SampleBrowser } from './SampleBrowser';
import { Perform } from './Perform';
import { SongBar } from './SongBar';
import { reorderProps } from './reorder';
import { useUiStore } from './store';

const AUTOSAVE_MS = 5000;

const patternName = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26) + 1) : '');

type Modal =
  | { kind: 'recover'; text: string; missing: string[] }
  | { kind: 'export' }
  | { kind: 'removePattern'; id: string }
  | { kind: 'about'; notices: string; version: string; platform: string }
  | { kind: 'unsaved'; then: 'close' | 'new' | 'open' }
  | null;

export function App() {
  const { state, dispatch, edit } = useUiStore();
  const project = state.history.present;
  const pattern = currentPattern(project);
  const engineRef = useRef<AudioEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [, setStatusTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audiblePattern, setAudiblePattern] = useState<string | null>(null);
  const [songMode, setSongModeState] = useState(false);
  const songModeRef = useRef(false);
  const [songIndex, setSongIndex] = useState(-1);
  const [view, setView] = useState<'edit' | 'perform'>('edit');
  const positionEl = useRef<HTMLDivElement | null>(null);
  const positionRef = useCallback((el: HTMLDivElement | null) => void (positionEl.current = el), []);
  const [queuedPattern, setQueuedPattern] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const dirty = state.savedProject !== project;
  const projectRef = useRef(project);
  projectRef.current = project;
  const stateRef = useRef(state);
  stateRef.current = state;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as any).t);
    (notify as any).t = window.setTimeout(() => setToast(null), 5000);
  }, []);

  // --- audio engine lifecycle ---
  useEffect(() => {
    const engine = new AudioEngine(sampleUrl);
    engine.onSampleStatus = () => setStatusTick((n) => n + 1);
    engine.onError = (m) => notify(`Playback error: ${m}`);
    engineRef.current = engine;
    engine
      .init()
      .then(() => {
        engine.update(projectRef.current);
        setEngineReady(true);
        return engine.loadSamples(projectRef.current);
      })
      .catch((e) => setEngineError(String(e)));
    // For automated tests and diagnostics.
    Object.assign(window as any, { __engine: engine, __bdb: { renderPattern, encodeWav24, parseProject, serializeProject } });
  }, [notify]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engineReady) return;
    engine.update(project);
  }, [project, engineReady]);

  useEffect(() => {
    if (engineReady) engineRef.current?.loadSamples(project);
  }, [project.samples, engineReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- playhead and meters, drawn on animation frames, independent of scheduling ---
  const rows = useRef(new Map<string, HTMLDivElement>());
  const rowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  }, []);
  const trackMeters = useRef<(HTMLDivElement | null)[]>([]);
  const meterRef = useCallback((i: number) => (el: HTMLDivElement | null) => void (trackMeters.current[i] = el), []);
  const masterL = useRef<HTMLDivElement | null>(null);
  const masterR = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLButtonElement | null>(null);
  const limitRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const lastPlay = new Map<string, HTMLElement>();
    const level = (p: number) => Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(p, 1e-6))) / 60));
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const engine = engineRef.current;
      if (!engine || !engine.isPlaying) {
        lastPlay.forEach((el) => el.classList.remove('play'));
        lastPlay.clear();
      }
      if (!engine) return;
      const p = projectRef.current;
      const audible = engine.audiblePatternId;
      setAudiblePattern((prev) => (prev === audible ? prev : audible));
      const song = engine.songState();
      const idx = song?.index ?? -1;
      setSongIndex((prev) => (prev === idx ? prev : idx));
      if (song?.finished) {
        // End of the song (no loop): stop once the last bar has been heard.
        void engine.stop().then(() => setPlaying(false));
      } else if (song && idx >= 0) {
        // In song mode the grid follows the pattern being heard.
        const id = p.song[idx]?.patternId;
        if (id && id !== p.currentPatternId) dispatch({ type: 'transient', fn: (q) => ({ ...q, currentPatternId: id }) });
      }
      setQueuedPattern((prev) => (prev === (engine.queued?.patternId ?? null) ? prev : engine.queued?.patternId ?? null));
      const cycle = engine.patternCycle();
      if (positionEl.current) {
        // Bar and beat of the pattern being heard, for the performance view.
        positionEl.current.textContent =
          cycle == null || !audible
            ? '–'
            : `${p.patterns.find((x) => x.id === audible)?.name ?? ''} · bar ${(Math.floor(cycle) % patternBars(p, audible)) + 1} · beat ${Math.floor((cycle % 1) * 4) + 1}`;
      }
      const shown = audible === p.currentPatternId ? cycle : null;
      const pat = currentPattern(p);
      for (const t of p.tracks) {
        const row = rows.current.get(t.id);
        if (!row) continue;
        let el: HTMLElement | undefined;
        if (shown != null) {
          const len = pat.lanes[t.id]?.length ?? 16;
          const step = Math.floor(shown * STEPS_PER_BAR) % len;
          el = row.children[step] as HTMLElement | undefined;
        }
        const prev = lastPlay.get(t.id);
        if (prev !== el) {
          prev?.classList.remove('play');
          el?.classList.add('play');
          if (el) lastPlay.set(t.id, el);
          else lastPlay.delete(t.id);
        }
      }
      const m = engine.readMeters(p.tracks.length);
      m.tracks.forEach((v, i) => {
        const el = trackMeters.current[i];
        if (el) el.style.transform = `scaleY(${level(v)})`;
      });
      if (masterL.current) masterL.current.style.transform = `scaleX(${level(m.left)})`;
      if (masterR.current) masterR.current.style.transform = `scaleX(${level(m.right)})`;
      clipRef.current?.classList.toggle('on', m.clip);
      limitRef.current?.classList.toggle('on', m.limiting);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- transport ---
  const togglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !engineReady) return;
    if (engine.isPlaying) {
      await engine.stop();
      setPlaying(false);
    } else {
      await engine.play();
      setPlaying(engine.isPlaying);
    }
  }, [engineReady]);

  const setSongMode = useCallback((on: boolean) => {
    songModeRef.current = on;
    setSongModeState(on);
    engineRef.current?.setSongMode(on);
  }, []);
  useEffect(() => {
    if (songMode && project.song.length === 0) setSongMode(false);
  }, [songMode, project.song.length, setSongMode]);

  const doRemovePattern = useCallback(
    (id: string) => {
      const next = removePattern(projectRef.current, id);
      if (next === projectRef.current) return;
      edit(() => next);
      const engine = engineRef.current;
      // If it was playing or queued, the new current pattern takes over at the next bar.
      if (engine?.isPlaying && (engine.audiblePatternId === id || engine.queued?.patternId === id)) engine.switchPattern(next.currentPatternId);
      notify(`Pattern ${projectRef.current.patterns.find((x) => x.id === id)?.name} removed (Ctrl+Z to undo)`);
    },
    [edit, notify],
  );
  /** Asks first when the pattern has steps or is used in the song; an empty, unused pattern goes at once. */
  const askRemovePattern = useCallback(
    (id: string) => {
      const u = patternUsage(projectRef.current, id);
      if (u.hits || u.songEntries) setModal({ kind: 'removePattern', id });
      else doRemovePattern(id);
    },
    [doRemovePattern],
  );

  const selectPattern = useCallback(
    (id: string) => {
      dispatch({ type: 'transient', fn: (p) => ({ ...p, currentPatternId: id }) });
      const engine = engineRef.current;
      // Picking a pattern while the song plays leaves song mode at the next bar.
      if (engine && songModeRef.current && engine.isPlaying) {
        songModeRef.current = false;
        setSongModeState(false);
        engine.songMode = false;
      }
      engine?.switchPattern(id);
    },
    [dispatch],
  );

  // --- editing callbacks (stable, so grid cells don't re-render needlessly) ---
  const onToggle = useCallback(
    (trackId: string, step: number) => edit((p) => toggleStep(p, p.currentPatternId, trackId, step)),
    [edit],
  );
  const onSelect = useCallback((track: string, step?: number) => dispatch({ type: 'select', track, step }), [dispatch]);
  const onTrack = useCallback((id: string, patch: { mute?: boolean; solo?: boolean }) => edit((p) => setTrack(p, id, patch)), [edit]);
  const onLength = useCallback(
    (id: string, len: number) => edit((p) => setLaneLength(p, p.currentPatternId, id, len), `len:${id}`),
    [edit],
  );

  const importFiles = useCallback(
    async (files: File[], assignTo?: string) => {
      let lastId: string | null = null;
      for (const f of files) {
        if (!/\.wav$/i.test(f.name)) {
          notify(`${f.name}: only WAV files are supported in this version.`);
          continue;
        }
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const { file } = await desktop.importSample(f.name, bytes);
          const id = `user:${file}`;
          const ref: SampleRef = { id, name: f.name.replace(/\.wav$/i, ''), source: 'user', file, originalName: f.name };
          edit((p) => ({ ...p, samples: { ...p.samples, [id]: ref } }));
          lastId = id;
        } catch (e) {
          notify(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (assignTo && lastId) {
        const id = lastId;
        edit((p) => setTrackSound(p, assignTo, { sampleId: id }));
      }
      if (lastId) notify(`Imported ${files.length === 1 ? files[0].name : `${files.length} files`}`);
    },
    [edit, notify],
  );

  const assignSample = useCallback(
    (trackId: string, sampleId: string) => {
      edit((p) => {
        const name = p.samples[sampleId]?.name;
        const t = p.tracks.find((x) => x.id === trackId);
        const renamed = t && name && t.name === p.samples[t.sound.sampleId ?? '']?.name ? setTrack(p, trackId, { name }) : p;
        return setTrackSound(renamed, trackId, { sampleId });
      });
    },
    [edit],
  );

  const audition = useCallback(
    (sampleId: string, withTrack?: string) => {
      const p = projectRef.current;
      const i = withTrack ? p.tracks.findIndex((t) => t.id === withTrack) : -1;
      const controls = i >= 0 ? trackControls(p.tracks[i], i, p) : {};
      delete controls.orbit;
      engineRef.current?.audition(sampleId, controls);
    },
    [],
  );

  // --- files ---
  const loadText = useCallback(
    (text: string, path: string | null, saved: boolean, missing: string[] = []) => {
      try {
        const p = parseProject(text);
        dispatch({ type: 'load', project: p, path, saved });
        if (missing.length) notify(`${missing.length} sample file(s) could not be found. Tracks using them are marked "missing".`);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    },
    [dispatch, notify],
  );

  const save = useCallback(
    async (saveAs = false) => {
      const p = projectRef.current;
      const st = stateRef.current;
      try {
        const res = await desktop.saveProject({ path: st.path, saveAs, name: p.name, text: serializeProject(p) });
        if (!res) return false;
        const name = res.path.split(/[\\/]/).pop()!.replace(/\.badaboom$/, '');
        const saved = p.name === name ? p : { ...p, name };
        if (saved !== p) dispatch({ type: 'transient', fn: () => saved });
        dispatch({ type: 'saved', path: res.path, project: saved });
        notify(
          res.notCollected.length
            ? `Saved, but ${res.notCollected.length} sample(s) could not be copied into the project folder.`
            : `Saved ${res.path}`,
        );
        return true;
      } catch (e) {
        notify(`Save failed: ${e instanceof Error ? e.message : e}`);
        return false;
      }
    },
    [dispatch, notify],
  );

  const open = useCallback(async () => {
    try {
      const res = await desktop.openProject();
      if (res) {
        if (engineRef.current?.isPlaying) {
          await engineRef.current.stop();
          setPlaying(false);
        }
        loadText(res.text, res.path, true, res.missing);
      }
    } catch (e) {
      notify(`Open failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [loadText, notify]);

  const newDoc = useCallback(async () => {
    if (engineRef.current?.isPlaying) {
      await engineRef.current.stop();
      setPlaying(false);
    }
    const p = newProject();
    dispatch({ type: 'load', project: p, path: null, saved: true });
  }, [dispatch]);

  const guarded = useCallback(
    (then: 'new' | 'open') => {
      if (stateRef.current.savedProject !== projectRef.current) setModal({ kind: 'unsaved', then });
      else if (then === 'new') newDoc();
      else open();
    },
    [newDoc, open],
  );

  // --- autosave and recovery ---
  useEffect(() => {
    desktop.autosaveRecover().then((r) => {
      if (r) setModal({ kind: 'recover', text: r.text, missing: r.missing });
    });
    desktop.onBeforeClose(async () => {
      await desktop.autosaveWrite(serializeProject(projectRef.current)).catch(() => {});
      if (stateRef.current.savedProject !== projectRef.current) {
        await desktop.closePending();
        setModal({ kind: 'unsaved', then: 'close' });
      } else {
        await desktop.closeReady();
      }
    });
  }, []);

  const lastAutosaved = useRef<Project | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = projectRef.current;
      if (p === lastAutosaved.current) return;
      lastAutosaved.current = p;
      desktop.autosaveWrite(serializeProject(p)).catch(() => {});
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, []);

  // --- export ---
  const [exportBars, setExportBars] = useState(0);
  const [exportSong, setExportSong] = useState(false);
  const [exportFormat, setExportFormat] = useState<'wav' | 'stems' | 'midi'>('wav');
  const [exportProgress, setExportProgress] = useState('');
  const [exporting, setExporting] = useState(false);
  const defaultBars = Math.max(1, Math.ceil(Math.max(...project.tracks.map((t) => pattern.lanes[t.id].length)) / STEPS_PER_BAR));

  const doExport = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setExporting(true);
    try {
      if (engine.isPlaying) {
        await engine.stop();
        setPlaying(false);
      }
      const p = projectRef.current;
      const missing = new Set(Object.keys(p.samples).filter((id) => engine.sampleStatus(id) !== 'ok'));
      const song = exportSong && p.song.length > 0;
      const bars = song ? songBars(p) : exportBars || defaultBars;
      const t0 = performance.now();
      const patternId = song ? 'song' : p.currentPatternId;
      const name = `${p.name} - ${song ? 'song' : currentPattern(p).name}`.replace(/[\\/:*?"<>|]/g, '_');
      if (exportFormat === 'midi') {
        const midi = exportMidi(p, patternId, bars);
        const path = await desktop.saveMidi(name, midi.bytes);
        (window as any).__lastExportInfo = { format: 'midi', notes: midi.notes, bytes: midi.bytes.length };
        if (path) {
          notify(`Exported ${midi.notes} notes (${bars} bar${bars === 1 ? '' : 's'}) as MIDI → ${path}`);
          setModal(null);
        }
        return;
      }
      if (exportFormat === 'stems') {
        const stems = await renderStems(p, { patternId, bars, missingSamples: missing }, (done, total) => setExportProgress(`${done} / ${total}`));
        if (!stems.length) throw new Error('No audible track has hits in this range');
        const files = stems.map((s) => ({ name: `${String(s.trackIndex + 1).padStart(2, '0')} ${s.name}.wav`.replace(/[\\/:*?"<>|]/g, '_'), bytes: encodeWav24(s.buffer) }));
        const path = await desktop.saveStems(name, files);
        (window as any).__lastExportInfo = { format: 'stems', stems: stems.map((s) => ({ track: s.trackIndex, events: s.events, frames: s.buffer.length, peak: s.peak })), files: files.map((f) => f.name) };
        if (path) {
          notify(`Exported ${stems.length} stems → ${path}`);
          setModal(null);
        }
        return;
      }
      const res = await renderPattern(p, { patternId, bars, missingSamples: missing });
      const wav = encodeWav24(res.buffer);
      const path = await desktop.saveWav(name, wav);
      (window as any).__lastExportInfo = { ...res, buffer: undefined, seconds: res.buffer.duration, ms: performance.now() - t0 };
      if (path) {
        notify(
          `Exported ${bars} bar(s), ${res.buffer.duration.toFixed(2)} s incl. tail, peak ${db(res.peak)} → ${path}`,
        );
        setModal(null);
      }
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  }, [defaultBars, exportBars, exportSong, exportFormat, notify]);

  // --- keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Typing in a field must not trigger shortcuts; checkboxes and buttons are fine.
      if (modal || target.closest('input:not([type=checkbox]):not([type=radio]), select, textarea')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const st = stateRef.current;
      const p = projectRef.current;
      const k = e.key.toLowerCase();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (ctrl && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (ctrl && k === 's') {
        e.preventDefault();
        save(e.shiftKey);
      } else if (ctrl && k === 'o') {
        e.preventDefault();
        guarded('open');
      } else if (ctrl && k === 'e') {
        e.preventDefault();
        setModal({ kind: 'export' });
      } else if (ctrl && k === 'c') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'copyPattern', pattern: currentPattern(p) });
        else dispatch({ type: 'copyLane', lane: currentLane(p, p.currentPatternId, st.selectedTrack) });
        notify(e.shiftKey ? 'Pattern copied' : 'Track lane copied');
      } else if (ctrl && k === 'v') {
        e.preventDefault();
        if (e.shiftKey && st.patternClipboard) edit((q) => pastePattern(q, q.currentPatternId, st.patternClipboard!));
        else if (!e.shiftKey && st.laneClipboard) edit((q) => pasteLane(q, q.currentPatternId, st.selectedTrack, st.laneClipboard!));
      } else if (ctrl && k === 'd') {
        e.preventDefault();
        edit((q) => duplicatePattern(q, q.currentPatternId));
      } else if (ctrl && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (p.patterns.length > 1) askRemovePattern(p.currentPatternId);
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const i = p.patterns.findIndex((x) => x.id === p.currentPatternId);
        edit((q) => movePattern(q, q.currentPatternId, i + (e.key === 'ArrowLeft' ? -1 : 1)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.shiftKey) edit((q) => clearPattern(q, q.currentPatternId));
        else edit((q) => clearLane(q, q.currentPatternId, st.selectedTrack));
      } else if (!ctrl && /^[1-8]$/.test(e.key)) {
        const target = p.patterns[Number(e.key) - 1];
        if (target) selectPattern(target.id);
      } else if (!ctrl && k === 'm') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t) edit((q) => setTrack(q, t.id, { mute: !t.mute }));
      } else if (!ctrl && k === 's') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t) edit((q) => setTrack(q, t.id, { solo: !t.solo }));
      } else if (!ctrl && k === 'l') {
        const s = currentLane(p, p.currentPatternId, st.selectedTrack).steps[st.selectedStep];
        if (s) edit((q) => setStep(q, q.currentPatternId, st.selectedTrack, st.selectedStep, { locked: !s.locked }));
      } else if (!ctrl && k === 'p') {
        setView((v) => (v === 'perform' ? 'edit' : 'perform'));
      } else if (!ctrl && k === 'g') {
        if (songModeRef.current || p.song.length) setSongMode(!songModeRef.current);
      } else if (!ctrl && k === 'k') {
        edit((q) => ({ ...q, metronome: !q.metronome }));
      } else if (!ctrl && k === 'a') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t?.sound.sampleId) audition(t.sound.sampleId, t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, togglePlay, dispatch, save, guarded, edit, notify, selectPattern, audition, askRemovePattern, setSongMode]);

  // --- derived ---
  const track = project.tracks.find((t) => t.id === state.selectedTrack) ?? project.tracks[0];
  const trackIndex = project.tracks.indexOf(track);
  const lane = pattern.lanes[track.id];
  const step = lane.steps[state.selectedStep] ?? lane.steps[0];
  const sampleStatus = useCallback((id: string) => engineRef.current?.sampleStatus(id), []);
  // Not memoised: sample status lives in the engine and changes without a project change.
  const usedMissing = project.tracks.filter((t) => t.sound.sampleId && sampleStatus(t.sound.sampleId) === 'missing').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Ba-da-boom</div>
        <div className="group" role="toolbar" aria-label="File">
          <button onClick={() => guarded('new')} title="New project">New</button>
          <button onClick={() => guarded('open')} title="Open project (Ctrl+O)">Open</button>
          <button onClick={() => save(false)} title="Save (Ctrl+S)">Save</button>
          <button onClick={() => save(true)} title="Save as (Ctrl+Shift+S)">Save as</button>
          <button onClick={() => setModal({ kind: 'export' })} title="Export WAV (Ctrl+E)">Export WAV</button>
        </div>
        <div className="group" role="toolbar" aria-label="Edit">
          <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.past.length} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={() => dispatch({ type: 'redo' })} disabled={!state.history.future.length} title="Redo (Ctrl+Y)">Redo</button>
        </div>
        <div className="group transport" role="toolbar" aria-label="Transport">
          <button className={`play ${playing ? 'on' : ''}`} onClick={togglePlay} disabled={!engineReady} title="Play / stop (Space)">
            {playing ? '■ Stop' : '▶ Play'}
          </button>
          <label className="num">
            BPM
            <input
              type="number"
              min={20}
              max={300}
              step={0.1}
              value={project.bpm}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 20 && v <= 300) edit((p) => ({ ...p, bpm: v }), 'bpm');
              }}
            />
          </label>
          <Slider label="Swing" value={project.swing} min={50} max={75} step={0.5} format={(v) => `${v.toFixed(1)}%`} onChange={(v, k) => edit((p) => ({ ...p, swing: v }), k)} />
          <button className={`toggle ${project.metronome ? 'on' : ''}`} aria-pressed={project.metronome} onClick={() => edit((p) => ({ ...p, metronome: !p.metronome }))} title="Metronome (K)">
            Click
          </button>
        </div>
        <div className="group master" aria-label="Master">
          <Slider label="Master" value={project.masterVolume} min={0} max={1.5} format={db} onChange={(v, k) => edit((p) => ({ ...p, masterVolume: v }), k)} />
          <div className="master-meters">
            <div className="meter h"><div className="meter-fill" ref={masterL} /></div>
            <div className="meter h"><div className="meter-fill" ref={masterR} /></div>
          </div>
          <button ref={clipRef} className="clip" title="Clip indicator: the mix went over 0 dBFS. Click to reset." onClick={() => engineRef.current?.resetClip()}>
            CLIP
          </button>
          <span ref={limitRef} className="limit" title="The safety limiter is reducing gain">LIM</span>
        </div>
        <button className={`view-toggle ${view === 'perform' ? 'on' : ''}`} aria-pressed={view === 'perform'} onClick={() => setView(view === 'perform' ? 'edit' : 'perform')} title="Performance view: big pattern pads and track mutes (P)">
          {view === 'perform' ? 'Edit view' : 'Perform'}
        </button>
        <button className="about" onClick={async () => {
          const info = await desktop.appInfo();
          setModal({ kind: 'about', notices: info.notices, version: info.version, platform: `${info.platform} · Electron ${info.electron}` });
        }}>About</button>
      </header>

      <nav className="patternbar" aria-label="Patterns">
        {project.patterns.map((pt, i) => (
          <button
            key={pt.id}
            className={`pattern-btn ${pt.id === project.currentPatternId ? 'current' : ''} ${pt.id === audiblePattern ? 'playing' : ''} ${pt.id === queuedPattern ? 'queued' : ''}`}
            onClick={() => selectPattern(pt.id)}
            title={`Pattern ${pt.name}${i < 8 ? ` (${i + 1})` : ''}. While playing, switches at the next bar. Drag to reorder.`}
            {...reorderProps('application/x-bdb-pattern', i, (from, to) => edit((p) => movePattern(p, p.patterns[from].id, to)))}
          >
            {pt.name}
          </button>
        ))}
        <button
          className="small"
          onClick={() => edit((p) => ({ ...p, patterns: [...p.patterns, emptyPattern(p.tracks, patternName(p.patterns.length))] }))}
          title="Add pattern"
        >
          +
        </button>
        <span className="sep" />
        <button className="small" onClick={() => edit((p) => duplicatePattern(p, p.currentPatternId))} title="Duplicate pattern (Ctrl+D)">Duplicate</button>
        <button className="small" onClick={() => edit((p) => clearPattern(p, p.currentPatternId))} title="Clear every step in this pattern (Shift+Delete)">Clear</button>
        <button className="small" disabled={project.patterns.length <= 1} onClick={() => askRemovePattern(project.currentPatternId)} title="Remove this pattern from the project (Ctrl+Delete)">Remove</button>
        <button className="small" onClick={() => { dispatch({ type: 'copyPattern', pattern }); notify('Pattern copied'); }} title="Copy pattern (Ctrl+Shift+C)">Copy</button>
        <button className="small" disabled={!state.patternClipboard} onClick={() => state.patternClipboard && edit((p) => pastePattern(p, p.currentPatternId, state.patternClipboard!))} title="Paste pattern (Ctrl+Shift+V)">Paste</button>
        <label className="num small">
          Steps
          <select value="" onChange={(e) => e.target.value && edit((p) => setPatternLength(p, p.currentPatternId, Number(e.target.value)))} title="Set every lane in this pattern to the same length">
            <option value="">set all…</option>
            {[8, 12, 16, 24, 32, 48, 64].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="sep" />
        <span className="hint">Edit lane: Ctrl+C / Ctrl+V · Delete clears lane</span>
      </nav>

      <SongBar
        project={project}
        songMode={songMode}
        playingIndex={playing ? songIndex : -1}
        onMode={setSongMode}
        onAdd={() => edit((p) => songAdd(p, p.currentPatternId))}
        onRemove={(i) => edit((p) => songRemove(p, i))}
        onMove={(i, to) => edit((p) => songMove(p, i, to))}
        onBars={(i, b) => edit((p) => songSetBars(p, i, b), `songbars:${i}`)}
        onLoop={(loop) => edit((p) => ({ ...p, songLoop: loop }))}
        onSelect={(id) => dispatch({ type: 'transient', fn: (p) => ({ ...p, currentPatternId: id }) })}
      />

      {view === 'perform' ? (
        <main className="workspace performing">
          <section className="center">
            <Perform
              project={project}
              playing={playing}
              audiblePattern={audiblePattern}
              queuedPattern={queuedPattern}
              songMode={songMode}
              songIndex={songIndex}
              meterRef={meterRef}
              positionRef={positionRef}
              onPlay={togglePlay}
              onPattern={selectPattern}
              onSongMode={setSongMode}
              onTrack={onTrack}
            />
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="left">
            <SampleBrowser
              project={project}
              selectedSampleId={track.sound.sampleId}
              status={sampleStatus}
              onAudition={(id) => audition(id)}
              onAssign={(id) => assignSample(track.id, id)}
              onImport={(files) => importFiles(files)}
            />
          </aside>
          <section className="center">
            <Grid
              project={project}
              pattern={pattern}
              selectedTrack={state.selectedTrack}
              selectedStep={state.selectedStep}
              sampleStatus={sampleStatus}
              onToggle={onToggle}
              onSelect={onSelect}
              onTrack={onTrack}
              onLength={onLength}
              onDropFiles={(id, files) => importFiles(files, id)}
              onDropSample={assignSample}
              meterRef={meterRef}
              rowRef={rowRef}
            />
            <Generate
              trackIndex={trackIndex}
              laneLength={lane.length}
              lockedCount={lane.steps.filter((s) => s.locked).length}
              patternName={pattern.name}
              onVariation={(opts) => {
                const next = addVariation(projectRef.current, projectRef.current.currentPatternId, opts);
                edit(() => next);
                // While playing, the new pattern comes in at the next bar, like pressing its number.
                engineRef.current?.switchPattern(next.currentPatternId);
                notify(`Pattern ${currentPattern(next).name} added`);
              }}
              onEuclid={(bits) => {
                edit((p) => setLane(p, p.currentPatternId, track.id, (l) => applySteps(l, bits)));
                notify(`Euclidean rhythm written to track ${trackIndex + 1}`);
              }}
              onRandomise={(opts, scope) => {
                const ids = scope === 'track' ? [track.id] : project.tracks.map((t) => t.id);
                edit((p) =>
                  ids.reduce((q, id) => setLane(q, q.currentPatternId, id, (l) => randomiseLane(l, { ...opts, salt: p.tracks.findIndex((t) => t.id === id) })), p),
                );
                notify(`Randomised ${scope === 'track' ? `track ${trackIndex + 1}` : 'all tracks'} (seed ${opts.seed})`);
              }}
            />
          </section>
          <aside className="right">
            <Inspector
              track={track}
              trackIndex={trackIndex}
              step={step}
              stepIndex={state.selectedStep}
              laneLength={lane.length}
              sampleName={track.sound.sampleId ? project.samples[track.sound.sampleId]?.name ?? 'Unknown' : 'None'}
            sampleBuffer={track.sound.sampleId ? engineRef.current?.sampleBuffer(track.sound.sampleId) : undefined}
              onStep={(patch, k) => edit((p) => setStep(p, p.currentPatternId, track.id, state.selectedStep, patch), k && `step:${k}`)}
              onSound={(patch, k) => edit((p) => setTrackSound(p, track.id, patch), k && `sound:${k}`)}
              onRename={(name) => edit((p) => setTrack(p, track.id, { name }), `rename:${track.id}`)}
              onAudition={() => track.sound.sampleId && audition(track.sound.sampleId, track.id)}
            />
          </aside>
        </main>
      )}

      <footer className="statusbar">
        <span>{state.path ?? 'Not saved yet'}{dirty ? ' · unsaved changes' : ''}</span>
        {usedMissing > 0 && <span className="warn">{usedMissing} track(s) have missing samples</span>}
        {engineError && <span className="warn">Audio engine failed to start: {engineError}</span>}
        <span className="right-info">
          {engineRef.current ? `${engineRef.current.ac.sampleRate} Hz` : ''}
          {!inElectron && ' · browser test mode'}
          {' · Space play/stop · arrows + Enter edit · 1–8 patterns'}
        </span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}

      {modal?.kind === 'recover' && (
        <Dialog title="Recover unsaved work?">
          <p>Ba-da-boom did not close normally last time. Your most recent autosave can be restored.</p>
          {modal.missing.length > 0 && <p className="warn">{modal.missing.length} imported sample(s) from that session could not be found.</p>}
          <div className="actions">
            <button onClick={() => setModal(null)}>Start fresh</button>
            <button className="primary" onClick={() => { loadText(modal.text, null, false, modal.missing); setModal(null); }}>Recover</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'unsaved' && (
        <Dialog title="Save changes?">
          <p>This project has unsaved changes.</p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button onClick={async () => {
              const then = modal.then;
              setModal(null);
              if (then === 'close') await desktop.closeReady();
              else if (then === 'new') newDoc();
              else open();
            }}>Don't save</button>
            <button className="primary" onClick={async () => {
              const then = modal.then;
              if (!(await save(false))) return;
              setModal(null);
              if (then === 'close') await desktop.closeReady();
              else if (then === 'new') newDoc();
              else open();
            }}>Save</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'removePattern' && (() => {
        const pt = project.patterns.find((x) => x.id === modal.id);
        const u = patternUsage(project, modal.id);
        return (
          <Dialog title={`Remove pattern ${pt?.name}?`}>
            <p>
              Pattern {pt?.name} has {u.hits} step{u.hits === 1 ? '' : 's'} switched on
              {u.songEntries ? ` and is used ${u.songEntries} time${u.songEntries === 1 ? '' : 's'} in the song. Those song entries are removed too` : ''}.
            </p>
            <p>You can undo this with Ctrl+Z.</p>
            <div className="actions">
              <button onClick={() => setModal(null)}>Cancel</button>
              <button className="primary danger" onClick={() => { setModal(null); doRemovePattern(modal.id); }}>Remove</button>
            </div>
          </Dialog>
        );
      })()}

      {modal?.kind === 'export' && (
        <Dialog title={`Export ${exportSong && project.song.length ? 'song' : `pattern ${pattern.name}`}`}>
          <div className="export-what" role="radiogroup" aria-label="Format">
            <label className="check">
              <input type="radio" name="export-format" checked={exportFormat === 'wav'} onChange={() => setExportFormat('wav')} /> WAV mix
            </label>
            <label className="check">
              <input type="radio" name="export-format" checked={exportFormat === 'stems'} onChange={() => setExportFormat('stems')} /> Stems (one WAV per track)
            </label>
            <label className="check">
              <input type="radio" name="export-format" checked={exportFormat === 'midi'} onChange={() => setExportFormat('midi')} /> MIDI
            </label>
          </div>
          {exportFormat === 'midi' ? (
            <p>A Standard MIDI File with one track per drum track on channel 10, using General MIDI drum notes. Ratchets, microtiming and swing are included.</p>
          ) : (
            <p>
              Renders offline at 44.1 kHz, 24-bit stereo, through the same sounds, effects and master chain as playback. Effect tails ring out after the last bar and are trimmed once silent. The metronome is not included.
              {exportFormat === 'stems' && ' Each audible track (mute and solo are respected) gets its own file with its own delay and reverb. All stems have the same length, so they line up in a DAW.'}
            </p>
          )}
          <p>Probability uses the project seed ({project.seed}), so the same project always exports the same result, matching playback from the start.</p>
          {project.song.length > 0 && (
            <div className="export-what" role="radiogroup" aria-label="What to export">
              <label className="check">
                <input type="radio" name="export-what" checked={!exportSong} onChange={() => setExportSong(false)} /> Pattern {pattern.name}
              </label>
              <label className="check">
                <input type="radio" name="export-what" checked={exportSong} onChange={() => setExportSong(true)} /> Song ({songBars(project)} bars, played once)
              </label>
            </div>
          )}
          <label className="num" hidden={exportSong && project.song.length > 0}>
            Bars
            <select value={exportBars || defaultBars} onChange={(e) => setExportBars(Number(e.target.value))}>
              {[1, 2, 4, 8, 16, 32].concat(defaultBars).sort((a, b) => a - b).filter((v, i, a) => a.indexOf(v) === i).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="actions">
            <button onClick={() => setModal(null)} disabled={exporting}>Cancel</button>
            <button className="primary" onClick={doExport} disabled={exporting}>{exporting ? `Rendering… ${exportProgress}` : 'Export'}</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'about' && (
        <Dialog title="About Ba-da-boom" wide>
          <p>Version {modal.version} · {modal.platform}</p>
          <p>
            Ba-da-boom is free software under the GNU Affero General Public License v3.0 or later. Its pattern engine and audio
            engine are <strong>Strudel</strong> (strudel.cc), © Strudel contributors, also AGPL-3.0-or-later. You can get the
            complete source code of this version at https://github.com/theappreview1277-blip/ba-da-boom.
          </p>
          <p>Factory sounds are synthesised by the project and released under CC0 1.0.</p>
          <pre className="notices">{modal.notices || 'Third-party notices are included with the installed app.'}</pre>
          <div className="actions"><button className="primary" onClick={() => setModal(null)}>Close</button></div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
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
