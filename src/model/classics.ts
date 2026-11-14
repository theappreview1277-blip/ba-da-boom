import type { Role } from './rhythm';

// The named beat library: well-known drum patterns, each with named variants,
// written by hand as step patterns that the app plays with its own kits. No
// recordings are included. The breaks are our own transcriptions of the
// rhythms as drummers commonly play them, so they are a starting point to
// edit, not copies of the records.
//
// Unlike the style generator, nothing here is random: a variant always writes
// exactly the same beat.
//
// Each character is one 16th step (a bar is 16 characters):
//   X accent   x hit   g ghost note   . rest
//   r roll of two hits in the step    R roll of three
//   t hit a third of a step early     u hit a third of a step late
//   q ghost a third of a step late     l hit laid back (a little late, for loose "drunk" feels)
// t, u and q put hits on the triplet grid (shuffles and 12/8): in a beat of
// four steps, triplet 8ths fall on 0, 1u/1q and 3t.

export interface ClassicVariant {
  name: string;
  /** Tempo and swing for this variant, when they differ from the beat's. */
  bpm?: number;
  swing?: number;
  parts: Partial<Record<Role, string>>;
}

export interface Classic {
  id: string;
  name: string;
  /** Short name for pattern buttons (no more than 10 characters). */
  short: string;
  category: string;
  bpm: number;
  /** Project swing, 50..75. */
  swing: number;
  about: string;
  variants: ClassicVariant[];
}

/** Bars joined into one part. */
const b = (...bars: string[]) => bars.join('');
const H8 = 'x.x.x.x.x.x.x.x.';
const H16 = 'xgxgxgxgxgxgxgxg';
const Q4 = 'x...x...x...x...';
const BB = '....X.......X...';
const FOUR = 'X...X...X...X...';
const OFF = '..x...x...x...x.';
const E = '................';

// --- Amen break: four bars (A A B C) ---
const AMEN_K1 = 'X.x.......xx....';
const AMEN_S1 = '....X..g.x..X..g';
const AMEN_K3 = 'X.x.......x.....';
const AMEN_S3 = '....X..g.x....X.';
const AMEN_K4 = '..xx......x.....';
const AMEN_S4 = '.g..X..g.x....X.';
const AMEN_R4 = 'x.x.x.x.x.....x.';

