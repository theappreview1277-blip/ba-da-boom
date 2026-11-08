import { useMemo, useState } from 'react';
import { FEELS, FILL_TYPES, GENRES, STYLES, detectStyle, styleById, type BeatOptions, type Feel, type FillOptions, type FillType, type HumaniseOptions } from '../model/rhythm';
import type { Pattern, Project } from '../model/types';
import { Slider, pct } from './controls';

export type HumaniseScope = 'track' | 'pattern';

interface Props {
  project: Project;
  pattern: Pattern;
  trackIndex: number;
  onBeat: (opts: BeatOptions) => void;
  onComplete: (opts: BeatOptions) => void;
  onFill: (opts: FillOptions, asNewPattern: boolean) => void;
  onHumanise: (opts: HumaniseOptions, scope: HumaniseScope) => void;
}

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

function Seed({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="slider">
      <label htmlFor={id}>Seed</label>
      <input id={id} type="number" min={0} value={value} onKeyDown={stop} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} title="The same seed and settings always give the same result" />
      <output />
    </div>
  );
}

function Pick<T extends string>({ label, value, options, onChange, title }: { label: string; value: T; options: readonly { id: T; name: string }[]; onChange: (v: T) => void; title?: string }) {
  return (
    <label className="pick" title={title}>
      <span>{label}</span>
      <select aria-label={label} value={value} onKeyDown={stop} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const FILL_LENGTHS = [
  { id: '4', name: '1 beat' },
  { id: '8', name: '2 beats' },
  { id: '16', name: '1 bar' },
] as const;

/**
 * Beat intelligence: beats in a style, completing a started beat, fills and
 * humanise. Results are written into the grid and stay editable; locked steps
 * are never changed.
 */
export function SmartBeats({ project, pattern, trackIndex, onBeat, onComplete, onFill, onHumanise }: Props) {
  const [styleId, setStyleId] = useState('dnb-twostep');
  const [complexity, setComplexity] = useState(0.5);
  const [seed, setSeed] = useState(1);
  const [tempo, setTempo] = useState(true);
  const [fillType, setFillType] = useState<FillType>('auto');
  const [fillLen, setFillLen] = useState<'4' | '8' | '16'>('4');
  const [intensity, setIntensity] = useState(0.6);
  const [fillSeed, setFillSeed] = useState(1);
  const [feel, setFeel] = useState<Feel>('natural');
  const [timing, setTiming] = useState(0.4);
  const [velocity, setVelocity] = useState(0.4);
  const [humSeed, setHumSeed] = useState(1);
  const [scope, setScope] = useState<HumaniseScope>('pattern');

  const style = styleById(styleId);
  const genre = style.genre;
  const inGenre = STYLES.filter((s) => s.genre === genre);
  const match = useMemo(() => detectStyle(project, pattern)[0], [project, pattern]);
  const beat = (s = seed): BeatOptions => ({ styleId, complexity, seed: s, tempo });
  const fill = (): FillOptions => ({ type: fillType, steps: Number(fillLen), intensity, seed: fillSeed });

  return (
    <section className="panel-section smart" aria-label="Beat intelligence">
      <h3>
        Beat intelligence <span className="sub">· style generator: {STYLES.length} styles in {GENRES.length} kinds of music · locked steps are kept</span>
      </h3>
      <div className="gen-blocks">
        <div className="gen-block" aria-label="Beat">
          <div className="gen-title">Style generator</div>
          <Pick label="Music" value={genre} options={GENRES.map((g) => ({ id: g, name: g }))} onChange={(g) => setStyleId(STYLES.find((s) => s.genre === g)!.id)} />
          <Pick label="Pattern" value={styleId} options={inGenre.map((s) => ({ id: s.id, name: s.name }))} onChange={setStyleId} />
          <p className="about" title={style.about}>
            {style.about}
          </p>
          <Slider label="Complexity" value={complexity} min={0} max={1} format={pct} title="How many extra hits, ghost notes and rolls are added" onChange={setComplexity} />
          <Seed id="beat-seed" value={seed} onChange={setSeed} />
          <label className="check" title="Set the tempo and swing to this pattern's">
            <input type="checkbox" checked={tempo} onChange={(e) => setTempo(e.target.checked)} /> Use its tempo and swing ({style.bpm} BPM, {style.swing}%)
          </label>
          <div className="gen-buttons">
            <button className="small" onClick={() => onBeat(beat())} title="Write this beat into the pattern. Tracks it doesn't use are cleared.">
              New beat
            </button>
            <button className="small" onClick={() => onComplete(beat())} title="Add this pattern's parts to the tracks that are still empty. Tracks you have written stay as they are.">
              Complete my beat
            </button>
          </div>
          <div className="detect" aria-label="Sounds like">
            {match ? (
              <>
                Sounds like <b>{match.style.genre === match.style.name ? match.style.name : `${match.style.genre}: ${match.style.name}`}</b> · {pct(match.score)}{' '}
                {match.style.id !== styleId && (
                  <button className="link" onClick={() => setStyleId(match.style.id)} title="Pick this pattern">
                    Use
                  </button>
                )}
              </>
            ) : (
              'Write a kick, snare or hat to see what style it sounds like'
            )}
          </div>
        </div>

        <div className="gen-block" aria-label="Fill">
          <div className="gen-title">Fill of pattern {pattern.name}</div>
          <Pick label="Fill" value={fillType} options={FILL_TYPES} onChange={setFillType} />
          <Pick label="Length" value={fillLen} options={FILL_LENGTHS} onChange={setFillLen} title="How much of the end of the pattern the fill takes" />
          <Slider label="Intensity" value={intensity} min={0} max={1} format={pct} title="Busier and with rolls towards the end" onChange={setIntensity} />
          <Seed id="fill-seed" value={fillSeed} onChange={setFillSeed} />
          <div className="gen-buttons">
            <button
              className="small"
              onClick={() => {
                onFill(fill(), true);
                setFillSeed(fillSeed + 1);
              }}
              title="Add a copy of this pattern with a fill at the end, right after it. While playing, it is queued for the next bar."
            >
              Add fill pattern
            </button>
            <button className="small" onClick={() => onFill(fill(), false)} title="Write the fill into the end of this pattern">
              Fill this pattern
            </button>
          </div>
        </div>

        <div className="gen-block" aria-label="Humanise">
          <div className="gen-title">Humanise</div>
          <Pick label="Feel" value={feel} options={FEELS} onChange={setFeel} title="Laid back: snares and hats sit late. Pushed: hats lean ahead. Tight: close to the grid." />
          <Slider label="Timing" value={timing} min={0} max={1} format={pct} title="How far hits drift from the grid" onChange={setTiming} />
          <Slider label="Velocity" value={velocity} min={0} max={1} format={pct} title="How much hit strengths vary" onChange={setVelocity} />
          <Seed id="hum-seed" value={humSeed} onChange={setHumSeed} />
          <div className="gen-buttons">
            <select value={scope} onKeyDown={stop} onChange={(e) => setScope(e.target.value as HumaniseScope)} aria-label="Humanise scope">
              <option value="pattern">All tracks</option>
              <option value="track">Track {trackIndex + 1}</option>
            </select>
            <button className="small" onClick={() => onHumanise({ timing, velocity, feel, seed: humSeed }, scope)} title="Give the hits a human feel">
              Humanise
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
