// Procedural room generator. Pure: the same RoomSpec always yields the same layout.

import type { Knock } from './fx';
import type { Bet, Floor } from './events';
import { BIOMES, MOB_HP_MUL, MOBS, NODES, TILE, isRanged, mobSize, toughOf, type Biome, type MobKind, type NodeKind, type RoomType } from './data';
import { makeRng, mulberry32 } from './rng';
import { DEMO, DEMO_BOSS } from './demo';
import { LAYERS } from './run';
import { TRINKET_CHANCE, trinketsOf } from './trinkets';

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
  /** The foam party's floor under the discs (src/events.ts): they keep their speed off the walls, roll twice as far, or stick. */
  ground?: Floor;
  /** The bookie's bet this fight settles (src/events.ts settleBet). */
  bet?: Bet;
  /** One disc a turn more for every hero in this fight only (the guard's reward at the black market). */
  extra?: number;
  /** The boss room's boss, when not the one its seed picks (bossOf): a test or the bot may name it. */
  boss?: MobKind;
  /** The warm-up room of the hero's lesson, built by hand (warmRoom): the same for any seed. */
  tut?: boolean;
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
/** A trinket lying in the room (src/trinkets.ts), in the middle of its cell; `by` the hero who took it, `t` seconds since then. */
export interface Trinket { k: string; x: number; y: number; by?: number; t: number }

export interface ResNode {
  k: NodeKind;
  name: string;
  r: number;
  ch: number;
  x: number;
  y: number;
  left: number;
  hit: number;
  /** Cells it covers on each side, 1 if not set. */
  s?: number;
}

/** What a floor boss's marked cells do to a hero standing on them: freeze, the dancefloor's beat, the beams, the roll, the fire. */
export type Zone = 'cold' | 'dance' | 'beam' | 'roll' | 'fire';

/**
 * What a mob will do in the coming enemy turn, shown to the players beforehand.
 * hit/move/charge aim at one hero; slam hits every hero (hero = -1); heal names the mob it mends;
 * summon and heat carry the spots that light up on the floor a turn ahead. The floor bosses': zone marks the cells its
 * blow falls on (`z` what it does there), emerge the cells round where the rat swarm comes up out of its burrow; dive
 * sends the swarm down one, toss is the fridge throwing food at a hero, brew Пахан treating its шестёрки. idle is a dummy
 * of the warm-up room standing there.
 */
export interface Intent {
  t: 'hit' | 'move' | 'charge' | 'slam' | 'heal' | 'summon' | 'heat' | 'scream' | 'smash' | 'rise' | 'zone' | 'emerge' | 'dive' | 'toss' | 'brew' | 'idle';
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
  /** A `move` toward the kid's firecracker lying here instead of the hero: it strikes nobody this turn. */
  bang?: { x: number; y: number };
  /**
   * It goes for this enemy (its index in the room's list) instead of a hero (`hero` is -1): kissed by the model, the nearest
   * other one; not kissed, one the model has kissed.
   */
  foe?: number;
  /** Kissed, with no other enemy left to go for: it stands and sighs and strikes nobody. */
  sigh?: boolean;
  /** A `zone`: what its cells do to a hero standing on them. */
  z?: Zone;
  /** A `toss`: what the fridge throws, an index into FOOD_TOSS. */
  item?: number;
  /** A `move` away from the heroes: the swarm's last rats running off, the dancer moonwalking. */
  flee?: boolean;
  /** Where the swarm comes up out of its burrow, or where the rolling ball stops. */
  to?: { x: number; y: number };
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
  /** Hits of the ice genius's frosted disc this turn: one slows it on its next move, two make it skip the move. */
  frost?: number;
  /** The model's kiss, by the hero who blew it: on its moves it goes for the nearest other enemy instead of the heroes. */
  kiss?: number;
  /** The enemy turns the kiss still holds, the coming one among them. */
  kissLeft?: number;
  /** The bouncer has just thrown it a cell on: where it stood, and how far along the slide is, 0 to 1. */
  slid?: { x: number; y: number; t: number };
  /** Thrown over a hole by the bouncer: it dropped in and is out of the fight; counts up as it sinks out of sight. */
  fell?: number;
  /** A coffin: who lies in it, and the enemy turns till it gets up. */
  hold?: MobKind;
  rise?: number;
  /** The rat swarm is down a burrow: the hole (by index in the room's list) where its eyes glow and it comes up next. */
  under?: number;
  /** Пахан's «общак»: the ore its blows have taken from the party, paid back twice when it falls. */
  pot?: number;
  /** Times Пахан has treated this шестёрка («Подогрев»): its blow grows with each, up to a limit. */
  brew?: number;
  /** The fridge's door stands open till its next move, facing this way: a disc into it hits twice as hard, past the armour. */
  open?: { x: number; y: number };
  /** The dragon goes after this hero on its next move, for breaking one of its eggs. */
  mad?: number;
  /** Floor cells covered in the disco ball's mirror tiles: a disc that stops there hurts its hero like spikes. */
  shards?: string[];
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
  /** The room's trinket, if it has one: a fight now and then. */
  trinket: Trinket | null;
  nodes: ResNode[];
  mobs: Mob[];
  haz: Set<string>;
  /** 1 where the cell is iced over (slippery), row-major gw × gh; all zeros outside icy biomes. */
  ice: Uint8Array;
  hpMul: number;
  dmgAdd: number;
  dmgMul: number;
}

