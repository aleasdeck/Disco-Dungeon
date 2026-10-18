// Main menu and its screens: collection, settings and the online lobby.

import { BIOMES, HEROES, MOB_HP_MUL, MOBS, fullHit, type MobKind } from './data';
import { drawPortrait, mobIcon } from './ui';
import { ARTIFACTS } from './artifacts';
import { artIcon } from './icons';
import { saveSettings, settings } from './settings';
import { sound } from './sound';
import type { Player } from './net';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'settingsScreen', 'pause'] as const;
export type Screen = (typeof SCREENS)[number];

/** Show one menu screen (or none). */
export function show(screen: Screen | null) {
  for (const id of SCREENS) $(id).hidden = id !== screen;
}

const FLOOR_NAMES = BIOMES.map(b => b.name);

// ------------------------------------------------------------ collection

export function renderCollection(tab: 'heroes' | 'mobs' | 'arts') {
  document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const grid = $('colGrid');
  grid.innerHTML = '';
  if (tab === 'heroes') {
    HEROES.forEach((def, i) => {
      const card = document.createElement('article');
      card.className = 'card';
      const cv = document.createElement('canvas');
      drawPortrait(cv, { i, def });
      // starting health, then the same words as the disc upgrades: damage of a full straight throw, speed next to Ash's, speed kept off a wall
      const stats = `<dt>HP</dt><dd>${def.hp}</dd><dt>Урон</dt><dd>${fullHit(def.m, def.pw)}</dd><dt>Скорость</dt><dd>${Math.round(def.pw * 100)}%</dd><dt>Отскок</dt><dd>${Math.round(def.e * 100)}%</dd>`;
      card.innerHTML = `<div></div><div><h3 style="color:${def.col}">${def.name}</h3><p>${def.role}. Способность «${def.ab}»: ${def.abTxt} ${def.abMore}</p>`
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

// ------------------------------------------------------------ campaign hero

/** The campaign's hero cards: the picked one is marked, and below them what it does. */
export function renderHeroSelect(picked: number, onPick: (hero: number) => void) {
  const box = $('heroPicks');
  box.innerHTML = '';
  HEROES.forEach((def, i) => {
    const b = document.createElement('button');
    b.className = 'pick' + (picked === i ? ' mine' : '');
    b.style.setProperty('--c', def.col);
    b.setAttribute('aria-pressed', String(picked === i));
    const cv = document.createElement('canvas');
    drawPortrait(cv, { i, def });
    b.append(cv);
    const label = document.createElement('span');
    label.innerHTML = `${def.name}<em>${def.role}</em>`;
    b.append(label);
    b.addEventListener('click', () => onPick(i));
    box.appendChild(b);
  });
  const def = HEROES[picked];
  $('heroInfo').innerHTML = `<b style="color:${def.col}">${def.name}</b>. ${def.role}. HP ${def.hp}, урон ${fullHit(def.m, def.pw)}, скорость ${Math.round(def.pw * 100)}%, отскок ${Math.round(def.e * 100)}%. `
    + `Способность «${def.ab}»: ${def.abTxt}`;
}

// ------------------------------------------------------------ settings

export function bindSettings(onChange: () => void) {
  const name = $<HTMLInputElement>('setName'), aim = $<HTMLInputElement>('setAim');
  const vols = [[$<HTMLInputElement>('setMusic'), 'music'], [$<HTMLInputElement>('setSfx'), 'sfx']] as const;
  const sync = () => {
    name.value = settings.name;
    aim.checked = settings.aimLine;
    for (const [el, k] of vols) el.value = String(Math.round(settings[k] * 100));
    document.querySelectorAll<HTMLInputElement>('input[name=quality]').forEach(r => { r.checked = r.value === settings.quality; });
  };
  name.addEventListener('input', () => { settings.name = name.value.trim(); saveSettings(); });
  aim.addEventListener('change', () => { settings.aimLine = aim.checked; saveSettings(); });
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

/** Draw the room part of the lobby: code, hero cards to pick, the players and (for the host) the start button. */
export function renderLobby(o: { code: string; players: Player[]; me: string; host: boolean; onPick: (hero: number | null) => void }) {
  $('lobbyStart').hidden = true;
  $('lobbyRoom').hidden = false;
  $('lobbyRoomCode').textContent = o.code;
  const mine = o.players.find(p => p.id === o.me)?.hero ?? null;
  const box = $('lobbyHeroes');
  box.innerHTML = '';
  HEROES.forEach((def, i) => {
    const by = o.players.find(p => p.hero === i), b = document.createElement('button');
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
    box.appendChild(b);
  });
  $('lobbyPlayers').innerHTML = o.players.map(p => {
    const def = p.hero !== null ? HEROES[p.hero] : null;
    return `<li><i style="--c:${def?.col ?? '#3a2d22'}"></i><b>${escapeHtml(p.name)}</b>${p.id === 'host' ? ' · хозяин' : ''}${p.id === o.me ? ' · ты' : ''}<span class="muted">${def ? def.name : 'выбирает героя'}</span></li>`;
  }).join('');
  const allPicked = o.players.every(p => p.hero !== null);
  $('lobbyStartBtn').hidden = !o.host;
  $<HTMLButtonElement>('lobbyStartBtn').disabled = !allPicked;
  $('lobbyHint').textContent = o.host
    ? (allPicked ? `Игроков: ${o.players.length}. Можно начинать: враги подстроятся под число героев.` : 'Начать можно, когда все выбрали героя.')
    : 'Игру начнёт хозяин комнаты.';
}

export function resetLobby() {
  $('lobbyStart').hidden = false;
  $('lobbyRoom').hidden = true;
  lobbyStatus('');
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
