// The boss's title card over its entrance (thread «Появление босса»): black bars close in over the HUD while the boss
// comes in on the field, then the room dims and a red band slides in with the boss's name, its nickname and its picture,
// and its line under it on a scrap of paper. Anywhere tapped skips it all. The clock is intro.ts's; main.ts drives it.

import { MOBS, type MobKind } from './data';
import { BOSS_LINES, type Intro } from './intro';
import { sprites } from './assets';
import { t } from './i18n';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let skip = () => {};
let gone = 0;

/** The bars come in and the HUD steps out; `onSkip` is what a tap or a key does. */
export function openIntro(onSkip: () => void) {
  skip = onSkip;
  clearTimeout(gone);
  const el = $('bossIntro');
  el.className = 'boss-intro';
  el.querySelector('.bi-card')!.innerHTML = '';
  el.hidden = false;
  document.documentElement.classList.add('intro');
  // the bars slide in from where they wait off screen
  void el.offsetWidth;
  el.classList.add('cine');
}

/** The card: the boss's name, nickname, picture and line. */
export function showCard(it: Intro, floor: number) {
  const el = $('bossIntro'), name = t(MOBS[it.k as MobKind]?.name ?? ''), art = sprites.get(it.k)?.img.src;
  el.querySelector('.bi-card')!.innerHTML = `<div class="bi-tc"><div class="bi-band"></div><div class="bi-in">`
    + `<span class="bi-lbl">${t('Босс этажа {0}', floor + 1)}</span><b class="bi-name${name.length > 12 ? ' long' : ''}">${esc(name)}</b>`
    + `<span class="bi-epi">${esc(t(BOSS_LINES[it.k]?.epi ?? ''))}</span>${art ? `<img class="bi-art" src="${art}" alt="">` : ''}</div></div>`
    + `<p class="bi-q">${esc(t('«{0}»', it.line))}</p>`;
  el.classList.add('titled');
}

/** The card goes. */
export function cardOut() {
  $('bossIntro').classList.add('out');
}

/** All of it goes: the bars slide back out and the HUD comes back. */
export function closeIntro() {
  const el = $('bossIntro');
  if (el.hidden) return;
  el.classList.remove('cine', 'titled');
  el.classList.add('out');
  document.documentElement.classList.remove('intro');
  clearTimeout(gone);
  gone = window.setTimeout(() => { el.hidden = true; el.querySelector('.bi-card')!.innerHTML = ''; }, 400);
}

// a tap anywhere, or any key, while the bars are in skips the entrance; it reaches nothing under it
const live = () => document.documentElement.classList.contains('intro');
$('bossIntro').addEventListener('pointerdown', e => { if (!live()) return; e.preventDefault(); e.stopPropagation(); skip(); });
window.addEventListener('keydown', e => {
  if (!live() || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  skip();
}, { capture: true });
