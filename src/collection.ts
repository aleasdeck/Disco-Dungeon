// «Коллекция» as a case folder (Vladislav's pick, 2026-10-26): every tab is a folder of files, one sheet a thing. The
// things of a tab come in groups, each behind a folder tab of its own: the heroes by kind, the enemies and the trinkets by
// floor, the trophies and the events by how they open. The folder shows the group's list (a row of faces on an upright
// phone) and the sheet of the thing picked: its photo on a paperclip with a stamp, its fields, its lines and what it
// does, all on one screen. Words that don't fit the sheet shrink instead of scrolling; a swipe across the sheet, ‹ › or the
// arrow keys go on to the next file. The heroes are guests on the list at the door of the disco underground, not recruits.

import { BIOMES, HEROES, KINDS, MOBS, MOB_HP_MUL, fullHit, heroesByKind, kindOf, toughOf, type MobKind } from './data';
import { faceUrl, mobFace, mobIcon, shadowUrl, standIcon } from './ui';
import { envArt, eventArt, sprites, uiArt } from './assets';
import { artIcon, icon as inked } from './icons';
import { ARTIFACTS } from './artifacts';
import { BOSS_UP, CASTS } from './room';
import { TRINKETS, opened } from './trinkets';
import { FLOORS } from './run';
import { DEMO } from './demo';
import { MEETS, START_ARTS, START_EVENTS, STARS_TO_OPEN, artLocked, eventLocked, featOf, kindAt, locked, meetOf, opening, prevOf, starsOf } from './progress';
import { dossierOf, inDossier } from './dossier';
import { EVENTS, eventDef } from './events';
import { KIND_NEXT, howToOpen, shutStars, standText, starRow } from './menu';
import { t } from './i18n';
import { tipAttrs } from './tip';

export type ColTab = 'heroes' | 'mobs' | 'arts' | 'events' | 'trinkets';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pic = (key: string) => uiArt.get(key)?.src ?? '';

/** A line each of the heroes' character, for their sheets: what the people at the door say about them. */
export const HERO_LINES: Record<string, string> = {
  bastion: 'Щит весь в помаде: говорит, от благодарных героинь. Героини говорят, что он целует его сам перед зеркалом.',
  cook: 'Двадцать лет кормила тюремную столовую, и никто ни разу не пожаловался. Жаловаться было некому.',
  bouncer: 'Фейсконтроль проходят немногие. Остальные проходят сквозь стену.',
  cop: 'Каждого скелета в казематах знает по имени и по статье. Пирожок изъят как вещдок.',
  ash: 'Звезда немого кино: после её премьеры от кинотеатра остались одни угли. Прикуривает от пальца.',
  electra: 'Причёску не укладывает: её укладывают двести двадцать вольт. В лифте с ней лучше не ездить.',
  bum: 'Враги слышат его за три комнаты, а чуют за пять. Селёдка в кармане для свежести.',
  genius: 'Выгнан из НИИ за опыты над вахтёром. Вахтёр до сих пор стоит в морозилке как живой.',
  ricochet: 'Уверен, что неотразим. Диски с ним согласны: отражаются от всего подряд.',
  sharp: 'В колоде пять тузов, в рукаве ещё три. Поцелуй на щеке тоже выиграл в карты.',
  kid: 'Рыжий, с петардами по карманам. Мама думает, что он в кружке юного химика.',
  model: 'Ест один листик салата в неделю и делится им с подружкой. На подиуме её не заметили: встала боком.',
};

/** One file of the folder: its key, whether it is open, its name, its place in the list, and its sheet by its number. */
interface File {
  key: string;
  open: boolean;
  name: string;
  /** Its face in the list, on the colour `col`, and the list's second line under its name. */
  face: string;
  col: string;
  small: string;
  sheet: (no: number) => string;
}

interface Group { tab: string; title: string; files: File[] }

/** The tab shown, the file picked in each tab, the hero whose line each trinket shows, and how the next sheet comes in. */
let tab: ColTab = 'heroes';
const picked: Partial<Record<ColTab, string>> = {};
const says: Record<string, string> = {};
let enter = 'cs-in-pop';

