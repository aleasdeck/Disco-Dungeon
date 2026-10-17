// DOM HUD: top bar, phase pill, ally cards, the enemy list and the hero frame at the bottom.

import { AB_COST, ENEMY_BASE, HAND_MAX, HAND_START, MOBS, ROOM_TYPES, UPS, UP_COST, type MobKind } from './data';
import { sprites } from './assets';
import type { Game, HeroState } from './game';
import { BASE_TH, drawHeroFigure, drawMiniature, drawMobFigure } from './draw/figures';
import { lg } from './draw/util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** "2 хода", "5 ходов". */
const turns = (n: number) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'ход' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'хода' : 'ходов');

/** Small picture of a mob's miniature for the enemy list, drawn once per kind (and again once its art loads). */
const mobIcons = new Map<string, string>();
export function mobIcon(k: MobKind) {
  const key = k + (sprites.has(k) ? '+img' : '');
  let url = mobIcons.get(key);
  if (!url) {
    const cv = document.createElement('canvas'), n = 64, c = cv.getContext('2d')!, d = MOBS[k];
    cv.width = cv.height = n;
    const s = (n - 6) / (d.fig + BASE_TH + d.r * 0.64 + 4);
    c.setTransform(s, 0, 0, s, n / 2, n - 3 - (d.r * 0.64 + 2) * s);
    drawMiniature(c, {
      key: k, x: 0, y: 0, baseR: d.r, baseCol: ENEMY_BASE, fig: d.fig, faceRight: true, flash: false, hop: 0, alpha: 1,
      placeholder: (cc, x, y, fl) => drawMobFigure(cc, k, x, y, fl),
    });
    url = cv.toDataURL();
    mobIcons.set(key, url);
  }
  return url;
}

