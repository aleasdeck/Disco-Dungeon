import { describe, expect, it } from 'vitest';
import { HAND_COST, HAND_START, MOBS, UP_COST } from '../src/data';
import { LAYERS } from '../src/run';
import { Game, newBank, newParty, type HeroState } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { chipIn, deal, give, oreOf, partyOre, payAll, rob, spend } from '../src/ore';
import { ROB_MIN, SELL, applyFx, eventDef, sellPick, shutWhy, stageOf, take, type EventState, type Table } from '../src/events';
import { campDo, digOre, type CampState } from '../src/camp';
import { makeRng } from '../src/rng';

const placeAll = (g: Game) => g.alive().forEach((h, k) => g.movePad(h, k));
const ores = (party: HeroState[]) => party.map(h => h.ore ?? 0);

describe('ore alone: one pool for the party', () => {
  it('puts every gain into the pool and pays out of it', () => {
    const party = newParty([0, 1, 2]), bank = newBank();
    expect(bank.split).toBeUndefined();
    deal(5, party, bank, party[1]);
    give(party[2], 2, bank);
    expect(bank.ore).toBe(7);
    expect(ores(party)).toEqual([0, 0, 0]);
    expect(oreOf(party[0], bank)).toBe(7);
    expect(spend(party[0], 4, bank)).toBe(true);
    expect(payAll(3, party, bank)).toBe(true);
    expect(bank.ore).toBe(0);
    expect(payAll(1, party, bank)).toBe(false);
    expect(chipIn(party[0], party[1], { ...bank, ore: 5 })).toBe(false);
  });
});

describe('ore online: each player keeps their own', () => {
  const trio = () => ({ party: newParty([0, 1, 2]), bank: newBank(0, true) });

  it('deals what the party wins one at a time, the hit first, so nobody gets more than one over another', () => {
    const { party, bank } = trio();
    deal(2, party, bank, party[2]);
    expect(ores(party)).toEqual([1, 0, 1]);
    deal(1, party, bank, party[2]);
    expect(ores(party)).toEqual([1, 1, 1]);
    expect(bank.ore).toBe(0);
    // thousands of odd amounts from random hits: what each was dealt stays within one of the others
    const R = makeRng(7);
    for (let k = 0; k < 2000; k++) {
      deal(R.int(1, 5), party, bank, party[R.int(0, 2)]);
      const got = party.map(h => h.got ?? 0);
      expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
    }
    expect(partyOre(party, bank)).toBe(party.reduce((a, h) => a + (h.got ?? 0), 0));
  });

  it('keeps what a hero earns itself and what it spends to that hero', () => {
    const { party, bank } = trio();
    give(party[1], 3, bank);
    expect(ores(party)).toEqual([0, 3, 0]);
    expect(oreOf(party[1], bank)).toBe(3);
    expect(spend(party[0], 1, bank)).toBe(false);
    expect(spend(party[1], 2, bank)).toBe(true);
    expect(ores(party)).toEqual([0, 1, 0]);
    // what one earns on its own doesn't hold its turn back when the party's winnings are dealt
    deal(3, party, bank);
    expect(ores(party)).toEqual([1, 2, 1]);
  });

  it('pays a price together, alike, the richest the odd ore and for whoever is short', () => {
    const { party, bank } = trio();
    party.forEach((h, k) => (h.ore = [5, 5, 5][k]));
    expect(payAll(4, party, bank)).toBe(true);
    expect(ores(party).sort()).toEqual([3, 4, 4]);
    party.forEach((h, k) => (h.ore = [0, 6, 3][k]));
    expect(payAll(6, party, bank)).toBe(true);
    // 2 each: the first has none, so the richest covers it
    expect(ores(party)).toEqual([0, 2, 1]);
    expect(payAll(4, party, bank)).toBe(false);
    expect(ores(party)).toEqual([0, 2, 1]);
  });

  it('robbers take half of each one\'s ore, and at least the least they take', () => {
    const { party, bank } = trio();
    party.forEach((h, k) => (h.ore = [4, 3, 0][k]));
    expect(rob(party, bank, ROB_MIN)).toBe(4);
    expect(ores(party)).toEqual([2, 1, 0]);
    expect(rob(party, bank, ROB_MIN)).toBe(ROB_MIN);
    expect(ores(party)).toEqual([0, 0, 0]);
  });

  it('hands one ore to a teammate, never more than the giver has', () => {
    const { party, bank } = trio();
    party[0].ore = 1;
    expect(chipIn(party[0], party[2], bank)).toBe(true);
    expect(chipIn(party[0], party[2], bank)).toBe(false);
    expect(chipIn(party[2], party[2], bank)).toBe(false);
    expect(ores(party)).toEqual([0, 0, 1]);
  });
});

