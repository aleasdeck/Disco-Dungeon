// What this player has opened, kept in this browser: the heroes and their stars, the events and the trophies.
// Heroes: a run starts with one hero of each kind; every floor boss beaten gives each hero of the party as many stars as
// the floor's number (a whole run: 1 + 2 + 3), and a hero with STARS_TO_OPEN of them opens the next hero of its own
// kind's ladder. Online every player counts their own hero, on their own device, and picks only from the heroes they have
// opened.
// Events («знакомства»): ten are open from the start, each of the others opens by a choice at the event before it in its
// chain (somebody there knows somebody) and waits in the next event room. Trophies («подвиги»): twelve are open from the
// start, each of the others opens by a feat of its own. Online the host's events and trophies come up, and every player
// opens their own by what they did there.
// «Громкость» (src/volume.ts): the first won run opens its first step, and a run won at the highest step opens the next.
// «Подставки мастерства» (src/stands.ts): the runs won with a hero dress it in a new stand; on the pick screens the player
// may put it back on any stand it has earned before.
// The demo has its own three heroes and events, the twelve starting trophies, no stars, no «Громкость» and no stands. Its
// first won run opens one hero, the next up the ladder of the party's first hero (online the player's own), and no other
// hero opens in the demo after it. `?progress=full` in the address opens everything for a test without writing it down,
// and `?stand=wood` puts every hero on that stand.

import { HEROES } from './data';
import { DEMO, DEMO_EVENTS, DEMO_HEROES, stored } from './demo';
import { stats } from './stats';
import { FLOORS, type Run } from './run';
import { EVENTS, type EventState } from './events';
import { shutArts, type ArtKey } from './artifacts';
import type { Tally } from './game';
import { VOL_MAX } from './volume';
import { STAND_MATS, standOf, type StandMat } from './stands';

/** The heroes open from the first run: Бастион, Зажигалка, Рикошет, one of each kind, the same as the demo's. */
export const START_HEROES = ['bastion', 'ash', 'ricochet'];
/** Each kind's heroes in the order they open, the simple ones first: Толстяки, Чуваки, Дрищи. */
export const LADDERS = [
  ['bastion', 'cook', 'bouncer', 'cop'],
  ['ash', 'electra', 'bum', 'genius'],
  ['ricochet', 'sharp', 'kid', 'model'],
];
/** The heroes the demo's first win may open: the next up its heroes' ladders, Поварёшка, Электра, Шулер. */
export const DEMO_OPENS = LADDERS.map(l => l[1]);
/** Stars a hero needs to open the next hero of its ladder: a whole run won gives exactly this many. */
export const STARS_TO_OPEN = 6;
/** Stars a floor's boss gives every hero of the party that beats it: the floor's number, 1 to 3. */
export const bossStars = (floor: number) => floor + 1;

/** The events open from the first run. */
export const START_EVENTS = ['bar', 'mimic', 'altar', 'doctor', 'gym', 'seer', 'toilet', 'ogre', 'goblin', 'dj'];

/**
 * The other events: each opens at the event `from` by one of its choices `opts` (their places in its list; any when not
 * given). `how` is the hint the collection gives. The slot machine counts a pull as its first choice.
 */
