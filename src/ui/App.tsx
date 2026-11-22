// The main screen. The pieces live in their own files: hooks for samples (useSamples), live
// playing (useLive), files (useFiles), the playhead and meters (usePlayhead) and shortcuts
// (useShortcuts); components for the top bar, pattern bar, tool panel and dialogs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../engine/audio/engine';
import { encodeWav24, renderPattern } from '../engine/audio/exportWav';
import { trackControls } from '../engine/strudel/fromModel';
import {
  currentLane,
  currentPattern,
  setLaneLength,
  setStep,
  setTrack,
  setTrackSound,
  patternUsage,
  removePattern,
  songAdd,
  songMove,
  songRemove,
  songSetBars,
} from '../model/ops';
import type { Settings, StepLane as LaneKind, ToolTab, UpdateState } from '../main/ipc';
import { parseProject, serializeProject } from '../model/serialize';
import { STEPS_PER_BAR } from '../model/types';
import { desktop, inElectron, sampleUrl } from './desktop';
import { Grid, gridPage, trackHeadWidth, type GridPage } from './Grid';
import { StepLane } from './StepLane';
import { Icon } from './icons';
import { trackColor } from './colors';
import { TAP_RESET_MS, tapTempo } from '../model/tempo';
import { Inspector } from './Inspector';
import { SampleBrowser } from './SampleBrowser';
import { Splitter } from './Splitter';
import { Perform } from './Perform';
import { SongBar } from './SongBar';
import { useUiStore } from './store';
import { SoundSettings } from './SoundSettings';
import { UpdateBanner } from './Updates';
import type { AppCtx } from './appContext';
import { useSamples } from './useSamples';
import { useLive } from './useLive';
import { useFiles } from './useFiles';
import { usePlayhead } from './usePlayhead';
import { useShortcuts } from './useShortcuts';
import { TopBar } from './TopBar';
import { PatternBar } from './PatternBar';
import { ToolPanel } from './ToolPanel';
import { playModel } from '../plugin/playModel';
import { AboutDialog, Dialog, ExportDialog, KeysDialog, RecoverDialog, RemovePatternDialog, UnsavedDialog, WelcomeDialog, type ExportPrefs, type Modal } from './Dialogs';

