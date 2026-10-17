// Cardboard standee look for figure art: the picture is printed on a sheet of board with its cut edge showing,
// corrugated core and all. Built once per picture when it loads, so a frame still draws one image per figure.

import { INK } from '../data';

export interface BoardStyle {
  /** Board thickness as a share of a hero's height; every figure is cut from the same board. */
  thick: number;
  /** White die-cut margin around the figure, as a share of a hero's height; 0 for none. */
  border: number;
  /** Rows of flutes in the cut: 0 plain board, 1 single wall, 2 double wall. */
  flute: 0 | 1 | 2;
}

export const BOARD_STYLES: Record<string, BoardStyle> = {
  thin: { thick: 0.03, border: 0, flute: 0 },
  flute: { thick: 0.055, border: 0, flute: 1 },
  slim: { thick: 0.04, border: 0, flute: 1 },
  diecut: { thick: 0.055, border: 0.02, flute: 1 },
  double: { thick: 0.085, border: 0, flute: 2 },
};

/**
 * The figure printed on board, at full size and then halved again and again: drawing a big picture small makes
 * it flicker, so each frame takes the size nearest to what it needs. x, y, w, h: where the original picture
 * sits in the full-size one; W, H: the full size.
 */
export interface Board {
  levels: HTMLCanvasElement[];
  W: number;
  H: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rgb = [number, number, number];
const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const LINER = hex('#e4bc83'), HOLLOW = hex('#b98749'), FLUTE = hex('#6a4220');
const PLAIN = hex('#d4a468'), PLAIN_BACK = hex('#a77843');
const PAPER = hex('#f4ede0'), INK_RGB = hex(INK);

/** Grow (op = max) or shrink (op = min) a mask by r pixels in each direction; separable square window. */
function morph(src: Uint8Array, W: number, H: number, r: number, grow: boolean): Uint8Array {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  const pick = grow ? Math.max : Math.min, edge = grow ? 0 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 255;
      for (let k = -r; k <= r; k++) { const xx = x + k; v = pick(v, xx < 0 || xx >= W ? edge : src[y * W + xx]); }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 255;
      for (let k = -r; k <= r; k++) { const yy = y + k; v = pick(v, yy < 0 || yy >= H ? edge : tmp[yy * W + x]); }
      out[y * W + x] = v;
    }
  }
  return out;
}

/** Box blur, twice, so the outline's slope can be read off it. */
function blur(src: Uint8Array, W: number, H: number, r: number): Float32Array {
  let a = Float32Array.from(src);
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(W * H), d = new Float32Array(W * H), n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * W + Math.min(W - 1, Math.max(0, k))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = s / n;
        s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        d[y * W + x] = s / n;
        s += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
    a = d;
  }
  return a;
}

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Colour of the cut at depth t (0 front face, 1 back face) and phase u (position along the cut, in flute periods). */
function cutColour(st: BoardStyle, t: number, u: number): Rgb {
  if (st.flute === 0) return mixRgb(PLAIN, PLAIN_BACK, t);
  // the back of the cut sits under the outline, so the walls fill the front 85% of it
  const walls = st.flute, d = t / 0.85;
  const seg = Math.min(walls - 1, Math.floor(d * walls)), lt = d * walls - seg, liner = 0.2;
  if (d >= 1 || lt < liner || lt > 1 - liner) return mixRgb(LINER, PLAIN_BACK, t * 0.4);
  // the fluted sheet runs from liner to liner, a dark wavy line over the hollows
  const wave = 0.5 + (0.5 - liner) * Math.sin(2 * Math.PI * (u + seg * 0.5));
  return Math.abs(lt - wave) < 0.12 ? FLUTE : mixRgb(HOLLOW, PLAIN_BACK, t * 0.4);
}

/**
 * Print `img` on board. `facing` is the way the figure looks: the cut shows behind it, as on a standee turned
 * a little toward its target, and on top, since the camera looks down. `rel` is the figure's height over a
 * hero's, `SH` the picture height in the result. The cut itself is worked out at `WORK` pixels high, where
 * all the time goes; it is plain colour, so scaling it up loses nothing that shows.
 */
