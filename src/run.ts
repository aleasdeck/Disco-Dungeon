// Run structure: 3 floors, each a layered branching map of rooms; a path takes 8 rooms ending at the boss.

import { ROOM_TYPES, type RoomType } from './data';
import { makeRng } from './rng';

export interface MapNode { id: string; l: number; i: number; type: RoomType; next: string[] }

export interface Run {
  seed: number;
  floor: number;
  path: string[][];
  floors: MapNode[][][];
  /** The events the party has met this run, so the next event room is a new one; older saves have none. */
  seen?: string[];
}

export const FLOORS = 3;
/** Rows of a floor: the entrance fight, five rows of choices, the rest row and the boss. */
export const LAYERS = 8;
/** The row before the boss: a camp and a blacksmith's, and a route comes to one of them only, so the party picks it on the way there. */
export const REST_ROW = LAYERS - 2;
/**
 * Rows where a floor may hold a blacksmith's before the rest row. Disc upgrades are sold only there, so every entrance
 * keeps a route through one by the middle of the floor: with blacksmiths only at the end the bot reached floor 2 far less often.
 */
export const FORGE_ROWS = [2, 3, 4];
/** Fights (elites included, the entrance too, the boss not) on every route through a floor. */
export const FIGHTS: [number, number] = [4, 5];
/** Most elites on one route, and fewest on a floor. */
export const ELITES = { path: 2, floor: 2 };

/** Rooms that are not fights: never the same one twice in a row on a route. */
const SPECIAL: RoomType[] = ['elite', 'camp', 'forge', 'event', 'treasure'];
export const isFight = (t: RoomType) => t === 'fight' || t === 'elite';

/** Every route through a floor, entrance to boss. */
export function routes(layers: MapNode[][]): MapNode[][] {
  const by = new Map(layers.flat().map(n => [n.id, n]));
  const out: MapNode[][] = [];
  const go = (n: MapNode, acc: MapNode[]) => { const a = [...acc, n]; if (!n.next.length) out.push(a); else n.next.forEach(id => go(by.get(id)!, a)); };
  layers[0].forEach(n => go(n, []));
  return out;
}

/** The rules a floor keeps (besides its fights per route): see genFloor. */
export function floorOk(layers: MapNode[][]): boolean {
  const by = new Map(layers.flat().map(n => [n.id, n]));
  for (const n of layers.flat()) {
    if (n.type === 'elite' && n.l < 2) return false;
    const kids = n.next.map(id => by.get(id)!);
    if (kids.length > 1 && kids[0].type === kids[1].type && kids[0].type !== 'boss') return false;
    if (kids.some(k => k.type === n.type && SPECIAL.includes(n.type))) return false;
  }
  if (layers.flat().filter(n => n.type === 'elite').length < ELITES.floor) return false;
  if (!layers[REST_ROW - 1].every(n => n.next.length === 1)) return false;
  const all = routes(layers);
  if (!layers[0].every(e => all.some(p => p[0] === e && p.some(n => n.type === 'forge' && n.l < REST_ROW)))) return false;
  return all.every(p => {
    const k = p.filter(n => isFight(n.type)).length;
    return k >= FIGHTS[0] && k <= FIGHTS[1] && p.filter(n => n.type === 'elite').length <= ELITES.path;
  });
}

/**
 * One floor, built row by row like Slay the Spire's map: random rooms, but every route holds FIGHTS fights, a fork never
 * leads to two rooms of a kind, a special room never comes twice in a row, elites wait for the third row, no two paths
 * cross, and the rest row before the boss is a camp and a blacksmith's, each room before it leading to one of them.
 */
export function genFloor(seed: number, f: number): MapNode[][] {
  const R = makeRng(seed + f * 1013);
  const wpick = (w: Partial<Record<RoomType, number>>): RoomType => {
    const ks = Object.keys(w) as RoomType[];
    let s = R.next() * ks.reduce((a, k) => a + w[k]!, 0);
    for (const k of ks) if ((s -= w[k]!) < 0) return k;
    return ks[0];
  };
  const W: Partial<Record<RoomType, number>>[] = [
    { fight: 1 },
    // past the first floor the ore cave comes early, so ore for the first blacksmith's isn't down to luck
    { fight: 3, event: 2, treasure: f > 0 ? 3 : 1.5 },
    { fight: 3, elite: 2, event: 1, forge: 1.5 },
    { fight: 2, elite: 1.5, camp: 1.5, event: 1, treasure: 1, forge: 1 },
    { fight: 3, elite: 2, event: 1, forge: 1 },
    { fight: 3, elite: 2, event: 1, camp: 1 },
  ];
  let layers: MapNode[][] = [];
  for (let tries = 0; tries < 500; tries++) {
    const sizes = [...Array.from({ length: REST_ROW }, () => R.int(2, 3)), 2, 1];
    layers = sizes.map((n, l) => Array.from({ length: n }, (_, i): MapNode => ({ id: `${f}-${l}-${i}`, l, i, type: 'fight', next: [] })));
    link(layers, R);
    // the rooms on the left come to the left rest room, those on the right to the right one, the middle one of three to either
    const mid = R.int(0, 1), last = layers[REST_ROW - 1].length - 1;
    layers[REST_ROW - 1].forEach((n, i) => (n.next = [layers[REST_ROW][2 * i < last ? 0 : 2 * i > last ? 1 : mid].id]));
    const by = new Map(layers.flat().map(n => [n.id, n]));
    const parents = (n: MapNode) => layers[n.l - 1]?.filter(p => p.next.includes(n.id)) ?? [];
    // fights so far on the routes into each room: fewest and most
    const span = new Map<string, [number, number]>();
    let stuck = false;
    rows: for (let l = 0; l < REST_ROW; l++) for (const n of layers[l]) {
      const ps = parents(n);
      const inLo = ps.length ? Math.min(...ps.map(p => span.get(p.id)![0])) : 0, inHi = ps.length ? Math.max(...ps.map(p => span.get(p.id)![1])) : 0;
      // fight rows still to come after this one
      const left = REST_ROW - 1 - l;
      let w = { ...W[l] };
      if (l > 0) {
        const mustFight = inLo + left < FIGHTS[0], noFight = inHi + 1 > FIGHTS[1];
        if (mustFight && noFight) { stuck = true; break rows; }
        const keep = (ok: (t: RoomType) => boolean) => (w = Object.fromEntries(Object.entries(w).filter(([k]) => ok(k as RoomType))));
        if (mustFight) keep(isFight);
        if (noFight) keep(t => !isFight(t));
        // not the special room a parent is, not the room a sibling already is
        const sib = ps.flatMap(p => p.next.map(id => by.get(id)!)).filter(o => o.i < n.i).map(o => o.type);
        const ban = new Set<RoomType>([...ps.map(p => p.type).filter(t => SPECIAL.includes(t)), ...sib]);
        const w2 = Object.fromEntries(Object.entries(w).filter(([k]) => !ban.has(k as RoomType)));
        if (Object.keys(w2).length) w = w2;
        if (!Object.keys(w).length) { stuck = true; break rows; }
      }
      n.type = wpick(w);
      const add = isFight(n.type) ? 1 : 0;
      span.set(n.id, [inLo + add, inHi + add]);
    }
    if (stuck) continue;
    const camp = R.next() < 0.5 ? 0 : 1;
    layers[REST_ROW].forEach(n => (n.type = n.i === camp ? 'camp' : 'forge'));
    layers[LAYERS - 1][0].type = 'boss';
    if (floorOk(layers)) return layers;
  }
  return layers;
}

