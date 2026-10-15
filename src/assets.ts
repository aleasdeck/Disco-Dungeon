// Figure art loader. public/assets/manifest.json lists the pictures that exist;
// anything missing falls back to the code-drawn placeholder figure.

export interface Sprite {
  img: HTMLImageElement;
  /** Which way the figure looks in the picture; used to turn it toward its target. */
  facing: 'left' | 'right';
}

interface ManifestEntry { file: string; facing?: 'left' | 'right' }

export const sprites = new Map<string, Sprite>();

export async function loadSprites(onLoad: () => void): Promise<void> {
  const base = import.meta.env.BASE_URL;
  let figures: Record<string, ManifestEntry> = {};
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (res.ok) figures = (await res.json()).figures ?? {};
  } catch {
    return;
  }
  await Promise.all(Object.entries(figures).map(([key, e]) => new Promise<void>(done => {
    const img = new Image();
    img.onload = () => { sprites.set(key, { img, facing: e.facing ?? 'right' }); onLoad(); done(); };
    img.onerror = () => done();
    img.src = `${base}assets/${e.file}`;
  })));
}
