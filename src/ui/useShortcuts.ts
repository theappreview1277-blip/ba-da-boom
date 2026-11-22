// Keyboard shortcuts for the main screen (the full list is in KeyboardMap.tsx).
import { useEffect, useRef } from 'react';
import { clearLane, clearPattern, currentLane, currentPattern, duplicatePattern, movePattern, pasteLane, pastePattern, setStep, setTrack } from '../model/ops';
import { ASSIGNABLE_KEY, keyToPad } from '../model/live';
import type { AppCtx } from './appContext';
import type { Live } from './useLive';

interface ShortcutHandlers {
  live: Live;
  togglePlay: () => void;
  save: (saveAs: boolean) => void;
  guarded: (then: 'new' | 'open') => void;
  openExport: () => void;
  openKeys: () => void;
  rename: (id: string) => void;
  askRemovePattern: (id: string) => void;
  selectPattern: (id: string) => void;
  toggleView: () => void;
  songMode: () => boolean;
  setSongMode: (on: boolean) => void;
  tap: () => void;
  auditionTrack: (id: string) => void;
}

/** `blocked`: a dialog is open, so shortcuts are off. */
export function useShortcuts(ctx: AppCtx, blocked: boolean, handlers: ShortcutHandlers) {
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const { dispatch, edit, notify, projectRef, stateRef } = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = hRef.current;
      const live = h.live;
      const target = e.target as HTMLElement;
      // Typing in a field must not trigger shortcuts; checkboxes and buttons are fine.
      if (blocked || target.closest('input:not([type=checkbox]):not([type=radio]), select, textarea')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const st = stateRef.current;
      const p = projectRef.current;
      const k = e.key.toLowerCase();
      const waiting = live.assignRef.current;
      if (waiting !== null && !ctrl && !e.altKey) {
        // Choosing keys: the next key pressed goes to the pad waiting for one.
        if (e.key === 'Escape') live.setAssigning(null);
        else if (waiting >= p.tracks.length) {
          if (e.key.length !== 1) return;
          notify('Click the pad to give that key to first.');
        } else if (e.key === 'Backspace' || e.key === 'Delete') live.assignToRef.current(waiting, { key: '', note: -1 });
        else if (ASSIGNABLE_KEY.test(k)) {
          if (!e.repeat) {
            live.assignToRef.current(waiting, { key: k });
            live.hitRef.current(waiting, 0.8);
          }
        } else if (e.key.length === 1 || e.key === 'Enter') notify(`${e.key === ' ' ? 'Space' : e.key} can't play a pad. Use a letter, a number or a punctuation key.`);
        else return; // Tab, arrows and the like keep working.
        e.preventDefault();
        return;
      }
      const pad = live.soundRef.current.padKeys && !ctrl && !e.altKey ? keyToPad(k, p.tracks) : -1;
      if (pad >= 0) {
        // While "Keys play pads" is on, these letters play the pads instead of their shortcuts.
        e.preventDefault();
        if (!e.repeat && pad < p.tracks.length) live.hitRef.current(pad, 0.8);
        return;
      }
      if (!ctrl && !e.altKey && k === 'r') {
        e.preventDefault();
        if (!e.repeat) void live.toggleRecordRef.current();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        h.togglePlay();
      } else if (ctrl && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (ctrl && k === 's') {
        e.preventDefault();
        h.save(e.shiftKey);
      } else if (ctrl && k === 'o') {
        e.preventDefault();
        h.guarded('open');
      } else if (ctrl && k === 'e') {
        e.preventDefault();
        h.openExport();
      } else if (ctrl && k === 'c') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'copyPattern', pattern: currentPattern(p) });
        else dispatch({ type: 'copyLane', lane: currentLane(p, p.currentPatternId, st.selectedTrack) });
        notify(e.shiftKey ? 'Pattern copied' : 'Track lane copied');
      } else if (ctrl && k === 'v') {
        e.preventDefault();
        if (e.shiftKey && st.patternClipboard) edit((q) => pastePattern(q, q.currentPatternId, st.patternClipboard!));
        else if (!e.shiftKey && st.laneClipboard) edit((q) => pasteLane(q, q.currentPatternId, st.selectedTrack, st.laneClipboard!));
      } else if (ctrl && k === 'd') {
        e.preventDefault();
        edit((q) => duplicatePattern(q, q.currentPatternId));
      } else if (e.key === 'F2') {
        e.preventDefault();
        h.rename(p.currentPatternId);
      } else if (ctrl && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (p.patterns.length > 1) h.askRemovePattern(p.currentPatternId);
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const i = p.patterns.findIndex((x) => x.id === p.currentPatternId);
        edit((q) => movePattern(q, q.currentPatternId, i + (e.key === 'ArrowLeft' ? -1 : 1)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.shiftKey) edit((q) => clearPattern(q, q.currentPatternId));
        else edit((q) => clearLane(q, q.currentPatternId, st.selectedTrack));
      } else if (!ctrl && /^[1-8]$/.test(e.key)) {
        const target = p.patterns[Number(e.key) - 1];
        if (target) h.selectPattern(target.id);
      } else if (!ctrl && k === 'm') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t) edit((q) => setTrack(q, t.id, { mute: !t.mute }));
      } else if (!ctrl && k === 's') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t) edit((q) => setTrack(q, t.id, { solo: !t.solo }));
      } else if (!ctrl && k === 'l') {
        const s = currentLane(p, p.currentPatternId, st.selectedTrack).steps[st.selectedStep];
        if (s) edit((q) => setStep(q, q.currentPatternId, st.selectedTrack, st.selectedStep, { locked: !s.locked }));
      } else if (!ctrl && k === 'p') {
        h.toggleView();
      } else if (!ctrl && k === 'g') {
        if (h.songMode() || p.song.length) h.setSongMode(!h.songMode());
      } else if (!ctrl && k === 'k') {
        edit((q) => ({ ...q, metronome: !q.metronome }));
      } else if (!ctrl && !e.altKey && k === 't') {
        if (!e.repeat) h.tap();
      } else if (!ctrl && (e.key === '?' || e.key === 'F1')) {
        e.preventDefault();
        h.openKeys();
      } else if (!ctrl && k === 'a') {
        const t = p.tracks.find((x) => x.id === st.selectedTrack);
        if (t) h.auditionTrack(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, dispatch, edit, notify, projectRef, stateRef]);
}
