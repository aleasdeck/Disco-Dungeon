import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('a player from before there was any progress', () => {
  it('keeps the heroes played, opens the next of each that has won, and the first «Громкость» step', async () => {
    const box = new Map<string, string>([['discodungeon.stats', JSON.stringify({
      runs: 4, wins: 1,
      heroes: { bastion: { runs: 3, wins: 1, time: 0, kills: 0 }, sharp: { runs: 1, wins: 0, time: 0, kills: 0 } },
    })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => box.set(k, v), removeItem: (k: string) => box.delete(k) });
    vi.resetModules();
    const p = await import('../src/progress');
    expect(p.starsOf('bastion')).toBe(p.STARS_TO_OPEN);
    expect(p.locked('cook')).toBe(false);
    expect(p.locked('sharp')).toBe(false);
    expect(p.locked('electra')).toBe(true);
    expect(p.volTop()).toBe(1);
    expect(JSON.parse(box.get('discodungeon.progress')!).open).toEqual(['sharp', 'cook']);
  });
});
