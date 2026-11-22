// Every keyboard shortcut in one place (the "? Keyboard shortcuts" button, ? or F1).

const GROUPS: { name: string; keys: [string, string][] }[] = [
  {
    name: 'Playing',
    keys: [
      ['Space', 'Play / stop'],
      ['1 – 8', 'Go to pattern 1 to 8 (while playing, at the next bar)'],
      ['G', 'Song mode on / off'],
      ['K', 'Metronome on / off'],
      ['T', 'Tap tempo: tap in time, the tempo follows'],
      ['R', 'Record what you play on the pads'],
      ['P', 'Performance view'],
      ['A', 'Hear the selected track'],
    ],
  },
  {
    name: 'Editing the grid',
    keys: [
      ['Arrow keys', 'Move around the grid (Ctrl: 4 steps at a time)'],
      ['Enter', 'Turn the selected step on or off'],
      ['M / S', 'Mute / solo the selected track'],
      ['L', 'Lock the selected step, so generators leave it alone'],
      ['Delete', 'Clear the selected track in this pattern'],
      ['Shift + Delete', 'Clear the whole pattern'],
      ['Ctrl + C / Ctrl + V', 'Copy / paste the selected track’s lane'],
      ['Ctrl + Shift + C / V', 'Copy / paste the whole pattern'],
    ],
  },
  {
    name: 'Patterns',
    keys: [
      ['Ctrl + D', 'Duplicate the pattern'],
      ['F2', 'Rename the pattern'],
      ['Alt + ← / →', 'Move the pattern earlier / later in the list'],
      ['Ctrl + Delete', 'Remove the pattern'],
    ],
  },
  {
    name: 'Files',
    keys: [
      ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
      ['Ctrl + S', 'Save (Ctrl + Shift + S: save as)'],
      ['Ctrl + O', 'Open a project'],
      ['Ctrl + E', 'Export WAV, stems or MIDI'],
      ['? or F1', 'This list'],
    ],
  },
];

export function KeyboardMap() {
  return (
    <div className="keymap">
      {GROUPS.map((g) => (
        <section key={g.name} aria-label={g.name}>
          <h3>{g.name}</h3>
          <dl>
            {g.keys.map(([k, what]) => (
              <div key={k} className="keymap-row">
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="about">While &ldquo;Keys play pads&rdquo; is on (Pads tab), the pads&rsquo; letters play drums instead of their shortcuts.</p>
    </div>
  );
}