/** Draw a hero's bust into a square canvas: the artist's picture when loaded, else the placeholder. */
export function drawPortrait(cv: HTMLCanvasElement, h: Pick<HeroState, 'i' | 'def'>) {
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
      b.innerHTML = '<canvas></canvas><span class="a-hp"><i></i><em></em></span><span class="a-res"></span>';
      drawPortrait(b.querySelector('canvas')!, h);
      b.addEventListener('click', () => this.g.select(h.i));
      b.disabled = !this.g.canControl(h);
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
    // enemies grow angrier every turn once a fight drags on; warn a turn ahead
    const rage = $('hRage'), fighting = S.phase !== 'place' && S.phase !== 'over', soon = g.rageFrom() - S.turn;
    rage.hidden = !fighting || (g.rage() === 0 && soon > 1);
    rage.classList.toggle('soon', g.rage() === 0);
    rage.textContent = g.rage() ? `Ярость +${g.rage()}` : 'Ярость со след. хода';
    rage.title = `С ${g.rageFrom()}-го хода каждый враг с каждым ходом бьёт на 1 сильнее.`;

    const left = g.alive().filter(o => o.hand > 0).length;
    const phase = $('phase');
    phase.className = 'phase ' + S.phase;
    phase.textContent = {
      place: g.online ? 'Расстановка: поставь своего героя на руну и нажми «Готов»' : 'Расстановка: поставь героев на руны и нажми «В бой!»',
      throw: left ? `Броски · ждём ${left}` : 'Диски катятся',
      resolve: 'Подсчёт',
      enemy: S.mobs[S.actor]?.hp > 0 ? `Ход мобов · ${S.mobs[S.actor].name}` : 'Ход мобов',
      over: g.alive().length ? 'Комната зачищена' : 'Отряд пал',
    }[S.phase];

    for (const o of g.party) {
      const t = $('ally' + o.i);
      if (!t) continue;
      t.hidden = o === h;
      t.classList.toggle('dead', o.hp <= 0);
      const hpPct = (Math.max(0, o.hp) / o.max) * 100, inc = g.incoming(o), risk = (Math.min(inc, Math.max(0, o.hp)) / o.max) * 100;
      (t.querySelector('.a-hp i') as HTMLElement).style.width = hpPct + '%';
      const em = t.querySelector('.a-hp em') as HTMLElement;
      em.style.left = hpPct - risk + '%';
      em.style.width = risk + '%';
      t.classList.toggle('lethal', o.hp > 0 && inc >= o.hp);
      t.querySelector('.a-res')!.textContent = o.hp <= 0 ? 'пал' : o.pad === null ? 'ждёт' : S.phase === 'place' ? (!g.online || S.ready.includes(o.i) ? 'готов' : 'ставит') : o.hand ? `${o.hand} в руке` : 'бросил';
    }

    // enemies in the room and what each will do this turn: a dot in the colour of the hero it goes for.
    // In the enemy turn they go one at a time from the top: the one moving now is lit, the ones done are dimmed.
    $('mobs').hidden = S.phase === 'over' || !g.liveMobs().length;
    const now = S.phase === 'enemy' ? S.mobs[S.actor] : undefined;
    $('mobList').innerHTML = g.liveMobs().map(m => {
      const it = m.intent, tgt = it && it.hero >= 0 ? g.heroOf(it.hero) : null;
      const act = !it ? '' : it.t === 'hit'
        ? `<span class="m-hit" title="Ударит ${tgt!.def.name} на ${it.dmg}">${it.dmg}</span><i class="m-dot" style="--c:${tgt!.def.col}" title="${tgt!.def.name}"></i>`
        : it.t === 'move'
          ? `<span class="m-go" title="Идёт к ${tgt!.def.name}${it.eta ? ', ударит через ' + turns(it.eta) : ''}">→${it.eta ? ' ' + it.eta : ''}</span><i class="m-dot" style="--c:${tgt!.def.col}" title="${tgt!.def.name}"></i>`
          : `<span class="m-sp">${{ charge: 'фитиль', slam: (it.chill ? 'метель ' : 'всем ') + it.dmg, heal: 'лечит ' + it.dmg, summon: 'призыв', heat: 'жар' }[it.t]}</span>`;
      return `<li${m === now ? ' class="now" aria-current="true"' : g.acted(m) ? ' class="done"' : ''}><img src="${mobIcon(m.k)}" alt=""><span class="m-name">${m.name}</span>`
        + `<span class="m-hp" title="${m.hp}/${m.max} HP${m.burn > 0 ? `, горит: в начале хода потеряет ${Math.min(m.burn, m.hp)}` : ''}"><i style="width:${(Math.max(0, m.hp) / m.max) * 100}%"></i>`
        // what its fire will burn off at its next move, at the end of the bar
        + (m.burn > 0 ? `<em style="left:${(Math.max(0, m.hp - m.burn) / m.max) * 100}%;width:${(Math.min(m.burn, Math.max(0, m.hp)) / m.max) * 100}%"></em>` : '')
        + `<b>${m.hp}</b></span>`
        + `<span class="m-act">${act}</span></li>`;
    }).join('');

    const pk = h.def.key + (sprites.has(h.def.key) ? '+img' : '');
    if (this.lastPortrait !== pk) { drawPortrait($<HTMLCanvasElement>('pf'), h); this.lastPortrait = pk; }
    $('fName').textContent = h.def.name;
    $('fName').style.color = h.def.col;
    // what the coming enemy turn will take is marked on the bar; a blow that would kill makes the bar pulse
    const inc = g.incoming(h), dead = h.hp > 0 && inc >= h.hp, hpPct = (Math.max(0, h.hp) / h.max) * 100, risk = (Math.min(inc, Math.max(0, h.hp)) / h.max) * 100;
    $('fHp').textContent = `${Math.max(0, h.hp)}/${h.max}` + (inc ? (dead ? `  · −${inc} смертельно` : `  · −${inc}`) : '');
    $('fHpBar').style.width = hpPct + '%';
    $('fRisk').style.left = hpPct - risk + '%';
    $('fRisk').style.width = risk + '%';
    $('fHpWrap').classList.toggle('lethal', dead);
    $('fHpWrap').title = inc ? `Враги в этот ход снимут ${inc} HP, если их не остановить.` : '';
    $('fShield').textContent = String(h.shield);
    $('fOre').textContent = String(g.bank.ore);
    $('fSpk').textContent = String(g.bank.sparks);
    $('fHand').innerHTML = Array.from({ length: h.discs }, (_, k) => `<i class="${k < h.hand ? 'on' : ''}" style="--c:${h.def.col}"></i>`).join('');
    $('fState').textContent = h.hp <= 0 ? 'Пал'
      : S.phase === 'place' ? (h.pad === null ? 'Тапни свободную руну, чтобы поставить героя' : g.online ? 'Можно переставить, потом «Готов»' : g.placed() ? 'Можно переставить, потом «В бой!»' : 'Поставь остальных героев')
      : S.phase !== 'throw' ? (S.phase === 'over' ? 'Комната закрыта' : 'Ждём конца хода')
      : h.hand === 0 ? 'Бросил, ждём остальных'
      : h.thrown ? 'Бросай следующий диск'
      : 'Тяни фигурку назад и отпускай';
    $('abName').textContent = h.def.ab;
    // once on, the ability lives in this turn's discs: the button says so until the turn ends
    $('abTxt').textContent = h.boost ? (h.hand ? 'Включено до конца хода: бросай' : 'Включено до конца хода') : h.def.abTxt;
    $('abCost').innerHTML = Array.from({ length: AB_COST }, (_, k) => `<i class="${k < g.bank.sparks ? 'on' : ''}"></i>`).join('');
    const ab = $<HTMLButtonElement>('abBtn');
    ab.disabled = !g.canUseAbility();
    ab.classList.toggle('on', h.boost);
    ab.style.setProperty('--ab', h.def.abCol);
    ab.title = `${h.def.ab}: ${h.def.abTxt} ${h.def.abMore} Стоит ${AB_COST} искры из общего запаса, включается до броска.`;
    const fb = $<HTMLButtonElement>('fightBtn'), isReady = S.ready.includes(h.i);
    fb.hidden = S.phase !== 'place' || h.hp <= 0;
    fb.disabled = (g.online && isReady) || !(g.online ? g.placed(h) : g.placed());
    fb.textContent = !g.online ? 'В бой!' : isReady ? `Ждём остальных · ${S.ready.length}/${g.alive().length}` : 'Готов';
    // each upgrade says what it does: a line under the name in the phone pop-up, a tooltip on the desktop
    const canBuy = (c: number) => !!c && g.bank.ore >= c && h.hp > 0 && S.phase !== 'over';
    const row = (k: string, name: string, txt: string, pips: number, lv: number, val: string, cost: number, tip: string) =>
      `<div class="up" title="${tip}"><span class="up-name">${name}<small>${txt}</small></span>`
      + `<span class="lvl">${Array.from({ length: pips }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`
      + `<b>${val}</b><button class="btn sm" data-k="${k}" ${canBuy(cost) ? '' : 'disabled'}>${cost ? '+ ' + cost + ' руды' : 'макс'}</button></div>`;
    const dc = g.discCost(h), discTxt = 'Больше бросков за ход. Самое сильное улучшение';
    $('ups').innerHTML = row('n', 'Диски за ход', discTxt, HAND_MAX - HAND_START, h.discs - HAND_START, String(h.discs), dc,
      `${discTxt}. ` + (dc ? `Следующий диск за ${dc} руды.` : 'Больше дисков не бывает.'))
      + UPS.map(u => {
        const lv = h.up[u.k], cost = g.upCost(h, u.k), v = g.stat(h, u.k);
        return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v), cost,
          `${u.txt}. ${u.now?.(v) ?? ''}` + (cost ? `Следующий уровень за ${cost} руды.` : 'Больше не прокачать.'));
      }).join('');
  }
}
