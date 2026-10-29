// Pointer, wheel and keyboard input on the playfield.
//
// One finger or the left mouse button: before the fight, drag a hero onto another rune
// (or tap a rune to move the selected hero there); during the fight, drag a hero to aim
// (pull back like a slingshot); drag empty floor to pan.
// Two fingers: pinch to zoom, twist to rotate. Mouse: wheel zooms, right-drag or Shift+wheel rotates.

import type { Camera } from './camera';
import type { Game, HeroState } from './game';
import type { Aim, Carry } from './draw/scene';

export interface ViewControls {
  rotateBy: (delta: number) => void;
  zoomBy: (k: number) => void;
  fit: () => void;
  center: () => [number, number];
  changed: () => void;
}

type Mode = 'none' | 'aim' | 'carry' | 'pan' | 'rotate' | 'gesture';

interface Gesture { wx: number; wy: number; d0: number; a0: number; z0: number; r0: number }

const MAX_PULL = 60;

export class Input {
  aim: Aim | null = null;
  /** Hero being dragged to another rune during placement. */
  carry: Carry | null = null;
  private pts = new Map<number, [number, number]>();
  private mode: Mode = 'none';
  private start = { x: 0, y: 0, rot: 0 };
  private gesture: Gesture | null = null;

  constructor(private cv: HTMLCanvasElement, private cam: Camera, private g: Game, private view: ViewControls) {
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', e => this.up(e, true));
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => this.wheel(e), { passive: false });
    window.addEventListener('keydown', e => this.key(e));
  }

  private pos(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Hero whose miniature is under the screen point. */
  heroAt(sx: number, sy: number): HeroState | null {
    const { cam, g } = this, S = g.S;
    let best: HeroState | null = null, bd = Infinity;
    for (const h of S.heroes) {
      const p = g.figureAt(h);
      if (!p || h.hp <= 0) continue;
      const [fx, fy] = cam.isoToScreen(...cam.iso(p.x, p.y, 16 + p.lift));
      const rx = Math.max(20, 13 * cam.zoom), ry = Math.max(26, 22 * cam.zoom);
      const d = ((sx - fx) / rx) ** 2 + ((sy - fy) / ry) ** 2;
      if (d < 1 && d < bd) { bd = d; best = h; }
    }
    return best;
  }

  padAt(sx: number, sy: number): number {
    const { cam, g } = this;
    let best = -1, bd = Infinity;
    g.S.pads.forEach((p, k) => {
      const [px, py] = cam.isoToScreen(...cam.iso(p.x, p.y));
      const rx = Math.max(24, 14 * cam.zoom), ry = Math.max(18, 8 * cam.zoom);
      const d = ((sx - px) / rx) ** 2 + ((sy - py) / ry) ** 2;
      if (d < 1 && d < bd) { bd = d; best = k; }
    });
    return best;
  }

  private beginPan(x: number, y: number) {
    this.mode = 'pan';
    this.start = { x, y, rot: this.cam.rot };
  }

  private beginGesture() {
    const [a, b] = [...this.pts.values()];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const [wx, wy] = this.cam.screenToWorld(mx, my);
    this.gesture = {
      wx, wy, d0: Math.max(10, Math.hypot(b[0] - a[0], b[1] - a[1])), a0: Math.atan2(b[1] - a[1], b[0] - a[0]),
      z0: this.cam.zoom, r0: this.cam.rot,
    };
    this.mode = 'gesture';
    this.aim = null;
    this.carry = null;
  }

  private down(e: PointerEvent) {
    const [x, y] = this.pos(e);
    this.pts.set(e.pointerId, [x, y]);
    this.cv.setPointerCapture(e.pointerId);
    if (this.pts.size === 2) { this.beginGesture(); return; }
    if (this.pts.size > 2) return;
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.mode = 'rotate';
      this.start = { x, y, rot: this.cam.rot };
      return;
    }
    if (e.button === 1) { this.beginPan(x, y); return; }
    const g = this.g, S = g.S;
    if (S.phase === 'throw' || S.phase === 'place') {
      const h = this.heroAt(x, y);
      if (h) {
        if (g.canControl(h)) {
          g.select(h.i);
          if (g.canThrow(h)) { this.mode = 'aim'; this.aim = { hero: h, dx: 0, dy: 0 }; this.cv.dataset.cur = 'aim'; return; }
          if (S.phase === 'place') { this.mode = 'carry'; this.carry = { hero: h, x, y, pad: h.pad, moved: false }; this.cv.dataset.cur = 'grabbing'; return; }
          this.mode = 'none';
          return;
        }
      }
      const pi = this.padAt(x, y);
      if (pi >= 0 && g.movePad(g.hero, pi)) { this.mode = 'none'; return; }
    }
    this.beginPan(x, y);
  }

  private move(e: PointerEvent) {
    const [x, y] = this.pos(e);
    if (!this.pts.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.cv.dataset.cur = this.heroAt(x, y) || this.padAt(x, y) >= 0 ? 'hand' : '';
      return;
    }
    this.pts.set(e.pointerId, [x, y]);
    const cam = this.cam;
    if (this.mode === 'aim' && this.aim) {
      const p = this.g.spot(this.aim.hero)!, [wx, wy] = cam.screenToWorld(x, y);
      let dx = p.x - wx, dy = p.y - wy;
      const L = Math.hypot(dx, dy);
      if (L > MAX_PULL) { dx *= MAX_PULL / L; dy *= MAX_PULL / L; }
      this.aim.dx = dx;
      this.aim.dy = dy;
    } else if (this.mode === 'carry' && this.carry) {
      const C = this.carry;
      if (Math.hypot(x - C.x, y - C.y) > 6) C.moved = true;
      C.x = x;
      C.y = y;
      const pi = this.padAt(x, y);
      C.pad = pi >= 0 ? pi : null;
    } else if (this.mode === 'pan') {
      // step by step, so at the room's edge a drag back moves the room again at once
      cam.panBy(x - this.start.x, y - this.start.y);
      this.start.x = x;
      this.start.y = y;
      this.cv.dataset.cur = 'grabbing';
      this.view.changed();
    } else if (this.mode === 'rotate') {
      const [cx, cy] = this.view.center();
      cam.rotateAt(this.start.rot + (x - this.start.x) * 0.01, cx, cy);
      this.start.x = x;
      this.start.rot = cam.rot;
      this.view.changed();
    } else if (this.mode === 'gesture' && this.gesture && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()], G = this.gesture;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      cam.zoom = Math.min(cam.maxZoom, Math.max(cam.minZoom, (G.z0 * d) / G.d0));
      cam.setRot(G.r0 + ang - G.a0);
      cam.pinWorld(G.wx, G.wy, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      this.view.changed();
    }
  }

  private up(e: PointerEvent, cancel = false) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.mode === 'aim' && this.aim) {
      if (!cancel) this.g.throwDisc(this.aim.hero, this.aim.dx, this.aim.dy);
      this.aim = null;
    }
    if (this.mode === 'carry' && this.carry) {
      const C = this.carry;
      if (!cancel && C.moved && C.pad !== null) this.g.movePad(C.hero, C.pad);
      this.carry = null;
    }
    if (this.mode === 'gesture' && this.pts.size === 1) {
      const [p] = [...this.pts.values()];
      this.beginPan(p[0], p[1]);
      return;
    }
    if (this.pts.size === 0) {
      this.mode = 'none';
      this.cv.dataset.cur = '';
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    if (e.shiftKey) {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      this.cam.rotateAt(this.cam.rot + d * 0.004, x, y);
    } else {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      this.cam.zoomAt(k, x, y);
    }
    this.view.changed();
  }

  private key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'й') this.view.rotateBy(-Math.PI / 4);
    else if (k === 'e' || k === 'у') this.view.rotateBy(Math.PI / 4);
    else if (k === '+' || k === '=') this.view.zoomBy(1.25);
    else if (k === '-' || k === '_') this.view.zoomBy(0.8);
    else if (k === '0' || k === 'home') this.view.fit();
    else return;
    e.preventDefault();
  }
}
