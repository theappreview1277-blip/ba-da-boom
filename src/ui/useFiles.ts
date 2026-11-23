// Project files: open, save, new, the "save changes?" guard, autosave and crash recovery,
// and project files handed over by Windows (double-click).
import { allowSending, call, inPlugin, onProjectReplaced } from '../plugin/bridge';
import { useCallback, useEffect, useRef } from 'react';
import { newProject } from '../model/defaults';
import { parseProject, serializeProject } from '../model/serialize';
import type { Project } from '../model/types';
import type { UpdateState } from '../main/ipc';
import { desktop } from './desktop';
import type { AppCtx } from './appContext';
import type { Modal } from './Dialogs';

const AUTOSAVE_MS = 5000;

interface FileOptions {
  setModal: (m: Modal) => void;
  setUpdate: (u: UpdateState) => void;
  /** Stops playback (before another project is loaded). */
  stop: () => Promise<void>;
}

export function useFiles(ctx: AppCtx, opts: FileOptions) {
  const { dispatch, notify, fail, projectRef, stateRef } = ctx;
  const { setModal, setUpdate, stop } = opts;

  const loadText = useCallback(
    (text: string, path: string | null, saved: boolean, missing: string[] = []) => {
      try {
        const p = parseProject(text);
        dispatch({ type: 'load', project: p, path, saved });
        if (missing.length) notify(`${missing.length} sample file(s) could not be found. Tracks using them are marked "missing".`);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [dispatch, notify, fail],
  );

  const save = useCallback(
    async (saveAs = false) => {
      const p = projectRef.current;
      const st = stateRef.current;
      try {
        const res = await desktop.saveProject({ path: st.path, saveAs, name: p.name, text: serializeProject(p) });
        if (!res) return false;
        const name = res.path.split(/[\\/]/).pop()!.replace(/\.badaboom$/, '');
        const saved = p.name === name ? p : { ...p, name };
        if (saved !== p) dispatch({ type: 'transient', fn: () => saved });
        dispatch({ type: 'saved', path: res.path, project: saved });
        notify(
          res.notCollected.length
            ? `Saved, but ${res.notCollected.length} sample(s) could not be copied into the project folder.`
            : `Saved ${res.path}`,
        );
        return true;
      } catch (e) {
        fail(`Save failed: ${e instanceof Error ? e.message : e}`);
        return false;
      }
    },
    [dispatch, notify, fail, projectRef, stateRef],
  );

  /** Open a project: the one Windows handed over (`path`), or one picked in the Open dialog. */
  const open = useCallback(
    async (path?: string) => {
      try {
        const res = await desktop.openProject(path);
        if (res) {
          await stop();
          loadText(res.text, res.path, true, res.missing);
        }
      } catch (e) {
        fail(`Open failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    [loadText, fail, stop],
  );

  const newDoc = useCallback(async () => {
    await stop();
    dispatch({ type: 'load', project: newProject(), path: null, saved: true });
  }, [dispatch, stop]);

  const guarded = useCallback(
    (then: 'new' | 'open', path?: string) => {
      if (stateRef.current.savedProject !== projectRef.current) setModal({ kind: 'unsaved', then, path });
      else if (then === 'new') newDoc();
      else open(path);
    },
    [newDoc, open, setModal, projectRef, stateRef],
  );
  const restartToUpdate = useCallback(async () => {
    await desktop.autosaveWrite(serializeProject(projectRef.current)).catch(() => {});
    if (stateRef.current.savedProject !== projectRef.current) setModal({ kind: 'unsaved', then: 'update' });
    else await desktop.updateInstall();
  }, [setModal, projectRef, stateRef]);
  const guardedRef = useRef(guarded);
  guardedRef.current = guarded;

  /** After "Save changes?": go on with what was asked (close, update, new or open). */
  const proceed = useCallback(
    async (then: 'close' | 'new' | 'open' | 'update', path?: string) => {
      if (then === 'close') await desktop.closeReady();
      else if (then === 'update') await desktop.updateInstall();
      else if (then === 'new') newDoc();
      else open(path);
    },
    [newDoc, open],
  );

  // --- autosave and recovery, and project files opened from Windows ---
  // Inside the plugin the project lives in the host's project: load it when the screen opens,
  // and again when the host loads another one.
  useEffect(() => {
    if (!inPlugin) return;
    const fromPlugin = () =>
      call<{ project: string | null }>('getState')
        .then((s) => {
          if (s.project) loadText(s.project, null, true);
          allowSending(!!s.project);
        })
        .catch((e) => fail(String(e?.message ?? e)));
    void fromPlugin();
    return onProjectReplaced(() => void fromPlugin()) as () => void;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([desktop.autosaveRecover(), desktop.launchFile().catch(() => null), desktop.settingsGet().catch(() => null)]).then(([r, launch, settings]) => {
      // Unsaved work from a crash comes first; the file opens if the user starts fresh.
      if (r) setModal({ kind: 'recover', text: r.text, missing: r.missing, launch });
      else if (launch) guardedRef.current('open', launch);
      // The first time the app starts on its own, say hello.
      else if (settings && !settings.welcomed) setModal({ kind: 'welcome' });
    });
    desktop.onOpenFile((path) => guardedRef.current('open', path));
    desktop.onUpdateState(setUpdate);
    desktop.updateGet().then(setUpdate).catch(() => {});
    desktop.onBeforeClose(async () => {
      await desktop.autosaveWrite(serializeProject(projectRef.current)).catch(() => {});
      if (stateRef.current.savedProject !== projectRef.current) {
        await desktop.closePending();
        setModal({ kind: 'unsaved', then: 'close' });
      } else {
        await desktop.closeReady();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastAutosaved = useRef<Project | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = projectRef.current;
      if (p === lastAutosaved.current) return;
      lastAutosaved.current = p;
      desktop.autosaveWrite(serializeProject(p)).catch(() => {});
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [projectRef]);

  return { loadText, save, open, newDoc, guarded, restartToUpdate, proceed };
}
