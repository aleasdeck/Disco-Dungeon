// Procedural room generator. Pure: the same RoomSpec always yields the same layout.

import { BIOMES, MOB_HP_MUL, MOBS, NODES, TILE, type Biome, type MobKind, type NodeKind, type RoomType } from './data';
import { makeRng } from './rng';

export interface RoomSpec {
  seed: number;
  depth: number;
  floor: number;
  type: RoomType;
}

export interface Pad { x: number; y: number }
export interface Pit { x: number; y: number; r: number }
export interface Block { x0: number; y0: number; x1: number; y1: number; v: number }
export interface Decal { x: number; y: number; k: number; a: number }

export interface ResNode {
  k: NodeKind;
  name: string;
  r: number;
  ch: number;
  x: number;
  y: number;
  left: number;
  hit: number;
}

export interface Intent { t: 'hit' | 'move'; hero: number; dmg: number }

export interface Mob {
  k: MobKind;
  name: string;
  r: number;
  speed: number;
  reach: number;
  armor?: number;
  hp: number;
  max: number;
  dmg: number;
  x: number;
  y: number;
  flash: number;
  dead: number;
  burn: number;
  intent: Intent | null;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  hop: number;
}

export type Shape = 'rect' | 'corner' | 'funnel' | 'alcove' | 'cross';

/** A floor cell's edge that borders solid rock: walls are drawn and discs bounce here. */
export interface Edge {
  /** Cell coordinates of the floor cell. */
  i: number;
  j: number;
  /** Outward normal, one of the four axis directions. */
  nx: number;
  ny: number;
  /** World endpoints of the edge. */
  a: [number, number];
  b: [number, number];
  /** Whether the same wall continues past each end (no corner there). */
  contA: boolean;
  contB: boolean;
}

export interface Layout {
  gw: number;
  gh: number;
  shape: Shape;
  /** 1 where the cell is floor, row-major gw × gh. */
  floor: Uint8Array;
  edges: Edge[];
  /** Rock cells next to the floor, as boxes for collisions. */
  rock: Block[];
  Wx: number;
  Wy: number;
  biome: Biome;
  pads: Pad[];
  pits: Pit[];
  blocks: Block[];
  decals: Decal[];
  nodes: ResNode[];
  mobs: Mob[];
  haz: Set<string>;
  hpMul: number;
  dmgAdd: number;
}

export function newMob(k: MobKind, x: number, y: number, hpMul = 1, dmgAdd = 0): Mob {
  const d = MOBS[k];
  const hp = Math.round(d.hp * hpMul);
  return {
    k, name: d.name, r: d.r, speed: d.speed, reach: d.reach, armor: d.armor,
    hp, max: hp, dmg: d.dmg + dmgAdd, x, y, flash: 0, dead: 0, burn: 0, intent: null,
    fx: x, fy: y, tx: x, ty: y, hop: 0,
  };
}

export const hazKey = (tx: number, ty: number) => tx + ',' + ty;

export function isFloor(L: { gw: number; gh: number; floor: Uint8Array }, i: number, j: number) {
  return i >= 0 && j >= 0 && i < L.gw && j < L.gh && L.floor[j * L.gw + i] === 1;
}

/** Floor cell under a world point. */
export const floorAt = (L: { gw: number; gh: number; floor: Uint8Array }, x: number, y: number) =>
  isFloor(L, Math.floor(x / TILE), Math.floor(y / TILE));

const boxDist = (x: number, y: number, b: Block) => Math.hypot(x - Math.max(b.x0, Math.min(x, b.x1)), y - Math.max(b.y0, Math.min(y, b.y1)));

/** A circle of radius r at (x, y) lies on floor without touching rock or the room bounds. */
export function clearOfRock(L: Pick<Layout, 'gw' | 'gh' | 'floor' | 'rock' | 'Wx' | 'Wy'>, x: number, y: number, r: number) {
  return x > r && y > r && x < L.Wx - r && y < L.Wy - r && floorAt(L, x, y) && L.rock.every(b => boxDist(x, y, b) >= r);
}

