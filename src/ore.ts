// Whose ore it is. Alone (the campaign, one player for every hero) the party shares one pool, Bank.ore. Online every
// player keeps their own: each hero has its ore (HeroState.ore), and what the party wins together, from the veins, a
// fight without a scratch, the blacksmith's gift or an event, is dealt out to every hero alike, the fallen and the heroes
// of players who dropped out too. What one hero earns for itself (digging at the camp, «Копилка», a trophy handed in at the
// pawnshop) is its own, and each hero buys at the blacksmith's with its own.

import type { Bank, HeroState } from './game';

/** Online every hero keeps its own ore; alone the party shares the pool. */
export const own = (bank: Bank) => !!bank.split;

/** The ore the hero has to spend: its own online, the party's pool alone. */
export const oreOf = (h: HeroState | null | undefined, bank: Bank) => (bank.split ? h?.ore ?? 0 : bank.ore);

/** All the party's ore: the pool, or online every hero's put together. */
export const partyOre = (party: HeroState[], bank: Bank) => (bank.split ? party.reduce((a, h) => a + (h.ore ?? 0), 0) : bank.ore);

/**
 * Ore the party has won together. Alone it goes into the pool. Online it is dealt out one at a time, each to the hero
 * who has been dealt the least this run (HeroState.got); on a tie to `by`, the hero whose hit won it, then to the first in
 * the party. So no hero ever has more than one ore over another from what they won together. Says what each hero got.
 */
export function deal(n: number, party: HeroState[], bank: Bank, by?: HeroState | null): Map<HeroState, number> {
  const got = new Map<HeroState, number>();
  if (n <= 0) return got;
  if (!bank.split || !party.length) { bank.ore += n; return got; }
  for (let k = 0; k < n; k++) {
    const lo = Math.min(...party.map(h => h.got ?? 0)), tied = party.filter(h => (h.got ?? 0) === lo);
    const h = by && tied.includes(by) ? by : tied[0];
    h.got = lo + 1;
    h.ore = (h.ore ?? 0) + 1;
    got.set(h, (got.get(h) ?? 0) + 1);
  }
  return got;
}

/** Ore the hero has earned for itself: its own online, the pool's alone. */
export function give(h: HeroState, n: number, bank: Bank) {
  if (n <= 0) return;
  if (bank.split) h.ore = (h.ore ?? 0) + n;
  else bank.ore += n;
}

/** The hero pays `n` out of its ore (the pool alone); false, and nothing paid, when there isn't that much. */
export function spend(h: HeroState, n: number, bank: Bank): boolean {
  if (oreOf(h, bank) < n) return false;
  if (bank.split) h.ore = (h.ore ?? 0) - n;
  else bank.ore -= n;
  return true;
}

/** Up to `n` ore taken from the hero (the pool alone), as much as there is; says how much went. */
export function take(h: HeroState, n: number, bank: Bank): number {
  const k = Math.max(0, Math.min(n, oreOf(h, bank)));
  if (bank.split) h.ore = (h.ore ?? 0) - k;
  else bank.ore -= k;
  return k;
}

/**
 * The party pays `n` together. Alone out of the pool. Online they chip in alike: each pays an even share, the richest the
 * ore left over; a hero short of its share pays what it has and the others, the richest first, make up the rest. False,
 * and nothing paid, when all of them together haven't got that much.
 */
export function payAll(n: number, party: HeroState[], bank: Bank): boolean {
  if (n <= 0) return true;
  if (partyOre(party, bank) < n) return false;
  if (!bank.split) { bank.ore -= n; return true; }
  const has = (h: HeroState) => h.ore ?? 0, rich = [...party].sort((a, b) => has(b) - has(a));
  const owe = new Map(party.map(h => [h, Math.floor(n / party.length)]));
  for (let k = 0; k < n % party.length; k++) owe.set(rich[k], owe.get(rich[k])! + 1);
  let short = 0;
  for (const h of party) if (owe.get(h)! > has(h)) { short += owe.get(h)! - has(h); owe.set(h, has(h)); }
  while (short > 0) {
    const h = rich.reduce((a, b) => (has(b) - owe.get(b)! > has(a) - owe.get(a)! ? b : a));
    owe.set(h, owe.get(h)! + 1);
    short--;
  }
  for (const h of party) h.ore = has(h) - owe.get(h)!;
  return true;
}

/**
 * Robbers take half of the ore, rounded up, `min` at the least (as much as there is): alone half the pool, online half of
 * every hero's own, and the richest make up what falls short of `min`. Says how much went.
 */
export function rob(party: HeroState[], bank: Bank, min: number): number {
  const all = partyOre(party, bank);
  if (!bank.split) { const n = Math.min(all, Math.max(min, Math.ceil(all / 2))); bank.ore -= n; return n; }
  let n = 0;
  for (const h of party) { const k = Math.ceil((h.ore ?? 0) / 2); h.ore = (h.ore ?? 0) - k; n += k; }
  while (n < min) {
    const h = party.reduce((a, b) => ((b.ore ?? 0) > (a.ore ?? 0) ? b : a));
    if (!(h.ore ?? 0)) break;
    h.ore!--;
    n++;
  }
  return n;
}

/** Online at the blacksmith's: the hero hands one ore of its own to a teammate; false when it has none. */
export function chipIn(from: HeroState, to: HeroState, bank: Bank): boolean {
  if (!bank.split || from === to || (from.ore ?? 0) < 1) return false;
  from.ore!--;
  to.ore = (to.ore ?? 0) + 1;
  return true;
}