/**
 * An enemy's blow: its own plus the floor's extra, cut for a smaller party, plus `plus` (a boss's BOSS_UP), and then
 * `toughOf` more. Blows are a few points, so a plain rounding would leave a 3 a 3 and make a 5 a 6: the fraction left
 * is paid as one point more by a coin instead, the same for every enemy of a kind in a room (by the room's seed), so on
 * the average every blow grows by the same share and two skeletons side by side still hit alike. Without a `room` (the
 * warm-up dummies, the dragon's eggs) or for a kind that doesn't hit the blow stays as it was.
 */
export function mobDmg(k: MobKind, dmgAdd = 0, dmgMul = 1, room: number | null = null, plus = 0) {
  const n = Math.max(1, Math.round((MOBS[k].dmg + dmgAdd) * dmgMul)) + plus;
  if (room === null || !MOBS[k].dmg) return n;
  let h = room | 0;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  const x = n * toughOf(k), whole = Math.floor(x + 1e-9);
  return whole + (mulberry32(h)() < x - whole ? 1 : 0);
}

/** An enemy; one a room's fight brings (`room`, its seed) gets `toughOf` more HP and blow, see `mobDmg`. */
export function newMob(k: MobKind, x: number, y: number, hpMul = 1, dmgAdd = 0, dmgMul = 1, room: number | null = null): Mob {
  const d = MOBS[k];
  const hp = Math.round(d.hp * hpMul * (room === null ? 1 : toughOf(k)));
  return {
    k, name: d.name, r: d.r, speed: d.speed, reach: d.reach, armor: d.armor,
    hp, max: hp, dmg: mobDmg(k, dmgAdd, dmgMul, room), x, y, flash: 0, dead: 0, burn: 0, intent: null,
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

// with 4–5 fights on every path (thread «Карта и элита») the rooms from the third row on hold 2–3 enemies, not 3–4
export const TIERS: Tier[] = [
  { gw: [10, 11], gh: [8, 9], shapes: ['rect'], blocks: [1, 1], blockKinds: 1, pits: [0, 0], pitCells: 0, haz: [0, 0], mobs: [2, 2] },
  { gw: [11, 12], gh: [9, 9], shapes: ['rect', 'corner'], blocks: [1, 2], blockKinds: 3, pits: [0, 0], pitCells: 0, haz: [1, 1], mobs: [2, 3] },
  { gw: [12, 13], gh: [10, 10], shapes: ['corner', 'alcove'], blocks: [1, 2], blockKinds: 4, pits: [0, 1], pitCells: 2, haz: [1, 2], mobs: [2, 2] },
  { gw: [13, 14], gh: [10, 11], shapes: ['alcove', 'funnel', 'corner'], blocks: [2, 2], blockKinds: 4, pits: [0, 1], pitCells: 4, haz: [2, 3], mobs: [2, 3] },
  { gw: [14, 15], gh: [11, 12], shapes: ['funnel', 'cross', 'alcove'], blocks: [2, 3], blockKinds: 5, pits: [1, 2], pitCells: 9, haz: [3, 3], mobs: [2, 3] },
];
/** The boss fights among as many columns, holes and hazards as the last room before it; its holes stay small enough to walk round. */
export const BOSS_TIER: Tier = { gw: [14, 15], gh: [12, 12], shapes: ['rect', 'cross'], blocks: [3, 3], blockKinds: 5, pits: [1, 2], pitCells: 4, haz: [3, 3], mobs: [3, 3] };

/** Most floor cells the holes of one room take: next to a 3 × 3 hole there is room only for a 1 × 1. */
export const PIT_CELLS = 10;

/** Most enemies a room starts with: past this a room is a crowd, not a fight. */
export const MOB_CAP = 5;

/** The room's row on its floor's map (0 = entrance). */
export const rowOf = (spec: Pick<RoomSpec, 'depth' | 'floor'>) => Math.max(0, Math.min(LAYERS - 1, spec.depth - 1 - spec.floor * LAYERS));

/** Map row to its tier: the six rows of fights grow from the entrance to the last room before the boss. */
export function tierOf(spec: RoomSpec): { tier: Tier; t: number } {
  if (spec.type === 'boss') return { tier: BOSS_TIER, t: TIERS.length };
  const t = [0, 1, 2, 2, 3, 4][rowOf(spec)] ?? TIERS.length - 1;
  return { tier: TIERS[t], t };
}

/**
 * Rooms of the run before this one, for the enemies' HP: the rest row before the boss doesn't count, so with a fight
 * row more on each floor every row's enemies have the HP they had on the 7-row map.
 */
export const hpStep = (spec: Pick<RoomSpec, 'depth' | 'floor'>) => spec.floor * (LAYERS - 1) + Math.min(rowOf(spec), LAYERS - 2);

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

/**
 * Throw runes by the size of the room: three up to the first of these many floor cells, four up to the second, five
 * past it. The first rooms of a floor have three, the middle ones mostly four, the last rooms and the boss's mostly five.
 * A party is three heroes at most, so every hero always has one.
 */
export const RUNE_AREA = [100, 130];

/** Throw runes for a room with this many cells of floor. */
export const runes = (cells: number) => 3 + RUNE_AREA.filter(a => cells > a).length;

/** Throw runes: spread along the near boundary of the floor, as many as the room's size asks for. */
function pickPads(gw: number, gh: number, floor: Uint8Array, R: ReturnType<typeof makeRng>): Pad[] {
  const L = { gw, gh, floor };
  const n = runes(floor.reduce((a, b) => a + b, 0));
  const cand: [number, number][] = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!isFloor(L, i, j)) continue;
    const nearEdge = !isFloor(L, i + 1, j) || !isFloor(L, i, j + 1);
    if (nearEdge && (i + 0.5) / gw + (j + 0.5) / gh > 1.05) cand.push([i, j]);
  }
  cand.sort((p, q) => q[0] + q[1] - (p[0] + p[1]));
  const chosen: [number, number][] = [cand[0]];
  for (let minD = 3.5; chosen.length < n && minD > 0.9; minD -= 0.5) {
    while (chosen.length < n) {
      let best: [number, number] | null = null, bd = -1;
      for (const c of cand) {
        const d = Math.min(...chosen.map(o => Math.hypot(o[0] - c[0], o[1] - c[1])));
        if (d >= minD && d > bd) { bd = d; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }
  }
  // a rune sits in the middle of its cell, so the hero's stand fits inside it; the eight draws that once nudged the
  // four runes off centre stay, whatever the count, so a seed still lays out the rest of the room the same
  for (let k = 0; k < 8; k++) R.next();
  return chosen.map(([i, j]) => ({ x: i * TILE + 8, y: j * TILE + 8 }));
}

/** Block clusters from plain to awkward: single, pairs, an L, a diagonal pair. */
const BLOCK_SHAPES = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 1]]];