describe('ore online in the game', () => {
  const online = (picks = [0, 1, 2]) => {
    const g = new Game();
    g.party = newParty(picks);
    g.bank = newBank(0, true);
    g.online = true;
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    return g;
  };

  it('every hero buys at the blacksmith\'s with its own ore, and may chip in for a teammate', () => {
    const g = online(), [a, b, c] = g.party;
    g.forge = 1;
    a.ore = HAND_COST[0] - 1;
    b.ore = 1;
    g.buyDisc(a);
    expect(a.discs).toBe(HAND_START);
    g.perform({ k: 'chip', h: b.i, to: a.i });
    expect([a.ore, b.ore]).toEqual([HAND_COST[0], 0]);
    g.buyDisc(a);
    expect([a.discs, a.ore]).toEqual([HAND_START + 1, 0]);
    c.ore = UP_COST[0];
    g.upgrade('m', a);
    expect(a.up.m).toBe(0);
    g.upgrade('m', c);
    expect([c.up.m, c.ore]).toEqual([1, 0]);
    // no handing ore over in the sharpening window or away from the blacksmith's
    c.ore = 2;
    g.whet = true;
    g.perform({ k: 'chip', h: c.i, to: b.i });
    g.whet = false;
    g.forge = 0;
    g.perform({ k: 'chip', h: c.i, to: b.i });
    expect([b.ore, c.ore]).toEqual([0, 2]);
  });

  it('deals the ore mined in the cave out to the heroes, and the snapshot carries it to every screen', () => {
    const g = new Game();
    g.party = newParty([0, 1, 2]);
    g.bank = newBank(0, true);
    g.loadRoom({ seed: 4, depth: LAYERS + 2, floor: 1, type: 'treasure' });
    placeAll(g); g.startFight();
    const h = g.hero, p = g.spot(h)!, v = g.S.nodes.filter(n => n.k === 'ore').sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y))[0];
    g.throwDisc(h, v.x - p.x, v.y - p.y);
    for (let k = 0; k < 600 && g.moving(); k++) g.update(1 / 60);
    expect(g.mined).toBeGreaterThan(0);
    expect(g.bank.ore).toBe(0);
    expect(partyOre(g.party, g.bank)).toBe(g.mined);
    expect(h.ore).toBeGreaterThan(0);
    const c = new Game();
    applySnapshot(c, JSON.parse(JSON.stringify(snapshot(g))));
    expect(ores(c.party)).toEqual(ores(g.party));
    expect(c.bank.split).toBe(true);
  });

  it('Пахан steals from the hero he hits and gives it back twice over to that hero', () => {
    const g = online(), [a, b] = g.party;
    a.ore = 5;
    b.ore = 5;
    const m = g.S.mobs[0], pot = MOBS.pahan2.pot!;
    m.k = 'pahan2';
    (g as unknown as { steal(m: unknown, h: HeroState): void }).steal(m, a);
    expect([a.ore, b.ore, m.pot]).toEqual([5 - pot, 5, pot]);
    g.hurtMob(m, 999, '#fff', true, 1, b);
    expect([a.ore, b.ore]).toEqual([5 + pot, 5]);
  });
});

describe('events and the camp online', () => {
  const at = (key: string, seed = 1000): EventState => ({ key, seed, votes: {} });
  const tbl = (party: HeroState[]): Table => ({ party, bank: newBank(0, true) });

  it('opens a paid choice for what the party has together, and everyone chips in', () => {
    const party = newParty([0, 1, 2]), t = tbl(party), c = eventDef('pawn').choices[0];
    party.forEach((h, k) => (h.ore = [10, 6, 3][k]));
    expect(shutWhy(c, t)).toBe('Нужно 20 руды');
    party[2].ore = 4;
    expect(shutWhy(c, t)).toBeNull();
    expect(take(at('pawn'), 0, t)).toBe(true);
    expect(ores(party)).toEqual([0, 0, 0]);
  });

  it('deals an event\'s ore out, takes half of each one\'s to the robbers, and pays a trophy to the hero who handed it in', () => {
    const party = newParty([0, 1, 2]), bank = newBank(0, true);
    applyFx([{ k: 'ore', n: 4 }], party, bank, 1);
    expect(ores(party)).toEqual([2, 1, 1]);
    applyFx([{ k: 'rob' }], party, bank, 1);
    expect(ores(party)).toEqual([1, 0, 0]);
    party.forEach(h => (h.ore = 0));
    party[1].arts = ['belly'];
    const t: Table = { party, bank }, ev = at('pawn');
    expect(take(ev, 1, t)).toBe(true);
    sellPick(ev, 1, 'belly', t, [0, 1, 2]);
    expect(stageOf(ev)).toBe('done');
    expect(ores(party)).toEqual([0, SELL, 0]);
  });

  it('keeps the ore dug at the camp for the digger', () => {
    const party = newParty([0, 1, 2]), bank = newBank(0, true), camp = { seed: 9001, did: {} } as CampState;
    const n = digOre(camp.seed, party[1].i);
    campDo(camp, party[1], { k: 'dig' }, party, bank);
    expect(ores(party)).toEqual([0, n, 0]);
  });
});
