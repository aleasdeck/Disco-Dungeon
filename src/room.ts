// Procedural room generator. Pure: the same RoomSpec always yields the same layout.

import { BIOMES, MOB_HP_MUL, MOBS, NODES, TILE, isRanged, mobSize, type Biome, type MobKind, type NodeKind, type RoomType } from './data';
import { makeRng } from './rng';
import { LAYERS } from './run';

export interface RoomSpec {
  seed: number;
  depth: number;
  floor: number;
  type: RoomType;
}

export interface Pad { x: number; y: number }
export interface Pit { x: number; y: number; r: number }
/**
 * A one-tile obstacle. `ice` marks an icicle growing from the floor: it collides exactly like a stone block,
 * but discs chip `hp` off it and it shatters at 0. `big` icicles take several hits, small ones one or two.
 */
export interface Block { x0: number; y0: number; x1: number; y1: number; v: number; ice?: boolean; big?: boolean; hp?: number; max?: number }

/** Icicle toughness: a small one breaks to a fair hit, a big one needs two or three. */
export const ICICLE_HP = { small: 3, big: 11 };

/** Blocks discs still bounce off: everything but shattered icicles. */
export const standing = (blocks: Block[]) => blocks.filter(b => !b.ice || b.hp! > 0);
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

/**
 * What a mob will do in the coming enemy turn, shown to the players beforehand.
 * hit/move/charge aim at one hero; slam hits every hero (hero = -1); heal names the mob it mends;
 * summon and heat carry the spots that light up on the floor a turn ahead.
 */
export interface Intent {
  t: 'hit' | 'move' | 'charge' | 'slam' | 'heal' | 'summon' | 'heat';
  hero: number;
  dmg: number;
  chill?: boolean;
  mob?: number;
  spots?: { x: number; y: number }[];
  /** A walker's route to the hero's rune, around blocks and pits; the first `go` units of it are walked this turn. */
  way?: { x: number; y: number }[];
  go?: number;
  /** Enemy turns until this walker strikes, counting this one. */
  eta?: number;
}

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
  /** The stretch of route walked this enemy turn, from (fx, fy) to (tx, ty). */
  walk?: { x: number; y: number }[];
  /** Index in the room's mob list of the mob that summoned this one, or -1. */
  owner: number;
  /** Counts down from 1 while a summoned mob rises out of its circle. */
  born: number;
  rage?: boolean;
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
  /** 1 where the cell is iced over (slippery), row-major gw × gh; all zeros outside icy biomes. */
  ice: Uint8Array;
  hpMul: number;
  dmgAdd: number;
}

export function newMob(k: MobKind, x: number, y: number, hpMul = 1, dmgAdd = 0): Mob {
  const d = MOBS[k];
  const hp = Math.round(d.hp * hpMul);
  return {
    k, name: d.name, r: d.r, speed: d.speed, reach: d.reach, armor: d.armor,
    hp, max: hp, dmg: d.dmg + dmgAdd, x, y, flash: 0, dead: 0, burn: 0, intent: null,
    fx: x, fy: y, tx: x, ty: y, hop: 0, owner: -1, born: 0,
  };
}

export const hazKey = (tx: number, ty: number) => tx + ',' + ty;

/**
 * Enemies and resources stand on the cell grid like the blocks: a thing s cells wide has its centre in the middle
 * of its s × s cells. These map between that centre and its top-left cell.
 */
export const cellAt = (x: number, y: number, s = 1): [number, number] => [Math.round(x / TILE - s / 2), Math.round(y / TILE - s / 2)];
export const cellCentre = (i: number, j: number, s = 1) => ({ x: (i + s / 2) * TILE, y: (j + s / 2) * TILE });

export function isFloor(L: { gw: number; gh: number; floor: Uint8Array }, i: number, j: number) {
  return i >= 0 && j >= 0 && i < L.gw && j < L.gh && L.floor[j * L.gw + i] === 1;
}

