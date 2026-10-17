// Draws one frame of a room: walls, floor, obstacles, resources, discs and miniatures.
// Everything is drawn in iso space through the camera, so zoom and rotation are free.

import { WALL_WORDS, HERO_BASE, HERO_FIG, INK, ENEMY_BASE, MOBS, WALL_H, TILE, mobSize } from '../data';
import type { Camera, Vec } from '../camera';
import { type Disc, type Game, type HeroState, type Spark } from '../game';
import { cellAt, floorAt, hazKey, isFloor, pitAt, type Block, type Decal, type Edge, type Mob, type Pit, type ResNode } from '../room';
import { BASE_TH, MOB_TOP, drawHeroFigure, drawMiniature, drawMobFigure } from './figures';
import { circ, ell, fs, mix, pth, rr, type Ctx, type Pt } from './util';
import { GRAFFITI_FONTS, envArt } from '../assets';
import { settings } from '../settings';
import { fx, knockPose, topplePose, type ChipTo, type Knock, type Pose } from '../fx';

export interface Aim { hero: HeroState; dx: number; dy: number }
/** A hero dragged to another rune: pointer position in screen pixels and the rune under it. */
export interface Carry { hero: HeroState; x: number; y: number; pad: number | null; moved: boolean }


const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Room art from the manifest; anything missing is drawn by code in the same cartoon look. */
const env = (k: string) => envArt.get(k);

