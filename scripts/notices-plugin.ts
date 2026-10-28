// Vite plugin: writes NOTICES.txt into the renderer bundle, listing every npm
// package whose code ends up in the bundle, with its licence text. Licence
// compliance then follows what is actually shipped, not a hand-kept list.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

function packageRoot(id: string): string | null {
  const m = id.replace(/\\/g, '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return m ? m[1] : null;
}

export function noticesPlugin(extraRoots: string[] = []): Plugin {
  return {
    name: 'badaboom-notices',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const roots = new Set<string>(extraRoots);
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const root = packageRoot(id.replace(/^\0/, ''));
          if (root) roots.add(root);
        }
      }
      const entries = [...roots]
        .map((root) => {
          const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
          const licFile = existsSync(root)
            ? readdirSync(root).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f))
            : undefined;
          const text = licFile ? readFileSync(join(root, licFile), 'utf8').trim() : '(no licence file in package; see package metadata)';
          const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '';
          return { name: pkg.name as string, version: pkg.version as string, license: pkg.license ?? 'UNKNOWN', repo, text };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const header = [
        'Ba-da-boom third-party notices',
        '',
        'Ba-da-boom is licensed under the GNU Affero General Public License v3.0 or later.',
        'Complete corresponding source: https://github.com/theappreview1277-blip/ba-da-boom',
        '',
        'Strudel (https://strudel.cc, source: https://codeberg.org/uzu/strudel) is by the Strudel',
        'contributors and is licensed under AGPL-3.0-or-later. Ba-da-boom bundles it unmodified.',
        '',
        'Drum machine kits: the kits in the Kit menu are the ones Strudel offers, from',
        'tidal-drum-machines (https://github.com/ritchse/tidal-drum-machines, file list via',
        'https://github.com/felixroos/dough-samples). They are included unmodified in the kits',
        'folder of this app. No licence is stated for them; check before releasing music or',
        'files that contain them.',
        '',
        'Electron and Chromium licences are installed alongside the app as LICENSE.electron.txt',
        'and LICENSES.chromium.html.',
        '',
        'Packages bundled into the app:',
        ...entries.map((e) => `  ${e.name} ${e.version} (${e.license})`),
        '',
      ].join('\n');
      const body = entries
        .map((e) => `${'='.repeat(78)}\n${e.name} ${e.version}\nLicense: ${e.license}\n${e.repo ? `Source: ${e.repo}\n` : ''}\n${e.text}\n`)
        .join('\n');
      this.emitFile({ type: 'asset', fileName: 'NOTICES.txt', source: header + '\n' + body });
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(join(process.cwd(), 'LICENSE'), 'utf8') });
    },
  };
}