export const MEETS: { key: string; from: string; opts?: number[]; how: string }[] = [
  { key: 'mapper', from: 'bar', opts: [0, 1], how: 'В баре «Последний глоток» выпей что угодно: картограф пьёт за соседним столиком.' },
  { key: 'gnome', from: 'mapper', how: 'Дай пьяному картографу что-нибудь нарисовать: на его карте крестиком отмечена чужая заначка.' },
  { key: 'thimble', from: 'goblin', opts: [0, 1], how: 'Заключи сделку на Чёрном рынке: брат гоблина работает этажом ниже.' },
  { key: 'slot', from: 'thimble', opts: [0, 1, 2], how: 'Сыграй с наперсточником: азарт затягивает.' },
  { key: 'bookie', from: 'slot', opts: [0], how: 'Дёрни рычаг Жадной Люськи: у неё есть знакомый букмекер.' },
  { key: 'sphinx', from: 'seer', opts: [0], how: '«Позолоти ручку» гадалке: Лысый Сфинкс её кот.' },
  { key: 'tattoo', from: 'gym', opts: [0, 1], how: 'В качалке пожми валуны или хлебни протеина: качки идут бить наколки.' },
  { key: 'foam', from: 'dj', opts: [1], how: 'У будки диджея «Танцуй до упаду»: диджей зовёт на пенную.' },
  { key: 'bottle', from: 'foam', how: 'Побывай на пенной вечеринке: после неё афтепати.' },
  { key: 'husband', from: 'bottle', opts: [0, 1], how: 'Покрути бутылочку: на кого она покажет, та замужем.' },
  { key: 'gopnik', from: 'ogre', opts: [0], how: 'У храпуна на руде «Набей карманы»: слух о богачах разошёлся.' },
  { key: 'pawn', from: 'gopnik', opts: [0, 1], how: 'Отдай гопникам руду или цацку: отнятое всплывает на полке ломбарда.' },
];

/** The trophies open from the first run: a number or one plain rule each. */
export const START_ARTS: ArtKey[] = ['tray', 'polish', 'cup', 'belly', 'fangs', 'piggy', 'battery', 'energy', 'opener', 'glasseye', 'hedgehog', 'sock'];

/**
 * The other trophies, each opened by a feat about the trophy itself: a number this player's heroes have reached in all their
 * runs (`sum`: the statistics' sum, or its record for top, rico, multi and late), the floor's boss beaten (`boss`), or a
 * choice taken at an event (`ev`: the event and the places of the choices, any when null). `how` is what the collection says.
 */
export const FEATS: { key: ArtKey; how: string; sum?: [keyof Tally, number]; boss?: string; ev?: [string, number[] | null] }[] = [
  { key: 'xray', how: 'Попади во врага одним броском после трёх отскоков.', sum: ['rico', 3] },
  { key: 'spring', how: 'Нанеси один удар на 15 урона или больше.', sum: ['top', 15] },
  { key: 'chalk', how: 'Набери 100 «ТОЧНО!» за все забеги.', sum: ['crits', 100] },
  { key: 'insoles', how: 'Задень одним диском трёх врагов.', sum: ['multi', 3] },
  { key: 'bells', how: 'Набери 20 «ЗВОН!» за все забеги: это диски двух героев бьются друг о друга.', sum: ['clangs', 20] },
  { key: 'lube', how: 'Набери 1000 отскоков от стен и камней за все забеги.', sum: ['walls', 1000] },
  { key: 'undies', how: 'Урони 25 дисков в ямы. Утешительный приз.', sum: ['holes', 25] },
  { key: 'tea', how: 'Выиграй бой на 10-м ходу или позже, когда все уже озверели.', sum: ['late', 10] },
  { key: 'mirrorball', how: 'Победи Великого Диско-шара.', boss: 'discoball' },
  { key: 'denture', how: 'На алтаре диско-бога «Стащи подношения»: челюсть лежит прямо там.', ev: ['altar', [2]] },
  { key: 'boomerang', how: 'Побывай на пенной вечеринке: он оттуда.', ev: ['foam', null] },
  { key: 'hand', how: '«Отдай почку» гоблину на Чёрном рынке: рука за почку.', ev: ['goblin', [0]] },
];

/** One run as far as it is counted: how many of its bosses have paid their stars, and what it opened. */
interface Cur {
  seed: number;
  heroes: string[];
  /** Bosses beaten and paid for so far, floor by floor. */
  floors: number;
  /** Stars each hero got in this run. */
  got: Record<string, number>;
  /** Heroes, events and trophies this run opened, in the order they opened. */
  opened: string[];
  events?: string[];
  arts?: string[];
  /** The «Громкость» step this run opened. */
  vol?: number;
  /** The win is counted for the stands, and the new stands it gave the heroes. */
  stood?: boolean;
  stands?: Record<string, StandMat>;
}

