// Isometric camera with free rotation and zoom.
//
// World space: the room floor, x/y in world units (a tile is 16), h is height.
// Iso space: world rotated around the room centre, then projected to the classic 2:1 iso plane.
// Screen space: CSS pixels, iso * zoom + pan.
//
// Once fitted to a room, the view is held to it: never smaller than fitting the screen, and however far it is dragged,
// a piece of the floor stays on screen to drag it back by.

export const KX = 0.9;
export const KY = 0.45;
/** Share of the screen area the room fills at the fit: a little margin all round. */
export const FIT = 0.96;
/** How deep the floor reaches into the screen area at the least, however far the view is dragged: share of the area's shorter side. */
export const KEEP = 0.2;

export type Vec = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }

export class Camera {
  rot = 0;
  zoom = 1;
  panX = 0;
  panY = 0;
  cx = 0;
  cy = 0;
  minZoom = 0.3;
  maxZoom = 12;
  private c = 1;
  private s = 0;
  /** The room and the screen area it is held to, from the last fit; until then the view goes anywhere. */
  private room: { Wx: number; Wy: number; wallH: number; rect: Rect } | null = null;

  setRot(r: number) {
    this.rot = ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.c = Math.cos(this.rot);
    this.s = Math.sin(this.rot);
  }

  /** World point to iso space (unscaled). */
  iso(x: number, y: number, h = 0): Vec {
    const dx = x - this.cx, dy = y - this.cy;
    const rx = dx * this.c - dy * this.s, ry = dx * this.s + dy * this.c;
    return [(rx - ry) * KX, (rx + ry) * KY - h];
  }

  /** Painter's-order key: larger is nearer to the viewer. */
  depth(x: number, y: number): number {
    const dx = x - this.cx, dy = y - this.cy;
    return dx * (this.c + this.s) + dy * (this.c - this.s);
  }

  /** How much a world-space direction points toward the viewer (positive) or away (negative). */
  facing(nx: number, ny: number): number {
    return nx * (this.c + this.s) + ny * (this.c - this.s);
  }

  /** Screen-x component of a world direction after projection, used for side lighting. */
  sideways(nx: number, ny: number): number {
    const rx = nx * this.c - ny * this.s, ry = nx * this.s + ny * this.c;
    return (rx - ry) / Math.SQRT2;
  }

  isoToWorld(ix: number, iy: number): Vec {
    const a = ix / KX, b = iy / KY;
    const rx = (a + b) / 2, ry = (b - a) / 2;
    return [rx * this.c + ry * this.s + this.cx, -rx * this.s + ry * this.c + this.cy];
  }