/** Floor cell under a world point. */
export const floorAt = (L: { gw: number; gh: number; floor: Uint8Array }, x: number, y: number) =>
  isFloor(L, Math.floor(x / TILE), Math.floor(y / TILE));

/** Floor friction under a world point: ice patches are slippery, the rest of the floor is not. */
export const muAt = (L: { gw: number; gh: number; ice: Uint8Array; biome: Biome }, x: number, y: number) => {
  const i = Math.floor(x / TILE), j = Math.floor(y / TILE);
  return L.biome.iceMu !== undefined && i >= 0 && j >= 0 && i < L.gw && j < L.gh && L.ice[j * L.gw + i] ? L.biome.iceMu : L.biome.mu;
};

/** Ice in patches: a few frozen blobs covering roughly a third of the floor. */
function freeze(gw: number, gh: number, floor: Uint8Array, R: ReturnType<typeof makeRng>) {
  const ice = new Uint8Array(gw * gh);
  const cells = floor.reduce((n, v) => n + v, 0);
  const goal = cells * (0.26 + R.next() * 0.12);
  let n = 0;
  for (let tr = 0; tr < 40 && n < goal; tr++) {
    const ci = R.next() * gw, cj = R.next() * gh, rx = 1.4 + R.next() * 2, ry = 1.4 + R.next() * 2;
    for (let j = Math.floor(cj - ry - 1); j <= cj + ry + 1; j++) for (let i = Math.floor(ci - rx - 1); i <= ci + rx + 1; i++) {
      if (i < 0 || j < 0 || i >= gw || j >= gh || !floor[j * gw + i] || ice[j * gw + i]) continue;
      const dx = (i + 0.5 - ci) / rx, dy = (j + 0.5 - cj) / ry;
      // a ragged rim so patches don't come out as clean ellipses
      if (dx * dx + dy * dy < 0.8 + R.next() * 0.5) { ice[j * gw + i] = 1; n++; }
    }
  }
  return ice;
}

const boxDist = (x: number, y: number, b: Block) => Math.hypot(x - Math.max(b.x0, Math.min(x, b.x1)), y - Math.max(b.y0, Math.min(y, b.y1)));

/** A circle of radius r at (x, y) lies on floor without touching rock or the room bounds. */
export function clearOfRock(L: Pick<Layout, 'gw' | 'gh' | 'floor' | 'rock' | 'Wx' | 'Wy'>, x: number, y: number, r: number) {
  return x > r && y > r && x < L.Wx - r && y < L.Wy - r && floorAt(L, x, y) && L.rock.every(b => boxDist(x, y, b) >= r);
}

type Range = [number, number];

/** How a room is built at one step of a floor: rooms near the entrance are small and plain, the ones before the boss big and tangled. */
export interface Tier {
  gw: Range;
  gh: Range;
  shapes: Shape[];
  /** How many block clusters, and which of BLOCK_SHAPES they may use (the first n). */
  blocks: Range;
  blockKinds: number;
  pits: Range;
  haz: Range;
  mobs: Range;
}

export const TIERS: Tier[] = [
  { gw: [10, 11], gh: [8, 9], shapes: ['rect'], blocks: [1, 2], blockKinds: 1, pits: [0, 0], haz: [0, 0], mobs: [2, 3] },
  { gw: [11, 12], gh: [9, 9], shapes: ['rect', 'corner'], blocks: [2, 2], blockKinds: 3, pits: [0, 0], haz: [2, 2], mobs: [3, 3] },
  { gw: [12, 13], gh: [10, 10], shapes: ['corner', 'alcove'], blocks: [2, 3], blockKinds: 4, pits: [0, 0], haz: [3, 4], mobs: [3, 4] },
  { gw: [13, 14], gh: [10, 11], shapes: ['alcove', 'funnel', 'corner'], blocks: [3, 4], blockKinds: 4, pits: [0, 1], haz: [5, 6], mobs: [4, 5] },
  { gw: [14, 15], gh: [11, 12], shapes: ['funnel', 'cross', 'alcove'], blocks: [4, 5], blockKinds: 5, pits: [1, 2], haz: [6, 8], mobs: [5, 6] },
];
export const BOSS_TIER: Tier = { gw: [14, 15], gh: [12, 12], shapes: ['rect', 'cross'], blocks: [2, 3], blockKinds: 3, pits: [0, 0], haz: [4, 6], mobs: [3, 3] };

