// Infinity Castle — the chapters. One loop of the fall is a fixed run of places, each a band of depth in the
// castle: the shape of the open space, how fast you fall, the shots the camera takes. Depth 0 is the floor of
// the first room; the title and the drop take the first LEAD metres, once, and the loop repeats below that.

export const INTRO_Y = 30;      // the floor of the Ubuyashiki room, in world y
export const LEAD = 100;        // depth of the title and the drop, before the first loop

// the camera's shots: where it looks (pitch), how fast it turns (rate), its roll, how long it holds
export const SHOTS = [
  { pitch: -1.12, rate: 0.1, roll: 0.0, dur: 12 },               // 0 down and ahead: the open space below
  { pitch: -0.36, rate: 0.07, roll: 0.06, dur: 10 },             // 1 across, at the walls rushing up
  { pitch: -1.5, rate: 0.42, roll: 0.0, dur: 9 },                // 2 straight down and turning
  { pitch: 0.82, rate: -0.05, roll: -0.05, dur: 8 },             // 3 back up at what is already gone
  { pitch: -0.85, rate: 0.03, roll: 0.0, dur: 8, tumble: true }, // 4 head over heels, once
  { pitch: -0.3, rate: 0.05, roll: 0.03, dur: 10 },              // 5 level, at the balconies all round
  { pitch: -1.1, rate: 0.03, roll: 0.0, dur: 20 },               // 6 slowly down into the void
  { pitch: -0.05, rate: 0.0, roll: 0.0, dur: 30 },               // 7 level and still: someone is there
];

// open: the shape of the open space (see Castle.openRow); cut: how long the shots hold (1 = their own length);
// strike: seconds between refolds; ease: the speed runs down from the last chapter's to this one's
export const CHAPTERS = [
  { id: 'canyon', jp: '格子谷', name: 'Lattice canyon', len: 480, speed: 16, open: 'canyon', shots: [0, 1, 0, 3, 1], cut: 1 },
  { id: 'well', jp: '階段井', name: 'Square stairwell', len: 420, speed: 14, open: 'well', shots: [2], cut: 1 },
  { id: 'atrium', jp: '吹抜', name: 'Atrium', len: 300, speed: 10, open: 'atrium', shots: [5, 5, 4], cut: 1 },
  { id: 'refold', jp: '変転', name: 'Refold', len: 660, speed: 22, open: 'canyon', shots: [0, 1, 2, 3, 1, 0], cut: 0.35, strike: 2.6, debris: true },
  { id: 'void', jp: '紅輪', name: 'Red ring and void', len: 270, speed: 9, open: 'void', shots: [3, 6], cut: 1 },
  { id: 'nakime', jp: '鳴女', name: 'Nakime', len: 90, speed: 2, open: 'void', shots: [7], cut: 1, ease: 9 },
];
let acc = 0;
for (const c of CHAPTERS) { c.from = acc; acc += c.len; }
export const LOOP = acc;

// the chapter at a depth: which one, how far through it (u, 0..1), which loop
export function chapterAt(d) {
  if (d < LEAD) return { ch: CHAPTERS[0], i: 0, u: 0, loop: -1, lead: true };
  const t = d - LEAD, loop = Math.floor(t / LOOP), r = t - loop * LOOP;
  let i = CHAPTERS.length - 1;
  while (i > 0 && CHAPTERS[i].from > r) i--;
  const ch = CHAPTERS[i];
  return { ch, i, u: (r - ch.from) / ch.len, loop, lead: false };
}

// how much the line of the fall wanders at a depth: fully in the canyons, not at all in the well, the atria and
// the void, which are centred on a cell; it eases in and out over the first and last 40 m of a canyon
export function wanderAt(d) {
  const at = chapterAt(d);
  if (at.lead || at.ch.open !== 'canyon') return 0;
  const m = at.u * at.ch.len, rest = at.ch.len - m;
  const s = (x) => { const k = Math.min(1, Math.max(0, x / 40)); return k * k * (3 - 2 * k); };
  return s(m) * s(rest);
}