/**
 * Each floor has its own cast: how likely each enemy is in a regular fight on each of the six fight rows, who leads an
 * elite fight, and its boss. Weak enemies crowd the first rooms and thin out (the prison rat is gone by the fifth row),
 * tougher ones come in half way and the floor's heavy hitters only in the last two rows.
 */
export const CASTS: { rows: Partial<Record<MobKind, number[]>>; elite: MobKind; boss: MobKind; bosses: MobKind[] }[] = [
  {
    rows: {
      skel: [3, 3, 3, 3, 2, 2],
      archer: [1, 2, 2, 2, 2, 2],
      rat: [3, 3, 1, 1, 0, 0],
      guard: [0, 0, 1, 2, 2, 2],
      necro: [0, 0, 0, 0, 1, 1],
    },
    elite: 'headsman', boss: 'king', bosses: ['king', 'ratswarm', 'pahan'],
  },
  {
    rows: {
      ghoul: [3, 3, 3, 2, 2, 1],
      ghost: [1, 2, 2, 2, 2, 2],
      yeti: [0, 0, 1, 1, 2, 2],
      undertaker: [0, 0, 1, 1, 1, 1],
      witch: [0, 0, 0, 0, 1, 1],
    },
    elite: 'banshee', boss: 'lich', bosses: ['lich', 'fridge', 'dancer'],
  },
  {
    rows: {
      imp: [3, 3, 3, 2, 1, 1],
      slime: [1, 2, 2, 2, 2, 2],
      bomber: [0, 1, 1, 1, 1, 1],
      grinder: [0, 0, 1, 1, 2, 2],
      golem: [0, 0, 0, 0, 1, 1],
    },
    elite: 'smasher', boss: 'forgelord', bosses: ['forgelord', 'discoball', 'dragon'],
  },
];

