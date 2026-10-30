// Main menu and its screens: the hero pick screens, statistics, settings and the online lobby (the collection is in src/collection.ts).

import { HEROES, KINDS, fullHit, heroesByKind, kindOf } from './data';
import { drawPortrait, faceUrl, shadowUrl, standIcon } from './ui';
import { saveSettings, settings } from './settings';
import { favourite, stats } from './stats';
import { FLOORS, LAYERS } from './run';
import { sound } from './sound';
import type { Player } from './net';
import { uiArt } from './assets';
import { BACKDROP_COUNT, drawPhoto, savePhoto, stillPhoto, type PhotoSeat } from './photo';
import { DEMO } from './demo';
import { bestStand, demoLocked, demoOpened, kindAt, locked, opening, prevOf, standFor, STARS_TO_OPEN, starsOf, volTop, wearStand } from './progress';
import { nextStand, standDef, STANDS, type StandMat } from './stands';
import { renderKnob } from './volview';
import { LANGS, isLang, lang, langTag, setLang, t } from './i18n';
import { tipAttrs } from './tip';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'statsScreen', 'settingsScreen', 'pause'] as const;
export type Screen = (typeof SCREENS)[number];

/** Show one menu screen (or none). */
export function show(screen: Screen | null) {
  for (const id of SCREENS) $(id).hidden = id !== screen;
}

// ------------------------------------------------------------ statistics

/** Seconds as hours and minutes. */
function clock(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? t('{0} ч {1} мин', h, m) : m || sec < 1 ? t('{0} мин', m) : t('{0} с', Math.round(sec));
}

const num = (n: number) => Math.round(n).toLocaleString(langTag());
const heroByKey = (key: string) => HEROES.findIndex(h => h.key === key);

