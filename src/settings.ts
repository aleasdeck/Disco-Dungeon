// Player settings, kept in this browser.

export interface Settings {
  name: string;
  /** Canvas sharpness: 'auto' lowers it on slow devices, 'low' always draws at one pixel per CSS pixel. */
  quality: 'auto' | 'high' | 'low';
  /** Dashed lines from mobs to the heroes they will hit. */
  attackLines: boolean;
  /** The aim line while pulling a hero back. */
  aimLine: boolean;
}

const KEY = 'discodungeon.settings';
const defaults: Settings = { name: '', quality: 'auto', attackLines: true, aimLine: true };

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
