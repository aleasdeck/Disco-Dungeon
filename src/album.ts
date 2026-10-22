// The run's photo album for its end screen (src/albumview.ts): the party photo the run began with (ДО), a photo for every
// floor boss the party beat, the boss's hoard scene from the trophy window with the heroes' heads stuck in, and the party
// as the run left it (ПОСЛЕ) on the first photo's backdrop: beaten by the health they were left with, wearing their
// trophies, the fallen lying in chalk outlines. All of it is drawn from the game's own pictures.

import { BIOMES, HEROES, MOBS, type MobKind } from './data';
import { envArt, eventArt, sprites, uiArt } from './assets';
import { BACKDROPS, BACKDROP_COUNT, PHOTO, SPOTS, arrow, artOf, drawPhoto, finish, inLight, lightOf, marker, tallOf } from './photo';
import type { Tally } from './game';

type Pt = [number, number];
type Look = 'left' | 'right';

/** A floor boss the party beat, and each hero's health as it fell (before the boss gave half of it back). */
export interface Shot { boss: string; heroes: { i: number; hp: number; max: number }[] }

/** The party photo of the pick screen: its backdrop, the heroes in their places from the left, online the players' names. */
export interface StartPhoto { bg: number; heroes: number[]; names?: string[]; host?: number }

/** What the end screen shows: made by the host as the run ends and sent to every player with the result. */
export interface Album {
  win: boolean;
  /** The floor the run ended on, 0 to 2. */
  floor: number;
  /** The boss that beat the party, if the party fell in a boss's room. */
  boss?: string;
  photo: StartPhoto;
  /** The floors' bosses the party beat, floor by floor. */
  shots: Shot[];
  /** The party as the run left it: its health (after a win, as the last boss fell), its trophies and numbers. */
  heroes: { i: number; hp: number; max: number; arts: string[]; t: Tally }[];
  rooms: number;
  /** Seconds the host spent in the run. */
  time: number;
  /** When the run ended, in ms: the prints' date. */
  at: number;
}

/** How beaten a hero looks by the part of its health left: 0 whole, 1 knocked about, 2 barely alive, 3 fallen. */
export const stateOf = (hp: number, max: number) => (hp <= 0 ? 3 : hp >= max * 0.7 ? 0 : hp >= max * 0.35 ? 1 : 2);

// ---------------------------------------------------------------- where things are on each hero's picture

interface Body {
  /** The face's middle and its radius (of the picture's height). */
  head: [number, number, number];
  eyes: [Pt, Pt];
  mouth: Pt;
  neck: Pt;
  chest: Pt;
  hips: Pt;
  hands: [Pt, Pt];
  /**
   * The head cut out as a sticker: inside `box`, below the middle of `face` only inside its ellipse (the chin, not the
   * shoulders), and inside `round` where the head touches something cut straight (a shield, the picture's edge).
   */
  cut: { box: [number, number, number, number]; face: [number, number, number, number]; round?: [number, number, number, number] };
}

