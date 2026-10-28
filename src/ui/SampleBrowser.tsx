import { useMemo, useState } from 'react';
import type { Project, SampleRef } from '../model/types';
import type { SampleStatus } from '../engine/audio/engine';

interface Props {
  project: Project;
  selectedSampleId: string | null;
  status: (id: string) => SampleStatus | undefined;
  onAudition: (id: string) => void;
  onAssign: (id: string) => void;
  onImport: (files: File[]) => void;
}

export function SampleBrowser({ project, selectedSampleId, status, onAudition, onAssign, onImport }: Props) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const all = Object.values(project.samples).filter((s) => !s.file.startsWith('metro-'));
    const f = filter.trim().toLowerCase();
    const match = (s: SampleRef) => !f || s.name.toLowerCase().includes(f);
    return [
      { title: 'Factory kit', items: all.filter((s) => s.source === 'factory' && match(s)) },
      { title: 'Imported', items: all.filter((s) => s.source === 'user' && match(s)) },
    ];
  }, [project.samples, filter]);

  return (
    <div
      className="browser"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) onImport([...e.dataTransfer.files]);
      }}
    >
      <div className="browser-head">
        <input
          type="search"
          placeholder="Filter samples"
          value={filter}
          aria-label="Filter samples"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="button small">
          Import…
          <input
            type="file"
            accept=".wav,audio/wav"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) onImport([...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="hint">Click to audition. Double-click or drag onto a track to assign. Drop WAV files here to import.</p>
      {groups.map((g) => (
        <div key={g.title} className="browser-group">
          <h4>{g.title}</h4>
          {g.items.length === 0 && <div className="empty">{g.title === 'Imported' ? 'Drop WAV files here' : 'No matches'}</div>}
          <ul role="listbox" aria-label={g.title}>
            {g.items.map((s) => {
              const st = status(s.id);
              return (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={s.id === selectedSampleId}
                  tabIndex={0}
                  draggable
                  className={`sample ${s.id === selectedSampleId ? 'current' : ''} ${st === 'missing' ? 'missing' : ''}`}
                  onDragStart={(e) => e.dataTransfer.setData('application/x-bdb-sample', s.id)}
                  onClick={() => onAudition(s.id)}
                  onDoubleClick={() => onAssign(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onAssign(s.id);
                    }
                  }}
                  title={s.originalName ?? s.name}
                >
                  {s.name}
                  {st === 'missing' && <span className="badge warn">missing</span>}
                  {st === 'loading' && <span className="badge">…</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
