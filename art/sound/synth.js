// A small Web Audio synth: drums, bass, keys, strings, brass and leads, a mixer with reverb and delay.
// Every instrument is a function (mix, t, f, len, vel, opt) that schedules its own nodes; it works in a live
// AudioContext and in an OfflineAudioContext alike.

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A4', 'C#5', 'Bb3' to a MIDI number; numbers pass through. */
export function n(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (+m[3] + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const noiseOf = new WeakMap();
/** Two seconds of white noise, one buffer per context. */
export function noiseBuf(ctx) {
  let b = noiseOf.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 2147483648) - 1; }
    noiseOf.set(ctx, b);
  }
  return b;
}

export function noise(ctx, t, len) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf(ctx);
  s.loop = true;
  // where in the buffer it starts depends on the time only, so a render comes out the same every time
  s.start(t, ((t * 7919.31) % 1) * 1.5);
  s.stop(t + len + 0.05);
  return s;
}

export function osc(ctx, type, f, t, stop, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

export function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }

export function filt(ctx, type, f, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  return b;
}

/** A percussive hit on a gain: up to `peak` at once, then down to silence over `dec` seconds. */
export function perc(p, t, peak, dec, a = 0.001) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + dec);
  p.setValueAtTime(0, t + a + dec + 0.001);
}

/** Attack, decay to sustain, hold to `len`, release. Returns when the sound is over. */
export function adsr(p, t, len, { a = 0.005, d = 0.1, s = 0.7, r = 0.1, peak = 1 } = {}) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3);
  const te = t + Math.max(len, a + 0.001);
  p.setTargetAtTime(0, te, r / 4);
  return te + r * 1.6;
}

/** An impulse response for the reverb: decaying stereo noise, darker as it goes. */
function impulse(ctx, secs = 2.2, decay = 3.2, bright = 0.5) {
  const sr = ctx.sampleRate, L = Math.floor(sr * secs), b = ctx.createBuffer(2, L, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 777 + c * 999, lp = 0;
    for (let i = 0; i < L; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const w = (s / 2147483648) - 1, u = i / L;
      // one-pole lowpass closing over time
      const k = bright * (1 - u) + 0.04;
      lp += k * (w - lp);
      d[i] = lp * Math.pow(1 - u, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
  }
  return b;
}

/** The mixer: named channels with volume, pan, filters and sends into a shared reverb and a ping-pong delay. */
export class Mix {
  constructor(ctx, { bpm = 120, out = ctx.destination, rev = 2.2, master = 0.5, limit = true, loop = 0 } = {}) {
    this.ctx = ctx;
    /** Length of the loop being rendered: the LFOs then make whole cycles in it, so every pass sounds the same. */
    this.loop = loop;
    this.bpm = bpm;
    this.beat = 60 / bpm;
    this.master = gain(ctx, master);
    if (limit) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 2.5; comp.knee.value = 8; comp.attack.value = 0.012; comp.release.value = 0.16;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.001; lim.release.value = 0.08;
      this.master.connect(comp).connect(lim).connect(out);
    } else this.master.connect(out);
    this.rev = ctx.createConvolver();
    this.rev.buffer = impulse(ctx, rev);
    this.revIn = filt(ctx, 'highpass', 250);
    this.revIn.connect(this.rev);
    this.rev.connect(gain(ctx, 0.9)).connect(this.master);
    // ping-pong delay, three sixteenths
    const dt = this.beat * 0.75;
    this.dlyIn = gain(ctx, 1);
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2), fb = gain(ctx, 0.32), lp = filt(ctx, 'lowpass', 2800);
    dl.delayTime.value = dt; dr.delayTime.value = dt;
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
    pl.pan.value = -0.7; pr.pan.value = 0.7;
    this.dlyIn.connect(dl);
    dl.connect(pl).connect(this.master);
    dl.connect(dr);
    dr.connect(pr).connect(this.master);
    dr.connect(lp).connect(fb).connect(dl);
    this.ch = {};
    this.lfos = {};
  }

  /** A channel strip; instruments connect to what this returns. */
  channel(name, { vol = 1, pan = 0, rev = 0, dly = 0, hp = 0, lp = 0, duck = 0 } = {}) {
    if (this.ch[name]) return this.ch[name].input;
    const ctx = this.ctx, input = gain(ctx, 1);
    let node = input;
    if (hp) { const f = filt(ctx, 'highpass', hp); node.connect(f); node = f; }
    if (lp) { const f = filt(ctx, 'lowpass', lp); node.connect(f); node = f; }
    const v = gain(ctx, vol), d = gain(ctx, 1), p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(d).connect(v).connect(p).connect(this.master);
    if (rev) node.connect(gain(ctx, rev)).connect(this.revIn);
    if (dly) node.connect(gain(ctx, dly)).connect(this.dlyIn);
    this.ch[name] = { input, vol: v, duck: d, duckBy: duck };
    return input;
  }

  /** Pump the ducked channels down on every kick. */
  pump(t) {
    if (t < 0) return;
    for (const c of Object.values(this.ch)) {
      if (!c.duckBy) continue;
      const g = c.duck.gain;
      g.setValueAtTime(1 - c.duckBy, t);
      g.setTargetAtTime(1, t + 0.02, this.beat * 0.22);
    }
  }

  /** A shared LFO by name: a sine at `rate` Hz scaled by `depth`. */
  lfo(name, rate, depth) {
    if (this.lfos[name]) return this.lfos[name];
    const o = this.ctx.createOscillator(), g = gain(this.ctx, depth);
    o.frequency.value = this.loop ? Math.round(rate * this.loop) / this.loop : rate;
    o.connect(g);
    o.start(0);
    this.lfos[name] = g;
    return g;
  }
}

