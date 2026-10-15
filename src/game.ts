// Combat rules: turn flow, disc physics, damage, abilities.
// Rendering and input live elsewhere; this module only changes state.

import { AB_COST, HAND_COST, HAND_MAX, HAND_START, HEROES, UPS, UP_COST, type HeroDef, type StatKey } from './data';
import { generate, hazKey, newMob, spawnSpot, type Layout, type Mob, type RoomSpec } from './room';

export type Phase = 'place' | 'throw' | 'resolve' | 'enemy' | 'over';

export interface HeroState {
  i: number;
  def: HeroDef;
  hp: number;
  max: number;
  shield: number;
  ore: number;
  sparks: number;
  up: Record<StatKey, number>;
  /** Discs per turn; starts at 1 and grows through upgrades. */
  discs: number;
  pad: number | null;
  hand: number;
  thrown: boolean;
  flash: number;
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
}

export interface Float { x: number; y: number; txt: string; col: string; t: number }
export interface Spark { x: number; y: number; h: number; vx: number; vy: number; vh: number; t: number; col: string; sz: number }

export interface State extends Layout {
  spec: RoomSpec;
  turn: number;
  phase: Phase;
  timer: number;
  attacked: boolean;
  discs: Disc[];
  floats: Float[];
  sparks: Spark[];
  heroes: HeroState[];
  shake: number;
}

const STEP = 1 / 120;

export function newParty(): HeroState[] {
  return HEROES.map((def, i) => ({
    i, def, hp: 14, max: 14, shield: 0, ore: 1, sparks: 1, up: { m: 0, pw: 0, e: 0 }, discs: HAND_START,
    pad: null, hand: HAND_START, thrown: false, flash: 0,
  }));
}

export class Game {
  S!: State;
  act = 0;
  party: HeroState[] = newParty();
  onChange: () => void = () => {};
  onRoomEnd: (win: boolean) => void = () => {};
  private acc = 0;

  loadRoom(spec: RoomSpec) {
    const L = generate(spec);
    for (const h of this.party) Object.assign(h, { pad: null, hand: h.hp > 0 ? h.discs : 0, thrown: false, shield: 0, flash: 0 });
    this.S = { ...L, spec, turn: 1, phase: 'place', timer: 0, attacked: false, discs: [], floats: [], sparks: [], heroes: this.party, shake: 0 };
    // everyone starts on a rune, spread along the near edge; players may rearrange before the fight
    const living = this.party.filter(h => h.hp > 0), n = L.pads.length;
    living.forEach((h, k) => { h.pad = living.length === 1 ? Math.floor(n / 2) : Math.round((k * (n - 1)) / (living.length - 1)); });
    this.act = Math.max(0, this.party.findIndex(h => h.hp > 0));
    this.pickIntents();
    this.acc = 0;
    this.onChange();
  }

  alive = () => this.S.heroes.filter(h => h.hp > 0);
  liveMobs = () => this.S.mobs.filter(m => m.hp > 0);
  stat = (h: HeroState, k: StatKey) => h.def[k] + h.up[k] * UPS.find(u => u.k === k)!.step;
  get hero() { return this.S.heroes[this.act]; }

  select(i: number) {
    this.act = i;
    this.onChange();
  }

  canPlace(h: HeroState) {
    return h.hp > 0 && !h.thrown && (this.S.phase === 'place' || this.S.phase === 'throw');
  }

  padFree(pi: number) {
    return !this.S.heroes.some(h => h.pad === pi && h.hp > 0);
  }

  /** Move a hero to rune pi; if another hero who hasn't thrown stands there, they swap places. */
  movePad(h: HeroState, pi: number) {
    const S = this.S;
    if (!this.canPlace(h) || h.pad === pi) return false;
    const other = S.heroes.find(o => o.pad === pi && o.hp > 0);
    if (other && !this.canPlace(other)) return false;
    if (other) other.pad = h.pad;
    h.pad = pi;
    this.burst(S.pads[pi].x, S.pads[pi].y, h.def.col, 10);
    this.pickIntents();
    this.onChange();
    return true;
  }

  /** End the placement phase and start the first turn. */
  startFight() {
    if (this.S.phase !== 'place') return;
    this.S.phase = 'throw';
    this.pickIntents();
    this.onChange();
  }

