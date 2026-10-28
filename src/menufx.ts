// The hall behind the main menu (menu_bg / menu_bg_tall) a little alive: light on a canvas laid over the picture, drawn
// at most 20 times a second and only while the menu is up, so the phone has no more to do than in a room standing still.
// Nothing moves when the system asks for less motion or the graphics are set low. Everything is placed in the picture's
// own pixels (parts2/comp/hall3_*.json of the menu background) and follows it as the stylesheet covers the screen with it.
//
// Variants to pick from (?menufx=a|b|c|d), thread «Оживить фон главного меню»:
//   a: the mirror ball turns: spots of light sweep over the walls and the floor, sparks flash on the ball
//   b: the torches flicker and dust floats in the three beams
//   c: the three beams breathe in turn and a white spotlight sweeps the dance floor
//   d: a little of everything: fewer and dimmer spots, sparks on the ball, torches, dust

import { settings } from './settings';

type XY = [number, number];
type RGB = [number, number, number];

interface Beam {
  from: XY;
  to: [XY, XY];
  rgb: RGB;
  /** The light's pool on the floor: centre and half sizes. */
  pool: [number, number, number, number];
}

interface Hall {
  w: number;
  h: number;
  /** The mirror ball: centre and radius. */
  ball: [number, number, number];
  /** The flames. */
  torches: XY[];
  /** Where the floor starts, going down: spots below it lie flat. */
  floorY: number;
  /** The dance floor's middle and how far a spotlight sweeps either way. */
  stage: [number, number, number];
  beams: Beam[];
}

const HALLS: Record<'pc' | 'tall', Hall> = {
  pc: {
    w: 1536, h: 1024, ball: [1086, 305, 104], torches: [[180, 305], [335, 335], [1205, 340], [1375, 305]], floorY: 712, stage: [768, 860, 330],
    beams: [
      { from: [1080, 250], to: [[430, 930], [640, 960]], rgb: [150, 90, 230], pool: [535, 945, 150, 36] },
      { from: [200, 0], to: [[760, 850], [930, 860]], rgb: [240, 180, 50], pool: [845, 855, 120, 28] },
      { from: [1400, 0], to: [[1000, 960], [1180, 955]], rgb: [50, 200, 180], pool: [1090, 958, 130, 32] },
    ],
  },
  tall: {
    w: 1024, h: 1536, ball: [723, 230, 85], torches: [[140, 580], [884, 575]], floorY: 1075, stage: [512, 1330, 260],
    beams: [
      { from: [720, 180], to: [[300, 1450], [470, 1480]], rgb: [150, 90, 230], pool: [385, 1465, 130, 32] },
      { from: [160, 0], to: [[560, 1460], [700, 1480]], rgb: [240, 180, 50], pool: [630, 1470, 100, 26] },
      { from: [900, 0], to: [[600, 1480], [780, 1490]], rgb: [50, 200, 180], pool: [690, 1485, 120, 28] },
    ],
  },
};

type Variant = 'a' | 'b' | 'c' | 'd' | 'off';
const VARIANT: Variant = (() => {
  const v = new URLSearchParams(location.search).get('menufx');
  return v === 'a' || v === 'b' || v === 'c' || v === 'off' ? v : 'd';
})();

/** At most this many drawings a second. */
const FPS = Number(new URLSearchParams(location.search).get('menufps')) || 20;
/** The canvas holds at most about this many pixels, so a big screen costs no more than a laptop. */
const MAX_PIXELS = 2.6e6;

const SPOT_RGB: RGB[] = [[245, 238, 255], [245, 238, 255], [200, 160, 255], [130, 235, 225], [255, 225, 140], [255, 160, 215]];

