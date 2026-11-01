import { useMemo, useState } from 'react';
import type { Project, SampleRef } from '../model/types';
import type { SampleStatus } from '../engine/audio/engine';
import type { FolderListing, KitProgress } from '../main/ipc';
import { kitLabel } from '../model/kits';

interface Props {
  project: Project;
  selectedSampleId: string | null;
  status: (id: string) => SampleStatus | undefined;
  onAudition: (id: string) => void;
  onAssign: (id: string) => void;
  onImport: (files: File[]) => void;
  /** Strudel drum machine kits: name -> sound -> variants. */
  kits: Record<string, Record<string, number>>;
  /** 'factory', a kit name, or '' when the tracks use a mix. */
  currentKit: string;
  kitProgress: KitProgress | null;
  onKit: (name: string) => void;
  /** The user's sample folders. */
  folders: FolderListing[];
  favourites: Set<string>;
  onFavourite: (key: string) => void;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onRescan: () => void;
  onFolderAudition: (folder: string, file: string) => void;
  onFolderAssign: (folder: string, file: string) => void;
}

interface Item {
  /** Favourite key: a sample id for factory sounds, "pool:<file>" for others, "file:<folder>|<path>" for folder files. */
  key: string;
  label: string;
  title: string;
  sampleId?: string;
  folder?: string;
  file?: string;
}

interface Group {
  title: string;
  items: Item[];
  /** Total before the display limit. */
  total: number;
  folder?: FolderListing;
  empty: string;
}

/** Folder groups show this many files; the filter finds the rest. */
const FOLDER_LIMIT = 500;

