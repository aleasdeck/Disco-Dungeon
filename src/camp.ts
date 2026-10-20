// The camp on the run map opens its own window, where every hero does one thing by the fire: rests, patches up a
// teammate (in a party of two or three), or digs the ore vein behind the fire for 0 to 3 ore.

import type { Bank, HeroState } from './game';
import { makeRng } from './rng';

/** Health a rest by the fire or a teammate's bandage gives back; a fallen hero gets up with half instead. */
export const CAMP_HEAL = 8;
/** Most ore one hero digs out at a camp; the least is none. */
export const DIG_MAX = 3;

/** What a hero asks to do by the fire: rest, bandage the hero with this index, or dig. */
export type CampPick = { k: 'rest' } | { k: 'mend'; to: number } | { k: 'dig' };

/** What a hero did by the fire, and what came of it: health given back, or ore found. */
export type CampDid = { k: 'rest'; hp: number } | { k: 'mend'; to: number; hp: number } | { k: 'dig'; ore: number };

/** The camp the party sits at, the same on every screen: the host keeps it and shares it with the map. */
export interface CampState {
  /** The room's seed: the ore each hero digs is rolled from it. */
  seed: number;
  /** What each hero has done here, by hero; every hero does one thing. */
  did: Record<number, CampDid>;
}

/** Ore a hero digs out at this camp, 0 to DIG_MAX: the same on every screen and after a reload. */
export const digOre = (seed: number, hero: number) => makeRng(seed * 7 + hero * 977 + 5).int(0, DIG_MAX);

/** Health back by CAMP_HEAL, up to the top; a fallen hero gets up with half. Returns how much it gave. */
function heal(h: HeroState) {
  const was = Math.max(0, h.hp);
  h.hp = h.hp <= 0 ? Math.ceil(h.max / 2) : Math.min(h.max, h.hp + CAMP_HEAL);
  return h.hp - was;
}

/** Whether a hero can do this by the fire now: the fallen can only get up, and a bandage goes to a hurt teammate. */
export function canCamp(h: HeroState, pick: CampPick, party: HeroState[]): boolean {
  if (pick.k === 'rest') return h.hp < h.max;
  if (h.hp <= 0) return false;
  if (pick.k === 'dig') return true;
  const t = party.find(o => o.i === pick.to);
  return !!t && t !== h && t.hp < t.max;
}

/** Do what a hero picked, once per camp: heal, or add the ore to the party's pool. Returns what came of it, or null. */
export function campDo(camp: CampState, h: HeroState, pick: CampPick, party: HeroState[], bank: Bank): CampDid | null {
  if (camp.did[h.i] || !canCamp(h, pick, party)) return null;
  let did: CampDid;
  if (pick.k === 'rest') did = { k: 'rest', hp: heal(h) };
  else if (pick.k === 'mend') did = { k: 'mend', to: pick.to, hp: heal(party.find(o => o.i === pick.to)!) };
  else {
    did = { k: 'dig', ore: digOre(camp.seed, h.i) };
    bank.ore += did.ore;
  }
  return (camp.did[h.i] = did);
}

/** The party walks on: a hero who did nothing here (their player dropped out) has rested by the fire. */
export function campLeave(camp: CampState, party: HeroState[], bank: Bank) {
  for (const h of party) campDo(camp, h, { k: 'rest' }, party, bank);
}
