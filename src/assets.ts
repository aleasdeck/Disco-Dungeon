// Art loader. public/assets/manifest.json lists the pictures that exist;
// anything missing falls back to the code-drawn placeholder.

import { HERO_FIG, MOBS, type MobKind } from './data';
import { BOARD_STYLES, makeBoard, type Board } from './draw/cardboard';

export interface Sprite {
  img: HTMLImageElement;
  /** Which way the figure looks in the picture; used to turn it toward its target. */
  facing: 'left' | 'right';
  /** The picture printed on cardboard, when the board look is on. */
  board?: Board;
}

const boardStyle = BOARD_STYLES[new URLSearchParams(location.search).get('board') ?? ''];

interface ManifestEntry { file: string; facing?: 'left' | 'right' }

export const sprites = new Map<string, Sprite>();
/** Room art by key: floor slabs, brickwork, torches, pillars, resources, disc tops (keys in the README). */
export const envArt = new Map<string, HTMLImageElement>();

export async function loadSprites(onLoad: () => void): Promise<void> {
  const base = import.meta.env.BASE_URL;
  let figures: Record<string, ManifestEntry> = {}, env: Record<string, string> = {};
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      figures = m.figures ?? {};
      env = m.env ?? {};
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
      sprites.set(key, { img, facing, board: boardStyle ? makeBoard(img, facing, boardStyle, fig / HERO_FIG) : undefined });
    })),
    ...Object.entries(env).map(([key, file]) => load(file, img => envArt.set(key, img))),
  ]);
}