/** The floor's cast. */
export const castOf = (f: number) => CASTS[Math.min(f, CASTS.length - 1)];

/**
 * The boss of a floor's boss room: one of the floor's three, by the room's seed, so every screen, a reloaded game and the
 * map before it all meet the same one, and the next run may bring another.
 */
export const bossOf = (spec: Pick<RoomSpec, 'seed' | 'floor' | 'boss'>) => {
  // the demo has the king alone
  const list = DEMO ? [DEMO_BOSS] : castOf(spec.floor).bosses;
  return spec.boss ?? list[makeRng(spec.seed * 13 + spec.floor * 7 + 991).int(0, list.length - 1)];
};

/**
 * Floor bosses parties beat too often (thread «Сложность боссов»): more health and a harder blow, by party size (one, two,
 * three heroes). `hp` multiplies the boss's health, `dmg` is added to its blow after the party's cut, so its special moves
 * and later phases hit that much harder too. Tuned with the average-player bot so parties that reach each of them win
 * about 60% of the fights; a trio comes to the later floors strong, so it gets the most.
 */
export const BOSS_UP: Partial<Record<MobKind, { hp: number[]; dmg: number[] }>> = {
  pahan: { hp: [1, 1.3, 1.45], dmg: [0, 0, 0] },
  fridge: { hp: [1.3, 1.6, 2], dmg: [0, 3, 6] },
  dancer: { hp: [1, 1.1, 1.3], dmg: [0, 0, 0] },
  forgelord: { hp: [1.4, 2, 2.1], dmg: [2, 3, 6] },
  dragon: { hp: [1.2, 1.7, 2], dmg: [2, 3, 3] },
};

/** Enemies a boss brings fewer of: Пахан has his шестёрки instead of an escort, the dragon its eggs. */
const LESS_ESCORT: Partial<Record<MobKind, number>> = { pahan: 9, dragon: 1 };

/** Enemies a fight on this row of the floor draws from, each as many times as its weight; past the fight rows (the boss's escort) the last row's. */
export function mobPool(f: number, row: number): MobKind[] {
  const rows = castOf(f).rows, r = Math.min(row, 5);
  return (Object.keys(rows) as MobKind[]).flatMap(k => Array<MobKind>(rows[k]![r]).fill(k));
}

/** Enemies that set the pace of a fight: at most one of each in a room, and none in the boss's escort. */
const SOLO: MobKind[] = ['golem', 'necro', 'witch', 'yeti', 'bomber', 'undertaker', 'grinder', 'headsman', 'banshee', 'smasher'];

/**
 * Resources in each kind of fight room: one of each, so the floor stays clear. Ore is scarce, so a party can't buy
 * every upgrade in one run; an elite fight pays a second vein. The ore cave rolls its own (CAVE).
 */
export const NODE_SETS: Partial<Record<RoomType, NodeKind[]>> = {
  fight: ['ore', 'spk', 'herb'],
  elite: ['ore', 'ore', 'spk', 'herb'],
  boss: ['ore', 'spk', 'herb'],
};