/** As fractions of the hero's picture trimmed to what is drawn on it, the hero facing its own way (Sprite.facing). */
const BODY: Record<string, Body> = {
  bastion: {
    head: [0.415, 0.22, 0.15], eyes: [[0.3, 0.195], [0.44, 0.205]], mouth: [0.37, 0.3], neck: [0.42, 0.37], chest: [0.4, 0.45], hips: [0.37, 0.68], hands: [[0.07, 0.6], [0.66, 0.5]],
    cut: { box: [0.17, 0.04, 0.6, 0.4], face: [0.4, 0.22, 0.22, 0.15], round: [0.39, 0.21, 0.215, 0.19] },
  },
  ricochet: {
    head: [0.44, 0.2, 0.11], eyes: [[0.378, 0.19], [0.507, 0.185]], mouth: [0.447, 0.27], neck: [0.45, 0.35], chest: [0.47, 0.48], hips: [0.45, 0.64], hands: [[0.08, 0.36], [0.86, 0.36]],
    cut: { box: [0.24, 0.02, 0.63, 0.34], face: [0.42, 0.22, 0.13, 0.12] },
  },
  ash: {
    head: [0.54, 0.25, 0.11], eyes: [[0.43, 0.25], [0.61, 0.235]], mouth: [0.47, 0.33], neck: [0.49, 0.4], chest: [0.5, 0.47], hips: [0.52, 0.63], hands: [[0.2, 0.43], [0.66, 0.6]],
    cut: { box: [0.17, 0.03, 0.89, 0.43], face: [0.5, 0.25, 0.36, 0.15] },
  },
  cook: {
    head: [0.47, 0.2, 0.15], eyes: [[0.39, 0.17], [0.53, 0.165]], mouth: [0.46, 0.275], neck: [0.47, 0.34], chest: [0.5, 0.44], hips: [0.5, 0.66], hands: [[0.12, 0.33], [0.84, 0.48]],
    cut: { box: [0.27, 0, 0.77, 0.36], face: [0.52, 0.2, 0.24, 0.145] },
  },
  sharp: {
    head: [0.49, 0.29, 0.15], eyes: [[0.36, 0.265], [0.51, 0.26]], mouth: [0.44, 0.365], neck: [0.49, 0.44], chest: [0.6, 0.53], hips: [0.6, 0.72], hands: [[0.11, 0.53], [0.84, 0.72]],
    cut: { box: [0.18, 0.02, 0.79, 0.44], face: [0.48, 0.28, 0.3, 0.16] },
  },
  electra: {
    head: [0.49, 0.32, 0.09], eyes: [[0.42, 0.3], [0.56, 0.295]], mouth: [0.53, 0.38], neck: [0.5, 0.45], chest: [0.52, 0.52], hips: [0.52, 0.66], hands: [[0.14, 0.48], [0.88, 0.45]],
    cut: { box: [0.12, 0, 0.84, 0.44], face: [0.48, 0.3, 0.36, 0.13] },
  },
  kid: {
    head: [0.57, 0.3, 0.12], eyes: [[0.53, 0.29], [0.71, 0.285]], mouth: [0.57, 0.36], neck: [0.54, 0.4], chest: [0.52, 0.52], hips: [0.55, 0.71], hands: [[0.15, 0.42], [0.94, 0.32]],
    cut: { box: [0.14, 0, 0.82, 0.39], face: [0.52, 0.27, 0.34, 0.11] },
  },
  bum: {
    head: [0.555, 0.23, 0.13], eyes: [[0.53, 0.21], [0.675, 0.195]], mouth: [0.6, 0.29], neck: [0.49, 0.38], chest: [0.53, 0.48], hips: [0.53, 0.63], hands: [[0.06, 0.33], [0.93, 0.42]],
    cut: { box: [0.24, 0.03, 0.76, 0.43], face: [0.52, 0.24, 0.27, 0.16] },
  },
  genius: {
    head: [0.5, 0.25, 0.12], eyes: [[0.49, 0.235], [0.585, 0.225]], mouth: [0.53, 0.31], neck: [0.55, 0.39], chest: [0.59, 0.5], hips: [0.59, 0.69], hands: [[0.28, 0.52], [0.8, 0.63]],
    cut: { box: [0.21, 0, 0.75, 0.41], face: [0.47, 0.24, 0.27, 0.16] },
  },
  bouncer: {
    head: [0.49, 0.17, 0.15], eyes: [[0.54, 0.155], [0.66, 0.15]], mouth: [0.57, 0.24], neck: [0.5, 0.33], chest: [0.49, 0.44], hips: [0.49, 0.64], hands: [[0.11, 0.64], [0.93, 0.32]],
    cut: { box: [0.15, 0, 0.71, 0.33], face: [0.43, 0.18, 0.27, 0.14] },
  },
  cop: {
    head: [0.49, 0.22, 0.12], eyes: [[0.39, 0.18], [0.5, 0.19]], mouth: [0.41, 0.29], neck: [0.49, 0.36], chest: [0.49, 0.47], hips: [0.49, 0.64], hands: [[0.13, 0.5], [0.86, 0.66]],
    cut: { box: [0.21, 0, 0.8, 0.35], face: [0.5, 0.2, 0.27, 0.14] },
  },
  model: {
    head: [0.53, 0.2, 0.08], eyes: [[0.42, 0.195], [0.63, 0.195]], mouth: [0.64, 0.265], neck: [0.46, 0.3], chest: [0.43, 0.38], hips: [0.42, 0.55], hands: [[0.1, 0.46], [0.86, 0.4]],
    cut: { box: [0, 0, 0.86, 0.3], face: [0.55, 0.19, 0.3, 0.11], round: [0.47, 0.15, 0.47, 0.17] },
  },
};

/** Where on a hero each trophy goes on the ПОСЛЕ photo; one that finds its place taken hangs from the neck on a string. */
const SLOT: Record<string, 'eyes' | 'head' | 'mouth' | 'hips' | 'belly' | 'feet' | 'hand' | 'shoulder' | 'neck'> = {
  xray: 'eyes', sock: 'head', fangs: 'mouth', denture: 'mouth', battery: 'mouth', undies: 'hips', cup: 'hips', hedgehog: 'hips',
  belly: 'belly', spring: 'feet', insoles: 'feet', piggy: 'feet', hand: 'shoulder', bells: 'neck',
  polish: 'hand', tray: 'hand', lube: 'hand', glasseye: 'hand', chalk: 'hand', opener: 'hand', mirrorball: 'hand', tea: 'hand', energy: 'hand', boomerang: 'hand',
};

// ---------------------------------------------------------------- stickers over a beaten hero

const cv = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** A sticking plaster: a strip with a pad in the middle; `cross` lays two of them crossed. */
function plaster(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, cross = true) {
  const one = (a: number) => {
    c.save();
    c.rotate(a);
    rrect(c, -s, -s * 0.28, s * 2, s * 0.56, s * 0.24);
    c.fillStyle = '#e8c597';
    c.fill();
    c.lineWidth = Math.max(2.5, s * 0.09);
    c.strokeStyle = '#1a120d';
    c.stroke();
    rrect(c, -s * 0.36, -s * 0.2, s * 0.72, s * 0.4, s * 0.08);
    c.fillStyle = '#f6e7cf';
    c.fill();
    c.fillStyle = 'rgba(120,80,40,.55)';
    for (const dx of [-0.75, -0.6, 0.6, 0.75]) for (const dy of [-0.08, 0.08]) { c.beginPath(); c.arc(dx * s, dy * s, s * 0.035, 0, 7); c.fill(); }
    c.restore();
  };
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  one(0.35);
  if (cross) one(-0.45);
  c.restore();
}