/** The player's own statistics: the runs and their time, the favourite hero, every hero's runs, the totals and the records. */
export function renderStats() {
  const s = stats, box = $('statsBody');
  if (!s.runs) {
    box.innerHTML = `<p class="st-empty">${t('Пока ни одного забега. Сыграй кампанию или сетевую игру, и здесь появятся твои забеги, время, любимый герой и рекорды.')}</p>`;
    return;
  }
  const tile = (big: string, label: string, sub: string) => `<div class="st-tile"><b>${big}</b><span>${label}</span><small>${sub}</small></div>`;
  let html = '<div class="st-tiles">'
    + tile(num(s.runs), t('{0|забег|забега|забегов}', s.runs), s.online ? t('из них по сети {0}', num(s.online)) : t('все в одиночку'))
    + tile(clock(s.time), t('в забегах'), t('в среднем {0} на забег', clock(s.time / s.runs)))
    + tile(num(s.wins), t('{0|победа|победы|побед}', s.wins), s.losses ? t('и {0} {1|поражение|поражения|поражений}', num(s.losses), s.losses) : t('без поражений'))
    + '</div>';

  const fav = favourite(), fi = fav ? heroByKey(fav) : -1;
  if (fi >= 0) {
    const def = HEROES[fi], h = s.heroes[fav!];
    html += `<div class="st-fav" style="--c:${def.col}"><canvas></canvas><div><small>${def.fem ? t('Любимая героиня') : t('Любимый герой')}</small>`
      + `<b style="color:${def.col}">${t(def.name)}</b>`
      + `<span>${t('{0} {1|забег|забега|забегов} из {2}, {3} {4|победа|победы|побед}, {5} в забегах, {6} {7|враг повержен|врага повержено|врагов повержено}',
        num(h.runs), h.runs, num(s.runs), num(h.wins), h.wins, clock(h.time), num(h.kills), h.kills)}</span></div></div>`;
  }

  // every hero played here, the favourite first: a bar for the runs, then the wins and the time
  const played = Object.entries(s.heroes).filter(([k, h]) => h.runs && heroByKey(k) >= 0).sort((a, b) => b[1].runs - a[1].runs || b[1].time - a[1].time);
  if (played.length > 1) {
    const most = played[0][1].runs;
    html += `<h3>${t('По героям')}</h3><ul class="st-heroes">` + played.map(([k, h]) => {
      const i = heroByKey(k), def = HEROES[i];
      return `<li style="--c:${def.col}"><img src="${faceUrl({ i, def })}" alt=""><b>${t(def.name)}</b>`
        + `<span class="st-bar"><i style="width:${(h.runs / most) * 100}%"></i></span>`
        + `<em>${h.wins ? t('{0} {1|забег|забега|забегов}, {2} {3|победа|победы|побед}, {4}', num(h.runs), h.runs, num(h.wins), h.wins, clock(h.time))
          : t('{0} {1|забег|забега|забегов}, {2}', num(h.runs), h.runs, clock(h.time))}</em></li>`;
    }).join('') + '</ul>';
  }

  const sum = s.sum, row = (k: string, v: string) => `<dt>${t(k)}</dt><dd>${v}</dd>`;
  const topBy = heroByKey(s.best.topBy);
  html += `<div class="st-cols"><section><h3>${t('За всё время')}</h3><dl>`
    + row('Комнат пройдено', num(s.rooms))
    + row('Боссов повержено', num(s.bosses))
    + row('Врагов повержено', num(sum.kills))
    + row('Урона нанесено', num(sum.dmg))
    + row('Бросков', num(sum.throws))
    + row('Точных бросков', sum.throws ? `${num(sum.crits)} (${Math.round((sum.crits / sum.throws) * 100)}%)` : '0')
    + row('Умений применено', num(sum.abs))
    + row('Руды добыто', num(sum.ore))
    + row('Трофеев взято', num(s.arts))
    + row('Урона получено', num(sum.hurt))
    + row('Герой падал', t('{0} {1|раз|раза|раз}', num(sum.falls), sum.falls))
    + `</dl></section><section><h3>${t('Рекорды')}</h3><dl>`
    + row('Сильнейший удар', !sum.top ? '—' : topBy >= 0 ? `${num(sum.top)}, ${t(HEROES[topBy].name)}` : num(sum.top))
    + row('Врагов за забег', num(s.best.kills))
    + row('Дальше всего', s.wins ? t('всё подземелье') : t('этаж {0}, {1} {2|комната|комнаты|комнат} из {3}', Math.max(1, s.best.floor), num(s.best.rooms), s.best.rooms, FLOORS * LAYERS))
    + row('Быстрейшая победа', s.best.fast ? clock(s.best.fast) : t('ещё впереди'))
    + row('Отскоков до удара', num(sum.rico))
    + '</dl></section></div>';

  if (s.since) html += `<p class="st-since">${t('Считается на этом устройстве с {0}', new Date(s.since).toLocaleDateString(langTag(), { day: 'numeric', month: 'long', year: 'numeric' }))}</p>`;
  box.innerHTML = html;
  const cv = box.querySelector<HTMLCanvasElement>('.st-fav canvas');
  if (cv && fi >= 0) drawPortrait(cv, { i: fi, def: HEROES[fi] });
}

// ------------------------------------------------------------ campaign party

/** The campaign's party size in words: how many heroes are still missing. */
const SIZE_WORDS = ['', 'Выбери ещё одного героя', 'Выбери ещё двух героев', 'Выбери ещё трёх героев'];

// ------------------------------------------------------------ the pick screens: the party photo, the heroes, the card

const icon = (key: string) => uiArt.get(key)?.src ?? '';

/** What a shut hero's card says of the hero before it on its kind's ladder, and how far its stars go, by the kind's place in KINDS. */
const KIND_FIRST = ['Сначала открой толстяка перед ним.', 'Сначала открой чувака перед ним.', 'Сначала открой дрища перед ним.'];
export const KIND_NEXT = ['до нового толстяка', 'до нового чувака', 'до нового дрища'];
const STARS_WHY = 'Босс этажа даёт каждому герою отряда звёзды по номеру этажа: 1, 2 и 3.';

/** Stars toward the next hero as a row of STARS_TO_OPEN: the ones got in gold, the rest hollow. */
export function starRow(n: number) {
  const k = Math.min(n, STARS_TO_OPEN);
  return `<span class="stars" role="img" aria-label="${t('{0} из {1} {1|звезды|звёзд|звёзд}', k, STARS_TO_OPEN)}">${'★'.repeat(k)}<i>${'★'.repeat(STARS_TO_OPEN - k)}</i></span>`;
}

/**
 * How a hero not opened yet opens: the hero before it on its ladder gathers the stars, once that one is open itself. In the
 * demo the first win opens the next hero up the ladder of the party's first hero, and only that one.
 */