function carve(gw: number, gh: number, R: ReturnType<typeof makeRng>, type: RoomType): { shape: Shape; floor: Uint8Array } {
  const floor = new Uint8Array(gw * gh).fill(1);
  const cut = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = Math.max(0, j0); j < Math.min(gh, j1); j++) for (let i = Math.max(0, i0); i < Math.min(gw, i1); i++) floor[j * gw + i] = 0;
  };
  // the near corner (large x and y) always stays: the throw runes live along the near edges
  const shapes: Shape[] = type === 'boss' ? ['rect', 'cross', 'funnel'] : ['rect', 'corner', 'corner', 'funnel', 'alcove', 'cross'];
  const shape = R.pick(shapes);
  if (shape === 'corner') {
    const cw = R.int(4, Math.floor(gw / 2)), ch = R.int(3, Math.floor(gh / 2));
    const which = R.int(0, 2);
    if (which === 0) cut(0, 0, cw, ch);
    else if (which === 1) cut(gw - cw, 0, gw, ch);
    else cut(0, gh - ch, cw, gh);
  } else if (shape === 'funnel') {
    cut(0, 0, R.int(3, 5), R.int(3, 4));
    cut(R.int(3, 4) + 5, 0, gw, R.int(2, 3));
    cut(0, R.int(3, 4) + 4, R.int(2, 3), gh);
  } else if (shape === 'alcove') {
    // a block of rock pushing into the room from a far wall
    if (R.next() < 0.5) { const j0 = R.int(3, gh - 7); cut(0, j0, R.int(3, 5), j0 + R.int(3, 4)); }
    else { const i0 = R.int(3, gw - 7); cut(i0, 0, i0 + R.int(3, 4), R.int(3, 5)); }
  } else if (shape === 'cross') {
    const c = R.int(2, 3), d = R.int(2, 3);
    cut(0, 0, c, d); cut(gw - c, 0, gw, d); cut(0, gh - d, c, gh); cut(gw - 2, gh - 2, gw, gh);
  }
  // small bites out of the far walls so even simple shapes look dug out
  if (shape !== 'rect') {
    for (let k = 0, n = R.int(1, 3); k < n; k++) {
      if (R.next() < 0.5) { const i = R.int(1, gw - 3); cut(i, 0, i + R.int(1, 2), 1); }
      else { const j = R.int(1, gh - 3); cut(0, j, 1, j + R.int(1, 2)); }
    }
  }
  return { shape, floor };
}

function buildEdges(gw: number, gh: number, floor: Uint8Array) {
  const L = { gw, gh, floor };
  const edges: Edge[] = [];
  const rockSet = new Set<string>();
  const rock: Block[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!isFloor(L, i, j)) continue;
    for (const [nx, ny] of dirs) {
      if (isFloor(L, i + nx, j + ny)) continue;
      const x0 = i * TILE, y0 = j * TILE;
      // edge endpoints run along the tangent (ty, tx) so that a→b is consistent per direction
      const a: [number, number] = nx === 1 ? [x0 + TILE, y0] : nx === -1 ? [x0, y0] : ny === 1 ? [x0, y0 + TILE] : [x0, y0];
      const b: [number, number] = nx !== 0 ? [a[0], a[1] + TILE] : [a[0] + TILE, a[1]];
      const ti = nx !== 0 ? 0 : 1, tj = nx !== 0 ? 1 : 0;
      const same = (ci: number, cj: number) => isFloor(L, ci, cj) && !isFloor(L, ci + nx, cj + ny);
      edges.push({ i, j, nx, ny, a, b, contA: same(i - ti, j - tj), contB: same(i + ti, j + tj) });
      const ri = i + nx, rj = j + ny;
      if (ri >= 0 && rj >= 0 && ri < gw && rj < gh && !rockSet.has(ri + ',' + rj)) {
        rockSet.add(ri + ',' + rj);
        rock.push({ x0: ri * TILE, y0: rj * TILE, x1: (ri + 1) * TILE, y1: (rj + 1) * TILE, v: 0 });
      }
    }
  }
  return { edges, rock };
}