// ------------------------------------------------------------------ drums

export function kick(mix, out, t, vel = 1, { f0 = 150, f1 = 48, dec = 0.42, click = 0.35 } = {}) {
  const ctx = mix.ctx, o = osc(ctx, 'sine', f0, t, t + dec + 0.05), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f1 * 1.15, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.3);
  perc(g.gain, t, vel, dec);
  o.connect(g).connect(out);
  // a little beater click
  const nz = noise(ctx, t, 0.02), hp = filt(ctx, 'highpass', 2500), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * click, 0.012);
  nz.connect(hp).connect(ng).connect(out);
}

export function clap(mix, out, t, vel = 1, { f = 1150, tail = 0.2 } = {}) {
  const ctx = mix.ctx, nz = noise(ctx, t, 0.4), bp = filt(ctx, 'bandpass', f, 0.9), hp = filt(ctx, 'highpass', 500), g = gain(ctx, 0);
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

export function snare(mix, out, t, vel = 1, { f = 190, tone = 0.5, dec = 0.16, snappy = 1 } = {}) {
  const ctx = mix.ctx;
  const o = osc(ctx, 'triangle', f * 1.3, t, t + 0.2), og = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
  perc(og.gain, t, vel * tone, 0.09);
  o.connect(og).connect(out);
  const nz = noise(ctx, t, dec + 0.05), hp = filt(ctx, 'highpass', 1800), bp = filt(ctx, 'peaking', 5000, 1), ng = gain(ctx, 0);
  bp.gain.value = 4;
  perc(ng.gain, t, vel * 0.8 * snappy, dec);
  nz.connect(hp).connect(bp).connect(ng).connect(out);
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
export function hat(mix, out, t, vel = 1, { open = false, dec } = {}) {
  const ctx = mix.ctx, len = dec ?? (open ? 0.24 : 0.04);
  const bp = filt(ctx, 'bandpass', 10000, 0.8), hp = filt(ctx, 'highpass', 7000), g = gain(ctx, 0);
  for (const r of HAT_RATIOS) osc(ctx, 'square', 40 * r * 10, t, t + len + 0.05).connect(bp);
  const nz = noise(ctx, t, len + 0.05), ng = gain(ctx, 0.5);
  nz.connect(ng).connect(hp);
  bp.connect(hp).connect(g).connect(out);
  perc(g.gain, t, vel * 0.32, len, 0.0015);
}

export function shaker(mix, out, t, vel = 1, { dec = 0.06, f = 7500 } = {}) {
  const ctx = mix.ctx, nz = noise(ctx, t, dec + 0.05), bp = filt(ctx, 'bandpass', f, 1.2), g = gain(ctx, 0);
  perc(g.gain, t, vel * 0.7, dec, 0.012);
  nz.connect(bp).connect(g).connect(out);
}

export function tamb(mix, out, t, vel = 1) {
  const ctx = mix.ctx;
  shaker(mix, out, t, vel * 0.8, { dec: 0.12, f: 9000 });
  const bp = filt(ctx, 'bandpass', 7200, 6), g = gain(ctx, 0);
  for (const f of [5320, 6870, 8130]) osc(ctx, 'square', f, t, t + 0.25).connect(bp);
  bp.connect(g).connect(out);
  perc(g.gain, t, vel * 0.12, 0.16, 0.003);
}

export function cowbell(mix, out, t, vel = 1, { f = 560 } = {}) {
  const ctx = mix.ctx, bp = filt(ctx, 'bandpass', f * 1.9, 1.6), g = gain(ctx, 0);
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
export function syndrum(mix, out, t, vel = 1, { f0 = 700, f1 = 140, dec = 0.45 } = {}) {
  const ctx = mix.ctx, o = osc(ctx, 'sine', f0, t, t + dec + 0.05), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.9);
  perc(g.gain, t, vel * 0.8, dec, 0.002);
  o.connect(g).connect(out);
  const nz = noise(ctx, t, 0.05), bp = filt(ctx, 'bandpass', 3000, 1), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.15, 0.03);
  nz.connect(bp).connect(ng).connect(out);
}

export function tom(mix, out, t, vel = 1, { f = 160 } = {}) {
  const ctx = mix.ctx, o = osc(ctx, 'sine', f * 1.6, t, t + 0.5), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  perc(g.gain, t, vel * 0.9, 0.35, 0.002);
  o.connect(g).connect(out);
  const nz = noise(ctx, t, 0.08), lp = filt(ctx, 'lowpass', 2500), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.2, 0.05);
  nz.connect(lp).connect(ng).connect(out);
}