export function howToOpen(key: string) {
  const prev = prevOf(key);
  if (DEMO) {
    const got = demoOpened();
    if (demoLocked(key) || !prev) return t('Этот герой ждёт в полной версии игры.');
    return got ? t('В демо открывается только один герой, и это {0}. Этот ждёт в полной версии игры.', HEROES.find(h => h.key === got)!.name)
      : t('Откроется, когда {0} победит босса. В отряде считается герой под номером 1. В демо открывается только один герой.', HEROES.find(h => h.key === prev)!.name);
  }
  if (!prev) return '';
  // the one before is shut too: its name stays a secret
  if (locked(prev)) return t(KIND_FIRST[kindAt(key)]);
  return `${t('Откроется, когда {0} наберёт {1}&nbsp;★.', HEROES.find(h => h.key === prev)!.name, STARS_TO_OPEN)} ${t(STARS_WHY)}`;
}

/** The stars the hero before a shut one has gathered toward it, when that one is open. */
export function shutStars(key: string) {
  const prev = prevOf(key);
  if (DEMO || !prev || locked(prev)) return '';
  const n = starsOf(prev);
  return `<p class="pc-next">${starRow(n)}<span>${t('{0} из {1}', Math.min(n, STARS_TO_OPEN), STARS_TO_OPEN)}</span></p>`;
}
/**
 * The hero's stand: what it is made of and how many more wins with the hero make the next one, and the six stands in a row,
 * the ones earned to put the hero on with a tap, the rest dim. Nothing in the demo. `theirs`: another player's hero online,
 * on the stand that player put it on, only shown.
 */
function standLine(key: string, col: string, theirs?: StandMat) {
  if (DEMO) return '';
  if (theirs) return `<p class="pc-stand"><img src="${standIcon(theirs, col)}" alt=""><span>${t('Подставка: {0}', standDef(theirs).name)}</span></p>`;
  const best = bestStand(key), { mat, txt } = standText(key);
  const top = STANDS.indexOf(standDef(best));
  const mats = STANDS.map((s, k) => k <= top
    ? `<button type="button" class="ps-mat${s.mat === mat ? ' on' : ''}" data-mat="${s.mat}" aria-pressed="${s.mat === mat}"${tipAttrs({ h: t(s.name) })}><img src="${standIcon(s.mat, col)}" alt="${t(s.name)}"></button>`
    : `<span class="ps-mat shut"${tipAttrs({ p: t('{0:u}: за {1} {1|победу|победы|побед}', s.name, s.wins) })}><img src="${standIcon(s.mat, col)}" alt=""></span>`).join('');
  return `<div class="pc-stand"><div class="ps-mats" role="group" aria-label="${t('Выбор подставки')}">${mats}</div><span>${txt}</span></div>`;
}

/** The stand the hero `key` goes on, and the line about it: what it is made of and how many more wins make the next one. */
export function standText(key: string) {
  const best = bestStand(key), mat = standFor(key), next = nextStand(best), left = next ? next.wins - (stats.heroes[key]?.wins ?? 0) : 0;
  const tail = !next ? t('выше некуда') : left > 0 ? t('до {0} {1} {1|победа|победы|побед}', next.gen, left) : '';
  return { mat, txt: tail ? t('Подставка: {0}, {1}', standDef(mat).name, tail) : t('Подставка: {0}', standDef(mat).name) };
}

/** Mice can point at a hero to read it without taking it; fingers take it with a tap. */
const canPoint = () => matchMedia('(hover: hover)').matches;

/**
 * The card beside the photo: whose the hero is, its name and kind, its numbers, its stand, its ability whole, and its stars
 * while it still has a hero to open. A hero this player hasn't opened (`shut`) shows only its kind and how it opens.
 * `theirs`: the stand of another player who took the hero online. `onStand`: the player has put the hero on another stand.
 */
