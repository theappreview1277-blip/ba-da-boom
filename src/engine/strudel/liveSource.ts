// A Strudel Pattern whose content can be replaced from a given cycle onwards.
//
// The scheduler queries ahead of the audio clock, so swapping its pattern
// directly would change music at an arbitrary point in the lookahead window.
// Instead the scheduler always plays this one pattern, and changes are added
// as segments that take effect at an exact cycle: the next step for edits, or
// the next bar (or pattern end) for pattern switches. Anything before that
// cycle keeps coming from the previous segment, so already-scheduled audio and
// newly-queried audio always agree.

import { Fraction, PatternClass, TimeSpan, type StrudelHap, type StrudelPattern } from './strudel';

interface Segment {
  /** First cycle at which this segment plays. */
  from: number;
  /** Cycle that the source pattern's cycle 0 is aligned to. */
  origin: number;
  shifted: StrudelPattern;
}

export class LiveSource {
  private segments: Segment[] = [];
  readonly pattern: StrudelPattern;

  constructor(initial: StrudelPattern) {
    this.reset(initial);
    this.pattern = new PatternClass((state: any) => this.query(state));
  }

  /** Forget all history; the pattern starts at cycle 0. Used when the transport stops. */
  reset(p: StrudelPattern) {
    this.segments = [{ from: -Infinity, origin: 0, shifted: p }];
  }

  /** Origin of the segment active at `cycle`. */
  originAt(cycle: number): number {
    return this.segmentAt(cycle).origin;
  }

  private segmentAt(cycle: number): Segment {
    let s = this.segments[0];
    for (const seg of this.segments) if (seg.from <= cycle) s = seg;
    return s;
  }

  /**
   * Play `p` from cycle `from`. If `origin` is given, p's cycle 0 is aligned to it
   * (a pattern switch restarts the pattern); otherwise the current origin is kept
   * (an edit continues where the pattern was).
   */
  schedule(p: StrudelPattern, from: number, origin?: number) {
    const o = origin ?? this.originAt(from);
    const shifted = o === 0 ? p : p.late(o);
    // Segments starting at or after `from` are superseded.
    this.segments = this.segments.filter((s) => s.from < from);
    this.segments.push({ from, origin: o, shifted });
    // Drop history that can no longer be queried (keep one segment before `from`).
    while (this.segments.length > 2 && this.segments[1].from <= from - 64) this.segments.shift();
  }

  private query(state: any): StrudelHap[] {
    const begin = state.span.begin.valueOf();
    const end = state.span.end.valueOf();
    const out: StrudelHap[] = [];
    for (let i = 0; i < this.segments.length; i++) {
      const segBegin = Math.max(begin, this.segments[i].from);
      const segEnd = Math.min(end, this.segments[i + 1]?.from ?? Infinity);
      if (segBegin >= segEnd) continue;
      const span =
        segBegin === begin && segEnd === end
          ? state.span
          : new TimeSpan(Fraction(segBegin), Fraction(segEnd));
      out.push(...this.segments[i].shifted.query(state.setSpan(span)));
    }
    return out;
  }
}

/** Next step boundary (in cycles) at or after `cycle`. */
export const nextStep = (cycle: number, stepsPerCycle = 16) => Math.ceil(cycle * stepsPerCycle - 1e-9) / stepsPerCycle;
/** Next bar boundary at or after `cycle`. */
export const nextBar = (cycle: number) => Math.ceil(cycle - 1e-9);
