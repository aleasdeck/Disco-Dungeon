// Online play: the host's game state as plain data, and applying it on a client.
// Rooms are rebuilt from their spec (generation is seeded), so only what changes travels.

import { AB_COST, HEROES } from './data';
import type { Bank, Bomb, Cue, Disc, Float, Food, Game, Gas, HeroState, Phase, Spark, State } from './game';
import type { Mob, RoomSpec } from './room';
import type { CampState } from './camp';
import type { LootState } from './artifacts';
import type { EventState } from './events';
import type { Run, Votes } from './run';

type HeroSnap = Omit<HeroState, 'def'>;

export interface Snapshot {
  spec: RoomSpec;
  /** The host's physics step this state is from: a client plays it on from there to where the host is by the time it arrives. */
  tick?: number;
  turn: number;
  phase: Phase;
  timer: number;
  /** Which enemy is making its move and how far into it: every screen shows the same one going. */
  actor?: number;
  clock?: number;
  attacked: boolean;
  ready: number[];
  /** Saves from before ending the turn by hand have none, nor the enemy-turn journal. */
  done?: number[];
  /** Heroes whose players dropped out; older saves have none. */
  away?: number[];
  log?: State['log'];
  shake: number;
  heroes: HeroSnap[];
  mobs: Mob[];
  nodes: [number, number][];
  /** Hit points left on each icicle, in block order. */
  ice?: number[];
  discs: (Omit<Disc, 'hero'> & { hero: number })[];
  /** The cook's dishes on the floor; older saves have none. */
  food?: Food[];
  /** The kid's firecrackers and the bum's clouds of gas; older saves have none. */
  bombs?: Bomb[];
  gas?: Gas[];
  floats: Float[];
  /** Only the sparks every screen can't make itself: the ones the discs' hits throw, each screen throws on its own. */
  sparks: Spark[];
  /** Saves from before sparks were each hero's own hold the party's pool here, and their heroes have none. */
  bank: Bank & { sparks?: number };
  /** Hazard tiles change mid-fight: lava from slimes and the forge boss. */
  haz: string[];
  /** Depth of the blacksmith's the party is at, 0 elsewhere: everyone upgrades their own hero's discs there. */
  forge?: number;
  /** Ore the blacksmith handed the party there, for his window's scene. */
  gift?: number;
  /** The sounds the host made outside the physics lately (the enemies' blows, the turns starting): sent along, never saved. */
  cues?: Cue[];
}

export function snapshot(g: Game): Snapshot {
  const S = g.S;
  return {
    spec: S.spec, tick: g.tick, turn: S.turn, phase: S.phase, timer: S.timer, actor: S.actor, clock: S.clock, attacked: S.attacked,
    ready: S.ready, done: S.done, away: S.away, log: S.log, shake: S.shake,
    heroes: g.party.map(({ def: _def, ...h }) => h),
    mobs: S.mobs,
    nodes: S.nodes.map(n => [n.left, n.hit]),
    ice: S.blocks.filter(b => b.ice).map(b => b.hp!),
    discs: S.discs.filter(d => !d.gone).map(d => ({ ...d, hero: d.hero.i })),
    food: S.food,
    bombs: S.bombs,
    gas: S.gas,
    floats: S.floats,
    sparks: S.sparks.filter(p => p.b === undefined),
    bank: g.bank,
    haz: [...S.haz],
    forge: g.forge,
    gift: g.gift,
  };
}

/** The run map as the host has it between rooms; online the party moves on once every player points at the same room. */
export interface MapState {
  run: Run;
  choosing: boolean;
  votes: Votes;
  /** Heroes whose players are here to vote; the host plays the others, and they have no say. */
  voters: number[];
  /** The event the party stands in: its choices, the vote on them, and once taken what came of it. */
  ev?: EventState | null;
  /** The camp the party sits at: what each hero has done by the fire. */
  camp?: CampState | null;
  /** The floor boss's trophies the party shares out, and once shared who got what. */
  loot?: LootState | null;
}

const sameSpec = (a: RoomSpec, b: RoomSpec) => a.seed === b.seed && a.depth === b.depth && a.floor === b.floor && a.type === b.type && (a.heroes ?? 3) === (b.heroes ?? 3);

/** Make the client's game match the host's. Returns true when the party or the room changed (the HUD and camera need a rebuild). */
export function applySnapshot(g: Game, s: Snapshot): { party: boolean; room: boolean } {
  let party = false, room = false;
  // a save from before sparks were each hero's own: the party's pool is shared out hero by hero, as much as each can hold
  const { sparks: old = 0, ...bank } = s.bank;
  let pool = old;
  const heroes = s.heroes.map(h => {
    if ((h as Partial<HeroSnap>).sparks !== undefined) return h;
    const n = Math.min(AB_COST, pool);
    pool -= n;
    return { ...h, sparks: n };
  });
  if (g.party.length !== heroes.length || g.party.some((h, k) => h.i !== heroes[k].i)) {
    g.party = heroes.map(h => ({ ...h, def: HEROES[h.i] }));
    party = true;
  } else {
    // keep the same objects so discs and the HUD can hold on to them
    g.party.forEach((h, k) => Object.assign(h, heroes[k]));
  }
  if (!g.S || !sameSpec(g.S.spec, s.spec)) { g.showRoom(s.spec); room = true; }
  const S = g.S;
  // the sparks of the hits this screen has played: they don't come with the snapshot
  const own = S.sparks.filter(p => p.b !== undefined);
  S.heroes = g.party;
  Object.assign(S, {
    turn: s.turn, phase: s.phase, timer: s.timer, actor: s.actor ?? -1, clock: s.clock ?? 0, attacked: s.attacked,
    ready: s.ready, done: s.done ?? [], away: s.away ?? [], log: s.log ?? [], shake: s.shake, mobs: s.mobs, floats: s.floats, sparks: s.sparks,
  });
  S.nodes.forEach((n, k) => { if (s.nodes[k]) [n.left, n.hit] = s.nodes[k]; });
  if (s.ice) S.blocks.filter(b => b.ice).forEach((b, k) => { if (s.ice![k] !== undefined) b.hp = s.ice![k]; });
  S.discs = s.discs.map(d => ({ ...d, hero: g.heroOf(d.hero) }));
  S.food = (s.food ?? []).map(f => ({ ...f }));
  S.bombs = (s.bombs ?? []).map(b => ({ ...b }));
  S.gas = (s.gas ?? []).map(o => ({ ...o }));
  Object.assign(g.bank, bank);
  if (s.haz) S.haz = new Set(s.haz);
  g.forge = s.forge ?? 0;
  g.gift = s.gift ?? 0;
  g.pickActive();
  // a client brings the host's state up to now; the host reopening its own saved game just carries on counting from it
  if (g.send) { g.synced(s.tick ?? g.tick, own); g.hearCues(s.cues ?? [], room); }
  else g.tick = s.tick ?? g.tick;
  return { party, room };
}
