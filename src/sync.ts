// Online play: the host's game state as plain data, and applying it on a client.
// Rooms are rebuilt from their spec (generation is seeded), so only what changes travels.

import { HEROES } from './data';
import type { Bank, Disc, Float, Game, HeroState, Phase, Spark } from './game';
import type { Mob, RoomSpec } from './room';

type HeroSnap = Omit<HeroState, 'def'>;

export interface Snapshot {
  spec: RoomSpec;
  turn: number;
  phase: Phase;
  timer: number;
  attacked: boolean;
  ready: number[];
  shake: number;
  heroes: HeroSnap[];
  mobs: Mob[];
  nodes: [number, number][];
  /** Hit points left on each icicle, in block order. */
  ice?: number[];
  /** Whether each wing door is open, in block order. */
  doors?: boolean[];
  discs: (Omit<Disc, 'hero'> & { hero: number })[];
  floats: Float[];
  sparks: Spark[];
  bank: Bank;
  /** Hazard tiles change mid-fight: lava from slimes and the forge boss. */
  haz: string[];
}

export function snapshot(g: Game): Snapshot {
  const S = g.S;
  return {
    spec: S.spec, turn: S.turn, phase: S.phase, timer: S.timer, attacked: S.attacked, ready: S.ready, shake: S.shake,
    heroes: g.party.map(({ def: _def, ...h }) => h),
    mobs: S.mobs,
    nodes: S.nodes.map(n => [n.left, n.hit]),
    ice: S.blocks.filter(b => b.ice).map(b => b.hp!),
    doors: S.blocks.filter(b => b.door).map(b => !!b.open),
    discs: S.discs.filter(d => !d.gone).map(d => ({ ...d, hero: d.hero.i })),
    floats: S.floats,
    sparks: S.sparks,
    bank: g.bank,
    haz: [...S.haz],
  };
}

const sameSpec = (a: RoomSpec, b: RoomSpec) => a.seed === b.seed && a.depth === b.depth && a.floor === b.floor && a.type === b.type;

/** Make the client's game match the host's. Returns true when the party or the room changed (the HUD and camera need a rebuild). */
export function applySnapshot(g: Game, s: Snapshot): { party: boolean; room: boolean } {
  let party = false, room = false;
  if (g.party.length !== s.heroes.length || g.party.some((h, k) => h.i !== s.heroes[k].i)) {
    g.party = s.heroes.map(h => ({ ...h, def: HEROES[h.i] }));
    party = true;
  } else {
    // keep the same objects so discs and the HUD can hold on to them
    g.party.forEach((h, k) => Object.assign(h, s.heroes[k]));
  }
  if (!g.S || !sameSpec(g.S.spec, s.spec)) { g.showRoom(s.spec); room = true; }
  const S = g.S;
  S.heroes = g.party;
  Object.assign(S, { turn: s.turn, phase: s.phase, timer: s.timer, attacked: s.attacked, ready: s.ready, shake: s.shake, mobs: s.mobs, floats: s.floats, sparks: s.sparks });
  S.nodes.forEach((n, k) => { if (s.nodes[k]) [n.left, n.hit] = s.nodes[k]; });
  if (s.ice) S.blocks.filter(b => b.ice).forEach((b, k) => { if (s.ice![k] !== undefined) b.hp = s.ice![k]; });
  if (s.doors) S.blocks.filter(b => b.door).forEach((b, k) => { b.open = !!s.doors![k]; });
  S.discs = s.discs.map(d => ({ ...d, hero: g.heroOf(d.hero) }));
  Object.assign(g.bank, s.bank);
  if (s.haz) S.haz = new Set(s.haz);
  g.pickActive();
  return { party, room };
}
