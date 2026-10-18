// Combat rules: turn flow, disc physics, damage, abilities.
// Rendering and input live elsewhere; this module only changes state.

import { AB_BOUNCES, AB_BURN, AB_COST, AB_SHIELD, AB_SPEED, CRIT, CRIT_COS, E_MAX, FAN_ANGLE, FAN_M, FAN_R, FOOD_HEAL, FOOD_MAX, FOOD_PER_DISC, HAND_COST, HAND_MAX, HAND_START, HEROES, MOBS, MOB_E, NODE_E, RAGE_FROM, RAGE_FROM_BOSS, TILE, UPS, UP_COST, ZAP, ZAP_REACH, isRanged, mobSize, type HeroDef, type MobAct, type StatKey } from './data';
import { KNOCK_T, type ChipKind, type Knock } from './fx';
import { mulberry32 } from './rng';
import type { Sfx } from './audio/sfx';
import { caveTurns, cellAt, cellCentre, generate, hazKey, isFloor, muAt, newMob, partyScale, pitAt, standing, type Intent, type Layout, type Mob, type RoomSpec } from './room';

export type Phase = 'place' | 'throw' | 'resolve' | 'enemy' | 'over';

export interface HeroState {
  i: number;
  def: HeroDef;
  hp: number;
  max: number;
  shield: number;
  up: Record<StatKey, number>;
  /** Discs per turn; starts at 1 and grows through upgrades. */
  discs: number;
  /** The rune the hero was put on before the fight: its starting cell. */
  pad: number | null;
  /** Where the hero stands once the throws have moved it off its rune: the cell where its last disc stopped. */
  at: Pt | null;
  /** The hero hops over to `at` after the throws: where from, and how far along it is, 0 to 1. */
  from: Pt | null;
  leap: number;
  hand: number;
  thrown: boolean;
  flash: number;
  /** Turns left with weaker throws, from a chilling hit. */
  chill: number;
  /** Burning: takes 2 damage at the start of the next enemy turn. */
  fire: number;
  /** The ability is on for the rest of this turn: the discs thrown now shield, set on fire or keep their speed. */
  boost: boolean;
  /** Sparks for the ability, 0 to AB_COST: a spark crystal fills every hero's at once, each spends its own, and they last one fight. */
  sparks: number;
  /** The last knock it took: the figure rocks on its stand for a moment. */
  knock?: Knock;
}

export interface Disc {
  /** Tells the discs of a turn apart: the turn and the throw's place in it (saves from before the new heroes have none). */
  id?: number;
  /** The throw it flew out with: the card sharp's fan shares one, and discs of one fan don't knock each other. */
  vol?: number;
  hero: HeroState;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  e: number;
  fr: number;
  fall: number;
  gone: boolean;
  charged: boolean;
  bounces: number;
  spin: number;
  /** Enemies and resources this disc has hit; a disc that hit nothing is a miss. */
  hits: number;
  /** Thrown with the hero's ability on. */
  ab: boolean;
  /** Ricochet's ability: bounces left that cost the disc no speed. */
  rico: number;
  /** The cook's ability: dishes this disc has dropped so far. */
  food?: number;
  /**
   * One of the two side discs of the card sharp's fan, a phantom: smaller and weaker, its miss goes unremarked, and a hole
   * or a hazard it ends up in doesn't hurt him.
   */
  fan?: boolean;
}

/**
 * A dish the cook's disc dropped: it flies from where the disc bounced (fx, fy) to (x, y) for FOOD_FLY seconds, then lies
 * there to be picked up. `k` picks the dish, `by` is the disc that dropped it (it can't pick it up itself), `t` its age.
 */
export interface Food { x: number; y: number; fx: number; fy: number; k: number; by?: number; t: number }
/** Seconds a dropped dish takes to land. */
export const FOOD_FLY = 0.35;
/** How close a disc's edge must pass a dish to pick it up. */
const FOOD_R = 3;

/**
 * A stroke of Electra's lightning from one enemy to the next, for the eye only: every screen strikes its own as the discs
 * hit, `b` is the physics step it struck on, `s` shapes the zigzag, `t` its age.
 */
/** A stroke of lightning from (x0, y0) at height h0 to (x1, y1) at height h1. */
export interface Zap { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; t: number; b: number; s: number }
/** Seconds a stroke of lightning stays on screen. */
export const ZAP_T = 0.55;

export interface Float { x: number; y: number; txt: string; col: string; t: number }
export interface Spark {
  x: number; y: number; h: number; vx: number; vy: number; vh: number; t: number; col: string; sz: number;
  /** A chip of something solid: what it looks like. It tumbles (angle a, turning at va), bounces and lies a moment. */
  k?: ChipKind; a?: number; va?: number;
  /** Seconds it lasts, half a second when not given. */
  life?: number;
  /**
   * The physics step a disc's hit threw it on. Every screen runs the discs and throws these itself, the same ones,
   * so they stay out of the host's snapshots.
   */
  b?: number;
}

export interface State extends Layout {
  spec: RoomSpec;
  turn: number;
  phase: Phase;
  timer: number;
  /** Enemy turn: the index in `mobs` of the enemy making its move now, -1 before the first one goes. */
  actor: number;
  /** Enemy turn: seconds since the current enemy began its move. */
  clock: number;
  /** Enemy turn: the current enemy has already struck (or cast, healed, summoned). */
  attacked: boolean;
  discs: Disc[];
  /** The cook's dishes on the floor; they last the fight. */
  food: Food[];
  zaps: Zap[];
  floats: Float[];
  sparks: Spark[];
  heroes: HeroState[];
  shake: number;
  /** Heroes (by `i`) whose players pressed "ready" during placement in an online game. */
  ready: number[];
  /** Online: heroes whose players dropped out. They hold nobody up; the host may still play them. */
  away: number[];
  /** Heroes (by `i`) whose players pressed «Конец хода» this turn: the enemies go once every living hero is here. */
  done: number[];
  /** The enemy-turn journal, oldest first: a line for each thing the enemies did, the room's last LOG_MAX of them. */
  log: { turn: number; txt: string }[];
}

/** What a player can do to the shared game; online clients send these to the host instead of applying them. */
export type Action =
  | { k: 'throw'; h: number; dx: number; dy: number }
  | { k: 'move'; h: number; pad: number }
  | { k: 'disc'; h: number }
  | { k: 'up'; h: number; stat: StatKey }
  | { k: 'ability'; h: number }
  | { k: 'ready'; h: number }
  | { k: 'end'; h: number; on: boolean };

const STEP = 1 / 120;

/**
 * Online client: a snapshot's delay is weighed against the least delayed one of this many milliseconds back; one late by
 * more than RESYNC_MS starts the count afresh (the host page was asleep or reloaded). REPLAY caps the physics steps run at once.
 */
const LAG_WINDOW = 3000, RESYNC_MS = 2500, REPLAY = 360;

/**
 * Enemy turn pacing, in seconds: a pause before the first enemy goes (the "Ход врагов" banner has the stage),
 * a cell of walking, the beat an enemy that stays put takes before it acts, and the pause after an enemy acts
 * before the next one starts.
 */
const LEAD = 1, CELL_T = 0.14, BEAT = 0.18, AFTER = 0.35;

/** Seconds a hero takes to hop over to where its last disc stopped. */
const HOP_T = 0.45;

/** Host: the sounds it sends along with its snapshots are the ones of this many milliseconds back. */
const CUE_MS = 2000;

/** A sound the host made outside the physics, for the clients: its number (they go up), which, how hard, and whose action it was. */
export type Cue = [n: number, ev: Sfx, p: number, h?: number];

/** Lines the enemy-turn journal keeps. */
const LOG_MAX = 40;

/** What the HUD calls a mob's special move. */
const SPECIAL = { summon: 'призыв', heal: 'лечение', heat: 'жар', charge: 'фитиль' };
const specialName = (k: keyof typeof SPECIAL | 'slam', chill?: boolean) => (k === 'slam' ? (chill ? 'метель' : 'удар по всем') : SPECIAL[k]);

/** A past-tense verb agreeing with whoever did it: «ударил», «ударила». */
const did = (o: { fem?: boolean }, he: string, she = he + 'а') => (o.fem ? she : he);

type Pt = { x: number; y: number };

/** Cells a walker covers each enemy turn: its speed in cells, at least one. */
export const stepsOf = (m: Mob) => Math.max(1, Math.round(m.speed / TILE));

export const wayLen = (w: Pt[]) => w.reduce((n, p, k) => (k ? n + Math.hypot(p.x - w[k - 1].x, p.y - w[k - 1].y) : 0), 0);

/** The point at distance d along a route. */
export function pointAt(w: Pt[], d: number): Pt {
  for (let k = 1; k < w.length; k++) {
    const a = w[k - 1], b = w[k], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= L) return L ? { x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L } : { ...b };
    d -= L;
  }
  return { ...w[w.length - 1] };
}

/**
 * Ore belongs to the whole party: any hero's hit fills the pool, any hero spends from it, and it lasts the whole run.
 * Sparks are each hero's own to spend (`HeroState.sparks`), though a crystal fills everyone's, and last one fight; every hero
 * starts the next one with `boon` of them (the altar's gift, usually none). An event may also leave the next fight a `shield`
 * for every hero, `rage`: that much harder blows from its enemies, or a curse that room's spec carries: `smoke` over the
 * floor, a `strobe` that hides the aiming line.
 */
export interface Bank { ore: number; boon?: number; shield?: number; rage?: number; smoke?: boolean; strobe?: boolean }

export function newBank(): Bank {
  return { ore: 0, boon: 0 };
}

/** A fresh party; `picks` lists which heroes (by index into HEROES) take part, the first three by default. */
export function newParty(picks: number[] = [0, 1, 2]): HeroState[] {
  return picks.map(i => ({ i, def: HEROES[i], ...heroStart(HEROES[i].hp) }));
}

function heroStart(hp: number) {
  return {
    hp, max: hp, shield: 0, up: { m: 0, pw: 0, e: 0 }, discs: HAND_START,
    pad: null as number | null, at: null as Pt | null, from: null as Pt | null, leap: 0, hand: HAND_START, thrown: false, flash: 0, chill: 0, fire: 0, boost: false, sparks: 0,
  };
}

export class Game {
  S!: State;
  act = 0;
  party: HeroState[] = newParty();
  bank: Bank = newBank();
  onChange: () => void = () => {};
  onRoomEnd: (win: boolean) => void = () => {};
  /** A sound to play now; p is how hard, 0 to 1. */
  onSound: (ev: Sfx, p: number) => void = () => {};
  /** Host: the sounds of the last CUE_MS made outside the physics; online clients play them from the snapshots. */
  cues: Cue[] = [];
  /** Online client: the last of the host's sounds played here. */
  heardCue = 0;
  /** The last physics step whose sounds were played: steps played again after a snapshot stay quiet. */
  private heard = 0;
  private inStep = false;
  /** The enemy making its move, the cells it has put down on so far, and the turn each hero last landed after its hop. */
  private walked = { key: '', n: 0 };
  private hopped = new Map<number, number>();
  /** Which heroes this screen may move, aim and select (online: only the player's own). */
  canControl: (h: HeroState) => boolean = () => true;
  /** Online: placement ends when every hero's player is ready, and heroes cannot swap runes. */
  online = false;
  /** Online client: actions go to the host through this instead of changing local state. */
  send: ((a: Action) => void) | null = null;
  /**
   * Depth of the blacksmith's room the party stands in between rooms, 0 anywhere else. Only there are extra discs and stat
   * levels for sale; the depth tells one visit from the next when two blacksmiths come in a row.
   */
  forge = 0;
  /** Ore the blacksmith handed the party at this visit, for the scene in his window. */
  gift = 0;
  /** Host: ore the party has mined in this room, for the room's result. */
  mined = 0;
  private acc = 0;
  /** Physics steps run so far on this page; online, every snapshot carries the host's count. */
  tick = 0;
  /** Online client: this page's clock in milliseconds (tests set their own). */
  clock: () => number = () => performance.now();
  /**
   * Online client: how far behind this page's clock the host's step count was in each recent snapshot, in steps, and when
   * the snapshot came. The smallest is the least delayed snapshot: it tells where the host is now.
   */
  private lags: { at: number; lag: number }[] = [];
  /**
   * Chips and sparks scatter by this, seeded afresh on every physics step, so a hit throws the same ones on every screen
   * and the host's snapshot doesn't swap them for others.
   */
  private fx = mulberry32(0);
  /** Host: the disc each hero is hopping over to; it picks the disc up once it lands. */
  private pickup = new Map<HeroState, Disc>();