/** A number from 0 to 1 that is always the same for the same i. */
const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** A soft round light, bright in the middle (or crisp: a mirror's spot, lit to near its edge); drawn once, then stamped. */
function softDot(rgb: RGB, size = 64, crisp = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!, r = size / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
  const [R, G, B] = rgb;
  grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
  grad.addColorStop(crisp ? 0.45 : 0.25, `rgba(${R},${G},${B},0.85)`);
  grad.addColorStop(crisp ? 0.62 : 0.55, `rgba(${R},${G},${B},${crisp ? 0.35 : 0.25})`);
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** A four-pointed spark, as the ones painted round the ball. */
function sparkSprite(size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!, r = size / 2;
  g.translate(r, r);
  for (const [w, len, a] of [[0.07, 1, 1], [0.035, 0.62, 0.7]] as const) {
    for (let k = 0; k < (len === 1 ? 2 : 4); k++) {
      g.save();
      g.rotate((k * Math.PI) / (len === 1 ? 2 : 4) + (len === 1 ? 0 : Math.PI / 4));
      const grad = g.createLinearGradient(0, -r * len, 0, r * len);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -r * len);
      g.lineTo(r * w, 0);
      g.lineTo(0, r * len);
      g.lineTo(-r * w, 0);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(-r, -r, size, size);
  return c;
}

interface Cone { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }

/** A light cone from a point down to a span, soft at its sides and fading as it goes; drawn once at a quarter size and
 * only as big as the cone, so stamping it fills no more of the screen than the light takes. */
function coneSprite(from: XY, to: [XY, XY], rgb: RGB, alpha: number): Cone {
  const k = 0.25, c = document.createElement('canvas'), SPREAD = 6, STEP = 0.09;
  const mid: XY = [(to[0][0] + to[1][0]) / 2, (to[0][1] + to[1][1]) / 2], half = (to[1][0] - to[0][0]) / 2;
  const wide = half * (1 + (SPREAD - 1) * STEP);
  const x = Math.floor(Math.min(from[0], mid[0] - wide)), y = Math.floor(Math.min(from[1], to[0][1], to[1][1]));
  const w = Math.ceil(Math.max(from[0], mid[0] + wide)) - x, h = Math.ceil(Math.max(from[1], to[0][1], to[1][1])) - y;
  c.width = Math.max(1, Math.ceil(w * k));
  c.height = Math.max(1, Math.ceil(h * k));
  const g = c.getContext('2d')!;
  g.scale(k, k);
  g.translate(-x, -y);
  const [R, G, B] = rgb;
  const grad = g.createLinearGradient(from[0], from[1], mid[0], mid[1]);
  grad.addColorStop(0, `rgba(${R},${G},${B},${alpha})`);
  grad.addColorStop(1, `rgba(${R},${G},${B},${alpha * 0.45})`);
  g.fillStyle = grad;
  // a few cones each a little wider and fainter make soft sides without a blur filter
  for (let i = 0; i < SPREAD; i++) {
    const spread = 1 + i * STEP;
    g.globalAlpha = i === 0 ? 0.55 : 0.12;
    g.beginPath();
    g.moveTo(from[0], from[1]);
    g.lineTo(mid[0] - half * spread, to[0][1]);
    g.lineTo(mid[0] + half * spread, to[1][1]);
    g.closePath();
    g.fill();
  }
  return { c, x, y, w, h };
}

/** Is the point inside the beam's cone? 0 outside, rising to 1 a little inside its edge. */
function inBeam(b: Beam, x: number, y: number) {
  const [fx, fy] = b.from, [[ax, ay], [bx, by]] = b.to;
  const u = (y - fy) / ((ay + by) / 2 - fy);
  if (u <= 0 || u > 1.02) return 0;
  const l = fx + (ax - fx) * u, r = fx + (bx - fx) * u, w = r - l;
  if (w <= 0) return 0;
  const v = (x - l) / w;
  return Math.min(smooth(0, 0.25, v), smooth(1, 0.75, v));
}

interface Spot { lon: number; y: number; r: number; c: number; tw: number }
interface Mote { x: number; y: number; r: number; p: number[]; beam: number }

class MenuFx {
  private ctx: CanvasRenderingContext2D;
  private sized = false;
  private drawnAt = -Infinity;
  private blank = true;
  private hall = HALLS.pc;
  private key: 'pc' | 'tall' = 'pc';
  /** Picture to screen: scale and offset (canvas pixels). */
  private s = 1;
  private ox = 0;
  private oy = 0;
  private dots = SPOT_RGB.map(c => softDot(c));
  private crisp = SPOT_RGB.map(c => softDot(c, 64, true));
  private warm = softDot([255, 150, 60], 128);
  private spark = sparkSprite();
  private beamSprites: Record<string, Cone[]> = {};
  private sweep: Record<string, Cone> = {};
  private spots: Spot[] = [];
  private motes: Record<string, Mote[]> = {};
  private still = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement, private menu: HTMLElement) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => (this.sized = false));
    const n = VARIANT === 'a' ? 80 : 40;
    for (let i = 0; i < n; i++) {
      this.spots.push({ lon: hash(i + 1) * Math.PI * 2, y: hash(i + 101), r: 0.7 + hash(i + 201) * 0.6, c: Math.floor(hash(i + 301) * SPOT_RGB.length), tw: hash(i + 401) * 6.28 });
    }
  }

  private size() {
    this.sized = true;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // one canvas pixel to a screen point is plenty for soft light, and each pixel more is work 20 times a second
    const q = Number(new URLSearchParams(location.search).get('menuq')) || Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    this.canvas.width = Math.round(w * q);
    this.canvas.height = Math.round(h * q);
    // the same picture as the stylesheet's: the tall one on an upright screen
    this.key = matchMedia('(orientation: portrait)').matches ? 'tall' : 'pc';
    this.hall = HALLS[this.key];
    const s = Math.max(w / this.hall.w, h / this.hall.h);
    this.s = s * q;
    this.ox = ((w - this.hall.w * s) / 2) * q;
    this.oy = ((h - this.hall.h * s) / 2) * q;
    this.blank = true;
  }

  private beamsOf() {
    const k = this.key, H = this.hall;
    this.beamSprites[k] ??= H.beams.map(b => coneSprite(b.from, b.to, b.rgb, 0.5));
    // the spotlight is drawn hanging straight down from the top middle and turned about that point as it sweeps
    const [, cy, reach] = H.stage, top: XY = [H.w / 2, -40], half = reach * 0.36;
    this.sweep[k] ??= coneSprite(top, [[top[0] - half, cy], [top[0] + half, cy + 4]], [255, 244, 225], 0.42);
    return this.beamSprites[k];
  }

  private motesOf() {
    if (this.motes[this.key]) return this.motes[this.key];
    const out: Mote[] = [], beams = this.hall.beams, n = VARIANT === 'b' ? 90 : 60;
    for (let i = 0; i < n; i++) {
      const bi = i % beams.length, b = beams[bi];
      // somewhere in the beam's cone, a little past its edges
      const u = 0.12 + hash(i + 501) * 0.85, v = -0.15 + hash(i + 601) * 1.3;
      const l = b.from[0] + (b.to[0][0] - b.from[0]) * u, r = b.from[0] + (b.to[1][0] - b.from[0]) * u;
      const y = b.from[1] + ((b.to[0][1] + b.to[1][1]) / 2 - b.from[1]) * u;
      out.push({ x: l + (r - l) * v, y, r: 1.6 + hash(i + 701) * 2.2, beam: bi, p: [0, 1, 2, 3].map(j => hash(i * 7 + j + 801) * 6.28) });
    }
    return (this.motes[this.key] = out);
  }

  /** Called from the game's loop each frame; draws only when it is time and the menu is on screen. */
  tick(now: number) {
    if (this.menu.hidden) return;
    const off = VARIANT === 'off' || this.still.matches || settings.quality === 'low' || !document.documentElement.classList.contains('art-menu_bg');
    if (off) {
      if (!this.blank) { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.blank = true; }
      return;
    }
    if (!this.sized) this.size();
    if (now - this.drawnAt < 1000 / FPS - 4) return;
    this.drawnAt = now;
    this.draw(now / 1000);
    this.blank = false;
  }

  private draw(t: number) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.s, 0, 0, this.s, this.ox, this.oy);
    g.globalCompositeOperation = 'lighter';
    const v = VARIANT;
    if (v === 'c') this.beams(t);
    if (v === 'b' || v === 'd') this.torches(t, v === 'b' ? 1 : 0.75);
    if (v === 'b' || v === 'd') this.dust(t, v === 'b' ? 1 : 0.8);
    if (v === 'a' || v === 'd') this.mirror(t, v === 'a' ? 1 : 0.7);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** The ball turns: its spots sweep round the room, and sparks flash on it now and then. */
  private mirror(t: number, k: number) {
    const g = this.ctx, H = this.hall, [bx, by, br] = H.ball;
    // the spots go round the room as on a drum about the room's middle: across the back wall, thinning out at the sides
    const turn = (t * Math.PI * 2) / 40, reach = H.w * 0.6, mx = H.w / 2;
    const top = H.h * 0.03, bottom = H.h * 0.98;
    for (const s of this.spots) {
      const th = s.lon + turn, c = Math.cos(th);
      if (c <= 0.02) continue;
      const x = mx + Math.sin(th) * reach;
      if (x < -40 || x > H.w + 40) continue;
      const y = top + (bottom - top) * s.y;
      const flat = y > H.floorY ? 0.45 : 1;
      const r = H.w * 0.011 * s.r * (0.7 + 0.3 * c);
      g.globalAlpha = k * 0.85 * smooth(0.02, 0.35, c) * (0.7 + 0.3 * Math.sin(t * 2.3 + s.tw));
      g.drawImage(this.crisp[s.c], x - r, y - r * flat, r * 2, r * 2 * flat);
    }
    // a spark every so often somewhere on the ball's face, each one lit for under a second
    const every = 0.5, life = 0.9;
    for (let n = Math.floor((t - life) / every) + 1; n * every <= t; n++) {
      const age = (t - n * every) / life;
      if (age < 0 || age > 1) continue;
      const a = hash(n * 3 + 1) * 6.28, d = Math.sqrt(hash(n * 3 + 2)) * br * 0.82;
      const x = bx + Math.cos(a) * d, y = by + Math.sin(a) * d, size = br * (0.32 + hash(n * 3 + 3) * 0.3) * Math.sin(age * Math.PI);
      g.globalAlpha = k * 0.9 * Math.sin(age * Math.PI);
      g.drawImage(this.spark, x - size, y - size, size * 2, size * 2);
    }
  }

  /** The flames breathe: the warm light round each one comes and goes, never two alike. */
  private torches(t: number, k: number) {
    const g = this.ctx, R = this.hall.w * 0.11;
    this.hall.torches.forEach(([x, y], i) => {
      const f = 0.5 + 0.22 * Math.sin(t * 7.3 + i * 1.7) + 0.16 * Math.sin(t * 12.9 + i * 4.1) + 0.12 * Math.sin(t * 21.7 + i * 2.3);
      g.globalAlpha = k * (0.06 + 0.16 * f);
      g.drawImage(this.warm, x - R, y - R, R * 2, R * 2);
      const r = R * 0.28;
      g.globalAlpha = k * (0.1 + 0.3 * f);
      g.drawImage(this.warm, x - r, y - r * 1.2, r * 2, r * 2.4);
    });
  }

  /** Dust floats in the air: seen only where a beam catches it, in the beam's colour. */
  private dust(t: number, k: number) {
    const g = this.ctx, beams = this.hall.beams;
    for (const m of this.motesOf()) {
      const x = m.x + 16 * Math.sin(t * 0.21 + m.p[0]) + 9 * Math.sin(t * 0.47 + m.p[1]);
      const y = m.y + 12 * Math.sin(t * 0.17 + m.p[2]) + 7 * Math.sin(t * 0.39 + m.p[3]);
      const lit = inBeam(beams[m.beam], x, y);
      if (lit <= 0.01) continue;
      const r = m.r * 2.4;
      g.globalAlpha = k * lit * (0.55 + 0.35 * Math.sin(t * 1.3 + m.p[0] * 3));
      g.drawImage(this.dots[[2, 4, 3][m.beam] ?? 0], x - r, y - r, r * 2, r * 2);
      g.globalAlpha *= 0.8;
      g.drawImage(this.dots[0], x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
    }
  }

  /** The three beams brighten one after another, and a white spotlight sweeps the dance floor. */
  private beams(t: number) {
    const g = this.ctx, H = this.hall, sprites = this.beamsOf();
    sprites.forEach((c, i) => {
      g.globalAlpha = 0.4 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 6 + (i * Math.PI * 2) / 3)) ** 1.5;
      g.drawImage(c.c, c.x, c.y, c.w, c.h);
      const [px, py, rx, ry] = H.beams[i].pool;
      g.globalAlpha *= 0.9;
      g.drawImage(this.dots[[2, 4, 3][i]], px - rx * 1.2, py - ry * 1.2, rx * 2.4, ry * 2.4);
    });
    const [cx, cy, reach] = H.stage, top: XY = [H.w / 2, -40];
    const x = cx + Math.sin((t * Math.PI * 2) / 11) * reach;
    const ang = -Math.atan2(x - top[0], cy - top[1]);
    g.save();
    g.translate(top[0], top[1]);
    g.rotate(ang);
    g.translate(-top[0], -top[1]);
    g.globalAlpha = 0.8;
    const sw = this.sweep[this.key];
    g.drawImage(sw.c, sw.x, sw.y, sw.w, sw.h);
    g.restore();
    g.globalAlpha = 0.55;
    const rx = reach * 0.42, ry = rx * 0.24;
    g.drawImage(this.dots[0], x - rx, cy - ry, rx * 2, ry * 2);
  }
}

let fx: MenuFx | null = null;
/** The menu's light, once the page is up; call menuFx(now) from the loop. */
export function menuFx(now: number) {
  if (!fx) {
    const canvas = document.getElementById('menuFx') as HTMLCanvasElement | null, menu = document.getElementById('menu');
    if (!canvas || !menu) return;
    fx = new MenuFx(canvas, menu);
  }
  fx.tick(now);
}
