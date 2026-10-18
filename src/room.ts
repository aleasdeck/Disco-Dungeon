// Procedural room generator. Pure: the same RoomSpec always yields the same layout.

import type { Knock } from './fx';
import { BIOMES, MOB_HP_MUL, MOBS, NODES, TILE, isRanged, mobSize, type Biome, type MobKind, type NodeKind, type RoomType } from './data';
import { makeRng } from './rng';
import { LAYERS } from './run';

export interface RoomSpec {
  seed: number;
  depth: number;
  floor: number;
  type: RoomType;
  /** Heroes in the party the room is built for, 1..3; rooms from before this was kept were built for three. */
  heroes?: number;
  /** An event's curse on the fight, «Дым-машина»: smoke over the room, clear only a few steps around the heroes. */
  smoke?: boolean;
  /** An event's curse on the fight, «Стробоскоп»: no aiming line. */
  strobe?: boolean;
}

export interface Pad { x: number; y: number }
export type PitKind = '1x1' | '2x1' | '3x1' | 'L3' | '2x2' | 'L4' | 'L5' | '2x3' | '3x3';
/**
 * Shapes of holes in the floor, made of whole cells: squares, strips, a rectangle and corners from small to a full Г.
 * Each is listed one way round; the generator turns and mirrors them.
 */
export const PIT_SHAPES: Record<PitKind, [number, number][]> = {
  '1x1': [[0, 0]],
  '2x1': [[0, 0], [1, 0]],
  '3x1': [[0, 0], [1, 0], [2, 0]],
  'L3': [[0, 0], [1, 0], [0, 1]],
  '2x2': [[0, 0], [1, 0], [0, 1], [1, 1]],
  'L4': [[0, 0], [1, 0], [0, 1], [0, 2]],
  'L5': [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]],
  '2x3': [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  '3x3': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
};
export const PIT_KINDS = Object.keys(PIT_SHAPES) as PitKind[];

/** Every way a shape can lie on the grid: four turns, each also mirrored, the copies that come out the same dropped. */
const turns = new Map<PitKind, [number, number][][]>();
function pitTurns(k: PitKind) {
  let out = turns.get(k);
  if (out) return out;
  const seen = new Set<string>();
  out = [];
  for (let m = 0; m < 8; m++) {
    const c = PIT_SHAPES[k].map(([a, b]): [number, number] => {
      const [x, y] = m & 4 ? [-a, b] : [a, b];
      return m % 4 === 0 ? [x, y] : m % 4 === 1 ? [-y, x] : m % 4 === 2 ? [-x, -y] : [y, -x];
    });
    const a0 = Math.min(...c.map(q => q[0])), b0 = Math.min(...c.map(q => q[1]));
    const n = c.map(([a, b]): [number, number] => [a - a0, b - b0]).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    const key = n.join(';');
    if (!seen.has(key)) { seen.add(key); out.push(n); }
  }
  turns.set(k, out);
  return out;
}

/** A hole in the floor and the cells it covers: a disc that rolls onto any of them is lost. */
export interface Pit { k: PitKind; cells: [number, number][] }

/** Whether the hole covers the cell (i, j). */
export const inPit = (p: Pit, i: number, j: number) => p.cells.some(c => c[0] === i && c[1] === j);

/** The hole under a world point, if there is one. */
export const pitAt = (pits: Pit[], x: number, y: number) => {
  const i = Math.floor(x / TILE), j = Math.floor(y / TILE);
  return pits.find(p => inPit(p, i, j));
};
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
  /** Cells it covers on each side: the ore cave's big vein stands on 2 × 2 cells, the rest on one. */
  s?: number;
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
  /** The last knock it took: the figure rocks on its stand for a moment. */
  knock?: Knock;
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
  dmgMul: number;
}

