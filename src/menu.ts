// Main menu and its screens: collection, settings and the online lobby.

import { BIOMES, HEROES, MOB_HP_MUL, KINDS, MOBS, fullHit, heroesByKind, kindOf, type MobKind } from './data';
import { drawPortrait, faceUrl, mobIcon } from './ui';
import { ARTIFACTS } from './artifacts';
import { artIcon } from './icons';
import { BOSS_UP, CASTS } from './room';
import { saveSettings, settings } from './settings';
import { favourite, stats } from './stats';
import { TRINKETS, opened, type TrinketDef } from './trinkets';
import { envArt } from './assets';
import { FLOORS, LAYERS } from './run';
import { sound } from './sound';
import type { Player } from './net';
import { uiArt } from './assets';
import { BACKDROP_COUNT, drawPhoto, savePhoto, type PhotoSeat } from './photo';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'statsScreen', 'settingsScreen', 'pause'] as const;
export type Screen = (typeof SCREENS)[number];

/** Show one menu screen (or none). */
export function show(screen: Screen | null) {
  for (const id of SCREENS) $(id).hidden = id !== screen;
}

const FLOOR_NAMES = BIOMES.map(b => b.name);

// ------------------------------------------------------------ collection

export function renderCollection(tab: 'heroes' | 'mobs' | 'arts' | 'trinkets') {
  document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const grid = $('colGrid');
  grid.innerHTML = '';
  if (tab === 'heroes') {
    // the same order as the pick screens: the biggest discs first
    heroesByKind().flat().forEach(i => {
      const def = HEROES[i], card = document.createElement('article');
      card.className = 'card';
      const cv = document.createElement('canvas');
      drawPortrait(cv, { i, def });
      // starting health, then the same words as the disc upgrades: damage of a full straight throw, speed next to Ash's, speed kept off a wall
      const stats = `<dt>HP</dt><dd>${def.hp}</dd><dt>Урон</dt><dd>${fullHit(def.m, def.pw)}</dd><dt>Скорость</dt><dd>${Math.round(def.pw * 100)}%</dd><dt>Отскок</dt><dd>${Math.round(def.e * 100)}%</dd>`;
      card.innerHTML = `<div></div><div><h3 style="color:${def.col}">${def.name}</h3><p>${kindOf(def)}. Способность «${def.ab}»: ${def.abTxt} ${def.abMore}</p>`
        + `<dl>${stats}<dt>Диск</dt><dd>${def.r * 2}</dd></dl></div>`;
      card.firstElementChild!.replaceWith(cv);
      grid.appendChild(card);
    });
  } else if (tab === 'trinkets') {
    renderTrinkets(grid);
  } else if (tab === 'arts') {
    // the floor bosses' trophies: what each does, and its joke
    for (const a of ARTIFACTS) {
      const card = document.createElement('article');
      card.className = 'card col-art';
      card.innerHTML = `<span class="col-art-ico">${artIcon(a.key)}</span><div><h3>${a.name}</h3><p><b>${a.txt}.</b> ${a.gag}</p></div>`;
      grid.appendChild(card);
    }
  } else {
    // the undertaker's coffin is a thing, not an enemy of its own
    // a boss's later phases are told on its own card
    (Object.keys(MOBS) as MobKind[]).filter(k => !MOBS[k].prop && !MOBS[k].of && !MOBS[k].dummy).forEach(k => {
      // a boss as a party of three meets it, its extra health and blow (BOSS_UP) included
      const d = MOBS[k], up = BOSS_UP[k], card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `<img src="${mobIcon(k)}" alt=""><div><h3>${d.name}</h3><p><b>${FLOOR_NAMES[d.floor]}${d.boss ? ', босс' : CASTS.some(c => c.elite === k) ? ', элита' : ''}.</b> ${d.txt}</p>`
        + `<dl><dt>HP</dt><dd>${Math.round(d.hp * MOB_HP_MUL * (up?.hp[2] ?? 1))}</dd><dt>Удар</dt><dd>${d.dmg + (up?.dmg[2] ?? 0)}</dd>${d.armor ? `<dt>Броня</dt><dd>${d.armor}</dd>` : ''}</dl></div>`;
      grid.appendChild(card);
    });
  }
}