export const CLASSICS: Classic[] = [
  // ===================== Breaks =====================
  {
    id: 'amen',
    name: 'Amen break',
    short: 'Amen',
    category: 'Breaks',
    bpm: 136,
    swing: 50,
    about: 'The most sampled drum break of all (The Winstons, "Amen, Brother", 1969): syncopated kicks, ghosted snares, a broken third bar and a crash in bar four.',
    variants: [
      {
        name: 'Full break (4 bars)',
        parts: {
          kick: b(AMEN_K1, AMEN_K1, AMEN_K3, AMEN_K4),
          snare: b(AMEN_S1, AMEN_S1, AMEN_S3, AMEN_S4),
          ride: b(H8, H8, H8, AMEN_R4),
          crash: b(E, E, E, '..........X.....'),
        },
      },
      { name: 'Main groove (1 bar)', parts: { kick: AMEN_K1, snare: AMEN_S1, ride: H8 } },
      {
        name: 'Turnaround (bars 3 and 4)',
        parts: { kick: b(AMEN_K3, AMEN_K4), snare: b(AMEN_S3, AMEN_S4), ride: b(H8, AMEN_R4), crash: b(E, '..........X.....') },
      },
      {
        name: 'Jungle chop (165 BPM)',
        bpm: 165,
        parts: {
          kick: b(AMEN_K1, AMEN_K3, AMEN_K1, AMEN_K4),
          snare: b(AMEN_S1, AMEN_S3, AMEN_S1, '.g..X..g.x..X.rR'),
          ride: b(H8, H8, H8, 'x.x.x.x.x.x.....'),
          crash: b('X...............', E, E, E),
        },
      },
      {
        name: 'Rolling DnB edit (172 BPM)',
        bpm: 172,
        parts: {
          kick: b(AMEN_K1, 'X.x.......x.....'),
          snare: b('....X..g.x.gX..g', '....X.gg.x.gX.gr'),
          ride: b(H8, H8),
        },
      },
      {
        name: 'Halftime Amen (170 BPM)',
        bpm: 170,
        parts: {
          kick: b('X...x...........', '....x.x.........'),
          snare: b('........X.....g.', '..x.....X.....g.'),
          ride: b(Q4, Q4),
        },
      },
    ],
  },
  {
    id: 'funky-drummer',
    name: 'Funky Drummer',
    short: 'FunkyDrm',
    category: 'Breaks',
    bpm: 100,
    swing: 50,
    about: 'Clyde Stubblefield\'s groove from James Brown\'s "Funky Drummer" (1970): 16th hats with open-hat lifts, a busy syncopated kick and a carpet of ghost notes.',
    variants: [
      {
        name: 'Main groove (1 bar)',
        parts: { kick: 'X.x...x...x..x..', snare: '....X..g.g.gX..g', hat: 'xgxgxgx.xgxgx.xg', openhat: '.......x.....x..' },
      },
      {
        name: 'Two-bar phrase',
        parts: {
          kick: b('X.x...x...x..x..', 'X.x...x...x.x...'),
          snare: b('....X..g.g.gX..g', '....X..g.g..X.gg'),
          hat: b('xgxgxgx.xgxgx.xg', 'xgxgxgx.xgxgxgxg'),
          openhat: b('.......x.....x..', '.......x........'),
        },
      },
      {
        name: 'Clean (no ghost notes)',
        parts: { kick: 'X.x...x...x..x..', snare: BB, hat: 'x.x.x...x.x.x...', openhat: '......x.......x.' },
      },
      {
        name: 'Hip-hop flip (90 BPM)',
        bpm: 90,
        swing: 56,
        parts: { kick: 'X.x...x...x.....', snare: '....X.......X..g', hat: H8 },
      },
      {
        name: 'With fill (2 bars)',
        parts: {
          kick: b('X.x...x...x..x..', 'X.x...x...x.....'),
          snare: b('....X..g.g.gX..g', '....X..g.g.gXrRR'),
          hat: b('xgxgxgx.xgxgx.xg', 'xgxgxgx.xgxg....'),
          openhat: b('.......x.....x..', '.......x........'),
        },
      },
    ],
  },
  {
    id: 'apache',
    name: 'Apache',
    short: 'Apache',
    category: 'Breaks',
    bpm: 118,
    swing: 52,
    about: 'The Incredible Bongo Band\'s "Apache" (1973): a punchy kit groove under rolling bongos, the break that built b-boy culture and later jungle.',
    variants: [
      {
        name: 'Full break (kit and bongos, 2 bars)',
        parts: {
          kick: b('X......x..x.....', 'X......x..x...x.'),
          snare: b(BB, BB),
          hat: b(H8, H8),
          conga: b('x.gxx.gxx.gxx.gx', 'x.gxx.gxx.gxxgxx'),
          tomhigh: b('.x...x...x...x..', '.x...x...x...x.x'),
        },
      },
      { name: 'Kit only', parts: { kick: 'X......x..x.....', snare: BB, hat: H8 } },
      { name: 'Bongos only', parts: { conga: 'x.gxx.gxx.gxx.gx', tomhigh: '.x...x...x...x..' } },
      {
        name: 'Jungle Apache (170 BPM)',
        bpm: 170,
        swing: 50,
        parts: {
          kick: b('X.........x.....', 'X......x..x.....'),
          snare: b('....X..g....X..g', '....X..g.g..X...'),
          conga: b('x.gxx.gxx.gxx.gx', 'x.gxx.gxx.gxxgxx'),
          hat: b(H8, H8),
        },
      },
      {
        name: 'Boom bap Apache (94 BPM)',
        bpm: 94,
        swing: 56,
        parts: { kick: 'X......xX.x.....', snare: BB, hat: H8, conga: 'x..xx..xx..xx.gx' },
      },
    ],
  },
  {
    id: 'think',
    name: 'Think (About It)',
    short: 'Think',
    category: 'Breaks',
    bpm: 114,
    swing: 50,
    about: 'The break from Lyn Collins\' "Think (About It)" (1972): bright tambourine over a funky kick and snare, a staple of hip-hop and liquid DnB.',
    variants: [
      { name: 'Main groove (1 bar)', parts: { kick: 'X.....x.x.......', snare: '....X..g....X..g', hat: 'x.x.x.x.x.x.x...', openhat: '..............x.', shaker: H16 } },
      {
        name: 'Two-bar phrase',
        parts: {
          kick: b('X.....x.x.......', 'X.....x...x..x..'),
          snare: b('....X..g....X..g', '....X..g.g..X...'),
          hat: b('x.x.x.x.x.x.x...', 'x.x.x.x.x.x.x.x.'),
          openhat: b('..............x.', E),
          shaker: b(H16, H16),
        },
      },
      {
        name: 'Liquid DnB (172 BPM)',
        bpm: 172,
        parts: {
          kick: b('X.....x.x.......', 'X.........x.....'),
          snare: b('....X..g....X..g', '....X.g.....X.g.'),
          shaker: b(H16, H16),
          hat: b('..x...x...x...x.', '..x...x...x...x.'),
        },
      },
      { name: 'Hip-hop (92 BPM)', bpm: 92, swing: 56, parts: { kick: 'X.....x.x.......', snare: BB, hat: H8, shaker: '..x...x...x...x.' } },
    ],
  },
  {
    id: 'soul-pride',
    name: 'Soul Pride',
    short: 'SoulPride',
    category: 'Breaks',
    bpm: 106,
    swing: 50,
    about: 'In the manner of the break from James Brown\'s "Soul Pride" (1969): a busy, bouncing kick, ghost-note snares and driving 16th hats, loved by jungle and DnB producers.',
    variants: [
      { name: 'Main groove (1 bar)', parts: { kick: 'X..x..x...x.....', snare: '....X.gg.g..X.g.', hat: H16 } },
      {
        name: 'Two-bar phrase',
        parts: {
          kick: b('X..x..x...x.....', 'X.....x..x.x....'),
          snare: b('....X.gg.g..X.g.', '....X.g..g.gX..g'),
          hat: b(H16, 'xgxgxgxgxgxgxgx.'),
          openhat: b(E, '...............x'),
        },
      },
      {
        name: 'DnB (174 BPM)',
        bpm: 174,
        parts: {
          kick: b('X..x......x.....', 'X.....x...x.....'),
          snare: b('....X.gg.g..X.g.', '....X.g..g.gX..g'),
          hat: b(H8, H8),
          shaker: b(H16, H16),
        },
      },
      { name: 'Ghost-heavy', parts: { kick: 'X..x..x...x.....', snare: 'g.g.Xggg.g.gX.gg', hat: H16 } },
    ],
  },
  {
    id: 'cold-sweat',
    name: 'Cold Sweat',
    short: 'ColdSweat',
    category: 'Breaks',
    bpm: 112,
    swing: 50,
    about: 'In the manner of James Brown\'s "Cold Sweat" (1967): the beat often called the first funk groove, with a sparse kick and a strong 2 and 4.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.......X.x.....', snare: '....X..g....X...', hat: H8 } },
      { name: 'The drum break', parts: { kick: 'X..x....X.x.....', snare: '....X..g.g..X..g', hat: 'x.x.x.x.x.x.x...', openhat: '..............x.' } },
      {
        name: 'Two-bar phrase',
        parts: { kick: b('X.......X.x.....', 'X..x....X.....x.'), snare: b('....X..g....X...', '....X..g.g..X...'), hat: b(H8, H8) },
      },
    ],
  },
  {
    id: 'impeach',
    name: 'Impeach the President',
    short: 'Impeach',
    category: 'Breaks',
    bpm: 96,
    swing: 50,
    about: 'In the manner of the Honey Drippers\' "Impeach the President" (1973): a hard, simple kick and snare with an open hat at the end of the bar, a cornerstone of golden-era hip-hop.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X......xX.....x.', snare: BB, hat: 'x.x.x.x.x.x.x...', openhat: '..............x.' } },
      {
        name: 'Two-bar phrase',
        parts: {
          kick: b('X......xX.....x.', 'X......xX.x.....'),
          snare: b(BB, '....X.......X..g'),
          hat: b('x.x.x.x.x.x.x...', H8),
          openhat: b('..............x.', E),
        },
      },
      { name: 'Boom bap (90 BPM)', bpm: 90, swing: 58, parts: { kick: 'X......xX.....x.', snare: '....X..g....X...', hat: H8 } },
    ],
  },
  {
    id: 'levee',
    name: 'When the Levee Breaks',
    short: 'Levee',
    category: 'Breaks',
    bpm: 72,
    swing: 50,
    about: 'In the manner of John Bonham on Led Zeppelin\'s "When the Levee Breaks" (1971): slow, huge, and heavy, with a doubled kick at the top of the bar.',
    variants: [
      { name: 'Main groove', parts: { kick: 'XX......x.x.....', snare: BB, hat: H8 } },
      { name: 'With open hats', parts: { kick: 'XX......x.x.....', snare: BB, hat: 'x.x.x...x.x.x...', openhat: '......x.......x.' } },
      {
        name: 'Two-bar phrase',
        parts: { kick: b('XX......x.x.....', 'XX......x.x...x.'), snare: b(BB, BB), hat: b(H8, H8), crash: b('X...............', E) },
      },
    ],
  },
  {
    id: 'synthetic-sub',
    name: 'Synthetic Substitution',
    short: 'SynthSub',
    category: 'Breaks',
    bpm: 102,
    swing: 50,
    about: 'In the manner of Melvin Bliss\' "Synthetic Substitution" (1973): a crisp 16th hat over a kick that pushes into beat 3.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.x....x..x.....', snare: BB, hat: H16 } },
      { name: 'Two-bar phrase', parts: { kick: b('X.x....x..x.....', 'X.x....x..x..x..'), snare: b(BB, '....X.......X..g'), hat: b(H16, H16) } },
      { name: 'Hip-hop (92 BPM)', bpm: 92, swing: 56, parts: { kick: 'X.x....x..x.....', snare: BB, hat: H8 } },
    ],
  },
  {
    id: 'roachclip',
    name: "Ashley's Roachclip",
    short: 'Roachclip',
    category: 'Breaks',
    bpm: 104,
    swing: 50,
    about: 'In the manner of The Soul Searchers\' "Ashley\'s Roachclip" (1974): a laid-back, tight groove with a cowbell-free pocket and ghosted snare.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.....x.x.x.....', snare: '....X..g....X..g', hat: H8 } },
      { name: 'Two-bar phrase', parts: { kick: b('X.....x.x.x.....', 'X.....x...x..x..'), snare: b('....X..g....X..g', '....X..g.g..X...'), hat: b(H8, H8) } },
    ],
  },
  {
    id: 'hot-pants',
    name: 'Hot Pants',
    short: 'HotPants',
    category: 'Breaks',
    bpm: 108,
    swing: 50,
    about: 'In the manner of James Brown\'s "Hot Pants" (1971): skipping kicks and choppy 16th hats, tight and dry.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X..x....x..x....', snare: '....X..g.g..X...', hat: H16 } },
      { name: 'Two-bar phrase', parts: { kick: b('X..x....x..x....', 'X..x....x.x...x.'), snare: b('....X..g.g..X...', '....X..g.g..X..g'), hat: b(H16, H16) } },
    ],
  },
  {
    id: 'new-day',
    name: "It's a New Day",
    short: 'NewDay',
    category: 'Breaks',
    bpm: 92,
    swing: 50,
    about: 'In the manner of the Skull Snaps\' "It\'s a New Day" (1973): a fat double kick and open hats that breathe, sampled across 90s hip-hop.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.x.......x.x...', snare: BB, hat: 'x.x.x...x.x.x...', openhat: '......x.......x.' } },
      { name: 'Two-bar phrase', parts: { kick: b('X.x.......x.x...', 'X.x.......x...x.'), snare: b(BB, BB), hat: b('x.x.x...x.x.x...', 'x.x.x...x.x.x.x.'), openhat: b('......x.......x.', '......x.........') } },
    ],
  },
  {
    id: 'big-beat',
    name: 'The Big Beat',
    short: 'BigBeat',
    category: 'Breaks',
    bpm: 102,
    swing: 50,
    about: 'In the manner of Billy Squier\'s "The Big Beat" (1980): a roomy rock break with a heavy kick and snare.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.....x.x.......', snare: BB, hat: H8 } },
      { name: 'With crash', parts: { kick: b('X.....x.x.......', 'X.....x.x...x...'), snare: b(BB, BB), hat: b('..x.x.x.x.x.x.x.', H8), crash: b('X...............', E) } },
    ],
  },
  {
    id: 'funky-president',
    name: 'Funky President',
    short: 'FunkyPres',
    category: 'Breaks',
    bpm: 96,
    swing: 50,
    about: 'In the manner of James Brown\'s "Funky President" (1974): a rolling, tight kick figure with a snappy backbeat.',
    variants: [
      { name: 'Main groove', parts: { kick: 'X.x.....x.x.....', snare: '....X.......X..g', hat: H8 } },
      { name: 'Two-bar phrase', parts: { kick: b('X.x.....x.x.....', 'X.x.....x.x..x..'), snare: b('....X.......X..g', '....X..g....X...'), hat: b(H8, H8) } },
    ],
  },

  // ===================== Hip-hop =====================
  {
    id: 'boom-bap',
    name: 'Boom bap',
    short: 'BoomBap',
    category: 'Hip-hop',
    bpm: 90,
    swing: 56,
    about: 'The classic 90s New York beat: a heavy kick, a cracking snare on 2 and 4, and swung hats.',
    variants: [
      { name: 'Classic', parts: { kick: 'X......x..x.....', snare: BB, hat: H8 } },
      { name: 'Dusty (ghost notes)', parts: { kick: 'X......x..x.....', snare: '....X..g....X.g.', hat: 'x.x.x.xgx.x.x.xg' } },
      { name: 'Kick skip', parts: { kick: 'X.x.......x..x..', snare: BB, hat: H8 } },
      { name: 'Two-bar with open hat', parts: { kick: b('X......x..x.....', 'X.x.......x.....'), snare: b(BB, BB), hat: b(H8, 'x.x.x.x.x.x.x...'), openhat: b(E, '..............x.') } },
      { name: 'Rimshot and shaker', parts: { kick: 'X......x..x.....', snare: BB, rim: '.......x.......x', shaker: H16 } },
    ],
  },
  {
    id: 'dilla',
    name: 'Dilla swing',
    short: 'Dilla',
    category: 'Hip-hop',
    bpm: 88,
    swing: 62,
    about: 'Loose, "drunk" timing in the manner of J Dilla: late snares, swung hats and kicks that land where they want.',
    variants: [
      { name: 'Drunk drums', parts: { kick: 'X.....x..xx.....', snare: '....l.......l...', hat: 'x.xgx.x.x.xgx.x.' } },
      { name: 'Clap and rim', parts: { kick: 'X.....x..x.x....', clap: '....l.......l...', rim: '.......g......g.', hat: H8 } },
      { name: 'Two-bar', parts: { kick: b('X.....x..xx.....', 'X.......x.x...x.'), snare: b('....l.......l...', '....l.......l...'), hat: b(H8, H8) } },
    ],
  },
  {
    id: 'gfunk',
    name: 'G-funk',
    short: 'G-funk',
    category: 'Hip-hop',
    bpm: 92,
    swing: 54,
    about: 'West Coast bounce: a rolling kick, clap on 2 and 4 and smooth 16th hats.',
    variants: [
      { name: 'Classic', parts: { kick: 'X......xX.x.....', clap: BB, hat: H16 } },
      { name: 'With snare and open hat', parts: { kick: 'X......xX.x.....', snare: BB, clap: BB, hat: 'xgxgxgxgxgxgxg..', openhat: '..............x.' } },
      { name: 'Two-bar', parts: { kick: b('X......xX.x.....', 'X.x....x..x..x..'), clap: b(BB, BB), hat: b(H16, H16) } },
    ],
  },
  {
    id: 'electro',
    name: 'Electro 808',
    short: 'Electro',
    category: 'Hip-hop',
    bpm: 122,
    swing: 50,
    about: 'Early-80s drum machine funk: syncopated 808 kicks, clap and snare on 2 and 4, cowbell and rimshot accents.',
    variants: [
      { name: 'Classic electro', parts: { kick: 'X.....x...x.....', clap: BB, hat: H8, cowbell: '..x.......x.....' } },
      { name: 'Miami bass', bpm: 130, parts: { kick: 'X.....x..x....x.', clap: BB, hat: H16, rim: '...x.......x....' } },
      { name: 'Freestyle', bpm: 118, parts: { kick: 'X..x..x...x..x..', snare: BB, hat: H16, clap: '....x.......x...' } },
      { name: 'Two-bar with cowbell', parts: { kick: b('X.....x...x.....', 'X.....x..x..x...'), clap: b(BB, BB), hat: b(H8, H8), cowbell: b('..x.......x.....', '..x...x...x...x.') } },
    ],
  },
  {
    id: 'trap',
    name: 'Trap',
    short: 'Trap',
    category: 'Hip-hop',
    bpm: 140,
    swing: 50,
    about: 'Half-time snare on beat 3, sparse 808 kicks, and hats with rolls.',
    variants: [
      { name: 'Basic', parts: { kick: b('X.......x.x.....', 'X......x..x.....'), snare: b('........X.......', '........X.......'), hat: b(H8, H8) } },
      { name: 'Hat rolls', parts: { kick: b('X.......x.x.....', 'X......x..x.....'), snare: b('........X.......', '........X.......'), hat: b('x.x.x.x.x.x.xrx.', 'x.xrx.x.x.x.RRRR') } },
      { name: '16th hats', parts: { kick: b('X.....x...x.....', 'X.......x..x..x.'), clap: b('........X.......', '........X.......'), hat: b('xxxxxxxxxxxxxxxx', 'xxxxxxxxxxxxrrRR') } },
      { name: 'Triplet hats', parts: { kick: b('X.......x.......', 'X......x..x.....'), snare: b('........X.......', '........X.......'), hat: b('xu.txu.txu.txu.t', 'xu.txu.txu.txu.t') } },
    ],
  },
  {
    id: 'drill',
    name: 'UK drill',
    short: 'Drill',
    category: 'Hip-hop',
    bpm: 142,
    swing: 50,
    about: 'Sliding, syncopated hats over a snare on beat 3 and a late snare in the second bar.',
    variants: [
      { name: 'Classic', parts: { kick: b('X.........x.....', 'X..x......x.....'), snare: b('........X.......', '........X..x....'), hat: b('x..x..x.x..x..x.', 'x..x..x.x.x.xrx.') } },
      { name: 'Triplet hats', parts: { kick: b('X.........x.....', '..x.......x.....'), snare: b('........X.......', '........X.....x.'), hat: b('xu.txu.txu.txu.t', 'x..x..x.xu.txu.t') } },
      { name: 'Sparse', parts: { kick: b('X...........x...', '......x.........'), snare: b('........X.......', '........X..x....'), hat: b('x...x..x..x.x...', 'x...x..x..x.xrx.') } },
    ],
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    short: 'Lo-fi',
    category: 'Hip-hop',
    bpm: 80,
    swing: 60,
    about: 'Mellow, swung and soft: a lazy kick, rimshot backbeat and a shaker.',
    variants: [
      { name: 'Classic', parts: { kick: 'X.......x.x.....', rim: BB, hat: 'x.x.x.x.x.x.x.x.', shaker: '.g.g.g.g.g.g.g.g' } },
      { name: 'Snare and ghosts', parts: { kick: 'X......x..x.....', snare: '....X..g....X..g', hat: H8 } },
      { name: 'Two-bar', parts: { kick: b('X.......x.x.....', 'X.....x...x.....'), rim: b(BB, BB), hat: b(H8, H8) } },
    ],
  },

  // ===================== Drum & bass and jungle =====================
  {
    id: 'two-step',
    name: 'Two-step',
    short: 'TwoStep',
    category: 'Drum & bass',
    bpm: 174,
    swing: 50,
    about: 'The standard DnB groove: kick on 1, snare on 2, a kick just before 3, snare on 4.',
    variants: [
      { name: 'Basic', parts: { kick: 'X.........X.....', snare: BB, hat: H8 } },
      { name: 'Rolling (ghost notes)', parts: { kick: b('X.........X.....', 'X.........X..x..'), snare: b('....X..g....X..g', '....X.....g.X...'), hat: b('x.xgx.x.x.xgx.x.', 'x.xgx.x.x.xgx.xg') } },
      { name: 'Liquid (ride and shaker)', parts: { kick: 'X.........X.....', snare: BB, ride: H8, shaker: H16 } },
      { name: 'Jump-up double kick', parts: { kick: b('XX........X.....', 'X.........XX....'), snare: b(BB, BB), hat: b(H8, H8), openhat: b(E, '..............x.') } },
      { name: 'Neuro (tight and hard)', parts: { kick: b('X.........X.....', 'X.....x...X.....'), snare: b(BB, BB), clap: b(BB, BB), hat: b('x...x.x.x...x.x.', 'x...x.x.x...xrx.') } },
    ],
  },
  {
    id: 'dnb-halftime',
    name: 'Halftime DnB',
    short: 'Halftime',
    category: 'Drum & bass',
    bpm: 174,
    swing: 50,
    about: 'Still around 174 BPM but one snare per bar on beat 3: slow, heavy and head-nodding.',
    variants: [
      { name: 'Basic', parts: { kick: b('X.........X.....', 'X......x...X....'), snare: b('........X.......', '........X.......'), hat: b(Q4, 'x.x.x.x.x.x.x.x.') } },
      { name: 'With ghosts', parts: { kick: b('X.........X.....', 'X......x........'), snare: b('........X.....g.', '...g....X.....g.'), hat: b(H8, H8) } },
      { name: 'Sparse', parts: { kick: b('X...............', '......x...X.....'), snare: b('........X.......', '........X.......'), hat: b('x.......x.......', 'x.......x...x...') } },
    ],
  },
  {
    id: 'jungle',
    name: 'Jungle',
    short: 'Jungle',
    category: 'Drum & bass',
    bpm: 165,
    swing: 50,
    about: 'Chopped-up breakbeat drums at jungle tempo, with rolls and ragga accents.',
    variants: [
      { name: 'Ragga', parts: { kick: b('X.x.......x.....', 'X.x.......xx....'), snare: b('....X..g.x..X..g', '....X..g.x....X.'), ride: b(H8, H8), rim: b('..x.....', '..x.....', '..x.....', 'x.x.....') } },
      { name: 'Darkside', parts: { kick: b('X.........x.....', 'X.x.......x.....'), snare: b('....X..g.g..X...', '....X..g.g..X.rR'), hat: b('x.xgx.xgx.xgx.xg', 'x.xgx.xgx.xg....') } },
      { name: 'Rolling chops', parts: { kick: b('X.x.......xx....', '..xx......x.....'), snare: b('....X..g.x..X..g', '.g..X..g.x..Xrrr'), ride: b(H8, 'x.x.x.x.x.x.....') } },
    ],
  },

  // ===================== Funk, soul and shuffles =====================
  {
    id: 'purdie',
    name: 'Purdie shuffle',
    short: 'Purdie',
    category: 'Funk & soul',
    bpm: 92,
    swing: 50,
    about: 'Bernard Purdie\'s half-time shuffle: triplet hats with the middle note ghosted on the snare, and a backbeat on 3.',
    variants: [
      { name: 'Half-time shuffle', parts: { kick: 'X......t.u......', snare: '.q...q..X....q..', hat: 'x..tx..tx..tx..t' } },
      { name: 'With all ghost notes', parts: { kick: 'X......t.u......', snare: '.q...q..Xq...q..', hat: 'x..tx..tx..tx..t' } },
      { name: 'Porcaro-style (86 BPM)', bpm: 86, parts: { kick: 'X......tX......t', snare: '.q...q..X....q..', hat: 'x..tx..tx..tx..t' } },
      { name: 'Two-bar', parts: { kick: b('X......t.u......', 'X......t.......t'), snare: b('.q...q..X....q..', '.q...q..Xq...q..'), hat: b('x..tx..tx..tx..t', 'x..tx..tx..tx..t') } },
    ],
  },
  {
    id: 'shuffle',
    name: 'Blues shuffle',
    short: 'Shuffle',
    category: 'Funk & soul',
    bpm: 112,
    swing: 50,
    about: 'The swung triplet feel of blues and rock-and-roll: long-short 8ths, kick on 1 and 3, snare on 2 and 4.',
    variants: [
      { name: 'Basic shuffle', parts: { kick: 'X.......X.......', snare: BB, hat: 'x..tx..tx..tx..t' } },
      { name: 'Texas shuffle', parts: { kick: 'X...x...X...x...', snare: '...tX..t...tX..t', ride: 'x..tx..tx..tx..t' } },
      { name: 'Slow blues 12/8 (60 BPM)', bpm: 60, parts: { kick: 'X.......X.......', snare: BB, ride: 'xu.txu.txu.txu.t' } },
      { name: 'Swing ride', parts: { kick: 'g...g...g...g...', ride: 'x...x..tx...x..t', hat: BB, snare: '.......g........' } },
    ],
  },
  {
    id: 'funk',
    name: 'Funk',
    short: 'Funk',
    category: 'Funk & soul',
    bpm: 100,
    swing: 50,
    about: 'Tight 16th-note funk: syncopated kick, ghost notes between the backbeats and open-hat lifts.',
    variants: [
      { name: 'Classic 16ths', parts: { kick: 'X.x....x..x.....', snare: '....X..g.g..X..g', hat: H16 } },
      { name: 'Linear (no two hits together)', parts: { kick: 'X..x...x..x.....', snare: '....X.g..g..X.g.', hat: '.x.....x.x.x.x.x' } },
      { name: 'New Orleans (second-line feel)', parts: { kick: 'X..x..x...x.....', snare: 'g.gX.g.gg.gX.g.g', hat: '....x.......x...' } },
      { name: 'Open hat lifts', parts: { kick: 'X.x...x...x.....', snare: BB, hat: 'xgx...xgxgx...xg', openhat: '...x.......x....' } },
    ],
  },
  {
    id: 'motown',
    name: 'Motown',
    short: 'Motown',
    category: 'Funk & soul',
    bpm: 112,
    swing: 50,
    about: 'The 60s soul backbeat: snare on every beat, tambourine on 2 and 4.',
    variants: [
      { name: 'Four on the snare', parts: { kick: 'X.x.....X.x.....', snare: 'X...X...X...X...', shaker: BB, hat: H8 } },
      { name: 'Backbeat with tambourine', parts: { kick: 'X.......X.x.....', snare: BB, shaker: H8 } },
    ],
  },
  {
    id: 'gogo',
    name: 'Go-go',
    short: 'Go-go',
    category: 'Funk & soul',
    bpm: 98,
    swing: 58,
    about: 'Washington DC go-go: a swung pocket with congas and cowbell.',
    variants: [
      { name: 'Pocket', parts: { kick: 'X.....x.x.......', snare: '....X..g....X...', hat: H8, conga: '...x..x....x..x.', cowbell: 'x.....x.....x...' } },
      { name: 'Percussion only', parts: { conga: '...x..x....x..xx', cowbell: 'x.....x.....x...', tomhigh: '..x.......x.....' } },
    ],
  },

  // ===================== Rock and pop =====================
  {
    id: 'rock',
    name: 'Rock',
    short: 'Rock',
    category: 'Rock & pop',
    bpm: 120,
    swing: 50,
    about: 'The backbone of rock and pop: kick on 1 and 3, snare on 2 and 4, straight 8th hats.',
    variants: [
      { name: 'Basic 8ths', parts: { kick: 'X.......X.......', snare: BB, hat: H8 } },
      { name: 'Pushed kick', parts: { kick: 'X.......X.x.....', snare: BB, hat: H8 } },
      { name: 'Driving 16ths', parts: { kick: 'X.......X.x.....', snare: BB, hat: H16 } },
      { name: 'Half-time', parts: { kick: 'X.....x.........', snare: '........X.......', hat: H8 } },
      { name: 'Ride and crash (2 bars)', parts: { kick: b('X.......X.x.....', 'X.......X.....x.'), snare: b(BB, BB), ride: b(H8, H8), crash: b('X...............', E) } },
      { name: 'With tom fill (2 bars)', parts: { kick: b('X.......X.......', 'X.......X.......'), snare: b(BB, '....X.......xx..'), hat: b(H8, 'x.x.x.x.x.x.....'), tommid: b(E, '..............x.'), tomlow: b(E, '...............x') } },
    ],
  },
  {
    id: 'bo-diddley',
    name: 'Bo Diddley beat',
    short: 'BoDiddley',
    category: 'Rock & pop',
    bpm: 120,
    swing: 50,
    about: 'The 3-2 clave rhythm on toms with maracas, from rock-and-roll\'s early days.',
    variants: [
      { name: 'Toms and maracas', parts: { tomlow: 'X..x..x...x.x...', shaker: H16 } },
      { name: 'Kit version', parts: { kick: 'X..x..x.........', snare: '..........x.x...', hat: H8 } },
    ],
  },
  {
    id: 'train',
    name: 'Train beat',
    short: 'Train',
    category: 'Rock & pop',
    bpm: 150,
    swing: 50,
    about: 'Country and rockabilly: 16th snare brushes with accents on 2 and 4, kick on 1 and 3.',
    variants: [
      { name: 'Classic', parts: { kick: 'X.......X.......', snare: 'gggggggggggggggg', clap: BB } },
      { name: 'Accented snare', parts: { kick: 'X.......X.......', snare: 'ggggXgggggggXggg' } },
    ],
  },
  {
    id: 'motorik',
    name: 'Motorik',
    short: 'Motorik',
    category: 'Rock & pop',
    bpm: 130,
    swing: 50,
    about: 'The steady krautrock pulse: a relentless, hypnotic 8th-note groove.',
    variants: [
      { name: 'Classic', parts: { kick: 'X...X.x.X...X.x.', snare: BB, hat: H8 } },
      { name: 'With open hat', parts: { kick: 'X...X.x.X...X.x.', snare: BB, hat: 'x.x.x.x.x.x.x...', openhat: '..............x.' } },
    ],
  },
  {
    id: 'punk',
    name: 'Punk',
    short: 'Punk',
    category: 'Rock & pop',
    bpm: 180,
    swing: 50,
    about: 'Fast and driving: kick and snare trading 8ths.',
    variants: [
      { name: 'Polka beat', parts: { kick: 'X...X...X...X...', snare: OFF, hat: H8 } },
      { name: 'Straight 8ths', parts: { kick: 'X.......X.x.....', snare: BB, hat: H8 } },
      { name: 'Skate punk', parts: { kick: 'X.x.X.x.X.x.X.x.', snare: BB, crash: H8 } },
    ],
  },
  {
    id: 'metal',
    name: 'Metal',
    short: 'Metal',
    category: 'Rock & pop',
    bpm: 160,
    swing: 50,
    about: 'Double kick 16ths, blast beats and heavy half-time grooves.',
    variants: [
      { name: 'Double kick', parts: { kick: 'XxxxXxxxXxxxXxxx', snare: BB, ride: H8 } },
      { name: 'Blast beat', bpm: 200, parts: { kick: 'X.x.x.x.x.x.x.x.', snare: '.x.x.x.x.x.x.x.x', crash: H8 } },
      { name: 'Gallop', parts: { kick: 'X.xxX.xxX.xxX.xx', snare: BB, hat: H8 } },
      { name: 'Half-time heavy', parts: { kick: 'XxxxXxxx.xxxXxxx', snare: '........X.......', crash: Q4 } },
    ],
  },

  // ===================== Electronic =====================
  {
    id: 'house',
    name: 'House',
    short: 'House',
    category: 'Electronic',
    bpm: 124,
    swing: 50,
    about: 'Four-on-the-floor kick, clap on 2 and 4 and an offbeat open hat.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, clap: BB, openhat: OFF } },
      { name: 'With 16th hats', parts: { kick: FOUR, clap: BB, openhat: OFF, hat: 'xg.gxg.gxg.gxg.g' } },
      { name: 'Deep (rim and shaker)', bpm: 120, swing: 56, parts: { kick: FOUR, rim: '...x..x....x..x.', shaker: H16, openhat: OFF } },
      { name: 'Jackin\'', bpm: 126, parts: { kick: 'X...X...X...X..x', clap: BB, snare: '.......g......g.', hat: H16, openhat: OFF } },
      { name: 'Tech house', bpm: 126, parts: { kick: FOUR, clap: BB, hat: '..x...x.x.x...x.', rim: '.x.....x.x......', shaker: H16 } },
    ],
  },
  {
    id: 'techno',
    name: 'Techno',
    short: 'Techno',
    category: 'Electronic',
    bpm: 132,
    swing: 50,
    about: 'Driving four-on-the-floor kicks with ride and hats on the offbeat.',
    variants: [
      { name: 'Driving', parts: { kick: FOUR, clap: BB, openhat: OFF, hat: H16, ride: OFF } },
      { name: 'Rumble (ghost kicks)', parts: { kick: 'X..gX..gX..gX..g', openhat: OFF, hat: '.x.x.x.x.x.x.x.x' } },
      { name: 'Minimal', bpm: 126, parts: { kick: FOUR, rim: '...x....x.....x.', hat: OFF, shaker: '.g.g.g.g.g.g.g.g' } },
      { name: 'Hard', bpm: 145, parts: { kick: FOUR, clap: BB, ride: H16, openhat: OFF } },
    ],
  },
  {
    id: 'trance',
    name: 'Trance',
    short: 'Trance',
    category: 'Electronic',
    bpm: 138,
    swing: 50,
    about: 'Big four-on-the-floor kick, clap on 2 and 4, offbeat open hats and a 16th ride.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, clap: BB, openhat: OFF, hat: H16 } },
      { name: 'Build-up roll (2 bars)', parts: { kick: b(FOUR, FOUR), snare: b('x...x...x...x...', 'x.x.x.x.xxxxrrRR'), openhat: b(OFF, OFF) } },
    ],
  },
  {
    id: 'garage',
    name: 'UK garage',
    short: 'Garage',
    category: 'Electronic',
    bpm: 132,
    swing: 62,
    about: 'Skippy 2-step kicks that miss beat 3, a snare on 2 and 4 and heavily swung hats.',
    variants: [
      { name: '2-step', parts: { kick: 'X.........x.....', snare: BB, hat: 'g.x.g.x.g.x.g.x.', rim: '.......x.......x' } },
      { name: '2-step shuffle', parts: { kick: 'X......x..x.....', snare: BB, hat: 'g.xgg.x.g.xgg.x.', shaker: '.g.g.g.g.g.g.g.g' } },
      { name: 'Speed garage', bpm: 135, swing: 58, parts: { kick: FOUR, snare: BB, openhat: OFF, hat: '.g.g.g.g.g.g.g.g' } },
    ],
  },
  {
    id: 'dubstep',
    name: 'Dubstep',
    short: 'Dubstep',
    category: 'Electronic',
    bpm: 140,
    swing: 50,
    about: 'Half-time weight: kick on 1, a big snare on 3 and sparse syncopated hats.',
    variants: [
      { name: 'Classic', parts: { kick: b('X.........x.....', 'X......x........'), snare: b('........X.......', '........X.......'), hat: b('x.x...x.x.x...x.', 'x.x...x.x.x...x.') } },
      { name: 'Early dubstep (sparse)', parts: { kick: 'X...........x...', snare: '........X.......', hat: 'x...x.x.x...x.x.' } },
    ],
  },
  {
    id: 'breakbeat',
    name: 'Breakbeat',
    short: 'Breaks',
    category: 'Electronic',
    bpm: 130,
    swing: 50,
    about: 'Nu-skool and big-beat breaks: a funky, broken kick against a fat backbeat.',
    variants: [
      { name: 'Nu-skool', parts: { kick: 'X.x.......xx....', snare: '....X..g....X..g', hat: H8 } },
      { name: 'Big beat', bpm: 110, swing: 54, parts: { kick: 'X......xX.x.....', snare: BB, clap: BB, hat: 'x.xxx.xxx.xxx.xx' } },
      { name: 'Footwork / juke', bpm: 160, parts: { kick: 'X..X..X...X..X..', clap: BB, hat: OFF } },
    ],
  },
  {
    id: 'disco',
    name: 'Disco',
    short: 'Disco',
    category: 'Electronic',
    bpm: 120,
    swing: 50,
    about: 'Four-on-the-floor with offbeat open hats and a 16th-note hi-hat drive.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, snare: BB, openhat: OFF, hat: 'xx.xxx.xxx.xxx.x' } },
      { name: 'Philly (with toms)', parts: { kick: FOUR, snare: BB, openhat: OFF, hat: H16, shaker: '.x.x.x.x.x.x.x.x' } },
      { name: 'Nu-disco', bpm: 118, parts: { kick: FOUR, clap: BB, openhat: OFF, shaker: H16 } },
    ],
  },

  // ===================== Latin, Caribbean and African =====================
  {
    id: 'clave',
    name: 'Clave',
    short: 'Clave',
    category: 'Latin & world',
    bpm: 100,
    swing: 50,
    about: 'The two-bar key rhythm of Afro-Cuban music, in son and rumba forms.',
    variants: [
      { name: 'Son clave 3-2', parts: { clave: b('X.....X.....X...', '....X...X.......'), kick: b('...x...x...x...x', '...x...x...x...x'), shaker: b(H8, H8) } },
      { name: 'Son clave 2-3', parts: { clave: b('....X...X.......', 'X.....X.....X...'), kick: b('...x...x...x...x', '...x...x...x...x'), shaker: b(H8, H8) } },
      { name: 'Rumba clave 3-2', parts: { clave: b('X.....X.......X.', '....X...X.......'), conga: b('......x.......xx', '......x.......xx') } },
      { name: 'Songo', bpm: 110, parts: { clave: b('X.....X.....X...', '....X...X.......'), kick: b('...x.......x....', '...x.......x....'), snare: b('.......x..g...g.', '.......x..g...g.'), cowbell: b(H8, H8) } },
    ],
  },
  {
    id: 'bossa',
    name: 'Bossa nova',
    short: 'Bossa',
    category: 'Latin & world',
    bpm: 128,
    swing: 50,
    about: 'Brazilian bossa: a gentle kick pulse, cross-stick clave figure and 8th hats.',
    variants: [
      { name: 'Classic', parts: { kick: b('X..xX..xX..xX..x', 'X..xX..xX..xX..x'), rim: b('X..X..X...X..X..', '..X..X...X..X...'), hat: b(H8, H8) } },
      { name: 'Samba', bpm: 100, parts: { kick: b('X..xX..xX..xX..x', 'X..xX..xX..xX..x'), snare: b('x.gxg.gxx.gxg.gx', 'x.gxg.gxx.gxg.gx'), shaker: b(H16, H16), tomlow: b('....X.......X...', '....X.......X...') } },
      { name: 'Baião', bpm: 110, parts: { kick: 'X..x....X..x....', hat: H8, clave: '....x.......x...', shaker: H16 } },
    ],
  },
  {
    id: 'reggae',
    name: 'Reggae',
    short: 'Reggae',
    category: 'Latin & world',
    bpm: 76,
    swing: 58,
    about: 'Jamaican grooves: the one drop (kick and rim together on beat 3), rockers and steppers.',
    variants: [
      { name: 'One drop', parts: { kick: '........X.......', rim: '........X.......', hat: 'x.x.x.x.x.x.x.x.' } },
      { name: 'Rockers', bpm: 80, parts: { kick: 'X.......X.......', rim: BB, hat: 'x.xgx.xgx.xgx.xg' } },
      { name: 'Steppers', bpm: 140, swing: 50, parts: { kick: FOUR, snare: '........X.......', hat: OFF } },
      { name: 'Ska', bpm: 150, swing: 50, parts: { kick: 'X.......X.......', snare: BB, openhat: OFF } },
    ],
  },
  {
    id: 'dembow',
    name: 'Dembow (reggaeton)',
    short: 'Dembow',
    category: 'Latin & world',
    bpm: 95,
    swing: 50,
    about: 'The reggaeton pulse: four kicks with the "boom-ch-boom-chick" snare figure.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, snare: '...x..x....x..x.', hat: H8 } },
      { name: 'Perreo', bpm: 92, parts: { kick: FOUR, snare: '...x..x....x..x.', clap: '...x.......x....', hat: H16 } },
      { name: 'With rolls (2 bars)', parts: { kick: b(FOUR, FOUR), snare: b('...x..x....x..x.', '...x..x....x.rRR'), hat: b(H8, H8) } },
      { name: 'Dancehall', bpm: 100, parts: { kick: 'X..X..X.X..X..X.', snare: BB, rim: '..x...x...x...x.', hat: H8 } },
    ],
  },
  {
    id: 'afrobeat',
    name: 'Afrobeat',
    short: 'Afrobeat',
    category: 'Latin & world',
    bpm: 112,
    swing: 52,
    about: 'Nigerian grooves: the Tony Allen-style afrobeat and the modern afrobeats bounce.',
    variants: [
      { name: 'Afrobeat (Tony Allen-style)', parts: { kick: 'X.....x...x..x..', snare: '...g.X.g..g.X..g', hat: 'x.x.x.xxx.x.x.xx' } },
      { name: 'Afrobeats', bpm: 104, parts: { kick: 'X..x..x...x.....', rim: '...x..x....x..x.', shaker: H16, clap: '........X.......' } },
      { name: 'Amapiano', bpm: 112, parts: { kick: 'X.......X.......', shaker: H16, rim: '..x...x...x..x..', clap: BB } },
      { name: 'Afro house', bpm: 122, parts: { kick: FOUR, conga: '..x..x.x..x..x.x', shaker: H16, rim: '...x......x.....' } },
    ],
  },
  // ===================== More beats (2026-11) =====================
  // A second batch of well-known grooves across more kinds of music, written
  // by hand from standard drumming practice.

  // --- Jazz ---
  {
    id: 'jazz-swing',
    name: 'Jazz swing',
    short: 'JazzSwing',
    category: 'Jazz',
    bpm: 140,
    swing: 50,
    about: 'The jazz time feel: "spang-a-lang" ride on the triplet grid, hi-hat foot on 2 and 4 and a feathered kick.',
    variants: [
      { name: 'Medium swing', parts: { ride: 'x...x..tx...x..t', hat: BB, kick: 'g...g...g...g...' } },
      { name: 'With comping', parts: { ride: 'x...x..tx...x..t', hat: BB, kick: 'g...g...g...g...', snare: '.......t.q......' } },
      { name: 'Two-feel', parts: { ride: 'x...x..tx...x..t', hat: BB, kick: 'x.......x.......' } },
      { name: 'Up-tempo (200 BPM)', bpm: 200, swing: 58, parts: { ride: 'x...x.x.x...x.x.', hat: BB, kick: 'g.......g.......' } },
      { name: 'Brushes ballad (70 BPM)', bpm: 70, parts: { snare: 'g..tX..tg..tX..t', hat: BB, kick: 'g.......g.......' } },
      {
        name: 'Trading fours fill (2 bars)',
        parts: {
          ride: b('x...x..tx...x..t', 'x...x..t........'),
          hat: b(BB, BB),
          kick: b('g...g...g...g...', 'g...g.......X...'),
          snare: b(E, '........x..tx..t'),
        },
      },
    ],
  },

  // --- Funk, soul and gospel ---
  {
    id: 'second-line',
    name: 'Second line',
    short: 'SecondLn',
    category: 'Funk & soul',
    bpm: 100,
    swing: 56,
    about: 'The New Orleans street-parade groove: a rolling, accented snare over a bass drum that pushes ahead of the beat.',
    variants: [
      { name: 'Street beat', parts: { kick: 'X.....x.X.......', snare: '..gX..gX.gX...X.' } },
      { name: 'With cowbell', parts: { kick: 'X.....x.X.......', snare: '..gX..gX.gX...X.', cowbell: 'x..x..x...x.x...' } },
      { name: 'On the kit', parts: { kick: 'X.....x.X.....x.', snare: 'g.gXg.gXggX.g.Xg', hat: '....x.......x...' } },
      { name: 'Two-bar', parts: { kick: b('X.....x.X.......', 'X.....x...x..x..'), snare: b('..gX..gX.gX...X.', '..gX..gX.g.Xrr.X') } },
    ],
  },
  {
    id: 'gospel',
    name: 'Gospel chops',
    short: 'Gospel',
    category: 'Funk & soul',
    bpm: 96,
    swing: 50,
    about: 'Church and "shed" drumming: a heavy backbeat wrapped in ghost notes, shuffle feels and fast kick-snare runs.',
    variants: [
      { name: 'Shed backbeat', parts: { kick: 'X.....x...x..x..', snare: '....X.g.gg..X.gg', hat: H16 } },
      { name: 'Gospel shuffle', parts: { kick: 'X......tX.......', snare: '.q..X..t.q..X..t', hat: 'x..tx..tx..tx..t' } },
      { name: 'Chops run (2 bars)', parts: { kick: b('X.....x...x.....', 'XxxXxxXxxX......'), snare: b('....X.g.gg..X.gg', '.x..x..x..XrrRRR'), hat: b(H16, 'x...............'), crash: b(E, '..........X.....') } },
    ],
  },

  // --- Hip-hop and R&B ---
  {
    id: 'new-jack',
    name: 'New jack swing',
    short: 'NewJack',
    category: 'Hip-hop',
    bpm: 108,
    swing: 62,
    about: 'Late-80s R&B meets hip-hop: hard swung 16ths, a busy kick and a snare and clap stacked on the backbeat.',
    variants: [
      { name: 'Classic', parts: { kick: 'X..x..x...x..x..', snare: BB, clap: BB, hat: H16 } },
      { name: 'With rim', parts: { kick: 'X..x....X.x.....', snare: BB, rim: '..x.......x..x..', hat: H8 } },
      { name: 'Two-bar', parts: { kick: b('X..x..x...x..x..', 'X..x....X.x...x.'), snare: b(BB, '....X.......X.x.'), clap: b(BB, BB), hat: b(H16, H16) } },
    ],
  },
  {
    id: 'rnb-90s',
    name: '90s R&B',
    short: 'R&B90s',
    category: 'Hip-hop',
    bpm: 88,
    swing: 54,
    about: 'Slow-jam R&B: a laid-back kick, rim and finger snaps on the backbeat, soft 16th hats.',
    variants: [
      { name: 'Slow jam', parts: { kick: 'X......x.x......', snare: BB, hat: H16 } },
      { name: 'Rim and snaps', parts: { kick: 'X.....x..x.x....', rim: BB, clap: BB, hat: H8 } },
      { name: 'With shaker', bpm: 84, parts: { kick: 'X......x..x..x..', snare: BB, shaker: H16, openhat: '......x.......x.' } },
    ],
  },
  {
    id: 'crunk',
    name: 'Crunk',
    short: 'Crunk',
    category: 'Hip-hop',
    bpm: 80,
    swing: 50,
    about: 'Southern party hip-hop: booming sparse kicks, big claps and snare rolls into the next bar.',
    variants: [
      { name: 'Classic', parts: { kick: 'X.....x...X.....', clap: BB, hat: H8 } },
      { name: 'Snare rolls (2 bars)', parts: { kick: b('X.....x...X.....', 'X.....x.X.x.....'), clap: b(BB, BB), snare: b(E, '............rrRR'), hat: b(H8, H8) } },
    ],
  },
  {
    id: 'bounce',
    name: 'Bounce',
    short: 'Bounce',
    category: 'Hip-hop',
    bpm: 100,
    swing: 50,
    about: 'New Orleans bounce: a call-and-response party beat with a busy, syncopated kick and snare.',
    variants: [
      { name: 'Classic', parts: { kick: 'X..x..x...x..x..', snare: '....x..x..x.x...', hat: H16 } },
      { name: 'With claps', parts: { kick: 'X..x..x...x..x..', snare: '....x..x..x.x...', clap: BB, hat: H8 } },
    ],
  },
  {
    id: 'phonk',
    name: 'Memphis phonk',
    short: 'Phonk',
    category: 'Hip-hop',
    bpm: 130,
    swing: 50,
    about: 'Memphis-rap-rooted phonk: half-time snare, rattling cowbell figures and rolling hats.',
    variants: [
      { name: 'Classic (2 bars)', parts: { kick: b('X.....x...x.....', 'X.x...x...x.....'), clap: b('........X.......', '........X.......'), cowbell: b('x..x..x.x..x..x.', 'x..x..x.x.x.x...'), hat: b(H8, 'x.x.x.x.x.x.xrx.') } },
      { name: 'Drift (16th hats)', parts: { kick: 'X.....x...x..x..', clap: '........X.......', hat: H16, cowbell: 'x..x..x.x..x..x.' } },
    ],
  },

  // --- Electronic ---
  {
    id: 'jersey-club',
    name: 'Jersey club',
    short: 'JerseyClb',
    category: 'Electronic',
    bpm: 140,
    swing: 50,
    about: 'Fast club music from New Jersey: the five-kick "bounce" figure with claps on the backbeat.',
    variants: [
      { name: 'Classic', parts: { kick: 'X...X...X.X.X...', clap: BB, hat: H8 } },
      { name: 'Two-bar', parts: { kick: b('X...X...X.X.X...', 'X...X...X.X.X.x.'), clap: b(BB, '....X.......X.x.'), hat: b(H8, H8) } },
    ],
  },
  {
    id: 'footwork',
    name: 'Footwork',
    short: 'Footwork',
    category: 'Electronic',
    bpm: 160,
    swing: 50,
    about: 'Chicago footwork and juke: syncopated triplet-leaning kicks at 160 with sparse claps.',
    variants: [
      { name: 'Classic', parts: { kick: 'X..X..X...X..X..', clap: '....x.......x...', hat: 'x..x..x.x..x..x.' } },
      { name: 'Triplet hats', parts: { kick: 'X..X..X...X..X..', clap: BB, hat: 'xu.txu.txu.txu.t' } },
    ],
  },
  {
    id: 'trip-hop',
    name: 'Trip-hop',
    short: 'TripHop',
    category: 'Electronic',
    bpm: 82,
    swing: 54,
    about: 'Bristol-style downtempo: slow, heavy breakbeats with a dusty, laid-back feel.',
    variants: [
      { name: 'Heavy', parts: { kick: 'X.......x.x.....', snare: BB, hat: H8 } },
      { name: 'Dusty', parts: { kick: 'X......x..x..x..', snare: '....X..g....X...', hat: 'x.xgx.x.x.xgx.x.', shaker: H16 } },
      { name: 'Ride and rim', bpm: 76, parts: { kick: 'X.........x.....', rim: BB, ride: H8 } },
    ],
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    short: 'Synthwave',
    category: 'Electronic',
    bpm: 110,
    swing: 50,
    about: '80s-inspired synthwave: big gated snares, steady kicks and tom runs.',
    variants: [
      { name: 'Gated snare', parts: { kick: 'X.......X.......', snare: BB, hat: H16 } },
      { name: 'Four on the floor', parts: { kick: FOUR, snare: BB, hat: OFF } },
      {
        name: 'Tom run (2 bars)',
        parts: {
          kick: b(FOUR, FOUR),
          snare: b(BB, '....X...........'),
          hat: b(H8, 'x.x.x.x.........'),
          tomhigh: b(E, '........xx......'),
          tommid: b(E, '..........xx....'),
          tomlow: b(E, '............xxxx'),
        },
      },
    ],
  },
  {
    id: 'hardstyle',
    name: 'Hardstyle',
    short: 'Hardstyle',
    category: 'Electronic',
    bpm: 150,
    swing: 50,
    about: 'Hard dance at 150: a distorted kick on every beat, claps on 2 and 4 and offbeat open hats.',
    variants: [
      { name: 'Kick and clap', parts: { kick: FOUR, clap: BB, openhat: OFF } },
      { name: 'With 16th hats', parts: { kick: FOUR, clap: BB, hat: 'xx.xxx.xxx.xxx.x', openhat: OFF } },
    ],
  },
  {
    id: 'gabber',
    name: 'Gabber',
    short: 'Gabber',
    category: 'Electronic',
    bpm: 190,
    swing: 50,
    about: 'Rotterdam hardcore: a pounding kick at 190 with offbeat hats and kick rolls.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, openhat: OFF, clap: BB } },
      { name: 'Kick rolls (2 bars)', parts: { kick: b(FOUR, 'X...X...X.x.XxxX'), openhat: b(OFF, OFF), clap: b(BB, BB) } },
    ],
  },
  {
    id: 'moombahton',
    name: 'Moombahton',
    short: 'Moombah',
    category: 'Electronic',
    bpm: 108,
    swing: 50,
    about: 'Dutch house slowed to reggaeton tempo: four kicks with the dembow snare and tribal percussion.',
    variants: [
      { name: 'Classic', parts: { kick: FOUR, snare: '...x..x....x..x.', clap: BB, hat: H8 } },
      { name: 'Tribal', parts: { kick: FOUR, conga: '..x..x.x..x..x.x', rim: '...x..x....x..x.', shaker: H16 } },
    ],
  },

  // --- Latin and world ---
  {
    id: 'mambo',
    name: 'Mambo',
    short: 'Mambo',
    category: 'Latin & world',
    bpm: 104,
    swing: 50,
    about: 'Afro-Cuban dance band rhythm: mambo bell and son clave over the conga tumbao, or the timbale cascara.',
    variants: [
      { name: 'Bell and clave 3-2', parts: { cowbell: b('X.x.X.x.X.xxX.x.', 'X.x.X.x.X.x.X.xx'), clave: b('X.....X.....X...', '....X...X.......'), conga: b('......xx......xx', '......xx......xx'), kick: b('......x.......x.', '......x.......x.') } },
      { name: 'Cascara 3-2', parts: { rim: b('X...X.X...X...X.', 'X...X...X.X...X.'), clave: b('X.....X.....X...', '....X...X.......'), conga: b('......x.......xx', '......x.......xx') } },
    ],
  },
  {
    id: 'chacha',
    name: 'Cha-cha-chá',
    short: 'ChaCha',
    category: 'Latin & world',
    bpm: 120,
    swing: 50,
    about: 'The Cuban cha-cha-chá: cowbell on the beat, güiro scrape and the "cha-cha" conga on 4-and.',
    variants: [
      { name: 'Percussion', parts: { cowbell: 'X...X...X...X...', shaker: 'x...x.x.x...x.x.', conga: '......x.......xx' } },
      { name: 'Kit version', parts: { kick: 'X.......X.......', rim: '....X.......X...', cowbell: Q4, tomlow: '............x.x.' } },
    ],
  },
  {
    id: 'soca',
    name: 'Soca and calypso',
    short: 'Soca',
    category: 'Latin & world',
    bpm: 120,
    swing: 50,
    about: 'Trinidad carnival rhythms: driving soca with a kick on every beat and offbeat snare, and the older, lighter calypso.',
    variants: [
      { name: 'Soca', parts: { kick: FOUR, snare: OFF, hat: H16, cowbell: 'x..x..x.x..x..x.' } },
      { name: 'Power soca', bpm: 155, parts: { kick: FOUR, snare: '..x...x...x..xx.', hat: H8 } },
      { name: 'Calypso', bpm: 105, parts: { kick: 'X..x....X..x....', snare: BB, hat: H8 } },
    ],
  },
  {
    id: 'merengue',
    name: 'Merengue',
    short: 'Merengue',
    category: 'Latin & world',
    bpm: 140,
    swing: 50,
    about: 'Dominican merengue: the güira scraping on every beat and the tambora\'s rolling two-headed pattern.',
    variants: [
      { name: 'Güira and tambora', parts: { shaker: 'X.xxX.xxX.xxX.xx', tomlow: 'X......xX.x.X.x.', rim: '....x.......x...' } },
      { name: 'Kit version', parts: { kick: FOUR, rim: '..x...x...x...x.', shaker: 'X.xxX.xxX.xxX.xx', snare: '.......x.......x' } },
    ],
  },
  {
    id: 'cumbia',
    name: 'Cumbia',
    short: 'Cumbia',
    category: 'Latin & world',
    bpm: 95,
    swing: 50,
    about: 'Colombian cumbia: the guacharaca scrape, a two-beat kick and the conga on the offbeats.',
    variants: [
      { name: 'Classic', parts: { kick: 'X.......X.......', shaker: 'x.xxx.xxx.xxx.xx', conga: '..x...x...x...x.', rim: BB } },
      { name: 'Sonidera', bpm: 90, parts: { kick: FOUR, shaker: 'x.xxx.xxx.xxx.xx', rim: '..x...x...x...x.', cowbell: '....x.......x...' } },
    ],
  },
  {
    id: 'tango',
    name: 'Tango and habanera',
    short: 'Tango',
    category: 'Latin & world',
    bpm: 116,
    swing: 50,
    about: 'Rioplatense and Cuban roots: the habanera figure (dotted 8th, 16th, two 8ths) and tango\'s marching four.',
    variants: [
      { name: 'Habanera', parts: { tomlow: 'X..xx.x.X..xx.x.', rim: BB } },
      { name: 'Tango marcato', parts: { kick: 'X...X...X...X...', snare: '...x.......x....' } },
      { name: 'Tango 3-3-2', parts: { kick: 'X..X..X.X..X..X.', rim: '......x.......x.' } },
    ],
  },
  {
    id: 'bolero',
    name: 'Bolero',
    short: 'Bolero',
    category: 'Latin & world',
    bpm: 84,
    swing: 50,
    about: 'Latin bolero: slow and romantic, with the bongó martillo, a rim backbeat and maracas.',
    variants: [
      { name: 'Classic', parts: { kick: 'X.......X.......', rim: '....x.......x...', shaker: H8, tomhigh: 'x.gxx.gxx.gxx.gx' } },
      { name: 'With conga', parts: { kick: 'X.......X.......', rim: '....x..x....x...', conga: '......x.......xx', shaker: H8 } },
    ],
  },
  {
    id: 'highlife',
    name: 'Highlife',
    short: 'Highlife',
    category: 'Latin & world',
    bpm: 120,
    swing: 50,
    about: 'Ghanaian highlife: a bright bell pattern over a light kick and snare and shaker.',
    variants: [
      { name: 'Classic', parts: { cowbell: 'x.x..x.x.x.x..x.', kick: 'X.......X.......', snare: '......x.......x.', shaker: H16 } },
      { name: 'With congas', parts: { cowbell: 'x.x..x.x.x.x..x.', kick: 'X.......X.......', conga: '..xx..x...xx..x.', shaker: H8 } },
    ],
  },
  {
    id: 'bhangra',
    name: 'Bhangra',
    short: 'Bhangra',
    category: 'Latin & world',
    bpm: 100,
    swing: 50,
    about: 'Punjabi bhangra: the dhol\'s bouncing "chaal" on the triplet grid, a bass hit and a sharp stick on top.',
    variants: [
      { name: 'Chaal', parts: { tomlow: 'X..tx..tX..tx..t', rim: '.u...u...u...u..' } },
      { name: 'Kit version', parts: { kick: 'X..t...tX..t...t', snare: '....X.......X...', rim: '.u...u...u...u..', shaker: 'x..tx..tx..tx..t' } },
    ],
  },
  {
    id: 'maqsum',
    name: 'Middle Eastern rhythms',
    short: 'Maqsum',
    category: 'Latin & world',
    bpm: 100,
    swing: 50,
    about: 'Arabic dance rhythms on doum (low tom) and tek (rim): maqsum, baladi, saidi and malfuf.',
    variants: [
      { name: 'Maqsum', parts: { tomlow: 'X.......X.......', rim: '..x...x.....x...', shaker: 'gggggggggggggggg' } },
      { name: 'Baladi', parts: { tomlow: 'X.X.....X.......', rim: '......x.....x...', shaker: 'gggggggggggggggg' } },
      { name: 'Saidi', parts: { tomlow: 'X.....X.X.......', rim: '..x.........x...', shaker: 'gggggggggggggggg' } },
      { name: 'Malfuf', bpm: 130, parts: { tomlow: 'X...............', rim: '......x.....x...' } },
    ],
  },

  // --- Rock, pop and country ---
  {
    id: 'pop',
    name: 'Pop',
    short: 'Pop',
    category: 'Rock & pop',
    bpm: 100,
    swing: 50,
    about: 'Pop staples: the ballad, the dance-pop four-on-the-floor, half-time choruses and the stomp-clap beat.',
    variants: [
      { name: 'Ballad (72 BPM)', bpm: 72, parts: { kick: 'X.......X.x.....', rim: BB, hat: H8 } },
      { name: 'Dance pop', bpm: 120, parts: { kick: FOUR, clap: BB, hat: OFF } },
      { name: 'Half-time chorus', parts: { kick: 'X.....x...x.....', snare: '........X.......', hat: H16 } },
      { name: 'Stomp and clap', bpm: 82, parts: { kick: 'X.X.....X.X.....', clap: BB } },
    ],
  },
  {
    id: 'surf',
    name: 'Surf rock',
    short: 'Surf',
    category: 'Rock & pop',
    bpm: 160,
    swing: 50,
    about: 'Early-60s surf: a fast, driving beat with rolling floor-tom 16ths.',
    variants: [
      { name: 'Tom groove', parts: { kick: 'X.......X.......', snare: BB, tomlow: 'x.xxx.xxx.xxx.xx' } },
      { name: 'Kit version', parts: { kick: 'X.......X.x.....', snare: BB, ride: H8, crash: 'X...............' } },
    ],
  },
  {
    id: 'country',
    name: 'Country',
    short: 'Country',
    category: 'Rock & pop',
    bpm: 110,
    swing: 50,
    about: 'Country and bluegrass: the two-beat with cross-stick backbeats and the fast bluegrass offbeat snare.',
    variants: [
      { name: 'Two-beat', parts: { kick: 'X.......X.......', rim: BB, hat: H8 } },
      { name: 'Bluegrass', bpm: 180, parts: { kick: 'X.......X.......', snare: OFF } },
      { name: 'Country rock', bpm: 124, parts: { kick: 'X.......X.x.....', snare: BB, hat: H8, shaker: H16 } },
    ],
  },
];

export const CATEGORIES: string[] = [...new Set(CLASSICS.map((c) => c.category))];

export const classicById = (id: string): Classic => CLASSICS.find((c) => c.id === id) ?? CLASSICS[0];

/** Total number of named variants in the library. */
export const VARIANT_COUNT = CLASSICS.reduce((n, c) => n + c.variants.length, 0);