/** A bruise or a black eye: a soft purple patch multiplied into the skin. */
function bruise(c: CanvasRenderingContext2D, x: number, y: number, r: number, black: boolean) {
  c.save();
  c.globalCompositeOperation = 'multiply';
  const g = c.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, black ? 'rgba(60,20,70,.95)' : 'rgba(120,60,140,.75)');
  g.addColorStop(0.6, black ? 'rgba(90,40,110,.7)' : 'rgba(150,120,90,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(x, y, r, r * 0.8, 0, 0, 7);
  c.fill();
  c.restore();
}

/** A bandage round the head: a white band over the forehead, a red spot soaked through, the knot's ends at the back. */
function bandage(c: CanvasRenderingContext2D, hx: number, hy: number, r: number, back: number) {
  c.save();
  c.lineCap = 'round';
  const band = (w: number, col: string) => {
    c.beginPath();
    c.ellipse(hx, hy - r * 0.18, r * 1.04, r * 0.5, back * 0.12, Math.PI * 1.02, Math.PI * 1.98);
    c.lineWidth = w;
    c.strokeStyle = col;
    c.stroke();
  };
  band(r * 0.42, '#1a120d');
  band(r * 0.32, '#f4efe4');
  c.fillStyle = 'rgba(190,40,40,.85)';
  c.beginPath();
  c.ellipse(hx - back * r * 0.12, hy - r * 0.64, r * 0.12, r * 0.08, 0.3, 0, 7);
  c.fill();
  const kx = hx + back * r * 1.0, ky = hy - r * 0.3;
  for (const [a, l] of [[-0.5, 0.55], [0.25, 0.5]]) {
    c.save();
    c.translate(kx, ky);
    c.rotate(back > 0 ? a : Math.PI - a);
    rrect(c, 0, -r * 0.1, r * l, r * 0.2, r * 0.06);
    c.fillStyle = '#f4efe4';
    c.fill();
    c.lineWidth = r * 0.05;
    c.strokeStyle = '#1a120d';
    c.stroke();
    c.restore();
  }
  c.restore();
}

/** Little stars going round a dizzy head. */
function stars(c: CanvasRenderingContext2D, hx: number, hy: number, r: number) {
  const star = (x: number, y: number, s: number, a: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? s * 0.45 : s; c.lineTo(rr * Math.sin((k * Math.PI) / 5), -rr * Math.cos((k * Math.PI) / 5)); }
    c.closePath();
    c.fillStyle = '#ffd34d';
    c.fill();
    c.lineWidth = s * 0.18;
    c.strokeStyle = '#1a120d';
    c.stroke();
    c.restore();
  };
  star(hx - r * 0.95, hy - r * 1.05, r * 0.2, 0.2);
  star(hx + r * 0.1, hy - r * 1.35, r * 0.16, -0.3);
  star(hx + r * 1.0, hy - r * 1.0, r * 0.18, 0.5);
}

/** A fallen hero's crossed-out eye. */
function xeye(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.save();
  c.lineCap = 'round';
  for (const [w, col] of [[s * 0.42, '#1a120d'], [s * 0.2, '#fbf6ea']] as const) {
    c.lineWidth = w;
    c.strokeStyle = col;
    c.beginPath();
    c.moveTo(x - s, y - s);
    c.lineTo(x + s, y + s);
    c.moveTo(x + s, y - s);
    c.lineTo(x - s, y + s);
    c.stroke();
  }
  c.restore();
}

/** The face's bruises for its state: the eyes, the face's middle and radius as drawn on the canvas, `side` 1 for a face looking right. */
function beaten(c: CanvasRenderingContext2D, st: number, eyes: Pt[], hx: number, hy: number, hr: number, side: number) {
  if (st <= 0) return;
  // the eye nearer the camera's side of the face gets the black eye, the far cheek the plaster
  const [near, far] = side > 0 ? [eyes[1], eyes[0]] : [eyes[0], eyes[1]];
  if (st < 3) bruise(c, near[0] + side * hr * 0.06, near[1] + hr * 0.1, hr * 0.32, st >= 2);
  plaster(c, far[0] - side * hr * 0.15, far[1] + hr * 0.55, hr * 0.28, 0.4 * side, st >= 2);
  if (st >= 2) bandage(c, hx, hy, hr, -side);
  if (st === 2) stars(c, hx, hy - hr * 0.2, hr);
  if (st === 3) for (const [ex, ey] of eyes) xeye(c, ex, ey, hr * 0.13);
}

// ---------------------------------------------------------------- the heads, cut out as stickers

interface Head { cv: HTMLCanvasElement; eyes: Pt[]; hx: number; hy: number; hr: number }
/** The sticker's white edge, in the picture's pixels. */
const EDGE = 9;
const heads = new Map<string, Head | null>();