interface Progress {
  v: 1;
  /** Every hero's stars, kept growing past STARS_TO_OPEN. */
  stars: Record<string, number>;
  /** The heroes opened beyond START_HEROES. */
  open: string[];
  /** The events opened beyond START_EVENTS, and the ones of them not met yet: the next event room brings the first. */
  events: string[];
  due: string[];
  /** The trophies opened beyond START_ARTS. */
  arts: string[];
  /** The highest «Громкость» step opened, 0 before the first won run. */
  vol: number;
  /** The heroes the player has put on a stand below the best one earned, picked on the pick screens. */
  worn: Record<string, StandMat>;
  cur: Cur | null;
}

const KEY = stored('discodungeon.progress');
/** `?progress=full` in the address: everything open for a test, nothing written down. */
export const ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('progress') === 'full';

/**
 * Read the progress; a player who played before there was any keeps every hero they have played and gets a whole
 * run's stars for every hero that has won one, from the statistics.
 */
function load(): Progress {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null') as Progress | null;
    // a player who has won before there was any «Громкость» has its first step open
    if (o && o.v === 1) return { v: 1, stars: o.stars ?? {}, open: o.open ?? [], events: o.events ?? [], due: o.due ?? [], arts: o.arts ?? [], vol: o.vol ?? (wonBefore() ? 1 : 0), worn: o.worn ?? {}, cur: o.cur ?? null };
  } catch { /* unreadable: start over below */ }
  const p: Progress = { v: 1, stars: {}, open: [], events: [], due: [], arts: [], vol: wonBefore() ? 1 : 0, worn: {}, cur: null };
  // the demo opens its one hero only by a win
  if (DEMO) return p;
  for (const [k, h] of Object.entries(stats.heroes)) {
    if (!HEROES.some(d => d.key === k)) continue;
    if (h.runs > 0 && !START_HEROES.includes(k)) p.open.push(k);
    if (h.wins > 0) p.stars[k] = STARS_TO_OPEN;
  }
  for (const k of Object.keys(p.stars)) openNext(p, k);
  return p;
}

/** Some hero of this player's has won a run, by the statistics. */
function wonBefore() {
  return Object.values(stats.heroes).some(h => h.wins > 0);
}

const progress: Progress = load();
save();
// the bosses and the events hand out only the trophies opened
shutArts(k => artLocked(k));

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

/** Whether `key` is open in `p`; a function declaration, as loading the progress (above) already needs it. */
function isOpen(p: Progress, key: string) {
  return START_HEROES.includes(key) || p.open.includes(key);
}

/** Open the hero after `key` if `key` has the stars for it; true when it did. */
function openNext(p: Progress, key: string) {
  const next = nextOf(key);
  if (!next || isOpen(p, next) || (p.stars[key] ?? 0) < STARS_TO_OPEN) return false;
  p.open.push(next);
  return true;
}

/** Whether this player can't take the hero `key`: in the demo, any but its three and the one it has opened; in the full game, one not opened yet. */
export function locked(key: string) {
  if (DEMO) return !isOpen(progress, key);
  return !ALL && !isOpen(progress, key);
}

/** The hero `key` stays out of the demo, which never opens it; the full game lets anyone's own heroes in, whatever the host has opened. */
export const demoLocked = (key: string) => DEMO && !DEMO_HEROES.includes(key) && !DEMO_OPENS.includes(key);

/** The hero the demo has opened, if it has: the demo opens only one. */
export const demoOpened = (): string | null => (DEMO ? progress.open[0] ?? null : null);

/** The stars of the hero `key`. */
export const starsOf = (key: string) => progress.stars[key] ?? 0;

/** The hero `key` still has a hero to open: the next one up its ladder is shut. Never in the demo. */
export const opening = (key: string) => {
  const next = nextOf(key);
  return !DEMO && !!next && locked(next);
};

/** What a run has done that opens things: won, the event the party stands in, and the player's numbers of all runs. */
export interface Deeds {
  won: boolean;
  ev?: EventState | null;
  /** The statistics' sums and records (stats.sum). */
  sum?: Partial<Tally>;
  /** The floor bosses beaten in this run. */
  bosses?: string[];
  /** The «Громкость» step the run is played at. */
  vol?: number;
}

