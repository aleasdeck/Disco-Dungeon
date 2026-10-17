// Three disco tunes for the dungeon, each a loop of 24 bars.
import * as Synth from './synth.js';
const { n, mtof } = Synth;

/** Seeded randomness so a render comes out the same every time. */
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Time of a sixteenth `step` in bar `bar`, with a touch of swing on the off sixteenths. */
function clock(bpm, swing, t0) {
  const s16 = 60 / bpm / 4;
  return (bar, step) => t0 + (bar * 16 + step) * s16 + (Math.floor(step) % 2 === 1 ? swing * s16 : 0);
}

/** Play a line of [step, note, len16, vel?] in a bar. */
function line(T, s16, bar, notes, play) {
  for (const [st, nt, len, vel = 1] of notes) play(T(bar, st), mtof(n(nt)), len * s16, vel);
}

// ---------------------------------------------------------------------------------------------
// 1. Funk disco of the 70s: strings, chicken-scratch guitar, octave bass, brass.

const FUNK_CH = {
  Am7: { r: 'A1', pad: ['C4', 'E4', 'G4', 'B4'], g: ['G4', 'C5', 'E5'] },
  D9: { r: 'D2', pad: ['C4', 'E4', 'F#4', 'A4'], g: ['F#4', 'C5', 'E5'] },
  Fmaj7: { r: 'F1', pad: ['C4', 'E4', 'F4', 'A4'], g: ['A4', 'C5', 'E5'] },
  Em7: { r: 'E1', pad: ['B3', 'D4', 'E4', 'G4'], g: ['G4', 'B4', 'D5'] },
  Dm7: { r: 'D2', pad: ['C4', 'D4', 'F4', 'A4'], g: ['F4', 'A4', 'C5'] },
  G7: { r: 'G1', pad: ['B3', 'D4', 'F4', 'G4'], g: ['F4', 'B4', 'D5'] },
  E7s9: { r: 'E1', pad: ['G#3', 'D4', 'G4', 'B4'], g: ['G#4', 'D5', 'G5'] },
};
const FUNK_BARS = [
  'Am7', 'D9', 'Am7', 'D9', 'Am7', 'D9', 'Am7', 'D9',
  'Fmaj7', 'Em7', 'Dm7', 'G7', 'Fmaj7', 'Em7', 'Dm7', 'E7s9',
  'Am7', 'D9', 'Am7', 'D9', 'Am7', 'D9', 'Am7', 'D9',
];
const HOOK_X = [[0, 'E5', 2], [2, 'G5', 2], [4, 'A5', 3], [7, 'G5', 1], [8, 'E5', 2], [10, 'D5', 2], [12, 'E5', 4]];
const HOOK_Y = [[0, 'F#5', 2], [2, 'E5', 2], [4, 'D5', 2], [6, 'C5', 2], [8, 'D5', 4], [12, 'A4', 2], [14, 'C5', 2]];
const HOOK_Y2 = [[0, 'F#5', 2], [2, 'E5', 2], [4, 'D5', 2], [6, 'C5', 2], [8, 'D5', 2], [10, 'E5', 2], [12, 'F#5', 2], [14, 'G5', 2]];
const FUNK_B = [
  [[0, 'C6', 3], [3, 'A5', 3], [6, 'G5', 2], [8, 'A5', 8]],
  [[0, 'B5', 3], [3, 'G5', 3], [6, 'E5', 2], [8, 'G5', 8]],
  [[0, 'A5', 3], [3, 'F5', 3], [6, 'D5', 2], [8, 'F5', 4], [12, 'E5', 2], [14, 'F5', 2]],
  [[0, 'G5', 10], [12, 'A5', 2], [14, 'B5', 2]],
  [[0, 'C6', 3], [3, 'A5', 3], [6, 'G5', 2], [8, 'A5', 8]],
  [[0, 'B5', 3], [3, 'G5', 3], [6, 'E5', 2], [8, 'G5', 8]],
  [[0, 'A5', 3], [3, 'F5', 3], [6, 'D5', 2], [8, 'A5', 4], [12, 'B5', 2], [14, 'C6', 2]],
  [[0, 'B5', 8], [8, 'G#5', 8]],
];