const FLOOR_NAMES = BIOMES.map(b => b.name);
const no3 = (n: number) => String(n).padStart(3, '0');
/** A name still secret: blacked out, as long as the name is. */
const blackout = (s: string) => `<span class="cs-red">${s.replace(/\S/g, 'x')}</span>`;
const field = (label: string, body: string, cls = '') => `<div class="cs-fd${cls ? ' ' + cls : ''}"><i>${label}</i>${body}</div>`;
const chip = (img: string, val: string | number, label: string) => `<li${tipAttrs({ h: label })}><img src="${img}" alt="">${val}<small>${label}</small></li>`;

/** The photo on the sheet: a figure cut out as a sticker on a coloured backdrop, a thing on kraft, an event's scene whole. */
function photo(o: { img: string; kind: 'fig' | 'thing' | 'scene'; shut: boolean; col: string; stamp: string; green: boolean; big?: string }) {
  // a stamp with a long word (German, Polish) is set smaller
  const long = o.stamp.length > 16 || o.stamp.split(/\s+/).some(w => w.length > 9) ? ' long' : '';
  const zoom = !o.shut && o.big ? ` data-big="${o.big}" data-kind="${o.kind}" role="button" tabindex="0" aria-label="${t('Рассмотреть')}"` : '';
  return `<div class="cs-photo cs-${o.kind}${o.shut ? ' shut' : ''}${zoom ? ' zoom' : ''}" style="--c:${o.col}"${zoom}><i class="cs-clip" aria-hidden="true"></i>`
    + `<span class="cs-pin">${o.img}</span><b class="cs-stamp${o.green ? ' g' : ''}${long}">${o.stamp}</b></div>`;
}

/**
 * The sheet: its title and number, the photo with its stamp, the fields beside it, the thing's character in words (`flav`,
 * beside the photo too where the sheet is wide) and the rest of the file below.
 */
function sheet(o: { title: string; note: string; photo: string; fields: string; flav?: string; body: string }) {
  // the character twice: beside the photo, and at the head of the rest for an upright phone, the stylesheet shows one
  return `<header class="cs-top"><span>${o.title}</span><span>${o.note}</span></header>${o.photo}<div class="cs-fields">${o.fields}</div>`
    + `${o.flav ? `<div class="cs-flav">${o.flav}</div>` : ''}<div class="cs-txt">${o.flav ? `<div class="cs-flav-in">${o.flav}</div>` : ''}${o.body}</div>`;
}

// ------------------------------------------------------------ the files of each tab

function heroFile(i: number): File {
  const def = HEROES[i], h = { i, def }, shut = locked(def.key), prev = prevOf(def.key);
  const sp = sprites.get(def.key);
  const stars = !shut || DEMO || !prev || locked(prev) ? '' : `★ ${t('{0} из {1}', Math.min(starsOf(prev), STARS_TO_OPEN), STARS_TO_OPEN)}`;
  return {
    key: def.key, open: !shut, name: t(def.name), col: shut ? '#a8916f' : def.col,
    face: `<img src="${shut ? shadowUrl(h) : faceUrl(h)}" alt="">`,
    small: shut ? stars : t('В списке'),
    sheet: no => sheet({
      title: t('Анкета гостя № {0}', no3(no)), note: shut ? t('Ждёт у входа') : t('Проход свободный'),
      photo: photo({ img: `<img src="${sp ? sp.img.src : faceUrl(h)}" alt="">`, kind: 'fig', shut, col: def.col, stamp: shut ? t('Не в списке') : t('В списке'), green: !shut, big: sp?.img.src }),
      fields: field(t('Кличка'), `<b class="cs-name">${shut ? blackout(t(def.name)) : t(def.name)}</b>`)
        + field(t('Сложение'), `<span>${t(shut ? KINDS[kindAt(def.key)].one : kindOf(def))}</span>`)
        + (shut ? '' : field(t('Показатели'), `<ul class="cs-chips">${chip(pic('ico_hp'), def.hp, 'HP')}${chip(pic('up_dmg'), fullHit(def.m, def.pw), t('Урон'))}`
          + `${chip(pic('up_speed'), `${Math.round(def.pw * 100)}%`, t('Скорость'))}${chip(pic('up_bounce'), `${Math.round(def.e * 100)}%`, t('Отскок'))}</ul>`)),
      flav: shut ? '' : field(t('Приметы'), `<p class="cs-hand">${t(HERO_LINES[def.key] ?? '')}</p>`),
      body: shut ? field(t('Как попасть в список'), `<p>${howToOpen(def.key)}</p>${shutStars(def.key)}`)
        : field(t('Умеет'), `<p><b>${t('«{0}»', def.ab)}.</b> ${t(def.abTxt)}${def.abMore ? ` <button type="button" class="cs-more" data-more>${t('Подробнее')}</button>` : ''}</p>`)
          + (DEMO ? '' : `<p class="cs-stand"><img src="${standIcon(standText(def.key).mat, def.col)}" alt="">${standText(def.key).txt}</p>`)
          + (opening(def.key) ? `<p class="cs-next">${starRow(starsOf(def.key))}<span>${t(KIND_NEXT[kindAt(def.key)])}</span></p>` : '')
          + (def.abMore ? `<p class="cs-foot">${t(def.abMore)}</p>` : ''),
    }),
  };
}

