import { describe, expect, it } from 'vitest';
import { HAND_COST, HAND_START, MOBS, NODES, RAGE_FROM, RAGE_FROM_BOSS, UP_COST } from '../src/data';
import { Game, newBank, newParty } from '../src/game';
import { generate, volBlow, type RoomSpec } from '../src/room';
import { CAMP_HEAL, campDo, newCamp } from '../src/camp';
import { OFFER, newLoot } from '../src/artifacts';
import { VOL, VOL_BOSS_HP, VOL_CAMP_HEAL, VOL_MAX, VOL_OFFER, VOL_RULES, setOut } from '../src/volume';

/** The same room at two «Громкость» steps. */
const both = (spec: RoomSpec, a: number, b: number) => [generate({ ...spec, vol: a }), generate({ ...spec, vol: b })];

describe('«Громкость»', () => {
  it('has a rule for every step, each coming in at its own step', () => {
    expect(VOL_RULES).toHaveLength(VOL_MAX);
    expect(new Set(Object.values(VOL)).size).toBe(VOL_MAX);
    for (const at of Object.values(VOL)) expect(at >= 1 && at <= VOL_MAX).toBe(true);
  });

  it('brings an elite one enemy more, for any party', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const [quiet, loud] = both({ seed, depth: 5, floor: seed % 3, type: 'elite', heroes: 1 + (seed % 3) }, 0, VOL.elite);
      expect(loud.mobs.length).toBe(quiet.mobs.length + 1);
    }
  });

  it('makes the floor bosses thicker and every other enemy hit one harder, from their steps on', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const spec: RoomSpec = { seed, depth: 8, floor: seed % 3, type: 'boss', heroes: 2 };
      const [before, after] = both(spec, VOL.boss - 1, VOL.boss);
      expect(after.mobs[0].max).toBe(Math.round(before.mobs[0].max * VOL_BOSS_HP));
      const [soft, hard] = both(spec, VOL.blow - 1, VOL.blow);
      expect(hard.mobs[0].dmg).toBe(soft.mobs[0].dmg);
      hard.mobs.slice(1).forEach((m, k) => expect(m.dmg).toBe(soft.mobs[k + 1].dmg + (MOBS[m.k].dmg ? 1 : 0)));
    }
    expect(volBlow({ vol: VOL.blow }, 'skel')).toBe(1);
    expect(volBlow({ vol: VOL.blow - 1 }, 'skel')).toBe(0);
    expect(volBlow({ vol: VOL_MAX }, 'king')).toBe(0);
  });

  it('takes a mushroom off every patch in a fight, never the last one, and leaves the ore cave as it is', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const spec: RoomSpec = { seed, depth: 3, floor: 0, type: 'fight', heroes: 3 };
      const [full, thin] = both(spec, VOL.herb - 1, VOL.herb);
      const herbs = (L: typeof full) => L.nodes.filter(n => n.k === 'herb').map(n => n.ch);
      expect(herbs(thin)).toEqual(herbs(full).map(c => Math.max(1, c - 1)));
      const [c0, c1] = both({ ...spec, type: 'treasure' }, 0, VOL_MAX);
      expect(c1.nodes.map(n => n.ch)).toEqual(c0.nodes.map(n => n.ch));
    }
    expect(NODES.herb.ch).toBeGreaterThan(1);
  });

  it('lets the enemies rage a turn sooner, and in the boss room from the first turn', () => {
    const at = (type: RoomSpec['type'], vol: number) => {
      const g = new Game();
      g.party = newParty([0]);
      g.bank = newBank(vol);
      g.loadRoom({ seed: 3, depth: 2, floor: 0, type });
      return g.rageFrom();
    };
    expect(at('fight', VOL.rage - 1)).toBe(RAGE_FROM);
    expect(at('fight', VOL.rage)).toBe(RAGE_FROM - 1);
    expect(at('boss', VOL.rage)).toBe(RAGE_FROM_BOSS - 1);
    expect(at('boss', VOL.bossRage)).toBe(1);
    expect(at('fight', VOL.bossRage)).toBe(RAGE_FROM - 1);
  });

  it('makes everything at the blacksmith\'s one ore dearer', () => {
    const g = new Game();
    g.party = newParty([0]);
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    const h = g.party[0];
    g.bank = newBank(VOL.forge - 1);
    expect([g.discCost(h), g.upCost(h, 'pw')]).toEqual([HAND_COST[0], UP_COST[0]]);
    g.bank = newBank(VOL.forge);
    expect([g.discCost(h), g.upCost(h, 'pw')]).toEqual([HAND_COST[0] + 1, UP_COST[0] + 1]);
    g.forge = 1;
    g.bank.ore = HAND_COST[0];
    g.buyDisc();
    expect(h.discs).toBe(HAND_START);
    g.bank.ore = HAND_COST[0] + 1;
    g.buyDisc();
    expect([h.discs, g.bank.ore]).toEqual([HAND_START + 1, 0]);
  });

  it('heals less by the fire, starts the party short of health and leaves fewer trophies to pick from', () => {
    const party = newParty([0, 1]);
    for (const h of party) h.hp = 1;
    expect(newCamp(5, VOL.camp - 1).heal).toBeUndefined();
    const camp = newCamp(5, VOL.camp);
    campDo(camp, party[0], { k: 'rest' }, party, newBank());
    campDo(camp, party[1], { k: 'mend', to: party[0].i }, party, newBank());
    expect(party[0].hp).toBe(1 + 2 * VOL_CAMP_HEAL);
    expect(VOL_CAMP_HEAL).toBeLessThan(CAMP_HEAL);

    const start = newParty([0, 1, 2]);
    setOut(start, VOL.start - 1);
    expect(start.every(h => h.hp === h.max)).toBe(true);
    setOut(start, VOL.start);
    for (const h of start) expect(h.hp).toBe(Math.ceil(h.max * 0.8));

    expect(newLoot(9, 0, newParty([0]), 'king', VOL.loot - 1).offer).toHaveLength(OFFER);
    expect(newLoot(9, 0, newParty([0]), 'king', VOL.loot).offer).toHaveLength(VOL_OFFER);
    expect(newLoot(9, 0, newParty([0, 1]), 'king', VOL.loot).offer).toHaveLength(VOL_OFFER);
    expect(newLoot(9, 0, newParty([0, 1, 2]), 'king', VOL.loot).offer).toHaveLength(3);
  });

  it('carries the step into every room the run builds', () => {
    const g = new Game();
    g.party = newParty([0]);
    g.bank = newBank(4);
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.vol).toBe(4);
    g.bank = newBank();
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.vol).toBeUndefined();
  });
});