/**
 * Count what `run` has done for the heroes this player plays in it (`keys`): the stars of the bosses beaten that haven't
 * paid yet and the heroes they open, the events met and the ones their choices open, and the trophies of the feats done.
 * The same run pays each boss once, whatever comes again: a reload, a rejoin, a saved campaign.
 */
export function creditRun(run: Run, keys: string[], o: Deeds) {
  if (!keys.length) return;
  let c = progress.cur;
  if (!c || c.seed !== run.seed || c.heroes.join() !== keys.join()) c = progress.cur = { seed: run.seed, heroes: keys, floors: 0, got: {}, opened: [] };
  // the demo's first win opens the next hero up the first hero's ladder, and nothing opens in the demo after it
  if (DEMO) {
    const next = nextOf(keys[0]);
    if (!o.won || progress.open.length || !next) return;
    progress.open.push(next);
    c.opened.push(next);
    save();
    return;
  }
  let changed = false;
  const beaten = o.won ? FLOORS : Math.min(run.floor, FLOORS);
  if (beaten > c.floors) {
    for (let f = c.floors; f < beaten; f++) {
      for (const k of keys) {
        progress.stars[k] = (progress.stars[k] ?? 0) + bossStars(f);
        c.got[k] = (c.got[k] ?? 0) + bossStars(f);
      }
    }
    c.floors = beaten;
    for (const k of keys) if (openNext(progress, k)) c.opened.push(nextOf(k)!);
    changed = true;
  }
  // a run won at the highest step opens the next one
  const up = Math.min(VOL_MAX, (o.vol ?? 0) + 1);
  if (o.won && up > progress.vol) {
    progress.vol = c.vol = up;
    changed = true;
  }
  // a won run may dress its heroes in a new stand, and the hero goes on it whatever stand it was put on before: the
  // statistics have counted the win by now
  if (o.won && !c.stood) {
    c.stood = true;
    for (const k of keys) {
      const w = stats.heroes[k]?.wins ?? 0;
      if (standOf(w) === standOf(w - 1)) continue;
      (c.stands ??= {})[k] = standOf(w);
      delete progress.worn[k];
    }
    changed = true;
  }
  if (o.ev && meet(o.ev, c)) changed = true;
  for (const f of FEATS) {
    const did = (f.sum && (o.sum?.[f.sum[0]] ?? 0) >= f.sum[1]) || (f.boss && o.bosses?.includes(f.boss));
    if (did && openArt(f.key, c)) changed = true;
  }
  if (changed) save();
}

/** Open the trophy `k` if it is shut; true when it did. */
function openArt(k: ArtKey, c: Cur) {
  if (START_ARTS.includes(k) || progress.arts.includes(k)) return false;
  progress.arts.push(k);
  (c.arts ??= []).push(k);
  return true;
}

/** The party is at the event `ev`: it is met (no longer waited for), and once a choice is taken, what that choice opens. */
function meet(ev: EventState, c: Cur) {
  let changed = false;
  if (progress.due.includes(ev.key)) {
    progress.due = progress.due.filter(k => k !== ev.key);
    changed = true;
  }
  if (!ev.done) return changed;
  // a pull of the slot machine's lever, whatever came of it
  const opt = ev.key === 'slot' && (ev.pulls ?? 0) > 0 ? 0 : ev.done.opt;
  for (const m of MEETS) {
    if (m.from !== ev.key || (m.opts && !m.opts.includes(opt)) || START_EVENTS.includes(m.key) || progress.events.includes(m.key)) continue;
    progress.events.push(m.key);
    progress.due.push(m.key);
    (c.events ??= []).push(m.key);
    changed = true;
  }
  for (const f of FEATS) if (f.ev && f.ev[0] === ev.key && (!f.ev[1] || f.ev[1].includes(opt)) && openArt(f.key, c)) changed = true;
  return changed;
}