/** How dangerous an enemy is, by its place in its floor: a common one, an elite, a boss. */
const DANGER = [['Опасен', 'Опасна'], ['Очень опасен', 'Очень опасна'], ['Особо опасен', 'Особо опасна']];

function mobFile(k: MobKind): File {
  const d = MOBS[k], f = dossierOf(k), shut = !f.met, sp = sprites.get(k), floor = FLOOR_NAMES[d.floor];
  const elite = CASTS.some(c => c.elite === k), danger = t(DANGER[d.boss ? 2 : elite ? 1 : 0][d.fem ? 1 : 0]);
  const where = d.boss ? t('{0}, босс', floor) : elite ? t('{0}, элита', floor) : t(floor);
  // a boss as a party of three meets it, its extra health and blow (BOSS_UP) included
  const up = BOSS_UP[k];
  const lines = (f.lines ?? []).map((line, i) => (i < f.open ? `<li><q>${t(line)}</q></li>`
    : `<li class="off">${blackout(t(line))}<small>${d.boss ? (f.need[i] === 1 ? t('Откроется после первой победы') : t('Откроется после {0} {0|победы|побед|побед}: {1} из {0}', f.need[i], f.n))
      : d.fem ? t('Откроется после {0} {0|победы|побед|побед} над ней: {1} из {0}', f.need[i], f.n) : t('Откроется после {0} {0|победы|побед|побед} над ним: {1} из {0}', f.need[i], f.n)}</small></li>`)).join('');
  return {
    key: k, open: !shut, name: t(d.name), col: shut ? '#a8916f' : '#b8323f',
    face: `<img src="${shut ? mobIcon(k) : mobFace(k)}" alt="">`,
    small: shut ? '' : danger,
    sheet: no => sheet({
      title: t('Досье № {0}', no3(no)), note: shut ? t('Совершенно секретно') : t('Хранить вечно'),
      photo: photo({ img: `<img src="${sp ? sp.img.src : mobIcon(k)}" alt="">`, kind: 'fig', shut, col: '#b8323f', stamp: shut ? t('Засекречено') : danger, green: false, big: sp?.img.src }),
      fields: field(t('Кличка'), `<b class="cs-name">${shut ? blackout(t(d.name)) : t(d.name)}</b>`) + field(t('Где водится'), `<span>${where}</span>`)
        + (shut ? '' : field(t('Показатели'), `<ul class="cs-chips">${chip(pic('ico_hp'), Math.round(d.hp * MOB_HP_MUL * toughOf(k) * (up?.hp[2] ?? 1)), 'HP')}`
          + `${chip(pic('ico_hit'), Math.round((d.dmg + (up?.dmg[2] ?? 0)) * toughOf(k)), t('Удар'))}${d.armor ? chip(pic('ico_armor'), d.armor, t('Броня')) : ''}</ul>`)),
      flav: shut ? '' : field(t('Повадки'), `<p>${t(d.txt)}</p>`),
      body: shut ? field(t('Рассекретить'), `<p>${d.fem ? t('Ещё не встречалась.') : t('Ещё не встречался.')}</p>`)
        : (lines ? field(t('Из досье'), `<ul class="cs-lines">${lines}</ul>`) : '')
          + (d.boss && f.n ? `<p class="cs-count">${d.fem ? t('Побеждена {0} {0|раз|раза|раз}', f.n) : t('Побеждён {0} {0|раз|раза|раз}', f.n)}</p>` : ''),
    }),
  };
}

