import { useState } from 'react';
import { CATEGORIES, CLASSICS, ROLE_NAMES, VARIANT_COUNT, classicById, classicHits, classicTempo, classicVariant, type ClassicOptions, type Role } from '../model/rhythm';

interface Props {
  onLoad: (opts: ClassicOptions) => void;
  onAddAll: (opts: Omit<ClassicOptions, 'variant'>) => void;
}

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

// Rows of the preview in a drummer's order, top to bottom.
const PREVIEW_ORDER: Role[] = ['crash', 'ride', 'openhat', 'hat', 'shaker', 'cowbell', 'clave', 'conga', 'tomhigh', 'tommid', 'tomlow', 'rim', 'clap', 'snare', 'kick'];

/**
 * The named beat library: well-known beats (Amen, Funky Drummer, Apache, Soul
 * Pride, boom bap, ...) each with named variants. Picking a variant always
 * writes exactly the same beat; the arrows step through the variants.
 */
export function BeatLibrary({ onLoad, onAddAll }: Props) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [classicId, setClassicId] = useState(CLASSICS[0].id);
  const [variant, setVariant] = useState(0);
  const [tempo, setTempo] = useState(true);
  const [find, setFind] = useState('');

  const c = classicById(classicId);
  const v = classicVariant(c, variant);
  const { bpm, swing } = classicTempo(c, v);
  const q = find.trim().toLowerCase();
  const list = q
    ? CLASSICS.filter((x) => `${x.name} ${x.category} ${x.about} ${x.variants.map((y) => y.name).join(' ')}`.toLowerCase().includes(q))
    : CLASSICS.filter((x) => x.category === category);
  const pickBeat = (id: string) => {
    setClassicId(id);
    setVariant(0);
    if (!q) setCategory(classicById(id).category);
  };
  const step = (d: number) => {
    const next = (((variant + d) % c.variants.length) + c.variants.length) % c.variants.length;
    setVariant(next);
    onLoad({ classicId, variant: next, tempo });
  };
  const rows = PREVIEW_ORDER.filter((r) => v.parts[r]);
  const length = Math.max(...rows.map((r) => v.parts[r]!.length));

  return (
    <section className="panel-section beatlib" aria-label="Beat library">
      <h3>
        Beat library <span className="sub">· {CLASSICS.length} named beats, {VARIANT_COUNT} variants · always the same beat, ready to edit</span>
      </h3>
      <div className="beatlib-body">
        <div className="beatlib-pick">
          <label className="pick">
            <span>Find</span>
            <input type="search" aria-label="Find a beat" placeholder="Amen, funky, trap…" value={find} onKeyDown={stop} onChange={(e) => setFind(e.target.value)} />
          </label>
          {!q && (
            <label className="pick">
              <span>Kind</span>
              <select
                aria-label="Kind"
                value={category}
                onKeyDown={stop}
                onChange={(e) => {
                  setCategory(e.target.value);
                  pickBeat(CLASSICS.find((x) => x.category === e.target.value)!.id);
                }}
              >
                {CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="pick">
            <span>Beat</span>
            <select aria-label="Beat" value={list.some((x) => x.id === classicId) ? classicId : ''} onKeyDown={stop} onChange={(e) => pickBeat(e.target.value)}>
              {!list.some((x) => x.id === classicId) && <option value="">{list.length ? 'Pick a beat' : 'No beats found'}</option>}
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="pick">
            <span>Variant</span>
            <select aria-label="Variant" value={variant} onKeyDown={stop} onChange={(e) => setVariant(Number(e.target.value))}>
              {c.variants.map((x, i) => (
                <option key={i} value={i}>
                  {i + 1}. {x.name}
                </option>
              ))}
            </select>
          </label>
          <p className="about" title={c.about}>
            {c.about}
          </p>
          <label className="check" title="Set the tempo and swing to this variant's">
            <input type="checkbox" checked={tempo} onChange={(e) => setTempo(e.target.checked)} /> Use its tempo and swing ({bpm} BPM{swing !== 50 ? `, ${swing}% swing` : ''})
          </label>
          <div className="gen-buttons">
            <button className="small" onClick={() => step(-1)} title="Previous variant: writes it into the pattern" aria-label="Previous variant">
              ◀
            </button>
            <button className="small primary" onClick={() => onLoad({ classicId, variant, tempo })} title="Write this beat into the pattern. Tracks it doesn't use are cleared; locked steps are kept.">
              Load beat
            </button>
            <button className="small" onClick={() => step(1)} title="Next variant: writes it into the pattern" aria-label="Next variant">
              ▶
            </button>
            <button className="small" onClick={() => onAddAll({ classicId, tempo })} title={`Add all ${c.variants.length} variants as new patterns after this one, ready for song mode`}>
              Add all {c.variants.length} as patterns
            </button>
          </div>
        </div>
        <div className="beatlib-preview" aria-label={`Preview of ${c.name}: ${v.name}`} style={{ ['--steps' as string]: length }}>
          <div className="beatlib-title">
            {c.name} · {v.name} · {length / 16} bar{length > 16 ? 's' : ''}
          </div>
          {rows.map((r) => {
            const hits = classicHits(v.parts[r]!);
            return (
              <div className="beatlib-row" key={r} data-role={r}>
                <span className="beatlib-role">{ROLE_NAMES[r]}</span>
                <span className="beatlib-cells">
                  {Array.from({ length }, (_, i) => {
                    const h = hits[i % hits.length];
                    return <span key={i} className={`${h ? 'on' : ''}${h && h.ratchet > 1 ? ' roll' : ''}${i % 16 === 0 ? ' bar' : i % 4 === 0 ? ' beat' : ''}`} style={h ? { opacity: 0.35 + 0.65 * h.velocity } : undefined} />;
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
