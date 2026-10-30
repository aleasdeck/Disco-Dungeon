// The hall behind the main menu and its screens a little alive (thread «Оживить фон главного меню», Vladislav picked
// «всё понемногу» of four, 2026-10-28, and wanted it on every screen with the hall, 2026-10-29): the mirror ball turns and
// its spots drift over the walls and the floor, a spark flashes on it on every beat, the torches breathe, dust floats
// where the three beams catch it, and the dancers move to the music, each one whole, as a cut-out figure moves: a dip on
// the beat, a sway, the rat a hop.
// It is one layer (#hall) under whichever of those screens is up, which then leaves its own still picture off: the hall
// without its dancers (menu_hall / menu_hall_tall), the dancers as pictures of their own (menu_dancer_*) and the light as
// a canvas over both. All of it is redrawn at most 20 times a second and only while such a screen is up, so the phone does
// less than in a room standing still; it holds still under a window that blurs what is under it (the rules, the online
// wait), and with less motion asked of the system or the graphics set to save, the screens keep the still hall with its
// dancers in it (menu_bg). Everything is placed in the hall picture's own pixels
// (art: /mnt/project-files/discodungeon/menu-fx/tools/split.py) and follows it as the stylesheet covers the screen with it.
// The light comes round again every 40 beats exactly, and the dancers every 4, so a recording of 40 beats loops clean.

import { uiArt } from './assets';
import { settings } from './settings';
import { sound } from './sound';

type XY = [number, number];
type RGB = [number, number, number];

interface Beam {
  from: XY;
  /** The two corners where it meets the floor. */
  to: [XY, XY];
}

/** How a dancer moves, all of it at once: sway in degrees, the rest in parts of its height. */
interface Move {
  sway: number;
  /** Sways over 4 beats instead of 2. */
  slow?: boolean;
  /** Its sway starts this many beats on, so no two lean the same way at once. */
  turn: number;
  /** A step aside and back with the sway. */
  side: number;
  /** A hop between beats. */
  hop: number;
  /** Squashed down onto its feet on the beat. */
  dip: number;
}

interface Dancer {
  /** Its picture, ui/<key>.webp. */
  key: string;
  /** Its box in the hall picture: left, top, right, bottom. */
  box: [number, number, number, number];
  feet: XY;
  move: Move;
}

interface Hall {
  w: number;
  h: number;
  /** The still hall with the dancers in it, and the one without them. */
  still: string;
  bare: string;
  /** The mirror ball: centre and radius. */
  ball: [number, number, number];
  /** The flames. */
  torches: XY[];
  /** Where the floor starts, going down: spots below it lie flat. */
  floorY: number;
  /** The purple, the yellow and the teal beam. */
  beams: Beam[];
  /** Back to front. */
  dancers: Dancer[];
}

const GOBLIN: Move = { sway: 2.5, turn: 0, side: 0.025, hop: 0, dip: 0.03 };
const RAT: Move = { sway: 3, turn: 1, side: 0, hop: 0.045, dip: 0.05 };
const POINTER: Move = { sway: 2, turn: 1, side: 0, hop: 0, dip: 0.022 };
const ARMS_UP: Move = { sway: 3, slow: true, turn: 0.5, side: 0.01, hop: 0, dip: 0.028 };

const HALLS: Record<'pc' | 'tall', Hall> = {
  pc: {
    w: 1536, h: 1024, still: 'menu_bg', bare: 'menu_hall', ball: [1086, 305, 104], torches: [[180, 305], [335, 335], [1205, 340], [1375, 305]], floorY: 712,
    beams: [{ from: [1080, 250], to: [[430, 930], [640, 960]] }, { from: [200, 0], to: [[760, 850], [930, 860]] }, { from: [1400, 0], to: [[1000, 960], [1180, 955]] }],
    dancers: [
      { key: 'menu_dancer_pc0', box: [968, 520, 1173, 870], feet: [1070, 870], move: GOBLIN },
      { key: 'menu_dancer_pc1', box: [373, 590, 567, 880], feet: [470, 880], move: RAT },
      { key: 'menu_dancer_pc2', box: [84, 412, 357, 972], feet: [220, 972], move: POINTER },
      { key: 'menu_dancer_pc3', box: [1146, 405, 1494, 975], feet: [1320, 975], move: ARMS_UP },
    ],
  },
  tall: {
    w: 1024, h: 1536, still: 'menu_bg_tall', bare: 'menu_hall_tall', ball: [723, 230, 85], torches: [[140, 580], [884, 575]], floorY: 1075,
    beams: [{ from: [720, 180], to: [[300, 1450], [470, 1480]] }, { from: [160, 0], to: [[560, 1460], [700, 1480]] }, { from: [900, 0], to: [[600, 1480], [780, 1490]] }],
    dancers: [
      { key: 'menu_dancer_tall0', box: [443, 1290, 587, 1505], feet: [515, 1505], move: RAT },
      { key: 'menu_dancer_tall1', box: [215, 1178, 385, 1528], feet: [300, 1528], move: POINTER },
      { key: 'menu_dancer_tall2', box: [617, 1175, 834, 1530], feet: [725, 1530], move: ARMS_UP },
    ],
  },
};