function artFile(key: string): File {
  // the demo opens no trophy by a feat: the others wait for the full game
  const a = ARTIFACTS.find(x => x.key === key)!, shut = artLocked(key), feat = shut && !DEMO ? featOf(key) : null;
  const start = START_ARTS.includes(a.key), ico = artIcon(a.key);
  return {
    key, open: !shut, name: t(a.name), face: ico, col: '#6b4a2c',
    small: feat?.need ? t('{0} из {1}', feat.now ?? 0, feat.need) : '',
    sheet: no => sheet({
      title: t('Вещдок № {0}', no3(no)), note: shut ? t('Совершенно секретно') : t('Хранить вечно'),
      photo: photo({ img: ico, kind: 'thing', shut, col: '#9a7440', stamp: shut ? t('Засекречено') : t('Вещдок'), green: !shut, big: uiArt.get('art_' + a.key)?.src }),
      fields: field(t('Предмет'), `<b class="cs-name">${shut ? blackout(t(a.name)) : t(a.name)}</b>`) + field(t('Откуда'), `<span>${start ? t('Есть с самого начала') : t('Открыт подвигом')}</span>`),
      flav: shut ? '' : field(t('Что делает'), `<p><b>${t(a.txt)}.</b></p>`),
      body: !shut ? field(t('Приметы'), `<p class="cs-hand">${t(a.gag)}</p>`)
        : !feat ? field(t('Рассекретить'), `<p>${t('Этот трофей ждёт в полной версии игры.')}</p>`)
        : field(t('Рассекретить'), `<p><b>${t('Подвиг.')}</b> ${t(feat.how)}</p>`
          + (feat.need ? `<p class="cs-prog"><span class="cs-bar"><i style="width:${Math.round((100 * (feat.now ?? 0)) / feat.need)}%"></i></span>${t('{0} из {1}', feat.now ?? 0, feat.need)}</p>` : '')),
    }),
  };
}

function eventFile(key: string): File {
  const e = eventDef(key), shut = eventLocked(key), m = meetOf(key), art = eventArt.get(key);
  // the one before it in its chain is shut too: whom it knows stays a secret
  const how = DEMO ? t('Это событие ждёт в полной версии игры.') : !m ? '' : eventLocked(m.from) ? t('Сначала открой событие, которое к нему ведёт.') : t(m.how);
  const img = art ? `<img src="${art.src}" alt="">` : '';
  const choices = e.choices.map(c => `<li>${t(c.label)}${c.pay ? `<b>${c.pay}${inked('ore')}</b>` : c.odds ? `<b>${Math.round(c.odds * 100)}%</b>` : ''}</li>`).join('');
  return {
    key, open: !shut, name: t(e.title), face: img, col: '#6b4a2c', small: '',
    sheet: no => sheet({
      title: t('Протокол № {0}', no3(no)), note: shut ? t('Совершенно секретно') : t('Хранить вечно'),
      photo: photo({ img, kind: 'scene', shut, col: '#6b4a2c', stamp: shut ? t('Засекречено') : t('Протокол'), green: !shut, big: art?.src }),
      fields: field(t('Место'), `<b class="cs-name">${shut ? blackout(t(e.title)) : t(e.title)}</b>`)
        + field(t('Откуда'), `<span>${START_EVENTS.includes(key) ? t('Есть с самого начала') : t('Открыто знакомством')}</span>`),
      flav: shut ? '' : field(t('Со слов очевидцев'), `<p class="cs-hand cs-long">${t(e.txt)}</p>`),
      body: shut ? field(t('Рассекретить'), `<p>${how}</p>`) : field(t('Варианты'), `<ul class="cs-choices">${choices}</ul>`),
    }),
  };
}