function heroCard(box: HTMLElement, i: number, shut = locked(HEROES[i].key), o: { theirs?: StandMat; onStand?: () => void } = {}) {
  const d = HEROES[i];
  if (shut) {
    box.style.setProperty('--c', '#a8916f');
    box.innerHTML = `<div class="pc-top"><h3>???<em>${t(KINDS[kindAt(d.key)].one)}</em></h3></div>`
      + `<div class="pc-ab pc-shut"><p>${howToOpen(d.key)}</p>${shutStars(d.key)}</div>`;
    fitCard(box);
    return;
  }
  box.style.setProperty('--c', d.col);
  // the name and the numbers on one line, so the ability fits whole without scrolling
  const hp = t('Здоровье'), dmg = t('Урон'), speed = t('Скорость'), bounce = t('Отскок');
  box.innerHTML = `<div class="pc-top"><h3>${t(d.name)}<em>${t(kindOf(d))}</em></h3>`
    + `<ul class="pc-stats"><li${tipAttrs({ h: hp })}><img src="${icon('ico_hp')}" alt="${hp}">${d.hp}</li>`
    + `<li${tipAttrs({ h: dmg })}><img src="${icon('up_dmg')}" alt="${dmg}">${fullHit(d.m, d.pw)}</li>`
    + `<li${tipAttrs({ h: speed })}><img src="${icon('up_speed')}" alt="${speed}">${Math.round(d.pw * 100)}%</li>`
    + `<li${tipAttrs({ h: bounce })}><img src="${icon('up_bounce')}" alt="${bounce}">${Math.round(d.e * 100)}%</li></ul></div>`
    + (opening(d.key) ? `<p class="pc-next"${tipAttrs({ p: t(STARS_WHY) })}>${starRow(starsOf(d.key))}<span>${t(KIND_NEXT[kindAt(d.key)])}</span></p>` : '')
    + standLine(d.key, d.col, o.theirs)
    + `<div class="pc-ab"><div class="pc-abname"><span class="pc-gem" style="--ab:${d.abCol}"><img src="${icon('ab_' + d.key)}" alt=""></span><b>${t('«{0}»', d.ab)}</b></div>`
    + `<p>${t(d.abTxt)}</p><p class="pc-more">${t(d.abMore)}</p></div>`;
  box.querySelectorAll<HTMLButtonElement>('.ps-mat[data-mat]').forEach(b => b.addEventListener('click', () => {
    if (b.classList.contains('on')) return;
    wearStand(d.key, b.dataset.mat as StandMat);
    heroCard(box, i, shut, o);
    o.onStand?.();
  }));
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
    group.innerHTML = `<span class="pk-name">${t(KINDS[r].row)}</span>`;
    faces.className = 'pk-faces';
    group.append(faces);
    for (const i of list) {
      const def = HEROES[i], b = document.createElement('button');
      // the demo's other heroes: a dark shape in its frame with a «?» for the name, not to be picked or read
      if (demoLocked(def.key)) {
        b.className = 'pick shut';
        b.disabled = true;
        b.setAttribute('aria-label', t('Герой из полной версии'));
        b.innerHTML = `<img src="${shadowUrl({ i, def })}" alt=""><span>?</span><b class="pick-q" aria-hidden="true">?</b>`;
        faces.append(b);
        continue;
      }
      const m = o.mark(i);
      // a hero not opened yet: the same dark shape, but its card tells how it opens; one another player took shows as itself
      const shut = locked(def.key) && m.cls !== 'taken';
      b.className = 'pick' + (shut ? ' shut' : '') + (m.cls ? ' ' + m.cls : '');
      if (!shut) b.style.setProperty('--c', def.col);
      b.dataset.i = String(i);
      b.setAttribute('aria-label', [shut ? t('Закрытый герой, {0}', KINDS[r].one) : t(def.name), m.label].filter(Boolean).join(', '));
      b.setAttribute('aria-pressed', String(!!m.cls?.includes('mine')));
      b.innerHTML = (shut ? `<img src="${shadowUrl({ i, def })}" alt=""><span>?</span><b class="pick-q" aria-hidden="true">?</b>`
        : `<img src="${faceUrl({ i, def })}" alt=""><span>${t(def.name)}</span>`) + (m.badge ? `<b class="pick-n">${m.badge}</b>` : '');
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
/** The backdrop of the campaign's party photo as it is now: the run keeps it for its album. */
export const campPhotoBg = () => campBg;

/**
 * The campaign's screen: how many heroes go (1 to 3, one player plays them all), the party's photo, the twelve heroes on
 * one row and the card of the hero last tapped (`shown`) or under the mouse. The next free place in the photo shows the
 * hero under the mouse pale, as a try-on.
 */
export function renderHeroSelect(o: { size: number; party: number[]; shown: number; vol: number; onPick: (hero: number) => void; onSize: (n: number) => void; onVol: (n: number) => void }) {
  $('heroSize').innerHTML = [1, 2, 3].map(n => `<button class="btn tab${n === o.size ? ' on' : ''}" data-n="${n}" aria-pressed="${n === o.size}">${t('{0} {0|герой|героя|героев}', n)}</button>`).join('');
  $('heroSize').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => o.onSize(Number(b.dataset.n))));
  campPeek = -1;
  const photo = $<HTMLCanvasElement>('heroPhoto');
  photo.parentElement!.classList.remove('zoomed');
  zoomable(photo.parentElement!);
  const paint = () => {
    const i = campPeek >= 0 ? campPeek : o.shown;
    heroCard($('heroInfo'), i);
    const tryOn = campPeek >= 0 && !o.party.includes(campPeek) && !locked(HEROES[campPeek].key) ? campPeek : null;
    const seats: PhotoSeat[] = Array.from({ length: o.size }, (_, k) => ({ hero: o.party[k] ?? null, look: k === o.party.length ? tryOn : null }));
    drawPhoto(photo, seats, { bg: campBg, names: false });
    photo.setAttribute('aria-label', t('Фото отряда: {0}', o.party.map(h => t(HEROES[h].name)).join(', ') || t('пока никого')));
    stillPhoto(photo);
  };
  heroRow($('heroPicks'), {
    mark: i => {
      const at = o.party.indexOf(i);
      return at < 0 ? {} : { cls: 'mine', badge: o.size > 1 ? String(at + 1) : '', label: t('в отряде') };
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
  $('heroLeft').textContent = left > 0 ? t(SIZE_WORDS[left]) : '';
  const go = $<HTMLButtonElement>('heroGo');
  go.disabled = left > 0;
  go.textContent = left > 0 ? t('Ещё {0} {0|герой|героя|героев}', left) : t('В путь');
  renderKnob($('heroVol'), { vol: o.vol, top: volTop(), onVol: o.onVol });
}

// ------------------------------------------------------------ settings

export function bindSettings(onChange: () => void) {
  const name = $<HTMLInputElement>('setName'), pick = $<HTMLSelectElement>('setLang');
  const vols = [[$<HTMLInputElement>('setMusic'), 'music'], [$<HTMLInputElement>('setSfx'), 'sfx']] as const;
  // every language by its own name
  pick.innerHTML = LANGS.map(l => `<option value="${l.code}" lang="${l.tag}">${l.name}</option>`).join('');
  const sync = () => {
    pick.value = lang();
    name.value = settings.name;
    for (const [el, k] of vols) el.value = String(Math.round(settings[k] * 100));
    document.querySelectorAll<HTMLInputElement>('input[name=quality]').forEach(r => { r.checked = r.value === settings.quality; });
  };
  pick.addEventListener('change', () => {
    if (!isLang(pick.value)) return;
    settings.lang = pick.value;
    saveSettings();
    void setLang(pick.value);
  });
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

/** The line under the lobby: a line of the game, translated here (t). */
export function lobbyStatus(text: string) {
  $('lobbyStatus').textContent = t(text);
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
  code: string; players: Player[]; me: string; host: boolean; bg: number; vol: number;
  onPick: (hero: number | null) => void; onLook: (hero: number | null) => void; onBg: () => void; onVol: (n: number) => void;
}) {
  $('lobbyStart').hidden = true;
  $('lobbyRoom').hidden = false;
  $('lobbyRoom').closest('.panel')!.classList.add('pick-panel');
  $('lobbyCodeBox').hidden = false;
  $('lobbyRoomCode').textContent = o.code;
  const me = o.players.find(p => p.id === o.me), mine = me?.hero ?? null;
  const ownerOf = (i: number) => o.players.find(p => p.hero === i);
  if (lobbyShown < 0) lobbyShown = mine ?? Math.max(0, HEROES.findIndex((h, i) => !ownerOf(i) && !locked(h.key)));
  const photo = $<HTMLCanvasElement>('lobbyPhoto');
  zoomable(photo.parentElement!);
  const paint = () => {
    const i = lobbyPeek >= 0 ? lobbyPeek : lobbyShown, by = ownerOf(i);
    // another player's hero stands on their stand; a new stand for my own hero goes to the host with it
    heroCard($('lobbyInfo'), i, locked(HEROES[i].key) && !by, by && by.id !== o.me ? { theirs: by.stand ?? 'plastic' } : { onStand: () => { if (mine === i) o.onPick(i); } });
    const seats: PhotoSeat[] = o.players.map(p => ({
      hero: p.hero,
      look: p.hero !== null ? null : p.id === o.me && lobbyPeek >= 0 && !ownerOf(lobbyPeek) && !locked(HEROES[lobbyPeek].key) ? lobbyPeek : p.look ?? null,
      name: p.name, host: p.id === 'host', ready: !!p.ready,
    }));
    drawPhoto(photo, seats, { bg: o.bg, names: true });
    photo.setAttribute('aria-label', t('Фото отряда: {0}', o.players.map(p => `${p.name}: ${p.hero !== null ? t(HEROES[p.hero].name) : t('выбирает')}`).join(', ')));
    stillPhoto(photo);
  };
  let sent: number | null = null, timer = 0;
  heroRow($('lobbyHeroes'), {
    mark: i => {
      const by = ownerOf(i);
      if (by) return by.id === o.me ? { cls: 'mine', badge: '', label: t('твой') } : { cls: 'taken', badge: escapeHtml(by.name.slice(0, 1).toUpperCase()), label: t('взял {0}', by.name) };
      const eye = o.players.find(p => p.hero === null && p.id !== o.me && p.look === i);
      return eye ? { cls: 'eyed', badge: escapeHtml(eye.name.slice(0, 1).toUpperCase()) + '?', label: t('смотрит {0}', eye.name) } : {};
    },
    onTap: i => {
      // my own hero with another hero's card open: the tap opens its card, where its stand is picked, and the next tap lets it go
      const read = mine === i && lobbyShown !== i;
      lobbyShown = i;
      const by = ownerOf(i);
      if (read || (by && by.id !== o.me) || (!by && locked(HEROES[i].key))) { paint(); return; }
      o.onPick(mine === i ? null : i);
    },
    onPeek: i => {
      lobbyPeek = i;
      paint();
      // the others see the hero I point at only while I have none; a pause first, so a sweep of the mouse sends one word
      if (mine !== null) return;
      const want = i >= 0 && !ownerOf(i) && !locked(HEROES[i].key) ? i : null;
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
    const ready = p.id === 'host' ? '' : p.ready ? `<span class="rdy on">${t('готов')}</span>` : `<span class="rdy">${t('не готов')}</span>`;
    return `<li><b>${escapeHtml(p.name)}</b>${p.id === 'host' ? ` · ${t('хозяин')}` : ''}${p.id === o.me ? ` · ${t('ты')}` : ''}<span class="muted">${def ? t(def.name) : t('выбирает героя')}</span>${ready}</li>`;
  }).join('');
  // the host turns the knob for the table, the rest see where it stands
  renderKnob($('lobbyVol'), { vol: o.vol, top: volTop(), ...(o.host ? { onVol: o.onVol } : {}) });
  const go = startable(o.players), waiting = o.players.filter(p => p.id !== 'host' && !p.ready);
  $('lobbyStartBtn').hidden = !o.host;
  $<HTMLButtonElement>('lobbyStartBtn').disabled = !go;
  const rb = $<HTMLButtonElement>('lobbyReadyBtn');
  rb.hidden = o.host;
  rb.disabled = mine === null;
  rb.textContent = me?.ready ? t('Не готов') : t('Готов');
  rb.classList.toggle('big', !me?.ready);
  rb.setAttribute('aria-pressed', String(!!me?.ready));
  $('lobbyHint').textContent = o.host
    ? go ? t('Игроков: {0}. Можно начинать: враги подстроятся под число героев.', o.players.length)
      : !o.players.every(p => p.hero !== null) ? t('Начать можно, когда все выберут героя и нажмут «Готов».')
      : t('Ждём, пока нажмут «Готов»: {0}.', waiting.map(p => p.name).join(', '))
    : mine === null ? t('Выбери героя и нажми «Готов».')
    : me?.ready ? t('Игру начнёт хозяин комнаты.') : t('Нажми «Готов», когда соберёшься.');
}

export function resetLobby() {
  $('lobbyStart').hidden = false;
  $('lobbyRoom').hidden = true;
  $('lobbyRoom').closest('.panel')!.classList.remove('pick-panel');
  $('lobbyCodeBox').hidden = true;
  lobbyPeek = -1;
  lobbyShown = -1;
  $('lobbyPhoto').parentElement!.classList.remove('zoomed');
  lobbyStatus('');
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
