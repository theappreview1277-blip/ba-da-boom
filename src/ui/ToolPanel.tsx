// The tabbed tool panel under the grid: Beat library, Beat intelligence, Whole track,
// Generate, Pads and Mixer.
import { addVariation, currentPattern, setLane, setTrackSound } from '../model/ops';
import { applySteps, randomiseLane } from '../model/generate';
import { addClassicPatterns, addFillPattern, classicById, classicVariant, completeBeat, fillPattern, generateBeat, humanise, loadClassic, resolveFillType, styleById, FILL_TYPES } from '../model/rhythm';
import { buildTrack, resolveForm, retakeSection, sectionName } from '../model/arrange';
import { resetPadAssignments } from '../model/live';
import type { Lane, Pattern, Project, Track } from '../model/types';
import type { ToolTab } from '../main/ipc';
import { BeatLibrary } from './BeatLibrary';
import { SmartBeats } from './SmartBeats';
import { TrackBuilder } from './TrackBuilder';
import { Generate } from './Generate';
import { Pads } from './Pads';
import { Mixer } from './Mixer';
import type { AppCtx } from './appContext';
import type { Live } from './useLive';

export const TOOLS: { id: ToolTab; label: string; title: string }[] = [
  { id: 'library', label: 'Beat library', title: 'Named classic beats and their variants' },
  { id: 'beats', label: 'Beat intelligence', title: 'Style generator, complete my beat, fills and humanise' },
  { id: 'track', label: 'Whole track', title: 'Track beat intelligence: the drums for a whole track, with intro, verses, choruses, builds, breaks, fills and outro' },
  { id: 'generate', label: 'Generate', title: 'Euclidean rhythms, randomise and variations' },
  { id: 'pads', label: 'Pads', title: 'Drum pads to play and record live, with the mouse, the keyboard or a MIDI controller' },
  { id: 'mixer', label: 'Mixer', title: 'Every track side by side: level, pan, reverb and delay, mute and solo' },
];

interface ToolPanelProps {
  ctx: AppCtx;
  project: Project;
  pattern: Pattern;
  track: Track;
  trackIndex: number;
  lane: Lane;
  tool: ToolTab;
  open: boolean;
  onTab: (tool: ToolTab, open: boolean) => void;
  playing: boolean;
  songMode: boolean;
  songIndex: number;
  setSongMode: (on: boolean) => void;
  /** Plays the song from the start. */
  playSong: () => Promise<void>;
  live: Live;
  selectedTrack: string;
  onSelect: (id: string) => void;
  mixerMeterRef: (i: number) => (el: HTMLDivElement | null) => void;
  onSettings: () => void;
}

export function ToolPanel(props: ToolPanelProps) {
  const { ctx, project, pattern, track, trackIndex, lane, tool, open, playing, songMode, songIndex, setSongMode, live } = props;
  const { edit, dispatch, notify, projectRef, engineRef } = ctx;
  return (
    <div className={`tools ${open ? 'open' : ''} ${open && tool === 'mixer' ? 'mixing' : ''}`}>
      <div className="tools-tabs" role="tablist" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={open && tool === t.id}
            className={`tool-tab ${open && tool === t.id ? 'on' : ''}`}
            title={t.title}
            onClick={() => props.onTab(t.id, !(open && tool === t.id))}
          >
            {t.label}
          </button>
        ))}
        <span className="tools-spacer" />
        <button
          className="small tools-toggle"
          aria-expanded={open}
          title={open ? 'Hide the tools to give the grid more room' : 'Show the tools'}
          onClick={() => props.onTab(tool, !open)}
        >
          {open ? 'Hide ▾' : 'Show ▴'}
        </button>
      </div>
      <div className="tools-body" role="tabpanel" hidden={!open} aria-label={TOOLS.find((t) => t.id === tool)!.label}>
        <div className="tool-page" hidden={tool !== 'library'}>
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
        </div>
        <div className="tool-page" hidden={tool !== 'beats'}>
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
        </div>
        <div className="tool-page" hidden={tool !== 'track'}>
          <TrackBuilder
            project={project}
            pattern={pattern}
            playingIndex={playing && songMode ? songIndex : -1}
            onBuild={(opts) => {
              const { project: next, arrangement: a } = buildTrack(projectRef.current, opts);
              edit(() => next);
              setSongMode(true);
              const bars = a.song.reduce((n, e) => n + e.bars, 0);
              const secs = (bars * 240) / next.bpm;
              notify(`Track built: ${a.form.name}, ${a.sections.length} sections, ${bars} bars (${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}). Press Play.`);
            }}
            onRetake={(opts, kind) => {
              const { project: next, whole } = retakeSection(projectRef.current, opts, kind);
              edit(() => next);
              const name = sectionName(resolveForm(next, opts), kind);
              notify(whole ? `The track had changed, so it was built again with a new ${name.toLowerCase()}` : `New take of every ${name.toLowerCase()}; the rest of the track is as it was`);
            }}
            onShowEntry={(i) => {
              const e = projectRef.current.song[i];
              if (e) dispatch({ type: 'transient', fn: (p) => ({ ...p, currentPatternId: e.patternId }) });
            }}
            onPlay={props.playSong}
          />
        </div>
        <div className="tool-page" hidden={tool !== 'generate'}>
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
        </div>
        <div className="tool-page" hidden={tool !== 'pads'}>
          <Pads
            tracks={project.tracks}
            recording={live.recording}
            quantise={live.sound.quantise ?? true}
            padKeys={live.sound.padKeys ?? false}
            keys={live.padKeysShown}
            notes={live.padNotesShown}
            midi={live.midiState}
            assigning={live.assigning}
            onAssign={live.setAssigning}
            onClearPad={(i) => live.assignTo(i, { key: '', note: -1 })}
            onResetAll={() => {
              edit(resetPadAssignments);
              notify('Pads are back to the usual keys and notes');
            }}
            padRef={live.padRef}
            onHit={live.hit}
            onRecord={() => void live.toggleRecord()}
            onQuantise={(on) => live.saveSound({ quantise: on })}
            onPadKeys={(on) => live.saveSound({ padKeys: on })}
            onSettings={props.onSettings}
          />
        </div>
        <div className="tool-page" hidden={tool !== 'mixer'}>
          <Mixer
            tracks={project.tracks}
            selectedTrack={props.selectedTrack}
            meterRef={props.mixerMeterRef}
            onSound={(id, patch, k) => edit((p) => setTrackSound(p, id, patch), k && `sound:${id}:${k}`)}
            onSelect={(id) => props.onSelect(id)}
          />
        </div>
      </div>
    </div>
  );
}
