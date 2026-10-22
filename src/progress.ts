// What this player has opened, kept in this browser: the heroes and their stars. A run starts with one hero of each kind;
// every floor boss beaten gives each hero of the party as many stars as the floor's number (a whole run: 1 + 2 + 3), and a
// hero with STARS_TO_OPEN of them opens the next hero of its own kind's ladder. Online every player counts their own
// hero, on their own device, and picks only from the heroes they have opened. The demo has its own three heroes and no
// stars. `?progress=full` in the address opens everything for a test without writing it down.

import { HEROES } from './data';
import { DEMO, DEMO_HEROES, stored } from './demo';
import { stats } from './stats';
import { FLOORS, type Run } from './run';

/** The heroes open from the first run: Бастион, Зажигалка, Рикошет, one of each kind, the same as the demo's. */
export const START_HEROES = ['bastion', 'ash', 'ricochet'];
/** Each kind's heroes in the order they open, the simple ones first: Толстяки, Чуваки, Дрищи. */
export const LADDERS = [
  ['bastion', 'cook', 'bouncer', 'cop'],
  ['ash', 'electra', 'bum', 'genius'],
  ['ricochet', 'sharp', 'kid', 'model'],
];
/** Stars a hero needs to open the next hero of its ladder: a whole run won gives exactly this many. */
export const STARS_TO_OPEN = 6;
/** Stars a floor's boss gives every hero of the party that beats it: the floor's number, 1 to 3. */
export const bossStars = (floor: number) => floor + 1;

/** One run as far as its stars are given out: how many of its bosses have paid, and what they brought. */
interface Cur {
  seed: number;
  heroes: string[];
  /** Bosses beaten and paid for so far, floor by floor. */
  floors: number;
  /** Stars each hero got in this run. */
  got: Record<string, number>;
  /** Heroes this run opened, in the order they opened. */
  opened: string[];
}

interface Progress {
  v: 1;
  /** Every hero's stars, kept growing past STARS_TO_OPEN. */
  stars: Record<string, number>;
  /** The heroes opened beyond START_HEROES. */
  open: string[];
  cur: Cur | null;
}

const KEY = stored('discodungeon.progress');
const ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('progress') === 'full';

/**
 * Read the progress; a player who played before there was any keeps every hero they have played and gets a whole
 * run's stars for every hero that has won one, from the statistics.
 */
function load(): Progress {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null') as Progress | null;
    if (o && o.v === 1) return { v: 1, stars: o.stars ?? {}, open: o.open ?? [], cur: o.cur ?? null };
  } catch { /* unreadable: start over below */ }
  const p: Progress = { v: 1, stars: {}, open: [], cur: null };
  for (const [k, h] of Object.entries(stats.heroes)) {
    if (!HEROES.some(d => d.key === k)) continue;
    if (h.runs > 0 && !START_HEROES.includes(k)) p.open.push(k);
    if (h.wins > 0) p.stars[k] = STARS_TO_OPEN;
  }
  for (const k of Object.keys(p.stars)) openNext(p, k);
  return p;
}

const progress: Progress = load();
save();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode: the progress lasts for this visit */ }
}

/** The ladder `key` stands on and its place there. */
function placeOf(key: string) {
  for (let r = 0; r < LADDERS.length; r++) {
    const at = LADDERS[r].indexOf(key);
    if (at >= 0) return { r, at };
  }
  return null;
}

/** The hero `key` opens: the next one up its ladder, or null for the last one. */
export function nextOf(key: string) {
  const p = placeOf(key);
  return p ? LADDERS[p.r][p.at + 1] ?? null : null;
}

/** The hero that opens `key`: the one before it on its ladder, or null for a starting hero. */
export function prevOf(key: string) {
  const p = placeOf(key);
  return p && p.at > 0 ? LADDERS[p.r][p.at - 1] : null;
}

/** The kind's place in KINDS (0 Толстяки, 1 Чуваки, 2 Дрищи) of the hero `key`. */
export const kindAt = (key: string) => placeOf(key)?.r ?? 0;

const isOpen = (p: Progress, key: string) => START_HEROES.includes(key) || p.open.includes(key);

/** Open the hero after `key` if `key` has the stars for it; true when it did. */
function openNext(p: Progress, key: string) {
  const next = nextOf(key);
  if (!next || isOpen(p, next) || (p.stars[key] ?? 0) < STARS_TO_OPEN) return false;
  p.open.push(next);
  return true;
}

/** Whether this player can't take the hero `key`: in the demo, any but its three; in the full game, one not opened yet. */
export function locked(key: string) {
  if (DEMO) return !DEMO_HEROES.includes(key);
  return !ALL && !isOpen(progress, key);
}

/** The hero `key` stays out of the demo; the full game lets anyone's own heroes in, whatever the host has opened. */
export const demoLocked = (key: string) => DEMO && !DEMO_HEROES.includes(key);

/** The stars of the hero `key`. */
export const starsOf = (key: string) => progress.stars[key] ?? 0;

/** The hero `key` still has a hero to open: the next one up its ladder is shut. Never in the demo. */
export const opening = (key: string) => {
  const next = nextOf(key);
  return !DEMO && !!next && locked(next);
};

/**
 * Give out the stars of the bosses beaten in `run` that haven't paid yet, to the heroes this player plays in it (`keys`),
 * and open what they bring. `won`: the last boss is down too. The same run pays each boss once, whatever comes again: a
 * reload, a rejoin, a saved campaign.
 */
export function creditRun(run: Run, keys: string[], won: boolean) {
  if (DEMO || !keys.length) return;
  let c = progress.cur;
  if (!c || c.seed !== run.seed || c.heroes.join() !== keys.join()) c = progress.cur = { seed: run.seed, heroes: keys, floors: 0, got: {}, opened: [] };
  const beaten = won ? FLOORS : Math.min(run.floor, FLOORS);
  if (beaten <= c.floors) return;
  for (let f = c.floors; f < beaten; f++) {
    for (const k of keys) {
      progress.stars[k] = (progress.stars[k] ?? 0) + bossStars(f);
      c.got[k] = (c.got[k] ?? 0) + bossStars(f);
    }
  }
  c.floors = beaten;
  for (const k of keys) if (openNext(progress, k)) c.opened.push(nextOf(k)!);
  save();
}

/** What a run brought this player: each of its heroes' stars, and the heroes it opened in the order they opened. */
export interface Gains { heroes: string[]; got: Record<string, number>; opened: string[] }

/** What `run` brought this player; null if it isn't the run counted. */
export function runGains(run: Run): Gains | null {
  const c = progress.cur;
  return !DEMO && c && c.seed === run.seed ? { got: c.got, opened: c.opened, heroes: c.heroes } : null;
}
