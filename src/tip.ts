// The hint a mouse resting on a thing brings up (thread «Красивые тултипы»): one paper slip in the game's look for every
// hint, instead of the browser's grey title. A thing says what its hint holds in data-tip-h (a heading), data-tip (the
// words, a line break starts a new line) and data-tip-f (a small line under them); tipAttrs() and setTip() write them.
// Only a mouse brings a hint: a tap on a phone presses the thing, as it always did.

import { ui } from './scale';

export interface Tip {
  /** The heading: the thing's name. */
  h?: string;
  /** What it does, in a line or two; '\n' starts another. */
  p?: string;
  /** A small line under the words: a price, a state. */
  f?: string;
  /** A picture by the heading (our own markup, never a player's words). */
  ico?: string;
}

/** Each part of a hint, its dataset key and its attribute. */
const KEYS = [['h', 'tipH', 'data-tip-h'], ['p', 'tip', 'data-tip'], ['f', 'tipF', 'data-tip-f']] as const;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A hint as attributes for markup built in a string: ` data-tip-h="…" data-tip="…"`. */
export const tipAttrs = (o: Tip) => KEYS.map(([k, , a]) => (o[k] ? ` ${a}="${esc(o[k]!)}"` : '')).join('');

/** Give an element its hint, or take it away with an empty one; the open slip follows at once. */
export function setTip(el: HTMLElement | SVGElement, o: Tip) {
  for (const [k, d] of KEYS) {
    if (o[k]) { if (el.dataset[d] !== o[k]) el.dataset[d] = o[k]; } else if (d in el.dataset) delete el.dataset[d];
  }
}

const tipOf = (el: Element): Tip => {
  const d = (el as HTMLElement).dataset;
  return { h: d.tipH, p: d.tip, f: d.tipF };
};

/** Fill a slip with a hint: the paper with the heading, the lines and the small line, and the tail under it. */
export function fillTip(box: HTMLElement, o: Tip) {
  const paper = document.createElement('div');
  paper.className = 'tip-paper';
  if (o.h) {
    const h = document.createElement('b');
    h.className = 'tip-h';
    if (o.ico) h.innerHTML = o.ico;
    h.append(o.h);
    paper.append(h);
  }
  for (const line of (o.p ?? '').split('\n').filter(Boolean)) {
    const p = document.createElement('p');
    p.textContent = line;
    paper.append(p);
  }
  if (o.f) {
    const f = document.createElement('small');
    f.className = 'tip-f';
    f.textContent = o.f;
    paper.append(f);
  }
  const tail = document.createElement('i');
  tail.className = 'tip-tail';
  box.replaceChildren(paper, tail);
  box.classList.toggle('only-h', !!o.h && !o.p && !o.f);
}

/**
 * Put a slip by the thing it speaks of: over it, or under it where the top of the screen is too near, or beside it
 * (`side`), always on the screen, its tail at the thing's middle.
 */
export function placeTip(box: HTMLElement, at: Element, side = false) {
  // all in the zoomed interface's pixels, as the slip's own size and place are (src/scale.ts)
  const s = at.getBoundingClientRect(), r = { left: ui(s.left), top: ui(s.top), right: ui(s.right), bottom: ui(s.bottom), width: ui(s.width), height: ui(s.height) };
  const w = box.offsetWidth, h = box.offsetHeight, gap = 11, m = 8;
  const W = ui(window.innerWidth), H = ui(window.innerHeight), clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  let x: number, y: number, dir: 'up' | 'down' | 'left';
  if (side && r.right + gap + w <= W - m) {
    dir = 'left';
    x = r.right + gap;
    y = clamp(r.top + r.height / 2 - h / 2, m, H - h - m);
    box.style.setProperty('--ay', clamp(r.top + r.height / 2 - y, 14, h - 14) + 'px');
  } else {
    dir = r.top - gap - h >= m || r.top > H - r.bottom ? 'down' : 'up';
    x = clamp(r.left + r.width / 2 - w / 2, m, W - w - m);
    y = dir === 'down' ? Math.max(m, r.top - gap - h) : Math.min(H - h - m, r.bottom + gap);
    box.style.setProperty('--ax', clamp(r.left + r.width / 2 - x, 16, w - 16) + 'px');
  }
  box.style.left = Math.round(x) + 'px';
  box.style.top = Math.round(y) + 'px';
  // the tail points the way to the thing: down from a slip over it, up from one under it, left from one beside it
  box.dataset.dir = dir;
}

// ------------------------------------------------------------ the slip a mouse brings up

/** How long a mouse rests on a thing before its slip comes; moving on from one slip to the next is at once. */
const WAIT = 260, QUICK = 400;

let box: HTMLElement | null = null;
let on: Element | null = null;
let timer = 0;
/** When the last slip went, so a mouse running along a row of buttons gets the next slip at once. */
let goneAt = -1e9;
/** A press on the thing put its slip away; it stays away until the mouse leaves it. */
let pressed = false;
/** Watches the thing under the mouse, so its slip follows when the game rewrites the hint (the health moves, a price changes). */
let watch: MutationObserver | null = null;

function show() {
  if (!on || !box) return;
  const o = tipOf(on);
  if (!on.isConnected || !(o.h || o.p || o.f)) { hide(); return; }
  fillTip(box, o);
  const fresh = box.hidden;
  box.hidden = false;
  placeTip(box, on);
  // it comes in once, a short drop onto the table; nothing on it moves after that
  if (fresh && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    box.animate([{ opacity: 0, translate: box.dataset.dir === 'up' ? '0 -5px' : '0 5px' }, { opacity: 1, translate: '0 0' }], { duration: 130, easing: 'ease-out' });
  }
}

function hide(keep = false) {
  clearTimeout(timer);
  if (box && !box.hidden) { box.hidden = true; goneAt = performance.now(); }
  if (!keep) { on = null; pressed = false; watch?.disconnect(); }
}

function aim(el: Element | null, now = false) {
  if (el === on) return;
  hide();
  if (!el) return;
  on = el;
  watch?.observe(el, { attributes: true, attributeFilter: KEYS.map(k => k[2]) });
  timer = window.setTimeout(show, now || performance.now() - goneAt < QUICK ? 0 : WAIT);
}

const hinted = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-tip],[data-tip-h],[data-tip-f]') : null);

/** Start the hints: one slip for the whole page, brought up by a resting mouse or the keyboard's focus. */
export function initTips() {
  watch = new MutationObserver(() => { if (on && box && !box.hidden) show(); });
  box = document.createElement('div');
  box.id = 'tip';
  box.className = 'tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const el = hinted(e.target);
    if (el === on && pressed) return;
    aim(el);
  });
  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'mouse' && on && !(e.relatedTarget instanceof Node && on.contains(e.relatedTarget))) hide();
  });
  // a press, a wheel or a key puts the slip away: the thing is being used now
  document.addEventListener('pointerdown', () => { if (on) { hide(true); pressed = true; } }, true);
  document.addEventListener('wheel', () => hide(true), { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(true); });
  document.addEventListener('focusin', e => { if (e.target instanceof Element && e.target.matches(':focus-visible')) aim(hinted(e.target), true); });
  document.addEventListener('focusout', () => { if (on && !on.matches(':hover')) hide(); });
  window.addEventListener('resize', () => hide());
}
