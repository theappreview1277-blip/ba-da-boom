// Project files given on the command line: Windows starts the app with the file's
// path when a .badaboom file is double-clicked (or dropped on the app's icon), and
// passes it on to the running app when one is already open.

import path from 'node:path';

/** The last argument that names a .badaboom file, as an absolute path, or null. */
export function projectFileFromArgs(argv: readonly string[], cwd: string, paths: Pick<typeof path, 'isAbsolute' | 'resolve'> = path): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (!/\.badaboom$/i.test(a)) continue;
    return paths.isAbsolute(a) ? a : paths.resolve(cwd, a);
  }
  return null;
}