function trinketFile(key: string, heroes: number[]): File {
  const it = TRINKETS.find(x => x.key === key)!, art = envArt.get(it.art), got = heroes.filter(i => opened(key, HEROES[i].key)), shut = !got.length;
  const img = art ? `<img src="${art.src}" alt="">` : '';
  const count = t('{0} из {1}', got.length, heroes.length);
  return {
    key, open: !shut, name: t(it.name), face: img, col: '#6b4a2c', small: count,
    sheet: no => {
      // whose line the bubble shows: the one tapped last, else the first who has picked it up
      const who = heroes.find(i => HEROES[i].key === says[key]) ?? got[0] ?? heroes[0], def = HEROES[who];
      const faces = heroes.map(i => {
        const d = HEROES[i], on = opened(key, d.key);
        return `<button type="button" class="cs-face${on ? '' : ' off'}${i === who ? ' on' : ''}" style="--c:${d.col}" data-say="${d.key}" aria-pressed="${i === who}"${tipAttrs({ h: t(d.name) })}><img src="${faceUrl({ i, def: d })}" alt="${t(d.name)}"></button>`;
      }).join('');
      const line = opened(key, def.key) ? `<p class="cs-bub" style="--c:${def.col}"><b>${t(def.name)}</b><q>${t(it.lines[def.key])}</q></p>`
        : `<p class="cs-bub off">${t('{0} ещё не {1?подбирала|подбирал} эту безделушку.', def.name, !!def.fem)}</p>`;
      return sheet({
        title: t('Находка № {0}', no3(no)), note: shut ? t('Совершенно секретно') : t('Хранить вечно'),
        photo: photo({ img, kind: 'thing', shut, col: '#9a7440', stamp: shut ? t('Засекречено') : t('Находка'), green: !shut, big: art?.src }),
        fields: field(t('Предмет'), `<b class="cs-name">${shut ? blackout(t(it.name)) : t(it.name)}</b>`) + field(t('Где'), `<span>${t(FLOOR_NAMES[it.floor])}</span>`)
          + (shut ? '' : field(t('Показания'), `<span>${count}</span>`)),
        flav: shut ? '' : field(t('Описание'), `<p class="cs-hand">${t(it.txt)}</p>`),
        body: shut ? field(t('Рассекретить'), `<p>${t('Ещё не попадалась. Прокати по ней диск в комнате, и герой скажет о ней своё.')}</p>`)
          : field(t('Показания героев'), `<div class="cs-faces">${faces}</div>${line}`, 'cs-says'),
      });
    },
  };
}

/** The groups of a tab, in order, each with its folder tab's name and its list's title. */
function groupsOf(which: ColTab): Group[] {
  if (which === 'heroes') return heroesByKind().map((list, r) => ({ tab: t(KINDS[r].row), title: t(KINDS[r].row), files: list.map(heroFile) }));
  if (which === 'mobs') {
    const kinds = (Object.keys(MOBS) as MobKind[]).filter(inDossier);
    // a floor's common enemies, then its elite, then its bosses
    const rank = (k: MobKind) => (MOBS[k].boss ? 2 : CASTS.some(c => c.elite === k) ? 1 : 0);
    return BIOMES.map((b, f) => ({ tab: t('Этаж {0}', f + 1), title: t(b.name), files: kinds.filter(k => MOBS[k].floor === f).sort((x, y) => rank(x) - rank(y)).map(mobFile) }));
  }
  if (which === 'arts') {
    const later = ARTIFACTS.filter(a => !START_ARTS.includes(a.key)).map(a => a.key);
    return [{ tab: t('Есть сразу'), title: t('Есть сразу'), files: START_ARTS.map(artFile) }, { tab: t('За подвиги'), title: t('За подвиги'), files: later.map(artFile) }];
  }
  if (which === 'events') {
    const first = EVENTS.map(e => e.key).filter(k => START_EVENTS.includes(k));
    // the rest as they open, one meeting after another, and any that no meeting opens after them
    const met = MEETS.map(m => m.key).filter((k, i, all) => !START_EVENTS.includes(k) && all.indexOf(k) === i);
    const rest = [...met, ...EVENTS.map(e => e.key).filter(k => !first.includes(k) && !met.includes(k))];
    return [{ tab: t('Есть сразу'), title: t('Есть сразу'), files: first.map(eventFile) }, { tab: t('Знакомства'), title: t('Знакомства'), files: rest.map(eventFile) }];
  }
  // the demo: its floor's trinkets and its heroes' lines
  const heroes = heroesByKind().flat().filter(i => !locked(HEROES[i].key));
  return BIOMES.slice(0, FLOORS).map((b, f) => ({ tab: t('Этаж {0}', f + 1), title: t(b.name), files: TRINKETS.filter(it => it.drawn && it.floor === f).map(it => trinketFile(it.key, heroes)) }))
    .filter(g => g.files.length);
}

