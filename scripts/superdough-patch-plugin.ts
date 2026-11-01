// Vite plugin: one fix to superdough 1.3.0 (AGPL, see NOTICES.txt).
//
// superdough re-uses audio nodes from a pool (nodePools.mjs) but the pool is
// not kept per audio context. WAV export renders into its own
// OfflineAudioContext, so a filter left in the pool by one render (or by live
// playback) was handed to the next one, and connecting it threw
// "cannot connect to an AudioNode belonging to a different audio context".
// The fix: a pooled node is only re-used by the audio context it belongs to.
//
// The replacement is exact; if superdough's code changes the build stops, so
// an upgrade can never drop the fix silently.
import type { Plugin } from 'vite';

const FIND = 'Gn = (e) => {\n  if (!(e instanceof AudioWorkletNode)) return !0;';
const REPLACE = 'Gn = (e) => {\n  if (e.context !== ze) return !1;\n  if (!(e instanceof AudioWorkletNode)) return !0;';

export function superdoughPatchPlugin(): Plugin {
  return {
    name: 'badaboom-superdough-pool-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]superdough[\\/]dist[\\/]index\.mjs/.test(id.split('?')[0])) return null;
      if (!code.includes('ze = new AudioContext()') || code.split(FIND).length !== 2) {
        throw new Error('superdough node-pool fix: code not found (superdough changed?)');
      }
      return { code: code.replace(FIND, REPLACE), map: null };
    },
  };
}
