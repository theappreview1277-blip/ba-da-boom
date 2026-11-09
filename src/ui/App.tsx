import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  renamePattern,
  PATTERN_NAME_MAX,
  patternUsage,
  removePattern,
  songAdd,
  songBars,
  songMove,
  songRemove,
  songSetBars,
} from '../model/ops';
import { applySteps, randomiseLane } from '../model/generate';
import { FACTORY_SAMPLES } from '../model/factory';
import { kitAssignments, kitLabel, kitSampleName } from '../model/kits';
import type { FolderListing, KitProgress, KitSample, Settings, SoundSettings as SoundPrefs, StepLane as LaneKind, ToolTab, UpdateState } from '../main/ipc';
import { parseProject, serializeProject } from '../model/serialize';
import { STEPS_PER_BAR, type Project, type SampleRef } from '../model/types';
import { NumberField, Slider, db } from './controls';
import { desktop, inElectron, sampleUrl } from './desktop';
import { Grid, gridPage, trackHeadWidth, type GridPage } from './Grid';
import { StepLane } from './StepLane';
import { Icon } from './icons';
import { trackColor } from './colors';
import { Generate } from './Generate';
import { SmartBeats } from './SmartBeats';
import { addClassicPatterns, addFillPattern, classicById, classicVariant, completeBeat, fillPattern, generateBeat, humanise, loadClassic, resolveFillType, styleById, FILL_TYPES } from '../model/rhythm';
import { BeatLibrary } from './BeatLibrary';
import { Inspector } from './Inspector';
import { SampleBrowser } from './SampleBrowser';
import { Splitter } from './Splitter';
import { Perform } from './Perform';
import { SongBar } from './SongBar';
import { reorderProps } from './reorder';
import { useUiStore } from './store';
import { SAMPLE_FILE, sampleName } from '../model/audioFiles';
import { toWav } from '../engine/audio/convert';
import { Pads } from './Pads';
import { Mixer } from './Mixer';
import { Logo } from './Logo';
import { SoundSettings } from './SoundSettings';
import { UpdateBanner, updateText } from './Updates';
import { findOutput, listOutputs, Midi, type MidiState, type OutputDevice } from './devices';
import { ASSIGNABLE_KEY, assignKey, assignNote, hitStep, keyToPad, noteName, noteToPad, padKeyList, padNoteList, resetPadAssignments } from '../model/live';

const AUTOSAVE_MS = 5000;

const TOOLS: { id: ToolTab; label: string; title: string }[] = [
  { id: 'library', label: 'Beat library', title: 'Named classic beats and their variants' },
  { id: 'beats', label: 'Beat intelligence', title: 'Style generator, complete my beat, fills and humanise' },
  { id: 'generate', label: 'Generate', title: 'Euclidean rhythms, randomise and variations' },
  { id: 'pads', label: 'Pads', title: 'Drum pads to play and record live, with the mouse, the keyboard or a MIDI controller' },
  { id: 'mixer', label: 'Mixer', title: 'Every track side by side: level, pan, reverb and delay, mute and solo' },
];

const patternName = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26) + 1) : '');

