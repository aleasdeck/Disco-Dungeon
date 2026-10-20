// The fight's sounds, the «Диско» set Vladislav picked: cowbell, syndrum, a record scratch and the band's brass and strings.
// Each sound is (band, out, t, p): p is how hard, 0 to 1, where the sound has a soft and a hard version.

import { adsr, bass, bell, brass, clap, cowbell, filt, gain, guitar, hat, kick, mtof, noise, note, organ, osc, perc, strings, stringRun, syndrum, xylo, type Band } from './synth';

export type Sfx =
  | 'click' | 'launch' | 'wall' | 'clink' | 'hit' | 'crit' | 'kill' | 'armor' | 'ore' | 'sparks' | 'herb' | 'ice' | 'shatter'
  | 'pit' | 'hurt' | 'ability' | 'enemyTurn' | 'yourTurn' | 'step' | 'slam' | 'win' | 'lose' | 'zap' | 'eat' | 'gas' | 'boom' | 'freeze'
  | 'shove' | 'cuff' | 'kiss';

type Play = (b: Band, o: AudioNode, t: number, p: number) => void;

/** A tone sliding from f0 to f1 over its decay. */
function tone(b: Band, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dec: number, vel: number) {
  const o = osc(b.ctx, type, f0, t, t + dec + 0.05), g = gain(b.ctx, 0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dec);
  perc(g.gain, t, vel, dec, 0.002);
  o.connect(g).connect(out);
}

/** A burst of filtered noise; the filter may sweep from f to f1. */
function hiss(b: Band, out: AudioNode, t: number, dec: number, vel: number, { type = 'bandpass' as BiquadFilterType, f = 2000, q = 1 } = {}) {
  const s = noise(b.ctx, t, dec + 0.05), bp = filt(b.ctx, type, f, q), g = gain(b.ctx, 0);
  perc(g.gain, t, vel, dec);
  s.connect(bp).connect(g).connect(out);
}

/** A record scratch: noise through a band that sweeps up and back down, or (`down`) only falls. */
function scratch(b: Band, out: AudioNode, t: number, down: boolean) {
  const ctx = b.ctx, len = down ? 0.4 : 0.3, s = noise(ctx, t, len), bp = filt(ctx, 'bandpass', 900, down ? 3 : 4), g = gain(ctx, 0);
  if (down) {
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + 0.35);
  } else {
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.07);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.2);
  }
  perc(g.gain, t, 0.7, down ? 0.35 : 0.22, 0.01);
  s.connect(bp).connect(g).connect(out);
}

