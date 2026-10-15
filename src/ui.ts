// DOM HUD: top bar, phase pill, ally cards and the hero frame at the bottom.

import { AB_COST, HAND_MAX, HAND_START, ROOM_TYPES, UPS, UP_COST } from './data';
import { sprites } from './assets';
import type { Game, HeroState } from './game';
import { drawHeroFigure } from './draw/figures';
import { lg } from './draw/util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Draw a hero's bust into a square canvas: the artist's picture when loaded, else the placeholder. */
export function drawPortrait(cv: HTMLCanvasElement, h: HeroState) {
  const size = 96, r = 2;
  cv.width = size * r;
  cv.height = size * r;
  const c = cv.getContext('2d')!;
  c.setTransform(r, 0, 0, r, 0, 0);
  c.fillStyle = lg(c, 0, 0, 0, size, h.def.col, h.def.dk);
  c.fillRect(0, 0, size, size);
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(0, 70, size, 26);
  const sp = sprites.get(h.def.key);
  if (sp) {
    // the upper ~60% of the figure, scaled to fill the frame
    const iw = sp.img.naturalWidth, ih = sp.img.naturalHeight, sh = ih * 0.6, sw = Math.min(iw, sh);
    c.drawImage(sp.img, (iw - sw) / 2, 0, sw, sh, 4, 6, size - 8, size - 6);
  } else {
    drawHeroFigure(c, h.i, 48, 136, 3.1, false, 0);
  }
}

export class Hud {
  private lastPortrait = '';

  constructor(private g: Game) {
    $('abBtn').addEventListener('click', () => g.useAbility());
    $('upsToggle').addEventListener('click', () => {
      const open = $('frame').classList.toggle('ups-open');
      $('upsToggle').setAttribute('aria-expanded', String(open));
    });
    $('ups').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.k === 'n') g.buyDisc();
      else if (b?.dataset.k) g.upgrade(b.dataset.k as 'm' | 'pw' | 'e');
    });
    $('fightBtn').addEventListener('click', () => g.startFight());
  }

  buildAllies() {
    const box = $('allies');
    box.innerHTML = '';
    for (const h of this.g.party) {
      const b = document.createElement('button');
      b.className = 'ally';
      b.id = 'ally' + h.i;
      b.style.setProperty('--c', h.def.col);
      b.setAttribute('aria-label', 'Играть за ' + h.def.name);
      b.innerHTML = '<canvas></canvas><span class="a-hp"><i></i></span><span class="a-res"></span>';
      drawPortrait(b.querySelector('canvas')!, h);
      b.addEventListener('click', () => this.g.select(h.i));
      box.appendChild(b);
    }
    this.lastPortrait = '';
  }

  refresh() {
    const g = this.g, S = g.S, h = g.hero;
    $('locName').textContent = `Этаж ${S.spec.floor + 1} · ${ROOM_TYPES[S.spec.type].name}`;
    $('locSub').textContent = `${S.biome.name} · сложность ${S.spec.depth}`;
    $('hTurn').textContent = String(S.turn);
    $('hMobs').textContent = String(g.liveMobs().length);
    const nw = S.waves[0];
    $('hWave').textContent = nw ? (nw - S.turn <= 0 ? 'в конце хода' : `через ${nw - S.turn}`) : 'нет';

    const left = g.alive().filter(o => o.hand > 0).length;
    const phase = $('phase');
    phase.className = 'phase ' + S.phase;
    phase.textContent = {
      place: 'Расстановка: перетащи фигурки на руны',
      throw: left ? `Броски · ждём ${left}` : 'Диски катятся',
      resolve: 'Подсчёт',
      enemy: 'Ход мобов',
      over: g.alive().length ? 'Комната зачищена' : 'Отряд пал',
    }[S.phase];

    for (const o of g.party) {
      const t = $('ally' + o.i);
      if (!t) continue;
      t.hidden = o === h;
      t.classList.toggle('dead', o.hp <= 0);
      (t.querySelector('.a-hp i') as HTMLElement).style.width = (Math.max(0, o.hp) / o.max) * 100 + '%';
      t.querySelector('.a-res')!.textContent = o.hp <= 0 ? 'пал' : o.pad === null ? 'ждёт' : S.phase === 'place' ? 'готов' : o.hand ? `${o.hand} в руке` : 'бросил';
    }

    const pk = h.def.key + (sprites.has(h.def.key) ? '+img' : '');
    if (this.lastPortrait !== pk) { drawPortrait($<HTMLCanvasElement>('pf'), h); this.lastPortrait = pk; }
    $('fName').textContent = h.def.name;
    $('fName').style.color = h.def.col;
    $('fHp').textContent = `${Math.max(0, h.hp)}/${h.max}`;
    $('fHpBar').style.width = (Math.max(0, h.hp) / h.max) * 100 + '%';
    $('fShield').textContent = String(h.shield);
    $('fOre').textContent = String(h.ore);
    $('fSpk').textContent = String(h.sparks);
    $('fHand').innerHTML = Array.from({ length: h.discs }, (_, k) => `<i class="${k < h.hand ? 'on' : ''}" style="--c:${h.def.col}"></i>`).join('');
    $('fState').textContent = h.hp <= 0 ? 'Пал'
      : S.phase === 'place' ? 'Перетащи фигурку на руну, потом «В бой!»'
      : S.phase !== 'throw' ? (S.phase === 'over' ? 'Комната закрыта' : 'Ждём конца хода')
      : h.hand === 0 ? 'Бросил, ждём остальных'
      : h.thrown ? 'Бросай следующий диск'
      : 'Тяни фигурку назад и отпускай';
    $('abName').textContent = h.def.ab;
    $('abTxt').textContent = h.def.abTxt;
    $('abCost').innerHTML = Array.from({ length: AB_COST }, (_, k) => `<i class="${k < h.sparks ? 'on' : ''}"></i>`).join('');
    $<HTMLButtonElement>('abBtn').disabled = !g.canUseAbility();
    $('abBtn').title = `${h.def.ab}: ${h.def.abTxt} Стоит ${AB_COST} искры.`;
    $<HTMLButtonElement>('fightBtn').hidden = S.phase !== 'place';
    const dc = g.discCost(h), dOk = dc && h.ore >= dc && h.hp > 0 && S.phase !== 'over';
    const discRow = `<div class="up"><span>Диски</span><span class="lvl">${Array.from({ length: HAND_MAX - HAND_START }, (_, k) => `<i class="${k < h.discs - HAND_START ? 'on' : ''}"></i>`).join('')}</span><b>${h.discs}</b><button class="btn sm" data-k="n" ${dOk ? '' : 'disabled'}>${dc ? '+ ' + dc + ' руды' : 'макс'}</button></div>`;
    $('ups').innerHTML = discRow + UPS.map(u => {
      const lv = h.up[u.k], cost = UP_COST[lv], ok = cost && h.ore >= cost && h.hp > 0 && S.phase !== 'over';
      return `<div class="up"><span>${u.name}</span><span class="lvl">${[0, 1, 2].map(k => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</span><b>${u.fmt(g.stat(h, u.k))}</b><button class="btn sm" data-k="${u.k}" ${ok ? '' : 'disabled'}>${cost ? '+ ' + cost + ' руды' : 'макс'}</button></div>`;
    }).join('');
  }
}