/**
 * A hero's head cut out of its picture as a sticker with a white edge, looking the given way: the part of the picture in
 * the head's box that hangs together with the face, so a hand or a prop beside it stays out. Made once for each.
 */
function headOf(i: number, look: Look): Head | null {
  const id = `${i}${look}`;
  if (heads.has(id)) return heads.get(id)!;
  const d = HEROES[i], b = BODY[d.key], sp = sprites.get(d.key), art = sp && b ? artOf(i, sp.facing) : null;
  let out: Head | null = null;
  if (art && b && sp) {
    const w = art.width, h = art.height, px = art.getContext('2d')!.getImageData(0, 0, w, h);
    const [x0, y0, x1, y1] = b.cut.box.map((v, k) => v * (k % 2 ? h : w));
    const [cx, cy, rx, ry] = [b.cut.face[0] * w, b.cut.face[1] * h, b.cut.face[2] * w, b.cut.face[3] * h];
    const rd = b.cut.round && [b.cut.round[0] * w, b.cut.round[1] * h, b.cut.round[2] * w, b.cut.round[3] * h];
    const ok = (x: number, y: number) => px.data[(y * w + x) * 4 + 3] > 24 && x >= x0 && x < x1 && y >= y0 && y < y1
      && (y <= cy || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1)
      && (!rd || ((x - rd[0]) / rd[2]) ** 2 + ((y - rd[1]) / rd[3]) ** 2 <= 1);
    // what hangs together with the middle of the face
    const mask = new Uint8Array(w * h), stack = [Math.round(cy) * w + Math.round(cx)];
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      if (mask[p] || !ok(x, y)) continue;
      mask[p] = 1;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    if (bx1 > bx0) {
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, cut = cv(bw, bh), cc = cut.getContext('2d')!, part = cc.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const s = ((y + by0) * w + x + bx0) * 4, t = (y * bw + x) * 4;
        if (!mask[(y + by0) * w + x + bx0]) continue;
        for (let k = 0; k < 4; k++) part.data[t + k] = px.data[s + k];
      }
      cc.putImageData(part, 0, 0);
      // the white edge: the head's outline drawn all round, filled cream, the head on top
      const m = EDGE + 3, st = cv(bw + m * 2, bh + m * 2), sc = st.getContext('2d')!;
      for (let a = 0; a < 16; a++) sc.drawImage(cut, m + Math.cos((a * Math.PI) / 8) * EDGE, m + Math.sin((a * Math.PI) / 8) * EDGE);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = '#f6efe2';
      sc.fillRect(0, 0, st.width, st.height);
      sc.globalCompositeOperation = 'source-over';
      sc.drawImage(cut, m, m);
      const flip = look !== sp.facing, X = (fx: number) => (flip ? st.width - (fx * w - bx0 + m) : fx * w - bx0 + m), Y = (fy: number) => fy * h - by0 + m;
      let pic = st;
      if (flip) {
        pic = cv(st.width, st.height);
        const fc = pic.getContext('2d')!;
        fc.translate(st.width, 0);
        fc.scale(-1, 1);
        fc.drawImage(st, 0, 0);
      }
      out = { cv: pic, eyes: b.eyes.map(([ex, ey]) => [X(ex), Y(ey)] as Pt), hx: X(b.head[0]), hy: Y(b.head[1]), hr: b.head[2] * h };
    }
  }
  heads.set(id, out);
  return out;
}

/** The head sticker with the bruises of its state. */
function headIn(i: number, look: Look, st: number) {
  const hd = headOf(i, look);
  if (!hd || !st) return hd?.cv ?? null;
  const out = cv(hd.cv.width, hd.cv.height), c = out.getContext('2d')!;
  c.drawImage(hd.cv, 0, 0);
  beaten(c, st, hd.eyes, hd.hx, hd.hy, hd.hr, look === 'right' ? 1 : -1);
  return out;
}

// ---------------------------------------------------------------- a hero as the run left it

interface Dressed { cv: HTMLCanvasElement; fx: number; fy: number; w: number; h: number }

/** Something the hero wears or holds: the picture's middle at (x, y), `s` its longer side. */
function put(c: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, s: number, rot: number) {
  const k = s / Math.max(img.width, img.height);
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.shadowColor = 'rgba(0,0,0,.4)';
  c.shadowBlur = 6;
  c.shadowOffsetY = 3;
  c.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
  c.restore();
}

/** Something hung on a string from (sx, sy), its middle at (x, y). */
function hung(c: CanvasRenderingContext2D, img: HTMLImageElement, sx: number, sy: number, x: number, y: number, s: number, rot: number) {
  const k = s / Math.max(img.width, img.height), top = y - (img.height * k) / 2 + s * 0.06;
  c.save();
  c.lineCap = 'round';
  for (const [lw, col] of [[7, 'rgba(18,10,6,.85)'], [3, '#d9c39a']] as const) {
    c.lineWidth = lw;
    c.strokeStyle = col;
    c.beginPath();
    c.moveTo(sx, sy);
    c.quadraticCurveTo((sx + x) / 2, Math.max(sy, top) + 8, x, top);
    c.stroke();
  }
  c.restore();
  put(c, img, x, y, s, rot);
}