  /** Start a fight in a new room; unless the spec says otherwise, the room is built for the party's size. */
  loadRoom(spec: RoomSpec) {
    spec = { ...spec, heroes: spec.heroes ?? this.party.length };
    // an event's curse on the fight goes with the room, so every screen and a reloaded game have it too
    if (this.bank.smoke) spec.smoke = true;
    if (this.bank.strobe) spec.strobe = true;
    const L = generate(spec);
    this.forge = 0;
    this.mined = 0;
    this.pickup.clear();
    this.walked = { key: '', n: 0 };
    this.hopped.clear();
    // sparks don't carry over: every fight starts without them, or full after the altar
    const boon = Math.min(AB_COST, this.bank.boon ?? 0), shield = this.bank.shield ?? 0;
    for (const h of this.party) Object.assign(h, { pad: null, at: null, from: null, leap: 0, hand: h.hp > 0 ? h.discs : 0, thrown: false, shield: h.hp > 0 ? shield : 0, flash: 0, chill: 0, fire: 0, boost: false, sparks: boon });
    // an event's curse: the room's enemies come in angrier
    if (this.bank.rage) for (const m of L.mobs) m.dmg += this.bank.rage;
    this.bank.boon = 0;
    delete this.bank.shield;
    delete this.bank.rage;
    delete this.bank.smoke;
    delete this.bank.strobe;
    this.S = { ...L, spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], food: [], zaps: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [], done: [], log: [], away: this.online ? this.S?.away ?? [] : [] };
    // every rune starts empty: the players put their heroes on them before the fight
    this.pickActive();
    this.pickIntents();
    this.acc = 0;
    this.onChange();
  }

  /** Online client: rebuild a room from its spec (rooms are generated from the seed), state comes from the host. */
  showRoom(spec: RoomSpec) {
    this.walked = { key: '', n: 0 };
    this.hopped.clear();
    this.S = { ...generate(spec), spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], food: [], zaps: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [], done: [], log: [], away: [] };
    this.pickActive();
  }

  /** After the party changes: select the first hero this screen controls. */
  pickActiveParty() {
    const h = this.party.find(o => this.canControl(o)) ?? this.party[0];
    if (h) this.act = h.i;
  }

  /** Keep the selected hero if it can still act, else switch to the first living hero this screen controls. */
  pickActive() {
    const cur = this.party.find(h => h.i === this.act);
    if (cur && cur.hp > 0 && this.canControl(cur)) return;
    const h = this.party.find(o => o.hp > 0 && this.canControl(o)) ?? this.party.find(o => this.canControl(o)) ?? this.party[0];
    if (h) this.act = h.i;
  }

  heroOf(i: number) {
    return this.S.heroes.find(h => h.i === i) ?? this.S.heroes[0];
  }

  /** Where a hero stands: on its rune for the first throws, then where its last disc stopped; null before it is placed. */
  spot(h: HeroState): Pt | null {
    return h.at ?? (h.pad !== null ? this.S.pads[h.pad] : null);
  }

  /** Where a hero's figure is seen, and how high it is lifted: it hops over to its new cell for a moment after the throws. */
  figureAt(h: HeroState): { x: number; y: number; lift: number } | null {
    const p = this.spot(h), f = h.from;
    if (!p) return null;
    if (!f || h.leap >= 1) return { x: p.x, y: p.y, lift: 0 };
    const u = Math.max(0, h.leap), e = u * u * (3 - 2 * u), L = Math.hypot(p.x - f.x, p.y - f.y);
    return { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e, lift: Math.sin(Math.PI * u) * Math.min(14, 4 + L / 6) };
  }

  alive = () => this.S.heroes.filter(h => h.hp > 0);
  liveMobs = () => this.S.mobs.filter(m => m.hp > 0);
  /** The ore cave: no enemies, only veins and mushrooms, and a few turns to mine or heal. */
  cave = () => this.S.spec.type === 'treasure';
  /** Turns the room gives the party, 0 for no limit: a fight lasts as long as its enemies stand. */
  turnsMax = () => (this.cave() ? caveTurns(this.S.spec) : 0);
  /** The room is done: every enemy is down, or in the ore cave nothing is left to hit, veins and mushrooms alike. */
  cleared = () => (this.cave() ? !this.S.nodes.some(n => n.left > 0) : !this.liveMobs().length);
  stat = (h: HeroState, k: StatKey) => {
    const step = UPS.find(u => u.k === k)!.step;
    return k === 'e' ? Math.min(E_MAX, h.def.e + h.up.e * step) : h.def[k] * (1 + h.up[k] * step);
  };
  get hero() { return this.heroOf(this.act); }

  select(i: number) {
    const h = this.party.find(o => o.i === i);
    if (!h || !this.canControl(h)) return;
    this.act = i;
    this.onChange();
  }


  padFree(pi: number) {
    return !this.S.heroes.some(h => h.pad === pi && h.hp > 0);
  }

  /** Heroes go on runes only while preparing; once the fight starts nobody moves. */
  canPlace(h: HeroState) {
    return h.hp > 0 && this.S.phase === 'place' && !this.S.ready.includes(h.i);
  }

  /** Every living hero (online: this hero) stands on a rune, so the fight can start. */
  placed(h?: HeroState) {
    return h ? h.pad !== null : this.alive().every(o => o.pad !== null);
  }

  /** Put a hero on rune pi; a placed hero standing there swaps places with it (online, someone else's rune stays theirs). */
  movePad(h: HeroState, pi: number) {
    const S = this.S;
    if (!this.canPlace(h) || !S.pads[pi] || h.pad === pi) return false;
    const other = S.heroes.find(o => o.pad === pi && o.hp > 0);
    if (other && (this.online || h.pad === null)) return false;
    this.sfx('step', 0.9, h.i);
    if (this.send) { this.send({ k: 'move', h: h.i, pad: pi }); return true; }
    const first = h.pad === null;
    if (other) other.pad = h.pad;
    h.pad = pi;
    this.burst(S.pads[pi].x, S.pads[pi].y, h.def.col, 10);
    // in the campaign, the next hero still waiting for a rune is picked up right away
    if (first && !this.online) {
      const next = this.alive().find(o => o.pad === null && this.canControl(o));
      if (next) this.act = next.i;
    }
    this.pickIntents();
    this.onChange();
    return true;
  }

  /** End the placement phase and start the first turn; online, only once every player is ready. */
  startFight(h = this.hero) {
    const S = this.S;
    if (S.phase !== 'place') return;
    if (this.online ? !this.placed(h) : !this.placed()) return;
    if (this.send) { this.send({ k: 'ready', h: h.i }); return; }
    if (this.online) {
      if (!S.ready.includes(h.i)) S.ready.push(h.i);
      if (!this.everyoneReady()) { this.onChange(); return; }
      this.seatAway();
    }
    S.phase = 'throw';
    this.sfx('yourTurn');
    this.pickIntents();
    this.onChange();
  }

  /** Online placement is over once every player at the table is ready; one who dropped out holds nobody up. */
  private everyoneReady() {
    const S = this.S;
    return this.alive().every(o => S.ready.includes(o.i) || S.away.includes(o.i));
  }

  /** The heroes of players who dropped out take a free rune if they have none yet, and count as ready. */
  private seatAway() {
    const S = this.S;
    for (const o of this.alive()) {
      if (S.ready.includes(o.i)) continue;
      if (o.pad === null) {
        const k = S.pads.findIndex((_, k) => !S.heroes.some(x => x.pad === k && x.hp > 0));
        if (k < 0) continue;
        o.pad = k;
      }
      S.ready.push(o.i);
    }
  }

  /**
   * Host: the heroes whose players dropped out. Nobody waits for them: placement ends and the enemies go once the
   * players still here are done, though the host may move and throw for them until then.
   */
  setAway(list: number[]) {
    const S = this.S;
    if (!S || S.away.join() === list.join()) return;
    S.away = list;
    if (S.phase === 'place' && this.online && S.ready.length && this.everyoneReady()) {
      this.seatAway();
      S.phase = 'throw';
      this.sfx('yourTurn');
      this.pickIntents();
    }
    this.onChange();
  }

  /** Online: this hero's player is at the table. */
  here(h: HeroState) {
    return !this.online || !this.S.away.includes(h.i);
  }

  /** This hero's player has pressed «Конец хода» this turn. */
  ended(h = this.hero) {
    return this.S.done.includes(h.i);
  }

  /** The player may say they are done with this turn: it is the heroes' turn, the hero stands, is theirs to move and isn't done yet. */
  canEndTurn(h = this.hero) {
    return this.mayEnd(h) && this.canControl(h);
  }

  private mayEnd(h: HeroState) {
    return this.S.phase === 'throw' && h.hp > 0 && !this.ended(h);
  }

  /**
   * The player is done with this turn: the hero throws no more, and discs left in hand are lost. The enemies go once
   * every living hero's player has pressed it and the discs have stopped; alone that is at once.
   */
  endTurn(h = this.hero) {
    if (!this.mayEnd(h)) return;
    if (this.send) { this.send({ k: 'end', h: h.i, on: true }); return; }
    this.S.done.push(h.i);
    this.onChange();
  }

  /** Take the press back while the heroes' turn lasts: the hero may throw again. */
  cancelEndTurn(h = this.hero) {
    const S = this.S;
    if (S.phase !== 'throw' || !this.ended(h)) return;
    if (this.send) { this.send({ k: 'end', h: h.i, on: false }); return; }
    S.done = S.done.filter(i => i !== h.i);
    this.onChange();
  }

  /** Throw the hero's next disc. (dx, dy) is the pull-back vector in world units, up to 60. */
  throwDisc(h: HeroState, dx: number, dy: number) {
    const S = this.S;
    const p = this.spot(h);
    if (S.phase !== 'throw' || h.hand <= 0 || !p || h.hp <= 0 || this.ended(h)) return;
    const L = Math.hypot(dx, dy);
    if (L < 4) return;
    this.sfx('launch', Math.min(1, L / 60), h.i);
    if (this.send) { this.send({ k: 'throw', h: h.i, dx, dy }); return; }
    // a reopened save holds only the discs still on the table, so the next number goes past the highest one
    const next = () => Math.max(S.turn * 64 - 1, ...S.discs.map(d => d.id ?? 0)) + 1, s = this.power(h), vol = next();
    const disc = (a: number, fan: boolean): Disc => {
      const c = Math.cos(a), sn = Math.sin(a), ux = (dx * c - dy * sn) / L, uy = (dx * sn + dy * c) / L;
      return {
        id: next(), vol, hero: h, x: p.x + ux * 6, y: p.y + uy * 6, vx: ux * L * s, vy: uy * L * s,
        r: h.def.r * (fan ? FAN_R : 1), m: this.stat(h, 'm') * (fan ? FAN_M : 1), e: this.stat(h, 'e'), fr: h.def.fr,
        fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0,
        ab: h.boost, rico: h.boost && h.def.key === 'ricochet' ? AB_BOUNCES : 0, ...(fan ? { fan } : {}),
      };
    };
    // the card sharp's fan: a disc out of each sleeve first, the one he aimed last, so he goes after that one
    if (h.boost && h.def.key === 'sharp') for (const a of [-FAN_ANGLE, FAN_ANGLE]) S.discs.push(disc(a, true));
    S.discs.push(disc(0, false));
    h.hand--;
    h.thrown = true;
    this.onChange();
  }

  /** Launch speed per unit of pull-back; a chilled hero throws softer. */
  power(h: HeroState) {
    return ((270 * this.stat(h, 'pw')) / 60) * (h.chill > 0 ? 0.7 : 1);
  }

  /** A ghost is bodiless on even turns: discs pass through it. */
  solid(m: Mob) {
    return m.hp > 0 && !(MOBS[m.k].ghost && this.S.turn % 2 === 0);
  }

  /**
   * Where a throw with pull-back (dx, dy) would roll, ignoring other discs: path points, the bounce points along it,
   * and the mob it would hit first. Stops after `maxBounces` bounces (the aim line uses 0: it ends at the first obstacle).
   */
  predict(h: HeroState, dx: number, dy: number, maxBounces = 2) {
    const S = this.S, L = Math.hypot(dx, dy), path: [number, number][] = [], bounces: [number, number][] = [], p = this.spot(h);
    if (!p || L < 4) return { path, bounces, hit: null as Mob | null };
    const s = this.power(h), dt = 1 / 60;
    const d = { x: p.x + (dx / L) * 6, y: p.y + (dy / L) * 6, vx: dx * s, vy: dy * s, r: h.def.r, e: this.stat(h, 'e') } as Disc;
    const boxes = standing(S.blocks).concat(S.rock);
    path.push([d.x, d.y]);
    for (let k = 0; k < 600; k++) {
      const v = Math.hypot(d.vx, d.vy);
      if (v < 8) break;
      const nv = Math.max(0, v - muAt(S, d.x, d.y) * h.def.fr * dt);
      d.vx *= nv / v; d.vy *= nv / v;
      // sub-steps keep fast discs from tunnelling through a one-tile block
      for (let sub = 0; sub < 4; sub++) {
        d.x += (d.vx * dt) / 4; d.y += (d.vy * dt) / 4;
        let hitWall = false;
        if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * d.e; hitWall = true; }
        if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * d.e; hitWall = true; }
        if (d.x > S.Wx - d.r) { d.x = S.Wx - d.r; d.vx = -d.vx * d.e; hitWall = true; }
        if (d.y > S.Wy - d.r) { d.y = S.Wy - d.r; d.vy = -d.vy * d.e; hitWall = true; }
        for (const b of boxes) if (this.bounceBox(d, b) > 0) hitWall = true;
        for (const n of S.nodes) if (n.left > 0 && this.bounceStatic(d, n) > 0) hitWall = true;
        const m = S.mobs.find(o => this.solid(o) && Math.hypot(d.x - o.x, d.y - o.y) < d.r + o.r);
        if (m) { path.push([d.x, d.y]); return { path, bounces, hit: m }; }
        if (pitAt(S.pits, d.x, d.y)) { path.push([d.x, d.y]); return { path, bounces, hit: null }; }
        if (hitWall) {
          bounces.push([d.x, d.y]);
          path.push([d.x, d.y]);
          if (bounces.length > maxBounces) return { path, bounces, hit: null };
        }
      }
      if (k % 3 === 0) path.push([d.x, d.y]);
    }
    path.push([d.x, d.y]);
    return { path, bounces, hit: null as Mob | null };
  }

  /** Cost of the next extra disc, or 0 when the hero already has the most. */
  discCost(h: HeroState) {
    return h.discs < HAND_MAX ? HAND_COST[h.discs - HAND_START] : 0;
  }

  buyDisc(h = this.hero) {
    const c = this.discCost(h);
    if (!this.forge || !c || this.bank.ore < c) return;
    if (this.send) { this.send({ k: 'disc', h: h.i }); return; }
    this.bank.ore -= c;
    h.discs++;
    this.onChange();
  }

  /** Cost of the next level of a disc stat, or 0 when there is nothing more to gain (a bounce already at the limit). */
  upCost(h: HeroState, k: StatKey) {
    if (k === 'e' && this.stat(h, 'e') >= E_MAX) return 0;
    return UP_COST[h.up[k]] ?? 0;
  }

  upgrade(k: StatKey, h = this.hero) {
    const c = this.upCost(h, k);
    if (!this.forge || !c || this.bank.ore < c) return;
    if (this.send) { this.send({ k: 'up', h: h.i, stat: k }); return; }
    this.bank.ore -= c;
    h.up[k]++;
    this.onChange();
  }

  /**
   * An ability works through the discs thrown after it, so it needs a disc still in hand and a hero still throwing,
   * and it goes on once a turn on the hero's own sparks.
   */
  canUseAbility(h = this.hero) {
    return this.S.phase === 'throw' && h.hp > 0 && h.hand > 0 && !h.boost && !this.ended(h) && h.sparks >= AB_COST && this.liveMobs().length > 0;
  }

  useAbility(h = this.hero) {
    if (!this.canUseAbility(h)) return;
    this.sfx('ability', 0.7, h.i);
    if (this.send) { this.send({ k: 'ability', h: h.i }); return; }
    h.sparks -= AB_COST;
    h.boost = true;
    const p = this.spot(h);
    if (p) {
      this.float(p.x, p.y - 8, h.def.ab + '!', h.def.abCol);
      this.burst(p.x, p.y, h.def.abCol, 16);
    }
    this.onChange();
  }

  /**
   * A disc thrown with the ability on hits an enemy: Bastion's shields the whole party, Ash's stokes the enemy's fire,
   * Electra's strikes lightning, the cook's drops a dish. This goes before the hit's damage; Electra's lightning comes after it.
   */
  private abilityHit(d: Disc, m: Mob) {
    const k = d.hero.def.key;
    if (k === 'cook') this.dropFood(d, d.x - m.x, d.y - m.y);
    else if (k === 'bastion') {
      for (const o of this.alive()) {
        o.shield += AB_SHIELD;
        const p = this.spot(o);
        if (p) this.float(p.x, p.y + 6, `+${AB_SHIELD} щит`, '#3fc4b6');
      }
      this.burst(d.x, d.y, '#3fc4b6', 10);
    } else if (k === 'ash') {
      m.burn += AB_BURN;
      this.float(m.x, m.y - 14, `огонь ${m.burn}`, '#ff7a3d');
      this.burst(m.x, m.y, '#ff7a3d', 14);
    }
  }

  /**
   * Electra's lightning off a hit on m: it strikes m (unless the disc has just felled it), then leaps to the nearest enemy
   * not struck yet within ZAP_REACH of the last one, as many times as ZAP has strokes, each weaker, through armour.
   */
  private zap(m: Mob) {
    const hit = new Set<Mob>([m]);
    let at: Pt = m, k = 0;
    // the first stroke falls on the struck enemy from above, the rest leap from one to the next at chest height
    if (m.hp > 0) { this.hurtMob(m, ZAP[k++], '#7fe3ff', true, 0.5); this.bolt(m.x, m.y, 60, m.x, m.y, 14, 0.6); }
    while (k < ZAP.length) {
      let to: Mob | null = null, best = ZAP_REACH;
      for (const o of this.S.mobs) {
        const far = Math.hypot(o.x - at.x, o.y - at.y);
        if (!hit.has(o) && this.solid(o) && far <= best) { best = far; to = o; }
      }
      if (!to) break;
      hit.add(to);
      this.bolt(at.x, at.y, 16, to.x, to.y, 16, 1);
      this.hurtMob(to, ZAP[k++], '#7fe3ff', true, 0.5);
      at = to;
    }
    this.sfx('zap', 0.8);
  }

  /** A stroke of lightning between two points, `p` how bright. */
  private bolt(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, p: number) {
    this.S.zaps.push({ x0, y0, h0, x1, y1, h1, t: 0, b: this.tick, s: Math.floor(this.fx() * 1e9) });
    this.burst(x1, y1, '#7fe3ff', Math.round(6 * p));
  }

  /**
   * The cook's disc bounced off something; (nx, ny) points from it toward the disc. While the disc has dishes left it drops
   * one, which flies back out into the room a cell or so and lands on open floor, clear of everything standing there.
   */
  private dropFood(d: Disc, nx: number, ny: number) {
    const S = this.S, L = Math.hypot(nx, ny);
    if ((d.food ?? 0) >= FOOD_PER_DISC || S.food.length >= FOOD_MAX || !L) return;
    nx /= L; ny /= L;
    const side = (this.fx() - 0.5) * 12;
    for (const out of [16, 11, 22]) {
      const x = d.x + nx * out - ny * side, y = d.y + ny * out + nx * side;
      if (!isFloor(S, Math.floor(x / TILE), Math.floor(y / TILE)) || pitAt(S.pits, x, y) || this.inBlock(x, y, 4)) continue;
      if (S.mobs.some(m => m.hp > 0 && Math.hypot(m.x - x, m.y - y) < m.r + 3) || S.nodes.some(n => n.left > 0 && Math.hypot(n.x - x, n.y - y) < n.r + 3)) continue;
      if (S.food.some(f => Math.hypot(f.x - x, f.y - y) < 7)) continue;
      S.food.push({ x, y, fx: d.x, fy: d.y, k: Math.floor(this.fx() * 4), by: d.id, t: 0 });
      d.food = (d.food ?? 0) + 1;
      return;
    }
  }

  /** Dishes on the floor this disc rolls over: the hero who threw it eats, if hurt, any but the dishes this disc dropped. */
  private eat(d: Disc) {
    const S = this.S, h = d.hero;
    if (h.hp <= 0 || h.hp >= h.max || !S.food.length) return false;
    let ate = false;
    S.food = S.food.filter(f => {
      if (f.t < FOOD_FLY || f.by === d.id || h.hp >= h.max || Math.hypot(f.x - d.x, f.y - d.y) > d.r + FOOD_R) return true;
      const hl = Math.min(FOOD_HEAL, h.max - h.hp);
      h.hp += hl;
      this.float(f.x, f.y, `+${hl} HP`, '#7be39a');
      this.burst(f.x, f.y, '#7be39a', 8);
      this.sfx('eat');
      ate = true;
      return false;
    });
    return ate;
  }

  /** Host: apply an action a player sent, as long as it names a hero in the party. */
  perform(a: Action) {
    const h = this.S.heroes.find(o => o.i === a.h);
    if (!h) return;
    if (a.k === 'throw') this.throwDisc(h, a.dx, a.dy);
    else if (a.k === 'move') this.movePad(h, a.pad);
    else if (a.k === 'disc') this.buyDisc(h);
    else if (a.k === 'up') this.upgrade(a.stat, h);
    else if (a.k === 'ability') this.useAbility(h);
    else if (a.k === 'ready') this.startFight(h);
    else if (a.k === 'end') { if (a.on) this.endTurn(h); else this.cancelEndTurn(h); }
  }

  // ------------------------------------------------------------ intents

  /** Turn from which the enemies grow angrier every turn. */
  rageFrom() {
    return this.S.spec.type === 'boss' ? RAGE_FROM_BOSS : RAGE_FROM;
  }

  /** Extra damage every enemy deals this turn: one more for each turn the fight has dragged past rageFrom. */
  rage() {
    return Math.max(0, this.S.turn - this.rageFrom() + 1);
  }

  /**
   * Damage coming at a hero in this enemy turn if nobody is stopped: strikes aimed at it, blows on the whole party, burning.
   * While the enemies take their moves, only the ones still to go count: the rest has already landed.
   */
  incoming(h: HeroState) {
    const S = this.S;
    if (h.hp <= 0 || S.phase === 'place' || S.phase === 'over') return 0;
    let n = h.fire > 0 && S.phase !== 'enemy' ? 2 : 0;
    for (const m of this.liveMobs()) {
      const it = m.intent;
      if (it && !this.acted(m) && ((it.t === 'hit' && it.hero === h.i) || it.t === 'slam')) n += it.dmg;
    }
    return Math.max(0, n - h.shield);
  }

  /** In the enemy turn: this enemy has already made its move. */
  acted(m: Mob) {
    const S = this.S, k = S.mobs.indexOf(m);
    return S.phase === 'enemy' && (k < S.actor || (k === S.actor && S.attacked));
  }

  /**
   * The special move a mob makes next and in how many enemy turns, 0 for the coming one (or the one under way, until the
   * mob has moved), by the rules that pick its intents: summons, heals, slams and heat on their turns, a bomber's fuse on
   * odd ones. Null for a mob without one. A turn to come counts if the move can happen as things stand: a summoner with
   * its risen at their limit has no summon coming until one falls, a healer left alone has nobody to mend.
   */
  specialIn(m: Mob): { name: string; turns: number } | null {
    const S = this.S, d = MOBS[m.k], it = m.intent;
    if (m.hp <= 0 || S.phase === 'over' || (!d.acts && !d.charge)) return null;
    // the move picked for this turn, unless it is made already or has come to nothing (the one to heal has fallen)
    if (it && it.t !== 'hit' && it.t !== 'move' && !this.acted(m) && !this.idle(m)) return { name: specialName(it.t, it.chill), turns: 0 };
    for (let k = 1; k <= 6; k++) {
      const t = S.turn + k, a = d.acts?.find(o => t % o.every === o.at && this.able(m, o));
      if (a) return { name: specialName(a.k, a.chill), turns: k };
      if (d.charge && t % 2 === 1) return { name: SPECIAL.charge, turns: k };
    }
    return null;
  }

  /** Whether a mob could make its special act now: room and a limit left to summon, someone else standing to heal. */
  private able(m: Mob, a: MobAct) {
    if (a.k === 'summon') return this.risen(m, a) > 0;
    if (a.k === 'heal') return this.liveMobs().some(o => o !== m);
    return true;
  }

  /** How many mobs a summon raises now: fewer for a smaller party, never past the summoner's limit or a crowded room. */
  private risen(m: Mob, a: MobAct) {
    const S = this.S, mi = S.mobs.indexOf(m), k = partyScale(S.spec).mobs;
    const mine = S.mobs.filter(o => o.hp > 0 && o.owner === mi).length;
    return Math.min(Math.max(1, Math.round((a.n ?? 1) * k)), Math.max(1, Math.round((a.cap ?? 3) * k)) - mine, 9 - this.liveMobs().length);
  }

  pickIntents() {
    const S = this.S, hs = this.alive().filter(h => this.spot(h)), rage = this.rage();
    if (!hs.length) return;
    const taken: { x: number; y: number }[] = [];
    this.liveMobs().forEach((m, i) => {
      const d = MOBS[m.k];
      for (const a of d.acts ?? []) {
        if (S.turn % a.every !== a.at) continue;
        const it = this.special(m, a, hs, taken);
        if (it) { if (it.t === 'slam') it.dmg += rage; m.intent = it; return; }
      }
      if (isRanged(m.k)) { m.intent = this.shoot(m, hs, S.turn + i); return; }
      let best = hs[0], way: Pt[] | null = null, bd = Infinity;
      for (const h of hs) {
        const w = this.route(m, this.spot(h)!);
        if (w && w.length < bd) { bd = w.length; best = h; way = w; }
      }
      m.intent = this.chase(m, best, way);
    });
  }

  /** What a walker or a shooter deals this turn: a bomber after lighting its fuse twice as much, plus the rage of a long fight. */
  private blow(m: Mob) {
    return (MOBS[m.k].charge ? m.dmg * 2 : m.dmg) + this.rage();
  }

  /**
   * A walker going after hero h along `way`: it strikes this turn if its steps take it there, else it closes in.
   * A shooter's way ends where it sees the hero, and it fires on arriving there.
   */
  private chase(m: Mob, h: HeroState, way: Pt[] | null): Intent {
    // walled off from the hero: it stays put
    if (!way) return { t: 'move', hero: h.i, dmg: 0 };
    const p = this.spot(h)!, n = way.length - 1, go = wayLen(way.slice(0, this.stopAt(m, way) + 1)), eta = Math.max(1, Math.ceil(n / stepsOf(m)));
    if (!isRanged(m.k)) way.push({ x: p.x, y: p.y });
    return n <= stepsOf(m) ? { t: 'hit', hero: h.i, dmg: this.blow(m), way, go, eta: 1 } : { t: 'move', hero: h.i, dmg: 0, way, go, eta };
  }

  /**
   * What a shooter does about the heroes `hs`: it fires at one it sees, taking them in turn by `k`; seeing none, it walks
   * to the nearest spot it sees one from and fires on arriving, if its steps take it there this turn. A bomber lighting
   * its fuse walks the same way, so it has the hero in sight when the bomb is ready.
   */
  private shoot(m: Mob, hs: HeroState[], k: number): Intent {
    const seen = hs.filter(h => this.sees(m, h));
    let it: Intent;
    if (seen.length) it = { t: 'hit', hero: seen[k % seen.length].i, dmg: this.blow(m) };
    else {
      let best = hs[k % hs.length], way: Pt[] | null = null;
      for (const h of hs) {
        const w = this.route(m, this.spot(h)!, true, true);
        if (w && (!way || w.length < way.length)) { best = h; way = w; }
      }
      it = this.chase(m, best, way);
    }
    return MOBS[m.k].charge && this.S.turn % 2 === 1 ? { ...it, t: 'charge', dmg: 0 } : it;
  }

  /**
   * The heroes have moved to their discs: every walker still goes after the hero it was after, now to where that hero stands,
   * so its route, its reach and the blows the heroes expect are right for the enemy turn. A shooter keeps its target too:
   * a hero who has stepped out of its sight makes it walk to where it sees that hero again.
   */
  private rechase() {
    for (const m of this.liveMobs()) {
      const it = m.intent;
      if (!it || (it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge')) continue;
      const h = this.heroOf(it.hero), p = this.spot(h);
      if (h.hp <= 0 || !p) continue;
      if (isRanged(m.k)) m.intent = this.shoot(m, it.t === 'charge' ? this.alive().filter(o => this.spot(o)) : [h], 0);
      else if (it.t !== 'charge') m.intent = this.chase(m, h, this.route(m, p));
    }
  }

  /**
   * Whether a shot from a to b flies clear: no wall, block or icicle still standing and no resource left in between.
   * Holes in the floor, the heroes and the other enemies don't stand in the way; a line that only grazes an edge
   * or a corner of a block goes past it.
   */
  clearShot(a: Pt, b: Pt) {
    const S = this.S, dx = b.x - a.x, dy = b.y - a.y, E = 0.01;
    for (const o of S.rock.concat(standing(S.blocks))) {
      let t0 = 0, t1 = 1;
      for (const [p, d, lo, hi] of [[a.x, dx, o.x0 + E, o.x1 - E], [a.y, dy, o.y0 + E, o.y1 - E]]) {
        if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) t1 = -1; continue; }
        const u = (lo - p) / d, v = (hi - p) / d;
        t0 = Math.max(t0, Math.min(u, v));
        t1 = Math.min(t1, Math.max(u, v));
      }
      if (t1 > t0) return false;
    }
    const L2 = dx * dx + dy * dy;
    for (const n of S.nodes) {
      if (n.left <= 0) continue;
      const t = L2 ? Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / L2)) : 0;
      if (Math.hypot(a.x + dx * t - n.x, a.y + dy * t - n.y) < n.r) return false;
    }
    return true;
  }

  /** Whether a mob standing at `from` (where it stands now, by default) sees hero h: a shooter fires only then. */
  sees(m: Mob, h: HeroState, from: Pt = m) {
    const p = this.spot(h);
    return h.hp > 0 && !!p && this.clearShot(from, p);
  }

  /** The intent for a mob's special act this turn, or null when it can't do it (nobody to heal, no room to summon). */
  private special(m: Mob, a: MobAct, hs: HeroState[], taken: { x: number; y: number }[]): Intent | null {
    const S = this.S;
    if (a.k === 'slam') return { t: 'slam', hero: -1, dmg: Math.ceil(m.dmg * (a.chill ? 0.5 : 0.6)), chill: a.chill };
    if (a.k === 'heal') {
      const hurt = this.liveMobs().filter(o => o !== m && o.hp < o.max).sort((p, q) => p.hp / p.max - q.hp / q.max)[0];
      // enemies of a smaller party have less HP, so they mend for less too
      return hurt ? { t: 'heal', hero: -1, dmg: Math.max(1, Math.round((a.amt ?? 6) * partyScale(S.spec).hp)), mob: S.mobs.indexOf(hurt) } : null;
    }
    if (a.k === 'summon') {
      // a smaller party faces fewer risen mobs, like it faces fewer enemies from the start
      const n = this.risen(m, a);
      if (n <= 0) return null;
      const spots: { x: number; y: number }[] = [];
      // circles on the cells right around the summoner, the side facing the runes first, so the risen mob plainly comes from it
      const sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), cells: Pt[] = [];
      for (let ring = 1; ring <= 2; ring++) {
        for (let j = j0 - ring; j < j0 + sz + ring; j++) for (let i = i0 - ring; i < i0 + sz + ring; i++) {
          if (i >= i0 - ring + 1 && i < i0 + sz + ring - 1 && j >= j0 - ring + 1 && j < j0 + sz + ring - 1) continue;
          cells.push(cellCentre(i, j));
        }
      }
      const toRunes = (p: Pt) => -(p.x - m.x) * (S.Wx - m.x) - (p.y - m.y) * (S.Wy - m.y) + Math.hypot(p.x - m.x, p.y - m.y) * 1e4;
      cells.sort((p, q) => toRunes(p) - toRunes(q));
      for (const c of cells) {
        if (spots.length >= n) break;
        if (this.spotFree(c.x, c.y, taken)) { spots.push(c); taken.push(c); }
      }
      return spots.length ? { t: 'summon', hero: -1, dmg: 0, spots } : null;
    }
    // heat: tiles a little in front of each hero turn to lava
    const spots: { x: number; y: number }[] = [], stands = this.stands();
    for (const h of hs) {
      const p = this.spot(h)!, dx = S.Wx / 2 - p.x, dy = S.Wy / 2 - p.y, L = Math.hypot(dx, dy) || 1;
      let got = 0;
      for (let k = 0; k < 10 && got < (a.n ?? 2); k++) {
        const dist = 26 + (k >> 1) * 8, side = k % 2 ? 1 : -1;
        const x = p.x + (dx / L) * dist - (dy / L) * side * 9 * (got ? 1 : 0.4), y = p.y + (dy / L) * dist + (dx / L) * side * 9 * (got ? 1 : 0.4);
        const i = Math.floor(x / TILE), j = Math.floor(y / TILE), cx = i * TILE + 8, cy = j * TILE + 8;
        if (!isFloor(S, i, j) || S.haz.has(hazKey(i, j)) || pitAt(S.pits, cx, cy) || spots.some(o => o.x === cx && o.y === cy)) continue;
        if (stands.some(q => Math.hypot(q.x - cx, q.y - cy) < 20) || standing(S.blocks).some(b => cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1)) continue;
        spots.push({ x: cx, y: cy });
        got++;
      }
    }
    return spots.length ? { t: 'heat', hero: -1, dmg: 0, spots } : null;
  }

  /** Room for a summoned mob on the cell at (x, y): open floor no one stands on, off the runes and the circles already marked. */
  private spotFree(x: number, y: number, taken: { x: number; y: number }[]) {
    const [i, j] = cellAt(x, y);
    return this.cellFree(i, j, this.occupied(null, true)) && !this.standCells().has(hazKey(i, j)) && !taken.some(p => p.x === x && p.y === y);
  }

  // ------------------------------------------------------------ damage & fx

  float(x: number, y: number, txt: string, col: string) {
    this.S.floats.push({ x, y, txt, col, t: 0 });
  }

  burst(x: number, y: number, col: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = this.fx() * Math.PI * 2, s = 20 + this.fx() * 60;
      this.S.sparks.push({ x, y, h: 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: 30 + this.fx() * 40, t: 0, col, sz: 1 + this.fx() * 1.5 });
    }
  }

  /**
   * Knock a figure standing at (x, y) away from (fromX, fromY), with strength p (0 to 1), after `delay` seconds;
   * when the two points coincide, some way at random. A figure still swinging from a harder knock keeps that one.
   */
  knock(o: { knock?: Knock }, x: number, y: number, fromX: number, fromY: number, p: number, delay = 0) {
    let dx = x - fromX, dy = y - fromY, L = Math.hypot(dx, dy);
    if (L < 1e-6) { const a = this.fx() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); L = 1; }
    const k = o.knock;
    if (k && k.t < KNOCK_T / 2 && k.p * (1 - Math.max(0, k.t) / KNOCK_T) > p) return;
    o.knock = { t: -delay, x: dx / L, y: dy / L, p: Math.min(1, p) };
  }

  /** A hard blow shakes the table: the figures around give a little jolt, the nearest first. */
  private tremor(x: number, y: number, p: number, skip: object) {
    const jolt = (o: { knock?: Knock }, ox: number, oy: number) => {
      const L = Math.hypot(ox - x, oy - y), q = p * (1 - L / 150);
      if (o !== skip && q > 0.04) this.knock(o, ox, oy, x, y, q * 0.4, L / 400);
    };
    for (const m of this.liveMobs()) jolt(m, m.x, m.y);
    for (const h of this.alive()) { const s = this.spot(h); if (s) jolt(h, s.x, s.y); }
  }

  /** A disc knocks chips off a resource or an icicle: they spray back toward the disc, bounce on the floor and fade. */
  private chips(k: 'ore' | 'spk' | 'herb' | 'ice', x: number, y: number, r: number, d: Disc, q: number, big = false) {
    const S = this.S, L = Math.hypot(d.x - x, d.y - y) || 1, nx = (d.x - x) / L, ny = (d.y - y) / L;
    // from the side the disc struck, a little above the floor
    const ox = x + nx * r * 0.6, oy = y + ny * r * 0.6;
    const add = (kind: ChipKind, sz: number, spread: number, sp: number, life: number) => {
      const a = Math.atan2(ny, nx) + (this.fx() - 0.5) * spread, s = sp * (0.6 + this.fx() * 0.6);
      S.sparks.push({
        x: ox, y: oy, h: 5 + this.fx() * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: 110 * (0.7 + this.fx() * 0.5),
        t: 0, col: '', sz, k: kind, a: this.fx() * 6.3, va: (this.fx() - 0.5) * 24, life,
      });
    };
    if (k === 'ice') {
      for (let i = 0; i < (big ? 12 : 5); i++) add('ice', 1.4 + this.fx() * 1.6, Math.PI * 1.6, big ? 70 : 50, 0.9 + this.fx() * 0.3);
      return;
    }
    // stone with gold in it, crystal splinters, bits of cap and stem
    const kinds: ChipKind[] = k === 'ore' ? ['ore', 'ore', 'gold'] : k === 'spk' ? ['spk'] : ['cap', 'cap', 'stem'];
    for (let i = 0, n = 5 + 3 * q; i < n; i++) add(kinds[Math.floor(this.fx() * kinds.length)], 1.1 + this.fx() * 1.2, Math.PI * 1.3, 65, 0.9 + this.fx() * 0.4);
  }

  /**
   * Play a sound. Every screen runs the physics itself, so the physics' sounds play on each (once: a step played again
   * after a snapshot stays quiet); everything else only the host runs, and it sends those sounds along with its snapshots.
   * `h` is the hero whose player's action it was: that player heard it already.
   */
  private sfx(ev: Sfx, p = 0.7, h?: number) {
    if (this.inStep) { if (this.tick > this.heard) this.onSound(ev, p); return; }
    this.onSound(ev, p);
    if (this.send) return;
    this.cues = this.recentCues();
    const n = Math.max(Date.now(), (this.cues[this.cues.length - 1]?.[0] ?? 0) + 1);
    this.cues.push(h === undefined ? [n, ev, p] : [n, ev, p, h]);
  }

  /** Host: the sounds to send along with a snapshot. */
  recentCues() {
    const now = Date.now();
    return this.cues.filter(c => c[0] > now - CUE_MS);
  }

  /** Online client: play the host's sounds a snapshot brings that haven't been played here; `quiet` only counts them. */
  hearCues(cues: Cue[], quiet: boolean) {
    for (const [n, ev, p, h] of cues) {
      if (n <= this.heardCue) continue;
      // a new room's first snapshot only says where the count is
      if (!quiet && (h == null || !this.canControl(this.heroOf(h)))) this.onSound(ev, p);
      this.heardCue = n;
    }
  }

  hurtMob(m: Mob, n: number, col = '#fff', pierce = false, p = 0.6) {
    if (m.hp <= 0) return;
    if (m.armor && !pierce && n < m.armor) { this.float(m.x, m.y, 'броня', '#c7cbe0'); this.sfx('armor'); return; }
    m.hp -= n;
    m.flash = 0.15;
    this.float(m.x, m.y, '-' + n, col);
    const d = MOBS[m.k];
    if (d.rage && !m.rage && m.hp > 0 && m.hp <= m.max / 2) {
      const up = Math.max(1, Math.round(3 * this.S.dmgMul));
      m.rage = true; m.dmg += up; this.float(m.x, m.y - 12, `ЯРОСТЬ +${up}`, '#ff7a3d'); this.burst(m.x, m.y, '#ff7a3d', 18);
    }
    this.sfx(m.hp <= 0 ? 'kill' : 'hit', p);
    if (m.hp <= 0) {
      m.dead = 0.001; this.burst(m.x, m.y, '#ffd34d', 22); this.float(m.x, m.y - 6, 'повержен', '#ffd34d');
      if (m.burn > 0) this.spreadFire(m);
      if (d.lava) {
        const S = this.S, i = Math.floor(m.x / TILE), j = Math.floor(m.y / TILE);
        if (isFloor(S, i, j) && this.stands().every(p => Math.hypot(p.x - (i * TILE + 8), p.y - (j * TILE + 8)) > 20)) { S.haz.add(hazKey(i, j)); this.float(m.x, m.y + 4, 'лава!', '#ff7a3d'); }
      }
    }
  }

  /** A burning enemy falls: what is left of its fire leaps onto the nearest enemy still standing. */
  private spreadFire(m: Mob) {
    const to = this.liveMobs().sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    if (to) {
      to.burn += m.burn;
      this.float(to.x, to.y - 14, `огонь ${to.burn}`, '#ff7a3d');
      this.burst(to.x, to.y, '#ff7a3d', 12);
    }
    m.burn = 0;
  }

  /** A line in the enemy-turn journal. */
  private note(txt: string) {
    const L = this.S.log;
    L.push({ turn: this.S.turn, txt });
    if (L.length > LOG_MAX) L.splice(0, L.length - LOG_MAX);
  }

  /** Journal a blow on a hero: the line, what the shield took of it, and the hero falling to it. */
  private noteBlow(txt: string, h: HeroState, blk: number) {
    this.note(blk ? `${txt}, щит принял ${blk}` : txt);
    this.noteFall(h);
  }

  private noteFall(h: HeroState) {
    if (h.hp <= 0) this.note(`${h.def.name} ${did(h.def, 'пал')}`);
  }

  /** Damage a hero; `from` is where the blow came from, so the figure rocks away from it. Returns what the shield took. */
  hurtHero(h: HeroState, n: number, why = '', from?: Pt) {
    const S = this.S;
    if (h.hp <= 0) return 0;
    const p = this.spot(h) ?? { x: S.Wx - 20, y: S.Wy - 20 };
    const blk = Math.min(h.shield, n);
    h.shield -= blk;
    const dmg = n - blk;
    h.hp -= dmg;
    h.flash = 0.2;
    // a blow knocks the figure away from the enemy; spikes, lava and fire just make it jump
    const kp = (0.35 + Math.min(n, 10) / 14) * (dmg ? 1 : 0.6);
    if (from) this.knock(h, p.x, p.y, from.x, from.y, kp, 0.06);
    else if (dmg) this.knock(h, p.x, p.y, p.x, p.y, kp * 0.7);
    this.float(p.x, p.y, dmg ? `-${dmg}${why ? ' ' + why : ''}` : 'блок', dmg ? '#ff4d6a' : '#3fc4b6');
    this.sfx(dmg ? 'hurt' : 'armor');
    if (dmg) { this.burst(p.x, p.y, '#ff4d6a', 10); S.shake = 0.2; }
    if (h.hp <= 0) { this.float(p.x, p.y - 6, 'пал', '#ff4d6a'); h.hand = 0; }
    return blk;
  }

  // ------------------------------------------------------------ physics

  private bodies() { return this.S.discs.filter(d => !d.gone && !d.fall); }

  private bounceStatic(d: Disc, o: { x: number; y: number; r: number }, e = d.e) {
    const dx = d.x - o.x, dy = d.y - o.y, L = Math.hypot(dx, dy), mn = d.r + o.r;
    if (L >= mn || L === 0) return 0;
    const nx = dx / L, ny = dy / L;
    d.x = o.x + nx * mn;
    d.y = o.y + ny * mn;
    const vn = d.vx * nx + d.vy * ny;
    if (vn >= 0) return 0;
    d.vx -= (1 + e) * vn * nx;
    d.vy -= (1 + e) * vn * ny;
    return -vn;
  }

  private bounceBox(d: Disc, b: { x0: number; y0: number; x1: number; y1: number }, e = d.e) {
    const cx = Math.max(b.x0, Math.min(d.x, b.x1)), cy = Math.max(b.y0, Math.min(d.y, b.y1));
    const dx = d.x - cx, dy = d.y - cy, L = Math.hypot(dx, dy);
    if (L >= d.r) return 0;
    let nx: number, ny: number, pen: number;
    if (L > 1e-6) { nx = dx / L; ny = dy / L; pen = d.r - L; }
    else {
      const l = d.x - b.x0, r = b.x1 - d.x, t = d.y - b.y0, bt = b.y1 - d.y, m = Math.min(l, r, t, bt);
      if (m === l) { nx = -1; ny = 0; pen = l + d.r; }
      else if (m === r) { nx = 1; ny = 0; pen = r + d.r; }
      else if (m === t) { nx = 0; ny = -1; pen = t + d.r; }
      else { nx = 0; ny = 1; pen = bt + d.r; }
    }
    d.x += nx * pen;
    d.y += ny * pen;
    const vn = d.vx * nx + d.vy * ny;
    if (vn >= 0) return 0;
    d.vx -= (1 + e) * vn * nx;
    d.vy -= (1 + e) * vn * ny;
    return -vn;
  }

  /** Share of its speed a disc keeps off a wall or a block: all of it while a Ricochet disc has sure bounces left. */
  private keep(d: Disc) {
    return d.rico > 0 ? 1 : d.e;
  }

  /**
   * A bounce off a wall or a block at speed v: it clacks, louder the harder. (nx, ny) points from the wall into the room:
   * the cook's disc drops a dish that way.
   */
  private bounced(d: Disc, v: number, nx: number, ny: number) {
    d.bounces++;
    if (d.rico > 0) d.rico--;
    if (v > 15) this.sfx('wall', Math.min(1, v / 300));
    if (d.ab && d.hero.def.key === 'cook') this.dropFood(d, nx, ny);
  }

  /** Which way from a block a disc that has just bounced off it lies: from the block's nearest point to the disc's centre. */
  private boxNormal(d: Disc, b: { x0: number; y0: number; x1: number; y1: number }): [number, number] {
    return [d.x - Math.max(b.x0, Math.min(d.x, b.x1)), d.y - Math.max(b.y0, Math.min(d.y, b.y1))];
  }

  inBlock(x: number, y: number, r: number) {
    const boxes = standing(this.S.blocks).concat(this.S.rock);
    return boxes.some(b => Math.hypot(x - Math.max(b.x0, Math.min(x, b.x1)), y - Math.max(b.y0, Math.min(y, b.y1))) < r);
  }

  step(dt: number) {
    const S = this.S;
    let changed = false;
    this.tick++;
    this.inStep = true;
    this.fx = mulberry32(Math.imul(this.tick, 0x9e3779b1));
    const born = S.sparks.length;
    for (const d of this.bodies()) {
      const v = Math.hypot(d.vx, d.vy);
      // a disc with sure bounces left rolls on without slowing, and even a soft throw goes at a good clip
      if (d.rico > 0 && v > 0) { const nv = Math.max(v, AB_SPEED); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
      else if (v > 0) { const nv = Math.max(0, v - muAt(S, d.x, d.y) * d.fr * dt); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const v0 = Math.hypot(d.vx, d.vy);
      if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * this.keep(d); this.bounced(d, v0, 1, 0); }
      if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * this.keep(d); this.bounced(d, v0, 0, 1); }
      if (d.x > S.Wx - d.r) { d.x = S.Wx - d.r; d.vx = -d.vx * this.keep(d); this.bounced(d, v0, -1, 0); }
      if (d.y > S.Wy - d.r) { d.y = S.Wy - d.r; d.vy = -d.vy * this.keep(d); this.bounced(d, v0, 0, -1); }
      if (pitAt(S.pits, d.x, d.y)) {
        d.fall = 0.001; d.vx = d.vy = 0;
        this.sfx('pit');
        // a phantom just melts away down there
        if (!d.fan) { this.float(d.x, d.y, 'провал', '#c7cbe0'); this.hurtHero(d.hero, 2); }
        changed = true;
        continue;
      }
      for (const b of S.blocks) {
        if (b.ice && b.hp! <= 0) continue;
        const vn = this.bounceBox(d, b, this.keep(d));
        if (vn <= 0) continue;
        this.bounced(d, vn, ...this.boxNormal(d, b));
        if (!b.ice || vn <= 30) continue;
        // icicles chip like mobs take damage, and shatter at zero
        const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
        b.hp = Math.max(0, b.hp! - Math.ceil((d.m * vn) / 120));
        if (b.hp > 0) { this.chips('ice', x, y, 8, d, 1); this.sfx('ice'); }
        else { this.float(x, y, 'дзынь!', '#bfe9ff'); this.chips('ice', x, y, 0, d, 1, true); this.S.shake = Math.max(this.S.shake, 0.12); this.sfx('shatter'); }
        changed = true;
      }
      for (const b of S.rock) { const vn = this.bounceBox(d, b, this.keep(d)); if (vn > 0) this.bounced(d, vn, ...this.boxNormal(d, b)); }
      if (this.eat(d)) changed = true;
      for (const n of S.nodes) {
        if (n.left <= 0) continue;
        // a resource soaks up most of the disc's run: collecting costs the throw
        const vn = this.bounceStatic(d, n, NODE_E);
        if (vn <= 30) continue;
        d.hits++;
        // even Ricochet's ability doesn't carry a disc on through a resource
        d.rico = 0;
        const big = Math.ceil((d.m * vn) / 120) >= 4, h = d.hero, q = big ? 2 : 1;
        n.hit = 0.2;
        if (n.k !== 'spk') n.left--;
        if (n.k === 'ore') { this.bank.ore += q; this.mined += q; this.float(n.x, n.y, `+${q} руда`, '#ffb070'); }
        // sparks go to every hero still standing, whoever threw the disc, each up to what one ability costs; the crystal
        // loses only what was taken, so sparks nobody had room for stay in it for later
        if (n.k === 'spk') {
          const all = this.alive();
          let got = 0;
          for (const o of all) { const k = Math.min(q, n.left, AB_COST - o.sparks); o.sparks += k; got = Math.max(got, k); }
          n.left -= got;
          this.float(n.x, n.y, got ? `+${got} искр${got > 1 ? 'ы' : 'а'}${all.length > 1 ? ' всем' : ''}` : 'искры полны', '#c9a8ff');
        }
        if (n.k === 'herb') { const hl = Math.min(h.max - h.hp, 1 + 2 * q); h.hp += hl; this.float(n.x, n.y, hl ? `+${hl} HP` : 'HP полное', '#7be39a'); }
        this.chips(n.k, n.x, n.y, n.r, d, q);
        this.sfx(n.k === 'spk' ? 'sparks' : n.k);
        if (n.left <= 0) this.float(n.x, n.y - 6, 'истощено', '#c7cbe0');
        changed = true;
      }
      for (const m of S.mobs) {
        if (!this.solid(m)) continue;
        const v = Math.hypot(d.vx, d.vy), vn = this.bounceStatic(d, m, d.rico > 0 ? 1 : MOB_E);
        if (vn <= 5) continue;
        if (d.rico > 0) d.rico--;
        let dmg = Math.ceil((d.m * vn) / 120);
        // straight from the rune into the enemy, square on: a precise throw hits much harder
        const crit = d.bounces === 0 && d.hits === 0 && vn >= v * CRIT_COS;
        d.hits++;
        if (crit) dmg = Math.ceil(dmg * CRIT);
        if (d.hero.def.key === 'ricochet') dmg += Math.min(d.bounces, 4);
        if (d.charged) { dmg *= 2; d.charged = false; }
        if (crit && m.hp > 0) { this.float(m.x, m.y - 24, 'ТОЧНО!', '#ffe27a'); this.sfx('crit'); }
        // the ability goes first: fire on an enemy this very hit kills leaps on to the next one
        if (d.ab) this.abilityHit(d, m);
        this.hurtMob(m, dmg, '#fff', false, Math.min(1, vn / 250));
        if (d.ab && d.hero.def.key === 'electra') this.zap(m);
        this.burst(d.x, d.y, d.hero.def.col, 8);
        // the figure rocks away from the disc, a big one less; a sure hit or a kill shakes the table
        this.knock(m, m.x, m.y, d.x, d.y, Math.min(1, 0.3 + vn / 260) * Math.min(1, (7 / m.r) ** 0.6));
        if (crit || m.hp <= 0) this.tremor(m.x, m.y, crit ? 0.6 : 0.45, m);
        changed = true;
      }
    }
    const bs = this.bodies();
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.vol !== undefined && a.vol === b.vol) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), mn = a.r + b.r;
      if (L >= mn || L === 0) continue;
      const nx = dx / L, ny = dy / L, ov = mn - L, tm = a.m + b.m;
      a.x -= (nx * ov * b.m) / tm; a.y -= (ny * ov * b.m) / tm;
      b.x += (nx * ov * a.m) / tm; b.y += (ny * ov * a.m) / tm;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv >= 0) continue;
      const e = Math.min(a.e, b.e), j2 = (-(1 + e) * rv) / (1 / a.m + 1 / b.m);
      a.vx -= (j2 * nx) / a.m; a.vy -= (j2 * ny) / a.m;
      b.vx += (j2 * nx) / b.m; b.vy += (j2 * ny) / b.m;
      // "Звон": discs of two different heroes collide hard, both deal double on their next hit
      if (-rv > 40 && a.hero !== b.hero) {
        a.charged = b.charged = true;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.float(mx, my, 'ЗВОН ×2', '#b893ff');
        this.burst(mx, my, '#b893ff', 10);
        this.sfx('clink', Math.min(1, -rv / 300));
      } else if (-rv > 15) this.sfx('wall', Math.min(1, -rv / 400));
    }
    for (const f of S.food) if (f.t < FOOD_FLY) f.t = Math.min(FOOD_FLY, f.t + dt);
    for (let k = born; k < S.sparks.length; k++) S.sparks[k].b = this.tick;
    this.inStep = false;
    this.heard = Math.max(this.heard, this.tick);
    if (changed) this.onChange();
  }

  moving() {
    return this.bodies().some(d => Math.hypot(d.vx, d.vy) > 2) || this.S.discs.some(d => d.fall && !d.gone);
  }

  /** Every living hero has thrown all its discs; the turn still waits for the players to end it. */
  allThrown() { return this.alive().every(h => h.hand === 0); }

  /** Every living hero's player has pressed «Конец хода»; the fallen and the players who dropped out never hold the turn up. */
  allDone() { return this.alive().every(h => this.ended(h) || !this.here(h)); }

  // ------------------------------------------------------------ turn flow

  private resolve() {
    const S = this.S;
    // discs still in hand are lost: the hand fills again next turn
    for (const h of S.heroes) h.hand = 0;
    for (const d of S.discs) {
      d.vx = d.vy = 0;
      if (d.gone || d.fall || d.hero.hp <= 0) continue;
      if (d.fan) continue;
      if (!d.hits) this.float(d.x, d.y, 'мимо', '#c7cbe0');
      if (S.haz.has(hazKey(Math.floor(d.x / 16), Math.floor(d.y / 16)))) {
        this.float(d.x, d.y, S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
        this.hurtHero(d.hero, S.biome.hazDmg);
      }
    }
    this.regroup();
    this.rechase();
  }

  /**
   * After the throws every living hero goes over to where its last disc stopped: to the cell holding most of that disc,
   * or, when that cell is taken, the one holding the next most of it, else the free cell nearest the disc. When two heroes
   * are after one cell, it goes to the one whose disc covers more of it. A hero whose last disc fell into a pit goes back
   * to its rune, the cell it started the fight on.
   */
  private regroup() {
    const S = this.S, gw = S.gw, taken = this.occupied(null, true);
    const free = (i: number, j: number) => isFloor(S, i, j) && !taken[j * gw + i];
    const put = (h: HeroState, i: number, j: number, d?: Disc) => {
      taken[j * gw + i] = 1;
      const to = cellCentre(i, j), now = this.spot(h)!;
      h.at = to;
      if (now.x !== to.x || now.y !== to.y) { h.from = { x: now.x, y: now.y }; h.leap = 0; if (d) this.pickup.set(h, d); }
      // the disc stopped right under the hero: it picks it up where it stands
      else if (d) d.gone = true;
    };
    const nearest = (h: HeroState, x: number, y: number, d?: Disc) => {
      let best: [number, number] | null = null, bd = Infinity;
      for (let j = 0; j < S.gh; j++) for (let i = 0; i < gw; i++) {
        const c = cellCentre(i, j), far = Math.hypot(c.x - x, c.y - y);
        if (far < bd && free(i, j)) { bd = far; best = [i, j]; }
      }
      if (best) put(h, ...best, d);
    };
    const home: HeroState[] = [], movers: [HeroState, Disc][] = [];
    for (const h of S.heroes) {
      const p = this.spot(h);
      if (!p) continue;
      const last = h.hp > 0 ? S.discs.filter(d => d.hero === h).pop() : undefined;
      // a fallen hero lies where it fell
      if (!last) taken[Math.floor(p.y / TILE) * gw + Math.floor(p.x / TILE)] = 1;
      else if (last.fall) home.push(h);
      else movers.push([h, last]);
    }
    // the way back to the rune goes first: nobody takes a hero's starting cell from it
    for (const h of home) {
      const r = h.pad !== null ? S.pads[h.pad] : this.spot(h)!, i = Math.floor(r.x / TILE), j = Math.floor(r.y / TILE);
      if (free(i, j)) put(h, i, j);
      else nearest(h, r.x, r.y);
    }
    const bids = movers.flatMap(([h, d]) => this.cover(d).map(([i, j, share]) => ({ h, d, i, j, share })));
    bids.sort((a, b) => b.share - a.share);
    const placed = new Set<HeroState>();
    for (const b of bids) if (!placed.has(b.h) && free(b.i, b.j)) { put(b.h, b.i, b.j, b.d); placed.add(b.h); }
    for (const [h, d] of movers) if (!placed.has(h)) nearest(h, d.x, d.y, d);
  }

  /** The cells a disc lies on and the share of it on each, most first. */
  cover(d: { x: number; y: number; r: number }): [number, number, number][] {
    const N = 12, n = new Map<number, number>(), gw = this.S.gw;
    let all = 0;
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      const x = d.x - d.r + ((a + 0.5) * 2 * d.r) / N, y = d.y - d.r + ((b + 0.5) * 2 * d.r) / N;
      if (Math.hypot(x - d.x, y - d.y) > d.r) continue;
      const k = Math.floor(y / TILE) * gw + Math.floor(x / TILE);
      n.set(k, (n.get(k) ?? 0) + 1);
      all++;
    }
    return [...n].map(([k, c]): [number, number, number] => [k % gw, Math.floor(k / gw), c / all]).sort((p, q) => q[2] - p[2]);
  }

  /** The enemy turn begins: burning heroes smoulder, then the enemies take their moves one at a time. */
  private mobsStart() {
    const S = this.S;
    this.sfx('enemyTurn');
    for (const h of this.alive()) {
      if (h.fire <= 0) continue;
      h.fire--;
      const blk = this.hurtHero(h, 2, 'горит');
      this.noteBlow(blk < 2 ? `${h.def.name} горит: −${2 - blk}` : `${h.def.name} горит`, h, blk);
    }
    for (const m of S.mobs) { m.fx = m.tx = m.x; m.fy = m.ty = m.y; m.walk = undefined; m.hop = 0; }
    S.actor = -1;
    S.clock = 0;
    S.attacked = false;
  }

  /**
   * Hand the move to the next enemy in the order of the room's list (the enemy list shows the same order),
   * skipping ones with nothing to do. False when every enemy has had its move.
   */
  private nextActor() {
    const S = this.S;
    for (let k = S.actor + 1; k < S.mobs.length; k++) {
      const m = S.mobs[k];
      // risen this turn: no intent yet, it acts from the next turn on
      if (m.hp <= 0 || !m.intent) continue;
      S.actor = k;
      S.clock = 0;
      S.attacked = false;
      const burnt = m.burn > 0;
      // fire takes as many HP as it has, through armour, and dies down by one
      if (burnt) {
        const fire = m.burn--;
        this.hurtMob(m, fire, '#ff7a3d', true);
        this.note(`${m.name} горит: −${fire}`);
        if (m.hp <= 0) this.note(`${m.name} ${did(MOBS[m.k], 'сгорел')}`);
      }
      this.planWalk(m);
      if (burnt || (m.hp > 0 && !this.idle(m))) return true;
    }
    return false;
  }

  /**
   * Where a walker goes on its move: along its way to the hero it is after, as far as its steps take it.
   * A shooter that sees the hero fires from where it stands; out of sight, it walks to where it sees it.
   */
  private planWalk(m: Mob) {
    const it = m.intent;
    m.fx = m.tx = m.x;
    m.fy = m.ty = m.y;
    m.walk = undefined;
    if (m.hp <= 0 || !it || it.hero < 0 || m.speed === 0) return;
    const h = this.heroOf(it.hero), p = this.spot(h), aim = isRanged(m.k);
    if (h.hp <= 0 || !p || (aim && this.sees(m, h))) return;
    // the room has changed since the intent was picked: the enemies before it have moved, an icicle may have broken
    const way = this.route(m, p, true, aim);
    if (!way) return;
    const walk = way.slice(0, this.stopAt(m, way) + 1);
    if (walk.length < 2) return;
    m.walk = walk;
    m.tx = walk[walk.length - 1].x;
    m.ty = walk[walk.length - 1].y;
  }

  /** An enemy with nothing to do on its move: walled off, or the one it was after has already fallen. */
  private idle(m: Mob) {
    const it = m.intent!;
    if (it.t === 'move') return !m.walk;
    if (it.t === 'hit') { const h = this.heroOf(it.hero); return h.hp <= 0 || !this.spot(h); }
    if (it.t === 'heal') { const o = this.S.mobs[it.mob!]; return !o || o.hp <= 0; }
    return false;
  }

  /** Seconds an enemy spends walking on its move: a beat per cell. */
  walkTime(m: Mob) {
    return m.walk && m.walk.length > 1 ? Math.max(0.25, (m.walk.length - 1) * CELL_T) : 0;
  }

  /** When an enemy acts, counted from the start of its move: as soon as it has walked up, or after a beat in place. */
  private actAt(m: Mob) {
    const w = this.walkTime(m);
    return w ? w + 0.06 : BEAT;
  }

  /**
   * The cell index along a route where a walker stops this enemy turn: as far as its steps take it,
   * backing off cells that hold a rune, a hero or another enemy (a route that had to squeeze past them).
   */
  private stopAt(m: Mob, cells: Pt[]) {
    const sz = mobSize(m.k), taken = this.occupied(m, true), stands = this.standCells();
    let k = Math.min(cells.length - 1, stepsOf(m));
    while (k > 0) {
      const [i, j] = cellAt(cells[k].x, cells[k].y, sz);
      if (this.fits(i, j, sz, taken) && !this.onStand(i, j, sz, stands)) break;
      k--;
    }
    return k;
  }

  /**
   * Where heroes stand or may come back to: the room's runes, and every hero who has moved off its rune
   * (a fallen one too, its figure lies there). Enemies never stop here, lava never spreads here.
   */
  stands(): Pt[] {
    const out: Pt[] = [...this.S.pads];
    for (const h of this.S.heroes) if (h.at) out.push(h.at);
    return out;
  }

  /** Cells under the runes and the heroes. */
  standCells() {
    return new Set(this.stands().map(p => hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))));
  }

  /**
   * Cells nobody can step on: under blocks, resources, pits and (with `mobs`) the enemies other than `self`,
   * at the cells they will stand on this turn. 1 = taken, row-major gw × gh.
   */
  occupied(self: Mob | null, mobs: boolean) {
    const S = this.S, gw = S.gw, out = new Uint8Array(gw * S.gh);
    const mark = (i: number, j: number, sz = 1) => {
      for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (i + a >= 0 && j + b >= 0 && i + a < gw && j + b < S.gh) out[(j + b) * gw + i + a] = 1;
    };
    for (const b of standing(S.blocks)) mark(Math.floor(b.x0 / TILE), Math.floor(b.y0 / TILE));
    for (const n of S.nodes) if (n.left > 0) mark(...cellAt(n.x, n.y, n.s), n.s);
    for (const p of S.pits) for (const [i, j] of p.cells) mark(i, j);
    if (mobs) for (const o of S.mobs) {
      if (o === self || o.hp <= 0) continue;
      mark(...cellAt(o.tx, o.ty, mobSize(o.k)), mobSize(o.k));
      // a summoning circle is where a mob will rise this turn
      if (o.intent?.t === 'summon') for (const p of o.intent.spots ?? []) mark(...cellAt(p.x, p.y));
    }
    return out;
  }

  private cellFree(i: number, j: number, taken: Uint8Array) {
    return isFloor(this.S, i, j) && !taken[j * this.S.gw + i];
  }

  /** Whether an s × s enemy with its top-left cell at (i, j) fits on open floor. */
  private fits(i: number, j: number, sz: number, taken: Uint8Array) {
    for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (!this.cellFree(i + a, j + b, taken)) return false;
    return true;
  }

  private onStand(i: number, j: number, sz: number, stands: Set<string>) {
    for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (stands.has(hazKey(i + a, j + b))) return true;
    return false;
  }

  /** Whether an s × s enemy at (i, j) stands right next to the cell (ti, tj), close enough to strike it. */
  private nextTo(i: number, j: number, sz: number, ti: number, tj: number) {
    const inside = ti >= i && ti < i + sz && tj >= j && tj < j + sz;
    return !inside && ti >= i - 1 && ti <= i + sz && tj >= j - 1 && tj <= j + sz;
  }

  /** Whether a mob stands next to the hero standing at p. */
  private beside(m: Mob, p: Pt) {
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz);
    return this.nextTo(i, j, sz, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  }

  /**
   * A walker's way to the hero standing at `to`, cell by cell like a piece on a board: 8 directions, no corner cutting,
   * around blocks, pits, resources and the other enemies, to the nearest cells next to the hero it can stand on.
   * Big enemies move their whole 2 × 2 footprint. Returns the centres it steps through, starting where it stands,
   * or null when nothing connects. Other enemies crowding the hero don't stop a walker from heading there.
   * With `aim` the way ends instead on the nearest cell it can stand on that sees the hero: a shooter's firing spot.
   */
  route(m: Mob, to: Pt, mobs = true, aim = false): Pt[] | null {
    const S = this.S, gw = S.gw, gh = S.gh, sz = mobSize(m.k), taken = this.occupied(m, mobs), stands = this.standCells();
    const ti = Math.floor(to.x / TILE), tj = Math.floor(to.y / TILE);
    const [si, sj] = cellAt(m.x, m.y, sz);
    const inRoom = (i: number, j: number) => i >= 0 && j >= 0 && i <= gw - sz && j <= gh - sz;
    if (!inRoom(si, sj)) return null;
    const start = sj * gw + si;
    // a rune or a hero can sit in a one-cell corridor: walkers pass over them, they just never stop on one
    const open = (i: number, j: number) => inRoom(i, j) && !this.onStand(i, j, sz, new Set([hazKey(ti, tj)])) && ((i === si && j === sj) || this.fits(i, j, sz, taken));
    const stop = (i: number, j: number) => (i === si && j === sj) || (this.fits(i, j, sz, taken) && !this.onStand(i, j, sz, stands));
    const goal = aim ? (i: number, j: number) => stop(i, j) && this.clearShot(cellCentre(i, j, sz), to) : (i: number, j: number) => this.nextTo(i, j, sz, ti, tj) && stop(i, j);
    const dist = new Float64Array(gw * gh).fill(Infinity), from = new Int32Array(gw * gh).fill(-1), done = new Uint8Array(gw * gh);
    dist[start] = 0;
    let end = -1;
    // rooms are a couple of hundred cells: a plain scan for the nearest open cell is plenty
    for (;;) {
      let c = -1, cd = Infinity;
      for (let k = 0; k < dist.length; k++) if (!done[k] && dist[k] < cd) { cd = dist[k]; c = k; }
      if (c < 0) break;
      const ci = c % gw, cj = (c - ci) / gw;
      if (goal(ci, cj)) { end = c; break; }
      done[c] = 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if ((!di && !dj) || !open(i, j)) continue;
        if (di && dj && (!open(ci + di, cj) || !open(ci, cj + dj))) continue;
        const k = j * gw + i, nd = cd + (di && dj ? Math.SQRT2 : 1);
        if (nd < dist[k]) { dist[k] = nd; from[k] = c; }
      }
    }
    if (end < 0) return mobs ? this.route(m, to, false, aim) : null;
    const way: Pt[] = [];
    for (let k = end; k >= 0; k = from[k]) way.push(k === start ? { x: m.x, y: m.y } : cellCentre(k % gw, Math.floor(k / gw), sz));
    return way.reverse();
  }

  /** The enemy making its move strikes, casts, heals or summons, as its intent said. */
  private mobAct(m: Mob) {
    const S = this.S, it = m.intent, d = MOBS[m.k];
    if (m.hp <= 0 || !it) return;
    if (it.t === 'slam') {
      m.flash = 0.12; S.shake = 0.3;
      this.sfx('slam');
      this.float(m.x, m.y - 10, it.chill ? 'МЕТЕЛЬ' : 'УДАР ОБ ПОЛ', it.chill ? '#bfe6ff' : '#ffd34d');
      this.note(`${m.name}: ${it.chill ? 'метель' : 'удар'} по всем на ${it.dmg}`);
      for (const h of this.alive()) {
        const blk = this.hurtHero(h, it.dmg, '', m);
        if (blk) this.note(`${h.def.name}: щит принял ${blk}`);
        this.noteFall(h);
        if (it.chill) this.chillHero(h);
      }
      this.tremor(m.x, m.y, 1, m);
    } else if (it.t === 'heal') {
      const o = S.mobs[it.mob!];
      if (!o || o.hp <= 0) return;
      const hl = Math.min(o.max - o.hp, it.dmg);
      o.hp += hl;
      this.float(o.x, o.y, `+${hl}`, '#7be39a'); this.burst(o.x, o.y, '#9fe3ff', 12);
      this.sfx('herb');
      this.note(`${m.name} ${did(d, 'подлечил')} ${MOBS[o.k].acc} на ${hl}`);
    } else if (it.t === 'summon') {
      const kind = d.acts!.find(a => a.k === 'summon')!.kind!, mi = S.mobs.indexOf(m), n = it.spots?.length ?? 0;
      this.float(m.x, m.y - 10, 'призыв!', '#c9a8ff');
      this.sfx('ability');
      this.note(`${m.name} ${did(d, 'призвал')} ${MOBS[kind].acc.toLowerCase()}${n > 1 ? ' ×' + n : ''}`);
      for (const p of it.spots ?? []) {
        // a disc may have come to rest on the circle; the mob still rises, the disc is long gone by then
        const o = newMob(kind, p.x, p.y, S.hpMul, S.dmgAdd, S.dmgMul);
        o.owner = mi; o.born = 1;
        S.mobs.push(o);
        this.burst(p.x, p.y, '#b893ff', 16);
      }
    } else if (it.t === 'heat') {
      this.float(m.x, m.y - 10, 'РАСКАЛЯЕТ ПОЛ', '#ff7a3d');
      this.sfx('ability');
      this.note(`${m.name} ${did(d, 'раскалил')} пол`);
      for (const p of it.spots ?? []) { S.haz.add(hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))); this.burst(p.x, p.y, '#ff7a3d', 10); }
    } else if (it.t === 'charge') {
      this.float(m.x, m.y - 10, 'фитиль горит', '#ffb070');
      this.sfx('launch', 0.3);
      this.note(`${m.name} ${did(d, 'поджёг', 'подожгла')} фитиль` + (m.walk ? ` и ${did(d, 'пошёл', 'пошла')} к ${this.heroOf(it.hero).def.dat}` : ''));
    } else if (it.t === 'move') {
      // walled off, it stayed put: nothing to tell
      if (m.walk) this.note(`${m.name} идёт к ${this.heroOf(it.hero).def.dat}`);
    } else if (it.t === 'hit') {
      const h = this.heroOf(it.hero);
      const p = this.spot(h);
      if (h.hp <= 0 || !p) return;
      // a shooter fires only at a hero it sees, a walker strikes only from right next to it
      if (isRanged(m.k) ? this.sees(m, h) : this.beside(m, p)) {
        // up close the enemy lunges at the hero; a shooter rocks back from its shot
        if (isRanged(m.k)) this.knock(m, m.x, m.y, p.x, p.y, 0.3);
        else this.knock(m, p.x, p.y, m.x, m.y, 0.5);
        const blk = this.hurtHero(h, it.dmg, '', m); m.flash = 0.12;
        const how = !isRanged(m.k) ? `${did(d, 'ударил')} ${h.def.acc}` : d.charge ? `${did(d, 'бросил')} бомбу в ${h.def.acc}` : `${did(d, 'выстрелил')} в ${h.def.acc}`;
        this.noteBlow(`${m.name} ${how} на ${it.dmg}`, h, blk);
        if (d.chill && h.hp > 0) this.chillHero(h);
        if (d.fire && h.hp > 0) { h.fire = 1; this.float(p.x, p.y - 8, 'горит!', '#ff7a3d'); }
      } else if (isRanged(m.k)) {
        this.float(m.x, m.y, 'не видит', '#c7cbe0');
        this.note(`${m.name} не ${did(d, 'увидел')} ${h.def.acc}`);
      } else {
        this.float(m.x, m.y, 'не достал', '#c7cbe0');
        this.note(`${m.name} не ${did(d, 'достал')} ${h.def.acc}`);
      }
    }
  }

  /** Chill lasts through the hero's next throws: two turn ends, the first one comes right after this enemy turn. */
  private chillHero(h: HeroState) {
    if (h.hp <= 0) return;
    h.chill = 2;
    const p = this.spot(h);
    if (p) this.float(p.x, p.y - 8, 'озноб', '#bfe6ff');
  }

  private nextTurn() {
    const S = this.S;
    // the ore cave also ends once its turns are up
    if (!this.alive().length || this.cleared() || (this.turnsMax() && S.turn >= this.turnsMax())) { this.finish(); return; }
    S.turn++;
    S.discs = [];
    S.done = [];
    for (const h of S.heroes) { h.shield = 0; h.thrown = false; h.boost = false; h.hand = h.hp > 0 ? h.discs : 0; if (h.chill > 0) h.chill--; }
    S.phase = 'throw';
    this.sfx('yourTurn');
    this.pickActive();
    this.pickIntents();
    if (this.rage() > 0) { this.float(S.Wx / 2, S.Wy / 2, `ВРАГИ ЗВЕРЕЮТ +${this.rage()}`, '#ff4d6a'); S.shake = Math.max(S.shake, 0.15); }
    this.onChange();
  }

  private finish() {
    this.S.phase = 'over';
    this.sfx(this.alive().length > 0 ? 'win' : 'lose');
    this.onChange();
    this.onRoomEnd(this.alive().length > 0);
  }

  update(dt: number) {
    const S = this.S;
    if (this.send) { this.updateRemote(dt); return; }
    this.acc += dt;
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
    // the last enemy down (in the ore cave, the last vein or mushroom spent) ends the room at once, whatever throws are left
    if ((S.phase === 'throw' || S.phase === 'resolve' || S.phase === 'enemy') && this.cleared()) this.finish();
    // the heroes' turn ends by the players' word only, once the discs have stopped
    else if (S.phase === 'throw' && this.allDone() && !this.moving()) {
      S.phase = 'resolve'; S.timer = 0.9; this.resolve(); this.onChange();
    } else if (S.phase === 'resolve' && (S.timer -= dt) <= 0) {
      // nobody moves against the party in the ore cave: its next turn comes at once
      if (this.cave()) this.nextTurn();
      else { S.phase = 'enemy'; this.mobsStart(); this.onChange(); }
    } else if (S.phase === 'enemy') this.enemyTurn(dt);
    this.fade(dt);
  }

  /** The enemies move one at a time: each walks up and acts, and after a short pause the next one goes. */
  private enemyTurn(dt: number) {
    const S = this.S, m = S.mobs[S.actor];
    S.clock += dt;
    if (m) {
      this.walkMob(m);
      if (!S.attacked && S.clock >= this.actAt(m)) { S.attacked = true; this.mobAct(m); this.onChange(); }
      // a walker that doesn't strike has nothing more to show once it stands
      if (S.clock < this.actAt(m) + (m.intent?.t === 'move' ? 0.12 : AFTER)) return;
    } else if (S.clock < LEAD) return;
    // once the party has fallen nobody is left to hit
    if (this.alive().length && this.nextActor()) this.onChange();
    else this.nextTurn();
  }

  /**
   * The enemy making its move, like a piece on a board: lifted and put down on every cell it walks,
   * or lifted once in place before it acts.
   */
  private walkMob(m: Mob) {
    const S = this.S, T = this.walkTime(m), w = m.walk;
    if (!T || !w) {
      const u = S.clock / BEAT;
      m.hop = m.hp > 0 && u < 1 ? Math.sin(Math.PI * u) * 4 : 0;
      return;
    }
    const n = w.length - 1;
    this.putDown(m, S.clock >= T ? n : Math.floor((S.clock / T) * n));
    if (S.clock >= T) { m.x = m.tx; m.y = m.ty; m.hop = 0; return; }
    const at = Math.min(n - 1e-6, (S.clock / T) * n), k = Math.floor(at), f = at - k, e = f * f * (3 - 2 * f);
    m.x = w[k].x + (w[k + 1].x - w[k].x) * e;
    m.y = w[k].y + (w[k + 1].y - w[k].y) * e;
    m.hop = Math.sin(Math.PI * f) * 6;
  }

  /** The walker has put down on its `n`th cell: a knock on the board for each, once, however the snapshots set the clock back. */
  private putDown(m: Mob, n: number) {
    const key = `${this.S.turn}:${this.S.actor}`;
    if (key !== this.walked.key) this.walked = { key, n: 0 };
    if (n <= this.walked.n) return;
    this.walked.n = n;
    this.onSound('step', n % 2 ? 0.35 : 0.6);
  }

  /**
   * Online client: the host owns the rules; between its snapshots the discs roll on here by the same rules, step for step
   * with the host's count, so they bounce where the host's do, and the enemy making its move keeps walking.
   */
  private updateRemote(dt: number) {
    const S = this.S;
    this.rollOn();
    if (S.phase === 'enemy') {
      S.clock += dt;
      const m = S.mobs[S.actor];
      if (m) this.walkMob(m);
    }
    this.fade(dt);
  }

  /** Online client: run the physics on to the host's step count now. */
  private rollOn() {
    const to = this.hostTick();
    for (let n = 0; this.tick < to && n < REPLAY; n++) this.step(STEP);
  }

  /** Online client: where the host's step count is now, as near as the snapshots tell. */
  private hostTick() {
    if (!this.lags.length) return this.tick;
    return Math.floor((this.clock() / 1000) / STEP - Math.min(...this.lags.map(l => l.lag)) + 1e-6);
  }

  /**
   * Online client: the state of the host's step `tick` was just put in place. It is already a little old, so the discs
   * are played on to where the host's are now, not where they were. The rest (what the enemies do, the effects of it)
   * shows as the host had it, a moment late but from its start. `own` are the sparks this screen's discs have thrown:
   * the snapshot leaves them out.
   */
  synced(tick: number, own: Spark[] = []) {
    const S = this.S, now = this.clock(), lag = (now / 1000) / STEP - tick, was = this.tick;
    this.lags = this.lags.filter(l => now - l.at < LAG_WINDOW);
    if (this.lags.some(l => lag - l.lag > (RESYNC_MS / 1000) / STEP)) this.lags = [];
    this.lags.push({ at: now, lag });
    // the host started its count over: so does what was heard; joining, or waking up far behind, the catch-up plays in silence
    if (tick < this.heard - 2 * REPLAY) this.heard = tick;
    if (tick - was > REPLAY) this.heard = Math.max(this.heard, this.hostTick());
    this.tick = tick;
    const zn = S.zaps.length;
    this.rollOn();
    // hits this screen had already played come again as the discs are played on: their sparks and lightning go on as they were
    S.sparks = S.sparks.filter(p => p.b === undefined || p.b > was).concat(own);
    S.zaps = S.zaps.slice(0, zn).concat(S.zaps.slice(zn).filter(z => z.b > was));
  }

  /** A chip in flight: it falls, bounces off the floor and the walls, slides to a stop; one that drops into a hole is gone. */
  private roll(p: Spark, dt: number) {
    const S = this.S, nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    p.vh -= 340 * dt;
    p.h += p.vh * dt;
    p.a! += p.va! * dt;
    if (isFloor(S, Math.floor(nx / TILE), Math.floor(p.y / TILE))) p.x = nx; else p.vx *= -0.5;
    if (isFloor(S, Math.floor(p.x / TILE), Math.floor(ny / TILE))) p.y = ny; else p.vy *= -0.5;
    if (p.h > 0) return;
    if (pitAt(S.pits, p.x, p.y)) { p.t = p.life ?? 1; return; }
    p.h = 0;
    if (p.vh < -35) { p.vh *= -0.38; p.vx *= 0.55; p.vy *= 0.55; p.va! *= 0.5; }
    else { const k = Math.max(0, 1 - 9 * dt); p.vh = 0; p.vx *= k; p.vy *= k; p.va! *= k; }
  }

  /** Timers of flashes, falling discs, particles and floating numbers. */
  private fade(dt: number) {
    const S = this.S;
    for (const d of S.discs) if (d.fall && !d.gone) { d.fall += dt; if (d.fall > 0.5) d.gone = true; }
    for (const m of S.mobs) {
      if (m.flash > 0) m.flash -= dt; if (m.dead) m.dead += dt; if (m.born > 0) m.born = Math.max(0, m.born - dt * 1.5);
      if (m.knock && (m.knock.t += dt) > KNOCK_T) m.knock = undefined;
    }
    for (const h of S.heroes) {
      if (h.flash > 0) h.flash -= dt;
      if (h.knock && (h.knock.t += dt) > KNOCK_T) h.knock = undefined;
      if (h.from && (h.leap += dt / HOP_T) >= 1) {
        h.from = null;
        h.leap = 0;
        if (this.hopped.get(h.i) !== S.turn) { this.hopped.set(h.i, S.turn); this.onSound('step', 0.9); }
        // landed on its disc: it picks the disc up
        const d = this.pickup.get(h);
        if (d) d.gone = true;
        this.pickup.delete(h);
      }
    }
    for (const n of S.nodes) if (n.hit > 0) n.hit -= dt;
    if (S.shake > 0) S.shake -= dt;
    for (const p of S.sparks) {
      p.t += dt;
      if (p.k) { this.roll(p, dt); continue; }
      p.x += p.vx * dt * 0.5; p.y += p.vy * dt * 0.5; p.vh -= 160 * dt; p.h = Math.max(0, p.h + p.vh * dt);
    }
    S.sparks = S.sparks.filter(p => p.t < (p.life ?? 0.5));
    for (const z of S.zaps) z.t += dt;
    S.zaps = S.zaps.filter(z => z.t < ZAP_T);
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter(f => f.t < 1.6);
  }
}