/** Throw runes: spread along the near boundary of the floor. */
function pickPads(gw: number, gh: number, floor: Uint8Array, R: ReturnType<typeof makeRng>): Pad[] {
  const L = { gw, gh, floor };
  const cand: [number, number][] = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!isFloor(L, i, j)) continue;
    const nearEdge = !isFloor(L, i + 1, j) || !isFloor(L, i, j + 1);
    if (nearEdge && (i + 0.5) / gw + (j + 0.5) / gh > 1.05) cand.push([i, j]);
  }
  cand.sort((p, q) => q[0] + q[1] - (p[0] + p[1]));
  const chosen: [number, number][] = [cand[0]];
  for (let minD = 3.5; chosen.length < 5 && minD > 0.9; minD -= 0.5) {
    while (chosen.length < 5) {
      let best: [number, number] | null = null, bd = -1;
      for (const c of cand) {
        const d = Math.min(...chosen.map(o => Math.hypot(o[0] - c[0], o[1] - c[1])));
        if (d >= minD && d > bd) { bd = d; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }
  }
  return chosen.map(([i, j]) => ({ x: i * TILE + 8 + (R.next() - 0.5) * 3, y: j * TILE + 8 + (R.next() - 0.5) * 3 }));
}

export function generate(spec: RoomSpec): Layout {
  const R = makeRng(spec.seed * 31 + spec.depth);
  const { int: ri, pick } = R;
  const d = spec.depth;
  const type = spec.type;
  const gw = ri(12, 15), gh = ri(10, 12);
  const { shape, floor } = carve(gw, gh, R, type);
  const Wx = gw * TILE, Wy = gh * TILE;
  const { edges, rock } = buildEdges(gw, gh, floor);
  const geo = { gw, gh, floor, rock, Wx, Wy };
  const biome = BIOMES[Math.min(spec.floor, BIOMES.length - 1)];
  const objs: { x: number; y: number; r: number }[] = [];
  const free = (x: number, y: number, r: number, pad = 6) => objs.every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + pad);
  const place = (r: number, test: (x: number, y: number) => boolean): [number, number] | null => {
    for (let i = 0; i < 300; i++) {
      const x = r + 8 + R.next() * (Wx - 2 * r - 16), y = r + 8 + R.next() * (Wy - 2 * r - 16);
      if (test(x, y) && free(x, y, r) && clearOfRock(geo, x, y, r + 6)) return [x, y];
    }
    return null;
  };
  // "far" is the half away from the throw runes; "mid" is the band between the two sides.
  const far = (x: number, y: number) => x / Wx + y / Wy < 0.95;
  const mid = (x: number, y: number) => { const s = x / Wx + y / Wy; return s > 0.55 && s < 1.45; };
  const any = () => true;

  const pads = pickPads(gw, gh, floor, R);
  for (const p of pads) objs.push({ x: p.x, y: p.y, r: 22 });

  const pits: Pit[] = [];
  for (let i = 0, n = ri(0, d > 5 ? 3 : 1); i < n; i++) {
    const r = ri(10, 13), q = place(r, mid);
    if (q) { pits.push({ x: q[0], y: q[1], r }); objs.push({ x: q[0], y: q[1], r }); }
  }

  const blocks: Block[] = [];
  const SHAPES = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 1]]];
  for (let i = 0, n = ri(2, 4); i < n; i++) {
    for (let tr = 0; tr < 40; tr++) {
      const tx = ri(1, gw - 4), ty = ri(1, gh - 4), sh = pick(SHAPES);
      const cells = sh.map(([a, b]) => ({ x0: (tx + a) * TILE, y0: (ty + b) * TILE, x1: (tx + a + 1) * TILE, y1: (ty + b + 1) * TILE, v: ri(0, 7) }));
      // blocks keep a free tile between themselves and the rock so discs can't get wedged
      if (cells.every(c => free(c.x0 + 8, c.y0 + 8, 11, 4) && clearOfRock(geo, c.x0 + 8, c.y0 + 8, 20))) {
        for (const c of cells) { blocks.push(c); objs.push({ x: c.x0 + 8, y: c.y0 + 8, r: 11 }); }
        break;
      }
    }
  }

  const decals: Decal[] = [];
  for (let i = 0, n = ri(8, 14); i < n; i++) {
    const d0 = { x: 8 + R.next() * (Wx - 16), y: 8 + R.next() * (Wy - 16), k: ri(0, 2), a: R.next() * 3 };
    if (clearOfRock(geo, d0.x, d0.y, 5)) decals.push(d0);
  }

  const nodes: ResNode[] = [];
  const kinds: NodeKind[] = type === 'treasure' ? ['ore', 'ore', 'ore', 'ore', 'spk', 'spk', 'spk', 'herb', 'herb'] : ['ore', 'ore', 'spk', 'spk', 'herb'];
  for (const k of kinds) {
    const q = place(NODES[k].r, type === 'treasure' ? any : mid);
    if (q) { nodes.push({ k, ...NODES[k], x: q[0], y: q[1], left: NODES[k].ch, hit: 0 }); objs.push({ x: q[0], y: q[1], r: NODES[k].r }); }
  }

  const hpMul = MOB_HP_MUL * (1 + 0.09 * (d - 1)), dmgAdd = Math.floor((d - 1) / 5);
  const pool: MobKind[] = spec.floor === 0 ? ['skel', 'skel', 'archer', 'slime'] : spec.floor === 1 ? ['skel', 'archer', 'slime', 'slime', 'archer'] : ['skel', 'archer', 'slime', 'golem'];
  let mk: MobKind[];
  if (type === 'treasure') mk = ['skel', 'archer'];
  else if (type === 'boss') mk = ['king', 'skel', 'archer'];
  else if (type === 'elite') mk = ['golem', pick(pool), pick(pool), pick(pool)];
  else { mk = []; for (let i = 0, n = Math.min(3 + Math.floor(d / 3), 7); i < n; i++) mk.push(pick(pool)); }
  const mobs: Mob[] = [];
  for (const k of mk) {
    const q = place(MOBS[k].r, far);
    if (q) { mobs.push(newMob(k, q[0], q[1], hpMul, dmgAdd)); objs.push({ x: q[0], y: q[1], r: MOBS[k].r }); }
  }

  const haz = new Set<string>();
  for (let i = 0, n = 4 + Math.floor(d / 2); i < n; i++) {
    const tx = ri(1, gw - 2), ty = ri(1, gh - 2), cx = tx * TILE + 8, cy = ty * TILE + 8;
    if (isFloor(geo, tx, ty) && mid(cx, cy) && pads.every(p => Math.hypot(p.x - cx, p.y - cy) > 26) && objs.every(o => Math.hypot(o.x - cx, o.y - cy) > o.r + 4)) haz.add(hazKey(tx, ty));
  }
  return { gw, gh, shape, floor, edges, rock, Wx, Wy, biome, pads, pits, blocks, decals, nodes, mobs, haz, hpMul, dmgAdd };
}
