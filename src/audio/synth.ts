// The few synth voices the fight's sounds are made of: drums, bass, brass, strings, bells and the like. The music is
// played by the same voices, rendered ahead into the files in public/assets/music (sources in art/sound).
// Every voice schedules its own nodes at time t; they stop and let go of themselves once the sound is over.

/** What a voice plays through: the audio context, and shared LFOs by name (vibrato, tremolo). */
export interface Band {
  ctx: BaseAudioContext;
  lfo(name: string, rate: number, depth: number): AudioNode;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A4', 'C#5', 'Bb3' to a MIDI number. */
export function n(s: string) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (+m[3] + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const note = (s: string, shift = 0) => mtof(n(s) + shift);

const noiseOf = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Two seconds of white noise, one buffer per context. */
function noiseBuf(ctx: BaseAudioContext) {
  let b = noiseOf.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseOf.set(ctx, b);
  }
  return b;
}

export function noise(ctx: BaseAudioContext, t: number, len: number) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + len + 0.05);
  return s;
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, t: number, stop: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

export function gain(ctx: BaseAudioContext, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

export function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** A percussive hit on a gain: up to `peak` at once, then down to silence over `dec` seconds. */
export function perc(p: AudioParam, t: number, peak: number, dec: number, a = 0.001) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + dec);
  p.setValueAtTime(0, t + a + dec + 0.001);
}

/** Attack, decay to sustain, hold to `len`, release. */
export function adsr(p: AudioParam, t: number, len: number, { a = 0.005, d = 0.1, s = 0.7, r = 0.1, peak = 1 } = {}) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3);
  p.setTargetAtTime(0, t + Math.max(len, a + 0.001), r / 4);
}

// ------------------------------------------------------------------ drums

export function kick(b: Band, out: AudioNode, t: number, vel = 1, { f0 = 150, f1 = 48, dec = 0.42, click = 0.35 } = {}) {
  const ctx = b.ctx, o = osc(ctx, 'sine', f0, t, t + dec + 0.05), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f1 * 1.15, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.3);
  perc(g.gain, t, vel, dec);
  o.connect(g).connect(out);
  const nz = noise(ctx, t, 0.02), hp = filt(ctx, 'highpass', 2500), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * click, 0.012);
  nz.connect(hp).connect(ng).connect(out);
}

export function clap(b: Band, out: AudioNode, t: number, vel = 1, { f = 1150, tail = 0.2 } = {}) {
  const ctx = b.ctx, nz = noise(ctx, t, 0.4), bp = filt(ctx, 'bandpass', f, 0.9), hp = filt(ctx, 'highpass', 500), g = gain(ctx, 0);
  const p = g.gain;
  p.setValueAtTime(0, t);
  for (let k = 0; k < 3; k++) {
    const s = t + k * 0.011;
    p.setValueAtTime(vel, s);
    p.exponentialRampToValueAtTime(vel * 0.15, s + 0.009);
  }
  p.setValueAtTime(vel * 0.9, t + 0.034);
  p.exponentialRampToValueAtTime(0.0001, t + 0.034 + tail);
  nz.connect(bp).connect(hp).connect(g).connect(out);
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
export function hat(b: Band, out: AudioNode, t: number, vel = 1, o: { open?: boolean; dec?: number } = {}) {
  const dec = o.dec ?? (o.open ? 0.24 : 0.04), ctx = b.ctx, bp = filt(ctx, 'bandpass', 10000, 0.8), hp = filt(ctx, 'highpass', 7000), g = gain(ctx, 0);
  for (const r of HAT_RATIOS) osc(ctx, 'square', 400 * r, t, t + dec + 0.05).connect(bp);
  const nz = noise(ctx, t, dec + 0.05), ng = gain(ctx, 0.5);
  nz.connect(ng).connect(hp);
  bp.connect(hp).connect(g).connect(out);
  perc(g.gain, t, vel * 0.32, dec, 0.0015);
}

export function cowbell(b: Band, out: AudioNode, t: number, vel = 1, { f = 560 } = {}) {
  const ctx = b.ctx, bp = filt(ctx, 'bandpass', f * 1.9, 1.6), g = gain(ctx, 0);
  osc(ctx, 'square', f, t, t + 0.5).connect(bp);
  osc(ctx, 'square', f * 1.48, t, t + 0.5).connect(bp);
  bp.connect(g).connect(out);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.5, t + 0.002);
  p.exponentialRampToValueAtTime(vel * 0.12, t + 0.05);
  p.exponentialRampToValueAtTime(0.0001, t + 0.4);
}

