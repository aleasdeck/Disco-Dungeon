// Run structure: 3 floors, each a layered branching map of rooms; a path takes 7 rooms ending at the boss.

import { AB_COST, FORGE_ORE, ROOM_TYPES, type RoomType } from './data';
import type { Bank, HeroState } from './game';
import { makeRng } from './rng';

export interface MapNode { id: string; l: number; i: number; type: RoomType; next: string[] }

export interface Run {
  seed: number;
  floor: number;
  path: string[][];
  floors: MapNode[][][];
}

export const FLOORS = 3;
export const LAYERS = 7;
/** Rows where a floor lets the party catch its breath: camp, forge or event. */
export const REST_ROWS = [3, 5];
/**
 * Rows where every floor has a blacksmith's at least once. Disc upgrades are sold only there, so the first chance
 * comes by the middle of a floor: with blacksmiths only in the rest rows the bot reached floor 2 in 24% of runs, not 43%.
 */
export const FORGE_ROWS = [2, 3];

export function genFloor(seed: number, f: number): MapNode[][] {
  const R = makeRng(seed + f * 1013);
  const sizes = [R.int(2, 3), R.int(2, 3), R.int(2, 3), 2, R.int(2, 3), 2, 1];
  const wpick = (w: Partial<Record<RoomType, number>>): RoomType => {
    const ks = Object.keys(w) as RoomType[];
    let s = R.next() * ks.reduce((a, k) => a + w[k]!, 0);
    for (const k of ks) if ((s -= w[k]!) < 0) return k;
    return ks[0];
  };
  const W: Partial<Record<RoomType, number>>[] = [
    { fight: 1 },
    { fight: 3, treasure: 2, event: 1 },
    { fight: 3, elite: 2, event: 1, forge: 1 },
    { camp: 2, forge: 2, event: 1 },
    { fight: 2, elite: 2, treasure: 1 },
    { camp: 2, forge: 2, fight: 1, elite: 1 },
    { boss: 1 },
  ];
  const layers = sizes.map((n, l) => Array.from({ length: n }, (_, i): MapNode => ({ id: `${f}-${l}-${i}`, l, i, type: wpick(W[l]), next: [] })));
  for (const r of REST_ROWS) if (!layers[r].some(n => n.type === 'camp' || n.type === 'forge')) layers[r][0].type = 'camp';
  // never in place of a rest row's only camp
  if (!FORGE_ROWS.some(r => layers[r].some(n => n.type === 'forge'))) {
    const row = layers[R.pick(FORGE_ROWS)], open = row.filter(n => n.type !== 'camp');
    (open.length ? R.pick(open) : row[row.length - 1]).type = 'forge';
  }
  if (f > 0 && !layers[1].some(n => n.type === 'treasure')) layers[1][layers[1].length - 1].type = 'treasure';
  for (let l = 0; l < layers.length - 1; l++) {
    const A = layers[l], B = layers[l + 1];
    A.forEach((a, i) => {
      const j = A.length === 1 ? Math.floor((B.length - 1) / 2) : Math.round((i * (B.length - 1)) / (A.length - 1));
      a.next.push(B[j].id);
      const k = j + (R.next() < 0.5 ? -1 : 1);
      if (B[k] && R.next() < 0.55 && !a.next.includes(B[k].id)) a.next.push(B[k].id);
    });
    B.forEach((b, j) => {
      if (!A.some(a => a.next.includes(b.id))) {
        const i = Math.round((j * (A.length - 1)) / Math.max(1, B.length - 1));
        A[Math.min(i, A.length - 1)].next.push(b.id);
      }
    });
  }
  return layers;
}

export function newRun(seed = Math.floor(Math.random() * 90000) + 10000): Run {
  return { seed, floor: 0, path: [[], [], []], floors: [0, 1, 2].map(f => genFloor(seed, f)) };
}

export const nodeById = (run: Run, f: number, id: string) => run.floors[f].flat().find(n => n.id === id)!;
export const depthOf = (f: number, n: MapNode) => f * LAYERS + n.l + 1;

export function reachable(run: Run, f: number): string[] {
  if (f !== run.floor) return [];
  const p = run.path[f];
  if (!p.length) return run.floors[f][0].map(n => n.id);
  return nodeById(run, f, p[p.length - 1]).next;
}

export const runDone = (run: Run) => run.path[FLOORS - 1].length === LAYERS;

/** Online, the room each player points at on the map, by their hero. */
export type Votes = Record<number, string>;

/** The room every voter points at, or null while someone hasn't chosen yet or they disagree. */
export function agreed(votes: Votes, voters: number[]): string | null {
  const ids = voters.map(h => votes[h]);
  return ids.length && ids.every(id => id && id === ids[0]) ? ids[0] : null;
}

/** Minutes played so far and the forecast for the whole run. */
export function minutes(run: Run) {
  let done = 0, est = 0;
  for (let f = 0; f < FLOORS; f++) {
    const p = run.path[f].map(id => nodeById(run, f, id));
    for (const n of p) done += ROOM_TYPES[n.type].min;
    for (let l = p.length; l < LAYERS; l++) est += l === LAYERS - 1 ? ROOM_TYPES.boss.min : REST_ROWS.includes(l) ? 0.75 : l < 3 ? 1.5 : 2.5;
  }
  return { done, total: done + est };
}

/** Rooms without a fight resolve at once; returns what happened, worded for a lone hero or a party. */
export function restRoom(type: RoomType, party: HeroState[], bank: Bank, seed: number): string {
  const solo = party.length === 1;
  if (type === 'camp') {
    for (const h of party) h.hp = h.hp <= 0 ? Math.ceil(h.max / 2) : Math.min(h.max, h.hp + 8);
    return solo ? 'Костёр: герой подлечился на 8 HP.' : 'Костёр: отряд подлечился на 8 HP, павшие встали с половиной здоровья.';
  }
  if (type === 'forge') {
    bank.ore += FORGE_ORE;
    return solo ? `Кузнец дал ${FORGE_ORE} руды. Прокачать диски можно только у него.` : `Кузнец дал отряду ${FORGE_ORE} руды. Прокачать диски можно только у него, руда общая на всех.`;
  }
  const R = makeRng(seed);
  const roll = R.int(0, 2);
  if (roll === 0) {
    // sparks burn out between fights, so the altar's gift waits for the next one: every hero starts it full
    bank.boon = AB_COST;
    return `Алтарь искр: следующий бой ${solo ? 'герой' : 'каждый герой'} начнёт с полным запасом искр (${AB_COST}).`;
  }
  if (roll === 1) {
    for (const h of party) if (h.hp > 0) h.hp = Math.max(1, h.hp - 3);
    bank.ore += 4;
    return `Ловушка в сундуке: −3 HP${solo ? '' : ' каждому'}, зато внутри 4 руды.`;
  }
  for (const h of party) { h.max += 2; if (h.hp > 0) h.hp += 2; }
  return `Бродячий лекарь: +2 к максимуму здоровья ${solo ? 'герою' : 'всему отряду'}.`;
}
