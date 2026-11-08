// The Ba-da-boom logo: a tiny step grid playing a beat, hats on top, snare in
// the middle, kick at the bottom, in the tracks' own colours. build/icon.svg is
// the same drawing (scripts/make-icon.mjs turns it into the app icon).
const DIM = '#2a2d33';
const ROWS: [string, boolean[]][] = [
  ['#c6e04b', [true, true, true]],
  ['#ff9f43', [false, true, false]],
  ['#ff5a4f', [true, false, true]],
];

export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 256 256" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="256" height="256" rx="56" fill="#121316" />
      {ROWS.map(([colour, on], r) =>
        on.map((lit, c) => <rect key={`${r}-${c}`} x={40 + c * 68} y={40 + r * 68} width="40" height="40" rx="9" fill={lit ? colour : DIM} />),
      )}
    </svg>
  );
}

/** The logo as SVG text, for the icon file. */
export const logoSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">\n  <rect width="256" height="256" rx="56" fill="#121316"/>\n` +
  ROWS.flatMap(([colour, on], r) => on.map((lit, c) => `  <rect x="${40 + c * 68}" y="${40 + r * 68}" width="40" height="40" rx="9" fill="${lit ? colour : DIM}"/>\n`)).join('') +
  `</svg>\n`;