/** Wood: a block or a xylophone of bones. Partials 1 and ~3, very short. */
export function xylo(mix, out, t, f, len, vel = 1, { ratio = 3.98, dec = 0.35 } = {}) {
  const ctx = mix.ctx, g = gain(ctx, 0), g2 = gain(ctx, 0);
  osc(ctx, 'sine', f, t, t + dec + 0.1).connect(g).connect(out);
  osc(ctx, 'sine', f * ratio, t, t + 0.12).connect(g2).connect(out);
  perc(g.gain, t, vel * 0.6, dec, 0.001);
  perc(g2.gain, t, vel * 0.25, 0.05, 0.001);
  const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', f * 6, 2), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.35, 0.008);
  nz.connect(bp).connect(ng).connect(out);
}

// ------------------------------------------------------------------ bass

/** Funky synth bass: saw and square through a lowpass that pops open on each note. */
export function bass(mix, out, t, f, len, vel = 1, { cut = 380, env = 1600, q = 5, dec = 0.13, sub = 0.3, rel = 0.04 } = {}) {
  const ctx = mix.ctx, end = t + len + rel * 2 + 0.05;
  const lp = filt(ctx, 'lowpass', cut, q), g = gain(ctx, 0);
  const a = osc(ctx, 'sawtooth', f, t, end), b = osc(ctx, 'square', f, t, end, -6), s = osc(ctx, 'sine', f, t, end);
  const ag = gain(ctx, 0.5), bg = gain(ctx, 0.25), sg = gain(ctx, sub);
  a.connect(ag).connect(lp); b.connect(bg).connect(lp); s.connect(sg).connect(g);
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

/** A rounder, bowed-tuba kind of bass for the spooky tune. */
export function tuba(mix, out, t, f, len, vel = 1) {
  const ctx = mix.ctx, end = t + len + 0.2;
  const lp = filt(ctx, 'lowpass', 500, 1.5), g = gain(ctx, 0);
  const a = osc(ctx, 'sawtooth', f, t, end), s = osc(ctx, 'sine', f, t, end);
  a.frequency.setValueAtTime(f * 0.97, t);
  a.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  a.connect(gain(ctx, 0.5)).connect(lp);
  s.connect(gain(ctx, 0.7)).connect(g);
  lp.connect(g).connect(out);
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.linearRampToValueAtTime(900 * vel, t + 0.03);
  lp.frequency.setTargetAtTime(420, t + 0.03, 0.08);
  adsr(g.gain, t, len, { a: 0.012, d: 0.12, s: 0.7, r: 0.06, peak: vel * 0.8 });
}

// ------------------------------------------------------------------ keys

/** Electric piano: two-operator FM with a bell-like tine on top. */
export function epiano(mix, out, t, f, len, vel = 1, { bright = 1 } = {}) {
  const ctx = mix.ctx, end = t + len + 0.6;
  const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f, t, end), mg = gain(ctx, 0);
  mod.connect(mg).connect(car.frequency);
  const mi = mg.gain;
  mi.setValueAtTime(f * 2.2 * vel * bright, t);
  mi.setTargetAtTime(f * 0.25, t, 0.25);
  const tine = osc(ctx, 'sine', f * 14, t, t + 0.3), tg = gain(ctx, 0);
  tine.connect(tg).connect(car.frequency);
  perc(tg.gain, t, f * 1.8 * vel, 0.06);
  const g = gain(ctx, 0);
  car.connect(g).connect(out);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.42, t + 0.003);
  p.setTargetAtTime(vel * 0.16, t + 0.003, 0.5);
  p.setTargetAtTime(0, t + len, 0.12);
}

