import { INK } from '../data';

export type Ctx = CanvasRenderingContext2D;
export type Pt = [number, number];

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Fill the current path and outline it in ink. */
export function fs(c: Ctx, fill: string | CanvasGradient, lw = 1.1) {
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lw;
  c.strokeStyle = INK;
  c.stroke();
}

export function ell(c: Ctx, x: number, y: number, rx: number, ry: number) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2);
}

export function circ(c: Ctx, x: number, y: number, r: number) {
  c.beginPath();
  c.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}

export function lg(c: Ctx, x0: number, y0: number, x1: number, y1: number, a: string, b: string) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

export function rg(c: Ctx, x: number, y: number, r: number, a: string, b: string) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

export function pth(c: Ctx, pts: Pt[]) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}

/** Beady caricature eye: lid 0..1 is how closed, look shifts the pupil. */
export function eye(c: Ctx, x: number, y: number, r: number, lid: number, look: number, s: number, lidCol = '#b98563') {
  ell(c, x, y, r, r * 1.05);
  fs(c, '#f4ead2', 0.7 * s);
  circ(c, x + look * r * 0.45, y + r * 0.15, r * 0.42);
  c.fillStyle = INK;
  c.fill();
  if (lid > 0) {
    c.beginPath();
    c.ellipse(x, y, r + 0.3 * s, r * 1.05 + 0.3 * s, 0, Math.PI, Math.PI + Math.PI * lid, false);
    c.lineTo(x, y);
    c.closePath();
    c.fillStyle = lidCol;
    c.fill();
    c.lineWidth = 0.7 * s;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(x - r - 0.3 * s, y - r * (1 - lid * 1.6));
    c.lineTo(x + r + 0.3 * s, y - r * (1 - lid * 1.6) + 0.4 * s);
    c.stroke();
  }
}

export function brow(c: Ctx, x0: number, y0: number, x1: number, y1: number, s: number, w = 1.3) {
  c.strokeStyle = INK;
  c.lineWidth = w * s;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

/** Mix two #rrggbb colours, t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, sh: number) => (p >> sh) & 255;
  const m = (sh: number) => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * t);
  return '#' + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1);
}
