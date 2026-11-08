import { describe, expect, it } from 'vitest';
import { gridPage, rulerLabel } from '../src/ui/Grid';
import { valueAt } from '../src/ui/StepLane';

describe('bars on screen', () => {
  it('shows a one-bar pattern whole, with cells that grow to the width', () => {
    const p = gridPage(16, 1200, 0);
    expect(p).toMatchObject({ start: 0, steps: 16, total: 16 });
    expect(p.cell).toBe(40);
  });
  it('fits as many whole bars as it can at a usable size', () => {
    expect(gridPage(64, 1550, 0).steps).toBe(32); // 2 bars at 1920 wide
    expect(gridPage(64, 2600, 0).steps).toBe(64); // all 4 on a very wide screen
    expect(gridPage(64, 700, 0).steps).toBe(16); // 1 bar on a small window
    expect(gridPage(48, 1700, 0).steps).toBe(48); // 3 bars when 3 fit
  });
  it('keeps the page inside the pattern', () => {
    expect(gridPage(64, 700, 3).start).toBe(48);
    expect(gridPage(64, 700, 9).start).toBe(48);
    expect(gridPage(64, 700, -1).start).toBe(0);
  });
  it('never makes cells smaller than 18 px', () => {
    expect(gridPage(16, 300, 0).cell).toBe(18);
  });
});

describe('ruler', () => {
  it('counts bars, then bar.beat', () => {
    expect(rulerLabel(0)).toEqual({ text: '1', bar: true });
    expect(rulerLabel(4)).toEqual({ text: '1.2', bar: false });
    expect(rulerLabel(16)).toEqual({ text: '2', bar: true });
    expect(rulerLabel(60)).toEqual({ text: '4.4', bar: false });
    expect(rulerLabel(5)).toBeNull();
  });
});

describe('step lane values', () => {
  it('maps the pointer height to loudness or chance', () => {
    expect(valueAt('velocity', 0.25)).toBe(0.25);
    expect(valueAt('probability', 1.4)).toBe(1);
    expect(valueAt('velocity', -1)).toBe(0);
  });
  it('maps the middle of the lane to on-time for timing', () => {
    expect(valueAt('micro', 0.5)).toBe(0);
    expect(valueAt('micro', 1)).toBe(0.5);
    expect(valueAt('micro', 0)).toBe(-0.5);
  });
});
