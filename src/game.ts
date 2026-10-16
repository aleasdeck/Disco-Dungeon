// Combat rules: turn flow, disc physics, damage, abilities.
// Rendering and input live elsewhere; this module only changes state.

import { AB_COST, CRIT, CRIT_COS, E_MAX, HAND_COST, HAND_MAX, HAND_START, HEROES, MOBS, MOB_E, NODE_E, RAGE_FROM, RAGE_FROM_BOSS, TILE, UPS, UP_COST, isRanged, mobSize, type HeroDef, type MobAct, type StatKey } from './data';
import { cellAt, cellCentre, generate, hazKey, isFloor, muAt, newMob, standing, type Intent, type Layout, type Mob, type RoomSpec } from './room';

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
  pad: number | null;
  hand: number;
  thrown: boolean;
  flash: number;
  /** Turns left with weaker throws, from a chilling hit. */
  chill: number;
  /** Burning: takes 2 damage at the start of the next enemy turn. */
  fire: number;
}

export interface Disc {
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
}

export interface Float { x: number; y: number; txt: string; col: string; t: number }
export interface Spark { x: number; y: number; h: number; vx: number; vy: number; vh: number; t: number; col: string; sz: number }

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
  floats: Float[];
  sparks: Spark[];
  heroes: HeroState[];
  shake: number;
  /** Heroes (by `i`) whose players pressed "ready" during placement in an online game. */
  ready: number[];
}

/** What a player can do to the shared game; online clients send these to the host instead of applying them. */
export type Action =
  | { k: 'throw'; h: number; dx: number; dy: number }
  | { k: 'move'; h: number; pad: number }
  | { k: 'disc'; h: number }
  | { k: 'up'; h: number; stat: StatKey }
  | { k: 'ability'; h: number }
  | { k: 'ready'; h: number };

const STEP = 1 / 120;

/**
 * Enemy turn pacing, in seconds: a pause before the first enemy goes, a cell of walking, the beat an enemy
 * that stays put takes before it acts, and the pause after an enemy acts before the next one starts.
 */
const LEAD = 0.3, CELL_T = 0.14, BEAT = 0.18, AFTER = 0.35;

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
 * Ore and sparks belong to the whole party: any hero's hit fills the pool, any hero spends from it.
 * Ore lasts the whole run; sparks are for one fight only, and every fight starts with `boon` of them (usually none).
 */
export interface Bank { ore: number; sparks: number; boon?: number }

export function newBank(): Bank {
  return { ore: 0, sparks: 0, boon: 0 };
}

/** A fresh party; `picks` lists which heroes (by index into HEROES) take part, all of them by default. */
export function newParty(picks: number[] = HEROES.map((_, i) => i)): HeroState[] {
  return picks.map(i => ({ i, def: HEROES[i], ...heroStart() }));
}

function heroStart() {
  return {
    hp: 22, max: 22, shield: 0, up: { m: 0, pw: 0, e: 0 }, discs: HAND_START,
    pad: null as number | null, hand: HAND_START, thrown: false, flash: 0, chill: 0, fire: 0,
  };
}

export class Game {
  S!: State;
  act = 0;
  party: HeroState[] = newParty();
  bank: Bank = newBank();
  onChange: () => void = () => {};
  onRoomEnd: (win: boolean) => void = () => {};
  /** Which heroes this screen may move, aim and select (online: only the player's own). */
  canControl: (h: HeroState) => boolean = () => true;
  /** Online: placement ends when every hero's player is ready, and heroes cannot swap runes. */
  online = false;
  /** Online client: actions go to the host through this instead of changing local state. */
  send: ((a: Action) => void) | null = null;
  private acc = 0;

  loadRoom(spec: RoomSpec) {
    const L = generate(spec);
    for (const h of this.party) Object.assign(h, { pad: null, hand: h.hp > 0 ? h.discs : 0, thrown: false, shield: 0, flash: 0, chill: 0, fire: 0 });
    // sparks don't carry over: every fight starts afresh
    this.bank.sparks = this.bank.boon ?? 0;
    this.bank.boon = 0;
    this.S = { ...L, spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [] };
    // every rune starts empty: the players put their heroes on them before the fight
    this.pickActive();
    this.pickIntents();
    this.acc = 0;
    this.onChange();
  }