/** What the choice taken at the event `ev` has just opened for this player in `run`: events and trophies. */
export function openedBy(ev: EventState, run: Run): { events: string[]; arts: ArtKey[] } {
  const c = progress.cur;
  if (DEMO || !c || c.seed !== run.seed || !ev.done) return { events: [], arts: [] };
  return {
    events: MEETS.filter(m => m.from === ev.key && c.events?.includes(m.key)).map(m => m.key),
    arts: FEATS.filter(f => f.ev?.[0] === ev.key && c.arts?.includes(f.key)).map(f => f.key),
  };
}

/** Whether this player hasn't opened the event `key`: in the demo, any but its three. */
export function eventLocked(key: string) {
  if (DEMO) return !DEMO_EVENTS.includes(key);
  return !ALL && !START_EVENTS.includes(key) && !progress.events.includes(key);
}

/** The events this player's runs draw from, and the ones just opened that wait for the next event room, oldest first. */
export const openEvents = () => EVENTS.map(e => e.key).filter(k => !eventLocked(k));
export const dueEvents = (): readonly string[] => (DEMO ? [] : progress.due);

/** How the event `key` opens, if it is one that opens. */
export const meetOf = (key: string) => MEETS.find(m => m.key === key) ?? null;

/** Whether this player hasn't opened the trophy `key`. The demo hands out the starting ones only. */
export function artLocked(key: string) {
  if (DEMO) return !START_ARTS.includes(key as ArtKey);
  return !ALL && !START_ARTS.includes(key as ArtKey) && !progress.arts.includes(key);
}

/** The feat that opens the trophy `key`, and how far this player has got with a counted one (null for the others). */
export function featOf(key: string) {
  const f = FEATS.find(o => o.key === key);
  if (!f) return null;
  return { how: f.how, now: f.sum ? Math.min(stats.sum[f.sum[0]] ?? 0, f.sum[1]) : null, need: f.sum?.[1] ?? null };
}

/** What a run brought this player: each of its heroes' stars, the heroes, events and trophies it opened, in order, the «Громкость» step and the new stands. */
export interface Gains { heroes: string[]; got: Record<string, number>; opened: string[]; events: string[]; arts: string[]; vol?: number; stands?: Record<string, StandMat> }

/** What `run` brought this player; null if it isn't the run counted. */
export function runGains(run: Run): Gains | null {
  const c = progress.cur;
  return c && c.seed === run.seed ? { got: c.got, opened: c.opened, heroes: c.heroes, events: c.events ?? [], arts: c.arts ?? [], ...(c.vol ? { vol: c.vol } : {}), ...(c.stands ? { stands: c.stands } : {}) } : null;
}

/** The highest «Громкость» step this player can turn the knob to: none in the demo, all of them with `?progress=full`. */
export const volTop = () => (DEMO ? 0 : ALL ? VOL_MAX : progress.vol);

/** `?stand=wood` in the address: every hero on that stand, for a test. */
const TEST_STAND = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('stand') as StandMat | null) : null;

/** The best stand this player's wins with the hero `key` have earned: plain in the demo, the mirror with `?progress=full`. */
export function bestStand(key: string): StandMat {
  if (TEST_STAND && STAND_MATS.includes(TEST_STAND)) return TEST_STAND;
  if (DEMO) return 'plastic';
  return ALL ? 'mirror' : standOf(stats.heroes[key]?.wins ?? 0);
}

/** Stands picked in a test (`?progress=full`, `?stand=`): for this visit only, never written down. */
const testWorn: Record<string, StandMat> = {};
const wornNow = () => (ALL || TEST_STAND ? testWorn : progress.worn);

/** The stand the hero `key` goes on: the one the player put it on, while earned, or the best one. */
export function standFor(key: string): StandMat {
  const best = bestStand(key), w = wornNow()[key];
  return w && STAND_MATS.indexOf(w) <= STAND_MATS.indexOf(best) ? w : best;
}

/** Put the hero `key` on the stand `mat`, if earned; the best one again lets the next stand earned dress it at once. */
export function wearStand(key: string, mat: StandMat) {
  const best = bestStand(key), m = wornNow();
  if (DEMO || !STAND_MATS.includes(mat) || STAND_MATS.indexOf(mat) > STAND_MATS.indexOf(best)) return;
  if (mat === best) delete m[key];
  else m[key] = mat;
  if (m === progress.worn) save();
}