/**
 * The trinkets found here and the heroes' lines about them: a line is open once its hero has picked the trinket up on this
 * device. A trinket nobody has picked up yet is a dark shape with only its floor told.
 */
function renderTrinkets(grid: HTMLElement) {
  const list = TRINKETS.filter(t => t.drawn), order = heroesByKind().flat();
  const all = list.length * order.length, open = list.reduce((n, t) => n + order.filter(i => opened(t.key, HEROES[i].key)).length, 0);
  const head = document.createElement('p');
  head.className = 'tr-head';
  head.innerHTML = `Открыто фраз: <b>${open}</b> из ${all}. Прокати диск по безделушке в комнате, и герой скажет о ней своё. Каждый герой — свою фразу.`;
  grid.append(head);
  const pic = (t: TrinketDef, found: boolean) => `<span class="tr-pic${found ? '' : ' dark'}">${envArt.get(t.art) ? `<img src="${envArt.get(t.art)!.src}" alt="">` : ''}</span>`;
  const card = (t: TrinketDef) => {
    const got = order.filter(i => opened(t.key, HEROES[i].key)), found = got.length > 0, el = document.createElement('article');
    el.className = 'card tr-card';
    const lines = order.map(i => {
      const def = HEROES[i], on = opened(t.key, def.key);
      return `<li class="${on ? 'on' : 'off'}" style="--c:${def.col}"><img src="${faceUrl({ i, def })}" alt="${def.name}">`
        + (on ? `<b>${def.name}</b><q>${t.lines[def.key]}</q>` : `<span>???</span>`) + '</li>';
    }).join('');
    el.innerHTML = pic(t, found) + `<div><h3>${found ? t.name : '???'} <small>${got.length} из ${order.length}</small></h3>`
      + `<p><b>${FLOOR_NAMES[t.floor]}.</b> ${found ? t.txt : 'Ещё не попадалась.'}</p></div>${found ? `<ul class="tr-lines">${lines}</ul>` : ''}`;
    return el;
  };
  // tiles: the picture, the name and how many lines are open; one tapped opens its card under them, the first found to begin with
  const box = document.createElement('div');
  box.className = 'tr-open';
  const tiles = document.createElement('div');
  tiles.className = 'tr-tiles';
  const pickT = (t: TrinketDef) => { box.replaceChildren(card(t)); tiles.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === t.key)); };
  for (const t of list) {
    const n = order.filter(i => opened(t.key, HEROES[i].key)).length, b = document.createElement('button');
    b.className = 'tr-tile';
    b.dataset.k = t.key;
    b.innerHTML = pic(t, n > 0) + `<b>${n ? t.name : '???'}</b><small>${n} из ${order.length}</small>`;
    b.addEventListener('click', () => pickT(t));
    tiles.append(b);
  }
  grid.append(tiles, box);
  pickT(list.find(t => order.some(i => opened(t.key, HEROES[i].key))) ?? list[0]);
}

// ------------------------------------------------------------ statistics

/** The Russian word for `n` things: 1 забег, 2 забега, 5 забегов. */
export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

/** Seconds as hours and minutes. */
function clock(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : m ? `${m} мин` : sec >= 1 ? `${Math.round(sec)} с` : '0 мин';
}

const num = (n: number) => Math.round(n).toLocaleString('ru-RU');
const heroByKey = (key: string) => HEROES.findIndex(h => h.key === key);