/**
 * Links between rows: each room to the one straight ahead and often a neighbour, every room reached from somewhere, and
 * no two links crossing. Rooms stand in a row by their index, so links i→j and p→q cross when i, p and j, q go opposite ways.
 */
function link(layers: MapNode[][], R: ReturnType<typeof makeRng>) {
  for (let l = 0; l < layers.length - 1; l++) {
    const A = layers[l], B = layers[l + 1], es: [number, number][] = [];
    const add = (i: number, j: number) => { es.push([i, j]); A[i].next.push(B[j].id); };
    const crosses = (i: number, j: number) => es.some(([p, q]) => (p - i) * (q - j) < 0);
    const ahead = (i: number) => A.length === 1 ? Math.floor((B.length - 1) / 2) : Math.round((i * (B.length - 1)) / (A.length - 1));
    A.forEach((_, i) => add(i, ahead(i)));
    // the neighbours in a random order, so when two of them would cross neither side of the row always keeps its fork
    const order = A.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = R.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    for (const i of order) {
      const k = ahead(i) + (R.next() < 0.5 ? -1 : 1);
      if (B[k] && R.next() < 0.55 && !crosses(i, k)) add(i, k);
    }
    B.forEach((_, j) => {
      if (es.some(([, q]) => q === j)) return;
      // the room level with it, kept between the rooms that link to its neighbours so the new link crosses none
      const lo = Math.max(0, ...es.filter(([, q]) => q < j).map(([p]) => p)), hi = Math.min(A.length - 1, ...es.filter(([, q]) => q > j).map(([p]) => p));
      add(Math.min(hi, Math.max(lo, Math.round((j * (A.length - 1)) / Math.max(1, B.length - 1)))), j);
    });
  }
}

export function newRun(seed = Math.floor(Math.random() * 90000) + 10000): Run {
  return { seed, floor: 0, path: [[], [], []], floors: [0, 1, 2].map(f => genFloor(seed, f)), seen: [] };
}

export const nodeById = (run: Run, f: number, id: string) => run.floors[f].flat().find(n => n.id === id)!;
export const depthOf = (f: number, n: MapNode) => f * LAYERS + n.l + 1;
/** The seed a fight room on the map is built from: the run's, its depth and its place in the row. */
export const roomSeed = (run: Run, f: number, n: MapNode) => run.seed + depthOf(f, n) * 97 + n.i;

export function reachable(run: Run, f: number): string[] {
  if (f !== run.floor) return [];
  const p = run.path[f];
  if (!p.length) return run.floors[f][0].map(n => n.id);
  return nodeById(run, f, p[p.length - 1]).next;
}

/** The whole run is beaten: the last floor's boss is behind (a floor's own rows count, so a save from a shorter map still ends). */
export const runDone = (run: Run) => run.path[FLOORS - 1].length === run.floors[FLOORS - 1].length;

/** Online, the room each player points at on the map, by their hero. */
export type Votes = Record<number, string>;

/** The room (or an event's choice) every voter points at, or null while someone hasn't chosen yet or they disagree. */
export function agreed<T extends string | number>(votes: Record<number, T>, voters: number[]): T | null {
  const ids = voters.map(h => votes[h]);
  return ids.length && ids.every(id => id !== undefined && id === ids[0]) ? ids[0] : null;
}

/** Minutes played so far and the forecast for the whole run. */
export function minutes(run: Run) {
  let done = 0, est = 0;
  for (let f = 0; f < FLOORS; f++) {
    const p = run.path[f].map(id => nodeById(run, f, id)), rows = run.floors[f].length;
    for (const n of p) done += ROOM_TYPES[n.type].min;
    for (let l = p.length; l < rows; l++) est += l === rows - 1 ? ROOM_TYPES.boss.min : l === rows - 2 ? 0.75 : l < 3 ? 1.5 : 2.5;
  }
  return { done, total: done + est };
}