export function makeBoard(img: HTMLImageElement, facing: 'left' | 'right', st: BoardStyle, rel: number, SH = 512, WORK = 320): Board {
  const sc = SH / img.naturalHeight, SW = Math.round(img.naturalWidth * sc), side = facing === 'left' ? 1 : -1;
  const T = (st.thick / rel) * SH, B0 = (st.border / rel) * SH, dx0 = side * T * 0.8, dy0 = -T * 0.6;
  const m = Math.ceil(B0) + 8;
  const W = SW + 2 * m + Math.ceil(Math.abs(dx0)), H = SH + 2 * m + Math.ceil(-dy0);
  const ox = m + (dx0 < 0 ? Math.ceil(-dx0) : 0), oy = m + Math.ceil(-dy0);

  // the same layout at the working size
  const f = Math.min(1, WORK / SH), w = Math.ceil(W * f), h = Math.ceil(H * f), n = w * h;
  const dx = dx0 * f, dy = dy0 * f, B = B0 * f, px = ox * f, py = oy * f, pw = SW * f, ph = SH * f;
  const wk = document.createElement('canvas');
  wk.width = w;
  wk.height = h;
  const c = wk.getContext('2d', { willReadFrequently: true })!;

  // the cut outline: the figure itself, grown by the white margin when there is one
  if (B > 0) {
    // round margin: stamp the figure around a few rings, then firm up the soft edge
    for (const r of [B, B * 0.66, B * 0.33]) {
      for (let a = 0; a < 20; a++) c.drawImage(img, px + r * Math.cos(a * 0.314), py + r * Math.sin(a * 0.314), pw, ph);
    }
  } else c.drawImage(img, px, py, pw, ph);
  const pic = c.getImageData(0, 0, w, h).data, shape = new Uint8Array(n);
  for (let i = 0; i < n; i++) shape[i] = B > 0 ? Math.min(255, pic[i * 4 + 3] * 6) : pic[i * 4 + 3];
  c.clearRect(0, 0, w, h);

  // the cut: each pixel takes the shallowest copy of the outline, swept back toward the back face, that covers it
  const N = Math.max(4, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const depth = new Float32Array(n), cov = new Uint8Array(n);
  for (let k = 1; k <= N; k++) {
    const t = k / N, ix = Math.round(dx * t), iy = Math.round(dy * t);
    for (let y = Math.max(0, iy); y < Math.min(h, h + iy); y++) {
      const row = y * w, srow = (y - iy) * w - ix;
      for (let x = Math.max(0, ix), x1 = Math.min(w, w + ix); x < x1; x++) {
        const a = shape[srow + x], p = row + x;
        if (a > cov[p]) cov[p] = a;
        if (a >= 128 && depth[p] === 0) depth[p] = t;
      }
    }
  }

  // outline around the outside of the cut, as thick as the ink in the art
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = cov[i] >= 128 || shape[i] >= 128 ? 255 : 0;
  const ink = Math.max(2, Math.round(WORK * 0.006));
  const inner = morph(solid, w, h, ink, false);
  const rimShape = B > 0 ? morph(shape.map(v => (v >= 128 ? 255 : 0)), w, h, Math.max(1, Math.round(ink * 0.6)), false) : null;
  // slope of the outline: cuts on top of the figure catch the light, the ones underneath sit in shade
  const soft = blur(shape, w, h, 2);
  const len = Math.hypot(dx, dy), vx = -dy / len, vy = dx / len, period = T * f * 0.9;

  const out = c.createImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let col: Rgb | null = null, a = 0;
      if (cov[p] > 0) {
        const t = depth[p] || 1, qx = x - dx * t, qy = y - dy * t;
        if (inner[p] === 0 && shape[p] < 128) col = INK_RGB;
        else {
          col = cutColour(st, t, (qx * vx + qy * vy) / period);
          const sx = Math.min(w - 2, Math.max(1, Math.round(qx))), sy = Math.min(h - 2, Math.max(1, Math.round(qy)));
          const gy = soft[(sy + 1) * w + sx] - soft[(sy - 1) * w + sx], gx = soft[sy * w + sx + 1] - soft[sy * w + sx - 1];
          const k = 0.88 + (0.14 * gy) / (Math.hypot(gx, gy) || 1); // gy > 0: the outline faces up
          col = [col[0] * k, col[1] * k, col[2] * k];
        }
        a = cov[p];
      }
      if (B > 0 && shape[p] > 0) {
        // white margin with a thin ink rim; it covers the cut where they overlap
        const mc = rimShape![p] === 0 ? INK_RGB : PAPER;
        if (a === 0 || shape[p] >= 128) { col = mc; a = shape[p]; }
        else col = mixRgb(col!, mc, shape[p] / 255);
      }
      if (col) {
        o[p * 4] = col[0]; o[p * 4 + 1] = col[1]; o[p * 4 + 2] = col[2]; o[p * 4 + 3] = a;
      }
    }
  }
  c.putImageData(out, 0, 0);

  // full size: the cut scaled up, the picture on top at full sharpness
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const fc = cv.getContext('2d')!;
  fc.imageSmoothingQuality = 'high';
  fc.drawImage(wk, 0, 0, w / f, h / f);
  fc.drawImage(img, ox, oy, SW, SH);
  const levels = [cv];
  for (let lw = W, lh = H; lh > 48;) {
    lw = Math.ceil(lw / 2); lh = Math.ceil(lh / 2);
    const half = document.createElement('canvas');
    half.width = lw;
    half.height = lh;
    const hc = half.getContext('2d')!;
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(levels[levels.length - 1], 0, 0, lw, lh);
    levels.push(half);
  }
  return { levels, W, H, x: ox, y: oy, w: SW, h: SH };
}
