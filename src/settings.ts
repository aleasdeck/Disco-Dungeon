// Player settings, kept in this browser.

export interface Settings {
  name: string;
  /** Canvas sharpness: 'auto' lowers it on slow devices, 'low' always draws at one pixel per CSS pixel. */
  quality: 'auto' | 'high' | 'low';
  /** The hero last picked for the campaign, an index into HEROES: the first of `party`. */
  hero: number;
  /** How many heroes the campaign's party has, 1 to 3: one player plays them all. */
  size: number;
  /** The heroes picked for the campaign in the order they were picked, indexes into HEROES; up to `size` of them. */
  party: number[];
  /** Music and sound effect volumes, 0 to 1. */
  music: number;
  sfx: number;
  /** The «Громкость» step (src/volume.ts) the knob was last turned to for the campaign or a room this player hosts. */
  vol: number;
}

const KEY = 'discodungeon.settings';
const defaults: Settings = { name: '', quality: 'auto', hero: 0, size: 1, party: [], music: 0.7, sfx: 0.85, vol: 0 };

function load(): Settings {
  let s: Settings;
  try {
    s = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    s = { ...defaults };
  }
  // settings from before the party size hold only the one hero
  if (!Array.isArray(s.party) || !s.party.length) s.party = [s.hero];
  return s;
}

export const settings: Settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: settings last for this visit */ }
}
