// Online play survives a crash or a reload: the browser remembers which room it was in, and the host
// also keeps the whole game, so it can open the same room again and the others rejoin their heroes.
// The campaign is kept the same way, so a run closed in the middle goes on from the main menu's «Продолжить».

import type { Player } from './net';
import type { CampState } from './camp';
import type { LootState } from './artifacts';
import type { EventState } from './events';
import type { Run, Votes } from './run';
import type { Snapshot } from './sync';
import type { Cur } from './stats';
import type { Album } from './album';
import { stored } from './demo';

/** A room's result screen; `again` and `win` (the whole run beaten) lead back to the lobby, `map` to the map. */
export interface Ending {
  title: string;
  text: string;
  kind: 'again' | 'map' | 'win';
  /** After an elite the screen leads to the sharpening window instead of the map. */
  next?: 'whet';
  /** The end of the run: its album, shown instead of the plain result screen (src/albumview.ts). */
  album?: Album;
}

/** Which online room this browser is in, and the secret it rejoins its seat with. */
export interface Seat { code: string; key: string; host: boolean; at: number }

/** Everything the host needs to reopen its room. */
export interface HostSave {
  code: string;
  players: Player[];
  started: boolean;
  run: Run;
  choosing: boolean;
  /** Saves from before the vote have none. */
  votes?: Votes;
  /** The event the party stands in, if any. */
  ev?: EventState | null;
  /** The camp the party sits at, if any. */
  camp?: CampState | null;
  /** The floor boss's trophies the party stands over, if any. */
  loot?: LootState | null;
  /** The room's result screen, if it was showing. */
  ending: Ending | null;
  screen: { title: string; text: string; win?: boolean; lose?: boolean };
  snap: Snapshot | null;
}

/** The campaign as this browser keeps it: the map, the windows between rooms, and the room as it stands, mid-fight too. */
export interface CampaignSave {
  /** A save of another make is dropped (CAMPAIGN). */
  v: number;
  run: Run;
  choosing: boolean;
  ev: EventState | null;
  camp: CampState | null;
  /** The hero whose pick by the fire the camp window asks for. */
  campFor: number;
  loot: LootState | null;
  /** The seeds of the event, the camp and the trophies whose windows the player has closed. */
  shut: { ev: number; camp: number; loot: number };
  /** The room's result screen, if it was showing. */
  ending: Ending | null;
  /** The player is done at the blacksmith's the party stands at: the map is up, not his window. */
  forgeLeft: boolean;
  /** The hero selected. */
  act: number;
  /** Ore mined in the room and paid for it «Без царапины», for its result screen. */
  mined: number;
  clean: number;
  /** How the bookie's bet came out in the room, for its result screen; saves from before have none. */
  bet?: string;
  snap: Snapshot;
  /** How far the statistics had counted the run, so it goes on counting there even after an online game was counted. */
  count: Cur | null;
}

// the demo keeps its own: a run of one floor can't go on in the full game, nor the other way round
const SEAT = stored('discodungeon.seat'), SAVE = stored('discodungeon.hostSave'), KEYS = stored('discodungeon.keys'), RUN = stored('discodungeon.campaign');
/** The campaign save's make: bumped when an old save could no longer be played on. */
export const CAMPAIGN = 1;
/** A seat older than this is a finished game, not a crash. */
const FRESH = 30 * 60 * 1000;
/** How long this browser keeps its key to a room it left, so typing that room's code again gives the same hero back. */
const KEEP = 12 * 60 * 60 * 1000;

export const newKey = () => Math.random().toString(36).slice(2, 12);

function read<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // private mode or full storage: the game still works, it just can't come back after a reload
  }
}

export function loadSeat(): Seat | null {
  const s = read<Seat>(SEAT);
  return s && Date.now() - s.at < FRESH ? s : null;
}

export const saveSeat = (s: Omit<Seat, 'at'>) => write(SEAT, { ...s, at: Date.now() });

export function clearSeat() {
  write(SEAT, null);
  write(SAVE, null);
}

/** The key this browser joined `code` with lately, even after it left the room or gave up on getting back. */
export function keyFor(code: string): string | null {
  const k = read<Record<string, { key: string; at: number }>>(KEYS)?.[code];
  return k && Date.now() - k.at < KEEP ? k.key : null;
}

export function keepKey(code: string, key: string) {
  const all = read<Record<string, { key: string; at: number }>>(KEYS) ?? {}, now = Date.now();
  for (const c in all) if (now - all[c].at >= KEEP) delete all[c];
  all[code] = { key, at: now };
  write(KEYS, all);
}

export const loadHost = () => read<HostSave>(SAVE);
export const saveHost = (s: HostSave) => write(SAVE, s);

let runJson = '';

/**
 * Keep the campaign in this browser. It is written only when something changed since the last time: the physics step
 * counts on while the room stands still, and alone it doesn't make a change.
 */
export function saveCampaign(s: CampaignSave) {
  const { tick: _tick, ...still } = s.snap, j = JSON.stringify({ ...s, snap: still });
  if (j === runJson) return;
  runJson = j;
  try {
    localStorage.setItem(RUN, JSON.stringify(s));
  } catch {
    // private mode or full storage: the run lasts for this visit
  }
}

export function loadCampaign(): CampaignSave | null {
  const s = read<CampaignSave>(RUN);
  return s?.v === CAMPAIGN && s.snap ? s : null;
}

/** The run is over (or a new one replaces it): nothing to go on with. */
export function clearCampaign() {
  runJson = '';
  write(RUN, null);
}
