// Combat rules: turn flow, disc physics, damage, abilities.
// Rendering and input live elsewhere; this module only changes state.

import { AB_BOUNCES, AB_BURN, AB_COST, AB_SHIELD, AB_SPEED, BOSS_HEAL, CLEAN_ORE, CRIT, CRIT_COS, CUFF_TURNS, E_MAX, ELITE_UPS, FAN_ANGLE, FAN_M, FAN_R, FOOD_HEAL, FOOD_MAX, FOOD_PER_DISC, FROST_STEPS, GAS_MAX, GAS_R, GAS_TURNS, GAS_WEAK, HAND_COST, HAND_MAX, HAND_START, HEROES, MOBS, MOB_E, NODE_E, PETARD_DMG, PETARD_LURE, PETARD_TURNS, RAGE_FROM, RAGE_FROM_BOSS, SHOVE_DMG, TILE, UPS, UP_COST, ZAP, ZAP_REACH, frostVuln, gasDmg, isRanged, mobSize, type HeroDef, type MobAct, type StatKey } from './data';
import { KNOCK_T, type ChipKind, type Knock } from './fx';
import { mulberry32 } from './rng';
import { has, type ArtKey } from './artifacts';
import type { Sfx } from './audio/sfx';
import { CASTS, caveTurns, cellAt, cellCentre, generate, hazKey, inPit, isFloor, muAt, newMob, partyScale, pitAt, standing, type Intent, type Layout, type Mob, type RoomSpec } from './room';

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
  /** Turns left without the aiming line, from a banshee's scream (`dazeHero`). */
  daze: number;
  /** Burning: takes 2 damage at the start of the next enemy turn. */
  fire: number;
  /** The ability is on for the rest of this turn: the discs thrown now shield, set on fire or keep their speed. */
  boost: boolean;
  /** Sparks for the ability, 0 to AB_COST: a spark crystal fills every hero's at once, each spends its own, and they last the whole run. */
  sparks: number;
  /** The last knock it took: the figure rocks on its stand for a moment. */
  knock?: Knock;
  /** The floor bosses' trophies the hero has taken (src/artifacts.ts); saves from before them have none. */
  arts?: string[];
  /** «Бумеранг»: the turn its miss last came back to the hand. */
  boomed?: number;
  /** «Счастливый носок»: it has already saved the hero from a deadly blow in this room. */
  lucky?: boolean;
  /** How many times each of its trophies has gone off this run: the snapshots carry the counts, and the trophy's token by the portrait flashes on every screen. */
  pops?: Record<string, number>;
  /** What the hero has done this run, for the player's statistics; saves from before them have none. */
  tally?: Tally;
  /** Stat levels an elite owes the hero: the next one costs no ore (the sharpening window right after it, or the next blacksmith's). */
  free?: number;
  /** The cop's «Наручники»: the enemies (by index) his discs have hit this turn, the first two; the second hit cuffs them. */
  cuffing?: number[];
}

/**
 * A hero's run in numbers, for the player's statistics (src/stats.ts). The host counts them and the snapshots carry them,
 * so each online player reads their own hero's from the game state. `top` and `rico` are the run's records, the rest sums.
 */
export interface Tally {
  /**
   * The seed of the run it counts: until the host's first snapshot of a new run comes, a client's heroes still hold the
   * last run's numbers, and the statistics leave those alone.
   */
  run: number;
  /** Damage the hero's discs (and their lightning, firecrackers and light spots) dealt, and the biggest single blow. */
  dmg: number;
  top: number;
  kills: number;
  throws: number;
  /** «ТОЧНО!»: straight from the rune into an enemy, square on. */
  crits: number;
  /** The ability switched on. */
  abs: number;
  ore: number;
  /** Damage taken past the shield, and the times the hero fell. */
  hurt: number;
  falls: number;
  /** The most bounces a disc made on its way into an enemy. */
  rico: number;
}

export const newTally = (run = 0): Tally => ({ run, dmg: 0, top: 0, kills: 0, throws: 0, crits: 0, abs: 0, ore: 0, hurt: 0, falls: 0, rico: 0 });
const tallyOf = (h: HeroState) => (h.tally ??= newTally());

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
  /** The bum's ability: this disc has let its cloud of gas out already. */
  gas?: boolean;
  /** «Смазка»: bounces off walls and blocks left that cost the disc no speed. */
  slick?: number;
  /** «Карманный диско-шар»: light spots this disc's bounces have thrown so far. */
  beams?: number;
  /** «Бумеранг»: a miss that went back into the hand; it is off the table and nobody walks over to it. */
  back?: boolean;
  /**
   * The heroes' turn is over and the disc has been settled where it lies: it is out of play, nothing knocks it any more,
   * and its hero, going over to it, picks it up as it lands.
   */
  held?: boolean;
  /** «Надувные труселя»: the disc has floated over a hole already (the trophy's token flashes once a throw). */
  floated?: boolean;
  /**
   * One of the two side discs of the card sharp's fan, a phantom: smaller and weaker, its miss goes unremarked, and a hole
   * or a hazard it ends up in doesn't hurt him.
   */
  fan?: boolean;
}

/**
 * A dish the cook's disc dropped: it flies from where the disc bounced (fx, fy) to (x, y), the middle of a cell, for
 * FOOD_FLY seconds, then lies there to be picked up. `k` picks the dish, `by` is the disc that dropped it (it can't pick it up itself), `t` its age.
 */
export interface Food { x: number; y: number; fx: number; fy: number; k: number; by?: number; t: number }
/** Seconds a dropped dish takes to land. */
export const FOOD_FLY = 0.35;
/**
 * A firecracker the kid's disc dropped: it flies in like a dish, from (fx, fy) to (x, y) in the middle of a cell, for FOOD_FLY
 * seconds, then lies there till an enemy comes within a cell of it. `by` is the disc that dropped it, `h` its hero, `t` its age,
 * `left` the enemy turns it has left and `turn` the turn it was laid in.
 */
export interface Bomb { x: number; y: number; fx: number; fy: number; by?: number; h: number; t: number; left: number; turn: number }
/** The cop's handcuffs on two enemies, by their index in the room's list, for `left` more enemy turns. */
export interface Cuffs { a: number; b: number; left: number }
/** A cloud of the bum's gas: its middle cell, the enemy turns it has left, and its age, for the eye. */
export interface Gas { i: number; j: number; left: number; t: number }
/** How close a disc's edge must pass the middle of a dish to pick it up: the dish fills most of its cell. */
const FOOD_R = 6;
/** How many cells from where a dish was flung it may end up, when the cells nearer are taken. */
const FOOD_SPREAD = 2;

/**
 * A stroke of Electra's lightning from one enemy to the next, for the eye only: every screen strikes its own as the discs
 * hit, `b` is the physics step it struck on, `s` shapes the zigzag, `t` its age.
 */
/** A stroke of lightning from (x0, y0) at height h0 to (x1, y1) at height h1. */
export interface Zap { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; t: number; b: number; s: number; beam?: boolean }
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
  /** The kid's firecracker on the floor, till it goes off or fizzles out. */
  bombs: Bomb[];
  /** The bum's clouds of gas over the floor. */
  gas: Gas[];
  /** The two enemies the cop has cuffed together, if any. */
  cuffs: Cuffs | null;
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
  /** Some hero has lost health in this room: no ore «Без царапины» for it. */
  hurt?: boolean;
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

/** Seconds an enemy the bouncer threw takes to slide a cell over. */
const SLIDE_T = 0.16;
/** Seconds a hero takes to hop over to where its last disc stopped. */
const HOP_T = 0.45;

/** Host: the sounds it sends along with its snapshots are the ones of this many milliseconds back. */
const CUE_MS = 2000;

/** A sound the host made outside the physics, for the clients: its number (they go up), which, how hard, and whose action it was. */
export type Cue = [n: number, ev: Sfx, p: number, h?: number];

/** Lines the enemy-turn journal keeps. */
const LOG_MAX = 40;

/** What the HUD calls a mob's special move. */
const SPECIAL = { summon: 'призыв', heal: 'лечение', heat: 'жар', charge: 'фитиль', execute: 'казнь', scream: 'визг', smash: 'удар молотом', rise: 'подъём' };
const specialName = (k: keyof typeof SPECIAL | 'slam', chill?: boolean) => (k === 'slam' ? (chill ? 'метель' : 'удар по всем') : SPECIAL[k]);

/** The coffin a beaten enemy is laid in gets up as that enemy after this many enemy turns, unless broken. */
export const COFFIN_TURNS = 2;
/** The undertaker reaches enemies that fall this close to it (in world units: five cells). */
export const COFFIN_REACH = 5 * TILE;
/** The grinder hones enemies this close to it (two cells). */
export const HONE_REACH = 2 * TILE + 4;
/** The door shield covers this much on each side of the way its holder faces (cosine of the half angle: ±45°). */
export const SHIELD_COS = 0.7;
/** The hammer's blow on its square hits this much harder than a plain strike. */
export const SMASH_MUL = 1.5;

/** A past-tense verb agreeing with whoever did it: «ударил», «ударила». */
const did = (o: { fem?: boolean }, he: string, she = he + 'а') => (o.fem ? she : he);

type Pt = { x: number; y: number };

/**
 * The trophies' numbers (src/artifacts.ts). «Поднос» widens the disc, «Полироль» cuts its friction, «Смазка» spares it the
 * speed of its first bounces, «Стельки» keep more of its speed off an enemy, «Пружина» adds a point a bounce, «Диско-шар»
 * throws a light spot off a bounce at the nearest enemy, «Ракушка» shields every turn, «Ёж» pricks back, «Клыки» heal
 * a kill, «Чай» puts the rage off, «Энергетик» makes the ability cheaper, «Рентген» shows the bounces.
 */
export const ART = {
  trayR: 1.33, polishFr: 0.67, slick: 2, insolesE: 0.75, springMax: 4, beamDmg: 1, beamReach: 5 * TILE, beamMax: 3,
  cup: 3, hedgehog: 3, fangs: 2, tea: 3, energyCost: 2, xrayBounces: 3, critBig: 3, bells: 3,
};

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
 * Sparks are each hero's own to spend (`HeroState.sparks`), though a crystal fills everyone's, and last the whole run; the
 * altar's gift tops every hero up to `boon` of them at the next fight (usually none). An event may also leave the next fight a `shield`
 * for every hero, `rage`: that much harder blows from its enemies, or a curse that room's spec carries: `smoke` over the
 * floor, a `strobe` that hides the aiming line.
 */
export interface Bank { ore: number; boon?: number; shield?: number; rage?: number; smoke?: boolean; strobe?: boolean }

export function newBank(): Bank {
  return { ore: 0, boon: 0 };
}

/** A fresh party for the run with seed `run`; `picks` lists which heroes (by index into HEROES) take part, the first three by default. */
export function newParty(picks: number[] = [0, 1, 2], run = 0): HeroState[] {
  return picks.map(i => ({ i, def: HEROES[i], ...heroStart(HEROES[i].hp), tally: newTally(run) }));
}