/** The player's own statistics: the runs and their time, the favourite hero, every hero's runs, the totals and the records. */
export function renderStats() {
  const s = stats, box = $('statsBody');
  if (!s.runs) {
    box.innerHTML = '<p class="st-empty">Пока ни одного забега. Сыграй кампанию или сетевую игру, и здесь появятся твои забеги, время, любимый герой и рекорды.</p>';
    return;
  }
  const tile = (big: string, label: string, sub: string) => `<div class="st-tile"><b>${big}</b><span>${label}</span><small>${sub}</small></div>`;
  let html = '<div class="st-tiles">'
    + tile(num(s.runs), plural(s.runs, 'забег', 'забега', 'забегов'), s.online ? `из них по сети ${num(s.online)}` : 'все в одиночку')
    + tile(clock(s.time), 'в забегах', `в среднем ${clock(s.time / s.runs)} на забег`)
    + tile(num(s.wins), plural(s.wins, 'победа', 'победы', 'побед'), s.losses ? `и ${num(s.losses)} ${plural(s.losses, 'поражение', 'поражения', 'поражений')}` : 'без поражений')
    + '</div>';

  const fav = favourite(), fi = fav ? heroByKey(fav) : -1;
  if (fi >= 0) {
    const def = HEROES[fi], h = s.heroes[fav!];
    html += `<div class="st-fav" style="--c:${def.col}"><canvas></canvas><div><small>${def.fem ? 'Любимая героиня' : 'Любимый герой'}</small>`
      + `<b style="color:${def.col}">${def.name}</b>`
      + `<span>${num(h.runs)} ${plural(h.runs, 'забег', 'забега', 'забегов')} из ${num(s.runs)}, ${num(h.wins)} ${plural(h.wins, 'победа', 'победы', 'побед')}, `
      + `${clock(h.time)} в забегах, ${num(h.kills)} ${plural(h.kills, 'враг повержен', 'врага повержено', 'врагов повержено')}</span></div></div>`;
  }

  // every hero played here, the favourite first: a bar for the runs, then the wins and the time
  const played = Object.entries(s.heroes).filter(([k, h]) => h.runs && heroByKey(k) >= 0).sort((a, b) => b[1].runs - a[1].runs || b[1].time - a[1].time);
  if (played.length > 1) {
    const most = played[0][1].runs;
    html += '<h3>По героям</h3><ul class="st-heroes">' + played.map(([k, h]) => {
      const i = heroByKey(k), def = HEROES[i];
      return `<li style="--c:${def.col}"><img src="${faceUrl({ i, def })}" alt=""><b>${def.name}</b>`
        + `<span class="st-bar"><i style="width:${(h.runs / most) * 100}%"></i></span>`
        + `<em>${num(h.runs)} ${plural(h.runs, 'забег', 'забега', 'забегов')}${h.wins ? `, ${num(h.wins)} ${plural(h.wins, 'победа', 'победы', 'побед')}` : ''}, ${clock(h.time)}</em></li>`;
    }).join('') + '</ul>';
  }

  const t = s.sum, row = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;
  const topBy = heroByKey(s.best.topBy);
  html += '<div class="st-cols"><section><h3>За всё время</h3><dl>'
    + row('Комнат пройдено', num(s.rooms))
    + row('Боссов повержено', num(s.bosses))
    + row('Врагов повержено', num(t.kills))
    + row('Урона нанесено', num(t.dmg))
    + row('Бросков', num(t.throws))
    + row('Точных бросков', t.throws ? `${num(t.crits)} (${Math.round((t.crits / t.throws) * 100)}%)` : '0')
    + row('Умений применено', num(t.abs))
    + row('Руды добыто', num(t.ore))
    + row('Трофеев взято', num(s.arts))
    + row('Урона получено', num(t.hurt))
    + row('Герой падал', `${num(t.falls)} ${plural(t.falls, 'раз', 'раза', 'раз')}`)
    + '</dl></section><section><h3>Рекорды</h3><dl>'
    + row('Сильнейший удар', t.top ? `${num(t.top)}${topBy >= 0 ? `, ${HEROES[topBy].name}` : ''}` : '—')
    + row('Врагов за забег', num(s.best.kills))
    + row('Дальше всего', s.wins ? 'всё подземелье' : `этаж ${Math.max(1, s.best.floor)}, ${num(s.best.rooms)} ${plural(s.best.rooms, 'комната', 'комнаты', 'комнат')} из ${FLOORS * LAYERS}`)
    + row('Быстрейшая победа', s.best.fast ? clock(s.best.fast) : 'ещё впереди')
    + row('Отскоков до удара', num(t.rico))
    + '</dl></section></div>';

  if (s.since) html += `<p class="st-since">Считается на этом устройстве с ${new Date(s.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`;
  box.innerHTML = html;
  const cv = box.querySelector<HTMLCanvasElement>('.st-fav canvas');
  if (cv && fi >= 0) drawPortrait(cv, { i: fi, def: HEROES[fi] });
}