/** Map row (0 = entrance) to its tier; the rest rows in the middle borrow the tier of the row before. */
export function tierOf(spec: RoomSpec): { tier: Tier; t: number } {
  if (spec.type === 'boss') return { tier: BOSS_TIER, t: TIERS.length };
  const row = Math.max(0, Math.min(LAYERS - 2, spec.depth - 1 - spec.floor * LAYERS));
  const t = [0, 1, 2, 2, 3, 4][row] ?? TIERS.length - 1;
  return { tier: TIERS[t], t };
}

function carve(gw: number, gh: number, R: ReturnType<typeof makeRng>, shapes: Shape[]): { shape: Shape; floor: Uint8Array } {
  const floor = new Uint8Array(gw * gh).fill(1);
  const cut = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = Math.max(0, j0); j < Math.min(gh, j1); j++) for (let i = Math.max(0, i0); i < Math.min(gw, i1); i++) floor[j * gw + i] = 0;
  };
  // the near corner (large x and y) always stays: the throw runes live along the near edges
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
  // bites can wall off a corner cell: keep only floor connected to the near corner, where the runes are
  let near = 0;
  for (let k = 0; k < gw * gh; k++) if (floor[k] && (k % gw) + Math.floor(k / gw) > (near % gw) + Math.floor(near / gw)) near = k;
  const keep = new Uint8Array(gw * gh), stack = [near];
  keep[near] = 1;
  while (stack.length) {
    const k = stack.pop()!, i = k % gw, j = (k - i) / gw;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, nk = nj * gw + ni;
      if (ni >= 0 && nj >= 0 && ni < gw && nj < gh && floor[nk] && !keep[nk]) { keep[nk] = 1; stack.push(nk); }
    }
  }
  return { shape, floor: keep };
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
  for (let minD = 3.5; chosen.length < OPEN_PADS && minD > 0.9; minD -= 0.5) {
    while (chosen.length < OPEN_PADS) {
      let best: [number, number] | null = null, bd = -1;
      for (const c of cand) {
        const d = Math.min(...chosen.map(o => Math.hypot(o[0] - c[0], o[1] - c[1])));
        if (d >= minD && d > bd) { bd = d; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }
  }
  // a rune sits in the middle of its cell, so the hero's stand fits inside it; the two draws that once nudged it
  // off centre stay, so a seed still lays out the rest of the room the same
  return chosen.map(([i, j]) => (R.next(), R.next(), { x: i * TILE + 8, y: j * TILE + 8 }));
}

/** Throw runes in every room; heroes are put on them before the fight and stay there. */
export const OPEN_PADS = 4;

/** Block clusters from plain to awkward: single, pairs, an L, a diagonal pair. */
const BLOCK_SHAPES = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 1]]];

/** Each floor has its own cast: who fills regular fights, who leads an elite fight, and its boss. */
export const CASTS: { early: MobKind[]; late: MobKind[]; elite: MobKind; boss: MobKind }[] = [
  { early: ['skel', 'skel', 'archer', 'rat'], late: ['skel', 'archer', 'rat', 'rat', 'necro'], elite: 'necro', boss: 'king' },
  { early: ['ghoul', 'ghoul', 'ghost'], late: ['ghoul', 'ghost', 'yeti', 'witch'], elite: 'witch', boss: 'lich' },
  { early: ['imp', 'imp', 'slime', 'bomber'], late: ['imp', 'slime', 'bomber', 'golem'], elite: 'golem', boss: 'forgelord' },
];

