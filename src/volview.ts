// «Громкость» on screen (src/volume.ts): a step's token, its disco ball with the number on a sticker, and the knob on the
// campaign screen and in the lobby that turns it, with the list of every step and its rule.

import { uiArt } from './assets';
import { VOL_MAX, VOL_RULES } from './volume';
import { t } from './i18n';

/** A step's token: its disco ball (step 0 the first one's, faded, with no number) and the number on a sticker. */
export function volToken(vol: number, cls = '') {
  const img = uiArt.get('vol_' + Math.max(1, Math.min(VOL_MAX, vol)));
  return `<span class="vol-token${vol ? '' : ' off'}${cls ? ' ' + cls : ''}">${img ? `<img src="${img.src}" alt="" draggable="false">` : ''}${vol ? `<b>${vol}</b>` : ''}</span>`;
}

/** How a run at step `vol` plays, in a line in the player's language: the step's own rule, or the game as it is. */
export const volLine = (vol: number) => t(vol > 0 ? VOL_RULES[vol - 1] : 'Обычная игра, без правил сверху');

/** The knob's list, opened over it; one open list at a time, and a tap anywhere else closes it. */
let openList: HTMLElement | null = null;
const closeList = () => {
  if (!openList) return;
  openList.hidden = true;
  openList.parentElement?.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  openList = null;
};
if (typeof document !== 'undefined') document.addEventListener('pointerdown', e => { if (openList && !openList.parentElement?.contains(e.target as Node)) closeList(); });

/**
 * The knob in `el`: the step's token, its number and its own rule, and for the one who turns it (`onVol`) «тише» and
 * «громче» on either side. A tap on the token or the words opens the list of all the steps: the ones in force, the ones
 * opened above (a tap picks one) and the ones still shut with what opens them. Hidden while there is nothing to show:
 * before the first won run, and for the players at a table whose host keeps the knob at 0. `mini` is the token alone, its
 * list opening downwards (the map's corner during a run); `head` says over the list where the step comes from.
 */
export function renderKnob(el: HTMLElement, o: { vol: number; top: number; onVol?: (n: number) => void; mini?: boolean; head?: string }) {
  const turn = !!o.onVol, vol = Math.max(0, Math.min(o.vol, VOL_MAX));
  el.hidden = turn ? o.top <= 0 : vol <= 0;
  closeList();
  if (el.hidden) { el.innerHTML = ''; return; }
  const arrow = (d: number, label: string, off: boolean) => `<button class="vk-arrow" data-d="${d}" aria-label="${label}"${off ? ' disabled' : ''}>${d < 0 ? '‹' : '›'}</button>`;
  const rows = Array.from({ length: VOL_MAX + 1 }, (_, n) => {
    // the players at a host's table see only which rules are in force
    const state = n === vol ? 'cur' : n < vol ? 'on' : !turn ? 'open' : n <= o.top ? 'open' : 'shut';
    const words = t(n === 0 ? 'Обычная игра' : VOL_RULES[n - 1]);
    const tag = turn && state !== 'shut' ? 'button' : 'div';
    const how = state === 'shut' ? `<small>${t('Откроется победой на громкости {0}', n - 1)}</small>` : '';
    return `<${tag} class="vk-row ${state}" data-n="${n}">${volToken(n, 'sm')}<span><b>${n}</b> ${words}${how}</span></${tag}>`;
  }).join('');
  const more = vol > 1 ? `<small class="vk-more">${t('+ ещё {0} {0|правило|правила|правил}', vol - 1)}</small>` : '';
  el.innerHTML = (turn ? arrow(-1, t('Тише'), vol <= 0) : '')
    + `<button class="vk-face" aria-expanded="false" aria-label="${t('Громкость {0}: все правила', vol)}">${volToken(vol)}</button>`
    + (turn ? arrow(1, t('Громче'), vol >= o.top) : '')
    + (o.mini ? '' : `<button class="vk-txt" aria-expanded="false"><b>${t('Громкость {0}', vol)}</b><small>${volLine(vol)}</small>${more}</button>`)
    + `<div class="vk-list" hidden><p class="vk-head">${o.head ?? t(turn ? 'Каждая ступень добавляет своё правило к прошлым. Новая открывается победой на самой высокой.' : 'Громкость выбрал хозяин комнаты. Её правила складываются:')}</p>${rows}</div>`;
  const list = el.querySelector<HTMLElement>('.vk-list')!;
  el.querySelectorAll<HTMLButtonElement>('.vk-face, .vk-txt').forEach(b => b.addEventListener('click', () => {
    if (openList === list) { closeList(); return; }
    closeList();
    list.hidden = false;
    openList = list;
    el.querySelectorAll('.vk-face, .vk-txt').forEach(x => x.setAttribute('aria-expanded', 'true'));
  }));
  if (!o.onVol) return;
  const pick = o.onVol;
  el.querySelectorAll<HTMLButtonElement>('.vk-arrow').forEach(b => b.addEventListener('click', () => pick(Math.max(0, Math.min(o.top, vol + Number(b.dataset.d))))));
  el.querySelectorAll<HTMLButtonElement>('button.vk-row').forEach(b => b.addEventListener('click', () => pick(Number(b.dataset.n))));
}