// ------------------------------------------------------------ campaign party

/** The campaign's party size in words: who to pick, and how many are still missing. */
const SIZE_WORDS = ['', 'одного героя', 'двух героев', 'трёх героев'];

// ------------------------------------------------------------ the pick screens: the party photo, the heroes, the card

const icon = (key: string) => uiArt.get(key)?.src ?? '';
/** Mice can point at a hero to read it without taking it; fingers take it with a tap. */
const canPoint = () => matchMedia('(hover: hover)').matches;

/** The card beside the photo: whose the hero is, its name and kind, its numbers, its ability whole. */
function heroCard(box: HTMLElement, i: number) {
  const d = HEROES[i];
  box.style.setProperty('--c', d.col);
  // the name and the numbers on one line, so the ability fits whole without scrolling
  box.innerHTML = `<div class="pc-top"><h3>${d.name}<em>${kindOf(d)}</em></h3>`
    + `<ul class="pc-stats"><li title="Здоровье"><img src="${icon('ico_hp')}" alt="Здоровье">${d.hp}</li>`
    + `<li title="Урон"><img src="${icon('up_dmg')}" alt="Урон">${fullHit(d.m, d.pw)}</li>`
    + `<li title="Скорость"><img src="${icon('up_speed')}" alt="Скорость">${Math.round(d.pw * 100)}%</li>`
    + `<li title="Отскок"><img src="${icon('up_bounce')}" alt="Отскок">${Math.round(d.e * 100)}%</li></ul></div>`
    + `<div class="pc-ab"><div class="pc-abname"><span class="pc-gem" style="--ab:${d.abCol}"><img src="${icon('ab_' + d.key)}" alt=""></span><b>«${d.ab}»</b></div>`
    + `<p>${d.abTxt}</p><p class="pc-more">${d.abMore}</p></div>`;
  fitCard(box);
}

/**
 * The card never scrolls: when a long ability doesn't fit the card's place (a small phone), its words shrink step by
 * step until it does. Again after the screen turns or the window changes size.
 */
function fitCard(box: HTMLElement) {
  requestAnimationFrame(() => {
    let k = 1;
    box.style.setProperty('--fit', '1');
    while (box.clientHeight && box.scrollHeight > box.clientHeight + 1 && k > 0.66) {
      k -= 0.03;
      box.style.setProperty('--fit', k.toFixed(2));
    }
  });
}
window.addEventListener('resize', () => document.querySelectorAll<HTMLElement>('.pick-card').forEach(fitCard));

/** A small photo (a phone's) lifts over the screen at full size on a tap; the next tap anywhere, or Esc, puts it back. */
function zoomable(print: HTMLElement) {
  print.onclick = () => {
    if (print.classList.contains('zoomed') || print.clientWidth >= 360) return;
    print.classList.add('zoomed');
    const back = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      print.classList.remove('zoomed');
      window.removeEventListener('click', back, true);
      window.removeEventListener('keydown', back, true);
    };
    setTimeout(() => {
      window.addEventListener('click', back, true);
      window.addEventListener('keydown', back, true);
    });
  };
}

/**
 * All twelve heroes on one row, kind after kind with a gap between the kinds. `mark` says how a hero's face is marked:
 * picked by me, taken by someone else, looked at by someone, with a number or a player's letter on it.
 */
