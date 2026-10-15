// Draws one frame of a room: walls, floor, obstacles, resources, discs and miniatures.
// Everything is drawn in iso space through the camera, so zoom and rotation are free.

import { HERO_FIG, INK, ENEMY_BASE, MOBS, WALL_H, TILE, isRanged } from '../data';
import type { Camera, Vec } from '../camera';
import { cutWay, type Disc, type Game, type HeroState } from '../game';
import { floorAt, hazKey, isFloor, type Block, type Edge, type Mob, type ResNode } from '../room';
import { BASE_TH, MOB_TOP, drawHeroFigure, drawMiniature, drawMobFigure } from './figures';
import { circ, ell, fs, lg, mix, pth, rr, type Ctx, type Pt } from './util';
import { settings } from '../settings';

export interface Aim { hero: HeroState; dx: number; dy: number }
/** A hero dragged to another rune: pointer position in screen pixels and the rune under it. */
export interface Carry { hero: HeroState; x: number; y: number; pad: number | null; moved: boolean }


const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Label and colour of an enemy's special intent badge. */
const INTENT_PILL: Record<'charge' | 'slam' | 'heal' | 'summon' | 'heat', (dmg: number, chill: boolean) => [string, string]> = {
  charge: () => ['фитиль', '#8a5a2b'],
  slam: (d, chill) => [(chill ? 'метель ' : 'всем ') + d, chill ? '#3f7fa8' : '#b8323f'],
  heal: d => ['лечит ' + d, '#3c8a52'],
  summon: () => ['призыв', '#6b4fa8'],
  heat: () => ['жар', '#c2501f'],
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

    this.drawLips();
    this.drawFloor();

    const items: [number, () => void][] = [];
    for (const d of S.discs) if (!d.gone) items.push([cam.depth(d.x, d.y), () => this.drawDisc(d)]);
    for (const hs of S.heroes) if (hs.pad !== null) { const p = S.pads[hs.pad]; items.push([cam.depth(p.x, p.y) + 2, () => this.drawHero(hs)]); }
    const cr = this.carry;
    if (cr) {
      const [wx, wy] = cam.screenToWorld(cr.x, cr.y);
      items.push([cam.depth(wx, wy) + 2, () => this.drawHero(cr.hero, { x: wx, y: wy })]);
    }
    for (const m of S.mobs) if (m.dead <= 1) items.push([cam.depth(m.x, m.y), () => this.drawMob(m)]);
    for (const b of S.blocks) items.push([cam.depth(b.x0 + 8, b.y0 + 8), () => this.drawBlock(b)]);
    for (const n of S.nodes) items.push([cam.depth(n.x, n.y), () => this.drawNode(n)]);
    this.wallItems(items);
    items.sort((a, b) => a[0] - b[0]).forEach(i => i[1]());

    this.drawOmens();
    this.drawTelegraph();
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
      c.fillStyle = lg(c, 0, Math.min(A[1], Bp[1]), 0, Math.max(A[1], Bp[1]) + 9, this.shade([e.nx, e.ny], B.w), '#1e1712');
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 1.2;
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
    pth(c, [A, Bp, Bt, At]);
    c.fillStyle = lg(c, 0, Math.min(At[1], Bt[1]), 0, Math.max(A[1], Bp[1]), mix(base, '#ffffff', 0.08), mix(base, '#000000', 0.3));
    c.fill();
    // brick courses, joints placed by world coordinate so they line up across pieces
    const along = e.nx !== 0, u0 = along ? ay : ax;
    const at = (u: number, h: number) => (along ? P(ax, u, h) : P(u, ay, h));
    c.strokeStyle = 'rgba(20,12,8,.35)';
    c.lineWidth = 0.8;
    c.beginPath();
    for (let r = 1; r <= 4; r++) {
      const hh = r * 8.5;
      if (r < 4) { c.moveTo(...P(ax, ay, hh)); c.lineTo(...P(bx, by, hh)); }
      for (let u = u0 + (r % 2) * 8; u < u0 + TILE; u += 16) { c.moveTo(...at(u, hh - 8.5)); c.lineTo(...at(u, Math.min(hh, H))); }
    }
    c.stroke();
    pth(c, [At, Bt, P(bx, by, H + 4), P(ax, ay, H + 4)]);
    c.fillStyle = B.cap;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(...At); c.lineTo(...Bt);
    c.moveTo(...P(ax, ay, H + 4)); c.lineTo(...P(bx, by, H + 4));
    if (!e.contA) { c.moveTo(...A); c.lineTo(...P(ax, ay, H + 4)); }
    if (!e.contB) { c.moveTo(...Bp); c.lineTo(...P(bx, by, H + 4)); }
    c.stroke();
    // a torch on every fourth piece of wall, a banner now and then
    const k = along ? e.j : e.i;
    const [mx, my] = P((ax + bx) / 2, (ay + by) / 2, 30);
    if (k % 4 === 2) this.drawTorch(...P((ax + bx) / 2, (ay + by) / 2, 20), ax + ay);
    else if (k % 4 === 0 && (e.i + e.j) % 3 === 0) {
      pth(c, [[mx - 5, my], [mx + 5, my], [mx + 5, my + 16], [mx, my + 12], [mx - 5, my + 16]]);
      fs(c, lg(c, 0, my, 0, my + 16, '#a8323f', '#5e1a24'), 1);
      circ(c, mx, my + 6, 2.2);
      fs(c, '#d9b24a', 0.8);
    }
  }

  private drawTorch(sx: number, sy: number, seed: number) {
    const c = this.c, B = this.g.S.biome, fl = reduce ? 1 : 0.9 + Math.sin(this.t * 11 + seed) * 0.08;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.glowSprite(B.torch), sx - 50 * fl, sy - 50 * fl, 100 * fl, 100 * fl);
    c.restore();
    rr(c, sx - 1.5, sy - 1, 3, 7, 1); fs(c, '#6b4a2e', 0.8);
    c.beginPath(); c.moveTo(sx, sy - 8 * fl); c.quadraticCurveTo(sx + 4, sy - 2, sx, sy); c.quadraticCurveTo(sx - 4, sy - 2, sx, sy - 8 * fl); fs(c, '#ff9a3d', 0.8);
    c.beginPath(); c.moveTo(sx, sy - 5 * fl); c.quadraticCurveTo(sx + 2, sy - 1.5, sx, sy - 0.5); c.quadraticCurveTo(sx - 2, sy - 1.5, sx, sy - 5 * fl); c.fillStyle = '#ffe680'; c.fill();
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
    c.fillStyle = B.g;
    c.fill();
    const inner = (i: number, j: number) => quad(i * TILE + gap, j * TILE + gap, (i + 1) * TILE - gap, (j + 1) * TILE - gap);
    for (const alt of [0, 1]) {
      c.beginPath();
      for (const [i, j] of cells) if (((i * 7 + j * 3) % 5 === 0 ? 1 : 0) === alt) inner(i, j);
      c.fillStyle = B.f[alt];
      c.fill();
    }
    c.beginPath();
    for (const [i, j] of cells) inner(i, j);
    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.lineWidth = 0.7;
    c.stroke();
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
    for (const [i, j] of hazard) {
      const x0 = i * TILE + gap, y0 = j * TILE + gap, x1 = (i + 1) * TILE - gap, y1 = (j + 1) * TILE - gap;
      const q: Pt[] = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
      pth(c, q);
      const ys = q.map(p => p[1]);
      c.fillStyle = B.haz === 'lava' ? lg(c, 0, Math.min(...ys), 0, Math.max(...ys), '#ffb347', '#e0461f') : '#55473e';
      c.fill();
      if (B.haz === 'lava') {
        for (let k = 0; k < 2; k++) {
          const ph = (t * 0.8 + i * 0.37 + j * 0.51 + k * 0.5) % 1;
          const [bx, by] = P(i * TILE + 5 + k * 6, j * TILE + 6 + k * 4);
          circ(c, bx, by, 0.6 + ph * 1.8);
          c.fillStyle = `rgba(255,236,150,${1 - ph})`;
          c.fill();
        }
      } else {
        for (const [ox, oy] of [[5, 5], [11, 6], [7, 11], [12, 12]]) {
          const [sx, sy] = P(i * TILE + ox, j * TILE + oy);
          pth(c, [[sx - 1.8, sy], [sx + 1.8, sy], [sx, sy - 5]]);
          fs(c, lg(c, sx - 2, 0, sx + 2, 0, '#eef0f8', '#9aa0bb'), 0.7);
        }
      }
    }
    for (const dc of S.decals) {
      const [dx, dy] = P(dc.x, dc.y);
      if (dc.k === 0) { ell(c, dx, dy, 7, 3); c.fillStyle = 'rgba(25,15,10,.22)'; c.fill(); }
      else if (dc.k === 1) { c.strokeStyle = 'rgba(25,15,10,.45)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(dx - 5, dy); c.lineTo(dx - 1, dy + 1.5); c.lineTo(dx + 1, dy - 1); c.lineTo(dx + 5, dy + 0.5); c.stroke(); }
      else {
        c.save(); c.translate(dx, dy); c.rotate(dc.a + this.cam.rot);
        rr(c, -4, -0.7, 8, 1.4, 0.7); fs(c, '#d9cfb4', 0.6);
        for (const [bx, by] of [[-4, -0.9], [-4, 0.9], [4, -0.9], [4, 0.9]]) { circ(c, bx, by, 1); fs(c, '#d9cfb4', 0.5); }
        c.restore();
      }
    }
    // the locked wing lies in the dark until its door opens
    if (S.wing.length && !g.secOpen(1)) {
      c.beginPath();
      for (const k of S.wing) { const i = k % S.gw, j = (k - i) / S.gw; quad(i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE); }
      c.fillStyle = 'rgba(8,5,3,.5)';
      c.fill();
    }
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    c.beginPath();
    for (const e of S.edges) { c.moveTo(...P(...e.a)); c.lineTo(...P(...e.b)); }
    c.stroke();
    for (const p of S.pits) {
      const [sx, sy] = P(p.x, p.y);
      ell(c, sx, sy, p.r * 1.27 + 1.5, p.r * 0.64 + 1); fs(c, '#2e2620', 1.1);
      ell(c, sx, sy + 0.5, p.r * 1.2, p.r * 0.58); c.fillStyle = '#070403'; c.fill();
    }
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
    // throw runes
    const h = g.hero, mine = g.canControl(h), cr = this.carry;
    S.pads.forEach((p, k) => {
      const occ = S.heroes.find(o => o.pad === k && o.hp > 0), [sx, sy] = P(p.x, p.y);
      const kind = mine && !occ ? g.moveKind(h, k) : null, on = kind === 'free', pulse = reduce ? 0.8 : 0.6 + Math.sin(t * 5) * 0.3;
      if (p.sec && !g.secOpen(p.sec)) {
        // a rune behind the closed door: dim, with a padlock
        ell(c, sx, sy, 13, 6.5);
        c.lineWidth = 1.2;
        c.strokeStyle = 'rgba(255,214,90,.22)';
        c.stroke();
        c.lineWidth = 1;
        c.strokeStyle = '#8d8478';
        c.beginPath(); c.arc(sx, sy - 5, 2.4, Math.PI, 0); c.stroke();
        rr(c, sx - 3.6, sy - 5, 7.2, 5.6, 1); fs(c, '#8d8478', 0.8);
        return;
      }
      if (kind === 'disc') {
        // the way through the door is open: stepping here costs one of this turn's discs
        ell(c, sx, sy, 13, 6.5);
        c.fillStyle = `rgba(120,200,255,${0.3 * pulse})`;
        c.fill();
        c.lineWidth = 1.4;
        c.strokeStyle = `rgba(120,200,255,${pulse})`;
        c.stroke();
        c.font = 'bold 6px system-ui, sans-serif';
        c.textAlign = 'center';
        c.lineWidth = 2;
        c.strokeStyle = INK;
        c.strokeText('−1 диск', sx, sy + 13);
        c.fillStyle = '#bfe6ff';
        c.fillText('−1 диск', sx, sy + 13);
        return;
      }
      if (cr && cr.pad === k && cr.hero.pad !== k) {
        ell(c, sx, sy, 17, 8.5);
        c.fillStyle = cr.hero.def.col + '66';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#ffd65a';
        c.stroke();
      }
      ell(c, sx, sy, 13, 6.5);
      c.fillStyle = occ ? occ.def.col + '55' : on ? `rgba(255,214,90,${0.35 * pulse})` : 'rgba(255,214,90,.12)';
      c.fill();
      c.lineWidth = 1.4;
      c.strokeStyle = occ ? occ.def.col : on ? `rgba(255,214,90,${pulse})` : 'rgba(255,214,90,.4)';
      c.stroke();
      ell(c, sx, sy, 8, 4);
      c.lineWidth = 0.8;
      c.stroke();
    });
  }

  /** Glowing summon circles and tiles about to turn to lava, a turn ahead; drawn over the figures so nothing hides them. */
  private drawOmens() {
    const { c, P, g } = this;
    const S = g.S;
    if (S.phase === 'over' || (S.phase === 'enemy' && S.attacked)) return;
    const pulse = reduce ? 0.7 : 0.55 + 0.35 * Math.sin(this.t * 4);
    for (const m of g.liveMobs()) {
      const it = m.intent;
      if (!it?.spots) continue;
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

  private drawTelegraph() {
    const { c, P, g } = this;
    const S = g.S;
    if ((S.phase !== 'throw' && S.phase !== 'place') || !settings.attackLines) return;
    // drawn over the figures, faint, so it never hides them but is never hidden by them either
    c.save();
    c.lineCap = 'round';
    const lw = Math.max(1.4, 2.4 / this.cam.zoom);
    const lines: { m: Mob; to: { x: number; y: number }; col: string }[] = [];
    for (const m of g.liveMobs()) {
      const it = m.intent;
      if (!it) continue;
      if (it.way && (it.t === 'hit' || it.t === 'move')) continue;
      if (it.t === 'hit') {
        const hero = g.heroOf(it.hero);
        if (hero.pad !== null) lines.push({ m, to: S.pads[hero.pad], col: isRanged(m.k) ? 'rgba(150,235,120,.9)' : 'rgba(255,90,115,.9)' });
      } else if (it.t === 'slam') {
        for (const h of g.alive()) if (h.pad !== null) lines.push({ m, to: S.pads[h.pad], col: it.chill ? 'rgba(170,225,255,.95)' : 'rgba(255,211,77,.95)' });
      } else if (it.t === 'heal' && S.mobs[it.mob!]) lines.push({ m, to: S.mobs[it.mob!], col: 'rgba(123,227,154,.95)' });
    }
    for (const { m, to: p, col } of lines) {
      const [ax, ay] = P(m.x, m.y, 8), [bx, by] = P(p.x, p.y, 8);
      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 18, bx, by);
      c.setLineDash([]);
      c.strokeStyle = 'rgba(18,13,10,.5)';
      c.lineWidth = lw + 1.6;
      c.stroke();
      c.setLineDash([lw * 2.5, lw * 2]);
      c.lineDashOffset = reduce ? 0 : -this.t * 12;
      c.strokeStyle = col;
      c.lineWidth = lw;
      c.stroke();
    }
    this.drawRoutes(lw);
    c.restore();
  }

  /**
   * Walkers' routes to the rune they go for: the stretch they walk this turn is bright, the rest faint,
   * with a ring where they stop. A walker that strikes this turn lights the rune it will hit.
   */
  private drawRoutes(lw: number) {
    const { c, P, g } = this;
    const S = g.S, pulse = reduce ? 0.8 : 0.6 + 0.3 * Math.sin(this.t * 5);
    const line = (w: { x: number; y: number }[], col: string, width: number, dash: number[]) => {
      if (w.length < 2) return;
      c.beginPath();
      w.forEach((p, k) => { const [x, y] = P(p.x, p.y, 1); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
      c.setLineDash(dash);
      c.strokeStyle = col;
      c.lineWidth = width;
      c.stroke();
    };
    for (const m of g.liveMobs()) {
      const it = m.intent;
      if (!it?.way || (it.t !== 'hit' && it.t !== 'move')) continue;
      const hero = g.heroOf(it.hero);
      if (hero.pad === null) continue;
      const now = cutWay(it.way, it.go ?? 0), stop = now[now.length - 1];
      line(it.way, 'rgba(18,13,10,.35)', lw + 1.2, []);
      line(it.way, 'rgba(255,90,115,.35)', lw, [lw * 1.5, lw * 2.5]);
      line(now, 'rgba(18,13,10,.5)', lw + 1.6, []);
      c.lineDashOffset = reduce ? 0 : -this.t * 12;
      line(now, 'rgba(255,90,115,.95)', lw, [lw * 2.5, lw * 2]);
      c.lineDashOffset = 0;
      c.setLineDash([]);
      if (it.go && it.go > 2) {
        const [x, y] = P(stop.x, stop.y);
        ell(c, x, y, m.r * 1.1, m.r * 0.55);
        c.strokeStyle = 'rgba(255,90,115,.8)'; c.lineWidth = 1; c.stroke();
      }
      if (it.t === 'hit') {
        const p = S.pads[hero.pad], [x, y] = P(p.x, p.y);
        ell(c, x, y, 13, 6.5);
        c.fillStyle = `rgba(217,67,79,${0.25 * pulse})`; c.fill();
        c.strokeStyle = `rgba(255,90,115,${pulse})`; c.lineWidth = 1.8; c.stroke();
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
      pth(c, [[x - r, y], [tx, ty], [x + r, y]]);
      fs(c, lg(c, x - r, 0, x + r, 0, '#eefaff', '#6fa9c2'), 0.9);
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

  /** The wing's door: a banded wooden slab filling its doorway, or a bare threshold once it swings open. */
  private drawDoor(b: Block) {
    const { c, P, cam } = this;
    if (b.open) {
      pth(c, [P(b.x0 + 1, b.y0 + 1), P(b.x1 - 1, b.y0 + 1), P(b.x1 - 1, b.y1 - 1), P(b.x0 + 1, b.y1 - 1)]);
      c.fillStyle = 'rgba(70,45,25,.55)';
      c.fill();
      return;
    }
    const H = 28, wood: [string, string] = ['#6b4526', '#8a5c34'];
    const faces: { a: Vec; b: Vec; n: Vec }[] = [
      { a: [b.x1, b.y0], b: [b.x1, b.y1], n: [1, 0] },
      { a: [b.x0, b.y1], b: [b.x1, b.y1], n: [0, 1] },
      { a: [b.x0, b.y0], b: [b.x0, b.y1], n: [-1, 0] },
      { a: [b.x0, b.y0], b: [b.x1, b.y0], n: [0, -1] },
    ];
    for (const f of faces) {
      if (cam.facing(f.n[0], f.n[1]) <= 1e-6) continue;
      const at = (u: number, h: number) => P(f.a[0] + (f.b[0] - f.a[0]) * u, f.a[1] + (f.b[1] - f.a[1]) * u, h);
      pth(c, [P(...f.a), P(...f.b), P(...f.b, H), P(...f.a, H)]);
      fs(c, this.shade(f.n, wood), 1.1);
      // planks
      c.strokeStyle = 'rgba(30,15,6,.55)';
      c.lineWidth = 0.6;
      c.beginPath();
      for (const u of [0.25, 0.5, 0.75]) { c.moveTo(...at(u, 0)); c.lineTo(...at(u, H)); }
      c.stroke();
      // iron bands and a ring
      c.strokeStyle = '#3a3633';
      c.lineWidth = 1.6;
      c.beginPath();
      for (const hh of [6, 21]) { c.moveTo(...at(0, hh)); c.lineTo(...at(1, hh)); }
      c.stroke();
      const [rx, ry] = at(0.5, 13);
      circ(c, rx, ry, 1.8);
      c.lineWidth = 0.9;
      c.strokeStyle = '#c9b48a';
      c.stroke();
    }
    pth(c, [P(b.x0, b.y0, H), P(b.x1, b.y0, H), P(b.x1, b.y1, H), P(b.x0, b.y1, H)]);
    fs(c, '#9a6a3e', 1.1);
  }

  private drawBlock(b: Block) {
    if (b.ice) return this.drawIcicle(b);
    if (b.door) return this.drawDoor(b);
    const { c, P, cam } = this;
    const B = this.g.S.biome, H = 24;
    const fp: Pt[] = [P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)];
    pth(c, fp.map(([x, y]) => [x + 4, y + 2.5] as Pt));
    c.fillStyle = 'rgba(15,8,4,.35)';
    c.fill();
    const faces: { a: Vec; b: Vec; n: Vec }[] = [
      { a: [b.x1, b.y0], b: [b.x1, b.y1], n: [1, 0] },
      { a: [b.x0, b.y1], b: [b.x1, b.y1], n: [0, 1] },
      { a: [b.x0, b.y0], b: [b.x0, b.y1], n: [-1, 0] },
      { a: [b.x0, b.y0], b: [b.x1, b.y0], n: [0, -1] },
    ];
    for (const f of faces) {
      if (cam.facing(f.n[0], f.n[1]) <= 1e-6) continue;
      pth(c, [P(...f.a), P(...f.b), P(...f.b, H), P(...f.a, H)]);
      fs(c, this.shade(f.n, B.w), 1.1);
      c.strokeStyle = 'rgba(20,12,8,.45)';
      c.lineWidth = 0.7;
      c.beginPath();
      const at = (u: number, h: number) => P(f.a[0] + (f.b[0] - f.a[0]) * u, f.a[1] + (f.b[1] - f.a[1]) * u, h);
      for (const hh of [8, 16]) { c.moveTo(...at(0, hh)); c.lineTo(...at(1, hh)); }
      for (const [u, h0] of [[0.5, 0], [0.25, 8], [0.75, 8], [0.5, 16]]) { c.moveTo(...at(u, h0)); c.lineTo(...at(u, h0 + 8)); }
      c.stroke();
    }
    pth(c, [P(b.x0, b.y0, H), P(b.x1, b.y0, H), P(b.x1, b.y1, H), P(b.x0, b.y1, H)]);
    fs(c, B.cap, 1.1);
    if (b.v & 1) {
      c.strokeStyle = 'rgba(20,12,8,.6)'; c.lineWidth = 0.7; c.beginPath();
      c.moveTo(...P(b.x0 + 3, b.y0 + 8, H)); c.lineTo(...P(b.x0 + 7, b.y0 + 9, H)); c.lineTo(...P(b.x0 + 9, b.y0 + 7, H)); c.lineTo(...P(b.x0 + 13, b.y0 + 9, H));
      c.stroke();
    }
    if (b.v & 2) { const [mx, my] = P(b.x0 + 4, b.y0 + 12, H); c.fillStyle = '#5d7a34'; ell(c, mx, my, 4, 1.4); c.fill(); }
    if (b.v & 4) {
      const [kx, ky] = P(b.x0 + 9, b.y0 + 7, H);
      ell(c, kx, ky - 1.5, 2.4, 2); fs(c, '#e3d8bc', 0.6);
      circ(c, kx - 0.8, ky - 1.7, 0.45); c.fillStyle = INK; c.fill(); circ(c, kx + 0.8, ky - 1.7, 0.45); c.fill();
    }
  }

  private drawNode(n: ResNode) {
    const { c, P } = this;
    const [x, y] = P(n.x, n.y);
    if (n.left <= 0) {
      ell(c, x, y, n.r * 1.1, n.r * 0.5); fs(c, '#5a4d48', 0.8);
      circ(c, x - 3, y - 1, 1.6); fs(c, '#7a6d68', 0.6);
      circ(c, x + 3, y, 1.3); fs(c, '#7a6d68', 0.6);
      return;
    }
    const f = n.hit > 0;
    ell(c, x + 1, y + 1, n.r * 1.3, n.r * 0.6); c.fillStyle = 'rgba(20,10,5,.35)'; c.fill();
    if (n.k === 'ore') {
      pth(c, [[x - 9, y], [x - 8, y - 7], [x - 3, y - 11], [x + 4, y - 10], [x + 9, y - 4], [x + 8, y]]);
      fs(c, f ? '#fff' : lg(c, 0, y - 11, 0, y, '#8f8a84', '#55504a'), 1.1);
      for (const [ox, oy, r] of [[-4, -6, 2.2], [2, -7, 1.8], [4, -3, 2], [-1, -2.5, 1.5]]) {
        pth(c, [[x + ox - r, y + oy], [x + ox, y + oy - r], [x + ox + r, y + oy], [x + ox, y + oy + r * 0.8]]);
        fs(c, f ? '#fff' : '#e8b44a', 0.7);
      }
    } else if (n.k === 'spk') {
      c.save(); c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(x, y - 8, 0, x, y - 8, 18);
      g.addColorStop(0, 'rgba(190,150,255,.4)'); g.addColorStop(1, 'rgba(190,150,255,0)');
      c.fillStyle = g; c.fillRect(x - 18, y - 26, 36, 36); c.restore();
      for (const [ox, w, hgt] of [[-5, 3, 9], [4, 3, 11], [0, 4, 16]]) {
        pth(c, [[x + ox - w, y - 1], [x + ox - w, y - hgt + 3], [x + ox, y - hgt], [x + ox + w, y - hgt + 3], [x + ox + w, y - 1]]);
        fs(c, f ? '#fff' : lg(c, x + ox - w, 0, x + ox + w, 0, '#d9c4ff', '#7a4fe0'), 1);
      }
    } else {
      rr(c, x - 1.5, y - 7, 3, 7, 1.2); fs(c, f ? '#fff' : '#f3ead8', 0.9);
      rr(c, x + 4, y - 4, 2.4, 4, 1); fs(c, '#f3ead8', 0.8);
      c.beginPath(); c.arc(x, y - 7, 6, Math.PI, 0); c.closePath(); fs(c, f ? '#fff' : lg(c, 0, y - 13, 0, y - 7, '#d9604f', '#9a3226'), 1);
      c.beginPath(); c.arc(x + 5.2, y - 4, 3.4, Math.PI, 0); c.closePath(); fs(c, '#d9604f', 0.9);
      for (const [ox, oy] of [[-2.5, -10], [1.8, -11], [2.8, -8.5], [5, -5.5]]) { circ(c, x + ox, y + oy, 0.9); c.fillStyle = '#f3ead8'; c.fill(); }
    }
    for (let k = 0; k < n.left; k++) {
      circ(c, x - (n.left - 1) * 2.5 + k * 5, y - 21, 1.6);
      fs(c, n.k === 'ore' ? '#e8b44a' : n.k === 'spk' ? '#c9a8ff' : '#7be39a', 0.7);
    }
  }

  private drawDisc(d: Disc) {
    const { c, P } = this;
    let s = 1, hh = 0;
    if (d.fall) { s = Math.max(0, 1 - d.fall * 2); hh = -d.fall * 20; }
    if (s <= 0) return;
    const col = d.hero.def.col, dk = d.hero.def.dk;
    const rx = d.r * 1.27 * s, ry = d.r * 0.64 * s, th = 3 * s, [x, y] = P(d.x, d.y, hh);
    if (!d.fall) { ell(c, x + 1, y + 1.5, rx + 0.5, ry + 0.5); c.fillStyle = 'rgba(20,10,5,.35)'; c.fill(); }
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI); c.lineTo(x - rx, y - th); c.ellipse(x, y - th, rx, ry, 0, Math.PI, 0, true); c.closePath(); fs(c, dk, 1);
    ell(c, x, y - th, rx, ry); fs(c, lg(c, x - rx, y - th - ry, x + rx, y - th + ry, mix(col, '#ffffff', 0.45), col), 1);
    ell(c, x, y - th, rx * 0.55, ry * 0.55); c.lineWidth = 0.8; c.strokeStyle = dk; c.stroke();
    c.save(); c.translate(x, y - th); c.scale(1, 0.5); c.rotate(d.spin); c.fillStyle = dk;
    if (d.hero.i === 0) { c.fillRect(-rx * 0.35, -rx * 0.1, rx * 0.7, rx * 0.2); c.fillRect(-rx * 0.1, -rx * 0.35, rx * 0.2, rx * 0.7); }
    else if (d.hero.i === 1) { c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 1.571; c.lineTo(Math.cos(a) * rx * 0.4, Math.sin(a) * rx * 0.4); c.lineTo(Math.cos(a + 0.785) * rx * 0.12, Math.sin(a + 0.785) * rx * 0.12); } c.fill(); }
    else { c.beginPath(); c.arc(0, 0, rx * 0.25, 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y - th, rx * 0.75, ry * 0.7, 0, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
    if (d.charged) { c.save(); c.globalCompositeOperation = 'lighter'; ell(c, x, y - th, rx + 2.5, ry + 1.8); c.fillStyle = 'rgba(184,147,255,.35)'; c.fill(); c.restore(); }
  }

  // ------------------------------------------------------------ miniatures

  private faceRight(fromX: number, fromY: number, toX: number, toY: number) {
    return this.P(toX, toY)[0] >= this.P(fromX, fromY)[0];
  }

  /** Draw a hero on its rune, or lifted at `at` while it is being carried to another rune. */
  private drawHero(h: HeroState, at?: { x: number; y: number }) {
    const { c, P, g } = this;
    const lifted = !!at, carried = !at && this.carry?.hero === h;
    const S = g.S, p = at ?? S.pads[h.pad!], [sx, sy0] = P(p.x, p.y), sy = sy0 - (lifted ? 8 : 0), dead = h.hp <= 0;
    const target = g.liveMobs()[0] ?? { x: S.Wx / 2, y: S.Wy / 2 };
    if (lifted) { ell(c, sx, sy0, 9, 4.5); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); }
    drawMiniature(c, {
      key: h.def.key, x: sx, y: sy, baseR: 9, baseCol: h.def.col, fig: HERO_FIG,
      faceRight: this.faceRight(p.x, p.y, target.x, target.y), flash: h.flash > 0, hop: 0,
      alpha: dead ? 0.45 : carried ? 0.3 : lifted ? 0.85 : 1,
      placeholder: (cc, x, y, fl) => drawHeroFigure(cc, h.i, x, y, 0.8, fl, this.t),
    });
    if (dead || carried) return;
    const top = sy - BASE_TH - HERO_FIG - 6;
    rr(c, sx - 9, top - 3, 18, 4, 2); fs(c, '#2a1f18', 0.8);
    rr(c, sx - 8.3, top - 2.3, (16.6 * Math.max(0, h.hp)) / h.max, 2.6, 1.3); c.fillStyle = '#d9434f'; c.fill();
    if (h.shield > 0) {
      c.beginPath(); c.moveTo(sx + 11, top - 4); c.lineTo(sx + 15, top - 4); c.lineTo(sx + 15, top - 1);
      c.quadraticCurveTo(sx + 13, top + 2, sx + 13, top + 2); c.quadraticCurveTo(sx + 11, top, sx + 11, top - 1); c.closePath();
      fs(c, '#3fc4b6', 0.8);
    }
    for (let k = 0; k < h.hand; k++) { ell(c, sx - 15 - k * 5, sy - 1, 3, 1.6); fs(c, h.def.col, 0.7); }
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
    const it = m.intent, th = it ? g.heroOf(it.hero) : null, tgt = th && th.pad !== null ? S.pads[th.pad] : { x: S.Wx, y: S.Wy };
    drawMiniature(c, {
      key: m.k, x, y, baseR: m.r, baseCol: ENEMY_BASE, fig: MOBS[m.k].fig,
      faceRight: this.faceRight(m.x, m.y, tgt.x, tgt.y), flash: m.flash > 0, hop: m.hop,
      alpha: m.dead ? Math.max(0, 1 - m.dead) : (1 - (m.born ?? 0)) * (m.hp > 0 && !g.solid(m) ? 0.35 : 1),
      placeholder: (cc, fx, fy, fl) => drawMobFigure(cc, m.k, fx, fy, fl),
    });
    if (m.hp <= 0) return;
    const top = y - m.hop - BASE_TH - MOB_TOP[m.k];
    if (m.burn > 0) {
      for (let k = 0; k < 3; k++) {
        const ph = (this.t * 1.5 + k / 3) % 1, fx = x - 5 + k * 5, fy = top + 14 - ph * 8;
        c.beginPath(); c.moveTo(fx, fy - 4); c.quadraticCurveTo(fx + 2, fy, fx, fy + 1); c.quadraticCurveTo(fx - 2, fy, fx, fy - 4);
        c.fillStyle = `rgba(255,140,60,${1 - ph})`; c.fill();
      }
    }
    const w = Math.max(14, m.r * 2.2);
    rr(c, x - w / 2, top, w, 3.6, 1.2); fs(c, '#2a1f18', 0.7);
    rr(c, x - w / 2 + 0.6, top + 0.6, ((w - 1.2) * Math.max(0, m.hp)) / m.max, 2.4, 0.8); c.fillStyle = '#d9434f'; c.fill();
    if (m.armor) { c.font = '600 6px Oswald, sans-serif'; c.textAlign = 'right'; c.fillStyle = '#d6cfbd'; c.fillText('бр ' + m.armor, x - w / 2 - 1.5, top + 3.8); }
    if (it && (S.phase === 'throw' || S.phase === 'place')) {
      const bx = x + w / 2 + 2, by = top - 3;
      if (it.t === 'hit') {
        pth(c, [[bx, by], [bx + 11, by], [bx + 11, by + 6], [bx + 5.5, by + 11], [bx, by + 6]]); fs(c, '#b8323f', 0.9);
        c.font = '600 7.5px Oswald, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(String(it.dmg), bx + 5.5, by + 7);
        circ(c, bx + 12, by + 1, 2); fs(c, g.heroOf(it.hero).def.col, 0.6);
      } else if (it.t === 'move') {
        const txt = it.eta ? '→ через ' + it.eta : '→';
        c.font = '600 6.5px Oswald, sans-serif';
        const tw = c.measureText(txt).width + 6;
        rr(c, bx, by + 1, tw, 8, 2); fs(c, '#d6cfbd', 0.85);
        c.textAlign = 'center'; c.fillStyle = INK; c.fillText(txt, bx + tw / 2, by + 7.2);
      } else {
        const [txt, col] = INTENT_PILL[it.t](it.dmg, !!it.chill);
        c.font = '600 6.5px Oswald, sans-serif';
        const tw = c.measureText(txt).width + 6;
        rr(c, bx, by + 1, tw, 8, 2); fs(c, col, 0.8);
        c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(txt, bx + tw / 2, by + 7.2);
      }
    }
    if (!g.solid(m) && m.hp > 0 && S.phase !== 'over') {
      c.font = '600 6px Oswald, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#d9f2ff';
      c.fillText('бесплотен', x, y + m.r * 0.64 + 8);
    }
  }

  // ------------------------------------------------------------ aim & effects

  private drawAim(aim: Aim | null) {
    if (!aim) return;
    const { c, P, g } = this;
    const h = aim.hero, p = g.S.pads[h.pad!], len = Math.hypot(aim.dx, aim.dy);
    if (len < 4) return;
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

  private drawFx() {
    const { c, P } = this;
    const S = this.g.S;
    for (const p of S.sparks) {
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