export const sampleKey = (s: SampleRef) => (s.source === 'factory' ? s.id : `pool:${s.file}`);
export const folderKey = (folder: string, file: string) => `file:${folder}|${file}`;
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function SampleBrowser(props: Props) {
  const { project, selectedSampleId, status, onAudition, onAssign, onImport, kits, currentKit, kitProgress, onKit, folders, favourites } = props;
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo((): Group[] => {
    const all = Object.values(project.samples).filter((s) => !s.file.startsWith('metro-'));
    const f = filter.trim().toLowerCase();
    const match = (text: string) => !f || text.toLowerCase().includes(f);
    const sampleItem = (s: SampleRef, prefix = ''): Item => ({
      key: sampleKey(s),
      label: prefix && s.name.startsWith(prefix) ? s.name.slice(prefix.length) : s.name,
      title: s.originalName ?? s.name,
      sampleId: s.id,
    });
    const fileItem = (folder: string, file: string): Item => ({ key: folderKey(folder, file), label: file.replace(/\.wav$/i, ''), title: `${folder} › ${file}`, folder, file });
    const kitNames = [...new Set(all.map((s) => s.kit).filter((k): k is string => !!k))].sort();
    const samplesBy = (keep: (s: SampleRef) => boolean, prefix = '') => all.filter((s) => keep(s) && match(s.name)).map((s) => sampleItem(s, prefix));
    const favs = [
      ...all.filter((s) => favourites.has(sampleKey(s)) && match(s.name)).map((s) => sampleItem(s)),
      ...folders.flatMap((fo) => fo.files.filter((file) => favourites.has(folderKey(fo.path, file)) && match(file)).map((file) => fileItem(fo.path, file))),
    ];
    const out: Group[] = [];
    if (favs.length) out.push({ title: 'Favourites', items: favs, total: favs.length, empty: '' });
    const factory = samplesBy((s) => s.source === 'factory');
    out.push({ title: 'Factory kit', items: factory, total: factory.length, empty: 'No matches' });
    for (const k of kitNames) {
      const items = samplesBy((s) => s.kit === k, `${kitLabel(k)} `);
      if (items.length) out.push({ title: kitLabel(k), items, total: items.length, empty: '' });
    }
    const imported = samplesBy((s) => s.source === 'user' && !s.kit);
    out.push({ title: 'Imported', items: imported, total: imported.length, empty: f ? 'No matches' : 'Drop WAV files here' });
    for (const fo of folders) {
      const files = fo.files.filter(match);
      out.push({
        title: folderName(fo.path),
        folder: fo,
        items: files.slice(0, FOLDER_LIMIT).map((file) => fileItem(fo.path, file)),
        total: files.length,
        empty: !fo.readable ? 'Folder not found. Is the drive connected?' : f ? 'No matches' : 'No WAV files in this folder',
      });
    }
    return out;
  }, [project.samples, filter, folders, favourites]);

  const toggle = (title: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      return n;
    });
  const audition = (it: Item) => (it.sampleId ? onAudition(it.sampleId) : props.onFolderAudition(it.folder!, it.file!));
  const assign = (it: Item) => (it.sampleId ? onAssign(it.sampleId) : props.onFolderAssign(it.folder!, it.file!));

  return (
    <div
      className="browser"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) onImport([...e.dataTransfer.files]);
      }}
    >
      <label className="kit-pick">
        Kit
        <select
          value={kitProgress ? kitProgress.kit : currentKit}
          disabled={!!kitProgress}
          aria-label="Kit"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => e.target.value && onKit(e.target.value)}
          title="Put a whole kit on the tracks: the factory kit or one of Strudel's drum machines."
        >
          <option value="factory">Factory</option>
          {currentKit === '' && !kitProgress && <option value="">Mixed</option>}
          {Object.keys(kits).length > 0 && (
            <optgroup label="Strudel drum machines">
              {Object.entries(kits).map(([name, sounds]) => (
                <option key={name} value={name}>
                  {kitLabel(name)} ({Object.values(sounds).reduce((a, b) => a + b, 0)})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {kitProgress && (
        <div className="kit-progress" role="status">
          {kitProgress.total ? `Loading ${kitLabel(kitProgress.kit)}… ${kitProgress.done} / ${kitProgress.total}` : `Loading ${kitLabel(kitProgress.kit)}…`}
        </div>
      )}
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
      <p className="hint">Click to audition. Double-click or drag onto a track to assign. ☆ adds to favourites. Drop WAV files here to import.</p>
      <div className="folder-actions">
        <button className="small" onClick={props.onAddFolder} title="Add a folder of WAV files to this list. It is remembered next time.">
          Add folder…
        </button>
        {folders.length > 0 && (
          <button className="small" onClick={props.onRescan} title="Look for new or removed files in your folders">
            Refresh
          </button>
        )}
      </div>
      {groups.map((g) => {
        const key = g.folder ? `folder:${g.folder.path}` : g.title;
        const open = !collapsed.has(key);
        return (
          <div key={key} className={`browser-group ${g.folder ? 'folder' : ''}`} data-folder={g.folder?.path}>
            <div className="group-head">
              <h4 onClick={() => toggle(key)} aria-expanded={open} title={g.folder ? g.folder.path : undefined}>
                {g.title}
              </h4>
              <span className="group-count">{g.total}</span>
              {g.folder && (
                <button className="icon" aria-label={`Remove folder ${g.title}`} title="Remove this folder from the list (the files stay where they are)" onClick={() => props.onRemoveFolder(g.folder!.path)}>
                  ×
                </button>
              )}
            </div>
            {open && (
              <>
                {g.items.length === 0 && g.empty && <div className="empty">{g.empty}</div>}
                <ul role="listbox" aria-label={g.title}>
                  {g.items.map((it) => {
                    const st = it.sampleId ? status(it.sampleId) : undefined;
                    const fav = favourites.has(it.key);
                    return (
                      <li
                        key={it.key}
                        role="option"
                        aria-selected={!!it.sampleId && it.sampleId === selectedSampleId}
                        tabIndex={0}
                        draggable
                        className={`sample ${it.sampleId && it.sampleId === selectedSampleId ? 'current' : ''} ${st === 'missing' ? 'missing' : ''}`}
                        onDragStart={(e) => {
                          if (it.sampleId) e.dataTransfer.setData('application/x-bdb-sample', it.sampleId);
                          else e.dataTransfer.setData('application/x-bdb-folder-file', JSON.stringify({ folder: it.folder, file: it.file }));
                        }}
                        onClick={() => audition(it)}
                        onDoubleClick={() => assign(it)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            assign(it);
                          }
                        }}
                        title={it.title}
                      >
                        <span className="name">{it.label}</span>
                        {st === 'missing' && <span className="badge warn">missing</span>}
                        {st === 'loading' && <span className="badge">…</span>}
                        <button
                          className={`star ${fav ? 'on' : ''}`}
                          aria-label={`${fav ? 'Remove from' : 'Add to'} favourites: ${it.label}`}
                          aria-pressed={fav}
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onFavourite(it.key);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {fav ? '★' : '☆'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {g.total > g.items.length && <div className="more">Showing {g.items.length} of {g.total}. Type in the filter to find the rest.</div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
