import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the demo is switched on by the address (src/demo.ts): each test loads the game's modules again under ?demo=true
let box: Map<string, string>;
beforeEach(() => {
  box = new Map();
  vi.stubGlobal('location', { search: '?demo=true' });
  vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => box.set(k, v), removeItem: (k: string) => box.delete(k) });
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the demo', () => {
  it('is one floor whose boss is any of its three, and every entrance has an event on its way by the third row', async () => {
    const { DEMO_EVENT_ROW, FLOORS, genFloor, routes } = await import('../src/run');
    const { CASTS, bossOf } = await import('../src/room');
    expect(FLOORS).toBe(1);
    const met = new Set<string>();
    for (let seed = 1; seed < 400; seed++) {
      const layers = genFloor(seed * 7919, 0), all = routes(layers);
      expect(layers[0].every(e => all.some(r => r[0] === e && r.some(n => n.type === 'event' && n.l <= DEMO_EVENT_ROW)))).toBe(true);
      met.add(bossOf({ seed, floor: 0 }));
    }
    expect([...met].sort()).toEqual([...CASTS[0].bosses].sort());
  });

  it('draws from its seven events and hands out the starting trophies only', async () => {
    const { DEMO_EVENTS } = await import('../src/demo');
    const { eventOf } = await import('../src/events');
    const { artLocked, openEvents, START_ARTS } = await import('../src/progress');
    const { ARTIFACTS } = await import('../src/artifacts');
    expect(DEMO_EVENTS).toHaveLength(7);
    expect(openEvents().sort()).toEqual([...DEMO_EVENTS].sort());
    const seen = new Set(Array.from({ length: 300 }, (_, s) => eventOf(s, ['mimic'])));
    expect([...seen].sort()).toEqual(DEMO_EVENTS.filter(k => k !== 'mimic').sort());
    expect(ARTIFACTS.map(a => a.key).filter(k => !artLocked(k)).sort()).toEqual([...START_ARTS].sort());
  });

  it("meets the chest far more often than the other events, and the chest's hand finds a trophy half the time, as in the full game", async () => {
    const { DEMO_CHEST_ODDS, DEMO_EVENTS } = await import('../src/demo');
    const { EVENTS, choicesOf, doneOf, eventOf, take } = await import('../src/events');
    const { newBank, newParty } = await import('../src/game');
    const N = 4000, keys = Array.from({ length: N }, (_, s) => eventOf(s * 7919 + 1));
    const share = (k: string) => keys.filter(x => x === k).length / N;
    expect(Math.abs(share('mimic') - DEMO_CHEST_ODDS)).toBeLessThan(0.03);
    for (const k of DEMO_EVENTS.filter(k => k !== 'mimic')) expect(share(k)).toBeGreaterThan(0.02);
    // a run that met it meets the others
    expect(Array.from({ length: 200 }, (_, s) => eventOf(s, ['bar', 'mimic']))).not.toContain('mimic');
    const got = new Set<string>();
    for (let s = 0; s < 60; s++) {
      const ev = { key: 'mimic', seed: s, votes: {} }, party = newParty([0]), opt = choicesOf(ev).findIndex(c => c.label === 'Сунуть руку');
      expect(choicesOf(ev)[opt].odds).toBe(0.5);
      expect(take(ev, opt, { party, bank: newBank() })).toBe(true);
      got.add(doneOf(ev)!.out.fx[0].k);
    }
    expect([...got].sort()).toEqual(['art', 'hp']);
    // the other demo events give no trophy: the chest is the demo's one way to them
    const arts = (o?: { fx: { k: string }[] }) => !!o?.fx.some(f => f.k === 'art' || f.k === 'gift');
    for (const e of EVENTS.filter(e => DEMO_EVENTS.includes(e.key) && e.key !== 'mimic')) expect(e.choices.some(c => arts(c.win) || arts(c.lose))).toBe(false);
  });

  it("opens one hero with its first win, the next up the first hero's ladder, and none after it", async () => {
    const p = await import('../src/progress');
    const { newRun } = await import('../src/run');
    for (const k of ['bastion', 'ash', 'ricochet']) expect(p.locked(k)).toBe(false);
    // the ones it may open are shut, but not out of the demo; the rest are
    for (const k of p.DEMO_OPENS) {
      expect(p.locked(k)).toBe(true);
      expect(p.demoLocked(k)).toBe(false);
    }
    expect(p.demoLocked('cop')).toBe(true);
    const lost = newRun(11);
    p.creditRun(lost, ['ash', 'bastion'], { won: false });
    expect(p.demoOpened()).toBe(null);
    const won = newRun(12);
    p.creditRun(won, ['ash', 'bastion'], { won: true });
    p.creditRun(won, ['ash', 'bastion'], { won: true });
    expect(p.demoOpened()).toBe('electra');
    expect(p.locked('electra')).toBe(false);
    expect(p.locked('cook')).toBe(true);
    expect(p.runGains(won)).toEqual({ heroes: ['ash', 'bastion'], got: {}, opened: ['electra'], events: [], arts: [] });
    // another win opens nothing more
    const again = newRun(13);
    p.creditRun(again, ['bastion'], { won: true });
    expect(p.locked('cook')).toBe(true);
    expect(p.runGains(again)?.opened).toEqual([]);
    // and it stays open in the next visit
    vi.resetModules();
    const q = await import('../src/progress');
    expect(q.locked('electra')).toBe(false);
    expect(q.demoOpened()).toBe('electra');
  });
});
