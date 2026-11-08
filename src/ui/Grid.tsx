import { memo, useCallback, useEffect, useRef } from 'react';
import type { Lane, Pattern, Project, Step, Track } from '../model/types';
import { STEPS_PER_BAR } from '../model/types';
import { Meter } from './controls';
import { trackColor } from './colors';
import type { SampleStatus } from '../engine/audio/engine';

/** The part of the pattern on screen: whole bars, `steps` long, from `start`. */
export interface GridPage {
  start: number;
  steps: number;
  /** Steps in the whole pattern view (the longest lane, rounded up to whole bars). */
  total: number;
  /** Width of one step cell in pixels. */
  cell: number;
}

interface GridProps {
  project: Project;
  pattern: Pattern;
  selectedTrack: string;
  selectedStep: number;
  sampleStatus: (id: string) => SampleStatus | undefined;
  page: GridPage;
  /** The playhead turns the pages while playing. */
  follow: boolean;
  onPage: (index: number) => void;
  onFollow: (on: boolean) => void;
  /** Switch a step on or off; one drag (same `gesture`) is one undo step. */
  onPaint: (trackId: string, step: number, on: boolean, gesture: string) => void;
  onSelect: (trackId: string, step?: number) => void;
  onTrack: (trackId: string, patch: Partial<Pick<Track, 'mute' | 'solo'>>) => void;
  onLength: (trackId: string, length: number) => void;
  onDropFiles: (trackId: string, files: File[]) => void;
  onDropSample: (trackId: string, sampleId: string) => void;
  /** A WAV dragged from one of the user's folders in the sample list. */
  onDropFolderFile: (trackId: string, folder: string, file: string) => void;
  meterRef: (index: number) => (el: HTMLDivElement | null) => void;
  /** Registers each row's step container so the playhead can be drawn without React renders. */
  rowRef: (trackId: string) => (el: HTMLDivElement | null) => void;
}

let gestures = 0;

/** Width of the track names column plus the gap after it, as in styles.css (narrower below 1320 px). */
export const trackHeadWidth = (windowWidth: number) => (windowWidth > 1320 ? 238 : 208);
const GAP = 3;
const MIN_CELL = 22;
const MAX_CELL = 40;

/**
 * Which bars are on screen. As many whole bars as fit (4, 3, 2 or 1) at a
 * comfortable cell size; cells grow to use the width, up to MAX_CELL.
 * `width` is the grid area's inner width in pixels.
 */
export function gridPage(total: number, width: number, index: number, headW = 238): GridPage {
  const bars = total / STEPS_PER_BAR;
  const fit = (n: number) => Math.floor((width - headW - 4) / (n * STEPS_PER_BAR)) - GAP;
  const options = [Math.min(bars, 4), 2, 1].filter((n) => n <= bars);
  const per = options.find((n) => fit(n) >= MIN_CELL) ?? 1;
  const steps = per * STEPS_PER_BAR;
  const pages = Math.ceil(total / steps);
  const i = Math.max(0, Math.min(pages - 1, index));
  return { start: i * steps, steps, total, cell: Math.max(18, Math.min(MAX_CELL, fit(per))) };
}

/** Ruler label for a step: the bar number at the start of a bar, bar.beat on the other beats. */
export function rulerLabel(step: number): { text: string; bar: boolean } | null {
  if (step % STEPS_PER_BAR === 0) return { text: String(step / STEPS_PER_BAR + 1), bar: true };
  if (step % 4 === 0) return { text: `${Math.floor(step / STEPS_PER_BAR) + 1}.${(step % STEPS_PER_BAR) / 4 + 1}`, bar: false };
  return null;
}

