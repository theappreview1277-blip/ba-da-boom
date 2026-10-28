import type { Project } from '../model/types';
import { Meter } from './controls';

interface Props {
  project: Project;
  playing: boolean;
  audiblePattern: string | null;
  queuedPattern: string | null;
  songMode: boolean;
  songIndex: number;
  meterRef: (index: number) => (el: HTMLDivElement | null) => void;
  positionRef: (el: HTMLDivElement | null) => void;
  onPlay: () => void;
  onPattern: (id: string) => void;
  onSongMode: (on: boolean) => void;
  onTrack: (id: string, patch: { mute?: boolean; solo?: boolean }) => void;
}

/** Large controls for playing live: pattern pads, track mutes and solos, transport. */
export function Perform({ project, playing, audiblePattern, queuedPattern, songMode, songIndex, meterRef, positionRef, onPlay, onPattern, onSongMode, onTrack }: Props) {
  const songEntry = songMode && songIndex >= 0 ? project.song[songIndex] : null;
  return (
    <div className="perform" aria-label="Performance view">
      <div className="perform-top">
        <button className={`perform-play ${playing ? 'on' : ''}`} onClick={onPlay} aria-label={playing ? 'Stop' : 'Play'}>
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
            {playing ? <rect x="5" y="5" width="14" height="14" fill="currentColor" /> : <path d="M7 4l13 8-13 8z" fill="currentColor" />}
          </svg>
        </button>
        <div className="perform-status">
          <div className="perform-position" ref={positionRef} aria-live="off">
            –
          </div>
          <div className="perform-sub">
            {project.bpm} BPM ·{' '}
            {songEntry
              ? `Song: ${songIndex + 1} of ${project.song.length}`
              : songMode
                ? 'Song mode'
                : 'Pattern mode'}
          </div>
        </div>
        <button className={`small ${songMode ? 'on' : ''}`} aria-pressed={songMode} disabled={!project.song.length && !songMode} onClick={() => onSongMode(!songMode)} title="Play the song arrangement (G)">
          Song
        </button>
      </div>

      <div className="perform-pads" role="group" aria-label="Patterns">
        {project.patterns.map((pt, i) => (
          <button
            key={pt.id}
            className={`pad ${pt.id === audiblePattern ? 'playing' : ''} ${pt.id === queuedPattern ? 'queued' : ''}`}
            onClick={() => onPattern(pt.id)}
            title={`Pattern ${pt.name}${i < 8 ? ` (${i + 1})` : ''}. While playing, switches at the next bar.`}
          >
            <span className="pad-name">{pt.name}</span>
            {i < 8 && <span className="pad-key">{i + 1}</span>}
            {pt.id === queuedPattern && <span className="pad-state">next bar</span>}
          </button>
        ))}
      </div>

      <div className="perform-tracks" role="group" aria-label="Tracks">
        {project.tracks.map((t, i) => (
          <div key={t.id} className={`ptrack ${t.mute ? 'muted' : ''} ${t.solo ? 'soloed' : ''}`}>
            <Meter refFn={meterRef(i)} label={`${t.name} level`} />
            <div className="ptrack-name">{t.name}</div>
            <button className={`ptrack-mute ${t.mute ? 'on' : ''}`} aria-pressed={t.mute} onClick={() => onTrack(t.id, { mute: !t.mute })} aria-label={`Mute ${t.name}`}>
              M
            </button>
            <button className={`ptrack-solo ${t.solo ? 'on' : ''}`} aria-pressed={t.solo} onClick={() => onTrack(t.id, { solo: !t.solo })} aria-label={`Solo ${t.name}`}>
              S
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