/** Organ: drawbar sines, a key click, vibrato from the mixer's "vib" LFO. */
export function organ(mix, out, t, f, len, vel = 1, { bars = [0.6, 1, 0.55, 0.35, 0, 0.2], click = 0.15 } = {}) {
  const ctx = mix.ctx, end = t + len + 0.2, g = gain(ctx, 0), ratios = [0.5, 1, 2, 3, 4, 6];
  const vib = mix.lfo('vib', 6.2, 9);
  bars.forEach((a, k) => {
    if (!a) return;
    const o = osc(ctx, 'sine', f * ratios[k], t, end);
    vib.connect(o.detune);
    o.connect(gain(ctx, a * 0.16)).connect(g);
  });
  g.connect(out);
  adsr(g.gain, t, len, { a: 0.006, d: 0.05, s: 1, r: 0.05, peak: vel });
  if (click) {
    const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', 2500, 1), ng = gain(ctx, 0);
    perc(ng.gain, t, click * vel, 0.006);
    nz.connect(bp).connect(ng).connect(out);
  }
}

/** Harpsichord: bright, plucked, quick to fade. */
export function harpsi(mix, out, t, f, len, vel = 1) {
  const ctx = mix.ctx, dec = 0.9, end = t + dec + 0.1;
  const hp = filt(ctx, 'highpass', 250), lp = filt(ctx, 'lowpass', 5500, 0.9), g = gain(ctx, 0);
  osc(ctx, 'sawtooth', f, t, end, -4).connect(gain(ctx, 0.35)).connect(hp);
  osc(ctx, 'sawtooth', f * 2, t, end, 5).connect(gain(ctx, 0.2)).connect(hp);
  osc(ctx, 'square', f, t, end).connect(gain(ctx, 0.15)).connect(hp);
  hp.connect(lp).connect(g).connect(out);
  lp.frequency.setValueAtTime(7000, t);
  lp.frequency.setTargetAtTime(2200, t, 0.15);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.5, t + 0.002);
  p.setTargetAtTime(vel * 0.18, t + 0.002, 0.12);
  p.setTargetAtTime(0, t + Math.min(len, dec), 0.06);
  const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', 3500, 1.5), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.2, 0.006);
  nz.connect(bp).connect(ng).connect(out);
}

/** A bell for accents: inharmonic FM. */
export function bell(mix, out, t, f, len, vel = 1, { ratio = 3.5, dec = 1.4 } = {}) {
  const ctx = mix.ctx, end = t + dec + 0.1;
  const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f * ratio, t, end), mg = gain(ctx, 0);
  mod.connect(mg).connect(car.frequency);
  perc(mg.gain, t, f * 2.5, dec * 0.6);
  const g = gain(ctx, 0);
  car.connect(g).connect(out);
  perc(g.gain, t, vel * 0.35, dec, 0.002);
}

// ------------------------------------------------------------------ strings, brass, guitar, leads

/** String section: detuned saws spread in stereo, slow to swell. */
export function strings(mix, out, t, f, len, vel = 1, { a = 0.18, r = 0.5, cut = 3200, voices = 3 } = {}) {
  const ctx = mix.ctx, end = t + len + r * 2, lp = filt(ctx, 'lowpass', cut, 0.6), g = gain(ctx, 0);
  const vib = mix.lfo('svib', 5.1, 7);
  for (let k = 0; k < voices; k++) {
    const dt = voices === 1 ? 0 : (k / (voices - 1) - 0.5) * 18;
    const o = osc(ctx, 'sawtooth', f, t, end, dt), p = ctx.createStereoPanner();
    vib.connect(o.detune);
    p.pan.value = voices === 1 ? 0 : (k / (voices - 1) - 0.5) * 1.2;
    o.connect(gain(ctx, 0.22 / Math.sqrt(voices))).connect(p).connect(lp);
  }
  lp.connect(g).connect(out);
  adsr(g.gain, t, len, { a, d: 0.3, s: 0.85, r, peak: vel });
}