  screenToIso(sx: number, sy: number): Vec {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  isoToScreen(ix: number, iy: number): Vec {
    return [ix * this.zoom + this.panX, iy * this.zoom + this.panY];
  }

  screenToWorld(sx: number, sy: number): Vec {
    return this.isoToWorld(...this.screenToIso(sx, sy));
  }

  /** Zoom by factor k keeping the screen point (sx, sy) fixed, as far as the room allows. */
  zoomAt(k: number, sx: number, sy: number) {
    const z = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * k));
    const f = z / this.zoom;
    this.panX = sx - (sx - this.panX) * f;
    this.panY = sy - (sy - this.panY) * f;
    this.zoom = z;
    this.clamp();
  }

  /** Change rotation keeping the floor point under (sx, sy) fixed on screen, as far as the room allows. */
  rotateAt(rot: number, sx: number, sy: number) {
    let [wx, wy] = this.screenToWorld(sx, sy);
    // a room dragged aside turns about its point nearest to (sx, sy) rather than swinging round it
    if (this.room) {
      wx = Math.min(this.room.Wx, Math.max(0, wx));
      wy = Math.min(this.room.Wy, Math.max(0, wy));
      [sx, sy] = this.isoToScreen(...this.iso(wx, wy));
    }
    this.setRot(rot);
    const [ix, iy] = this.iso(wx, wy);
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
    this.clamp();
  }

  /** Put world point (wx, wy) under screen point (sx, sy), as far as the room allows. */
  pinWorld(wx: number, wy: number, sx: number, sy: number) {
    const [ix, iy] = this.iso(wx, wy);
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
    this.clamp();
  }

  /** Move the view by (dx, dy) screen pixels, as far as the room allows. */
  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.clamp();
  }

  /** Fit a room of size Wx×Wy with walls of height wallH into the given screen rectangle, and hold the view to it from now on. */
  fit(Wx: number, Wy: number, wallH: number, rect: Rect) {
    this.cx = Wx / 2;
    this.cy = Wy / 2;
    this.room = { Wx, Wy, wallH, rect };
    this.zoom = this.minZoom = this.fitZoom();
    this.maxZoom = this.zoom * 5;
    const [x0, y0, x1, y1] = this.box();
    this.panX = rect.x + rect.w / 2 - ((x0 + x1) / 2) * this.zoom;
    this.panY = rect.y + rect.h / 2 - ((y0 + y1) / 2) * this.zoom;
    this.clamp();
  }

  /** The room's outline on the iso plane at the current rotation, walls and the base under the floor included: x0, y0, x1, y1. */
  private box() {
    const { Wx, Wy, wallH } = this.room!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[0, 0], [Wx, 0], [Wx, Wy], [0, Wy]]) {
      for (const h of [-10, wallH + 6]) {
        const [ix, iy] = this.iso(x, y, h);
        x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); y0 = Math.min(y0, iy); y1 = Math.max(y1, iy);
      }
    }
    return [x0, y0, x1, y1];
  }

  /** The zoom at which the whole room just fits its screen area at the current rotation, with a margin. */
  private fitZoom() {
    const r = this.room!.rect, [x0, y0, x1, y1] = this.box();
    return Math.min(r.w / (x1 - x0), r.h / (y1 - y0)) * FIT;
  }

  /**
   * Hold the view to the room after a pan, zoom or turn: never smaller than fitting the screen area (the least zoom
   * follows the rotation, since a turned room takes up more or less of the screen, and a view zoomed all the way out
   * stays so), and dragged no further than leaves some of the floor reaching KEEP into the area, so the room is never
   * lost. The pans that do are the area shrunk by that depth less the floor (a convex polygon), and a pan outside them
   * goes to the nearest one. Everything changes smoothly with the zoom and the angle, so holding never makes the view jump.
   */
  clamp() {
    const R = this.room;
    if (!R) return;
    const out = this.zoom <= this.minZoom * (1 + 1e-9);
    this.minZoom = this.fitZoom();
    const z = (this.zoom = out ? this.minZoom : Math.min(Math.max(this.minZoom, this.maxZoom), Math.max(this.minZoom, this.zoom)));
    const r = R.rect, m = Math.min(r.w, r.h) * KEEP, pans: Vec[] = [];
    for (const [ax, ay] of [[r.x + m, r.y + m], [r.x + r.w - m, r.y + m], [r.x + r.w - m, r.y + r.h - m], [r.x + m, r.y + r.h - m]])
      for (const [x, y] of [[0, 0], [R.Wx, 0], [R.Wx, R.Wy], [0, R.Wy]]) {
        const [ix, iy] = this.iso(x, y);
        pans.push([ax - ix * z, ay - iy * z]);
      }
    [this.panX, this.panY] = nearestIn(hull(pans), [this.panX, this.panY]);
  }
}

/** Convex hull of the points, counter-clockwise. */
function hull(ps: Vec[]): Vec[] {
  ps = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (qs: Vec[]) => {
    const h: Vec[] = [];
    for (const p of qs) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return half(ps).concat(half(ps.reverse()));
}

/** The point of the convex polygon H (counter-clockwise) nearest to p: p itself when it is inside. */
function nearestIn(H: Vec[], p: Vec): Vec {
  let inside = true, best = p, bd = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ey = b[1] - a[1];
    if (ex * (p[1] - a[1]) - ey * (p[0] - a[0]) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    const q: Vec = [a[0] + ex * t, a[1] + ey * t], d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return inside ? p : best;
}
