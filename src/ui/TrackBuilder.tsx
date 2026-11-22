import { useMemo, useState } from 'react';
import {
  BLOCK_BARS,
  FILL_PLANS,
  FORMS,
  LENGTHS,
  SECTION_KINDS,
  arrangedKind,
  planSections,
  resolveForm,
  sectionName,
  songSections,
  type ArrangeOptions,
  type FillPlan,
  type GrooveSource,
  type Section,
  type SectionKind,
  type TrackLength,
} from '../model/arrange';
import { CATEGORIES, CLASSICS, GENRES, STYLES, classicById, styleById } from '../model/rhythm';
import { MAX_SONG_BARS, type Pattern, type Project } from '../model/types';
import { Slider, pct } from './controls';

interface Props {
  project: Project;
  pattern: Pattern;
  /** Song entry being heard, or -1. */
  playingIndex: number;
  onBuild: (opts: ArrangeOptions) => void;
  onRetake: (opts: ArrangeOptions, kind: SectionKind) => void;
  onShowEntry: (entry: number) => void;
  onPlay: () => void;
}

const stop = (e: React.KeyboardEvent) => e.stopPropagation();
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const BAR_CHOICES = Array.from({ length: MAX_SONG_BARS / BLOCK_BARS }, (_, i) => (i + 1) * BLOCK_BARS);

type SourceKind = GrooveSource['kind'];
const SOURCES: { id: SourceKind; name: string }[] = [
  { id: 'style', name: 'A style' },
  { id: 'classic', name: 'A named beat' },
  { id: 'pattern', name: 'This pattern' },
];

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

/**
 * Track beat intelligence: builds the drums for a whole track from one groove,
 * as patterns plus the song (intro, verses, choruses or drops, builds, breaks,
 * fills and an outro). The sections can be changed before building, and each
 * kind of section can get a new take afterwards without touching the others.
 */
