// Playing live: the sound card, the drum pads, recording what is played, and MIDI controllers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackControls } from '../engine/strudel/fromModel';
import { currentLane, setStep } from '../model/ops';
import type { Project } from '../model/types';
import type { SoundSettings as SoundPrefs, ToolTab } from '../main/ipc';
import { assignKey, assignNote, hitStep, noteName, noteToPad, padKeyList, padNoteList } from '../model/live';
import { desktop } from './desktop';
import { findOutput, listOutputs, Midi, type MidiState, type OutputDevice } from './devices';
import type { AppCtx } from './appContext';

interface LiveOptions {
  engineReady: boolean;
  playing: boolean;
  setPlaying: (on: boolean) => void;
  tool: ToolTab;
  toolsOpen: boolean;
}

export function useLive(ctx: AppCtx, project: Project, opts: LiveOptions) {
  const { edit, notify, fail, projectRef, engineRef } = ctx;
  const { engineReady, playing, setPlaying, tool, toolsOpen } = opts;

  // --- sound settings (kept in the app's settings file) ---
  const [sound, setSound] = useState<SoundPrefs>({});
  const [soundLoaded, setSoundLoaded] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  /** The saved settings arrived (or could not be read): MIDI and the sound card can start. */
  const loadSound = useCallback((s: SoundPrefs | undefined) => {
    if (s) setSound(s);
    setSoundLoaded(true);
  }, []);
  const saveSound = useCallback((patch: Partial<SoundPrefs>) => {
    setSound((prev) => {
      const next = { ...prev, ...patch };
      if (next.output && !next.output.id) delete next.output;
      return next;
    });
    desktop.settingsSet({ sound: patch }).catch(() => {});
  }, []);

  // --- sound card ---
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [activeOutput, setActiveOutput] = useState<OutputDevice | null>(null);
  /** Play through the saved sound card when it is connected, otherwise the system default. */
  const applyOutput = useCallback(
    async (announce: boolean) => {
      const engine = engineRef.current;
      if (!engine) return;
      const list = await listOutputs();
      setOutputs(list);
      const saved = soundRef.current.output;
      const found = findOutput(list, saved);
      try {
        await engine.setOutput(found?.id ?? '');
        setActiveOutput(found);
        if (saved && !found && announce) notify(`${saved.label} is not connected, so sound plays through the system default.`);
      } catch (e) {
        setActiveOutput(null);
        if (saved) fail(`Could not play through ${saved.label}: ${e instanceof Error ? e.message : e}`);
      }
    },
    [notify, fail, engineRef],
  );
  useEffect(() => {
    if (!engineReady || !soundLoaded) return;
    void applyOutput(true);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    // A sound card plugged in or out: use the saved one again as soon as it is back.
    const onChange = () => void applyOutput(false);
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [engineReady, soundLoaded, applyOutput]);
  const chooseOutput = useCallback(
    (d: OutputDevice | null) => {
      soundRef.current = { ...soundRef.current, output: d ? { id: d.id, label: d.label } : undefined };
      // undefined is dropped on the way to the settings file, so the default is sent as an empty id.
      saveSound({ output: d ? { id: d.id, label: d.label } : { id: '', label: '' } });
      void applyOutput(false).then(() => notify(d ? `Playing through ${d.label}` : 'Playing through the system default'));
    },
    [saveSound, applyOutput, notify],
  );

  // --- pads and recording ---
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const takes = useRef(0);
  const padEls = useRef(new Map<number, HTMLButtonElement>());
  const padRef = useCallback((i: number) => (el: HTMLButtonElement | null) => {
    if (el) padEls.current.set(i, el);
    else padEls.current.delete(i);
  }, []);
  /** A live hit on track `index`: play it, light its pad and, while recording, write it into the pattern. */
  const hit = useCallback(
    (index: number, velocity: number) => {
      const p = projectRef.current;
      const t = p.tracks[index];
      const engine = engineRef.current;
      if (!t || !engine) return;
      // Where the hit falls, read first: playing it and lighting the pad take time
      // (a few ms on a busy machine), which would make a recorded hit late.
      const cycle = engine.isPlaying ? engine.patternCycle() : null;
      engine.hit(trackControls(t, index, p), t.sound.source === 'synth' ? null : t.sound.sampleId ?? null, velocity).catch(() => {});
      const pad = padEls.current.get(index);
      if (pad) {
        pad.classList.remove('hit');
        void pad.offsetWidth;
        pad.classList.add('hit');
      }
      if (!recordingRef.current || !engine.isPlaying) return;
      const patternId = engine.audiblePatternId;
      if (cycle == null || !patternId) return;
      const len = currentLane(p, patternId, t.id).length;
      const { step, micro } = hitStep(cycle, len, soundRef.current.quantise ?? true);
      edit((q) => setStep(q, patternId, t.id, step, { on: true, velocity: Math.round(velocity * 100) / 100, micro }), `rec:${takes.current}`);
    },
    [edit, projectRef, engineRef],
  );
  const hitRef = useRef(hit);
  hitRef.current = hit;
  const toggleRecord = useCallback(async () => {
    if (recordingRef.current) {
      setRecording(false);
      return;
    }
    // Each time recording starts is one take, and one undo step.
    takes.current++;
    setRecording(true);
    const engine = engineRef.current;
    if (engine && !engine.isPlaying) {
      await engine.play();
      setPlaying(engine.isPlaying);
    }
  }, [engineRef, setPlaying]);
  const toggleRecordRef = useRef(toggleRecord);
  toggleRecordRef.current = toggleRecord;
  useEffect(() => {
    if (!playing) setRecording(false);
  }, [playing]);

  // Choosing each pad's key and MIDI note: the pad waiting for one (tracks.length: none picked yet), or null.
  const [assigning, setAssigning] = useState<number | null>(null);
  const assignRef = useRef(assigning);
  assignRef.current = assigning;
  const assignTo = useCallback(
    (pad: number, what: { key?: string; note?: number }) => {
      const t = projectRef.current.tracks[pad];
      if (!t) return;
      edit((p) => {
        let q = what.key !== undefined ? assignKey(p, t.id, what.key) : p;
        if (what.note !== undefined) q = assignNote(q, t.id, what.note);
        return q;
      });
      // A key chosen here should work straight away.
      if (what.key && !soundRef.current.padKeys) saveSound({ padKeys: true });
      if (what.key === '' && what.note === -1) notify(`${t.name} has no key or MIDI note now`);
      else if (what.key) notify(`Key ${what.key.toUpperCase()} plays ${t.name}`);
      else if (what.note !== undefined && what.note >= 0) notify(`MIDI note ${noteName(what.note)} (${what.note}) plays ${t.name}`);
      // On to the next pad, so a whole kit can be set up in one go.
      if (what.key !== '' && what.note !== -1) setAssigning((a) => (a === pad ? pad + 1 : a));
    },
    [edit, saveSound, notify, projectRef],
  );
  const assignToRef = useRef(assignTo);
  assignToRef.current = assignTo;
  const padKeysShown = useMemo(() => padKeyList(project.tracks), [project.tracks]);
  const padNotesShown = useMemo(() => padNoteList(project.tracks, sound.midiMap ?? 'gm'), [project.tracks, sound.midiMap]);
  useEffect(() => {
    if (tool !== 'pads' || !toolsOpen) setAssigning(null);
  }, [tool, toolsOpen]);

  // --- MIDI controllers ---
  const midiRef = useRef<Midi | null>(null);
  const [midiState, setMidiState] = useState<MidiState>({ status: 'off', inputs: [], listening: [] });
  const [lastNote, setLastNote] = useState<{ note: number; input: string; track: string | null } | null>(null);
  useEffect(() => {
    const midi = new Midi();
    midiRef.current = midi;
    midi.onState = setMidiState;
    midi.onNote = (note, velocity, input) => {
      const p = projectRef.current;
      const target = assignRef.current;
      if (target !== null && target < p.tracks.length) {
        // Choosing notes: this note now plays the pad waiting for one.
        assignToRef.current(target, { note });
        setLastNote({ note, input, track: p.tracks[target].name });
        hitRef.current(target, velocity);
        return;
      }
      const i = noteToPad(note, p.tracks, soundRef.current.midiMap ?? 'gm');
      setLastNote({ note, input, track: i == null ? null : p.tracks[i].name });
      if (i != null) hitRef.current(i, velocity);
    };
    void midi.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Wait for the saved choice, so an input that is turned off is never opened.
    if (soundLoaded) midiRef.current?.use(sound.midiInput || null, sound.midiOff ?? false);
  }, [soundLoaded, sound.midiInput, sound.midiOff]);

  return {
    sound,
    soundRef,
    loadSound,
    saveSound,
    outputs,
    activeOutput,
    chooseOutput,
    recording,
    padRef,
    hit,
    hitRef,
    toggleRecord,
    toggleRecordRef,
    assigning,
    setAssigning,
    assignRef,
    assignTo,
    assignToRef,
    padKeysShown,
    padNotesShown,
    midiState,
    lastNote,
  };
}

export type Live = ReturnType<typeof useLive>;