/**
 * A spark crystal holds one ability, and the bigger the room, the more of them: one up to the first of these many floor
 * cells (holes left out), two up to the second, three past it. The first rows of a floor are small rooms with one,
 * the last rooms and the boss's mostly have three.
 */
export const SPK_AREA = [100, 130];

/** Spark crystals for a room with this many cells of floor outside its holes. */
export const crystals = (cells: number) => 1 + SPK_AREA.filter(a => cells > a).length;

/**
 * The ore cave holds no enemies, and each one is stocked differently: a clump of three small veins grown into one rock
 * in the middle of the room or none, two to five small veins and up to two mushroom patches off to the sides (`n`: how
 * many, each count as likely). The clump stands on three cells of a 2 × 2 square (`r` keeps the room clear round it).
 * It has only `turns` minus the heroes: three turns for a lone hero, one for three heroes, who throw three times as many
 * discs a turn. Each throw goes for ore or for health. It ends once the turns run out or nothing is left
 * to hit. Its veins hold as many charges whatever the party: the turns already make up for its size.
 */
export const CAVE = { turns: 4, clump: { r: 12, n: [0, 1] as Range }, small: { ch: 2, n: [2, 5] as Range }, herbs: [0, 2] as Range };

/** What one ore cave holds, from its own stream of the seed, so the rest of the room is laid out as before. */
export function caveStock(spec: Pick<RoomSpec, 'seed' | 'depth'>) {
  const R = makeRng(spec.seed * 31 + spec.depth + 4241), roll = (r: Range) => R.int(r[0], r[1]);
  // the last roll: which cell of the clump's square stays free
  return { clump: roll(CAVE.clump.n), ore: roll(CAVE.small.n), herb: roll(CAVE.herbs), gap: R.int(0, 3) };
}

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
 * Rooms are made for a party of three. A smaller party meets fewer enemies (summons included), with less HP and softer hits.
 * Spark crystals hold as much for any party: one ability for every hero. Tuned with the bot so one, two and three heroes
 * get about as far through a run: a lone hero has one throw a turn and nobody to stand in for it, so it gets the biggest cut.
 * Resources grow with the party. Ore veins hold more charges than one a hero: each hero buys their own upgrades, while
 * the blacksmith's gift, the ore cave and the events pay the same to any party, so without this a trio ended up with
 * little more than half a lone hero's ore each. A mushroom heals only the hero who threw at it, so a bigger party finds
 * more mushroom patches in a fight (`herbs`, the ore cave aside) and a trio's hold more: as many heals for every hero.
 */
export const PARTY_SCALE: Record<number, { mobs: number; hp: number; dmg: number; herbs: number; ch: Partial<Record<NodeKind, number>> }> = {
  1: { mobs: 0.4, hp: 0.5, dmg: 0.6, herbs: 1, ch: { ore: 1 } },
  2: { mobs: 0.7, hp: 0.8, dmg: 0.8, herbs: 2, ch: { ore: 3 } },
  3: { mobs: 1, hp: 1, dmg: 1, herbs: 2, ch: { ore: 5, herb: 3 } },
};

export const partyScale = (spec: Pick<RoomSpec, 'heroes'>) => PARTY_SCALE[Math.max(1, Math.min(3, spec.heroes ?? 3))];

/** Past the first floor rooms hold fewer enemies than they used to, so each one there is tougher: this much more HP (on top of MOB_HP_MUL) and one more damage. */
export const LATER_HP = 1.2;

/** Extra damage per hit: two on the second floor and one more on each floor after it, and one more in the last rooms before the boss. */
export const dmgBonus = (f: number, t: number) => (f > 0 ? f + 1 : 0) + (t >= 3 ? 1 : 0);

/**
 * The warm-up room, where the hero shows a newcomer the ropes on three dummies, by hand: one rune, the plain dummy
 * off it on a slant (on a phone a straight-ahead one stands behind the hero's own figure, and the arrow to it with it),
 * the boxer on the other side where it sees the cells round the plain dummy, a spark crystal near the rune, and the
 * lady dummy in a far corner behind a column, so only a disc off a wall reaches her.
 */
export const WARM = { gw: 10, gh: 8, rune: [8, 3], dummy: [5, 5], boxer: [4, 1], lady: [1, 5], column: [[3, 5], [3, 4]], crystal: [7, 1] } as const;

