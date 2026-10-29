// The mouse pointer the game draws itself (thread «Нарисовать игровые курсоры»): paper stickers in place of the system's
// arrow, the arrow and the hand Vladislav picked (look «Бумага», А2) and the rest drawn to match. The browser won't show
// a big picture cursor of its own near the window's right and bottom edges (Chromium drops a custom cursor that sticks
// out of the page), so the game hides the system pointer and moves a picture after the mouse instead.
// Every rule of style.css names the pointer it wants in --cur, a cursor keyword; the picture is the one for the keyword
// under the mouse. A touch or a pen gives the system its pointer back.

import { uiArt } from './assets';

/** Per cursor keyword: the picture (`cur_<key>` in public/assets/ui, art/ui/cut_cursors.py) and the point that clicks, in its own pixels. */
const KINDS: Record<string, [key: string, x: number, y: number]> = {
  default: ['cur_arrow', 13.3, 6],
  pointer: ['cur_hand', 22.1, 2.8],
  grab: ['cur_palm', 73.4, 83.2],
  grabbing: ['cur_fist', 55.4, 73.7],
  crosshair: ['cur_aim', 77.5, 54.4],
  'zoom-in': ['cur_zin', 65.7, 65.7],
  'zoom-out': ['cur_zout', 65.7, 65.7],
  help: ['cur_help', 13.3, 6],
  text: ['cur_text', 32.2, 61.4],
};
/** The pictures are drawn for this long side of the arrow; the game shows them at size() for that. */
const ART = 192;
/** How big the arrow is: a part of the window's height (48 px on a 1080 px screen), never smaller than the system's. */
const size = () => Math.max(32, Math.round(innerHeight * 0.044));

export function initCursor() {
  const pics = new Map<string, HTMLImageElement>();
  for (const [kw, [key]] of Object.entries(KINDS)) {
    const art = uiArt.get(key);
    if (!art) continue;
    const img = new Image();
    img.src = art.src;
    img.alt = '';
    img.hidden = true;
    pics.set(kw, img);
  }
  if (!pics.has('default')) return;
  const box = document.createElement('div');
  box.className = 'cursor-pic';
  box.append(...pics.values());
  document.body.append(box);

  let shown: HTMLImageElement | null = null, kw = '', x = 0, y = 0, at: Element | null = null, queued = false, out = true;
  const fit = () => {
    const k = size() / ART;
    for (const img of pics.values()) img.style.width = img.naturalWidth * k + 'px';
  };
  const paint = () => {
    queued = false;
    const want = out ? '' : at ? getComputedStyle(at).getPropertyValue('--cur').trim() : 'default';
    const next = pics.has(want) ? want : out ? '' : 'default';
    if (next !== kw) {
      kw = next;
      if (shown) shown.hidden = true;
      shown = pics.get(kw) ?? null;
      if (shown) shown.hidden = false;
    }
    if (!shown) return;
    const k = size() / ART, [, hx, hy] = KINDS[kw];
    box.style.transform = `translate(${x - hx * k}px, ${y - hy * k}px)`;
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  const track = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      // a finger or a pen: the system's pointer (or none) as before
      document.documentElement.classList.remove('own-cursor');
      out = true;
      later();
      return;
    }
    document.documentElement.classList.add('own-cursor');
    x = e.clientX;
    y = e.clientY;
    at = e.target as Element;
    out = false;
    later();
  };
  addEventListener('pointermove', track, { capture: true, passive: true });
  addEventListener('pointerdown', track, { capture: true, passive: true });
  // a press can change the pointer (pulling a disc, dragging the room): look again once the game has had it
  addEventListener('pointerdown', later, { passive: true });
  addEventListener('pointerup', later, { passive: true });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) { out = true; later(); } });
  addEventListener('resize', () => { fit(); later(); });
  for (const img of pics.values()) if (!img.complete) img.addEventListener('load', fit, { once: true });
  fit();
}