/**
 * A hero as it comes out of the run, on a canvas with room round the picture: turned to look `look`, with the bruises
 * of its state and its trophies worn where they go (Third hand behind the shoulder, the glasses on the eyes...).
 */
function dressed(i: number, look: Look, st: number, arts: string[]): Dressed | null {
  const d = HEROES[i], sp = sprites.get(d.key), b = BODY[d.key], img = artOf(i, look);
  if (!sp || !img) return null;
  const w = img.width, h = img.height, pad = Math.round(h * 0.32), out = cv(w + pad * 2, h + pad * 2), c = out.getContext('2d')!;
  const flip = look !== sp.facing, X = (f: number) => pad + (flip ? 1 - f : f) * w, Y = (f: number) => pad + f * h, side = look === 'right' ? 1 : -1;
  // a hero without a table of its own still stands, as it is
  if (!b) { c.drawImage(img, pad, pad); return { cv: out, fx: pad + w / 2, fy: pad + h, w, h }; }
  // each trophy to its place; a taken place (one mouth, two hands, two feet) sends it to hang from the neck
  const free: Record<string, number> = { eyes: 1, head: 1, mouth: 1, hips: 1, belly: 1, feet: 2, hand: 2, shoulder: 1, neck: 9 };
  const worn = arts.filter(k => uiArt.has('art_' + k)).map(k => {
    let s: string = SLOT[k] ?? 'neck';
    if (!(free[s]-- > 0)) s = 'neck';
    return { k, s, img: uiArt.get('art_' + k)! };
  });
  c.drawImage(img, pad, pad);
  // the third hand sticks up over the back shoulder, away from where the hero looks
  for (const t of worn.filter(t => t.s === 'shoulder')) put(c, t.img, X(b.neck[0]) - side * w * 0.3, Y(b.neck[1]) - h * 0.04, h * 0.24, -side * 0.35);
  const eyes = b.eyes.map(([ex, ey]) => [X(ex), Y(ey)] as Pt), hx = X(b.head[0]), hy = Y(b.head[1]), hr = b.head[2] * h;
  if (st >= 2) bruise(c, X(b.chest[0]) + side * w * 0.1, Y(b.chest[1]), hr * 0.35, false);
  if (st >= 2) plaster(c, X(b.hands[0][0]), Y(b.hands[0][1]) - h * 0.05, hr * 0.26, -0.3, false);
  beaten(c, st, eyes, hx, hy, hr, side);
  const neck = worn.filter(t => t.s === 'neck');
  neck.forEach((t, k) => {
    const n = neck.length, nx = X(b.neck[0]), ny = Y(b.neck[1]), dx = (k - (n - 1) / 2) * h * 0.2;
    hung(c, t.img, nx + dx * 0.25, ny, nx + dx, Y(b.chest[1]) + h * 0.08 + Math.abs(dx) * 0.25, h * 0.2, (k - (n - 1) / 2) * 0.18);
  });
  // worn things first, the ones in the hands over them
  const ORDER = ['hips', 'belly', 'eyes', 'head', 'mouth', 'feet', 'hand'];
  let hands = 0, feet = 0;
  for (const t of worn.filter(t => ORDER.includes(t.s)).sort((p, q) => ORDER.indexOf(p.s) - ORDER.indexOf(q.s))) {
    if (t.s === 'eyes') {
      const [l, r] = eyes, d2 = Math.hypot(r[0] - l[0], r[1] - l[1]);
      let a = Math.atan2(r[1] - l[1], r[0] - l[0]);
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      put(c, t.img, (l[0] + r[0]) / 2, (l[1] + r[1]) / 2, Math.max(d2 * 2.4, hr * 1.5), a);
    } else if (t.s === 'head') put(c, t.img, hx + side * hr * 0.1, hy - hr * 1.15, hr * 1.4, -side * 0.55);
    else if (t.s === 'hips') put(c, t.img, X(b.hips[0]), Y(b.hips[1]), Math.min(w * 0.5, h * 0.28), 0);
    else if (t.s === 'belly') put(c, t.img, X(b.chest[0]), (Y(b.chest[1]) + Y(b.hips[1])) / 2, Math.min(w * 0.45, h * 0.24), 0);
    else if (t.s === 'mouth') put(c, t.img, X(b.mouth[0]) + side * hr * 0.2, Y(b.mouth[1]) + hr * 0.1, hr * 0.8, side * 0.4);
    else if (t.s === 'hand') {
      const hd = b.hands[hands++ % 2];
      hung(c, t.img, X(hd[0]), Y(hd[1]), X(hd[0]) + side * h * 0.02, Y(hd[1]) + h * 0.11, h * 0.17, side * 0.12);
    } else if (t.s === 'feet') put(c, t.img, pad + w / 2 + (feet++ % 2 ? -1 : 1) * side * (w * 0.5 + h * 0.06), pad + h * 0.89, h * 0.2, 0);
  }
  return { cv: out, fx: pad + w / 2, fy: pad + h * 0.985, w, h };
}

