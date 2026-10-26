// Combat rules: turn flow, disc physics, damage, abilities.
// Rendering and input live elsewhere; this module only changes state.

import { AB_BOUNCES, AB_BURN, AB_COST, AB_SHIELD, AB_SPEED, BOSS_HEAL, CLEAN_ORE, CRIT, CRIT_COS, CUFF_TURNS, E_MAX, ELITE_UPS, FAN_ANGLE, FAN_M, FAN_R, FOOD_HEAL, FOOD_MAX, FOOD_PER_DISC, FROST_STEPS, GAS_MAX, GAS_R, GAS_TURNS, GAS_WEAK, HAND_COST, HAND_MAX, HAND_START, HEROES, KISS_TURNS, MOBS, MOB_E, NODE_E, PETARD_DMG, PETARD_LURE, PETARD_TURNS, RAGE_FROM, RAGE_FROM_BOSS, RISE_HP, SHOVE_DMG, TILE, UP_COST, ZAP, ZAP_REACH, frostVuln, gasDmg, isRanged, mobSize, stepOf, type HeroDef, type MobAct, type MobKind, type StatKey } from './data';
import { KNOCK_T, type ChipKind, type Knock } from './fx';
import { mulberry32 } from './rng';
import { has, type ArtKey, type Kept } from './artifacts';
import type { Sfx } from './audio/sfx';
import { TRINKET_R } from './trinkets';
import { BET_TURNS, FLOOR_FR, settleBet, type Bet, type Floor } from './events';
import { CASTS, caveTurns, cellAt, cellCentre, clearLine, fireCells, generate, hazKey, ICICLE_HP, inPit, isFloor, mobDmg, muAt, newMob, partyScale, pitAt, standing, stops, volBlow, type Intent, type Layout, type Mob, type RoomSpec, type Zone } from './room';
import { VOL, loud } from './volume';
import { M } from './i18n';
import type { StandMat } from './stands';

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
  /** Where the hero stands once the throws have moved it off its rune: the cell where its last disc on the floor stopped. */
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
  /** Burning: takes 2 damage at the start of each enemy turn while this lasts. */
  fire: number;
  /** Turns left frozen to its cell by the fridge's freezer: it throws, but doesn't go over to its discs. */
  pin?: number;
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
  /** The trinkets it has picked up this run, by key (src/trinkets.ts): the host lists them, every screen opens its own heroes' lines. */
  found?: string[];
  /** What the hero has done this run, for the player's statistics; saves from before them have none. */
  tally?: Tally;
  /** Stat levels an elite owes the hero: the next one costs no ore (the sharpening window right after it, or the next blacksmith's). */
  free?: number;
  /** The cop's «Наручники»: the enemies (by index) his discs have hit this turn, the first two; the second hit cuffs them. */
  cuffing?: number[];
  /** Online: the boss's trophies kept for the hero while its player was away at the share-out, to pick one from once back. */
  kept?: Kept | null;
  /** What the hero's stand is made of: its player's pick of the ones their wins with it have earned (src/stands.ts); plain painted plastic when not given. */
  stand?: StandMat;
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
  /** Since the trophies' feats (src/progress.ts): bounces off walls and blocks, discs dropped into holes, «Звон» rung. */
  walls: number;
  holes: number;
  clangs: number;
  /** The most enemies one disc hit, and the latest turn a fight was won on. */
  multi: number;
  late: number;
}

export const newTally = (run = 0): Tally => ({ run, dmg: 0, top: 0, kills: 0, throws: 0, crits: 0, abs: 0, ore: 0, hurt: 0, falls: 0, rico: 0, walls: 0, holes: 0, clangs: 0, multi: 0, late: 0 });
/** A hero's tally, the counts a save from before them lacks put in at 0. */
const tallyOf = (h: HeroState) => {
  const t = (h.tally ??= newTally());
  if (t.walls === undefined) Object.assign(t, { ...newTally(t.run), ...t });
  return t;
};

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
  /** The enemies it hit, by their place in the room's list: one counts once. */
  foes?: number[];
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
  /** The dragon has belched the room full of smoke: it hangs there through the heroes' next turn, clear only round them. */
  smog?: boolean;
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
const SPECIAL = {
  summon: 'призыв', heal: 'лечение', heat: 'жар', charge: 'фитиль', execute: 'казнь', scream: 'визг', smash: 'удар молотом', rise: 'подъём',
  dive: 'в нору', emerge: 'из норы', brew: 'подогрев', cone: 'морозилка', dance: 'танцпол', lights: 'светомузыка', roll: 'каток', belch: 'отрыжка',
  toss: 'закусь', hatch: 'вылупление', crown: 'корона', wall: 'ледяная стена', draft: 'сквозняк', cast: 'литьё',
};
/** What the HUD calls a floor boss's marked cells, by what they do. */
const ZONE_NAME: Record<Zone, string> = {
  cold: 'морозилка', dance: 'танцпол', beam: 'светомузыка', roll: 'каток', fire: 'отрыжка', crown: 'корона', wall: 'ледяная стена', draft: 'сквозняк', cast: 'литьё',
};
const specialName = (k: keyof typeof SPECIAL | 'slam' | 'zone', chill?: boolean, z?: Zone) =>
  k === 'slam' ? (chill ? 'метель' : 'удар по всем') : k === 'zone' ? ZONE_NAME[z ?? 'cold'] : SPECIAL[k];
/** The cry over a floor boss as its marked cells go off, and the colour of the cells. */
export const ZONE_CRY: Record<Zone, string> = {
  cold: 'МОРОЗИЛКА!', dance: 'БИТ!', beam: 'СВЕТОМУЗЫКА!', roll: 'КАТИТСЯ!', fire: 'ОТРЫЖКА!', crown: 'КОРОНА!', wall: 'ЛЕДЯНАЯ СТЕНА!', draft: 'СКВОЗНЯК!', cast: 'ЛИТЬЁ!',
};
export const ZONE_COL: Record<Zone | 'bite', string> = {
  bite: '#ff3a2a', cold: '#7fd8ff', dance: '#ff5ad1', beam: '#ffe27a', roll: '#ff9a3a', fire: '#ff6a1a', crown: '#ffd34d', wall: '#4a86ff', draft: '#3ddc84', cast: '#ff8a2a',
};
/** The cry over a floor boss as it turns into its next phase. */
const PHASE_CRY: Partial<Record<MobKind, string>> = { ratswarm2: 'свора редеет!', ratswarm3: 'разбегаются!', pahan2: 'БЕСПРЕДЕЛ!', dancer2: 'ЛИХОРАДКА!', discoball2: 'сорвался!', dragon2: 'слез с яиц!' };
/** How the journal tells a shooter's shot when it isn't an arrow: Пахан's shiv, the dancer's record, the disco ball's beam. */
const SHOT: Partial<Record<MobKind, string>> = { pahan: '{0} метнул заточку в {1}', dancer: '{0} запустил пластинкой в {1}', dancer2: '{0} запустил пластинкой в {1}', discoball: '{0} ударил лучом в {1}', discoball2: '{0} ударил лучом в {1}', dummy_boxer: '{0} выбросил кулак на пружине в {1}' };

/**
 * The fridge's snacks («Закусь»), by `Intent.item`: what it throws, the share of its blow each deals, and what else it does:
 * the frozen chicken chills, the boxers land on the hero's head and hide the aiming line.
 */
export const FOOD_TOSS: { name: string; acc: string; k: number; chill?: boolean; daze?: boolean }[] = [
  { name: 'огурцы', acc: 'банку огурцов', k: 0.5 },
  { name: 'курица', acc: 'мороженую курицу', k: 0.625, chill: true },
  { name: 'семейники', acc: 'семейники в сердечки', k: 0, daze: true },
];
/** A disc into the hole where the rat swarm's eyes glow, or into the fridge's open door, hits this many times as hard. */
export const WEAK_MUL = 2;
/** The fridge's door is open to discs this far round from the way it faces (cosine: ±60°). */
const FRIDGE_COS = 0.5;
/** The dragon goes after whoever broke its egg this fast. */
const MAD_SPEED = 32;
/** The disco ball's shards lie this many cells round it at most. */
const SHARD_REACH = 2;

/** The coffin a beaten enemy is laid in gets up as that enemy after this many enemy turns, unless broken. */
export const COFFIN_TURNS = 2;
/** The undertaker reaches enemies that fall this close to it (in world units: five cells). */
export const COFFIN_REACH = 5 * TILE;
/** The grinder hones enemies this close to it (two cells). */
export const HONE_REACH = 2 * TILE + 4;
/** The door shield covers this much on each side of the way its holder faces (cosine of the half angle: ±45°). */
export const SHIELD_COS = 0.7;
/** A disc into the door still wounds its holder by this share of the blow (rounded up, a point at the least). */
export const DOOR_MUL = 0.5;
/** The hammer's blow on its square hits this much harder than a plain strike. */
export const SMASH_MUL = 1.5;
/** The fridge's draft: how far out it reaches (cells, kingwise from the fridge) and how many cells it pulls a hero over. */
export const DRAFT = { reach: 6, pull: 2 };

type Pt = { x: number; y: number };

/**
 * The trophies' numbers (src/artifacts.ts). «Поднос» widens the disc, «Полироль» cuts its friction, «Смазка» spares it the
 * speed of its first bounces, «Стельки» keep more of its speed off an enemy, «Пружина» adds a point a bounce, «Диско-шар»
 * throws a light spot off a bounce at the nearest enemy, «Ракушка» shields every turn, «Ёж» pricks back, «Клыки» heal
 * a kill, «Чай» puts the rage off, «Энергетик» makes the ability cheaper, «Рентген» shows the bounces.
 */
/** The foam party's slick discs keep their speed off every wall: as many sure bounces as no throw ever takes. */
const SLICK_ALL = 99;

