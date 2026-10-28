# Staged plan

Each milestone ends with: source in a pull request, a Windows installer built on a
real Windows machine, the checks that were run, and the next concrete task.

## Milestone 1: vertical slice (this PR)

Installed Windows app → load sample → edit beat → play reliably → save project →
export WAV. Includes the sequencer core, sound/mix controls, pattern
copy/paste/switching, autosave/recovery and missing-sample handling.

## Milestone 2: pattern creation

* Done: Euclidean generator per lane (hits, steps, rotation) using `@strudel/core`'s
  `bjorklund` and `rotate` (identical to `euclidRot`), written into the grid so it stays editable
* Done: seeded randomisation with strength, density and locked steps (format 2 adds `Step.locked`)
* Done: variations that keep chosen features (beat skeleton, accents, density), added as a new pattern and queued while playing
* Done: song arrangement (patterns × bars, reorder, loop), song playback with the grid
  following, leaving the song at the next bar with a pattern key, song WAV export

## Milestone 3: performance and polish

* Done (in milestone 2): performance view with large pattern pads, mutes/solos with
  meters, queued-switch display, bar/beat position
* Resizable panels, display-scaling review at 100/125/150/200 %, full keyboard map
* Done: waveform preview of the selected track's sample (with start/end shown)
* Sample browser: folder browsing, favourites
* Acoustic kit from a CC0 source (candidate: Versilian Community Sample Library, CC0)

## Milestone 4: export and code

* Done: stem export (one WAV per audible track, same offline renderer, equal lengths)
* Done: MIDI file export (format 1 SMF, PPQ 480, GM drum notes on channel 10;
  probability, ratchets and microtiming taken from the same Strudel pattern as playback)
* Optional Strudel code editor (`@strudel/codemirror`, `@strudel/transpiler`):
  a clearly labelled code pattern that plays alongside the grid; grid lanes are
  never overwritten by code

## Later, assessed separately

* MIDI controller input and MIDI clock (Web MIDI in Electron; jitter must be measured)
* Audio device selection (`AudioContext.setSinkId`; superdough already supports it)
* More sample formats (FLAC/MP3/OGG decode via Chromium)
* DAW integration: not possible as a plugin from Electron. ASIO and VST3 are not
  offered; Chromium's Windows audio path is WASAPI shared mode.