const SOUNDS: Record<Sfx, Play> = {
  click: (b, o, t) => { tone(b, o, t, 'triangle', 1700, 1700, 0.03, 0.35); hiss(b, o, t, 0.015, 0.25, { f: 4000, q: 2 }); },
  // a filter opening on two saws: "whoosh"
  launch: (b, o, t, p) => {
    const ctx = b.ctx, lp = filt(ctx, 'lowpass', 300, 9), g = gain(ctx, 0), d = 0.16 + 0.06 * p;
    osc(ctx, 'sawtooth', 110, t, t + d + 0.05).connect(lp);
    osc(ctx, 'sawtooth', 165, t, t + d + 0.05, 8).connect(lp);
    lp.frequency.exponentialRampToValueAtTime(5000, t + d);
    lp.connect(g).connect(o);
    perc(g.gain, t, 0.35 + 0.2 * p, d, 0.01);
  },
  wall: (b, o, t, p) => { tone(b, o, t, 'triangle', 1900 + 600 * p, 1800, 0.035, 0.2 + 0.4 * p); hiss(b, o, t, 0.02, 0.2 + 0.3 * p, { f: 3500, q: 3 }); },
  clink: (b, o, t, p) => { cowbell(b, o, t, 0.7 + 0.3 * p); cowbell(b, o, t + 0.11, 0.5 + 0.3 * p); },
  hit: (b, o, t, p) => { kick(b, o, t, 0.5 + 0.4 * p, { f0: 200, f1: 70, dec: 0.2 }); clap(b, o, t, 0.4 + 0.4 * p, { tail: 0.08 }); },
  // an orchestra hit in C minor
  crit: (b, o, t) => {
    kick(b, o, t, 1, { f0: 180, f1: 55, dec: 0.3 });
    for (const m of ['C4', 'Eb4', 'G4', 'C5']) { brass(b, o, t, note(m), 0.18, 0.7); strings(b, o, t, note(m, 12), 0.15, 0.6, { a: 0.005, r: 0.25, voices: 2 }); }
    hiss(b, o, t, 0.5, 0.25, { type: 'highpass', f: 5000 });
  },
  kill: (b, o, t) => { syndrum(b, o, t, 1, { f0: 900, f1: 120, dec: 0.4 }); [0, 4, 7, 12, 16].forEach((k, i) => bell(b, o, t + 0.25 + i * 0.045, mtof(84 + k), 0.45, { dec: 0.5 })); },
  armor: (b, o, t) => { cowbell(b, o, t, 1, { f: 300 }); tone(b, o, t + 0.07, 'square', 160, 120, 0.12, 0.12); },
  ore: (b, o, t) => { bell(b, o, t, note('B5'), 0.6, { ratio: 2.01, dec: 0.3 }); bell(b, o, t + 0.08, note('E6'), 0.6, { ratio: 2.01, dec: 0.5 }); },
  sparks: (b, o, t) => { ['E6', 'G#6', 'B6', 'E7'].forEach((m, i) => bell(b, o, t + i * 0.04, note(m), 0.4, { ratio: 1.41, dec: 0.5 })); },
  herb: (b, o, t) => { guitar(b, o, t, ['E4', 'A4', 'C#5'], 0.9, { wah: 900, len: 0.18 }); guitar(b, o, t + 0.17, ['E4', 'A4', 'C#5'], 0.9, { wah: 2200, len: 0.2 }); },
  ice: (b, o, t) => bell(b, o, t, note('A6'), 0.35, { ratio: 2.76, dec: 0.35 }),
  shatter: (b, o, t) => { ['E7', 'C7', 'A6', 'F6', 'D6', 'A5'].forEach((m, i) => bell(b, o, t + i * 0.035, note(m), 0.4, { ratio: 2.76, dec: 0.4 })); hiss(b, o, t, 0.3, 0.25, { type: 'highpass', f: 6000 }); },
  pit: (b, o, t) => syndrum(b, o, t, 0.9, { f0: 1200, f1: 90, dec: 0.75 }),
  hurt: (b, o, t) => { kick(b, o, t, 0.9, { f0: 120, f1: 45, dec: 0.25 }); bass(b, o, t, note('F#1'), 0.2, 1, { cut: 200, env: 2500, q: 10 }); },
  // an A major chord swelling open, then a string run up
  ability: (b, o, t) => {
    const ctx = b.ctx, lp = filt(ctx, 'lowpass', 300, 8), g = gain(ctx, 0);
    for (const k of [0, 4, 7]) osc(ctx, 'sawtooth', 220 * Math.pow(2, k / 12), t, t + 0.75).connect(lp);
    lp.frequency.exponentialRampToValueAtTime(7000, t + 0.55);
    lp.connect(g).connect(o);
    adsr(g.gain, t, 0.5, { a: 0.4, d: 0.1, s: 1, r: 0.15, peak: 0.35 });
    stringRun(b, o, t + 0.3, ['A4', 'C#5', 'E5', 'A5', 'C#6', 'E6'], 0.035, 0.7);
  },
  // a record scratch, then a low minor stab
  enemyTurn: (b, o, t) => {
    scratch(b, o, t, false);
    for (const m of ['D3', 'F3', 'A3', 'D4']) brass(b, o, t + 0.22, note(m), 0.35, 0.7);
    kick(b, o, t + 0.22, 1, { f0: 140, f1: 45, dec: 0.5 });
  },
  yourTurn: (b, o, t) => { stringRun(b, o, t, ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6'], 0.03, 0.7); clap(b, o, t + 0.2, 0.9); hat(b, o, t + 0.2, 1, { open: true }); },
  step: (b, o, t, p) => xylo(b, o, t, 500 + 250 * p, 0.5, { dec: 0.08, ratio: 2.4 }),
  slam: (b, o, t) => { kick(b, o, t, 1, { f0: 120, f1: 38, dec: 0.7 }); hiss(b, o, t, 1.1, 0.35, { type: 'highpass', f: 3000, q: 0.5 }); for (const m of ['D2', 'D3', 'Ab3']) brass(b, o, t, note(m), 0.4, 0.8); },
  // a fanfare: a string run up, brass on C, F/D and C, cowbells and a spray of bells
  win: (b, o, t) => {
    const T = 60 / 120 / 4;
    stringRun(b, o, t, ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'], T / 2, 0.8);
    ([[2, ['E4', 'G4', 'C5']], [3, ['E4', 'G4', 'C5']], [6, ['F4', 'A4', 'D5']], [8, ['G4', 'C5', 'E5']]] as const).forEach(([s, chd], k) => {
      for (const m of chd) brass(b, o, t + s * T, note(m), (k === 3 ? 6 : 1) * T, 0.8);
      kick(b, o, t + s * T, 0.7);
    });
    cowbell(b, o, t + 2 * T, 0.6);
    cowbell(b, o, t + 6 * T, 0.6);
    for (let k = 0; k < 6; k++) bell(b, o, t + 8 * T + k * 0.06, note('C7', [0, 4, 7, 12, 7, 4][k]), 0.3, { dec: 0.6 });
    hat(b, o, t + 8 * T, 1, { open: true, dec: 0.5 });
  },
  // a crackle: a buzzing square diving down over a burst of hiss, twice
  zap: (b, o, t, p) => {
    for (const [dt, f] of [[0, 1400], [0.05, 1000]]) { tone(b, o, t + dt, 'square', f, 90, 0.09, 0.18 + 0.15 * p); hiss(b, o, t + dt, 0.06, 0.3 + 0.2 * p, { type: 'highpass', f: 4500 }); }
  },
  // a munch: two quick low bloops and a wah lick
  eat: (b, o, t) => {
    tone(b, o, t, 'sine', 420, 180, 0.08, 0.5);
    tone(b, o, t + 0.1, 'sine', 380, 160, 0.08, 0.45);
    guitar(b, o, t + 0.16, ['G4', 'B4', 'D5'], 0.7, { wah: 1800, len: 0.16 });
  },
  // a long wet raspberry: a low buzzing saw wobbling down through a closing filter, over a puff of hiss
  gas: (b, o, t) => {
    const ctx = b.ctx, lp = filt(ctx, 'lowpass', 900, 6), g = gain(ctx, 0), s = osc(ctx, 'sawtooth', 95, t, t + 0.75);
    s.frequency.setValueAtTime(95, t);
    for (let k = 1; k <= 8; k++) s.frequency.linearRampToValueAtTime(k % 2 ? 70 - k * 3 : 105 - k * 4, t + k * 0.08);
    lp.frequency.exponentialRampToValueAtTime(250, t + 0.7);
    s.connect(lp).connect(g).connect(o);
    adsr(g.gain, t, 0.6, { a: 0.02, d: 0.2, s: 0.7, r: 0.12, peak: 0.6 });
    hiss(b, o, t + 0.05, 0.6, 0.2, { f: 700, q: 0.7 });
  },
  // a firecracker: a sharp crack of noise and a thump, and a crackle of little pops after it
  boom: (b, o, t) => {
    kick(b, o, t, 1, { f0: 160, f1: 40, dec: 0.35 });
    hiss(b, o, t, 0.25, 0.9, { type: 'highpass', f: 1200, q: 0.5 });
    for (let k = 0; k < 5; k++) hiss(b, o, t + 0.12 + k * 0.05 + (k % 2) * 0.02, 0.03, 0.4 - k * 0.05, { f: 3000 + k * 400, q: 2 });
  },
  // ice: a glassy creak and high bells, harder for a freeze than for a chill
  freeze: (b, o, t, p) => {
    tone(b, o, t, 'triangle', 2600, 1300, 0.12, 0.25 + 0.2 * p);
    ['B6', 'F#6', 'D#6'].slice(0, p > 0.8 ? 3 : 2).forEach((m, i) => bell(b, o, t + 0.04 + i * 0.05, note(m), 0.45, { ratio: 2.76, dec: 0.45 }));
    hiss(b, o, t, 0.2, 0.2, { type: 'highpass', f: 6500 });
  },
  // the bouncer's throw: a heavy thud and a short shove of air
  shove: (b, o, t, p) => {
    kick(b, o, t, 0.7 + 0.3 * p, { f0: 150, f1: 48, dec: 0.28 });
    hiss(b, o, t, 0.12, 0.3 + 0.2 * p, { type: 'lowpass', f: 900, q: 0.7 });
  },
  // handcuffs: a quick metal ratchet and a snap
  cuff: (b, o, t, p) => {
    for (let k = 0; k < 4; k++) tone(b, o, t + k * 0.03, 'square', 2600 - k * 120, 2300, 0.012, 0.12 + 0.08 * p);
    cowbell(b, o, t + 0.14, 0.4 + 0.4 * p, { f: 900 });
  },
  // a blown kiss: a «mwah» sliding up and a little sparkle
  kiss: (b, o, t) => {
    tone(b, o, t, 'sine', 480, 1250, 0.13, 0.5);
    tone(b, o, t + 0.12, 'sine', 1300, 900, 0.05, 0.25);
    ['E6', 'B6'].forEach((m, i) => bell(b, o, t + 0.14 + i * 0.05, note(m), 0.3, { dec: 0.4 }));
  },
  lose: (b, o, t) => {
    scratch(b, o, t, true);
    syndrum(b, o, t + 0.3, 0.8, { f0: 600, f1: 60, dec: 1 });
    for (const m of ['D3', 'F3', 'Ab3', 'C4']) organ(b, o, t + 0.45, note(m), 1.1, 0.8);
  },
};

/** Level trims in dB so every sound sits where it should against the others (each one measured alone). */
const TRIM: Record<Sfx, number> = {
  click: 3.7, launch: -6.0, wall: 4.0, clink: -0.7, hit: -2.0, crit: -3.2, kill: -1.6, armor: 0.5, ore: 4.4, sparks: 2.6, herb: 10.5,
  ice: 6.3, shatter: 4.6, pit: -7.0, hurt: -7.7, ability: -4.3, enemyTurn: -5.4, yourTurn: 3.9, step: -0.4, slam: -4.3, win: -2.3, lose: -1.9,
  zap: 0, eat: 6, gas: 2, boom: -3, freeze: 4, shove: -3, cuff: 3, kiss: 4,
};

/** How long each sound lasts, about: the trim node is let go after it. */
const LONG: Partial<Record<Sfx, number>> = { win: 2.5, lose: 2, slam: 1.4, ability: 1, kill: 0.9, enemyTurn: 1 };

/** Play one sound at time t through its trim. */
export function playSfx(b: Band, out: AudioNode, ev: Sfx, t: number, p = 0.7) {
  const g = gain(b.ctx, Math.pow(10, TRIM[ev] / 20));
  g.connect(out);
  SOUNDS[ev](b, g, t, p);
  setTimeout(() => g.disconnect(), (t - b.ctx.currentTime + (LONG[ev] ?? 0.6) + 1) * 1000);
}
