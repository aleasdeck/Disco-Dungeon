// Isometric camera with free rotation and zoom.
//
// World space: the room floor, x/y in world units (a tile is 16), h is height.
// Iso space: world rotated around the room centre, then projected to the classic 2:1 iso plane.
// Screen space: CSS pixels, iso * zoom + pan.

export const KX = 0.9;
export const KY = 0.45;

export type Vec = [number, number];

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

  /** Zoom by factor k keeping the screen point (sx, sy) fixed. */
  zoomAt(k: number, sx: number, sy: number) {
    const z = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * k));
    const f = z / this.zoom;
    this.panX = sx - (sx - this.panX) * f;
    this.panY = sy - (sy - this.panY) * f;
    this.zoom = z;
  }

  /** Change rotation keeping the floor point under (sx, sy) fixed on screen. */
  rotateAt(rot: number, sx: number, sy: number) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.setRot(rot);
    const [ix, iy] = this.iso(wx, wy);
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
  }

  /** Put world point (wx, wy) under screen point (sx, sy). */
  pinWorld(wx: number, wy: number, sx: number, sy: number) {
    const [ix, iy] = this.iso(wx, wy);
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
  }

  /** Fit a room of size Wx×Wy with walls of height wallH into the given screen rectangle. */
  fit(Wx: number, Wy: number, wallH: number, rect: { x: number; y: number; w: number; h: number }) {
    this.cx = Wx / 2;
    this.cy = Wy / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[0, 0], [Wx, 0], [Wx, Wy], [0, Wy]]) {
      for (const h of [-10, wallH + 6]) {
        const [ix, iy] = this.iso(x, y, h);
        x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); y0 = Math.min(y0, iy); y1 = Math.max(y1, iy);
      }
    }
    const z = Math.min(rect.w / (x1 - x0), rect.h / (y1 - y0)) * 0.96;
    this.zoom = z;
    this.minZoom = z * 0.5;
    this.maxZoom = z * 5;
    this.panX = rect.x + rect.w / 2 - ((x0 + x1) / 2) * z;
    this.panY = rect.y + rect.h / 2 - ((y0 + y1) / 2) * z;
  }
}
