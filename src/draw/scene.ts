// Draws one frame of a room: walls, floor, obstacles, resources, discs and miniatures.
// Everything is drawn in iso space through the camera, so zoom and rotation are free.

import { WALL_WORDS, FAN_R, GAS_R, GAS_TURNS, HERO_BASE, HERO_FIG, INK, ENEMY_BASE, MOBS, WALL_H, TILE, heroFig, mobSize, type NodeKind } from '../data';
import { KX, KY, type Camera, type Vec } from '../camera';
import { ART, FOOD_FLY, SHIELD_COS, ZAP_T, ZONE_COL, type Bomb, type Disc, type Food, type Game, type Gas, type HeroState, type Spark, type Zap } from '../game';
import { cellAt, floorAt, hazKey, inPit, isFloor, pitAt, type Block, type Edge, type Mob, type Pit, type ResNode, type Trinket } from '../room';
import { BASE_TH, MOB_TOP, drawHeroFigure, drawMiniature, drawMobFigure, heroLook } from './figures';
import { circ, ell, fs, mix, pth, rr, type Ctx, type Pt } from './util';
import { GRAFFITI_FONTS, envArt, sprites } from '../assets';
import { knockPose, topplePose, type Knock, type Pose } from '../fx';
import { hl } from '../hl';
import { has } from '../artifacts';
import { intro, bossKind } from '../intro';
import { SAY_TIME, justOpened, trinketDef } from '../trinkets';

export interface Aim { hero: HeroState; dx: number; dy: number }
/** A hero dragged to another rune: pointer position in screen pixels and the rune under it. */
export interface Carry { hero: HeroState; x: number; y: number; pad: number | null; moved: boolean }


/**
 * The guard's door round its stand: how far out from the stand's edge it runs, how high it is, how many boards it is made
 * of and their colours in turn, and the heights of its two iron bands.
 */
const DOOR_OFF = 3;
const DOOR_H = 4.5;
const DOOR_BOARDS = 5;
const DOOR_WOOD = ['#9c6840', '#8a5934', '#a06c42'];
const DOOR_BANDS: [number, number][] = [[DOOR_H * 0.17, DOOR_H * 0.32], [DOOR_H * 0.66, DOOR_H * 0.81]];

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Room art from the manifest; anything missing is drawn by code in the same cartoon look. */
const env = (k: string) => envArt.get(k);

/**
 * Resource pictures standing on a pad: the full one (`key`) for a full stock and `<key>_<n>` for n of its `pieces` left,
 * as wide as `w`, set off the cell's centre on screen by `sx` to the right and `sy` down: the picture always faces the
 * viewer, so its foot sits the same way on the cell at any turn of the camera. A crystal is a spark and a
 * mushroom a heal, so the toilet shows how many crystals are left and the meadow how many mushrooms. The pad is a
 * picture laid flat on the cell (`pad`): bathroom tiles, or a meadow rounded off (`round`). Ore is a rock built in code
 * (drawRock).
 */
type PadKind = Exclude<NodeKind, 'ore'>;
const NODE_ART: Record<PadKind, { key: string; pieces: number; w: number; sx: number; sy: number; pad: string; round?: number }> = {
  spk: { key: 'crystal', pieces: 3, w: 17, sx: 1, sy: 2, pad: 'res_tiles' },
  herb: { key: 'mushrooms', pieces: 3, w: 18.5, sx: 0, sy: 1.7, pad: 'res_grass', round: 1.06 },
};
/** How wide a pad is: a cell less a rim of floor. */
const PAD_W = 14;

/** Pieces of a resource's picture still standing with `left` charges. */
const nodePieces = (k: PadKind, left: number) => Math.min(NODE_ART[k].pieces, left);

/** The ore rock's look: slate sides and top, and gold nuggets (every `gold_*` picture) at most this wide. */
const ROCK = { side: 'rock_side', top: 'rock_top', nugW: 4.2 };

/** How thick a disc's ink outline is, in iso units: a hairline, as thin as the ring on its picture. */
const DISC_LW = 0.6;

/** The card sharp's phantom discs: pink where his disc is purple, inked the same, and see-through. */
const PHANTOM = { col: '#f06ac6', dk: '#7a2463', ink: '#3a0c2c', alpha: 0.66 };
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const phantoms = new WeakMap<HTMLImageElement, HTMLCanvasElement | null>();
/**
 * His disc's picture recoloured for a phantom, made once: by brightness, ink stays ink, the purple turns pink and the
 * white emblem stays white. Null where the picture can't be read back.
 */
const phantomArt = (img: HTMLImageElement) => {
  if (phantoms.has(img)) return phantoms.get(img)!;
  let out: HTMLCanvasElement | null = null;
  try {
    const cv = document.createElement('canvas'), w = (cv.width = img.naturalWidth), h = (cv.height = img.naturalHeight), x = cv.getContext('2d')!;
    x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, w, h), d = px.data, ink = rgb(PHANTOM.ink), pk = rgb(PHANTOM.col), white = [255, 255, 255];
    // his purple is about this bright: darker goes toward the ink, lighter toward white
    const mid = 0.42;
    for (let k = 0; k < d.length; k += 4) {
      const l = (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255, lo = l < mid;
      const a = lo ? ink : pk, b = lo ? pk : white, t = lo ? l / mid : (l - mid) / (1 - mid);
      for (let c = 0; c < 3; c++) d[k + c] = a[c] + (b[c] - a[c]) * t;
    }
    x.putImageData(px, 0, 0);
    out = cv;
  } catch {
    // a picture from elsewhere can't be read back: the phantom is drawn by code
  }
  phantoms.set(img, out);
  return out;
};

/** The cook's dishes, by `Food.k`: their pictures are food_<name> in the manifest, else drawn by code. */
const DISHES = ['cutlet', 'sausage', 'pie', 'drumstick'];
/** How wide a dish's plate stands, in iso units: about half the cell it lies in, so neighbouring plates keep apart. */
const FOOD_W = 16;
/** How far below the middle of its cell a plate's front rim comes, as a share of its width: the plate sits centred on the cell. */
const FOOD_RIM = 0.28;

/** How wide a firecracker stands, in iso units. */
const BOMB_W = 7;
/**
 * A trinket's picture covers the same area whatever its shape, about half a cell (a bucket stands 9 wide), so a lying hot
 * water bag is as easy to spot as an upright kettlebell; never wider than TRINKET_MAX, to stay inside its cell.
 */
const TRINKET_K = 10.6, TRINKET_MAX = 12;
/** The gas: its green, its ink, and how many puffs drift over a cloud. */
const GAS_COL = '#a9d65a', GAS_INK = '#4f6b1e', PUFFS = 8;

/** Cartoon look: silhouette and detail ink widths, in iso units. */
const OL = 2.1, DL = 1.1;
/** How deep the walls of a hole in the floor show before the dark swallows them. */
const PIT_D = 30;
/** Ink on stone blocks: thinner than the room's silhouette, so a block doesn't look cut out of the floor. */
const BL = 1.2;
/**
 * Whether the graffiti fonts have loaded; words drawn before that use a fallback face and are drawn again.
 * Asked by every piece of wall every frame, while document.fonts.check itself is slow (a few of them a frame were
 * most of the frame on a phone), so the answer is looked up at most a few times a second and kept once it's yes.
 */
