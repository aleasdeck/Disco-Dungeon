// Figure art as a tabletop standee: the picture is a sticker on a thin plate of coloured plastic, cut with a margin
// around the figure, the plate's edge showing behind it and on top. Built once per picture when it loads, so a frame
// still draws one image per figure.

import { INK } from '../data';

/** Plate thickness, margin around the figure and the sticker's white edge, as shares of a hero's height: every
 *  figure is cut from the same plate. */
const THICK = 0.026, MARGIN = 0.03, STICKER = 0.009;

/**
 * The finished standee at full size and then halved again and again: drawing a big picture small makes it
 * flicker, so each frame takes the size nearest to what it needs. x, y, w, h: where the original picture sits in
 * the full-size one; W, H: the full size.
 */
export interface Standee {
  levels: HTMLCanvasElement[];
  W: number;
  H: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The levels washed in the current floor's light, made when a floor first draws the figure. */
  lit?: { light: string; levels: HTMLCanvasElement[] };
}

type Rgb = [number, number, number];
const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const INK_RGB = hex(INK), WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];

/** Grow or shrink a 0/255 mask by r pixels each way (square window): rows first, then columns. */
function morph(src: Uint8Array, W: number, H: number, r: number, grow: boolean): Uint8Array {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  sweep(src, tmp, W, H, 1, W, r, grow);
  sweep(tmp, out, H, W, W, 1, r, grow);
  return out;
}

/** One direction of `morph`: a pixel takes the spreading value when one lies within r of it along its line. */
function sweep(a: Uint8Array, b: Uint8Array, len: number, lines: number, step: number, lineStep: number, r: number, grow: boolean) {
  // growing spreads the figure; shrinking spreads the empty space, and beyond the edge counts as empty
  const spread = grow ? 255 : 0;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let last = grow ? -1e9 : -1;
    for (let i = 0; i < len; i++) {
      const p = base + i * step;
      if (a[p] === spread) last = i;
      b[p] = i - last <= r ? spread : a[p];
    }
    last = grow ? 1e9 : len;
    for (let i = len - 1; i >= 0; i--) {
      const p = base + i * step;
      if (a[p] === spread) last = i;
      if (last - i <= r) b[p] = spread;
    }
  }
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

/** Colour of the plate's edge at depth t (0 front face, 1 back face): a glossy lip, then darker toward the back. */
const edgeColour = (tint: Rgb, t: number): Rgb =>
  t < 0.25 ? mixRgb(tint, WHITE, 0.35) : mixRgb(mixRgb(tint, BLACK, 0.3), BLACK, (t - 0.25) * 0.3);

/**
 * Stick `img` on a plate. `facing` is the way the figure looks: the edge shows behind it, as on a standee turned a
 * little toward its target, and on top, since the camera looks down. `rel` is the figure's height over a hero's,
 * `tint` the colour of its stand, `SH` the picture height in the result. The plate itself is worked out at `WORK`
 * pixels high, where all the time goes; it is plain colour, so scaling it up loses nothing that shows.
 */