/** Cartoon look: silhouette and detail ink widths, in iso units. */
const OL = 2.1, DL = 1.1;
/** How deep the walls of a hole in the floor show before the dark swallows them. */
const PIT_D = 30;
/** Ink on stone blocks: thinner than the room's silhouette, so a block doesn't look cut out of the floor. */
const BL = 1.2;
/** Whether the graffiti fonts have loaded; words drawn before that use a fallback face and are drawn again. */
const fontsReady = () => typeof document === 'undefined' || !document.fonts || GRAFFITI_FONTS.every(f => document.fonts.check(f, 'WЖ'));
/** At most this many gags on the walls of one room, so each stays a find rather than wallpaper. */
const MAX_GAGS = 4;
/** Chalk white, for words and doodles on the walls. */
const CHALK = '#efeadf';
/** A gag on a wall line: world coordinate of its middle along the wall, height of its middle, height, and what it shows. */
interface WallGag { u: number; h: number; size: number; doodle?: string; word?: string; font?: string; tilt: number; flip?: boolean }
/** The four sides of a cell: neighbour offset, then the side's two corners in cell units. */
const SIDES: [number, number, number, number, number, number][] = [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]];
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
  private bgCss = '';
  private glow: { key: string; img: HTMLCanvasElement } | null = null;

  private P = (x: number, y: number, h = 0): Pt => this.cam.iso(x, y, h);
  private get bk() { return this.g.S.biome.art; }

  /**
   * A chip has popped out and now flies into its counter, from (x, y) in canvas pixels: the page flies it over the
   * frame, which covers the field.
   */
  onFly: (to: ChipTo, x: number, y: number) => void = () => {};
  private flown = new Set<number>();

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
    this.c = c; this.cam = cam; this.g = g; this.t = t;
    const S = g.S, { w, h, dpr } = view;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the backdrop gradient and the vignette live in CSS: full-screen gradients every frame are what made phones crawl
    c.clearRect(0, 0, w, h);
    const bgCss = `radial-gradient(ellipse at 50% 50%, ${S.biome.bg[0]}, ${S.biome.bg[1]} 75%)`;
    if (this.bgCss !== bgCss) { c.canvas.style.background = bgCss; this.bgCss = bgCss; }

    let sx = 0, sy = 0;
    if (S.shake > 0 && !reduce) { sx = (Math.random() - 0.5) * 6; sy = (Math.random() - 0.5) * 4; }
    const z = cam.zoom;
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cam.panX + sx), dpr * (cam.panY + sy));
    c.lineJoin = 'round';

    this.pickDecor();
    this.drawLips();
    this.drawFloor();

    const items: [number, () => void][] = [];
    for (const d of S.discs) if (!d.gone) items.push([cam.depth(d.x, d.y), () => this.drawDisc(d)]);
    for (const hs of S.heroes) { const p = g.figureAt(hs); if (p) items.push([cam.depth(p.x, p.y) + 2, () => this.drawHero(hs)]); }
    const cr = this.carry;
    if (cr) {
      const [wx, wy] = cam.screenToWorld(cr.x, cr.y);
      items.push([cam.depth(wx, wy) + 2, () => this.drawHero(cr.hero, { x: wx, y: wy })]);
    }
    for (const m of S.mobs) if (m.dead <= 1) items.push([cam.depth(m.x, m.y), () => this.drawMob(m)]);
    for (const b of S.blocks) items.push([cam.depth(b.x0 + 8, b.y0 + 8), () => this.drawBlock(b)]);
    for (const n of S.nodes) items.push([cam.depth(n.x, n.y), () => this.drawNode(n)]);
    for (const p of S.sparks) if (p.k && !(p.to && p.t >= p.hang!)) items.push([cam.depth(p.x, p.y) + 0.5, () => this.drawChip(p)]);
    this.wallItems(items);
    this.decorItems(items);
    items.sort((a, b) => a[0] - b[0]).forEach(i => i[1]());

    this.drawOmens();
    this.drawAim(aim);
    this.drawFx();

  }

  // ------------------------------------------------------------ room shell

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

  /** Gag props replace a couple of floor decals that sit clear of runes, enemies and resources. */
  private decor = new Map<Decal, string>();
  private pickDecor() {
    const S = this.g.S, bk = this.bk;
    this.decor.clear();
    const want: [number, string][] = bk === 'prison' ? [[0, 'bucket'], [2, 'bones_bra']] : bk === 'forge' ? [[0, 'anvil'], [2, 'bones_bra']] : [[2, 'bones_bra']];
    for (const [k, key] of want) {
      if (!env(key)) continue;
      const dc = S.decals.find(d => d.k === k && !this.decor.has(d)
        && [...S.pads, ...S.mobs, ...S.nodes].every(o => Math.hypot(o.x - d.x, o.y - d.y) > 14)
        && S.blocks.every(b => d.x < b.x0 - 6 || d.x > b.x1 + 6 || d.y < b.y0 - 6 || d.y > b.y1 + 6));
      if (dc) this.decor.set(dc, key);
    }
  }

  private decorItems(items: [number, () => void][]) {
    for (const [d, key] of this.decor) {
      const im = env(key)!;
      items.push([this.cam.depth(d.x, d.y), () => { const [x, y] = this.P(d.x, d.y); this.standee(im, x, y + 2, key === 'bones_bra' ? 13 : 14); }]);
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
    // ice patches: whole tiles glazed over, joints hidden under the ice, a glint that drifts across
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
      c.strokeStyle = 'rgba(255,255,255,.75)';
      c.lineWidth = 0.8;
      c.beginPath();
      for (const [i, j] of iced) {
        const ph = reduce ? 0.5 : (t * 0.15 + (i + j) * 0.09) % 1;
        if ((i * 3 + j * 7) % 3) continue;
        const u = 3 + ph * 8;
        c.moveTo(...P(i * TILE + u, j * TILE + 4)); c.lineTo(...P(i * TILE + u + 4, j * TILE + 8));
      }
      c.stroke();
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
    for (const dc of S.decals) {
      if (this.decor.has(dc)) continue;
      const [dx, dy] = P(dc.x, dc.y);
      if (dc.k === 0) { ell(c, dx, dy, 7, 3); c.fillStyle = 'rgba(25,15,10,.22)'; c.fill(); }
      else if (dc.k === 1) { c.strokeStyle = INK; c.lineWidth = 0.9; c.beginPath(); c.moveTo(dx - 5, dy); c.lineTo(dx - 1, dy + 1.5); c.lineTo(dx + 1, dy - 1); c.lineTo(dx + 5, dy + 0.5); c.stroke(); }
      else {
        // a cartoon bone: knobs first, then the shaft over them, one inked outline each
        c.save(); c.translate(dx, dy); c.rotate(dc.a + this.cam.rot); c.scale(1.2, 1.2);
        for (const [bx, by] of [[-4, -1], [-4, 1], [4, -1], [4, 1]]) { circ(c, bx, by, 1.3); fs(c, '#efe6cc', 0.8); }
        rr(c, -4, -0.9, 8, 1.8, 0.9); c.fillStyle = '#efe6cc'; c.fill();
        c.strokeStyle = INK; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-3, -0.9); c.lineTo(3, -0.9); c.moveTo(-3, 0.9); c.lineTo(3, 0.9); c.stroke();
        c.restore();
      }
    }
    // a spent resource leaves only a flat scatter of chips on its cell, not something to bounce off
    for (const n of S.nodes) {
      if (n.left > 0) continue;
      const [dx, dy] = P(n.x, n.y);
      ell(c, dx, dy, 9, 4.2); c.fillStyle = 'rgba(25,15,10,.18)'; c.fill();
      const tint = n.k === 'ore' ? '#e8b44a' : n.k === 'spk' ? '#a98ae8' : '#c9584a';
      const chips: [number, number, number, boolean][] = [[-4, -1, 1.4, false], [3, -3, 1.1, true], [1, 2.5, 1.3, false], [-2, 3.5, 0.9, true], [5, 2, 1, false], [-5, 2, 0.8, true]];
      for (const [ox, oy, r, tinted] of chips) {
        const [x, y] = P(n.x + ox, n.y + oy);
        pth(c, [[x - r * 1.4, y], [x, y - r * 0.6], [x + r * 1.4, y], [x, y + r * 0.6]]);
        c.fillStyle = tinted ? tint : 'rgba(120,110,104,.85)';
        c.fill();
      }
    }
    // the cells enemies and resources stand on are shaded like a square on a board; enemies get a red rim
    c.beginPath();
    for (const n of S.nodes) if (n.left > 0) { const [i, j] = cellAt(n.x, n.y); inner(i, j); }
    for (const m of S.mobs) if (m.hp > 0) { const s = mobSize(m.k), [i, j] = cellAt(m.tx, m.ty, s); quad(i * TILE + gap, j * TILE + gap, (i + s) * TILE - gap, (j + s) * TILE - gap); }
    c.fillStyle = 'rgba(25,15,10,.2)';
    c.fill();
    c.beginPath();
    for (const m of S.mobs) if (m.hp > 0) { const s = mobSize(m.k), [i, j] = cellAt(m.tx, m.ty, s); quad(i * TILE + 1.6, j * TILE + 1.6, (i + s) * TILE - 1.6, (j + s) * TILE - 1.6); }
    c.strokeStyle = 'rgba(184,50,63,.55)';
    c.lineWidth = 0.9;
    c.stroke();
    c.strokeStyle = INK;
    c.lineWidth = OL;
    c.beginPath();
    for (const e of S.edges) { c.moveTo(...P(...e.a)); c.lineTo(...P(...e.b)); }
    c.stroke();
    for (const p of S.pits) this.drawPit(p);
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

  /** The opening of a hole in the floor, on screen. */
  private mouth(p: Pit): Pt[] {
    const P = this.P, x0 = p.i * TILE, y0 = p.j * TILE, x1 = x0 + p.s * TILE, y1 = y0 + p.s * TILE;
    return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  }

  /**
   * A square hole in the floor: the far walls of the shaft, in the room's own masonry, sink into the dark in flat bands,
   * and the opening is inked like the edge of the room. A bigger hole shows more of the black below.
   */
  private drawPit(p: Pit) {
    const { c, P, cam } = this;
    const B = this.g.S.biome, D = PIT_D, mouth = this.mouth(p), wt = env(`wall_${this.bk}`);
    const x0 = p.i * TILE, y0 = p.j * TILE, x1 = x0 + p.s * TILE, y1 = y0 + p.s * TILE;
    c.save();
    pth(c, mouth);
    c.fillStyle = '#070403';
    c.fill();
    c.clip();
    // each side's face, turned into the hole; only the ones looking at the viewer show
    const all: { a: Vec; b: Vec; n: Vec }[] = [
      { a: [x0, y0], b: [x1, y0], n: [0, 1] }, { a: [x1, y0], b: [x1, y1], n: [-1, 0] },
      { a: [x0, y1], b: [x1, y1], n: [0, -1] }, { a: [x0, y0], b: [x0, y1], n: [1, 0] },
    ];
    const sides = all.filter(f => cam.facing(f.n[0], f.n[1]) > 1e-6);
    for (const f of sides) {
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
    // the far corner where two walls meet, inked down into the dark
    const ends = sides.flatMap(f => [f.a, f.b]), corner = ends.find((v, k) => ends.findIndex(o => o[0] === v[0] && o[1] === v[1]) !== k);
    if (corner) {
      c.beginPath(); c.moveTo(...P(...corner)); c.lineTo(...P(...corner, -12));
      c.strokeStyle = INK; c.lineWidth = DL; c.stroke();
    }
    c.restore();
    pth(c, mouth);
    c.strokeStyle = INK;
    c.lineWidth = OL;
    c.stroke();
  }

  /** Glowing summon circles and tiles about to turn to lava, a turn ahead; drawn over the figures so nothing hides them. */
  private drawOmens() {
    const { c, P, g } = this;
    const S = g.S;
    if (S.phase === 'over') return;
    const pulse = reduce ? 0.7 : 0.55 + 0.35 * Math.sin(this.t * 4);
    for (const m of g.liveMobs()) {
      const it = m.intent;
      // gone once that enemy has made its move: the mob has risen, the floor has turned to lava
      if (!it?.spots || g.acted(m)) continue;
      for (const p of it.spots) {
        if (it.t === 'summon') {
          const r = MOBS[MOBS[m.k].acts!.find(a => a.k === 'summon')!.kind!].r + 3, [x, y] = P(p.x, p.y);
          ell(c, x, y, r * 1.27, r * 0.64);
          c.fillStyle = `rgba(150,110,255,${0.3 * pulse})`; c.fill();
          c.strokeStyle = `rgba(200,170,255,${pulse})`; c.lineWidth = 1.6; c.stroke();
          ell(c, x, y, r * 0.8, r * 0.4);
          c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]);
        } else {
          const x0 = p.x - 7, y0 = p.y - 7, x1 = p.x + 7, y1 = p.y + 7;
          pth(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
          c.fillStyle = `rgba(255,120,40,${0.35 * pulse})`; c.fill();
          c.strokeStyle = `rgba(255,170,70,${pulse})`; c.lineWidth = 1; c.stroke();
        }
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
  private drawNodeShape(n: ResNode, left: number, f: boolean) {
    const c = this.c, [x, y] = this.P(n.x, n.y), q = left / n.ch;
    const ni = env(n.k === 'ore' ? 'ore' : n.k === 'spk' ? 'crystal' : 'mushrooms');
    if (ni) { this.standee(ni, x, y + 3, (n.k === 'ore' ? 21 : n.k === 'spk' ? 15.5 : 19) * (0.6 + 0.4 * q), f); return; }
    const W = (col: string) => (f ? '#ffffff' : col);
    c.lineJoin = 'round';
    if (n.k === 'ore') {
      const s = 0.75 + 0.25 * q;
      const lump: [number, number][] = [[-9, 0], [-9.5, -5], [-6.5, -10], [-2, -12.5], [3, -11.5], [7, -8.5], [9.5, -3.5], [8.5, 1], [3, 3], [-4, 3]];
      const pts = lump.map(([px, py]) => [x + px * s, y + py * s] as Pt);
      const path = () => { c.beginPath(); pts.forEach((p, k) => { const nx = pts[(k + 1) % pts.length]; const mx = (p[0] + nx[0]) / 2, my = (p[1] + nx[1]) / 2; if (!k) c.moveTo(mx, my); else c.quadraticCurveTo(p[0], p[1], mx, my); }); const p0 = pts[0], p1 = pts[1]; c.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); c.closePath(); };
      path(); c.fillStyle = W('#948c80'); c.fill();
      c.save(); path(); c.clip();
      ell(c, x + 6 * s, y - 2 * s, 9 * s, 8 * s); c.fillStyle = W('#6a635a'); c.fill();
      ell(c, x - 4 * s, y - 9 * s, 4 * s, 2 * s); c.fillStyle = W('#b3ab9f'); c.fill();
      c.restore();
      path(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
      const nug: [number, number, number][] = [[-5, -5, 1.5], [1, -8, 1.2], [4, -3, 1.6], [-1, -1, 1.1], [6.5, -7, 1], [-6.5, -9, 1]];
      for (const [ox, oy, r] of nug.slice(0, Math.max(2, Math.round(nug.length * q)))) {
        const gx = x + ox * s, gy = y + oy * s, t = r * 1.3;
        pth(c, [[gx - 1.4 * t, gy + 0.3 * t], [gx - 0.5 * t, gy - 1.1 * t], [gx + 1.3 * t, gy - 0.6 * t], [gx + 1 * t, gy + 0.9 * t], [gx - 0.6 * t, gy + 1.1 * t]]);
        fs(c, W('#f2b83c'), 0.8);
        circ(c, gx - 0.3 * t, gy - 0.3 * t, 0.4 * t); c.fillStyle = '#fff3c4'; c.fill();
      }
    } else if (n.k === 'spk') {
      // a little rock, then up to three crystals: a lit left face and a shaded right face, inked
      ell(c, x, y - 1, 7.5, 3.2); fs(c, W('#7d766c'), 1.2);
      const cr: [number, number, number, number][] = [[-4, -1, 10, -0.35], [4, -1, 9, 0.3], [0, 0, 15, 0.05]];
      for (const [ox, oy, L0, lean] of [cr[2], cr[0], cr[1]].slice(0, left).sort((a, b) => a[1] - b[1])) {
        const L = L0 * (0.75 + 0.25 * q), bx = x + ox, by = y + oy - 1, w = 2.6;
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
      for (const [ox, oy, s] of sh.slice(0, left === n.ch ? 3 : left)) {
        const mx = x + ox, my = y + oy;
        rr(c, mx - 1.6 * s, my - 6 * s, 3.2 * s, 6 * s, 1.2 * s); fs(c, W('#f1e7d0'), 1);
        c.beginPath(); c.ellipse(mx, my - 6 * s, 5.2 * s, 5 * s, 0, Math.PI, 0); c.quadraticCurveTo(mx, my - 4 * s, mx - 5.2 * s, my - 6 * s); c.closePath();
        fs(c, W('#d24c3a'), 1.2);
        for (const [sx, sy, r] of [[-2.2, -8.5, 1], [1.6, -9.5, 0.8], [3.2, -7, 0.6], [-0.2, -10.6, 0.55]]) { ell(c, mx + sx * s, my + sy * s, r * s * 1.1, r * s); fs(c, W('#fbf3e0'), 0.6); }
      }
    }
  }

  private drawNode(n: ResNode) {
    // a spent node is drawn with the floor
    if (n.left <= 0) return;
    const { c, P } = this;
    ell(c, ...P(n.x + 1.5, n.y + 1.5), 11, 5.5); c.fillStyle = 'rgba(15,8,4,.35)'; c.fill();
    // a struck resource jolts: squashed and shaken for a moment
    const f = n.hit > 0 && !reduce ? n.hit / 0.2 : 0;
    if (f) {
      const [x, y] = P(n.x, n.y);
      c.save();
      c.translate(x + Math.sin(f * 19) * 1.4 * f, y);
      c.scale(1 + 0.1 * f, 1 - 0.14 * f);
      c.translate(-x, -y);
    }
    this.drawNodeShape(n, Math.min(n.left, n.ch), n.hit > 0);
    if (f) c.restore();
  }

  private drawDisc(d: Disc) {
    const hole = d.fall ? pitAt(this.g.S.pits, d.x, d.y) : undefined;
    if (!hole) return this.drawPuck(d);
    // a disc going down a hole sinks behind its near rim
    this.c.save();
    pth(this.c, this.mouth(hole));
    this.c.clip();
    this.drawPuck(d);
    this.c.restore();
  }

  private drawPuck(d: Disc) {
    const { c, P } = this;
    let s = 1, hh = 0;
    if (d.fall) { s = Math.max(0, 1 - d.fall * 2); hh = -d.fall * 20; }
    if (s <= 0) return;
    const col = d.hero.def.col, dk = d.hero.def.dk;
    const rx = d.r * 1.35 * s, ry = d.r * 0.68 * s, th = 3.4 * s, [x, y] = P(d.x, d.y, hh);
    if (!d.fall) { ell(c, x + 1, y + 1.5, rx + 0.5, ry + 0.5); c.fillStyle = 'rgba(20,10,5,.35)'; c.fill(); }
    // a fat puck: dark rim band, flat enamel top, a raised ring and the hero's emblem, all inked
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI); c.lineTo(x - rx, y - th); c.ellipse(x, y - th, rx, ry, 0, Math.PI, 0, true); c.closePath(); fs(c, dk, 1.5);
    const di = env(`disc_${d.hero.def.key}`);
    if (di) {
      c.save(); c.translate(x, y - th); c.scale(1, ry / rx); c.rotate(d.spin); c.drawImage(di, -rx * 1.04, -rx * 1.04, rx * 2.08, rx * 2.08); c.restore();
      this.discGlow(d, x, y - th, rx, ry);
      return;
    }
    ell(c, x, y - th, rx, ry); fs(c, col, 1.5);
    ell(c, x, y - th, rx * 0.62, ry * 0.62); fs(c, mix(col, '#ffffff', 0.18), 0.9);
    c.save(); c.translate(x, y - th); c.scale(1, 0.5); c.rotate(d.spin); c.fillStyle = '#f6efe0'; c.strokeStyle = INK; c.lineWidth = 1.4;
    if (d.hero.i === 0) { c.beginPath(); for (const [a, b] of [[-0.12, -0.38], [0.12, -0.38], [0.12, -0.12], [0.38, -0.12], [0.38, 0.12], [0.12, 0.12], [0.12, 0.38], [-0.12, 0.38], [-0.12, 0.12], [-0.38, 0.12], [-0.38, -0.12], [-0.12, -0.12]]) c.lineTo(a * rx * 1.4, b * rx * 1.4); c.closePath(); c.stroke(); c.fill(); }
    else if (d.hero.i === 1) { c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 1.571; c.lineTo(Math.cos(a) * rx * 0.48, Math.sin(a) * rx * 0.48); c.lineTo(Math.cos(a + 0.785) * rx * 0.15, Math.sin(a + 0.785) * rx * 0.15); } c.closePath(); c.stroke(); c.fill(); }
    else { c.beginPath(); c.moveTo(0, -rx * 0.42); c.quadraticCurveTo(rx * 0.36, -rx * 0.05, rx * 0.2, rx * 0.3); c.quadraticCurveTo(0, rx * 0.42, -rx * 0.2, rx * 0.3); c.quadraticCurveTo(-rx * 0.36, -rx * 0.05, 0, -rx * 0.42); c.closePath(); c.stroke(); c.fill(); }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1.1; c.beginPath(); c.ellipse(x, y - th, rx * 0.8, ry * 0.74, 0, Math.PI * 1.1, Math.PI * 1.42); c.stroke();
    this.discGlow(d, x, y - th, rx, ry);
  }

  /** Rings over a disc's top: the hero's ability colour while it carries the ability, violet while charged by a clash. */
  private discGlow(d: Disc, x: number, y: number, rx: number, ry: number) {
    const { c } = this;
    // Ricochet's disc glows only while it still has sure bounces
    if (d.ab && !d.fall && (d.hero.def.key !== 'ricochet' || d.rico > 0)) {
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
    const target = g.liveMobs()[0] ?? { x: S.Wx / 2, y: S.Wy / 2 };
    if (lifted) { ell(c, sx, sy0, HERO_BASE * 1.27, HERO_BASE * 0.64); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); }
    drawMiniature(c, {
      key: h.def.key, x: sx, y: sy, baseR: HERO_BASE, baseCol: h.def.col, fig: HERO_FIG,
      faceRight: this.faceRight(p.x, p.y, target.x, target.y), flash: h.flash > 0, hop: at ? 0 : g.figureAt(h)!.lift,
      alpha: dead ? 0.45 : carried ? 0.3 : lifted ? 0.85 : 1,
      hp: dead || carried ? undefined : { now: h.hp, max: h.max },
      pose: lifted ? undefined : this.pose(h.knock, p.x, p.y, HERO_BASE),
      placeholder: (cc, x, y, fl) => drawHeroFigure(cc, h.i, x, y, 0.8, fl, this.t),
    });
    if (dead || carried) return;
    const top = sy - BASE_TH - HERO_FIG - 6;
    if (h.shield > 0) {
      // shield badge on the right of the stand
      const bx = sx + 12, by = sy - 6;
      c.beginPath(); c.moveTo(bx - 2.5, by - 3); c.lineTo(bx + 2.5, by - 3); c.lineTo(bx + 2.5, by);
      c.quadraticCurveTo(bx + 2.5, by + 2.5, bx, by + 3.5); c.quadraticCurveTo(bx - 2.5, by + 2.5, bx - 2.5, by); c.closePath();
      fs(c, '#3fc4b6', 0.8);
    }
    if (h.chill > 0 || h.fire > 0) {
      c.font = '600 6.5px Oswald, sans-serif'; c.textAlign = 'right';
      c.fillStyle = h.chill > 0 ? '#bfe6ff' : '#ff9a5c';
      c.fillText(h.chill > 0 && h.fire > 0 ? 'озноб, горит' : h.chill > 0 ? 'озноб' : 'горит', sx - 11, top + 1);
    }
    if (g.hero === h && S.phase !== 'over') {
      const yy = top - 7 - (reduce ? 0 : Math.sin(this.t * 6) * 1.2);
      pth(c, [[sx - 3, yy - 3], [sx + 3, yy - 3], [sx, yy + 1]]);
      fs(c, '#ffd34d', 0.8);
    }
  }

  private drawMob(m: Mob) {
    const { c, P, g } = this;
    const S = g.S, [x, y] = P(m.x, m.y);
    const it = m.intent, th = it ? g.heroOf(it.hero) : null, tgt = (th && g.spot(th)) ?? { x: S.Wx, y: S.Wy };
    let pose = this.pose(m.knock, m.x, m.y, m.r), alpha = m.dead ? Math.max(0, 1 - m.dead) : (1 - (m.born ?? 0)) * (m.hp > 0 && !g.solid(m) ? 0.35 : 1);
    if (m.dead && fx.topple && !reduce) {
      // beaten, it topples over away from the blow, lies a moment and fades
      const k = m.knock, side = (k && Math.sign(this.onScreen(m.x, m.y, k.x, k.y)[0])) || 1;
      pose = topplePose(m.dead, side, m.r * 1.27);
      alpha = Math.min(1, Math.max(0, (1 - m.dead) / 0.4));
    }
    drawMiniature(c, {
      key: m.k, x, y, baseR: m.r, baseCol: ENEMY_BASE, fig: MOBS[m.k].fig,
      faceRight: this.faceRight(m.x, m.y, tgt.x, tgt.y), flash: m.flash > 0, hop: m.hop,
      alpha,
      hp: m.hp > 0 ? { now: m.hp, max: m.max } : undefined,
      pose,
      placeholder: (cc, fx, fy, fl) => drawMobFigure(cc, m.k, fx, fy, fl),
    });
    if (m.hp <= 0) return;
    const top = y - m.hop - BASE_TH - MOB_TOP[m.k];
    if (m.burn > 0) {
      // the more fire piled on, the more tongues of flame, and the number says what it burns off next move
      const n = Math.min(5, 2 + Math.floor(m.burn / 3));
      for (let k = 0; k < n; k++) {
        const ph = (this.t * 1.5 + k / n) % 1, fx = x - (n - 1) * 2.5 + k * 5, fy = top + 14 - ph * 8;
        c.beginPath(); c.moveTo(fx, fy - 4); c.quadraticCurveTo(fx + 2, fy, fx, fy + 1); c.quadraticCurveTo(fx - 2, fy, fx, fy - 4);
        c.fillStyle = `rgba(255,140,60,${1 - ph})`; c.fill();
      }
      c.font = '700 7px Oswald, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#ffb070';
      c.strokeStyle = INK; c.lineWidth = 2; c.strokeText(String(m.burn), x + n * 2.5 + 2, top + 13); c.fillText(String(m.burn), x + n * 2.5 + 2, top + 13);
    }
    if (m.armor) { c.font = '600 6px Oswald, sans-serif'; c.textAlign = 'right'; c.fillStyle = '#d6cfbd'; c.fillText('бр ' + m.armor, x - m.r * 1.27 - 2, y - m.hop - 1); }
    if (!g.solid(m) && m.hp > 0 && S.phase !== 'over') {
      c.font = '600 6px Oswald, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#d9f2ff';
      c.fillText('бесплотен', x, y + m.r * 0.64 + 8);
    }
  }

  // ------------------------------------------------------------ aim & effects

  private drawAim(aim: Aim | null) {
    if (!aim) return;
    const { c, P, g } = this;
    const h = aim.hero, p = g.spot(h), len = Math.hypot(aim.dx, aim.dy);
    if (!p || len < 4) return;
    // one straight line up to the first wall, block or mob; ricochets are left for the player to judge
    const pr = g.predict(h, aim.dx, aim.dy, 0);
    if (pr.path.length < 2 || !settings.aimLine) return;
    // thick enough to read on a phone at any zoom: at least ~4 screen pixels
    const lw = Math.max(2.4, 4 / this.cam.zoom);
    const [x0, y0] = P(...pr.path[0], 2), [x1, y1] = P(...pr.path[pr.path.length - 1], 2);
    c.save();
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.strokeStyle = INK;
    c.lineWidth = lw + 2.2;
    c.stroke();
    c.setLineDash([lw * 2.2, lw * 1.4]);
    c.lineDashOffset = reduce ? 0 : -this.t * 20;
    c.strokeStyle = h.def.col;
    c.lineWidth = lw;
    c.stroke();
    c.setLineDash([]);
    c.restore();
    const [px, py] = P(p.x, p.y), pw = Math.round((len / 60) * 5);
    for (let k = 0; k < 5; k++) { rr(c, px - 11 + k * 4.6, py + 7, 3.6, 2.6, 1); fs(c, k < pw ? h.def.col : '#2a1f18', 0.6); }
  }

  /** A chip of ore, crystal, mushroom or ice, tumbling, with its shadow on the floor; it fades at the end of its life. */
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
    const prism = (L: number, w: number) => {
      // a crystal: a lit left face, a shaded right face, a pointed tip
      pth(c, [[-w * s, L * s], [-w * s, (-L + w * 1.4) * s], [0, -L * s], [0, L * s]]); c.fillStyle = '#c6b2f4'; c.fill();
      pth(c, [[0, L * s], [0, -L * s], [w * s, (-L + w * 1.4) * s], [w * s, L * s]]); c.fillStyle = '#7650d6'; c.fill();
      pth(c, [[-w * s, L * s], [-w * s, (-L + w * 1.4) * s], [0, -L * s], [w * s, (-L + w * 1.4) * s], [w * s, L * s]]);
      c.strokeStyle = INK; c.lineWidth = lw; c.stroke();
      c.lineWidth = lw * 0.6; c.beginPath(); c.moveTo(0, L * s); c.lineTo(0, -L * s); c.stroke();
    };
    const cap = (r: number, dy: number) => {
      c.beginPath(); c.ellipse(0, dy * s, r * s, r * 0.85 * s, 0, Math.PI, 0); c.quadraticCurveTo(0, (dy + 0.35 * r) * s, -r * s, dy * s); c.closePath();
      fs(c, '#d24c3a', lw);
      ell(c, -0.3 * r * s, (dy - 0.45 * r) * s, 0.2 * r * s, 0.17 * r * s); fs(c, '#fbf3e0', lw * 0.6);
      ell(c, 0.35 * r * s, (dy - 0.3 * r) * s, 0.14 * r * s, 0.12 * r * s); fs(c, '#fbf3e0', lw * 0.6);
    };
    switch (p.k) {
      case 'ore': rock('#948c80', '#6a635a'); break;
      case 'lump': rock('#948c80', '#6a635a'); nug(-0.35, -0.2, 0.5); nug(0.3, 0.35, 0.4); break;
      case 'gold': nug(0, 0, 1.6); break;
      case 'spk': poly([[-0.35, 0.9], [-0.35, -0.4], [0, -1.1], [0.35, -0.4], [0.35, 0.9]], '#a98ae8'); break;
      case 'crystal': prism(1.2, 0.45); break;
      case 'cap': cap(1, 0.4); break;
      case 'stem': rr(c, -0.35 * s, -0.8 * s, 0.7 * s, 1.6 * s, 0.3 * s); fs(c, '#f1e7d0', lw); break;
      case 'shroom': rr(c, -0.3 * s, -0.4 * s, 0.6 * s, 1.3 * s, 0.25 * s); fs(c, '#f1e7d0', lw); cap(0.95, -0.3); break;
      case 'ice': poly([[-0.4, 0.8], [-0.2, -0.9], [0.5, 0.3]], '#d8f2ff'); break;
    }
    c.restore();
  }

  private drawFx() {
    const { c, P } = this;
    const S = this.g.S;
    for (const p of S.sparks) {
      if (!p.to || p.t < p.hang! || this.flown.has(p.id!)) continue;
      if (this.flown.size > 200) this.flown.clear();
      this.flown.add(p.id!);
      const [x, y] = P(p.x, p.y, p.h), cam = this.cam;
      this.onFly(p.to, x * cam.zoom + cam.panX, y * cam.zoom + cam.panY);
    }
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
}