function heroRow(box: HTMLElement, o: {
  mark: (i: number) => { cls?: string; badge?: string; label?: string };
  onTap: (i: number) => void;
  onPeek: (i: number) => void;
  shown: number;
}) {
  // on a phone the row scrolls: it stays where it was, and the face being read is kept in sight
  const left = box.scrollLeft;
  box.innerHTML = '';
  heroesByKind().forEach((list, r) => {
    // each kind on its own piece of cardboard, its name over its faces
    const group = document.createElement('div'), faces = document.createElement('div');
    group.className = 'pick-kind';
    group.innerHTML = `<span class="pk-name">${KINDS[r].row}</span>`;
    faces.className = 'pk-faces';
    group.append(faces);
    for (const i of list) {
      const def = HEROES[i], m = o.mark(i), b = document.createElement('button');
      b.className = 'pick' + (m.cls ? ' ' + m.cls : '');
      b.style.setProperty('--c', def.col);
      b.dataset.i = String(i);
      b.setAttribute('aria-label', def.name + (m.label ? `, ${m.label}` : ''));
      b.setAttribute('aria-pressed', String(!!m.cls?.includes('mine')));
      b.innerHTML = `<img src="${faceUrl({ i, def })}" alt=""><span>${def.name}</span>${m.badge ? `<b class="pick-n">${m.badge}</b>` : ''}`;
      b.addEventListener('click', () => o.onTap(i));
      if (canPoint()) {
        b.addEventListener('mouseenter', () => o.onPeek(i));
        b.addEventListener('mouseleave', () => o.onPeek(-1));
      }
      faces.append(b);
    }
    box.append(group);
  });
  box.scrollLeft = left;
  // after layout: the screen may only now be coming up
  requestAnimationFrame(() => {
    const t = box.querySelector<HTMLElement>(`[data-i="${o.shown}"]`);
    if (!t || box.scrollWidth <= box.clientWidth) return;
    const x0 = t.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft, x1 = x0 + t.offsetWidth;
    if (x0 < box.scrollLeft) box.scrollLeft = x0 - 8;
    else if (x1 > box.scrollLeft + box.clientWidth) box.scrollLeft = x1 - box.clientWidth + 8;
  });
}

/** The face under the mouse on the campaign screen, and the backdrop of its photo (a new one each time it opens). */
let campPeek = -1;
let campBg = Math.floor(Math.random() * BACKDROP_COUNT);

/**
 * The campaign's screen: how many heroes go (1 to 3, one player plays them all), the party's photo, the twelve heroes on
 * one row and the card of the hero last tapped (`shown`) or under the mouse. The next free place in the photo shows the
 * hero under the mouse pale, as a try-on.
 */
export function renderHeroSelect(o: { size: number; party: number[]; shown: number; onPick: (hero: number) => void; onSize: (n: number) => void }) {
  $('heroSize').innerHTML = [1, 2, 3].map(n => `<button class="btn tab${n === o.size ? ' on' : ''}" data-n="${n}" aria-pressed="${n === o.size}">${n} ${plural(n, 'герой', 'героя', 'героев')}</button>`).join('');
  $('heroSize').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => o.onSize(Number(b.dataset.n))));
  campPeek = -1;
  const photo = $<HTMLCanvasElement>('heroPhoto');
  photo.parentElement!.classList.remove('zoomed');
  zoomable(photo.parentElement!);
  const paint = () => {
    const i = campPeek >= 0 ? campPeek : o.shown;
    heroCard($('heroInfo'), i);
    const tryOn = campPeek >= 0 && !o.party.includes(campPeek) ? campPeek : null;
    const seats: PhotoSeat[] = Array.from({ length: o.size }, (_, k) => ({ hero: o.party[k] ?? null, look: k === o.party.length ? tryOn : null }));
    drawPhoto(photo, seats, { bg: campBg, names: false });
    photo.setAttribute('aria-label', 'Фото отряда: ' + (o.party.map(h => HEROES[h].name).join(', ') || 'пока никого'));
  };
  heroRow($('heroPicks'), {
    mark: i => {
      const at = o.party.indexOf(i);
      return at < 0 ? {} : { cls: 'mine', badge: o.size > 1 ? String(at + 1) : '', label: 'в отряде' };
    },
    onTap: i => o.onPick(i),
    onPeek: i => { campPeek = i; paint(); },
    shown: o.shown,
  });
  $('heroBg').onclick = () => { campBg++; paint(); };
  $('heroSave').onclick = () => savePhoto(photo);
  paint();
  const left = o.size - o.party.length;
  // no line under the screen for it: the button itself says how many heroes are still missing
  $('heroLeft').textContent = left > 0 ? `Выбери ещё ${SIZE_WORDS[left]}` : '';
  const go = $<HTMLButtonElement>('heroGo');
  go.disabled = left > 0;
  go.textContent = left > 0 ? `Ещё ${left} ${plural(left, 'герой', 'героя', 'героев')}` : 'В путь';
}

