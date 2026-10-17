// Art loader. public/assets/manifest.json lists the pictures that exist;
// anything missing falls back to the code-drawn placeholder.

import { ENEMY_BASE, HEROES, HERO_FIG, MOBS, type MobKind } from './data';
import { makeStandee, type Standee } from './draw/standee';

export interface Sprite {
  img: HTMLImageElement;
  /** Which way the figure looks in the picture; used to turn it toward its target. */
  facing: 'left' | 'right';
  /** The picture as a sticker on a plastic plate in the colour of the figure's stand: what the game draws. */
  standee: Standee;
}

interface ManifestEntry { file: string; facing?: 'left' | 'right' }

export const sprites = new Map<string, Sprite>();
/** Room art by key: floor slabs, brickwork, torches, pillars, resources, disc tops (keys in the README). */
export const envArt = new Map<string, HTMLImageElement>();
/** Interface art by key: button plates (`btn_…`) and icons (`ico_…`), see the README. */
export const uiArt = new Map<string, HTMLImageElement>();
/** Hand-drawn faces with Latin and Cyrillic for words scratched and chalked on the walls (Google Fonts, linked in index.html). */
export const GRAFFITI_FONTS = ['700 20px "Amatic SC"', '700 20px "Caveat"', '400 20px "Neucha"'];

export async function loadSprites(onLoad: () => void): Promise<void> {
  const base = import.meta.env.BASE_URL;
  let figures: Record<string, ManifestEntry> = {}, env: Record<string, string> = {}, ui: Record<string, string> = {};
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      figures = m.figures ?? {};
      env = m.env ?? {};
      ui = m.ui ?? {};
    }
  } catch {
    return;
  }
  const load = (file: string, keep: (img: HTMLImageElement) => void) => new Promise<void>(done => {
    const img = new Image();
    img.onload = () => { keep(img); onLoad(); done(); };
    img.onerror = () => done();
    img.src = `${base}assets/${file}`;
  });
  await Promise.all([
    ...Object.entries(figures).map(([key, e]) => load(e.file, img => {
      const facing = e.facing ?? 'right', fig = MOBS[key as MobKind]?.fig ?? HERO_FIG;
      const tint = HEROES.find(h => h.key === key)?.col ?? ENEMY_BASE;
      sprites.set(key, { img, facing, standee: makeStandee(img, facing, fig / HERO_FIG, tint) });
    })),
    ...Object.entries(env).map(([key, file]) => load(file, img => envArt.set(key, img))),
    ...Object.entries(ui).map(([key, file]) => load(file, img => {
      uiArt.set(key, img);
      // the stylesheet paints a plate once its picture is in: as var(--btn_main) under the class art-btn_main
      const root = document.documentElement;
      root.style.setProperty('--' + key, `url("${img.src}")`);
      root.classList.add('art-' + key);
    })),
    // the wall graffiti fonts, Latin and Cyrillic letters both, before the room is drawn with them
    ...GRAFFITI_FONTS.map(f => document.fonts?.load(f, 'WTF ЖОПА').then(onLoad, () => {})),
  ]);
}