let fontsOk = typeof document === 'undefined' || !document.fonts, fontsAt = -Infinity;
if (!fontsOk) document.fonts.addEventListener('loadingdone', () => { fontsAt = -Infinity; });
const fontsReady = () => {
  if (fontsOk) return true;
  const now = performance.now();
  if (now - fontsAt < 250) return false;
  fontsAt = now;
  return (fontsOk = GRAFFITI_FONTS.every(f => document.fonts.check(f, 'WЖ')));
};
/** At most this many gags on the walls of one room, so each stays a find rather than wallpaper. */
const MAX_GAGS = 4;
/** Chalk white, for words and doodles on the walls. */
const CHALK = '#efeadf';
/** A gag on a wall line: world coordinate of its middle along the wall, height of its middle, height, and what it shows. */
interface WallGag { u: number; h: number; size: number; doodle?: string; word?: string; font?: string; tilt: number; flip?: boolean }
/** The four sides of a cell: neighbour offset, then the side's two corners in cell units. */
const SIDES: [number, number, number, number, number, number][] = [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]];
/** The convex hull of some points, in order round it. */
const hull = (pts: Pt[]): Pt[] => {
  const ps = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(ps), ...half([...ps].reverse())];
};
/** Stable pseudo-random 0..1 from integers, so stones and cracks stay put between frames. */
const hr = (a: number, b = 0, d = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(d | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class SceneRenderer {
  private c!: Ctx;
  private cam!: Camera;
  private g!: Game;
  private t = 0;
  private carry: Carry | null = null;
  private aim: Aim | null = null;
  private bgCss = '';
  private glow: { key: string; img: HTMLCanvasElement } | null = null;

  private P = (x: number, y: number, h = 0): Pt => this.cam.iso(x, y, h);
  private get bk() { return this.g.S.biome.art; }


  /**
   * Lay a picture, or the part `src` (x, y, w, h in its pixels) of it, flat on the rectangle (x0, y0)-(x1, y1) at height h;
   * rot picks which corner its top-left goes to.
   */
  private imgOnRect(im: HTMLImageElement | HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number, rot = 0, h = 0,
    src: [number, number, number, number] = [0, 0, im.width, im.height]) {
    const cs: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const o = this.P(...cs[rot % 4], h), a = this.P(...cs[(rot + 1) % 4], h), d = this.P(...cs[(rot + 3) % 4], h);
    const c = this.c, [sx, sy, sw, sh] = src;
    c.save();
    c.transform((a[0] - o[0]) / sw, (a[1] - o[1]) / sw, (d[0] - o[0]) / sh, (d[1] - o[1]) / sh, o[0], o[1]);
    c.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    c.restore();
  }

  private mirrored: { src: HTMLImageElement; img: HTMLCanvasElement } | null = null;
  /** The lava picture beside three mirrored copies of itself, so it tiles without seams; a quarter of it across per cell. */
  private lavaTex() {
    const im = env('lava');
    if (!im) return null;
    if (this.mirrored?.src !== im) {
      const w = im.width, h = im.height, img = document.createElement('canvas');
      img.width = w * 2;
      img.height = h * 2;
      const x = img.getContext('2d')!;
      for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        x.setTransform(fx, 0, 0, fy, fx < 0 ? 2 * w : 0, fy < 0 ? 2 * h : 0);
        x.drawImage(im, 0, 0);
      }
      this.mirrored = { src: im, img };
    }
    return this.mirrored.img;
  }

  private plain = new Map<HTMLImageElement, string>();
  /** Average colour of a cap picture just inside its rim, away from the ornament in the middle. */
  private capPlain(cap: HTMLImageElement) {
    let col = this.plain.get(cap);
    if (!col) {
      const n = 16, cv = document.createElement('canvas');
      cv.width = cv.height = n;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(cap, cap.width * 0.22, cap.height * 0.22, cap.width * 0.12, cap.height * 0.12, 0, 0, n, n);
      const d = x.getImageData(0, 0, n, n).data, sum = [0, 0, 0];
      for (let k = 0; k < d.length; k += 4) for (let ch = 0; ch < 3; ch++) sum[ch] += d[k + ch];
      col = `rgb(${sum.map(v => Math.round(v / (n * n))).join(',')})`;
      this.plain.set(cap, col);
    }
    return col;
  }

  private blockSet: { S: object; cells: Set<string>; deco: Set<string> } | null = null;
  /** Cells taken by stone blocks (icicles stand alone), and the one cell per group of touching blocks that carries the cap's ornament. */
  private stoneBlocks() {
    const S = this.g.S;
    if (this.blockSet?.S === S) return this.blockSet;
    const cells = new Set(S.blocks.filter(b => !b.ice).map(b => hazKey(b.x0 / TILE, b.y0 / TILE))), deco = new Set<string>(), seen = new Set<string>();
    for (const k of cells) {
      if (seen.has(k)) continue;
      const group: [number, number][] = [], todo = [k];
      seen.add(k);
      while (todo.length) {
        const [a, d] = todo.pop()!.split(',').map(Number);
        group.push([a, d]);
        for (const [da, dd] of SIDES) {
          const n = hazKey(a + da, d + dd);
          if (cells.has(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
        }
      }
      const ca = group.reduce((t, g) => t + g[0], 0) / group.length, cd = group.reduce((t, g) => t + g[1], 0) / group.length;
      const mid = group.reduce((m, g) => (Math.hypot(g[0] - ca, g[1] - cd) < Math.hypot(m[0] - ca, m[1] - cd) ? g : m));
      deco.add(hazKey(mid[0], mid[1]));
    }
    this.blockSet = { S, cells, deco };
    return this.blockSet;
  }

  /** Stand a cut-out picture upright with its bottom centre at screen point (x, y), w iso units wide. */
  private standee(im: HTMLImageElement, x: number, y: number, w: number, flash = false) {
    const h = (w * im.height) / im.width, c = this.c;
    if (flash) c.filter = 'brightness(3) saturate(0)';
    c.drawImage(im, x - w / 2, y - h, w, h);
    c.filter = 'none';
  }

  /** A picture flat on a wall: w world units wide, its top edge at height top, centred on world coordinate um along the wall. */
  private onWall(im: HTMLImageElement, at: (u: number, h: number) => Pt, um: number, top: number, w: number) {
    const [m, d] = this.wallFrame(at, um, top), sc = w / im.width, c = this.c;
    c.save();
    c.transform(d[0] * sc, d[1] * sc, 0, sc, m[0] - (d[0] * w) / 2, m[1] - (d[1] * w) / 2);
    c.drawImage(im, 0, 0);
    c.restore();
  }

  /** Screen point of world coordinate um along a wall at height h, and the step along the wall that reads left to right on screen. */
  private wallFrame(at: (u: number, h: number) => Pt, um: number, h: number): [Pt, Pt] {
    const o = at(um, h), e = at(um + 1, h), d: Pt = [e[0] - o[0], e[1] - o[1]];
    return [o, d[0] < 0 ? [-d[0], -d[1]] : d];
  }

  private gagSet: { S: object; stamp: string; lines: Map<string, WallGag[]> } | null = null;
  /**
   * A few big gags along the straight runs of wall, laid out once per room: chalk doodles and scratched words, each up to
   * about two and a half tiles wide, with long bare stretches between them. Keyed by the run's line, so every piece of
   * wall draws its slice.
   */
  private wallGags() {
    // laid out again once the doodles and the fonts arrive, since both change how wide a gag is
    const S = this.g.S, stamp = `${envArt.size}:${fontsReady()}`;
    if (this.gagSet?.S === S && this.gagSet.stamp === stamp) return this.gagSet.lines;
    const runs = new Map<string, [number, number][]>(), hung = new Map<string, number[]>();
    for (const e of S.edges) {
      const along = e.nx !== 0, u0 = Math.min(along ? e.a[1] : e.a[0], along ? e.b[1] : e.b[0]), k = along ? e.j : e.i;
      const key = `${along ? 'x' : 'y'}${along ? e.a[0] : e.a[1]}:${e.nx},${e.ny}`;
      if (!runs.has(key)) { runs.set(key, []); hung.set(key, []); }
      runs.get(key)!.push([u0, u0 + TILE]);
      // the same rules drawWall uses for where torches and banners hang
      if (k % 4 === 2 || (k % 4 === 0 && (e.i + e.j) % 3 === 0)) hung.get(key)!.push(u0 + TILE / 2);
    }
    // every chalk doodle in the manifest and every word for this floor; each room picks its own few, none twice
    const words = [...WALL_WORDS.all, ...(WALL_WORDS[this.bk] ?? [])], lines = new Map<string, WallGag[]>();
    const doodles = [...envArt.keys()].filter(k => k.startsWith('doodle_')).sort(), used = new Set<string>();
    const fresh = (list: string[], v: number) => {
      for (let k = 0, i = Math.floor(v * list.length); k < list.length; k++) {
        const pick = list[(i + k) % list.length];
        if (!used.has(pick)) { used.add(pick); return pick; }
      }
      return undefined;
    };
    let seed = Math.imul(S.spec.seed, 31) + S.spec.depth * 7 + S.spec.floor, placed = 0;
    for (const [key, spans] of runs) {
      spans.sort((p, q) => p[0] - q[0]);
      const gags: WallGag[] = [];
      // walk each unbroken stretch of this line, leaving room at its ends
      for (let k = 0; k < spans.length;) {
        let end = spans[k][1];
        const start = spans[k][0];
        while (k + 1 < spans.length && spans[k + 1][0] <= end + 0.01) end = spans[++k][1];
        k++;
        for (let u = start + 4; u < end - 16 && placed < MAX_GAGS; seed++) {
          const r = (n: number) => hr(seed, n, 97);
          if (r(1) < 0.55) { u += 20 + r(2) * 20; continue; }
          const doodle = doodles.length && r(3) < 0.5;
          const g: WallGag = doodle
            // doodles come in all sizes, turned and sometimes mirrored, as if different hands drew them
            ? { u: 0, h: 14 + r(4) * 4, size: 12 + r(5) * 14, doodle: fresh(doodles, r(6)), tilt: (r(7) - 0.5) * 0.7, flip: r(8) < 0.4 }
            : { u: 0, h: 14 + r(4) * 4, size: 7 + r(5) * 5, word: fresh(words, r(6)), font: GRAFFITI_FONTS[Math.floor(r(8) * GRAFFITI_FONTS.length)], tilt: (r(7) - 0.5) * 0.4 };
          if (!g.doodle && !g.word) { u += 20; continue; }
          const w = Math.min(end - u - 2, this.gagWidth(g));
          if (w < 12) break;
          // keep clear of torches and banners
          const t = hung.get(key)!.find(c => c + 6 > u && c - 6 < u + w);
          if (t !== undefined) { u = t + 6; continue; }
          g.u = u + w / 2;
          gags.push(g);
          placed++;
          u += w + 40 + r(9) * 24;
        }
      }
      lines.set(key, gags);
    }
    this.gagSet = { S, stamp, lines };
    return lines;
  }

  /** Width of a gag along the wall in world units, at its natural proportions. */
  private gagWidth(g: WallGag) {
    const im = g.doodle ? env(g.doodle) : this.chalkWord(g.word!, g.font!);
    if (!im) return 0;
    const lines = g.word ? g.word.split('\n').length : 1;
    return Math.min(40, (im.width / im.height) * g.size * lines);
  }

  private words = new Map<string, HTMLCanvasElement>();
  /** A word written in white chalk or scratched into the stone: re-traced a couple of times, with dry streaks knocked out. */
  private chalkWord(text: string, font: string) {
    const key = `${font}|${text}|${fontsReady()}`;
    let cv = this.words.get(key);
    if (cv) return cv;
    const lines = text.split('\n'), px = 96, pad = 16, f = font.replace(/\d+px/, `${px}px`);
    cv = document.createElement('canvas');
    const x = cv.getContext('2d')!;
    x.font = f;
    cv.width = Math.ceil(Math.max(...lines.map(l => x.measureText(l).width))) + pad * 2;
    cv.height = Math.ceil(lines.length * px * 0.95) + pad * 2;
    x.font = f;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = CHALK;
    for (const [dx, dy, a] of [[0, 0, 1], [2.5, -1.5, 0.5], [-2, 2, 0.4]]) {
      x.globalAlpha = a;
      lines.forEach((l, n) => x.fillText(l, cv!.width / 2 + dx, pad + px * 0.95 * (n + 0.5) + dy));
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = 'rgba(0,0,0,.6)';
    x.lineWidth = 2;
    x.beginPath();
    const n = Math.round((cv.width * cv.height) / 180);
    for (let k = 0; k < n; k++) {
      const sx = hr(k, text.length, 13) * cv.width, sy = hr(k, text.length, 17) * cv.height, len = 5 + hr(k, 3, 19) * 12;
      x.moveTo(sx, sy);
      x.lineTo(sx + len, sy - len * 0.45);
    }
    x.stroke();
    this.words.set(key, cv);
    return cv;
  }

  /** The slices of this line's gags that fall on the piece of wall from u0 to u1, clipped to its face. */
  private wallGraffiti(e: Edge, face: Pt[], at: (u: number, h: number) => Pt, u0: number, u1: number) {
    const along = e.nx !== 0, gags = this.wallGags().get(`${along ? 'x' : 'y'}${along ? e.a[0] : e.a[1]}:${e.nx},${e.ny}`);
    if (!gags?.length) return;
    const c = this.c;
    let clipped = false;
    for (const g of gags) {
      const w = this.gagWidth(g);
      if (!w || g.u + w / 2 < u0 || g.u - w / 2 > u1) continue;
      const im = g.doodle ? env(g.doodle)! : this.chalkWord(g.word!, g.font!);
      if (!clipped) { c.save(); pth(c, face); c.clip(); clipped = true; }
      const [m, d] = this.wallFrame(at, g.u, g.h), h = (w * im.height) / im.width;
      c.save();
      c.transform(d[0], d[1], 0, 1, m[0], m[1]);
      c.rotate(g.tilt);
      if (g.flip) c.scale(-1, 1);
      c.globalAlpha = g.word ? 0.9 : 0.85;
      c.drawImage(im, -w / 2, -h / 2, w, h);
      c.restore();
    }
    if (clipped) c.restore();
  }

  /** Brick texture on a vertical face, repeating along world coordinate u; the strip's height spans fullH (the face's own height unless given), top edge at the top of the face. */
  private wallTex(im: HTMLImageElement, face: Pt[], at: (u: number, h: number) => Pt, u0: number, u1: number, H: number, dark: number, fullH = H) {
    const c = this.c, s = fullH / im.height, period = im.width * s;
    c.save();
    pth(c, face);
    c.clip();
    for (let k = Math.floor(u0 / period); k * period < u1; k++) {
      const o = at(k * period, H), e = at(k * period + 1, H);
      c.save();
      c.transform((e[0] - o[0]) * s, (e[1] - o[1]) * s, 0, s, o[0], o[1]);
      c.drawImage(im, 0, 0);
      c.restore();
    }
    pth(c, face); c.fillStyle = `rgba(20,10,5,${dark})`; c.fill();
    pth(c, [at(u0 - 1, 0), at(u1 + 1, 0), at(u1 + 1, 4), at(u0 - 1, 4)]); c.fillStyle = 'rgba(15,8,4,.3)'; c.fill();
    c.restore();
  }

  draw(c: Ctx, cam: Camera, g: Game, t: number, view: { w: number; h: number; dpr: number }, aim: Aim | null, carry: Carry | null = null) {
    this.carry = carry?.moved ? carry : null;
    this.aim = aim;
    this.c = c; this.cam = cam; this.g = g; this.t = t;
    const S = g.S, { w, h, dpr } = view;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the backdrop gradient and the vignette live in CSS: full-screen gradients every frame are what made phones crawl
    c.clearRect(0, 0, w, h);
    const bgCss = `radial-gradient(ellipse at 50% 50%, ${S.biome.bg[0]}, ${S.biome.bg[1]} 75%)`;
    if (this.bgCss !== bgCss) { c.canvas.style.background = bgCss; this.bgCss = bgCss; }

    let sx = 0, sy = 0;
    this.introAt();
    const shake = Math.max(S.shake > 0 ? 1 : 0, this.introShake());
    if (shake > 0 && !reduce) { sx = (Math.random() - 0.5) * 6 * shake; sy = (Math.random() - 0.5) * 4 * shake; }
    const z = cam.zoom;
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cam.panX + sx), dpr * (cam.panY + sy));
    // round ends on every stroke: everything that sets the line cap sets it round, so this is how a frame looked anyway
    // once anything had been drawn, and the kept floor starts from the same brush
    c.lineJoin = 'round';
    c.lineCap = 'round';

    this.drawUnder(c, view, sx !== 0 || sy !== 0);
    this.drawGround();
    this.drawIntroFloor();
    this.drawAimLine(aim);
    this.drawHammer();
    this.drawEyes();

    const items: [number, () => void][] = [];
    for (const d of S.discs) if (!d.gone) items.push([cam.depth(d.x, d.y), () => this.drawDisc(d)]);
    for (const hs of S.heroes) { const p = g.figureAt(hs); if (p) items.push([cam.depth(p.x, p.y) + 2, () => this.drawHero(hs)]); }
    const cr = this.carry;
    if (cr) {
      const [wx, wy] = cam.screenToWorld(cr.x, cr.y);
      items.push([cam.depth(wx, wy) + 2, () => this.drawHero(cr.hero, { x: wx, y: wy })]);
    }
    // the rat swarm down a burrow is only its eyes in the hole
    for (const m of S.mobs) if (m.dead <= 1 && m.under === undefined) items.push([cam.depth(m.x, m.y), () => this.drawMob(m)]);
    this.cuffItems(items);
    for (const b of S.blocks) items.push([cam.depth(b.x0 + 8, b.y0 + 8), () => this.drawBlock(b)]);
    for (const n of S.nodes) items.push([cam.depth(n.x, n.y), () => this.drawNode(n)]);
    for (const f of S.food) items.push([cam.depth(f.x, f.y) - 0.5, () => this.drawFood(f)]);
    for (const b of S.bombs) items.push([cam.depth(b.x, b.y) - 0.5, () => this.drawBomb(b)]);
    for (const p of S.sparks) if (p.k) items.push([cam.depth(p.x, p.y) + 0.5, () => this.drawChip(p)]);
    this.wallItems(items);
    this.introItems(items);
    const tr = S.trinket;
    if (tr && tr.by === undefined) items.push([cam.depth(tr.x, tr.y), () => this.drawTrinket(tr)]);
    items.sort((a, b) => a[0] - b[0]).forEach(i => i[1]());

    this.drawOmens();
    this.drawPuffs();
    if (S.spec.smoke && S.phase !== 'over') this.drawSmoke(view);
    this.drawAimPull(aim);
    this.drawFx();
    this.drawIntroOver();
    this.drawSay(view);

  }

  // ------------------------------------------------------------ room shell

  /**
   * The lips and the floor as last drawn, kept while nothing on them changes: they lie under everything else and take
   * about a third of a frame, so with the camera still they go on in one stamp. `key` is what the kept picture shows,
   * `seen` what the frame before asked for: a moving camera asks for a new floor every frame, so it is drawn straight
   * on the screen then and kept only once the camera holds still. `fill`, `stroke` and `lw` are the brush the floor
   * leaves behind, handed on to the rest of the frame as if it had been drawn there.
   */
  private under: { cv: HTMLCanvasElement; key: string; seen: string; fill: string | CanvasGradient | CanvasPattern; stroke: string | CanvasGradient | CanvasPattern; lw: number } | null = null;
  /** A number per room met, so a new room never takes the last one's floor. */
  private rooms = new WeakMap<object, number>();
  private roomsMet = 0;

  /** Everything the lips and the floor are drawn from, the table's shake aside; null when they can't be kept (code-drawn lava bubbles). */
  private underKey(dpr: number): string | null {
    const S = this.g.S, cam = this.cam, c = this.c;
    if (S.biome.haz === 'lava' && S.haz.size && !this.lavaTex()) return null;
    if (!this.rooms.has(S)) this.rooms.set(S, ++this.roomsMet);
    return [
      c.canvas.width, c.canvas.height, dpr, cam.zoom, cam.panX, cam.panY, cam.rot, cam.cx, cam.cy, this.rooms.get(S), envArt.size, S.pits.length,
      [...S.haz].join(' '), S.ice.join(''),
      S.blocks.map(b => `${b.x0},${b.y0},${b.x1},${b.y1},${b.ice ? 1 : 0}`).join(' '),
      S.nodes.map(n => `${n.k},${n.x},${n.y},${n.s ?? 1},${n.left > 0 ? 1 : 0}`).join(' '),
      S.mobs.map(o => (o.hp > 0 ? `${o.k},${o.tx},${o.ty},${o.under ?? ''}` : '')).join(' '),
      S.mobs.map(o => o.shards?.join(';') ?? '').join(' '),
    ].join('|');
  }

  private drawUnder(c: Ctx, view: { dpr: number }, shaking: boolean) {
    const { dpr } = view, cam = this.cam, key = this.underKey(dpr);
    const u = (this.under ??= { cv: document.createElement('canvas'), key: '', seen: '', fill: '', stroke: '', lw: 1 });
    // a shaking table is drawn straight for its moment, and the kept floor is there again once it stops
    if (key === null || shaking || key !== u.seen) {
      u.seen = key ?? '';
      this.drawLips();
      this.drawFloor();
    } else {
      if (key !== u.key) {
        const cv = u.cv;
        if (cv.width !== c.canvas.width || cv.height !== c.canvas.height) { cv.width = c.canvas.width; cv.height = c.canvas.height; }
        const f = cv.getContext('2d')!;
        f.setTransform(1, 0, 0, 1, 0, 0);
        f.clearRect(0, 0, cv.width, cv.height);
        f.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.panX, dpr * cam.panY);
        f.lineJoin = c.lineJoin;
        f.lineCap = c.lineCap;
        this.c = f;
        try { this.drawLips(); this.drawFloor(); } finally { this.c = c; }
        Object.assign(u, { key, fill: f.fillStyle, stroke: f.strokeStyle, lw: f.lineWidth });
      }
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(u.cv, 0, 0);
      c.restore();
      c.fillStyle = u.fill;
      c.strokeStyle = u.stroke;
      c.lineWidth = u.lw;
    }
    this.drawOver();
  }

  /** Base colour of a vertical face whose outward normal is n; faces turned left catch the light. */
  private shade(n: Vec, cols: [string, string]) {
    const side = this.cam.sideways(n[0], n[1]);
    return mix(cols[0], cols[1], 0.5 - 0.5 * side);
  }

  /** Edges whose rock lies away from the viewer get a tall wall; the rest a low lip below the floor. */
  private isBack(e: Edge) {
    return this.cam.facing(e.nx, e.ny) < -1e-6;
  }

  private drawLips() {
    const { c, P, cam } = this;
    const S = this.g.S, B = S.biome;
    const key = (e: Edge) => cam.depth((e.a[0] + e.b[0]) / 2 + e.nx * 8, (e.a[1] + e.b[1]) / 2 + e.ny * 8);
    for (const e of S.edges.filter(e => !this.isBack(e)).sort((a, b) => key(a) - key(b))) {
      const A = P(...e.a), Bp = P(...e.b);
      pth(c, [A, Bp, P(...e.b, -9), P(...e.a, -9)]);
      c.fillStyle = mix(this.shade([e.nx, e.ny], B.w), '#000000', 0.3);
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = OL;
      c.beginPath();
      c.moveTo(...P(...e.a, -9)); c.lineTo(...P(...e.b, -9));
      if (!e.contA) { c.moveTo(...A); c.lineTo(...P(...e.a, -9)); }
      if (!e.contB) { c.moveTo(...Bp); c.lineTo(...P(...e.b, -9)); }
      c.stroke();
    }
  }

  /** Depth-sorted wall pieces, one per floor-cell edge that faces away from the viewer. */
  private wallItems(items: [number, () => void][]) {
    const cam = this.cam;
    for (const e of this.g.S.edges) {
      if (!this.isBack(e)) continue;
      items.push([cam.depth((e.a[0] + e.b[0]) / 2 + e.nx * 8, (e.a[1] + e.b[1]) / 2 + e.ny * 8), () => this.drawWall(e)]);
    }
  }

  private drawWall(e: Edge) {
    const { c, P } = this;
    const B = this.g.S.biome, H = WALL_H;
    const [ax, ay] = e.a, [bx, by] = e.b;
    const base = this.shade([-e.nx, -e.ny], B.w);
    const A = P(ax, ay), Bp = P(bx, by), At = P(ax, ay, H), Bt = P(bx, by, H);
    const along = e.nx !== 0, u0 = along ? ay : ax, line = along ? ax * 3 + 1 : ay * 3 + 2;
    const at = (u: number, h: number) => (along ? P(ax, u, h) : P(u, ay, h));
    const wt = env(`wall_${this.bk}`);
    if (wt) this.wallTex(wt, [A, Bp, Bt, At], at, u0, u0 + TILE, H, 0.06 + 0.2 * (0.5 + 0.5 * this.cam.sideways(-e.nx, -e.ny)));
    else this.stones([A, Bp, Bt, At], at, u0, u0 + TILE, H, base, line);
    this.wallGraffiti(e, [A, Bp, Bt, At], at, u0, u0 + TILE);
    pth(c, [At, Bt, P(bx, by, H + 4), P(ax, ay, H + 4)]);
    c.fillStyle = B.cap;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = OL;
    c.beginPath();
    c.moveTo(...At); c.lineTo(...Bt);
    c.moveTo(...P(ax, ay, H + 4)); c.lineTo(...P(bx, by, H + 4));
    if (!e.contA) { c.moveTo(...A); c.lineTo(...P(ax, ay, H + 4)); }
    if (!e.contB) { c.moveTo(...Bp); c.lineTo(...P(bx, by, H + 4)); }
    c.stroke();
    // a torch on every fourth piece of wall, a banner now and then
    const k = along ? e.j : e.i;
    const [mx, my] = P((ax + bx) / 2, (ay + by) / 2, 31);
    if (k % 4 === 2) this.drawTorch(...P((ax + bx) / 2, (ay + by) / 2, 19), ax + ay);
    else if (k % 4 === 0 && (e.i + e.j) % 3 === 0 && env('banner')) this.onWall(env('banner')!, at, u0 + TILE / 2, H - 1, 11);
    else if (k % 4 === 1 && this.bk === 'prison' && hr(e.i, e.j, 77) < 0.5 && env('shackles')) this.onWall(env('shackles')!, at, u0 + TILE / 2, H - 7, 6.5);
    else if (k % 4 === 0 && (e.i + e.j) % 3 === 0) {
      // rod, then a ragged cloth with a sun badge and a darker fold down one side
      c.lineCap = 'round';
      c.strokeStyle = INK; c.lineWidth = 3.4; c.beginPath(); c.moveTo(mx - 7, my - 1); c.lineTo(mx + 7, my - 1); c.stroke();
      c.strokeStyle = '#8a5a32'; c.lineWidth = 1.6; c.stroke();
      const cloth: Pt[] = [[mx - 5.5, my], [mx + 5.5, my], [mx + 5.8, my + 15], [mx + 3, my + 12.5], [mx + 0.5, my + 17], [mx - 2.5, my + 12.8], [mx - 5.8, my + 16]];
      pth(c, cloth); fs(c, '#9c3a3a', DL + 0.3);
      pth(c, [[mx + 2.5, my], [mx + 5.5, my], [mx + 5.8, my + 15], [mx + 3, my + 12.5]]); c.fillStyle = '#6e2628'; c.fill();
      pth(c, cloth); c.lineWidth = DL + 0.4; c.strokeStyle = INK; c.stroke();
      circ(c, mx, my + 6, 2.6); fs(c, '#e2b54a', DL);
    }
  }

  /**
   * Chunky cartoon stones on a vertical face (screen quad `face`); `at(u, h)` maps a world coordinate along the face and
   * a height to the screen. Joints come from world coordinates, so neighbouring pieces of wall line up.
   */
  private stones(face: Pt[], at: (u: number, h: number) => Pt, u0: number, u1: number, H: number, base: string, line: number, rowH = 11.3) {
    const c = this.c;
    c.save();
    pth(c, face);
    c.fillStyle = mix(base, '#000000', 0.45);
    c.fill();
    c.clip();
    const rows = Math.max(1, Math.round(H / rowH)), rh = H / rows, g = 0.55;
    for (let r = 0; r < rows; r++) {
      const h0 = r * rh + g, h1 = (r + 1) * rh - g;
      const brk = (k: number) => k * 10 + (r % 2) * 5 + (hr(k, r, line) - 0.5) * 4.5;
      for (let k = Math.floor((u0 - 15) / 10); k < Math.ceil((u1 + 15) / 10); k++) {
        const s0 = brk(k) + g, s1 = brk(k + 1) - g;
        if (s1 < u0 - 1 || s0 > u1 + 1) continue;
        const v = hr(k, r, line + 7), cc = Math.min(1.6, (s1 - s0) / 3);
        // a bevelled stone: cut corners read as hand-drawn rounded blocks
        const pts: Pt[] = [at(s0 + cc, h0), at(s1 - cc, h0), at(s1, h0 + cc), at(s1, h1 - cc), at(s1 - cc, h1), at(s0 + cc, h1), at(s0, h1 - cc), at(s0, h0 + cc)];
        pth(c, pts);
        c.fillStyle = v < 0.28 ? mix(base, '#000000', 0.13) : v > 0.82 ? mix(base, '#ffffff', 0.09) : base;
        c.fill();
        // cel shadow along the bottom of every stone, a lit lip along its top
        pth(c, [at(s0 + cc, h0), at(s1 - cc, h0), at(s1, h0 + cc), at(s1, h0 + 2.4), at(s0, h0 + 2.4), at(s0, h0 + cc)]);
        c.fillStyle = 'rgba(20,10,5,.22)'; c.fill();
        c.strokeStyle = 'rgba(255,240,215,.22)'; c.lineWidth = 0.9;
        c.beginPath(); c.moveTo(...at(s0 + cc + 0.6, h1 - 1)); c.lineTo(...at(s1 - cc - 0.6, h1 - 1)); c.stroke();
        pth(c, pts);
        c.strokeStyle = INK; c.lineWidth = DL; c.stroke();
        if (hr(k, r, line + 13) < 0.16) {
          const m = (s0 + s1) / 2;
          c.beginPath(); c.moveTo(...at(m - 2, h1)); c.lineTo(...at(m - 0.5, h1 - 3)); c.lineTo(...at(m + 1, h1 - 4)); c.lineTo(...at(m + 0.5, h1 - 6.5));
          c.lineWidth = 0.8; c.stroke();
        }
      }
    }
    // contact shadow where the wall meets the floor
    pth(c, [at(u0 - 1, 0), at(u1 + 1, 0), at(u1 + 1, 4), at(u0 - 1, 4)]);
    c.fillStyle = 'rgba(15,8,4,.28)'; c.fill();
    c.restore();
  }

  private drawTorch(sx: number, sy: number, seed: number) {
    const c = this.c, B = this.g.S.biome, fl = reduce ? 1 : 0.92 + Math.sin(this.t * 11 + seed) * 0.08;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.glowSprite(B.torch), sx - 50 * fl, sy - 50 * fl, 100 * fl, 100 * fl);
    c.restore();
    const ti = env('torch');
    if (ti) { this.standee(ti, sx, sy + 12, 8.5); return; }
    c.lineJoin = 'round';
    // iron bracket, wooden handle, then a big three-tongued flame with an inked rim
    pth(c, [[sx - 3.2, sy + 6], [sx + 3.2, sy + 6], [sx + 2, sy + 9.5], [sx - 2, sy + 9.5]]); fs(c, '#4a4440', DL);
    pth(c, [[sx - 1.7, sy - 1], [sx + 1.7, sy - 1], [sx + 1.1, sy + 11], [sx - 1.1, sy + 11]]); fs(c, '#7a4e2c', DL);
    pth(c, [[sx - 2.9, sy - 1.6], [sx + 2.9, sy - 1.6], [sx + 2.4, sy + 1], [sx - 2.4, sy + 1]]); fs(c, '#5a524c', DL);
    const f = (k: number, ox: number, top: number) => {
      c.beginPath();
      c.moveTo(sx + ox, sy - top * fl);
      c.bezierCurveTo(sx + ox + 4 * k, sy - top * 0.55 * fl, sx + 5.5 * k, sy - 4, sx + 3.6 * k, sy - 1);
      c.quadraticCurveTo(sx, sy + 0.8, sx - 3.6 * k, sy - 1);
      c.bezierCurveTo(sx - 5.5 * k, sy - 4.5, sx - 3 * k, sy - 6 * fl, sx - 1.8 * k, sy - 9 * fl);
      c.quadraticCurveTo(sx - 0.8 * k, sy - 6.5 * fl, sx + ox, sy - top * fl);
      c.closePath();
    };
    f(0.85, 0.5, 13); fs(c, '#f07f2c', DL + 0.2);
    f(0.52, 0.3, 9); c.fillStyle = '#ffd25a'; c.fill();
    circ(c, sx, sy - 2.6, 1.2); c.fillStyle = '#fff6c8'; c.fill();
  }

  /** Torch light pre-rendered once per biome; stamping an image is far cheaper than a fresh gradient per torch per frame. */
  private glowSprite(rgb: string) {
    if (this.glow?.key === rgb) return this.glow.img;
    const img = document.createElement('canvas'), n = 64;
    img.width = img.height = n;
    const gc = img.getContext('2d')!, g = gc.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, `rgba(${rgb},.4)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    gc.fillStyle = g;
    gc.fillRect(0, 0, n, n);
    this.glow = { key: rgb, img };
    return img;
  }

  private drawFloor() {
    const { c, P, g } = this;
    const S = g.S, B = S.biome, gap = 0.9, t = this.t;
    // plain tiles go into a handful of batched paths: one fill per colour instead of several per tile
    const quad = (x0: number, y0: number, x1: number, y1: number) => {
      const a = P(x0, y0), b = P(x1, y0), d = P(x1, y1), e = P(x0, y1);
      c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath();
    };
    const cells: [number, number][] = [], hazard: [number, number][] = [];
    for (let i = 0; i < S.gw; i++) for (let j = 0; j < S.gh; j++) {
      if (!isFloor(S, i, j)) continue;
      if (S.haz.has(hazKey(i, j))) hazard.push([i, j]); else cells.push([i, j]);
    }
    c.beginPath();
    for (const [i, j] of [...cells, ...hazard]) quad(i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE);
    c.fillStyle = mix(B.g, '#000000', 0.25);
    c.fill();
    const g2 = 1.2;
    const inner = (i: number, j: number) => quad(i * TILE + g2, j * TILE + g2, (i + 1) * TILE - g2, (j + 1) * TILE - g2);
    const slabs = [0, 1, 2, 3, 4, 5, 6, 7].map(k => env(`slab_${this.bk}_${k}`)).filter((im): im is HTMLImageElement => !!im);
    if (slabs.length) {
      for (const [i, j] of cells) {
        const im = slabs[Math.floor(hr(i, j, 41) * slabs.length)];
        this.imgOnRect(im, i * TILE + 0.6, j * TILE + 0.6, (i + 1) * TILE - 0.6, (j + 1) * TILE - 0.6, Math.floor(hr(i, j, 42) * 4));
      }
    } else {
      // three flat tones of slab, scattered, plus a darker cel band along one side of each slab
      for (const alt of [0, 1, 2]) {
        c.beginPath();
        for (const [i, j] of cells) { const v = hr(i, j, 3); if ((v < 0.18 ? 2 : v < 0.45 ? 1 : 0) === alt) inner(i, j); }
        c.fillStyle = alt === 2 ? mix(B.f[0], '#000000', 0.12) : B.f[alt];
        c.fill();
      }
      c.beginPath();
      for (const [i, j] of cells) quad(i * TILE + g2, (j + 1) * TILE - g2 - 2.6, (i + 1) * TILE - g2, (j + 1) * TILE - g2);
      c.fillStyle = 'rgba(20,10,5,.16)';
      c.fill();
      // chipped corners and cracks on some slabs
      c.beginPath();
      for (const [i, j] of cells) {
        const v = hr(i, j, 5), x0 = i * TILE + g2, y0 = j * TILE + g2, x1 = (i + 1) * TILE - g2;
        if (v < 0.22) { const a = P(x1, y0), b = P(x1 - 3.5, y0), d = P(x1, y0 + 3); c.moveTo(...a); c.lineTo(...b); c.lineTo(...d); c.closePath(); }
        else if (v > 0.86) { const a = P(x0, y0 + 4), b = P(x0 + 3, y0); c.moveTo(...a); c.lineTo(...b); c.lineTo(...P(x0, y0)); c.closePath(); }
      }
      c.fillStyle = mix(B.g, '#000000', 0.25);
      c.fill();
      c.beginPath();
      for (const [i, j] of cells) inner(i, j);
      c.strokeStyle = INK;
      c.lineWidth = 0.9;
      c.stroke();
      c.beginPath();
      for (const [i, j] of cells) {
        if (hr(i, j, 9) > 0.16) continue;
        // a crack running in from a slab edge, wandering a little, sometimes forking
        let x = i * TILE + 3 + hr(i, j, 10) * 10, y = j * TILE + 1.5, a = 0.9 + hr(i, j, 11) * 1.3;
        if (hr(i, j, 12) > 0.5) { const t = x - i * TILE; x = i * TILE + 1.5; y = j * TILE + t; a -= 1.2; }
        c.moveTo(...P(x, y));
        for (let k = 0; k < 3; k++) {
          a += (hr(i, j, 20 + k) - 0.5) * 1.4;
          x += Math.cos(a) * 2.6; y += Math.sin(a) * 2.6;
          c.lineTo(...P(x, y));
          if (k === 1 && hr(i, j, 30) < 0.5) { c.lineTo(...P(x + Math.cos(a - 1) * 2.2, y + Math.sin(a - 1) * 2.2)); c.moveTo(...P(x, y)); }
        }
      }
      c.lineWidth = 0.75;
      c.stroke();
    }
    // ice patches: whole tiles glazed over, joints hidden under the ice (the glint drifting across them is drawn live, in drawOver)
    const iced = cells.filter(([i, j]) => S.ice[j * S.gw + i]);
    if (iced.length) {
      c.beginPath();
      for (const [i, j] of iced) quad(i * TILE - 0.2, j * TILE - 0.2, (i + 1) * TILE + 0.2, (j + 1) * TILE + 0.2);
      c.fillStyle = '#b9dbe6';
      c.fill();
      c.beginPath();
      for (const [i, j] of iced) if ((i * 5 + j * 3) % 4 === 0) quad(i * TILE + 2, j * TILE + 2, (i + 1) * TILE - 2, (j + 1) * TILE - 2);
      c.fillStyle = '#cde8f0';
      c.fill();
    }
    // touching lava cells are one pool: one picture running across them, inked only along the pool's edge
    const lava = B.haz === 'lava', lv = lava ? this.lavaTex() : null;
    for (const [i, j] of hazard) {
      if (lava) {
        const x0 = i * TILE, y0 = j * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
        if (lv) {
          const cw = lv.width / 4, ch = lv.height / 4;
          this.imgOnRect(lv, x0, y0, x1, y1, 0, 0, [(((i % 4) + 4) % 4) * cw, (((j % 4) + 4) % 4) * ch, cw, ch]);
          continue;
        }
        pth(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
        c.fillStyle = '#ef6a24';
        c.fill();
        // flat molten swirls with an inked rim, and bubbles that pop
        for (const [ox, oy, r] of [[5, 6, 3], [11, 10, 2.4]]) {
          const [bx, by] = P(i * TILE + ox, j * TILE + oy);
          ell(c, bx, by, r * 1.3, r * 0.65); fs(c, '#ffc23d', 0.7);
        }
        const ph = (t * 0.8 + i * 0.37 + j * 0.51) % 1, [bx, by] = P(i * TILE + 10, j * TILE + 5);
        circ(c, bx, by - ph * 1.5, 0.5 + ph * 1.6); c.fillStyle = `rgba(255,240,170,${1 - ph})`; c.fill();
        continue;
      }
      const x0 = i * TILE + gap, y0 = j * TILE + gap, x1 = (i + 1) * TILE - gap, y1 = (j + 1) * TILE - gap;
      pth(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
      fs(c, '#4a3f38', 0.9);
      {
        // iron spikes: a lit face and a dark face, inked
        for (const [ox, oy] of [[5, 5], [11, 6], [7, 11], [12, 12]]) {
          const [sx, sy] = P(i * TILE + ox, j * TILE + oy);
          ell(c, sx, sy, 2.4, 1.1); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill();
          pth(c, [[sx - 2, sy], [sx, sy - 6], [sx, sy + 0.6]]); c.fillStyle = '#e6e3dc'; c.fill();
          pth(c, [[sx, sy + 0.6], [sx, sy - 6], [sx + 2, sy]]); c.fillStyle = '#8f8a84'; c.fill();
          pth(c, [[sx - 2, sy], [sx, sy - 6], [sx + 2, sy], [sx, sy + 0.6]]); c.strokeStyle = INK; c.lineWidth = 0.8; c.stroke();
        }
      }
    }
    if (lava && hazard.length) {
      c.beginPath();
      for (const [i, j] of hazard) for (const [di, dj, ax, ay, bx, by] of SIDES) {
        if (S.haz.has(hazKey(i + di, j + dj))) continue;
        c.moveTo(...P((i + ax) * TILE, (j + ay) * TILE)); c.lineTo(...P((i + bx) * TILE, (j + by) * TILE));
      }
      c.strokeStyle = INK;
      c.lineWidth = BL;
      c.lineCap = 'round';
      c.stroke();
    }
    // stone blocks' shadows as one shape, so blocks standing together don't darken each other's
    c.beginPath();
    for (const b of S.blocks) {
      if (b.ice) continue;
      const fp = [P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)];
      fp.forEach(([x, y], k) => (k ? c.lineTo(x + 4, y + 2.5) : c.moveTo(x + 4, y + 2.5)));
      c.closePath();
    }
    c.fillStyle = 'rgba(15,8,4,.35)';
    c.fill();
    // only faint stains on the floor: the drawn bones and cracks looked poor
    for (const dc of S.decals) {
      if (dc.k !== 0) continue;
      const [dx, dy] = P(dc.x, dc.y);
      ell(c, dx, dy, 7, 3); c.fillStyle = 'rgba(25,15,10,.22)'; c.fill();
    }
    // a spent resource leaves only a flat scatter of chips on its cell, not something to bounce off
    for (const n of S.nodes) {
      if (n.left > 0) continue;
      // a vein on 2 × 2 cells leaves a scatter as big as it was
      const [dx, dy] = P(n.x, n.y), z = n.s ?? 1;
      ell(c, dx, dy, 9 * z, 4.2 * z); c.fillStyle = 'rgba(25,15,10,.18)'; c.fill();
      const tint = n.k === 'ore' ? '#e8b44a' : n.k === 'spk' ? '#a98ae8' : '#c9584a';
      const chips: [number, number, number, boolean][] = [[-4, -1, 1.4, false], [3, -3, 1.1, true], [1, 2.5, 1.3, false], [-2, 3.5, 0.9, true], [5, 2, 1, false], [-5, 2, 0.8, true]];
      for (const [ox, oy, r0, tinted] of chips) {
        const [x, y] = P(n.x + ox * z, n.y + oy * z), r = r0 * z;
        pth(c, [[x - r * 1.4, y], [x, y - r * 0.6], [x + r * 1.4, y], [x, y + r * 0.6]]);
        c.fillStyle = tinted ? tint : n.k === 'ore' ? 'rgba(78,84,96,.85)' : 'rgba(120,110,104,.85)';
        c.fill();
      }
    }
    // the cells enemies and resources stand on are shaded like a square on a board; enemies get a red rim
    c.beginPath();
    for (const n of S.nodes) if (n.left > 0) { const z = n.s ?? 1, [i, j] = cellAt(n.x, n.y, z); quad(i * TILE + g2, j * TILE + g2, (i + z) * TILE - g2, (j + z) * TILE - g2); }
    for (const m of S.mobs) if (m.hp > 0 && m.under === undefined) { const s = mobSize(m.k), [i, j] = cellAt(m.tx, m.ty, s); quad(i * TILE + gap, j * TILE + gap, (i + s) * TILE - gap, (j + s) * TILE - gap); }
    c.fillStyle = 'rgba(25,15,10,.2)';
    c.fill();
    c.beginPath();
    for (const m of S.mobs) if (m.hp > 0 && m.under === undefined) { const s = mobSize(m.k), [i, j] = cellAt(m.tx, m.ty, s); quad(i * TILE + 1.6, j * TILE + 1.6, (i + s) * TILE - 1.6, (j + s) * TILE - 1.6); }
    c.strokeStyle = 'rgba(184,50,63,.55)';
    c.lineWidth = 0.9;
    c.stroke();
    // a toilet stands on a square of bathroom tiles, a mushroom patch on a meadow
    for (const n of S.nodes) if (n.left > 0) this.drawPad(n);
    c.strokeStyle = INK;
    c.lineWidth = OL;
    c.beginPath();
    for (const e of S.edges) { c.moveTo(...P(...e.a)); c.lineTo(...P(...e.b)); }
    c.stroke();
    for (const p of S.pits) this.drawPit(p);
    this.drawShards();
    if (B.mu < 30) {
      c.strokeStyle = 'rgba(255,255,255,.5)';
      c.lineWidth = 0.8;
      for (let k = 0; k < 18; k++) {
        const wx = ((k * 53) % (S.Wx - 10)) + 5, wy = ((k * 31) % (S.Wy - 10)) + 5;
        if (!floorAt(S, wx, wy)) continue;
        const [sx, sy] = P(wx, wy);
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + 5, sy - 1.5); c.stroke();
      }
    }
  }

  /**
   * What moves on the floor, drawn every frame over the kept floor: the glint drifting across ice and, while heroes are
   * being placed, the pulsing throw runes.
   */
  private drawOver() {
    const { c, P, g } = this;
    const S = g.S, t = this.t;
    const iced: [number, number][] = [];
    for (let i = 0; i < S.gw; i++) for (let j = 0; j < S.gh; j++) {
      if (isFloor(S, i, j) && !S.haz.has(hazKey(i, j)) && S.ice[j * S.gw + i] && !((i * 3 + j * 7) % 3)) iced.push([i, j]);
    }
    if (iced.length) {
      c.strokeStyle = 'rgba(255,255,255,.75)';
      c.lineWidth = 0.8;
      c.beginPath();
      for (const [i, j] of iced) {
        const ph = reduce ? 0.5 : (t * 0.15 + (i + j) * 0.09) % 1;
        const u = 3 + ph * 8;
        c.moveTo(...P(i * TILE + u, j * TILE + 4)); c.lineTo(...P(i * TILE + u + 4, j * TILE + 8));
      }
      c.stroke();
    }
    // throw runes: only while heroes are being placed, the fight itself hides them
    if (S.phase !== 'place') return;
    const h = g.hero, canMove = g.canControl(h) && g.canPlace(h), cr = this.carry;
    S.pads.forEach((p, k) => {
      const occ = S.heroes.find(o => o.pad === k && o.hp > 0), [sx, sy] = P(p.x, p.y);
      const on = !occ && canMove, pulse = reduce ? 0.8 : 0.6 + Math.sin(t * 5) * 0.3;
      if (cr && cr.pad === k && cr.hero.pad !== k) {
        ell(c, sx, sy, 10, 5);
        c.fillStyle = cr.hero.def.col + '66';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#ffd65a';
        c.stroke();
      }
      ell(c, sx, sy, 9.6, 4.8);
      c.fillStyle = occ ? occ.def.col + '55' : on ? `rgba(255,214,90,${0.35 * pulse})` : 'rgba(255,214,90,.12)';
      c.fill();
      c.lineWidth = 1.4;
      c.strokeStyle = occ ? occ.def.col : on ? `rgba(255,214,90,${pulse})` : 'rgba(255,214,90,.4)';
      c.stroke();
      ell(c, sx, sy, 6, 3);
      c.lineWidth = 0.8;
      c.stroke();
    });
  }

  /** The opening of a hole in the floor as the current path: its cells, one square each, which fill and clip as one shape. */
  private mouth(p: Pit) {
    const { c, P } = this;
    c.beginPath();
    for (const [i, j] of p.cells) {
      const x0 = i * TILE, y0 = j * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
      c.moveTo(...P(x0, y0)); c.lineTo(...P(x1, y0)); c.lineTo(...P(x1, y1)); c.lineTo(...P(x0, y1)); c.closePath();
    }
  }

  /**
   * A hole in the floor, any shape of cells: the far walls of the shaft, in the room's own masonry, sink into the dark in
   * flat bands, and the opening is inked like the edge of the room. A bigger hole shows more of the black below.
   */
  private drawPit(p: Pit) {
    const { c, P, cam } = this;
    const B = this.g.S.biome, D = PIT_D, wt = env(`wall_${this.bk}`);
    // the rim: every cell side with floor beyond it; its face, turned into the hole, shows when it looks at the viewer
    const rim: { a: Vec; b: Vec; n: Vec }[] = [];
    for (const [i, j] of p.cells) for (const [di, dj, ax, ay, bx, by] of SIDES) {
      if (!inPit(p, i + di, j + dj)) rim.push({ a: [(i + ax) * TILE, (j + ay) * TILE], b: [(i + bx) * TILE, (j + by) * TILE], n: [-di, -dj] });
    }
    const mid = (f: { a: Vec; b: Vec }) => cam.depth((f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2);
    const walls = rim.filter(f => cam.facing(f.n[0], f.n[1]) > 1e-6).sort((f, g) => mid(f) - mid(g));
    c.save();
    this.mouth(p);
    c.fillStyle = '#070403';
    c.fill();
    c.clip();
    // far walls first, so a nearer one that juts into the hole hides what is behind it
    for (const f of walls) {
      const alongX = f.n[1] !== 0, u0 = alongX ? f.a[0] : f.a[1], u1 = alongX ? f.b[0] : f.b[1];
      const face: Pt[] = [P(...f.a), P(...f.b), P(...f.b, -D), P(...f.a, -D)];
      const at = (u: number, h: number) => (alongX ? P(u, f.a[1], h - D) : P(f.a[0], u, h - D));
      if (wt) this.wallTex(wt, face, at, u0, u1, D, 0.3 + 0.2 * (0.5 + 0.5 * cam.sideways(f.n[0], f.n[1])), WALL_H);
      else { pth(c, face); c.fillStyle = mix(this.shade(f.n, B.w), '#000000', 0.4); c.fill(); }
      // darker the deeper, in flat cel bands, then black
      for (const [h0, h1, a] of [[3, 8, 0.35], [8, 14, 0.6], [14, D, 0.85]]) {
        pth(c, [P(...f.a, -h0), P(...f.b, -h0), P(...f.b, -h1), P(...f.a, -h1)]);
        c.fillStyle = `rgba(7,4,3,${a})`;
        c.fill();
      }
    }
    // corners where a wall turns, inked down into the dark: the far ones and the ones a corner of floor juts into the hole
    const same = (u: Vec, v: Vec) => u[0] === v[0] && u[1] === v[1];
    c.beginPath();
    const inked: Vec[] = [];
    for (const f of walls) for (const v of [f.a, f.b]) {
      if (inked.some(o => same(o, v)) || walls.some(g => g !== f && g.n[0] === f.n[0] && g.n[1] === f.n[1] && (same(g.a, v) || same(g.b, v)))) continue;
      inked.push(v);
      c.moveTo(...P(...v)); c.lineTo(...P(...v, -12));
    }
    c.strokeStyle = INK;
    c.lineWidth = DL;
    c.stroke();
    c.restore();
    c.beginPath();
    for (const f of rim) { c.moveTo(...P(...f.a)); c.lineTo(...P(...f.b)); }
    c.strokeStyle = INK;
    c.lineWidth = OL;
    c.lineCap = 'round';
    c.stroke();
  }

  /** The cells an enemy marked a turn ahead, while its move is still to come: the mob has not risen, the floor not turned to lava. */
  private *omens(hammer: boolean) {
    const g = this.g;
    if (g.S.phase === 'over') return;
    for (const m of g.liveMobs()) {
      const it = m.intent;
      const flat = it?.t === 'smash' || it?.t === 'zone' || it?.t === 'emerge';
      if (!it?.spots || g.acted(m) || g.frozen(m) || flat !== hammer) continue;
      for (const p of it.spots) yield { m, it, p };
    }
  }

  /**
   * The smasher's hammer square, red on the floor under the figures, so whoever stands in it stands on it; the floor
   * bosses' marked cells the same way, each in the colour of what they do (one path a colour: the dancefloor is half the room).
   */
  private drawHammer() {
    const { c, P } = this, a = reduce ? 0.85 : 0.775 + 0.175 * Math.sin(this.t * 4);
    const by = new Map<string, { x: number; y: number }[]>();
    for (const { it, p } of this.omens(true)) {
      const col = it.t === 'smash' ? '' : it.t === 'zone' ? ZONE_COL[it.z ?? 'cold'] : ZONE_COL.bite;
      (by.get(col) ?? by.set(col, []).get(col)!).push(p);
    }
    for (const [col, ps] of by) {
      c.beginPath();
      for (const p of ps) {
        const x0 = p.x - 7, y0 = p.y - 7, x1 = p.x + 7, y1 = p.y + 7;
        c.moveTo(...P(x0, y0)); c.lineTo(...P(x1, y0)); c.lineTo(...P(x1, y1)); c.lineTo(...P(x0, y1)); c.closePath();
      }
      if (!col) {
        c.fillStyle = `rgba(255,30,20,${0.45 * a})`; c.fill();
        c.strokeStyle = `rgba(255,70,50,${a})`; c.lineWidth = 2; c.stroke();
        continue;
      }
      const rgb = [1, 3, 5].map(k => parseInt(col.slice(k, k + 2), 16)).join(',');
      c.fillStyle = `rgba(${rgb},${0.38 * a})`; c.fill();
      c.strokeStyle = `rgba(${rgb},${a})`; c.lineWidth = 1.4; c.stroke();
    }
  }

  /** The rat swarm down a burrow: pairs of eyes glowing in the hole it will come up by, blinking now and then. */
  private drawEyes() {
    const { c, P, g } = this, S = g.S;
    if (S.phase === 'over') return;
    for (const m of g.liveMobs()) {
      const pit = m.under !== undefined ? S.pits[m.under] : undefined;
      if (!pit) continue;
      const n = Math.min(3, pit.cells.length + 1);
      for (let k = 0; k < n; k++) {
        const [i, j] = pit.cells[k % pit.cells.length], ox = [5, 10, 7][k], oy = [6, 9, 11][k];
        const blink = reduce ? 1 : Math.max(0.15, Math.min(1, Math.abs(Math.sin(this.t * 1.3 + k * 2.1)) * 6));
        const [x, y] = P(i * TILE + ox, j * TILE + oy, -3);
        for (const dx of [-1.6, 1.6]) {
          ell(c, x + dx, y, 1.1, 0.9 * blink);
          c.fillStyle = '#ffe27a'; c.fill();
          ell(c, x + dx, y, 0.45, 0.6 * blink);
          c.fillStyle = '#2a1500'; c.fill();
        }
      }
    }
  }

  /** The disco ball's mirror tiles on the floor: broken glass in a cell, glinting; a disc that stops on them hurts its hero. */
  private drawShards() {
    const { c, P, g } = this;
    for (const m of g.S.mobs) for (const key of m.shards ?? []) {
      const [i, j] = key.split(',').map(Number);
      for (const [ox, oy, r, a] of [[4, 5, 2.4, 0.3], [10.5, 6, 2, 1.4], [6.5, 11, 2.8, 2.2], [12, 12, 1.6, 0.9]]) {
        const pts: Pt[] = [0, 1, 2, 3].map(q => { const t = a + (q * Math.PI) / 2, rr = q % 2 ? r * 0.55 : r; return P(i * TILE + ox + Math.cos(t) * rr, j * TILE + oy + Math.sin(t) * rr); });
        pth(c, pts);
        c.fillStyle = '#cfefff'; c.fill();
        c.strokeStyle = INK; c.lineWidth = 0.5; c.stroke();
        pth(c, [pts[0], pts[1], pts[2]]);
        c.fillStyle = 'rgba(255,255,255,.8)'; c.fill();
      }
    }
  }

  /** Glowing summon circles and tiles about to turn to lava, a turn ahead; drawn over the figures so nothing hides them. */
  private drawOmens() {
    const { c, P } = this;
    const pulse = reduce ? 0.7 : 0.55 + 0.35 * Math.sin(this.t * 4);
    for (const { m, it, p } of this.omens(false)) {
      if (it.t === 'summon') {
        const r = MOBS[MOBS[m.k].acts!.find(a => a.k === 'summon')!.kind!].r + 3, [x, y] = P(p.x, p.y);
        ell(c, x, y, r * 1.27, r * 0.64);
        c.fillStyle = `rgba(150,110,255,${0.3 * pulse})`; c.fill();
        c.strokeStyle = `rgba(200,170,255,${pulse})`; c.lineWidth = 1.6; c.stroke();
        ell(c, x, y, r * 0.8, r * 0.4);
        c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]);
      } else {
        // lava to come
        const x0 = p.x - 7, y0 = p.y - 7, x1 = p.x + 7, y1 = p.y + 7;
        pth(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
        c.fillStyle = `rgba(255,120,40,${0.35 * pulse})`; c.fill();
        c.strokeStyle = `rgba(255,170,70,${pulse})`; c.lineWidth = 1; c.stroke();
      }
    }
  }

  // ------------------------------------------------------------ props

  /** An icicle growing straight out of the floor: a tall cluster or a couple of stubs, cracking as it is hit, shards once broken. */
  private drawIcicle(b: Block) {
    const { c, P } = this;
    const hp = b.hp!, max = b.max!;
    if (hp <= 0) {
      for (const [ox, oy, r] of [[4, 6, 2.2], [10, 4, 1.6], [7, 11, 2.6], [12, 12, 1.8], [3, 13, 1.4]]) {
        const [x, y] = P(b.x0 + ox, b.y0 + oy);
        pth(c, [[x - r, y], [x, y - r * 0.9], [x + r, y], [x, y + r * 0.5]]);
        fs(c, '#cfeaf3', 0.6);
      }
      return;
    }
    const [cx, cy] = P(b.x0 + 8, b.y0 + 8);
    ell(c, cx + 3, cy + 2, 10, 4.5);
    c.fillStyle = 'rgba(15,30,40,.3)';
    c.fill();
    const tall = (b.big ? 30 : 14) + (b.v % 3) * 3;
    const spikes: [number, number, number, number][] = b.big
      ? [[4.5, 4.5, 0.6, 3.2], [11.5, 4, 0.48, 2.7], [3.5, 11.5, 0.44, 2.7], [8.5, 8.5, 1, 4.6], [12, 11.5, 0.7, 3.4], [7, 13, 0.35, 2.2]]
      : [[6, 7, 1, 3.4], [10.5, 10, 0.65, 2.6], [5, 11.5, 0.4, 2]];
    spikes.sort((p, q) => this.cam.depth(b.x0 + p[0], b.y0 + p[1]) - this.cam.depth(b.x0 + q[0], b.y0 + q[1]));
    // frost where the ice meets the floor
    for (const [ox, oy, , r] of spikes) {
      const [x, y] = P(b.x0 + ox, b.y0 + oy);
      ell(c, x, y, r * 1.5, r * 0.65);
      c.fillStyle = 'rgba(214,240,250,.75)';
      c.fill();
    }
    const dmg = 1 - hp / max;
    for (const [ox, oy, k, r] of spikes) {
      const [x, y] = P(b.x0 + ox, b.y0 + oy), [tx, ty] = P(b.x0 + ox, b.y0 + oy, tall * k);
      pth(c, [[x - r, y], [tx, ty], [x, y + r * 0.3]]); c.fillStyle = '#dff4fb'; c.fill();
      pth(c, [[x, y + r * 0.3], [tx, ty], [x + r, y]]); c.fillStyle = '#86bcd3'; c.fill();
      pth(c, [[x - r, y], [tx, ty], [x + r, y], [x, y + r * 0.3]]); c.strokeStyle = INK; c.lineWidth = 1.3; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.8)';
      c.lineWidth = 0.6;
      c.beginPath(); c.moveTo(x - r * 0.4, y - 1); c.lineTo(tx - 0.3, ty + 2); c.stroke();
      if (dmg > 0 && k > 0.6) {
        // cracks spread up the big spikes as they take hits
        const ys = (u: number) => y + (ty - y) * u;
        c.strokeStyle = 'rgba(30,60,80,.75)';
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(x - r * 0.5, ys(0.15)); c.lineTo(x + r * 0.2, ys(0.3)); c.lineTo(x - r * 0.1, ys(0.15 + dmg * 0.5));
        if (dmg > 0.5) { c.moveTo(x + r * 0.6, ys(0.1)); c.lineTo(x + r * 0.1, ys(0.25)); c.lineTo(x + r * 0.3, ys(0.45)); }
        c.stroke();
      }
    }
  }

  private drawBlock(b: Block) {
    const bi = b.ice ? env('icicle') : undefined;
    if (bi && (b.hp ?? 1) > 0) {
      // an ice block is a cut-out standee as wide as its footprint on screen
      const fp = [this.P(b.x0, b.y0), this.P(b.x1, b.y0), this.P(b.x1, b.y1), this.P(b.x0, b.y1)];
      const xs = fp.map(p => p[0]), ys = fp.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs);
      ell(this.c, (x0 + x1) / 2 + 3, Math.max(...ys) - 3, (x1 - x0) * 0.55, (x1 - x0) * 0.22); this.c.fillStyle = 'rgba(15,8,4,.35)'; this.c.fill();
      this.standee(bi, (x0 + x1) / 2, Math.max(...ys) + 2, (x1 - x0) * (b.big ? 1.25 : 0.85));
      return;
    }
    if (b.ice) return this.drawIcicle(b);
    const { c, P, cam } = this;
    const B = this.g.S.biome, H = 24, wt = env(`wall_${this.bk}`), cap = wt && env(`cap_${this.bk}`);
    // blocks standing side by side are one pillar: no wall, cap edge or ink line between them
    const i = b.x0 / TILE, j = b.y0 / TILE, bs = this.stoneBlocks(), solid = (a: number, d: number) => bs.cells.has(hazKey(a, d));
    const faces: { a: Vec; b: Vec; n: Vec }[] = [
      { a: [b.x1, b.y0], b: [b.x1, b.y1], n: [1, 0] },
      { a: [b.x0, b.y1], b: [b.x1, b.y1], n: [0, 1] },
      { a: [b.x0, b.y0], b: [b.x0, b.y1], n: [-1, 0] },
      { a: [b.x0, b.y0], b: [b.x1, b.y0], n: [0, -1] },
    ];
    for (const f of faces) {
      if (cam.facing(f.n[0], f.n[1]) <= 1e-6 || solid(i + f.n[0], j + f.n[1])) continue;
      const face: Pt[] = [P(...f.a), P(...f.b), P(...f.b, H), P(...f.a, H)];
      const alongX = f.a[1] === f.b[1], u0 = alongX ? f.a[0] : f.a[1], u1 = alongX ? f.b[0] : f.b[1];
      const at = (u: number, h: number) => (alongX ? P(u, f.a[1], h) : P(f.a[0], u, h));
      // a pillar is built from the same bricks as the floor's walls, at the same scale, so it turns with the room
      if (wt) this.wallTex(wt, face, at, u0, u1, H, 0.06 + 0.2 * (0.5 + 0.5 * cam.sideways(f.n[0], f.n[1])), WALL_H);
      else this.stones(face, at, u0, u1, H, this.shade(f.n, B.w), (alongX ? f.a[1] : f.a[0]) * 3 + 5, 8);
      // ink along the face's foot and top, and up an end unless the same face runs on into the next block
      const [dx, dy] = alongX ? [1, 0] : [0, 1];
      const runs = (s: number) => solid(i + dx * s, j + dy * s) && !solid(i + dx * s + f.n[0], j + dy * s + f.n[1]);
      c.beginPath();
      c.moveTo(...P(...f.a)); c.lineTo(...P(...f.b));
      c.moveTo(...P(...f.a, H)); c.lineTo(...P(...f.b, H));
      if (!runs(-1)) { c.moveTo(...P(...f.a)); c.lineTo(...P(...f.a, H)); }
      if (!runs(1)) { c.moveTo(...P(...f.b)); c.lineTo(...P(...f.b, H)); }
      c.strokeStyle = INK; c.lineWidth = BL; c.lineCap = 'round'; c.stroke();
    }
    if (cap) this.capTop(cap, b, i, j, solid, bs.deco.has(hazKey(i, j)), H);
    else {
      pth(c, [P(b.x0, b.y0, H), P(b.x1, b.y0, H), P(b.x1, b.y1, H), P(b.x0, b.y1, H)]);
      c.fillStyle = B.cap;
      c.fill();
      if (b.v & 1) {
        c.strokeStyle = INK; c.lineWidth = 0.9; c.beginPath();
        c.moveTo(...P(b.x0 + 3, b.y0 + 8, H)); c.lineTo(...P(b.x0 + 7, b.y0 + 9, H)); c.lineTo(...P(b.x0 + 9, b.y0 + 7, H)); c.lineTo(...P(b.x0 + 13, b.y0 + 9, H));
        c.stroke();
      }
      if (b.v & 2) { const [mx, my] = P(b.x0 + 4, b.y0 + 12, H); ell(c, mx, my, 4.4, 1.8); fs(c, '#6f8f3a', 0.9); ell(c, mx - 1, my - 0.4, 2, 0.7); c.fillStyle = '#93b350'; c.fill(); }
      if (b.v & 4) {
        const [kx, ky] = P(b.x0 + 9, b.y0 + 7, H);
        ell(c, kx, ky - 2, 3.2, 2.8); fs(c, '#efe6cc', 0.9);
        rr(c, kx - 1.6, ky - 0.4, 3.2, 1.8, 0.5); fs(c, '#efe6cc', 0.8);
        circ(c, kx - 1.1, ky - 2.2, 0.75); c.fillStyle = INK; c.fill(); circ(c, kx + 1.1, ky - 2.2, 0.75); c.fill();
      }
    }
    // the cap is inked only along the pillar's outer edge
    c.beginPath();
    for (const [di, dj, ax, ay, bx, by] of SIDES) {
      if (solid(i + di, j + dj)) continue;
      c.moveTo(...P(b.x0 + ax * TILE, b.y0 + ay * TILE, H)); c.lineTo(...P(b.x0 + bx * TILE, b.y0 + by * TILE, H));
    }
    c.strokeStyle = INK; c.lineWidth = BL; c.lineCap = 'round'; c.stroke();
  }

  /**
   * The cap of one block. A block on its own gets the whole picture; in a group each cell gets the colour of its plain middle,
   * the picture's rim along the sides that face out, its corners where two such sides meet, and one cell per group the
   * ornament from the picture's centre.
   */
  private capTop(cap: HTMLImageElement, b: Block, i: number, j: number, solid: (a: number, d: number) => boolean, deco: boolean, H: number) {
    const up = !solid(i, j - 1), dn = !solid(i, j + 1), lf = !solid(i - 1, j), rt = !solid(i + 1, j);
    const { x0, y0, x1, y1 } = b;
    if (up && dn && lf && rt) { this.imgOnRect(cap, x0, y0, x1, y1, 0, H); return; }
    const w = cap.width, h = cap.height, r = 0.2, R = TILE * r;
    const part = (sx: number, sy: number, sw: number, sh: number, tx0: number, ty0: number, tx1: number, ty1: number) =>
      this.imgOnRect(cap, tx0, ty0, tx1, ty1, 0, H, [sx * w, sy * h, sw * w, sh * h]);
    pth(this.c, [this.P(x0, y0, H), this.P(x1, y0, H), this.P(x1, y1, H), this.P(x0, y1, H)]);
    this.c.fillStyle = this.capPlain(cap);
    this.c.fill();
    if (up) part(r, 0, 1 - 2 * r, r, x0, y0, x1, y0 + R);
    if (dn) part(r, 1 - r, 1 - 2 * r, r, x0, y1 - R, x1, y1);
    if (lf) part(0, r, r, 1 - 2 * r, x0, y0, x0 + R, y1);
    if (rt) part(1 - r, r, r, 1 - 2 * r, x1 - R, y0, x1, y1);
    if (up && lf) part(0, 0, r, r, x0, y0, x0 + R, y0 + R);
    if (up && rt) part(1 - r, 0, r, r, x1 - R, y0, x1, y0 + R);
    if (dn && lf) part(0, 1 - r, r, r, x0, y1 - R, x0 + R, y1);
    if (dn && rt) part(1 - r, 1 - r, r, r, x1 - R, y1 - R, x1, y1);
    if (deco) part(0.3, 0.3, 0.4, 0.4, x0 + 0.3 * TILE, y0 + 0.3 * TILE, x1 - 0.3 * TILE, y1 - 0.3 * TILE);
  }

  /**
   * Cartoon resource props, drawn flat in screen space like the figures: a lumpy boulder with gold nuggets,
   * a cluster of violet crystals, or fat spotted mushrooms. Each loses a piece per charge taken.
   */
  /** A crystal or a mushroom patch drawn in code, for when its pictures are missing. */
  private drawNodeShape(n: ResNode, left: number, f: boolean) {
    const c = this.c, [x, y] = this.P(n.x, n.y);
    const W = (col: string) => (f ? '#ffffff' : col);
    c.lineJoin = 'round';
    if (n.k === 'spk') {
      // a little rock, then up to three crystals: a lit left face and a shaded right face, inked
      ell(c, x, y - 1, 7.5, 3.2); fs(c, W('#7d766c'), 1.2);
      const cr: [number, number, number, number][] = [[-4, -1, 10, -0.35], [4, -1, 9, 0.3], [0, 0, 15, 0.05]];
      for (const [ox, oy, L0, lean] of [cr[2], cr[0], cr[1]].slice(0, left).sort((a, b) => a[1] - b[1])) {
        const L = L0 * (0.75 + 0.25 * (left / n.ch)), bx = x + ox, by = y + oy - 1, w = 2.6;
        const tx = bx + lean * L, ty = by - L, sx = bx + lean * L * 0.78, sy = by - L * 0.78;
        pth(c, [[bx - w, by], [sx - w, sy], [tx, ty], [tx, sy + 0.5], [bx, by + 1]]); c.fillStyle = W('#c6b2f4'); c.fill();
        pth(c, [[bx, by + 1], [tx, sy + 0.5], [tx, ty], [sx + w, sy], [bx + w, by]]); c.fillStyle = W('#7650d6'); c.fill();
        pth(c, [[bx - w, by], [sx - w, sy], [tx, ty], [sx + w, sy], [bx + w, by], [bx, by + 1]]); c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke();
        c.lineWidth = 0.7; c.beginPath(); c.moveTo(bx, by + 1); c.lineTo(tx, sy + 0.5); c.lineTo(tx, ty); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(bx - w * 0.5, by - 2); c.lineTo(sx - w * 0.5, sy + 1); c.stroke();
      }
    } else {
      // mushrooms straight on the floor, big one behind
      const sh: [number, number, number][] = [[0, -1.5, 1.35], [5, 1.5, 0.85], [-5, 1.5, 0.7]];
      for (const [ox, oy, s] of sh.slice(0, nodePieces('herb', left))) {
        const mx = x + ox, my = y + oy;
        rr(c, mx - 1.6 * s, my - 6 * s, 3.2 * s, 6 * s, 1.2 * s); fs(c, W('#f1e7d0'), 1);
        c.beginPath(); c.ellipse(mx, my - 6 * s, 5.2 * s, 5 * s, 0, Math.PI, 0); c.quadraticCurveTo(mx, my - 4 * s, mx - 5.2 * s, my - 6 * s); c.closePath();
        fs(c, W('#d24c3a'), 1.2);
        for (const [sx, sy, r] of [[-2.2, -8.5, 1], [1.6, -9.5, 0.8], [3.2, -7, 0.6], [-0.2, -10.6, 0.55]]) { ell(c, mx + sx * s, my + sy * s, r * s * 1.1, r * s); fs(c, W('#fbf3e0'), 0.6); }
      }
    }
  }

  /**
   * An ore vein is a rock built in code over its cell, of slate: a squat prism with a slanted, chamfered outline, sides
   * leaning in and a faceted top, a smaller stone on it while the vein is full, gold nuggets stuck in its sides. A vein
   * in the cell next door grows into the same rock (no wall, no chamfer between them, the higher one steps up), and a
   * vein sinks and loses its gold as its charges go.
   */
  private rockCells() {
    const cells = new Map<string, { q: number; f: number; z: number; ch: number }>();
    for (const m of this.g.S.nodes) {
      if (m.k !== 'ore' || m.left <= 0) continue;
      const z = m.s ?? 1, i0 = Math.round((m.x - 8 * z) / TILE), j0 = Math.round((m.y - 8 * z) / TILE);
      const q = Math.min(m.left, m.ch) / m.ch;
      // one height for the whole vein (one on 2 × 2 cells too), a little different from the vein next door
      const f = 0.9 + 0.2 * (((Math.imul(i0 * 73856093 ^ j0 * 19349663, 2654435761) >>> 0) % 1000) / 1000);
      for (let a = 0; a < z; a++) for (let b = 0; b < z; b++) cells.set(hazKey(i0 + a, j0 + b), { q, f, z, ch: m.ch });
    }
    return cells;
  }

  /** Gold nugget layouts of rock cells (see rockGold). */
  private goldLay = new Map<string, { c: number; u: number; h: number; img: string; s: number; st: number; turn: number; flip: boolean; lv: number }[]>();

  /** The rock's pictures by key, the gold nuggets' keys, and its look; kept once the pictures are in. */
  private rockArt: { I: Record<string, HTMLImageElement>; r: typeof ROCK & { gold: string[] } } | null = null;
  private rockLook() {
    if (this.rockArt?.r.gold.length) return this.rockArt;
    const I: Record<string, HTMLImageElement> = {}, gold = [...envArt.keys()].filter(k => k.startsWith('gold_'));
    for (const k of [ROCK.side, ROCK.top, ...gold]) { const im = env(k); if (im) I[k] = im; }
    return (this.rockArt = { I, r: { ...ROCK, gold } });
  }

  private drawRock(n: ResNode) {
    const { r } = this.rockLook(), cells = this.rockCells(), z = n.s ?? 1, i0 = Math.round((n.x - 8 * z) / TILE), j0 = Math.round((n.y - 8 * z) / TILE);
    const own: [number, number][] = [];
    for (let a = 0; a < z; a++) for (let b = 0; b < z; b++) own.push([i0 + a, j0 + b]);
    own.sort((p, o) => this.cam.depth((p[0] + 0.5) * TILE, (p[1] + 0.5) * TILE) - this.cam.depth((o[0] + 0.5) * TILE, (o[1] + 0.5) * TILE));
    for (const [ci, cj] of own) this.rockCell(ci, cj, cells, r, n.hit > 0);
  }

  private rockCell(ci: number, cj: number, cells: Map<string, { q: number; f: number; z: number; ch: number }>, r: any, struck: boolean) {
    const { I } = this.rockLook(), q = cells.get(hazKey(ci, cj))?.q;
    if (q === undefined) return;
    const hh = (a: number, b: number, k = 0) => {
      let t = (a * 374761393 + b * 668265263 + k * 1442695041) | 0;
      t = Math.imul(t ^ (t >>> 13), 1274126177);
      t = Math.imul(t ^ (t >>> 16), 668265263);
      return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    };
    const low = r.low ?? 0.45, H0 = r.H ?? 11, hv = r.hv ?? 0.2;
    const hOf = (a: number, b: number) => {
      const v = cells.get(hazKey(a, b));
      return v === undefined ? -1 : H0 * (low + (1 - low) * v.q) * v.f;
    };
    // a struck vein jolts down a little
    const ht = hOf(ci, cj) - (struck ? 0.6 : 0);
    const x0 = ci * TILE, y0 = cj * TILE;
    // edges top, right, bottom, left (clockwise on the floor), each with its outward normal and the cell across it
    const E = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(o => ({ n: o, out: !cells.has(hazKey(ci + o[0], cj + o[1])) }));
    const K: Vec[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ins = r.ins ?? 0.7, jit = r.jit ?? 1.4, ov = 0.25;
    // the outline's points, each with a key on the grid, so a point two cells share comes out the same in both
    type V = { x: number; y: number; id: [number, number, number]; edge: number };
    const outline = (): V[] => {
      const pts: V[] = [];
      for (let k = 0; k < 4; k++) {
        const kIn = (k + 3) % 4, eIn = E[kIn], eOut = E[k], gx = ci + K[k][0], gy = cj + K[k][1], X = x0 + K[k][0] * TILE, Y = y0 + K[k][1] * TILE;
        const dIn = ins + jit * hh(gx, gy, 40 + (kIn % 2)), dOut = ins + jit * hh(gx, gy, 40 + (k % 2));
        if (eIn.out && eOut.out) {
          // an outer corner: cut off, by a different amount on each side
          const ch = (r.cham ?? 3) * (0.7 + 0.6 * hh(gx, gy, 43)), ch2 = (r.cham ?? 3) * (0.7 + 0.6 * hh(gx, gy, 44));
          const dirIn: Vec = [K[k][0] - K[kIn][0], K[k][1] - K[kIn][1]], dirOut: Vec = [K[(k + 1) % 4][0] - K[k][0], K[(k + 1) % 4][1] - K[k][1]];
          pts.push({ x: X - dirIn[0] * ch - eIn.n[0] * dIn, y: Y - dirIn[1] * ch - eIn.n[1] * dIn, id: [gx, gy, 81], edge: kIn });
          pts.push({ x: X + dirOut[0] * ch2 - eOut.n[0] * dOut, y: Y + dirOut[1] * ch2 - eOut.n[1] * dOut, id: [gx, gy, 82], edge: -1 });
        } else {
          let px = X, py = Y;
          if (eIn.out) { px -= eIn.n[0] * dIn; py -= eIn.n[1] * dIn; } else { px += eIn.n[0] * ov; py += eIn.n[1] * ov; }
          if (eOut.out) { px -= eOut.n[0] * dOut; py -= eOut.n[1] * dOut; } else { px += eOut.n[0] * ov; py += eOut.n[1] * ov; }
          pts.push({ x: px, y: py, id: [gx, gy, 80], edge: kIn });
        }
        if (eOut.out) {
          // a bulge or a dent along an outer edge, not quite halfway
          const gx2 = 2 * ci + K[k][0] + K[(k + 1) % 4][0], gy2 = 2 * cj + K[k][1] + K[(k + 1) % 4][1];
          const d = ins + (r.bulge ?? 1.6) * (hh(gx2, gy2, 45) - 0.6), al = (hh(gx2, gy2, 46) - 0.5) * 5;
          const dir: Vec = [K[(k + 1) % 4][0] - K[k][0], K[(k + 1) % 4][1] - K[k][1]];
          const mx = x0 + (K[k][0] + K[(k + 1) % 4][0]) * 8, my = y0 + (K[k][1] + K[(k + 1) % 4][1]) * 8;
          pts.push({ x: mx - eOut.n[0] * d + dir[0] * al, y: my - eOut.n[1] * d + dir[1] * al, id: [gx2 + 9999, gy2, 83], edge: k });
        }
      }
      // each point's `edge` names the cell edge its side to the next point runs along (-1: a chamfer); fix it up from the points
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        a.edge = -1;
        for (let e = 0; e < 4; e++) {
          const on = (p: V) => (e % 2 === 0 ? Math.abs(p.y - (y0 + (e === 2 ? TILE : 0))) : Math.abs(p.x - (x0 + (e === 1 ? TILE : 0)))) < ov + 1e-6;
          if (!E[e].out && on(a) && on(b)) a.edge = e;
        }
      }
      return pts;
    };
    const foot = outline(), M = foot.length;
    // the top rim: the outer sides lean in, by a little more or less from cell to cell (the sides on a shared edge stand
    // straight), each point a little up or down
    const tp = (r.taper ?? 1.8) * (0.8 + 0.4 * hh(ci, cj, 94)), lean = foot.map(p => (p.edge >= 0 ? 0 : tp));
    const cxm = x0 + 8 + 3 * (hh(ci, cj, 90) - 0.5), cym = y0 + 8 + 3 * (hh(ci, cj, 91) - 0.5);
    const rim = foot.map((p, i) => {
      const pv = foot[(i + M - 1) % M], nx = foot[(i + 1) % M], o1 = lean[(i + M - 1) % M], o2 = lean[i];
      // inward normals of the side coming in and the side going out; the rim point lies o1 in from one and o2 from the other
      const d1x = p.x - pv.x, d1y = p.y - pv.y, l1 = Math.hypot(d1x, d1y) || 1, d2x = nx.x - p.x, d2y = nx.y - p.y, l2 = Math.hypot(d2x, d2y) || 1;
      const n1x = -d1y / l1, n1y = d1x / l1, n2x = -d2y / l2, n2y = d2x / l2, det = n1x * n2y - n1y * n2x;
      let ax = n1x * o1, ay = n1y * o1;
      if (Math.abs(det) > 0.05) { ax = (o1 * n2y - o2 * n1y) / det; ay = (n1x * o2 - n2x * o1) / det; }
      const al = Math.hypot(ax, ay), cap = 2.2 * (r.taper ?? 1.8);
      if (al > cap) { ax *= cap / al; ay *= cap / al; }
      const f = 1 + hv * (hh(p.id[0], p.id[1], p.id[2] + 100) - 0.5);
      return { x: p.x + ax, y: p.y + ay, h: ht * f };
    });
    const peak = { x: cxm + 2 * (hh(ci, cj, 92) - 0.5), y: cym + 2 * (hh(ci, cj, 93) - 0.5), h: ht * (1 + (r.peak ?? 0.14)) };
    this.rockPrism(foot.map(p => ({ x: p.x, y: p.y, h: 0 })), rim, peak, foot.map(p => p.edge), r, I, (e: number) => {
      const o = E[e].n;
      return (cells.has(hazKey(ci + o[0], cj + o[1])) ? hOf(ci + o[0], cj + o[1]) : -1) / ht;
    }, ci * 7 + cj);
    // gold on the outward sides, never on top: the lowest nugget stays to the last hit
    const cell = cells.get(hazKey(ci, cj))!;
    this.rockGold(ci, cj, foot, rim, q, cell.z, cell.ch, (qq: number) => H0 * (low + (1 - low) * qq) * cell.f, r, I, hh);
    // a boulder on top while the vein is full: it goes with the first hit
    if (q > (r.stoneTill ?? 0.7) && r.stone !== false && hh(ci, cj, 69) < (r.stones ?? 0.5)) {
      const cx = x0 + 5 + 4 * hh(ci, cj, 70), cy = y0 + 5 + 4 * hh(ci, cj, 71), R = (r.stoneR ?? 6) * (0.85 + 0.3 * hh(ci, cj, 72)), N = 5;
      const sh = ht + (peak.h - ht) * 0.5, H2 = (r.stoneH ?? 3) * (0.8 + 0.4 * hh(ci, cj, 75));
      const ft: { x: number; y: number; h: number }[] = [], rm: { x: number; y: number; h: number }[] = [];
      for (let k = 0; k < N; k++) {
        const an = (k / N) * Math.PI * 2 + hh(ci, cj, 73) * 2 + (hh(ci * 7 + k, cj, 76) - 0.5) * 0.7, rr = R * (0.6 + 0.65 * hh(ci * 7 + k, cj, 74));
        ft.push({ x: cx + Math.cos(an) * rr, y: cy + Math.sin(an) * rr, h: sh - 0.4 });
        rm.push({ x: cx + Math.cos(an) * rr * 0.8 + 0.5, y: cy + Math.sin(an) * rr * 0.8 - 0.3, h: sh + H2 * (0.8 + 0.4 * hh(ci * 7 + k, cj, 77)) });
      }
      this.rockPrism(ft, rm, { x: cx + 1.2, y: cy - 0.6, h: sh + H2 * 1.2 }, ft.map(() => -1), r, I, () => -1, ci * 11 + cj * 3 + 1);
    }
  }

  /**
   * One chunk of the rock: sides from its foot up to its rim, and a top of a few facets meeting at a peak. A side along a
   * shared cell edge (`edges[i]` ≥ 0) shows only where the cell across stands lower (`across` gives its height over ours).
   */
  private rockPrism(ft: { x: number; y: number; h: number }[], rm: { x: number; y: number; h: number }[], pk: { x: number; y: number; h: number },
    edges: number[], r: any, I: Record<string, HTMLImageElement>, across: (e: number) => number, seed: number) {
    const { c, P, cam } = this, N = ft.length, side = I[r.side], top = I[r.top];
    const TONES = r.tones ?? ['#4a3a30', '#5e4a3c', '#76604e', '#8f7860', '#a8916f', '#bba582'];
    const hs = (a: number, b: number, k: number) => { let t = (a * 374761393 + b * 668265263 + k * 1442695041) | 0; t = Math.imul(t ^ (t >>> 13), 1274126177); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const vis: boolean[] = [], faces: { i: number; d: number; nx: number; ny: number; lo: number }[] = [];
    for (let i = 0; i < N; i++) {
      const a = ft[i], b = ft[(i + 1) % N], nx = b.y - a.y, ny = -(b.x - a.x), l = Math.hypot(nx, ny);
      vis[i] = l > 1e-6 && cam.facing(nx / l, ny / l) > 1e-6;
      if (!vis[i]) continue;
      let lo = 0;
      if (edges[i] >= 0) {
        lo = across(edges[i]);
        if (lo >= 0.995) { vis[i] = false; continue; }
      }
      faces.push({ i, d: cam.depth((a.x + b.x) / 2, (a.y + b.y) / 2), nx: nx / l, ny: ny / l, lo: Math.max(0, lo) });
    }
    faces.sort((p, o) => p.d - o.d);
    for (const f of faces) {
      const i = f.i, j = (i + 1) % N, a = ft[i], b = ft[j], ta = rm[i], tb = rm[j];
      const mix = (p: typeof a, t2: typeof a, s: number): Pt => P(p.x + (t2.x - p.x) * s, p.y + (t2.y - p.y) * s, p.h + (t2.h - p.h) * s);
      const face: Pt[] = [mix(a, ta, f.lo), mix(b, tb, f.lo), P(tb.x, tb.y, tb.h), P(ta.x, ta.y, ta.h)];
      const lit = 0.5 + 0.5 * cam.sideways(f.nx, f.ny);
      if (side) {
        // the side leans in, so its rim runs above the upright plane the strip is laid in: start the strip a little higher
        const L = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / L, dy = (b.y - a.y) / L, u0 = 40 * hs(seed, i, 47), H = Math.max(ta.h, tb.h) + 4;
        const at = (u: number, h: number) => P(a.x + dx * (u - u0), a.y + dy * (u - u0), h + a.h);
        this.wallTex(side, face, at, u0, u0 + L, H, (r.dark ?? 0.04) + (r.shade ?? 0.3) * lit, r.texH ?? 22);
      } else {
        pth(c, face); c.fillStyle = TONES[Math.min(2, Math.floor((1 - lit) * 3))]; c.fill();
      }
      // a crease where two sides meet: ink only where the rock turns away, a darker line between two faces we see
      const prevVis = vis[(i + N - 1) % N], nextVis = vis[j];
      c.lineWidth = prevVis ? 0.4 : BL; c.strokeStyle = prevVis ? `rgba(20,12,8,${r.crease ?? 0.3})` : INK;
      c.beginPath(); c.moveTo(...face[0]); c.lineTo(...face[3]); c.stroke();
      c.lineWidth = nextVis ? 0.4 : BL; c.strokeStyle = nextVis ? `rgba(20,12,8,${r.crease ?? 0.3})` : INK;
      c.beginPath(); c.moveTo(...face[1]); c.lineTo(...face[2]); c.stroke();
      if (f.lo === 0) { c.lineWidth = BL; c.strokeStyle = INK; c.beginPath(); c.moveTo(...face[0]); c.lineTo(...face[1]); c.stroke(); }
    }
    // the top: facets from the rim up to the peak, lit by how they lean
    const PK = P(pk.x, pk.y, pk.h), R = rm.map(p => P(p.x, p.y, p.h));
    for (let i = 0; i < N; i++) {
      const a = rm[i], b = rm[(i + 1) % N];
      const ux = a.x - pk.x, uy = a.y - pk.y, uz = a.h - pk.h, vx = b.x - pk.x, vy = b.y - pk.y, vz = b.h - pk.h;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const k = (nz / l) * 0.6 + 0.4 * (0.5 + 0.5 * cam.sideways(nx / l, ny / l)) * -1 + 0.4 + 0.25 * (cam.facing(nx / l, ny / l) / Math.SQRT2);
      const tri: Pt[] = [PK, R[i], R[(i + 1) % N]];
      if (top) {
        c.save(); pth(c, tri); c.clip();
        const S2 = r.topSpan ?? 2 * TILE, X0 = Math.floor(pk.x / S2) * S2, Y0 = Math.floor(pk.y / S2) * S2;
        this.imgOnRect(top, X0, Y0, X0 + S2, Y0 + S2, 0, (a.h + b.h + pk.h) / 3);
        pth(c, tri); c.fillStyle = `rgba(${k > 0.62 ? '255,240,215' : '25,14,8'},${Math.min(0.4, Math.abs(k - 0.62) * (r.topShade ?? 0.9))})`; c.fill();
        c.restore();
      } else {
        const col = TONES[Math.max(2, Math.min(TONES.length - 1, Math.round(2 + k * 4)))];
        pth(c, tri); c.fillStyle = col; c.fill(); c.strokeStyle = col; c.lineWidth = 0.3; c.stroke();
      }
    }
    // creases up to the peak: faint
    c.strokeStyle = 'rgba(20,12,8,.4)'; c.lineWidth = 0.45;
    for (let i = 0; i < N; i++) { if (hs(seed, i, 48) < 0.5) continue; c.beginPath(); c.moveTo(...R[i]); c.lineTo(...PK); c.stroke(); }
    // the rim, inked round the rock's outside and where it steps down to a lower cell
    c.strokeStyle = INK; c.lineWidth = r.rimLw ?? 1;
    for (let i = 0; i < N; i++) {
      if (edges[i] >= 0 && across(edges[i]) >= 0.9) continue;
      c.beginPath(); c.moveTo(...R[i]); c.lineTo(...R[(i + 1) % N]); c.stroke();
    }
  }

  /**
   * Gold nuggets on one rock cell, laid out like a prop artist would: each run of outward sides facing one way on screen
   * is one canvas, and every canvas gets an anchor nugget low down (it stays to the last hit), a medium one (from the
   * second hit back) and a small one (full vein only), the last two along a slanting seam that runs on round the front
   * corner. A canvas too narrow on screen gets one medium nugget at most; a 2 × 2 vein shares anchor and medium between
   * the two cells of a facade. Heights are kept in world units, each nugget below the rim of the lowest rock it shows
   * on, so every stage is the one before less its highest nuggets. Spacing is measured on the drawn shapes.
   */
  private rockGold(ci: number, cj: number, foot: { x: number; y: number; edge: number }[], rim: { x: number; y: number; h: number }[], q: number, z: number, ch: number,
    hAt: (q: number) => number, r: any, I: Record<string, HTMLImageElement>, hh: (a: number, b: number, k?: number) => number) {
    const { P, cam } = this, M = foot.length, base = r.nugW ?? 4.2;
    const keys = ((r.gold ?? []) as string[]).filter(k => I[k]);
    if (!keys.length) return;
    const shape = (k: string) => k.replace(/_\d+$/, '').replace(/^gold_/, '');
    // the stage now (3 full, 2 after a hit, 1 before the last) and the lowest rock each stage stands at with this many
    // charges (a stage no charge comes to takes the next one's)
    const stOf = (qq: number) => Math.min(3, Math.max(1, Math.ceil(qq * 3 - 1e-6))), stage = stOf(q), lim = [0, 0, 0, 0];
    for (let left = Math.max(1, ch); left >= 1; left--) lim[stOf(left / Math.max(1, ch))] = hAt(left / Math.max(1, ch));
    for (let k = 3; k >= 1; k--) if (!lim[k]) lim[k] = lim[k + 1] ?? hAt(1);
    // canvases: runs of outward sides that face the viewer, split by which way they face on screen
    const side = (i: number) => {
      const a = foot[i], b = foot[(i + 1) % M], L = Math.hypot(b.x - a.x, b.y - a.y);
      return { a, b, L, nx: (b.y - a.y) / (L || 1), ny: -(b.x - a.x) / (L || 1) };
    };
    const look = foot.map((p, i) => {
      const sd = side(i);
      return p.edge < 0 && sd.L > 0.3 && cam.facing(sd.nx, sd.ny) > 0.15 ? (cam.sideways(sd.nx, sd.ny) >= 0 ? 1 : -1) : 0;
    });
    let start = look.findIndex((v, i) => v !== look[(i + M - 1) % M]);
    if (start < 0) start = 0;
    type Can = { sides: number[]; sg: number; W: number; thin: boolean; uc: number };
    const cans: Can[] = [];
    for (let n = 0, i = start; n < M; n++, i = (i + 1) % M) {
      if (!look[i]) continue;
      const last = cans[cans.length - 1];
      if (last && last.sg === look[i] && last.sides[last.sides.length - 1] === (i + M - 1) % M) last.sides.push(i);
      else cans.push({ sides: [i], sg: look[i], W: 0, thin: false, uc: 0 });
    }
    const [ox] = P(foot[0].x, foot[0].y), ref = Math.max(Math.abs(P(foot[0].x + TILE, foot[0].y)[0] - ox), Math.abs(P(foot[0].x, foot[0].y + TILE)[0] - ox));
    for (const c of cans) {
      c.W = c.sides.reduce((t, i) => t + side(i).L, 0);
      const s0 = foot[c.sides[0]], s1 = foot[(c.sides[c.sides.length - 1] + 1) % M];
      c.thin = Math.abs(P(s1.x, s1.y)[0] - P(s0.x, s0.y)[0]) < 0.35 * ref;
      // the end of the canvas at the front corner, where the seam passes over to the other canvas
      c.uc = cam.depth(s1.x, s1.y) > cam.depth(s0.x, s0.y) ? c.W : 0;
    }
    // a point on a canvas: arc length u along its foot, height h up its leaning side
    const at = (c: Can, u: number, h: number) => {
      let acc = 0;
      for (const i of c.sides) {
        const sd = side(i);
        if (u <= acc + sd.L || i === c.sides[c.sides.length - 1]) {
          const t = Math.min(1, Math.max(0, (u - acc) / (sd.L || 1))), ta = rim[i], tb = rim[(i + 1) % M];
          const fx = sd.a.x + (sd.b.x - sd.a.x) * t, fy = sd.a.y + (sd.b.y - sd.a.y) * t, th = ta.h + (tb.h - ta.h) * t;
          const v = Math.min(1, h / (th || 1)), rx = ta.x + (tb.x - ta.x) * t, ry = ta.y + (tb.y - ta.y) * t;
          return { x: fx + (rx - fx) * v + sd.nx * 0.15, y: fy + (ry - fy) * v + sd.ny * 0.15, h, ax: [(sd.b.x - sd.a.x) / sd.L, (sd.b.y - sd.a.y) / sd.L] as Vec };
        }
        acc += sd.L;
      }
      return null;
    };
    // one seam per cell: through the front corner at a middle height, slanting 20–35° one way or the other on screen
    // (on a wide canvas it slants less, so it doesn't run into the foot or the rim)
    const hc = lim[3] * (0.5 + 0.12 * hh(ci, cj, 120)), rise = hh(ci, cj, 121) < 0.5 ? 1 : -1, tn0 = Math.tan(((20 + 15 * hh(ci, cj, 122)) * Math.PI) / 180);
    const tn = (c: Can) => Math.min(tn0, (0.32 * lim[3]) / Math.max(c.W, 1));
    const seam = (c: Can, u: number) => hc + rise * c.sg * tn(c) * Math.abs(u - c.uc);
    const seamK = (c: Can, u: number) => rise * c.sg * tn(c) * (u >= c.uc ? 1 : -1);
    // the layout is worked out once for a cell as it stands and kept, so a stage is the one before less its top nuggets
    const key = `${ch},${z},${cam.rot.toFixed(3)},${foot.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`;
    let lay = this.goldLay.get(key);
    if (!lay) {
      // a nugget's drawn shape as an ellipse in canvas units (along u, up h); a sliver runs along its picture's diagonal
      type Nug = { c: Can; u: number; h: number; img: string; s: number; st: number; turn: number; flip: boolean; lv: number; A: number; B: number; ang: number; sx: number; sy: number };
      const dims = (img: string, s: number, st: number) => {
        const im = I[img], a = Math.sqrt(im.width / im.height), w = s * a * st, g = s / a / st;
        return shape(img) === 'long' ? { w, g, A: 0.45 * Math.hypot(w, g), B: 0.22 * Math.min(w, g), diag: Math.atan2(g, w) } : { w, g, A: 0.45 * w, B: 0.45 * g, diag: 0 };
      };
      const reach = (n: { A: number; B: number; ang: number }, phi: number) => {
        const d = phi - n.ang;
        return (n.A * n.B) / Math.hypot(n.B * Math.cos(d), n.A * Math.sin(d));
      };
      const all: Nug[] = [];
      const gapOk = (n: Nug) => {
        let worst = Infinity;
        for (const o of all) {
          let gap: number, need: number;
          if (o.c === n.c) {
            const du = n.u - o.u, dh = n.h - o.h, phi = Math.atan2(dh, du);
            gap = Math.hypot(du, dh) - reach(n, phi) - reach(o, phi + Math.PI);
          } else {
            // another canvas of this cell: on screen, as circles
            gap = Math.hypot(n.sx - o.sx, n.sy - o.sy) - Math.max(n.A, n.B) - Math.max(o.A, o.B);
          }
          need = o.lv === 1 || n.lv === 1 ? 0.6 * (o.lv === 1 ? o.s : n.s) : 0.5 * Math.min(o.s, n.s);
          worst = Math.min(worst, gap - need);
        }
        return worst;
      };
      const ANCHOR = ['chunk', 'flat', 'nugget', 'knobby'];
      const make = (c: Can, ci2: number, lv: number, sizeK: number, salt: number): Nug | null => {
        const used = all.filter(o => o.c === c), types = new Set(used.map(o => shape(o.img)));
        // a picture for it: anchors chunky, slivers (medium only) and knobs kept to their places, no picture twice and three shapes at most on a canvas
        const pool = keys.filter(k => {
          const sh = shape(k);
          if (used.some(o => o.img === k)) return false;
          if (lv === 1 ? !ANCHOR.includes(sh) : sh === 'knobby') return false;
          if (sh === 'long' && (lv !== 2 || used.some(o => shape(o.img) === 'long'))) return false;
          return types.size < 3 || types.has(sh);
        });
        if (!pool.length) return null;
        const img = pool[Math.floor(hh(ci * 31 + ci2, cj * 17 + lv, salt) * pool.length)];
        const st = 0.9 + 0.22 * hh(ci * 7 + ci2, cj * 11 + lv, salt + 1), flip0 = hh(ci * 5 + ci2, cj * 3 + lv, salt + 2) < 0.5;
        let s = base * sizeK;
        const top = lim[lv] - 1.0, H1 = lim[1];
        for (let tries = 0; tries < 3; tries++, s *= 0.85) {
          const d = dims(img, s, st);
          if (lv === 1) s = Math.min(s, (0.4 * c.W * s) / Math.max(d.w, 0.01), (0.55 * H1 * s) / Math.max(d.g, 0.01));
          const dd = dims(img, s, st);
          // turn: slivers along the seam, the rest a little either way
          const cands: Nug[] = [];
          const N = lv === 1 ? 1 : 12;
          for (let k = 0; k < N; k++) {
            let u: number, h: number;
            const hu0 = 0.5 * dd.w + 0.12 * c.W, hu1 = c.W - 0.5 * dd.w - 0.12 * c.W;
            if (hu1 < hu0) break;
            if (lv === 1) {
              // the anchor in one third of its canvas, never the middle, the other third on the cell's other canvas
              const third = (ci2 + (hh(ci, cj, 123) < 0.5 ? 0 : 1)) % 2 === 0;
              u = c.W * (third ? 0.3 + 0.1 * hh(ci, cj, salt + 3) : 0.6 + 0.1 * hh(ci, cj, salt + 3));
              h = H1 * (0.3 + 0.2 * hh(ci, cj, salt + 4));
            } else {
              u = hu0 + (hu1 - hu0) * hh(ci * 13 + ci2 * 3 + k, cj * 7 + lv, salt + 5);
              h = seam(c, u) + (hh(ci * 3 + k, cj * 19 + ci2, salt + 6) - 0.5) * 0.2 * lim[lv];
            }
            u = Math.min(hu1, Math.max(hu0, u));
            let turn: number, flip = flip0;
            // the picture's x runs to the right on screen, which may be against u
            const sp = at(c, u, 0), sX = sp && P(sp.x + sp.ax[0], sp.y + sp.ax[1])[0] >= P(sp.x, sp.y)[0] ? 1 : -1;
            if (shape(img) === 'long') {
              // the sliver's picture rises to the right along its diagonal: mirror and turn it onto the seam
              const beta = Math.atan(seamK(c, u) * sX);
              flip = beta < 0;
              turn = -(beta - (flip ? -dd.diag : dd.diag)) + ((hh(ci, cj + k, salt + 7) - 0.5) * 20 * Math.PI) / 180;
            } else turn = ((hh(ci * 3 + k, cj, salt + 8) - 0.5) * 50 * Math.PI) / 180;
            const ang = sX * (shape(img) === 'long' ? -turn + (flip ? -dd.diag : dd.diag) : -turn);
            const rh = Math.sqrt((dd.A * Math.sin(ang)) ** 2 + (dd.B * Math.cos(ang)) ** 2);
            const lo = 1.2 + rh + (shape(img) === 'long' ? 0.3 * lim[lv] : 0), hi = top - rh;
            if (hi < lo) continue;
            h = Math.min(hi, Math.max(lo, h));
            const p = at(c, u, h);
            if (!p) continue;
            const [sx, sy] = P(p.x, p.y, p.h);
            cands.push({ c, u, h, img, s, st, turn, flip, lv, A: dd.A, B: dd.B, ang, sx, sy });
          }
          let best: Nug | null = null, bs = -Infinity;
          for (const n of cands) { const g = gapOk(n); if (g > bs) { bs = g; best = n; } }
          if (best && bs >= -0.3 * base) return best;
        }
        return null;
      };
      const plans: [Can, number, number, number][] = [];
      cans.forEach((c, k) => {
        if (c.thin) { plans.push([c, k, 2, 0.7]); return; }
        // a 2 × 2 vein: the two cells of a facade take the anchor and the medium nugget by turns
        const own = z > 1 ? ((ci + cj + (c.sg > 0 ? 1 : 0)) % 2 === 0 ? [1] : [2]) : [1, 2];
        for (const lv of own) plans.push([c, k, lv, lv === 1 ? 0.95 + 0.15 * hh(ci, cj, 130 + k) : 0.7 + 0.15 * hh(ci, cj, 131 + k)]);
        plans.push([c, k, 3, 0.5 + 0.15 * hh(ci, cj, 132 + k)]);
      });
      // anchors first on every canvas, then the medium ones, then the small, so the low and big ones get the room
      plans.sort((p, o) => p[2] - o[2]);
      for (const [c, k, lv, sk] of plans) {
        const n = make(c, k, lv, sk, 140 + lv * 10);
        if (n) all.push(n);
      }
      lay = all.map(n => ({ c: cans.indexOf(n.c), u: n.u, h: n.h, img: n.img, s: n.s, st: n.st, turn: n.turn, flip: n.flip, lv: n.lv }));
      if (this.goldLay.size > 400) this.goldLay.clear();
      this.goldLay.set(key, lay);
    }
    const clipOf = (c: Can): Pt[] => {
      const ids = [...c.sides, (c.sides[c.sides.length - 1] + 1) % M];
      return [...ids.map(i => P(foot[i].x, foot[i].y, 0)), ...ids.reverse().map(i => P(rim[i].x, rim[i].y, rim[i].h))];
    };
    lay
      .filter(n => n.lv <= stage && cans[n.c])
      .map(n => ({ ...at(cans[n.c], n.u, n.h)!, s: n.s, k: 0, img: n.img, clip: clipOf(cans[n.c]), turn: n.turn, flip: n.flip, st: n.st }))
      .sort((p, o) => cam.depth(p.x, p.y) - cam.depth(o.x, o.y))
      .forEach(p => this.rockNugget(p, r, I));
  }

  /** A gold chip stuck in the rock: its picture (or a drawn one) laid flat on a side or on the top. */
  private rockNugget(p: { x: number; y: number; h: number; ax: Vec; s: number; k: number; img?: string; clip?: Pt[]; turn?: number; flip?: boolean; st?: number }, r: any, I: Record<string, HTMLImageElement>) {
    const { c, P } = this, gold = ((r.gold ?? []) as string[]).map(k => I[k]).filter(Boolean);
    const [ox, oy] = P(p.x, p.y, p.h), [ex, ey] = P(p.x + p.ax[0], p.y + p.ax[1], p.h);
    let ux = ex - ox, uy = ey - oy;
    if (ux < 0) { ux = -ux; uy = -uy; }
    const im = (p.img && I[p.img]) || gold[p.k % Math.max(1, gold.length)];
    c.save();
    if (p.clip) { pth(c, p.clip); c.clip(); }
    if (im) {
      // the side's own axes, then the chip's turn, mirror and stretch about its centre
      // the same area for every shape, so a long sliver comes out long and a bead round
      const a = Math.sqrt(im.width / im.height), w = p.s * a * (p.st ?? 1), h = p.s / a / (p.st ?? 1);
      c.transform(ux, uy, 0, 1, ox, oy);
      c.rotate(p.turn ?? 0);
      if (p.flip) c.scale(-1, 1);
      c.drawImage(im, -w / 2, -h / 2, w, h);
    } else {
      c.transform(ux, uy, 0, 1, ox, oy);
      const rr = p.s / 2, blob: Pt[] = [];
      for (let k = 0; k < 7; k++) { const an = (k / 7) * Math.PI * 2; blob.push([Math.cos(an) * rr * (0.75 + 0.4 * ((k * 37 + p.k * 11) % 7) / 7), Math.sin(an) * rr * 0.8 * (0.75 + 0.4 * ((k * 53 + p.k * 5) % 7) / 7)]); }
      pth(c, blob); c.fillStyle = '#f2b83c'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.5; c.stroke();
      circ(c, -rr * 0.3, -rr * 0.25, rr * 0.22); c.fillStyle = '#fff3c4'; c.fill();
    }
    c.restore();
  }

  /**
   * The pad a toilet or a mushroom patch stands on, flat on its cell: the picture clipped to a square (a meadow's is
   * rounded off, a little wobbly), inked round. Drawn with the floor.
   */
  private drawPad(n: ResNode) {
    if (n.k === 'ore') return;
    const { c, P } = this, art = NODE_ART[n.k], w = PAD_W, im = env(art.pad), ring: Pt[] = [];
    if (!art.round) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ring.push(P(n.x + (a * w) / 2, n.y + (b * w) / 2));
    else {
      for (let k = 0; k < 48; k++) {
        // a superellipse, so it stays square-ish and fills the cell
        const a = (k / 48) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / 3.2;
        const rx = Math.sign(ca) * Math.abs(ca) ** e, ry = Math.sign(sa) * Math.abs(sa) ** e, wob = 1 + 0.07 * Math.sin(a * 7 + n.x) * Math.cos(a * 3);
        ring.push(P(n.x + (w / 2) * rx * wob * art.round, n.y + (w / 2) * ry * wob * art.round));
      }
    }
    pth(c, ring);
    if (im) {
      const m = art.round ? 1.15 : 1;
      c.save(); c.clip();
      this.imgOnRect(im, n.x - (w / 2) * m, n.y - (w / 2) * m, n.x + (w / 2) * m, n.y + (w / 2) * m);
      c.restore();
    } else { c.fillStyle = art.round ? '#5f9a3c' : '#e6ecee'; c.fill(); }
    pth(c, ring); c.strokeStyle = INK; c.lineWidth = 0.9; c.stroke();
  }

  private drawNode(n: ResNode) {
    // a spent node is drawn with the floor, and so is the pad under a live one
    if (n.left <= 0) return;
    if (n.k === 'ore') return this.drawRock(n);
    const { c, P } = this, art = NODE_ART[n.k], left = Math.min(n.left, n.ch), im = env(art.key);
    // a struck resource jolts: squashed and shaken for a moment
    const f = n.hit > 0 && !reduce ? n.hit / 0.2 : 0;
    if (f) {
      const [x, y] = P(n.x, n.y);
      c.save();
      c.translate(x + Math.sin(f * 19) * 1.4 * f, y);
      c.scale(1 + 0.1 * f, 1 - 0.14 * f);
      c.translate(-x, -y);
    }
    if (im) {
      const k = nodePieces(n.k, left), [x, y] = P(n.x, n.y);
      this.standee((k < art.pieces && env(`${art.key}_${k}`)) || im, x + art.sx, y + art.sy, art.w, n.hit > 0);
    } else this.drawNodeShape(n, left, n.hit > 0);
    if (f) c.restore();
  }

  /** The room's trinket, small in the middle of its cell with a little shadow. */
  private drawTrinket(tr: Trinket) {
    const { c, P } = this, def = trinketDef(tr.k), im = def && env(def.art);
    if (!im) return;
    const [x, y] = P(tr.x, tr.y);
    const w = Math.min(TRINKET_MAX, TRINKET_K * Math.sqrt(im.width / im.height));
    ell(c, x, y + 0.5, w * 0.5, w * 0.24); c.fillStyle = 'rgba(15,8,4,.35)'; c.fill();
    this.standee(im, x, y + 1.5, w);
  }

  /**
   * The line the hero says on picking up a trinket: a cartoon speech bubble over its head for a few seconds, drawn at a
   * size of its own in screen pixels, so it reads the same however far the camera is zoomed out.
   */
  private drawSay(view: { w: number; h: number; dpr: number }) {
    const g = this.g, tr = g.S.trinket;
    if (!tr || tr.by === undefined || tr.t >= SAY_TIME) return;
    const h = g.heroOf(tr.by), p = h && g.figureAt(h), line = h && trinketDef(tr.k)?.lines[h.def.key];
    if (!h || !p || !line) return;
    const { c, cam } = this, [ix, iy] = this.P(p.x, p.y), [hx, hy] = cam.isoToScreen(ix, iy - BASE_TH - heroFig(h.def) - 3);
    const pop = Math.min(1, tr.t / 0.18), fade = Math.min(1, (SAY_TIME - tr.t) / 0.4);
    c.save();
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.font = '700 18px Hand, Caveat, cursive';
    // the words in lines no wider than the bubble's measure
    const MAXW = Math.min(220, view.w * 0.6), lines: string[] = [];
    for (const w of line.split(' ')) {
      const last = lines[lines.length - 1];
      if (last !== undefined && c.measureText(last + ' ' + w).width <= MAXW) lines[lines.length - 1] = last + ' ' + w;
      else lines.push(w);
    }
    const LH = 19, PADX = 11, PADY = 7, TAIL = 11;
    const bw = Math.max(...lines.map(l => c.measureText(l).width)) + PADX * 2, bh = lines.length * LH + PADY * 2;
    // over the head, kept on the screen; the tail still points at the hero
    const bx = Math.max(6, Math.min(view.w - bw - 6, hx - bw / 2)), by = Math.max(6, hy - TAIL - bh);
    c.globalAlpha = fade;
    c.translate(hx, by + bh);
    c.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
    c.translate(-hx, -(by + bh));
    const tx = Math.max(bx + 14, Math.min(bx + bw - 14, hx));
    rr(c, bx, by, bw, bh, 12);
    c.moveTo(tx - 7, by + bh - 1);
    c.lineTo(hx, Math.min(hy, by + bh + TAIL));
    c.lineTo(tx + 7, by + bh - 1);
    c.fillStyle = '#fffaf0';
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.lineJoin = 'round';
    c.stroke();
    c.fill();
    c.fillStyle = '#2a1d16';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((l, k) => c.fillText(l, bx + bw / 2, by + PADY + LH * (k + 0.5) + 1));
    // a line this screen has just opened gets a gold tag on the bubble's corner
    if (justOpened(tr.k, h.def.key)) {
      c.font = '600 11px Oswald, sans-serif';
      const tag = 'В КОЛЛЕКЦИИ', tw = c.measureText(tag).width + 12, gx = bx + bw - tw + 4, gy = by - 9;
      rr(c, gx, gy, tw, 16, 4);
      c.fillStyle = '#ffd34d'; c.fill();
      c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#3a2410';
      c.fillText(tag, gx + tw / 2, gy + 8.5);
    }
    c.restore();
  }

  /** A dish of the cook's: in flight it arcs from where the disc bounced, then sits on the floor with a little shadow. */
  private drawFood(f: Food) {
    const { c, P } = this, u = Math.min(1, f.t / FOOD_FLY), e = u * (2 - u);
    const x = f.fx + (f.x - f.fx) * e, y = f.fy + (f.y - f.fy) * e, h = Math.sin(Math.PI * u) * 14;
    const [gx, gy] = P(x, y), q = 0.6 + 0.4 * u;
    ell(c, gx, gy + 1.5 * u, FOOD_W * 0.48 * q, FOOD_W * 0.26 * q); c.fillStyle = 'rgba(15,8,4,.35)'; c.fill();
    const [sx, sy] = P(x, y, h), im = env('food_' + DISHES[f.k % DISHES.length]);
    if (im) { this.standee(im, sx, sy + FOOD_W * FOOD_RIM, FOOD_W); return; }
    // the drawn dishes are sized for a dish 10 wide
    c.save();
    c.translate(sx, sy);
    c.scale(FOOD_W / 10, FOOD_W / 10);
    c.lineJoin = 'round';
    switch (f.k % DISHES.length) {
      case 0: ell(c, 0, -1, 5.5, 2.6); fs(c, '#f4efe4', 1); ell(c, 0, -2, 3.6, 2); fs(c, '#8a4f2a', 1); break;
      case 1: rr(c, -4.5, -4, 9, 3.4, 1.7); fs(c, '#e59a9a', 1); break;
      case 2: c.beginPath(); c.ellipse(0, -1.5, 4.8, 3, 0, Math.PI, 0); c.closePath(); fs(c, '#d9a13d', 1); break;
      default: ell(c, 1, -2.5, 3.4, 2.6); fs(c, '#b8692e', 1); rr(c, -4.5, -2, 3.5, 1.4, 0.6); fs(c, '#f1e7d0', 0.8);
    }
    c.restore();
  }

  /**
   * A firecracker of the kid's: it arcs in like a dish, then stands on end in its cell, its fuse spitting sparks. Its
   * reach is marked on the floor (see drawGround).
   */
  private drawBomb(b: Bomb) {
    const { c, P } = this, u = Math.min(1, b.t / FOOD_FLY), e = u * (2 - u);
    const x = b.fx + (b.x - b.fx) * e, y = b.fy + (b.y - b.fy) * e, h = Math.sin(Math.PI * u) * 16;
    const [gx, gy] = P(x, y), q = 0.6 + 0.4 * u;
    ell(c, gx, gy + 0.5, BOMB_W * 0.55 * q, BOMB_W * 0.3 * q); c.fillStyle = 'rgba(15,8,4,.35)'; c.fill();
    const [sx, sy] = P(x, y, h), im = env('petard');
    // in flight it tumbles end over end
    const spin = u < 1 ? (1 - u) * 7 : 0;
    c.save();
    c.translate(sx, sy - BOMB_W * 0.9);
    c.rotate(spin);
    c.translate(-sx, -(sy - BOMB_W * 0.9));
    let tipX = sx + BOMB_W * 0.2, tipY = sy - BOMB_W * 2.1;
    if (im) {
      this.standee(im, sx, sy + 1, BOMB_W * 1.5);
      const H = (BOMB_W * 1.5 * im.height) / im.width;
      tipX = sx + BOMB_W * 1.5 * 0.25; tipY = sy + 1 - H * 0.95;
    } else {
      c.lineJoin = 'round';
      rr(c, sx - BOMB_W / 2, sy - BOMB_W * 1.7, BOMB_W, BOMB_W * 1.7, 1.2); fs(c, '#d23a3a', 1);
      c.fillStyle = '#f2c94c'; c.fillRect(sx - BOMB_W / 2 + 0.5, sy - BOMB_W * 1.05, BOMB_W - 1, 2);
      ell(c, sx, sy - BOMB_W * 1.7, BOMB_W / 2, BOMB_W / 4); fs(c, '#f1e7d0', 0.8);
      c.beginPath(); c.moveTo(sx, sy - BOMB_W * 1.7); c.quadraticCurveTo(sx + 2, sy - BOMB_W * 2, tipX, tipY); c.strokeStyle = INK; c.lineWidth = 0.9; c.stroke();
    }
    c.restore();
    if (u < 1) return;
    // the fuse fizzes: a flicker of a star and a couple of sparks hopping off it
    const fl = reduce ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(this.t * 23 + b.x));
    c.save();
    c.globalAlpha = fl;
    c.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4 + this.t * 3, r = k % 2 ? 1.2 : 2.8 * fl; c.lineTo(tipX + Math.cos(a) * r, tipY + Math.sin(a) * r); }
    c.closePath(); c.fillStyle = '#fff1a8'; c.fill(); c.strokeStyle = '#ff9a2e'; c.lineWidth = 0.6; c.stroke();
    if (!reduce) for (let k = 0; k < 3; k++) {
      const ph = (this.t * 2.5 + k / 3 + b.y * 0.01) % 1;
      circ(c, tipX + Math.sin(k * 2.1 + ph * 3) * ph * 4, tipY - ph * 5, 0.6 * (1 - ph) + 0.2); c.fillStyle = '#ffd34d'; c.fill();
    }
    c.restore();
  }

  /**
   * On the floor, under everything standing: the bum's gas, a green haze over every cell of its clouds with a dashed rim
   * round them, and around each firecracker that has landed the cells an enemy sets it off from.
   */
  private drawGround() {
    const { c, P, g } = this, S = g.S;
    if (!S.gas.length && !S.bombs.length) return;
    const quad = (x0: number, y0: number, x1: number, y1: number) => pth(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
    if (S.gas.length) {
      // a cell under two clouds is as green as under the thicker one: a thinning cloud is paler
      const cells = new Map<string, number>();
      for (const o of S.gas) {
        const k = this.gasLook(o);
        for (let j = o.j - GAS_R; j <= o.j + GAS_R; j++) for (let i = o.i - GAS_R; i <= o.i + GAS_R; i++) {
          if (!isFloor(S, i, j) || !g.gasAt(i, j) || Math.abs(i - o.i) + Math.abs(j - o.j) > 2 * GAS_R - 1) continue;
          const key = hazKey(i, j);
          cells.set(key, Math.max(cells.get(key) ?? 0, k));
        }
      }
      c.save();
      for (const [key, k] of cells) {
        const [i, j] = key.split(',').map(Number);
        quad(i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE);
        c.fillStyle = `rgba(150,205,60,${0.32 * k})`;
        c.fill();
      }
      c.beginPath();
      for (const key of cells.keys()) {
        const [i, j] = key.split(',').map(Number);
        for (const [di, dj, ax, ay, bx, by] of SIDES) {
          if (cells.has(hazKey(i + di, j + dj))) continue;
          const a = P((i + ax) * TILE, (j + ay) * TILE), b = P((i + bx) * TILE, (j + by) * TILE);
          c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        }
      }
      c.setLineDash([3, 2]); c.lineDashOffset = reduce ? 0 : -this.t * 4;
      c.strokeStyle = 'rgba(70,105,20,.8)'; c.lineWidth = 1.2; c.stroke();
      c.restore();
    }
    // a firecracker's reach: the 3 × 3 cells round it, where the first enemy to step sets it off, dashed in its fuse's orange
    c.save();
    c.setLineDash([2, 2]);
    c.strokeStyle = 'rgba(255,170,60,.7)';
    c.lineWidth = 1;
    for (const b of S.bombs) {
      if (b.t < FOOD_FLY) continue;
      const i = Math.floor(b.x / TILE), j = Math.floor(b.y / TILE);
      quad((i - 1) * TILE + 1, (j - 1) * TILE + 1, (i + 2) * TILE - 1, (j + 2) * TILE - 1);
      c.fillStyle = 'rgba(255,150,40,.08)'; c.fill(); c.stroke();
    }
    c.restore();
  }

  /** How thick a cloud of gas looks, 0 to 1: it swells out as it rises and thins out over its turns. */
  private gasLook(o: Gas) {
    return Math.min(1, o.t / 0.5) * (0.55 + 0.45 * (o.left / GAS_TURNS));
  }

  private puffImg: HTMLCanvasElement | null = null;

  /** One cartoon puff of gas, drawn once: three lumps of green with a darker rim and a pale top. */
  private puff() {
    if (this.puffImg) return this.puffImg;
    const cv = document.createElement('canvas'), W = 96, H = 64;
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d')!;
    const lumps: [number, number, number][] = [[30, 38, 18], [52, 28, 22], [72, 40, 16], [50, 44, 18]];
    x.beginPath();
    for (const [a, b, r] of lumps) { x.moveTo(a + r, b); x.arc(a, b, r, 0, Math.PI * 2); }
    x.lineWidth = 6; x.strokeStyle = GAS_INK; x.stroke();
    x.fillStyle = GAS_COL; x.fill();
    x.fillStyle = 'rgba(235,255,190,.6)';
    for (const [a, b, r] of lumps) { x.beginPath(); x.arc(a - r * 0.3, b - r * 0.35, r * 0.38, 0, Math.PI * 2); x.fill(); }
    this.puffImg = cv;
    return cv;
  }

  /** Puffs of the bum's gas drifting and bobbing over its clouds, see-through so the figures inside still show. */
  private drawPuffs() {
    const { c, P, g } = this, S = g.S;
    if (!S.gas.length || S.phase === 'over') return;
    const im = this.puff();
    c.save();
    for (const o of S.gas) {
      const k = this.gasLook(o);
      for (let n = 0; n < PUFFS; n++) {
        const a = hr(o.i, o.j, n * 7 + 1) * Math.PI * 2, r = (0.35 + 0.6 * Math.sqrt(hr(o.i, o.j, n * 7 + 2))) * GAS_R * TILE;
        const ph = hr(o.i, o.j, n * 7 + 3) * 6.3, sp = reduce ? 0 : this.t;
        const x = (o.i + 0.5) * TILE + Math.cos(a + sp * 0.12) * r, y = (o.j + 0.5) * TILE + Math.sin(a + sp * 0.12) * r;
        if (!floorAt(S, x, y)) continue;
        const [sx, sy] = P(x, y, 6 + 5 * Math.sin(sp * 0.9 + ph)), w = 15 + 7 * hr(o.i, o.j, n * 7 + 4);
        c.globalAlpha = 0.42 * k;
        c.drawImage(im, sx - w / 2, sy - w / 3, w, (w * 2) / 3);
      }
    }
    c.restore();
  }

  private drawDisc(d: Disc) {
    const hole = d.fall ? pitAt(this.g.S.pits, d.x, d.y) : undefined;
    if (!hole) return this.drawPuck(d);
    // a disc going down a hole sinks behind its near rim
    this.c.save();
    this.mouth(hole);
    this.c.clip();
    this.drawPuck(d);
    this.c.restore();
  }

  private drawPuck(d: Disc) {
    const { c } = this;
    if (!d.fan) return this.puck(d);
    // a phantom shimmers a little, see-through all the while
    c.save();
    c.globalAlpha = PHANTOM.alpha + (reduce ? 0 : Math.sin(this.t * 5 + (d.id ?? 0)) * 0.08);
    this.puck(d);
    c.restore();
  }

  private puck(d: Disc) {
    const { c, P } = this;
    let s = 1, hh = 0;
    if (d.fall) { s = Math.max(0, 1 - d.fall * 2); hh = -d.fall * 20; }
    if (s <= 0) return;
    const ph = !!d.fan, col = ph ? PHANTOM.col : d.hero.def.col, dk = ph ? PHANTOM.dk : d.hero.def.dk;
    // a phantom is a thinner puck too, as much as it is a smaller one
    const rx = d.r * 1.35 * s, ry = d.r * 0.68 * s, th = 3.4 * s * (ph ? FAN_R : 1), [x, y] = P(d.x, d.y, hh);
    if (!d.fall) { ell(c, x + 1, y + 1.5, rx + 0.5, ry + 0.5); c.fillStyle = `rgba(20,10,5,${ph ? 0.2 : 0.35})`; c.fill(); }
    // a fat puck: dark rim band, flat enamel top, a raised ring and the hero's emblem, all inked
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI); c.lineTo(x - rx, y - th); c.ellipse(x, y - th, rx, ry, 0, Math.PI, 0, true); c.closePath(); fs(c, dk, ph ? DISC_LW * 0.75 : DISC_LW);
    const art = env(`disc_${d.hero.def.key}`), di = art && ph ? phantomArt(art) : art;
    if (di) {
      c.save(); c.translate(x, y - th); c.scale(1, ry / rx); c.rotate(d.spin); c.drawImage(di, -rx * 1.04, -rx * 1.04, rx * 2.08, rx * 2.08); c.restore();
      this.discGlow(d, x, y - th, rx, ry);
      return;
    }
    ell(c, x, y - th, rx, ry); fs(c, col, DISC_LW);
    ell(c, x, y - th, rx * 0.62, ry * 0.62); fs(c, mix(col, '#ffffff', 0.18), DISC_LW * 0.8);
    c.save(); c.translate(x, y - th); c.scale(1, 0.5); c.rotate(d.spin); c.fillStyle = '#f6efe0'; c.strokeStyle = INK; c.lineWidth = 1.4;
    const look = heroLook(d.hero.def.key);
    if (look === 0) { c.beginPath(); for (const [a, b] of [[-0.12, -0.38], [0.12, -0.38], [0.12, -0.12], [0.38, -0.12], [0.38, 0.12], [0.12, 0.12], [0.12, 0.38], [-0.12, 0.38], [-0.12, 0.12], [-0.38, 0.12], [-0.38, -0.12], [-0.12, -0.12]]) c.lineTo(a * rx * 1.4, b * rx * 1.4); c.closePath(); c.stroke(); c.fill(); }
    else if (look === 1) { c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 1.571; c.lineTo(Math.cos(a) * rx * 0.48, Math.sin(a) * rx * 0.48); c.lineTo(Math.cos(a + 0.785) * rx * 0.15, Math.sin(a + 0.785) * rx * 0.15); } c.closePath(); c.stroke(); c.fill(); }
    else { c.beginPath(); c.moveTo(0, -rx * 0.42); c.quadraticCurveTo(rx * 0.36, -rx * 0.05, rx * 0.2, rx * 0.3); c.quadraticCurveTo(0, rx * 0.42, -rx * 0.2, rx * 0.3); c.quadraticCurveTo(-rx * 0.36, -rx * 0.05, 0, -rx * 0.42); c.closePath(); c.stroke(); c.fill(); }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1.1; c.beginPath(); c.ellipse(x, y - th, rx * 0.8, ry * 0.74, 0, Math.PI * 1.1, Math.PI * 1.42); c.stroke();
    this.discGlow(d, x, y - th, rx, ry);
  }

  /** Rings over a disc's top: the hero's ability colour while it carries the ability, violet while charged by a clash. */
  private discGlow(d: Disc, x: number, y: number, rx: number, ry: number) {
    const { c } = this;
    // Ricochet's disc glows only while it still has sure bounces; a phantom is the ability's colour all over already
    if (d.ab && !d.fall && !d.fan && (d.hero.def.key !== 'ricochet' || d.rico > 0)) {
      c.save();
      c.strokeStyle = d.hero.def.abCol; c.lineWidth = 1.6; c.globalAlpha = 0.65 + Math.sin(this.t * 10) * 0.25;
      ell(c, x, y, rx + 2.2, ry + 1.6); c.stroke();
      c.restore();
    }
    if (d.charged) { c.save(); c.globalCompositeOperation = 'lighter'; ell(c, x, y, rx + 2.5, ry + 1.8); c.fillStyle = 'rgba(184,147,255,.35)'; c.fill(); c.restore(); }
  }

  // ------------------------------------------------------------ miniatures

  /** How far one world unit in direction (x, y) goes on screen from (ox, oy). */
  private onScreen(ox: number, oy: number, x: number, y: number): Pt {
    const a = this.P(ox, oy), b = this.P(ox + x, oy + y);
    return [b[0] - a[0], b[1] - a[1]];
  }

  /** A figure at (x, y) on a stand of radius R, rocking from its last knock. */
  private pose(k: Knock | undefined, x: number, y: number, R: number): Pose | undefined {
    if (!k || k.t <= 0 || reduce) return undefined;
    return knockPose(k, ...this.onScreen(x, y, k.x, k.y), R);
  }

  private faceRight(fromX: number, fromY: number, toX: number, toY: number) {
    return this.P(toX, toY)[0] >= this.P(fromX, fromY)[0];
  }

  /**
   * Draw a hero where it stands (hopping over to its disc's cell after the throws), or lifted at `at`
   * while it is being carried to another rune.
   */
  private drawHero(h: HeroState, at?: { x: number; y: number }) {
    const { c, P, g } = this;
    const lifted = !!at, carried = !at && this.carry?.hero === h;
    const S = g.S, p = at ?? g.figureAt(h)!, [sx, sy0] = P(p.x, p.y), sy = sy0 - (lifted ? 8 : 0), dead = h.hp <= 0;
    // heroes face the enemies, in the ore cave its biggest vein
    const target = g.liveMobs()[0] ?? S.nodes.filter(n => n.left > 0).sort((a, b) => b.r - a.r)[0] ?? { x: S.Wx / 2, y: S.Wy / 2 };
    if (lifted) { ell(c, sx, sy0, HERO_BASE * 1.27, HERO_BASE * 0.64); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); }
    drawMiniature(c, {
      key: h.def.key, x: sx, y: sy, baseR: HERO_BASE, baseCol: h.def.col, fig: heroFig(h.def),
      faceRight: this.faceRight(p.x, p.y, target.x, target.y), flash: h.flash > 0, hop: at ? 0 : g.figureAt(h)!.lift,
      alpha: dead ? 0.45 : carried ? 0.3 : lifted ? 0.85 : this.aimFade(h),
      hp: dead || carried ? undefined : { now: h.hp, max: h.max },
      pose: lifted ? undefined : this.pose(h.knock, p.x, p.y, HERO_BASE),
      light: S.biome.light,
      placeholder: (cc, x, y, fl) => drawHeroFigure(cc, h.i, x, y, (0.8 * heroFig(h.def)) / HERO_FIG, fl, this.t),
    });
    if (dead || carried) return;
    // with friends on the field a small gold arrow just over the head says which figure is yours
    if (g.hero === h && g.party.length > 1 && S.phase !== 'over') {
      const yy = sy - BASE_TH - heroFig(h.def) - 4 - (reduce ? 0 : Math.sin(this.t * 6) * 1.2);
      pth(c, [[sx - 3, yy - 3], [sx + 3, yy - 3], [sx, yy + 1]]);
      fs(c, '#ffd34d', 0.8);
    }
  }

  /** Where an enemy is seen: where it stands, or on its way there while the bouncer's throw slides it over. */
  private seen(m: Mob) {
    const sl = m.slid;
    if (!sl) return { x: m.x, y: m.y };
    const e = sl.t * (2 - sl.t);
    return { x: sl.x + (m.x - sl.x) * e, y: sl.y + (m.y - sl.y) * e };
  }

  private drawMob(m: Mob) {
    const { c, P, g } = this;
    // thrown down a hole by the bouncer, it drops out of sight
    const S = g.S, at = this.seen(m), [x, y0] = P(at.x, at.y), y = y0 + (m.fell ? Math.min(1, m.fell * 2.2) ** 2 * 26 : 0);
    // a kissed enemy turns to the enemy it goes for
    const it = m.intent, foe = it?.foe !== undefined ? S.mobs[it.foe] : null, th = it && !foe ? g.heroOf(it.hero) : null;
    const tgt = foe ?? (th && g.spot(th)) ?? { x: S.Wx, y: S.Wy };
    const fixed = !!MOBS[m.k].fixed;
    let pose = this.pose(m.knock, m.x, m.y, m.r), alpha = m.dead ? Math.max(0, 1 - m.dead) : (1 - (m.born ?? 0)) * (m.hp > 0 && !g.solid(m) && !fixed ? 0.35 : 1);
    if (m.fell) {
      pose = undefined;
      alpha = Math.max(0, 1 - m.fell * 2.2);
    } else if (m.dead && !reduce) {
      // beaten, it topples over away from the blow, lies a moment and fades
      const k = m.knock, side = (k && Math.sign(this.onScreen(m.x, m.y, k.x, k.y)[0])) || 1;
      pose = topplePose(m.dead, side, m.r * 1.27);
      alpha = Math.min(1, Math.max(0, (1 - m.dead) / 0.4));
    }
    if (hl.mob >= 0 && S.mobs[hl.mob] === m && m.hp > 0) {
      // picked in the HUD's queue: a gold ring round its stand shows which figure that is
      const k = reduce ? 1 : 1 + 0.08 * Math.sin(this.t * 6);
      ell(c, x, y, m.r * 1.27 * 1.35 * k, m.r * 0.64 * 1.35 * k);
      c.strokeStyle = '#ffd864'; c.lineWidth = 2.2; c.stroke();
      c.strokeStyle = 'rgba(255,216,100,.35)'; c.lineWidth = 5; c.stroke();
    }
    // the guard's door turned away from the viewer stands behind the figure, turned to it in front
    const door = !!MOBS[m.k].shield && m.hp > 0, lift = y - y0 - m.hop;
    if (door) this.drawDoor(at, m.r, tgt, lift, alpha, false);
    // the boss making its entrance (intro.ts) is drawn the way the entrance has it now; the others rock as it lands
    const iv = m === this.ib ? this.introLook(m, x, y) : null;
    if (!iv && this.ib && !pose && m.hp > 0) pose = this.introShock(m);
    let face = this.faceRight(m.x, m.y, tgt.x, tgt.y), ix = x, iy = y;
    if (iv) {
      if (iv.pose) pose = iv.pose;
      alpha *= iv.alpha ?? 1;
      if (iv.face !== undefined) face = iv.face;
      ix += iv.dx ?? 0; iy += iv.dy ?? 0;
      if (iv.clip) { c.save(); c.beginPath(); c.rect(ix - 200, iy + 4 - 400, 400, 400); c.clip(); }
    }
    const key = iv?.key ?? (m.open && sprites.has(m.k + '_open') ? m.k + '_open' : m.k);
    drawMiniature(c, {
      // the fridge with its door open has a picture of its own; Пахан's empty bunk is no enemy: a grey stand and no health
      key, x: ix, y: iy, baseR: m.r, baseCol: fixed ? '#77736c' : ENEMY_BASE, fig: MOBS[key as keyof typeof MOBS]?.fig ?? MOBS[m.k].fig,
      faceRight: face, flash: m.flash > 0, hop: m.hop + (iv?.hop ?? 0),
      alpha,
      hp: m.hp > 0 && !fixed && !iv?.bare ? { now: m.hp, max: m.max } : undefined,
      pose,
      light: S.biome.light,
      placeholder: (cc, fx, fy, fl) => drawMobFigure(cc, m.k, fx, fy, fl),
    });
    if (iv?.clip) c.restore();
    if (iv) return;
    if (m.hp <= 0) return;
    if (door) this.drawDoor(at, m.r, tgt, lift, alpha, true);
    if (m.frost) this.drawFrost(m, x, y - m.hop);
    const top = y - m.hop - BASE_TH - MOB_TOP[m.k];
    if (m.kiss !== undefined) this.drawKiss(x, top);
    if (this.cuffed()?.includes(m)) this.drawCuff(m);
    if (m.burn > 0) {
      // the more fire piled on, the more tongues of flame, and the number says what it burns off next move
      const n = Math.min(5, 2 + Math.floor(m.burn / 3));
      for (let k = 0; k < n; k++) {
        const ph = (this.t * 1.5 + k / n) % 1, fx = x - (n - 1) * 2.5 + k * 5, fy = top + 14 - ph * 8;
        c.beginPath(); c.moveTo(fx, fy - 4); c.quadraticCurveTo(fx + 2, fy, fx, fy + 1); c.quadraticCurveTo(fx - 2, fy, fx, fy - 4);
        c.fillStyle = `rgba(255,140,60,${1 - ph})`; c.fill();
      }
    }
  }

  /** The model's kiss on an enemy: a red heart bobbing over its head, with a smaller one rising off it now and then. */
  private drawKiss(x: number, top: number) {
    const { c } = this, b = reduce ? 0 : Math.sin(this.t * 3) * 1.2, ph = reduce ? 0 : (this.t * 0.7) % 1;
    const heart = (hx: number, hy: number, r: number) => {
      c.beginPath();
      c.moveTo(hx, hy + r);
      c.bezierCurveTo(hx - r * 1.7, hy - r * 0.1, hx - r * 0.9, hy - r * 1.6, hx, hy - r * 0.55);
      c.bezierCurveTo(hx + r * 0.9, hy - r * 1.6, hx + r * 1.7, hy - r * 0.1, hx, hy + r);
      c.closePath();
    };
    c.save();
    c.lineJoin = 'round';
    heart(x, top - 7 + b, 3.4); fs(c, '#ff4f7e', 0.9);
    if (ph > 0) {
      c.globalAlpha = 1 - ph;
      heart(x + 4 + ph * 2, top - 11 - ph * 8, 1.8); fs(c, '#ff9ab8', 0.6);
    }
    c.restore();
  }

  /** The cop's cuffed pair while both stand: the two enemies, or null. */
  private cuffed(): [Mob, Mob] | null {
    const S = this.g.S, cf = S.cuffs;
    if (!cf || S.phase === 'over') return null;
    const a = S.mobs[cf.a], b = S.mobs[cf.b];
    return a && b && a.hp > 0 && b.hp > 0 ? [a, b] : null;
  }

  /** Where a cuffed enemy's hands are: the cuff and the chain's end. */
  private cuffAt(m: Mob) {
    const p = this.seen(m);
    return this.P(p.x, p.y, BASE_TH + MOBS[m.k].fig * 0.42 + m.hop);
  }

  /**
   * The cop's handcuffs: a sagging chain from one cuffed enemy's hands to the other's. It goes in with the figures just in
   * front of the farther enemy, so the nearer one and whoever stands between them cover it.
   */
  private cuffItems(items: [number, () => void][]) {
    const pair = this.cuffed();
    if (!pair) return;
    const [a, b] = pair, { cam } = this;
    items.push([Math.min(cam.depth(a.x, a.y), cam.depth(b.x, b.y)) + 0.01, () => this.drawChain(a, b)]);
  }

  private drawChain(a: Mob, b: Mob) {
    const { c } = this, [ax, ay] = this.cuffAt(a), [bx, by] = this.cuffAt(b);
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + Math.min(14, Math.hypot(bx - ax, by - ay) * 0.18);
    c.save();
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(mx, my, bx, by);
    c.strokeStyle = INK; c.lineWidth = 2.6; c.stroke();
    c.setLineDash([2.2, 1.6]);
    c.strokeStyle = '#d8dde6'; c.lineWidth = 1.3; c.stroke();
    c.restore();
    this.drawCuff(a);
    this.drawCuff(b);
  }

  /** A pink fluffy cuff on a cuffed enemy's hands, worn over its figure. */
  private drawCuff(m: Mob) {
    const { c } = this, [x, y] = this.cuffAt(m);
    circ(c, x, y, 2.8); fs(c, '#ff9ccf', 0.9);
    circ(c, x, y, 1.1); c.fillStyle = INK; c.fill();
  }

  /**
   * The guard's door: a low curved door of planks bound with iron round its stand, on the side it faces `to` (±45°), where
   * a disc deals only half. It is cut in thin upright strips drawn far to near; `near` draws the strips nearer the viewer
   * than the figure, after it, else the ones behind it.
   */
  private drawDoor(at: { x: number; y: number }, r: number, to: { x: number; y: number }, lift: number, alpha: number, near: boolean) {
    const { c, P, cam } = this, a = Math.atan2(to.y - at.y, to.x - at.x), half = Math.acos(SHIELD_COS);
    const R = r + DOOR_OFF, T = 2, H = DOOR_H, N = DOOR_BOARDS * 3, ro = R + T / 2, ri = R - T / 2, mid = cam.depth(at.x, at.y), cx = P(at.x, at.y)[0], e = 0.004;
    const pt = (b: number, rad: number, h: number): Pt => {
      const q = P(at.x + Math.cos(b) * rad, at.y + Math.sin(b) * rad, h);
      return [q[0], q[1] + lift];
    };
    const quad = (b0: number, b1: number, r0: number, r1: number, h0: number, h1: number) => pth(c, [pt(b0, r0, h0), pt(b1, r1, h0), pt(b1, r1, h1), pt(b0, r0, h1)]);
    const line = (p: Pt, q: Pt) => { c.moveTo(...p); c.lineTo(...q); };
    const strips = [], hidden: number[] = [];
    for (let k = 0; k < N; k++) {
      const b0 = a - half + (2 * half * k) / N, b1 = a - half + (2 * half * (k + 1)) / N, bm = (b0 + b1) / 2;
      const d = cam.depth(at.x + Math.cos(bm) * R, at.y + Math.sin(bm) * R);
      if (d > mid === near) strips.push({ k, b0, b1, bm, d });
      // behind the figure, unless it sticks out to the side of it
      else if (near && Math.abs(pt(bm, R, H)[0] - cx) < r * 1.1) hidden.push(k);
    }
    c.save();
    c.globalAlpha *= alpha;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    // the part behind the figure shows through it as a dashed outline of its top, so the player sees where the door is
    if (hidden.length) {
      c.beginPath();
      for (const k of hidden) {
        const b0 = a - half + (2 * half * k) / N, b1 = a - half + (2 * half * (k + 1)) / N;
        line(pt(b0, ro, H), pt(b1, ro, H));
        line(pt(b0, ri, H), pt(b1, ri, H));
      }
      c.setLineDash([1.6, 1.3]);
      c.strokeStyle = 'rgba(255,232,190,.75)';
      c.lineWidth = 0.9;
      c.stroke();
      c.setLineDash([]);
    }
    strips.sort((p, q) => p.d - q.d);
    for (const { k, b0, b1, bm } of strips) {
      // the outside of the door where it is turned to the viewer, the inside where it curves away
      const nx = Math.cos(bm), ny = Math.sin(bm), out = cam.facing(nx, ny) > 0, rad = out ? ro : ri, board = Math.floor(k / 3);
      const wood = DOOR_WOOD[board % DOOR_WOOD.length], lit = 0.5 - 0.5 * cam.sideways(out ? nx : -nx, out ? ny : -ny);
      quad(b0 - e, b1 + e, rad, rad, 0, H);
      c.fillStyle = out ? mix(wood, '#2a160a', 0.35 * (1 - lit)) : mix(wood, '#1a0d06', 0.5);
      c.fill();
      for (const [h0, h1] of DOOR_BANDS) {
        quad(b0 - e, b1 + e, rad, rad, h0, h1);
        c.fillStyle = out ? mix('#4a4a50', '#1c1c20', 0.5 * (1 - lit)) : '#232327';
        c.fill();
      }
      c.beginPath();
      // the seam where one board meets the next, and a rivet on each band of the second board and the second to last
      if (k % 3 === 0 && k) { line(pt(b0, rad, 0), pt(b0, rad, H)); c.strokeStyle = '#3a2010'; c.lineWidth = 0.5; c.stroke(); }
      if (out && k % 3 === 1) {
        c.fillStyle = '#b4b4ba';
        if (board === 1 || board === DOOR_BOARDS - 2) for (const [h0, h1] of DOOR_BANDS) { circ(c, ...pt(bm, rad + 0.2, (h0 + h1) / 2), 0.5); c.fill(); }
        // the note with a lipstick kiss, stuck on the middle board between the bands
        if (board === 2) {
          quad(bm - 0.09, bm + 0.09, rad + 0.1, rad + 0.1, H * 0.36, H * 0.62);
          c.fillStyle = '#efe6cf'; c.fill();
          circ(c, ...pt(bm + 0.04, rad + 0.15, H * 0.43), 0.5); c.fillStyle = '#d8323f'; c.fill();
        }
      }
      // the top of the planks
      pth(c, [pt(b0 - e, ri, H), pt(b1 + e, ri, H), pt(b1 + e, ro, H), pt(b0 - e, ro, H)]);
      c.fillStyle = mix(wood, '#ffe2c0', 0.25);
      c.fill();
      // the cut end of the door, at either side
      const end = k === 0 ? b0 : k === N - 1 ? b1 : null;
      if (end !== null) { quad(end, end, ri, ro, 0, H); c.fillStyle = mix(wood, '#2a160a', 0.3); c.fill(); }
      // the outline: the top edges, the foot of the side in sight, and the end
      c.beginPath();
      line(pt(b0, ro, H), pt(b1, ro, H));
      line(pt(b0, ri, H), pt(b1, ri, H));
      line(pt(b0, rad, 0), pt(b1, rad, 0));
      if (end !== null) { line(pt(end, ri, 0), pt(end, ri, H)); line(pt(end, ro, 0), pt(end, ro, H)); line(pt(end, ri, 0), pt(end, ro, 0)); }
      c.strokeStyle = INK;
      c.lineWidth = 0.7;
      c.stroke();
    }
    c.restore();
  }

  /**
   * The ice genius's frost on an enemy standing at screen point (x, y): slowed, its stand is rimed over and snowflakes
   * hang round it; frozen, it stands in a block of ice.
   */
  private drawFrost(m: Mob, x: number, y: number) {
    const { c } = this, R = m.r * 1.27, fig = MOBS[m.k].fig, frozen = this.g.frozen(m);
    c.save();
    c.lineJoin = 'round';
    // rime on the stand
    ell(c, x, y - BASE_TH, R + 1, m.r * 0.64 + 0.6);
    c.fillStyle = 'rgba(225,246,255,.55)'; c.fill();
    c.strokeStyle = '#7fc8e8'; c.lineWidth = 0.9; c.stroke();
    if (frozen) {
      // a block of ice on the enemy's own cells: its sides run along the floor's grid, so it turns with the room like
      // a stone block, glassy blue with the figure showing through
      const { P, cam } = this, sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz), H = BASE_TH + fig + 5;
      const x0 = i * TILE + 0.6, y0 = j * TILE + 0.6, x1 = (i + sz) * TILE - 0.6, y1 = (j + sz) * TILE - 0.6;
      const sides: [Vec, Vec, Vec][] = [[[x1, y0], [x1, y1], [1, 0]], [[x0, y1], [x1, y1], [0, 1]], [[x0, y0], [x0, y1], [-1, 0]], [[x0, y0], [x1, y0], [0, -1]]];
      c.strokeStyle = '#2b6f93'; c.lineWidth = 1.2;
      for (const [a, b, n] of sides) {
        const k = cam.facing(n[0], n[1]);
        if (k <= 1e-6) continue;
        pth(c, [P(...a), P(...b), P(...b, H), P(...a, H)]);
        c.fillStyle = `rgba(175,228,255,${(0.34 + 0.16 * (0.5 + 0.5 * cam.sideways(n[0], n[1]))).toFixed(2)})`; c.fill(); c.stroke();
      }
      pth(c, [P(x0, y0, H), P(x1, y0, H), P(x1, y1, H), P(x0, y1, H)]);
      c.fillStyle = 'rgba(230,248,255,.7)'; c.fill(); c.stroke();
      // two glints across the top
      const at = (u: number, v: number) => P(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, H);
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(...at(0.2, 0.3)); c.lineTo(...at(0.45, 0.25)); c.moveTo(...at(0.25, 0.55)); c.lineTo(...at(0.38, 0.5)); c.stroke();
      c.restore();
      return;
    }
    // slowed: three snowflakes turning slowly round it
    for (let k = 0; k < 3; k++) {
      const a = (reduce ? 0 : this.t * 0.8) + (k * Math.PI * 2) / 3, fx = x + Math.cos(a) * (R + 3), fy = y - fig * 0.55 + Math.sin(a) * 4;
      c.strokeStyle = '#e8f8ff'; c.lineWidth = 1;
      c.beginPath();
      for (let s = 0; s < 3; s++) { const b = (s * Math.PI) / 3 + a; c.moveTo(fx - Math.cos(b) * 2.2, fy - Math.sin(b) * 2.2); c.lineTo(fx + Math.cos(b) * 2.2, fy + Math.sin(b) * 2.2); }
      c.stroke();
    }
    c.restore();
  }

  // ------------------------------------------------------------ smoke

  private fog: { cv: HTMLCanvasElement; mask: HTMLCanvasElement; pats: CanvasPattern[]; key: string; at: number } | null = null;

  /** A tile of soft clouds in one colour that repeats seamlessly. */
  private puffTile(col: string) {
    const N = 256;
    const tile = document.createElement('canvas');
    tile.width = tile.height = N;
    const x = tile.getContext('2d')!;
    for (let k = 0; k < 46; k++) {
      const cx = hr(k, 1) * N, cy = hr(k, 2) * N, r = 26 + hr(k, 3) * 58, a = 0.18 + hr(k, 4) * 0.3;
      // drawn again past each edge, so the tile meets itself without a seam
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        gr.addColorStop(0, `rgba(${col},${a})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = gr;
        x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
      }
    }
    return tile;
  }

  /**
   * «Дым-машина», an event's curse: the room under drifting smoke, clear only around the heroes (and their runes while
   * they are put out), with a small clearing following every disc in flight. Smoke is soft, so it is drawn at half a pixel
   * per screen pixel, and made afresh only when something under it moves or, for the slow drift, ten times a second.
   */
  private drawSmoke(view: { w: number; h: number; dpr: number }) {
    const { c, cam, g, t } = this;
    const S = g.S, q = 0.5;
    if (!this.fog) {
      // made once: two cloud tiles, a light and a dark one, as patterns of the smoke's own canvas
      const cv = document.createElement('canvas'), x = cv.getContext('2d')!;
      this.fog = { cv, mask: document.createElement('canvas'), pats: ['240,236,250', '140,134,162'].map(col => x.createPattern(this.puffTile(col), 'repeat')!), key: '', at: -1 };
    }
    const fog = this.fog, { cv, mask, pats } = fog, W = Math.ceil(view.w * q), H = Math.ceil(view.h * q);
    const spots = [...S.heroes.map(h => g.figureAt(h)), ...S.discs.filter(d => !d.gone && Math.hypot(d.vx, d.vy) > 1)]
      .map(p => p && `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const key = `${W}x${H} ${cam.panX},${cam.panY},${cam.zoom},${cam.rot} ${S.phase} ${spots} ${this.carry ? this.carry.x + ',' + this.carry.y : ''}`;
    if (key !== fog.key || Math.abs(t - fog.at) > 0.1) {
      fog.key = key;
      fog.at = t;
      for (const k of [cv, mask]) if (k.width !== W || k.height !== H) { k.width = W; k.height = H; }
      this.smokeLayer(cv, mask, pats, W, H, view, q);
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(cv, 0, 0, W, H, 0, 0, view.w * view.dpr, view.h * view.dpr);
    c.restore();
  }

  private smokeLayer(cv: HTMLCanvasElement, mask: HTMLCanvasElement, pats: CanvasPattern[], W: number, H: number, view: { w: number; h: number }, q: number) {
    const { cam, g, t } = this;
    const S = g.S;
    const f = cv.getContext('2d')!;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H);
    const z = cam.zoom * q, drift = reduce ? 0 : t;
    // stage smoke: light lilac grey, the walls and torches stick out of it, an enemy inside is a shadow at most
    f.fillStyle = 'rgba(172,166,192,.88)';
    f.fillRect(0, 0, W, H);
    // two layers of clouds drifting apart, anchored to the room so they turn and zoom with it
    pats.forEach((pat, k) => {
      const sp = k ? -5 : 7;
      f.setTransform(z, 0, 0, z, cam.panX * q, cam.panY * q);
      // the tile repeats every 256 units, so the drift wraps round and the clouds never run out
      f.translate((drift * sp) % 256, (drift * sp * 0.4 * (k ? 1 : -1)) % 256);
      f.fillStyle = pat;
      const [x0, y0] = cam.screenToIso(0, 0), [x1, y1] = cam.screenToIso(view.w, view.h);
      f.fillRect(x0 - 300, y0 - 300, x1 - x0 + 600, y1 - y0 + 600);
    });
    // the smoke fills the room's box and thins out towards the tops of the walls, never spilling into the dark around it:
    // boxes of rising height, each adding a fifth of the smoke
    const m = mask.getContext('2d')!;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    m.setTransform(z, 0, 0, z, cam.panX * q, cam.panY * q);
    m.fillStyle = 'rgba(0,0,0,.2)';
    // added up, not laid over: where all five boxes meet, the smoke is whole
    m.globalCompositeOperation = 'lighter';
    for (const k of [0.3, 0.5, 0.7, 0.85, 1]) {
      const box: Pt[] = [];
      for (const [x, y] of [[0, 0], [S.Wx, 0], [S.Wx, S.Wy], [0, S.Wy]]) box.push(this.P(x, y), this.P(x, y, (WALL_H + 8) * k));
      pth(m, hull(box));
      m.fill();
    }
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(mask, 0, 0);
    // the clearings: a world circle lies on the iso floor as an ellipse twice as wide as it is tall
    f.globalCompositeOperation = 'destination-out';
    f.setTransform(z, 0, 0, z, cam.panX * q, cam.panY * q);
    const clear = (x: number, y: number, r0: number, r1: number, lift = 0) => {
      const [px, py] = this.P(x, y, lift);
      f.save();
      f.translate(px, py);
      f.scale(KX * Math.SQRT2, KY * Math.SQRT2 * 1.25);
      const gr = f.createRadialGradient(0, 0, r0, 0, 0, r1);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = gr;
      f.fillRect(-r1, -r1, r1 * 2, r1 * 2);
      f.restore();
    };
    for (const h of S.heroes) {
      const p = g.figureAt(h);
      if (p) clear(p.x, p.y, TILE * 1.8, TILE * 3.4, 10);
    }
    if (this.carry) { const [x, y] = cam.screenToWorld(this.carry.x, this.carry.y); clear(x, y, TILE * 1.2, TILE * 2.6, 10); }
    if (S.phase === 'place') for (const p of S.pads) clear(p.x, p.y, TILE * 0.9, TILE * 2);
    for (const d of S.discs) if (!d.gone && Math.hypot(d.vx, d.vy) > 1) clear(d.x, d.y, TILE * 0.6, TILE * 1.8);
  }

  // ------------------------------------------------------------ aim & effects

  /**
   * The aim line, painted on the floor: one stretch up to the first wall, block or mob; ricochets are left for the player
   * to judge, unless the hero wears «Рентген-очки»: then the line runs on through three bounces, with a ring at each.
   * It goes down before the figures, so they stand on it, and it lies flat with the floor's own foreshortening.
   */
  private drawAimLine(aim: Aim | null) {
    if (!aim) return;
    const { c, g } = this;
    const h = aim.hero, len = Math.hypot(aim.dx, aim.dy);
    if (!g.spot(h) || len < 4) return;
    const xray = has(h, 'xray'), pr = g.predict(h, aim.dx, aim.dy, xray ? ART.xrayBounces : 0);
    // «Стробоскоп», an event's curse: the fight goes without the line; a banshee's scream takes it off the screamed-at hero for a turn
    if (pr.path.length < 2 || g.S.spec.strobe || h.daze > 0) return;
    const pts = xray ? pr.path : [pr.path[0], pr.path[pr.path.length - 1]];
    // thick enough to read on a phone at any zoom; in floor units, so it flattens with the floor where it runs across the view
    const lw = Math.max(2.6, 5 / this.cam.zoom), col = h.def.col, run = reduce ? 0 : this.t * 20;
    c.save();
    this.onFloor();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = 'rgba(20,10,5,.55)';
    c.lineWidth = lw + 2;
    c.stroke();
    c.setLineDash([lw * 2.2, lw * 1.4]);
    c.lineDashOffset = -run;
    c.strokeStyle = col;
    c.lineWidth = lw;
    c.stroke();
    c.setLineDash([]);
    if (xray) for (const [bx, by] of pr.bounces) { circ(c, bx, by, lw * 1.3); fs(c, col, 1); }
    c.restore();
  }

  /**
   * The aim line lies on the floor, so a hero throwing up the screen would hide it behind its whole figure: the steeper
   * the line climbs from its feet, the more the figure fades while aiming, and the line shows through.
   */
  private aimFade(h: HeroState) {
    const a = this.aim, len = a ? Math.hypot(a.dx, a.dy) : 0;
    if (!a || a.hero !== h || len < 4 || this.g.S.spec.strobe) return 1;
    // how steeply the line climbs the screen from the hero's feet: straight up it runs behind the whole figure
    const o = this.P(0, 0), e = this.P(a.dx, a.dy), up = (o[1] - e[1]) / Math.hypot(e[0] - o[0], e[1] - o[1]);
    const k = Math.min(1, Math.max(0, (up - 0.45) / 0.45));
    return 1 - 0.5 * k * k * (3 - 2 * k);
  }

  /** How hard the hero pulls, in five pips at its feet: these stay over the figure, they are its readout, not paint. */
  private drawAimPull(aim: Aim | null) {
    if (!aim) return;
    const { c, P, g } = this;
    const h = aim.hero, p = g.spot(h), len = Math.hypot(aim.dx, aim.dy);
    if (!p || len < 4) return;
    const [px, py] = P(p.x, p.y), pw = Math.round((len / 60) * 5);
    for (let k = 0; k < 5; k++) { rr(c, px - 11 + k * 4.6, py + 7, 3.6, 2.6, 1); fs(c, k < pw ? h.def.col : '#2a1f18', 0.6); }
  }

  /** From here on the canvas draws in world units on the floor: what is drawn lies flat on it, foreshortened as it is. */
  private onFloor() {
    const { c, P } = this, o = P(0, 0), ex = P(1, 0), ey = P(0, 1);
    c.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
  }

  /** A chip of stone, gold, crystal, mushroom or ice, tumbling, with its shadow on the floor; it fades at the end of its life. */
  private drawChip(p: Spark) {
    const { c, P } = this, life = p.life ?? 0.5, s = p.sz;
    const [x, y] = P(p.x, p.y, p.h);
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, (life - p.t) / 0.3));
    ell(c, ...P(p.x, p.y), s * 0.9, s * 0.45); c.fillStyle = 'rgba(15,8,4,.3)'; c.fill();
    c.translate(x, y);
    c.rotate(p.a ?? 0);
    c.lineJoin = 'round';
    const lw = Math.min(0.9, 0.3 + s * 0.12);
    const poly = (pts: number[][], col: string) => { pth(c, pts.map(([u, v]) => [u * s, v * s] as Pt)); fs(c, col, lw); };
    const rock = (col: string, dk: string) => {
      const pts = [[-1, -0.3], [-0.4, -1], [0.6, -0.8], [1, 0.1], [0.4, 0.9], [-0.7, 0.7]];
      poly(pts, col);
      pth(c, [[0.6 * s, -0.8 * s], [1 * s, 0.1 * s], [0.4 * s, 0.9 * s], [-0.1 * s, 0.2 * s]]); c.fillStyle = dk; c.fill();
      pth(c, pts.map(([u, v]) => [u * s, v * s] as Pt)); c.strokeStyle = INK; c.lineWidth = lw; c.stroke();
    };
    const nug = (u: number, v: number, k: number) => {
      pth(c, [[(u - 0.5 * k) * s, v * s], [u * s, (v - 0.7 * k) * s], [(u + 0.5 * k) * s, v * s], [u * s, (v + 0.45 * k) * s]]);
      fs(c, '#f2b83c', lw * 0.8);
      circ(c, (u - 0.1 * k) * s, (v - 0.15 * k) * s, 0.14 * k * s); c.fillStyle = '#fff3c4'; c.fill();
    };
    const cap = (r: number, dy: number) => {
      c.beginPath(); c.ellipse(0, dy * s, r * s, r * 0.85 * s, 0, Math.PI, 0); c.quadraticCurveTo(0, (dy + 0.35 * r) * s, -r * s, dy * s); c.closePath();
      fs(c, '#d24c3a', lw);
      ell(c, -0.3 * r * s, (dy - 0.45 * r) * s, 0.2 * r * s, 0.17 * r * s); fs(c, '#fbf3e0', lw * 0.6);
      ell(c, 0.35 * r * s, (dy - 0.3 * r) * s, 0.14 * r * s, 0.12 * r * s); fs(c, '#fbf3e0', lw * 0.6);
    };
    switch (p.k) {
      case 'ore': rock('#6b7280', '#41464f'); break;
      case 'gold': nug(0, 0, 1.6); break;
      case 'spk': poly([[-0.35, 0.9], [-0.35, -0.4], [0, -1.1], [0.35, -0.4], [0.35, 0.9]], '#a98ae8'); break;
      case 'cap': cap(1, 0.4); break;
      case 'stem': rr(c, -0.35 * s, -0.8 * s, 0.7 * s, 1.6 * s, 0.3 * s); fs(c, '#f1e7d0', lw); break;
      case 'ice': poly([[-0.4, 0.8], [-0.2, -0.9], [0.5, 0.3]], '#d8f2ff'); break;
    }
    c.restore();
  }

  /** A stroke of lightning: a jagged line at mid-figure height, a wide cyan glow under a white core, flickering out. */
  private drawZap(z: Zap) {
    const { c, P } = this, a = P(z.x0, z.y0, z.h0), b = P(z.x1, z.y1, z.h1), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const n = Math.max(3, Math.round(L / 6)), pts: Pt[] = [];
    let r = z.s;
    const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296 - 0.5;
    for (let k = 0; k <= n; k++) {
      // a light spot off the mirror ball flies straight; lightning zigzags
      const u = k / n, off = k === 0 || k === n || z.beam ? 0 : rnd() * Math.min(9, L * 0.25);
      pts.push([a[0] + dx * u - (dy / L) * off, a[1] + dy * u + (dx / L) * off]);
    }
    // a cartoon bolt: ink outline, electric blue, white core, so it reads on dark stone and on white ice alike; it flickers
    // and thins out as it fades
    const q = 1 - z.t / ZAP_T, w = 0.5 + 0.5 * q;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.globalAlpha = Math.min(1, q * 2) * (0.8 + 0.2 * Math.sin(z.t * 70));
    c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(...p) : c.moveTo(...p)));
    c.strokeStyle = INK; c.lineWidth = 3.6 * w; c.stroke();
    c.strokeStyle = z.beam ? '#ffd34d' : '#3fb4ff'; c.lineWidth = 2.4 * w; c.stroke();
    c.strokeStyle = z.beam ? '#fffbe6' : '#f2fcff'; c.lineWidth = 0.9 * w; c.stroke();
    c.restore();
  }

  private drawFx() {
    const { c, P } = this;
    const S = this.g.S;
    for (const z of S.zaps) this.drawZap(z);
    for (const p of S.sparks) {
      if (p.k) continue;
      const [sx, sy] = P(p.x, p.y, p.h);
      c.globalAlpha = Math.max(0, 1 - p.t * 2);
      circ(c, sx, sy, p.sz);
      c.fillStyle = p.col;
      c.fill();
    }
    c.globalAlpha = 1;
    c.font = '600 10px Oswald, sans-serif';
    c.textAlign = 'center';
    c.lineJoin = 'round';
    for (const f of S.floats) {
      const [sx, sy] = P(f.x, f.y, 26 + f.t * 14), sc = f.t < 0.12 ? 0.6 + f.t * 3.3 : 1;
      c.save();
      c.translate(sx, sy);
      c.scale(sc, sc);
      c.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      c.strokeStyle = INK; c.lineWidth = 2.6; c.strokeText(f.txt, 0, 0);
      c.fillStyle = f.col; c.fillText(f.txt, 0, 0);
      c.restore();
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------ the boss's entrance (intro.ts)

  /** The boss making its entrance this frame, if one is under way. */
  private ib: Mob | null = null;
  /** Where the dancer moonwalks in from and where the king's carpet runs to, worked out once per entrance. */
  private introWay: { of: object; dx: number; dy: number; len: number } | null = null;
  private introPuffImg: HTMLCanvasElement | null = null;

  private introAt() {
    const it = intro.now, S = this.g.S;
    this.ib = it ? S.mobs.find(m => MOBS[m.k].boss && m.hp > 0 && bossKind(m.k) === it.k) ?? null : null;
    if (it && this.ib && this.introWay?.of !== it) this.introWay = { of: it, ...this.freeWay(this.ib, it.k === 'king' ? 5 : 3) };
  }

  /** Seconds since the entrance began, and the boss's own kind; null when there is none. */
  private iu(): { u: number; k: string; end: number } | null {
    const it = intro.now;
    // before the entrance begins the room stands as it is before the boss comes
    return it && this.ib && it.len ? { u: Math.max(0, it.t), k: it.k, end: it.end } : null;
  }

  /** When the boss lands in its entrance, and how hard: the others rock and the board shakes. */
  private static LAND: Record<string, [number, number]> = {
    king: [1.45, 1], ratswarm: [1.4, 0.5], pahan: [0.95, 0.7], lich: [0.55, 0.45], fridge: [1.75, 0.6], forgelord: [1.05, 1], discoball: [1.75, 0.5],
  };

  private introShake() {
    const iu = this.iu(), l = iu && SceneRenderer.LAND[iu.k];
    if (!iu || !l) return 0;
    const v = iu.u - l[0];
    return v >= 0 && v < 0.28 ? l[1] * (1 - v / 0.28) : 0;
  }

  /** Another enemy near the boss rocks on its stand when the boss lands. */
  private introShock(m: Mob): Pose | undefined {
    const iu = this.iu(), l = iu && SceneRenderer.LAND[iu.k], b = this.ib;
    if (!iu || !l || !b || iu.u < l[0]) return undefined;
    const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy) || 1, p = l[1] * Math.max(0, 1 - d / 120);
    if (p <= 0.05) return undefined;
    // the wave runs out from the boss: the farther, the later it comes
    return knockPose({ t: iu.u - l[0] - d / 260, x: dx / d, y: dy / d, p: p * 0.8 }, ...this.onScreen(m.x, m.y, dx / d, dy / d), m.r);
  }

  /** The direction with the most free floor next to the boss's cells, and how many cells of it there are, up to `max`. */
  private freeWay(m: Mob, max: number) {
    const S = this.g.S, half = mobSize(m.k) * TILE / 2;
    const free = (x: number, y: number) => floorAt(S, x, y) && !pitAt(S.pits, x, y) && S.blocks.every(b => x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1)
      && S.mobs.every(o => o === m || Math.hypot(o.x - x, o.y - y) > o.r + 4);
    let best = { dx: 1, dy: 0, len: 0 };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let n = 0;
      while (n < max && free(m.x + dx * (half + TILE * (n + 0.5)), m.y + dy * (half + TILE * (n + 0.5)))) n++;
      // ties go to the side that runs across the screen, where a slide is seen best
      const across = Math.abs(this.onScreen(m.x, m.y, dx, dy)[0]);
      if (n > best.len || (n === best.len && across > Math.abs(this.onScreen(m.x, m.y, best.dx, best.dy)[0]))) best = { dx, dy, len: n };
    }
    return best;
  }

  /**
   * How the boss is drawn this frame of its entrance: how see-through, how high off the table, how it leans or squashes,
   * off its cell by how much (screen units), which picture, cut off at the floor (coming up through it).
   */
  private introLook(m: Mob, x: number, y: number): { alpha?: number; hop?: number; pose?: Pose; key?: string; dx?: number; dy?: number; face?: boolean; clip?: boolean; bare?: boolean } | null {
    const iu = this.iu();
    if (!iu) return null;
    const { u, k } = iu, clamp = (v: number) => Math.min(1, Math.max(0, v));
    // dropping from above, faster and faster, from height H between t0 and t1; not in the room before t0
    const drop = (t0: number, t1: number, H: number) => (u < t0 ? { alpha: 0 } : u < t1 ? { hop: H * (1 - ((u - t0) / (t1 - t0)) ** 2) } : null);
    // the squash of landing, settling with a wobble
    const squash = (t: number, a: number, f = 13, d = 6): Pose => ({ rot: 0, px: 0, py: 0, sy: 1 - a * Math.exp(-d * (u - t)) * Math.cos(f * (u - t)) });
    const knock = (t: number, dx: number, dy: number, p: number) => (u >= t ? knockPose({ t: u - t, x: dx, y: dy, p }, ...this.onScreen(m.x, m.y, dx, dy), m.r) : undefined);
    switch (k) {
      case 'king': return drop(1.0, 1.45, 190) ?? { pose: squash(1.45, 0.2) };
      case 'forgelord': return drop(0.6, 1.05, 200) ?? { pose: squash(1.05, 0.16) };
      case 'ratswarm': {
        // the heap knots itself together as the rats arrive
        const sw = clamp((u - 0.9) / 0.5);
        return sw < 1 ? { pose: { rot: 0, px: 0, py: 0, sy: Math.max(0.01, sw) }, alpha: Math.min(1, sw * 3) } : { pose: squash(1.4, 0.12) };
      }
      case 'pahan': {
        // standing, he jumps down onto his empty bunk and lands sitting on it, the springs bouncing him
        if (u < 0.95) {
          this.introBunk(m, x, y);
          return u < 0.5 ? { alpha: 0 } : { key: 'pahan2', hop: 170 * (1 - ((u - 0.5) / 0.45) ** 2), bare: true };
        }
        return { pose: squash(0.95, 0.3, 17, 2.6) };
      }
      case 'lich': {
        const v = clamp((u - 0.55) / 1.15), e = 1 - (1 - v) ** 2;
        return { hop: -(MOBS[m.k].fig + BASE_TH + 6) * (1 - e), clip: v < 1, pose: v >= 1 ? squash(1.7, 0.06) : undefined };
      }
      case 'fridge': {
        const open = u >= 0.45 && u < 1.75;
        return { key: open ? 'fridge_open' : undefined, pose: u >= 1.75 ? knock(1.75, 0.7, 0.7, 0.9) : knock(0.45, -0.7, 0.7, 0.5) };
      }
      case 'dancer': {
        // the moonwalk: he glides in backwards from the free side, bobbing, and turns to strike his pose
        const w = this.introWay!, D = w.len * TILE + 8, v = clamp((u - 0.2) / 1.4), e = 1 - (1 - v) ** 3;
        const [ox, oy] = this.onScreen(m.x, m.y, w.dx * D * (1 - e), w.dy * D * (1 - e));
        if (u < 1.65) return { dx: ox, dy: oy, hop: v < 1 ? Math.abs(Math.sin(u * 13)) * 1.6 : 0, face: this.onScreen(m.x, m.y, w.dx, w.dy)[0] > 0, alpha: clamp((u - 0.2) / 0.2) };
        return { pose: squash(1.65, -0.12, 16, 5) };
      }
      case 'discoball': {
        const v = clamp((u - 0.2) / 1.55), e = 1 - (1 - v) ** 3;
        return { hop: 220 * (1 - e), pose: v < 1 ? { rot: 0.1 * Math.sin(u * 5) * (1 - e), px: 0, py: 0, sy: 1 } : squash(1.75, 0.08) };
      }
      case 'dragon': return { alpha: clamp((u - 0.75) / 0.35) };
    }
    return null;
  }

  /** Пахан's bunk, standing empty until he lands on it. */
  private introBunk(m: Mob, x: number, y: number) {
    drawMiniature(this.c, {
      key: 'bunk', x, y, baseR: m.r, baseCol: '#77736c', fig: MOBS.bunk.fig, faceRight: !this.faceRight(m.x, m.y, this.g.S.Wx / 2, this.g.S.Wy / 2), flash: false, hop: 0, alpha: 1,
      light: this.g.S.biome.light, placeholder: (cc, fx, fy, fl) => drawMobFigure(cc, 'bunk', fx, fy, fl),
    });
  }

  /** What an entrance lays on the floor under the figures: a carpet, a lit dance floor, frost, a glowing forge floor, light spots. */
  private drawIntroFloor() {
    const iu = this.iu(), m = this.ib;
    if (!iu || !m) return;
    const { c, P } = this, { u, k, end } = iu, out = Math.min(1, Math.max(0, (end - 0.3 - u) / 0.8)), half = mobSize(m.k) * TILE / 2;
    const quad = (x0: number, y0: number, x1: number, y1: number) => { c.moveTo(...P(x0, y0)); c.lineTo(...P(x1, y0)); c.lineTo(...P(x1, y1)); c.lineTo(...P(x0, y1)); c.closePath(); };
    const ring = (t: number, col: string) => {
      // the shock of the landing running out over the floor
      const v = (u - t) / 0.7;
      if (v < 0 || v > 1) return;
      c.beginPath();
      for (let a = 0; a <= 48; a++) { const r = half + 8 + v * 70, q = P(m.x + Math.cos((a / 48) * Math.PI * 2) * r, m.y + Math.sin((a / 48) * Math.PI * 2) * r); if (a) c.lineTo(...q); else c.moveTo(...q); }
      c.strokeStyle = `rgba(${col},${0.7 * (1 - v)})`; c.lineWidth = 3 * (1 - v) + 1; c.stroke();
    };
    c.save();
    c.globalAlpha = out;
    if (k === 'king') {
      // the red carpet rolls out from the far end up to his cell, gold along its edges, the roll going before it
      const w = this.introWay!, L = Math.max(2, w.len) * TILE, v = Math.min(1, Math.max(0, (u - 0.1) / 0.8)), e = 1 - (1 - v) ** 2;
      const nx = -w.dy, ny = w.dx, W = 6.5, a0 = half + L, a1 = half + L * (1 - e);
      const pt = (a: number, s: number) => P(m.x + w.dx * a + nx * s, m.y + w.dy * a + ny * s);
      if (v > 0) {
        pth(c, [pt(a0, -W), pt(a0, W), pt(a1, W), pt(a1, -W)]); c.fillStyle = '#a5232f'; c.fill();
        for (const s of [-W + 1, W - 1]) { c.beginPath(); c.moveTo(...pt(a0, s)); c.lineTo(...pt(a1, s)); c.strokeStyle = '#e8b64a'; c.lineWidth = 1.4; c.stroke(); }
        if (v < 1) { pth(c, [pt(a1 + 1.5, -W - 0.5), pt(a1 + 1.5, W + 0.5), pt(a1 - 2.5, W + 0.5), pt(a1 - 2.5, -W - 0.5)]); c.fillStyle = '#6e1820'; c.fill(); }
      }
      ring(1.45, '255,220,140');
    } else if (k === 'dancer') {
      // the dance floor round him lights up cell by cell in waves of colour
      const ci = Math.floor(m.x / TILE), cj = Math.floor(m.y / TILE), cols = ['255,79,180', '80,220,255', '255,226,90', '140,255,120'], S = this.g.S;
      const on = Math.min(1, u / 0.3);
      for (let j = cj - 4; j <= cj + 3; j++) for (let i = ci - 4; i <= ci + 3; i++) {
        if (!isFloor(S, i, j)) continue;
        const d = Math.max(Math.abs(i + 0.5 - m.x / TILE), Math.abs(j + 0.5 - m.y / TILE));
        if (d > 4) continue;
        const ph = Math.floor(u * 6 - d * 0.7), lit = (i + j + ph) % 2 === 0;
        if (!lit) continue;
        c.beginPath(); quad(i * TILE + 1, j * TILE + 1, i * TILE + TILE - 1, j * TILE + TILE - 1);
        c.fillStyle = `rgba(${cols[((i * 3 + j + ph) % 4 + 4) % 4]},${0.42 * on * (1 - d / 5)})`; c.fill();
      }
    } else if (k === 'forgelord') {
      // the cells round his landing glow red hotter and hotter, flare white-hot as he lands and cool off
      const pre = Math.min(1, u / 1.05), flare = u >= 1.05 ? Math.max(0, 1 - (u - 1.05) / 0.9) : 0;
      const a = u < 1.05 ? 0.25 + 0.35 * pre * (0.8 + 0.2 * Math.sin(u * 18)) : 0.6 * flare;
      if (a > 0) {
        c.beginPath();
        for (let j = -2; j < 2; j++) for (let i = -2; i < 2; i++) { const x0 = m.x + i * TILE * 1.5 + 1, y0 = m.y + j * TILE * 1.5 + 1; quad(x0, y0, x0 + TILE * 1.5 - 2, y0 + TILE * 1.5 - 2); }
        c.fillStyle = u < 1.05 ? `rgba(255,40,20,${a})` : `rgba(255,${150 + 80 * flare},70,${a})`; c.fill();
        c.strokeStyle = `rgba(255,90,50,${Math.min(1, a * 1.6)})`; c.lineWidth = 1.6; c.stroke();
      }
      ring(1.05, '255,150,60');
    } else if (k === 'lich') {
      // frost spreads over the floor from where he will come up, cracks running out through it
      const v = Math.min(1, u / 0.9), R = half + 6 + v * 34;
      c.beginPath();
      for (let a = 0; a <= 36; a++) { const ang = (a / 36) * Math.PI * 2, r = R * (0.86 + 0.14 * hr(a % 36, 7)), q = P(m.x + Math.cos(ang) * r, m.y + Math.sin(ang) * r); if (a) c.lineTo(...q); else c.moveTo(...q); }
      c.fillStyle = 'rgba(200,238,255,.32)'; c.fill();
      c.strokeStyle = 'rgba(235,250,255,.7)'; c.lineWidth = 0.8;
      for (let n = 0; n < 9; n++) {
        const ang = (n / 9) * Math.PI * 2 + hr(n, 3), len = R * (0.6 + 0.4 * hr(n, 5));
        c.beginPath(); c.moveTo(...P(m.x + Math.cos(ang) * half * 0.6, m.y + Math.sin(ang) * half * 0.6));
        for (let s = 1; s <= 3; s++) { const r = (len * s) / 3, wob = (hr(n, s) - 0.5) * 0.5; c.lineTo(...P(m.x + Math.cos(ang + wob) * r, m.y + Math.sin(ang + wob) * r)); }
        c.stroke();
      }
    } else if (k === 'discoball') {
      // the mirror ball's light spots wheel round the floor once it hangs low enough
      const on = Math.min(1, Math.max(0, (u - 0.9) / 0.5));
      if (on > 0) for (let n = 0; n < 26; n++) {
        const r = half + 10 + 58 * hr(n, 11), ang = hr(n, 12) * Math.PI * 2 + u * (0.9 + 0.3 * hr(n, 13)), x = m.x + Math.cos(ang) * r, yy = m.y + Math.sin(ang) * r;
        if (!floorAt(this.g.S, x, yy)) continue;
        const [sx, sy] = P(x, yy);
        ell(c, sx, sy, 2.2, 1.1); c.fillStyle = `rgba(${n % 3 ? '255,255,255' : n % 2 ? '255,170,230' : '160,230,255'},${0.75 * on})`; c.fill();
      }
    }
    c.restore();
  }

  /** The entrance's figures that stand on the floor among the others: the rats running in to knot into the swarm. */
  private introItems(items: [number, () => void][]) {
    const iu = this.iu(), m = this.ib;
    if (!iu || !m || iu.k !== 'ratswarm') return;
    const { u } = iu, S = this.g.S, N = 12, [bx] = this.P(m.x, m.y);
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2 + 0.3, st = 0.05 * (k % 5), v = Math.min(1, Math.max(0, (u - st) / 1.0));
      if (v >= 1) continue;
      const R0 = 90 + (k % 3) * 18, wx = m.x + Math.cos(a0) * R0 * (1 - v), wy = m.y + Math.sin(a0) * R0 * (1 - v);
      items.push([this.cam.depth(wx, wy), () => {
        const [rx, ry] = this.P(wx, wy);
        drawMiniature(this.c, {
          key: 'rat', x: rx, y: ry, baseR: MOBS.rat.r, baseCol: ENEMY_BASE, fig: MOBS.rat.fig, faceRight: rx < bx, flash: false,
          hop: Math.abs(Math.sin(u * 22 + k)) * 2.5, alpha: v > 0.85 ? (1 - v) / 0.15 : 1, light: S.biome.light,
          placeholder: (cc, fx, fy, fl) => drawMobFigure(cc, 'rat', fx, fy, fl),
        });
      }]);
    }
  }

  /** A soft grey puff of smoke, dust or steam. */
  private introPuff() {
    if (this.introPuffImg) return this.introPuffImg;
    const cv = document.createElement('canvas'), W = 96, H = 64, x = cv.getContext('2d')!;
    cv.width = W; cv.height = H;
    const lumps: [number, number, number][] = [[30, 38, 18], [52, 28, 22], [72, 40, 16], [50, 44, 18]];
    x.beginPath();
    for (const [a, b, r] of lumps) { x.moveTo(a + r, b); x.arc(a, b, r, 0, Math.PI * 2); }
    x.lineWidth = 5; x.strokeStyle = '#6f675e'; x.stroke();
    x.fillStyle = '#bdb4a8'; x.fill();
    x.fillStyle = 'rgba(245,240,232,.7)';
    for (const [a, b, r] of lumps) { x.beginPath(); x.arc(a - r * 0.3, b - r * 0.35, r * 0.38, 0, Math.PI * 2); x.fill(); }
    return (this.introPuffImg = cv);
  }

  /** What an entrance throws up over the figures: dust, ice, sparks, steam, smoke, food, the light inside the fridge, the chain. */
  private drawIntroOver() {
    const iu = this.iu(), m = this.ib;
    if (!iu || !m) return;
    const { c, P } = this, { u, k } = iu, [x, y] = P(m.x, m.y), top = y - BASE_TH - MOB_TOP[m.k], im = this.introPuff();
    const puff = (px: number, py: number, w: number, a: number) => { c.globalAlpha = a; c.drawImage(im, px - w / 2, py - w / 3, w, (w * 2) / 3); };
    const dust = (t: number, n = 9, spread = 1) => {
      const v = (u - t) / 0.7;
      if (v < 0 || v > 1) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4, r = (m.r * 1.3 + v * 26 * spread), [px, py] = P(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r, 3 + v * 6);
        puff(px, py, (10 + 8 * v) * spread, 0.75 * (1 - v));
      }
    };
    // bits flying off: up and out from the boss, falling back, `col` coloured
    const bits = (t: number, n: number, col: string, size: number, speed = 1) => {
      const v = u - t;
      if (v < 0 || v > 0.9) return;
      c.globalAlpha = Math.max(0, 1 - v / 0.9);
      c.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const a = hr(i, 21) * Math.PI * 2, sp = (40 + 50 * hr(i, 22)) * speed, up = 70 + 60 * hr(i, 23);
        const [px, py] = P(m.x + Math.cos(a) * sp * v, m.y + Math.sin(a) * sp * v, Math.max(0, up * v - 160 * v * v) + 6);
        c.beginPath(); c.moveTo(px, py - size); c.lineTo(px + size * 0.6, py); c.lineTo(px, py + size); c.lineTo(px - size * 0.6, py); c.closePath(); c.fill();
      }
    };
    c.save();
    switch (k) {
      case 'king': dust(1.45, 10, 1.2); break;
      case 'ratswarm': dust(1.4, 7, 0.8); break;
      case 'pahan': dust(0.95, 8); break;
      case 'forgelord': {
        dust(1.05, 10, 1.2);
        bits(1.05, 18, '#ffb347', 1.6, 1.3);
        bits(1.08, 10, '#fff1a8', 1.2, 1.1);
        // steam from his ears, three puffs rising
        for (let n = 0; n < 3; n++) {
          const v = (u - 1.3 - n * 0.32) / 0.9;
          if (v < 0 || v > 1) continue;
          for (const side of [-1, 1]) puff(x + side * (6 + v * 6), top + 6 - v * 18, 9 + v * 8, 0.8 * (1 - v));
        }
        break;
      }
      case 'lich': bits(0.55, 16, '#dff6ff', 1.8); bits(0.6, 8, '#9fd8f5', 1.3); break;
      case 'fridge': {
        if (u >= 0.45 && u < 1.75) {
          // the light inside, cold white
          const a = Math.min(1, (u - 0.45) / 0.15) * Math.min(1, (1.75 - u) / 0.2), cy = (y + top) / 2, gr = c.createRadialGradient(x, cy, 2, x, cy, 46);
          gr.addColorStop(0, `rgba(230,250,255,${0.7 * a})`); gr.addColorStop(1, 'rgba(200,240,255,0)');
          c.globalCompositeOperation = 'lighter'; c.fillStyle = gr; c.fillRect(x - 46, cy - 46, 92, 92); c.globalCompositeOperation = 'source-over';
        }
        // food flies out of the open door, lands and bounces, and is gone
        const w = this.introWay!;
        ['sausage', 'drumstick', 'cutlet'].forEach((dish, n) => {
          const t0 = 0.6 + n * 0.17, v = (u - t0) / 0.6, food = env('food_' + dish);
          if (v < 0 || v > 2.2 || !food) return;
          const spread = (n - 1) * 0.7, dx = w.dx - w.dy * spread, dy = w.dy + w.dx * spread, L = Math.hypot(dx, dy), D = 26 + 12 * n;
          const f = Math.min(1, v), bounce = v > 1 ? Math.abs(Math.sin((v - 1) * Math.PI * 1.6)) * 5 * Math.exp(-(v - 1) * 2) : 0;
          const fx = m.x + (dx / L) * D * f, fy = m.y + (dy / L) * D * f, h = 22 * Math.sin(Math.PI * f) * (1 - f * 0.3) + 10 * (1 - f) + bounce;
          const [gx, gy] = P(fx, fy), [sx, sy] = P(fx, fy, h);
          c.globalAlpha = Math.min(1, (2.2 - v) / 0.4);
          ell(c, gx, gy, FOOD_W * 0.4, FOOD_W * 0.2); c.fillStyle = 'rgba(15,8,4,.3)'; c.fill();
          this.standee(food, sx, sy + FOOD_W * FOOD_RIM, FOOD_W);
        });
        break;
      }
      case 'dancer': {
        // a glint or two as he strikes his pose
        const v = (u - 1.65) / 0.6;
        if (v >= 0 && v < 1) for (let n = 0; n < 4; n++) {
          const sx = x + (hr(n, 31) - 0.5) * 40, sy = top + (hr(n, 32) - 0.2) * 30, r = 4 * Math.sin(Math.PI * Math.min(1, v * 1.4 - n * 0.1));
          if (r <= 0) continue;
          c.globalAlpha = 1; c.fillStyle = '#fff6c2';
          c.beginPath(); c.moveTo(sx, sy - r); c.lineTo(sx + r * 0.25, sy - r * 0.25); c.lineTo(sx + r, sy); c.lineTo(sx + r * 0.25, sy + r * 0.25); c.lineTo(sx, sy + r); c.lineTo(sx - r * 0.25, sy + r * 0.25); c.lineTo(sx - r, sy); c.lineTo(sx - r * 0.25, sy - r * 0.25); c.closePath(); c.fill();
        }
        break;
      }
      case 'discoball': {
        // the chain it is let down on, from above the screen
        const v = Math.min(1, Math.max(0, (u - 0.2) / 1.55)), e = 1 - (1 - v) ** 3, ty = y - 220 * (1 - e) - BASE_TH - MOB_TOP[m.k] + 6;
        c.globalAlpha = 1; c.strokeStyle = '#2a2622'; c.lineWidth = 1.6; c.setLineDash([2.2, 1.2]);
        c.beginPath(); c.moveTo(x, ty - 500); c.lineTo(x, ty); c.stroke(); c.setLineDash([]);
        dust(1.75, 7, 0.8);
        break;
      }
      case 'dragon': {
        // a cloud of smoke he shows through, and later the smoke ring he blows
        const v = Math.max(0, u - 0.2);
        if (v < 2.2) for (let n = 0; n < 11; n++) {
          const a0 = n * 2.39, r0 = 6 + (n % 3) * 5, w = Math.min(1, v / 0.4), fade = Math.max(0, 1 - Math.max(0, v - 0.9) / 1.3);
          const px = x + Math.cos(a0) * (r0 + v * 14), py = y - 14 - Math.sin(a0) * (r0 * 0.6 + v * 6) - v * 10 * (n % 2);
          puff(px, py, (16 + (n % 4) * 5) * w * (1 + v * 0.35), 0.85 * fade);
        }
        const r = (u - 1.75) / 0.85;
        if (r >= 0 && r < 1) {
          const sp = sprites.get(m.k), mouthX = x + (sp?.facing === 'left' ? -1 : 1) * 6;
          c.globalAlpha = 0.85 * (1 - r); c.strokeStyle = '#d8d2c8'; c.lineWidth = 2.6 * (1 - r) + 0.8;
          ell(c, mouthX, top + 4 - r * 26, 3 + r * 9, 1.6 + r * 4); c.stroke();
        }
        break;
      }
    }
    c.restore();
  }
}