// ------------------------------------------------------------ the screen

/** Each tab's picture for the bar of an upright phone: a hero's face, an enemy's, a trophy, an event room, a trinket. */
function tabIcons() {
  const src: Record<ColTab, string> = {
    heroes: faceUrl({ i: 0, def: HEROES[0] }), mobs: mobFace('skel'), arts: pic('art_cup'), events: pic('room_event'), trinkets: envArt.get('trinket_soap')?.src ?? '',
  };
  document.querySelectorAll<HTMLElement>('#collection .tab').forEach(b => {
    const ico = b.querySelector<HTMLElement>('.col-ico'), s = src[b.dataset.tab as ColTab];
    if (ico && s && ico.dataset.src !== s) {
      ico.dataset.src = s;
      ico.innerHTML = `<img src="${s}" alt="">`;
    }
  });
}

let groups: Group[] = [];
const filesNow = () => groups.flatMap(g => g.files);

/** Show the tab `which` (the one shown, if none), at the file picked in it before or its first open one. */
export function renderCollection(which: ColTab = tab) {
  if (which !== tab) enter = 'cs-in-pop';
  tab = which;
  document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  });
  tabIcons();
  groups = groupsOf(tab);
  const all = filesNow(), cur = all.find(f => f.key === picked[tab]) ?? all.find(f => f.open) ?? all[0];
  picked[tab] = cur.key;
  const gi = groups.findIndex(g => g.files.includes(cur)), g = groups[gi], n = g.files.length;
  const box = $('colGrid');
  box.innerHTML = `<div class="cs-gtabs">${groups.map((x, i) => `<button type="button" class="cs-gt${i === gi ? ' on' : ''}" data-g="${i}" aria-pressed="${i === gi}">${x.tab}<b>${x.files.filter(f => f.open).length}/${x.files.length}</b></button>`).join('')}</div>`
    + `<div class="cs-desk" data-tab="${tab}"><nav class="cs-list" style="--rows:${Math.ceil(n / 2)};--per:${n > 8 ? Math.ceil(n / 2) : n};--n:${n}" aria-label="${t('Опись · {0}', g.title)}"><h3>${t('Опись · {0}', g.title)}</h3><div class="cs-items">`
    + g.files.map(f => `<button type="button" class="cs-it${f === cur ? ' on' : ''}${f.open ? '' : ' shut'}" data-k="${f.key}" aria-pressed="${f === cur}"${tipAttrs({ h: f.open ? f.name : '???' })}>`
      + `<span class="cs-face" style="--c:${f.col}">${f.face}</span><span class="cs-in"><b>${f.open ? f.name : '???'}</b><small>${f.small}</small></span></button>`).join('')
    + `</div><div class="cs-nav"><button type="button" data-go="-1" aria-label="${t('Предыдущий')}">‹</button><button type="button" data-go="1" aria-label="${t('Следующий')}">›</button></div></nav>`
    + `<article class="cs-sheet ${enter}">${cur.sheet(all.indexOf(cur) + 1)}</article></div>`;
  enter = '';
  fit();
}

/** Go `d` files on through the tab's groups, round from the last to the first. */
function go(d: number) {
  const all = filesNow(), at = all.findIndex(f => f.key === picked[tab]);
  picked[tab] = all[(at + d + all.length) % all.length].key;
  enter = d > 0 ? 'cs-in-next' : 'cs-in-prev';
  renderCollection();
}

