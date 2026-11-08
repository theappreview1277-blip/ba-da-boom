# Ba-da-boom

A Windows drum machine with a visual step sequencer, powered by
[Strudel](https://strudel.cc)'s pattern engine.

**Status: milestone 1 (vertical slice), development build.** Installers are
unsigned: Windows SmartScreen will warn ("Windows protected your PC"); choose
*More info → Run anyway*. No signed public release exists yet.

## What works in this build

* 16 tracks, 1–64 steps per track with independent lengths (polymeters)
* Per-step velocity, probability (seeded), microtiming and ratchets
* Tempo, swing, metronome, mute/solo, immediate stop
* Patterns with names you can change (double-click or F2), copy/paste/duplicate/clear, undo/redo, quantised switching at the next bar
* Synthesised CC0 factory kit, an Acoustic Kit recorded from real drums (Virtuosity Drums, CC0), sound import: WAV, MP3, FLAC and OGG (drag and drop or Import…; other formats are stored as WAV), auditioning
* Kit menu with Strudel's 71 drum machine kits (TR-808, TR-909, LinnDrum, MPC60…), included in the
  installer and fetched by `npm run kits` at build time (not stored in git; no licence is stated for them)
* Per-track volume, pan, pitch, sample start/end, reverse, attack/decay/sustain/release, choke groups,
  delay and reverb sends
* Strudel's synths on any track: sine, triangle, square, sawtooth, supersaw, pulse, white/pink/brown
  noise, crackle and the synth kick, with a note for each track
* Strudel's filters and effects: low-pass (12 dB, 24 dB or ladder) with resonance and filter envelope,
  high-pass with resonance, band-pass, vowel, drive, shape, bit crush, downsample, tremolo and phaser
* Track and master meters, clip light, soft-clip safety stage
* Save/open portable project folders, autosave and crash recovery, missing-sample handling
* Main screen: the grid shows whole bars (pages turn with the playhead, Follow can be switched off),
  click and drag to paint or erase steps, a lane under the grid to draw each step's loudness, chance or
  timing, a colour per track, and the Beat library, Beat intelligence and Generate tools as tabs under the
  grid (Hide folds them away; the open tab is remembered)
* Double-click a `.badaboom` project in Explorer to open it (also while the app is open)
* Error log in the app data folder (About → Show error log)
* Updates: the installed app looks for a newer release on GitHub shortly after it starts, says so in the
  corner of the window, downloads it when you click Download and installs it when it restarts
  (About → Check for updates any time). The installer is not code-signed yet, so Windows SmartScreen
  may warn the first time it is installed
* Offline WAV export (24-bit, 44.1 kHz) with effect tails, of a pattern or the whole song
* Stem export (one 24-bit WAV per audible track, all the same length) and MIDI export
  (Standard MIDI File, General MIDI drum notes on channel 10)
* Euclidean rhythms, seeded randomise with step locks, variations, song mode,
  performance view, waveform preview of the selected track's sample
* Beat intelligence: 54 drum patterns in 16 kinds of music (drum & bass two-step, double kick, halftime,
  four-on-the-floor and break-style patterns; jungle, house, techno, hip-hop, trap and drill, R&B, pop and
  disco, funk, rock and metal, reggae and dancehall, African, Latin, jazz and blues, UK garage and dubstep,
  breakbeat), with complexity, "Sounds like" style recognition, "Complete my beat" for a beat you started,
  fills (snare roll, tom run, build, drop out) as a new queued pattern or in place, and humanise with
  natural, laid back, pushed and tight feels. Break-style patterns are rhythms written for the grid and
  played with your kit; no recordings are included
* Sample folders: add your own folders of sounds (WAV, MP3, FLAC, OGG) to the sample list (remembered), favourites (☆),
  resizable side panels (drag the edges, double-click to reset)

Not yet built (planned): Strudel code editor. See `docs/PLAN.md`.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / stop |
| Arrows, Enter | Move in the grid, toggle step |
| 1–8 | Select / queue pattern |
| M, S | Mute / solo selected track |
| A | Audition selected track |
| K | Metronome |
| P | Performance view on / off (big pattern pads, mutes, solos) |
| G | Song mode on / off (play the arrangement) |
| L | Lock / unlock selected step (generators leave locked steps alone) |
| Shift+click | Select a step without toggling it |
| Click and drag | Paint steps on (or off, when you start on a lit step) |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C, Ctrl+V | Copy / paste track lane (add Shift for whole pattern) |
| Delete, Shift+Delete | Clear lane / pattern |
| Ctrl+D | Duplicate pattern |
| F2 (or double-click a pattern) | Rename pattern |
| Ctrl+Delete | Remove pattern (asks first if it has steps or is in the song) |
| Alt+Left, Alt+Right | Move the current pattern in the list (or drag the pattern tabs) |
| Ctrl+S, Ctrl+Shift+S, Ctrl+O | Save, save as, open |
| Ctrl+E | Export WAV |

## Building

Requires Node.js 22 or newer.

```
npm ci
npm test              # unit tests
npm run build
npx electron .        # run from source
npm run dist:win      # Windows x64 NSIS installer in release/ (run on Windows)
```

Browser checks of the renderer: `npm run build && npx vite preview --port 4173`, then
`node test/e2e/smoke.mjs` and `node test/e2e/timing.mjs`. Electron checks:
`node test/e2e/electron.mjs`, `node test/e2e/electron-files.mjs`, and
`ELECTRON_EXE="<installed Ba-da-boom.exe>" node test/e2e/timing.mjs` for the installed app.

The factory kit is generated by `npm run samples`.

Releases: set the version in `package.json`, then push a tag `v<version>`. The Release workflow builds the
installer and uploads it with `latest.yml` to a draft GitHub release; the app's update check sees it once the
draft is published. `node test/e2e/update-real.mjs` (Windows, after `scripts\windows-test.cmd`) checks a real
update end to end: it builds the next version, serves it from the PC, updates the installed app through its
own UI, then puts the current version back.

## Licence

GNU Affero General Public License v3.0 or later (see `LICENSE`). Strudel is
© Strudel contributors, AGPL-3.0-or-later. Third-party notices are generated into
the app bundle (`NOTICES.txt`, shown in About). Factory sounds are CC0.