// ------------------------------------------------------------ settings

export function bindSettings(onChange: () => void) {
  const name = $<HTMLInputElement>('setName');
  const vols = [[$<HTMLInputElement>('setMusic'), 'music'], [$<HTMLInputElement>('setSfx'), 'sfx']] as const;
  const sync = () => {
    name.value = settings.name;
    for (const [el, k] of vols) el.value = String(Math.round(settings[k] * 100));
    document.querySelectorAll<HTMLInputElement>('input[name=quality]').forEach(r => { r.checked = r.value === settings.quality; });
  };
  name.addEventListener('input', () => { settings.name = name.value.trim(); saveSettings(); });
  for (const [el, k] of vols) {
    el.addEventListener('input', () => { settings[k] = Number(el.value) / 100; sound.volumes(); });
    el.addEventListener('change', () => { saveSettings(); if (k === 'sfx') sound.play('ore'); });
  }
  document.querySelectorAll<HTMLInputElement>('input[name=quality]').forEach(r => r.addEventListener('change', () => {
    if (r.checked) { settings.quality = r.value as typeof settings.quality; saveSettings(); onChange(); }
  }));
  return sync;
}

// ------------------------------------------------------------ lobby

export function lobbyStatus(text: string) {
  $('lobbyStatus').textContent = text;
}

/** The host may start once every player has a hero and everyone but the host has pressed «Готов». */
export const startable = (players: Player[]) => players.every(p => p.hero !== null && (p.id === 'host' || p.ready));

/** The face under the mouse in the lobby, and the hero whose card is open when nothing is under it. */
let lobbyPeek = -1;
let lobbyShown = -1;

/**
 * Draw the room part of the lobby: the party's photo with every player's name written on it, the twelve heroes on one row
 * (a taken one shows its player's letter and can only be read), the card, and the start button (host) or «Готов» (the
 * rest). A player still choosing stands pale in the photo as the hero they point at.
 */
