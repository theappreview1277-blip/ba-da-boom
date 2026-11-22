// Where sounds come from: imported files, the drum machine kits, the user's sample folders
// and favourites, and putting a sound on a track.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FACTORY_SAMPLES } from '../model/factory';
import { kitAssignments, kitLabel, kitSampleName } from '../model/kits';
import { setTrack, setTrackSound } from '../model/ops';
import { SAMPLE_FILE, sampleName } from '../model/audioFiles';
import type { Project, SampleRef } from '../model/types';
import type { FolderListing, KitProgress, KitSample } from '../main/ipc';
import { toWav } from '../engine/audio/convert';
import { desktop } from './desktop';
import { ipcMessage, type AppCtx } from './appContext';

export function useSamples(ctx: AppCtx, project: Project) {
  const { edit, notify, fail, projectRef, engineRef } = ctx;

  const importFiles = useCallback(
    async (files: File[], assignTo?: string) => {
      let lastId: string | null = null;
      for (const f of files) {
        if (!SAMPLE_FILE.test(f.name)) {
          notify(`${f.name}: use WAV, AIFF, MP3, FLAC or OGG sound files.`);
          continue;
        }
        try {
          const bytes = await toWav(f.name, new Uint8Array(await f.arrayBuffer()));
          const { file } = await desktop.importSample(f.name, bytes);
          const id = `user:${file}`;
          const ref: SampleRef = { id, name: sampleName(f.name), source: 'user', file, originalName: f.name };
          edit((p) => ({ ...p, samples: { ...p.samples, [id]: ref } }));
          lastId = id;
        } catch (e) {
          fail(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (assignTo && lastId) {
        const id = lastId;
        edit((p) => setTrackSound(p, assignTo, { sampleId: id }));
      }
      if (lastId) notify(`Imported ${files.length === 1 ? files[0].name : `${files.length} files`}`);
    },
    [edit, notify, fail],
  );

  // Strudel drum machine kits, downloaded when picked.
  const [kits, setKits] = useState<Record<string, Record<string, number>>>({});
  const [kitProgress, setKitProgress] = useState<KitProgress | null>(null);
  // Progress messages can arrive after the load has finished; only the running load's count.
  const kitLoading = useRef<string | null>(null);
  useEffect(() => {
    desktop.kitList().then(setKits, () => {});
    desktop.onKitProgress((p) => {
      if (p.kit === kitLoading.current) setKitProgress(p);
    });
  }, []);
  const loadKit = useCallback(
    async (name: string) => {
      if (name === 'factory') {
        edit((p) => ({ ...p, tracks: p.tracks.map((t, i) => (FACTORY_SAMPLES[i] ? { ...t, sound: { ...t.sound, sampleId: `factory:${FACTORY_SAMPLES[i].key}` } } : t)) }));
        notify('Factory kit on every track');
        return;
      }
      if (kitLoading.current) return;
      kitLoading.current = name;
      setKitProgress({ kit: name, done: 0, total: 0 });
      try {
        const r = await desktop.kitDownload(name);
        const got: Record<string, KitSample[]> = {};
        for (const s of r.samples) (got[s.sound] ??= []).push(s);
        const refs: Record<string, SampleRef> = {};
        for (const [sound, list] of Object.entries(got)) {
          list.sort((a, b) => a.index - b.index);
          list.forEach((s, i) => {
            const id = `user:${s.file}`;
            // Kits sometimes contain the same file twice; the first name wins.
            if (!refs[id]) refs[id] = { id, name: kitSampleName(name, sound, i, list.length), source: 'user', file: s.file, kit: name };
          });
        }
        const plan = kitAssignments(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.map((s) => s.file)])), projectRef.current.tracks.length);
        edit((p) => ({
          ...p,
          samples: { ...p.samples, ...refs },
          tracks: p.tracks.map((t, i) => {
            const a = plan[i];
            return a ? { ...t, sound: { ...t.sound, sampleId: `user:${got[a[0]][a[1]].file}` } } : t;
          }),
        }));
        const kept = projectRef.current.tracks.filter((_, i) => !plan[i]).map((t) => t.name);
        (window as any).__lastKit = { ...r, assigned: plan.filter(Boolean).length, kept };
        notify(
          `${kitLabel(name)}${r.downloaded ? ' downloaded' : ''}: on ${plan.filter(Boolean).length} of ${plan.length} tracks` +
            (kept.length ? ` (no sound for ${kept.join(', ')}, kept as before)` : '') +
            (r.failed ? `. ${r.failed} file${r.failed === 1 ? '' : 's'} could not be loaded.` : ''),
        );
      } catch (e) {
        fail(`Could not load ${kitLabel(name)}: ${ipcMessage(e)}`);
      } finally {
        kitLoading.current = null;
        setKitProgress(null);
      }
    },
    [edit, notify, fail, projectRef],
  );
  const currentKit = useMemo(() => {
    const ids = project.tracks.map((t) => t.sound.sampleId ?? '');
    if (ids.every((id, i) => !FACTORY_SAMPLES[i] || id === `factory:${FACTORY_SAMPLES[i].key}`)) return 'factory';
    const used = new Set(ids.map((id) => project.samples[id]?.kit).filter(Boolean));
    return used.size === 1 ? [...used][0]! : '';
  }, [project.tracks, project.samples]);

  /** Put a sample on a track; `ref` adds it to the project first (one undo step for both). */
  const assignSample = useCallback(
    (trackId: string, sampleId: string, ref?: SampleRef) => {
      edit((p0) => {
        const p = ref && !p0.samples[ref.id] ? { ...p0, samples: { ...p0.samples, [ref.id]: ref } } : p0;
        const name = p.samples[sampleId]?.name;
        const t = p.tracks.find((x) => x.id === trackId);
        const renamed = t && name && t.name === p.samples[t.sound.sampleId ?? '']?.name ? setTrack(p, trackId, { name }) : p;
        return setTrackSound(renamed, trackId, { sampleId });
      });
    },
    [edit],
  );

  // The user's sample folders and favourites (kept in the app's settings).
  const [folders, setFolders] = useState<FolderListing[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  useEffect(() => {
    desktop.folderList().then(setFolders, () => {});
  }, []);
  const rescan = useCallback(() => desktop.folderList().then(setFolders, () => {}), []);
  const folderSample = useCallback(async (folder: string, file: string): Promise<SampleRef> => {
    const base = file.split('/').pop()!;
    const got = await desktop.folderRead(folder, file);
    const pool = 'file' in got ? got.file : (await desktop.importSample(base, await toWav(base, got.bytes))).file;
    return { id: `user:${pool}`, name: sampleName(base), source: 'user', file: pool, originalName: base };
  }, []);
  const folderError = useCallback((file: string, e: unknown) => fail(`Could not use ${file}: ${ipcMessage(e)}`), [fail]);
  const auditionFolderFile = useCallback(
    async (folder: string, file: string) => {
      try {
        const ref = await folderSample(folder, file);
        const engine = engineRef.current;
        if (engine && (projectRef.current.samples[ref.id] || (await engine.previewSample(ref)))) engine.audition(ref.id);
        (window as any).__lastPreview = ref;
      } catch (e) {
        folderError(file, e);
      }
    },
    [folderSample, folderError, engineRef, projectRef],
  );
  const assignFolderFile = useCallback(
    async (trackId: string, folder: string, file: string) => {
      try {
        const ref = await folderSample(folder, file);
        assignSample(trackId, ref.id, projectRef.current.samples[ref.id] ?? ref);
      } catch (e) {
        folderError(file, e);
      }
    },
    [folderSample, folderError, assignSample, projectRef],
  );
  const addFolder = useCallback(async () => {
    const l = await desktop.folderAdd().catch(() => null);
    if (!l) return;
    setFolders((fs) => [...fs.filter((f) => f.path !== l.path), l]);
    notify(`Added ${l.path}: ${l.files.length}${l.truncated ? '+' : ''} sound file${l.files.length === 1 ? '' : 's'}`);
  }, [notify]);
  const removeFolder = useCallback(
    async (path: string) => {
      await desktop.folderRemove(path);
      setFolders((fs) => fs.filter((f) => f.path !== path));
      notify(`Removed ${path} from the list. The files are still there.`);
    },
    [notify],
  );
  const toggleFavourite = useCallback((key: string) => {
    setFavourites((f) => {
      const n = new Set(f);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      desktop.settingsSet({ favourites: [...n] }).catch(() => {});
      return n;
    });
  }, []);

  return {
    importFiles,
    kits,
    kitProgress,
    loadKit,
    currentKit,
    assignSample,
    folders,
    rescan,
    favourites,
    setFavourites,
    auditionFolderFile,
    assignFolderFile,
    addFolder,
    removeFolder,
    toggleFavourite,
  };
}