export function newMob(k: MobKind, x: number, y: number, hpMul = 1, dmgAdd = 0, dmgMul = 1): Mob {
  const d = MOBS[k];
  const hp = Math.round(d.hp * hpMul);
  return {
    k, name: d.name, r: d.r, speed: d.speed, reach: d.reach, armor: d.armor,
    hp, max: hp, dmg: Math.max(1, Math.round((d.dmg + dmgAdd) * dmgMul)), x, y, flash: 0, dead: 0, burn: 0, intent: null,
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
  /** How many holes, and how many cells the biggest one may take; the holes in one room are all of different shapes. */
  pits: Range;
  pitCells: number;
  haz: Range;
  mobs: Range;
}

export const TIERS: Tier[] = [
  { gw: [10, 11], gh: [8, 9], shapes: ['rect'], blocks: [1, 1], blockKinds: 1, pits: [0, 0], pitCells: 0, haz: [0, 0], mobs: [2, 2] },
  { gw: [11, 12], gh: [9, 9], shapes: ['rect', 'corner'], blocks: [1, 2], blockKinds: 3, pits: [0, 0], pitCells: 0, haz: [1, 1], mobs: [2, 3] },
  { gw: [12, 13], gh: [10, 10], shapes: ['corner', 'alcove'], blocks: [1, 2], blockKinds: 4, pits: [0, 1], pitCells: 2, haz: [1, 2], mobs: [2, 3] },
  { gw: [13, 14], gh: [10, 11], shapes: ['alcove', 'funnel', 'corner'], blocks: [2, 2], blockKinds: 4, pits: [0, 1], pitCells: 4, haz: [2, 3], mobs: [3, 3] },
  { gw: [14, 15], gh: [11, 12], shapes: ['funnel', 'cross', 'alcove'], blocks: [2, 3], blockKinds: 5, pits: [1, 2], pitCells: 9, haz: [3, 3], mobs: [3, 4] },
];
/** The boss fights among as many columns, holes and hazards as the last room before it; its holes stay small enough to walk round. */
export const BOSS_TIER: Tier = { gw: [14, 15], gh: [12, 12], shapes: ['rect', 'cross'], blocks: [3, 3], blockKinds: 5, pits: [1, 2], pitCells: 4, haz: [3, 3], mobs: [3, 3] };

/** Most floor cells the holes of one room take: next to a 3 × 3 hole there is room only for a 1 × 1. */
export const PIT_CELLS = 10;

/** Most enemies a room starts with: past this a room is a crowd, not a fight. */
export const MOB_CAP = 5;

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

/**
 * Resources in each kind of fight room: one of each, so the floor stays clear. Ore is scarce, so a party can't buy
 * every upgrade in one run; an elite fight pays a second vein. The ore cave has its big vein on top of these (CAVE).
 */
export const NODE_SETS: Partial<Record<RoomType, NodeKind[]>> = {
  fight: ['ore', 'spk', 'herb'],
  elite: ['ore', 'ore', 'spk', 'herb'],
  boss: ['ore', 'spk', 'herb'],
  treasure: ['ore', 'ore', 'herb', 'herb'],
};

/**
 * The ore cave holds no enemies: one big vein in the middle of the room, the two small veins and two mushroom patches
 * of NODE_SETS off to the sides, and only `turns` minus the heroes: three turns for a lone hero, one for three heroes,
 * who throw three times as many discs a turn. Each throw goes for ore or for health. It ends once the turns run out
 * or nothing is left to hit. Its veins hold as many charges whatever the party: the turns already make up for its size.
 */
export const CAVE = { turns: 4, big: { r: 12, ch: 6 }, small: 2 };

/** Turns the party has in the ore cave: 4 minus the heroes, at least one. */
export const caveTurns = (spec: Pick<RoomSpec, 'heroes'>) => Math.max(1, CAVE.turns - Math.max(1, Math.min(3, spec.heroes ?? 3)));

/** How much every enemy's HP grows per room of the run (on top of MOB_HP_MUL). */
export const HP_STEP = 0.065;

/**
 * The first floor gets no floor bonus, so next to the later floors its rooms looked bare: it adds a block cluster
 * to every room, a hazard tile to every room after the first and an enemy from the third row on (the boss included).
 */
export const firstFloorExtra = (f: number, t: number) =>
  f > 0 ? { blocks: 0, haz: 0, mobs: 0 } : { blocks: 1, haz: t > 0 ? 1 : 0, mobs: t >= 2 ? 1 : 0 };

/**
 * Rooms are made for a party of three. A smaller party meets fewer enemies (summons included), with less HP and softer hits,
 * and its ore veins hold fewer charges, so mining costs it as many turns as it costs three heroes and each hero earns
 * about as much ore. Tuned with the bot so one, two and three heroes get about as far through a run: a lone hero has
 * one throw a turn and nobody to stand in for it, so it gets the biggest cut.
 */
export const PARTY_SCALE: Record<number, { mobs: number; hp: number; dmg: number; ch: Partial<Record<NodeKind, number>> }> = {
  1: { mobs: 0.4, hp: 0.5, dmg: 0.6, ch: { ore: 1, spk: 2 } },
  2: { mobs: 0.7, hp: 0.8, dmg: 0.8, ch: { ore: 2 } },
  3: { mobs: 1, hp: 1, dmg: 1, ch: {} },
};

export const partyScale = (spec: Pick<RoomSpec, 'heroes'>) => PARTY_SCALE[Math.max(1, Math.min(3, spec.heroes ?? 3))];

/** Past the first floor rooms hold fewer enemies than they used to, so each one there is tougher: this much more HP (on top of MOB_HP_MUL) and one more damage. */
export const LATER_HP = 1.2;

/** Extra damage per hit: two on the second floor and one more on each floor after it, and one more in the last rooms before the boss. */
export const dmgBonus = (f: number, t: number) => (f > 0 ? f + 1 : 0) + (t >= 3 ? 1 : 0);

export function generate(spec: RoomSpec): Layout {
  const R = makeRng(spec.seed * 31 + spec.depth);
  const { int: ri, pick } = R;
  const d = spec.depth;
  const type = spec.type, f = spec.floor;
  const { tier, t } = tierOf(spec);
  const extra = firstFloorExtra(f, t);
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
  // "far" is the half away from the throw runes; "mid" is the band between the two sides.
  const far = (x: number, y: number) => x / Wx + y / Wy < 0.95;
  const mid = (x: number, y: number) => { const s = x / Wx + y / Wy; return s > 0.55 && s < 1.45; };
  const any = () => true;
  // off to the sides of the line from the runes to the enemies: a resource takes a throw of its own, it isn't picked up on the way
  const flank = (x: number, y: number) => mid(x, y) && Math.abs(x / Wx - y / Wy) > 0.3;

  const pads = pickPads(gw, gh, floor, R);
  for (const p of pads) { objs.push({ x: p.x, y: p.y, r: 22 }); take(Math.floor(p.x / TILE), Math.floor(p.y / TILE)); }

  const pits: Pit[] = [];
  const holes = new Set<string>();
  /** Cells under blocks and resources: walkers go round them as round the holes. */
  const shut = new Set<string>();
  /** Which piece of open floor each spot an s × s walker can stand on belongs to, with the holes, blocks, resources (and `extra`) cut out; -1 where it can't stand. */
  const parts = (s: number, extra?: Set<string>) => {
    const id = new Int32Array(gw * gh).fill(-1);
    const fits = (i: number, j: number) => {
      if (i < 0 || j < 0 || i > gw - s || j > gh - s) return false;
      for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) {
        const k = hazKey(i + a, j + b);
        if (!isFloor(geo, i + a, j + b) || holes.has(k) || shut.has(k) || extra?.has(k)) return false;
      }
      return true;
    };
    for (let k = 0, n = 0; k < gw * gh; k++) {
      if (id[k] >= 0 || !fits(k % gw, Math.floor(k / gw))) continue;
      id[k] = n;
      for (const stack = [k]; stack.length;) {
        const c = stack.pop()!, i = c % gw, j = (c - i) / gw;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj, nk = nj * gw + ni;
          if (fits(ni, nj) && id[nk] < 0) { id[nk] = n; stack.push(nk); }
        }
      }
      n++;
    }
    return id;
  };
  // a hole may swallow a dead end, but every piece of floor a walker could cross before stays one piece without it
  const splits = (cells: Set<string>) => [1, 2].some(s => {
    const was = parts(s), now = parts(s, cells), seen = new Map<number, number>();
    for (let k = 0; k < gw * gh; k++) {
      if (was[k] < 0 || now[k] < 0) continue;
      if ((seen.get(was[k]) ?? now[k]) !== now[k]) return true;
      seen.set(was[k], now[k]);
    }
    return false;
  });
  /** The top-left cell of the boss, once it stands. */
  let bossCell = -1;
  /** The piece of floor a 2 × 2 boss walks, as parts(2) ids and the id of that piece: the one it stands on, before that the biggest. */
  const main = (extra?: Set<string>) => {
    const id = parts(2, extra), size = new Map<number, number>();
    if (bossCell >= 0) return { id, at: id[bossCell] };
    for (const v of id) if (v >= 0) size.set(v, (size.get(v) ?? 0) + 1);
    return { id, at: [...size].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1 };
  };
  const padCells = new Set(pads.map(p => hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))));
  /** How many runes a 2 × 2 boss on its piece of floor can step right next to, off every rune, with `extra` cells shut too. */
  const reach = (extra?: Set<string>) => {
    const { id, at } = main(extra);
    return pads.filter(p => {
      const ti = Math.floor(p.x / TILE), tj = Math.floor(p.y / TILE);
      for (let j = tj - 2; j <= tj + 1; j++) for (let i = ti - 2; i <= ti + 1; i++) {
        if (i < 0 || j < 0 || i > gw - 2 || j > gh - 2 || id[j * gw + i] !== at) continue;
        if (![0, 1].some(b => [0, 1].some(a => padCells.has(hazKey(i + a, j + b))))) return true;
      }
      return false;
    }).length;
  };
  // the boss is the one enemy two cells wide: nothing put in its room may cut it off from a rune it could get to
  const cuts = (cells: [number, number][]) => type === 'boss' && reach(new Set(cells.map(([i, j]) => hazKey(i, j)))) < reach();
  /**
   * A hole of the given shape, turned any way, between the runes and the enemies. It keeps a ring of open floor around it,
   * so no wall or rune touches it, stays two cells clear of the other holes, and never cuts off a way across the room,
   * even for big 2 × 2 enemies.
   */
  const placePit = (k: PitKind): Pit | null => {
    const ways = pitTurns(k);
    for (let tr = 0; tr < 200; tr++) {
      const way = ways[ri(0, ways.length - 1)], w = Math.max(...way.map(c => c[0])) + 1, h = Math.max(...way.map(c => c[1])) + 1;
      const i0 = ri(1, gw - w - 1), j0 = ri(1, gh - h - 1), cells = way.map(([a, b]): [number, number] => [i0 + a, j0 + b]);
      const cx = cells.reduce((n, c) => n + c[0] + 0.5, 0) / cells.length * TILE, cy = cells.reduce((n, c) => n + c[1] + 0.5, 0) / cells.length * TILE;
      let ok = mid(cx, cy) && pits.every(q => q.cells.every(([a, b]) => cells.every(([i, j]) => Math.max(Math.abs(a - i), Math.abs(b - j)) >= 3)));
      for (const [i, j] of cells) for (let b = -1; b <= 1 && ok; b++) for (let a = -1; a <= 1 && ok; a++) ok = isFloor(geo, i + a, j + b) && !taken.has(hazKey(i + a, j + b));
      if (ok && !splits(new Set(cells.map(([i, j]) => hazKey(i, j)))) && !cuts(cells)) return { k, cells };
    }
    return null;
  };
  const nPits = roll(tier.pits);
  if (nPits) {
    // shapes in a random order, so each hole in a room is a different one
    const size = (k: PitKind) => PIT_SHAPES[k].length;
    const kinds = PIT_KINDS.filter(k => size(k) <= tier.pitCells);
    for (let k = kinds.length - 1; k > 0; k--) { const m = ri(0, k); [kinds[k], kinds[m]] = [kinds[m], kinds[k]]; }
    const room = (k: PitKind) => pits.reduce((n, p) => n + p.cells.length, size(k)) <= PIT_CELLS;
    while (pits.length < nPits && kinds.length) {
      const k = kinds.shift()!;
      let p = room(k) ? placePit(k) : null;
      // a shape that finds no room gives way to a smaller one still unused, the biggest first
      for (const o of kinds.filter(o => size(o) < size(k) && room(o)).sort((a, b) => size(b) - size(a))) {
        if (p) break;
        if ((p = placePit(o))) kinds.splice(kinds.indexOf(o), 1);
      }
      if (!p) continue;
      pits.push(p);
      // the cells of a hole are taken, and blocks, enemies and resources keep clear of its edge
      for (const [i, j] of p.cells) { holes.add(hazKey(i, j)); take(i, j); objs.push({ ...cellCentre(i, j), r: 8 }); }
    }
  }

  // the ore cave's big vein stands in the middle of the room, a straight throw from every rune, on 2 × 2 cells;
  // it goes in before the blocks, so they keep out of its way
  const cave = type === 'treasure';
  let big: ResNode | null = null;
  if (cave) {
    const { r, ch } = CAVE.big, centre = (x: number, y: number) => Math.abs(x / Wx - 0.5) < 0.18 && Math.abs(y / Wy - 0.5) < 0.18;
    const q = placeCell(2, r, centre) ?? placeCell(2, r, mid) ?? placeCell(2, r, any) ?? placeCell(2, r, any, true);
    if (q) { big = { k: 'ore', ...NODES.ore, r, ch, x: q[0], y: q[1], left: ch, hit: 0, s: 2 }; objs.push({ x: q[0], y: q[1], r }); }
  }

  const blocks: Block[] = [];
  const SHAPES = BLOCK_SHAPES.slice(0, tier.blockKinds);
  const cluster = (cell: (i: number, j: number) => Block) => {
    for (let tr = 0; tr < 40; tr++) {
      const tx = ri(1, gw - 4), ty = ri(1, gh - 4), sh = pick(SHAPES);
      const cells = sh.map(([a, b]) => cell(tx + a, ty + b));
      // blocks keep a free tile between themselves and the rock so discs can't get wedged
      if (cells.every(c => free(c.x0 + 8, c.y0 + 8, 11, 4) && clearOfRock(geo, c.x0 + 8, c.y0 + 8, 20)) && !cuts(cells.map(c => [c.x0 / TILE, c.y0 / TILE]))) {
        for (const c of cells) { blocks.push(c); objs.push({ x: c.x0 + 8, y: c.y0 + 8, r: 11 }); take(c.x0 / TILE, c.y0 / TILE); shut.add(hazKey(c.x0 / TILE, c.y0 / TILE)); }
        return;
      }
    }
  };
  const box = (i: number, j: number) => ({ x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE });
  const stone = (i: number, j: number): Block => ({ ...box(i, j), v: ri(0, 7) });
  const icicle = (i: number, j: number): Block => {
    const v = ri(0, 7), big = v % 2 === 0, max = big ? ICICLE_HP.big : ICICLE_HP.small;
    return { ...box(i, j), v, ice: true, big, hp: max, max };
  };
  // ice caves get one cluster more, and most of them are icicles, big and small, rising from the floor:
  // same one-tile footprint and bounce as stone, but discs can shatter them
  const icy = biome.iceMu !== undefined;
  const nBlocks = roll(tier.blocks) + extra.blocks + (icy ? 1 : 0), nIce = icy ? Math.ceil(nBlocks / 2) : 0;
  for (let k = 0; k < nBlocks - nIce; k++) cluster(stone);
  for (let k = 0; k < nIce; k++) cluster(icicle);

  const decals: Decal[] = [];
  for (let i = 0, n = ri(3, 6); i < n; i++) {
    const d0 = { x: 8 + R.next() * (Wx - 16), y: 8 + R.next() * (Wy - 16), k: ri(0, 2), a: R.next() * 3 };
    if (clearOfRock(geo, d0.x, d0.y, 5) && !pitAt(pits, d0.x, d0.y)) decals.push(d0);
  }

  const sc = partyScale(spec);
  const hpMul = MOB_HP_MUL * (1 + HP_STEP * (d - 1)) * (f > 0 ? LATER_HP : 1) * sc.hp, dmgAdd = dmgBonus(f, t), dmgMul = sc.dmg;
  // a share of n enemies for a smaller party; a fraction left over is one more enemy that often
  const fewer = (n: number, min: number) => {
    if (sc.mobs === 1) return n;
    const x = n * sc.mobs, k = Math.floor(x);
    return Math.max(min, k + (R.next() < x - k ? 1 : 0));
  };
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
  const count = Math.min(roll(tier.mobs) + f + extra.mobs, MOB_CAP);
  let mk: MobKind[];
  if (type === 'treasure') mk = [];
  else if (type === 'boss') mk = [cast.boss, ...draw(fewer(1 + f + extra.mobs, 0), SOLO)];
  else if (type === 'elite') mk = [cast.elite, ...draw(fewer(count - 1, 0), [cast.elite])];
  else mk = draw(fewer(count, 1));
  const mobs: Mob[] = [];
  for (const k of mk) {
    // a cut corner can eat the far half, so a mob that finds no room there stands anywhere short of the runes
    const sz = mobSize(k), r = MOBS[k].r, open = MOBS[k].boss ? main() : null;
    // the boss starts on the biggest piece of floor, never shut in a pocket of blocks
    const onMain = (x: number, y: number) => !open || open.id[(y / TILE - 1) * gw + x / TILE - 1] === open.at;
    const far2 = (x: number, y: number) => far(x, y) && onMain(x, y), short = (x: number, y: number) => x / Wx + y / Wy < 1.25 && onMain(x, y);
    const q = placeCell(sz, r, far2) ?? placeCell(sz, r, short) ?? placeCell(sz, r, far2, true) ?? placeCell(sz, r, short, true) ?? (open && placeCell(sz, r, onMain, true)) ?? placeCell(sz, r, any, true);
    if (!q) continue;
    mobs.push(newMob(k, q[0], q[1], hpMul, dmgAdd, dmgMul));
    objs.push({ x: q[0], y: q[1], r: MOBS[k].r });
    if (open) bossCell = (q[1] / TILE - 1) * gw + q[0] / TILE - 1;
  }

  const nodes: ResNode[] = [];
  if (cave && big) nodes.push(big);
  // in the ore cave the small veins and the mushrooms stand apart, from the big vein and from each other
  const apart = (x: number, y: number) => !cave || nodes.every(n => Math.hypot(x - n.x, y - n.y) > (n.s ? 3 : 2.5) * TILE);
  const kinds = NODE_SETS[type] ?? NODE_SETS.fight!;
  for (const k of kinds) {
    const open = (x: number, y: number) => !cuts([[Math.floor(x / TILE), Math.floor(y / TILE)]]);
    const side = (x: number, y: number) => flank(x, y) && apart(x, y) && open(x, y);
    const q = placeCell(1, NODES[k].r, side) ?? placeCell(1, NODES[k].r, (x, y) => apart(x, y) && open(x, y)) ?? placeCell(1, NODES[k].r, (x, y) => mid(x, y) && open(x, y)) ?? placeCell(1, NODES[k].r, open) ?? placeCell(1, NODES[k].r, any, true);
    if (!q) continue;
    const ch = cave && k === 'ore' ? CAVE.small : sc.ch[k] ?? NODES[k].ch;
    nodes.push({ k, ...NODES[k], ch, x: q[0], y: q[1], left: ch, hit: 0 });
    objs.push({ x: q[0], y: q[1], r: NODES[k].r });
    shut.add(hazKey(Math.floor(q[0] / TILE), Math.floor(q[1] / TILE)));
  }

  const haz = new Set<string>();
  const hazOk = (tx: number, ty: number) => {
    const cx = tx * TILE + 8, cy = ty * TILE + 8;
    return isFloor(geo, tx, ty) && !haz.has(hazKey(tx, ty)) && mid(cx, cy) && pads.every(p => Math.hypot(p.x - cx, p.y - cy) > 26) && objs.every(o => Math.hypot(o.x - cx, o.y - cy) > o.r + 4);
  };
  const nHaz = roll(tier.haz) + (t === 0 ? Math.min(f, 1) : f) + extra.haz;
  // before the boss and around it a strip of three tiles cuts the room
  if (t >= TIERS.length - 1 && type !== 'treasure') {
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
  return { gw, gh, shape, floor, edges, rock, Wx, Wy, biome, pads, pits, blocks, decals, nodes, mobs, haz, ice, hpMul, dmgAdd, dmgMul };
}
