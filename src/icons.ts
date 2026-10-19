// HUD icons: the painted picture from public/assets/ui when it has loaded, else a small inked SVG in the same spirit.

import { uiArt } from './assets';

const INK = '#1a1210';

/** Inked shapes on a 24×24 grid: [path, fill] pairs drawn in order. */
const SHAPES: Record<string, [string, string][]> = {
  ore: [['M4 15l3-8 6-3 6 4 1 8-6 4-8-1z', '#5b4a3e'], ['M9 9l2 2-2 2-2-2zM14 12l2 1-1 2-2-1zM12 16l1 1-1 1-1-1z', '#ffd34d']],
  map: [['M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z', '#e6cf9c'], ['M9 3v16M15 5v16', 'none'], ['M16 9l3 3M19 9l-3 3', 'none']],
  log: [['M6 3h11a3 3 0 0 1 0 6h-1v10a3 3 0 0 1-3 3H5a3 3 0 0 1 0-6h1z', '#e6cf9c'], ['M9 8h5M9 11h5M9 14h4', 'none']],
  menu: [['M4 5h16v3H4zM3 11h17v3H3zM5 17h15v3H5z', '#d9c6a0']],
  chill: [['M12 2v20M3.5 7l17 10M3.5 17l17-10', 'none'], ['M12 2l-2 2M12 2l2 2M12 22l-2-2M12 22l2-2', 'none']],
  /** A banshee's scream: an eye struck out, no aiming line this turn. */
  daze: [['M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7s-7-2-10-7z', '#e8e0cc'], ['M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z', '#7a4fb0'], ['M4 21L20 3', 'none']],
  fire: [['M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 1 4 2 4 0-4-1-7 1-10z', '#ff8a3d'], ['M12 13c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 2-3 3-5z', '#ffd34d']],
  armor: [['M5 4l7-2 7 2v7c0 6-4 9-7 11-3-2-7-5-7-11z', '#8f98a8'], ['M12 2v20M5 9h14', 'none']],
  ghost: [['M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z', '#d9f2ff'], ['M9 10h.01M15 10h.01', 'none']],
  rage: [['M3 6l5 3 4-6 4 6 5-3-2 14H5z', '#d9434f'], ['M8 13l3 1M16 13l-3 1M9 17h6', 'none']],
  fuse: [['M10 9a6 6 0 1 0 1 0z', '#3a3330'], ['M13 8c1-3 3-4 5-4', 'none'], ['M18 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z', '#ffd34d']],
  shield: [['M12 2l8 3v6c0 6-4 9.5-8 11-4-1.5-8-5-8-11V5z', '#6fa8d6']],
  spark: [['M12 1l2.5 7.5L22 12l-7.5 2.5L12 23l-2.5-8.5L2 12l7.5-3.5z', '#c9a8ff']],
  heal: [['M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', '#6fcf7a']],
  summon: [['M6 20c0-5 2-8 6-8s6 3 6 8z', '#b9a6e6'], ['M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', '#e8e0cc']],
  heat: [['M12 3c3 5 7 8 7 12a7 7 0 0 1-14 0c0-4 4-7 7-12z', '#ff7a2e']],
  slam: [['M4 18h16', 'none'], ['M9 4h6v8H9z', '#a08470'], ['M6 12h12v3H6z', '#7d6553'], ['M3 21l2-2M21 21l-2-2M12 22v-3', 'none']],
  move: [['M7 2h6v9l6 3c2 1 2.5 2.5 2.5 4.5V20H3.5v-4l2-5z', '#9a6a44'], ['M3.5 20h18M7 6h6', 'none']],
  hit: [['M4 20l9-9M13 11l7-7v4l-5 5', '#c9ced8'], ['M3 17l4 4M2 21l2-2', 'none']],
  plug: [['M8 2v5M14 2v5M5 7h12v4a6 6 0 0 1-12 0z', '#c7cbe0'], ['M11 17v5', 'none'], ['M3 21L21 3', 'none']],
  check: [['M3 13l6 6L21 6l-3-3-9 10-3-3z', '#5fd068']],
  bow: [['M18 3Q4 4 3 18h3q1-11 12-12z', '#8a5a35'], ['M17 5L5 17', 'none'], ['M21 21L8 8', 'none'], ['M5 5l6 2-4 4z', '#c9ced8'], ['M19 17l3 0-1 3zM17 19l0 3 3-1z', '#c2364f']],
  gas: [['M5 18a4 4 0 0 1 0-8 5 5 0 0 1 9-3 4 4 0 0 1 5 4 3.5 3.5 0 0 1 0 7z', '#a9d45a'], ['M8 4c1 1 1 2 0 3M12 2c1 1 1 2 0 3M16 4c1 1 1 2 0 3', 'none']],
  slow: [['M4 19h13a4 4 0 0 0 0-8c-1-3-4-5-7-4a5 5 0 0 0-3 7H4z', '#c9a06a'], ['M10 11a2 2 0 1 1 3 2', 'none'], ['M18 11l1-5M20 11l2-4', 'none']],
  petard: [['M15 7c0-3 2-4 4-5', 'none'], ['M7 9l8-2v13l-8 2z', '#d63a35'], ['M7 13l8-2v3l-8 2z', '#f2c94c'], ['M20 1l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z', '#ffd34d']],
  disc: [['M3 10c0-3 4-5 9-5s9 2 9 5v4c0 3-4 5-9 5s-9-2-9-5z', 'currentColor'], ['M3 10c0 3 4 5 9 5s9-2 9-5', 'none']],
  /** A boss's trophy until its picture is painted: a little mirror ball on a gold tag. */
  relic: [['M12 1v3', 'none'], ['M12 4a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', '#c9ced8'], ['M3.5 12.5h17M12 4v17M5.5 8c4 1.6 9 1.6 13 0M5.5 17c4-1.6 9-1.6 13 0', 'none'],
    ['M8 6.5l2 0-1 2.5zM15 10l2.5.5-1 2zM9 14l2 .5-.5 2z', '#f3f6ff'], ['M19 1l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z', '#ffd34d']],
};