/** A soft shadow on the floor under a figure. */
function shadow(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
  c.save();
  c.translate(x, y);
  c.scale(1, 0.32);
  const sh = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
  sh.addColorStop(0, 'rgba(10,6,4,.6)');
  sh.addColorStop(1, 'rgba(10,6,4,0)');
  c.fillStyle = sh;
  c.fillRect(-w, -w, w * 2, w * 2);
  c.restore();
}

/** A figure lying on the floor, the way a toppled one lies: turned on its side and squashed, its feet at (x, y). */
function lying(c: CanvasRenderingContext2D, d: Dressed, art: HTMLCanvasElement, x: number, y: number, len: number, dir: number) {
  const k = len / d.h;
  c.save();
  c.translate(x, y);
  c.scale(1, 0.55);
  c.rotate((dir * Math.PI) / 2);
  c.drawImage(art, -d.fx * k, -d.fy * k, d.cv.width * k, d.cv.height * k);
  c.restore();
}

/** A chalk outline round a lying figure: its outline grown and hollowed, in rough chalk. */
function chalk(c: CanvasRenderingContext2D, d: Dressed, x: number, y: number, len: number, dir: number) {
  const k = len / d.h, W = d.cv.width * k + 40, H = d.cv.height * k + 40, m = cv(W, H), mc = m.getContext('2d')!;
  const at = (ox: number, oy: number) => mc.drawImage(d.cv, 20 + ox, 20 + oy, d.cv.width * k, d.cv.height * k);
  for (let a = 0; a < 16; a++) at(Math.cos((a * Math.PI) / 8) * 14, Math.sin((a * Math.PI) / 8) * 14);
  mc.globalCompositeOperation = 'source-in';
  mc.fillStyle = '#f2efe6';
  mc.fillRect(0, 0, W, H);
  mc.globalCompositeOperation = 'destination-out';
  for (let a = 0; a < 16; a++) at(Math.cos((a * Math.PI) / 8) * 8, Math.sin((a * Math.PI) / 8) * 8);
  at(0, 0);
  // chalk is never solid
  for (let n = 0; n < 900; n++) mc.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 2);
  c.save();
  c.translate(x, y);
  c.scale(1, 0.55);
  c.rotate((dir * Math.PI) / 2);
  c.globalAlpha = 0.9;
  c.drawImage(m, -d.fx * k - 20, -d.fy * k - 20);
  c.restore();
}

// ---------------------------------------------------------------- the prints

const backdrop = (bg: number) => BACKDROPS[((bg % BACKDROP_COUNT) + BACKDROP_COUNT) % BACKDROP_COUNT];
/** In a photo of n the ones at the sides turn to the middle, as people do on a group photo. */
const lookAt = (i: number, n: number, k: number): Look => (n === 1 || k === 1 ? sprites.get(HEROES[i].key)?.facing ?? 'right' : k === 0 ? 'right' : 'left');

function sized(c: HTMLCanvasElement) {
  c.width = c.height = PHOTO;
  return c.getContext('2d')!;
}

/** ДО: the party photo of the pick screen as the run began, online with the players' names. */
export function drawStart(out: HTMLCanvasElement, a: Album) {
  sized(out);
  const p = a.photo;
  drawPhoto(out, p.heroes.map((hero, k) => ({ hero, look: null, name: p.names?.[k], host: p.host === k })), { bg: p.bg, names: !!p.names, date: a.at });
}

/** Where the marker notes go on ПОСЛЕ, by the party's size. */
const NOTES: Record<number, { x: number; y: number; rot: number; bend: number }[]> = {
  1: [{ x: 512, y: 110, rot: -3, bend: 0.06 }],
  2: [{ x: 250, y: 130, rot: -5, bend: -0.22 }, { x: 780, y: 120, rot: 4, bend: 0.22 }],
  3: [{ x: 175, y: 160, rot: -6, bend: -0.22 }, { x: 512, y: 62, rot: 2, bend: 0.06 }, { x: 845, y: 160, rot: 5, bend: 0.22 }],
};

const plural = (n: number, one: string, few: string, many: string) => {
  const t = n % 10, h = n % 100;
  return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 10 || h >= 20) ? few : many;
};

/**
 * ПОСЛЕ: the same backdrop and places, the heroes as the run left them, beaten by their health and wearing their
 * trophies; the fallen lie in chalk outlines. A marker note over each says how it came out of it.
 */