function heroStart(hp: number) {
  return {
    hp, max: hp, shield: 0, up: { m: 0, pw: 0, e: 0 }, discs: HAND_START,
    pad: null as number | null, at: null as Pt | null, from: null as Pt | null, leap: 0, hand: HAND_START, thrown: false, flash: 0, chill: 0, daze: 0, fire: 0, boost: false, sparks: 0, arts: [] as string[],
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
  /** The hero (by index) who has just thrown its last disc of the turn: the next one takes over once it lands (`passOn`). */
  private passing = -1;
  /** The enemy making its move, the cells it has put down on so far, and the hop each hero last landed from. */
  private walked = { key: '', n: 0 };
  private hopped = new Map<number, string>();
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
  /**
   * The blacksmith's window is up after an elite instead of at a blacksmith's room: «Заточка», where every hero takes the
   * stat level the elite gave it (HeroState.free) and nothing is for sale.
   */
  whet = false;
  /** Host: ore the party has mined in this room, for the room's result. */
  mined = 0;
  /** Host: ore the room paid for nobody losing any health in it («Без царапины»), for the room's result. */
  clean = 0;
  private acc = 0;
  /** A blow the cop's cuffs are passing on to the other enemy in them: it isn't passed back. */
  private linked = false;
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
  /** Start a fight in a new room; unless the spec says otherwise, the room is built for the party's size. */
  loadRoom(spec: RoomSpec) {
    spec = { ...spec, heroes: spec.heroes ?? this.party.length };
    // an event's curse on the fight goes with the room, so every screen and a reloaded game have it too
    if (this.bank.smoke) spec.smoke = true;
    if (this.bank.strobe) spec.strobe = true;
    const L = generate(spec);
    this.forge = 0;
    this.whet = false;
    this.mined = 0;
    this.clean = 0;
    this.walked = { key: '', n: 0 };
    this.hopped.clear();
    this.passing = -1;
    // sparks carry over from the last room, and the altar fills them up
    const boon = Math.min(AB_COST, this.bank.boon ?? 0), shield = this.bank.shield ?? 0;
    for (const h of this.party) {
      // «Батарейка» fills the sparks at the start of every fight, «Ракушка» shields from the first blow on
      const full = has(h, 'battery') ? AB_COST : boon, cup = has(h, 'cup') ? ART.cup : 0;
      if (h.hp > 0 && full > boon && h.sparks < AB_COST) this.pop(h, 'battery');
      if (h.hp > 0 && cup) this.pop(h, 'cup');
      Object.assign(h, {
        pad: null, at: null, from: null, leap: 0, hand: h.hp > 0 ? this.handOf(h) : 0, thrown: false, shield: h.hp > 0 ? shield + cup : 0, flash: 0, chill: 0, daze: 0, fire: 0,
        boost: false, sparks: Math.min(AB_COST, Math.max(h.sparks, full)), boomed: 0, lucky: false,
      });
      delete h.cuffing;
    }
    // an event's curse: the room's enemies come in angrier
    if (this.bank.rage) for (const m of L.mobs) m.dmg += this.bank.rage;
    this.bank.boon = 0;
    delete this.bank.shield;
    delete this.bank.rage;
    delete this.bank.smoke;
    delete this.bank.strobe;
    this.S = { ...L, spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], food: [], bombs: [], gas: [], cuffs: null, zaps: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [], done: [], log: [], away: this.online ? this.S?.away ?? [] : [] };
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
    this.S = { ...generate(spec), spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], food: [], bombs: [], gas: [], cuffs: null, zaps: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [], done: [], log: [], away: [] };
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

  /** Where a hero stands: on its rune for the first turn, then where its last disc stopped; null before it is placed. */
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

  /** Sparks the hero's ability costs: fewer with «Энергетик». */
  abCost(h: HeroState) { return has(h, 'energy') ? ART.energyCost : AB_COST; }
  /** Discs the hero throws a turn: the ones bought, and one more with «Третья рука». */
  handOf(h: HeroState) { return h.discs + (has(h, 'hand') ? 1 : 0); }
  /** The size of the hero's disc and its friction on the floor, as the trophies change them. */
  discR(h: HeroState) { return h.def.r * (has(h, 'tray') ? ART.trayR : 1); }
  discFr(h: HeroState) { return h.def.fr * (has(h, 'polish') ? ART.polishFr : 1); }

  select(i: number) {
    const h = this.party.find(o => o.i === i);
    if (!h || !this.canControl(h)) return;
    this.act = i;
    this.passing = -1;
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

  /**
   * A disc the hero has thrown still rolls or is dropping into a hole (the card sharp's phantoms aside). The hero stays
   * where it stands all turn and may throw again meanwhile; only the campaign's hand-over to the next hero waits for it.
   */
  waits(h: HeroState) {
    return this.S.discs.some(d => d.hero === h && !d.gone && !d.back && !d.fan && !d.held && (d.fall > 0 || Math.hypot(d.vx, d.vy) > 2));
  }

  /**
   * The hero can throw now: the heroes' turn, a disc in hand, and its player hasn't ended the turn. Every disc of the turn
   * leaves from the same cell, so it may bounce off the ones already lying on the table.
   */
  canThrow(h: HeroState) {
    return this.S.phase === 'throw' && h.hand > 0 && h.hp > 0 && !!this.spot(h) && !this.ended(h);
  }

  /** Throw the hero's next disc. (dx, dy) is the pull-back vector in world units, up to 60. */
  throwDisc(h: HeroState, dx: number, dy: number) {
    const S = this.S;
    const p = this.spot(h);
    if (!this.canThrow(h) || !p) return;
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
        r: this.discR(h) * (fan ? FAN_R : 1), m: this.stat(h, 'm') * (fan ? FAN_M : 1), e: this.stat(h, 'e'), fr: this.discFr(h),
        fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0,
        ab: h.boost, rico: h.boost && h.def.key === 'ricochet' ? AB_BOUNCES : 0, ...(fan ? { fan } : {}), ...(has(h, 'lube') ? { slick: ART.slick } : {}),
      };
    };
    // the card sharp's fan: a disc out of each sleeve first, the one he aimed last, so he goes after that one
    if (h.boost && h.def.key === 'sharp') for (const a of [-FAN_ANGLE, FAN_ANGLE]) S.discs.push(disc(a, true));
    S.discs.push(disc(0, false));
    h.hand--;
    if (!h.hand) this.passing = h.i;
    h.thrown = true;
    tallyOf(h).throws++;
    this.onChange();
  }

  /** Launch speed per unit of pull-back; a chilled hero throws softer. */
  power(h: HeroState) {
    return ((270 * this.stat(h, 'pw')) / 60) * (h.chill > 0 ? 0.7 : 1);
  }

  /** A ghost is bodiless on even turns: discs pass through it. */
  solid(m: Mob) {
    // a coffin still settling on the floor lets the disc that felled its enemy roll on
    return m.hp > 0 && !(m.born > 0) && !(MOBS[m.k].ghost && this.S.turn % 2 === 0);
  }

  /**
   * Where a throw with pull-back (dx, dy) would roll, ignoring other discs: path points, the bounce points along it,
   * and the mob it would hit first. It rolls by the same rules as a thrown disc, step for step. Stops after `maxBounces`
   * bounces (the aim line uses 0: it ends at the first obstacle; «Рентген-очки» show three).
   */
  predict(h: HeroState, dx: number, dy: number, maxBounces = 2) {
    const S = this.S, L = Math.hypot(dx, dy), path: [number, number][] = [], bounces: [number, number][] = [], p = this.spot(h);
    if (!p || L < 4) return { path, bounces, hit: null as Mob | null };
    const s = this.power(h);
    const d = {
      hero: h, x: p.x + (dx / L) * 6, y: p.y + (dy / L) * 6, vx: dx * s, vy: dy * s, r: this.discR(h), e: this.stat(h, 'e'), fr: this.discFr(h), spin: 0,
      ab: h.boost, rico: h.boost && h.def.key === 'ricochet' ? AB_BOUNCES : 0, slick: has(h, 'lube') ? ART.slick : 0,
    } as Disc;
    const boxes = standing(S.blocks).concat(S.rock), over = has(h, 'undies') || this.wild(d);
    // a bounce that costs no speed spends one of the disc's sure bounces, as in play
    const keep = () => this.keep(d), spend = () => { if (d.rico > 0) d.rico--; else if (d.slick) d.slick--; };
    path.push([d.x, d.y]);
    for (let k = 0; k < 1800; k++) {
      if (Math.hypot(d.vx, d.vy) < 2) break;
      this.glide(d, STEP);
      let hitWall = false;
      const k0 = keep();
      if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * k0; hitWall = true; }
      if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * k0; hitWall = true; }
      if (d.x > S.Wx - d.r) { d.x = S.Wx - d.r; d.vx = -d.vx * k0; hitWall = true; }
      if (d.y > S.Wy - d.r) { d.y = S.Wy - d.r; d.vy = -d.vy * k0; hitWall = true; }
      if (!over && pitAt(S.pits, d.x, d.y)) { path.push([d.x, d.y]); return { path, bounces, hit: null }; }
      for (const b of boxes) if (this.bounceBox(d, b, keep()) > 0) hitWall = true;
      for (const n of S.nodes) if (n.left > 0 && this.bounceStatic(d, n, NODE_E) > 0) hitWall = true;
      const m = S.mobs.find(o => this.solid(o) && Math.hypot(d.x - o.x, d.y - o.y) < d.r + o.r);
      if (m) { path.push([d.x, d.y]); return { path, bounces, hit: m }; }
      if (hitWall) {
        spend();
        bounces.push([d.x, d.y]);
        path.push([d.x, d.y]);
        if (bounces.length > maxBounces) return { path, bounces, hit: null };
      }
      if (k % 6 === 0) path.push([d.x, d.y]);
    }
    path.push([d.x, d.y]);
    return { path, bounces, hit: null as Mob | null };
  }

  /** A disc rolls on for dt: it slows on the floor (a Ricochet disc with sure bounces left keeps a good clip) and moves. */
  private glide(d: Disc, dt: number) {
    const v = Math.hypot(d.vx, d.vy);
    if (d.rico > 0 && v > 0) { const nv = Math.max(v, AB_SPEED); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
    else if (v > 0) { const nv = Math.max(0, v - muAt(this.S, d.x, d.y) * d.fr * dt); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }

  /** Cost of the next extra disc, or 0 when the hero already has the most. */
  discCost(h: HeroState) {
    return h.discs < HAND_MAX ? HAND_COST[h.discs - HAND_START] : 0;
  }

  buyDisc(h = this.hero) {
    const c = this.discCost(h);
    if (!this.forge || this.whet || !c || this.bank.ore < c) return;
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

  /** The hero's next stat level costs nothing: an elite owes it one. */
  freeUp(h: HeroState) {
    return (h.free ?? 0) > 0;
  }

  upgrade(k: StatKey, h = this.hero) {
    const c = this.upCost(h, k), free = this.freeUp(h);
    if (!this.forge || !c || (!free && (this.whet || this.bank.ore < c))) return;
    if (this.send) { this.send({ k: 'up', h: h.i, stat: k }); return; }
    if (free) h.free!--;
    else this.bank.ore -= c;
    h.up[k]++;
    this.onChange();
  }

  /** Open the sharpening window after an elite: every hero is owed ELITE_UPS stat levels, the fallen too. */
  sharpen(depth: number) {
    for (const h of this.party) h.free = (h.free ?? 0) + ELITE_UPS;
    this.forge = depth;
    this.gift = 0;
    this.whet = true;
    this.onChange();
  }

  /**
   * An ability works through the discs thrown after it, so it needs a disc still in hand and a hero still throwing,
   * and it goes on once a turn on the hero's own sparks.
   */
  canUseAbility(h = this.hero) {
    return this.S.phase === 'throw' && h.hp > 0 && h.hand > 0 && !h.boost && !this.ended(h) && h.sparks >= this.abCost(h) && this.liveMobs().length > 0;
  }

  useAbility(h = this.hero) {
    if (!this.canUseAbility(h)) return;
    this.sfx('ability', 0.7, h.i);
    if (this.send) { this.send({ k: 'ability', h: h.i }); return; }
    h.sparks -= this.abCost(h);
    if (has(h, 'energy')) this.pop(h, 'energy');
    h.boost = true;
    tallyOf(h).abs++;
    const p = this.spot(h);
    if (p) {
      this.float(p.x, p.y - 8, h.def.ab + '!', h.def.abCol);
      this.burst(p.x, p.y, h.def.abCol, 16);
    }
    this.onChange();
  }

  /**
   * A disc thrown with the ability on hits an enemy: Bastion's shields the whole party, Ash's stokes the enemy's fire,
   * Electra's strikes lightning, the cook's drops a dish, the bum's lets out its gas, the cop's cuffs it. This goes before
   * the hit's damage; Electra's lightning, the ice genius's frost, the bouncer's throw and the model's kiss come after it.
   */
  private abilityHit(d: Disc, m: Mob) {
    const k = d.hero.def.key;
    this.abBounce(d, d.x - m.x, d.y - m.y, true);
    if (k === 'bastion') {
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
    } else if (k === 'cop') this.cuff(d.hero, m);
  }

  /**
   * Electra's lightning off a hit on m: it strikes m (unless the disc has just felled it), then leaps to the nearest enemy
   * not struck yet within ZAP_REACH of the last one, as many times as ZAP has strokes, each weaker, through armour.
   */
  private zap(m: Mob, by?: HeroState) {
    const hit = new Set<Mob>([m]);
    let at: Pt = m, k = 0;
    // the first stroke falls on the struck enemy from above, the rest leap from one to the next at chest height
    if (m.hp > 0) { this.hurtMob(m, ZAP[k++], '#7fe3ff', true, 0.5, by); this.bolt(m.x, m.y, 60, m.x, m.y, 14, 0.6); }
    while (k < ZAP.length) {
      let to: Mob | null = null, best = ZAP_REACH;
      for (const o of this.S.mobs) {
        const far = Math.hypot(o.x - at.x, o.y - at.y);
        if (!hit.has(o) && this.solid(o) && far <= best) { best = far; to = o; }
      }
      if (!to) break;
      hit.add(to);
      this.bolt(at.x, at.y, 16, to.x, to.y, 16, 1);
      this.hurtMob(to, ZAP[k++], '#7fe3ff', true, 0.5, by);
      at = to;
    }
    this.sfx('zap', 0.8);
  }

  /** A stroke of lightning between two points, `p` how bright. */
  private bolt(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, p: number, beam = false) {
    this.S.zaps.push({ x0, y0, h0, x1, y1, h1, t: 0, b: this.tick, s: Math.floor(this.fx() * 1e9), ...(beam ? { beam } : {}) });
    this.burst(x1, y1, beam ? '#ffe27a' : '#7fe3ff', Math.round(6 * p));
  }

  /**
   * A disc with its ability on bounced off something (a wall, a block, a resource, another disc or, `foe`, an enemy); (nx, ny)
   * points from it toward the disc. The cook's drops a dish, the kid's a firecracker (off anything but an enemy), the bum's
   * lets its gas out on its first bounce.
   */
  private abBounce(d: Disc, nx: number, ny: number, foe = false) {
    if (!d.ab) return;
    const k = d.hero.def.key;
    if (k === 'cook') this.dropFood(d, nx, ny);
    else if (k === 'kid' && !foe) this.dropBomb(d, nx, ny);
    else if (k === 'bum') this.puff(d);
  }

  /**
   * Where a thing flung off a bounce lands; (nx, ny) points from what the disc bounced off toward it. It flies back out into
   * the room about a cell and lands in the middle of a cell of open floor: one dish or firecracker to a cell, so a bounce
   * next to one already lying there puts the new one on the nearest free cell beside it. Nothing lands under an enemy, a
   * resource, a block, in a hole, on spikes or lava, or on a rune or a hero's cell. Null when there's no room.
   */
  private landing(d: Disc, nx: number, ny: number): Pt | null {
    const S = this.S, L = Math.hypot(nx, ny);
    if (!L) return null;
    nx /= L; ny /= L;
    const side = (this.fx() - 0.5) * 12, x = d.x + nx * 16 - ny * side, y = d.y + ny * 16 + nx * side;
    const taken = this.occupied(null, true), stands = this.standCells(), fi = Math.floor(x / TILE), fj = Math.floor(y / TILE);
    const lying = (c: Pt) => S.food.some(f => f.x === c.x && f.y === c.y) || S.bombs.some(b => b.x === c.x && b.y === c.y);
    let best: Pt | null = null, bd = Infinity;
    for (let j = fj - FOOD_SPREAD; j <= fj + FOOD_SPREAD; j++) for (let i = fi - FOOD_SPREAD; i <= fi + FOOD_SPREAD; i++) {
      if (!this.cellFree(i, j, taken) || S.haz.has(hazKey(i, j)) || stands.has(hazKey(i, j))) continue;
      const c = cellCentre(i, j), dd = Math.hypot(c.x - x, c.y - y);
      if (dd >= bd || lying(c)) continue;
      best = c; bd = dd;
    }
    return best;
  }

  /** The cook's disc drops a dish off a bounce, while it has dishes left and the floor has room for one. */
  private dropFood(d: Disc, nx: number, ny: number) {
    const S = this.S;
    if ((d.food ?? 0) >= FOOD_PER_DISC || S.food.length >= FOOD_MAX) return;
    const at = this.landing(d, nx, ny);
    if (!at) return;
    S.food.push({ ...at, fx: d.x, fy: d.y, k: Math.floor(this.fx() * 4), by: d.id, t: 0 });
    d.food = (d.food ?? 0) + 1;
  }

  /** A disc bounced off another one: the kid's drops a firecracker, if its ability is on. */
  private kidBounce(d: Disc, nx: number, ny: number) {
    if (d.ab && d.hero.def.key === 'kid') this.dropBomb(d, nx, ny);
  }

  /**
   * The kid's disc drops a firecracker off a bounce, the same way the cook's drops a dish, one a turn. One from an earlier
   * turn moves: it is gone as the new one flies off, and the enemies it drew go back to the heroes till the new one lands.
   */
  private dropBomb(d: Disc, nx: number, ny: number) {
    const S = this.S, old = S.bombs;
    if (old.some(b => b.turn === S.turn)) return;
    S.bombs = [];
    const at = this.landing(d, nx, ny);
    if (!at) { S.bombs = old; return; }
    for (const b of old) this.burst(b.x, b.y, '#9a948a', 8);
    S.bombs = [{ ...at, fx: d.x, fy: d.y, by: d.id, h: d.hero.i, t: 0, left: PETARD_TURNS, turn: S.turn }];
    if (old.length) this.listen();
  }

  /** Whether an enemy stands within `r` cells of a firecracker (any of its cells, counting diagonals), or on it. */
  near(m: Mob, b: Pt, r = 1) {
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz), bi = Math.floor(b.x / TILE), bj = Math.floor(b.y / TILE);
    return bi >= i - r && bi < i + sz + r && bj >= j - r && bj < j + sz + r;
  }

  /** In the enemies' turn, a firecracker that has landed goes off on the first enemy within a cell of it, the nearest if two are. */
  private fuse() {
    const S = this.S;
    if (S.phase !== 'enemy') return;
    for (const b of S.bombs.slice()) {
      if (b.t < FOOD_FLY) continue;
      const m = this.liveMobs().filter(o => this.near(o, b)).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
      if (m) this.blast(b, m);
    }
  }

  /**
   * The firecrackers crackle, loud enough for the whole room: each draws the PETARD_LURE enemies nearest it out of those that
   * mean to go for a hero and can walk up to it, the nearest pairs first, every enemy to one firecracker. Those go for the noise
   * this turn instead; one no longer drawn goes back to the hero it was after. Bosses' blows on everyone, heals and summons
   * go ahead as they were, an enemy that never walks can't come.
   */
  private listen() {
    const S = this.S, bombs = S.bombs.filter(b => b.t >= FOOD_FLY);
    const can = this.liveMobs().filter(m => m.speed > 0 && m.kiss === undefined && m.intent && (m.intent.t === 'hit' || m.intent.t === 'move' || m.intent.t === 'charge'));
    const pairs: { b: Bomb; m: Mob; d: number }[] = [];
    for (const b of bombs) for (const m of can) pairs.push({ b, m, d: Math.hypot(b.x - m.x, b.y - m.y) });
    pairs.sort((p, q) => p.d - q.d);
    const drawn = new Map<Mob, Intent>(), count = new Map<Bomb, number>();
    for (const { b, m } of pairs) {
      if (drawn.has(m) || (count.get(b) ?? 0) >= PETARD_LURE) continue;
      const it = this.lureTo(m, b);
      if (!it) continue;
      drawn.set(m, it);
      count.set(b, (count.get(b) ?? 0) + 1);
    }
    for (const m of can) {
      const it = drawn.get(m);
      if (it) m.intent = it;
      else if (m.intent!.bang) { m.intent = { t: 'move', hero: m.intent!.hero, dmg: 0 }; this.retune(m); }
    }
  }

  /** An enemy going for the firecracker at b instead of hero `it.hero`: as far as its steps take it this turn. Null when walled off. */
  private lureTo(m: Mob, b: Pt): Intent | null {
    const way = this.route(m, b);
    if (!way) return null;
    return { t: 'move', hero: m.intent?.hero ?? 0, dmg: 0, bang: { x: b.x, y: b.y }, way, go: wayLen(way.slice(0, this.stopAt(m, way) + 1)) };
  }

  /**
   * A firecracker goes off under enemy m: it takes PETARD_DMG through armour and the figures around jolt; the firecracker is gone.
   * An enemy felled on its walk stops on the cell where it fell.
   */
  private blast(b: Bomb, m: Mob) {
    const S = this.S, by = S.heroes.find(h => h.i === b.h);
    S.bombs = S.bombs.filter(o => o !== b);
    this.float(b.x, b.y - 10, 'БАХ!', '#ffb347');
    this.burst(b.x, b.y, '#ffb347', 18);
    this.burst(b.x, b.y, '#fff1a8', 10);
    S.shake = Math.max(S.shake, 0.15);
    this.sfx('boom');
    this.hurtMob(m, PETARD_DMG, '#ffb347', true, 0.7, by);
    this.knock(m, m.x, m.y, b.x, b.y, 0.7);
    if (m.hp <= 0 && m.walk && S.phase === 'enemy' && S.mobs[S.actor] === m) {
      const c = cellCentre(...cellAt(m.x, m.y, mobSize(m.k)), mobSize(m.k));
      m.x = m.tx = c.x; m.y = m.ty = c.y; m.walk = undefined; m.hop = 0;
    }
    this.tremor(b.x, b.y, 0.5, b);
  }

  /** Whether the cell (i, j) is in a cloud of gas: within GAS_R of its middle each way, the corners cut off. */
  gasAt(i: number, j: number) {
    return this.S.gas.some(g => { const a = Math.abs(i - g.i), b = Math.abs(j - g.j); return a <= GAS_R && b <= GAS_R && (a < GAS_R || b < GAS_R); });
  }

  /** Whether an enemy stands in the gas: any of its cells in a cloud. */
  inGas(m: Mob) {
    if (!this.S.gas.length) return false;
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz);
    for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (this.gasAt(i + a, j + b)) return true;
    return false;
  }

  /** A blow by m: GAS_WEAK weaker while it stands in the gas, never under one. */
  private cut(m: Mob, n: number) {
    return n > 0 && this.inGas(m) ? Math.max(1, Math.round(n * (1 - GAS_WEAK))) : n;
  }

  /**
   * The bum's disc bounces for the first time: a cloud of gas rises on the cell under it. A cloud already on that cell starts
   * its turns over; past GAS_MAX the oldest clears. The enemies it takes in strike weaker at once.
   */
  private puff(d: Disc) {
    const S = this.S;
    if (d.gas) return;
    d.gas = true;
    const i = Math.floor(d.x / TILE), j = Math.floor(d.y / TILE);
    S.gas = S.gas.filter(g => g.i !== i || g.j !== j);
    S.gas.push({ i, j, left: GAS_TURNS, t: 0 });
    if (S.gas.length > GAS_MAX) S.gas.shift();
    this.float(d.x, d.y - 10, 'фу-у!', '#b9e34f');
    this.burst(d.x, d.y, '#9fd34a', 14);
    this.sfx('gas');
    for (const m of this.liveMobs()) if (this.inGas(m)) this.retune(m);
  }

  /** An enemy frozen stiff: hit twice by the ice genius's disc this turn, it skips its next move. */
  frozen(m: Mob) {
    return (m.frost ?? 0) >= 2;
  }

  /** Cells a walker covers on its next move: a frosted one only FROST_STEPS. */
  private steps(m: Mob) {
    return m.frost ? Math.min(FROST_STEPS, stepsOf(m)) : stepsOf(m);
  }

  /** The ice genius's disc hits an enemy: once, and it barely crawls next move; twice, and it skips the move. */
  private freeze(m: Mob) {
    if (m.hp <= 0) return;
    m.frost = (m.frost ?? 0) + 1;
    this.float(m.x, m.y - 14, this.frozen(m) ? 'заморожен!' : 'замедлен', '#bdf2ff');
    this.burst(m.x, m.y, '#cfefff', this.frozen(m) ? 16 : 8);
    this.sfx('freeze', this.frozen(m) ? 1 : 0.6);
    this.retune(m);
  }

  /**
   * Gas, frost, a kiss or the bouncer has just caught an enemy in the heroes' turn: what it means to do this turn is worked
   * out afresh, so the badge shows it. A frosted walker gets as far as its steps take it, a gassed blow is weaker.
   */
  private retune(m: Mob) {
    const it = m.intent;
    if (!it || m.hp <= 0) return;
    // kissed, it goes for the nearest other enemy from where it stands now
    if (m.kiss !== undefined) { m.intent = this.charm(m); return; }
    if (it.t === 'slam') { it.dmg = this.slamDmg(m, it.chill); return; }
    // drawn by a firecracker, a frosted walker gets that much less far toward it
    if (it.bang) { m.intent = this.lureTo(m, it.bang) ?? it; return; }
    if (it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge') return;
    const h = this.heroOf(it.hero), p = this.spot(h);
    if (h.hp <= 0 || !p) return;
    if (isRanged(m.k)) m.intent = this.shoot(m, [h], 0);
    else if (it.t !== 'charge') m.intent = this.chase(m, h, this.route(m, p));
  }

  /** A boss or the floor's elite: too heavy for the bouncer to throw anywhere. */
  heavy(m: Mob) {
    return !!MOBS[m.k].boss || mobSize(m.k) > 1 || CASTS.some(c => c.elite === m.k);
  }

  /**
   * The bouncer's disc has hit m and left it standing: m is thrown a cell on, away from the disc, to the nearest of the eight
   * ways a piece goes on the board. A wall, a block, a resource, a rune or another enemy in the way slams it (SHOVE_DMG through
   * armour, and as much to the other enemy); a hole swallows it; spikes or lava burn it as they would a hero. A boss or the
   * floor's elite doesn't budge and takes the slam.
   */
  private shove(d: Disc, m: Mob) {
    const S = this.S, h = d.hero;
    if (m.hp <= 0) return;
    if (this.heavy(m)) {
      this.float(m.x, m.y - 14, 'не сдвинуть', '#ffcf5a');
      this.slam(m, h);
      return;
    }
    const a = Math.round(Math.atan2(m.y - d.y, m.x - d.x) / (Math.PI / 4)) * (Math.PI / 4), di = Math.round(Math.cos(a)), dj = Math.round(Math.sin(a));
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz), ni = i + di, nj = j + dj, stands = this.standCells();
    const cells: Pt[] = [];
    for (let b = 0; b < sz; b++) for (let c = 0; c < sz; c++) cells.push({ x: ni + c, y: nj + b });
    // rock, a block, a resource, a rune or a summoning circle: it bangs into it; going slantwise it can't cut past a corner either
    const circles = new Set(this.liveMobs().flatMap(q => (q.intent?.t === 'summon' ? q.intent.spots ?? [] : []).map(p => hazKey(...cellAt(p.x, p.y)))));
    const hard = (ci: number, cj: number) => !isFloor(S, ci, cj) || stands.has(hazKey(ci, cj)) || circles.has(hazKey(ci, cj))
      || standing(S.blocks).some(b => Math.floor(b.x0 / TILE) === ci && Math.floor(b.y0 / TILE) === cj)
      || S.nodes.some(n => { if (n.left <= 0) return false; const s = n.s ?? 1, [p, q] = cellAt(n.x, n.y, s); return ci >= p && ci < p + s && cj >= q && cj < q + s; });
    const corner = di && dj && [[i + di, j], [i, j + dj]].some(([ci, cj]) => cells.length === 1 && hard(ci, cj));
    if (corner || cells.some(c => hard(c.x, c.y))) {
      this.float(m.x, m.y - 14, 'БАМ!', '#ffcf5a');
      this.slam(m, h);
      return;
    }
    const o = this.liveMobs().find(q => {
      if (q === m) return false;
      const qs = mobSize(q.k), [p, r] = cellAt(q.x, q.y, qs);
      return cells.some(c => c.x >= p && c.x < p + qs && c.y >= r && c.y < r + qs);
    });
    if (o) {
      this.float((m.x + o.x) / 2, (m.y + o.y) / 2 - 14, 'БАМ!', '#ffcf5a');
      this.knock(o, o.x, o.y, m.x, m.y, 0.7, 0.05);
      this.slam(m, h, o);
      return;
    }
    // a free cell: it slides over
    const c = cellCentre(ni, nj, sz);
    m.slid = { x: m.x, y: m.y, t: 0 };
    m.x = m.fx = m.tx = c.x;
    m.y = m.fy = m.ty = c.y;
    this.sfx('shove', 0.6);
    if (cells.some(q => S.pits.some(pt => inPit(pt, q.x, q.y)))) {
      // over a hole: down it goes, out of the fight
      m.fell = 0.001;
      this.float(m.x, m.y - 14, 'на выход!', '#ffcf5a');
      this.note(`${h.def.name} ${did(h.def, 'выкинул')} ${MOBS[m.k].acc.toLowerCase()} в яму`);
      this.sfx('pit');
      this.hurtMob(m, m.hp, '#ffcf5a', true, 0.8, h);
      return;
    }
    if (cells.some(q => S.haz.has(hazKey(q.x, q.y)))) {
      this.float(m.x, m.y - 22, S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
      this.hurtMob(m, S.biome.hazDmg, '#ff4d6a', true, 0.6, h);
    }
    this.retune(m);
  }

  /** Thrown into something by the bouncer: SHOVE_DMG to m through armour, and as much to the enemy `o` it hit. */
  private slam(m: Mob, h: HeroState, o?: Mob) {
    this.S.shake = Math.max(this.S.shake, 0.12);
    this.sfx('shove');
    this.hurtMob(m, SHOVE_DMG, '#ffcf5a', true, 0.6, h);
    if (o) this.hurtMob(o, SHOVE_DMG, '#ffcf5a', true, 0.6, h);
  }

  /**
   * The cop's disc hits an enemy: the first two different ones his discs hit this turn are cuffed together, before the second
   * hit's damage, so that already goes to both. A pair cuffed before comes off, the new one goes on. If the first has
   * fallen meanwhile, this one waits for its pair instead.
   */
  private cuff(h: HeroState, m: Mob) {
    const S = this.S, k = S.mobs.indexOf(m), got = (h.cuffing ??= []);
    if (m.hp <= 0 || got.includes(k) || got.length >= 2) return;
    if (got.length && S.mobs[got[0]].hp <= 0) got.length = 0;
    got.push(k);
    if (got.length < 2) { this.float(m.x, m.y - 14, 'клац', '#ff8fd0'); this.sfx('cuff', 0.4); return; }
    S.cuffs = { a: got[0], b: k, left: CUFF_TURNS };
    for (const o of [S.mobs[got[0]], m]) { this.float(o.x, o.y - 14, 'в наручниках!', '#ff8fd0'); this.burst(o.x, o.y, '#ff8fd0', 10); }
    this.sfx('cuff');
  }

  /** The enemy cuffed to m, standing or not; null for one not in cuffs. */
  cuffedTo(m: Mob) {
    const S = this.S, c = S.cuffs, k = S.mobs.indexOf(m);
    return !c ? null : k === c.a ? S.mobs[c.b] : k === c.b ? S.mobs[c.a] : null;
  }

  /**
   * The cuffs pass a blow on: whatever m has just lost, the enemy cuffed to it loses too, through armour, and not back again.
   * With either of them down the cuffs drop off.
   */
  private chain(m: Mob, n: number, p: number, by?: HeroState) {
    const S = this.S, c = S.cuffs, o = this.cuffedTo(m);
    if (!c || !o) return;
    if (!this.linked && o.hp > 0) {
      this.linked = true;
      this.hurtMob(o, n, '#ff8fd0', true, p * 0.7, by);
      this.linked = false;
    }
    if (S.cuffs === c && (m.hp <= 0 || o.hp <= 0)) {
      S.cuffs = null;
      const up = m.hp > 0 ? m : o;
      if (up.hp > 0) this.float(up.x, up.y - 18, 'наручники упали', '#ff8fd0');
    }
  }

  /**
   * The model's disc hits m: a kiss, and on its next move it goes for the nearest other enemy instead of the heroes. Bosses
   * shrug it off, and a coffin has nobody inside to charm.
   */
  private kiss(m: Mob, h: HeroState) {
    if (m.hp <= 0) return;
    if (MOBS[m.k].boss || MOBS[m.k].prop) { this.float(m.x, m.y - 14, 'не берёт', '#ff9ab8'); return; }
    if (m.kiss === undefined) { this.float(m.x, m.y - 14, 'чмок!', '#ff5a8a'); this.burst(m.x, m.y, '#ff7ab0', 10); this.sfx('kiss'); }
    m.kiss = h.i;
    this.retune(m);
  }

  /**
   * What a kissed enemy does on its move: it goes for the nearest other enemy instead of the heroes, with its own blow at full
   * strength. A walker strikes from right next to it, a shooter fires once it sees it, walking to where it would if not; with
   * nobody else left in the room it stands and sighs.
   */
  private charm(m: Mob): Intent {
    const S = this.S, o = this.liveMobs().filter(q => q !== m).sort((p, q) => Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(q.x - m.x, q.y - m.y))[0];
    if (!o) return { t: 'move', hero: -1, dmg: 0, sigh: true };
    const foe = S.mobs.indexOf(o), far = isRanged(m.k);
    if (far && this.clearShot(m, o)) return { t: 'hit', hero: -1, dmg: this.blow(m), foe };
    const way = m.speed > 0 ? this.route(m, o, true, far) : null;
    if (!way) return { t: 'move', hero: -1, dmg: 0, foe };
    const n = way.length - 1, now = this.steps(m), go = wayLen(way.slice(0, this.stopAt(m, way) + 1));
    return n <= now ? { t: 'hit', hero: -1, dmg: this.blow(m), foe, way, go, eta: 1 } : { t: 'move', hero: -1, dmg: 0, foe, way, go, eta: 1 + Math.ceil((n - now) / stepsOf(m)) };
  }

  /** Whether two enemies stand right next to each other, close enough for one to strike the other. */
  private besideMob(m: Mob, o: Mob) {
    const a = mobSize(m.k), b = mobSize(o.k), [i, j] = cellAt(m.x, m.y, a), [p, q] = cellAt(o.x, o.y, b);
    // the gap between the two footprints along each axis, in cells: 0 touching, below 0 overlapping
    const gx = Math.max(p - (i + a), i - (p + b)), gy = Math.max(q - (j + a), j - (q + b));
    return gx <= 0 && gy <= 0 && (gx === 0 || gy === 0);
  }

  /** A kissed enemy's move: it walks up to the enemy it goes for and strikes it, or fires at it, as it would at a hero. */
  private charmed(m: Mob) {
    const S = this.S, it = m.intent!, d = MOBS[m.k], o = S.mobs[it.foe!], by = S.heroes.find(h => h.i === m.kiss), far = isRanged(m.k);
    if (!o || o.hp <= 0) return;
    const acc = MOBS[o.k].acc.toLowerCase();
    if (it.t === 'move') {
      if (m.walk) this.note(`${m.name} идёт ${far ? 'стрелять в' : 'бить'} ${acc}`);
      return;
    }
    if (far ? !this.clearShot(m, o) : !this.besideMob(m, o)) {
      this.float(m.x, m.y, far ? 'не видит' : 'не достал', '#c7cbe0');
      this.note(`${m.name} не ${did(d, far ? 'увидел' : 'достал')} ${acc}`);
      return;
    }
    if (far) this.knock(m, m.x, m.y, o.x, o.y, 0.3);
    else this.knock(m, o.x, o.y, m.x, m.y, 0.5);
    m.flash = 0.12;
    const hp = o.hp;
    this.hurtMob(o, it.dmg, '#ff7ab0', false, 0.7, by);
    this.knock(o, o.x, o.y, m.x, m.y, 0.6, 0.05);
    const how = !far ? `${did(d, 'ударил')} ${acc}` : d.charge ? `${did(d, 'бросил')} бомбу в ${acc}` : `${did(d, 'выстрелил')} в ${acc}`;
    this.note(`${m.name} ${how}` + (hp > o.hp ? ` на ${hp - o.hp}` : ', но броня выдержала') + (o.hp <= 0 ? `, ${did(MOBS[o.k], 'пал')}` : ''));
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
    // «Ромашковый чай» in anyone's bag calms the whole room down for a while
    return (this.S.spec.type === 'boss' ? RAGE_FROM_BOSS : RAGE_FROM) + (this.S.heroes.some(h => has(h, 'tea')) ? ART.tea : 0);
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
      if (it && !this.acted(m) && !this.frozen(m) && ((it.t === 'hit' && it.hero === h.i) || it.t === 'slam' || (it.t === 'smash' && this.underHammer(h, it.spots!)))) n += it.dmg;
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
    if (m.hp <= 0 || S.phase === 'over') return null;
    // a coffin's only move is to get up
    if (m.k === 'coffin') return { name: SPECIAL.rise, turns: Math.max(0, (m.rise ?? COFFIN_TURNS) - 1) };
    if (!d.acts && !d.charge) return null;
    // the move picked for this turn, unless it is made already or has come to nothing (the one to heal has fallen)
    if (it && it.t !== 'hit' && it.t !== 'move' && !this.acted(m) && !this.idle(m) && !this.frozen(m)) return { name: specialName(it.t, it.chill), turns: 0 };
    // the headsman's execution is a strike of its own: this turn's counts while it is still to land
    if (it && this.executes(m) && !this.acted(m) && !this.frozen(m)) return { name: SPECIAL.execute, turns: 0 };
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
    const S = this.S, hs = this.alive().filter(h => this.spot(h));
    if (!hs.length) return;
    const taken: { x: number; y: number }[] = [];
    this.liveMobs().forEach((m, i) => {
      const d = MOBS[m.k];
      if (m.k === 'coffin') { m.intent = this.rising(m); return; }
      for (const a of d.acts ?? []) {
        if (S.turn % a.every !== a.at) continue;
        const it = this.special(m, a, hs, taken);
        if (it) { if (it.t === 'slam') it.dmg = this.slamDmg(m, it.chill); m.intent = it; return; }
      }
      if (isRanged(m.k)) { m.intent = this.shoot(m, hs, S.turn + i); return; }
      m.intent = this.goAfter(m, hs);
    });
    this.listen();
  }

  /**
   * A walker picks the hero it goes after: the nearest by its route, or (the headsman) the one with the least health it can
   * reach, the nearer of two as hurt.
   */
  private goAfter(m: Mob, hs: HeroState[]): Intent {
    let best = hs[0], way: Pt[] | null = null, bd = Infinity;
    const hunts = MOBS[m.k].hunts;
    for (const h of hs) {
      const w = this.route(m, this.spot(h)!);
      const sc = !w ? Infinity : hunts ? h.hp * 1000 + w.length : w.length;
      if (sc < bd) { bd = sc; best = h; way = w; }
    }
    return this.chase(m, best, way);
  }

  /** A coffin waits to get up: the enemy turns it still has, counting this one. */
  private rising(m: Mob): Intent {
    return { t: 'rise', hero: -1, dmg: 0, eta: m.rise ?? COFFIN_TURNS };
  }

  /** The headsman's execution is due this turn: its strike lands twice as hard. */
  executes(m: Mob) {
    return !!MOBS[m.k].acts?.some(a => a.k === 'execute' && this.S.turn % a.every === a.at);
  }

  /** A grinder other than this enemy stands close enough to hone its blade: what that adds to its blows. */
  honed(m: Mob) {
    let n = 0;
    for (const o of this.liveMobs()) {
      const hone = MOBS[o.k].hone;
      if (hone && o !== m && Math.hypot(o.x - m.x, o.y - m.y) <= HONE_REACH) n = Math.max(n, Math.round(hone * this.S.dmgMul));
    }
    return n;
  }

  /**
   * What a walker or a shooter deals this turn: a bomber after lighting its fuse twice as much, the headsman's execution
   * twice as much, a grinder's edge and the rage of a long fight on top, and less from the gas.
   */
  private blow(m: Mob) {
    const d = MOBS[m.k], twice = d.charge || this.executes(m);
    return this.cut(m, (twice ? m.dmg * 2 : m.dmg) + this.honed(m) + this.rage());
  }

  /** What the hammer's blow on its square deals: half again a plain strike, rage on top, less from the gas. */
  private smashDmg(m: Mob) {
    return this.cut(m, Math.ceil(m.dmg * SMASH_MUL) + this.honed(m) + this.rage());
  }

  /** The door its holder faces its hero with covers the point (x, y): a disc hitting there does no damage. */
  shielded(m: Mob, x: number, y: number) {
    if (!MOBS[m.k].shield) return false;
    const it = m.intent, h = it && it.hero >= 0 ? this.heroOf(it.hero) : null, p = (h && this.spot(h)) ?? { x: this.S.Wx, y: this.S.Wy };
    const fx = p.x - m.x, fy = p.y - m.y, dx = x - m.x, dy = y - m.y, L = Math.hypot(fx, fy) * Math.hypot(dx, dy);
    return L > 0 && (fx * dx + fy * dy) / L > SHIELD_COS;
  }

  /** The hero standing in a square the hammer is coming down on. */
  private underHammer(h: HeroState, spots: Pt[]) {
    const p = this.spot(h);
    return !!p && spots.some(c => Math.abs(c.x - p.x) <= TILE / 2 && Math.abs(c.y - p.y) <= TILE / 2);
  }

  /** A beaten enemy near an undertaker with room for one more coffin is laid in one: it gets up as itself unless broken. */
  private bury(dead: Mob) {
    const S = this.S, d = MOBS[dead.k];
    if (d.prop || d.boss || mobSize(dead.k) > 1) return;
    const u = this.liveMobs().find(o => {
      const max = MOBS[o.k].coffins;
      if (!max || o === dead || Math.hypot(o.x - dead.x, o.y - dead.y) > COFFIN_REACH) return false;
      const mi = S.mobs.indexOf(o);
      return S.mobs.filter(c => c.k === 'coffin' && c.hp > 0 && c.owner === mi).length < max;
    });
    if (!u) return;
    const c = newMob('coffin', dead.x, dead.y, S.hpMul, S.dmgAdd, S.dmgMul);
    c.owner = S.mobs.indexOf(u); c.born = 1; c.hold = dead.k; c.rise = COFFIN_TURNS;
    c.intent = this.rising(c);
    S.mobs.push(c);
    this.float(u.x, u.y - 12, 'в гроб!', '#b7a07a');
    this.note(`${u.name} ${did(MOBS[u.k], 'уложил')} ${d.acc.toLowerCase()} в гроб`);
  }

  /** What a blow on the whole party deals, a blizzard less: the rage of a long fight on top, less from the gas. */
  private slamDmg(m: Mob, chill?: boolean) {
    return this.cut(m, Math.ceil(m.dmg * (chill ? 0.5 : 0.6)) + this.rage());
  }

  /**
   * A walker going after hero h along `way`: it strikes this turn if its steps take it there, else it closes in.
   * A shooter's way ends where it sees the hero, and it fires on arriving there.
   */
  private chase(m: Mob, h: HeroState, way: Pt[] | null): Intent {
    // walled off from the hero: it stays put
    if (!way) return { t: 'move', hero: h.i, dmg: 0 };
    // a frosted walker covers fewer cells this turn only
    const p = this.spot(h)!, n = way.length - 1, go = wayLen(way.slice(0, this.stopAt(m, way) + 1)), now = this.steps(m);
    const eta = n <= now ? 1 : 1 + Math.ceil((n - now) / stepsOf(m));
    if (!isRanged(m.k)) way.push({ x: p.x, y: p.y });
    return n <= now ? { t: 'hit', hero: h.i, dmg: this.blow(m), way, go, eta: 1 } : { t: 'move', hero: h.i, dmg: 0, way, go, eta };
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
      if (m.kiss !== undefined) { m.intent = this.charm(m); continue; }
      const it = m.intent;
      if (it?.t === 'slam') it.dmg = this.slamDmg(m, it.chill);
      if (!it || it.bang || (it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge')) continue;
      const h = this.heroOf(it.hero), p = this.spot(h);
      if (h.hp <= 0 || !p) continue;
      if (isRanged(m.k)) m.intent = this.shoot(m, it.t === 'charge' ? this.alive().filter(o => this.spot(o)) : [h], 0);
      else if (it.t !== 'charge') m.intent = this.chase(m, h, this.route(m, p));
    }
    // and the firecrackers draw the enemies nearest them afresh, from where everybody stands now
    this.listen();
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
    if (a.k === 'slam') return { t: 'slam', hero: -1, dmg: 0, chill: a.chill };
    // the execution is the strike itself, twice as hard (blow)
    if (a.k === 'execute') return null;
    if (a.k === 'scream') return { t: 'scream', hero: -1, dmg: 0 };
    if (a.k === 'smash') {
      // the square round the hero it would go after: it stays where it is marked, so a throw that lands outside dodges it
      const p = this.spot(this.heroOf(this.goAfter(m, hs).hero)) ?? this.spot(hs[0])!;
      const [ci, cj] = cellAt(p.x, p.y), spots: Pt[] = [];
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (isFloor(S, i, j)) spots.push(cellCentre(i, j));
      return { t: 'smash', hero: -1, dmg: this.smashDmg(m), spots };
    }
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

  /** A trophy has just done its thing: its token by the portrait flashes (the host counts, the snapshots bring the count over). */
  private pop(h: HeroState, k: ArtKey) {
    if (this.send) return;
    (h.pops ??= {})[k] = (h.pops[k] ?? 0) + 1;
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

  /**
   * Damage an enemy; `by` is the hero whose disc (or its lightning, firecracker or light spot) dealt it, for the trophies
   * that pay for kills. A hero's blow on an enemy the ice genius has frosted hits harder (`frostVuln`); fire and gas don't.
   * What it takes, the enemy cuffed to it takes too (`chain`).
   */
  hurtMob(m: Mob, n: number, col = '#fff', pierce = false, p = 0.6, by?: HeroState) {
    if (m.hp <= 0) return;
    // a blow the cuffs pass on is as big as the one they took, frost or not
    if (by && m.frost && !this.linked) { n = Math.ceil(n * (1 + frostVuln(m.frost))); this.burst(m.x, m.y, '#cfefff', 6); }
    if (m.armor && !pierce && n < m.armor) { this.float(m.x, m.y, 'броня', '#c7cbe0'); this.sfx('armor'); return; }
    // the statistics count the health the blow took off, and the blow itself as the record
    if (by) { const t = tallyOf(by); t.dmg += Math.min(n, m.hp); t.top = Math.max(t.top, n); }
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
      if (by) this.killed(m, by);
      // one the bouncer threw down a hole is gone: nobody buries it, no lava spills where it fell
      if (!m.fell) this.bury(m);
      if (d.lava && !m.fell) {
        const S = this.S, i = Math.floor(m.x / TILE), j = Math.floor(m.y / TILE);
        if (isFloor(S, i, j) && this.stands().every(p => Math.hypot(p.x - (i * TILE + 8), p.y - (j * TILE + 8)) > 20)) { S.haz.add(hazKey(i, j)); this.float(m.x, m.y + 4, 'лава!', '#ff7a3d'); }
      }
    }
    this.chain(m, n, p, by);
  }

  /** A hero's disc has felled an enemy: «Клыки» mend the hero, «Копилка» drops ore into the pool. */
  private killed(m: Mob, h: HeroState) {
    const p = this.spot(h);
    tallyOf(h).kills++;
    if (has(h, 'fangs') && h.hp > 0 && h.hp < h.max) {
      const hl = Math.min(ART.fangs, h.max - h.hp);
      h.hp += hl;
      if (p) this.float(p.x, p.y - 4, `+${hl} HP`, '#7be39a');
      this.pop(h, 'fangs');
    }
    if (has(h, 'piggy')) { this.bank.ore++; this.mined++; tallyOf(h).ore++; this.float(m.x, m.y + 8, '+1 руда', '#ffb070'); this.pop(h, 'piggy'); }
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
    const dmg = n - blk, had = h.hp;
    h.hp -= dmg;
    if (dmg > 0) S.hurt = true;
    // «Счастливый носок»: once a room a deadly blow leaves the hero standing on 1
    if (h.hp <= 0 && dmg > 0 && has(h, 'sock') && !h.lucky) { h.hp = 1; h.lucky = true; this.float(p.x, p.y - 14, 'носок спас!', '#ffe27a'); this.pop(h, 'sock'); }
    const t = tallyOf(h);
    t.hurt += Math.min(dmg, had);
    if (h.hp <= 0) t.falls++;
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

  private bodies() { return this.S.discs.filter(d => !d.gone && !d.fall && !d.held); }

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

  /** Ricochet's disc thrown with «Шальной диск»: it rolls over the holes as over the floor the whole way, its sure bounces spent or not. */
  private wild(d: Disc) {
    return d.ab && d.hero.def.key === 'ricochet';
  }

  /** Share of its speed a disc keeps off a wall or a block: all of it while it has sure bounces left (Ricochet's, «Смазка»). */
  private keep(d: Disc) {
    return d.rico > 0 || (d.slick ?? 0) > 0 ? 1 : d.e;
  }

  /**
   * A bounce off a wall or a block at speed v: it clacks, louder the harder. (nx, ny) points from the wall into the room:
   * the cook's disc drops a dish that way, the kid's a firecracker.
   */
  private bounced(d: Disc, v: number, nx: number, ny: number) {
    d.bounces++;
    if (d.rico > 0) d.rico--;
    else if (d.slick) d.slick--;
    if (v > 15) this.sfx('wall', Math.min(1, v / 300));
    this.abBounce(d, nx, ny);
    if (v > 40 && has(d.hero, 'mirrorball') && (d.beams ?? 0) < ART.beamMax) this.beam(d);
  }

  /** «Карманный диско-шар»: a bounce throws a light spot at the nearest enemy within reach, through armour. */
  private beam(d: Disc) {
    let to: Mob | null = null, best = ART.beamReach;
    for (const o of this.S.mobs) {
      const far = Math.hypot(o.x - d.x, o.y - d.y) - o.r;
      if (this.solid(o) && far <= best) { best = far; to = o; }
    }
    if (!to) return;
    d.beams = (d.beams ?? 0) + 1;
    this.pop(d.hero, 'mirrorball');
    this.bolt(d.x, d.y, 3, to.x, to.y, 14, 0.7, true);
    this.hurtMob(to, ART.beamDmg, '#ffe27a', true, 0.4, d.hero);
  }

  /** Which way from a block a disc that has just bounced off it lies: from the block's nearest point to the disc's centre. */
  private boxNormal(d: Disc, b: { x0: number; y0: number; x1: number; y1: number }): [number, number] {
    return [d.x - Math.max(b.x0, Math.min(d.x, b.x1)), d.y - Math.max(b.y0, Math.min(d.y, b.y1))];
  }

  /** How many times harder a hero's disc charged by a clash («Звон») hits: twice, three times with «Бубенцы». */
  private ring(h: HeroState) {
    return has(h, 'bells') ? ART.bells : 2;
  }

  /**
   * «Бумеранг»: once a turn the hero's disc that has come to rest without touching an enemy or a resource goes back into
   * the hand, while the hero is still throwing. It leaves the table; nobody walks over to it.
   */
  private boomerang(d: Disc) {
    const h = d.hero;
    if (!has(h, 'boomerang') || d.fan || d.back || d.hits || d.gone || d.fall || this.S.phase !== 'throw' || h.hp <= 0 || h.boomed === this.S.turn) return false;
    if (Math.hypot(d.vx, d.vy) >= 2 || this.ended(h)) return false;
    d.back = true;
    d.gone = true;
    d.vx = d.vy = 0;
    h.hand++;
    h.boomed = this.S.turn;
    this.pop(h, 'boomerang');
    this.float(d.x, d.y, 'вернулся!', '#ffe27a');
    this.burst(d.x, d.y, h.def.col, 8);
    return true;
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
      // a disc with sure bounces left rolls on without slowing, and even a soft throw goes at a good clip
      this.glide(d, dt);
      const v0 = Math.hypot(d.vx, d.vy);
      if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * this.keep(d); this.bounced(d, v0, 1, 0); }
      if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * this.keep(d); this.bounced(d, v0, 0, 1); }
      if (d.x > S.Wx - d.r) { d.x = S.Wx - d.r; d.vx = -d.vx * this.keep(d); this.bounced(d, v0, -1, 0); }
      if (d.y > S.Wy - d.r) { d.y = S.Wy - d.r; d.vy = -d.vy * this.keep(d); this.bounced(d, v0, 0, -1); }
      // «Надувные труселя»: the disc floats over the holes and never drops in; so does Ricochet's with his ability on
      const pit = pitAt(S.pits, d.x, d.y), wild = this.wild(d);
      if (pit && !wild && !d.floated && !d.fan && has(d.hero, 'undies')) { d.floated = true; this.pop(d.hero, 'undies'); }
      if (!wild && !has(d.hero, 'undies') && pit) {
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
        // a dish, a firecracker or the gas comes off a resource as off an enemy, soft touch or not
        if (vn > 5) this.abBounce(d, d.x - n.x, d.y - n.y);
        if (vn <= 30) continue;
        d.hits++;
        // even Ricochet's ability doesn't carry a disc on through a resource
        d.rico = 0;
        const big = Math.ceil((d.m * vn) / 120) >= 4, h = d.hero, q = big ? 2 : 1;
        n.hit = 0.2;
        // «Золотая челюсть» bites the whole vein out at once, takes as much of the crystal as everyone has room for,
        // and eats as many mushrooms as it takes to heal up (one at the least)
        const all = has(h, 'denture');
        if (all) this.pop(h, 'denture');
        if (n.k === 'ore') { const k = all ? n.left : 1, got = q * k; n.left -= k; this.bank.ore += got; this.mined += got; tallyOf(h).ore += got; this.float(n.x, n.y, `+${got} руда`, '#ffb070'); }
        // sparks go to every hero still standing, whoever threw the disc, each up to what one ability costs; the crystal
        // loses only what was taken, so sparks nobody had room for stay in it for later
        if (n.k === 'spk') {
          const live = this.alive();
          let got = 0;
          for (const o of live) { const k = Math.min(all ? AB_COST : q, n.left, AB_COST - o.sparks); o.sparks += k; got = Math.max(got, k); }
          n.left -= got;
          this.float(n.x, n.y, got ? `+${got} искр${got > 1 ? 'ы' : 'а'}${live.length > 1 ? ' всем' : ''}` : 'искры полны', '#c9a8ff');
        }
        if (n.k === 'herb') {
          const each = 1 + 2 * q, k = all ? Math.max(1, Math.min(n.left, Math.ceil((h.max - h.hp) / each))) : 1, hl = Math.min(h.max - h.hp, each * k);
          n.left -= k;
          h.hp += hl;
          this.float(n.x, n.y, hl ? `+${hl} HP` : 'HP полное', '#7be39a');
        }
        this.chips(n.k, n.x, n.y, n.r, d, q);
        this.sfx(n.k === 'spk' ? 'sparks' : n.k);
        if (n.left <= 0) this.float(n.x, n.y - 6, 'истощено', '#c7cbe0');
        changed = true;
      }
      for (const m of S.mobs) {
        if (!this.solid(m)) continue;
        const h = d.hero, v = Math.hypot(d.vx, d.vy), vn = this.bounceStatic(d, m, d.rico > 0 ? 1 : has(h, 'insoles') ? ART.insolesE : MOB_E);
        if (vn <= 5) continue;
        if (d.rico <= 0 && has(h, 'insoles')) this.pop(h, 'insoles');
        if (d.rico > 0) d.rico--;
        let dmg = Math.ceil((d.m * vn) / 120);
        // straight from the rune into the enemy, square on: a precise throw hits much harder («Бильярдный мел»: off the walls too)
        const crit = (d.bounces === 0 || has(h, 'chalk')) && d.hits === 0 && vn >= v * CRIT_COS;
        d.hits++;
        if (crit) dmg = Math.ceil(dmg * (has(h, 'glasseye') ? ART.critBig : CRIT));
        if (crit && has(h, 'glasseye')) this.pop(h, 'glasseye');
        if (crit && d.bounces > 0 && has(h, 'chalk')) this.pop(h, 'chalk');
        if (h.def.key === 'ricochet') dmg += Math.min(d.bounces, 4);
        // «Скрипучая пружина»: every bounce on the way adds a point, Ricochet's own on top
        if (has(h, 'spring') && d.bounces > 0) { dmg += Math.min(d.bounces, ART.springMax); this.pop(h, 'spring'); }
        if (d.charged) { dmg *= this.ring(h); d.charged = false; }
        if (has(h, 'opener') && m.armor && dmg < m.armor && m.hp > 0) this.pop(h, 'opener');
        const t = tallyOf(h);
        if (crit && m.hp > 0) { this.float(m.x, m.y - 24, 'ТОЧНО!', '#ffe27a'); this.sfx('crit'); t.crits++; }
        t.rico = Math.max(t.rico, d.bounces);
        // the ability goes first: fire on an enemy this very hit kills leaps on to the next one
        if (d.ab) this.abilityHit(d, m);
        // the guard's door takes a disc from the front: it bounces off and wounds nobody
        if (this.shielded(m, d.x, d.y)) { this.float(m.x, m.y - 14, 'дверь!', '#c7cbe0'); this.sfx('armor'); }
        else this.hurtMob(m, dmg, '#fff', has(h, 'opener'), Math.min(1, vn / 250), h);
        if (d.ab && h.def.key === 'electra') this.zap(m, h);
        if (d.ab && h.def.key === 'genius') this.freeze(m);
        if (d.ab && h.def.key === 'bouncer') this.shove(d, m);
        if (d.ab && h.def.key === 'model') this.kiss(m, h);
        this.burst(d.x, d.y, d.hero.def.col, 8);
        // the figure rocks away from the disc, a big one less; a sure hit or a kill shakes the table
        this.knock(m, m.x, m.y, d.x, d.y, Math.min(1, 0.3 + vn / 260) * Math.min(1, (7 / m.r) ** 0.6));
        if (crit || m.hp <= 0) this.tremor(m.x, m.y, crit ? 0.6 : 0.45, m);
        changed = true;
      }
      if (this.boomerang(d)) changed = true;
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
      // "Звон": discs of two different heroes collide hard, both deal double on their next hit; with «Бубенцы» a hero's
      // own discs ring off each other too, and its discs deal triple
      if (-rv > 40 && (a.hero !== b.hero || has(a.hero, 'bells'))) {
        a.charged = b.charged = true;
        for (const o of new Set([a.hero, b.hero])) if (has(o, 'bells')) this.pop(o, 'bells');
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ka = this.ring(a.hero), kb = this.ring(b.hero);
        this.float(mx, my, ka === kb ? `ЗВОН ×${ka}` : `ЗВОН ×${Math.min(ka, kb)}/×${Math.max(ka, kb)}`, '#b893ff');
        this.burst(mx, my, '#b893ff', 10);
        this.sfx('clink', Math.min(1, -rv / 300));
      } else if (-rv > 15) this.sfx('wall', Math.min(1, -rv / 400));
      // the kid's firecrackers come off another disc as off a wall
      if (-rv > 15) { this.kidBounce(a, -nx, -ny); this.kidBounce(b, nx, ny); }
    }
    for (const f of S.food) if (f.t < FOOD_FLY) f.t = Math.min(FOOD_FLY, f.t + dt);
    let landed = false;
    for (const b of S.bombs) if (b.t < FOOD_FLY) { b.t = Math.min(FOOD_FLY, b.t + dt); landed ||= b.t >= FOOD_FLY; }
    // a firecracker down on the floor starts crackling: the enemies nearest it turn to the noise
    if (landed && S.phase !== 'enemy') { this.listen(); changed = true; }
    if (S.bombs.length) this.fuse();
    for (let k = born; k < S.sparks.length; k++) S.sparks[k].b = this.tick;
    this.inStep = false;
    this.heard = Math.max(this.heard, this.tick);
    if (changed) this.onChange();
  }

  moving() {
    return this.bodies().some(d => Math.hypot(d.vx, d.vy) > 2) || this.S.discs.some(d => d.fall && !d.gone);
  }

  /** Some hero is hopping over to its last disc. */
  hopping() {
    return this.S.heroes.some(h => h.from);
  }

  /**
   * Alone with a party (the campaign of two or three): once the selected hero has thrown its last disc of the turn and it
   * has stopped, the next hero in the party with discs in hand is picked, so the player throws on without a tap. Only right
   * after that throw: a hero the player picks afterwards stays picked.
   */
  private passOn() {
    const h = this.hero;
    if (this.online || this.passing !== h.i || this.waits(h)) return;
    this.passing = -1;
    const k = this.party.indexOf(h), order = [...this.party.slice(k + 1), ...this.party.slice(0, k + 1)];
    const next = order.find(o => o.hp > 0 && o.hand > 0 && !this.ended(o) && this.canControl(o));
    if (next) { this.act = next.i; this.onChange(); }
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
    this.follow();
    this.rechase();
  }

  /**
   * A disc of the hero's has come to rest: a miss says so, and spikes or lava under it hurt the hero who threw it.
   * A phantom of the card sharp's fan, a disc in a hole and a fallen hero's go unremarked.
   */
  private land(d: Disc) {
    const S = this.S;
    if (d.fall || d.fan || d.hero.hp <= 0) return;
    if (!d.hits) this.float(d.x, d.y, 'мимо', '#c7cbe0');
    // «Надувные труселя»: spikes and lava under the disc don't hurt
    if (!S.haz.has(hazKey(Math.floor(d.x / 16), Math.floor(d.y / 16)))) return;
    if (has(d.hero, 'undies')) this.pop(d.hero, 'undies');
    else {
      this.float(d.x, d.y, S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
      this.hurtHero(d.hero, S.biome.hazDmg);
    }
  }

  /**
   * Host: the heroes' turn is over. Every disc still on the table comes to rest where it lies, and each hero goes over to
   * the last disc it threw this turn; its earlier ones are cleared away. A hero whose last disc dropped into a hole stays
   * where it stood.
   */
  private follow() {
    const S = this.S, movers: [HeroState, Disc][] = [];
    for (const d of S.discs) d.vx = d.vy = 0;
    for (const h of S.heroes) {
      if (h.hp <= 0 || !this.spot(h)) continue;
      // a miss «Бумеранг» brought back is in the hand, and the card sharp goes after the disc he aimed, not a phantom
      const mine = S.discs.filter(d => d.hero === h && !d.back && !d.fan), last = mine[mine.length - 1];
      if (!last) continue;
      for (const d of mine) {
        if (d.gone || d.held) continue;
        d.held = true;
        this.land(d);
        // the earlier discs nobody goes over to are cleared away
        if (d !== last && !d.fall) d.gone = true;
      }
      if (!last.fall) movers.push([h, last]);
    }
    if (movers.length) this.regroup(movers);
  }

  /**
   * Heroes go over to where their last discs stopped: to the cell holding most of the disc, or, when that cell is taken,
   * the one holding the next most of it, else the free cell nearest the disc. When two heroes are after one cell, it goes
   * to the one whose disc covers more of it. Every other hero keeps the cell it stands on.
   */
  private regroup(movers: [HeroState, Disc][]) {
    const S = this.S, gw = S.gw, taken = this.occupied(null, true);
    const moving = new Set(movers.map(([h]) => h));
    for (const h of S.heroes) {
      const p = this.spot(h);
      // the others keep their cells, and a fallen hero lies where it fell
      if (p && !moving.has(h)) taken[Math.floor(p.y / TILE) * gw + Math.floor(p.x / TILE)] = 1;
    }
    const free = (i: number, j: number) => isFloor(S, i, j) && !taken[j * gw + i];
    const put = (h: HeroState, i: number, j: number, d: Disc) => {
      taken[j * gw + i] = 1;
      const to = cellCentre(i, j), now = this.figureAt(h)!;
      h.at = to;
      if (now.x !== to.x || now.y !== to.y) { h.from = { x: now.x, y: now.y }; h.leap = 0; }
      // the disc stopped right under the hero: it picks it up where it stands
      else d.gone = true;
    };
    const nearest = (h: HeroState, x: number, y: number, d: Disc) => {
      let best: [number, number] | null = null, bd = Infinity;
      for (let j = 0; j < S.gh; j++) for (let i = 0; i < gw; i++) {
        const c = cellCentre(i, j), far = Math.hypot(c.x - x, c.y - y);
        if (far < bd && free(i, j)) { bd = far; best = [i, j]; }
      }
      if (best) put(h, ...best, d);
    };
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
      const burnt = m.burn > 0, gassed = this.inGas(m);
      // fire takes as many HP as it has, through armour, and dies down by one
      if (burnt) {
        const fire = m.burn--;
        this.hurtMob(m, fire, '#ff7a3d', true);
        this.note(`${m.name} горит: −${fire}`);
        if (m.hp <= 0) this.note(`${m.name} ${did(MOBS[m.k], 'сгорел')}`);
      }
      // the gas it starts its move in chokes it, through armour too
      if (gassed && m.hp > 0) {
        const gas = gasDmg(m.max);
        this.hurtMob(m, gas, '#b9e34f', true);
        this.note(`${m.name} дышит газом: −${gas}`);
        if (m.hp <= 0) this.note(`${m.name} ${did(MOBS[m.k], 'задохнулся', 'задохнулась')}`);
      }
      // kissed, it looks for the nearest other enemy as its move begins: the ones before it have moved, some have fallen
      if (m.kiss !== undefined && m.hp > 0) m.intent = this.charm(m);
      this.planWalk(m);
      if (burnt || gassed || (m.hp > 0 && !this.idle(m))) return true;
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
    const foe = it?.foe !== undefined ? this.S.mobs[it.foe] : null;
    if (m.hp <= 0 || !it || (it.hero < 0 && !foe) || m.speed === 0 || this.frozen(m)) return;
    // one drawn by a firecracker runs to where it crackled, even when another enemy has set it off on the way; a kissed one
    // goes for the other enemy, a shooter only till it sees it
    const h = this.heroOf(it.hero), p = foe ?? it.bang ?? this.spot(h), aim = !it.bang && isRanged(m.k);
    if (!p || (foe ? foe.hp <= 0 || (aim && this.clearShot(m, foe)) : !it.bang && (h.hp <= 0 || (aim && this.sees(m, h))))) return;
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
    // frozen stiff, it still takes its turn to stand there; kissed with nobody to go for, to sigh
    if (this.frozen(m) || it.sigh) return false;
    if (it.foe !== undefined) { const o = this.S.mobs[it.foe]; return !o || o.hp <= 0 || (it.t === 'move' && !m.walk); }
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
    let k = Math.min(cells.length - 1, this.steps(m));
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
    if (this.frozen(m)) {
      this.float(m.x, m.y - 10, 'заморожен', '#bdf2ff');
      this.sfx('ice');
      this.note(`${m.name} ${did(d, 'заморожен')} и пропускает ход`);
      return;
    }
    if (it.t === 'rise') {
      m.rise = (m.rise ?? COFFIN_TURNS) - 1;
      if (m.rise > 0) {
        this.float(m.x, m.y - 10, 'скрип…', '#b7a07a');
        this.note(`В гробу ворочается ${MOBS[m.hold!].name.toLowerCase()}`);
        m.intent = this.rising(m);
        return;
      }
      // the lid flies off: the enemy in it stands up whole, in the coffin's place in the order
      const o = newMob(m.hold!, m.x, m.y, S.hpMul, S.dmgAdd, S.dmgMul);
      Object.assign(m, o, { owner: m.owner, born: 1, intent: null, hold: undefined, rise: undefined });
      this.burst(m.x, m.y, '#b7a07a', 16);
      this.sfx('ability');
      this.float(m.x, m.y - 12, 'встал из гроба!', '#c9a8ff');
      this.note(`${m.name} ${did(MOBS[m.k], 'встал', 'встала')} из гроба`);
    } else if (it.t === 'scream') {
      m.flash = 0.12; S.shake = 0.2;
      this.sfx('slam');
      this.float(m.x, m.y - 10, 'ВИЗГ', '#bfe6ff');
      this.note(`${m.name} ${did(d, 'завизжал')}: у отряда звенит в ушах, линии прицела нет`);
      for (const h of this.alive()) this.dazeHero(h);
    } else if (it.t === 'smash') {
      m.flash = 0.12; S.shake = 0.35;
      this.sfx('slam');
      this.float(m.x, m.y - 10, 'МОЛОТ!', '#ff7a3d');
      const hit = this.alive().filter(h => this.underHammer(h, it.spots!));
      for (const p of it.spots!) this.burst(p.x, p.y, '#ff7a3d', 4);
      if (!hit.length) this.note(`${m.name} ${did(d, 'ударил')} молотом мимо`);
      for (const h of hit) {
        const blk = this.hurtHero(h, it.dmg, '', m);
        this.noteBlow(`${m.name} ${did(d, 'ударил')} молотом ${h.def.acc} на ${it.dmg}`, h, blk);
      }
      this.tremor(m.x, m.y, 1, m);
    } else if (it.t === 'slam') {
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
    } else if (it.sigh) {
      const by = S.heroes.find(h => h.i === m.kiss);
      this.float(m.x, m.y - 10, 'вздыхает…', '#ff9ab8');
      this.note(`${m.name} вздыхает${by ? ' по ' + by.def.dat : ''} и никого не бьёт`);
    } else if (it.foe !== undefined) {
      this.charmed(m);
    } else if (it.t === 'move') {
      // walled off, it stayed put: nothing to tell
      if (m.walk) this.note(it.bang ? `${m.name} ${did(d, 'побежал', 'побежала')} на треск петарды` : `${m.name} идёт к ${this.heroOf(it.hero).def.dat}`);
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
        // «Ёж в штанах» pricks whoever strikes up close
        if (!isRanged(m.k) && has(h, 'hedgehog')) {
          this.float(m.x, m.y - 12, 'ёж!', '#c9a86a');
          this.pop(h, 'hedgehog');
          this.hurtMob(m, ART.hedgehog, '#c9a86a', true, 0.5);
          this.note(`Ёж уколол ${d.acc} на ${ART.hedgehog}` + (m.hp <= 0 ? `, ${did(d, 'пал')}` : ''));
        }
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

  /** A scream rings in the hero's ears through its next turn: it throws without the aiming line, as under «Стробоскоп». */
  private dazeHero(h: HeroState) {
    if (h.hp <= 0) return;
    h.daze = 2;
    const p = this.spot(h);
    if (p) this.float(p.x, p.y - 8, 'звон в ушах', '#e8d6ff');
  }

  private nextTurn() {
    const S = this.S;
    // the ore cave also ends once its turns are up
    if (!this.alive().length || this.cleared() || (this.turnsMax() && S.turn >= this.turnsMax())) { this.finish(); return; }
    S.turn++;
    S.discs = [];
    S.done = [];
    this.passing = -1;
    // the frost wears off after one enemy turn, a cloud of gas thins out turn by turn, a firecracker nobody came to fizzles out
    for (const m of S.mobs) { delete m.frost; delete m.kiss; }
    // the cuffs hold for their turns, the cop cuffs anew next turn
    if (S.cuffs && --S.cuffs.left <= 0) S.cuffs = null;
    S.gas = S.gas.filter(g => --g.left > 0);
    for (const b of S.bombs) if (--b.left <= 0) { this.float(b.x, b.y - 10, 'пшик', '#c9c2b4'); this.burst(b.x, b.y, '#9a948a', 8); }
    S.bombs = S.bombs.filter(b => b.left > 0);
    for (const h of S.heroes) if (h.hp > 0 && has(h, 'cup')) this.pop(h, 'cup');
    for (const h of S.heroes) { delete h.cuffing; h.shield = h.hp > 0 && has(h, 'cup') ? ART.cup : 0; h.thrown = false; h.boost = false; h.hand = h.hp > 0 ? this.handOf(h) : 0; if (h.chill > 0) h.chill--; if (h.daze > 0) h.daze--; }
    S.phase = 'throw';
    this.sfx('yourTurn');
    this.pickActive();
    this.pickIntents();
    if (this.rage() > 0) { this.float(S.Wx / 2, S.Wy / 2, `ВРАГИ ЗВЕРЕЮТ +${this.rage()}`, '#ff4d6a'); S.shake = Math.max(S.shake, 0.15); }
    this.onChange();
  }

  private finish() {
    const S = this.S, win = this.alive().length > 0;
    S.phase = 'over';
    if (win && S.spec.type === 'boss') this.bossHeal();
    // a fight won without a scratch pays ore for every hero; the ore cave has nobody to scratch them
    if (win && S.spec.type !== 'treasure' && !S.hurt) {
      this.clean = CLEAN_ORE * this.party.length;
      this.bank.ore += this.clean;
      this.float(S.Wx / 2, S.Wy / 2, `БЕЗ ЦАРАПИНЫ +${this.clean}`, '#ffd34d');
    }
    this.sfx(win ? 'win' : 'lose');
    this.onChange();
    this.onRoomEnd(win);
  }

  /** The floor's boss is beaten: every hero gets back half their most health, up to the top, and the fallen get up with half. */
  private bossHeal() {
    for (const h of this.S.heroes) {
      const was = Math.max(0, h.hp), hl = Math.min(h.max - was, Math.ceil(h.max * BOSS_HEAL));
      if (hl <= 0) continue;
      h.hp = was + hl;
      const p = this.figureAt(h);
      if (p) { this.float(p.x, p.y - 6, `+${hl} HP`, '#7be39a'); this.burst(p.x, p.y, '#7be39a', 10); }
    }
  }

  update(dt: number) {
    const S = this.S;
    if (this.send) { this.updateRemote(dt); return; }
    this.acc += dt;
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
    // alone with a party, the next hero with discs takes over once the last disc of the one in hand has stopped
    if (S.phase === 'throw') this.passOn();
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
      if (m.slid && (m.slid.t += dt / SLIDE_T) >= 1) m.slid = undefined;
      if (m.fell) m.fell += dt;
    }
    for (const h of S.heroes) {
      if (h.flash > 0) h.flash -= dt;
      if (h.knock && (h.knock.t += dt) > KNOCK_T) h.knock = undefined;
      if (h.from && (h.leap += dt / HOP_T) >= 1) {
        // one knock on the board a hop, however the snapshots set the hop back
        const hop = `${S.turn}:${h.from.x},${h.from.y}:${h.at?.x},${h.at?.y}`;
        if (this.hopped.get(h.i) !== hop) { this.hopped.set(h.i, hop); this.onSound('step', 0.9); }
        h.from = null;
        h.leap = 0;
        // landed on its disc: it picks the disc up
        for (const d of S.discs) if (d.hero === h && d.held && !d.fall) d.gone = true;
        this.onChange();
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
    for (const g of S.gas) g.t += dt;
    S.zaps = S.zaps.filter(z => z.t < ZAP_T);
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter(f => f.t < 1.6);
  }
}
