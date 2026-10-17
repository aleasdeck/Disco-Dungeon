// Player settings, kept in this browser.

export interface Settings {
  name: string;
  /** Canvas sharpness: 'auto' lowers it on slow devices, 'low' always draws at one pixel per CSS pixel. */
  quality: 'auto' | 'high' | 'low';
  /** The aim line while pulling a hero back. */
  aimLine: boolean;
  /** The hero last picked for the campaign, an index into HEROES. */
  hero: number;
  /** Music and sound effect volumes, 0 to 1. */
  music: number;
  sfx: number;
}

const KEY = 'discodungeon.settings';
const defaults: Settings = { name: '', quality: 'auto', aimLine: true, hero: 0, music: 0.7, sfx: 0.85 };

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: settings last for this visit */ }
}