export function renderLobby(o: {
  code: string; players: Player[]; me: string; host: boolean; bg: number;
  onPick: (hero: number | null) => void; onLook: (hero: number | null) => void; onBg: () => void;
}) {
  $('lobbyStart').hidden = true;
  $('lobbyRoom').hidden = false;
  $('lobbyRoom').closest('.panel')!.classList.add('pick-panel');
  $('lobbyRoomCode').textContent = o.code;
  const me = o.players.find(p => p.id === o.me), mine = me?.hero ?? null;
  const ownerOf = (i: number) => o.players.find(p => p.hero === i);
  if (lobbyShown < 0) lobbyShown = mine ?? Math.max(0, HEROES.findIndex((_, i) => !ownerOf(i)));
  const photo = $<HTMLCanvasElement>('lobbyPhoto');
  zoomable(photo.parentElement!);
  const paint = () => {
    const i = lobbyPeek >= 0 ? lobbyPeek : lobbyShown;
    heroCard($('lobbyInfo'), i);
    const seats: PhotoSeat[] = o.players.map(p => ({
      hero: p.hero,
      look: p.hero !== null ? null : p.id === o.me && lobbyPeek >= 0 && !ownerOf(lobbyPeek) ? lobbyPeek : p.look ?? null,
      name: p.name, host: p.id === 'host', ready: !!p.ready,
    }));
    drawPhoto(photo, seats, { bg: o.bg, names: true });
    photo.setAttribute('aria-label', 'Фото отряда: ' + o.players.map(p => `${p.name}: ${p.hero !== null ? HEROES[p.hero].name : 'выбирает'}`).join(', '));
  };
  let sent: number | null = null, timer = 0;
  heroRow($('lobbyHeroes'), {
    mark: i => {
      const by = ownerOf(i);
      if (by) return by.id === o.me ? { cls: 'mine', badge: '', label: 'твой' } : { cls: 'taken', badge: escapeHtml(by.name.slice(0, 1).toUpperCase()), label: `взял ${by.name}` };
      const eye = o.players.find(p => p.hero === null && p.id !== o.me && p.look === i);
      return eye ? { cls: 'eyed', badge: escapeHtml(eye.name.slice(0, 1).toUpperCase()) + '?', label: `смотрит ${eye.name}` } : {};
    },
    onTap: i => {
      lobbyShown = i;
      const by = ownerOf(i);
      if (by && by.id !== o.me) { paint(); return; }
      o.onPick(mine === i ? null : i);
    },
    onPeek: i => {
      lobbyPeek = i;
      paint();
      // the others see the hero I point at only while I have none; a pause first, so a sweep of the mouse sends one word
      if (mine !== null) return;
      const want = i >= 0 && !ownerOf(i) ? i : null;
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (want !== sent) { sent = want; o.onLook(want); } }, 160);
    },
    shown: lobbyShown,
  });
  $('lobbyBg').hidden = !o.host;
  $('lobbyBg').onclick = () => o.onBg();
  $('lobbySave').onclick = () => savePhoto(photo);
  paint();
  // the same as the photo in words, for screen readers
  $('lobbyPlayers').innerHTML = o.players.map(p => {
    const def = p.hero !== null ? HEROES[p.hero] : null;
    // the host has no «Готов» of its own: it starts the game when the rest are ready
    const ready = p.id === 'host' ? '' : p.ready ? '<span class="rdy on">готов</span>' : '<span class="rdy">не готов</span>';
    return `<li><b>${escapeHtml(p.name)}</b>${p.id === 'host' ? ' · хозяин' : ''}${p.id === o.me ? ' · ты' : ''}<span class="muted">${def ? def.name : 'выбирает героя'}</span>${ready}</li>`;
  }).join('');
  const go = startable(o.players), waiting = o.players.filter(p => p.id !== 'host' && !p.ready);
  $('lobbyStartBtn').hidden = !o.host;
  $<HTMLButtonElement>('lobbyStartBtn').disabled = !go;
  const rb = $<HTMLButtonElement>('lobbyReadyBtn');
  rb.hidden = o.host;
  rb.disabled = mine === null;
  rb.textContent = me?.ready ? 'Не готов' : 'Готов';
  rb.classList.toggle('big', !me?.ready);
  rb.setAttribute('aria-pressed', String(!!me?.ready));
  $('lobbyHint').textContent = o.host
    ? go ? `Игроков: ${o.players.length}. Можно начинать: враги подстроятся под число героев.`
      : !o.players.every(p => p.hero !== null) ? 'Начать можно, когда все выберут героя и нажмут «Готов».'
      : `Ждём, пока нажмут «Готов»: ${waiting.map(p => p.name).join(', ')}.`
    : mine === null ? 'Выбери героя и нажми «Готов».'
    : me?.ready ? 'Игру начнёт хозяин комнаты.' : 'Нажми «Готов», когда соберёшься.';
}

export function resetLobby() {
  $('lobbyStart').hidden = false;
  $('lobbyRoom').hidden = true;
  $('lobbyRoom').closest('.panel')!.classList.remove('pick-panel');
  lobbyPeek = -1;
  lobbyShown = -1;
  $('lobbyPhoto').parentElement!.classList.remove('zoomed');
  lobbyStatus('');
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
