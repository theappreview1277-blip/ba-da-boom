import { memo, useCallback } from 'react';
import type { Lane, Pattern, Project, Step, Track } from '../model/types';
import { STEPS_PER_BAR } from '../model/types';
import { Meter } from './controls';
import type { SampleStatus } from '../engine/audio/engine';

interface GridProps {
  project: Project;
  pattern: Pattern;
  selectedTrack: string;
  selectedStep: number;
  sampleStatus: (id: string) => SampleStatus | undefined;
  onToggle: (trackId: string, step: number) => void;
  onSelect: (trackId: string, step?: number) => void;
  onTrack: (trackId: string, patch: Partial<Pick<Track, 'mute' | 'solo'>>) => void;
  onLength: (trackId: string, length: number) => void;
  onDropFiles: (trackId: string, files: File[]) => void;
  onDropSample: (trackId: string, sampleId: string) => void;
  meterRef: (index: number) => (el: HTMLDivElement | null) => void;
  /** Registers each row's step container so the playhead can be drawn without React renders. */
  rowRef: (trackId: string) => (el: HTMLDivElement | null) => void;
}

export function Grid(props: GridProps) {
  const { project, pattern } = props;
  const maxLen = Math.max(...project.tracks.map((t) => pattern.lanes[t.id]?.length ?? 16));
  const columns = Math.ceil(maxLen / STEPS_PER_BAR) * STEPS_PER_BAR;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ti = project.tracks.findIndex((t) => t.id === props.selectedTrack);
      let t = ti;
      let s = props.selectedStep;
      if (e.key === 'ArrowUp') t = Math.max(0, ti - 1);
      else if (e.key === 'ArrowDown') t = Math.min(project.tracks.length - 1, ti + 1);
      else if (e.key === 'ArrowLeft') s = Math.max(0, s - (e.ctrlKey ? 4 : 1));
      else if (e.key === 'ArrowRight') s = Math.min(columns - 1, s + (e.ctrlKey ? 4 : 1));
      else if (e.key === 'Enter') {
        props.onToggle(props.selectedTrack, props.selectedStep);
        e.preventDefault();
        return;
      } else return;
      e.preventDefault();
      props.onSelect(project.tracks[t].id, s);
      const cell = document.querySelector<HTMLElement>(`[data-cell="${project.tracks[t].id}:${s}"]`);
      cell?.focus();
    },
    [project.tracks, props, columns],
  );

  return (
    <div className="grid" role="grid" aria-label="Step sequencer" onKeyDown={onKeyDown} style={{ ['--cols' as string]: columns }}>
      <div className="grid-header" role="row">
        <div className="track-head-spacer" />
        <div className="ruler">
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className={`ruler-cell ${i % 4 === 0 ? 'beat' : ''}`}>
              {i % 4 === 0 ? i / 4 + 1 : ''}
            </div>
          ))}
        </div>
      </div>
      {project.tracks.map((track, i) => (
        <Row
          key={track.id}
          index={i}
          track={track}
          lane={pattern.lanes[track.id]}
          columns={columns}
          selected={track.id === props.selectedTrack}
          selectedStep={track.id === props.selectedTrack ? props.selectedStep : -1}
          status={track.sound.sampleId ? props.sampleStatus(track.sound.sampleId) : undefined}
          sampleName={track.sound.sampleId ? project.samples[track.sound.sampleId]?.name ?? '?' : 'No sample'}
          props={props}
        />
      ))}
    </div>
  );
}

const Row = memo(function Row({
  index,
  track,
  lane,
  columns,
  selected,
  selectedStep,
  status,
  sampleName,
  props,
}: {
  index: number;
  track: Track;
  lane: Lane;
  columns: number;
  selected: boolean;
  selectedStep: number;
  status: SampleStatus | undefined;
  sampleName: string;
  props: GridProps;
}) {
  const missing = status === 'missing';
  return (
    <div
      className={`row ${selected ? 'selected' : ''} ${track.mute ? 'muted' : ''}`}
      role="row"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const sampleId = e.dataTransfer.getData('application/x-bdb-sample');
        if (sampleId) props.onDropSample(track.id, sampleId);
        else if (e.dataTransfer.files.length) props.onDropFiles(track.id, [...e.dataTransfer.files]);
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
      <div className="steps" ref={props.rowRef(track.id)} data-len={lane.length}>
        {Array.from({ length: columns }, (_, s) => (
          <Cell
            key={s}
            trackId={track.id}
            index={s}
            step={lane.steps[s]}
            inactive={s >= lane.length}
            focused={s === selectedStep}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
          />
        ))}
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
  onToggle,
  onSelect,
}: {
  trackId: string;
  index: number;
  step: Step;
  inactive: boolean;
  focused: boolean;
  onToggle: (t: string, s: number) => void;
  onSelect: (t: string, s: number) => void;
}) {
  const label = `Step ${index + 1}${step.on ? `, on, velocity ${Math.round(step.velocity * 100)}%` : ', off'}`;
  return (
    <button
      className={`cell ${step.on ? 'on' : ''} ${inactive ? 'inactive' : ''} ${index % 4 === 0 ? 'beat' : ''} ${focused ? 'focused' : ''}`}
      data-cell={`${trackId}:${index}`}
      data-step={index}
      role="gridcell"
      aria-label={label}
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      disabled={inactive}
      onMouseDown={(e) => {
        if (e.shiftKey) onSelect(trackId, index);
        else {
          onToggle(trackId, index);
          onSelect(trackId, index);
        }
      }}
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