/** Enemies a regular fight draws from: the floor sets the cast, late rows of a floor add tougher ones. */
function mobPool(f: number, t: number): MobKind[] {
  const cast = CASTS[Math.min(f, CASTS.length - 1)];
  if (t === 0) return cast.early.slice(0, 3);
  return t < 3 ? cast.early : cast.late;
}

/** Enemies that set the pace of a fight: at most one of each in a room. */
const SOLO: MobKind[] = ['golem', 'necro', 'witch', 'yeti', 'bomber'];

/** How much every enemy's HP grows per room of the run (on top of MOB_HP_MUL). */
export const HP_STEP = 0.065;

/** Extra damage per hit: one more on every floor, and one more in the last rooms before the boss. */
export const dmgBonus = (f: number, t: number) => f + (t >= 3 ? 1 : 0);

export function generate(spec: RoomSpec): Layout {
  const R = makeRng(spec.seed * 31 + spec.depth);
  const { int: ri, pick } = R;
  const d = spec.depth;
  const type = spec.type, f = spec.floor;
  const { tier, t } = tierOf(spec);
  const roll = (r: Range) => ri(r[0], r[1]);
  const gw = roll(tier.gw), gh = roll(tier.gh);
  const { shape, floor } = carve(gw, gh, R, tier.shapes);
  const Wx = gw * TILE, Wy = gh * TILE;
  const { edges, rock } = buildEdges(gw, gh, floor);
  const geo = { gw, gh, floor, rock, Wx, Wy };
  const biome = BIOMES[Math.min(spec.floor, BIOMES.length - 1)];
  const objs: { x: number; y: number; r: number }[] = [];
  const free = (x: number, y: number, r: number, pad = 6) => objs.every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + pad);
  // cells already holding a rune, a block, an enemy or a resource
  const taken = new Set<string>();
  const take = (i: number, j: number, s = 1) => { for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) taken.add(hazKey(i + a, j + b)); };
  /**
   * A free s × s patch of floor cells for something of radius r, centre passing `test`.
   * Things keep a little air around them; `tight` lets them stand side by side and against the walls in a crowded room.
   */
  const placeCell = (s: number, r: number, test: (x: number, y: number) => boolean, tight = false): [number, number] | null => {
    for (let k = 0; k < 300; k++) {
      const i = ri(0, gw - s), j = ri(0, gh - s), c = cellCentre(i, j, s);
      let ok = test(c.x, c.y) && free(c.x, c.y, r, tight ? -2 : 6) && clearOfRock(geo, c.x, c.y, r + (tight ? 1 : 6));
      for (let b = 0; b < s && ok; b++) for (let a = 0; a < s && ok; a++) ok = isFloor(geo, i + a, j + b) && !taken.has(hazKey(i + a, j + b));
      if (ok) { take(i, j, s); return [c.x, c.y]; }
    }
    return null;
  };
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
  // off to the sides of the line from the runes to the enemies: a resource takes a throw of its own, it isn't picked up on the way
  const flank = (x: number, y: number) => mid(x, y) && Math.abs(x / Wx - y / Wy) > 0.3;

  const pads = pickPads(gw, gh, floor, R);
  for (const p of pads) { objs.push({ x: p.x, y: p.y, r: 22 }); take(Math.floor(p.x / TILE), Math.floor(p.y / TILE)); }

  const pits: Pit[] = [];
  for (let i = 0, n = roll(tier.pits); i < n; i++) {
    const r = ri(10, 13), q = place(r, mid);
    if (q) { pits.push({ x: q[0], y: q[1], r }); objs.push({ x: q[0], y: q[1], r }); }
  }

  const blocks: Block[] = [];
  const SHAPES = BLOCK_SHAPES.slice(0, tier.blockKinds);
  for (let i = 0, n = roll(tier.blocks); i < n; i++) {
    for (let tr = 0; tr < 40; tr++) {
      const tx = ri(1, gw - 4), ty = ri(1, gh - 4), sh = pick(SHAPES);
      const cells = sh.map(([a, b]) => ({ x0: (tx + a) * TILE, y0: (ty + b) * TILE, x1: (tx + a + 1) * TILE, y1: (ty + b + 1) * TILE, v: ri(0, 7) }));
      // blocks keep a free tile between themselves and the rock so discs can't get wedged
      if (cells.every(c => free(c.x0 + 8, c.y0 + 8, 11, 4) && clearOfRock(geo, c.x0 + 8, c.y0 + 8, 20))) {
        for (const c of cells) { blocks.push(c); objs.push({ x: c.x0 + 8, y: c.y0 + 8, r: 11 }); take(c.x0 / TILE, c.y0 / TILE); }
        break;
      }
    }
  }

  // ice caves: icicles, big and small, rise from the floor on top of the stone blocks; same one-tile footprint, same bounce
  if (biome.iceMu !== undefined) {
    for (let i = 0, n = roll(tier.blocks); i < n; i++) {
      for (let tr = 0; tr < 40; tr++) {
        const tx = ri(1, gw - 4), ty = ri(1, gh - 4), sh = pick(SHAPES);
        const cells = sh.map(([a, b]) => {
          const v = ri(0, 7), big = v % 2 === 0, max = big ? ICICLE_HP.big : ICICLE_HP.small;
          return { x0: (tx + a) * TILE, y0: (ty + b) * TILE, x1: (tx + a + 1) * TILE, y1: (ty + b + 1) * TILE, v, ice: true, big, hp: max, max };
        });
        if (cells.every(c => free(c.x0 + 8, c.y0 + 8, 11, 4) && clearOfRock(geo, c.x0 + 8, c.y0 + 8, 20))) {
          for (const c of cells) { blocks.push(c); objs.push({ x: c.x0 + 8, y: c.y0 + 8, r: 11 }); take(c.x0 / TILE, c.y0 / TILE); }
          break;
        }
      }
    }
  }

  const decals: Decal[] = [];
  for (let i = 0, n = ri(8, 14); i < n; i++) {
    const d0 = { x: 8 + R.next() * (Wx - 16), y: 8 + R.next() * (Wy - 16), k: ri(0, 2), a: R.next() * 3 };
    if (clearOfRock(geo, d0.x, d0.y, 5)) decals.push(d0);
  }

  const hpMul = MOB_HP_MUL * (1 + HP_STEP * (d - 1)), dmgAdd = dmgBonus(f, t);
  const pool = mobPool(f, t), cast = CASTS[Math.min(f, CASTS.length - 1)];
  const solo = (k: MobKind) => SOLO.includes(k) || (t === 0 && isRanged(k));
  const draw = (n: number, has: MobKind[] = []) => {
    const out: MobKind[] = [];
    for (let i = 0; i < n; i++) {
      let k = pick(pool);
      // one shooter at most in the first room, one of each heavy hitter anywhere,
      // and never more than two shooters of a kind: a room full of them can't be reached
      const full = (k: MobKind) => (solo(k) && (out.includes(k) || has.includes(k))) || (isRanged(k) && out.filter(o => o === k).length >= 2);
      for (let tr = 0; tr < 8 && full(k); tr++) k = pick(pool);
      if (full(k)) k = cast.early[0];
      out.push(k);
    }
    return out;
  };
  const count = Math.min(roll(tier.mobs) + f, 7);
  let mk: MobKind[];
  if (type === 'treasure') mk = cast.early.filter((k, i, a) => a.indexOf(k) === i).slice(0, 2);
  else if (type === 'boss') mk = [cast.boss, ...draw(2 + f, SOLO)];
  else if (type === 'elite') mk = [cast.elite, ...draw(count - 1, [cast.elite])];
  else mk = draw(count);
  const mobs: Mob[] = [];
  for (const k of mk) {
    // a cut corner can eat the far half, so a mob that finds no room there stands anywhere short of the runes
    const sz = mobSize(k), r = MOBS[k].r;
    const short = (x: number, y: number) => x / Wx + y / Wy < 1.25;
    const q = placeCell(sz, r, far) ?? placeCell(sz, r, short) ?? placeCell(sz, r, far, true) ?? placeCell(sz, r, short, true) ?? placeCell(sz, r, any, true);
    if (q) { mobs.push(newMob(k, q[0], q[1], hpMul, dmgAdd)); objs.push({ x: q[0], y: q[1], r: MOBS[k].r }); }
  }

  const nodes: ResNode[] = [];
  const kinds: NodeKind[] = type === 'treasure' ? ['ore', 'ore', 'ore', 'ore', 'spk', 'spk', 'spk', 'herb', 'herb'] : ['ore', 'ore', 'spk', 'spk', 'herb'];
  for (const k of kinds) {
    const q = placeCell(1, NODES[k].r, type === 'treasure' ? any : flank) ?? placeCell(1, NODES[k].r, mid) ?? placeCell(1, NODES[k].r, any) ?? placeCell(1, NODES[k].r, any, true);
    if (q) { nodes.push({ k, ...NODES[k], x: q[0], y: q[1], left: NODES[k].ch, hit: 0 }); objs.push({ x: q[0], y: q[1], r: NODES[k].r }); }
  }

  const haz = new Set<string>();
  // the boss fights in the open: its hazards hug the walls instead of the middle
  const hazZone = type === 'boss' ? (x: number, y: number) => { const s = x / Wx + y / Wy; return mid(x, y) && (s < 0.8 || s > 1.2 || x < 40 || y < 40); } : mid;
  const hazOk = (tx: number, ty: number) => {
    const cx = tx * TILE + 8, cy = ty * TILE + 8;
    return isFloor(geo, tx, ty) && !haz.has(hazKey(tx, ty)) && hazZone(cx, cy) && pads.every(p => Math.hypot(p.x - cx, p.y - cy) > 26) && objs.every(o => Math.hypot(o.x - cx, o.y - cy) > o.r + 4);
  };
  const nHaz = roll(tier.haz) + (t === 0 ? 2 * Math.min(f, 1) : Math.round(f * 1.5));
  // before the boss a strip of three tiles cuts the room
  if (t === TIERS.length - 1 && type !== 'treasure') {
    for (let tr = 0; tr < 60; tr++) {
      const tx = ri(2, gw - 4), ty = ri(2, gh - 4), hor = R.next() < 0.5;
      const cells = [0, 1, 2].map(k => (hor ? [tx + k, ty] : [tx, ty + k]));
      if (cells.every(([a, b]) => hazOk(a, b))) { for (const [a, b] of cells) haz.add(hazKey(a, b)); break; }
    }
  }
  const hazGoal = type === 'treasure' ? Math.ceil(nHaz / 2) : nHaz;
  for (let tr = 0; tr < 200 && haz.size < hazGoal; tr++) {
    const tx = ri(1, gw - 2), ty = ri(1, gh - 2);
    if (hazOk(tx, ty)) haz.add(hazKey(tx, ty));
  }
  // its own stream, so freezing the floor doesn't reshuffle anything above
  const ice = biome.iceMu !== undefined ? freeze(gw, gh, floor, makeRng(spec.seed * 31 + spec.depth + 7919)) : new Uint8Array(gw * gh);
  return { gw, gh, shape, floor, edges, rock, Wx, Wy, biome, pads, pits, blocks, decals, nodes, mobs, haz, ice, hpMul, dmgAdd };
}
