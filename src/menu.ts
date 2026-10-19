// Main menu and its screens: collection, settings and the online lobby.

import { BIOMES, HEROES, MOB_HP_MUL, KINDS, MOBS, fullHit, heroesByKind, kindOf, type MobKind } from './data';
import { drawPortrait, faceUrl, mobIcon } from './ui';
import { ARTIFACTS } from './artifacts';
import { artIcon } from './icons';
import { saveSettings, settings } from './settings';
import { favourite, stats } from './stats';
import { FLOORS, LAYERS } from './run';
import { sound } from './sound';
import type { Player } from './net';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'statsScreen', 'settingsScreen', 'pause'] as const;
export type Screen = (typeof SCREENS)[number];

/** Show one menu screen (or none). */
export function show(screen: Screen | null) {
  for (const id of SCREENS) $(id).hidden = id !== screen;
}

const FLOOR_NAMES = BIOMES.map(b => b.name);

/** Heroes as the pick screens show them: a row for each kind, its name on a tab at the row's start, then its heroes' cards. */
function pickRows(box: HTMLElement, card: (i: number) => HTMLElement) {
  box.innerHTML = '';
  heroesByKind().forEach((list, r) => {
    const tab = document.createElement('b');
    tab.className = 'pick-role';
    tab.textContent = KINDS[r].row;
    box.append(tab, ...list.map(card));
  });
}

// ------------------------------------------------------------ collection

export function renderCollection(tab: 'heroes' | 'mobs' | 'arts') {
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
  } else if (tab === 'arts') {
    // the floor bosses' trophies: what each does, and its joke
    for (const a of ARTIFACTS) {
      const card = document.createElement('article');
      card.className = 'card col-art';
      card.innerHTML = `<span class="col-art-ico">${artIcon(a.key)}</span><div><h3>${a.name}</h3><p><b>${a.txt}.</b> ${a.gag}</p></div>`;
      grid.appendChild(card);
    }
  } else {
    (Object.keys(MOBS) as MobKind[]).forEach(k => {
      const d = MOBS[k], card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `<img src="${mobIcon(k)}" alt=""><div><h3>${d.name}</h3><p><b>${FLOOR_NAMES[d.floor]}${d.boss ? ', босс' : ''}.</b> ${d.txt}</p>`
        + `<dl><dt>HP</dt><dd>${Math.round(d.hp * MOB_HP_MUL)}</dd><dt>Удар</dt><dd>${d.dmg}</dd>${d.armor ? `<dt>Броня</dt><dd>${d.armor}</dd>` : ''}</dl></div>`;
      grid.appendChild(card);
    });
  }
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

// ------------------------------------------------------------ campaign hero

/** The campaign's hero cards: the picked one is marked, and below them what it does. */
export function renderHeroSelect(picked: number, onPick: (hero: number) => void) {
  pickRows($('heroPicks'), i => {
    const def = HEROES[i], b = document.createElement('button');
    b.className = 'pick' + (picked === i ? ' mine' : '');
    b.style.setProperty('--c', def.col);
    b.setAttribute('aria-pressed', String(picked === i));
    const cv = document.createElement('canvas');
    drawPortrait(cv, { i, def });
    b.append(cv);
    const label = document.createElement('span');
    label.innerHTML = `${def.name}<em>${kindOf(def)}</em>`;
    b.append(label);
    b.addEventListener('click', () => onPick(i));
    return b;
  });
  const def = HEROES[picked];
  $('heroInfo').innerHTML = `<b style="color:${def.col}">${def.name}</b>. ${kindOf(def)}. HP ${def.hp}, урон ${fullHit(def.m, def.pw)}, скорость ${Math.round(def.pw * 100)}%, отскок ${Math.round(def.e * 100)}%. `
    + `Способность «${def.ab}»: ${def.abTxt}`;
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

/** Draw the room part of the lobby: code, hero cards to pick, the players, and the start button (host) or «Готов» (the rest). */
export function renderLobby(o: { code: string; players: Player[]; me: string; host: boolean; onPick: (hero: number | null) => void }) {
  $('lobbyStart').hidden = true;
  $('lobbyRoom').hidden = false;
  $('lobbyRoomCode').textContent = o.code;
  const me = o.players.find(p => p.id === o.me), mine = me?.hero ?? null;
  pickRows($('lobbyHeroes'), i => {
    const def = HEROES[i], by = o.players.find(p => p.hero === i), b = document.createElement('button');
    b.className = 'pick' + (mine === i ? ' mine' : by ? ' taken' : '');
    b.style.setProperty('--c', def.col);
    b.disabled = !!by && by.id !== o.me;
    b.setAttribute('aria-pressed', String(mine === i));
    const cv = document.createElement('canvas');
    drawPortrait(cv, { i, def });
    b.append(cv);
    const label = document.createElement('span');
    label.innerHTML = `${def.name}<em>${by ? (by.id === o.me ? 'ты' : by.name) : 'свободен'}</em>`;
    b.append(label);
    b.addEventListener('click', () => o.onPick(mine === i ? null : i));
    return b;
  });
  $('lobbyPlayers').innerHTML = o.players.map(p => {
    const def = p.hero !== null ? HEROES[p.hero] : null;
    // the host has no «Готов» of its own: it starts the game when the rest are ready
    const ready = p.id === 'host' ? '' : p.ready ? '<span class="rdy on">готов</span>' : '<span class="rdy">не готов</span>';
    return `<li><i style="--c:${def?.col ?? '#3a2d22'}"></i><b>${escapeHtml(p.name)}</b>${p.id === 'host' ? ' · хозяин' : ''}${p.id === o.me ? ' · ты' : ''}<span class="muted">${def ? def.name : 'выбирает героя'}</span>${ready}</li>`;
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
  lobbyStatus('');
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
