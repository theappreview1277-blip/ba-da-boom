import type { MutableRefObject } from 'react';
import type { AudioEngine } from '../engine/audio/engine';
import type { Project } from '../model/types';
import type { useUiStore } from './store';

type Store = ReturnType<typeof useUiStore>;

/** What the main screen's hooks and panels share: the project, the engine and the way to report. */
export interface AppCtx {
  dispatch: Store['dispatch'];
  edit: Store['edit'];
  /** Always the newest project, for callbacks that must not change identity. */
  projectRef: MutableRefObject<Project>;
  stateRef: MutableRefObject<Store['state']>;
  engineRef: MutableRefObject<AudioEngine | null>;
  /** A short message at the bottom of the screen. */
  notify: (msg: string) => void;
  /** A problem: shown, and written to the error log. */
  fail: (msg: string) => void;
}

/** Strips Electron's "Error invoking remote method 'x': Error:" from errors that came from the main process. */
export const ipcMessage = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
