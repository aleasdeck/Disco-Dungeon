// Seeded RNG (mulberry32). Same seed gives the same room on every client.

export interface Rng {
  next: () => number;
  int: (a: number, b: number) => number;
  pick: <T>(arr: readonly T[]) => T;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}
