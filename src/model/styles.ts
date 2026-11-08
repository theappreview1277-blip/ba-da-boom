import type { Role } from './rhythm';

// The beat library: drum patterns for many kinds of music, written as step
// patterns that the app plays with its own kits. No recordings are included:
// the "-style" breaks are rhythms in the manner of the classic sampled breaks,
// written from scratch for the grid.
//
// Each character of a part is one 16th step (a bar is 16 characters):
//   X accent   x hit   . rest                      always written
//   o extra hit   g ghost note                     written when the complexity allows (seeded)
//   r hit that becomes a fast roll (ratchet)       when the complexity allows
//   t hit a third of a step early: the swung 8th of a triplet feel (jazz, shuffle)
// A part is 1, 2 or 4 bars (16, 32 or 64 steps). When a role has several
// alternatives, the seed picks one.

export interface Style {
  id: string;
  genre: string;
  name: string;
  bpm: number;
  /** Project swing, 50..75. */
  swing: number;
  /** One line on what makes this pattern what it is. */
  about: string;
  parts: Partial<Record<Role, string[]>>;
}

/** Bars joined into one part. */
const b = (...bars: string[]) => bars.join('');

export const STYLES: Style[] = [
  // --- Drum & bass ---
  {
    id: 'dnb-twostep',
    genre: 'Drum & bass',
    name: 'Two-step',
    bpm: 174,
    swing: 50,
    about: 'Kick on 1, snare on 2, a second kick just before 3, snare on 4: the standard rolling DnB groove.',
    parts: {
      kick: ['X.........X.....', 'X.........x..o..', b('X.........X.....', 'X.........X..o..')],
      snare: ['....X.......X...', '....X..g....X..g', '....X.....g.X...'],
      hat: ['x.x.x.xox.x.x.xo', 'x.xox.x.x.xox.x.'],
      shaker: ['gggggggggggggggg'],
      ride: ['o.o.o.o.o.o.o.o.'],
    },
  },
  {
    id: 'dnb-doublekick',
    genre: 'Drum & bass',
    name: 'Step-fast / double kick',
    bpm: 174,
    swing: 50,
    about: 'The two-step with an extra fast kick straight after a kick or snare: bouncy, jump-up energy.',
    parts: {
      kick: ['XX........X.....', 'X.........XX....', b('XX........X.....', 'X....x....XX....')],
      snare: ['....X.......X...', '....X..g....X...'],
      hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'],
      openhat: ['..............o.'],
    },
  },
  {
    id: 'dnb-halftime',
    genre: 'Drum & bass',
    name: 'Halftime',
    bpm: 174,
    swing: 50,
    about: 'Still ~174 BPM, but one snare per bar on beat 3: slow, heavy, head-nodding.',
    parts: {
      kick: ['X.........X.....', b('X.........X.....', 'X......x...X....'), 'X.....o...X..o..'],
      snare: ['........X.......', '........X......g'],
      hat: ['x...x...x...x...', 'x.o.x.o.x.o.x.o.'],
      openhat: [b('................', '..............o.')],
    },
  },
  {
    id: 'dnb-fourfloor',
    genre: 'Drum & bass',
    name: 'Four-on-the-floor',
    bpm: 174,
    swing: 50,
    about: 'Dancefloor DnB: a kick on every beat, like house at double speed.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['.g.g.g.g.g.g.g.g'],
    },
  },
  {
    id: 'dnb-amen',
    genre: 'Drum & bass',
    name: 'Amen-style break',
    bpm: 170,
    swing: 50,
    about: 'Four bars in the manner of the Amen break: syncopated kicks, ghosted snares, and a broken double-snare third bar with a crash in bar four.',
    parts: {
      kick: [b('X.x.......xx....', 'X.x.......xx....', 'X.x.......x.....', '..xx......x.....')],
      snare: [b('....X..x.x..X..x', '....X..x.x..X..x', '....X..x.x....X.', '.x..X..x.x....X.')],
      ride: [b('x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.')],
      crash: [b('................', '................', '................', '..........x.....')],
    },
  },
  {
    id: 'dnb-think',
    genre: 'Drum & bass',
    name: 'Think-style break',
    bpm: 172,
    swing: 52,
    about: 'A bright, shuffling tambourine over a funky kick and snare, the rolling feel of liquid DnB.',
    parts: {
      kick: [b('X.....x...X.....', 'X.....x.x.....o.')],
      snare: ['....X..g....X..g', '....X.....g.X...'],
      shaker: ['XgxgXgxgXgxgXgxg'],
      hat: ['..o...o...o...o.'],
    },
  },
  {
    id: 'dnb-apache',
    genre: 'Drum & bass',
    name: 'Apache-style break',
    bpm: 172,
    swing: 52,
    about: 'Punchy kick and snare under rolling, frantic bongos: tribal energy for deep rollers.',
    parts: {
      kick: ['X......x..X.....', b('X......x..X.....', 'X.x.......X.....')],
      snare: ['....X.......X...', '....X..g....X..g'],
      conga: ['x.xxx.xx.xxx.x.x', 'xx.xx.x.xx.xx.xo'],
      hat: ['x.x.x.x.x.x.x.x.'],
      tomhigh: ['...o.......o....'],
    },
  },
  {
    id: 'dnb-tramen',
    genre: 'Drum & bass',
    name: 'Tramen-style break',
    bpm: 174,
    swing: 50,
    about: 'Amen-style chops layered with hard modern hits: a heavy kick and clap stacked on the backbeat, for techstep and neurofunk.',
    parts: {
      kick: [b('X.x.......X.....', 'X.x.......xx....')],
      snare: [b('....X..g.g..X..g', '....X..g.g....X.')],
      clap: ['....X.......X...'],
      hat: ['x.x.x.x.x.x.x.x.'],
      ride: ['o.o.o.o.o.o.o.o.'],
    },
  },
  {
    id: 'dnb-soulpride',
    genre: 'Drum & bass',
    name: 'Soul Pride-style break',
    bpm: 172,
    swing: 50,
    about: 'Relentless, intricate ghost-noted snares around the backbeat: the drumfunk favourite.',
    parts: {
      kick: ['X..x......X..x..', 'X.........X.x...'],
      snare: ['g.ggXg.gg.ggXg.g', '.ggxXg.g.gg.Xgg.'],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },

  // --- Jungle ---
  {
    id: 'jungle-ragga',
    genre: 'Jungle',
    name: 'Ragga jungle',
    bpm: 165,
    swing: 50,
    about: 'Chopped break rhythms with a reggae-style rim and sparse kicks.',
    parts: {
      kick: [b('X.........X.....', 'X.x.......x.....')],
      snare: [b('....X..x.x..X...', '....X..x.x..X.xx')],
      rim: ['......o.......o.'],
      ride: ['x.x.x.x.x.x.x.x.'],
    },
  },

  // --- House ---
  {
    id: 'house-classic',
    genre: 'House',
    name: 'Classic house',
    bpm: 124,
    swing: 54,
    about: 'Four-on-the-floor kick, clap on 2 and 4, open hats on the offbeats.',
    parts: {
      kick: ['X...X...X...X...'],
      clap: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['g..gg..gg..gg..g', '.g.g.g.g.g.g.g.g'],
      shaker: ['.ggg.ggg.ggg.ggg'],
      conga: ['...o..o....o.o..', '......o..o....o.'],
    },
  },
  {
    id: 'house-deep',
    genre: 'House',
    name: 'Deep house',
    bpm: 120,
    swing: 58,
    about: 'Softer, swung house with a rim and shaker groove.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['....X.......X...'],
      rim: ['...o.....o....o.', '......o......o..'],
      hat: ['..x...x...x...x.'],
      shaker: ['gxgxgxgxgxgxgxgx'],
    },
  },
  {
    id: 'house-tech',
    genre: 'House',
    name: 'Tech house',
    bpm: 126,
    swing: 53,
    about: 'Tight four-on-the-floor with busy, syncopated percussion.',
    parts: {
      kick: ['X...X...X...X...'],
      clap: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['xg.gxg.gxg.gxg.g'],
      rim: ['...x..x...x..x..', '.x....x..x....x.'],
      clave: ['..........o.....'],
    },
  },

  // --- Techno ---
  {
    id: 'techno-driving',
    genre: 'Techno',
    name: 'Driving techno',
    bpm: 130,
    swing: 50,
    about: 'Relentless kick, offbeat open hat, syncopated rim.',
    parts: {
      kick: ['X...X...X...X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['xg.gxg.gxg.gxg.g', 'x..gx..gx..gx..g'],
      clap: ['....o.......o...'],
      rim: ['...o..o...o..o..', '..o..o..o..o.o..'],
      ride: ['..o...o...o...o.'],
    },
  },
  {
    id: 'techno-minimal',
    genre: 'Techno',
    name: 'Minimal',
    bpm: 125,
    swing: 52,
    about: 'Sparse and clicky: kick, a few rims and a light hat.',
    parts: {
      kick: ['X...X...X...X...'],
      rim: ['.......x.....o..', '...x.......x..o.'],
      hat: ['..x...x...x...x.'],
      clave: ['.....o.........o'],
    },
  },
  {
    id: 'techno-hard',
    genre: 'Techno',
    name: 'Hard techno',
    bpm: 150,
    swing: 50,
    about: 'Pounding kick with a rumbling ghost kick and 16th hats.',
    parts: {
      kick: ['X..gX..gX..gX..g', 'X...X...X...X..g'],
      clap: ['....X.......X...'],
      hat: ['xxxxxxxxxxxxxxxx'],
      openhat: ['..o...o...o...o.'],
    },
  },
  {
    id: 'trance',
    genre: 'Techno',
    name: 'Trance',
    bpm: 138,
    swing: 50,
    about: 'Straight four-on-the-floor, offbeat open hats and a crash every two bars.',
    parts: {
      kick: ['X...X...X...X...'],
      clap: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['x.gx..gx..gx..g.'],
      crash: [b('o...............', '................')],
    },
  },

  // --- Hip-hop ---
  {
    id: 'hiphop-boombap',
    genre: 'Hip-hop',
    name: 'Boom bap',
    bpm: 90,
    swing: 57,
    about: 'Hard kick and snare on 2 and 4, swung 8th hats, two-bar kick pattern.',
    parts: {
      kick: [b('X......x..X.....', 'X......x.xo...o.'), b('X.....x...X..o..', 'X.x...x...X.....'), b('X......xx.......', 'X.....x...x..o..')],
      snare: [b('....X..g....X...', '....X..g.g..X..g'), b('....X.......X..g', '....X..g....X...')],
      hat: ['x.x.x.xox.x.x.xo', 'x.xox.x.x.xox.x.'],
      openhat: [b('................', '..............o.')],
    },
  },
  {
    id: 'hiphop-lofi',
    genre: 'Hip-hop',
    name: 'Lo-fi',
    bpm: 78,
    swing: 62,
    about: 'Lazy, heavily swung boom bap with soft hats.',
    parts: {
      kick: [b('X......x..x.....', 'X.....x...X..o..'), b('X.....x...X.....', 'X......x..x.....')],
      snare: ['....X.......X..g', '....X..g....X...'],
      rim: ['..........o.....'],
      hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'],
      shaker: ['g.g.g.g.g.g.g.g.'],
    },
  },
  {
    id: 'hiphop-oldschool',
    genre: 'Hip-hop',
    name: 'Old school / electro',
    bpm: 108,
    swing: 50,
    about: 'Drum-machine electro: syncopated kick, clap on 2 and 4, cowbell.',
    parts: {
      kick: ['X......X..X.....', 'X.....X...X..X..'],
      clap: ['....X.......X...'],
      hat: ['x.x.x.x.x.x.x.x.', 'xxx.x.x.xxx.x.x.'],
      cowbell: ['o.....o.....o...'],
    },
  },

  // --- Trap and drill ---
  {
    id: 'trap',
    genre: 'Trap & drill',
    name: 'Trap',
    bpm: 140,
    swing: 50,
    about: 'Half-time clap on beat 3, sliding kicks and rolling hi-hats.',
    parts: {
      kick: [b('X......x..X.....', 'X.....X...x..x..'), b('X..x......X...x.', 'X......x..X.....'), b('X.....X...x.....', 'X..x......x..x..')],
      clap: ['........X.......'],
      snare: [b('........o.......', '........o......g')],
      hat: [b('x.xxx.x.x.xrx.x.', 'x.x.xrx.x.x.rrx.'), b('xxx.x.x.x.xxr.x.', 'x.x.x.xrx.x.x.rr'), b('x.x.x.x.xrx.x.x.', 'x.x.rrx.x.x.xrx.')],
      openhat: [b('................', '..............o.')],
    },
  },
  {
    id: 'drill',
    genre: 'Trap & drill',
    name: 'UK drill',
    bpm: 142,
    swing: 52,
    about: 'Snares on beat 3 and late in the bar, gliding kicks, triplet-flavoured hats.',
    parts: {
      kick: [b('X.....x...x.....', '..x...x.......x.'), b('X.........x..x..', 'X.....x.....x...')],
      snare: [b('........X.......', '........X..x....'), b('........X.....g.', '........X..x..g.')],
      hat: ['x..x..x.x.x..x..', 'x..x..x.x..rx.x.'],
      rim: ['...o.......o....'],
    },
  },
  {
    id: 'phonk',
    genre: 'Trap & drill',
    name: 'Phonk',
    bpm: 135,
    swing: 50,
    about: 'Memphis-style cowbell over trap kicks and a half-time snare.',
    parts: {
      kick: ['X......x..X.....', 'X..x......x..x..'],
      snare: ['........X.......'],
      cowbell: ['x..x..x...x..x..', 'x..x..x.x.x..x..'],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },

  // --- R&B ---
  {
    id: 'rnb',
    genre: 'R&B & soul',
    name: 'Modern R&B',
    bpm: 72,
    swing: 56,
    about: 'Slow, laid-back groove with snaps on 2 and 4 and fast hats.',
    parts: {
      kick: ['X......x..X..x..', 'X.....x...X.....'],
      clap: ['....X.......X...'],
      hat: ['x.x.x.xrx.x.x.x.', 'x.xxx.x.x.xxx.x.'],
      rim: ['.......o......o.'],
    },
  },
  {
    id: 'neosoul',
    genre: 'R&B & soul',
    name: 'Neo-soul',
    bpm: 85,
    swing: 63,
    about: 'Loose, behind-the-beat feel with a ghosted snare and rim clicks.',
    parts: {
      kick: [b('X.....x..x......', 'X......x..x...o.')],
      snare: ['....X..g....X..g'],
      rim: ['..o.....o.....o.'],
      hat: ['x.x.x.x.x.x.x.x.'],
      shaker: ['.g.g.g.g.g.g.g.g'],
    },
  },

  // --- Pop and disco ---
  {
    id: 'pop',
    genre: 'Pop & disco',
    name: 'Pop',
    bpm: 112,
    swing: 50,
    about: 'Simple, solid: kick on 1 and 3 with pushes, snare and clap on 2 and 4.',
    parts: {
      kick: ['X.....x.X.......', 'X.......X.x.....'],
      snare: ['....X.......X...'],
      clap: ['....o.......o...'],
      hat: ['x.x.x.x.x.x.x.x.'],
      shaker: ['.g.g.g.g.g.g.g.g'],
    },
  },
  {
    id: 'disco',
    genre: 'Pop & disco',
    name: 'Disco',
    bpm: 118,
    swing: 50,
    about: 'Four-on-the-floor with open hats on every offbeat and busy 16th hats.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['xx.xxx.xxx.xxx.x'],
      conga: ['...o...o..o...o.'],
    },
  },
  {
    id: 'synthpop',
    genre: 'Pop & disco',
    name: '80s synth-pop',
    bpm: 120,
    swing: 50,
    about: 'Drum-machine pop: big snare on 2 and 4, straight 8th hats, tom accents.',
    parts: {
      kick: ['X.......X.x.....', 'X.....x.X.......'],
      snare: ['....X.......X...'],
      hat: ['x.x.x.x.x.x.x.x.'],
      tomlow: [b('................', '.............o..')],
      tommid: [b('................', '..............o.')],
    },
  },

  // --- Funk ---
  {
    id: 'funk',
    genre: 'Funk',
    name: 'Funk',
    bpm: 100,
    swing: 56,
    about: 'Syncopated 16th kicks, ghost notes around the backbeat, 16th hats.',
    parts: {
      kick: ['X..x..x...x..x..', 'X.x...x...x.x...', 'X..x...x..x.....'],
      snare: ['....X..g.g..X..g', '....X..g.g.gX...'],
      hat: ['xgxgxgxgxgxgxgxg'],
      openhat: ['..............o.', '......o.......o.'],
      cowbell: ['o...o...o...o...'],
    },
  },
  {
    id: 'gogo',
    genre: 'Funk',
    name: 'Go-go',
    bpm: 95,
    swing: 58,
    about: 'Swung pocket with congas and cowbell carrying the groove.',
    parts: {
      kick: ['X......x..x.....'],
      snare: ['....X..g....X...'],
      conga: ['..x.x..x..x.x..x'],
      cowbell: ['x...x..x..x.x...'],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },

  // --- Rock and metal ---
  {
    id: 'rock',
    genre: 'Rock & metal',
    name: 'Rock',
    bpm: 120,
    swing: 50,
    about: 'The backbone rock beat: 8th hats, kick on 1 and 3 with pushes, snare on 2 and 4.',
    parts: {
      kick: ['X.....x.X.......', 'X.......X.x.....', 'X.....x.X.x.....'],
      snare: ['....X.......X..g', '....X.......X...'],
      hat: ['x.x.x.x.x.x.x.x.'],
      crash: [b('o...............', '................')],
    },
  },
  {
    id: 'rock-halftime',
    genre: 'Rock & metal',
    name: 'Half-time rock',
    bpm: 140,
    swing: 50,
    about: 'Heavy and wide: snare only on beat 3, ride or open hat on quarters.',
    parts: {
      kick: ['X.....x...x.....', 'X.........x..x..'],
      snare: ['........X.......'],
      ride: ['x...x...x...x...'],
      crash: [b('o...............', '................')],
    },
  },
  {
    id: 'punk',
    genre: 'Rock & metal',
    name: 'Punk',
    bpm: 180,
    swing: 50,
    about: 'Fast and driving: kick and snare trade 8ths under crashing hats.',
    parts: {
      kick: ['X.......X.......', 'X.....x.X.......'],
      snare: ['....X.......X...'],
      hat: ['x.x.x.x.x.x.x.x.'],
      crash: ['o...............'],
    },
  },
  {
    id: 'metal',
    genre: 'Rock & metal',
    name: 'Metal double kick',
    bpm: 160,
    swing: 50,
    about: 'Continuous 16th double-kick under a snare on 2 and 4.',
    parts: {
      kick: ['XxxxXxxxXxxxXxxx'],
      snare: ['....X.......X...'],
      ride: ['x...x...x...x...'],
      crash: [b('x...............', '................')],
    },
  },

  // --- Reggae and dancehall ---
  {
    id: 'reggae-onedrop',
    genre: 'Reggae & dancehall',
    name: 'One drop',
    bpm: 76,
    swing: 58,
    about: 'Nothing on the one: kick and rim land together on beat 3.',
    parts: {
      kick: ['........X.......'],
      rim: ['........X.......'],
      hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'],
      openhat: ['..............o.'],
    },
  },
  {
    id: 'reggae-rockers',
    genre: 'Reggae & dancehall',
    name: 'Rockers',
    bpm: 80,
    swing: 56,
    about: 'Kick on 1 and 3, rim on 3, a busier, pushing reggae beat.',
    parts: {
      kick: ['X.......X.......'],
      rim: ['........X.......'],
      snare: ['....o.......o...'],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },
  {
    id: 'reggae-steppers',
    genre: 'Reggae & dancehall',
    name: 'Steppers',
    bpm: 140,
    swing: 50,
    about: 'Kick on every beat with the snare on 3, the dub and roots dance beat.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['........X.......'],
      hat: ['..x...x...x...x.'],
      rim: ['......o.......o.'],
    },
  },
  {
    id: 'dancehall',
    genre: 'Reggae & dancehall',
    name: 'Dancehall',
    bpm: 100,
    swing: 50,
    about: 'Kick on 1 and 3 with the 3-3-2 snare accents.',
    parts: {
      kick: ['X.......X.......', 'X..x....X.......'],
      snare: ['...X..X....X..X.', '...x..X.....X...'],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },
  {
    id: 'reggaeton',
    genre: 'Reggae & dancehall',
    name: 'Reggaeton (dembow)',
    bpm: 95,
    swing: 50,
    about: 'Kick on every beat and the dembow snare: 3-3-2 in each half bar.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['...x..x....x..x.'],
      hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'],
      shaker: ['.g.g.g.g.g.g.g.g'],
      clave: ['...o..o....o..o.'],
    },
  },

  // --- African ---
  {
    id: 'afrobeats',
    genre: 'African',
    name: 'Afrobeats',
    bpm: 108,
    swing: 54,
    about: 'Bouncing kick, 3-3-2 rim, clave and a pushing shaker.',
    parts: {
      kick: ['X..x..x...x.X...', 'X...X..x..x.X...'],
      rim: ['..x..x....x..x..'],
      clave: [b('x..x..x...x.x...', '..x.x...x..x..x.')],
      shaker: ['XgxgXgxgXgxgXgxg'],
      conga: ['....o..o.o....o.'],
      clap: ['....o.......X...'],
    },
  },
  {
    id: 'amapiano',
    genre: 'African',
    name: 'Amapiano',
    bpm: 112,
    swing: 56,
    about: 'Steady, soft kick, constant shaker and syncopated rims and claps.',
    parts: {
      kick: ['X...X...X...X...', 'X.......X.......'],
      shaker: ['xxxxxxxxxxxxxxxx'],
      rim: ['...x..x...x..x..'],
      clap: ['....X.......X...'],
      hat: ['..o...o...o...o.'],
    },
  },
  {
    id: 'afrohouse',
    genre: 'African',
    name: 'Afro house',
    bpm: 122,
    swing: 54,
    about: 'Four-on-the-floor with rolling congas and a bell pattern.',
    parts: {
      kick: ['X...X...X...X...'],
      clap: ['....o.......X...'],
      conga: ['..x.x.xx..x.x.xx', '.xx..x.x.xx..x.x'],
      cowbell: ['x.x..x.x.x..x.x.'],
      shaker: ['gxgxgxgxgxgxgxgx'],
    },
  },

  // --- Latin ---
  {
    id: 'bossa',
    genre: 'Latin',
    name: 'Bossa nova',
    bpm: 140,
    swing: 50,
    about: 'Soft kick on the dotted pulse, cross-stick on a two-bar clave, 8th hats.',
    parts: {
      kick: ['X..xX..xX..xX..x'],
      rim: [b('x..x..x...x..x..', '..x..x..x..x....')],
      hat: ['x.x.x.x.x.x.x.x.'],
    },
  },
  {
    id: 'samba',
    genre: 'Latin',
    name: 'Samba',
    bpm: 100,
    swing: 50,
    about: 'Driving surdo-style kick on the and-of-each-beat, busy 16th shakers and agogo bell.',
    parts: {
      kick: ['X..xX..xX..xX..x'],
      shaker: ['XxxxXxxxXxxxXxxx'],
      cowbell: [b('x.x..x.x..x.x...', 'x.x..x.x.x..x...')],
      tomlow: ['....x.......x...'],
      snare: ['..g...g...g...g.'],
    },
  },
  {
    id: 'cumbia',
    genre: 'Latin',
    name: 'Cumbia',
    bpm: 95,
    swing: 50,
    about: 'Kick on 1 and 3, offbeat hats, and the shaker-and-guiro chug.',
    parts: {
      kick: ['X.......X.......'],
      rim: ['....x.......x...'],
      openhat: ['..x...x...x...x.'],
      shaker: ['x.xxx.xxx.xxx.xx'],
      conga: ['......o.......o.'],
    },
  },
  {
    id: 'salsa',
    genre: 'Latin',
    name: 'Salsa (clave)',
    bpm: 180,
    swing: 50,
    about: 'Son clave 3-2 with cascara on the cowbell and conga tumbao.',
    parts: {
      clave: [b('x..x..x.........', '....x...x.......')],
      cowbell: [b('x.x.xx.x.xx.x.x.', 'x.xx.x.xx.x.xx.x')],
      conga: ['......x.......x.', '....g.x.....g.x.'],
      kick: ['......x.......x.'],
    },
  },

  // --- Jazz and blues ---
  {
    id: 'jazz-swing',
    genre: 'Jazz & blues',
    name: 'Jazz swing',
    bpm: 140,
    swing: 50,
    about: 'Ride "ding, ding-a ding" with triplet swing, hat foot on 2 and 4, feathered kick.',
    parts: {
      ride: ['x...x..tx...x..t'],
      hat: ['....x.......x...'],
      kick: ['g...g...g...g...'],
      snare: [b('.......g........', '...........g...g')],
    },
  },
  {
    id: 'blues-shuffle',
    genre: 'Jazz & blues',
    name: 'Shuffle',
    bpm: 110,
    swing: 50,
    about: 'Triplet shuffle on the hats, kick on 1 and 3, snare on 2 and 4.',
    parts: {
      hat: ['x..tx..tx..tx..t'],
      kick: ['X.......X.......', 'X......tX.......'],
      snare: ['....X.......X...', '....X......gX...'],
    },
  },

  // --- UK and breaks ---
  {
    id: 'garage-2step',
    genre: 'UK garage & dubstep',
    name: '2-step garage',
    bpm: 132,
    swing: 62,
    about: 'Skippy kicks that miss beat 3, heavily swung hats.',
    parts: {
      kick: ['X.........X.....', 'X......x..X.....', 'X.........x..o..'],
      snare: ['....X.......X...'],
      hat: ['g.x.g.x.g.x.g.x.', 'g.xgg.x.g.xgg.x.'],
      rim: ['.......o.......o'],
      shaker: ['.g.g.g.g.g.g.g.g'],
    },
  },
  {
    id: 'garage-speed',
    genre: 'UK garage & dubstep',
    name: 'Speed garage',
    bpm: 135,
    swing: 58,
    about: 'Four-on-the-floor garage with offbeat open hats and swung shuffle.',
    parts: {
      kick: ['X...X...X...X...'],
      snare: ['....X.......X...'],
      openhat: ['..x...x...x...x.'],
      hat: ['.g.g.g.g.g.g.g.g'],
      rim: ['.......o......o.'],
    },
  },
  {
    id: 'dubstep',
    genre: 'UK garage & dubstep',
    name: 'Dubstep',
    bpm: 140,
    swing: 50,
    about: 'Half-time: kick on 1, big snare on 3, sparse syncopated hats.',
    parts: {
      kick: [b('X.........X.....', 'X......x........'), 'X...........x...'],
      snare: ['........X.......'],
      hat: ['x.x...x.x.x...x.', 'x.x.x.x.x.x.x.x.'],
      openhat: [b('................', '......o.........')],
    },
  },
  {
    id: 'breakbeat',
    genre: 'Breakbeat',
    name: 'Breakbeat',
    bpm: 130,
    swing: 52,
    about: 'Funky, broken kick against a ghosted backbeat.',
    parts: {
      kick: ['X.x.......xx....', 'X.x.......x..x..'],
      snare: ['....X..o.o..X..o', '....X.....g.X..g'],
      hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'],
      openhat: ['..............o.'],
    },
  },
  {
    id: 'bigbeat',
    genre: 'Breakbeat',
    name: 'Big beat',
    bpm: 110,
    swing: 54,
    about: 'Fat breaks at mid tempo with a crunchy, layered backbeat.',
    parts: {
      kick: ['X......xX.x.....', 'X.x...x...x.....'],
      snare: ['....X.......X...'],
      clap: ['....o.......o...'],
      hat: ['x.xxx.xxx.xxx.xx'],
    },
  },
  {
    id: 'footwork',
    genre: 'Breakbeat',
    name: 'Footwork / juke',
    bpm: 160,
    swing: 50,
    about: 'Triplet-pulse kicks against a sparse clap on 2 and 4.',
    parts: {
      kick: ['X..X..X...X..X..', 'X..X..X.X..X..X.'],
      clap: ['....X.......X...'],
      hat: ['..x...x...x...x.'],
      rim: ['.......o.......o'],
    },
  },
];

export const GENRES: string[] = [...new Set(STYLES.map((s) => s.genre))];
