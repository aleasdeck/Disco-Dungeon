// Loader of the art, the music and the fonts, all of it before the main menu. public/assets/manifest.json lists the
// pictures and tracks that exist; a missing picture falls back to the code-drawn placeholder.

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
/** Interface art by key: plates (`btn_…`, `panel…`), icons (`ico_…`) and the stickers of rooms, upgrades and menus, see the README. */
export const uiArt = new Map<string, HTMLImageElement>();
/** The music by key (`menu`, `calm`, `fight0`…`fight2`): the file's bytes, decoded when first played, and the loop's length. */
export const music = new Map<string, { data: ArrayBuffer; loop: number }>();
/** Hand-drawn faces with Latin and Cyrillic for words scratched and chalked on the walls (Google Fonts, linked in index.html). */
export const GRAFFITI_FONTS = ['700 20px "Amatic SC"', '700 20px "Caveat"', '400 20px "Neucha"'];

/** Content hash and size of each file in public/assets, from the build (empty on the dev server). */
declare const __ASSETS__: Record<string, [rev: string, bytes: number]>;
const ASSETS = __ASSETS__;

/** Address of a file in public/assets: with its content hash, so the cache keeps it until the file changes. */
function assetUrl(file: string) {
  const rev = ASSETS[file]?.[0];
  return `${import.meta.env.BASE_URL}assets/${file}${rev ? '?v=' + rev : ''}`;
}
/** What a file weighs on the loading bar: its size, or about that of a small picture or a font when unknown. */
const weightOf = (file?: string) => (file && ASSETS[file]?.[1]) || 30000;

/** The interface's own faces: Oswald on labels and numbers, Caveat (as Hand) in the notes, Rubik in the inputs and for signs Hand lacks. */
const UI_FONTS = ['500 16px Oswald', '600 16px Oswald', '700 16px Oswald', '700 16px Hand', '400 16px Rubik', '500 16px Rubik'];
/** A font that hasn't come by then is left to come later, so a dead font server doesn't hold the game. */
const FONT_WAIT = 12000;

/**
 * Load every picture, track and font the game uses, the pictures decoded and ready to draw. `onProgress` gets the part
 * loaded so far, 0 to 1, by size; whatever fails to load is counted in too and left to the code-drawn fallback.
 */
export async function loadAll(onProgress: (part: number) => void): Promise<void> {
  let figures: Record<string, ManifestEntry> = {}, env: Record<string, string> = {}, ui: Record<string, string> = {};
  let tracks: Record<string, { file: string; loop: number }> = {};
  try {
    const res = await fetch(assetUrl('manifest.json'), { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      figures = m.figures ?? {};
      env = m.env ?? {};
      ui = m.ui ?? {};
      tracks = m.music ?? {};
    }
  } catch {
    // no manifest, no pictures: the fonts still load
  }
  const fonts = document.fonts ? [...UI_FONTS, ...GRAFFITI_FONTS] : [];
  const files = [...Object.values(figures).map(e => e.file), ...Object.values(env), ...Object.values(ui), ...Object.values(tracks).map(t => t.file)];
  const total = files.reduce((t, f) => t + weightOf(f), 0) + fonts.length * weightOf();
  let done = 0;
  const tick = (file?: string) => onProgress((done += weightOf(file)) / total);
  onProgress(0);
  const load = (file: string, keep: (img: HTMLImageElement) => void) => new Promise<void>(ok => {
    const img = new Image();
    img.onload = () => img.decode().catch(() => {}).then(() => { keep(img); tick(file); ok(); });
    img.onerror = () => { tick(file); ok(); };
    img.src = assetUrl(file);
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
      // the stylesheet paints a plate once its picture is in: as var(--ui-btn_main) under the class art-btn_main
      const root = document.documentElement;
      root.style.setProperty('--ui-' + key, `url("${img.src}")`);
      root.classList.add('art-' + key);
    })),
    // the music comes whole before the game starts, so a track never waits on the network mid-fight
    ...Object.entries(tracks).map(([key, t]) => fetch(assetUrl(t.file))
      .then(res => (res.ok ? res.arrayBuffer() : null))
      .then(data => { if (data) music.set(key, { data, loop: t.loop }); })
      .catch(() => {})
      .then(() => tick(t.file))),
    // Latin and Cyrillic letters both, the graffiti on the walls among them
    ...fonts.map(f => Promise.race([document.fonts.load(f, 'WTF ЖОПА 0'), new Promise(r => setTimeout(r, FONT_WAIT))]).catch(() => {}).then(() => tick())),
  ]);
}
