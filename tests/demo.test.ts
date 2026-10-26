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

  it('draws from its six events and hands out the starting trophies only', async () => {
    const { DEMO_EVENTS } = await import('../src/demo');
    const { eventOf } = await import('../src/events');
    const { artLocked, openEvents, START_ARTS } = await import('../src/progress');
    const { ARTIFACTS } = await import('../src/artifacts');
    expect(DEMO_EVENTS).toHaveLength(6);
    expect(openEvents().sort()).toEqual([...DEMO_EVENTS].sort());
    const seen = new Set(Array.from({ length: 300 }, (_, s) => eventOf(s)));
    expect([...seen].sort()).toEqual([...DEMO_EVENTS].sort());
    expect(ARTIFACTS.map(a => a.key).filter(k => !artLocked(k)).sort()).toEqual([...START_ARTS].sort());
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
