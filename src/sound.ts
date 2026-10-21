// Music and sound effects. The music is seven looping disco tracks from public/assets/music, loaded with the art before the
// menu: one for the main menu, one for the map, the events and everything else outside a fight, a fight tune for each
// floor and the boss's theme, with its second half for the boss's second phase; they cross-fade into each other. The
// sound effects are synthesized on the spot.
// Nothing sounds before the player's first tap (browsers allow sound only after one), and the whole audio engine sleeps
// while both volumes are down to zero or the page is hidden, so it costs a phone nothing then.

import { music as musicFiles } from './assets';
import { playSfx, type Sfx } from './audio/sfx';
import type { Band } from './audio/synth';
import { settings } from './settings';

export type { Sfx } from './audio/sfx';
/** The main menu's tune, the one outside fights, the fight tune of floor 0, 1 or 2, and the boss's theme and its second phase. */
export type Track = 'menu' | 'calm' | `fight${number}` | 'boss' | 'bossRage';

/** The boss's theme and its second phase are one loop with more on top: one takes over from the other where it is. */
const BOSS: Track[] = ['boss', 'bossRage'];

/**
 * The hand on the record when the boss comes in (thread «Появление босса»): where the needle is, in seconds of the tune
 * against where it was, at each moment. The hand stops the record, drags it back, pushes it on, drags it back and lets go;
 * between those it eases in and out, as a hand does.
 */
const SCRATCH: [number, number][] = [[0.08, 0.04], [0.2, -0.17], [0.29, 0.03], [0.46, -0.32]];
/** When the music is cut instead: the record player is switched off and the record runs down this long. */
const SPIN_DOWN = 0.9;

/** Seconds of the files' head before the loop: the loop is [PAD, PAD + loop], so a seam never lands on the mp3's padding. */
const PAD = 0.3;
/** The music during the enemies' turn: muffled, as if heard through a wall. */
const MUFFLED_HZ = 650;
/** A decoded track not heard for this long is let go (a minute of music is tens of megabytes); it decodes again when needed. */
const KEEP_MS = 45_000;
/** The shortest gap between two of the same sound: a disc rattling along a wall makes one clatter, not forty. */
const GAP: Partial<Record<Sfx, number>> = { wall: 0.045, hit: 0.05, step: 0.06, ore: 0.08, sparks: 0.08, herb: 0.1, ice: 0.06, armor: 0.08, hurt: 0.12, click: 0.03, zap: 0.06, eat: 0.1, boom: 0.06, gas: 0.15, freeze: 0.06 };
/** Sounds a beat of their own: under them the music dips for a moment. */
const DIP: Partial<Record<Sfx, number>> = { win: 2.6, lose: 2.4, enemyTurn: 0.6, yourTurn: 0.5 };

/** A slider's position 0..1 to a gain: the ear hears loudness about this way. */
const level = (v: number) => v * v;