export function makeStandee(img: HTMLImageElement, facing: 'left' | 'right', rel: number, tint: string, SH = 512, WORK = 320): Standee {
  const sc = SH / img.naturalHeight, SW = Math.round(img.naturalWidth * sc), side = facing === 'left' ? 1 : -1;
  const T = (THICK / rel) * SH, B0 = (MARGIN / rel) * SH, dx0 = side * T * 0.8, dy0 = -T * 0.6;
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

  // the figure's own outline, then the plate's: the figure stamped round two rings for a round margin,
  // its soft edge firmed up
  c.drawImage(img, px, py, pw, ph);
  const raw = c.getImageData(0, 0, w, h).data;
  c.clearRect(0, 0, w, h);
  for (const r of [B, B * 0.5]) {
    for (let a = 0; a < 16; a++) c.drawImage(img, px + r * Math.cos(a * 0.3927), py + r * Math.sin(a * 0.3927), pw, ph);
  }
  const pic = c.getImageData(0, 0, w, h).data, shape = new Uint8Array(n), plate = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    shape[i] = Math.min(255, pic[i * 4 + 3] * 6);
    plate[i] = shape[i] >= 128 ? 255 : 0;
  }
  c.clearRect(0, 0, w, h);

  // the edge: each pixel takes the shallowest copy of the outline, swept back toward the back face, that covers it
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

  // ink round the outside of the edge, as thick as the ink in the art, and a thinner rim round the plate's face
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = cov[i] >= 128 || shape[i] >= 128 ? 255 : 0;
  const ink = Math.max(2, Math.round(WORK * 0.006));
  const inner = morph(solid, w, h, ink, false), rim = morph(plate, w, h, Math.max(1, Math.round(ink * 0.6)), false);
  // the plastic catches the light in a thin line just inside its rim
  const bevel = morph(plate, w, h, Math.max(2, Math.round(ink * 1.6)), false);
  // the sticker: the figure's outline grown a little for its white edge, with a shadow down and to the right
  const fig = new Uint8Array(n), sk = Math.max(1, Math.round((STICKER / rel) * SH * f));
  for (let i = 0; i < n; i++) fig[i] = raw[i * 4 + 3] >= 128 ? 255 : 0;
  const stick = morph(fig, w, h, sk, true), shadowAt = Math.round(sk * 0.8) * (w + 1);
  // slope of the outline: edges on top of the figure catch the light, the ones underneath sit in shade
  const soft = blur(shape, w, h, 2), tc = hex(tint);

  const out = c.createImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let col: Rgb | null = null, a = 0;
      if (cov[p] > 0) {
        const t = depth[p] || 1, qx = x - dx * t, qy = y - dy * t;
        if (inner[p] === 0 && shape[p] < 128) col = INK_RGB;
        else {
          col = edgeColour(tc, t);
          const sx = Math.min(w - 2, Math.max(1, Math.round(qx))), sy = Math.min(h - 2, Math.max(1, Math.round(qy)));
          const gy = soft[(sy + 1) * w + sx] - soft[(sy - 1) * w + sx], gx = soft[sy * w + sx + 1] - soft[sy * w + sx - 1];
          const k = 0.88 + (0.14 * gy) / (Math.hypot(gx, gy) || 1); // gy > 0: the outline faces up
          col = [col[0] * k, col[1] * k, col[2] * k];
        }
        a = cov[p];
      }
      if (shape[p] > 0) {
        // the plate's face, lit from above, inside its rim; it covers the edge where they overlap
        const face = rim[p] === 0 ? INK_RGB : bevel[p] === 0 ? mixRgb(tc, WHITE, 0.4) : mixRgb(tc, WHITE, 0.12 * (1 - y / h));
        if (a === 0 || shape[p] >= 128) { col = face; a = shape[p]; }
        else col = mixRgb(col!, face, shape[p] / 255);
      }
      if (col) {
        // the sticker's white edge, and its shadow on the plate
        if (stick[p]) { col = WHITE; a = 255; }
        else if (p >= shadowAt && stick[p - shadowAt]) col = mixRgb(col, BLACK, 0.3);
        o[p * 4] = col[0]; o[p * 4 + 1] = col[1]; o[p * 4 + 2] = col[2]; o[p * 4 + 3] = a;
      }
    }
  }
  c.putImageData(out, 0, 0);

  // full size: the plate scaled up, the picture on top at full sharpness
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

/**
 * The standee's levels in a floor's light: multiplied by `light` so the white sticker edge and the bright paint take
 * the room's cast, as torchlight or the crypt's cold would. Kept for one light at a time: a floor change remakes it.
 */
export function litLevels(b: Standee, light: string): HTMLCanvasElement[] {
  if (b.lit?.light === light) return b.lit.levels;
  const levels = b.levels.map(lv => {
    const cv = document.createElement('canvas');
    cv.width = lv.width;
    cv.height = lv.height;
    const c = cv.getContext('2d')!;
    c.drawImage(lv, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = light;
    c.fillRect(0, 0, cv.width, cv.height);
    // multiplying fills the empty corners too; the picture's own outline cuts them away again
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(lv, 0, 0);
    return cv;
  });
  b.lit = { light, levels };
  return levels;
}