/** The main menu's tune (music/funk.mp3) is 118 beats a minute, its first beat where its loop starts. */
const BEAT = 60 / 118;
/** The light comes round again after this many seconds. */
const LOOP = 40 * BEAT;
/** Once round, in radians a second: a motion at k times this comes back with the loop. */
const W = (Math.PI * 2) / LOOP;
/** At most this many drawings a second, as a room standing still. */
const FPS = 20;
/** The canvas holds at most about this many pixels, so a big screen costs no more than a laptop. */
const MAX_PIXELS = 2.6e6;
/** How many spots the ball throws round the room (half of them on its other side), and how much dust floats in the beams. */
const SPOTS = 40, MOTES = 60;

/** The spots' colours, white the most; the dust in each beam takes that beam's colour (purple, yellow, teal). */
const SPOT_RGB: RGB[] = [[245, 238, 255], [245, 238, 255], [200, 160, 255], [130, 235, 225], [255, 225, 140], [255, 160, 215]];
const BEAM_DOT = [2, 4, 3];

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
  // two long rays across, then four short ones between them
  for (const [w, len, a, n] of [[0.07, 1, 1, 2], [0.035, 0.62, 0.7, 4]] as const) {
    for (let k = 0; k < n; k++) {
      g.save();
      g.rotate((k * Math.PI) / n + (n === 2 ? 0 : Math.PI / 4));
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

/** Is the point inside the beam? 0 outside, rising to 1 a little inside its edge. */
function inBeam(b: Beam, x: number, y: number) {
  const [fx, fy] = b.from, [[ax, ay], [bx, by]] = b.to;
  const u = (y - fy) / ((ay + by) / 2 - fy);
  if (u <= 0 || u > 1.02) return 0;
  const l = fx + (ax - fx) * u, r = fx + (bx - fx) * u, w = r - l;
  if (w <= 0) return 0;
  const v = (x - l) / w;
  return Math.min(smooth(0, 0.25, v), smooth(1, 0.75, v));
}

/** A dancer's pose `b` beats into the tune, as a CSS transform about its feet; `h` is its height on screen. */
function pose(m: Move, b: number, h: number) {
  const sw = Math.sin((Math.PI * (b + m.turn)) / (m.slow ? 2 : 1));
  // down on the beat, up between beats
  const land = Math.max(0, Math.cos(Math.PI * 2 * b)) ** 3, air = Math.abs(Math.sin(Math.PI * b));
  const sq = m.dip * land;
  return `translate(${(m.side * h * sw).toFixed(1)}px,${(-m.hop * h * air).toFixed(1)}px) rotate(${(m.sway * sw).toFixed(2)}deg) scale(${(1 + sq * 0.6).toFixed(3)},${(1 - sq).toFixed(3)})`;
}

interface Spot { lon: number; y: number; r: number; c: number; tw: number }
interface Mote { x: number; y: number; r: number; p: number[]; beam: number }

class MenuFx {
  private ctx: CanvasRenderingContext2D;
  private sized = false;
  private drawnAt = -Infinity;
  private on = false;
  private hall = HALLS.pc;
  private key: 'pc' | 'tall' = 'pc';
  /** Picture to canvas: scale and offset. */
  private s = 1;
  private ox = 0;
  private oy = 0;
  /** The dancers on screen and their height there. */
  private figs: { img: HTMLImageElement; move: Move; h: number }[] = [];
  private dots = SPOT_RGB.map(c => softDot(c));
  private crisp = SPOT_RGB.map(c => softDot(c, 64, true));
  private warm = softDot([255, 150, 60], 128);
  private spark = sparkSprite();
  private spots: Spot[] = [];
  private motes: Partial<Record<'pc' | 'tall', Mote[]>> = {};
  private still = matchMedia('(prefers-reduced-motion: reduce)');
  private upright = matchMedia('(orientation: portrait)');

  /**
   * `screens` show the hall behind them; `over` are the windows after them in the page that may come up over them (the
   * rules, the online wait, the pause, the loading screen): under one the hall holds still.
   */
  constructor(private layer: HTMLElement, private canvas: HTMLCanvasElement, private floor: HTMLElement, private screens: HTMLElement[], private over: HTMLElement[]) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => (this.sized = false));
    // each spot has a twin on the ball's far side: half a turn later the room shows the same spots, so the light loops
    // after half a turn without the room ever showing a spot and its twin at once
    for (let i = 0; i < SPOTS / 2; i++) {
      const s = { lon: hash(i + 1) * Math.PI, y: hash(i + 101), r: 0.7 + hash(i + 201) * 0.6, c: Math.floor(hash(i + 301) * SPOT_RGB.length), tw: hash(i + 401) * 6.28 };
      this.spots.push(s, { ...s, lon: s.lon + Math.PI });
    }
  }

  /** Every picture it needs is in. */
  private ready(hall: Hall) {
    return uiArt.has(hall.still) && uiArt.has(hall.bare) && hall.dancers.every(d => uiArt.has(d.key));
  }

  private size() {
    this.sized = true;
    const w = this.layer.clientWidth, h = this.layer.clientHeight;
    // one canvas pixel to a screen point is plenty for soft light, and each pixel more is work 20 times a second
    const q = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    this.canvas.width = Math.round(w * q);
    this.canvas.height = Math.round(h * q);
    // the same picture as the stylesheet's: the tall one on an upright screen
    this.key = this.upright.matches ? 'tall' : 'pc';
    this.hall = HALLS[this.key];
    const s = Math.max(w / this.hall.w, h / this.hall.h), ox = (w - this.hall.w * s) / 2, oy = (h - this.hall.h * s) / 2;
    this.s = s * q;
    this.ox = ox * q;
    this.oy = oy * q;
    // the dancers stand where they stood in the still hall, each turning about its feet
    this.floor.replaceChildren();
    this.figs = this.hall.dancers.map(d => {
      const img = new Image(), [x0, y0, x1, y1] = d.box;
      img.src = uiArt.get(d.key)!.src;
      img.alt = '';
      Object.assign(img.style, {
        left: `${ox + x0 * s}px`, top: `${oy + y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px`,
        transformOrigin: `${(d.feet[0] - x0) * s}px ${(d.feet[1] - y0) * s}px`,
      });
      this.floor.append(img);
      return { img, move: d.move, h: (y1 - y0) * s };
    });
  }

  /** The live hall up behind the screens (they leave their still one off) or gone (they show it again). */
  private set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.layer.hidden = !on;
    document.documentElement.classList.toggle('hall-alive', on);
  }

  /** Each beam's dust: somewhere in it or a little past its edges, so a mote drifts in and out of the light. */
  private motesOf() {
    const had = this.motes[this.key];
    if (had) return had;
    const out: Mote[] = [], beams = this.hall.beams;
    for (let i = 0; i < MOTES; i++) {
      const bi = i % beams.length, b = beams[bi];
      const u = 0.12 + hash(i + 501) * 0.85, v = -0.15 + hash(i + 601) * 1.3;
      const l = b.from[0] + (b.to[0][0] - b.from[0]) * u, r = b.from[0] + (b.to[1][0] - b.from[0]) * u;
      const y = b.from[1] + ((b.to[0][1] + b.to[1][1]) / 2 - b.from[1]) * u;
      out.push({ x: l + (r - l) * v, y, r: 1.6 + hash(i + 701) * 2.2, beam: bi, p: [0, 1, 2, 3].map(j => hash(i * 7 + j + 801) * 6.28) });
    }
    return (this.motes[this.key] = out);
  }

  /** Called from the game's loop each frame; draws only when it is time and a screen with the hall is up. */
  tick(now: number) {
    const up = this.screens.some(s => !s.hidden) && !this.still.matches && settings.quality !== 'low' && this.ready(HALLS[this.upright.matches ? 'tall' : 'pc']);
    this.set(up);
    if (!up) return;
    if (!this.sized) this.size();
    if (now - this.drawnAt < 1000 / FPS - 4 || this.over.some(o => !o.hidden)) return;
    this.drawnAt = now;
    const t = now / 1000;
    // the dancers keep to the tune when it plays, else to a clock at its pace
    const beats = (sound.heard('menu') ?? t) / BEAT;
    for (const f of this.figs) f.img.style.transform = pose(f.move, beats, f.h);
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.s, 0, 0, this.s, this.ox, this.oy);
    // light adds up where it overlaps
    g.globalCompositeOperation = 'lighter';
    this.torches(t);
    this.dust(t);
    this.mirror(t);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.set(true);
  }

  /** The ball turns: its spots go round the room, and a spark flashes on it every beat. */
  private mirror(t: number) {
    const g = this.ctx, H = this.hall, [bx, by, br] = H.ball;
    // the spots go round as on a drum about the room's middle: across the back wall, thinning out at the sides; the ball
    // turns once in two loops, and its twin spots make half a turn look the same
    const turn = (W / 2) * t, reach = H.w * 0.6, mx = H.w / 2;
    const top = H.h * 0.03, bottom = H.h * 0.98;
    for (const s of this.spots) {
      const th = s.lon + turn, c = Math.cos(th);
      if (c <= 0.02) continue;
      const x = mx + Math.sin(th) * reach;
      if (x < -40 || x > H.w + 40) continue;
      const y = top + (bottom - top) * s.y;
      const flat = y > H.floorY ? 0.45 : 1;
      const r = H.w * 0.011 * s.r * (0.7 + 0.3 * c);
      g.globalAlpha = 0.6 * smooth(0.02, 0.35, c) * (0.7 + 0.3 * Math.sin(7 * W * t + s.tw));
      g.drawImage(this.crisp[s.c], x - r, y - r * flat, r * 2, r * 2 * flat);
    }
    // the spark of each beat, somewhere on the ball's face, lit for under a second; the 40 beats of a loop have 40 places
    const life = 0.9;
    for (let n = Math.floor((t - life) / BEAT) + 1; n * BEAT <= t; n++) {
      const age = (t - n * BEAT) / life;
      if (age < 0 || age > 1) continue;
      const k = ((n % 40) + 40) % 40, glow = Math.sin(age * Math.PI);
      const a = hash(k * 3 + 1) * 6.28, d = Math.sqrt(hash(k * 3 + 2)) * br * 0.82;
      const x = bx + Math.cos(a) * d, y = by + Math.sin(a) * d, size = br * (0.32 + hash(k * 3 + 3) * 0.3) * glow;
      g.globalAlpha = 0.63 * glow;
      g.drawImage(this.spark, x - size, y - size, size * 2, size * 2);
    }
  }

  /** The flames breathe: the warm light round each one comes and goes, never two alike. */
  private torches(t: number) {
    const g = this.ctx, R = this.hall.w * 0.11, r = R * 0.28;
    this.hall.torches.forEach(([x, y], i) => {
      const f = 0.5 + 0.22 * Math.sin(23 * W * t + i * 1.7) + 0.16 * Math.sin(41 * W * t + i * 4.1) + 0.12 * Math.sin(69 * W * t + i * 2.3);
      g.globalAlpha = 0.75 * (0.06 + 0.16 * f);
      g.drawImage(this.warm, x - R, y - R, R * 2, R * 2);
      g.globalAlpha = 0.75 * (0.1 + 0.3 * f);
      g.drawImage(this.warm, x - r, y - r * 1.2, r * 2, r * 2.4);
    });
  }

  /** Dust floats in the air, seen only where a beam catches it, in the beam's colour. */
  private dust(t: number) {
    const g = this.ctx, beams = this.hall.beams, wt = W * t;
    for (const m of this.motesOf()) {
      const x = m.x + 16 * Math.sin(wt + m.p[0]) + 9 * Math.sin(2 * wt + m.p[1]);
      const y = m.y + 12 * Math.sin(wt + m.p[2]) + 7 * Math.sin(3 * wt + m.p[3]);
      const lit = inBeam(beams[m.beam], x, y);
      if (lit <= 0.01) continue;
      const r = m.r * 2.4, a = 0.8 * lit * (0.55 + 0.35 * Math.sin(4 * wt + m.p[0] * 3));
      g.globalAlpha = a;
      g.drawImage(this.dots[BEAM_DOT[m.beam]], x - r, y - r, r * 2, r * 2);
      // and a white grain in its middle
      g.globalAlpha = a * 0.8;
      g.drawImage(this.dots[0], x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
    }
  }
}

let fx: MenuFx | null = null;
/** The hall's life: call from the game's loop every frame. */
export function menuFx(now: number) {
  if (!fx) {
    const $ = (id: string) => document.getElementById(id);
    const layer = $('hall'), canvas = $('hallFx') as HTMLCanvasElement | null, floor = $('hallDancers');
    if (!layer || !canvas || !floor) return;
    // every full screen with the hall for its picture, and every window that comes after it, over it
    const screens = [...document.querySelectorAll<HTMLElement>('.overlay.solid:not(.boot)')];
    const over = [...document.querySelectorAll<HTMLElement>('.overlay')].filter(o => !screens.includes(o) && layer.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING);
    fx = new MenuFx(layer, canvas, floor, screens, over);
  }
  fx.tick(now);
}