export function drawAfter(out: HTMLCanvasElement, a: Album) {
  const c = sized(out), b = backdrop(a.photo.bg), bg = uiArt.get(b.key), light = bg ? lightOf(bg) : ([1, 1, 1] as [number, number, number]);
  c.fillStyle = '#1a120d';
  c.fillRect(0, 0, PHOTO, PHOTO);
  if (bg) c.drawImage(bg, 0, 0, PHOTO, PHOTO);
  const seats = a.photo.heroes.map(i => a.heroes.find(h => h.i === i)).filter(h => h !== undefined);
  const n = Math.max(1, Math.min(3, seats.length)), spots = SPOTS[n], tops: { k: number; x: number; y: number }[] = [];
  const order = spots.map((_, k) => k).sort((p, q) => spots[p].y - spots[q].y);
  for (const k of order) {
    const h = seats[k], p = spots[k];
    if (!h) continue;
    const st = stateOf(h.hp, h.max), d = dressed(h.i, lookAt(h.i, n, k), st, h.arts);
    if (!d) continue;
    const art = inLight(d.cv, light, b.tint), H = tallOf(h.i, p.s);
    if (st === 3) {
      // across its place, the feet one way and the head the other; a trio lies a little shorter, so the three don't heap
      const len = H * (n === 3 ? 0.78 : 0.92), dir = k === 0 ? -1 : 1, y = p.y - 30, x = p.x - (dir * len) / 2;
      shadow(c, p.x, y + 6, len * 0.9);
      chalk(c, d, x, y, len, dir);
      lying(c, d, art, x, y, len, dir);
      tops.push({ k, x: p.x, y: y - 60 });
    } else {
      const kk = H / d.h, feet = p.y + 14 * p.s;
      shadow(c, p.x, feet, d.w * kk);
      c.drawImage(art, p.x - d.fx * kk, feet - d.fy * kk, d.cv.width * kk, d.cv.height * kk);
      tops.push({ k, x: p.x, y: feet - H - 30 * p.s });
    }
  }
  finish(c, a.at);
  for (const t of tops) {
    const m = NOTES[n][t.k], h = seats[t.k]!, def = HEROES[h.i], st = stateOf(h.hp, h.max), falls = h.t.falls;
    const word = st === 3 ? (def.fem ? 'пала' : 'пал') : st === 0 ? 'ни царапины!' : st === 1 ? (def.fem ? 'потрёпана' : 'потрёпан') : def.fem ? 'еле живая' : 'еле живой';
    // the health, and under it how many times the hero fell on the way
    const subs = [st === 3 ? '' : `${h.hp}/${h.max} HP`, falls ? `${def.fem ? 'падала' : 'падал'} ${falls} ${plural(falls, 'раз', 'раза', 'раз')}` : ''].filter(Boolean);
    const big = n === 3 ? 48 : 60, small = n === 3 ? 34 : 40;
    marker(c, word, m.x, m.y, big, m.rot);
    subs.forEach((t2, j) => marker(c, t2, m.x + 4, m.y + big * 0.85 + j * small * 1.05, small, m.rot, '#f6e7b8'));
    const y0 = m.y + big * 0.85 + subs.length * small * 1.05;
    arrow(c, m.x, y0, t.x + (m.x < t.x ? -20 : m.x > t.x ? 20 : 0), Math.max(t.y, y0 + 70), m.bend);
  }
}

/** Where the heads go on a boss's photo, by the party's size: looking in over the bottom edge, as on a selfie. */
const HEAD_SLOTS: Record<number, { x: number; y: number; s: number; rot: number }[]> = {
  1: [{ x: 815, y: 905, s: 0.34, rot: 8 }],
  2: [{ x: 170, y: 915, s: 0.3, rot: -8 }, { x: 860, y: 915, s: 0.3, rot: 9 }],
  3: [{ x: 155, y: 920, s: 0.29, rot: -9 }, { x: 512, y: 950, s: 0.24, rot: 3 }, { x: 875, y: 920, s: 0.29, rot: 9 }],
};
/** Bosses whose hoard lies in the bottom right corner: a lone head looks in from the left instead. */
const HOARD_RIGHT = new Set(['king']);
/** The picture a boss lies as on a photo built without a hoard scene: the disco ball cracked. */
const FALLEN_FIG: Record<string, string> = { discoball: 'discoball2' };

/**
 * A dungeon room seen from the doorway, built from its floor's brickwork, slabs and torches with one vanishing point:
 * the boss's photo when there is no hoard scene for it yet.
 */