/** A string run: a fast scale up or down, each note a short bow. */
export function stringRun(mix, out, t, notes, step, vel = 1) {
  notes.forEach((m, k) => strings(mix, out, t + k * step, mtof(n(m)), step * 1.2, vel * (0.6 + 0.4 * k / notes.length), { a: 0.01, r: 0.12, voices: 2, cut: 4500 }));
}

/** Brass section stab: saws with a bright filter swell and a scoop up into pitch. */
export function brass(mix, out, t, f, len, vel = 1) {
  const ctx = mix.ctx, end = t + len + 0.3, lp = filt(ctx, 'lowpass', 600, 1.2), g = gain(ctx, 0);
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

/** Muted funk guitar: a quick strum through a wah, or just the scratch of the strings when `mute`. */
export function guitar(mix, out, t, chord, vel = 1, { mute = false, wah = 1400, len = 0.07 } = {}) {
  const ctx = mix.ctx, bp = filt(ctx, 'bandpass', wah, 2.2), g = gain(ctx, 0), d = mute ? 0.025 : len;
  bp.connect(g).connect(out);
  if (!mute) chord.forEach((m, k) => {
    const s = t + k * 0.006, f = mtof(n(m)), o = osc(ctx, 'sawtooth', f, s, s + d + 0.08), og = gain(ctx, 0);
    o.connect(og).connect(bp);
    perc(og.gain, s, 0.5, d + 0.04, 0.002);
  });
  const nz = noise(ctx, t, 0.05), ng = gain(ctx, 0), nb = filt(ctx, 'bandpass', 2200, 1);
  perc(ng.gain, t, mute ? 0.9 : 0.35, mute ? 0.022 : 0.03);
  nz.connect(nb).connect(ng).connect(bp);
  bp.frequency.setValueAtTime(wah * 0.6, t);
  bp.frequency.linearRampToValueAtTime(wah * 1.6, t + 0.05);
  perc(g.gain, t, vel, d + 0.06, 0.002);
}

/** Theremin: a sine with deep vibrato that slides from the note before. */
export function theremin(mix, out, t, f, len, vel = 1, { from, slide = 0.07 } = {}) {
  const ctx = mix.ctx, end = t + len + 0.4, o = osc(ctx, 'sine', from ?? f, t, end), g = gain(ctx, 0);
  if (from) o.frequency.setTargetAtTime(f, t, slide);
  const vib = mix.lfo('thvib', 5.6, 22);
  vib.connect(o.detune);
  const o2 = osc(ctx, 'triangle', from ?? f, t, end);
  if (from) o2.frequency.setTargetAtTime(f, t, slide);
  vib.connect(o2.detune);
  o.connect(g); o2.connect(gain(ctx, 0.25)).connect(g);
  g.connect(out);
  adsr(g.gain, t, len, { a: 0.06, d: 0.2, s: 0.9, r: 0.18, peak: vel * 0.5 });
}

/** 80s synth lead: square and saw, gliding and singing. */
export function lead(mix, out, t, f, len, vel = 1, { from, slide = 0.03, cut = 2600 } = {}) {
  const ctx = mix.ctx, end = t + len + 0.4, lp = filt(ctx, 'lowpass', cut, 2), g = gain(ctx, 0);
  const vib = mix.lfo('lvib', 5.4, 10);
  for (const [type, dt, a] of [['square', 0, 0.22], ['sawtooth', 7, 0.2], ['sawtooth', -7, 0.2]]) {
    const o = osc(ctx, type, from ?? f, t, end, dt);
    if (from) o.frequency.setTargetAtTime(f, t, slide);
    vib.connect(o.detune);
    o.connect(gain(ctx, a)).connect(lp);
  }
  lp.frequency.setValueAtTime(cut * 0.5, t);
  lp.frequency.linearRampToValueAtTime(cut, t + 0.04);
  lp.connect(g).connect(out);
  adsr(g.gain, t, len, { a: 0.008, d: 0.15, s: 0.8, r: 0.12, peak: vel * 0.5 });
}

/** Synth pad / poly brass of the 80s: saws with a slower filter. */
export function poly(mix, out, t, f, len, vel = 1, { cut = 1800, a = 0.02, r = 0.25 } = {}) {
  const ctx = mix.ctx, end = t + len + r * 2, lp = filt(ctx, 'lowpass', cut, 1), g = gain(ctx, 0);
  for (const dt of [-12, 0, 12]) osc(ctx, 'sawtooth', f, t, end, dt).connect(gain(ctx, 0.14)).connect(lp);
  lp.frequency.setValueAtTime(cut * 0.4, t);
  lp.frequency.linearRampToValueAtTime(cut, t + 0.05);
  lp.frequency.setTargetAtTime(cut * 0.7, t + 0.05, 0.2);
  lp.connect(g).connect(out);
  adsr(g.gain, t, len, { a, d: 0.2, s: 0.8, r, peak: vel });
}

/** Sequencer bass of Italo disco: short saw plucks. */
export function seqBass(mix, out, t, f, len, vel = 1, { cut = 300, env = 2400 } = {}) {
  const ctx = mix.ctx, end = t + len + 0.1, lp = filt(ctx, 'lowpass', cut, 7), g = gain(ctx, 0);
  osc(ctx, 'sawtooth', f, t, end).connect(gain(ctx, 0.4)).connect(lp);
  osc(ctx, 'sawtooth', f, t, end, 10).connect(gain(ctx, 0.3)).connect(lp);
  osc(ctx, 'sine', f, t, end).connect(gain(ctx, 0.35)).connect(g);
  lp.connect(g).connect(out);
  lp.frequency.setValueAtTime(cut + env * vel, t);
  lp.frequency.setTargetAtTime(cut, t, 0.05);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.7, t + 0.003);
  p.setTargetAtTime(0, t + len, 0.015);
}

