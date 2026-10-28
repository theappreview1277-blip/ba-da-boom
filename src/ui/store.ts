// UI-side state: project history plus selection and document state.
import { useCallback, useReducer } from 'react';
import { newProject } from '../model/defaults';
import { commit, historyOf, redo, replacePresent, undo, type History } from '../model/ops';
import type { Lane, Pattern, Project } from '../model/types';

export interface UiState {
  history: History;
  selectedTrack: string;
  selectedStep: number;
  /** Where the document lives on disk; null until first saved. */
  path: string | null;
  /** Project object at the last save, to detect unsaved changes. */
  savedProject: Project | null;
  laneClipboard: Lane | null;
  patternClipboard: Pattern | null;
}

type Action =
  | { type: 'edit'; fn: (p: Project) => Project; mergeKey?: string }
  | { type: 'transient'; fn: (p: Project) => Project }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; project: Project; path: string | null; saved: boolean }
  | { type: 'saved'; path: string; project: Project }
  | { type: 'select'; track?: string; step?: number }
  | { type: 'copyLane'; lane: Lane }
  | { type: 'copyPattern'; pattern: Pattern };

function reducer(s: UiState, a: Action): UiState {
  switch (a.type) {
    case 'edit':
      return { ...s, history: commit(s.history, a.fn(s.history.present), a.mergeKey) };
    case 'transient':
      return { ...s, history: replacePresent(s.history, a.fn(s.history.present)) };
    case 'undo':
      return { ...s, history: undo(s.history) };
    case 'redo':
      return { ...s, history: redo(s.history) };
    case 'load':
      return {
        ...s,
        history: historyOf(a.project),
        path: a.path,
        savedProject: a.saved ? a.project : null,
        selectedTrack: a.project.tracks[0].id,
        selectedStep: 0,
      };
    case 'saved':
      return { ...s, path: a.path, savedProject: a.project };
    case 'select':
      return { ...s, selectedTrack: a.track ?? s.selectedTrack, selectedStep: a.step ?? s.selectedStep };
    case 'copyLane':
      return { ...s, laneClipboard: structuredClone(a.lane) };
    case 'copyPattern':
      return { ...s, patternClipboard: structuredClone(a.pattern) };
  }
}

export function useUiStore() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const project = newProject();
    return {
      history: historyOf(project),
      selectedTrack: project.tracks[0].id,
      selectedStep: 0,
      path: null,
      savedProject: project,
      laneClipboard: null,
      patternClipboard: null,
    } satisfies UiState;
  });
  const edit = useCallback((fn: (p: Project) => Project, mergeKey?: string) => dispatch({ type: 'edit', fn, mergeKey }), []);
  return { state, dispatch, edit };
}
