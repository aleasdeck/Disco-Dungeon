// «Обвал», the ore cave (thread «Своя руда в коопе и рудные пещеры»). The cave is rich but comes down around the party:
// every turn more of its ceiling is marked with dust a turn ahead and falls once the heroes have hopped to their discs. A
// stone where a hero stands hurts it, one on a vein chips an ore off it, anywhere else it lies as a block for the rest of
// the cave, and the cracks creep on from the fresh rubble. A vein under the dust has cracked open and pays twice until the
// stones come. Every hero may walk out with its ore at the start of a turn; whoever is still inside as the last turn
// begins is caught under the whole ceiling, and a hero buried in the cave spills half the ore it dug there.

import { makeRng } from './rng';

export const FALL = {
  /** Pieces of the ceiling marked on each turn, 2 × 2 cells; from turn `slabFrom` on every other one is a 3 × 3 slab. */
  pieces: [2, 3, 4, 5, 6],
  slabFrom: 3,
  /** The blow of a stone on a hero under it, of a slab's. */
  stone: 5,
  slab: 8,
  /** Share of the pieces that come down over a vein still standing (the rest anywhere); chance a free cell next to last turn's rubble cracks too. */
  toVein: 0.35,
  creep: 0.2,
  /** The whole ceiling comes down as this turn would begin, a blow of `endDmg` on every hero still inside. */
  end: 6,
  endDmg: 10,
  /** The first turn the heroes may walk out at. */
  leaveFrom: 2,
  /** Ore a vein under the dust pays per charge: it has cracked open. */
  crack: 2,
};

/** The cells (hazKey) coming down after this turn, the ones of them under a slab, and the rubble that fell last turn. */
export interface Fall { marks: string[]; slab: string[]; fresh: string[] }

/** What the ceiling falls on: which cells may take rubble, where the veins and the heroes in the cave stand. */
export interface FallRoom {
  gw: number;
  gh: number;
  /** Floor a stone may lie on: no rock, hole, block, hazard or resource. */
  open: (i: number, j: number) => boolean;
  veins: [number, number][];
  heroes: [number, number][];
}

const key = (i: number, j: number) => i + ',' + j;

/**
 * The ceiling that comes down after turn `turn` (from 1): the cell of every hero inside, the pieces, more of them every
 * turn and most of them anywhere, some over a vein, and a free cell now and then next to the rubble that fell last turn.
 * A piece only marks the cells of it a stone may lie on or that hold a vein; its own stream of the room's seed.
 */
export function planFall(room: FallRoom, seed: number, turn: number, fresh: string[] = []): Omit<Fall, 'fresh'> {
  const R = makeRng(seed * 131 + turn * 7919 + 17), set = new Set(room.heroes.map(([i, j]) => key(i, j))), slab = new Set<string>();
  const vein = new Set(room.veins.map(([i, j]) => key(i, j)));
  const hit = (i: number, j: number) => i >= 0 && j >= 0 && i < room.gw && j < room.gh && (room.open(i, j) || vein.has(key(i, j)));
  const n = FALL.pieces[Math.min(turn, FALL.pieces.length) - 1];
  for (let k = 0; k < n; k++) {
    const s = turn >= FALL.slabFrom && k % 2 === 0 ? 3 : 2;
    let ai: number, aj: number;
    if (room.veins.length && R.next() < FALL.toVein) {
      const [vi, vj] = R.pick(room.veins);
      ai = vi - R.int(0, s - 1);
      aj = vj - R.int(0, s - 1);
    } else {
      ai = R.int(0, room.gw - s);
      aj = R.int(0, room.gh - s);
    }
    for (let di = 0; di < s; di++) for (let dj = 0; dj < s; dj++) {
      if (!hit(ai + di, aj + dj)) continue;
      set.add(key(ai + di, aj + dj));
      if (s === 3) slab.add(key(ai + di, aj + dj));
    }
  }
  for (const c of fresh) {
    const [i, j] = c.split(',').map(Number);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (room.open(i + di, j + dj) && R.next() < FALL.creep) set.add(key(i + di, j + dj));
  }
  return { marks: [...set], slab: [...slab].filter(c => set.has(c)) };
}

/** Ore a hero spills when buried in the cave or caught under the whole ceiling: half of what it dug there, rounded up. */
export const spill = (dug: number) => Math.ceil(Math.max(0, dug) / 2);