interface Playing { track: Track; src: AudioBufferSourceNode; gain: GainNode; at: number; loop: number }

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private dip!: GainNode;
  private lowpass!: BiquadFilterNode;
  private fxBus!: GainNode;
  private band!: Band;
  private lfos = new Map<string, AudioNode>();
  private last = new Map<Sfx, number>();
  /** Decoded tracks, and when each was last heard. */
  private decoded = new Map<Track, { buf: Promise<AudioBuffer>; used: number }>();
  /** Where each track was left off, so going back to the map picks the tune up where it was. */
  private resumeAt = new Map<Track, number>();
  private playing: Playing | null = null;
  private want: Track | null = null;
  private muffled = false;

  /** Start the engine on the player's first tap or key: from then on sound may play. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.awake()) this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    // a soft limiter on everything, for the moments many sounds land at once
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.connect(lim).connect(ctx.destination);
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000; this.lowpass.Q.value = 0.9;
    this.musicBus = ctx.createGain();
    this.dip = ctx.createGain();
    this.musicBus.connect(this.dip).connect(this.lowpass).connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    // a small room around the sounds
    const sr = ctx.sampleRate, L = Math.floor(sr * 0.5), ir = ctx.createBuffer(2, L, sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 4); }
    const room = ctx.createConvolver(), send = ctx.createGain();
    room.buffer = ir;
    send.gain.value = 0.12;
    this.fxBus.connect(send).connect(room).connect(this.master);
    this.band = { ctx, lfo: (name, rate, depth) => this.lfo(name, rate, depth) };
    this.volumes();
    if (!this.awake()) ctx.suspend().catch(() => {});
    if (this.want) { const w = this.want; this.want = null; this.music(w); }
  }

  /** Whether the engine should run: something to hear and the page in view. */
  private awake() {
    return (settings.music > 0 || settings.sfx > 0) && document.visibilityState !== 'hidden';
  }

  private lfo(name: string, rate: number, depth: number) {
    let g = this.lfos.get(name);
    if (!g) {
      const ctx = this.ctx!, o = ctx.createOscillator(), gg = ctx.createGain();
      o.frequency.value = rate; gg.gain.value = depth;
      o.connect(gg);
      o.start();
      this.lfos.set(name, (g = gg));
    }
    return g;
  }

  /** Apply the volumes from the settings. */
  volumes() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(level(settings.music), now, 0.05);
    this.fxBus.gain.setTargetAtTime(level(settings.sfx) * 1.1, now, 0.05);
    if (this.awake() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    // the fade out has time to finish before the engine stops
    else if (!this.awake() && ctx.state === 'running') setTimeout(() => { if (!this.awake()) ctx.suspend().catch(() => {}); }, 150);
  }

  /** Play a sound now; p is how hard (a soft bounce, a hard one). Quiet before the first tap, with the sounds down to zero, and for repeats too close together. */
  play(ev: Sfx, p = 0.7) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || settings.sfx <= 0) return;
    const now = ctx.currentTime, gap = GAP[ev] ?? 0.02;
    if (now - (this.last.get(ev) ?? -1) < gap) return;
    this.last.set(ev, now);
    playSfx(this.band, this.fxBus, ev, now + 0.005, Math.max(0, Math.min(1, p)));
    const dip = DIP[ev];
    if (dip) {
      const g = this.dip.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0.35, now, 0.05);
      g.setTargetAtTime(1, now + dip, 0.4);
    }
  }

  /**
   * The needle scratched across the record that plays, and the music stops dead: the tune itself is dragged under the
   * hand ('scratch') or runs down like a record player switched off ('stop'). Nothing playing, nothing to scratch:
   * whether there was.
   */
  scratch(how: 'scratch' | 'stop' = 'scratch') {
    const ctx = this.ctx, p = this.playing;
    if (!ctx || !p?.src.buffer || ctx.state !== 'running' || settings.music <= 0) return false;
    const now = ctx.currentTime, buf = p.src.buffer, sr = buf.sampleRate, pos = ((now - p.at) % p.loop + p.loop) % p.loop;
    // the tune stops under the hand: its own fade would be heard; whatever is wanted next starts afresh
    this.playing = null;
    this.want = null;
    this.resumeAt.set(p.track, pos);
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setTargetAtTime(0, now, 0.004);
    p.src.stop(now + 0.05);
    // where the needle is t seconds in, against where it was
    const len = how === 'stop' ? SPIN_DOWN : SCRATCH[SCRATCH.length - 1][0];
    const at = (t: number) => {
      if (how === 'stop') return (SPIN_DOWN / 2.5) * (1 - (1 - t / SPIN_DOWN) ** 2.5);
      // the record first slows to a stop under the hand
      const t0 = SCRATCH[0][0];
      if (t < t0) return t - (t * t) / (2 * t0);
      for (let i = 1; i < SCRATCH.length; i++) {
        const [a, xa] = SCRATCH[i - 1], [b, xb] = SCRATCH[i];
        if (t <= b) return xa + (xb - xa) * (0.5 - 0.5 * Math.cos((Math.PI * (t - a)) / (b - a)));
      }
      return SCRATCH[SCRATCH.length - 1][1];
    };
    const N = Math.ceil(len * sr), out = ctx.createBuffer(buf.numberOfChannels, N, sr), fade = Math.floor(0.02 * sr);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (let i = 0; i < N; i++) {
        // read the tune where the needle is, wrapped into the loop, between two samples
        const x = PAD + ((((pos + at(i / sr)) % p.loop) + p.loop) % p.loop), j = Math.floor(x * sr), f = x * sr - j;
        dst[i] = ((src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f) * Math.min(1, (N - i) / fade);
      }
    }
    // the rumble of a record dragged slowly is cut, as a DJ's mixer does
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 110;
    g.gain.value = Math.max(0.3, p.gain.gain.value);
    s.buffer = out;
    s.connect(hp).connect(g).connect(this.musicBus);
    s.start(now + 0.004);
    return true;
  }

  /** Decode these tracks now, so they start on the beat when they are wanted. */
  prepare(...tracks: Track[]) {
    if (this.ctx) for (const t of tracks) if (musicFiles.get(t)) void this.buffer(t);
  }

  /** The enemies are taking their turn: the music goes dull. */
  muffle(on: boolean) {
    if (on === this.muffled || !this.ctx) return;
    this.muffled = on;
    this.lowpass.frequency.setTargetAtTime(on ? MUFFLED_HZ : 20000, this.ctx.currentTime, on ? 0.12 : 0.25);
  }

  /** Which tune plays (null: none); a change cross-fades. */
  music(track: Track | null) {
    const ctx = this.ctx;
    if (!ctx) { this.want = track; return; }
    if (this.want === track) return;
    this.want = track;
    // the boss's two phases go on from each other's place; the boss's theme starts from the top, and at once after silence
    const was = this.playing, follow = was && BOSS.includes(was.track) && BOSS.includes(track!) ? was : null, sharp = !was;
    this.stopMusic();
    if (!track) return;
    const file = musicFiles.get(track);
    // still loading: the next call tries again
    if (!file) { this.want = null; return; }
    this.buffer(track).then(buf => {
      if (!buf || this.want !== track || this.playing) return;
      const src = ctx.createBufferSource(), g = ctx.createGain(), loop = Math.min(file.loop, buf.duration - PAD);
      src.buffer = buf;
      src.loop = true;
      src.loopStart = PAD;
      src.loopEnd = PAD + loop;
      g.gain.value = 0;
      g.gain.setTargetAtTime(1, ctx.currentTime, sharp && BOSS.includes(track) ? 0.01 : 0.4);
      src.connect(g).connect(this.musicBus);
      const at = ctx.currentTime + 0.02;
      const from = follow ? ((((at - follow.at) % follow.loop) + follow.loop) % follow.loop) % loop : BOSS.includes(track) ? 0 : this.resumeAt.get(track) ?? 0;
      src.start(at, PAD + from);
      this.playing = { track, src, gain: g, at: at - from, loop };
    });
  }

  private stopMusic() {
    const p = this.playing, ctx = this.ctx;
    if (!p || !ctx) return;
    this.playing = null;
    this.resumeAt.set(p.track, ((ctx.currentTime - p.at) % p.loop + p.loop) % p.loop);
    p.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
    p.src.stop(ctx.currentTime + 2);
    const d = this.decoded.get(p.track);
    if (d) d.used = performance.now();
    setTimeout(() => this.drop(), KEEP_MS + 1000);
  }

  /** Let go of decoded tracks that haven't played for a while. */
  private drop() {
    for (const [k, d] of this.decoded) if (this.playing?.track !== k && this.want !== k && performance.now() - d.used > KEEP_MS) this.decoded.delete(k);
  }

  private buffer(track: Track): Promise<AudioBuffer | null> {
    const ctx = this.ctx!, file = musicFiles.get(track)!;
    let d = this.decoded.get(track);
    if (!d) {
      // the bytes are decoded from a copy: decoding takes the buffer it is given
      const buf = new Promise<AudioBuffer>((ok, no) => ctx.decodeAudioData(file.data.slice(0), ok, no));
      this.decoded.set(track, (d = { buf, used: performance.now() }));
    }
    d.used = performance.now();
    return d.buf.catch(() => { this.decoded.delete(track); return null; });
  }
}

export const sound = new Sound();

// the first tap or key wakes the sound; every button pressed clicks
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
document.addEventListener('click', e => {
  const b = (e.target as Element | null)?.closest?.('button');
  if (b && !b.disabled) sound.play('click');
}, { capture: true });
document.addEventListener('visibilitychange', () => sound.volumes());
