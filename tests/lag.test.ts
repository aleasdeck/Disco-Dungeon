// Online play over a slow, uneven link: a client's screen runs on smoothly, nothing on it starts over or steps back.
import { describe, expect, it } from 'vitest';
import { Game, newParty, type Action } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { makeRng } from '../src/rng';

/**
 * A fight between a host and a client one way 150 to 300 ms apart (now and then 400 ms more), messages in order: both
 * throw at an enemy, end the turn and watch the enemies' move. What the client's screen shows is checked every frame.
 */
function laggy(seed: number) {
  const rnd = makeRng(seed).next, late = () => 150 + rnd() * 150 + (rnd() < 0.05 ? 400 : 0);
  const host = new Game(), cli = new Game();
  host.online = true;
  host.party = newParty([0, 1]);
  host.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
  host.alive().forEach((h, k) => host.movePad(h, k));
  host.alive().forEach(h => host.startFight(h));
  let dirty = true, floats = 0, knocks = 0;
  host.onChange = () => { dirty = true; };
  const float = host.float.bind(host), knock = host.knock.bind(host);
  host.float = (...a) => { floats++; float(...a); };
  host.knock = (o, ...a) => { const was = o.knock; knock(o, ...a); if (o.knock !== was) knocks++; };

  let ms = 0, up = 0, down = 0, sent = -1e9;
  const toHost: { at: number; a: Action }[] = [], toCli: { at: number; s: string }[] = [];
  cli.online = true;
  cli.send = a => { up = Math.max(up, ms + late()); toHost.push({ at: up, a }); };
  cli.canControl = h => h.i === 1;
  cli.clock = () => ms + 123456;
  down = 150;
  toCli.push({ at: down, s: JSON.stringify(snapshot(host)) });
  const aim = (g: Game, i: number) => {
    const p = g.spot(g.heroOf(i))!, m = g.S.mobs.filter(o => o.hp > 0)[i % g.S.mobs.length], L = Math.hypot(m.x - p.x, m.y - p.y);
    return [((m.x - p.x) / L) * 55, ((m.y - p.y) / L) * 55] as const;
  };

  // what the client's screen showed last frame, and what started on it
  let tick = -1, back = 0, shown = 0, reeled = 0, enemy = false, hopped = false;
  const seen = { floats: new Map<string, number>(), knocks: new Map<string, number>() };
  let walk = { who: '', clock: 0 }, hop = new Map<number, number>();
  const stepsBack = { walk: 0, hop: 0 };
  for (let f = 0; f < 60 * 12; f++) {
    ms = (f * 1000) / 60;
    while (toHost.length && toHost[0].at <= ms) host.perform(toHost.shift()!.a);
    if (f === 18) host.throwDisc(host.heroOf(0), ...aim(host, 0));
    if (f === 36) cli.throwDisc(cli.heroOf(1), ...aim(cli, 1));
    if (f === 300) { host.endTurn(host.heroOf(0)); cli.endTurn(cli.heroOf(1)); }
    host.update(1 / 60);
    const S = host.S, busy = host.moving() || host.hopping() || S.phase === 'resolve' || S.phase === 'enemy';
    if ((dirty || busy) && ms - sent >= 50) {
      down = Math.max(down, ms + late());
      toCli.push({ at: down, s: JSON.stringify({ ...snapshot(host), cues: host.recentCues() }) });
      dirty = false;
      sent = ms;
    }
    while (toCli.length && toCli[0].at <= ms) applySnapshot(cli, JSON.parse(toCli.shift()!.s));
    if (!cli.S) continue;
    cli.update(1 / 60);
    const C = cli.S;
    if (tick >= 0 && cli.tick < tick) back++;
    tick = cli.tick;
    // a number over a hit is new when it wasn't there or is younger than it was: one that starts over counts again
    const fl = new Map<string, number>();
    for (const o of C.floats) {
      const k = `${o.txt}@${Math.round(o.x)},${Math.round(o.y)}`, was = seen.floats.get(k);
      if (was === undefined || o.t < was - 0.02) shown++;
      fl.set(k, o.t);
    }
    seen.floats = fl;
    // so is a figure reeling from a blow
    const kn = new Map<string, number>();
    const reel = (k: string, t: number) => {
      const was = seen.knocks.get(k);
      if (was === undefined || t < was - 0.02) reeled++;
      kn.set(k, t);
    };
    C.mobs.forEach((m, i) => { if (m.knock) reel(`m${i}`, m.knock.t); });
    C.heroes.forEach(h => { if (h.knock) reel(`h${h.i}`, h.knock.t); });
    seen.knocks = kn;
    if (C.phase === 'enemy' && C.actor >= 0) {
      enemy = true;
      const who = `${C.turn}:${C.actor}`;
      if (who === walk.who && C.clock < walk.clock - 0.02) stepsBack.walk++;
      walk = { who, clock: C.clock };
    }
    const leaps = new Map<number, number>();
    for (const h of C.heroes) if (h.from) {
      hopped = true;
      const was = hop.get(h.i);
      if (was !== undefined && h.leap < was - 0.05) stepsBack.hop++;
      leaps.set(h.i, h.leap);
    }
    hop = leaps;
  }
  return { back, floats, shown, knocks, reeled, enemy, hopped, stepsBack };
}

describe('online play over a slow link', () => {
  it('shows every hit\'s number and every reeling enemy once, and nothing steps back on the client\'s screen', () => {
    for (const seed of [1, 2, 3]) {
      const r = laggy(seed);
      // the fight had all of it: hits, enemies reeling, heroes hopping to their discs, the enemies' move
      expect(r.floats).toBeGreaterThanOrEqual(2);
      expect(r.knocks).toBeGreaterThanOrEqual(1);
      expect(r.enemy && r.hopped).toBe(true);
      expect(r.shown).toBe(r.floats);
      expect(r.reeled).toBe(r.knocks);
      expect(r.stepsBack).toEqual({ walk: 0, hop: 0 });
      expect(r.back).toBe(0);
    }
  });
});