function warmRoom(): Layout {
  const { gw, gh } = WARM, floor = new Uint8Array(gw * gh).fill(1);
  const { edges, rock } = buildEdges(gw, gh, floor);
  const at = (c: readonly [number, number] | readonly number[]) => cellCentre(c[0], c[1]);
  const mob = (k: MobKind, c: readonly number[]) => { const p = at(c); return newMob(k, p.x, p.y); };
  const crystal = at(WARM.crystal);
  return {
    gw, gh, shape: 'rect', floor, edges, rock, Wx: gw * TILE, Wy: gh * TILE, biome: BIOMES[0],
    pads: [at(WARM.rune)], pits: [],
    blocks: WARM.column.map(([i, j], k) => ({ x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE, v: k + 2 })),
    decals: [{ x: 40, y: 100, k: 0, a: 0.6 }, { x: 118, y: 52, k: 2, a: 2.1 }], trinket: null,
    nodes: [{ k: 'spk', ...NODES.spk, x: crystal.x, y: crystal.y, left: NODES.spk.ch, hit: 0 }],
    mobs: [mob('dummy', WARM.dummy), mob('dummy_boxer', WARM.boxer), mob('dummy_lady', WARM.lady)],
    haz: new Set(), ice: new Uint8Array(gw * gh), hpMul: 1, dmgAdd: 0, dmgMul: 1,
  };
}

