import { describe, expect, it } from 'vitest';
import { resolve, win32 } from 'node:path';
import { projectFileFromArgs } from '../src/main/launch';
import { rateLimiter } from '../src/main/log';

describe('project file from the command line', () => {
  it('finds a .badaboom file Windows passes to the installed app', () => {
    expect(projectFileFromArgs(['C:\\Ba-da-boom.exe', 'C:\\Beats\\Funk.badaboom'], 'C:\\', win32)).toBe('C:\\Beats\\Funk.badaboom');
  });
  it('resolves a Windows path relative to the folder it was started in', () => {
    expect(projectFileFromArgs(['C:\\Ba-da-boom.exe', 'Funk.badaboom'], 'D:\\Beats', win32)).toBe('D:\\Beats\\Funk.badaboom');
  });
  it('skips switches and the app folder in development', () => {
    expect(projectFileFromArgs(['electron', '.', '--no-sandbox', '--user-data-dir=/tmp/x', '/home/a/b.badaboom'], '/')).toBe('/home/a/b.badaboom');
  });
  it('accepts any letter case and resolves relative paths', () => {
    expect(projectFileFromArgs(['app', 'My Beat.BADABOOM'], '/work')).toBe(resolve('/work', 'My Beat.BADABOOM'));
  });
  it('returns null without a project file', () => {
    expect(projectFileFromArgs(['app', 'song.wav', '--flag'], '/')).toBeNull();
    expect(projectFileFromArgs(['app.badaboom'], '/')).toBeNull();
  });
});

describe('log rate limit', () => {
  it('lets 100 lines a minute through and reports how many were dropped', () => {
    const allow = rateLimiter(100);
    let ok = 0;
    for (let i = 0; i < 150; i++) if (allow(1000).ok) ok++;
    expect(ok).toBe(100);
    const next = allow(61_001);
    expect(next).toEqual({ ok: true, dropped: 50 });
  });
});