/** The 70s syndrum: a tone falling in pitch, "pew". */
export function syndrum(b: Band, out: AudioNode, t: number, vel = 1, { f0 = 700, f1 = 140, dec = 0.45 } = {}) {
  const ctx = b.ctx, o = osc(ctx, 'sine', f0, t, t + dec + 0.05), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.9);
  perc(g.gain, t, vel * 0.8, dec, 0.002);
  o.connect(g).connect(out);
  const nz = noise(ctx, t, 0.05), bp = filt(ctx, 'bandpass', 3000, 1), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.15, 0.03);
  nz.connect(bp).connect(ng).connect(out);
}

/** Wood: a block or a xylophone. Partials 1 and ~3, very short. */
export function xylo(b: Band, out: AudioNode, t: number, f: number, vel = 1, { ratio = 3.98, dec = 0.35 } = {}) {
  const ctx = b.ctx, g = gain(ctx, 0), g2 = gain(ctx, 0);
  osc(ctx, 'sine', f, t, t + dec + 0.1).connect(g).connect(out);
  osc(ctx, 'sine', f * ratio, t, t + 0.12).connect(g2).connect(out);
  perc(g.gain, t, vel * 0.6, dec, 0.001);
  perc(g2.gain, t, vel * 0.25, 0.05, 0.001);
  const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', f * 6, 2), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.35, 0.008);
  nz.connect(bp).connect(ng).connect(out);
}

// ------------------------------------------------------------------ bass, keys, bells

/** Funky synth bass: saw and square through a lowpass that pops open on the note. */
export function bass(b: Band, out: AudioNode, t: number, f: number, len: number, vel = 1, { cut = 380, env = 1600, q = 5, dec = 0.13, sub = 0.3, rel = 0.04 } = {}) {
  const ctx = b.ctx, end = t + len + rel * 2 + 0.05;
  const lp = filt(ctx, 'lowpass', cut, q), g = gain(ctx, 0);
  osc(ctx, 'sawtooth', f, t, end).connect(gain(ctx, 0.5)).connect(lp);
  osc(ctx, 'square', f, t, end, -6).connect(gain(ctx, 0.25)).connect(lp);
  osc(ctx, 'sine', f, t, end).connect(gain(ctx, sub)).connect(g);
  lp.connect(g).connect(out);
  const c = lp.frequency;
  c.setValueAtTime(cut, t);
  c.linearRampToValueAtTime(cut + env * vel, t + 0.006);
  c.setTargetAtTime(cut, t + 0.006, dec / 3);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.75, t + 0.004);
  p.setTargetAtTime(vel * 0.55, t + 0.004, 0.08);
  p.setTargetAtTime(0, t + len, rel / 3);
}

/** Organ: drawbar sines, a key click, vibrato from the band's "vib" LFO. */
export function organ(b: Band, out: AudioNode, t: number, f: number, len: number, vel = 1) {
  const ctx = b.ctx, end = t + len + 0.2, g = gain(ctx, 0), vib = b.lfo('vib', 6.2, 9);
  [[0.5, 0.6], [1, 1], [2, 0.55], [3, 0.35], [6, 0.2]].forEach(([r, a]) => {
    const o = osc(ctx, 'sine', f * r, t, end);
    vib.connect(o.detune);
    o.connect(gain(ctx, a * 0.16)).connect(g);
  });
  g.connect(out);
  adsr(g.gain, t, len, { a: 0.006, d: 0.05, s: 1, r: 0.05, peak: vel });
  const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', 2500, 1), ng = gain(ctx, 0);
  perc(ng.gain, t, 0.15 * vel, 0.006);
  nz.connect(bp).connect(ng).connect(out);
}