  /** Online client: rebuild a room from its spec (rooms are generated from the seed), state comes from the host. */
  showRoom(spec: RoomSpec) {
    this.S = { ...generate(spec), spec, turn: 1, phase: 'place', timer: 0, actor: -1, clock: 0, attacked: false, discs: [], floats: [], sparks: [], heroes: this.party, shake: 0, ready: [] };
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

  alive = () => this.S.heroes.filter(h => h.hp > 0);
  liveMobs = () => this.S.mobs.filter(m => m.hp > 0);
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
      if (!this.alive().every(o => S.ready.includes(o.i))) { this.onChange(); return; }
    }
    S.phase = 'throw';
    this.pickIntents();
    this.onChange();
  }

  /** Throw the hero's next disc. (dx, dy) is the pull-back vector in world units, up to 60. */
  throwDisc(h: HeroState, dx: number, dy: number) {
    const S = this.S;
    if (S.phase !== 'throw' || h.hand <= 0 || h.pad === null || h.hp <= 0) return;
    const L = Math.hypot(dx, dy);
    if (L < 4) return;
    if (this.send) { this.send({ k: 'throw', h: h.i, dx, dy }); return; }
    const p = S.pads[h.pad], s = this.power(h);
    S.discs.push({
      hero: h, x: p.x + (dx / L) * 6, y: p.y + (dy / L) * 6, vx: dx * s, vy: dy * s,
      r: h.def.r, m: this.stat(h, 'm'), e: this.stat(h, 'e'), fr: h.def.fr,
      fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0,
    });
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
    const S = this.S, L = Math.hypot(dx, dy), path: [number, number][] = [], bounces: [number, number][] = [];
    if (h.pad === null || L < 4) return { path, bounces, hit: null as Mob | null };
    const p = S.pads[h.pad], s = this.power(h), dt = 1 / 60;
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
        if (S.pits.some(o => Math.hypot(d.x - o.x, d.y - o.y) < o.r - 2)) { path.push([d.x, d.y]); return { path, bounces, hit: null }; }
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
    const S = this.S, c = this.discCost(h);
    if (!c || this.bank.ore < c || h.hp <= 0 || S.phase === 'over') return;
    if (this.send) { this.send({ k: 'disc', h: h.i }); return; }
    this.bank.ore -= c;
    h.discs++;
    // the new disc can be thrown this very turn
    if (S.phase === 'throw' || S.phase === 'place') h.hand++;
    if (h.pad !== null) {
      const p = S.pads[h.pad];
      this.float(p.x, p.y, '+1 диск', h.def.col);
      this.burst(p.x, p.y, h.def.col, 10);
    }
    this.onChange();
  }

  /** Cost of the next level of a disc stat, or 0 when there is nothing more to gain (a bounce already at the limit). */
  upCost(h: HeroState, k: StatKey) {
    if (k === 'e' && this.stat(h, 'e') >= E_MAX) return 0;
    return UP_COST[h.up[k]] ?? 0;
  }

  upgrade(k: StatKey, h = this.hero) {
    const S = this.S, c = this.upCost(h, k);
    if (!c || this.bank.ore < c || h.hp <= 0 || S.phase === 'over') return;
    if (this.send) { this.send({ k: 'up', h: h.i, stat: k }); return; }
    this.bank.ore -= c;
    h.up[k]++;
    if (h.pad !== null) {
      const p = S.pads[h.pad];
      this.float(p.x, p.y, UPS.find(u => u.k === k)!.next, h.def.col);
      this.burst(p.x, p.y, h.def.col, 10);
    }
    this.onChange();
  }

  canUseAbility(h = this.hero) {
    return this.S.phase === 'throw' && h.hp > 0 && this.bank.sparks >= AB_COST && this.liveMobs().length > 0;
  }

  useAbility(h = this.hero) {
    const S = this.S;
    if (!this.canUseAbility(h)) return;
    if (this.send) { this.send({ k: 'ability', h: h.i }); return; }
    this.bank.sparks -= AB_COST;
    if (h.i === 0) {
      for (const o of this.alive()) { o.shield += 3; if (o.pad !== null) this.float(S.pads[o.pad].x, S.pads[o.pad].y, '+3 щит', '#3fc4b6'); }
    } else if (h.i === 1) {
      for (const m of this.liveMobs()) { this.hurtMob(m, 4, '#f5c242', true); this.burst(m.x, m.y, '#f5c242', 8); }
    } else {
      const m = this.liveMobs().sort((a, b) => b.hp - a.hp)[0];
      if (m) { m.burn = 3; this.float(m.x, m.y, 'горит!', '#ff7a3d'); this.burst(m.x, m.y, '#ff7a3d', 16); }
    }
    this.onChange();
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

  pickIntents() {
    const S = this.S, hs = this.alive().filter(h => h.pad !== null), rage = this.rage();
    if (!hs.length) return;
    const taken: { x: number; y: number }[] = [];
    this.liveMobs().forEach((m, i) => {
      const d = MOBS[m.k];
      for (const a of d.acts ?? []) {
        if (S.turn % a.every !== a.at) continue;
        const it = this.special(m, a, hs, taken);
        if (it) { if (it.t === 'slam') it.dmg += rage; m.intent = it; return; }
      }
      if (d.charge && S.turn % 2 === 1) { m.intent = { t: 'charge', hero: hs[(S.turn + i) % hs.length].i, dmg: 0 }; return; }
      const dmg = (d.charge ? m.dmg * 2 : m.dmg) + rage;
      if (isRanged(m.k)) { m.intent = { t: 'hit', hero: hs[(S.turn + i) % hs.length].i, dmg }; return; }
      let best = hs[0], way: Pt[] | null = null, bd = Infinity;
      for (const h of hs) {
        const w = this.route(m, S.pads[h.pad!]);
        if (w && w.length < bd) { bd = w.length; best = h; way = w; }
      }
      // walled off from every rune: it stays put
      if (!way) { m.intent = { t: 'move', hero: best.i, dmg: 0 }; return; }
      const n = way.length - 1, go = wayLen(way.slice(0, this.stopAt(m, way) + 1)), eta = Math.max(1, Math.ceil(n / stepsOf(m)));
      way.push({ x: S.pads[best.pad!].x, y: S.pads[best.pad!].y });
      m.intent = n <= stepsOf(m) ? { t: 'hit', hero: best.i, dmg, way, go, eta: 1 } : { t: 'move', hero: best.i, dmg: 0, way, go, eta };
    });
  }

  /** The intent for a mob's special act this turn, or null when it can't do it (nobody to heal, no room to summon). */
  private special(m: Mob, a: MobAct, hs: HeroState[], taken: { x: number; y: number }[]): Intent | null {
    const S = this.S, mi = S.mobs.indexOf(m);
    if (a.k === 'slam') return { t: 'slam', hero: -1, dmg: Math.ceil(m.dmg * (a.chill ? 0.5 : 0.6)), chill: a.chill };
    if (a.k === 'heal') {
      const hurt = this.liveMobs().filter(o => o !== m && o.hp < o.max).sort((p, q) => p.hp / p.max - q.hp / q.max)[0];
      return hurt ? { t: 'heal', hero: -1, dmg: a.amt ?? 6, mob: S.mobs.indexOf(hurt) } : null;
    }
    if (a.k === 'summon') {
      const mine = S.mobs.filter(o => o.hp > 0 && o.owner === mi).length;
      const n = Math.min(a.n ?? 1, (a.cap ?? 3) - mine, 9 - this.liveMobs().length);
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
    // heat: tiles a little in front of each hero's rune turn to lava
    const spots: { x: number; y: number }[] = [];
    for (const h of hs) {
      const p = S.pads[h.pad!], dx = S.Wx / 2 - p.x, dy = S.Wy / 2 - p.y, L = Math.hypot(dx, dy) || 1;
      let got = 0;
      for (let k = 0; k < 10 && got < (a.n ?? 2); k++) {
        const dist = 26 + (k >> 1) * 8, side = k % 2 ? 1 : -1;
        const x = p.x + (dx / L) * dist - (dy / L) * side * 9 * (got ? 1 : 0.4), y = p.y + (dy / L) * dist + (dx / L) * side * 9 * (got ? 1 : 0.4);
        const i = Math.floor(x / TILE), j = Math.floor(y / TILE), cx = i * TILE + 8, cy = j * TILE + 8;
        if (!isFloor(S, i, j) || S.haz.has(hazKey(i, j)) || spots.some(o => o.x === cx && o.y === cy)) continue;
        if (S.pads.some(q => Math.hypot(q.x - cx, q.y - cy) < 20) || standing(S.blocks).some(b => cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1)) continue;
        spots.push({ x: cx, y: cy });
        got++;
      }
    }
    return spots.length ? { t: 'heat', hero: -1, dmg: 0, spots } : null;
  }

  /** Room for a summoned mob on the cell at (x, y): open floor no one stands on, off the runes and the circles already marked. */
  private spotFree(x: number, y: number, taken: { x: number; y: number }[]) {
    const [i, j] = cellAt(x, y);
    return this.cellFree(i, j, this.occupied(null, true)) && !this.runeCells().has(hazKey(i, j)) && !taken.some(p => p.x === x && p.y === y);
  }

  // ------------------------------------------------------------ damage & fx

  float(x: number, y: number, txt: string, col: string) {
    this.S.floats.push({ x, y, txt, col, t: 0 });
  }

  burst(x: number, y: number, col: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 60;
      this.S.sparks.push({ x, y, h: 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: 30 + Math.random() * 40, t: 0, col, sz: 1 + Math.random() * 1.5 });
    }
  }

  hurtMob(m: Mob, n: number, col = '#fff', pierce = false) {
    if (m.hp <= 0) return;
    if (m.armor && !pierce && n < m.armor) { this.float(m.x, m.y, 'броня', '#c7cbe0'); return; }
    m.hp -= n;
    m.flash = 0.15;
    this.float(m.x, m.y, '-' + n, col);
    const d = MOBS[m.k];
    if (d.rage && !m.rage && m.hp > 0 && m.hp <= m.max / 2) { m.rage = true; m.dmg += 3; this.float(m.x, m.y - 12, 'ЯРОСТЬ +3', '#ff7a3d'); this.burst(m.x, m.y, '#ff7a3d', 18); }
    if (m.hp <= 0) {
      m.dead = 0.001; this.burst(m.x, m.y, '#ffd34d', 22); this.float(m.x, m.y - 6, 'повержен', '#ffd34d');
      if (d.lava) {
        const S = this.S, i = Math.floor(m.x / TILE), j = Math.floor(m.y / TILE);
        if (isFloor(S, i, j) && S.pads.every(p => Math.hypot(p.x - (i * TILE + 8), p.y - (j * TILE + 8)) > 20)) { S.haz.add(hazKey(i, j)); this.float(m.x, m.y + 4, 'лава!', '#ff7a3d'); }
      }
    }
  }

  hurtHero(h: HeroState, n: number, why = '') {
    const S = this.S;
    if (h.hp <= 0) return;
    const p = h.pad !== null ? S.pads[h.pad] : { x: S.Wx - 20, y: S.Wy - 20 };
    const blk = Math.min(h.shield, n);
    h.shield -= blk;
    const dmg = n - blk;
    h.hp -= dmg;
    h.flash = 0.2;
    this.float(p.x, p.y, dmg ? `-${dmg}${why ? ' ' + why : ''}` : 'блок', dmg ? '#ff4d6a' : '#3fc4b6');
    if (dmg) { this.burst(p.x, p.y, '#ff4d6a', 10); S.shake = 0.2; }
    if (h.hp <= 0) { this.float(p.x, p.y - 6, 'пал', '#ff4d6a'); h.hand = 0; }
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

  inBlock(x: number, y: number, r: number) {
    const boxes = standing(this.S.blocks).concat(this.S.rock);
    return boxes.some(b => Math.hypot(x - Math.max(b.x0, Math.min(x, b.x1)), y - Math.max(b.y0, Math.min(y, b.y1))) < r);
  }

  step(dt: number) {
    const S = this.S;
    let changed = false;
    for (const d of this.bodies()) {
      const v = Math.hypot(d.vx, d.vy);
      if (v > 0) { const nv = Math.max(0, v - muAt(S, d.x, d.y) * d.fr * dt); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * d.e; d.bounces++; }
      if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * d.e; d.bounces++; }
      if (d.x > S.Wx - d.r) { d.x = S.Wx - d.r; d.vx = -d.vx * d.e; d.bounces++; }
      if (d.y > S.Wy - d.r) { d.y = S.Wy - d.r; d.vy = -d.vy * d.e; d.bounces++; }
      if (S.pits.some(p => Math.hypot(d.x - p.x, d.y - p.y) < p.r - 2)) {
        d.fall = 0.001; d.vx = d.vy = 0;
        this.float(d.x, d.y, 'провал', '#c7cbe0');
        this.hurtHero(d.hero, 2);
        changed = true;
        continue;
      }
      for (const b of S.blocks) {
        if (b.ice && b.hp! <= 0) continue;
        const vn = this.bounceBox(d, b);
        if (vn <= 0) continue;
        d.bounces++;
        if (!b.ice || vn <= 30) continue;
        // icicles chip like mobs take damage, and shatter at zero
        const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
        b.hp = Math.max(0, b.hp! - Math.ceil((d.m * vn) / 120));
        if (b.hp > 0) this.burst(d.x, d.y, '#d8f2ff', 5);
        else { this.float(x, y, 'дзынь!', '#bfe9ff'); this.burst(x, y, '#d8f2ff', b.big ? 22 : 12); this.S.shake = Math.max(this.S.shake, 0.12); }
        changed = true;
      }
      for (const b of S.rock) if (this.bounceBox(d, b) > 0) d.bounces++;
      for (const n of S.nodes) {
        if (n.left <= 0) continue;
        // a resource soaks up most of the disc's run: collecting costs the throw
        const vn = this.bounceStatic(d, n, NODE_E);
        if (vn <= 30) continue;
        d.hits++;
        const big = Math.ceil((d.m * vn) / 120) >= 4, h = d.hero, q = big ? 2 : 1;
        n.left--;
        n.hit = 0.2;
        if (n.k === 'ore') { this.bank.ore += q; this.float(n.x, n.y, `+${q} руда`, '#ffb070'); this.burst(n.x, n.y, '#ffcf6a', big ? 14 : 8); }
        if (n.k === 'spk') { this.bank.sparks += q; this.float(n.x, n.y, `+${q} искр${q > 1 ? 'ы' : 'а'}`, '#c9a8ff'); this.burst(n.x, n.y, '#c9a8ff', big ? 14 : 8); }
        if (n.k === 'herb') { const hl = Math.min(h.max - h.hp, 1 + 2 * q); h.hp += hl; this.float(n.x, n.y, hl ? `+${hl} HP` : 'HP полное', '#7be39a'); this.burst(n.x, n.y, '#7be39a', 8); }
        if (n.left <= 0) this.float(n.x, n.y - 6, 'истощено', '#c7cbe0');
        changed = true;
      }
      for (const m of S.mobs) {
        if (!this.solid(m)) continue;
        const v = Math.hypot(d.vx, d.vy), vn = this.bounceStatic(d, m, MOB_E);
        if (vn <= 5) continue;
        let dmg = Math.ceil((d.m * vn) / 120);
        // straight from the rune into the enemy, square on: a precise throw hits much harder
        const crit = d.bounces === 0 && d.hits === 0 && vn >= v * CRIT_COS;
        d.hits++;
        if (crit) dmg = Math.ceil(dmg * CRIT);
        if (d.hero.i === 1) dmg += Math.min(d.bounces, 4);
        if (d.charged) { dmg *= 2; d.charged = false; }
        if (crit && m.hp > 0) this.float(m.x, m.y - 24, 'ТОЧНО!', '#ffe27a');
        this.hurtMob(m, dmg);
        this.burst(d.x, d.y, d.hero.def.col, 8);
        changed = true;
      }
    }
    const bs = this.bodies();
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
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
      }
    }
    if (changed) this.onChange();
  }

  moving() {
    return this.bodies().some(d => Math.hypot(d.vx, d.vy) > 2) || this.S.discs.some(d => d.fall && !d.gone);
  }

  allThrown() { return this.alive().every(h => h.hand === 0); }

  // ------------------------------------------------------------ turn flow

  private resolve() {
    const S = this.S;
    for (const d of S.discs) {
      d.vx = d.vy = 0;
      if (d.gone || d.fall || d.hero.hp <= 0) continue;
      if (!d.hits) this.float(d.x, d.y, 'мимо', '#c7cbe0');
      if (S.haz.has(hazKey(Math.floor(d.x / 16), Math.floor(d.y / 16)))) {
        this.float(d.x, d.y, S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
        this.hurtHero(d.hero, S.biome.hazDmg);
      }
    }
  }

  /** The enemy turn begins: burning heroes smoulder, then the enemies take their moves one at a time. */
  private mobsStart() {
    const S = this.S;
    for (const h of this.alive()) if (h.fire > 0) { h.fire--; this.hurtHero(h, 2, 'горит'); }
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
      if (burnt) { this.hurtMob(m, 4, '#ff7a3d', true); m.burn--; }
      this.planWalk(m);
      if (burnt || (m.hp > 0 && !this.idle(m))) return true;
    }
    return false;
  }

  /** Where a walker goes on its move: along its way to the hero it is after, as far as its steps take it. */
  private planWalk(m: Mob) {
    const S = this.S, it = m.intent;
    m.fx = m.tx = m.x;
    m.fy = m.ty = m.y;
    m.walk = undefined;
    if (m.hp <= 0 || !it || it.hero < 0 || m.speed === 0) return;
    const h = this.heroOf(it.hero);
    if (h.hp <= 0 || h.pad === null) return;
    // the room has changed since the intent was picked: the enemies before it have moved, an icicle may have broken
    const way = this.route(m, S.pads[h.pad]);
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
    if (it.t === 'hit') { const h = this.heroOf(it.hero); return h.hp <= 0 || h.pad === null; }
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
   * backing off cells that hold a rune or another enemy (a route that had to squeeze past them).
   */
  private stopAt(m: Mob, cells: Pt[]) {
    const sz = mobSize(m.k), taken = this.occupied(m, true), runes = this.runeCells();
    let k = Math.min(cells.length - 1, stepsOf(m));
    while (k > 0) {
      const [i, j] = cellAt(cells[k].x, cells[k].y, sz);
      if (this.fits(i, j, sz, taken) && !this.onRune(i, j, sz, runes)) break;
      k--;
    }
    return k;
  }

  /** Cells under the room's runes. */
  runeCells() {
    return new Set(this.S.pads.map(p => hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))));
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
    for (const n of S.nodes) if (n.left > 0) mark(Math.floor(n.x / TILE), Math.floor(n.y / TILE));
    for (const p of S.pits) {
      for (let j = Math.floor((p.y - p.r) / TILE); j <= Math.floor((p.y + p.r) / TILE); j++) for (let i = Math.floor((p.x - p.r) / TILE); i <= Math.floor((p.x + p.r) / TILE); i++) {
        if (Math.hypot(p.x - (i * TILE + 8), p.y - (j * TILE + 8)) < p.r + 4) mark(i, j);
      }
    }
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

  private onRune(i: number, j: number, sz: number, runes: Set<string>) {
    for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) if (runes.has(hazKey(i + a, j + b))) return true;
    return false;
  }

  /** Whether an s × s enemy at (i, j) stands right next to the cell (ti, tj), close enough to strike it. */
  private nextTo(i: number, j: number, sz: number, ti: number, tj: number) {
    const inside = ti >= i && ti < i + sz && tj >= j && tj < j + sz;
    return !inside && ti >= i - 1 && ti <= i + sz && tj >= j - 1 && tj <= j + sz;
  }

  /** Whether a mob stands next to the rune at p. */
  private besideRune(m: Mob, p: Pt) {
    const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz);
    return this.nextTo(i, j, sz, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  }

  /**
   * A walker's way to the hero on the rune at `to`, cell by cell like a piece on a board: 8 directions, no corner cutting,
   * around blocks, pits, resources and the other enemies, to the nearest cells next to the rune it can stand on.
   * Big enemies move their whole 2 × 2 footprint. Returns the centres it steps through, starting where it stands,
   * or null when nothing connects. Other enemies crowding the rune don't stop a walker from heading there.
   */
  route(m: Mob, to: Pt, mobs = true): Pt[] | null {
    const S = this.S, gw = S.gw, gh = S.gh, sz = mobSize(m.k), taken = this.occupied(m, mobs), runes = this.runeCells();
    const ti = Math.floor(to.x / TILE), tj = Math.floor(to.y / TILE);
    const [si, sj] = cellAt(m.x, m.y, sz);
    const inRoom = (i: number, j: number) => i >= 0 && j >= 0 && i <= gw - sz && j <= gh - sz;
    if (!inRoom(si, sj)) return null;
    const start = sj * gw + si;
    // a rune can sit in a one-cell corridor: walkers pass over runes, they just never stop on one
    const open = (i: number, j: number) => inRoom(i, j) && !this.onRune(i, j, sz, new Set([hazKey(ti, tj)])) && ((i === si && j === sj) || this.fits(i, j, sz, taken));
    const goal = (i: number, j: number) => this.nextTo(i, j, sz, ti, tj) && ((i === si && j === sj) || (this.fits(i, j, sz, taken) && !this.onRune(i, j, sz, runes)));
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
    if (end < 0) return mobs ? this.route(m, to, false) : null;
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
      this.float(m.x, m.y - 10, it.chill ? 'МЕТЕЛЬ' : 'УДАР ОБ ПОЛ', it.chill ? '#bfe6ff' : '#ffd34d');
      for (const h of this.alive()) { this.hurtHero(h, it.dmg); if (it.chill) this.chillHero(h); }
    } else if (it.t === 'heal') {
      const o = S.mobs[it.mob!];
      if (!o || o.hp <= 0) return;
      const hl = Math.min(o.max - o.hp, it.dmg);
      o.hp += hl;
      this.float(o.x, o.y, `+${hl}`, '#7be39a'); this.burst(o.x, o.y, '#9fe3ff', 12);
    } else if (it.t === 'summon') {
      const kind = d.acts!.find(a => a.k === 'summon')!.kind!, mi = S.mobs.indexOf(m);
      this.float(m.x, m.y - 10, 'призыв!', '#c9a8ff');
      for (const p of it.spots ?? []) {
        // a disc may have come to rest on the circle; the mob still rises, the disc is long gone by then
        const o = newMob(kind, p.x, p.y, S.hpMul, S.dmgAdd);
        o.owner = mi; o.born = 1;
        S.mobs.push(o);
        this.burst(p.x, p.y, '#b893ff', 16);
      }
    } else if (it.t === 'heat') {
      this.float(m.x, m.y - 10, 'РАСКАЛЯЕТ ПОЛ', '#ff7a3d');
      for (const p of it.spots ?? []) { S.haz.add(hazKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE))); this.burst(p.x, p.y, '#ff7a3d', 10); }
    } else if (it.t === 'charge') {
      this.float(m.x, m.y - 10, 'фитиль горит', '#ffb070');
    } else if (it.t === 'hit') {
      const h = this.heroOf(it.hero);
      if (h.hp <= 0 || h.pad === null) return;
      const p = S.pads[h.pad];
      if (isRanged(m.k) || this.besideRune(m, p)) {
        this.hurtHero(h, it.dmg); m.flash = 0.12;
        if (d.chill && h.hp > 0) this.chillHero(h);
        if (d.fire && h.hp > 0) { h.fire = 1; this.float(p.x, p.y - 8, 'горит!', '#ff7a3d'); }
      } else this.float(m.x, m.y, 'не достал', '#c7cbe0');
    }
  }

  /** Chill lasts through the hero's next throws: two turn ends, the first one comes right after this enemy turn. */
  private chillHero(h: HeroState) {
    if (h.hp <= 0) return;
    h.chill = 2;
    const p = h.pad !== null ? this.S.pads[h.pad] : null;
    if (p) this.float(p.x, p.y - 8, 'озноб', '#bfe6ff');
  }

  private nextTurn() {
    const S = this.S;
    if (!this.alive().length || !this.liveMobs().length) { this.finish(); return; }
    S.turn++;
    S.discs = [];
    for (const h of S.heroes) { h.shield = 0; h.thrown = false; h.hand = h.hp > 0 ? h.discs : 0; if (h.chill > 0) h.chill--; }
    S.phase = 'throw';
    this.pickActive();
    this.pickIntents();
    if (this.rage() > 0) { this.float(S.Wx / 2, S.Wy / 2, `ВРАГИ ЗВЕРЕЮТ +${this.rage()}`, '#ff4d6a'); S.shake = Math.max(S.shake, 0.15); }
    this.onChange();
  }

  private finish() {
    this.S.phase = 'over';
    this.onChange();
    this.onRoomEnd(this.alive().length > 0);
  }

  update(dt: number) {
    const S = this.S;
    if (this.send) { this.updateRemote(dt); return; }
    this.acc += dt;
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
    // the last enemy down ends the fight at once, whatever throws are left
    if ((S.phase === 'throw' || S.phase === 'resolve' || S.phase === 'enemy') && !this.liveMobs().length) this.finish();
    else if (S.phase === 'throw' && this.allThrown() && !this.moving()) {
      S.phase = 'resolve'; S.timer = 0.9; this.resolve(); this.onChange();
    } else if (S.phase === 'resolve' && (S.timer -= dt) <= 0) {
      S.phase = 'enemy'; this.mobsStart(); this.onChange();
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
    if (S.clock >= T) { m.x = m.tx; m.y = m.ty; m.hop = 0; return; }
    const n = w.length - 1, at = Math.min(n - 1e-6, (S.clock / T) * n), k = Math.floor(at), f = at - k, e = f * f * (3 - 2 * f);
    m.x = w[k].x + (w[k + 1].x - w[k].x) * e;
    m.y = w[k].y + (w[k + 1].y - w[k].y) * e;
    m.hop = Math.sin(Math.PI * f) * 6;
  }

  /**
   * Online client: the host owns the rules; between its snapshots, discs keep rolling and mobs keep walking
   * locally so motion stays smooth.
   */
  private updateRemote(dt: number) {
    const S = this.S;
    for (const d of this.bodies()) {
      const v = Math.hypot(d.vx, d.vy);
      if (v > 0) { const nv = Math.max(0, v - muAt(S, d.x, d.y) * d.fr * dt); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
      d.x = Math.max(d.r, Math.min(S.Wx - d.r, d.x + d.vx * dt));
      d.y = Math.max(d.r, Math.min(S.Wy - d.r, d.y + d.vy * dt));
    }
    if (S.phase === 'enemy') {
      S.clock += dt;
      const m = S.mobs[S.actor];
      if (m) this.walkMob(m);
    }
    this.fade(dt);
  }

  /** Timers of flashes, falling discs, particles and floating numbers. */
  private fade(dt: number) {
    const S = this.S;
    for (const d of S.discs) if (d.fall && !d.gone) { d.fall += dt; if (d.fall > 0.5) d.gone = true; }
    for (const m of S.mobs) { if (m.flash > 0) m.flash -= dt; if (m.dead) m.dead += dt; if (m.born > 0) m.born = Math.max(0, m.born - dt * 1.5); }
    for (const h of S.heroes) if (h.flash > 0) h.flash -= dt;
    for (const n of S.nodes) if (n.hit > 0) n.hit -= dt;
    if (S.shake > 0) S.shake -= dt;
    for (const p of S.sparks) { p.t += dt; p.x += p.vx * dt * 0.5; p.y += p.vy * dt * 0.5; p.vh -= 160 * dt; p.h = Math.max(0, p.h + p.vh * dt); }
    S.sparks = S.sparks.filter(p => p.t < 0.5);
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter(f => f.t < 1.6);
  }
}