function funk(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0.06, t0), R = rng(7);
  const hum = () => 0.9 + R() * 0.2;
  const kickC = mix.channel('kick', { vol: 0.95 });
  const clapC = mix.channel('clap', { vol: 2.4, rev: 0.25 });
  const snC = mix.channel('snare', { vol: 0.67, rev: 0.2 });
  const hatC = mix.channel('hat', { vol: 0.8, pan: 0.2 });
  const tamC = mix.channel('tamb', { vol: 0.7, pan: -0.35 });
  const bassC = mix.channel('bass', { vol: 0.36 });
  const gtrC = mix.channel('gtr', { vol: 4, pan: 0.38, rev: 0.08 });
  const strC = mix.channel('str', { vol: 0.5, rev: 0.4, hp: 180 });
  const hookC = mix.channel('hook', { vol: 1.05, rev: 0.4, dly: 0.08, hp: 200 });
  const epC = mix.channel('ep', { vol: 0.13, pan: -0.3, rev: 0.2 });
  const brC = mix.channel('brass', { vol: 0.85, rev: 0.2, pan: -0.1 });
  const synC = mix.channel('syn', { vol: 0.35, rev: 0.3, dly: 0.2 });

  FUNK_BARS.forEach((name, bar) => {
    const c = FUNK_CH[name], r = n(c.r), sec = bar < 8 ? 'A' : bar < 16 ? 'B' : 'C';
    // drums
    for (const st of [0, 4, 8, 12]) S.kick(mix, kickC, T(bar, st), 1);
    const fill = bar === 7 || bar === 23;
    for (const st of [4, 12]) { S.clap(mix, clapC, T(bar, st), 1); S.snare(mix, snC, T(bar, st), 0.9); }
    if (fill) for (const st of [13, 14, 15]) S.snare(mix, snC, T(bar, st), 0.5 + 0.15 * (st - 12));
    for (let st = 0; st < 16; st++) {
      if (st % 4 === 2) S.hat(mix, hatC, T(bar, st), 0.75, { open: true });
      else S.hat(mix, hatC, T(bar, st), (st % 4 === 0 ? 0.55 : 0.32) * hum());
    }
    for (const st of [4, 12]) S.tamb(mix, tamC, T(bar, st), 0.9);
    if (sec === 'B') for (let st = 1; st < 16; st += 2) S.shaker(mix, tamC, T(bar, st), 0.5 * hum());
    // bass: disco octaves, a walk back to the root at the end of every second bar
    const pat = [[0, 0, 1.6, 1], [2, 12, 1, 0.85], [4, 0, 1.6, 0.95], [6, 12, 1, 0.85], [8, 0, 1.6, 0.95], [10, 12, 1, 0.85]];
    const end = bar % 2 ? [[12, 0, 0.8, 0.9], [13, 12, 0.8, 0.8], [14, 10, 0.8, 0.85], [15, 7, 0.8, 0.8]] : [[12, 0, 1.6, 0.95], [14, 12, 1, 0.85]];
    for (const [st, iv, len, v] of [...pat, ...end]) S.bass(mix, bassC, T(bar, st), mtof(r + iv), len * s16, v * hum());
    // guitar in A and A': sixteenths, chords on the offbeats, scratches between
    if (sec !== 'B') for (let st = 0; st < 16; st++) {
      const hit = [2, 3, 6, 10, 11, 14].includes(st);
      S.guitar(mix, gtrC, T(bar, st), c.g, (hit ? 0.8 : 0.35) * hum(), { mute: !hit, wah: hit ? 1700 : 1100 });
    }
    // strings: long chords in A, the melody in B and A'
    if (sec === 'A') for (const m of c.pad) S.strings(mix, strC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.05, 0.55);
    else for (const m of c.pad) S.strings(mix, strC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.05, 0.28);
    const mel = sec === 'B' ? FUNK_B[bar - 8] : sec === 'C' ? (bar % 2 === 0 ? HOOK_X : bar === 23 ? HOOK_Y2 : HOOK_Y) : null;
    if (mel) {
      line(T, s16, bar, mel, (t, f, len, v) => {
        S.strings(mix, hookC, t, f, len * 0.95, 0.75 * v, { a: 0.03, r: 0.2, cut: 4200 });
        S.strings(mix, hookC, t, f * 2, len * 0.95, 0.3 * v, { a: 0.03, r: 0.2, cut: 6000, voices: 2 });
      });
    }
    // electric piano comping in B
    if (sec === 'B') for (const [st, len] of [[0, 3], [6, 2], [10, 4]]) for (const m of c.pad) S.epiano(mix, epC, T(bar, st), mtof(n(m)), len * s16, 0.7 * hum());
    // brass: stabs that push into the next bar in B, answers to the hook in A'
    if (sec === 'B' && [9, 11, 13].includes(bar)) {
      const nx = FUNK_CH[FUNK_BARS[bar + 1]];
      for (const m of nx.pad) S.brass(mix, brC, T(bar, 14), mtof(n(m)), 1.5 * s16, 0.85);
    }
    if (bar === 15) for (const st of [0, 3, 6]) for (const m of c.pad) S.brass(mix, brC, T(bar, st), mtof(n(m)), 1.2 * s16, 0.9);
    if (sec === 'C' && bar % 2 === 1 && bar !== 23) for (const st of [12, 14]) for (const m of c.pad) S.brass(mix, brC, T(bar, st), mtof(n(m) + 12), (st === 12 ? 1 : 2) * s16, 0.7);
    // string runs into each section, a fall out of B
    if (bar === 7 || bar === 23) S.stringRun(mix, hookC, T(bar, 12), ['A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5', 'A5'], s16 / 2, 0.8);
    if (bar === 15) S.stringRun(mix, hookC, T(bar, 12), ['E6', 'D6', 'B5', 'A5', 'G#5', 'F5', 'E5', 'D5'], s16 / 2, 0.7);
    // syndrums
    if (bar === 15) for (const [st, f] of [[8, 900], [10, 700]]) S.syndrum(mix, synC, T(bar, st), 0.8, { f0: f });
    if (bar === 23) for (const [st, f] of [[12, 1000], [13, 850], [14, 700], [15, 560]]) S.syndrum(mix, synC, T(bar, st), 0.8, { f0: f, dec: 0.3 });
    mix.pump(T(bar, 0));
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Monster disco: organ, harpsichord, theremin and a xylophone of bones, in D minor.

const MON_CH = {
  Dm: { r: 'D2', pad: ['A3', 'D4', 'F4'], arp: ['D4', 'F4', 'A4', 'D5'] },
  Bb: { r: 'Bb1', pad: ['Bb3', 'D4', 'F4'], arp: ['Bb3', 'D4', 'F4', 'Bb4'] },
  A7: { r: 'A1', pad: ['C#4', 'E4', 'G4'], arp: ['A3', 'C#4', 'E4', 'G4'] },
  Gm: { r: 'G1', pad: ['Bb3', 'D4', 'G4'], arp: ['G3', 'Bb3', 'D4', 'G4'] },
  E7b9: { r: 'E1', pad: ['G#3', 'D4', 'F4'], arp: ['G#3', 'B3', 'D4', 'F4'] },
};
const MON_BARS = [
  'Dm', 'Dm', 'Bb', 'A7', 'Dm', 'Dm', 'Bb', 'A7',
  'Gm', 'Dm', 'Gm', 'A7', 'Bb', 'Gm', 'E7b9', 'A7',
  'Dm', 'Dm', 'Bb', 'A7', 'Gm', 'Bb', 'A7', 'A7',
];
const MON_MEL = {
  8: [[0, 'D5', 6], [6, 'Bb4', 2], [8, 'G4', 4], [12, 'A4', 2], [14, 'Bb4', 2]],
  9: [[0, 'A4', 8], [8, 'F4', 4], [12, 'E4', 2], [14, 'F4', 2]],
  10: [[0, 'G4', 6], [6, 'Bb4', 2], [8, 'D5', 4], [12, 'C#5', 2], [14, 'D5', 2]],
  11: [[0, 'E5', 8], [8, 'C#5', 4], [12, 'A4', 4]],
  12: [[0, 'F5', 6], [6, 'D5', 2], [8, 'Bb4', 4], [12, 'C5', 2], [14, 'D5', 2]],
  13: [[0, 'G5', 6], [6, 'F5', 2], [8, 'D5', 4], [12, 'Bb4', 4]],
  14: [[0, 'G#4', 4], [4, 'B4', 4], [8, 'D5', 4], [12, 'F5', 4]],
  15: [[0, 'E5', 10], [12, 'C#5', 4]],
  16: [[0, 'D5', 4], [4, 'F5', 4], [8, 'E5', 2], [10, 'D5', 2], [12, 'C#5', 2], [14, 'D5', 2]],
  17: [[0, 'A4', 11]],
  18: [[0, 'D5', 4], [4, 'F5', 4], [8, 'G5', 2], [10, 'F5', 2], [12, 'E5', 2], [14, 'D5', 2]],
  19: [[0, 'E5', 11]],
  20: [[0, 'G5', 4], [4, 'F5', 2], [6, 'E5', 2], [8, 'D5', 4], [12, 'Bb4', 4]],
  21: [[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'C#5', 4], [12, 'D5', 4]],
  22: [[0, 'E5', 8], [8, 'A4', 8]],
};
const BONES = {
  1: [[8, 'D5', 1], [9, 'F5', 1], [10, 'A5', 1], [11, 'F5', 1], [12, 'D5', 1], [14, 'A4', 1]],
  3: [[8, 'E5', 1], [9, 'G5', 1], [10, 'A5', 1], [11, 'G5', 1], [12, 'E5', 1], [13, 'C#5', 1], [14, 'A4', 1]],
  5: [[8, 'D5', 1], [9, 'F5', 1], [10, 'A5', 1], [11, 'F5', 1], [12, 'D5', 1], [14, 'A4', 1]],
  7: [[10, 'A4', 1], [11, 'Bb4', 1], [12, 'B4', 1], [13, 'C#5', 1], [14, 'D5', 1]],
  17: [[12, 'A5', 1], [13, 'G#5', 1], [14, 'A5', 1], [15, 'D6', 1]],
  19: [[12, 'C#6', 1], [13, 'D6', 1], [14, 'E6', 1], [15, 'A5', 1]],
  23: [[0, 'A5', 1], [1, 'G#5', 1], [2, 'G5', 1], [3, 'F#5', 1], [4, 'F5', 1], [5, 'E5', 1], [6, 'D#5', 1], [7, 'D5', 1]],
};

function monster(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0.1, t0), R = rng(11);
  const hum = () => 0.9 + R() * 0.2;
  const kickC = mix.channel('kick', { vol: 0.95 });
  const clapC = mix.channel('clap', { vol: 1.9, rev: 0.35 });
  const snC = mix.channel('snare', { vol: 0.58, rev: 0.25 });
  const hatC = mix.channel('hat', { vol: 0.88, pan: 0.25 });
  const shC = mix.channel('shaker', { vol: 0.53, pan: -0.3 });
  const bassC = mix.channel('bass', { vol: 0.38 });
  const orgC = mix.channel('organ', { vol: 0.2, pan: -0.2, rev: 0.3 });
  const hpC = mix.channel('harpsi', { vol: 0.63, pan: 0.35, rev: 0.25 });
  const thC = mix.channel('theremin', { vol: 0.22, rev: 0.5, dly: 0.18 });
  const xyC = mix.channel('bones', { vol: 0.8, pan: -0.25, rev: 0.25, dly: 0.12 });
  const chC = mix.channel('choir', { vol: 0.15, rev: 0.6 });
  const synC = mix.channel('syn', { vol: 0.35, rev: 0.4, dly: 0.25 });

  let prevMel = null;
  MON_BARS.forEach((name, bar) => {
    const c = MON_CH[name], r = n(c.r), sec = bar < 8 ? 'A' : bar < 16 ? 'B' : 'C';
    const next = MON_CH[MON_BARS[(bar + 1) % MON_BARS.length]], nr = n(next.r);
    for (const st of [0, 4, 8, 12]) S.kick(mix, kickC, T(bar, st), 1, { f1: 44 });
    for (const st of [4, 12]) { S.clap(mix, clapC, T(bar, st), 1); S.snare(mix, snC, T(bar, st), 0.8, { f: 170 }); }
    for (let st = 0; st < 16; st += 2) S.hat(mix, hatC, T(bar, st), st % 4 === 2 ? 0.8 : 0.4, { open: st % 4 === 2 });
    for (let st = 0; st < 16; st++) S.shaker(mix, shC, T(bar, st), (st % 2 ? 0.45 : 0.7) * hum());
    // bass: octaves that creep chromatically into the next chord
    const appr = nr === r ? r + 12 : (nr > r ? nr - 1 : nr + 1);
    const pat = [[0, r, 1.6, 1], [2, r + 12, 1, 0.8], [4, r, 1.6, 0.95], [6, r + 12, 1, 0.8], [8, r, 1.6, 0.95], [10, r + 12, 1, 0.8], [12, r, 1.6, 0.95], [14, appr, 1.5, 0.85]];
    for (const [st, m, len, v] of pat) S.tuba(mix, bassC, T(bar, st), mtof(m), len * s16, v * hum());
    // harpsichord sixteenths through the chord, up and down
    const ord = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
    const hv = sec === 'B' ? 0.55 : 0.8;
    if (bar !== 23) for (let st = 0; st < 16; st++) S.harpsi(mix, hpC, T(bar, st), mtof(n(c.arp[ord[st]])), s16, (st % 4 === 0 ? 1 : 0.7) * hv * hum());
    // organ: held chords in A, offbeat stabs in C
    if (sec === 'A') for (const m of c.pad) S.organ(mix, orgC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.03, 0.75);
    if (sec === 'C') for (const st of [2, 6, 10, 14]) for (const m of c.pad) S.organ(mix, orgC, T(bar, st), mtof(n(m)), 1.1 * s16, 0.8, { click: 0.25 });
    // a crypt choir under the theremin in B
    if (sec === 'B') for (const m of c.pad) S.choir(mix, chC, T(bar, 0), mtof(n(m) - 12), 16 * s16 - 0.05, 0.6);
    // theremin melody, sliding from note to note
    const mel = MON_MEL[bar];
    if (mel) for (const [st, nt, len] of mel) {
      const f = mtof(n(nt));
      S.theremin(mix, thC, T(bar, st), f, len * s16, 0.95, { from: prevMel ?? f * 0.94, slide: 0.05 });
      prevMel = f;
    } else prevMel = null;
    const bones = BONES[bar];
    if (bones) line(T, s16, bar, bones, (t, f, len, v) => S.xylo(mix, xyC, t, f, len, 0.9 * v));
    if (bar === 23) {
      for (const [st, f] of [[8, 900], [10, 760], [12, 640], [14, 520]]) S.syndrum(mix, synC, T(bar, st), 0.8, { f0: f, f1: 110 });
      for (const st of [12, 13, 14, 15]) S.snare(mix, snC, T(bar, st), 0.4 + 0.12 * (st - 12));
    }
    if (bar === 7 || bar === 15) S.syndrum(mix, synC, T(bar, 14), 0.8, { f0: 1100, f1: 120, dec: 0.6 });
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Euro disco of the 80s: octave bass in eighths, off-beat synth chords, a singing lead, toms.

const EURO_CH = {
  Em: { r: 'E2', pad: ['E4', 'G4', 'B4'] },
  C: { r: 'C2', pad: ['E4', 'G4', 'C5'] },
  D: { r: 'D2', pad: ['D4', 'F#4', 'A4'] },
  Bm: { r: 'B1', pad: ['D4', 'F#4', 'B4'] },
  B7: { r: 'B1', pad: ['D#4', 'F#4', 'A4', 'B4'] },
  Am: { r: 'A1', pad: ['E4', 'A4', 'C5'] },
  G: { r: 'G1', pad: ['D4', 'G4', 'B4'] },
};
const EURO_BARS = [
  'Em', 'C', 'D', 'Bm', 'Em', 'C', 'D', 'B7',
  'Am', 'D', 'G', 'Em', 'C', 'Am', 'B7', 'B7',
  'Em', 'C', 'D', 'Bm', 'Em', 'C', 'D', 'B7',
];
const EURO_MEL = {
  8: [[0, 'E5', 3], [3, 'E5', 3], [6, 'D5', 2], [8, 'C5', 2], [10, 'B4', 2], [12, 'C5', 4]],
  9: [[0, 'D5', 3], [3, 'D5', 3], [6, 'C5', 2], [8, 'B4', 2], [10, 'A4', 2], [12, 'B4', 4]],
  10: [[0, 'B4', 3], [3, 'D5', 3], [6, 'G5', 4], [10, 'F#5', 2], [12, 'E5', 2], [14, 'D5', 2]],
  11: [[0, 'E5', 8], [8, 'B4', 4], [12, 'D5', 2], [14, 'E5', 2]],
  12: [[0, 'G5', 3], [3, 'G5', 3], [6, 'E5', 2], [8, 'C5', 4], [12, 'E5', 4]],
  13: [[0, 'A5', 3], [3, 'G5', 3], [6, 'E5', 2], [8, 'C5', 4], [12, 'A4', 4]],
  14: [[0, 'B4', 3], [3, 'D#5', 3], [6, 'F#5', 2], [8, 'A5', 4], [12, 'F#5', 4]],
  15: [[0, 'D#5', 8], [8, 'B4', 4], [12, 'F#5', 2], [14, 'D#5', 2]],
  16: [[0, 'B4', 2], [2, 'E5', 2], [4, 'G5', 2], [6, 'F#5', 2], [8, 'E5', 4], [12, 'B4', 4]],
  17: [[0, 'C5', 2], [2, 'E5', 2], [4, 'G5', 2], [6, 'F#5', 2], [8, 'E5', 4], [12, 'C5', 4]],
  18: [[0, 'D5', 2], [2, 'F#5', 2], [4, 'A5', 2], [6, 'G5', 2], [8, 'F#5', 4], [12, 'D5', 4]],
  19: [[0, 'D5', 2], [2, 'F#5', 2], [4, 'B5', 4], [8, 'A5', 4], [12, 'F#5', 4]],
  20: [[0, 'B4', 2], [2, 'E5', 2], [4, 'G5', 2], [6, 'F#5', 2], [8, 'E5', 4], [12, 'B4', 4]],
  21: [[0, 'C5', 2], [2, 'E5', 2], [4, 'G5', 2], [6, 'F#5', 2], [8, 'E5', 4], [12, 'C5', 4]],
  22: [[0, 'D5', 2], [2, 'F#5', 2], [4, 'A5', 2], [6, 'G5', 2], [8, 'F#5', 4], [12, 'D5', 4]],
  23: [[0, 'D#5', 2], [2, 'F#5', 2], [4, 'A5', 2], [6, 'B5', 2], [8, 'A5', 2], [10, 'F#5', 2], [12, 'D#5', 4]],
};

function euro(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0, t0), R = rng(5);
  const hum = () => 0.92 + R() * 0.16;
  const kickC = mix.channel('kick', { vol: 1 });
  const clapC = mix.channel('clap', { vol: 1.9, rev: 0.45 });
  const snC = mix.channel('snare', { vol: 0.58, rev: 0.5 });
  const hatC = mix.channel('hat', { vol: 0.9, pan: 0.2 });
  const bassC = mix.channel('bass', { vol: 0.32 });
  const seqC = mix.channel('seq', { vol: 0.27, pan: -0.15, dly: 0.1 });
  const stabC = mix.channel('stab', { vol: 0.5, rev: 0.25, hp: 200, duck: 0.35 });
  const padC = mix.channel('pad', { vol: 0.4, rev: 0.4, hp: 220, duck: 0.4 });
  const leadC = mix.channel('lead', { vol: 0.7, rev: 0.35, dly: 0.22 });
  const bellC = mix.channel('bell', { vol: 0.6, rev: 0.5, dly: 0.2, pan: 0.3 });
  const tomC = mix.channel('tom', { vol: 0.55, rev: 0.4 });

  let prev = null;
  EURO_BARS.forEach((name, bar) => {
    const c = EURO_CH[name], r = n(c.r), sec = bar < 8 ? 'A' : bar < 16 ? 'B' : 'C';
    for (const st of [0, 4, 8, 12]) { S.kick(mix, kickC, T(bar, st), 1, { f0: 170, f1: 50, dec: 0.38 }); mix.pump(T(bar, st)); }
    for (const st of [4, 12]) { S.clap(mix, clapC, T(bar, st), 1, { tail: 0.25 }); S.snare(mix, snC, T(bar, st), 0.9, { f: 200, dec: 0.22 }); }
    for (let st = 0; st < 16; st++) {
      if (st % 4 === 2) S.hat(mix, hatC, T(bar, st), 0.8, { open: true, dec: 0.18 });
      else if (st % 2 === 1) S.hat(mix, hatC, T(bar, st), 0.3 * hum());
    }
    // bass: straight eighths, root and octave
    if (sec !== 'C') for (let st = 0; st < 16; st += 2) S.bass(mix, bassC, T(bar, st), mtof(r + (st % 4 ? 12 : 0)), 1.6 * s16, (st % 4 ? 0.85 : 1) * hum(), { cut: 450, env: 1200, q: 3 });
    else for (let st = 0; st < 16; st++) {
      // the sequencer bass takes over: root, octave, fifth, octave
      const iv = [0, 12, 7, 12][st % 4];
      S.seqBass(mix, seqC, T(bar, st), mtof(r + iv), 0.8 * s16, st % 4 === 0 ? 1 : 0.75);
    }
    if (sec === 'C') for (let st = 0; st < 16; st += 4) S.bass(mix, bassC, T(bar, st), mtof(r), 2 * s16, 0.8, { cut: 300, env: 500, q: 2 });
    // off-beat chords
    const sv = sec === 'B' ? 0.55 : 0.8;
    for (const st of [2, 6, 10, 14]) for (const m of c.pad) S.poly(mix, stabC, T(bar, st), mtof(n(m)), 1.3 * s16, sv * hum(), { cut: 2600 });
    // pads swell in B
    for (const m of c.pad) S.strings(mix, padC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.04, sec === 'B' ? 0.65 : 0.4, { a: 0.3, r: 0.6 });
    // the lead sings in B and C
    const mel = EURO_MEL[bar];
    if (mel) for (const [st, nt, len] of mel) {
      const f = mtof(n(nt));
      S.lead(mix, leadC, T(bar, st), f, len * s16 * 0.92, 0.9, { from: prev && Math.abs(Math.log2(prev / f)) < 0.6 ? prev : undefined });
      prev = f;
    }
    // bells on the downbeats of each phrase
    if (bar % 4 === 0) S.bell(mix, bellC, T(bar, 0), mtof(n(c.pad[c.pad.length - 1]) + 12), 1, 0.9);
    // tom fills
    if (bar === 7 || bar === 23) for (const [st, f] of [[12, 240], [13, 200], [14, 160], [15, 120]]) S.tom(mix, tomC, T(bar, st), 0.9, { f });
    if (bar === 15) {
      for (let st = 8; st < 16; st++) S.snare(mix, snC, T(bar, st), 0.35 + 0.06 * (st - 8), { f: 200, dec: 0.12 });
      for (const [st, f] of [[14, 180], [15, 130]]) S.tom(mix, tomC, T(bar, st), 1, { f });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Background disco: the funk band playing low and easy, for long fights. Slow chords, soft drums, no lead.

const LOW_CH = {
  Fmaj9: { r: 'F1', pad: ['A3', 'C4', 'E4', 'G4'], g: ['A4', 'C5', 'E5'] },
  Em7: { r: 'E1', pad: ['G3', 'B3', 'D4', 'E4'], g: ['G4', 'B4', 'D5'] },
  Dm9: { r: 'D2', pad: ['A3', 'C4', 'E4', 'F4'], g: ['F4', 'A4', 'C5'] },
  G13: { r: 'G1', pad: ['A3', 'B3', 'E4', 'F4'], g: ['F4', 'B4', 'E5'] },
  Bbmaj9: { r: 'Bb1', pad: ['D4', 'F4', 'A4', 'C5'], g: ['D5', 'F5', 'A5'] },
  Am7: { r: 'A1', pad: ['C4', 'E4', 'G4', 'A4'], g: ['C5', 'E5', 'G5'] },
  Gm9: { r: 'G1', pad: ['D4', 'F4', 'A4', 'Bb4'], g: ['Bb4', 'D5', 'F5'] },
  C13: { r: 'C2', pad: ['D4', 'E4', 'A4', 'Bb4'], g: ['Bb4', 'E5', 'A5'] },
};
const LOW_A = ['Fmaj9', 'Fmaj9', 'Em7', 'Em7', 'Dm9', 'Dm9', 'G13', 'G13'];
const LOW_B = ['Bbmaj9', 'Bbmaj9', 'Am7', 'Am7', 'Gm9', 'Gm9', 'C13', 'C13'];
// sections: A1 groove, A2 + guitar and the motif, B lifts a fourth, C breaks down, D the strings sing, E home again
const LOW_SEC = ['A1', 'A2', 'B', 'C', 'D', 'E'];
/** The motif over the A chords, two bars to each: a phrase that falls a step each time and leaves room. */
const LOW_MOTIF = [
  [[4, 'E5', 2], [6, 'G5', 2], [8, 'A5', 5]], [[0, 'G5', 6]],
  [[4, 'D5', 2], [6, 'E5', 2], [8, 'G5', 5]], [[0, 'E5', 6]],
  [[4, 'C5', 2], [6, 'D5', 2], [8, 'F5', 4]], [[0, 'E5', 4], [4, 'D5', 4]],
  [[4, 'B4', 2], [6, 'D5', 2], [8, 'E5', 6]], [],
];
/** Long string notes over the B chords in D. */
const LOW_LINE = [
  [[0, 'D5', 15]], [[0, 'C5', 8], [8, 'D5', 7]], [[0, 'E5', 15]], [[0, 'C5', 15]],
  [[0, 'D5', 15]], [[0, 'Bb4', 8], [8, 'A4', 7]], [[0, 'Bb4', 15]], [[0, 'A4', 8], [8, 'G4', 7]],
];

function lounge(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0.08, t0), R = rng(23);
  const hum = () => 0.88 + R() * 0.24;
  const kickC = mix.channel('kick', { vol: 0.7, lp: 4000 });
  const snC = mix.channel('snare', { vol: 1.27, rev: 0.3, lp: 7000 });
  const hatC = mix.channel('hat', { vol: 1.05, pan: 0.25, lp: 9000 });
  const shC = mix.channel('shaker', { vol: 0.56, pan: -0.3, lp: 8000 });
  const bassC = mix.channel('bass', { vol: 0.2 });
  const gtrC = mix.channel('gtr', { vol: 2.6, pan: 0.4, rev: 0.12, lp: 3500 });
  const epC = mix.channel('ep', { vol: 0.11, pan: -0.25, rev: 0.25 });
  const motC = mix.channel('motif', { vol: 0.2, pan: -0.15, rev: 0.3, dly: 0.12 });
  const vibC = mix.channel('vibes', { vol: 0.44, pan: 0.2, rev: 0.35, dly: 0.15 });
  const padC = mix.channel('pad', { vol: 0.35, rev: 0.45, hp: 200, lp: 3000 });
  const lineC = mix.channel('line', { vol: 0.7, rev: 0.45, hp: 220 });
  const synC = mix.channel('syn', { vol: 0.2, rev: 0.4, dly: 0.2 });

  LOW_SEC.forEach((sec, si) => {
    const prog = sec === 'B' || sec === 'D' ? LOW_B : LOW_A;
    prog.forEach((name, k) => {
      const bar = si * 8 + k, c = LOW_CH[name], r = n(c.r), second = k % 2 === 1;
      const nextName = k < 7 ? prog[k + 1] : (LOW_SEC[si + 1] === 'B' || LOW_SEC[si + 1] === 'D' ? LOW_B : LOW_A)[0];
      const brk = sec === 'C' && k < 4;
      // drums, soft: the kick sits out the start of the breakdown, the rim comes back two bars after it
      if (!brk) for (const st of [0, 4, 8, 12]) S.kick(mix, kickC, T(bar, st), 0.75, { f0: 120, f1: 50, dec: 0.3, click: 0.12 });
      if (!(sec === 'C' && k < 6)) for (const st of [4, 12]) S.snare(mix, snC, T(bar, st), 0.5 * hum(), { f: 230, tone: 0.7, dec: 0.09, snappy: 0.45 });
      for (let st = 0; st < 16; st++) {
        if (st % 4 === 2) S.hat(mix, hatC, T(bar, st), 0.45 * hum(), { open: true, dec: 0.14 });
        else if (!brk || st % 2 === 0) S.hat(mix, hatC, T(bar, st), (st % 4 === 0 ? 0.3 : 0.18) * hum());
      }
      if (sec !== 'A1') for (let st = 0; st < 16; st++) S.shaker(mix, shC, T(bar, st), (st % 2 ? 0.4 : 0.6) * hum(), { dec: 0.05 });
      // bass: relaxed octaves; long roots through the breakdown
      if (brk) S.bass(mix, bassC, T(bar, 0), mtof(r), (second ? 14 : 15) * s16, 0.8, { cut: 260, env: 300, q: 1.5 });
      else {
        const pat = [[0, 0, 2.5, 1], [3, 12, 0.8, 0.7], [4, 0, 1.5, 0.85], [6, 12, 1, 0.75], [8, 0, 2.5, 0.9], [11, 12, 0.8, 0.7], [12, 0, 1.5, 0.85]];
        const nr = n(LOW_CH[nextName].r);
        pat.push(second ? [14, nr > r ? nr - r - 1 : 7, 1.5, 0.75] : [14, 12, 1, 0.75]);
        for (const [st, iv, len, v] of pat) S.bass(mix, bassC, T(bar, st), mtof(r + iv), len * s16, v * hum(), { cut: 300, env: 700, q: 2, sub: 0.35 });
      }
      // electric piano: a chord on the one and an answer on the "and" of three
      if (sec !== 'C' || k >= 4) for (const [st, len, v] of [[0, 6, 0.7], [10, 5, 0.55]]) for (const m of c.pad) S.epiano(mix, epC, T(bar, st), mtof(n(m)), len * s16, v * hum(), { bright: 0.6 });
      // strings: a soft bed always, louder in the breakdown; the long line in D
      for (const m of c.pad) S.strings(mix, padC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.04, sec === 'C' ? 0.6 : 0.38, { a: 0.4, r: 0.8, cut: 2400 });
      if (sec === 'D') line(T, s16, bar, LOW_LINE[k], (t, f, len, v) => S.strings(mix, lineC, t, f, len, 0.6 * v, { a: 0.35, r: 0.6, cut: 3200 }));
      // guitar: quiet sixteenths in A2, D and E
      if (sec === 'A2' || sec === 'D' || sec === 'E') for (let st = 0; st < 16; st++) {
        const hit = [2, 6, 10, 14].includes(st);
        if (hit || st % 2 === 1) S.guitar(mix, gtrC, T(bar, st), c.g, (hit ? 0.7 : 0.25) * hum(), { mute: !hit, wah: hit ? 1200 : 900 });
      }
      // the motif: on the piano in A2, on vibes a fifth lower in B, sparse vibes in the breakdown, vibes in E
      const mot = LOW_MOTIF[k];
      if (sec === 'A2') line(T, s16, bar, mot, (t, f, len, v) => S.epiano(mix, motC, t, f, len, 0.8 * v, { bright: 0.8 }));
      if (sec === 'B') line(T, s16, bar, mot, (t, f, len, v) => S.vibes(mix, vibC, t, f * Math.pow(2, -7 / 12), len, 0.8 * v));
      if (sec === 'C' && k >= 4) line(T, s16, bar, mot, (t, f, len, v) => S.vibes(mix, vibC, t, f, len, 0.6 * v));
      if (sec === 'E') line(T, s16, bar, mot, (t, f, len, v) => S.vibes(mix, vibC, t, f, len, 0.75 * v));
      // a soft syndrum into the next section now and then
      if (k === 7 && (sec === 'A2' || sec === 'C' || sec === 'E')) S.syndrum(mix, synC, T(bar, 12), 0.6, { f0: 600, f1: 150, dec: 0.5 });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// 5. Battle funk: the 70s band in E minor at a run. A riff on the bass and the wah, horns that push, strings that tighten.

const BF_CH = {
  Em9: { r: 'E1', pad: ['G3', 'B3', 'D4', 'F#4'], g: ['G4', 'B4', 'D5'], ost: ['E5', 'E5', 'G5', 'E5', 'F#5', 'E5', 'D5', 'E5'] },
  A9: { r: 'A1', pad: ['G3', 'B3', 'C#4', 'E4'], g: ['G4', 'C#5', 'E5'], ost: ['E5', 'E5', 'G5', 'E5', 'F#5', 'E5', 'C#5', 'E5'] },
  Am9: { r: 'A1', pad: ['G3', 'B3', 'C4', 'E4'], g: ['G4', 'C5', 'E5'], ost: ['E5', 'E5', 'G5', 'E5', 'B4', 'E5', 'C5', 'E5'] },
  Cmaj7: { r: 'C2', pad: ['G3', 'B3', 'E4'], g: ['G4', 'B4', 'E5'], ost: ['E5', 'E5', 'G5', 'E5', 'B4', 'E5', 'G5', 'E5'] },
  B7s9: { r: 'B1', pad: ['D#4', 'A4', 'D5'], g: ['D#4', 'A4', 'D5'], ost: ['D#5', 'D#5', 'F#5', 'D#5', 'A5', 'F#5', 'D#5', 'B4'] },
};
// A the riff, B the strings tighten, C breaks down to bass and congas and builds, D everything with the horns calling
const BF_BARS = [
  'Em9', 'Em9', 'Em9', 'A9', 'Em9', 'Em9', 'Cmaj7', 'B7s9',
  'Am9', 'Am9', 'Em9', 'Em9', 'Am9', 'Am9', 'Cmaj7', 'B7s9',
  'Em9', 'Em9', 'Em9', 'Em9', 'Em9', 'Em9', 'Cmaj7', 'B7s9',
  'Em9', 'Em9', 'Em9', 'A9', 'Cmaj7', 'Cmaj7', 'B7s9', 'B7s9',
];
/** The bass riff over E and A: root, octave and the seventh, pushing on the sixteenths. [step, interval, len16, vel] */
const BF_RIFF = [[0, 0, 1.5, 1], [3, 12, 0.7, 0.8], [4, 0, 0.7, 0.85], [6, 10, 0.7, 0.8], [7, 12, 0.7, 0.8], [8, 0, 1.5, 0.95], [10, 7, 0.7, 0.8], [11, 10, 0.7, 0.8], [12, 0, 0.7, 0.9], [14, 12, 0.7, 0.85], [15, 10, 0.7, 0.8]];
const BF_OCT = [[0, 0, 1.5, 1], [2, 12, 0.7, 0.8], [4, 0, 1.5, 0.9], [6, 12, 0.7, 0.8], [8, 0, 1.5, 0.9], [10, 12, 0.7, 0.8], [12, 0, 1, 0.9], [14, 12, 0.7, 0.8]];
/** B7 walking up by semitones into E. */
const BF_WALK = [[0, 0, 1.5, 1], [2, 12, 0.7, 0.8], [4, 0, 1.5, 0.9], [6, 12, 0.7, 0.8], [8, 0, 1.5, 0.9], [10, 12, 0.7, 0.8], [12, 0, 0.7, 0.9], [13, 2, 0.7, 0.85], [14, 3, 0.7, 0.85], [15, 4, 0.7, 0.9]];
/** The strings of B in octaves, creeping by semitones. */
const BF_LINE = [[[0, 'B4', 15]], [[0, 'C5', 15]], [[0, 'B4', 15]], [[0, 'A#4', 15]], [[0, 'B4', 15]], [[0, 'C5', 15]], [[0, 'B4', 15]], [[0, 'A4', 8], [8, 'D#5', 7]]];
/** The horns' call in D. */
const BF_CALL = [[0, 'E4', 1.5], [2, 'E4', 1], [3, 'G4', 1.5], [6, 'E4', 1], [7, 'D4', 1], [8, 'E4', 3]];
/** Congas: [step, pitch, slap, vel]. */
const BF_CONGA = [[2, 330, true, 0.7], [3, 330, false, 0.5], [6, 220, false, 0.8], [7, 220, false, 0.5], [10, 330, true, 0.7], [11, 330, false, 0.5], [14, 220, false, 0.8], [15, 250, false, 0.6]];

function bfunk(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0.05, t0), R = rng(31);
  const hum = () => 0.9 + R() * 0.2;
  const kickC = mix.channel('kick', { vol: 0.95 });
  const clapC = mix.channel('clap', { vol: 2.1, rev: 0.25 });
  const snC = mix.channel('snare', { vol: 0.7, rev: 0.2 });
  const hatC = mix.channel('hat', { vol: 0.95, pan: 0.2, lp: 10000 });
  const tamC = mix.channel('tamb', { vol: 0.85, pan: -0.35 });
  const cgC = mix.channel('conga', { vol: 0.45, pan: -0.25, rev: 0.12 });
  const bassC = mix.channel('bass', { vol: 0.5 });
  const gtrC = mix.channel('gtr', { vol: 4.2, pan: 0.38, rev: 0.08 });
  const strC = mix.channel('str', { vol: 0.45, rev: 0.4, hp: 180 });
  const lineC = mix.channel('line', { vol: 0.8, rev: 0.4, hp: 200 });
  const ostC = mix.channel('ost', { vol: 0.5, pan: -0.2, rev: 0.25, hp: 250 });
  const epC = mix.channel('ep', { vol: 0.12, pan: -0.3, rev: 0.2 });
  const brC = mix.channel('brass', { vol: 0.8, rev: 0.2, pan: 0.1 });
  const tomC = mix.channel('tom', { vol: 0.5, rev: 0.3 });
  const synC = mix.channel('syn', { vol: 0.3, rev: 0.3, dly: 0.2 });

  BF_BARS.forEach((name, bar) => {
    const c = BF_CH[name], r = n(c.r), sec = 'ABCD'[bar >> 3], k = bar % 8;
    const next = BF_CH[BF_BARS[(bar + 1) % BF_BARS.length]];
    const brk = sec === 'C' && k < 2;
    // drums: the breakdown starts on hats and congas alone
    if (!brk) for (const st of [0, 4, 8, 12]) S.kick(mix, kickC, T(bar, st), 1, { f1: 46, dec: 0.38 });
    if (!brk) for (const st of [4, 12]) { S.clap(mix, clapC, T(bar, st), 1); S.snare(mix, snC, T(bar, st), 0.85); }
    for (let st = 0; st < 16; st++) {
      if (st % 4 === 2) S.hat(mix, hatC, T(bar, st), 0.6, { open: true, dec: 0.16 });
      else S.hat(mix, hatC, T(bar, st), (st % 4 === 0 ? 0.5 : 0.28) * hum());
    }
    if (sec !== 'C') for (const st of [4, 12]) S.tamb(mix, tamC, T(bar, st), 0.85);
    if (sec !== 'A') for (const [st, f, slap, v] of BF_CONGA) S.conga(mix, cgC, T(bar, st), v * hum(), { f, slap });
    // the build out of the breakdown: eighths, then sixteenths on the snare
    if (sec === 'C' && k === 6) for (let st = 0; st < 16; st += 2) S.snare(mix, snC, T(bar, st), 0.25 + 0.025 * st, { dec: 0.1 });
    if (sec === 'C' && k === 7) for (let st = 0; st < 16; st++) S.snare(mix, snC, T(bar, st), 0.3 + 0.035 * st, { dec: 0.08 });
    // bass
    const pat = name === 'Cmaj7' || (name === 'B7s9' && BF_BARS[bar + 1] === 'B7s9') ? BF_OCT : name === 'B7s9' ? BF_WALK : BF_RIFF;
    for (const [st, iv, len, v] of pat) S.bass(mix, bassC, T(bar, st), mtof(r + iv), len * s16, v * hum(), { cut: 360, q: 4 });
    // guitar: the wah riff in A and D, offbeat chops in B, scratches through the breakdown
    for (let st = 0; st < 16; st++) {
      const hits = sec === 'B' ? [2, 6, 10, 14] : sec === 'C' && k < 4 ? [6, 14] : [2, 3, 6, 10, 11, 14];
      const hit = hits.includes(st);
      if (sec === 'B' && !hit && st % 2 === 0) continue;
      S.guitar(mix, gtrC, T(bar, st), c.g, (hit ? 0.75 : 0.3) * hum(), { mute: !hit, wah: hit ? 1800 : 1100 });
    }
    // strings: a bed that grows, the creeping line in B, an ostinato through the build and in D
    const pv = sec === 'A' ? (k >= 4 ? 0.3 : 0) : sec === 'B' ? 0.4 : sec === 'C' ? (k >= 4 ? 0.5 : 0) : 0.32;
    if (pv) for (const m of c.pad) S.strings(mix, strC, T(bar, 0), mtof(n(m)), 16 * s16 - 0.05, pv);
    if (sec === 'B') line(T, s16, bar, BF_LINE[k], (t, f, len, v) => {
      S.strings(mix, lineC, t, f, len, 0.55 * v, { a: 0.25, r: 0.3, cut: 3800 });
      S.strings(mix, lineC, t, f * 2, len, 0.25 * v, { a: 0.25, r: 0.3, cut: 5500, voices: 2 });
    });
    if (sec === 'D' || (sec === 'C' && k >= 4)) c.ost.forEach((m, i) =>
      S.strings(mix, ostC, T(bar, i * 2), mtof(n(m)), 1.5 * s16, (i % 2 ? 0.45 : 0.75) * (sec === 'C' ? 0.6 + 0.1 * (k - 4) : 1), { a: 0.008, r: 0.08, voices: 2, cut: 3800 }));
    if (sec === 'C' && k === 7) S.stringRun(mix, ostC, T(bar, 12), ['B4', 'C#5', 'D#5', 'E5', 'F#5', 'G5', 'A5', 'B5'], s16 / 2, 0.8);
    // electric piano comping in B
    if (sec === 'B') for (const [st, len] of [[0, 3], [6, 2], [10, 4]]) for (const m of c.pad) S.epiano(mix, epC, T(bar, st), mtof(n(m)), len * s16, 0.6 * hum());
    // horns: pushes into the next bar, the turnaround hits, the call in D
    if ((sec === 'A' && [1, 3, 5].includes(k)) || (sec === 'B' && k === 3) || (sec === 'D' && [1, 3].includes(k)))
      for (const m of next.pad) S.brass(mix, brC, T(bar, 14), mtof(n(m)), 1.5 * s16, 0.8);
    if ((sec === 'B' || sec === 'C') && k === 7 || (sec === 'D' && k === 6)) for (const st of [0, 3, 6]) for (const m of c.pad) S.brass(mix, brC, T(bar, st), mtof(n(m)), 1.2 * s16, 0.85);
    if (sec === 'D' && (k === 0 || k === 2)) line(T, s16, bar, BF_CALL, (t, f, len, v) => {
      S.brass(mix, brC, t, f, len * 0.9, 0.85 * v);
      S.brass(mix, brC, t, f * 2, len * 0.9, 0.5 * v);
    });
    // fills
    if (sec === 'A' && k === 7) for (const [st, f] of [[8, 900], [10, 700]]) S.syndrum(mix, synC, T(bar, st), 0.8, { f0: f });
    if (sec === 'B' && k === 7) for (const [st, f] of [[12, 240], [13, 200], [14, 160], [15, 120]]) S.tom(mix, tomC, T(bar, st), 0.9, { f });
    if (sec === 'C' && k === 7) for (const [st, f] of [[14, 180], [15, 130]]) S.tom(mix, tomC, T(bar, st), 1, { f });
    if (sec === 'D' && k === 7) for (const [st, f] of [[12, 1000], [13, 850], [14, 700], [15, 560]]) S.syndrum(mix, synC, T(bar, st), 0.8, { f0: f, dec: 0.3 });
  });
}

// ---------------------------------------------------------------------------------------------
// 6. Dungeon march: disco in D minor with war drums, a cello ostinato, brass and a choir, a horn call twice a loop.

const MAR_CH = {
  Dm: { r: 'D2', pad: ['A3', 'D4', 'F4'], lo: ['D3', 'A3', 'D4', 'F4'] },
  Bb: { r: 'Bb1', pad: ['Bb3', 'D4', 'F4'], lo: ['Bb2', 'F3', 'Bb3', 'D4'] },
  C: { r: 'C2', pad: ['G3', 'C4', 'E4'], lo: ['C3', 'G3', 'C4', 'E4'] },
  A: { r: 'A1', pad: ['A3', 'C#4', 'E4'], lo: ['A2', 'E3', 'A3', 'C#4'] },
  Gm: { r: 'G1', pad: ['Bb3', 'D4', 'G4'], lo: ['G2', 'D3', 'G3', 'Bb3'] },
  Eb: { r: 'Eb2', pad: ['Bb3', 'Eb4', 'G4'], lo: ['Eb3', 'Bb3', 'Eb4', 'G4'] },
};
// A the march, B brass and choir, C war drums alone then building, D the horn call
const MAR_BARS = [
  'Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A',
  'Gm', 'Gm', 'Dm', 'Dm', 'Eb', 'Eb', 'A', 'A',
  'Dm', 'Dm', 'Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'A',
  'Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A',
];
/** The cello ostinato in sixteenths, 3 + 3 + 2: [step, chord tone, vel]. */
const MAR_OST = [[0, 0, 1], [1, 0, 0.4], [2, 0, 0.45], [3, 1, 0.85], [4, 0, 0.4], [5, 0, 0.45], [6, 2, 0.85], [7, 0, 0.45], [8, 0, 0.9], [9, 0, 0.4], [10, 0, 0.45], [11, 1, 0.85], [12, 0, 0.4], [13, 0, 0.45], [14, 3, 0.85], [15, 2, 0.6]];
/** The horn call over the first and fifth bars of D, and what it holds into the next. */
const MAR_CALL = {
  24: [[0, 'A4', 2], [2, 'D5', 2], [4, 'E5', 2], [6, 'F5', 6], [12, 'E5', 2], [14, 'D5', 2]],
  25: [[0, 'D5', 10]],
  28: [[0, 'A4', 2], [2, 'D5', 2], [4, 'E5', 2], [6, 'F5', 4], [10, 'G5', 2], [12, 'E5', 4]],
  29: [[0, 'F5', 4], [4, 'E5', 4], [8, 'D5', 6]],
};

function march(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0, t0), R = rng(17);
  const hum = () => 0.9 + R() * 0.2;
  const kickC = mix.channel('kick', { vol: 0.95 });
  const tomC = mix.channel('toms', { vol: 0.6, rev: 0.35 });
  const clapC = mix.channel('clap', { vol: 1.9, rev: 0.35 });
  const snC = mix.channel('snare', { vol: 0.7, rev: 0.3 });
  const hatC = mix.channel('hat', { vol: 1.0, pan: 0.2, lp: 10000 });
  const shC = mix.channel('shaker', { vol: 0.5, pan: -0.3 });
  const bassC = mix.channel('bass', { vol: 0.45 });
  const ostC = mix.channel('ost', { vol: 1.0, pan: -0.15, rev: 0.25, hp: 90 });
  const strC = mix.channel('str', { vol: 0.42, rev: 0.45, hp: 180 });
  const brC = mix.channel('brass', { vol: 0.62, rev: 0.3, pan: 0.12 });
  const hornC = mix.channel('horn', { vol: 0.75, rev: 0.4, dly: 0.08 });
  const chC = mix.channel('choir', { vol: 0.11, rev: 0.6 });
  const synC = mix.channel('syn', { vol: 0.3, rev: 0.4, dly: 0.2 });

  MAR_BARS.forEach((name, bar) => {
    const c = MAR_CH[name], r = n(c.r), sec = 'ABCD'[bar >> 3], k = bar % 8;
    const nr = n(MAR_CH[MAR_BARS[(bar + 1) % MAR_BARS.length]].r);
    const drums = sec === 'C' && k < 4;
    // drums: in the first half of C the war drums go alone
    if (!drums) for (const st of [0, 4, 8, 12]) S.kick(mix, kickC, T(bar, st), 1, { f0: 140, f1: 45, dec: 0.4 });
    const toms = drums ? [[0, 90, 1], [3, 110, 0.8], [6, 90, 0.9], [8, 90, 1], [11, 110, 0.8], [14, 130, 0.85]] : sec === 'B' ? [[0, 70, 0.9]] : [[0, 90, 0.75], [10, 110, 0.6]];
    for (const [st, f, v] of toms) S.tom(mix, tomC, T(bar, st), v * hum(), { f });
    for (const st of [4, 12]) { if (!drums) S.clap(mix, clapC, T(bar, st), 1); S.snare(mix, snC, T(bar, st), 0.85, { f: 180 }); }
    if (sec === 'D' || (sec === 'C' && k >= 4 && k < 7)) for (const [st, v] of [[7, 0.25], [13, 0.2], [14, 0.3], [15, 0.35]]) S.snare(mix, snC, T(bar, st), v, { dec: 0.08 });
    if (sec === 'C' && k === 7) for (let st = 0; st < 16; st++) S.snare(mix, snC, T(bar, st), 0.3 + 0.035 * st, { dec: 0.08 });
    for (let st = 0; st < 16; st += 2) S.hat(mix, hatC, T(bar, st), st % 4 === 2 ? 0.65 : 0.35, { open: st % 4 === 2, dec: 0.16 });
    if (sec === 'B' || sec === 'D') for (let st = 0; st < 16; st++) S.shaker(mix, shC, T(bar, st), (st % 2 ? 0.45 : 0.65) * hum());
    // bass: octaves in eighths creeping into the next chord; long roots under the war drums
    if (drums) S.bass(mix, bassC, T(bar, 0), mtof(r), 15 * s16, 0.85, { cut: 260, env: 400, q: 2 });
    else for (let st = 0; st < 16; st += 2) {
      const m = st === 14 && nr !== r ? (nr > r ? nr - 1 : nr + 1) : r + (st % 4 ? 12 : 0);
      S.bass(mix, bassC, T(bar, st), mtof(m), 1.6 * s16, (st % 4 ? 0.8 : 1) * hum(), { cut: 320, env: 1400, q: 4 });
    }
    // the cello ostinato: eighths in A and B, sixteenths from the middle of C on
    const full = sec === 'D' || (sec === 'C' && k >= 2);
    for (const [st, i, v] of MAR_OST) {
      if (!full && st % 2) continue;
      if (drums && k < 2) continue;
      S.strings(mix, ostC, T(bar, st), mtof(n(c.lo[i])), 0.9 * s16, v * (full ? 0.75 : 0.6) * hum(), { a: 0.006, r: 0.06, voices: 2, cut: 2600 });
    }
    // strings and brass chords, the choir under B
    if (sec !== 'B') for (const m of c.pad) S.strings(mix, strC, T(bar, 0), mtof(n(m) + 12), 16 * s16 - 0.05, sec === 'C' ? 0.45 : 0.3);
    if (sec === 'B') {
      for (const m of c.pad) S.brass(mix, brC, T(bar, 0), mtof(n(m)), 15 * s16, 0.5);
      for (const m of c.pad) S.choir(mix, chC, T(bar, 0), mtof(n(m) - 12), 16 * s16 - 0.05, 0.6, { vowel: 'aa' });
    }
    if ((sec === 'A' || sec === 'D') && (k === 3 || k === 7)) for (const st of [12, 14]) for (const m of c.pad) S.brass(mix, brC, T(bar, st), mtof(n(m)), 1.4 * s16, 0.8);
    if (sec === 'C' && k === 7) for (const st of [0, 3, 6]) for (const m of c.pad) S.brass(mix, brC, T(bar, st), mtof(n(m)), 1.2 * s16, 0.85);
    // the horn call, two octaves
    const call = MAR_CALL[bar];
    if (call) line(T, s16, bar, call, (t, f, len, v) => {
      S.brass(mix, hornC, t, f, len * 0.92, 0.85 * v);
      S.brass(mix, hornC, t, f / 2, len * 0.92, 0.55 * v);
    });
    // syndrums into each section
    if (k === 7 && sec !== 'C') for (const [st, f] of [[12, 900], [14, 650]]) S.syndrum(mix, synC, T(bar, st), 0.7, { f0: f, f1: 110, dec: 0.4 });
  });
}

// ---------------------------------------------------------------------------------------------
// 7. Chase: hi-NRG in A minor, a sequencer bass in sixteenths that opens up and closes, off-beat chords, toms.

const CHS_CH = {
  Am: { r: 'A1', pad: ['A3', 'C4', 'E4'] },
  F: { r: 'F1', pad: ['A3', 'C4', 'F4'] },
  G: { r: 'G1', pad: ['B3', 'D4', 'G4'] },
  E: { r: 'E1', pad: ['G#3', 'B3', 'E4'] },
  Dm: { r: 'D2', pad: ['A3', 'D4', 'F4'] },
};
// A the run, B darker with the arpeggio, C the filter closes and opens again, D everything with orchestra hits
const CHS_BARS = [
  'Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E',
  'Dm', 'Dm', 'Am', 'Am', 'F', 'G', 'E', 'E',
  'Am', 'Am', 'Am', 'Am', 'F', 'F', 'G', 'G',
  'Am', 'Am', 'F', 'G', 'Dm', 'F', 'E', 'E',
];
const CHS_SEQ = [0, 0, 12, 0, 7, 0, 12, 7];

function chase(mix, t0, S = Synth) {
  const bpm = mix.bpm, s16 = 60 / bpm / 4, T = clock(bpm, 0, t0), R = rng(41);
  const hum = () => 0.92 + R() * 0.16;
  const kickC = mix.channel('kick', { vol: 1 });
  const clapC = mix.channel('clap', { vol: 1.8, rev: 0.4 });
  const snC = mix.channel('snare', { vol: 0.6, rev: 0.4 });
  const hatC = mix.channel('hat', { vol: 0.85, pan: 0.2, lp: 10000 });
  const shC = mix.channel('shaker', { vol: 0.45, pan: -0.3 });
  const seqC = mix.channel('seq', { vol: 0.38, pan: -0.1, dly: 0.06 });
  const subC = mix.channel('sub', { vol: 0.22 });
  const stabC = mix.channel('stab', { vol: 0.45, rev: 0.25, hp: 200, duck: 0.35 });
  const padC = mix.channel('pad', { vol: 0.42, rev: 0.4, hp: 220, duck: 0.4 });
  const arpC = mix.channel('arp', { vol: 0.08, pan: 0.3, rev: 0.25, dly: 0.25, hp: 300 });
  const hitC = mix.channel('hit', { vol: 0.6, rev: 0.45 });
  const tomC = mix.channel('tom', { vol: 0.55, rev: 0.4 });
  const synC = mix.channel('syn', { vol: 0.3, rev: 0.4, dly: 0.2 });

  CHS_BARS.forEach((name, bar) => {
    const c = CHS_CH[name], r = n(c.r), sec = 'ABCD'[bar >> 3], k = bar % 8;
    const brk = sec === 'C' && k < 4;
    if (!brk) for (const st of [0, 4, 8, 12]) { S.kick(mix, kickC, T(bar, st), 1, { f0: 170, f1: 50, dec: 0.36 }); mix.pump(T(bar, st)); }
    if (!brk) for (const st of [4, 12]) { S.clap(mix, clapC, T(bar, st), 1, { tail: 0.22 }); S.snare(mix, snC, T(bar, st), 0.85, { f: 200, dec: 0.2 }); }
    if (sec === 'C' && k === 7) for (let st = 0; st < 16; st++) S.snare(mix, snC, T(bar, st), 0.3 + 0.035 * st, { f: 200, dec: 0.08 });
    for (let st = 0; st < 16; st++) {
      if (st % 4 === 2) S.hat(mix, hatC, T(bar, st), 0.75, { open: true, dec: 0.17 });
      else if (st % 2 === 1 && !brk) S.hat(mix, hatC, T(bar, st), 0.25 * hum());
    }
    if (sec === 'B' || sec === 'D') for (let st = 0; st < 16; st++) S.shaker(mix, shC, T(bar, st), (st % 2 ? 0.4 : 0.6) * hum());
    // the riser out of the breakdown
    if (sec === 'C' && k >= 6) for (let st = 0; st < 16; st++) {
      const u = ((k - 6) * 16 + st) / 32;
      S.shaker(mix, shC, T(bar, st), 0.3 + 0.7 * u, { dec: 0.07, f: 3000 + 7000 * u });
    }
    // the sequencer bass: its filter set by the section, shut and slowly opening through C
    let cut = sec === 'A' ? 280 : sec === 'B' ? 330 : sec === 'D' ? 360 : 180, env = sec === 'A' ? 1600 : sec === 'B' ? 2100 : sec === 'D' ? 2500 : 500;
    for (let st = 0; st < 16; st++) {
      if (sec === 'C') { const u = Math.max(0, (k - 2) * 16 + st) / 96; cut = 180 + 180 * u; env = 500 + 2000 * u; }
      S.seqBass(mix, seqC, T(bar, st), mtof(r + CHS_SEQ[st % 8]), 0.8 * s16, st % 4 === 0 ? 1 : 0.75, { cut, env });
    }
    for (const st of [0, 4, 8, 12]) if (!brk) S.bass(mix, subC, T(bar, st), mtof(r), 2 * s16, 0.8, { cut: 260, env: 400, q: 2 });
    // off-beat chords in A and D, a pad in B and C
    if (sec === 'A' || sec === 'D') for (const st of [2, 6, 10, 14]) for (const m of c.pad) S.poly(mix, stabC, T(bar, st), mtof(n(m) + 12), 1.2 * s16, 0.6 * hum(), { cut: 2400 });
    if (sec === 'B' || sec === 'C') for (const m of c.pad) S.strings(mix, padC, T(bar, 0), mtof(n(m) + 12), 16 * s16 - 0.04, sec === 'C' ? 0.6 : 0.5, { a: 0.3, r: 0.6 });
    // the arpeggio, up an octave and through the delay
    if (sec === 'B' || sec === 'D') for (let st = 0; st < 16; st++) {
      const m = n(c.pad[[0, 1, 2, 1][st % 4]]) + 12 + (st >= 8 && st % 4 === 2 ? 12 : 0);
      S.seqBass(mix, arpC, T(bar, st), mtof(m), 0.7 * s16, st % 4 === 0 ? 0.9 : 0.6, { cut: 900, env: 1800 });
    }
    // orchestra hits at the top of D's phrases
    if (sec === 'D' && (k === 0 || k === 4)) for (const m of c.pad) {
      S.brass(mix, hitC, T(bar, 0), mtof(n(m) + 12), 2 * s16, 0.9);
      S.strings(mix, hitC, T(bar, 0), mtof(n(m) + 12), 2 * s16, 0.5, { a: 0.005, r: 0.3, cut: 5000 });
    }
    // fills
    if (k === 7 && sec !== 'C') for (const [st, f] of [[12, 240], [13, 200], [14, 160], [15, 120]]) S.tom(mix, tomC, T(bar, st), 0.9, { f });
    if (sec === 'C' && k === 3) S.syndrum(mix, synC, T(bar, 12), 0.7, { f0: 900, f1: 120, dec: 0.6 });
  });
}

export const SONGS = {
  funk: { title: 'Фанк-диско 70-х', bpm: 118, bars: 24, play: funk },
  monster: { title: 'Монстр-диско', bpm: 112, bars: 24, play: monster },
  euro: { title: 'Евродиско 80-х', bpm: 122, bars: 24, play: euro },
  lounge: { title: 'Фоновое диско', bpm: 106, bars: 48, play: lounge },
  bfunk: { title: 'Боевой фанк', bpm: 120, bars: 32, play: bfunk },
  march: { title: 'Подземный марш', bpm: 116, bars: 32, play: march },
  chase: { title: 'Погоня', bpm: 126, bars: 32, play: chase },
};