/** Width of the sample list when folded away. */
const RAIL = 36;

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
  const [queuedPattern, setQueuedPattern] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const closeModal = useCallback(() => setModal(null), []);
  /** The pattern whose name is being typed in the pattern bar. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' });
  // "Later" hides the corner note until the update moves on (say, from downloading to ready).
  const [updateLater, setUpdateLater] = useState<string | null>(null);
  const [exportPrefs, setExportPrefs] = useState<ExportPrefs>({ bars: 0, song: false, format: 'wav' });
  const dirty = state.savedProject !== project;
  const projectRef = useRef(project);
  projectRef.current = project;
  const stateRef = useRef(state);
  stateRef.current = state;

  const toastTimer = useRef(0);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  /** Shows a problem to the user and writes it to the error log. */
  const fail = useCallback(
    (msg: string) => {
      notify(msg);
      desktop.log('error', msg).catch(() => {});
    },
    [notify],
  );
  const ctx: AppCtx = useMemo(() => ({ dispatch, edit, projectRef, stateRef, engineRef, notify, fail }), [dispatch, edit, notify, fail]);

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
    Object.assign(window as any, { __engine: engine, __bdb: { renderPattern, encodeWav24, parseProject, serializeProject, playModel } });
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

  const { rowRef, meterRef, mixerMeterRef, positionRef, meters } = usePlayhead(ctx, {
    pageRef,
    setPageIndex,
    setPlaying,
    setAudiblePattern,
    setQueuedPattern,
    setSongIndex,
  });

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
  /** Stops playback if it is running (before loading or exporting). */
  const stop = useCallback(async () => {
    const engine = engineRef.current;
    if (engine?.isPlaying) {
      await engine.stop();
      setPlaying(false);
    }
  }, []);

  const setSongMode = useCallback((on: boolean) => {
    songModeRef.current = on;
    setSongModeState(on);
    engineRef.current?.setSongMode(on);
  }, []);
  useEffect(() => {
    if (songMode && project.song.length === 0) setSongMode(false);
  }, [songMode, project.song.length, setSongMode]);
  const playSong = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !engineReady) return;
    if (engine.isPlaying) await engine.stop();
    setSongMode(true);
    await engine.play();
    setPlaying(engine.isPlaying);
  }, [engineReady, setSongMode]);

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

  const samples = useSamples(ctx, project);
  const onDropFiles = useCallback((id: string, files: File[]) => samples.importFiles(files, id), [samples.importFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel layout (kept in the app's settings).
  const [layout, setLayout] = useState<Settings['layout']>({});
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  const saveLayout = useCallback((next: Settings['layout']) => {
    setLayout(next);
    desktop.settingsSet({ layout: next }).catch(() => {});
  }, []);
  const tool: ToolTab = layout.tool ?? 'library';
  // Short windows start with the tools folded away, so all 16 tracks fit.
  const toolsOpen = layout.toolsOpen ?? window.innerHeight >= 860;
  const laneKind: LaneKind = layout.lane ?? 'velocity';

  const live = useLive(ctx, project, { engineReady, playing, setPlaying, tool, toolsOpen });

  useEffect(() => {
    desktop.settingsGet().then((s) => {
      samples.setFavourites(new Set(s.favourites));
      setLayout(s.layout);
      live.loadSound(s.sound);
    }, () => live.loadSound(undefined));
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel widths: the defaults follow the window size (as in styles.css); custom widths
  // are kept, but squeezed when the window is too small to leave room for a whole bar.
  const panels = useMemo(() => {
    const [dl, dr] = winWidth > 1320 ? [220, 330] : winWidth > 1100 ? [170, 280] : [130, 240];
    const room = winWidth - (winWidth > 1320 ? 760 : 640);
    const samplesShown = layout.samples ?? true;
    let left = samplesShown ? layout.left ?? dl : RAIL;
    let right = layout.right ?? dr;
    const over = left + right - room;
    if (over > 0) {
      if (samplesShown) left = Math.max(120, Math.round(left - (over * left) / (left + right)));
      right = Math.max(200, room - left);
    }
    return { left, right, room, samplesShown, custom: !samplesShown || layout.left !== undefined || layout.right !== undefined };
  }, [winWidth, layout]);
  /** Close the welcome screen; it is not shown at start-up again (About shows it). */
  const endWelcome = useCallback(() => {
    setModal(null);
    desktop.settingsSet({ welcomed: true }).catch(() => {});
  }, []);

  const audition = useCallback((sampleId: string, withTrack?: string) => {
    const p = projectRef.current;
    const i = withTrack ? p.tracks.findIndex((t) => t.id === withTrack) : -1;
    const controls = i >= 0 ? trackControls(p.tracks[i], i, p) : {};
    delete controls.orbit;
    engineRef.current?.audition(sampleId, controls);
  }, []);
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

  const files = useFiles(ctx, { setModal, setUpdate, stop });

  // --- tap tempo (Tap button or T) ---
  const taps = useRef<number[]>([]);
  const tapKey = useRef('');
  const tapTempoNow = useCallback(() => {
    const now = performance.now();
    const first = !taps.current.length || now - taps.current[taps.current.length - 1] > TAP_RESET_MS;
    if (first) tapKey.current = `tap:${now}`;
    const r = tapTempo(taps.current, now);
    taps.current = r.taps;
    if (r.bpm == null) notify('Tap tempo: keep tapping in time');
    else {
      const bpm = r.bpm;
      // One undo step for one run of taps.
      edit((p) => ({ ...p, bpm }), tapKey.current);
      notify(`Tap tempo: ${bpm} BPM`);
    }
  }, [edit, notify]);

  useShortcuts(ctx, modal !== null, {
    live,
    togglePlay,
    save: files.save,
    guarded: files.guarded,
    openExport: () => setModal({ kind: 'export' }),
    openKeys: () => setModal({ kind: 'keys' }),
    rename: setRenaming,
    askRemovePattern,
    selectPattern,
    toggleView: () => setView((v) => (v === 'perform' ? 'edit' : 'perform')),
    songMode: () => songModeRef.current,
    setSongMode,
    tap: tapTempoNow,
    auditionTrack,
  });

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
      <TopBar
        project={project}
        canUndo={state.history.past.length > 0}
        canRedo={state.history.future.length > 0}
        playing={playing}
        engineReady={engineReady}
        view={view}
        winWidth={winWidth}
        meters={meters}
        onNew={() => files.guarded('new')}
        onOpen={() => files.guarded('open')}
        onSave={files.save}
        onExport={() => setModal({ kind: 'export' })}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onPlay={togglePlay}
        onTap={tapTempoNow}
        onProject={edit}
        onResetClip={() => engineRef.current?.resetClip()}
        onView={setView}
        onSettings={() => setModal({ kind: 'settings' })}
        onAbout={async () => {
          const info = await desktop.appInfo();
          setModal({ kind: 'about', notices: info.notices, version: info.version, platform: `${info.platform} · Electron ${info.electron}`, logFile: info.logFile });
        }}
      />

      <PatternBar
        project={project}
        audiblePattern={audiblePattern}
        queuedPattern={queuedPattern}
        renaming={renaming}
        clipboard={state.patternClipboard}
        onRenaming={setRenaming}
        onSelect={selectPattern}
        onRemove={askRemovePattern}
        onCopy={() => {
          dispatch({ type: 'copyPattern', pattern });
          notify('Pattern copied');
        }}
        edit={edit}
      />

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
          <aside className={`left ${panels.samplesShown ? '' : 'folded'}`}>
            {panels.samplesShown ? (
              <SampleBrowser
                onHide={() => saveLayout({ ...layout, samples: false })}
                project={project}
                selectedSampleId={track.sound.sampleId}
                status={sampleStatus}
                onAudition={(id) => audition(id)}
                onAssign={(id) => samples.assignSample(track.id, id)}
                onImport={(f) => samples.importFiles(f)}
                kits={samples.kits}
                currentKit={samples.currentKit}
                kitProgress={samples.kitProgress}
                onKit={samples.loadKit}
                folders={samples.folders}
                favourites={samples.favourites}
                onFavourite={samples.toggleFavourite}
                onAddFolder={samples.addFolder}
                onRemoveFolder={samples.removeFolder}
                onRescan={samples.rescan}
                onFolderAudition={samples.auditionFolderFile}
                onFolderAssign={(folder, file) => samples.assignFolderFile(track.id, folder, file)}
              />
            ) : (
              <button className="samples-rail" onClick={() => saveLayout({ ...layout, samples: true })} title="Show the sample list" aria-label="Show the sample list">
                <Icon name="open" />
                <span>Sounds</span>
              </button>
            )}
          </aside>
          {panels.samplesShown ? (
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
          ) : (
            <div className="splitter-col" />
          )}
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
                onDropSample={samples.assignSample}
                onDropFolderFile={samples.assignFolderFile}
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
            <ToolPanel
              ctx={ctx}
              project={project}
              pattern={pattern}
              track={track}
              trackIndex={trackIndex}
              lane={lane}
              tool={tool}
              open={toolsOpen}
              onTab={(t, open) => saveLayout({ ...layout, tool: t, toolsOpen: open })}
              playing={playing}
              songMode={songMode}
              songIndex={songIndex}
              setSongMode={setSongMode}
              playSong={playSong}
              live={live}
              selectedTrack={state.selectedTrack}
              onSelect={onSelect}
              mixerMeterRef={mixerMeterRef}
              onSettings={() => setModal({ kind: 'settings' })}
            />
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
              onMixer={() => saveLayout({ ...layout, tool: 'mixer', toolsOpen: true })}
              onPickSample={() => saveLayout({ ...layout, samples: true })}
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
        </span>
        <button className="link keys-help" onClick={() => setModal({ kind: 'keys' })} title="Every keyboard shortcut (?)">
          ? Keyboard shortcuts
        </button>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
      {updateLater !== update.state && (
        <UpdateBanner update={update} onDownload={() => desktop.updateDownload()} onRestart={files.restartToUpdate} onLater={() => setUpdateLater(update.state)} />
      )}

      {modal?.kind === 'recover' && (
        <RecoverDialog modal={modal} onClose={closeModal} onOpen={files.open} onRecover={() => files.loadText(modal.text, null, false, modal.missing)} />
      )}
      {modal?.kind === 'unsaved' && <UnsavedDialog modal={modal} onClose={closeModal} save={files.save} proceed={files.proceed} />}
      {modal?.kind === 'removePattern' && <RemovePatternDialog project={project} id={modal.id} onClose={closeModal} onRemove={doRemovePattern} />}
      {modal?.kind === 'export' && <ExportDialog ctx={ctx} project={project} prefs={exportPrefs} setPrefs={setExportPrefs} stop={stop} onClose={closeModal} />}
      {modal?.kind === 'welcome' && (
        <WelcomeDialog onClose={endWelcome} onOpen={() => files.guarded('open')} onLibrary={() => saveLayout({ ...layout, tool: 'library', toolsOpen: true })} />
      )}
      {modal?.kind === 'keys' && <KeysDialog onClose={closeModal} />}
      {modal?.kind === 'settings' && (
        <Dialog title="Settings" wide>
          <SoundSettings
            sound={live.sound}
            outputs={live.outputs}
            activeOutput={live.activeOutput}
            midi={live.midiState}
            lastNote={live.lastNote}
            onChange={live.saveSound}
            onOutput={live.chooseOutput}
            onTest={() => auditionTrack(state.selectedTrack)}
          />
          <div className="actions">
            <button className="primary" onClick={closeModal}>Close</button>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'about' && (
        <AboutDialog modal={modal} update={update} setUpdate={setUpdate} onClose={closeModal} onRestart={files.restartToUpdate} onWelcome={() => setModal({ kind: 'welcome' })} />
      )}
    </div>
  );
}