export const ART = {
  trayR: 1.33, polishFr: 0.67, slick: 2, insolesE: 0.75, springMax: 4, beamDmg: 1, beamReach: 5 * TILE, beamMax: 3,
  cup: 3, hedgehog: 3, fangs: 2, tea: 3, energyCost: 2, xrayBounces: 3, critBig: 2, bells: 3,
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
 * floor, a `strobe` that hides the aiming line, a `ground` from the foam party, one `extra` disc a turn; and the bookie's `bet`,
 * which waits for a fight (the ore cave has nobody to fight).
 */
export interface Bank {
  ore: number; boon?: number; shield?: number; rage?: number; smoke?: boolean; strobe?: boolean;
  /** The next fight's floor, its bet and one disc a turn more in it: they go with the room's spec too. */
  ground?: Floor; bet?: Bet; extra?: number;
  /** The run's «Громкость» step (src/volume.ts), for the whole run: every room's spec carries it, the blacksmith and the camp read it. */
  vol?: number;
}

/** The party's pool for a new run at «Громкость» step `vol`. */
export function newBank(vol = 0): Bank {
  return { ore: 0, boon: 0, vol };
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
  /** Host: how the bookie's bet came out in this room, a line for the room's result; empty without one. */
  betLine = '';
  /** Host: each hero's health as the floor's boss fell, before it gave half back: the run's album shows them beaten so. */
  wounds: { i: number; hp: number; max: number }[] | null = null;
  /** A blow in the warm-up room that would have laid the hero down left it standing: the hero says so (tutor.ts). */
  spared = false;
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
    if (this.bank.ground) spec.ground = this.bank.ground;
    if (this.bank.extra) spec.extra = this.bank.extra;
    if (this.bank.vol) spec.vol = this.bank.vol;
    const bet = this.bank.bet && spec.type !== 'treasure' && !spec.tut ? this.bank.bet : undefined;
    if (bet) spec.bet = bet;
    const L = generate(spec);
    this.forge = 0;
    this.whet = false;
    this.mined = 0;
    this.clean = 0;
    this.betLine = '';
    this.walked = { key: '', n: 0 };
    this.hopped.clear();
    this.passing = -1;
    // sparks carry over from the last room, and the altar fills them up
    const boon = Math.min(AB_COST, this.bank.boon ?? 0), shield = this.bank.shield ?? 0;
    for (const h of this.party) {
      // a hero who fell in the last room gets up for this one, barely: the others won that room, or there'd be no next one
      if (h.hp <= 0) h.hp = RISE_HP;
      // «Батарейка» fills the sparks at the start of every fight, «Ракушка» shields from the first blow on
      const full = has(h, 'battery') ? AB_COST : boon, cup = has(h, 'cup') ? ART.cup : 0;
      if (h.hp > 0 && full > boon && h.sparks < AB_COST) this.pop(h, 'battery');
      if (h.hp > 0 && cup) this.pop(h, 'cup');
      Object.assign(h, {
        pad: null, at: null, from: null, leap: 0, hand: h.hp > 0 ? this.handOf(h, spec) : 0, thrown: false, shield: h.hp > 0 ? shield + cup : 0, flash: 0, chill: 0, daze: 0, fire: 0,
        boost: false, sparks: Math.min(AB_COST, Math.max(h.sparks, full)), boomed: 0, lucky: false,
      });
      delete h.cuffing;
      delete h.pin;
    }
    // an event's curse: the room's enemies come in angrier
    if (this.bank.rage) for (const m of L.mobs) m.dmg += this.bank.rage;
    this.bank.boon = 0;
    delete this.bank.shield;
    delete this.bank.rage;
    delete this.bank.smoke;
    delete this.bank.strobe;
    delete this.bank.ground;
    delete this.bank.extra;
    if (bet) delete this.bank.bet;
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
  /** The enemies still standing; Пахан's empty bunk is only cover, never one of them. */
  liveMobs = () => this.S.mobs.filter(m => m.hp > 0 && !MOBS[m.k].fixed);
  /** The ore cave: no enemies, only veins and mushrooms, and a few turns to mine or heal. */
  cave = () => this.S.spec.type === 'treasure';
  /** Turns the room gives the party, 0 for no limit: a fight lasts as long as its enemies stand. */
  turnsMax = () => (this.cave() ? caveTurns(this.S.spec) : 0);
  /** The room is done: every enemy is down, or in the ore cave nothing is left to hit, veins and mushrooms alike. */
  cleared = () => (this.cave() ? !this.S.nodes.some(n => n.left > 0) : !this.liveMobs().length);
  stat = (h: HeroState, k: StatKey) => {
    const step = stepOf(h.def, k);
    return k === 'e' ? Math.min(E_MAX, h.def.e + h.up.e * step) : h.def[k] * (1 + h.up[k] * step);
  };
  get hero() { return this.heroOf(this.act); }

  /** Sparks the hero's ability costs: fewer with «Энергетик». */
  abCost(h: HeroState) { return has(h, 'energy') ? ART.energyCost : AB_COST; }
  /** Discs the hero throws a turn: the ones bought, one more with «Третья рука», and one more in a fight an event gave one. */
  handOf(h: HeroState, spec: RoomSpec | undefined = this.S?.spec) { return h.discs + (has(h, 'hand') ? 1 : 0) + (spec?.extra ?? 0); }
  /** The size of the hero's disc and its friction on the floor, as the trophies and the foam party's floor change them. */
  discR(h: HeroState) { return h.def.r * (has(h, 'tray') ? ART.trayR : 1); }
  discFr(h: HeroState) { return h.def.fr * (has(h, 'polish') ? ART.polishFr : 1) * (this.S?.spec.ground ? FLOOR_FR[this.S.spec.ground] : 1); }
  /** Bounces off walls and blocks the hero's disc takes without losing speed: «Смазка»'s first two, every one on the foam party's slick discs. */
  slickOf(h: HeroState) { return this.S?.spec.ground === 'slick' ? SLICK_ALL : has(h, 'lube') ? ART.slick : 0; }

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
        ab: h.boost, rico: h.boost && h.def.key === 'ricochet' ? AB_BOUNCES : 0, ...(fan ? { fan } : {}), ...(this.slickOf(h) ? { slick: this.slickOf(h) } : {}),
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

  /** A ghost is bodiless on even turns: discs pass through it. The rat swarm down a burrow is out of their reach too. */
  solid(m: Mob) {
    // a coffin still settling on the floor lets the disc that felled its enemy roll on
    return m.hp > 0 && !(m.born > 0) && m.under === undefined && !MOBS[m.k].fixed && !(MOBS[m.k].ghost && this.S.turn % 2 === 0);
  }

  /** Пахан's empty bunk stands in the room like a 2 × 2 block: discs bounce off it, shots don't pass it. */
  fixtures() {
    return this.S.mobs.filter(m => m.hp > 0 && MOBS[m.k].fixed).map(m => {
      const h = (mobSize(m.k) * TILE) / 2;
      return { x0: m.x - h, y0: m.y - h, x1: m.x + h, y1: m.y + h };
    });
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
      ab: h.boost, rico: h.boost && h.def.key === 'ricochet' ? AB_BOUNCES : 0, slick: this.slickOf(h),
    } as Disc;
    const boxes = [...standing(S.blocks), ...S.rock, ...this.fixtures()], over = has(h, 'undies') || this.wild(d);
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
    return h.discs < HAND_MAX ? HAND_COST[h.discs - HAND_START] + this.dearer() : 0;
  }

  /** What «Громкость» adds to every price at the blacksmith's. */
  private dearer() {
    return loud(this.bank.vol, VOL.forge) ? 1 : 0;
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
    const c = UP_COST[h.up[k]];
    return c ? c + this.dearer() : 0;
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
      this.float(p.x, p.y - 8, M('{0}!', h.def.ab), h.def.abCol);
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
        if (p) this.float(p.x, p.y + 6, M('+{0} щит', AB_SHIELD), '#3fc4b6');
      }
      this.burst(d.x, d.y, '#3fc4b6', 10);
    } else if (k === 'ash') {
      m.burn += AB_BURN;
      this.float(m.x, m.y - 14, M('огонь {0}', m.burn), '#ff7a3d');
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
      const m = this.liveMobs().filter(o => o.under === undefined && this.near(o, b)).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
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
    const can = this.liveMobs().filter(m => m.speed > 0 && m.kiss === undefined && m.intent && !m.intent.flee && m.intent.foe === undefined && (m.intent.t === 'hit' || m.intent.t === 'move' || m.intent.t === 'charge'));
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
    if (!this.S.gas.length || m.under !== undefined) return false;
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
    // going for a kissed one, it heads there from where it stands now
    if (it.foe !== undefined) { const o = this.S.mobs[it.foe]; if (this.lover(o)) m.intent = this.lit(m, this.toward(m, o)); return; }
    if (it.t === 'slam') { it.dmg = this.slamDmg(m, it.chill); return; }
    // a floor boss's marked cells stay where they are, its blow on them weakens in the gas
    if ((it.t === 'zone' || it.t === 'emerge') && it.dmg) { it.dmg = it.z === 'roll' ? this.smashDmg(m) : this.zoneDmg(m); return; }
    // drawn by a firecracker, a frosted walker gets that much less far toward it
    if (it.bang) { m.intent = this.lureTo(m, it.bang) ?? it; return; }
    const d = MOBS[m.k], hs = this.alive().filter(h => this.spot(h));
    if ((it.t === 'hit' || it.t === 'move' || it.t === 'toss') && hs.length && m.mad === undefined && (d.toss || d.flees || d.moon)) { m.intent = this.basic(m, hs, 0); return; }
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
    const o = S.mobs.find(q => {
      if (q === m || q.hp <= 0 || q.under !== undefined) return false;
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
      this.note(M('{0} {2?выкинула|выкинул} {1:l} в яму', h.def.name, MOBS[m.k].acc, h.def.fem));
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
   * The model's disc hits m: a kiss, and for its next KISS_TURNS moves it goes for the nearest other enemy instead of the
   * heroes; a kiss on one already kissed starts the count afresh. Bosses shrug it off, and a coffin has nobody inside to charm.
   */
  private kiss(m: Mob, h: HeroState) {
    if (m.hp <= 0) return;
    if (MOBS[m.k].boss || MOBS[m.k].prop) { this.float(m.x, m.y - 14, 'не берёт', '#ff9ab8'); return; }
    // a second disc of the same turn adds nothing; one kissed last turn is kissed anew
    if (m.kiss === undefined || m.kissLeft !== KISS_TURNS) { this.float(m.x, m.y - 14, 'чмок!', '#ff5a8a'); this.burst(m.x, m.y, '#ff7ab0', 10); this.sfx('kiss'); }
    const fresh = m.kiss === undefined;
    m.kiss = h.i;
    m.kissLeft = KISS_TURNS;
    this.retune(m);
    // the others may go for it now, as they would for a hero
    if (fresh) this.retarget();
  }

  /**
   * What a kissed enemy does on its move: it goes for the nearest other enemy instead of the heroes, with its own blow at full
   * strength. A walker strikes from right next to it, a shooter fires once it sees it, walking to where it would if not; with
   * nobody else left in the room it stands and sighs.
   */
  private charm(m: Mob): Intent {
    const o = this.liveMobs().filter(q => q !== m && q.under === undefined).sort((p, q) => Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(q.x - m.x, q.y - m.y))[0];
    return o ? this.toward(m, o) : { t: 'move', hero: -1, dmg: 0, sigh: true };
  }

  /**
   * Enemy m going for enemy o instead of a hero, with its own blow at full strength: a walker strikes from right next to it,
   * a shooter fires once it sees it, walking to where it would if not.
   */
  private toward(m: Mob, o: Mob): Intent {
    const foe = this.S.mobs.indexOf(o), far = isRanged(m.k);
    if (far && this.clearShot(m, o)) return { t: 'hit', hero: -1, dmg: this.blow(m), foe };
    const way = m.speed > 0 ? this.route(m, o, true, far) : null;
    if (!way) return { t: 'move', hero: -1, dmg: 0, foe };
    const n = way.length - 1, now = this.steps(m), go = wayLen(way.slice(0, this.stopAt(m, way) + 1));
    return n <= now ? { t: 'hit', hero: -1, dmg: this.blow(m), foe, way, go, eta: 1 } : { t: 'move', hero: -1, dmg: 0, foe, way, go, eta: 1 + Math.ceil((n - now) / stepsOf(m)) };
  }

  /** An enemy still standing with the model's kiss on it: the others may go for it as for a hero. */
  private lover(o: Mob | undefined) {
    return !!o && o.hp > 0 && o.kiss !== undefined && o.under === undefined;
  }

  /** The kissed enemies m may go for: all standing but itself. */
  private lovers(m: Mob) {
    return this.liveMobs().filter(o => o !== m && o.kiss !== undefined && o.under === undefined);
  }

  /**
   * A kiss has just landed in the heroes' turn, or a kissed enemy has fallen: every enemy not kissed itself that means to go
   * for a hero or a kissed enemy looks again. One whose kissed enemy has fallen picks afresh; one that would rather go for a
   * kissed enemy now does. Firecrackers' draws, blows on everyone, heals and summons stay as they were.
   */
  private retarget() {
    const S = this.S, hs = this.alive().filter(h => this.spot(h));
    if (!hs.length) return;
    this.liveMobs().forEach((m, i) => {
      const it = m.intent;
      if (m.kiss !== undefined || !it || it.bang || (it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge')) return;
      const lost = it.foe !== undefined && !this.lover(S.mobs[it.foe]);
      const pick = this.basic(m, hs, S.turn + i);
      if (lost || (pick.foe !== undefined && pick.foe !== it.foe)) m.intent = pick;
    });
  }

  /** Whether two enemies stand right next to each other, close enough for one to strike the other. */
  private besideMob(m: Mob, o: Mob) {
    const a = mobSize(m.k), b = mobSize(o.k), [i, j] = cellAt(m.x, m.y, a), [p, q] = cellAt(o.x, o.y, b);
    // the gap between the two footprints along each axis, in cells: 0 touching, below 0 overlapping
    const gx = Math.max(p - (i + a), i - (p + b)), gy = Math.max(q - (j + a), j - (q + b));
    return gx <= 0 && gy <= 0 && (gx === 0 || gy === 0);
  }

  /**
   * A move against another enemy, by a kissed one or at a kissed one: it walks up to it and strikes it, or fires at it, as
   * it would at a hero. The blow counts for the model who blew the kiss.
   */
  private charmed(m: Mob) {
    const S = this.S, it = m.intent!, d = MOBS[m.k], o = S.mobs[it.foe!], by = S.heroes.find(h => h.i === (m.kiss ?? o?.kiss)), far = isRanged(m.k);
    if (!o || o.hp <= 0) return;
    const acc = MOBS[o.k].acc;
    if (it.t === 'move') {
      if (m.walk) this.note(far ? M('{0} идёт стрелять в {1:l}', m.name, acc) : M('{0} идёт бить {1:l}', m.name, acc));
      return;
    }
    if (far ? !this.clearShot(m, o) : !this.besideMob(m, o)) {
      this.float(m.x, m.y, far ? 'не видит' : 'не достал', '#c7cbe0');
      this.note(far ? M('{0} не {2?увидела|увидел} {1:l}', m.name, acc, d.fem) : M('{0} не {2?достала|достал} {1:l}', m.name, acc, d.fem));
      return;
    }
    if (far) this.knock(m, m.x, m.y, o.x, o.y, 0.3);
    else this.knock(m, o.x, o.y, m.x, m.y, 0.5);
    m.flash = 0.12;
    const hp = o.hp;
    this.hurtMob(o, it.dmg, '#ff7ab0', false, 0.7, by);
    this.knock(o, o.x, o.y, m.x, m.y, 0.6, 0.05);
    const how = !far ? M('{0} {2?ударила|ударил} {1:l}', m.name, acc, d.fem) : d.charge ? M('{0} {2?бросила|бросил} бомбу в {1:l}', m.name, acc, d.fem) : M('{0} {2?выстрелила|выстрелил} в {1:l}', m.name, acc, d.fem);
    const res = hp > o.hp ? M('{0} на {1}', how, hp - o.hp) : M('{0}, но броня выдержала', how);
    this.note(o.hp <= 0 ? M('{0}, {1?пала|пал}', res, MOBS[o.k].fem) : res);
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

  /** The trinket a disc rolls over: into the thrower's pocket, and the hero says a line about it (src/draw/scene.ts). */
  private grab(d: Disc) {
    const tr = this.S.trinket, h = d.hero;
    if (!tr || tr.by !== undefined || Math.hypot(tr.x - d.x, tr.y - d.y) > d.r + TRINKET_R) return false;
    tr.by = h.i;
    tr.t = 0;
    this.burst(tr.x, tr.y, '#ffd34d', 10);
    this.sfx('grab');
    // the host keeps the list; the snapshots bring it to every screen
    if (!this.send) (h.found ??= []).push(tr.k);
    return true;
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
    // the warm-up's dummies never get angry
    if (this.S.spec.tut) return Infinity;
    // «Громкость»: a turn sooner, and in the boss's room from the first
    const { vol, type } = this.S.spec, boss = type === 'boss';
    const from = boss && loud(vol, VOL.bossRage) ? 1 : (boss ? RAGE_FROM_BOSS : RAGE_FROM) - (loud(vol, VOL.rage) ? 1 : 0);
    return from + (this.S.heroes.some(h => has(h, 'tea')) ? ART.tea : 0);
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
      if (!it || this.acted(m) || this.frozen(m)) continue;
      if (((it.t === 'hit' || it.t === 'toss') && it.hero === h.i) || it.t === 'slam') n += it.dmg;
      else if ((it.t === 'smash' || it.t === 'zone' || it.t === 'emerge') && this.underHammer(h, it.spots!) && (it.z !== 'draft' || this.within(m, this.spot(h)!, DRAFT.pull + 1))) n += it.dmg;
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
    // an egg's only move is to hatch, on its turn
    if (m.k === 'egg') return it?.eta ? { name: SPECIAL.hatch, turns: Math.max(0, it.eta - 1) } : null;
    if (!d.acts && !d.charge && m.under === undefined) return null;
    // the move picked for this turn, unless it is made already or has come to nothing (the one to heal has fallen)
    if (it && it.t !== 'hit' && it.t !== 'move' && it.t !== 'toss' && it.t !== 'idle' && !this.acted(m) && !this.idle(m) && !this.frozen(m)) return { name: specialName(it.t, it.chill, it.z), turns: 0 };
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
    if (a.k === 'dive') return this.S.pits.length > 0;
    if (a.k === 'brew') return this.sixes(m).length > 0;
    return true;
  }

  /** Пахан's шестёрки still standing. */
  private sixes(m: Mob) {
    const mi = this.S.mobs.indexOf(m);
    return this.liveMobs().filter(o => o.k === 'six' && o.owner === mi);
  }

  /** How many mobs a summon raises now: fewer for a smaller party, never past the summoner's limit or a crowded room. */
  private risen(m: Mob, a: MobAct) {
    const S = this.S, mi = S.mobs.indexOf(m), k = partyScale(S.spec).mobs;
    const mine = S.mobs.filter(o => o.hp > 0 && o.owner === mi).length;
    return Math.min(Math.max(1, Math.round((a.n ?? 1) * k)), Math.max(1, Math.round((a.cap ?? 3) * k)) - mine, 9 - this.liveMobs().length);
  }

  pickIntents() {
    const hs = this.alive().filter(h => this.spot(h));
    if (!hs.length) return;
    const taken: { x: number; y: number }[] = [];
    this.liveMobs().forEach((m, i) => { m.intent = this.intentFor(m, hs, taken, i); });
    this.listen();
  }

  /**
   * What a mob means to do this turn: a coffin gets up, a kissed one goes for another enemy, an egg hatches, the rat swarm comes up out of its burrow; else its
   * special act on that act's turns (the dragon after whoever broke its egg has no time for one), else its usual move.
   */
  private intentFor(m: Mob, hs: HeroState[], taken: Pt[], i: number): Intent {
    const S = this.S;
    // a dummy of the warm-up room with no blow of its own just stands there
    if (MOBS[m.k].dummy && !MOBS[m.k].dmg) return { t: 'idle', hero: -1, dmg: 0 };
    if (m.k === 'coffin') return this.rising(m);
    // still kissed from a turn before, it goes for another enemy again
    if (m.kiss !== undefined) return this.charm(m);
    if (m.k === 'egg') return this.hatching(m);
    if (m.under !== undefined) return this.emerging(m);
    if (m.mad === undefined) for (const a of MOBS[m.k].acts ?? []) {
      if (S.turn % a.every !== a.at) continue;
      const it = this.special(m, a, hs, taken);
      if (it) { if (it.t === 'slam') it.dmg = this.slamDmg(m, it.chill); return it; }
    }
    return this.basic(m, hs, S.turn + i);
  }

  /**
   * A mob's move on a turn without a special act: the dragon goes after whoever broke its egg, the fridge bites or throws
   * food, the swarm's last rats run, the dancer moonwalks off a hero close by, a шестёрка goes on «шмон»; a shooter fires
   * (taking the heroes in turn by `k`), a walker goes after its hero.
   */
  private basic(m: Mob, hs: HeroState[], k: number): Intent {
    const d = MOBS[m.k], mad = m.mad !== undefined ? hs.find(h => h.i === m.mad) : undefined;
    if (mad) return this.chase(m, mad, this.route(m, this.spot(mad)!));
    if (d.toss) return this.snack(m, hs);
    if (d.flees) return this.runOff(m, hs);
    if (d.moon && hs.some(h => this.within(m, this.spot(h)!, d.shy ?? 1))) return this.backOff(m, hs, k);
    if (d.loots) { const it = this.shmon(m, hs); if (it) return it; }
    if (isRanged(m.k)) return this.shoot(m, hs, k);
    return this.goAfter(m, hs);
  }

  /**
   * A walker picks the hero it goes after: the nearest by its route, or (the headsman) the one with the least health it can
   * reach, the nearer of two as hurt. An enemy the model has kissed is picked the same way, unless `lovers` is off.
   */
  private goAfter(m: Mob, hs: HeroState[], lovers = true): Intent {
    let best = hs[0], way: Pt[] | null = null, bd = Infinity, foe: Mob | null = null;
    const hunts = MOBS[m.k].hunts;
    for (const h of hs) {
      const w = this.route(m, this.spot(h)!);
      const sc = !w ? Infinity : hunts ? h.hp * 1000 + w.length : w.length;
      if (sc < bd) { bd = sc; best = h; way = w; }
    }
    for (const o of lovers ? this.lovers(m) : []) {
      const w = this.route(m, o);
      const sc = !w ? Infinity : hunts ? o.hp * 1000 + w.length : w.length;
      if (sc < bd) { bd = sc; foe = o; }
    }
    return foe ? this.toward(m, foe) : this.chase(m, best, way);
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
    const d = MOBS[m.k], twice = d.charge || this.executes(m) || m.mad !== undefined;
    return this.cut(m, (twice ? m.dmg * 2 : m.dmg) + this.honed(m) + this.rage());
  }

  /** What the hammer's blow on its square deals: half again a plain strike, rage on top, less from the gas. */
  private smashDmg(m: Mob) {
    return this.cut(m, Math.ceil(m.dmg * SMASH_MUL) + this.honed(m) + this.rage());
  }

  /** The door its holder faces its hero with covers the point (x, y): a disc hitting there deals only half. */
  shielded(m: Mob, x: number, y: number) {
    if (!MOBS[m.k].shield) return false;
    const it = m.intent, foe = it?.foe !== undefined ? this.S.mobs[it.foe] : null, h = it && it.hero >= 0 ? this.heroOf(it.hero) : null;
    const p = foe ?? (h && this.spot(h)) ?? { x: this.S.Wx, y: this.S.Wy };
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
    const c = this.spawn('coffin', dead.x, dead.y);
    c.owner = S.mobs.indexOf(u); c.born = 1; c.hold = dead.k; c.rise = COFFIN_TURNS;
    c.intent = this.rising(c);
    S.mobs.push(c);
    // demo-cut: the undertaker is not in the demo
    this.float(u.x, u.y - 12, 'в гроб!', '#b7a07a');
    // demo-cut
    this.note(M('{0} {2?уложила|уложил} {1:l} в гроб', u.name, d.acc, MOBS[u.k].fem));
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
    // one that never walks (the dragon on its eggs) strikes only a hero right by it
    if (m.speed <= 0 && way.length > 1) return { t: 'move', hero: h.i, dmg: 0 };
    // a frosted walker covers fewer cells this turn only
    const p = this.spot(h)!, n = way.length - 1, go = wayLen(way.slice(0, this.stopAt(m, way) + 1)), now = this.steps(m);
    const eta = n <= now ? 1 : 1 + Math.ceil((n - now) / stepsOf(m));
    if (!isRanged(m.k)) way.push({ x: p.x, y: p.y });
    return n <= now ? { t: 'hit', hero: h.i, dmg: this.blow(m), way, go, eta: 1 } : { t: 'move', hero: h.i, dmg: 0, way, go, eta };
  }

  /**
   * What a shooter does about the heroes `hs` and the enemies the model has kissed (unless `lovers` is off): it fires at one
   * it sees, taking them in turn by `k`; seeing none, it walks to the nearest spot it sees one from and fires on arriving,
   * if its steps take it there this turn. A bomber lighting its fuse walks the same way, so it has its mark in sight when
   * the bomb is ready.
   */
  private shoot(m: Mob, hs: HeroState[], k: number, lovers = true): Intent {
    const S = this.S, foes = lovers ? this.lovers(m) : [];
    const seen: (HeroState | Mob)[] = [...hs.filter(h => this.sees(m, h)), ...foes.filter(o => this.clearShot(m, o))];
    let it: Intent;
    if (seen.length) {
      const t = seen[k % seen.length];
      it = 'def' in t ? { t: 'hit', hero: t.i, dmg: this.blow(m) } : { t: 'hit', hero: -1, dmg: this.blow(m), foe: S.mobs.indexOf(t) };
    } else {
      let best = hs[k % hs.length], way: Pt[] | null = null, foe: Mob | null = null;
      for (const h of hs) {
        const w = this.route(m, this.spot(h)!, true, true);
        if (w && (!way || w.length < way.length)) { best = h; way = w; }
      }
      for (const o of foes) {
        const w = this.route(m, o, true, true);
        if (w && (!way || w.length < way.length)) { foe = o; way = w; }
      }
      it = foe ? this.toward(m, foe) : this.chase(m, best, way);
    }
    return this.lit(m, it);
  }

  /** A bomber lights its fuse every other turn instead of throwing: it walks as it would, the bomb comes next turn. */
  private lit(m: Mob, it: Intent): Intent {
    return MOBS[m.k].charge && this.S.turn % 2 === 1 ? { ...it, t: 'charge', dmg: 0 } : it;
  }

  /**
   * The heroes have moved to their discs: every walker still goes after the hero it was after, now to where that hero stands,
   * so its route, its reach and the blows the heroes expect are right for the enemy turn. A shooter keeps its target too:
   * a hero who has stepped out of its sight makes it walk to where it sees that hero again.
   */
  private rechase() {
    const hs = this.alive().filter(h => this.spot(h));
    this.liveMobs().forEach((m, i) => {
      if (m.kiss !== undefined) { m.intent = this.charm(m); return; }
      const it = m.intent, d = MOBS[m.k];
      if (it?.t === 'slam') it.dmg = this.slamDmg(m, it.chill);
      // an egg's turn to hatch comes sooner once one before it is broken
      if (m.k === 'egg') { m.intent = this.hatching(m); return; }
      if (!it || it.bang || (it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge' && it.t !== 'toss')) return;
      // going for a kissed one: to where it stands now, or, that one fallen, for whoever is there to go for
      if (it.foe !== undefined) {
        const o = this.S.mobs[it.foe];
        if (this.lover(o)) m.intent = this.lit(m, this.toward(m, o));
        else if (hs.length) m.intent = this.basic(m, hs, this.S.turn + i);
        return;
      }
      // the fridge, the swarm's last rats, the dancer and a шестёрка weigh things up afresh from where everybody stands now
      if (hs.length && m.mad === undefined && (d.toss || d.flees || d.moon || d.loots)) { m.intent = this.basic(m, hs, 0); return; }
      const h = this.heroOf(it.hero), p = this.spot(h);
      if (h.hp <= 0 || !p) return;
      if (isRanged(m.k)) m.intent = this.shoot(m, it.t === 'charge' ? hs : [h], 0, false);
      else if (it.t !== 'charge') m.intent = this.chase(m, h, this.route(m, p));
    });
    // and the firecrackers draw the enemies nearest them afresh, from where everybody stands now
    this.listen();
  }

  /**
   * Whether a shot from a to b flies clear: no wall, block or icicle still standing and no resource left in between.
   * Holes in the floor, the heroes and the other enemies don't stand in the way; a line that only grazes an edge
   * or a corner of a block goes past it.
   */
  clearShot(a: Pt, b: Pt) {
    return clearLine(this.S, a, b, this.fixtures());
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
    // the floor bosses': the hero they would go after is the one they aim at
    const aim = () => this.heroOf(this.goAfter(m, hs, false).hero), at = (h: HeroState) => this.spot(h) ?? this.spot(hs[0])!;
    if (a.k === 'dive') return this.able(m, a) ? { t: 'dive', hero: aim().i, dmg: 0 } : null;
    if (a.k === 'brew') return this.able(m, a) ? { t: 'brew', hero: -1, dmg: 0 } : null;
    if (a.k === 'cone') { const h = aim(); return { t: 'zone', z: 'cold', hero: h.i, dmg: this.zoneDmg(m), spots: this.cone(m, at(h)) }; }
    if (a.k === 'belch') { const h = aim(); return { t: 'zone', z: 'fire', hero: h.i, dmg: this.zoneDmg(m), spots: this.fireLine(m, at(h)) }; }
    if (a.k === 'dance') return { t: 'zone', z: 'dance', hero: -1, dmg: this.zoneDmg(m), spots: this.pattern(m) };
    if (a.k === 'lights') return { t: 'zone', z: 'beam', hero: -1, dmg: this.zoneDmg(m), spots: this.beams(m) };
    if (a.k === 'roll') return this.rollPlan(m, hs);
    if (a.k === 'crown') { const h = aim(); return { t: 'zone', z: 'crown', hero: h.i, dmg: this.zoneDmg(m), spots: this.crownPath(m, at(h)) }; }
    if (a.k === 'cast') { const h = aim(); return { t: 'zone', z: 'cast', hero: h.i, dmg: this.zoneDmg(m), spots: this.castLine(m, at(h)) }; }
    // the wall and the draft only when there is something for them to do, else the boss's usual move
    if (a.k === 'wall') { const spots = this.iceWall(m, hs); return spots.length ? { t: 'zone', z: 'wall', hero: -1, dmg: 0, spots } : null; }
    if (a.k === 'draft') { const spots = this.draftCells(m); return hs.some(h => this.underHammer(h, spots)) ? { t: 'zone', z: 'draft', hero: -1, dmg: this.blow(m), spots } : null; }
    if (a.k === 'smash') {
      // the square round the hero it would go after: it stays where it is marked, so a throw that lands outside dodges it
      const p = this.spot(this.heroOf(this.goAfter(m, hs, false).hero)) ?? this.spot(hs[0])!;
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
    if (m.hp <= 0 || MOBS[m.k].fixed) return;
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
      m.rage = true; m.dmg += up; this.float(m.x, m.y - 12, M('ЯРОСТЬ +{0}', up), '#ff7a3d'); this.burst(m.x, m.y, '#ff7a3d', 18);
    }
    this.sfx(m.hp <= 0 ? 'kill' : 'hit', p);
    if (m.hp > 0) this.phase(m);
    if (m.hp <= 0) {
      m.dead = 0.001; this.burst(m.x, m.y, '#ffd34d', 22); this.float(m.x, m.y - 6, m.k === 'egg' ? 'хрусь!' : 'повержен', '#ffd34d');
      // Пахан's «общак» comes back to the party twice over
      if (m.pot) {
        const ore = m.pot * 2;
        this.bank.ore += ore; this.mined += ore; m.pot = 0;
        this.float(m.x, m.y + 8, M('общак +{0} руды', ore), '#ffb070');
        this.note(M('Общак {0} вернулся отряду: +{1} руды', MOBS[m.k].acc, ore));
      }
      if (m.k === 'egg' && by) this.enrage(by);
      if (m.burn > 0) this.spreadFire(m);
      if (by) this.killed(m, by);
      // those that went for it look for someone else
      if (m.kiss !== undefined && this.S.phase === 'throw') this.retarget();
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
      this.float(to.x, to.y - 14, M('огонь {0}', to.burn), '#ff7a3d');
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
    this.note(blk ? M('{0}, щит принял {1}', txt, blk) : txt);
    this.noteFall(h);
  }

  private noteFall(h: HeroState) {
    if (h.hp <= 0) this.note(M('{0} {1?пала|пал}', h.def.name, h.def.fem));
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
    // nobody falls in the warm-up
    if (h.hp <= 0 && S.spec.tut) { h.hp = 1; this.spared = true; }
    const t = tallyOf(h);
    t.hurt += Math.min(dmg, had);
    if (h.hp <= 0) t.falls++;
    h.flash = 0.2;
    // a blow knocks the figure away from the enemy; spikes, lava and fire just make it jump
    const kp = (0.35 + Math.min(n, 10) / 14) * (dmg ? 1 : 0.6);
    if (from) this.knock(h, p.x, p.y, from.x, from.y, kp, 0.06);
    else if (dmg) this.knock(h, p.x, p.y, p.x, p.y, kp * 0.7);
    this.float(p.x, p.y, !dmg ? 'блок' : why ? M('-{0} {1}', dmg, why) : `-${dmg}`, dmg ? '#ff4d6a' : '#3fc4b6');
    this.sfx(dmg ? 'hurt' : 'armor');
    if (dmg) { this.burst(p.x, p.y, '#ff4d6a', 10); S.shake = 0.2; }
    if (h.hp <= 0) { this.float(p.x, p.y - 6, 'пал', '#ff4d6a'); h.hand = 0; }
    return blk;
  }

  // ------------------------------------------------------------ floor bosses

  /** A floor boss hurt down to the share of its health its next phase begins at turns into it (twice over, for a hard enough blow). */
  private phase(m: Mob) {
    for (let nx = MOBS[m.k].next; nx && m.hp > 0 && m.hp <= m.max * nx.at; nx = MOBS[m.k].next) this.become(m, nx.k);
  }

  /**
   * A floor boss turns into its next phase `k`, keeping its health and whatever has added to its blows. The rat swarm sheds
   * prison rats and shrinks onto a cell of the pile, Пахан gets up off his bunk (it stays behind as cover), the dragon's
   * eggs all hatch at once. What it means to do this turn is worked out afresh.
   */
  private become(m: Mob, k: MobKind) {
    const S = this.S, was = MOBS[m.k], d = MOBS[k], mi = S.mobs.indexOf(m), sz0 = mobSize(m.k), sz = mobSize(k);
    const [i0, j0] = cellAt(m.x, m.y, sz0), blow = (kind: MobKind) => mobDmg(kind, S.dmgAdd, S.dmgMul, S.spec.seed);
    m.dmg += blow(k) - blow(m.k);
    Object.assign(m, { k, name: d.name, r: d.r, speed: d.speed, reach: d.reach, armor: d.armor });
    delete m.mad;
    const foot = this.footprint(i0, j0, sz0), area = m.under !== undefined ? S.pits[m.under].cells.map(([x, y]) => ({ x, y })) : foot;
    if (was.sheds) this.scatter(m, area, Math.max(1, Math.round(was.sheds * partyScale(S.spec).mobs)));
    if (k === 'pahan2') {
      const bunk = newMob('bunk', m.x, m.y);
      bunk.owner = mi;
      S.mobs.push(bunk);
    }
    if (m.under === undefined && (sz !== sz0 || k === 'pahan2')) {
      // a smaller body stands on the cell of the old one nearest the heroes; Пахан steps off his bunk beside it
      const cells = k === 'pahan2' ? this.around(foot, 1) : foot, taken = this.occupied(m, true), stands = this.standCells();
      const ok = cells.filter(c => this.fits(c.x, c.y, sz, taken) && !this.onStand(c.x, c.y, sz, stands)).map(c => cellCentre(c.x, c.y, sz));
      const at = this.nearestHero(ok) ?? cellCentre(i0, j0, sz);
      m.x = m.fx = m.tx = at.x;
      m.y = m.fy = m.ty = at.y;
    }
    m.walk = undefined;
    m.hop = 0;
    if (was.nest) for (const o of this.liveMobs()) if (o.k === 'egg' && o.owner === mi) this.hatch(o);
    const cry = PHASE_CRY[k] ?? '!';
    this.float(m.x, m.y - 16, cry, '#ff4d6a');
    this.burst(m.x, m.y, '#ff4d6a', 18);
    S.shake = Math.max(S.shake, 0.25);
    this.sfx('slam');
    this.note(M('{0}: {1:l}', d.name, cry));
    this.repick(m);
  }

  /** What a mob does this turn, worked out afresh after it has changed (a new phase, a broken egg); one that has made its move keeps it. */
  private repick(m: Mob) {
    const S = this.S, hs = this.alive().filter(h => this.spot(h));
    if (m.hp <= 0 || !hs.length || S.phase === 'over' || this.acted(m)) return;
    m.intent = this.intentFor(m, hs, [], S.mobs.indexOf(m));
    if (S.phase === 'enemy' && S.mobs[S.actor] === m) this.planWalk(m);
  }

  /** The cells of an s × s footprint with its top-left cell at (i, j). */
  private footprint(i: number, j: number, s: number): Pt[] {
    const out: Pt[] = [];
    for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) out.push({ x: i + a, y: j + b });
    return out;
  }

  /** The cells exactly r steps away (kingwise) from a group of cells. */
  private around(cells: Pt[], r: number): Pt[] {
    const xs = cells.map(c => c.x), ys = cells.map(c => c.y), out: Pt[] = [];
    const dist = (x: number, y: number) => Math.min(...cells.map(c => Math.max(Math.abs(c.x - x), Math.abs(c.y - y))));
    for (let y = Math.min(...ys) - r; y <= Math.max(...ys) + r; y++) for (let x = Math.min(...xs) - r; x <= Math.max(...xs) + r; x++) if (dist(x, y) === r) out.push({ x, y });
    return out;
  }

  /** Of the points, the one nearest a hero standing in the room (the first when nobody stands); null for none. */
  private nearestHero(pts: Pt[]): Pt | null {
    const hs = this.alive().map(h => this.spot(h)).filter((p): p is Pt => !!p);
    let best = pts[0] ?? null, bd = Infinity;
    for (const p of pts) {
      const far = Math.min(...hs.map(q => Math.hypot(q.x - p.x, q.y - p.y)));
      if (far < bd) { bd = far; best = p; }
    }
    return best;
  }

  /** Of the heroes, the one standing nearest the mob. */
  private nearestOf(m: Mob, hs: HeroState[]) {
    const far = (h: HeroState) => { const p = this.spot(h)!; return Math.hypot(p.x - m.x, p.y - m.y); };
    return hs.reduce((a, b) => (far(b) < far(a) ? b : a));
  }

  /** The rat swarm thins out: n prison rats run off it onto free cells round `area`, as many as there is room for (nine enemies at most). */
  private scatter(m: Mob, area: Pt[], n: number) {
    const S = this.S, taken = this.occupied(null, true), stands = this.standCells();
    n = Math.min(n, 9 - this.liveMobs().length);
    for (const c of [...this.around(area, 1), ...this.around(area, 2)]) {
      if (n <= 0) break;
      if (!this.cellFree(c.x, c.y, taken) || stands.has(hazKey(c.x, c.y)) || S.haz.has(hazKey(c.x, c.y))) continue;
      const p = cellCentre(c.x, c.y), o = this.spawn('rat', p.x, p.y);
      o.owner = S.mobs.indexOf(m);
      o.born = 1;
      S.mobs.push(o);
      taken[c.y * S.gw + c.x] = 1;
      this.burst(p.x, p.y, '#b7a07a', 8);
      n--;
    }
  }

  /** An enemy the fight brings in, as tough as the room's own: «Громкость» included. */
  private spawn(k: MobKind, x: number, y: number) {
    const S = this.S, m = newMob(k, x, y, S.hpMul, S.dmgAdd, S.dmgMul, S.spec.seed);
    m.dmg += volBlow(S.spec, k);
    return m;
  }

  /** A dragon's egg hatches: a fire imp gets up in its place, and goes from the next turn on. */
  private hatch(o: Mob) {
    const imp = this.spawn(o.hold ?? 'imp', o.x, o.y);
    Object.assign(o, imp, { owner: o.owner, born: 1, intent: null, hold: undefined });
    this.burst(o.x, o.y, '#ff7a3d', 14);
    this.float(o.x, o.y - 12, 'вылупился!', '#ff7a3d');
    this.note(M('Из яйца {1?вылупилась|вылупился} {0:l}', o.name, MOBS[o.k].fem));
  }

  /** An egg waits to hatch: one every third turn, in the order they lie in the room; `eta` counts the enemy turns this one has, this one too. */
  private hatching(m: Mob): Intent {
    const S = this.S, r = Math.max(0, this.liveMobs().filter(o => o.k === 'egg' && o.owner === m.owner).indexOf(m));
    return { t: 'rise', hero: -1, dmg: 0, eta: (3 - (S.turn % 3)) % 3 + 3 * r + 1 };
  }

  /** A hero has broken one of the dragon's eggs: the dragon gets up and goes after that hero on its next move, and hits twice as hard. */
  private enrage(by: HeroState) {
    const dr = this.liveMobs().find(o => MOBS[o.k].nest);
    if (!dr || by.hp <= 0) return;
    dr.mad = by.i;
    dr.speed = MAD_SPEED;
    this.float(dr.x, dr.y - 16, 'НЕ ТРОЖЬ ЯЙЦА!', '#ff4d6a');
    this.burst(dr.x, dr.y, '#ff4d6a', 12);
    this.note(M('{0} {3?разбила|разбил} яйцо: {1} идёт к {2}', by.def.name, dr.name, by.def.dat, by.def.fem));
    this.repick(dr);
  }

  /** Пахан's blow has landed: it takes `pot` ore from the party into its «общак», as much as the party has. */
  private steal(m: Mob, h: HeroState) {
    const n = Math.min(MOBS[m.k].pot ?? 0, this.bank.ore), p = this.spot(h);
    if (n <= 0) return;
    this.bank.ore -= n;
    m.pot = (m.pot ?? 0) + n;
    if (p) this.float(p.x, p.y - 14, M('−{0} руды в общак', n), '#ffb070');
    this.note(M('{0} {2?забрала|забрал} {1} руды в общак', m.name, n, MOBS[m.k].fem));
  }

  /** Пахан on his bunk: a шестёрка of his standing right next to him takes the disc meant for him, the one nearest the disc. */
  coverOf(m: Mob, d: Pt): Mob | null {
    if (!MOBS[m.k].cover) return null;
    return this.sixes(m).filter(o => this.solid(o) && this.besideMob(m, o))
      .sort((p, q) => Math.hypot(p.x - d.x, p.y - d.y) - Math.hypot(q.x - d.x, q.y - d.y))[0] ?? null;
  }

  /**
   * A disc's blow lands on m: into the fridge's open door twice as hard and past its armour, on Пахан on the шестёрка
   * covering him; one that hurts the disco ball knocks mirror tiles off it.
   */
  private strike(m: Mob, d: Disc, n: number, pierce: boolean, p: number) {
    const o = m.open, L = Math.hypot(d.x - m.x, d.y - m.y) || 1;
    if (o && (o.x * (d.x - m.x) + o.y * (d.y - m.y)) / L > FRIDGE_COS) {
      n *= WEAK_MUL;
      pierce = true;
      this.float(m.x, m.y - 22, M('в дверцу! ×{0}', WEAK_MUL), '#ffe27a');
    }
    const to = this.coverOf(m, d) ?? m, hp = to.hp;
    if (to !== m) this.float(to.x, to.y - 14, 'прикрыла!', '#ffb070');
    this.hurtMob(to, n, '#fff', pierce, p, d.hero);
    if (MOBS[to.k].shards && to.hp < hp) this.shatter(to);
  }

  /** A disc has hurt the disco ball: mirror tiles fall off it onto free floor round it, and lie there like spikes. */
  private shatter(m: Mob) {
    const S = this.S, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), taken = this.occupied(null, false), stands = this.standCells(), foot = this.footprint(i0, j0, sz);
    const free: Pt[] = [];
    for (let r = 1; r <= SHARD_REACH; r++) {
      for (const c of this.around(foot, r)) if (this.cellFree(c.x, c.y, taken) && !stands.has(hazKey(c.x, c.y)) && !S.haz.has(hazKey(c.x, c.y)) && !this.shardAt(c.x, c.y)) free.push(c);
    }
    const list = (m.shards ??= []);
    for (let n = MOBS[m.k].shards ?? 0; n > 0 && free.length; n--) {
      const c = free.splice(Math.floor(this.fx() * free.length), 1)[0], p = cellCentre(c.x, c.y);
      list.push(hazKey(c.x, c.y));
      this.burst(p.x, p.y, '#dff6ff', 6);
    }
  }

  /** Whether the disco ball's mirror tiles lie on the cell (i, j). */
  shardAt(i: number, j: number) {
    const k = hazKey(i, j);
    return this.S.mobs.some(o => o.shards?.includes(k));
  }

  /** What a floor boss's blow on its marked cells deals: its strike, rage on top, less from the gas. */
  private zoneDmg(m: Mob) {
    return this.cut(m, m.dmg + this.honed(m) + this.rage());
  }

  /** Cells under standing blocks. */
  private blockCells() {
    return new Set(standing(this.S.blocks).map(b => hazKey(Math.floor(b.x0 / TILE), Math.floor(b.y0 / TILE))));
  }

  /** The fridge's freezer: three cells out from it toward the point p, a cell wider each side every cell out. */
  private cone(m: Mob, p: Pt): Pt[] {
    const S = this.S, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), dx = p.x - m.x, dy = p.y - m.y, blocks = this.blockCells(), out: Pt[] = [];
    const across = Math.abs(dx) >= Math.abs(dy), s = Math.sign(across ? dx : dy) || 1;
    for (let k = 1; k <= 3; k++) for (let w = 1 - k; w < sz + k - 1; w++) {
      const ahead = s > 0 ? sz - 1 + k : -k, i = across ? i0 + ahead : i0 + w, j = across ? j0 + w : j0 + ahead;
      if (isFloor(S, i, j) && !blocks.has(hazKey(i, j))) out.push(cellCentre(i, j));
    }
    return out;
  }

  /**
   * The dancefloor's lit cells this turn: a checkerboard, stripes either way or rings round the dancer, as the turn's beat
   * falls, and the trail of its last moonwalk.
   */
  private pattern(m: Mob): Pt[] {
    const S = this.S, R = mulberry32(S.spec.seed * 31 + S.turn), kind = Math.floor(R() * 4), par = R() < 0.5 ? 0 : 1;
    const sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), blocks = this.blockCells(), out: Pt[] = [];
    for (let j = 0; j < S.gh; j++) for (let i = 0; i < S.gw; i++) {
      if (!isFloor(S, i, j) || blocks.has(hazKey(i, j)) || S.pits.some(p => inPit(p, i, j))) continue;
      const ring = Math.max(i0 - i, i - i0 - sz + 1, j0 - j, j - j0 - sz + 1);
      if (ring <= 0) continue;
      const lit = kind === 0 ? (i + j) % 2 : kind === 1 ? j % 2 : kind === 2 ? i % 2 : ring % 2;
      // the cells it has just moonwalked over light up whatever the pattern
      if (lit === par || m.trail?.includes(hazKey(i, j))) out.push(cellCentre(i, j));
    }
    return out;
  }

  /** The disco ball's beams: along its rows and columns, out from it to the walls and the blocks. */
  private beams(m: Mob): Pt[] {
    const S = this.S, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), blocks = this.blockCells(), out: Pt[] = [];
    const ray = (i: number, j: number, di: number, dj: number) => {
      for (i += di, j += dj; isFloor(S, i, j) && !blocks.has(hazKey(i, j)); i += di, j += dj) out.push(cellCentre(i, j));
    };
    for (let a = 0; a < sz; a++) { ray(i0 + a, j0, 0, -1); ray(i0 + a, j0 + sz - 1, 0, 1); ray(i0, j0 + a, -1, 0); ray(i0 + sz - 1, j0 + a, 1, 0); }
    return out;
  }

  /** The dragon's belch: a line of fire from its middle through the point p on to the wall or a block. */
  private fireLine(m: Mob, p: Pt): Pt[] {
    return fireCells(this.S, m, p);
  }

  /**
   * The king's crown: thrown from its middle toward the point p, it bounces off the walls and the columns twice and drops
   * where it hits a third time. The cells it flies over, past the king's own.
   */
  private crownPath(m: Mob, p: Pt): Pt[] {
    const S = this.S, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), blocks = this.blockCells(), out = new Map<string, Pt>();
    const solid = (x: number, y: number) => { const i = Math.floor(x / TILE), j = Math.floor(y / TILE); return !isFloor(S, i, j) || blocks.has(hazKey(i, j)); };
    const L = Math.hypot(p.x - m.x, p.y - m.y) || 1;
    let x = m.x, y = m.y, dx = ((p.x - m.x) / L) * 2, dy = ((p.y - m.y) / L) * 2;
    for (let n = 0, k = 0; k < 2000; k++) {
      if (solid(x + dx, y + dy)) {
        if (n++ === 2) break;
        // off a side it turns one way, into a corner straight back
        const fx = solid(x + dx, y), fy = solid(x, y + dy);
        if (fx || !fy) dx = -dx;
        if (fy || !fx) dy = -dy;
        continue;
      }
      x += dx;
      y += dy;
      const i = Math.floor(x / TILE), j = Math.floor(y / TILE);
      if (i < i0 || i >= i0 + sz || j < j0 || j >= j0 + sz) out.set(hazKey(i, j), cellCentre(i, j));
    }
    return [...out.values()];
  }

  /**
   * The forge's lord pours metal: across its way to the point p, a column when the hero is off to its side, a row when above
   * or below, through the hero's cell out to the walls and the blocks.
   */
  private castLine(m: Mob, p: Pt): Pt[] {
    const S = this.S, blocks = this.blockCells(), [ci, cj] = cellAt(p.x, p.y), out: Pt[] = [cellCentre(ci, cj)];
    const [di, dj] = Math.abs(p.x - m.x) >= Math.abs(p.y - m.y) ? [0, 1] : [1, 0];
    for (const s of [1, -1]) for (let i = ci + di * s, j = cj + dj * s; isFloor(S, i, j) && !blocks.has(hazKey(i, j)); i += di * s, j += dj * s) out.push(cellCentre(i, j));
    return out;
  }

  /** The metal poured stays as lava through the fight, but not on the runes, under the heroes or down the holes. */
  private pour(m: Mob, spots: Pt[]) {
    const S = this.S, stands = this.standCells();
    for (const p of spots) {
      const k = hazKey(...cellAt(p.x, p.y));
      if (!stands.has(k) && !pitAt(S.pits, p.x, p.y)) S.haz.add(k);
    }
    this.note(M('{0} {1?залила|залил} пол металлом: там теперь лава', m.name, MOBS[m.k].fem));
  }

  /**
   * Where the lich's ice wall grows: three cells across the way from it to the nearest hero who sees it (else the nearest
   * hero), two cells out in front of that hero, on open floor off the runes. None for a hero right by the lich.
   */
  private iceWall(m: Mob, hs: HeroState[]): Pt[] {
    const seen = hs.filter(h => this.sees(m, h)), p = this.spot(this.nearestOf(m, seen.length ? seen : hs))!;
    const L = Math.hypot(m.x - p.x, m.y - p.y);
    if (L < TILE * 4) return [];
    const ux = (m.x - p.x) / L, uy = (m.y - p.y) / L, [ci, cj] = cellAt(p.x + ux * TILE * 2, p.y + uy * TILE * 2);
    // across the way: square to it, the nearest of the eight ways a piece goes
    const a = Math.round(Math.atan2(uy, ux) / (Math.PI / 4)) * (Math.PI / 4) + Math.PI / 2, ai = Math.round(Math.cos(a)), aj = Math.round(Math.sin(a));
    const taken = this.occupied(null, true), stands = this.standCells(), out: Pt[] = [];
    for (const k of [0, -1, 1]) {
      const i = ci + ai * k, j = cj + aj * k;
      if (this.cellFree(i, j, taken) && !stands.has(hazKey(i, j))) out.push(cellCentre(i, j));
    }
    return out;
  }

  /** The lich's ice wall grows: a small icicle on each of its cells still free. */
  private iceUp(m: Mob, spots: Pt[]) {
    const S = this.S, taken = this.occupied(null, true), stands = this.standCells();
    let n = 0;
    for (const p of spots) {
      const [i, j] = cellAt(p.x, p.y);
      if (!this.cellFree(i, j, taken) || stands.has(hazKey(i, j))) continue;
      S.blocks.push({ x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE, v: 1 + 2 * ((i + j) % 4), ice: true, big: false, hp: ICICLE_HP.small, max: ICICLE_HP.small, made: true });
      this.burst(p.x, p.y, '#bfe6ff', 10);
      n++;
    }
    this.note(n ? M('{0} {1?поставила|поставил} ледяную стену', m.name, MOBS[m.k].fem) : M('{0}: ледяной стене негде встать', m.name));
  }

  /** The fridge's draft: the cells within DRAFT.reach of it that it sees, where it pulls a hero over. */
  private draftCells(m: Mob): Pt[] {
    const S = this.S, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), blocks = this.blockCells(), r = DRAFT.reach, out: Pt[] = [];
    for (let j = j0 - r; j < j0 + sz + r; j++) for (let i = i0 - r; i < i0 + sz + r; i++) {
      if ((i >= i0 && i < i0 + sz && j >= j0 && j < j0 + sz) || !isFloor(S, i, j) || blocks.has(hazKey(i, j))) continue;
      const c = cellCentre(i, j);
      if (this.clearShot(m, c)) out.push(c);
    }
    return out;
  }

  /**
   * The draft pulls the heroes on its cells DRAFT.pull cells over to the fridge, the nearest first, a cell at a time the way
   * a piece goes on the board, short of whatever stands in the way; spikes, lava or mirror tiles where one ends up hurt as
   * under a disc. Then the fridge bites the nearest hero right by it with its door.
   */
  private draft(m: Mob, hs: HeroState[], dmg: number) {
    const S = this.S, d = MOBS[m.k], gw = S.gw, sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz);
    const dist = (h: HeroState) => { const p = this.spot(h)!; return Math.hypot(p.x - m.x, p.y - m.y); };
    for (const h of hs.slice().sort((a, b) => dist(a) - dist(b))) {
      const p = this.spot(h)!, taken = this.occupied(null, true);
      for (const o of S.heroes) { const q = this.spot(o); if (o !== h && q) taken[Math.floor(q.y / TILE) * gw + Math.floor(q.x / TILE)] = 1; }
      let [i, j] = cellAt(p.x, p.y);
      for (let k = 0; k < DRAFT.pull && !this.nextTo(i0, j0, sz, i, j); k++) {
        const c = cellCentre(i, j), dx = m.x - c.x, dy = m.y - c.y;
        const di = Math.abs(dx) >= TILE / 2 ? Math.sign(dx) : 0, dj = Math.abs(dy) >= TILE / 2 ? Math.sign(dy) : 0;
        if ((!di && !dj) || !this.cellFree(i + di, j + dj, taken) || (di && dj && (!this.cellFree(i + di, j, taken) || !this.cellFree(i, j + dj, taken)))) break;
        i += di;
        j += dj;
      }
      const to = cellCentre(i, j);
      if (to.x === p.x && to.y === p.y) continue;
      h.from = { x: p.x, y: p.y };
      h.leap = 0;
      h.at = to;
      this.float(to.x, to.y - 16, 'сквозняк!', ZONE_COL.draft);
      this.note(M('{0} {2?протащила|протащил} {1} сквозняком', m.name, h.def.acc, d.fem));
      const haz = S.haz.has(hazKey(i, j));
      if (!haz && !this.shardAt(i, j)) continue;
      if (has(h, 'undies')) { this.pop(h, 'undies'); continue; }
      this.float(to.x, to.y, !haz ? 'осколки!' : S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
      this.hurtHero(h, S.biome.hazDmg);
    }
    const by = this.alive().filter(h => { const p = this.spot(h); return !!p && this.beside(m, p); }).sort((a, b) => dist(a) - dist(b))[0];
    if (!by || !dmg) return;
    const p = this.spot(by)!;
    this.knock(m, p.x, p.y, m.x, m.y, 0.5);
    delete m.open;
    const blk = this.hurtHero(by, dmg, '', m);
    this.noteBlow(M('{0} {3?куснула|куснул} дверцей {1} на {2}', m.name, by.def.acc, dmg, d.fem), by, blk);
  }

  /** The cells the dancer has just moonwalked over, but the ones it stands on now: they light up with its next beat. */
  private trail(m: Mob, walk: Pt[]) {
    const sz = mobSize(m.k), cells = (p: Pt) => this.footprint(...cellAt(p.x, p.y, sz), sz).map(c => hazKey(c.x, c.y));
    const now = new Set(cells(walk[walk.length - 1]));
    m.trail = [...new Set(walk.flatMap(cells))].filter(k => !now.has(k));
    this.note(M('{0} {1?ушла|ушёл} лунной походкой: след загорится на бит', m.name, MOBS[m.k].fem));
  }

  /**
   * A шестёрка's «шмон»: to the mushrooms or the crystal with charges left, the nearest by its way, when they are nearer
   * than any hero. Null when a hero is as near.
   */
  private shmon(m: Mob, hs: HeroState[]): Intent | null {
    const S = this.S, near = this.nearestOf(m, hs), hw = this.route(m, this.spot(near)!);
    let best: Intent | null = null, bd = hw ? hw.length : Infinity;
    S.nodes.forEach((n, k) => {
      if (n.left <= 0 || (n.k !== 'herb' && n.k !== 'spk')) return;
      const w = this.route(m, n);
      if (w && w.length < bd) { bd = w.length; best = { t: 'move', hero: near.i, dmg: 0, way: w, go: wayLen(w.slice(0, this.stopAt(m, w) + 1)), loot: k }; }
    });
    return best;
  }

  /** «Шмон»: a шестёрка right by the mushrooms or the crystal takes one of their charges. */
  private loot(m: Mob, k: number) {
    const n = this.S.nodes[k], d = MOBS[m.k];
    if (!n || n.left <= 0 || !this.beside(m, n)) return;
    n.left--;
    n.hit = 0.2;
    this.float(n.x, n.y - 10, 'шмон!', '#ffb070');
    this.sfx(n.k === 'spk' ? 'sparks' : 'herb');
    this.note(n.k === 'herb' ? M('{0} {1?отжала|отжал} грибы', m.name, d.fem) : M('{0} {1?отжала|отжал} искру из кристалла', m.name, d.fem));
    if (n.left <= 0) this.float(n.x, n.y - 6, 'истощено', '#c7cbe0');
  }

  /**
   * Where the fallen disco ball rolls: down one of its four lanes to whatever stops it (it never stops on a rune or a
   * hero's cell, it rolls over them), the lane with the most heroes in it, else the one most toward the nearest hero.
   * Null when it can't roll anywhere.
   */
  private rollPlan(m: Mob, hs: HeroState[]): Intent | null {
    const sz = mobSize(m.k), [i0, j0] = cellAt(m.x, m.y, sz), taken = this.occupied(m, true), near = this.spot(this.nearestOf(m, hs))!;
    let best: { way: Pt[]; spots: Pt[]; n: number; to: number } | null = null;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lane: Pt[] = [{ x: m.x, y: m.y }];
      for (let i = i0 + di, j = j0 + dj; lane.length < 40 && this.fits(i, j, sz, taken); i += di, j += dj) lane.push(cellCentre(i, j, sz));
      const way = this.rollWay(m, lane);
      if (!way) continue;
      const spots = this.swept(way, sz), n = hs.filter(h => this.underHammer(h, spots)).length, to = di * (near.x - m.x) + dj * (near.y - m.y);
      if (!best || n > best.n || (n === best.n && to > best.to)) best = { way, spots, n, to };
    }
    return best && { t: 'zone', z: 'roll', hero: -1, dmg: this.smashDmg(m), spots: best.spots, way: best.way, to: best.way[best.way.length - 1] };
  }

  /** How far down its lane the rolling ball gets now: up to whatever has come in its way, short of a rune or a hero's cell. */
  private rollWay(m: Mob, lane: Pt[]): Pt[] | null {
    const sz = mobSize(m.k), taken = this.occupied(m, true), stands = this.standCells();
    let end = 0;
    for (let k = 1; k < lane.length; k++) {
      const [i, j] = cellAt(lane[k].x, lane[k].y, sz);
      if (!this.fits(i, j, sz, taken)) break;
      if (!this.onStand(i, j, sz, stands)) end = k;
    }
    return end ? lane.slice(0, end + 1) : null;
  }

  /** The cells a body s cells wide covers along a walk, past where it starts. */
  private swept(way: Pt[], sz: number): Pt[] {
    const out = new Map<string, Pt>();
    for (const p of way.slice(1)) {
      const [i, j] = cellAt(p.x, p.y, sz);
      for (const c of this.footprint(i, j, sz)) out.set(hazKey(c.x, c.y), cellCentre(c.x, c.y));
    }
    return [...out.values()];
  }

  /**
   * Where a mob running from the heroes gets in `steps` cells, like a piece on the board (8 ways, no cutting corners, round
   * whatever a walker goes round): the cell farthest from the nearest hero, short of a rune. Null when nothing in reach
   * is farther than where it stands.
   */
  private fleeWay(m: Mob, steps: number): Pt[] | null {
    const S = this.S, gw = S.gw, sz = mobSize(m.k), taken = this.occupied(m, true), stands = this.standCells(), [si, sj] = cellAt(m.x, m.y, sz);
    const hs = this.alive().map(h => this.spot(h)).filter((p): p is Pt => !!p);
    if (!hs.length) return null;
    const far = (i: number, j: number) => { const c = cellCentre(i, j, sz); return Math.min(...hs.map(p => Math.hypot(p.x - c.x, p.y - c.y))); };
    const open = (i: number, j: number) => this.fits(i, j, sz, taken), start = sj * gw + si;
    const from = new Map<number, number>([[start, -1]]);
    let edge = [start], best = start, bd = far(si, sj) + 1e-6;
    for (let s = 0; s < steps; s++) {
      const next: number[] = [];
      for (const c of edge) {
        const ci = c % gw, cj = (c - ci) / gw;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj, k = j * gw + i;
          if ((!di && !dj) || !open(i, j) || from.has(k) || (di && dj && (!open(ci + di, cj) || !open(ci, cj + dj)))) continue;
          from.set(k, c);
          next.push(k);
          const f = far(i, j);
          if (f > bd && !this.onStand(i, j, sz, stands)) { bd = f; best = k; }
        }
      }
      edge = next;
    }
    if (best === start) return null;
    const way: Pt[] = [];
    for (let k = best; k >= 0; k = from.get(k)!) way.push(k === start ? { x: m.x, y: m.y } : cellCentre(k % gw, Math.floor(k / gw), sz));
    return way.reverse();
  }

  /** The swarm's last rats on their move: they run from the heroes, and bite one right by them only when cornered. */
  private runOff(m: Mob, hs: HeroState[]): Intent {
    const near = this.nearestOf(m, hs), way = this.fleeWay(m, this.steps(m));
    if (way) return { t: 'move', hero: near.i, dmg: 0, flee: true, way, go: wayLen(way), eta: 1 };
    const by = hs.find(h => this.beside(m, this.spot(h)!));
    return by ? { t: 'hit', hero: by.i, dmg: this.blow(m), eta: 1 } : { t: 'move', hero: near.i, dmg: 0, flee: true };
  }

  /** The dancer with a hero right by it: it moonwalks off, `moon` cells; cornered, it fires at whoever it sees as usual. */
  private backOff(m: Mob, hs: HeroState[], k: number): Intent {
    const way = this.fleeWay(m, MOBS[m.k].moon ?? 3);
    return way ? { t: 'move', hero: this.nearestOf(m, hs).i, dmg: 0, flee: true, way, go: wayLen(way), eta: 1 } : this.shoot(m, hs, k);
  }

  /**
   * The fridge on a turn without its freezer: right by a hero it bites with its door; seeing one, it opens up and throws
   * something out of itself at the nearest it sees; else it shuffles up to the nearest.
   */
  private snack(m: Mob, hs: HeroState[]): Intent {
    const by = hs.find(h => this.beside(m, this.spot(h)!));
    if (by) return this.chase(m, by, this.route(m, this.spot(by)!));
    const seen = hs.filter(h => this.sees(m, h));
    if (!seen.length) return this.goAfter(m, hs);
    const h = this.nearestOf(m, seen), item = (this.S.turn + h.i) % FOOD_TOSS.length;
    return { t: 'toss', hero: h.i, dmg: this.tossDmg(m, item), item };
  }

  /** What the fridge's throw of FOOD_TOSS[item] deals: a share of its blow, rage on top, less from the gas; the boxers nothing. */
  private tossDmg(m: Mob, item: number) {
    const k = FOOD_TOSS[item].k;
    return k ? this.cut(m, Math.max(1, Math.round(m.dmg * k)) + this.honed(m) + this.rage()) : 0;
  }

  /**
   * The rat swarm down its burrow: on its next move it comes up right by the hole its eyes glow in, on the free spot nearest
   * a hero, and bites everyone on the cells round it (marked a turn ahead).
   */
  private emerging(m: Mob): Intent {
    const to = this.burrowExit(m);
    if (!to) return { t: 'emerge', hero: -1, dmg: 0, spots: [] };
    const sz = mobSize(m.k), spots = this.around(this.footprint(...cellAt(to.x, to.y, sz), sz), 1).filter(c => isFloor(this.S, c.x, c.y)).map(c => cellCentre(c.x, c.y));
    return { t: 'emerge', hero: -1, dmg: this.zoneDmg(m), spots, to };
  }

  /** Where the swarm down its burrow can come up: a spot it fits on right by its hole, the nearest to `near` (or to a hero). */
  private burrowExit(m: Mob, near?: Pt): Pt | null {
    const S = this.S, pit = S.pits[m.under!], sz = mobSize(m.k), taken = this.occupied(m, true), stands = this.standCells(), out: Pt[] = [];
    if (!pit) return null;
    for (const c of this.around(pit.cells.map(([x, y]) => ({ x, y })), 1)) for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) {
      const i = c.x - a, j = c.y - b;
      if (this.fits(i, j, sz, taken) && !this.onStand(i, j, sz, stands)) out.push(cellCentre(i, j, sz));
    }
    if (!near) return this.nearestHero(out);
    return out.sort((p, q) => Math.hypot(p.x - near.x, p.y - near.y) - Math.hypot(q.x - near.x, q.y - near.y))[0] ?? null;
  }

  /**
   * The rat swarm digs a new burrow by the hero it is after as it goes down (up to `digs` in a fight): a 1 × 1 hole two
   * cells out from the hero, on the side nearest the swarm, on open floor away from the other holes, the runes and the heroes.
   */
  private dig(m: Mob, p: Pt) {
    const S = this.S, d = MOBS[m.k];
    if (!d.digs || S.pits.filter(q => q.dug).length >= d.digs) return;
    const taken = this.occupied(null, true), stands = this.standCells();
    let best: Pt | null = null, bd = Infinity;
    for (const c of this.around([{ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }], 2)) {
      const k = hazKey(c.x, c.y);
      if (!this.cellFree(c.x, c.y, taken) || stands.has(k) || S.haz.has(k) || this.shardAt(c.x, c.y)) continue;
      if (S.pits.some(q => q.cells.some(([i, j]) => Math.max(Math.abs(i - c.x), Math.abs(j - c.y)) < 2))) continue;
      const o = cellCentre(c.x, c.y), far = Math.hypot(o.x - m.x, o.y - m.y);
      if (far < bd) { bd = far; best = c; }
    }
    if (!best) return;
    S.pits.push({ k: '1x1', cells: [[best.x, best.y]], dug: true });
    const c = cellCentre(best.x, best.y);
    this.burst(c.x, c.y, '#b7a07a', 12);
    this.float(c.x, c.y - 10, 'новая нора!', '#b7a07a');
    this.note(M('{0} {1?вырыла|вырыл} новую нору', m.name, d.fem));
  }

  /** The rat swarm goes down the hole nearest the hero it is after: its eyes glow there through the heroes' turn. */
  private dive(m: Mob, it: Intent) {
    const S = this.S, d = MOBS[m.k], at = this.spot(this.heroOf(it.hero)), p = at ?? m;
    if (at) this.dig(m, at);
    const dist = (k: number) => Math.min(...S.pits[k].cells.map(([i, j]) => { const c = cellCentre(i, j); return Math.hypot(c.x - p.x, c.y - p.y); }));
    const k = S.pits.map((_, k) => k).sort((a, b) => dist(a) - dist(b))[0];
    if (k === undefined) return;
    this.burst(m.x, m.y, '#b7a07a', 14);
    const cs = S.pits[k].cells.map(([i, j]) => cellCentre(i, j));
    m.under = k;
    m.x = m.fx = m.tx = cs.reduce((n, c) => n + c.x, 0) / cs.length;
    m.y = m.fy = m.ty = cs.reduce((n, c) => n + c.y, 0) / cs.length;
    m.walk = undefined;
    this.sfx('pit');
    this.float(m.x, m.y - 10, 'в нору!', '#b7a07a');
    this.note(M('{0} {1?нырнула|нырнул} в нору: в яме светятся глаза', m.name, d.fem));
  }

  /** The rat swarm comes up out of its burrow where it meant to (or the nearest spot still free) and bites the heroes on the marked cells by it. */
  private emerge(m: Mob, it: Intent) {
    const S = this.S, d = MOBS[m.k], sz = mobSize(m.k);
    const fit = (p: Pt) => { const [i, j] = cellAt(p.x, p.y, sz); return this.fits(i, j, sz, this.occupied(m, true)) && !this.onStand(i, j, sz, this.standCells()); };
    const to = it.to && fit(it.to) ? it.to : this.burrowExit(m, it.to);
    if (!to) { this.float(m.x, m.y - 10, 'шуршит…', '#b7a07a'); this.note(M('{0} шуршит в норе', m.name)); return; }
    delete m.under;
    m.x = m.fx = m.tx = to.x;
    m.y = m.fy = m.ty = to.y;
    m.flash = 0.12;
    S.shake = Math.max(S.shake, 0.25);
    this.sfx('slam');
    this.float(m.x, m.y - 12, 'ИЗ НОРЫ!', ZONE_COL.bite);
    this.burst(m.x, m.y, '#b7a07a', 16);
    const hit = this.alive().filter(h => { const p = this.spot(h); return !!p && this.beside(m, p) && this.underHammer(h, it.spots ?? []); });
    if (!hit.length) this.note(M('{0} {1?вылезла|вылез} из норы, но никого не {1?достала|достал}', m.name, d.fem));
    for (const h of hit) {
      const blk = this.hurtHero(h, it.dmg, '', m);
      this.noteBlow(M('{0} {3?вылезла|вылез} из норы и {3?укусила|укусил} {1} на {2}', m.name, h.def.acc, it.dmg, d.fem), h, blk);
    }
    this.tremor(m.x, m.y, 0.6, m);
  }

  /** The fridge throws food out of itself at a hero it sees, its door left open till its next move: pickles, a frozen chicken, the boxers. */
  private toss(m: Mob, it: Intent) {
    const d = MOBS[m.k], h = this.heroOf(it.hero), p = this.spot(h), f = FOOD_TOSS[it.item ?? 0];
    if (h.hp <= 0 || !p) return;
    const L = Math.hypot(p.x - m.x, p.y - m.y) || 1;
    m.open = { x: (p.x - m.x) / L, y: (p.y - m.y) / L };
    if (!this.sees(m, h)) { this.float(m.x, m.y, 'не видит', '#c7cbe0'); this.note(M('{0} не {2?увидела|увидел} {1}', m.name, h.def.acc, d.fem)); return; }
    this.knock(m, m.x, m.y, p.x, p.y, 0.4);
    m.flash = 0.12;
    this.sfx('launch', 0.6);
    this.float(m.x, m.y - 14, M('{0}!', f.name), '#e8f6ff');
    if (f.k) {
      const blk = this.hurtHero(h, it.dmg, '', m);
      this.noteBlow(M('{0} {4?швырнула|швырнул} {1} в {2} на {3}', m.name, f.acc, h.def.acc, it.dmg, d.fem), h, blk);
    } else {
      this.float(p.x, p.y - 14, 'семейники на голове!', '#ff9ab8');
      this.note(M('{0} {3?надела|надел} {1} на голову {2}: линии прицела нет', m.name, h.def.dat, f.acc, d.fem));
    }
    if (f.chill) this.chillHero(h);
    if (f.daze && h.hp > 0) h.daze = 2;
  }

  /** «Подогрев»: Пахан treats his шестёрки to chifir, each hits harder (up to the act's cap) and holds out longer. */
  private brew(m: Mob) {
    const S = this.S, d = MOBS[m.k], a = d.acts?.find(o => o.k === 'brew');
    if (!a) return;
    const up = Math.max(1, Math.round((a.amt ?? 2) * S.dmgMul)), most = Math.floor((a.cap ?? 4) / (a.amt ?? 2)), hp = Math.max(1, Math.round(3 * partyScale(S.spec).hp));
    m.flash = 0.12;
    this.sfx('herb');
    this.float(m.x, m.y - 12, 'ПОДОГРЕВ', '#ffb070');
    for (const o of this.sixes(m)) {
      if ((o.brew ?? 0) < most) { o.brew = (o.brew ?? 0) + 1; o.dmg += up; }
      o.hp += hp;
      o.max += hp;
      this.float(o.x, o.y - 12, 'чифир!', '#ffb070');
      this.burst(o.x, o.y, '#c98a3a', 8);
    }
    this.note(M('{0} {1?подогрела|подогрел} шестёрок чифиром: бьют сильнее и держат больше', m.name, d.fem));
  }

  /** The fridge's freezer holds a hero to its cell through its next turn: it throws, but doesn't go over to its discs. */
  private pinHero(h: HeroState) {
    if (h.hp <= 0) return;
    h.pin = 2;
    const p = this.spot(h);
    if (p) this.float(p.x, p.y - 16, 'примёрз!', '#7fd8ff');
  }

  /**
   * A floor boss's marked cells go off: the freezer freezes whoever stands in it, the dragon's belch sets them on fire, the
   * dancefloor, the beams and the rolling ball hit them. The rolling ball crushes only those on the cells it really rolls over.
   */
  private zoneAct(m: Mob, it: Intent) {
    const S = this.S, d = MOBS[m.k], z = it.z ?? 'cold', spots = it.spots ?? [], col = ZONE_COL[z];
    const rolled = z === 'roll' ? this.swept(m.walk ?? [], mobSize(m.k)) : spots;
    const hit = this.alive().filter(h => this.underHammer(h, spots) && this.underHammer(h, rolled));
    if (z === 'cold' && spots.length) {
      // the freezer is behind the door: it stays open till the fridge's next move
      const c = spots.reduce((o, p) => ({ x: o.x + p.x / spots.length, y: o.y + p.y / spots.length }), { x: 0, y: 0 }), L = Math.hypot(c.x - m.x, c.y - m.y) || 1;
      m.open = { x: (c.x - m.x) / L, y: (c.y - m.y) / L };
    }
    m.flash = 0.12;
    S.shake = Math.max(S.shake, z === 'roll' ? 0.35 : 0.2);
    this.sfx(z === 'cold' || z === 'wall' || z === 'draft' ? 'freeze' : z === 'fire' || z === 'cast' ? 'boom' : 'slam');
    this.float(m.x, m.y - 12, ZONE_CRY[z], col);
    // a spark or two over the cells, not too many for a phone
    for (let k = 0; k < spots.length; k += Math.max(1, Math.floor(spots.length / 24))) this.burst(spots[k].x, spots[k].y, col, 2);
    if (z === 'dance') delete m.trail;
    if (z === 'wall') return this.iceUp(m, spots);
    if (z === 'draft') return this.draft(m, hit, it.dmg);
    if (z === 'fire' && d.smog) {
      // the belch leaves smoke behind: it hangs through the heroes' next turn
      S.smog = true;
      this.float(m.x, m.y - 24, 'ДЫМ!', '#c9c2d8');
      this.note(M('{0}: комнату затянуло дымом', m.name));
    }
    if (!hit.length) this.note(M('{0}: {1} мимо', m.name, ZONE_NAME[z]));
    for (const h of hit) {
      // the freezer and the belch hit as well (thread «Сложность боссов»), then freeze or set on fire whoever is still up
      if (z === 'cold') {
        const blk = it.dmg ? this.hurtHero(h, it.dmg, '', m) : 0;
        if (it.dmg) this.noteBlow(M('{0}: морозилка по {1} на {2}', m.name, h.def.dat, it.dmg), h, blk);
        this.pinHero(h);
        this.chillHero(h);
        if (h.hp > 0) this.note(M('{0} {2?заморозила|заморозил} {1}: ход без перехода к диску', m.name, h.def.acc, d.fem));
      } else if (z === 'fire') {
        const blk = it.dmg ? this.hurtHero(h, it.dmg, '', m) : 0;
        if (it.dmg) this.noteBlow(M('{0}: отрыжка по {1} на {2}', m.name, h.def.dat, it.dmg), h, blk);
        if (h.hp <= 0) continue;
        h.fire = Math.max(h.fire, 2);
        const p = this.spot(h);
        if (p) { this.float(p.x, p.y - 8, 'горит!', '#ff7a3d'); this.burst(p.x, p.y, '#ff7a3d', 8); }
        this.note(M('{0} {2?рыгнула|рыгнул} огнём: {1} горит', m.name, h.def.name, d.fem));
      } else {
        const blk = this.hurtHero(h, it.dmg, '', m);
        this.noteBlow(M('{0}: {1} по {2} на {3}', m.name, ZONE_NAME[z], h.def.dat, it.dmg), h, blk);
      }
    }
    if (z === 'roll') this.tremor(m.x, m.y, 1, m);
    if (z === 'cast') this.pour(m, spots);
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
    if (!d.fan) tallyOf(d.hero).walls++;
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
    const boxes = [...standing(this.S.blocks), ...this.S.rock, ...this.fixtures()];
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
        if (!d.fan) tallyOf(d.hero).holes++;
        // the rat swarm's eyes glow down this hole: the disc lands on its heads, twice as hard, and costs the hero nothing
        const rats = d.fan ? null : S.mobs.find(o => o.hp > 0 && o.under !== undefined && S.pits[o.under] === pit);
        if (rats) {
          d.hits++;
          this.float(d.x, d.y - 10, M('по макушке! ×{0}', WEAK_MUL), '#ffe27a');
          this.hurtMob(rats, Math.ceil((d.m * v0) / 120) * WEAK_MUL, '#ffe27a', false, 0.8, d.hero);
        // a phantom just melts away down there
        } else if (!d.fan) { this.float(d.x, d.y, 'провал', '#c7cbe0'); this.hurtHero(d.hero, 2); }
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
      for (const b of [...S.rock, ...this.fixtures()]) { const vn = this.bounceBox(d, b, this.keep(d)); if (vn > 0) this.bounced(d, vn, ...this.boxNormal(d, b)); }
      if (this.eat(d)) changed = true;
      if (this.grab(d)) changed = true;
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
        if (n.k === 'ore') { const k = all ? n.left : 1, got = q * k; n.left -= k; this.bank.ore += got; this.mined += got; tallyOf(h).ore += got; this.float(n.x, n.y, M('+{0} руда', got), '#ffb070'); }
        // sparks go to every hero still standing, whoever threw the disc, each up to what one ability costs; the crystal
        // loses only what was taken, so sparks nobody had room for stay in it for later
        if (n.k === 'spk') {
          const live = this.alive();
          let got = 0;
          for (const o of live) { const k = Math.min(all ? AB_COST : q, n.left, AB_COST - o.sparks); o.sparks += k; got = Math.max(got, k); }
          n.left -= got;
          this.float(n.x, n.y, !got ? 'искры полны' : live.length > 1 ? M('+{0} {0|искра|искры|искр} всем', got) : M('+{0} {0|искра|искры|искр}', got), '#c9a8ff');
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
        // the disco ball on its chain turns away a disc flying straight at it: only one off a wall or another enemy hurts it
        const mirrored = !!MOBS[m.k].mirror && d.bounces === 0 && d.hits === 0;
        // straight from the rune into the enemy, square on: a precise throw hits much harder («Бильярдный мел»: off the walls too)
        const crit = !mirrored && (d.bounces === 0 || has(h, 'chalk')) && d.hits === 0 && vn >= v * CRIT_COS;
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
        const at = S.mobs.indexOf(m), foes = (d.foes ??= []);
        if (!d.fan && !foes.includes(at)) { foes.push(at); t.multi = Math.max(t.multi, foes.length); }
        // the ability goes first: fire on an enemy this very hit kills leaps on to the next one
        if (d.ab) this.abilityHit(d, m);
        if (mirrored) { this.float(m.x, m.y - 14, 'зеркало!', '#ffe27a'); this.burst(d.x, d.y, '#fff6c8', 10); this.sfx('armor'); }
        else {
          // the guard's door takes a disc from the front: the blow comes through it at half, «ТОЧНО!» and the rest counted first
          if (this.shielded(m, d.x, d.y)) { dmg = Math.max(1, Math.ceil(dmg * DOOR_MUL)); this.float(m.x, m.y - 14, 'дверь!', '#c7cbe0'); this.sfx('armor'); }
          this.strike(m, d, dmg, has(h, 'opener'), Math.min(1, vn / 250));
        }
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
        for (const o of new Set([a.hero, b.hero])) {
          if (has(o, 'bells')) this.pop(o, 'bells');
          tallyOf(o).clangs++;
        }
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ka = this.ring(a.hero), kb = this.ring(b.hero);
        this.float(mx, my, ka === kb ? M('ЗВОН ×{0}', ka) : M('ЗВОН ×{0}/×{1}', Math.min(ka, kb), Math.max(ka, kb)), '#b893ff');
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
  private land(d: Disc, still = false) {
    const S = this.S;
    if (d.fall || d.fan || d.hero.hp <= 0) return;
    if (!d.hits) this.float(d.x, d.y, 'мимо', '#c7cbe0');
    // a hero frozen to its cell doesn't go over to the disc, so nothing under it hurts the hero
    if (still) return;
    // the disco ball's mirror tiles cut like spikes
    const i = Math.floor(d.x / TILE), j = Math.floor(d.y / TILE), haz = S.haz.has(hazKey(i, j));
    if (!haz && !this.shardAt(i, j)) return;
    // «Надувные труселя»: spikes and lava under the disc don't hurt
    if (has(d.hero, 'undies')) this.pop(d.hero, 'undies');
    else {
      this.float(d.x, d.y, !haz ? 'осколки!' : S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
      this.hurtHero(d.hero, S.biome.hazDmg);
    }
  }

  /**
   * Host: the heroes' turn is over. Every disc still on the table comes to rest where it lies, and each hero goes over to
   * the last disc it threw this turn that is still on the floor: when the last one dropped into a hole, to the one before
   * it, and so on. Its other discs are cleared away. A hero whose discs all dropped into holes, or frozen to its cell by
   * the fridge, stays where it stood.
   */
  private follow() {
    const S = this.S, movers: [HeroState, Disc][] = [];
    for (const d of S.discs) d.vx = d.vy = 0;
    for (const h of S.heroes) {
      if (h.hp <= 0 || !this.spot(h)) continue;
      // a miss «Бумеранг» brought back is in the hand, and the card sharp goes after the disc he aimed, not a phantom
      const mine = S.discs.filter(d => d.hero === h && !d.back && !d.fan), to = mine.filter(d => !d.fall && !d.gone).pop();
      for (const d of mine) {
        if (d.gone || d.held) continue;
        d.held = true;
        this.land(d, !!h.pin);
        // the other discs nobody goes over to are cleared away, all of them for a hero frozen to its cell
        if ((d !== to || h.pin) && !d.fall) d.gone = true;
      }
      if (to && !h.pin) movers.push([h, to]);
    }
    if (movers.length) this.regroup(movers);
  }

  /**
   * Heroes go over to where their discs stopped: to the cell holding most of the disc, or, when that cell is taken,
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
    // the dragon's smoke has hung through the heroes' turn
    delete S.smog;
    for (const h of this.alive()) {
      if (h.fire <= 0) continue;
      h.fire--;
      const blk = this.hurtHero(h, 2, 'горит');
      this.noteBlow(blk < 2 ? M('{0} горит: −{1}', h.def.name, 2 - blk) : M('{0} горит', h.def.name), h, blk);
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
      // the fridge shuts its door as its move begins
      delete m.open;
      const burnt = m.burn > 0, gassed = this.inGas(m);
      // fire takes as many HP as it has, through armour, and dies down by one
      if (burnt) {
        const fire = m.burn--;
        this.hurtMob(m, fire, '#ff7a3d', true);
        this.note(M('{0} горит: −{1}', m.name, fire));
        if (m.hp <= 0) this.note(M('{0} {1?сгорела|сгорел}', m.name, MOBS[m.k].fem));
      }
      // the gas it starts its move in chokes it, through armour too
      if (gassed && m.hp > 0) {
        const gas = gasDmg(m.max);
        this.hurtMob(m, gas, '#b9e34f', true);
        this.note(M('{0} дышит газом: −{1}', m.name, gas));
        if (m.hp <= 0) this.note(M('{0} {1?задохнулась|задохнулся}', m.name, MOBS[m.k].fem));
      }
      // kissed, it looks for the nearest other enemy as its move begins: the ones before it have moved, some have fallen
      if (m.kiss !== undefined && m.hp > 0) m.intent = this.charm(m);
      // one going for a kissed enemy sizes it up where it stands now: it may have walked off on its own move
      else if (m.hp > 0 && m.intent?.foe !== undefined && this.lover(S.mobs[m.intent.foe])) m.intent = this.lit(m, this.toward(m, S.mobs[m.intent.foe]));
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
    if (m.hp <= 0 || !it || this.frozen(m)) return;
    // the fallen disco ball rolls down its lane as far as it gets now; one running from the heroes runs from where they stand now
    if (it.t === 'zone' && it.z === 'roll') { this.setWalk(m, this.rollWay(m, it.way ?? [])); return; }
    if (it.flee) { this.setWalk(m, this.fleeWay(m, MOBS[m.k].flees ? this.steps(m) : MOBS[m.k].moon ?? 3)); return; }
    // a шестёрка on «шмон» goes to the resource, as long as it still has charges
    const node = it.loot !== undefined ? this.S.nodes[it.loot] : null;
    if (node) {
      const way = node.left > 0 && m.speed > 0 ? this.route(m, node) : null;
      if (way) this.setWalk(m, way.slice(0, this.stopAt(m, way) + 1));
      return;
    }
    const foe = it.foe !== undefined ? this.S.mobs[it.foe] : null;
    if ((it.t !== 'hit' && it.t !== 'move' && it.t !== 'charge') || (it.hero < 0 && !foe) || m.speed === 0) return;
    // one drawn by a firecracker runs to where it crackled, even when another enemy has set it off on the way; a kissed one
    // goes for the other enemy, a shooter only till it sees it
    const h = this.heroOf(it.hero), p = foe ?? it.bang ?? this.spot(h), aim = !it.bang && isRanged(m.k);
    if (!p || (foe ? foe.hp <= 0 || (aim && this.clearShot(m, foe)) : !it.bang && (h.hp <= 0 || (aim && this.sees(m, h))))) return;
    // the room has changed since the intent was picked: the enemies before it have moved, an icicle may have broken
    const way = this.route(m, p, true, aim);
    if (!way) return;
    this.setWalk(m, way.slice(0, this.stopAt(m, way) + 1));
  }

  private setWalk(m: Mob, walk: Pt[] | null) {
    if (!walk || walk.length < 2) return;
    m.walk = walk;
    m.tx = walk[walk.length - 1].x;
    m.ty = walk[walk.length - 1].y;
  }

  /** An enemy with nothing to do on its move: walled off, or the one it was after has already fallen. */
  private idle(m: Mob) {
    const it = m.intent!;
    if (it.t === 'idle') return true;
    // frozen stiff, it still takes its turn to stand there; kissed with nobody to go for, to sigh
    if (this.frozen(m) || it.sigh) return false;
    // an egg not hatching yet, Пахан with no шестёрка left to treat
    if (m.k === 'egg') return it.eta !== 1;
    if (it.t === 'brew') return !this.sixes(m).length;
    if (it.foe !== undefined) { const o = this.S.mobs[it.foe]; return !o || o.hp <= 0 || (it.t === 'move' && !m.walk); }
    // a шестёрка on «шмон» right by the resource takes its charge where it stands
    if (it.t === 'move') return !m.walk && it.loot === undefined;
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
   * Cells nobody can step on: under blocks, resources, pits (a 2 × 2 `self` steps over the small ones) and (with `mobs`)
   * the enemies other than `self`, at the cells they will stand on this turn. 1 = taken, row-major gw × gh.
   */
  occupied(self: Mob | null, mobs: boolean) {
    const S = this.S, gw = S.gw, out = new Uint8Array(gw * S.gh);
    const mark = (i: number, j: number, sz = 1) => {
      for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (i + a >= 0 && j + b >= 0 && i + a < gw && j + b < S.gh) out[(j + b) * gw + i + a] = 1;
    };
    for (const b of standing(S.blocks)) mark(Math.floor(b.x0 / TILE), Math.floor(b.y0 / TILE));
    for (const n of S.nodes) if (n.left > 0) mark(...cellAt(n.x, n.y, n.s), n.s);
    for (const p of S.pits) if (stops(p, self ? mobSize(self.k) : 1)) for (const [i, j] of p.cells) mark(i, j);
    if (mobs) for (const o of S.mobs) {
      // the swarm down a burrow stands nowhere
      if (o === self || o.hp <= 0 || o.under !== undefined) continue;
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

  /** Whether the point p lies within r cells of the mob, kingwise from its footprint: 1 is right by it. */
  private within(m: Mob, p: Pt, r: number) {
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz), ti = Math.floor(p.x / TILE), tj = Math.floor(p.y / TILE);
    return Math.max(i - ti, ti - i - sz + 1, j - tj, tj - j - sz + 1) <= r;
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
      this.note(M('{0} {1?заморожена|заморожен} и пропускает ход', m.name, d.fem));
      return;
    }
    // the dragon has had its go at whoever broke its egg: it sits back down
    if (m.mad !== undefined && (it.t === 'hit' || it.t === 'move')) { delete m.mad; m.speed = d.speed; }
    if (it.t === 'rise' && m.k === 'egg') {
      if (it.eta === 1) { this.hatch(m); this.sfx('ability'); }
    } else /* demo-cut: the coffins */ if (it.t === 'rise') {
      m.rise = (m.rise ?? COFFIN_TURNS) - 1;
      if (m.rise > 0) {
        this.float(m.x, m.y - 10, 'скрип…', '#b7a07a');
        this.note(M('В гробу ворочается {0:l}', MOBS[m.hold!].name));
        m.intent = this.rising(m);
        return;
      }
      // the lid flies off: the enemy in it stands up whole, in the coffin's place in the order
      const o = this.spawn(m.hold!, m.x, m.y);
      Object.assign(m, o, { owner: m.owner, born: 1, intent: null, hold: undefined, rise: undefined });
      this.burst(m.x, m.y, '#b7a07a', 16);
      this.sfx('ability');
      this.float(m.x, m.y - 12, 'встал из гроба!', '#c9a8ff');
      this.note(M('{0} {1?встала|встал} из гроба', m.name, MOBS[m.k].fem));
    } else if (it.t === 'scream') {
      m.flash = 0.12; S.shake = 0.2;
      this.sfx('slam');
      this.float(m.x, m.y - 10, 'ВИЗГ', '#bfe6ff');
      this.note(M('{0} {1?завизжала|завизжал}: у отряда звенит в ушах, линии прицела нет', m.name, d.fem));
      for (const h of this.alive()) this.dazeHero(h);
    } else if (it.t === 'smash') {
      m.flash = 0.12; S.shake = 0.35;
      this.sfx('slam');
      this.float(m.x, m.y - 10, 'МОЛОТ!', '#ff7a3d');
      const hit = this.alive().filter(h => this.underHammer(h, it.spots!));
      for (const p of it.spots!) this.burst(p.x, p.y, '#ff7a3d', 4);
      if (!hit.length) this.note(M('{0} {1?ударила|ударил} молотом мимо', m.name, d.fem));
      for (const h of hit) {
        const blk = this.hurtHero(h, it.dmg, '', m);
        this.noteBlow(M('{0} {3?ударила|ударил} молотом {1} на {2}', m.name, h.def.acc, it.dmg, d.fem), h, blk);
      }
      this.tremor(m.x, m.y, 1, m);
    } else if (it.t === 'slam') {
      m.flash = 0.12; S.shake = 0.3;
      this.sfx('slam');
      this.float(m.x, m.y - 10, it.chill ? 'МЕТЕЛЬ' : 'УДАР ОБ ПОЛ', it.chill ? '#bfe6ff' : '#ffd34d');
      this.note(it.chill ? M('{0}: метель по всем на {1}', m.name, it.dmg) : M('{0}: удар по всем на {1}', m.name, it.dmg));
      for (const h of this.alive()) {
        const blk = this.hurtHero(h, it.dmg, '', m);
        if (blk) this.note(M('{0}: щит принял {1}', h.def.name, blk));
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
      this.note(M('{0} {3?подлечила|подлечил} {1} на {2}', m.name, MOBS[o.k].acc, hl, d.fem));
    } else if (it.t === 'summon') {
      const kind = d.acts!.find(a => a.k === 'summon')!.kind!, mi = S.mobs.indexOf(m), n = it.spots?.length ?? 0;
      this.float(m.x, m.y - 10, 'призыв!', '#c9a8ff');
      this.sfx('ability');
      this.note(n > 1 ? M('{0} {3?призвала|призвал} {1:l} ×{2}', m.name, MOBS[kind].acc, n, d.fem) : M('{0} {2?призвала|призвал} {1:l}', m.name, MOBS[kind].acc, d.fem));
      for (const p of it.spots ?? []) {
        // a disc may have come to rest on the circle; the mob still rises, the disc is long gone by then
        const o = this.spawn(kind, p.x, p.y);
        o.owner = mi; o.born = 1;
        S.mobs.push(o);
        this.burst(p.x, p.y, '#b893ff', 16);
      }
    } else if (it.t === 'heat') {
      this.float(m.x, m.y - 10, 'РАСКАЛЯЕТ ПОЛ', '#ff7a3d');
      this.sfx('ability');
      this.note(M('{0} {1?раскалила|раскалил} пол', m.name, d.fem));
      for (const p of it.spots ?? []) { S.haz.add(hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))); this.burst(p.x, p.y, '#ff7a3d', 10); }
    } else if (it.t === 'charge') {
      this.float(m.x, m.y - 10, 'фитиль горит', '#ffb070');
      this.sfx('launch', 0.3);
      const lit = M('{0} {1?подожгла|поджёг} фитиль', m.name, d.fem);
      this.note(!m.walk ? lit : it.foe !== undefined ? M('{0} и {1?пошла|пошёл} на линию огня', lit, d.fem) : M('{0} и {2?пошла|пошёл} к {1}', lit, this.heroOf(it.hero).def.dat, d.fem));
    } else if (it.t === 'zone') this.zoneAct(m, it);
    else if (it.t === 'emerge') this.emerge(m, it);
    else if (it.t === 'dive') this.dive(m, it);
    else if (it.t === 'toss') this.toss(m, it);
    else if (it.t === 'brew') this.brew(m);
    else if (it.sigh) {
      const by = S.heroes.find(h => h.i === m.kiss);
      this.float(m.x, m.y - 10, 'вздыхает…', '#ff9ab8');
      this.note(by ? M('{0} вздыхает по {1} и никого не бьёт', m.name, by.def.dat) : M('{0} вздыхает и никого не бьёт', m.name));
    } else if (it.foe !== undefined) {
      this.charmed(m);
    } else if (it.loot !== undefined) {
      this.loot(m, it.loot);
    } else if (it.flee && d.trail && m.walk) {
      this.trail(m, m.walk);
    } else if (it.t === 'move') {
      // walled off, it stayed put: nothing to tell
      if (m.walk) this.note(it.bang ? M('{0} {1?побежала|побежал} на треск петарды', m.name, d.fem) : M('{0} идёт к {1}', m.name, this.heroOf(it.hero).def.dat));
    } else if (it.t === 'hit') {
      const h = this.heroOf(it.hero);
      const p = this.spot(h);
      if (h.hp <= 0 || !p) return;
      // a shooter fires only at a hero it sees, a walker strikes only from right next to it
      if (isRanged(m.k) ? this.sees(m, h) : this.beside(m, p)) {
        // up close the enemy lunges at the hero; a shooter rocks back from its shot
        if (isRanged(m.k)) this.knock(m, m.x, m.y, p.x, p.y, 0.3);
        else this.knock(m, p.x, p.y, m.x, m.y, 0.5);
        // the fridge shuts its door to bite with it
        if (!isRanged(m.k)) delete m.open;
        const blk = this.hurtHero(h, it.dmg, '', m); m.flash = 0.12;
        const how = !isRanged(m.k) ? M('{0} {2?ударила|ударил} {1}', m.name, h.def.acc, d.fem) : d.charge ? M('{0} {2?бросила|бросил} бомбу в {1}', m.name, h.def.acc, d.fem)
          : M(SHOT[m.k] ?? '{0} {2?выстрелила|выстрелил} в {1}', m.name, h.def.acc, d.fem);
        this.noteBlow(M('{0} на {1}', how, it.dmg), h, blk);
        if (d.pot) this.steal(m, h);
        // «Ёж в штанах» pricks whoever strikes up close
        if (!isRanged(m.k) && has(h, 'hedgehog')) {
          this.float(m.x, m.y - 12, 'ёж!', '#c9a86a');
          this.pop(h, 'hedgehog');
          this.hurtMob(m, ART.hedgehog, '#c9a86a', true, 0.5);
          const prick = M('Ёж уколол {0} на {1}', d.acc, ART.hedgehog);
          this.note(m.hp <= 0 ? M('{0}, {1?пала|пал}', prick, d.fem) : prick);
        }
        if (d.chill && h.hp > 0) this.chillHero(h);
        if (d.fire && h.hp > 0) { h.fire = Math.max(h.fire, 1); this.float(p.x, p.y - 8, 'горит!', '#ff7a3d'); }
      } else if (isRanged(m.k)) {
        this.float(m.x, m.y, 'не видит', '#c7cbe0');
        this.note(M('{0} не {2?увидела|увидел} {1}', m.name, h.def.acc, d.fem));
      } else {
        this.float(m.x, m.y, 'не достал', '#c7cbe0');
        this.note(M('{0} не {2?достала|достал} {1}', m.name, h.def.acc, d.fem));
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
    // the frost wears off after one enemy turn, a kiss after its turns, a cloud of gas thins out turn by turn, a firecracker
    // nobody came to fizzles out
    for (const m of S.mobs) {
      delete m.frost;
      if (m.kiss !== undefined && (m.kissLeft = (m.kissLeft ?? 1) - 1) > 0) continue;
      delete m.kiss;
      delete m.kissLeft;
    }
    // the cuffs hold for their turns, the cop cuffs anew next turn
    if (S.cuffs && --S.cuffs.left <= 0) S.cuffs = null;
    S.gas = S.gas.filter(g => --g.left > 0);
    for (const b of S.bombs) if (--b.left <= 0) { this.float(b.x, b.y - 10, 'пшик', '#c9c2b4'); this.burst(b.x, b.y, '#9a948a', 8); }
    S.bombs = S.bombs.filter(b => b.left > 0);
    for (const h of S.heroes) if (h.hp > 0 && has(h, 'cup')) this.pop(h, 'cup');
    for (const h of S.heroes) { delete h.cuffing; h.shield = h.hp > 0 && has(h, 'cup') ? ART.cup : 0; h.thrown = false; h.boost = false; h.hand = h.hp > 0 ? this.handOf(h) : 0; if (h.chill > 0) h.chill--; if (h.daze > 0) h.daze--; if (h.pin && --h.pin <= 0) delete h.pin; }
    S.phase = 'throw';
    this.sfx('yourTurn');
    this.pickActive();
    this.pickIntents();
    if (this.rage() > 0) { this.float(S.Wx / 2, S.Wy / 2, M('ВРАГИ ЗВЕРЕЮТ +{0}', this.rage()), '#ff4d6a'); S.shake = Math.max(S.shake, 0.15); }
    this.onChange();
  }

  private finish() {
    const S = this.S, win = this.alive().length > 0;
    S.phase = 'over';
    this.wounds = win && S.spec.type === 'boss' ? S.heroes.map(h => ({ i: h.i, hp: Math.max(0, h.hp), max: h.max })) : null;
    if (win && S.spec.type === 'boss') this.bossHeal();
    // the turn a fight was won on, for «Ромашковый чай»'s feat; the cave and the warm-up are no fights
    if (win && S.spec.type !== 'treasure' && !S.spec.tut) for (const h of S.heroes) tallyOf(h).late = Math.max(tallyOf(h).late, S.turn);
    // a fight won without a scratch pays the party ore, as much for any party; the ore cave has nobody to scratch them
    if (win && S.spec.type !== 'treasure' && !S.hurt) {
      this.clean = CLEAN_ORE;
      this.bank.ore += this.clean;
      this.float(S.Wx / 2, S.Wy / 2, M('БЕЗ ЦАРАПИНЫ +{0}', this.clean), '#ffd34d');
    }
    // the bookie's bet: a trophy on a fight without a scratch, a level on one won in three turns
    if (win && S.spec.bet) {
      const ok = S.spec.bet === 'art' ? !S.hurt : S.turn <= BET_TURNS;
      this.betLine = settleBet(S.spec.bet, ok, this.party, S.spec.seed);
      this.float(S.Wx / 2, S.Wy / 2 + 26, ok ? 'ПАРИ ВЫИГРАНО' : 'ПАРИ ПРОИГРАНО', ok ? '#7fe08a' : '#ff4d6a');
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
    if (S.trinket?.by !== undefined) S.trinket.t += dt;
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter(f => f.t < 1.6);
  }
}
