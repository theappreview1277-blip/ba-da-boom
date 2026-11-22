// The top bar: file and edit buttons, transport, tempo, master and view switches.
// When the window is narrow, button names are hidden step by step until it fits on one line.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Project } from '../model/types';
import { NumberField, Slider, db } from './controls';
import { Icon } from './icons';
import { Logo } from './Logo';

export interface MeterRefs {
  masterL: Ref<HTMLDivElement>;
  masterR: Ref<HTMLDivElement>;
  clip: Ref<HTMLButtonElement>;
  limit: Ref<HTMLSpanElement>;
}

interface TopBarProps {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  playing: boolean;
  engineReady: boolean;
  view: 'edit' | 'perform';
  winWidth: number;
  meters: MeterRefs;
  onNew: () => void;
  onOpen: () => void;
  onSave: (saveAs: boolean) => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onTap: () => void;
  onProject: (fn: (p: Project) => Project, gesture?: string) => void;
  onResetClip: () => void;
  onView: (v: 'edit' | 'perform') => void;
  onSettings: () => void;
  onAbout: () => void;
}

export function TopBar(props: TopBarProps) {
  const { project, playing, view, winWidth, meters, onProject } = props;
  const topbarRef = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(0);
  const fitTopbar = useCallback(() => {
    const el = topbarRef.current;
    if (!el) return;
    // One line when no item has wrapped below the first one.
    const oneLine = () => {
      const items = [...el.children] as HTMLElement[];
      const top = items[0]?.getBoundingClientRect().bottom ?? 0;
      return items.every((c) => c.getBoundingClientRect().top < top);
    };
    const apply = (level: number) => {
      el.classList.remove('c1', 'c2', 'c3', 'c4', 'c5');
      for (let i = 1; i <= level; i++) el.classList.add(`c${i}`);
    };
    let level = 0;
    for (; level < 5; level++) {
      apply(level);
      if (oneLine()) break;
    }
    apply(level);
    setCompact(level);
  }, []);
  useLayoutEffect(fitTopbar, [fitTopbar, winWidth, view, playing]);
  useEffect(() => {
    // Fonts can arrive after the first layout and change the widths.
    document.fonts?.ready.then(fitTopbar).catch(() => {});
  }, [fitTopbar]);

  return (
    <header className={`topbar ${compact ? Array.from({ length: compact }, (_, i) => `c${i + 1}`).join(' ') : ''}`} ref={topbarRef}>
      <div className="brand">
        <Logo size={22} />
        <span className="lbl">Ba-da-boom</span>
      </div>
      <div className="group" role="toolbar" aria-label="File">
        <button className="tb" onClick={props.onNew} title="New project" aria-label="New"><Icon name="new" /><span className="lbl">New</span></button>
        <button className="tb" onClick={props.onOpen} title="Open project (Ctrl+O)" aria-label="Open"><Icon name="open" /><span className="lbl">Open</span></button>
        <button className="tb" onClick={() => props.onSave(false)} title="Save (Ctrl+S)" aria-label="Save"><Icon name="save" /><span className="lbl">Save</span></button>
        <button className="tb" onClick={() => props.onSave(true)} title="Save as (Ctrl+Shift+S)" aria-label="Save as"><Icon name="saveAs" /><span className="lbl">Save as</span></button>
        <button className="tb" onClick={props.onExport} title="Export WAV, stems or MIDI (Ctrl+E)" aria-label="Export WAV"><Icon name="export" /><span className="lbl">Export WAV</span></button>
      </div>
      <div className="group" role="toolbar" aria-label="Edit">
        <button className="tb" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /><span className="lbl">Undo</span></button>
        <button className="tb" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /><span className="lbl">Redo</span></button>
      </div>
      <div className="group transport" role="toolbar" aria-label="Transport">
        <button className={`play ${playing ? 'on' : ''}`} onClick={props.onPlay} disabled={!props.engineReady} title="Play / stop (Space)">
          <Icon name={playing ? 'stop' : 'play'} size={18} />
          <span className="lbl">{playing ? 'Stop' : 'Play'}</span>
        </button>
        <NumberField label="BPM" value={project.bpm} min={20} max={300} decimals={1} wheel onCommit={(v, k) => onProject((p) => ({ ...p, bpm: v }), k)} title="Type a tempo (20–300) and press Enter. Arrow keys or mouse wheel: ±1, with Shift: ±10" />
        <button className="small tap" onClick={props.onTap} title="Tap tempo (T): click in time with the music, the tempo follows">
          Tap
        </button>
        <Slider label="Swing" value={project.swing} min={50} max={75} step={0.5} format={(v) => `${v.toFixed(1)}%`} onChange={(v, k) => onProject((p) => ({ ...p, swing: v }), k)} />
        <button className={`toggle ${project.metronome ? 'on' : ''}`} aria-pressed={project.metronome} onClick={() => onProject((p) => ({ ...p, metronome: !p.metronome }))} title="Metronome (K)">
          <Icon name="click" />
          <span className="lbl">Click</span>
        </button>
      </div>
      <div className="group master" aria-label="Master">
        <Slider label="Master" value={project.masterVolume} min={0} max={1.5} format={db} onChange={(v, k) => onProject((p) => ({ ...p, masterVolume: v }), k)} />
        <div className="master-meters">
          <div className="meter h"><div className="meter-fill" ref={meters.masterL} /></div>
          <div className="meter h"><div className="meter-fill" ref={meters.masterR} /></div>
        </div>
        <button ref={meters.clip} className="clip" title="Clip indicator: the mix went over 0 dBFS. Click to reset." onClick={props.onResetClip}>
          CLIP
        </button>
        <span ref={meters.limit} className="limit" title="The safety limiter is reducing gain">LIM</span>
      </div>
      <button className={`view-toggle ${view === 'perform' ? 'on' : ''}`} aria-pressed={view === 'perform'} onClick={() => props.onView(view === 'perform' ? 'edit' : 'perform')} title="Performance view: big pattern pads and track mutes (P)">
        <Icon name={view === 'perform' ? 'edit' : 'perform'} />
        <span className="lbl">{view === 'perform' ? 'Edit view' : 'Perform'}</span>
      </button>
      <button className="settings-btn" onClick={props.onSettings} aria-label="Settings" title="Sound card and MIDI controller">
        <Icon name="settings" />
      </button>
      <button className="about" onClick={props.onAbout} aria-label="About"><Icon name="info" /><span className="lbl">About</span></button>
    </header>
  );
}
