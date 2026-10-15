// Procedural room generator. Pure: the same RoomSpec always yields the same layout.

import { BIOMES, MOBS, NODES, TILE, type Biome, type MobKind, type NodeKind, type RoomType } from './data';
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

export interface Layout {
  gw: number;
  gh: number;
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
  waves: number[];
  hpMul: number;
  dmgAdd: number;
  pool: MobKind[];
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

export function generate(spec: RoomSpec): Layout {
  const R = makeRng(spec.seed * 31 + spec.depth);
  const { int: ri, pick } = R;
  const d = spec.depth;
  const type = spec.type;
  const gw = ri(12, 15), gh = ri(10, 12);
  const Wx = gw * TILE, Wy = gh * TILE;
  const biome = BIOMES[Math.min(spec.floor, BIOMES.length - 1)];
  const objs: { x: number; y: number; r: number }[] = [];
  const free = (x: number, y: number, r: number, pad = 6) => objs.every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + pad);
  const place = (r: number, test: (x: number, y: number) => boolean): [number, number] | null => {
    for (let i = 0; i < 200; i++) {
      const x = r + 8 + R.next() * (Wx - 2 * r - 16), y = r + 8 + R.next() * (Wy - 2 * r - 16);
      if (test(x, y) && free(x, y, r)) return [x, y];
    }
    return null;
  };
  // "far" is the half away from the throw runes; "mid" is the band between the two sides.
  const far = (x: number, y: number) => x / Wx + y / Wy < 0.95;
  const mid = (x: number, y: number) => { const s = x / Wx + y / Wy; return s > 0.55 && s < 1.45; };
  const any = () => true;

  const pads: Pad[] = [];
  for (const [x, y] of [[Wx - 11, Wy * 0.32], [Wx - 11, Wy * 0.62], [Wx - 13, Wy - 13], [Wx * 0.62, Wy - 11], [Wx * 0.32, Wy - 11]]) {
    const p = { x: x + (R.next() - 0.5) * 8, y: y + (R.next() - 0.5) * 8 };
    pads.push(p);
    objs.push({ x: p.x, y: p.y, r: 22 });
  }

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
      if (cells.every(c => free(c.x0 + 8, c.y0 + 8, 11, 4))) {
        for (const c of cells) { blocks.push(c); objs.push({ x: c.x0 + 8, y: c.y0 + 8, r: 11 }); }
        break;
      }
    }
  }

  const decals: Decal[] = [];
  for (let i = 0, n = ri(8, 14); i < n; i++) decals.push({ x: 8 + R.next() * (Wx - 16), y: 8 + R.next() * (Wy - 16), k: ri(0, 2), a: R.next() * 3 });

  const nodes: ResNode[] = [];
  const kinds: NodeKind[] = type === 'treasure' ? ['ore', 'ore', 'ore', 'ore', 'spk', 'spk', 'spk', 'herb', 'herb'] : ['ore', 'ore', 'spk', 'spk', 'herb'];
  for (const k of kinds) {
    const q = place(NODES[k].r, type === 'treasure' ? any : mid);
    if (q) { nodes.push({ k, ...NODES[k], x: q[0], y: q[1], left: NODES[k].ch, hit: 0 }); objs.push({ x: q[0], y: q[1], r: NODES[k].r }); }
  }

  const hpMul = 1 + 0.09 * (d - 1), dmgAdd = Math.floor((d - 1) / 5);
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
    if (mid(cx, cy) && pads.every(p => Math.hypot(p.x - cx, p.y - cy) > 26) && objs.every(o => Math.hypot(o.x - cx, o.y - cy) > o.r + 4)) haz.add(hazKey(tx, ty));
  }
  const waves = type === 'boss' ? [2, 4, 6] : type === 'treasure' ? [2, 4] : d >= 6 ? [2, 4, 6] : [3, 6];
  return { gw, gh, Wx, Wy, biome, pads, pits, blocks, decals, nodes, mobs, haz, waves, hpMul, dmgAdd, pool };
}