/** A choir "ooh": a saw through vowel formants. */
export function choir(mix, out, t, f, len, vel = 1, { vowel = 'oo' } = {}) {
  const ctx = mix.ctx, end = t + len + 1, g = gain(ctx, 0);
  const F = vowel === 'aa' ? [[700, 1], [1100, 0.5], [2600, 0.2]] : [[320, 1], [800, 0.35], [2500, 0.1]];
  const vib = mix.lfo('cvib', 4.8, 12);
  const src = gain(ctx, 1);
  for (const dt of [-8, 6]) { const o = osc(ctx, 'sawtooth', f, t, end, dt); vib.connect(o.detune); o.connect(src); }
  for (const [ff, a] of F) src.connect(filt(ctx, 'bandpass', ff, 6)).connect(gain(ctx, a)).connect(g);
  g.connect(out);
  adsr(g.gain, t, len, { a: 0.3, d: 0.3, s: 0.9, r: 0.6, peak: vel * 1.4 });
}

/** Vibraphone: a soft sine bar with a quick overtone and the motor's tremolo. */
export function vibes(mix, out, t, f, len, vel = 1, { dec = 1.8 } = {}) {
  const ctx = mix.ctx, d = Math.min(dec, len + 0.9), end = t + d + 0.1, g = gain(ctx, 0), trem = gain(ctx, 1);
  mix.lfo('trem', 5.2, 0.25).connect(trem.gain);
  osc(ctx, 'sine', f, t, end).connect(g);
  const g4 = gain(ctx, 0);
  osc(ctx, 'sine', f * 4, t, t + 0.4).connect(g4).connect(trem);
  perc(g4.gain, t, vel * 0.1, 0.22, 0.002);
  g.connect(trem).connect(out);
  perc(g.gain, t, vel * 0.45, d, 0.004);
  const nz = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', f * 3, 2), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * 0.08, 0.008);
  nz.connect(bp).connect(ng).connect(out);
}

/** Conga: a skin that drops a little in pitch; a slap is shorter and brighter. */
export function conga(mix, out, t, vel = 1, { f = 220, dec = 0.16, slap = false } = {}) {
  const ctx = mix.ctx, o = osc(ctx, 'sine', f * 1.25, t, t + dec + 0.05), g = gain(ctx, 0);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
  perc(g.gain, t, vel * 0.8, slap ? dec * 0.6 : dec, 0.002);
  o.connect(g).connect(out);
  const nz = noise(ctx, t, 0.03), bp = filt(ctx, 'bandpass', slap ? 3200 : 1600, 1.2), ng = gain(ctx, 0);
  perc(ng.gain, t, vel * (slap ? 0.55 : 0.15), slap ? 0.03 : 0.012);
  nz.connect(bp).connect(ng).connect(out);
}

/** A crash cymbal: a long bright hiss. */
export function crash(mix, out, t, vel = 1, { dec = 1.8 } = {}) {
  const ctx = mix.ctx, nz = noise(ctx, t, dec + 0.2), hp = filt(ctx, 'highpass', 5000), g = gain(ctx, 0);
  nz.connect(hp).connect(g).connect(out);
  perc(g.gain, t, vel * 0.5, dec, 0.002);
}
