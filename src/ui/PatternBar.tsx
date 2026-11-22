// The pattern bar: one button per pattern (click to switch, drag to reorder, double-click to
// rename) and the pattern tools.
import { useEffect, useRef } from 'react';
import { emptyPattern } from '../model/defaults';
import { clearPattern, duplicatePattern, movePattern, pastePattern, PATTERN_NAME_MAX, renamePattern, setPatternLength } from '../model/ops';
import type { Pattern, Project } from '../model/types';
import { reorderProps, scrollIntoList } from './reorder';

const patternName = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26) + 1) : '');

interface PatternBarProps {
  project: Project;
  audiblePattern: string | null;
  queuedPattern: string | null;
  /** The pattern whose name is being typed, or null. */
  renaming: string | null;
  clipboard: Pattern | null;
  onRenaming: (id: string | null) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onCopy: () => void;
  edit: (fn: (p: Project) => Project) => void;
}

export function PatternBar({ project, audiblePattern, queuedPattern, renaming, clipboard, onRenaming, onSelect, onRemove, onCopy, edit }: PatternBarProps) {
  // Many patterns (a built track has around 15) stay on one line that scrolls; the current one is kept in view.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.pattern-btn.current');
    if (list && el) scrollIntoList(list, el);
  }, [project.currentPatternId]);

  return (
    <nav className="patternbar" aria-label="Patterns">
      <div className="pattern-list" ref={listRef}>
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
              if (e.key === 'Escape') onRenaming(null);
            }}
            onBlur={(e) => {
              const name = e.target.value;
              onRenaming(null);
              edit((p) => renamePattern(p, pt.id, name));
            }}
          />
        ) : (
          <button
            key={pt.id}
            className={`pattern-btn ${pt.id === project.currentPatternId ? 'current' : ''} ${pt.id === audiblePattern ? 'playing' : ''} ${pt.id === queuedPattern ? 'queued' : ''}`}
            onClick={() => onSelect(pt.id)}
            onDoubleClick={() => onRenaming(pt.id)}
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
      </div>
      <span className="sep" />
      <button className="small" onClick={() => onRenaming(project.currentPatternId)} title="Give this pattern a name (F2, or double-click it)">Rename</button>
      <button className="small" onClick={() => edit((p) => duplicatePattern(p, p.currentPatternId))} title="Duplicate pattern (Ctrl+D)">Duplicate</button>
      <button className="small" onClick={() => edit((p) => clearPattern(p, p.currentPatternId))} title="Clear every step in this pattern (Shift+Delete)">Clear</button>
      <button className="small" disabled={project.patterns.length <= 1} onClick={() => onRemove(project.currentPatternId)} title="Remove this pattern from the project (Ctrl+Delete)">Remove</button>
      <button className="small" onClick={onCopy} title="Copy pattern (Ctrl+Shift+C)">Copy</button>
      <button className="small" disabled={!clipboard} onClick={() => clipboard && edit((p) => pastePattern(p, p.currentPatternId, clipboard))} title="Paste pattern (Ctrl+Shift+V)">Paste</button>
      <label className="num small">
        Steps
        <select value="" onChange={(e) => e.target.value && edit((p) => setPatternLength(p, p.currentPatternId, Number(e.target.value)))} title="Set every lane in this pattern to the same length">
          <option value="">set all…</option>
          {[8, 12, 16, 24, 32, 48, 64].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
