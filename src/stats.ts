// The player's own statistics, kept in this browser: how many runs, how long, with which heroes, and the records.
// Online every screen counts its own player's hero: the host counts what the heroes do (`Tally` in src/game.ts) and the
// snapshots carry it, so each player reads their own hero's numbers from the game state. In the campaign the player
// plays the whole party, so every hero of it counts: a run with each, and all they did.

import { newTally, type HeroState, type Tally } from './game';
import { FLOORS, type Run } from './run';

/** One hero's runs on this device. */
export interface HeroStats { runs: number; wins: number; time: number; kills: number }

/** The run under way (or the last one), and how much of it has been added to the totals already. */
interface Cur {
  seed: number;
  /** The heroes this player plays in it, by key: online their own, in the campaign the whole party. */
  heroes: string[];
  time: number;
  rooms: number;
  bosses: number;
  arts: number;
  /** Each hero's tally as far as it is in the totals, by key. */
  tallies: Record<string, Tally>;
  end?: 'win' | 'lose';
}

export interface Stats {
  runs: number;
  online: number;
  wins: number;
  losses: number;
  /** Seconds spent in runs with the game on screen and the player at it. */
  time: number;
  rooms: number;
  bosses: number;
  arts: number;
  /** Every run's tallies added up; `top` and `rico` hold the best of them instead. */
  sum: Tally;
  /** One run's best: most kills, most rooms, the deepest floor (1 to 3), the fastest win in seconds (0 for none yet); who dealt the biggest blow. */
  best: { kills: number; rooms: number; floor: number; fast: number; topBy: string };
  heroes: Record<string, HeroStats>;
  /** When the first run here began, in ms; 0 before it. */
  since: number;
  cur: Cur | null;
}

const KEY = 'discodungeon.stats';
/** The tallies that add up from run to run; the others are records. */
const SUMS = ['dmg', 'kills', 'throws', 'crits', 'abs', 'ore', 'hurt', 'falls'] as const;

const blank = (): Stats => ({
  runs: 0, online: 0, wins: 0, losses: 0, time: 0, rooms: 0, bosses: 0, arts: 0, sum: newTally(),
  best: { kills: 0, rooms: 0, floor: 0, fast: 0, topBy: '' }, heroes: {}, since: 0, cur: null,
});

function load(): Stats {
  const s = blank();
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Stats>;
    // a run counted before the campaign's party had one hero and one tally
    const cur = o.cur as (Cur & { hero?: string; tally?: Tally }) | null | undefined;
    if (cur && !cur.heroes) {
      cur.heroes = cur.hero ? [cur.hero] : [];
      cur.tallies = cur.hero && cur.tally ? { [cur.hero]: cur.tally } : {};
    }
    return { ...s, ...o, sum: { ...s.sum, ...o.sum }, best: { ...s.best, ...o.best }, heroes: o.heroes ?? {} };
  } catch {
    return s;
  }
}

export const stats: Stats = load();
let saved = JSON.stringify(stats);

/** Write the statistics down if anything changed since the last time. */
export function saveStats() {
  const j = JSON.stringify(stats);
  if (j === saved) return;
  saved = j;
  try { localStorage.setItem(KEY, j); } catch { /* private mode: the numbers last for this visit */ }
}

const heroStats = (key: string) => (stats.heroes[key] ??= { runs: 0, wins: 0, time: 0, kills: 0 });

/** The run being counted, if `run` is it. */
const counting = (run: Run) => (stats.cur?.seed === run.seed ? stats.cur : null);

/**
 * A run begins with this player's heroes (by their keys: online the own one, in the campaign the party), or goes on after
 * a reload or a rejoin: the same run counts once. Each hero counts a run of its own.
 */
export function beginRun(run: Run, keys: string[], online: boolean) {
  if (stats.cur?.seed === run.seed && stats.cur.heroes.join() === keys.join()) return;
  stats.runs++;
  if (online) stats.online++;
  for (const k of keys) heroStats(k).runs++;
  stats.since ||= Date.now();
  stats.cur = { seed: run.seed, heroes: keys, time: 0, rooms: 0, bosses: 0, arts: 0, tallies: {} };
  saveStats();
}

/** Time in the run: only while it is under way, on screen, and the player is at it. */
export function playTime(run: Run, dt: number) {
  const c = counting(run);
  if (!c || c.end) return;
  c.time += dt;
  stats.time += dt;
  for (const k of c.heroes) heroStats(k).time += dt;
}

/**
 * Add what is new in the run since the last call: the heroes' tallies, the rooms passed (`choosing`: the party stands between
 * rooms, so the last one entered is behind it), the floors' bosses and the trophies.
 */
export function syncRun(run: Run, heroes: HeroState[], choosing: boolean) {
  const c = counting(run);
  if (!c) return;
  // only the heroes the run began with, and their tallies of this run
  const mine = heroes.filter(h => c.heroes.includes(h.def.key) && h.tally?.run === c.seed);
  for (const h of mine) {
    const key = h.def.key, t = h.tally!, seen = (c.tallies[key] ??= newTally(c.seed));
    for (const k of SUMS) {
      const d = t[k] - seen[k];
      if (d <= 0) continue;
      stats.sum[k] += d;
      seen[k] = t[k];
      if (k === 'kills') heroStats(key).kills += d;
    }
    seen.top = Math.max(seen.top, t.top);
    seen.rico = Math.max(seen.rico, t.rico);
    if (t.top > stats.sum.top) { stats.sum.top = t.top; stats.best.topBy = key; }
    stats.sum.rico = Math.max(stats.sum.rico, t.rico);
  }
  if (mine.length) {
    stats.best.kills = Math.max(stats.best.kills, Object.values(c.tallies).reduce((n, t) => n + t.kills, 0));
    const arts = mine.reduce((n, h) => n + (h.arts?.length ?? 0), 0);
    if (arts > c.arts) { stats.arts += arts - c.arts; c.arts = arts; }
  }
  const won = c.end === 'win', entered = run.path.reduce((a, p) => a + p.length, 0);
  const rooms = won || choosing ? entered : entered - 1;
  if (rooms > c.rooms) { stats.rooms += rooms - c.rooms; c.rooms = rooms; }
  stats.best.rooms = Math.max(stats.best.rooms, c.rooms);
  // the floor counter moves on as the party walks out of a boss's room, but not after the last boss
  const bosses = won ? FLOORS : run.floor;
  if (bosses > c.bosses) { stats.bosses += bosses - c.bosses; c.bosses = bosses; }
  stats.best.floor = Math.max(stats.best.floor, won ? FLOORS : Math.min(FLOORS, run.floor + 1));
}

/** The run is over: won (the last boss is down) or lost (the whole party fell). Counted once, whatever comes again. */
export function endRun(run: Run, heroes: HeroState[], win: boolean) {
  const c = counting(run);
  if (!c || c.end) return;
  c.end = win ? 'win' : 'lose';
  if (win) {
    stats.wins++;
    for (const k of c.heroes) heroStats(k).wins++;
    if (!stats.best.fast || c.time < stats.best.fast) stats.best.fast = c.time;
  } else stats.losses++;
  syncRun(run, heroes, false);
  saveStats();
}

/** The hero played most: the most runs, then the most time. */
export function favourite(): string | null {
  let fav: string | null = null;
  for (const [k, h] of Object.entries(stats.heroes)) {
    const f = fav ? stats.heroes[fav] : null;
    if (h.runs && (!f || h.runs > f.runs || (h.runs === f.runs && h.time > f.time))) fav = k;
  }
  return fav;
}