  /** Throw the hero's next disc. (dx, dy) is the pull-back vector in world units, up to 60. */
  throwDisc(h: HeroState, dx: number, dy: number) {
    const S = this.S;
    if (S.phase !== 'throw' || h.hand <= 0 || h.pad === null || h.hp <= 0) return;
    const L = Math.hypot(dx, dy);
    if (L < 4) return;
    const p = S.pads[h.pad], s = (270 * this.stat(h, 'pw')) / 60;
    S.discs.push({
      hero: h, x: p.x + (dx / L) * 6, y: p.y + (dy / L) * 6, vx: dx * s, vy: dy * s,
      r: h.def.r, m: this.stat(h, 'm'), e: Math.min(0.99, this.stat(h, 'e')), fr: h.def.fr,
      fall: 0, gone: false, charged: false, bounces: 0, spin: 0,
    });
    h.hand--;
    h.thrown = true;
    this.onChange();
  }

  /**
   * Where a throw with pull-back (dx, dy) would roll, ignoring other discs: path points, the bounce points along it,
   * and the mob it would hit first. Stops after `maxBounces` bounces (the aim line uses 0: it ends at the first obstacle).
   */
  predict(h: HeroState, dx: number, dy: number, maxBounces = 2) {
    const S = this.S, L = Math.hypot(dx, dy), path: [number, number][] = [], bounces: [number, number][] = [];
    if (h.pad === null || L < 4) return { path, bounces, hit: null as Mob | null };
    const p = S.pads[h.pad], s = (270 * this.stat(h, 'pw')) / 60, mu = S.biome.mu, dt = 1 / 60;
    const d = { x: p.x + (dx / L) * 6, y: p.y + (dy / L) * 6, vx: dx * s, vy: dy * s, r: h.def.r, e: Math.min(0.99, this.stat(h, 'e')) } as Disc;
    const boxes = S.blocks.concat(S.rock);
    path.push([d.x, d.y]);
    for (let k = 0; k < 600; k++) {
      const v = Math.hypot(d.vx, d.vy);
      if (v < 8) break;
      const nv = Math.max(0, v - mu * h.def.fr * dt);
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
        const m = S.mobs.find(o => o.hp > 0 && Math.hypot(d.x - o.x, d.y - o.y) < d.r + o.r);
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

  buyDisc() {
    const S = this.S, h = this.hero, c = this.discCost(h);
    if (!c || h.ore < c || h.hp <= 0 || S.phase === 'over') return;
    h.ore -= c;
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

  upgrade(k: StatKey) {
    const S = this.S, h = this.hero, lv = h.up[k], c = UP_COST[lv];
    if (!c || h.ore < c || h.hp <= 0 || S.phase === 'over') return;
    h.ore -= c;
    h.up[k]++;
    if (h.pad !== null) {
      const p = S.pads[h.pad];
      this.float(p.x, p.y, UPS.find(u => u.k === k)!.name + ' +', h.def.col);
      this.burst(p.x, p.y, h.def.col, 10);
    }
    this.onChange();
  }

  canUseAbility() {
    const h = this.hero;
    return this.S.phase === 'throw' && h.hp > 0 && h.sparks >= AB_COST && this.liveMobs().length > 0;
  }

  useAbility() {
    const S = this.S, h = this.hero;
    if (!this.canUseAbility()) return;
    h.sparks -= AB_COST;
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

  // ------------------------------------------------------------ intents

  pickIntents() {
    const S = this.S, hs = this.alive().filter(h => h.pad !== null);
    if (!hs.length) return;
    this.liveMobs().forEach((m, i) => {
      if (m.k === 'archer') { m.intent = { t: 'hit', hero: hs[(S.turn + i) % hs.length].i, dmg: m.dmg }; return; }
      let best = hs[0], bd = Infinity;
      for (const h of hs) {
        const p = S.pads[h.pad!], dd = Math.hypot(p.x - m.x, p.y - m.y);
        if (dd < bd) { bd = dd; best = h; }
      }
      m.intent = bd - m.speed <= m.reach ? { t: 'hit', hero: best.i, dmg: m.dmg } : { t: 'move', hero: best.i, dmg: 0 };
    });
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
    if (m.hp <= 0) { m.dead = 0.001; this.burst(m.x, m.y, '#ffd34d', 22); this.float(m.x, m.y - 6, 'повержен', '#ffd34d'); }
  }

  hurtHero(h: HeroState, n: number) {
    const S = this.S;
    if (h.hp <= 0) return;
    const p = h.pad !== null ? S.pads[h.pad] : { x: S.Wx - 20, y: S.Wy - 20 };
    const blk = Math.min(h.shield, n);
    h.shield -= blk;
    const dmg = n - blk;
    h.hp -= dmg;
    h.flash = 0.2;
    this.float(p.x, p.y, dmg ? `-${dmg}` : 'блок', dmg ? '#ff4d6a' : '#3fc4b6');
    if (dmg) { this.burst(p.x, p.y, '#ff4d6a', 10); S.shake = 0.2; }
    if (h.hp <= 0) { this.float(p.x, p.y - 6, 'пал', '#ff4d6a'); h.hand = 0; }
  }

  // ------------------------------------------------------------ physics

  private bodies() { return this.S.discs.filter(d => !d.gone && !d.fall); }

  private bounceStatic(d: Disc, o: { x: number; y: number; r: number }) {
    const dx = d.x - o.x, dy = d.y - o.y, L = Math.hypot(dx, dy), mn = d.r + o.r;
    if (L >= mn || L === 0) return 0;
    const nx = dx / L, ny = dy / L;
    d.x = o.x + nx * mn;
    d.y = o.y + ny * mn;
    const vn = d.vx * nx + d.vy * ny;
    if (vn >= 0) return 0;
    d.vx -= (1 + d.e) * vn * nx;
    d.vy -= (1 + d.e) * vn * ny;
    return -vn;
  }

  private bounceBox(d: Disc, b: { x0: number; y0: number; x1: number; y1: number }) {
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
    d.vx -= (1 + d.e) * vn * nx;
    d.vy -= (1 + d.e) * vn * ny;
    return -vn;
  }

  inBlock(x: number, y: number, r: number) {
    const boxes = this.S.blocks.concat(this.S.rock);
    return boxes.some(b => Math.hypot(x - Math.max(b.x0, Math.min(x, b.x1)), y - Math.max(b.y0, Math.min(y, b.y1))) < r);
  }

  step(dt: number) {
    const S = this.S, mu = S.biome.mu;
    let changed = false;
    for (const d of this.bodies()) {
      const v = Math.hypot(d.vx, d.vy);
      if (v > 0) { const nv = Math.max(0, v - mu * d.fr * dt); d.vx *= nv / v; d.vy *= nv / v; d.spin += nv * dt * 0.08; }
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
      for (const b of S.blocks) if (this.bounceBox(d, b) > 0) d.bounces++;
      for (const b of S.rock) if (this.bounceBox(d, b) > 0) d.bounces++;
      for (const n of S.nodes) {
        if (n.left <= 0) continue;
        const vn = this.bounceStatic(d, n);
        if (vn <= 30) continue;
        const big = Math.ceil((d.m * vn) / 120) >= 4, h = d.hero, q = big ? 2 : 1;
        n.left--;
        n.hit = 0.2;
        if (n.k === 'ore') { h.ore += q; this.float(n.x, n.y, `+${q} руда`, '#ffb070'); this.burst(n.x, n.y, '#ffcf6a', big ? 14 : 8); }
        if (n.k === 'spk') { h.sparks += q; this.float(n.x, n.y, `+${q} искр${q > 1 ? 'ы' : 'а'}`, '#c9a8ff'); this.burst(n.x, n.y, '#c9a8ff', big ? 14 : 8); }
        if (n.k === 'herb') { const hl = Math.min(h.max - h.hp, 2 + q); h.hp += hl; this.float(n.x, n.y, hl ? `+${hl} HP` : 'HP полное', '#7be39a'); this.burst(n.x, n.y, '#7be39a', 8); }
        if (n.left <= 0) this.float(n.x, n.y - 6, 'истощено', '#c7cbe0');
        changed = true;
      }
      for (const m of S.mobs) {
        if (m.hp <= 0) continue;
        const vn = this.bounceStatic(d, m);
        if (vn <= 5) continue;
        let dmg = Math.ceil((d.m * vn) / 120);
        if (d.hero.i === 1) dmg += Math.min(d.bounces, 4);
        if (d.charged) { dmg *= 2; d.charged = false; }
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
      if (S.haz.has(hazKey(Math.floor(d.x / 16), Math.floor(d.y / 16)))) {
        this.float(d.x, d.y, S.biome.haz === 'lava' ? 'лава!' : 'шипы!', '#ff4d6a');
        this.hurtHero(d.hero, S.biome.hazDmg);
      }
    }
  }

  private mobsStart() {
    const S = this.S;
    for (const m of this.liveMobs()) {
      if (m.burn > 0) { this.hurtMob(m, 4, '#ff7a3d', true); m.burn--; }
      m.fx = m.tx = m.x;
      m.fy = m.ty = m.y;
      if (m.hp <= 0 || !m.intent || m.speed === 0) continue;
      const h = S.heroes[m.intent.hero];
      if (h.hp <= 0 || h.pad === null) continue;
      const p = S.pads[h.pad], dx = p.x - m.x, dy = p.y - m.y, L = Math.hypot(dx, dy);
      const go = Math.max(0, Math.min(m.speed, L - m.reach + 8));
      let g2 = 0;
      while (g2 + 2 <= go && !this.inBlock(m.x + (dx / L) * (g2 + 2), m.y + (dy / L) * (g2 + 2), m.r)) g2 += 2;
      m.tx = m.x + (dx / L) * g2;
      m.ty = m.y + (dy / L) * g2;
    }
  }

  private mobsAttack() {
    const S = this.S;
    for (const m of this.liveMobs()) {
      const it = m.intent;
      if (!it || it.t !== 'hit') continue;
      const h = S.heroes[it.hero];
      if (h.hp <= 0 || h.pad === null) continue;
      const p = S.pads[h.pad];
      if (m.k === 'archer' || Math.hypot(p.x - m.x, p.y - m.y) <= m.reach + 2) { this.hurtHero(h, it.dmg); m.flash = 0.12; }
      else this.float(m.x, m.y, 'не достал', '#c7cbe0');
    }
  }

  private spawnWave() {
    const S = this.S;
    S.waves.shift();
    const n = 1 + (S.spec.depth > 6 ? 1 : 0) + (S.turn > 4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const k = S.pool[Math.floor(Math.random() * S.pool.length)];
      const [x, y] = spawnSpot(S, 12, Math.random);
      S.mobs.push(newMob(k, x, y, S.hpMul, S.dmgAdd));
      this.float(x, y, 'из тьмы!', '#ff4d6a');
      this.burst(x, y, '#ff4d6a', 16);
    }
  }

  private nextTurn() {
    const S = this.S;
    if (!this.alive().length || (!this.liveMobs().length && !S.waves.length)) { this.finish(); return; }
    if (S.waves[0] && S.waves[0] <= S.turn) this.spawnWave();
    if (!this.liveMobs().length && S.waves.length) this.spawnWave();
    S.turn++;
    S.discs = [];
    for (const h of S.heroes) { h.shield = 0; h.thrown = false; h.hand = h.hp > 0 ? h.discs : 0; }
    S.phase = 'throw';
    if (this.hero.hp <= 0) this.act = Math.max(0, S.heroes.findIndex(h => h.hp > 0));
    this.pickIntents();
    this.onChange();
  }

  private finish() {
    this.S.phase = 'over';
    this.onChange();
    this.onRoomEnd(this.alive().length > 0);
  }

  update(dt: number) {
    const S = this.S;
    this.acc += dt;
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
    if (S.phase === 'throw' && this.allThrown() && !this.moving()) {
      S.phase = 'resolve'; S.timer = 0.9; this.resolve(); this.onChange();
    } else if (S.phase === 'resolve' && (S.timer -= dt) <= 0) {
      S.phase = 'enemy'; S.timer = 1.5; this.mobsStart(); S.attacked = false; this.onChange();
    } else if (S.phase === 'enemy') {
      S.timer -= dt;
      const u = Math.min(1, (1.5 - S.timer) / 0.6), e = u * u * (3 - 2 * u);
      for (const m of this.liveMobs()) {
        m.x = m.fx + (m.tx - m.fx) * e;
        m.y = m.fy + (m.ty - m.fy) * e;
        // a miniature is lifted and put down when it moves
        m.hop = Math.hypot(m.tx - m.fx, m.ty - m.fy) > 1 ? Math.sin(Math.PI * u) * 7 : 0;
      }
      if (!S.attacked && S.timer < 0.8) { S.attacked = true; this.mobsAttack(); this.onChange(); }
      if (S.timer <= 0) this.nextTurn();
    }
    for (const d of S.discs) if (d.fall && !d.gone) { d.fall += dt; if (d.fall > 0.5) d.gone = true; }
    for (const m of S.mobs) { if (m.flash > 0) m.flash -= dt; if (m.dead) m.dead += dt; }
    for (const h of S.heroes) if (h.flash > 0) h.flash -= dt;
    for (const n of S.nodes) if (n.hit > 0) n.hit -= dt;
    if (S.shake > 0) S.shake -= dt;
    for (const p of S.sparks) { p.t += dt; p.x += p.vx * dt * 0.5; p.y += p.vy * dt * 0.5; p.vh -= 160 * dt; p.h = Math.max(0, p.h + p.vh * dt); }
    S.sparks = S.sparks.filter(p => p.t < 0.5);
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter(f => f.t < 1.6);
  }
}