export function generate(spec: RoomSpec): Layout {
  if (spec.tut) return warmRoom();
  const R = makeRng(spec.seed * 31 + spec.depth);
  const { int: ri, pick } = R;
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
      let ok = free(c.x, c.y, r, tight ? -2 : 6) && clearOfRock(geo, c.x, c.y, r + (tight ? 1 : 6));
      for (let b = 0; b < s && ok; b++) for (let a = 0; a < s && ok; a++) ok = isFloor(geo, i + a, j + b) && !taken.has(hazKey(i + a, j + b));
      // the test last: in the boss room it walks the floor
      if (ok && test(c.x, c.y)) { take(i, j, s); return [c.x, c.y]; }
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
  // the rat swarm's room always has two or three small holes for its burrows
  const boss = type === 'boss' ? bossOf(spec) : null, burrows = boss === 'ratswarm';
  const nPits = burrows ? ri(2, 3) : roll(tier.pits);
  if (nPits) {
    // shapes in a random order, so each hole in a room is a different one
    const size = (k: PitKind) => PIT_SHAPES[k].length;
    const kinds = PIT_KINDS.filter(k => size(k) <= (burrows ? 3 : tier.pitCells));
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

  // the ore cave's clump of veins stands in the middle of the room, a straight throw from every rune, on three cells of
  // a 2 × 2 square; it goes in before the blocks, so they keep out of its way
  const cave = type === 'treasure', stock = cave ? caveStock(spec) : null;
  const clump: ResNode[] = [];
  if (stock?.clump) {
    const { r } = CAVE.clump, ch = CAVE.small.ch, centre = (x: number, y: number) => Math.abs(x / Wx - 0.5) < 0.18 && Math.abs(y / Wy - 0.5) < 0.18;
    const q = placeCell(2, r, centre) ?? placeCell(2, r, mid) ?? placeCell(2, r, any) ?? placeCell(2, r, any, true);
    if (q) {
      for (let k = 0; k < 4; k++) if (k !== stock.gap) clump.push({ k: 'ore', ...NODES.ore, ch, x: q[0] + (k % 2 ? 8 : -8), y: q[1] + (k < 2 ? -8 : 8), left: ch, hit: 0 });
      // each vein keeps the others off its sides too, so no other vein grows into the clump
      objs.push({ x: q[0], y: q[1], r }, ...clump.map(n => ({ x: n.x, y: n.y, r: n.r })));
    }
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
  // the disco ball's room has a column more to bank the discs off
  const nBlocks = roll(tier.blocks) + extra.blocks + (icy ? 1 : 0) + (boss === 'discoball' ? 1 : 0), nIce = icy ? Math.ceil(nBlocks / 2) : 0;
  for (let k = 0; k < nBlocks - nIce; k++) cluster(stone);
  for (let k = 0; k < nIce; k++) cluster(icicle);

  const decals: Decal[] = [];
  for (let i = 0, n = ri(3, 6); i < n; i++) {
    const d0 = { x: 8 + R.next() * (Wx - 16), y: 8 + R.next() * (Wy - 16), k: ri(0, 2), a: R.next() * 3 };
    if (clearOfRock(geo, d0.x, d0.y, 5) && !pitAt(pits, d0.x, d0.y)) decals.push(d0);
  }

  const sc = partyScale(spec);
  const hpMul = MOB_HP_MUL * (1 + HP_STEP * hpStep(spec)) * (f > 0 ? LATER_HP : 1) * sc.hp, dmgAdd = dmgBonus(f, t), dmgMul = sc.dmg;
  // a share of n enemies for a smaller party; a fraction left over is one more enemy that often
  const fewer = (n: number, min: number) => {
    if (sc.mobs === 1) return n;
    const x = n * sc.mobs, k = Math.floor(x);
    return Math.max(min, k + (R.next() < x - k ? 1 : 0));
  };
  const pool = mobPool(f, rowOf(spec)), cast = castOf(f);
  const solo = (k: MobKind) => SOLO.includes(k) || (t === 0 && isRanged(k));
  const draw = (n: number, has: MobKind[] = []) => {
    const out: MobKind[] = [];
    for (let i = 0; i < n; i++) {
      let k = pick(pool);
      // one shooter at most in the first room, one of each heavy hitter anywhere,
      // and never more than two shooters of a kind: a room full of them can't be reached
      const full = (k: MobKind) => (solo(k) && (out.includes(k) || has.includes(k))) || (isRanged(k) && out.filter(o => o === k).length >= 2);
      for (let tr = 0; tr < 8 && full(k); tr++) k = pick(pool);
      if (full(k)) k = pool[0];
      out.push(k);
    }
    return out;
  };
  const count = Math.min(roll(tier.mobs) + f + extra.mobs, MOB_CAP);
  let mk: MobKind[];
  if (type === 'treasure') mk = [];
  else if (type === 'boss') mk = [boss!, ...draw(fewer(Math.max(0, 1 + f + extra.mobs - (LESS_ESCORT[boss!] ?? 0)), 0), SOLO)];
  else if (type === 'elite') mk = [cast.elite, ...draw(fewer(count - 1, 0), [cast.elite])];
  else mk = draw(fewer(count, 1));
  const mobs: Mob[] = [];
  for (const k of mk) {
    // a cut corner can eat the far half, so a mob that finds no room there stands anywhere short of the runes
    const sz = mobSize(k), r = MOBS[k].r, piece = MOBS[k].boss ? main() : null;
    // the boss starts on the biggest piece of floor, never shut in a pocket of blocks
    const onMain = (x: number, y: number) => !piece || piece.id[(y / TILE - 1) * gw + x / TILE - 1] === piece.at;
    const far2 = (x: number, y: number) => far(x, y) && onMain(x, y), short = (x: number, y: number) => x / Wx + y / Wy < 1.25 && onMain(x, y);
    const q = placeCell(sz, r, far2) ?? placeCell(sz, r, short) ?? placeCell(sz, r, far2, true) ?? placeCell(sz, r, short, true) ?? (piece && placeCell(sz, r, onMain, true)) ?? placeCell(sz, r, any, true);
    if (!q) continue;
    const m = newMob(k, q[0], q[1], hpMul, dmgAdd, dmgMul, spec.seed), up = MOBS[k].boss && BOSS_UP[k], at = Math.max(1, Math.min(3, spec.heroes ?? 3)) - 1;
    if (up) { m.hp = m.max = Math.round(m.hp * up.hp[at]); m.dmg = mobDmg(k, dmgAdd, dmgMul, spec.seed, up.dmg[at]); }
    mobs.push(m);
    objs.push({ x: q[0], y: q[1], r: MOBS[k].r });
    if (piece) bossCell = (q[1] / TILE - 1) * gw + q[0] / TILE - 1;
  }
  // the dragon sits on its eggs: they lie on the cells right round it (as many as it can find room for), the same for any
  // floor, so a fair hit or two breaks one
  const nest = boss && mobs[0]?.k === boss ? MOBS[boss].nest ?? 0 : 0;
  for (let k = 0, n = nest && Math.max(1, Math.round(nest * sc.mobs)); k < n; k++) {
    const b = mobs[0], by = (x: number, y: number) => Math.abs(x - b.x) <= 1.5 * TILE + 1 && Math.abs(y - b.y) <= 1.5 * TILE + 1;
    const q = placeCell(1, MOBS.egg.r, by, true);
    if (!q) break;
    const egg = newMob('egg', q[0], q[1]);
    egg.owner = 0; egg.hold = 'imp';
    mobs.push(egg);
    objs.push({ x: q[0], y: q[1], r: MOBS.egg.r });
  }

  const nodes: ResNode[] = [];
  nodes.push(...clump);
  // in the ore cave the small veins and the mushrooms stand apart, from the clump and from each other;
  // in a fight the mushroom patches keep away from each other, so heroes on different runes each have one in reach
  const apart = (x: number, y: number, k: NodeKind) =>
    cave ? nodes.every(n => Math.hypot(x - n.x, y - n.y) > (clump.includes(n) ? 3 : 2.5) * TILE) : k !== 'herb' || nodes.every(n => n.k !== 'herb' || Math.hypot(x - n.x, y - n.y) > 4 * TILE);
  const ground = floor.reduce((a, b) => a + b, 0) - pits.reduce((a, p) => a + p.cells.length, 0);
  // a bigger party's mushroom patches come after the room's own resources; a bigger room's second and third crystals
  // come last, and stay out if no fair place is left for them
  const set = stock ? [...Array<NodeKind>(stock.ore).fill('ore'), ...Array<NodeKind>(stock.herb).fill('herb')] : NODE_SETS[type] ?? NODE_SETS.fight!, more = set.includes('spk') ? crystals(ground) - 1 : 0;
  const herbs = cave ? 0 : Math.max(0, sc.herbs - set.filter(k => k === 'herb').length);
  const kinds = [...set, ...Array<NodeKind>(herbs).fill('herb'), ...Array<NodeKind>(more).fill('spk')];
  for (const [n, k] of kinds.entries()) {
    const open = (x: number, y: number) => !cuts([[Math.floor(x / TILE), Math.floor(y / TILE)]]);
    const side = (x: number, y: number) => flank(x, y) && apart(x, y, k) && open(x, y);
    const extra = n >= set.length + herbs;
    // a second mushroom patch would rather stand against a wall than next to the first
    const away = k === 'herb' && !cave && nodes.some(o => o.k === 'herb');
    const q = placeCell(1, NODES[k].r, side) ?? placeCell(1, NODES[k].r, (x, y) => apart(x, y, k) && open(x, y)) ?? (away ? placeCell(1, NODES[k].r, (x, y) => apart(x, y, k) && open(x, y), true) : null) ?? placeCell(1, NODES[k].r, (x, y) => mid(x, y) && open(x, y)) ?? placeCell(1, NODES[k].r, open) ?? (extra ? null : placeCell(1, NODES[k].r, any, true));
    if (!q) continue;
    // the ore cave's veins and mushrooms hold as much for any party
    const ch = cave ? (k === 'ore' ? CAVE.small.ch : NODES[k].ch) : sc.ch[k] ?? NODES[k].ch;
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
  // a trinket now and then, on a cell nothing else stands on, a step off the runes; its own stream too
  let trinket: Trinket | null = null;
  const TR = makeRng(spec.seed * 53 + spec.depth + 104729), lot = trinketsOf(f);
  if (type !== 'camp' && type !== 'forge' && type !== 'event' && lot.length && TR.next() < TRINKET_CHANCE) {
    const k = TR.pick(lot).key;
    for (let tr = 0; tr < 200 && !trinket; tr++) {
      const i = TR.int(0, gw - 1), j = TR.int(0, gh - 1), c = cellCentre(i, j);
      if (!isFloor(geo, i, j) || taken.has(hazKey(i, j)) || haz.has(hazKey(i, j)) || pitAt(pits, c.x, c.y) || !clearOfRock(geo, c.x, c.y, 4)) continue;
      if (pads.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 1.5 * TILE) || objs.some(o => Math.hypot(o.x - c.x, o.y - c.y) < o.r + 6)) continue;
      trinket = { k, x: c.x, y: c.y, t: 0 };
    }
  }
  return { gw, gh, shape, floor, edges, rock, Wx, Wy, biome, pads, pits, blocks, decals, trinket, nodes, mobs, haz, ice, hpMul, dmgAdd, dmgMul };
}