/** The icon `k` as markup: the painted picture once loaded, else the inked SVG. */
export function icon(k: string, cls = '') {
  const art = uiArt.get('ico_' + k);
  if (art) return `<img class="ico ${cls}" src="${art.src}" alt="" draggable="false">`;
  const parts = SHAPES[k] ?? SHAPES.spark;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${parts.map(([d, f]) => `<path d="${d}" fill="${f}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}</svg>`;
}

/** A boss's trophy by its key (src/artifacts.ts): its painted picture (`art_<key>` in public/assets/ui) once there is one, else the mirror-ball tag. */
export function artIcon(key: string, cls = '') {
  const img = uiArt.get('art_' + key);
  return img ? `<img class="art ${cls}" src="${img.src}" alt="" draggable="false">` : icon('relic', cls);
}

/** A painted picture by its key in public/assets/ui (a room, an upgrade, a menu button), or nothing while it has not loaded. */
export function art(key: string, cls = '') {
  const img = uiArt.get(key);
  return img ? `<img class="art ${cls}" src="${img.src}" alt="" draggable="false">` : '';
}

/**
 * Fill every `<i class="ico ico-…">` placeholder under `root` with its icon, and every `<i data-art="…">` with its picture
 * once loaded (the stylesheet hides an empty one).
 */
export function fillIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('i.ico[class*="ico-"]').forEach(el => {
    const k = [...el.classList].find(c => c.startsWith('ico-'))!.slice(4);
    const key = k + (uiArt.has('ico_' + k) ? '+img' : '');
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.innerHTML = icon(k);
  });
  root.querySelectorAll<HTMLElement>('i[data-art]').forEach(el => {
    const k = uiArt.has(el.dataset.art!) ? el.dataset.art! : '';
    if ((el.dataset.k ?? '') === k) return;
    el.dataset.k = k;
    el.innerHTML = art(k);
  });
}