export function TrackBuilder({ project, pattern, playingIndex, onBuild, onRetake, onShowEntry, onPlay }: Props) {
  const [sourceKind, setSourceKind] = useState<SourceKind>('style');
  const [styleId, setStyleId] = useState('dnb-twostep');
  const [classicId, setClassicId] = useState('amen');
  const [formId, setFormId] = useState('auto');
  const [length, setLength] = useState<TrackLength>('normal');
  const [fills, setFills] = useState<FillPlan>('phrases');
  const [complexity, setComplexity] = useState(0.5);
  const [seed, setSeed] = useState(1);
  const [tempo, setTempo] = useState(true);
  const [custom, setCustom] = useState<Section[] | null>(null);
  const [takes, setTakes] = useState<Partial<Record<SectionKind, number>>>({});
  const [built, setBuilt] = useState<ArrangeOptions | null>(null);
  const [addKind, setAddKind] = useState<SectionKind>('verse');

  const source: GrooveSource =
    sourceKind === 'style' ? { kind: 'style', styleId } : sourceKind === 'classic' ? { kind: 'classic', classicId } : { kind: 'pattern', patternId: pattern.id };
  const form = resolveForm(project, { form: formId, source });
  const sections = custom ?? planSections(form, length);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);
  const bpm = tempo && sourceKind === 'style' ? styleById(styleId).bpm : tempo && sourceKind === 'classic' ? classicById(classicId).bpm : project.bpm;
  const options = (): ArrangeOptions => ({ source, form: formId, length, fills, complexity, seed, tempo, sections: custom ?? undefined, takes });

  const style = styleById(styleId);
  const classic = classicById(classicId);
  const timeline = useMemo(() => songSections(project), [project]);
  const songTotal = timeline.reduce((n, s) => n + s.bars, 0);
  const builtKinds = SECTION_KINDS.filter((k) => project.patterns.some((pt) => arrangedKind(pt.id) === k));
  const kindNames = (k: SectionKind) => sectionName(form, k);

  const edit = (fn: (s: Section[]) => Section[]) => setCustom(fn(sections.map((s) => ({ ...s }))));
  const resetPlan = () => setCustom(null);

  return (
    <section className="panel-section trackbuilder" aria-label="Whole track">
      <h3>
        Track beat intelligence <span className="sub">· builds the drums for a whole track: intro, verses, choruses, builds, breaks, fills and an outro</span>
      </h3>
      <div className="gen-blocks">
        <div className="gen-block" aria-label="Groove">
          <div className="gen-title">1. Groove</div>
          <Pick label="Start from" value={sourceKind} options={SOURCES} onChange={(v) => { setSourceKind(v); setCustom(null); }} title="The beat the whole track is built from" />
          {sourceKind === 'style' && (
            <>
              <Pick label="Music" value={style.genre} options={GENRES.map((g) => ({ id: g, name: g }))} onChange={(g) => { setStyleId(STYLES.find((s) => s.genre === g)!.id); setCustom(null); }} />
              <Pick label="Style" value={styleId} options={STYLES.filter((s) => s.genre === style.genre).map((s) => ({ id: s.id, name: s.name }))} onChange={(v) => { setStyleId(v); setCustom(null); }} />
              <Slider label="Complexity" value={complexity} min={0} max={1} format={pct} title="How many extra hits, ghost notes and rolls the verses and choruses get" onChange={setComplexity} />
            </>
          )}
          {sourceKind === 'classic' && (
            <>
              <Pick label="Kind" value={classic.category} options={CATEGORIES.map((c) => ({ id: c, name: c }))} onChange={(c) => { setClassicId(CLASSICS.find((x) => x.category === c)!.id); setCustom(null); }} />
              <Pick label="Beat" value={classicId} options={CLASSICS.filter((c) => c.category === classic.category).map((c) => ({ id: c.id, name: c.name }))} onChange={(v) => { setClassicId(v); setCustom(null); }} />
            </>
          )}
          {sourceKind === 'pattern' && <p className="about">Pattern {pattern.name} is the verse; the other sections are made from it.</p>}
          <div className="slider">
            <label htmlFor="track-seed">Seed</label>
            <input id="track-seed" type="number" min={0} value={seed} onKeyDown={stop} onChange={(e) => { setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0))); setTakes({}); }} title="The same seed and settings always give the same track" />
            <output />
          </div>
          {sourceKind !== 'pattern' && (
            <label className="check" title="Set the tempo and swing to the groove's">
              <input type="checkbox" checked={tempo} onChange={(e) => setTempo(e.target.checked)} /> Use its tempo ({sourceKind === 'style' ? style.bpm : classic.bpm} BPM)
            </label>
          )}
        </div>

        <div className="gen-block" aria-label="Sections">
          <div className="gen-title">2. Sections</div>
          <Pick
            label="Form"
            value={formId}
            options={[{ id: 'auto', name: `Auto (${resolveForm(project, { form: 'auto', source }).name})` }, ...FORMS.map((f) => ({ id: f.id, name: f.name }))]}
            onChange={(v) => { setFormId(v); setCustom(null); }}
            title="The order and lengths of the sections"
          />
          <Pick label="Length" value={length} options={LENGTHS} onChange={(v) => { setLength(v); setCustom(null); }} />
          <Pick label="Fills" value={fills} options={FILL_PLANS} onChange={setFills} title="Fills where one section goes into the next, and short turnarounds at the end of every 8 bars" />
          <ol className="plan" aria-label="Section plan">
            {sections.map((s, i) => (
              <li key={i} className={`plan-row kind-${s.kind}`}>
                <span className="swatch" />
                <select aria-label={`Section ${i + 1}`} value={s.kind} onKeyDown={stop} onChange={(e) => edit((x) => ((x[i].kind = e.target.value as SectionKind), x))}>
                  {SECTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindNames(k)}
                    </option>
                  ))}
                </select>
                <select aria-label={`Bars for section ${i + 1}`} value={s.bars} onKeyDown={stop} onChange={(e) => edit((x) => ((x[i].bars = Number(e.target.value)), x))}>
                  {BAR_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n} bars
                    </option>
                  ))}
                </select>
                <button className="icon" disabled={i === 0} onClick={() => edit((x) => (x.splice(i - 1, 0, x.splice(i, 1)[0]), x))} aria-label={`Move section ${i + 1} earlier`}>
                  ▲
                </button>
                <button className="icon" disabled={i === sections.length - 1} onClick={() => edit((x) => (x.splice(i + 1, 0, x.splice(i, 1)[0]), x))} aria-label={`Move section ${i + 1} later`}>
                  ▼
                </button>
                <button className="icon" disabled={sections.length <= 1} onClick={() => edit((x) => (x.splice(i, 1), x))} aria-label={`Remove section ${i + 1}`}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <div className="gen-buttons">
            <select aria-label="Section to add" value={addKind} onKeyDown={stop} onChange={(e) => setAddKind(e.target.value as SectionKind)}>
              {SECTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindNames(k)}
                </option>
              ))}
            </select>
            <button className="small" onClick={() => edit((x) => [...x, { kind: addKind, bars: addKind === 'build' ? 4 : 8 }])} title="Add a section at the end">
              + Add
            </button>
            <button className="small" disabled={!custom} onClick={resetPlan} title="Back to the form's sections">
              Reset
            </button>
          </div>
          <p className="about">
            {totalBars} bars · {duration((totalBars * 240) / bpm)} at {bpm} BPM
          </p>
        </div>

        <div className="gen-block" aria-label="Track">
          <div className="gen-title">3. Track</div>
          <div className="gen-buttons">
            <button
              className="small primary build-track"
              onClick={() => {
                const o = options();
                onBuild(o);
                setBuilt(o);
              }}
              title="Write the whole track as patterns and the song. A track built before is replaced; your own patterns stay. Ctrl+Z undoes it."
            >
              Build whole track
            </button>
            <button className="small play-track" disabled={!project.song.length} onClick={onPlay} title="Play the song from the start">
              ▶ Play track
            </button>
          </div>
          {timeline.length > 0 ? (
            <>
              <div className="timeline" aria-label="Track timeline">
                {timeline.map((s, i) => {
                  const on = playingIndex >= s.entry && playingIndex < s.entry + s.entries;
                  return (
                    <button
                      key={i}
                      className={`tl-section kind-${s.kind ?? 'own'} ${on ? 'playing' : ''}`}
                      style={{ flexGrow: s.bars }}
                      data-section={i}
                      onClick={() => onShowEntry(s.entry)}
                      title={`${s.name}: ${s.bars} bars, from bar ${s.start + 1}. Click to show its pattern.`}
                    >
                      <span>{s.name}</span>
                      <small>{s.bars}</small>
                    </button>
                  );
                })}
              </div>
              <p className="about">
                {songTotal} bars · {duration((songTotal * 240) / project.bpm)} · the song bar above has every block, to change or reorder by hand
              </p>
            </>
          ) : (
            <p className="about">Nothing built yet. The track goes into the song, ready to play and export (Ctrl+E).</p>
          )}
          {builtKinds.length > 0 && (
            <div className="retakes" aria-label="New take">
              <span className="hint">New take of:</span>
              {builtKinds.map((k) => (
                <button
                  key={k}
                  className={`small retake kind-${k}`}
                  disabled={!built}
                  onClick={() => {
                    if (!built) return;
                    const t = { ...takes, [k]: (takes[k] ?? 0) + 1 };
                    onRetake({ ...built, takes }, k);
                    setTakes(t);
                    setBuilt({ ...built, takes: t });
                  }}
                  title={built ? `New beats for every ${kindNames(k).toLowerCase()}; the other sections and your edits to them stay` : 'Build the track in this session first'}
                >
                  {sectionName(built ? resolveForm(project, built) : form, k)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
