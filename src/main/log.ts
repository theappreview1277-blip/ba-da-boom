// Error log: one plain text file in the app's data folder (logs/badaboom.log),
// so a problem on someone's PC can be looked at afterwards. Kept small: when it
// passes 1 MB it is renamed to badaboom.old.log and a new one is started.
// Writing is best effort and never throws.

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_BYTES = 1024 * 1024;
const MAX_LINE = 4000;

let file: string | null = null;

export function initLog(userDataDir: string): string {
  file = join(userDataDir, 'logs', 'badaboom.log');
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    /* ignore */
  }
  return file;
}

export const logFile = () => file;

function rotate(path: string) {
  try {
    if (statSync(path).size < MAX_BYTES) return;
    const old = path.replace(/\.log$/, '.old.log');
    rmSync(old, { force: true });
    renameSync(path, old);
  } catch {
    /* no file yet */
  }
}

export type Level = 'info' | 'warn' | 'error';

export function log(level: Level, source: string, message: unknown) {
  if (!file) return;
  let text = message instanceof Error ? (message.stack ?? message.message) : typeof message === 'string' ? message : safeJson(message);
  if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)} …(cut)`;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${text.replace(/\r?\n/g, '\n    ')}\n`;
  try {
    rotate(file);
    appendFileSync(file, line, 'utf8');
  } catch {
    /* disk full or read-only: nothing useful to do */
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Limits how much the renderer can write: at most `perMinute` lines a minute.
 * A loop that reports the same error every frame must not fill the disk.
 */
export function rateLimiter(perMinute: number) {
  let windowStart = 0;
  let count = 0;
  let dropped = 0;
  return (now = Date.now()): { ok: boolean; dropped: number } => {
    if (now - windowStart >= 60_000) {
      const d = dropped;
      windowStart = now;
      count = 0;
      dropped = 0;
      count++;
      return { ok: true, dropped: d };
    }
    if (count < perMinute) {
      count++;
      return { ok: true, dropped: 0 };
    }
    dropped++;
    return { ok: false, dropped: 0 };
  };
}
