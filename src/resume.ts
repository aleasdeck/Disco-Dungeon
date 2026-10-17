// Online play survives a crash or a reload: the browser remembers which room it was in, and the host
// also keeps the whole game, so it can open the same room again and the others rejoin their heroes.

import type { Player } from './net';
import type { Run, Votes } from './run';
import type { Snapshot } from './sync';

/** A room's result screen; `again` and `win` (the whole run beaten) lead back to the lobby, `map` to the map. */
export interface Ending { title: string; text: string; kind: 'again' | 'map' | 'win' }

/** Which online room this browser is in, and the secret it rejoins its seat with. */
export interface Seat { code: string; key: string; host: boolean; at: number }

/** Everything the host needs to reopen its room. */
export interface HostSave {
  code: string;
  players: Player[];
  started: boolean;
  run: Run;
  choosing: boolean;
  mapInfo: string;
  /** Saves from before the vote have none. */
  votes?: Votes;
  /** The room's result screen, if it was showing. */
  ending: Ending | null;
  screen: { title: string; text: string; win?: boolean; lose?: boolean };
  snap: Snapshot | null;
}

const SEAT = 'discodungeon.seat', SAVE = 'discodungeon.hostSave';
/** A seat older than this is a finished game, not a crash. */
const FRESH = 30 * 60 * 1000;

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

export const loadHost = () => read<HostSave>(SAVE);
export const saveHost = (s: HostSave) => write(SAVE, s);
