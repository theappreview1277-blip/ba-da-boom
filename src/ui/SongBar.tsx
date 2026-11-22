import { useEffect, useRef } from 'react';
import { songBars } from '../model/ops';
import { arrangedKind } from '../model/arrange';
import { MAX_SONG_BARS, type Project } from '../model/types';
import { reorderProps, scrollIntoList } from './reorder';

const BAR_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 48, MAX_SONG_BARS];
const barChoices = (current: number) => (BAR_CHOICES.includes(current) ? BAR_CHOICES : [...BAR_CHOICES, current].sort((a, b) => a - b));

interface Props {
  project: Project;
  songMode: boolean;
  /** Entry being heard, or -1. */
  playingIndex: number;
  onMode: (song: boolean) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, to: number) => void;
  onBars: (index: number, bars: number) => void;
  onLoop: (loop: boolean) => void;
  onSelect: (patternId: string) => void;
}

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** The song arrangement: patterns in order, each for a number of bars. */
export function SongBar({ project, songMode, playingIndex, onMode, onAdd, onRemove, onMove, onBars, onLoop, onSelect }: Props) {
  const names = new Map(project.patterns.map((p) => [p.id, p.name]));
  // A long song stays on one line that scrolls; the block being heard is kept in view.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playingIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-song-index="${playingIndex}"]`);
    if (el && listRef.current) scrollIntoList(listRef.current, el);
  }, [playingIndex]);
  const total = songBars(project);
  const current = names.get(project.currentPatternId);
  return (
    <nav className="songbar" aria-label="Song">
      <div className="mode" role="group" aria-label="Play mode">
        <button className={`small ${!songMode ? 'on' : ''}`} aria-pressed={!songMode} onClick={() => onMode(false)} title="Play the current pattern in a loop (G toggles)">
          Pattern
        </button>
        <button
          className={`small ${songMode ? 'on' : ''}`}
          aria-pressed={songMode}
          onClick={() => onMode(true)}
          disabled={!project.song.length && !songMode}
          title={project.song.length ? 'Play the song arrangement (G toggles)' : 'Add patterns to the song first'}
        >
          Song
        </button>
      </div>
      <div className="song-entries" ref={listRef}>
        {project.song.length === 0 && <span className="hint">Song is empty. Add patterns in the order they should play.</span>}
        {project.song.map((e, i) => (
          <div key={i} className={`song-entry kind-${arrangedKind(e.patternId) ?? 'own'} ${i === playingIndex ? 'playing' : ''}`} data-song-index={i} title="Drag to reorder" {...reorderProps('application/x-bdb-song', i, onMove)}>
            <button className="name" onClick={() => onSelect(e.patternId)} title="Show this pattern">
              {names.get(e.patternId)}
            </button>
            <select
              value={e.bars}
              aria-label={`Bars for entry ${i + 1}`}
              title="Bars"
              onKeyDown={(ev) => ev.stopPropagation()}
              onChange={(ev) => onBars(i, Number(ev.target.value))}
            >
              {barChoices(e.bars).map((n) => (
                <option key={n} value={n}>
                  ×{n}
                </option>
              ))}
            </select>
            <button className="icon" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Move entry ${i + 1} earlier`}>
              ◀
            </button>
            <button className="icon" disabled={i === project.song.length - 1} onClick={() => onMove(i, i + 1)} aria-label={`Move entry ${i + 1} later`}>
              ▶
            </button>
            <button className="icon" onClick={() => onRemove(i)} aria-label={`Remove entry ${i + 1}`}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="small add" onClick={onAdd} title="Add the current pattern to the end of the song">
        + {current}
      </button>
      <label className="check">
        <input type="checkbox" checked={project.songLoop} onChange={(e) => onLoop(e.target.checked)} /> Loop
      </label>
      <span className="hint">
        {total} bar{total === 1 ? '' : 's'} · {duration((total * 240) / project.bpm)}
      </span>
    </nav>
  );
}