function room(c: CanvasRenderingContext2D, f: number) {
  const B = BIOMES[f] ?? BIOMES[0], wall = envArt.get('wall_' + B.art), slab = envArt.get(`slab_${B.art}_0`), torch = envArt.get('torch');
  const VX = 512, VY = 470, BL = 230, BR = 794, BT = 150, BB = 600, rows = 5;
  c.fillStyle = B.bg[1];
  c.fillRect(0, 0, PHOTO, PHOTO);
  if (wall && slab) {
    const rowH = (BB - BT) / rows, panel = cv(wall.width * 2, rowH * rows), pc = panel.getContext('2d')!;
    for (let r = 0; r < rows; r++) for (let x = -((r * 173) % wall.width); x < panel.width; x += wall.width) pc.drawImage(wall, x, r * rowH, wall.width, rowH);
    // the floor in flat slices, each a row of slabs as wide as the floor is at that depth
    const tiles = 18, tex = cv(slab.width * tiles, slab.height), tc = tex.getContext('2d')!, unit = (BR - BL) / 4;
    for (let k = 0; k < tiles; k++) tc.drawImage(slab, k * slab.width, 0);
    for (let y = BB; y < PHOTO; y += 2) {
      const s = (y - VY) / (BB - VY), v = Math.floor((1 - 1 / s) * 7 * slab.height) % slab.height, dw = tiles * unit * s;
      c.drawImage(tex, 0, v, tex.width, 1, VX - dw / 2, y, dw, 2.5);
    }
    c.drawImage(panel, 0, 0, BR - BL, panel.height, BL, BT, BR - BL, BB - BT);
    // the side walls in thin upright slices, each as tall as the wall is at that depth
    for (const sd of [-1, 1]) {
      for (let x = 0; x < BL; x += 2) {
        const sx = sd < 0 ? x : PHOTO - x - 2, s = (VX - x) / (VX - BL), top = VY - (VY - BT) * s, bot = VY + (BB - VY) * s;
        const u = Math.floor((1 - 1 / s) * 3 * wall.width) % (panel.width - 4);
        c.drawImage(panel, u, 0, 2, panel.height, sx, top, 2.5, bot - top);
        c.fillStyle = `rgba(0,0,0,${0.1 + 0.2 * (1 - x / BL)})`;
        c.fillRect(sx, top, 2.5, bot - top);
      }
    }
  }
  // the ceiling in darkness, the far wall in a little fog, the near floor darker
  c.fillStyle = B.bg[1];
  c.beginPath();
  c.moveTo(0, -120);
  c.lineTo(PHOTO, -120);
  c.lineTo(BR, BT);
  c.lineTo(BL, BT);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(0,0,0,.12)';
  c.fillRect(BL, BT, BR - BL, BB - BT);
  const fg = c.createLinearGradient(0, BB, 0, PHOTO);
  fg.addColorStop(0, 'rgba(0,0,0,.45)');
  fg.addColorStop(0.5, 'rgba(0,0,0,.1)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = fg;
  c.fillRect(0, BB, PHOTO, PHOTO - BB);
  for (const tx of [BL + 70, BR - 70]) {
    const g = c.createRadialGradient(tx, 280, 10, tx, 280, 260);
    g.addColorStop(0, `rgba(${B.torch},.55)`);
    g.addColorStop(1, `rgba(${B.torch},0)`);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.fillRect(tx - 260, 20, 520, 520);
    c.restore();
    if (torch) c.drawImage(torch, tx - (65 * torch.width) / torch.height, 230, (130 * torch.width) / torch.height, 130);
  }
}

/** The boss knocked over on the floor of a room built in code, for a boss whose hoard has no picture yet. */
function fallenBoss(c: CanvasRenderingContext2D, boss: string) {
  const def = MOBS[boss as MobKind];
  room(c, def?.floor ?? 2);
  const sp = sprites.get(FALLEN_FIG[boss] ?? boss);
  if (!sp) return;
  const img = sp.img, w = img.naturalWidth, h = img.naturalHeight, art = cv(w, h), ac = art.getContext('2d')!;
  // turned to lie with its head to the left, in the room's light
  if (sp.facing !== 'left') { ac.translate(w, 0); ac.scale(-1, 1); }
  ac.drawImage(img, 0, 0);
  const B = BIOMES[def?.floor ?? 2] ?? BIOMES[0], hex = parseInt(B.light.slice(1), 16);
  const lit = inLight(art, [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255], 0.45);
  // across the middle of the floor, clear of the heads looking in at the bottom
  const len = 500 * ((def?.fig ?? 52) / 52), d: Dressed = { cv: art, fx: w / 2, fy: h * 0.98, w, h };
  shadow(c, 512, 690, len * 1.1);
  lying(c, d, lit, 512 + len * 0.5, 672, len, -1);
}

/**
 * A floor boss's photo: its hoard scene from the trophy window (or the boss knocked over in a room built in code, while
 * it has none), and the party's heads looking in over the bottom edge, each beaten as the hero was when the boss fell.
 */
export function drawShot(out: HTMLCanvasElement, a: Album, shot: Shot) {
  const c = sized(out), pic = eventArt.get('loot_' + shot.boss);
  if (pic) c.drawImage(pic, 0, 0, PHOTO, PHOTO);
  else fallenBoss(c, shot.boss);
  // the heroes in their places of the party photo, from the left
  const seats = a.photo.heroes.map(i => shot.heroes.find(h => h.i === i)).filter(h => h !== undefined);
  const n = Math.max(1, Math.min(3, seats.length)), mirror = n === 1 && HOARD_RIGHT.has(shot.boss);
  seats.forEach((h, k) => {
    const sl = HEAD_SLOTS[n][k], x = mirror ? PHOTO - sl.x : sl.x, rot = mirror ? -sl.rot : sl.rot;
    const look: Look = Math.abs(x - PHOTO / 2) < 60 ? sprites.get(HEROES[h.i].key)?.facing ?? 'right' : x < PHOTO / 2 ? 'right' : 'left';
    const st = stateOf(h.hp, h.max), img = headIn(h.i, look, st);
    if (!img) return;
    const k2 = (sl.s * PHOTO) / Math.sqrt(img.width * img.height);
    // a fallen hero leans over further, as if propped up by the others
    const tilt = ((rot + (st === 3 ? (x < PHOTO / 2 ? -16 : 16) : 0)) * Math.PI) / 180;
    c.save();
    c.translate(x, sl.y);
    c.rotate(tilt);
    c.shadowColor = 'rgba(0,0,0,.5)';
    c.shadowBlur = 18;
    c.shadowOffsetY = 8;
    c.drawImage(img, (-img.width * k2) / 2, (-img.height * k2) / 2, img.width * k2, img.height * k2);
    c.restore();
  });
  finish(c, a.at, false);
}