/**
 * The sheet doesn't scroll: its words start a little bigger on a roomy screen and shrink step by step until they fit. On
 * a small phone a hero's long footnote goes behind «Подробнее» if they still don't, and only then, on the smallest phones,
 * the rest of the file scrolls inside the sheet.
 */
function fit() {
  requestAnimationFrame(() => {
    const sheet = document.querySelector<HTMLElement>('#colGrid .cs-sheet'), box = sheet?.querySelector<HTMLElement>('.cs-txt');
    if (!sheet?.clientHeight || !box) return;
    const over = () => box.scrollHeight > box.clientHeight + 1;
    const shrink = () => {
      let k = box.clientWidth > 560 ? 1.12 : 1;
      sheet.style.setProperty('--f', k.toFixed(2));
      while (over() && k > 0.72) {
        k -= 0.03;
        sheet.style.setProperty('--f', k.toFixed(2));
      }
      return !over();
    };
    sheet.classList.remove('cs-short', 'cs-scroll');
    if (!shrink() && sheet.querySelector('.cs-foot')) {
      sheet.classList.add('cs-short');
      shrink();
    }
    sheet.classList.toggle('cs-scroll', over());
  });
}
window.addEventListener('resize', () => { if (!$('collection').hidden) fit(); });

/** A photo looked at whole over the screen, or a footnote read on a slip of paper: a tap anywhere, or Esc, puts it back. */
function lookAt(src: string, kind: string, note = '') {
  const lb = document.createElement('div');
  lb.className = `cs-look cs-${kind}`;
  lb.innerHTML = note ? `<p class="cs-note">${note}</p>` : `<img src="${src}" alt="">`;
  const close = () => { lb.remove(); window.removeEventListener('keydown', esc, true); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  lb.addEventListener('click', close);
  window.addEventListener('keydown', esc, true);
  $('collection').append(lb);
}

/** The folder's taps: a group's tab, a file in the list, ‹ ›, a hero's face under a trinket, the photo. */
let swiped = false;
export function bindCollection() {
  const box = $('colGrid');
  box.addEventListener('click', e => {
    if (swiped) { swiped = false; return; }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-g], [data-k], [data-go], [data-say], [data-big], [data-more]');
    if (!el) return;
    if (el.dataset.g) {
      const g = groups[Number(el.dataset.g)];
      if (!g || g.files.some(f => f.key === picked[tab])) return;
      picked[tab] = (g.files.find(f => f.open) ?? g.files[0]).key;
      enter = 'cs-in-pop';
    } else if (el.dataset.k) {
      if (el.dataset.k === picked[tab]) return;
      const all = filesNow();
      enter = all.findIndex(f => f.key === el.dataset.k) > all.findIndex(f => f.key === picked[tab]) ? 'cs-in-next' : 'cs-in-prev';
      picked[tab] = el.dataset.k;
    } else if (el.dataset.go) return go(Number(el.dataset.go));
    else if (el.dataset.say) says[picked[tab]!] = el.dataset.say;
    else if (el.dataset.big) return lookAt(el.dataset.big, el.dataset.kind ?? 'fig');
    else if (el.hasAttribute('data-more')) return lookAt('', 'note', box.querySelector('.cs-foot')?.innerHTML);
    renderCollection();
  });
  box.addEventListener('keydown', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-big]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); lookAt(el.dataset.big!, el.dataset.kind ?? 'fig'); }
  });
  // a swipe across the sheet turns to the next file or back
  let down: { x: number; y: number } | null = null;
  box.addEventListener('pointerdown', e => { down = (e.target as HTMLElement).closest('.cs-sheet') ? { x: e.clientX, y: e.clientY } : null; });
  box.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped = true;
    setTimeout(() => { swiped = false; });
    go(dx < 0 ? 1 : -1);
  });
  window.addEventListener('keydown', e => {
    if ($('collection').hidden || document.querySelector('.cs-look') || (e.target as HTMLElement).closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(e.key === 'ArrowLeft' ? -1 : 1); }
  });
}