/** A bell for accents: inharmonic FM. */
export function bell(b: Band, out: AudioNode, t: number, f: number, vel = 1, { ratio = 3.5, dec = 1.4 } = {}) {
  const ctx = b.ctx, end = t + dec + 0.1;
  const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f * ratio, t, end), mg = gain(ctx, 0);
  mod.connect(mg).connect(car.frequency);
  perc(mg.gain, t, f * 2.5, dec * 0.6);
  const g = gain(ctx, 0);
  car.connect(g).connect(out);
  perc(g.gain, t, vel * 0.35, dec, 0.002);
}

// ------------------------------------------------------------------ strings, brass, guitar

/** String section: detuned saws spread in stereo. */
export function strings(b: Band, out: AudioNode, t: number, f: number, len: number, vel = 1, { a = 0.18, r = 0.5, cut = 3200, voices = 3 } = {}) {
  const ctx = b.ctx, end = t + len + r * 2, lp = filt(ctx, 'lowpass', cut, 0.6), g = gain(ctx, 0), vib = b.lfo('svib', 5.1, 7);
  for (let k = 0; k < voices; k++) {
    const u = voices === 1 ? 0 : k / (voices - 1) - 0.5, o = osc(ctx, 'sawtooth', f, t, end, u * 18), p = ctx.createStereoPanner();
    vib.connect(o.detune);
    p.pan.value = u * 1.2;
    o.connect(gain(ctx, 0.22 / Math.sqrt(voices))).connect(p).connect(lp);
  }
  lp.connect(g).connect(out);
  adsr(g.gain, t, len, { a, d: 0.3, s: 0.85, r, peak: vel });
}

/** A string run: a fast scale up or down, each note a short bow. */
export function stringRun(b: Band, out: AudioNode, t: number, notes: string[], step: number, vel = 1) {
  notes.forEach((m, k) => strings(b, out, t + k * step, note(m), step * 1.2, vel * (0.6 + (0.4 * k) / notes.length), { a: 0.01, r: 0.12, voices: 2, cut: 4500 }));
}

/** Brass section stab: saws with a bright filter swell and a scoop up into pitch. */
export function brass(b: Band, out: AudioNode, t: number, f: number, len: number, vel = 1) {
  const ctx = b.ctx, end = t + len + 0.3, lp = filt(ctx, 'lowpass', 600, 1.2), g = gain(ctx, 0);
  for (const dt of [-9, 0, 8]) {
    const o = osc(ctx, 'sawtooth', f, t, end, dt);
    o.frequency.setValueAtTime(f * 0.985, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    o.connect(gain(ctx, 0.15)).connect(lp);
  }
  lp.connect(g).connect(out);
  const c = lp.frequency;
  c.setValueAtTime(500, t);
  c.linearRampToValueAtTime(3800 * vel, t + 0.03);
  c.setTargetAtTime(1600, t + 0.03, 0.12);
  adsr(g.gain, t, len, { a: 0.012, d: 0.1, s: 0.75, r: 0.1, peak: vel });
}

/** Funk guitar: a quick strum of the chord through a wah. */
export function guitar(b: Band, out: AudioNode, t: number, chord: string[], vel = 1, { wah = 1400, len = 0.07 } = {}) {
  const ctx = b.ctx, bp = filt(ctx, 'bandpass', wah, 2.2), g = gain(ctx, 0);
  bp.connect(g).connect(out);
  chord.forEach((m, k) => {
    const s = t + k * 0.006, o = osc(ctx, 'sawtooth', note(m), s, s + len + 0.08), og = gain(ctx, 0);
    o.connect(og).connect(bp);
    perc(og.gain, s, 0.5, len + 0.04, 0.002);
  });
  const nz = noise(ctx, t, 0.05), ng = gain(ctx, 0), nb = filt(ctx, 'bandpass', 2200, 1);
  perc(ng.gain, t, 0.35, 0.03);
  nz.connect(nb).connect(ng).connect(bp);
  bp.frequency.setValueAtTime(wah * 0.6, t);
  bp.frequency.linearRampToValueAtTime(wah * 1.6, t + 0.05);
  perc(g.gain, t, vel, len + 0.06, 0.002);
}
