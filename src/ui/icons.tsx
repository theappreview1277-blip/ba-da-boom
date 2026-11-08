// Small line icons for the toolbar, drawn in the current text colour.
const paths: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  new: 'M6 3h8l4 4v14H6zM14 3v4h4',
  open: 'M3 7h6l2 2h10v10H3zM3 7v12',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 14h8v7H8z',
  saveAs: 'M5 3h11l3 3v7M5 3v18h7M8 3v5h7V3M15 15v6M12 18h6',
  export: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4',
  click: 'M9 3h6l3 18H6zM12 17l5-11',
  perform: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  edit: 'M4 6h16M4 12h16M4 18h16M8 4v4M14 10v4M10 16v4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={paths[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