export function Grid(props: GridProps) {
  const { project, pattern, page } = props;
  const pages = Math.max(1, Math.ceil(page.total / page.steps));
  const current = Math.floor(page.start / page.steps);
  const barsPerPage = page.steps / STEPS_PER_BAR;

  // Painting: press on a step to switch it, drag across others to give them the same state.
  const painting = useRef<{ on: boolean; gesture: string } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    const up = () => (painting.current = null);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
  }, []);
  const onPress = useCallback((trackId: string, step: number, wasOn: boolean, shift: boolean) => {
    const p = propsRef.current;
    if (shift) {
      p.onSelect(trackId, step);
      return;
    }
    painting.current = { on: !wasOn, gesture: `paint:${++gestures}` };
    p.onPaint(trackId, step, !wasOn, painting.current.gesture);
    p.onSelect(trackId, step);
  }, []);
  const onEnter = useCallback((trackId: string, step: number, isOn: boolean, buttons: number) => {
    const g = painting.current;
    if (!g || !(buttons & 1)) return;
    if (isOn !== g.on) propsRef.current.onPaint(trackId, step, g.on, g.gesture);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const p = propsRef.current;
      const ti = project.tracks.findIndex((t) => t.id === p.selectedTrack);
      let t = ti;
      let s = p.selectedStep;
      if (e.key === 'ArrowUp') t = Math.max(0, ti - 1);
      else if (e.key === 'ArrowDown') t = Math.min(project.tracks.length - 1, ti + 1);
      else if (e.key === 'ArrowLeft') s = Math.max(0, s - (e.ctrlKey ? 4 : 1));
      else if (e.key === 'ArrowRight') s = Math.min(page.total - 1, s + (e.ctrlKey ? 4 : 1));
      else if (e.key === 'Enter') {
        const on = p.pattern.lanes[p.selectedTrack]?.steps[p.selectedStep]?.on ?? false;
        p.onPaint(p.selectedTrack, p.selectedStep, !on, `key:${++gestures}`);
        e.preventDefault();
        return;
      } else return;
      e.preventDefault();
      const id = project.tracks[t].id;
      p.onSelect(id, s);
      // Moving off the page turns to the page that holds the step.
      if (s < page.start || s >= page.start + page.steps) p.onPage(Math.floor(s / page.steps));
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cell="${id}:${s}"]`)?.focus());
    },
    [project.tracks, page],
  );

  return (
    <div
      className="grid"
      role="grid"
      aria-label="Step sequencer"
      onKeyDown={onKeyDown}
      style={{ ['--cols' as string]: page.steps, ['--cell-w' as string]: `${page.cell}px` }}
    >
      <div className="grid-header" role="row">
        <div className="pages" role="toolbar" aria-label="Bars on screen">
          {pages > 1 ? (
            <>
              {Array.from({ length: pages }, (_, i) => {
                const from = i * barsPerPage + 1;
                const label = barsPerPage === 1 ? `${from}` : `${from}–${Math.min(from + barsPerPage - 1, page.total / STEPS_PER_BAR)}`;
                return (
                  <button
                    key={i}
                    className={`page-btn ${i === current ? 'on' : ''}`}
                    aria-pressed={i === current}
                    title={`Show bar${barsPerPage === 1 ? '' : 's'} ${label}`}
                    onClick={() => props.onPage(i)}
                  >
                    {label}
                  </button>
                );
              })}
              <label className="follow" title="Turn the pages with the playhead while playing">
                <input type="checkbox" checked={props.follow} onChange={(e) => props.onFollow(e.target.checked)} /> Follow
              </label>
            </>
          ) : (
            <span className="pages-label">Bar{page.total > STEPS_PER_BAR ? 's' : ''}</span>
          )}
        </div>
        <div className="ruler">
          {Array.from({ length: page.steps }, (_, i) => {
            const l = rulerLabel(page.start + i);
            return (
              <div key={i} className={`ruler-cell ${l ? (l.bar ? 'bar' : 'beat') : ''}`}>
                {l?.text ?? ''}
              </div>
            );
          })}
        </div>
      </div>
      {project.tracks.map((track, i) => (
        <Row
          key={track.id}
          index={i}
          track={track}
          lane={pattern.lanes[track.id]}
          start={page.start}
          steps={page.steps}
          selected={track.id === props.selectedTrack}
          selectedStep={track.id === props.selectedTrack ? props.selectedStep : -1}
          status={track.sound.sampleId ? props.sampleStatus(track.sound.sampleId) : undefined}
          sampleName={track.sound.sampleId ? project.samples[track.sound.sampleId]?.name ?? '?' : 'No sample'}
          onPress={onPress}
          onEnter={onEnter}
          onSelect={props.onSelect}
          onTrack={props.onTrack}
          onLength={props.onLength}
          onDropFiles={props.onDropFiles}
          onDropSample={props.onDropSample}
          onDropFolderFile={props.onDropFolderFile}
          meterRef={props.meterRef}
          rowRef={props.rowRef}
        />
      ))}
    </div>
  );
}

interface RowProps extends Pick<GridProps, 'onSelect' | 'onTrack' | 'onLength' | 'onDropFiles' | 'onDropSample' | 'onDropFolderFile' | 'meterRef' | 'rowRef'> {
  index: number;
  track: Track;
  lane: Lane;
  start: number;
  steps: number;
  selected: boolean;
  selectedStep: number;
  status: SampleStatus | undefined;
  sampleName: string;
  onPress: (trackId: string, step: number, wasOn: boolean, shift: boolean) => void;
  onEnter: (trackId: string, step: number, isOn: boolean, buttons: number) => void;
}

const Row = memo(function Row(props: RowProps) {
  const { index, track, lane, start, steps, selected, selectedStep, status, sampleName } = props;
  const missing = status === 'missing' && track.sound.source === 'sample';
  return (
    <div
      className={`row ${selected ? 'selected' : ''} ${track.mute ? 'muted' : ''}`}
      role="row"
      style={{ ['--track' as string]: trackColor(index) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const sampleId = e.dataTransfer.getData('application/x-bdb-sample');
        const folderFile = e.dataTransfer.getData('application/x-bdb-folder-file');
        if (sampleId) props.onDropSample(track.id, sampleId);
        else if (folderFile) {
          const { folder, file } = JSON.parse(folderFile);
          props.onDropFolderFile(track.id, folder, file);
        } else if (e.dataTransfer.files.length) props.onDropFiles(track.id, [...e.dataTransfer.files]);
      }}
    >
      <div className="track-head" onClick={() => props.onSelect(track.id)}>
        <div className="track-name" title={sampleName}>
          <span className="track-num">{index + 1}</span>
          {track.name}
          {missing && (
            <span className="badge warn" title="Sample file is missing. Drop a WAV here or pick a sample to relink.">
              missing
            </span>
          )}
        </div>
        <button
          className={`ms ${track.mute ? 'on mute' : ''}`}
          aria-pressed={track.mute}
          title="Mute (M)"
          onClick={(e) => {
            e.stopPropagation();
            props.onTrack(track.id, { mute: !track.mute });
          }}
        >
          M
        </button>
        <button
          className={`ms ${track.solo ? 'on solo' : ''}`}
          aria-pressed={track.solo}
          title="Solo (S)"
          onClick={(e) => {
            e.stopPropagation();
            props.onTrack(track.id, { solo: !track.solo });
          }}
        >
          S
        </button>
        <input
          className="len"
          type="number"
          min={1}
          max={64}
          value={lane.length}
          title="Steps in this lane (1-64)"
          aria-label={`${track.name} length`}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => props.onLength(track.id, Number(e.target.value) || 1)}
        />
        <Meter refFn={props.meterRef(index)} label={`${track.name} level`} />
      </div>
      <div className="steps" ref={props.rowRef(track.id)} data-len={lane.length} data-start={start}>
        {Array.from({ length: steps }, (_, i) => {
          const s = start + i;
          return (
            <Cell
              key={s}
              trackId={track.id}
              index={s}
              step={lane.steps[s]}
              inactive={s >= lane.length}
              focused={s === selectedStep}
              onPress={props.onPress}
              onEnter={props.onEnter}
            />
          );
        })}
      </div>
    </div>
  );
});

const Cell = memo(function Cell({
  trackId,
  index,
  step,
  inactive,
  focused,
  onPress,
  onEnter,
}: {
  trackId: string;
  index: number;
  step: Step;
  inactive: boolean;
  focused: boolean;
  onPress: RowProps['onPress'];
  onEnter: RowProps['onEnter'];
}) {
  const label = `Step ${index + 1}${step.on ? `, on, velocity ${Math.round(step.velocity * 100)}%` : ', off'}${step.locked ? ', locked' : ''}`;
  const group = Math.floor(index / 4) % 2 === 1 ? 'alt' : '';
  return (
    <button
      className={`cell ${group} ${step.on ? 'on' : ''} ${step.locked ? 'locked' : ''} ${inactive ? 'inactive' : ''} ${index % 4 === 0 ? 'beat' : ''} ${index % STEPS_PER_BAR === 0 ? 'bar' : ''} ${focused ? 'focused' : ''}`}
      data-cell={`${trackId}:${index}`}
      data-step={index}
      role="gridcell"
      aria-label={label}
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      disabled={inactive}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection or focus jump while dragging
        (e.currentTarget as HTMLElement).focus();
        onPress(trackId, index, step.on, e.shiftKey);
      }}
      onMouseEnter={(e) => onEnter(trackId, index, step.on, e.buttons)}
      onKeyDown={(e) => {
        // Space is play/stop everywhere; don't let it "click" the button.
        if (e.key === ' ') e.preventDefault();
      }}
      style={step.on ? { ['--vel' as string]: step.velocity } : undefined}
    >
      {step.on && step.probability < 1 && <span className="prob" style={{ height: `${step.probability * 100}%` }} />}
      {step.on && step.ratchet > 1 && <span className="ratchet">{step.ratchet}</span>}
      {step.on && step.micro !== 0 && <span className={`micro ${step.micro > 0 ? 'late' : 'early'}`} />}
    </button>
  );
});
