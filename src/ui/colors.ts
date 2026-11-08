// One colour per track, so a lit step shows which drum it is. The order follows
// the factory kit: kicks red, snares and claps orange and amber, hats yellow-green,
// toms violet, percussion teal, cymbals blue. Tracks keep their colour whatever
// sound is put on them.
const TRACK_COLORS = [
  '#ff5a4f', // kick
  '#e5484d', // sub kick
  '#ff9f43', // snare
  '#f7b733', // clap
  '#e8c547', // rim
  '#c6e04b', // closed hat
  '#8fd14f', // open hat
  '#b07cf7', // low tom
  '#9a6cf0', // mid tom
  '#c58af9', // high tom
  '#2ec4b6', // cowbell
  '#3dd6c4', // clave
  '#5ed0a0', // shaker
  '#4ea8ff', // crash
  '#6fb7ff', // ride
  '#f36fb4', // conga
];

export const trackColor = (index: number) => TRACK_COLORS[((index % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length];