type Modal =
  | { kind: 'recover'; text: string; missing: string[]; launch: string | null }
  | { kind: 'export' }
  | { kind: 'settings' }
  | { kind: 'welcome' }
  | { kind: 'removePattern'; id: string }
  | { kind: 'about'; notices: string; version: string; platform: string; logFile: string }
  | { kind: 'unsaved'; then: 'close' | 'new' | 'open' | 'update'; path?: string }
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
  /** The pattern whose name is being typed in the pattern bar. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' });
  // "Later" hides the corner note until the update moves on (say, from downloading to ready).
  const [updateLater, setUpdateLater] = useState<string | null>(null);
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
  /** Shows a problem to the user and writes it to the error log. */
  const fail = useCallback(
    (msg: string) => {
      notify(msg);
      desktop.log('error', msg).catch(() => {});
    },
    [notify],
  );

  // Anything that goes wrong without being caught ends up in the error log too.
  useEffect(() => {
    const onError = (e: ErrorEvent) => desktop.log('error', `Uncaught: ${e.error?.stack ?? e.message} (${e.filename}:${e.lineno})`).catch(() => {});
    const onRejection = (e: PromiseRejectionEvent) => desktop.log('error', `Unhandled promise: ${e.reason?.stack ?? e.reason}`).catch(() => {});
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // --- audio engine lifecycle ---
  useEffect(() => {
    const engine = new AudioEngine(sampleUrl);
    engine.onSampleStatus = () => setStatusTick((n) => n + 1);
    engine.onError = (m) => fail(`Playback error: ${m}`);
    engineRef.current = engine;
    engine
      .init()
      .then(() => {
        engine.update(projectRef.current);
        setEngineReady(true);
        return engine.loadSamples(projectRef.current);
      })
      .catch((e) => {
        setEngineError(String(e));
        desktop.log('error', `Audio engine failed to start: ${e?.stack ?? e}`).catch(() => {});
      });
    // For automated tests and diagnostics.
    Object.assign(window as any, { __engine: engine, __bdb: { renderPattern, encodeWav24, parseProject, serializeProject } });
  }, [fail]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engineReady) return;
    engine.update(project);
  }, [project, engineReady]);

  useEffect(() => {
    if (engineReady) engineRef.current?.loadSamples(project);
  }, [project.samples, engineReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- the bars on screen: whole bars that fit the width, turned by the playhead ---
  const [pageIndex, setPageIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [gridWidth, setGridWidth] = useState(900);
  const gridObserver = useRef<ResizeObserver | null>(null);
  const gridAreaRef = useCallback((el: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    gridObserver.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridWidth(el.clientWidth));
    ro.observe(el);
    gridObserver.current = ro;
    setGridWidth(el.clientWidth);
  }, []);
  const totalSteps = Math.max(STEPS_PER_BAR, Math.ceil(Math.max(...project.tracks.map((t) => pattern.lanes[t.id]?.length ?? STEPS_PER_BAR)) / STEPS_PER_BAR) * STEPS_PER_BAR);
  const page: GridPage = useMemo(() => gridPage(totalSteps, gridWidth - 20, pageIndex, trackHeadWidth(window.innerWidth)), [totalSteps, gridWidth, pageIndex]);
  const pageRef = useRef({ ...page, follow });
  pageRef.current = { ...page, follow };
  useEffect(() => setPageIndex(0), [project.currentPatternId]);
  useEffect(() => {
    // Fewer pages after a lane got shorter or the window wider: stay on a page that exists.
    const pages = Math.ceil(page.total / page.steps);
    if (pageIndex >= pages) setPageIndex(pages - 1);
  }, [page.total, page.steps, pageIndex]);

  // --- playhead and meters, drawn on animation frames, independent of scheduling ---
  const rows = useRef(new Map<string, HTMLDivElement>());
  const rowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  }, []);
  const trackMeters = useRef<(HTMLDivElement | null)[]>([]);
  const meterRef = useCallback((i: number) => (el: HTMLDivElement | null) => void (trackMeters.current[i] = el), []);
  const mixerMeters = useRef<(HTMLDivElement | null)[]>([]);
  const mixerMeterRef = useCallback((i: number) => (el: HTMLDivElement | null) => void (mixerMeters.current[i] = el), []);
  const mixerMaster = useRef<HTMLDivElement | null>(null);
  const mixerMasterRef = useCallback((el: HTMLDivElement | null) => void (mixerMaster.current = el), []);
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
      const pg = pageRef.current;
      if (shown != null && pg.follow && engine.isPlaying) {
        // Turn the page when the playhead leaves it.
        const g = Math.floor(shown * STEPS_PER_BAR) % pg.total;
        if (g < pg.start || g >= pg.start + pg.steps) setPageIndex(Math.floor(g / pg.steps));
      }
      for (const t of p.tracks) {
        const row = rows.current.get(t.id);
        if (!row) continue;
        let el: HTMLElement | undefined;
        if (shown != null) {
          const len = pat.lanes[t.id]?.length ?? 16;
          const at = (Math.floor(shown * STEPS_PER_BAR) % len) - pg.start;
          el = at >= 0 && at < pg.steps ? (row.children[at] as HTMLElement | undefined) : undefined;
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
        const mx = mixerMeters.current[i];
        if (mx) mx.style.transform = `scaleY(${level(v)})`;
      });
      if (mixerMaster.current) mixerMaster.current.style.transform = `scaleY(${level(Math.max(m.left, m.right))})`;
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
  const onPaint = useCallback(
    (trackId: string, step: number, on: boolean, gesture: string) =>
      edit((p) => (currentLane(p, p.currentPatternId, trackId).steps[step]?.on === on ? p : setStep(p, p.currentPatternId, trackId, step, { on })), gesture),
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
        if (!SAMPLE_FILE.test(f.name)) {
          notify(`${f.name}: use WAV, MP3, FLAC or OGG sound files.`);
          continue;
        }
        try {
          const bytes = await toWav(f.name, new Uint8Array(await f.arrayBuffer()));
          const { file } = await desktop.importSample(f.name, bytes);
          const id = `user:${file}`;
          const ref: SampleRef = { id, name: sampleName(f.name), source: 'user', file, originalName: f.name };
          edit((p) => ({ ...p, samples: { ...p.samples, [id]: ref } }));
          lastId = id;
        } catch (e) {
          fail(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (assignTo && lastId) {
        const id = lastId;
        edit((p) => setTrackSound(p, assignTo, { sampleId: id }));
      }
      if (lastId) notify(`Imported ${files.length === 1 ? files[0].name : `${files.length} files`}`);
    },
    [edit, notify, fail],
  );

  // Strudel drum machine kits, downloaded when picked.
  const [kits, setKits] = useState<Record<string, Record<string, number>>>({});
  const [kitProgress, setKitProgress] = useState<KitProgress | null>(null);
  // Progress messages can arrive after the load has finished; only the running load's count.
  const kitLoading = useRef<string | null>(null);
  useEffect(() => {
    desktop.kitList().then(setKits, () => {});
    desktop.onKitProgress((p) => {
      if (p.kit === kitLoading.current) setKitProgress(p);
    });
  }, []);
  const loadKit = useCallback(
    async (name: string) => {
      if (name === 'factory') {
        edit((p) => ({ ...p, tracks: p.tracks.map((t, i) => (FACTORY_SAMPLES[i] ? { ...t, sound: { ...t.sound, sampleId: `factory:${FACTORY_SAMPLES[i].key}` } } : t)) }));
        notify('Factory kit on every track');
        return;
      }
      if (kitLoading.current) return;
      kitLoading.current = name;
      setKitProgress({ kit: name, done: 0, total: 0 });
      try {
        const r = await desktop.kitDownload(name);
        const got: Record<string, KitSample[]> = {};
        for (const s of r.samples) (got[s.sound] ??= []).push(s);
        const refs: Record<string, SampleRef> = {};
        for (const [sound, list] of Object.entries(got)) {
          list.sort((a, b) => a.index - b.index);
          list.forEach((s, i) => {
            const id = `user:${s.file}`;
            // Kits sometimes contain the same file twice; the first name wins.
            if (!refs[id]) refs[id] = { id, name: kitSampleName(name, sound, i, list.length), source: 'user', file: s.file, kit: name };
          });
        }
        const plan = kitAssignments(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.map((s) => s.file)])), projectRef.current.tracks.length);
        edit((p) => ({
          ...p,
          samples: { ...p.samples, ...refs },
          tracks: p.tracks.map((t, i) => {
            const a = plan[i];
            return a ? { ...t, sound: { ...t.sound, sampleId: `user:${got[a[0]][a[1]].file}` } } : t;
          }),
        }));
        const kept = projectRef.current.tracks.filter((_, i) => !plan[i]).map((t) => t.name);
        (window as any).__lastKit = { ...r, assigned: plan.filter(Boolean).length, kept };
        notify(
          `${kitLabel(name)}${r.downloaded ? ' downloaded' : ''}: on ${plan.filter(Boolean).length} of ${plan.length} tracks` +
            (kept.length ? ` (no sound for ${kept.join(', ')}, kept as before)` : '') +
            (r.failed ? `. ${r.failed} file${r.failed === 1 ? '' : 's'} could not be loaded.` : ''),
        );
      } catch (e) {
        fail(`Could not load ${kitLabel(name)}: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e}`);
      } finally {
        kitLoading.current = null;
        setKitProgress(null);
      }
    },
    [edit, notify, fail],
  );
  const currentKit = useMemo(() => {
    const ids = project.tracks.map((t) => t.sound.sampleId ?? '');
    if (ids.every((id, i) => !FACTORY_SAMPLES[i] || id === `factory:${FACTORY_SAMPLES[i].key}`)) return 'factory';
    const used = new Set(ids.map((id) => project.samples[id]?.kit).filter(Boolean));
    return used.size === 1 ? [...used][0]! : '';
  }, [project.tracks, project.samples]);

  /** Put a sample on a track; `ref` adds it to the project first (one undo step for both). */
  const assignSample = useCallback(
    (trackId: string, sampleId: string, ref?: SampleRef) => {
      edit((p0) => {
        const p = ref && !p0.samples[ref.id] ? { ...p0, samples: { ...p0.samples, [ref.id]: ref } } : p0;
        const name = p.samples[sampleId]?.name;
        const t = p.tracks.find((x) => x.id === trackId);
        const renamed = t && name && t.name === p.samples[t.sound.sampleId ?? '']?.name ? setTrack(p, trackId, { name }) : p;
        return setTrackSound(renamed, trackId, { sampleId });
      });
    },
    [edit],
  );

  // The user's sample folders, favourites and panel widths (kept in the app's settings).
  const [folders, setFolders] = useState<FolderListing[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Settings['layout']>({});
  const [sound, setSound] = useState<SoundPrefs>({});
  const [soundLoaded, setSoundLoaded] = useState(false);
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  useEffect(() => {
    desktop.settingsGet().then((s) => {
      setFavourites(new Set(s.favourites));
      setLayout(s.layout);
      setSound(s.sound ?? {});
      setSoundLoaded(true);
    }, () => setSoundLoaded(true));
    desktop.folderList().then(setFolders, () => {});
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const folderSample = useCallback(async (folder: string, file: string): Promise<SampleRef> => {
    const base = file.split('/').pop()!;
    const got = await desktop.folderRead(folder, file);
    const pool = 'file' in got ? got.file : (await desktop.importSample(base, await toWav(base, got.bytes))).file;
    return { id: `user:${pool}`, name: sampleName(base), source: 'user', file: pool, originalName: base };
  }, []);
  const folderError = useCallback((file: string, e: unknown) => fail(`Could not use ${file}: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e}`), [fail]);
  const auditionFolderFile = useCallback(
    async (folder: string, file: string) => {
      try {
        const ref = await folderSample(folder, file);
        const engine = engineRef.current;
        if (engine && (projectRef.current.samples[ref.id] || (await engine.previewSample(ref)))) engine.audition(ref.id);
        (window as any).__lastPreview = ref;
      } catch (e) {
        folderError(file, e);
      }
    },
    [folderSample, folderError],
  );
  const assignFolderFile = useCallback(
    async (trackId: string, folder: string, file: string) => {
      try {
        const ref = await folderSample(folder, file);
        assignSample(trackId, ref.id, projectRef.current.samples[ref.id] ?? ref);
      } catch (e) {
        folderError(file, e);
      }
    },
    [folderSample, folderError, assignSample],
  );
  const addFolder = useCallback(async () => {
    const l = await desktop.folderAdd().catch(() => null);
    if (!l) return;
    setFolders((fs) => [...fs.filter((f) => f.path !== l.path), l]);
    notify(`Added ${l.path}: ${l.files.length}${l.truncated ? '+' : ''} sound file${l.files.length === 1 ? '' : 's'}`);
  }, [notify]);
  const removeFolder = useCallback(
    async (path: string) => {
      await desktop.folderRemove(path);
      setFolders((fs) => fs.filter((f) => f.path !== path));
      notify(`Removed ${path} from the list. The files are still there.`);
    },
    [notify],
  );
  const toggleFavourite = useCallback((key: string) => {
    setFavourites((f) => {
      const n = new Set(f);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      desktop.settingsSet({ favourites: [...n] }).catch(() => {});
      return n;
    });
  }, []);
  // Panel widths: the defaults follow the window size (as in styles.css); custom widths
  // are kept, but squeezed when the window is too small to leave room for a whole bar.
  const panels = useMemo(() => {
    const [dl, dr] = winWidth > 1320 ? [220, 330] : winWidth > 1100 ? [170, 280] : [130, 240];
    const room = winWidth - (winWidth > 1320 ? 760 : 640);
    let left = layout.left ?? dl;
    let right = layout.right ?? dr;
    const over = left + right - room;
    if (over > 0) {
      left = Math.max(120, Math.round(left - (over * left) / (left + right)));
      right = Math.max(200, room - left);
    }
    return { left, right, room, custom: layout.left !== undefined || layout.right !== undefined };
  }, [winWidth, layout]);
  /** Close the welcome screen; it is not shown at start-up again (About shows it). */
  const endWelcome = useCallback(() => {
    setModal(null);
    desktop.settingsSet({ welcomed: true }).catch(() => {});
  }, []);
  const saveLayout = useCallback((next: Settings['layout']) => {
    setLayout(next);
    desktop.settingsSet({ layout: next }).catch(() => {});
  }, []);
  const tool: ToolTab = layout.tool ?? 'library';
  // Short windows start with the tools folded away, so all 16 tracks fit.
  const toolsOpen = layout.toolsOpen ?? window.innerHeight >= 860;
  const laneKind: LaneKind = layout.lane ?? 'velocity';

  // --- sound card, MIDI and drum pads ---
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const saveSound = useCallback((patch: Partial<SoundPrefs>) => {
    setSound((prev) => {
      const next = { ...prev, ...patch };
      if (next.output && !next.output.id) delete next.output;
      return next;
    });
    desktop.settingsSet({ sound: patch }).catch(() => {});
  }, []);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [activeOutput, setActiveOutput] = useState<OutputDevice | null>(null);
  /** Play through the saved sound card when it is connected, otherwise the system default. */
  const applyOutput = useCallback(async (announce: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    const list = await listOutputs();
    setOutputs(list);
    const saved = soundRef.current.output;
    const found = findOutput(list, saved);
    try {
      await engine.setOutput(found?.id ?? '');
      setActiveOutput(found);
      if (saved && !found && announce) notify(`${saved.label} is not connected, so sound plays through the system default.`);
    } catch (e) {
      setActiveOutput(null);
      if (saved) fail(`Could not play through ${saved.label}: ${e instanceof Error ? e.message : e}`);
    }
  }, [notify, fail]);
  useEffect(() => {
    if (!engineReady || !soundLoaded) return;
    void applyOutput(true);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    // A sound card plugged in or out: use the saved one again as soon as it is back.
    const onChange = () => void applyOutput(false);
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [engineReady, soundLoaded, applyOutput]);
  const chooseOutput = useCallback(
    (d: OutputDevice | null) => {
      soundRef.current = { ...soundRef.current, output: d ? { id: d.id, label: d.label } : undefined };
      // undefined is dropped on the way to the settings file, so the default is sent as an empty id.
      saveSound({ output: d ? { id: d.id, label: d.label } : { id: '', label: '' } });
      void applyOutput(false).then(() => notify(d ? `Playing through ${d.label}` : 'Playing through the system default'));
    },
    [saveSound, applyOutput, notify],
  );

  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const takes = useRef(0);
  const padEls = useRef(new Map<number, HTMLButtonElement>());
  const padRef = useCallback((i: number) => (el: HTMLButtonElement | null) => {
    if (el) padEls.current.set(i, el);
    else padEls.current.delete(i);
  }, []);
  /** A live hit on track `index`: play it, light its pad and, while recording, write it into the pattern. */
  const hit = useCallback(
    (index: number, velocity: number) => {
      const p = projectRef.current;
      const t = p.tracks[index];
      const engine = engineRef.current;
      if (!t || !engine) return;
      engine.hit(trackControls(t, index, p), t.sound.source === 'synth' ? null : t.sound.sampleId ?? null, velocity).catch(() => {});
      const pad = padEls.current.get(index);
      if (pad) {
        pad.classList.remove('hit');
        void pad.offsetWidth;
        pad.classList.add('hit');
      }
      if (!recordingRef.current || !engine.isPlaying) return;
      const cycle = engine.patternCycle();
      const patternId = engine.audiblePatternId;
      if (cycle == null || !patternId) return;
      const len = currentLane(p, patternId, t.id).length;
      const { step, micro } = hitStep(cycle, len, soundRef.current.quantise ?? true);
      edit((q) => setStep(q, patternId, t.id, step, { on: true, velocity: Math.round(velocity * 100) / 100, micro }), `rec:${takes.current}`);
    },
    [edit],
  );
  const hitRef = useRef(hit);
  hitRef.current = hit;
  const toggleRecordRef = useRef<() => Promise<void>>(async () => {});
  const toggleRecord = useCallback(async () => {
    if (recordingRef.current) {
      setRecording(false);
      return;
    }
    // Each time recording starts is one take, and one undo step.
    takes.current++;
    setRecording(true);
    const engine = engineRef.current;
    if (engine && !engine.isPlaying) {
      await engine.play();
      setPlaying(engine.isPlaying);
    }
  }, []);
  toggleRecordRef.current = toggleRecord;
  useEffect(() => {
    if (!playing) setRecording(false);
  }, [playing]);

  // Choosing each pad's key and MIDI note: the pad waiting for one (tracks.length: none picked yet), or null.
  const [assigning, setAssigning] = useState<number | null>(null);
  const assignRef = useRef(assigning);
  assignRef.current = assigning;
  const assignTo = useCallback(
    (pad: number, what: { key?: string; note?: number }) => {
      const t = projectRef.current.tracks[pad];
      if (!t) return;
      edit((p) => {
        let q = what.key !== undefined ? assignKey(p, t.id, what.key) : p;
        if (what.note !== undefined) q = assignNote(q, t.id, what.note);
        return q;
      });
      // A key chosen here should work straight away.
      if (what.key && !soundRef.current.padKeys) saveSound({ padKeys: true });
      if (what.key === '' && what.note === -1) notify(`${t.name} has no key or MIDI note now`);
      else if (what.key) notify(`Key ${what.key.toUpperCase()} plays ${t.name}`);
      else if (what.note !== undefined && what.note >= 0) notify(`MIDI note ${noteName(what.note)} (${what.note}) plays ${t.name}`);
      // On to the next pad, so a whole kit can be set up in one go.
      if (what.key !== '' && what.note !== -1) setAssigning((a) => (a === pad ? pad + 1 : a));
    },
    [edit, saveSound, notify],
  );
  const assignToRef = useRef(assignTo);
  assignToRef.current = assignTo;
  const padKeysShown = useMemo(() => padKeyList(project.tracks), [project.tracks]);
  const padNotesShown = useMemo(() => padNoteList(project.tracks, sound.midiMap ?? 'gm'), [project.tracks, sound.midiMap]);
  useEffect(() => {
    if (tool !== 'pads' || !toolsOpen) setAssigning(null);
  }, [tool, toolsOpen]);

  const midiRef = useRef<Midi | null>(null);
  const [midiState, setMidiState] = useState<MidiState>({ status: 'off', inputs: [] });
  const [lastNote, setLastNote] = useState<{ note: number; input: string; track: string | null } | null>(null);
  useEffect(() => {
    const midi = new Midi();
    midiRef.current = midi;
    midi.onState = setMidiState;
    midi.onNote = (note, velocity, input) => {
      const p = projectRef.current;
      const target = assignRef.current;
      if (target !== null && target < p.tracks.length) {
        // Choosing notes: this note now plays the pad waiting for one.
        assignToRef.current(target, { note });
        setLastNote({ note, input, track: p.tracks[target].name });
        hitRef.current(target, velocity);
        return;
      }
      const i = noteToPad(note, p.tracks, soundRef.current.midiMap ?? 'gm');
      setLastNote({ note, input, track: i == null ? null : p.tracks[i].name });
      if (i != null) hitRef.current(i, velocity);
    };
    void midi.start();
  }, []);
  useEffect(() => {
    if (midiRef.current) midiRef.current.only = sound.midiInput ?? null;
  }, [sound.midiInput]);
  const onDropFiles = useCallback((id: string, files: File[]) => importFiles(files, id), [importFiles]);

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
  /** Play a track's sound as it is set up: its sample, or its synth. */
  const auditionTrack = useCallback(
    (trackId: string) => {
      const p = projectRef.current;
      const i = p.tracks.findIndex((t) => t.id === trackId);
      const t = p.tracks[i];
      if (!t) return;
      if (t.sound.source === 'synth') {
        const controls = trackControls(t, i, p);
        delete controls.orbit;
        engineRef.current?.auditionSynth(controls);
      } else if (t.sound.sampleId) audition(t.sound.sampleId, t.id);
    },
    [audition],
  );

  // --- files ---
  const loadText = useCallback(
    (text: string, path: string | null, saved: boolean, missing: string[] = []) => {
      try {
        const p = parseProject(text);
        dispatch({ type: 'load', project: p, path, saved });
        if (missing.length) notify(`${missing.length} sample file(s) could not be found. Tracks using them are marked "missing".`);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [dispatch, notify, fail],
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
        fail(`Save failed: ${e instanceof Error ? e.message : e}`);
        return false;
      }
    },
    [dispatch, notify, fail],
  );

  /** Open a project: the one Windows handed over (`path`), or one picked in the Open dialog. */
  const open = useCallback(async (path?: string) => {
    try {
      const res = await desktop.openProject(path);
      if (res) {
        if (engineRef.current?.isPlaying) {
          await engineRef.current.stop();
          setPlaying(false);
        }
        loadText(res.text, res.path, true, res.missing);
      }
    } catch (e) {
      fail(`Open failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [loadText, fail]);

  const newDoc = useCallback(async () => {
    if (engineRef.current?.isPlaying) {
      await engineRef.current.stop();
      setPlaying(false);
    }
    const p = newProject();
    dispatch({ type: 'load', project: p, path: null, saved: true });
  }, [dispatch]);

  const guarded = useCallback(
    (then: 'new' | 'open', path?: string) => {
      if (stateRef.current.savedProject !== projectRef.current) setModal({ kind: 'unsaved', then, path });
      else if (then === 'new') newDoc();
      else open(path);
    },
    [newDoc, open],
  );
  const restartToUpdate = useCallback(async () => {
    await desktop.autosaveWrite(serializeProject(projectRef.current)).catch(() => {});
    if (stateRef.current.savedProject !== projectRef.current) setModal({ kind: 'unsaved', then: 'update' });
    else await desktop.updateInstall();
  }, []);
  const guardedRef = useRef(guarded);
  guardedRef.current = guarded;

  // --- autosave and recovery, and project files opened from Windows ---
  useEffect(() => {
    Promise.all([desktop.autosaveRecover(), desktop.launchFile().catch(() => null), desktop.settingsGet().catch(() => null)]).then(([r, launch, settings]) => {
      // Unsaved work from a crash comes first; the file opens if the user starts fresh.
      if (r) setModal({ kind: 'recover', text: r.text, missing: r.missing, launch });
      else if (launch) guardedRef.current('open', launch);
      // The first time the app starts on its own, say hello.
      else if (settings && !settings.welcomed) setModal({ kind: 'welcome' });
    });
    desktop.onOpenFile((path) => guardedRef.current('open', path));
    desktop.onUpdateState(setUpdate);
    desktop.updateGet().then(setUpdate).catch(() => {});
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
      fail(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  }, [defaultBars, exportBars, exportSong, exportFormat, notify, fail]);

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
      const waiting = assignRef.current;
      if (waiting !== null && !ctrl && !e.altKey) {
        // Choosing keys: the next key pressed goes to the pad waiting for one.
        if (e.key === 'Escape') setAssigning(null);
        else if (waiting >= p.tracks.length) {
          if (e.key.length !== 1) return;
          notify('Click the pad to give that key to first.');
        } else if ((e.key === 'Backspace' || e.key === 'Delete')) assignToRef.current(waiting, { key: '', note: -1 });
        else if (ASSIGNABLE_KEY.test(k)) {
          if (!e.repeat) {
            assignToRef.current(waiting, { key: k });
            hitRef.current(waiting, 0.8);
          }
        } else if (e.key.length === 1 || e.key === 'Enter') notify(`${e.key === ' ' ? 'Space' : e.key} can't play a pad. Use a letter, a number or a punctuation key.`);
        else return; // Tab, arrows and the like keep working.
        e.preventDefault();
        return;
      }
      const pad = soundRef.current.padKeys && !ctrl && !e.altKey ? keyToPad(k, p.tracks) : -1;
      if (pad >= 0) {
        // While "Keys play pads" is on, these letters play the pads instead of their shortcuts.
        e.preventDefault();
        if (!e.repeat && pad < p.tracks.length) hitRef.current(pad, 0.8);
        return;
      }
      if (!ctrl && !e.altKey && k === 'r') {
        e.preventDefault();
        if (!e.repeat) void toggleRecordRef.current();
        return;
      }
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
      } else if (e.key === 'F2') {
        e.preventDefault();
        setRenaming(p.currentPatternId);
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
        if (t) auditionTrack(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, togglePlay, dispatch, save, guarded, edit, notify, selectPattern, auditionTrack, askRemovePattern, setSongMode]);

  // --- top bar: hide button names step by step until it fits on one line ---
  const topbarRef = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(0);
  const fitTopbar = useCallback(() => {
    const el = topbarRef.current;
    if (!el) return;
    // One line when no item has wrapped below the first one.
    const oneLine = () => {
      const items = [...el.children] as HTMLElement[];
      const top = items[0]?.getBoundingClientRect().bottom ?? 0;
      return items.every((c) => c.getBoundingClientRect().top < top);
    };
    const apply = (level: number) => {
      el.classList.remove('c1', 'c2', 'c3', 'c4', 'c5');
      for (let i = 1; i <= level; i++) el.classList.add(`c${i}`);
    };
    let level = 0;
    for (; level < 5; level++) {
      apply(level);
      if (oneLine()) break;
    }
    apply(level);
    setCompact(level);
  }, []);
  useLayoutEffect(fitTopbar, [fitTopbar, winWidth, view, playing]);
  useEffect(() => {
    // Fonts can arrive after the first layout and change the widths.
    document.fonts?.ready.then(fitTopbar).catch(() => {});
  }, [fitTopbar]);

  // --- derived ---
  const track = project.tracks.find((t) => t.id === state.selectedTrack) ?? project.tracks[0];
  const trackIndex = project.tracks.indexOf(track);
  const lane = pattern.lanes[track.id];
  const step = lane.steps[state.selectedStep] ?? lane.steps[0];
  const sampleStatus = useCallback((id: string) => engineRef.current?.sampleStatus(id), []);
  // Not memoised: sample status lives in the engine and changes without a project change.
  const usedMissing = project.tracks.filter((t) => t.sound.source === 'sample' && t.sound.sampleId && sampleStatus(t.sound.sampleId) === 'missing').length;

  return (
    <div className="app">
      <header className={`topbar ${compact ? Array.from({ length: compact }, (_, i) => `c${i + 1}`).join(' ') : ''}`} ref={topbarRef}>
        <div className="brand">
          <Logo size={22} />
          <span className="lbl">Ba-da-boom</span>
        </div>
        <div className="group" role="toolbar" aria-label="File">
          <button className="tb" onClick={() => guarded('new')} title="New project" aria-label="New"><Icon name="new" /><span className="lbl">New</span></button>
          <button className="tb" onClick={() => guarded('open')} title="Open project (Ctrl+O)" aria-label="Open"><Icon name="open" /><span className="lbl">Open</span></button>
          <button className="tb" onClick={() => save(false)} title="Save (Ctrl+S)" aria-label="Save"><Icon name="save" /><span className="lbl">Save</span></button>
          <button className="tb" onClick={() => save(true)} title="Save as (Ctrl+Shift+S)" aria-label="Save as"><Icon name="saveAs" /><span className="lbl">Save as</span></button>
          <button className="tb" onClick={() => setModal({ kind: 'export' })} title="Export WAV, stems or MIDI (Ctrl+E)" aria-label="Export WAV"><Icon name="export" /><span className="lbl">Export WAV</span></button>
        </div>
        <div className="group" role="toolbar" aria-label="Edit">
          <button className="tb" onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.past.length} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /><span className="lbl">Undo</span></button>
          <button className="tb" onClick={() => dispatch({ type: 'redo' })} disabled={!state.history.future.length} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /><span className="lbl">Redo</span></button>
        </div>
        <div className="group transport" role="toolbar" aria-label="Transport">
          <button className={`play ${playing ? 'on' : ''}`} onClick={togglePlay} disabled={!engineReady} title="Play / stop (Space)">
            <Icon name={playing ? 'stop' : 'play'} size={18} />
            <span className="lbl">{playing ? 'Stop' : 'Play'}</span>
          </button>
          <NumberField label="BPM" value={project.bpm} min={20} max={300} decimals={1} onCommit={(v) => edit((p) => ({ ...p, bpm: v }))} title="Type a tempo (20–300) and press Enter. Arrow keys: ±1, Shift: ±10" />
          <Slider label="Swing" value={project.swing} min={50} max={75} step={0.5} format={(v) => `${v.toFixed(1)}%`} onChange={(v, k) => edit((p) => ({ ...p, swing: v }), k)} />
          <button className={`toggle ${project.metronome ? 'on' : ''}`} aria-pressed={project.metronome} onClick={() => edit((p) => ({ ...p, metronome: !p.metronome }))} title="Metronome (K)">
            <Icon name="click" />
            <span className="lbl">Click</span>
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
          <Icon name={view === 'perform' ? 'edit' : 'perform'} />
          <span className="lbl">{view === 'perform' ? 'Edit view' : 'Perform'}</span>
        </button>
        <button className="settings-btn" onClick={() => setModal({ kind: 'settings' })} aria-label="Settings" title="Sound card, MIDI controller and playing settings">
          <Icon name="settings" />
        </button>
        <button className="about" onClick={async () => {
          const info = await desktop.appInfo();
          setModal({ kind: 'about', notices: info.notices, version: info.version, platform: `${info.platform} · Electron ${info.electron}`, logFile: info.logFile });
        }} aria-label="About"><Icon name="info" /><span className="lbl">About</span></button>
      </header>

      <nav className="patternbar" aria-label="Patterns">
        {project.patterns.map((pt, i) => renaming === pt.id ? (
          <input
            key={pt.id}
            className="pattern-rename"
            aria-label={`New name for pattern ${pt.name}`}
            defaultValue={pt.name}
            maxLength={PATTERN_NAME_MAX}
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={(e) => {
              const name = e.target.value;
              setRenaming(null);
              edit((p) => renamePattern(p, pt.id, name));
            }}
          />
        ) : (
          <button
            key={pt.id}
            className={`pattern-btn ${pt.id === project.currentPatternId ? 'current' : ''} ${pt.id === audiblePattern ? 'playing' : ''} ${pt.id === queuedPattern ? 'queued' : ''}`}
            onClick={() => selectPattern(pt.id)}
            onDoubleClick={() => setRenaming(pt.id)}
            title={`Pattern ${pt.name}${i < 8 ? ` (${i + 1})` : ''}. While playing, switches at the next bar. Drag to reorder, double-click to rename.`}
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
        <button className="small" onClick={() => setRenaming(project.currentPatternId)} title="Give this pattern a name (F2, or double-click it)">Rename</button>
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
        <main
          className="workspace"
          style={panels.custom ? ({ '--left-w': `${panels.left}px`, '--right-w': `${panels.right}px` } as React.CSSProperties) : undefined}
        >
          <aside className="left">
            <SampleBrowser
              project={project}
              selectedSampleId={track.sound.sampleId}
              status={sampleStatus}
              onAudition={(id) => audition(id)}
              onAssign={(id) => assignSample(track.id, id)}
              onImport={(files) => importFiles(files)}
              kits={kits}
              currentKit={currentKit}
              kitProgress={kitProgress}
              onKit={loadKit}
              folders={folders}
              favourites={favourites}
              onFavourite={toggleFavourite}
              onAddFolder={addFolder}
              onRemoveFolder={removeFolder}
              onRescan={() => desktop.folderList().then(setFolders, () => {})}
              onFolderAudition={auditionFolderFile}
              onFolderAssign={(folder, file) => assignFolderFile(track.id, folder, file)}
            />
          </aside>
          <Splitter
            side="left"
            label="Resize sample list"
            width={panels.left}
            min={120}
            max={Math.max(120, Math.min(600, panels.room - panels.right))}
            onChange={(w) => setLayout((l) => ({ ...l, left: w }))}
            onCommit={(w) => saveLayout({ ...layout, left: w })}
            onReset={() => saveLayout({ ...layout, left: undefined })}
          />
          <section className="center">
            <div className="grid-area" ref={gridAreaRef}>
              <Grid
                project={project}
                pattern={pattern}
                selectedTrack={state.selectedTrack}
                selectedStep={state.selectedStep}
                sampleStatus={sampleStatus}
                page={page}
                follow={follow}
                onPage={setPageIndex}
                onFollow={setFollow}
                onPaint={onPaint}
                onSelect={onSelect}
                onTrack={onTrack}
                onLength={onLength}
                onDropFiles={onDropFiles}
                onDropSample={assignSample}
                onDropFolderFile={assignFolderFile}
                meterRef={meterRef}
                rowRef={rowRef}
              />
              <StepLane
                lane={lane}
                page={page}
                kind={laneKind}
                color={trackColor(trackIndex)}
                trackName={track.name}
                onKind={(k) => saveLayout({ ...layout, lane: k })}
                onSet={(stepIndex, patch, gesture) => edit((p) => setStep(p, p.currentPatternId, track.id, stepIndex, patch), gesture)}
              />
            </div>
            <div className={`tools ${toolsOpen ? 'open' : ''}`}>
              <div className="tools-tabs" role="tablist" aria-label="Tools">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={toolsOpen && tool === t.id}
                    className={`tool-tab ${toolsOpen && tool === t.id ? 'on' : ''}`}
                    title={t.title}
                    onClick={() => saveLayout({ ...layout, tool: t.id, toolsOpen: !(toolsOpen && tool === t.id) })}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="tools-spacer" />
                <button
                  className="small tools-toggle"
                  aria-expanded={toolsOpen}
                  title={toolsOpen ? 'Hide the tools to give the grid more room' : 'Show the tools'}
                  onClick={() => saveLayout({ ...layout, toolsOpen: !toolsOpen })}
                >
                  {toolsOpen ? 'Hide ▾' : 'Show ▴'}
                </button>
              </div>
              {(
                <div className="tools-body" role="tabpanel" hidden={!toolsOpen} aria-label={TOOLS.find((t) => t.id === tool)!.label}>
                  <div className="tool-page" hidden={tool !== 'library'}>{(
                  <BeatLibrary
                    onLoad={(opts) => {
                      edit((p) => loadClassic(p, opts));
                      const c = classicById(opts.classicId);
                      notify(`${c.name}: ${classicVariant(c, opts.variant).name} loaded into pattern ${pattern.name}`);
                    }}
                    onAddAll={(opts) => {
                      const { project: next, added } = addClassicPatterns(projectRef.current, opts);
                      if (!added.length) {
                        notify('No room for more patterns');
                        return;
                      }
                      edit(() => next);
                      // While playing, the first new pattern comes in at the next bar, like pressing its number.
                      engineRef.current?.switchPattern(next.currentPatternId);
                      const names = added.map((id) => next.patterns.find((pt) => pt.id === id)!.name);
                      notify(`Added ${added.length} patterns: ${names[0]} to ${names[names.length - 1]}`);
                    }}
                  />
                  )}</div>
                  <div className="tool-page" hidden={tool !== 'beats'}>{(
                  <SmartBeats
                    project={project}
                    pattern={pattern}
                    trackIndex={trackIndex}
                    onBeat={(opts) => {
                      edit((p) => generateBeat(p, opts));
                      const s = styleById(opts.styleId);
                      notify(`${s.genre}: ${s.name} beat written (seed ${opts.seed})`);
                    }}
                    onComplete={(opts) => {
                      const { project: next, filled } = completeBeat(projectRef.current, opts);
                      if (!filled.length) {
                        notify('Every track this pattern uses already has hits');
                        return;
                      }
                      edit(() => next);
                      notify(`Completed with ${styleById(opts.styleId).name}: ${filled.map((id) => next.tracks.find((t) => t.id === id)?.name).join(', ')}`);
                    }}
                    onFill={(opts, asNew) => {
                      const kind = FILL_TYPES.find((f) => f.id === resolveFillType(projectRef.current, opts))?.name ?? 'Fill';
                      if (asNew) {
                        const next = addFillPattern(projectRef.current, opts);
                        edit(() => next);
                        // While playing, the fill pattern comes in at the next bar, like pressing its number.
                        engineRef.current?.switchPattern(next.currentPatternId);
                        notify(`Pattern ${currentPattern(next).name} added (${kind.toLowerCase()})`);
                      } else {
                        edit((p) => fillPattern(p, opts));
                        notify(`${kind} written into the end of pattern ${pattern.name}`);
                      }
                    }}
                    onHumanise={(opts, scope) => {
                      const ids = scope === 'track' ? [track.id] : project.tracks.map((t) => t.id);
                      edit((p) => humanise(p, ids, opts));
                      notify(`Humanised ${scope === 'track' ? `track ${trackIndex + 1}` : 'all tracks'}`);
                    }}
                  />
                  )}</div>
                  <div className="tool-page" hidden={tool !== 'generate'}>{(
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
                  )}</div>
                  <div className="tool-page" hidden={tool !== 'pads'}>
                    <Pads
                      tracks={project.tracks}
                      recording={recording}
                      quantise={sound.quantise ?? true}
                      padKeys={sound.padKeys ?? false}
                      keys={padKeysShown}
                      notes={padNotesShown}
                      midi={midiState}
                      assigning={assigning}
                      onAssign={setAssigning}
                      onClearPad={(i) => assignTo(i, { key: '', note: -1 })}
                      onResetAll={() => {
                        edit(resetPadAssignments);
                        notify('Pads are back to the usual keys and notes');
                      }}
                      padRef={padRef}
                      onHit={hit}
                      onRecord={() => void toggleRecord()}
                      onQuantise={(on) => saveSound({ quantise: on })}
                      onPadKeys={(on) => saveSound({ padKeys: on })}
                      onSettings={() => setModal({ kind: 'settings' })}
                    />
                  </div>
                  <div className="tool-page" hidden={tool !== 'mixer'}>
                    <Mixer
                      tracks={project.tracks}
                      masterVolume={project.masterVolume}
                      selectedTrack={state.selectedTrack}
                      meterRef={mixerMeterRef}
                      masterMeterRef={mixerMasterRef}
                      onSound={(id, patch, k) => edit((p) => setTrackSound(p, id, patch), k && `sound:${id}:${k}`)}
                      onTrack={onTrack}
                      onSelect={(id) => onSelect(id)}
                      onMaster={(v, k) => edit((p) => ({ ...p, masterVolume: v }), k)}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
          <Splitter
            side="right"
            label="Resize inspector"
            width={panels.right}
            min={200}
            max={Math.max(200, Math.min(600, panels.room - panels.left))}
            onChange={(w) => setLayout((l) => ({ ...l, right: w }))}
            onCommit={(w) => saveLayout({ ...layout, right: w })}
            onReset={() => saveLayout({ ...layout, right: undefined })}
          />
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
              onAudition={() => auditionTrack(track.id)}
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
      {updateLater !== update.state && (
        <UpdateBanner update={update} onDownload={() => desktop.updateDownload()} onRestart={restartToUpdate} onLater={() => setUpdateLater(update.state)} />
      )}

      {modal?.kind === 'recover' && (
        <Dialog title="Recover unsaved work?">
          <p>Ba-da-boom did not close normally last time. Your most recent autosave can be restored.</p>
          {modal.missing.length > 0 && <p className="warn">{modal.missing.length} imported sample(s) from that session could not be found.</p>}
          {modal.launch && <p>Or open {modal.launch.split(/[\\/]/).pop()}, the project you double-clicked, and leave the unsaved work.</p>}
          <div className="actions">
            {modal.launch ? (
              <button onClick={() => { const f = modal.launch!; setModal(null); open(f); }}>Open {modal.launch.split(/[\\/]/).pop()}</button>
            ) : (
              <button onClick={() => setModal(null)}>Start fresh</button>
            )}
            <button className="primary" onClick={() => { loadText(modal.text, null, false, modal.missing); setModal(null); }}>Recover</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'unsaved' && (
        <Dialog title="Save changes?">
          <p>This project has unsaved changes.{modal.then === 'open' && modal.path ? ` Save them before opening ${modal.path.split(/[\\/]/).pop()}?` : ''}</p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button onClick={async () => {
              const { then, path } = modal;
              setModal(null);
              if (then === 'close') await desktop.closeReady();
              else if (then === 'update') await desktop.updateInstall();
              else if (then === 'new') newDoc();
              else open(path);
            }}>Don't save</button>
            <button className="primary" onClick={async () => {
              const { then, path } = modal;
              if (!(await save(false))) return;
              setModal(null);
              if (then === 'close') await desktop.closeReady();
              else if (then === 'update') await desktop.updateInstall();
              else if (then === 'new') newDoc();
              else open(path);
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

      {modal?.kind === 'welcome' && (
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
            <button onClick={() => { endWelcome(); guarded('open'); }}>Open a project…</button>
            <button onClick={endWelcome}>Start with this beat</button>
            <button className="primary" onClick={() => { endWelcome(); saveLayout({ ...layout, tool: 'library', toolsOpen: true }); }}>Browse the Beat library</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'settings' && (
        <Dialog title="Settings" wide>
          <SoundSettings
            sound={sound}
            outputs={outputs}
            activeOutput={activeOutput}
            midi={midiState}
            lastNote={lastNote}
            onChange={saveSound}
            onOutput={chooseOutput}
            onTest={() => auditionTrack(state.selectedTrack)}
          />
          <div className="actions">
            <button className="primary" onClick={() => setModal(null)}>Close</button>
          </div>
        </Dialog>
      )}

      {modal?.kind === 'about' && (
        <Dialog title="About Ba-da-boom" wide>
          <p>Version {modal.version} · {modal.platform}</p>
          <div className="about-update">
            {update.state === 'ready' ? (
              <button className="primary" onClick={() => { setModal(null); restartToUpdate(); }}>Restart to update</button>
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
            <button onClick={() => setModal({ kind: 'welcome' })}>Welcome screen</button>
            {inElectron && <button onClick={() => desktop.showLog()} title={modal.logFile}>Show error log</button>}
            <button className="primary" onClick={() => setModal(null)}>Close</button>
          </div>
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
