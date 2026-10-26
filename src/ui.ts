// DOM HUD in the corners, so the room keeps the middle of the screen: the top strip (the party, ore, where we are,
// the enemy queue with what each will do, map / journal / menu), my hero's corner (portrait with its statuses, a column of
// discs, health with the shield on it, the sparks under it and the ability gem) and one big button for the turn.

import { AB_COST, CRIT, E_MAX, ENEMY_BASE, FROST_STEPS, GAS_WEAK, HAND_MAX, HAND_START, MOBS, ROOM_TYPES, UPS, UP_COST, frostVuln, fullHit, gasDmg, isRanged, stepOf, type MobKind, type RoomType, type StatKey } from './data';
import { envArt, eventArt, sprites, uiArt } from './assets';
import { FOOD_TOSS, ZONE_COL, type Game, type HeroState } from './game';
import type { Mob, RoomSpec } from './room';
import { BET_TURNS } from './events';
import { BASE_TH, drawBase, drawHeroFigure, drawMiniature, drawMobFigure } from './draw/figures';
import type { StandMat } from './stands';
import { lg } from './draw/util';
import { art, artIcon, fillIcons, icon } from './icons';
import { SOCKETS, artDef } from './artifacts';
import { hl } from './hl';
import { DEMO } from './demo';
import { OreCounters } from './orefx';
import { M, t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Small picture of a mob's miniature, drawn once per kind (and again once its art loads). */
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

/** A hero's stand on its own, in its material and the hero's colour, for the hero's card and the run's album. */
const standIcons = new Map<string, string>();
export function standIcon(mat: StandMat, col: string) {
  let url = standIcons.get(mat + col);
  if (!url) {
    // drawn twice the size it shows at (56 × 36), the stand's bottom face centred low
    const cv = document.createElement('canvas'), c = cv.getContext('2d')!, R = 9.4, s = 104 / (R * 2.54);
    cv.width = 112;
    cv.height = 72;
    c.setTransform(s, 0, 0, s, cv.width / 2, cv.height - 3 - R * 0.64 * s);
    drawBase(c, 0, 0, R, col, undefined, mat);
    url = cv.toDataURL();
    standIcons.set(mat + col, url);
  }
  return url;
}

/** A mob's head and shoulders on red for the round queue icons: the top of its picture, or the whole miniature until art loads. */
const mobFaces = new Map<string, string>();
/** Where across its picture a mob's face is, when not in the middle (the last two rats of the swarm stand side by side). */
const FACE_X: Partial<Record<MobKind, number>> = { ratswarm3: 0.25 };
export function mobFace(k: MobKind) {
  const sp = sprites.get(k);
  if (!sp) return mobIcon(k);
  let url = mobFaces.get(k);
  if (!url) {
    const cv = document.createElement('canvas'), n = 96, c = cv.getContext('2d')!;
    cv.width = cv.height = n;
    c.fillStyle = lg(c, 0, 0, 0, n, '#c9474f', '#6e1a22');
    c.fillRect(0, 0, n, n);
    const iw = sp.img.naturalWidth, ih = sp.img.naturalHeight, side = Math.min(iw, ih * 0.62);
    c.drawImage(sp.img, Math.max(0, Math.min(iw - side, iw * (FACE_X[k] ?? 0.5) - side / 2)), 0, side, side, 4, 8, n - 8, n - 8);
    url = cv.toDataURL();
    mobFaces.set(k, url);
  }
  return url;
}

/** A hero's face as a picture, drawn once per hero (and again once its art loads): for the map and the turn button. */
const faces = new Map<string, string>();
export function faceUrl(h: Pick<HeroState, 'i' | 'def'>) {
  const key = h.def.key + (sprites.has(h.def.key) ? '+img' : '');
  let url = faces.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    drawPortrait(cv, h);
    url = cv.toDataURL();
    faces.set(key, url);
  }
  return url;
}

/** A hero's bust as a dark shape only: the demo's way of showing the full game's heroes (src/demo.ts). */
export function drawShadow(cv: HTMLCanvasElement, h: Pick<HeroState, 'i' | 'def'>) {
  drawPortrait(cv, h);
  const c = cv.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#1c130d';
  c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
}

/** The dark shape as a picture, drawn once per hero like its face. */
export function shadowUrl(h: Pick<HeroState, 'i' | 'def'>) {
  const key = h.def.key + (sprites.has(h.def.key) ? '+img' : '') + '+shadow';
  let url = faces.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    drawShadow(cv, h);
    url = cv.toDataURL();
    faces.set(key, url);
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
  // on the cardboard (pf_board, its print coloured by style.css) the canvas draws the hero alone
  if (!uiArt.has('pf_board') || !uiArt.has('pf_ink')) {
    c.fillStyle = lg(c, 0, 0, 0, size, h.def.col, h.def.dk);
    c.fillRect(0, 0, size, size);
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.fillRect(0, 70, size, 26);
  }
  const sp = sprites.get(h.def.key);
  if (sp) {
    // the upper ~60% of the figure, scaled to fill the frame; a figure narrower than that (Вешалка) keeps its build and
    // stands in the middle instead of being stretched to the frame's width
    const iw = sp.img.naturalWidth, ih = sp.img.naturalHeight, sh = ih * 0.6, sw = Math.min(iw, sh);
    const dh = size - 6, dw = Math.min(size - 8, (sw * dh) / sh);
    c.drawImage(sp.img, (iw - sw) / 2, 0, sw, sh, (size - dw) / 2, 6, dw, dh);
  } else {
    drawHeroFigure(c, h.i, 48, 136, 3.1, false, 0);
  }
}

/** Each upgrade's picture in public/assets/ui: more discs, damage, speed, bounce. */
const UP_ART: Record<string, string> = { n: 'up_discs', m: 'up_dmg', pw: 'up_speed', e: 'up_bounce' };

const pips = (n: number, lv: number) => `<span class="lvl">${Array.from({ length: n }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`;

/**
 * A hero's disc upgrades on the hero card, one row each: level pips and where the stat stands. Each says what it does
 * in a line under the name (the phone pop-up) or a tooltip (the desktop).
 */
function upRows(g: Game, h: HeroState) {
  const row = (k: string, name: string, txt: string, n: number, lv: number, val: string, tip: string[]) =>
    `<div class="up" title="${tip.filter(Boolean).join(' ')}">${art(UP_ART[k], 'up-ico')}<span class="up-name">${t(name)}</span>`
    + `${pips(n, lv)}<b>${val}</b><small class="up-txt">${t(txt)}</small></div>`;
  const dc = g.discCost(h), discTxt = 'Больше бросков за ход. Самое сильное улучшение';
  return row('n', 'Диски за ход', discTxt, HAND_MAX - HAND_START, h.discs - HAND_START, String(g.handOf(h)),
    [`${t(discTxt)}.`, dc ? t('Следующий диск у кузнеца за {0} руды.', dc) : t('Больше двух кузнец не продаёт, третий диск даёт только трофей «Третья рука».')])
    + UPS.map(u => {
      const lv = h.up[u.k], cost = g.upCost(h, u.k), v = g.stat(h, u.k);
      return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v),
        [`${t(u.txt)}.`, u.now?.(v) ?? '', cost ? t('Следующий уровень у кузнеца за {0} руды.', cost) : t('Больше не прокачать.')]);
    }).join('');
}

/** The smithy's scene in the blacksmith's window. */
const forgeTxt = (ore: number) => ore
  ? t('Гном-кузнец закаляет раскалённый диск прямо в унитазе: шипит, парит, пахнет сталью и чем-то ещё. На радостях он отсыпает отряду {0} руды, остальное за плату.', ore)
  : t('Гном-кузнец закаляет раскалённый диск прямо в унитазе: шипит, парит, пахнет сталью и чем-то ещё. Руды он сегодня не дарит: самому мало, так что всё за плату.');

/**
 * The blacksmith's slab for each of a hero's upgrades: what it is, its level, where the stat goes with the next level,
 * and the price in the party's ore. A slab the ore does not cover, or a stat at its top, is shut.
 */
function forgeRows(g: Game, h: HeroState, team: boolean) {
  // a stat level an elite owes the hero costs nothing; in the sharpening window that is all there is
  const free = g.freeUp(h);
  const row = (k: string, name: string, txt: string, n: number, lv: number, now: string, next: string, cost: number, gratis = false) => {
    const sold = !g.whet || gratis, short = !gratis && cost > g.bank.ore;
    return `<button class="ev-opt fg-up" data-k="${k}" title="${t(txt)}"${cost && sold && !short ? '' : ' disabled'}>`
      + `<i data-art="${UP_ART[k]}" aria-hidden="true"></i><span class="fg-name"><b>${t(name)}</b>${pips(n, lv)}</span>`
      + `<span class="fg-fx">${cost ? `${now}<i>→</i>${next}` : t('{0}, больше некуда', now)}</span>`
      + (!cost || !sold ? '' : gratis ? `<span class="fg-cost free">${t('даром')}</span>` : `<span class="fg-cost${short ? ' short' : ''}">${cost}${icon('ore')}</span>`) + '</button>';
  };
  // alone with a party the window serves every hero: a tab with each face, the shown one lit, a free level marked on its tab
  const head = team
    ? `<div class="fg-team">${g.party.map(o => `<button class="fg-tab${o === h ? ' on' : ''}" data-hero="${o.i}" style="--c:${o.def.col}" aria-pressed="${o === h}">`
      + `<img src="${faceUrl(o)}" alt=""><b>${t(o.def.name)}</b>${g.freeUp(o) ? `<em>${t('даром')}</em>` : ''}</button>`).join('')}</div>`
    : `<div class="fg-me"><img src="${faceUrl(h)}" alt=""><b>${t(h.def.name)}</b><span>${h.hp > 0 ? `${h.hp}/${h.max} HP` : t('пал')}</span></div>`;
  return head
    + (g.whet ? '' : row('n', 'Диски за ход', 'Больше бросков за ход. Самое сильное улучшение', HAND_MAX - HAND_START, h.discs - HAND_START, String(g.handOf(h)), String(g.handOf(h) + 1), g.discCost(h)))
    + UPS.map(u => {
      const lv = h.up[u.k], v = g.stat(h, u.k), next = u.k === 'e' ? Math.min(E_MAX, v + stepOf(h.def, 'e')) : v;
      return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v), u.fmt((lv + 1) * u.step, next), g.upCost(h, u.k), free);
    }).join('');
}

/** The sharpening window's scene after an elite: the hero still owed a level picks it, then it is done. */
const whetTxt = (free: boolean) => free
  ? t('Гном-кузнец прибежал на грохот боя с элитой и бесплатно точит каждому один диск. Выбери, что подтянуть.')
  : t('Диск заточен. Гном уже ворчит, что дальше только за руду.');

/** Whose turn it is, as the HUD tells it: the heroes throw (and the discs settle), then the enemies go. */
export type Side = 'place' | 'heroes' | 'enemies' | 'over';

/** One status as a little icon with a number: on the portrait for heroes, on the card for enemies. */
interface Status { k: string; n?: number; t: string }
const statusHtml = (list: Status[]) => list.map(s => `<i class="st st-${s.k}" title="${t(s.t)}">${icon(s.k)}${s.n ? `<b>${s.n}</b>` : ''}</i>`).join('');

/** The turn button's job right now. */
type TurnAct = 'fight' | 'end' | 'cancel' | 'none';

/** What an event left the fight, a word each in the top bar and a line in its tooltip. */
const CHIPS: { on: (s: RoomSpec) => boolean; name: string; txt: string; ico?: string }[] = [
  { on: s => !!s.smoke, name: 'дым-машина', txt: 'Дым-машина: видно только вокруг героев.' },
  { on: s => !!s.strobe, name: 'стробоскоп', txt: 'Стробоскоп: нет линии прицела.' },
  { on: s => s.ground === 'slick', name: 'пена на дисках', ico: 'ico_slick', txt: 'Пена на дисках: они не теряют скорость о стены.' },
  { on: s => s.ground === 'soap', name: 'мыльный пол', ico: 'ico_soap', txt: 'Мыльный пол: диски катятся вдвое дальше.' },
  { on: s => s.ground === 'sticky', name: 'липкий пол', ico: 'ico_sticky', txt: 'Липкий пол: диски тормозят быстрее.' },
  { on: s => s.bet === 'art', name: 'пари: без царапины', ico: 'ico_bet', txt: 'Пари с букмекером: победа без царапины даст каждому трофей, иначе каждый потеряет свой.' },
  { on: s => s.bet === 'up', name: M('пари: за {0} {0|ход|хода|ходов}', BET_TURNS), ico: 'ico_bet', txt: M('Пари с букмекером: победа за {0} {0|ход|хода|ходов} даст каждому уровень, иначе каждый потеряет уровень.', BET_TURNS) },
  { on: s => !!s.extra, name: '+1 диск', txt: 'Краденые шайбы: в этом бою каждый бросает на диск больше.' },
];

export class Hud {
  private lastPortrait = '';
  /** Whose turn the HUD showed last, so a change of turn gets its banner; in the ore cave every new turn gets one. */
  private side: Side | null = null;
  private bannerTurn = 0;
  /** The blacksmith's slabs as last drawn, so a refresh that changes nothing leaves the buttons under the finger alone. */
  private forgeHtml = '';
  /** The blacksmith's (by depth) this player is done at and left for the map, while the others may still be buying. */
  private forgeLeft = 0;
  /** Mobs (by index) and their art the queue was built for; it is rebuilt only when that changes, so hovers survive refreshes. */
  private queueKey = '';
  /** The enemy whose card is open, and whether a tap pinned it (a hover card goes when the pointer leaves). */
  private card = -1;
  private pinned = false;
  /** The map room whose window main.ts put up (an event, the camp). */
  private win: { floor: number; type: RoomType } | null = null;
  /** The hero (by index) whose card a tap on its face on the strip opened. */
  private peek = -1;
  /** The trophy socket whose hint is up, by its place, and whether a tap pinned it (a hover hint goes with the pointer). */
  private tip = -1;
  private tipPinned = false;
  /** How many times each hero's trophies had gone off when last looked at (Game.pop): a count that grows flashes the token. */
  private popSeen = new Map<number, Record<string, number>>();
  /** Online: the name of the player whose hero this is. */
  nameOf: (i: number) => string | null = () => null;
  /** This screen's own hero: the one the blacksmith's window sells upgrades for (online not the ones the host stands in for). */
  me: () => HeroState | null = () => this.g.party[0] ?? null;
  /** Alone with a party: the hero (by index) whose tab is open in the blacksmith's window, at the visit `forgeAt`. */
  private forgeFor = -1;
  private forgeAt = '';
  /** The ore counters, playing a change at the blacksmith's; the ore they were last given, at which visit ('' elsewhere), over which room. */
  private counters = new OreCounters(() => [$('forgeOre'), $('hOre')]);
  private oreWas = -1;
  private oreAt = '';
  private oreRoom = '';
  /** Each hero's discs and stat levels when the ore was last looked at, to tell who has just bought something with it. */
  private levels = new Map<number, number[]>();
  /** The first press of «Конец хода» with discs still in hand only asks «ТОЧНО?»; a second press within a moment ends. */
  private confirmUntil = 0;
  private act: TurnAct = 'none';
  /** Whose faces the turn button shows now, so it is redrawn only when that changes. */
  private whoKey = '';
  /** Journal lines already seen, so the scroll button says when there are new ones. */
  private logSeen = 0;

  /** The blacksmith's screen is up on this screen. */
  get atForge() { return this.g.forge > 0 && this.g.forge !== this.forgeLeft; }

  /**
   * The window up over the room (an event, the camp, the blacksmith's): the strip stays in sight over it and speaks of
   * that room, not the room behind. The sharpening after an elite is that elite room's own.
   */
  private get at() {
    const S = this.g.S;
    return this.atForge ? { floor: S.spec.floor, type: this.g.whet ? S.spec.type : 'forge' as RoomType } : this.win;
  }

  /** This screen is done at the blacksmith's; `false` (a saved campaign coming back) has his window up again. */
  leaveForge(left = true) {
    this.forgeLeft = left ? this.g.forge : 0;
    // the strip takes off the window's dress with it
    this.refresh();
  }

  constructor(private g: Game) {
    fillIcons();
    // the strip's height for the boss's bar under it: upright the strip grows a second row
    const top = $('hudTop');
    new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px')).observe(top);
    $('abBtn').addEventListener('click', () => g.useAbility());
    $('turnBtn').addEventListener('click', () => this.pressTurn());
    $('pfBtn').addEventListener('click', e => { e.stopPropagation(); this.toggleCard(); });
    $('btnLog').addEventListener('click', e => { e.stopPropagation(); this.toggleLog(); });
    $('forgeMine').addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-hero]');
      if (t) { this.forgeFor = Number(t.dataset.hero); this.forge(); return; }
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]'), h = this.forgeHero();
      if (!b || b.disabled || !h) return;
      if (b.dataset.k === 'n') g.buyDisc(h);
      else g.upgrade(b.dataset.k as StatKey, h);
      // sharpening for a party: once a hero has taken its free level, the next one still owed one comes up
      if (this.forgeTeam() && g.whet && !g.freeUp(h)) {
        const next = g.party.find(o => g.freeUp(o));
        if (next) { this.forgeFor = next.i; this.forge(); }
      }
    });

    // the enemy queue: hover shows a mob's card and rings its figure; a tap pins the card until the next tap elsewhere
    const q = $('queue'), at = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('li[data-m]');
    q.addEventListener('pointerover', e => { const li = at(e); if (li && !this.pinned) this.openCard(Number(li.dataset.m)); });
    q.addEventListener('pointerleave', () => { if (!this.pinned) this.closeCard(); });
    q.addEventListener('focusin', e => { const li = at(e); if (li) this.openCard(Number(li.dataset.m)); });
    q.addEventListener('focusout', () => { if (!this.pinned) this.closeCard(); });
    q.addEventListener('click', e => {
      const li = at(e);
      if (!li) return;
      e.stopPropagation();
      const i = Number(li.dataset.m);
      if (this.pinned && this.card === i) { this.pinned = false; this.closeCard(); } else { this.pinned = true; this.openCard(i); }
    });
    // the trophies under the discs: hover shows a hint with the mouse, a tap pins it until the next tap elsewhere
    const arts = $('fArts'), sock = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.sock');
    arts.addEventListener('pointerover', e => { const b = sock(e); if (b && e.pointerType === 'mouse' && !this.tipPinned) this.openTip(Number(b.dataset.k)); });
    arts.addEventListener('pointerleave', () => { if (!this.tipPinned) this.closeTip(); });
    arts.addEventListener('click', e => {
      const b = sock(e);
      if (!b) return;
      e.stopPropagation();
      const k = Number(b.dataset.k);
      if (this.tipPinned && this.tip === k) { this.tipPinned = false; this.closeTip(); } else { this.tipPinned = true; this.toggleCard(false); this.openTip(k); }
    });
    document.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (this.pinned && !t.closest('#mobCard')) { this.pinned = false; this.closeCard(); }
      if (this.tipPinned && !t.closest('#artTip')) { this.tipPinned = false; this.closeTip(); }
      if (!t.closest('#logPanel')) this.toggleLog(false);
      if (!t.closest('#ups')) this.toggleCard(false);
      if (!t.closest('#heroPeek')) this.closeHero();
    });
  }

  /**
   * A map room's window opens (an event, the camp) or closes, with null: over it the strip keeps the party's faces with
   * their health and the ore, names that room instead of the room behind, and a tap on a face opens that hero's card.
   * The blacksmith's window does the same by itself (refresh).
   */
  setWindow(at: { floor: number; type: RoomType } | null) {
    if (at?.floor === this.win?.floor && at?.type === this.win?.type) return;
    this.win = at;
    if (this.g.S) this.refresh();
    else this.liftStrip();
  }

  /** The strip takes on or leaves the window's dress as a window opens or closes. */
  private liftStrip() {
    const up = !!(this.g.S && this.at), root = document.documentElement;
    if (root.classList.contains('at-window') === up) return;
    root.classList.toggle('at-window', up);
    if (!up) this.closeHero();
    this.tipPinned = false;
    this.closeTip();
  }

  /** The big band across the room for a moment when the turn passes: "Ваш ход", "Ход врагов". */
  private banner(title: string, sub: string, side: Side) {
    const b = $('turnBanner');
    b.querySelector('b')!.textContent = title;
    b.querySelector('span')!.textContent = sub;
    b.className = 'turn-banner ' + side;
    // restart the animation even if the last banner is still on screen
    void b.offsetWidth;
    b.classList.add('show');
  }

  /** The language changed: what the HUD keeps drawn until the game changes is drawn again in it. */
  relang() {
    this.queueKey = this.whoKey = '';
    delete $('fArts').dataset.k;
    this.buildAllies();
    this.refresh();
  }

  /** The party's heads in the top strip: health under each, a tick once that player has ended the turn. */
  buildAllies() {
    const box = $('allies');
    box.innerHTML = '';
    for (const h of this.g.party) {
      const b = document.createElement('button');
      b.className = 'head';
      b.id = 'ally' + h.i;
      b.style.setProperty('--c', h.def.col);
      b.setAttribute('aria-label', t(h.def.name));
      b.innerHTML = `<canvas></canvas><b class="who"></b><span class="a-hp"><i></i><s></s><em></em></span><span class="tick">${icon('check')}</span><span class="off">${icon('plug')}</span>`;
      drawPortrait(b.querySelector('canvas')!, h);
      // a face opens its hero's card, with the trophies on it (Vladislav: the allies' trophies are seen there); only in a
      // fight a face of another hero this screen plays (the host's for players who left) picks it to throw with instead
      b.addEventListener('click', e => {
        if (!this.at && h !== this.g.hero && this.g.canControl(h)) { this.g.select(h.i); return; }
        e.stopPropagation();
        if (this.peek === h.i) this.closeHero(); else this.openHero(h.i);
      });
      box.appendChild(b);
    }
    this.lastPortrait = '';
    fillIcons();
  }

  refresh() {
    const g = this.g, S = g.S;
    fillIcons();
    this.liftStrip();
    // the floor is laid out after the room's name (style.css): where the strip is narrow the floor gives way, never the room
    $('locName').innerHTML = S.spec.tut && !this.at ? `<span>${t('Разминка')}</span>`
      : `<span class="fl">${t('Этаж {0}', (this.at?.floor ?? S.spec.floor) + 1)} · </span><span>${t(ROOM_TYPES[this.at?.type ?? S.spec.type].name)}</span>`;
    // the ore cave counts its turns down: «Ход 2 из 3»
    const max = g.turnsMax(), last = max > 0 && S.turn >= max;
    $('hTurn').textContent = S.phase === 'place' ? t('Расстановка') : max ? t('Ход {0} из {1}', S.turn, max) : t('Ход {0}', S.turn);
    // enemies grow angrier every turn once a fight drags on; warn a turn ahead
    const rage = $('hRage'), fighting = S.phase !== 'place' && S.phase !== 'over' && !g.cave(), soon = g.rageFrom() - S.turn;
    rage.hidden = !fighting || (g.rage() === 0 && soon > 1);
    rage.classList.toggle('soon', g.rage() === 0);
    rage.textContent = g.rage() ? t('ярость +{0}', g.rage()) : t('ярость со след. хода');
    rage.title = t('С {0}-го хода каждый враг с каждым ходом бьёт на 1 сильнее.', g.rageFrom());
    // an event's curse on this fight
    // and what else an event left this fight: the foam party's floor, the bookie's bet, a disc more
    const curse = $('hCurse'), on = CHIPS.filter(c => c.on(S.spec));
    curse.hidden = !on.length || S.phase === 'over';
    const chips = on.map(c => (c.ico ? art(c.ico, 'chip') : '') + t(c.name)).join(' · ');
    if (curse.dataset.k !== chips) { curse.dataset.k = chips; curse.innerHTML = chips; }
    curse.title = on.map(c => t(c.txt)).join(' ');

    // in the ore cave nobody moves against the party: the heroes hop to their discs and throw again
    const side: Side = S.phase === 'place' || S.phase === 'over' ? S.phase : S.phase === 'enemy' || (S.phase === 'resolve' && !g.cave()) ? 'enemies' : 'heroes';
    const sd = $('hSide');
    sd.className = 'side ' + side;
    sd.textContent = {
      place: () => (max ? t('{0} {0|ход|хода|ходов}', max) : ''),
      heroes: () => (last ? t('последний ход') : t('ваш ход')),
      enemies: () => t('ход врагов'),
      over: () => (!g.alive().length ? (g.party.length > 1 ? t('отряд пал') : t('герой пал')) : g.cave() ? t('пещера пройдена') : t('победа')),
    }[side]();
    document.body.dataset.turn = side;
    if (this.side !== side || (g.cave() && side === 'heroes' && this.bannerTurn !== S.turn)) {
      // the fight starts or the turn passes to the other side: a banner across the room says so
      if (this.side && (side === 'heroes' || side === 'enemies')) {
        const sub = !max ? t('Ход {0} · бросайте диски', S.turn) : last ? t('Последний ход · бросайте диски') : t('Ход {0} из {1} · бросайте диски', S.turn, max);
        this.banner(side === 'heroes' ? t('Ваш ход') : t('Ход врагов'), side === 'heroes' ? sub : t('враги ходят по очереди'), side);
      }
      this.side = side;
      this.bannerTurn = S.turn;
    }

    this.heads();
    this.queue();
    this.boss();
    this.corner();
    this.trophies();
    this.turnButton();
    this.log();
    if (this.card >= 0) this.openCard(this.card);
    if (!$('ups').hidden) this.fillCard();
    if (this.peek >= 0) this.openHero(this.peek);
    this.forge();
    this.ore();
  }

  // ------------------------------------------------------------ top strip

  private heads() {
    // over an event or the camp the room behind has nothing to say: no blows coming, nobody ready or done
    const g = this.g, S = g.S, ev = !!this.at;
    for (const o of g.party) {
      const el = $<HTMLButtonElement>('ally' + o.i);
      if (!el) continue;
      el.classList.toggle('me', o === g.hero);
      el.classList.toggle('dead', o.hp <= 0);
      // online: the player's name on their hero, greyed with a pulled plug while they are disconnected
      const who = this.nameOf(o.i), away = !g.here(o);
      el.querySelector('.who')!.textContent = who ?? '';
      el.classList.toggle('away', away);
      const tot = Math.max(o.max, o.hp + o.shield), inc = ev ? 0 : g.incoming(o);
      const hpPct = (Math.max(0, o.hp) / tot) * 100, risk = (Math.min(inc, Math.max(0, o.hp)) / tot) * 100;
      (el.querySelector('.a-hp i') as HTMLElement).style.width = hpPct + '%';
      const sh = el.querySelector('.a-hp s') as HTMLElement;
      sh.style.left = hpPct + '%';
      sh.style.width = (o.shield / tot) * 100 + '%';
      const em = el.querySelector('.a-hp em') as HTMLElement;
      em.style.left = hpPct - risk + '%';
      em.style.width = risk + '%';
      el.classList.toggle('lethal', o.hp > 0 && inc >= o.hp);
      // a tick: placed and ready (online placement), or done with the turn
      const done = !ev && (S.phase === 'place' ? g.online && S.ready.includes(o.i) : S.phase === 'throw' && g.ended(o));
      el.classList.toggle('done', done);
      el.title = [who, `${t(o.def.name)}: ${Math.max(0, o.hp)}/${o.max}`, o.shield ? t('щит {0}', o.shield) : '',
        o.hp <= 0 ? t('пал') : done ? (S.phase === 'place' ? t('готов') : t('закончил ход')) : ''].filter(Boolean).join(', ')
        + (away ? `. ${t('Нет связи: пока играет хозяин комнаты, ход его не ждёт')}` : '');
    }
  }

  /**
   * What an enemy's badge on its queue icon says; the same in words for its card. A shooter fires only at a hero it sees,
   * so its words say whether it fires from where it stands, steps out to fire or is still walking to where it sees the hero.
   */
  private intent(m: Mob): { badge: string; txt: string } {
    const g = this.g, it = m.intent, d = MOBS[m.k];
    if (!it || it.t === 'idle') return { badge: '', txt: d.dummy ? t('Стоит столбом и ждёт, когда стукнут') : t('Ничего не делает') };
    // frozen stiff, whatever it meant to do
    if (g.frozen(m) && !g.acted(m)) return { badge: `<span class="ib sp">${icon('chill')}</span>`, txt: t('{0?Заморожена|Заморожен}: пропустит ход', d.fem) };
    const tgt = it.hero >= 0 ? g.heroOf(it.hero) : null, far = isRanged(m.k), bomb = !!d.charge;
    // a shooter's blow and its walk to where it sees the hero carry a bow by the badge
    const acc = tgt?.def.acc ?? '', out = far && !!it.way && it.way.length > 1, bow = far ? icon('bow', 'qbow') : '';
    // its blow at another enemy, the name of that one put in lower case
    const atMob = (who: string) => {
      const how = !far ? t('ударит {0:l} на {1}', who, it.dmg) : bomb ? t('бросит бомбу в {0:l} на {1}', who, it.dmg) : t('выстрелит в {0:l} на {1}', who, it.dmg);
      return out ? t('выйдет на линию огня и {0}', how) : how;
    };
    // kissed by the model: it goes for another enemy, or sighs with nobody left to go for
    if (it.sigh) return { badge: `<span class="ib sp">${icon('kiss')}</span>`, txt: t('Поцелован: вздыхает и никого не ударит') };
    // going for an enemy the model has kissed, as it would for a hero
    if (it.foe !== undefined && m.kiss === undefined && it.t !== 'charge') {
      const o = MOBS[g.S.mobs[it.foe].k];
      if (it.t === 'hit') return { badge: `${bow}<span class="ib hit" style="--c:#ff5a8a">${it.dmg}</span>`, txt: cap(t('{0}: {1?та поцелована|тот поцелован} Вешалкой, броня считается', atMob(o.acc), o.fem)) };
      return {
        badge: `${bow}<span class="ib go" style="--c:#ff5a8a">${it.eta ?? icon('move')}</span>`,
        txt: far ? t('Идёт стрелять в {0:l}: {1?та поцелована|тот поцелован} Вешалкой', o.acc, o.fem) : t('Идёт бить {0:l}: {1?та поцелована|тот поцелован} Вешалкой', o.acc, o.fem),
      };
    }
    if (it.foe !== undefined && m.kiss !== undefined) {
      const o = g.S.mobs[it.foe], who = MOBS[o.k].acc, kiss = icon('kiss', 'qbow');
      if (it.t === 'hit') return { badge: `${kiss}<span class="ib hit" style="--c:#ff5a8a">${it.dmg}</span>`, txt: t('Поцелован: {0}, броня считается', atMob(who)) };
      return {
        badge: `${kiss}<span class="ib go" style="--c:#ff5a8a">${it.eta ?? icon('move')}</span>`,
        txt: far ? t('Поцелован: идёт стрелять в {0:l}, героев не тронет', who) : t('Поцелован: идёт бить {0:l}, героев не тронет', who),
      };
    }
    if (it.t === 'hit') {
      const how = !far ? t('ударит {0} на {1}', acc, it.dmg) : bomb ? t('бросит бомбу в {0} на {1}', acc, it.dmg) : t('выстрелит в {0} на {1}', acc, it.dmg);
      const line = cap(out ? t('выйдет на линию огня и {0}', how) : how);
      return { badge: `${bow}<span class="ib hit" style="--c:${tgt!.def.col}">${it.dmg}</span>`, txt: g.executes(m) ? t('Казнь: {0}', line) : line };
    }
    if (it.t === 'rise' && m.k === 'egg') {
      return { badge: `<span class="ib go">${it.eta}</span>`, txt: (it.eta ?? 1) > 1 ? t('Через {0} {0|ход|хода|ходов} вылупится бес-кочегар, если не разбить яйцо', it.eta!) : t('В этот ход вылупится бес-кочегар, если не разбить яйцо') };
    }
    if (it.t === 'rise') {
      const who = MOBS[m.hold ?? 'skel'].name;
      return { badge: `<span class="ib go">${it.eta}</span>`, txt: (it.eta ?? 1) > 1 ? t('Через {0} {0|ход|хода|ходов} встанет {1:l}, если не разбить гроб', it.eta!, who) : t('В этот ход встанет {0:l}, если не разбить гроб', who) };
    }
    if (it.t === 'smash') return { badge: `<span class="ib hit" style="--c:#d9434f">${it.dmg}</span>`, txt: t('Ударит молотом по красному квадрату на {0}: уходи оттуда броском', it.dmg) };
    // the floor bosses' marked cells, coloured by what they do
    if (it.t === 'zone' || it.t === 'emerge') {
      const z = it.t === 'emerge' ? 'bite' : it.z ?? 'cold', n = it.dmg;
      const txt = {
        bite: () => t('Вылезет из норы у ямы с глазами и укусит всех на красных клетках вокруг на {0}. Диск в яму с глазами бьёт вдвое', n),
        cold: () => t('Морозилка: кто останется в голубом конусе, получит удар на {0} и примёрзнет. Следующий ход бросает слабее и не переходит к диску', n),
        dance: () => t('Танцпол: на бит ударит всех на розовых клетках на {0}. Встань на тёмную', n),
        beam: () => t('Светомузыка: лучи по жёлтым клеткам через всю комнату, на {0}', n),
        roll: () => t('Покатится по оранжевой дорожке и задавит всех на ней на {0}', n),
        fire: () => t('Отрыжка: кто останется на огненной линии, получит удар на {0} и загорится', n),
        crown: () => t('Корона-бумеранг: полетит по золотой дорожке, дважды отскочит и ударит всех на ней на {0}', n),
        wall: () => t('Ледяная стена: на голубых клетках вырастут сосульки'),
        draft: () => t('Сквозняк: кого видит на бледно-голубых клетках, протащит к себе на 2 клетки, а кто окажется вплотную, получит дверцей на {0}', n),
        cast: () => t('Литьё: кто останется на оранжевой линии, получит удар на {0}, а линия станет лавой до конца боя', n),
      }[z]();
      return { badge: n ? `<span class="ib hit" style="--c:${ZONE_COL[z]}">${n}</span>` : `<span class="ib sp">${icon(z === 'fire' ? 'fire' : 'chill')}</span>`, txt };
    }
    if (it.t === 'dive') return { badge: `<span class="ib sp">${icon('move')}</span>`, txt: t('Нырнёт в нору, а в следующий ход вылезет у ямы с глазами и укусит всех вокруг') };
    if (it.t === 'brew') return { badge: `<span class="ib sp">${icon('rage')}</span>`, txt: t('Подогрев: шестёрки бьют сильнее и держат больше') };
    if (it.t === 'toss') {
      const f = FOOD_TOSS[it.item ?? 0];
      if (!it.dmg) return { badge: `<span class="ib sp">${icon('daze')}</span>`, txt: t('Наденет {0} на голову {1}: следующий ход без линии прицела', tgt!.def.dat, f.acc) };
      return { badge: `<span class="ib hit" style="--c:${tgt!.def.col}">${it.dmg}</span>`, txt: f.chill ? t('Швырнёт {0} в {1} на {2}, морозит', f.acc, acc, it.dmg) : t('Швырнёт {0} в {1} на {2}', f.acc, acc, it.dmg) };
    }
    // a шестёрка goes to take the charges of the mushrooms or the crystal
    if (it.loot !== undefined) return { badge: `<span class="ib sp">${icon('move')}</span>`, txt: g.S.nodes[it.loot]?.k === 'herb' ? t('Шмон: идёт отжать грибы') : t('Шмон: идёт отжать искры у кристалла') };
    // the swarm's last rats run, the dancer moonwalks off
    if (it.flee) return { badge: `<span class="ib sp">${icon('move')}</span>`, txt: d.moon ? t('Лунной походкой уходит от героя рядом') : t('Удирает от героев') };
    // drawn by the kid's firecracker: it runs to the noise and strikes nobody this turn
    if (it.bang) {
      return {
        badge: `<span class="ib sp">${icon('petard')}</span>`,
        txt: !far ? t('Бежит на треск петарды и в этот ход никого не ударит') : bomb ? t('Бежит на треск петарды и в этот ход не бросит бомбу') : t('Бежит на треск петарды и в этот ход не выстрелит'),
      };
    }
    // the dragon on its eggs never leaves them: it waits for a hero to come right up
    if (it.t === 'move' && !far && m.speed <= 0) {
      return {
        badge: `<span class="ib go" style="--c:${tgt!.def.col}">${icon('move')}</span>`,
        txt: d.nest ? t('Сидит на яйцах: ударит только того, кто подойдёт вплотную') : t('Стоит на месте: ударит только того, кто подойдёт вплотную'),
      };
    }
    if (it.t === 'move') {
      const txt = !far ? (it.eta ? t('Идёт к {0}, ударит через {1} {1|ход|хода|ходов}', tgt!.def.dat, it.eta) : t('Идёт к {0}', tgt!.def.dat))
        : !it.way ? t('Не видит {0}', acc)
        : it.eta && !bomb ? t('Не видит {0}: идёт на линию огня, выстрелит через {1} {1|ход|хода|ходов}', acc, it.eta) : t('Не видит {0}: идёт на линию огня', acc);
      return { badge: `${bow}<span class="ib go" style="--c:${tgt!.def.col}">${it.eta ?? icon('move')}</span>`, txt };
    }
    if (it.t === 'slam') {
      const cols = g.alive().map(o => o.def.col), n = cols.length;
      const pie = cols.map((c, k) => `${c} ${(k / n) * 360}deg ${((k + 1) / n) * 360}deg`).join(',');
      return { badge: `<span class="ib all" style="--pie:conic-gradient(${pie})">${it.dmg}</span>`, txt: it.chill ? t('Метель по всем на {0}, морозит', it.dmg) : t('Удар по всем на {0}', it.dmg) };
    }
    const sp = {
      charge: () => ['fuse', out ? t('Поджигает фитиль и идёт на линию огня: в следующий ход бомба на двойной урон') : t('Поджигает фитиль: в следующий ход бомба на двойной урон')],
      heal: () => ['heal', t('Лечит союзника на {0}', it.dmg)],
      summon: () => ['summon', t('Призывает подмогу на светящийся круг')],
      heat: () => ['heat', t('Раскаляет пол: отмеченные клетки станут лавой')],
      scream: () => ['daze', t('Визг: в следующий ход у всего отряда нет линии прицела')],
    }[it.t as 'charge']?.();
    return sp ? { badge: `<span class="ib sp">${icon(sp[0])}</span>`, txt: sp[1] } : { badge: '', txt: '' };
  }

  private mobStatus(m: Mob): Status[] {
    const g = this.g, out: Status[] = [];
    if (m.burn > 0) out.push({ k: 'fire', n: m.burn, t: t('Горит: в начале своего хода потеряет {0}', Math.min(m.burn, m.hp)) });
    if (g.inGas(m)) out.push({ k: 'gas', t: t('В газу: в начале своего хода потеряет {0} и ударит на {1}% слабее', Math.min(gasDmg(m.max), m.hp), Math.round(GAS_WEAK * 100)) });
    const brittle = Math.round(frostVuln(m.frost) * 100);
    if (g.frozen(m)) out.push({ k: 'chill', t: t('Заморожен: пропустит ход; урон от дисков и умений героев +{0}%', brittle) });
    else if (m.frost) out.push({ k: 'slow', t: t('Замедлен: в свой ход пройдёт не больше {0} {0|клетки|клеток|клеток}; урон от дисков и умений героев +{1}%', FROST_STEPS, brittle) });
    if (m.kiss !== undefined) out.push({ k: 'kiss', n: m.kissLeft, t: t('Поцелуй Вешалки: бьёт ближайшего другого врага, а не героев, и другие враги могут пойти на него; ещё {0} {0|ход|хода|ходов}', m.kissLeft ?? 1) });
    const mate = g.cuffedTo(m);
    if (mate && mate.hp > 0) out.push({ k: 'cuffs', n: g.S.cuffs!.left, t: t('В наручниках, в паре: {0}. Урон по одному достаётся и другому, ещё {1} {1|ход|хода|ходов}', MOBS[mate.k].name, g.S.cuffs!.left) });
    if (isRanged(m.k)) out.push({ k: 'bow', t: 'Дальний бой: стреляет только в того, кого видит' });
    if (m.armor) out.push({ k: 'armor', n: m.armor, t: t('Броня {0}', m.armor) });
    if (MOBS[m.k].shield) out.push({ k: 'shield', t: 'Дверь вместо щита: диск спереди ранит вполовину, бей сбоку или рикошетом' });
    const honed = g.honed(m);
    if (honed) out.push({ k: 'hit', n: honed, t: t('Наточен: точильщик рядом, бьёт на {0} сильнее', honed) });
    if (m.under !== undefined) out.push({ k: 'ghost', t: 'В норе: диски не достают. Попади диском в яму с глазами, удар вдвое' });
    else if (!g.solid(m) && !MOBS[m.k].fixed) out.push({ k: 'ghost', t: 'Бесплотен в этот ход: диски пролетают насквозь' });
    if (MOBS[m.k].mirror) out.push({ k: 'shield', t: 'На цепи: прямой удар отражается, ранит только рикошет. Огонь, газ, молния и мороз проходят' });
    if (m.open) out.push({ k: 'shield', t: 'Дверца открыта: диск в неё бьёт вдвое и мимо брони' });
    if (g.coverOf(m, m)) out.push({ k: 'shield', t: 'Шестёрка рядом прикрывает: диск по Пахану попадёт в неё' });
    if (m.pot) out.push({ k: 'ore', n: m.pot, t: t('Общак: {0} руды. Вернётся вдвое, когда Пахан падёт', m.pot) });
    if (m.brew) out.push({ k: 'rage', n: m.brew, t: 'Подогрета чифиром: бьёт сильнее' });
    if (m.mad !== undefined) out.push({ k: 'rage', t: t('Не трожь яйца: идёт за {0} и бьёт вдвое', g.heroOf(m.mad).def.acc) });
    if (m.intent?.t === 'charge') out.push({ k: 'fuse', t: 'Фитиль горит' });
    if (g.rage() > 0) out.push({ k: 'rage', n: g.rage(), t: t('Ярость: бьёт на {0} сильнее', g.rage()) });
    return out;
  }

  /** The enemies in the order they act, left to right with chevrons between; the one moving now is lit, the ones done fade. */
  private queue() {
    const g = this.g, S = g.S, live = g.liveMobs(), box = $('queue');
    box.hidden = S.phase === 'over' || !live.length;
    const key = live.map(m => S.mobs.indexOf(m) + m.k + (sprites.has(m.k) ? '+' : '')).join();
    if (key !== this.queueKey) {
      this.queueKey = key;
      box.innerHTML = live.map(m => `<li data-m="${S.mobs.indexOf(m)}"><button type="button" class="qb"><img src="${mobFace(m.k)}" alt=""><span class="qi"></span></button></li>`).join('');
      if (this.card >= 0 && !live.some(m => S.mobs.indexOf(m) === this.card)) { this.pinned = false; this.closeCard(); }
    }
    const now = S.phase === 'enemy' ? S.mobs[S.actor] : undefined;
    box.querySelectorAll<HTMLElement>('li[data-m]').forEach(li => {
      const m = S.mobs[Number(li.dataset.m)], it = this.intent(m);
      li.classList.toggle('now', m === now);
      li.classList.toggle('done', g.acted(m));
      li.classList.toggle('boss', !!MOBS[m.k].boss);
      const qi = li.querySelector('.qi')!;
      if (qi.innerHTML !== it.badge) qi.innerHTML = it.badge;
      li.querySelector('button')!.setAttribute('aria-label', t('{0}, {1} из {2}. {3}', m.name, m.hp, m.max, it.txt));
    });
  }

  private openCard(i: number) {
    const g = this.g, m = g.S.mobs[i];
    const li = $('queue').querySelector<HTMLElement>(`li[data-m="${i}"]`);
    if (!m || m.hp <= 0 || !li) { this.pinned = false; this.closeCard(); return; }
    const d = MOBS[m.k], it = this.intent(m), sp = g.specialIn(m), card = $('mobCard');
    const hpPct = (Math.max(0, m.hp) / m.max) * 100, burn = (Math.min(m.burn, Math.max(0, m.hp)) / m.max) * 100;
    card.innerHTML = `<div class="mc-head"><img src="${mobFace(m.k)}" alt=""><div><b>${t(m.name)}</b><span class="mc-hp"><i style="width:${hpPct}%"></i>`
      + (m.burn > 0 ? `<em style="left:${hpPct - burn}%;width:${burn}%"></em>` : '') + `<u>${m.hp}/${m.max}</u></span></div></div>`
      + `<p class="mc-act">${it.badge}<span>${it.txt}</span></p>`
      + (sp && sp.turns > 0 ? `<p class="mc-cd">${t('{0:u} через {1} {1|ход|хода|ходов}', sp.name, sp.turns)}</p>` : '')
      + `<div class="mc-st">${statusHtml(this.mobStatus(m))}</div><p class="mc-txt">${t(d.txt)}</p>`;
    card.hidden = false;
    const r = li.getBoundingClientRect(), w = card.offsetWidth;
    card.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    card.style.top = r.bottom + 10 + 'px';
    if (this.card !== i) { this.card = i; hl.mob = i; hl.changed(); }
  }

  private closeCard() {
    $('mobCard').hidden = true;
    if (this.card >= 0) { this.card = -1; hl.mob = -1; hl.changed(); }
  }

  /** A boss gets a wide bar under the top strip: its name, health and fire. What it does next lives only in the enemy list. */
  private boss() {
    const g = this.g, m = g.liveMobs().find(o => MOBS[o.k].boss), bar = $('bossBar');
    bar.hidden = !m || g.S.phase === 'over';
    if (!m) return;
    const cv = bar.querySelector('canvas')!;
    if (cv.dataset.k !== m.k + sprites.has(m.k)) {
      cv.dataset.k = m.k + sprites.has(m.k);
      const img = new Image();
      img.onload = () => { const c = cv.getContext('2d')!; c.clearRect(0, 0, 64, 64); c.drawImage(img, 0, 0, 64, 64); };
      img.src = mobFace(m.k);
    }
    const hpPct = (Math.max(0, m.hp) / m.max) * 100, burn = (Math.min(m.burn, Math.max(0, m.hp)) / m.max) * 100;
    bar.querySelector('b')!.textContent = t(m.name);
    (bar.querySelector('.bb-hp i') as HTMLElement).style.width = hpPct + '%';
    const em = bar.querySelector('.bb-hp em') as HTMLElement;
    em.style.left = hpPct - burn + '%';
    em.style.width = burn + '%';
    bar.querySelector('.bb-hp u')!.textContent = `${Math.max(0, m.hp)}/${m.max}`;
  }

  // ------------------------------------------------------------ my hero's corner

  private corner() {
    const g = this.g, S = g.S, h = g.hero, fr = $('frame');
    fr.style.setProperty('--c', h.def.col);
    fr.style.setProperty('--dk', h.def.dk);
    fr.classList.toggle('dead', h.hp <= 0);
    const pk = h.def.key + (sprites.has(h.def.key) ? '+img' : '');
    if (this.lastPortrait !== pk) { drawPortrait($<HTMLCanvasElement>('pf'), h); this.lastPortrait = pk; }
    const name = t(h.def.name);
    $('fName').textContent = name;
    $('fName').classList.toggle('long', name.length > 8);
    $('pfBtn').setAttribute('aria-label', t('{0}: прокачка и умение', h.def.name));

    const st: Status[] = [];
    if (h.chill > 0) st.push({ k: 'chill', n: h.chill, t: t('Озноб: бросок слабее ещё {0} {0|ход|хода|ходов}', h.chill) });
    if (h.daze > 0) st.push({ k: 'daze', n: h.daze, t: t('Звон в ушах: без линии прицела ещё {0} {0|ход|хода|ходов}', h.daze) });
    if (h.fire > 0) st.push({ k: 'fire', n: 2, t: h.fire > 1 ? t('Горит: в ход врагов потеряет 2, и так ещё {0} {0|ход|хода|ходов}', h.fire) : 'Горит: в ход врагов потеряет 2' });
    if (h.pin) st.push({ k: 'slow', n: h.pin, t: t('Примёрз: бросает, но не переходит к диску ещё {0} {0|ход|хода|ходов}', h.pin) });
    $('fStatus').innerHTML = statusHtml(st);

    // the discs of this turn as chips in a row, the first on the left, only the ones the hero has: the ones still in hand
    // show the hero's disc, the thrown ones (from the right) are dark ghosts
    const per = g.handOf(h), out = S.phase === 'throw' && g.ended(h) ? per : per - h.hand, discPic = envArt.get('disc_' + h.def.key);
    const discs = $('fDiscs');
    discs.innerHTML = Array.from({ length: per }, (_, k) => `<i class="${k < per - out ? 'on' : ''}"></i>`).join('');
    if (discPic) discs.style.setProperty('--disc', `url("${discPic.src}")`);
    else discs.style.removeProperty('--disc');
    discs.title = t('Диски: {0} из {1} за ход', h.hand, per);

    // health and the shield on top of it: the bar holds both, squeezing when they add up to more than the most health
    const inc = g.incoming(h), dead = h.hp > 0 && inc >= h.hp, tot = Math.max(h.max, h.hp + h.shield);
    const hpPct = (Math.max(0, h.hp) / tot) * 100, shPct = (h.shield / tot) * 100, risk = (Math.min(inc, Math.max(0, h.hp)) / tot) * 100;
    $('fHpBar').style.width = hpPct + '%';
    $('fShBar').style.left = hpPct + '%';
    $('fShBar').style.width = shPct + '%';
    // where each chunk starts, for the painted bar: it shows its slice of the whole blade picture
    $('fShBar').style.setProperty('--x', String(hpPct));
    // a blow that gets past the shield takes all of it first: the whole shield chunk is hatched then
    $('fShBar').classList.toggle('risk', inc > 0);
    $('fRisk').style.left = hpPct - risk + '%';
    $('fRisk').style.width = risk + '%';
    $('fRisk').style.setProperty('--x', String(hpPct - risk));
    $('fHp').textContent = `${Math.max(0, h.hp)}/${h.max}`;
    const wrap = $('fHpWrap');
    wrap.classList.toggle('shielded', h.shield > 0);
    wrap.classList.toggle('lethal', dead);
    // the shield has no badge of its own: the blue chunk shows it, the number is in the hint
    wrap.title = [h.shield > 0 ? t('Щит {0}: снимается первым.', h.shield) : '', inc ? t('Враги в этот ход снимут {0} HP, если их не остановить.', inc) : ''].filter(Boolean).join(' ');

    // the sparks under the health: two pieces, the gem itself being the third; full, they light up and the gem pulses
    // «Энергетик» makes the ability cheaper: the button lights up as soon as there are enough
    const sp = Math.min(AB_COST, h.sparks), cost = g.abCost(h), full = sp >= cost;
    $('fSpk').querySelectorAll('i').forEach((c, k) => c.classList.toggle('on', k < sp));
    $('fSpk').classList.toggle('full', full);
    $('abName').textContent = t(h.def.ab);
    // each hero's ability has its own picture in the gem (ab_<hero>); the name stays for when it has not loaded
    const ico = $('abIco'), pic = 'ab_' + h.def.key;
    if (ico.dataset.art !== pic) { ico.dataset.art = pic; fillIcons($('abBtn')); }
    const ab = $<HTMLButtonElement>('abBtn');
    ab.disabled = !g.canUseAbility();
    ab.classList.toggle('full', full);
    ab.classList.toggle('on', h.boost);
    ab.style.setProperty('--ab', h.def.abCol);
    ab.title = [`${t(h.def.ab)}: ${t(h.def.abTxt)}`, t(h.def.abMore), t('Стоит {0} {0|искру|искры|искр}, включается до броска.', cost), h.boost ? t('Включено до конца хода.') : ''].filter(Boolean).join(' ');
  }

  /** My hero's card from the portrait: how hard the disc hits, its upgrades and the ability in full. */
  private toggleCard(open = $('ups').hidden) {
    $('ups').hidden = !open;
    $('pfBtn').setAttribute('aria-expanded', String(open));
    if (open) this.fillCard();
  }

  private fillCard() {
    const h = this.g.hero;
    $('ups').innerHTML = `<h3 style="color:${h.def.col}">${t(h.def.name)}</h3>` + this.cardBody(h);
  }

  /** A hero's card under the name: how hard the disc hits, its upgrades, the ability in full and the bosses' trophies. */
  private cardBody(h: HeroState) {
    const g = this.g, hit = Math.round(fullHit(g.stat(h, 'm'), g.stat(h, 'pw')) * (h.chill > 0 ? 0.7 : 1));
    return `<p class="hc-hit" title="${t('Сильнее всего диск бьёт на полной натяжке; прямо в лоб урон в {0} раза больше', CRIT)}">${t('удар до {0}, в лоб ×{1}', hit, CRIT)}</p>`
      + upRows(g, h) + `<small class="ups-note">${t('Прокачка у кузнеца на карте')}</small>`
      + `<p class="hc-ab"><b>${t(h.def.ab)}.</b> ${t(h.def.abTxt)} ${t(h.def.abMore)}</p>`
      + (h.arts?.length ? `<div class="hc-arts"><small class="ups-note">${t('Трофеи боссов')}</small>${h.arts.map(k => {
        const a = artDef(k);
        return `<div class="hc-art" title="${t(a.gag)}">${artIcon(k, 'hc-art-ico')}<b>${t(a.name)}</b><small>${t(a.txt)}</small></div>`;
      }).join('')}</div>` : '');
  }

  /** Any hero's card from its face on the strip: the face, the health in numbers, then the same card as from the portrait. */
  private openHero(i: number) {
    const h = this.g.party.find(o => o.i === i), head = $('ally' + i), card = $('heroPeek');
    if (!h || !head) { this.closeHero(); return; }
    const hp = Math.max(0, h.hp), tot = Math.max(h.max, h.hp + h.shield), hpPct = (hp / tot) * 100;
    const html = `<div class="mc-head"><img src="${faceUrl(h)}" alt="" style="--c:${h.def.col}"><div><b style="color:${h.def.col}">${t(h.def.name)}</b>`
      + `<span class="mc-hp"><i style="width:${hpPct}%"></i>${h.shield ? `<s style="left:${hpPct}%;width:${(h.shield / tot) * 100}%"></s>` : ''}`
      + `<u>${h.hp > 0 ? `${hp}/${h.max}` : t('пал')}${h.shield ? ` ${t('+{0} щит', h.shield)}` : ''}</u></span></div></div>`
      + this.cardBody(h);
    // in a fight the strip refreshes with every move: the card is rebuilt only when it changes, so it keeps its scroll
    if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
    card.hidden = false;
    // under the face, kept on the screen; a short screen scrolls the card
    const r = head.getBoundingClientRect(), w = card.offsetWidth;
    card.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    card.style.top = r.bottom + 8 + 'px';
    card.style.maxHeight = window.innerHeight - r.bottom - 16 + 'px';
    if (this.peek !== i) { $('ally' + this.peek)?.setAttribute('aria-expanded', 'false'); head.setAttribute('aria-expanded', 'true'); }
    this.peek = i;
  }

  private closeHero() {
    if (this.peek < 0) return;
    $('heroPeek').hidden = true;
    $('ally' + this.peek)?.setAttribute('aria-expanded', 'false');
    this.peek = -1;
  }

  // ------------------------------------------------------------ my hero's trophies

  /**
   * The sockets in the block's column left of the health, the discs lying over it: a token in each for a trophy my hero
   * has, the first at the bottom, a «?» in the empty ones (a hero gets three at the most: the bosses of the first two
   * floors and the chest in love). A token that has had its go for the fight («Носок») or the turn («Бумеранг») is grey;
   * one whose count of goings-off has grown since the last look jumps once.
   */
  private trophies() {
    const h = this.g.hero, box = $('fArts'), arts = h.arts ?? [], n = Math.max(SOCKETS, arts.length);
    const key = `${h.i}:${arts.join(',')}`;
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.innerHTML = Array.from({ length: n }, (_, k) => arts[k]
        ? `<button class="sock" type="button" data-k="${k}" aria-label="${t(artDef(arts[k]).name)}"><i class="tok">${artIcon(arts[k])}</i></button>`
        : `<button class="sock empty" type="button" data-k="${k}" aria-label="${t('Пустое место под трофей')}"><b aria-hidden="true">?</b></button>`).join('');
      if (this.tip >= n) this.closeTip();
    }
    const socks = box.querySelectorAll<HTMLElement>('.sock');
    socks.forEach((b, k) => {
      b.classList.toggle('spent', !!arts[k] && this.spent(h, arts[k]) !== '');
      b.classList.toggle('sel', k === this.tip);
    });
    // every hero's counts are kept, so taking over another hero (online) doesn't flash what went off before
    for (const o of this.g.party) {
      const now = o.pops ?? {}, seen = this.popSeen.get(o.i);
      if (seen && o === h) arts.forEach((k, j) => { if ((now[k] ?? 0) > (seen[k] ?? 0)) this.jump(socks[j]); });
      this.popSeen.set(o.i, { ...now });
    }
    if (this.tip >= 0) this.openTip(this.tip);
  }

  /** What a trophy that works once a fight or a turn says once it has had its go, '' while it is ready. */
  private spent(h: HeroState, k: string) {
    if (k === 'sock' && h.lucky) return 'Сработал в этом бою';
    if (k === 'boomerang' && h.boomed === this.g.S.turn) return 'Уже вернулся в этом ходу';
    return '';
  }

  /** A trophy has gone off: its token jumps out of the socket and glows, once (no endless animation: phones heat up). */
  private jump(b: HTMLElement | undefined) {
    const t = b?.querySelector<HTMLElement>('.tok');
    if (!t) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.animate(still
      ? [{ boxShadow: '0 0 0 3px #ffd34d, 0 0 18px 4px rgba(255, 211, 77, 0.7)' }, { boxShadow: '0 2px 0 rgba(0, 0, 0, 0.5)' }]
      : [
        { transform: 'none' },
        { transform: 'translateY(-34%) scale(1.25)', boxShadow: '0 0 0 3px #ffd34d, 0 0 22px 6px rgba(255, 211, 77, 0.75), 0 6px 0 rgba(0, 0, 0, 0.4)', offset: 0.3 },
        { transform: 'none', boxShadow: '0 2px 0 rgba(0, 0, 0, 0.5)' },
      ], { duration: 900, easing: 'ease-out' });
  }

  /** The hint over the sockets: the trophy's name, what it does, its joke and whether it has had its go; or what fills an empty one. */
  private openTip(k: number) {
    const h = this.g.hero, key = h.arts?.[k], tip = $('artTip'), box = $('fArts'), b = box.querySelectorAll<HTMLElement>('.sock')[k];
    if (!b) { this.closeTip(); return; }
    let html: string;
    if (key) {
      const a = artDef(key), st = this.spent(h, key);
      html = `<div class="mc-head"><i class="tok">${artIcon(key)}</i><b>${t(a.name)}</b></div><p>${t(a.txt)}</p><small>${t(a.gag)}</small>`
        + (st ? `<span class="at-state">${t(st)}</span>` : '');
    } else html = `<div class="mc-head"><b>${t('Пустое место')}</b></div><p>${DEMO ? t('Трофеи появятся в полной версии игры.') : t('Трофеи дают боссы первого и второго этажа, а иногда «Влюблённый сундук».')}</p>`;
    if (tip.dataset.html !== html) { tip.innerHTML = html; tip.dataset.html = html; }
    tip.hidden = false;
    // beside the column of sockets, over the health, kept on the screen, its tail at the token
    const r = box.getBoundingClientRect(), br = b.getBoundingClientRect(), hgt = tip.offsetHeight;
    const top = Math.max(8, Math.min(window.innerHeight - hgt - 8, br.top + br.height / 2 - hgt / 2));
    tip.style.left = r.right + 12 + 'px';
    tip.style.top = top + 'px';
    tip.style.setProperty('--ay', br.top + br.height / 2 - top - 8 + 'px');
    if (this.tip !== k) {
      box.querySelectorAll('.sock').forEach((o, j) => o.classList.toggle('sel', j === k));
      this.tip = k;
    }
  }

  private closeTip() {
    $('artTip').hidden = true;
    if (this.tip < 0) return;
    $('fArts').querySelectorAll('.sock').forEach(o => o.classList.remove('sel'));
    this.tip = -1;
  }

  // ------------------------------------------------------------ the turn button

  /**
   * One button for whatever the turn needs: «В бой!» at the runes, then «Конец хода»: dull while discs are left
   * (a press asks «ТОЧНО?» first), lit once all are thrown, «ЖДЁМ…» once pressed (press again to take it back),
   * red «ХОД ВРАГОВ» while they move. The turn passes only when every player has pressed.
   */
  private turnButton() {
    const g = this.g, S = g.S, h = g.hero, b = $<HTMLButtonElement>('turnBtn');
    let txt = '', sub = '', cls = 'idle', act: TurnAct = 'none';
    // «готовы N из M» counts the players at the table: the ones who dropped out hold nobody up
    const here = g.alive().filter(o => g.here(o)).map(o => o.i), alive = here.length;
    // alone with a party the button speaks for every hero, so it stays when the picked one has fallen
    if (S.phase === 'over' || h.hp <= 0 && S.phase !== 'enemy' && S.phase !== 'resolve' && !this.team()) {
      b.hidden = true;
      this.act = 'none';
      return;
    }
    if (S.phase === 'place') {
      const ready = S.ready.includes(h.i);
      if (g.online && ready) { txt = 'Ждём'; sub = t('готовы {0} из {1}', S.ready.filter(i => here.includes(i)).length, alive); cls = 'wait'; }
      else if (g.online ? g.placed(h) : g.placed()) { txt = g.online ? 'Готов' : 'В бой!'; cls = 'lit'; act = 'fight'; }
      else { txt = g.party.length > 1 && !g.online ? 'Поставь героев' : 'Поставь героя'; }
    } else if (S.phase === 'throw' && this.team()) {
      // alone with a party the one press ends the turn for every hero, and the discs left are counted over all of them
      const left = g.alive().reduce((n, o) => n + (g.ended(o) ? 0 : o.hand), 0);
      if (g.allDone()) { txt = 'Ждём…'; cls = 'wait'; act = 'cancel'; }
      else if (left > 0 && performance.now() < this.confirmUntil) { txt = 'Точно?'; sub = t('не брошено: {0}', left); cls = 'confirm'; act = 'end'; }
      else { txt = 'Конец хода'; cls = left > 0 ? 'idle' : 'lit'; act = 'end'; }
    } else if (S.phase === 'throw') {
      const done = S.done.filter(i => here.includes(i)).length;
      if (g.ended(h)) { txt = 'Ждём…'; sub = alive > 1 ? t('готовы {0} из {1}', done, alive) : ''; cls = 'wait'; act = 'cancel'; }
      else if (h.hand > 0 && performance.now() < this.confirmUntil) { txt = 'Точно?'; sub = t('не брошено: {0}', h.hand); cls = 'confirm'; act = 'end'; }
      else { txt = 'Конец хода'; cls = h.hand > 0 ? 'idle' : 'lit'; act = g.canEndTurn(h) ? 'end' : 'none'; sub = alive > 1 && done ? t('готовы {0} из {1}', done, alive) : ''; }
    } else if (g.cave()) {
      // the ore cave: the heroes hop over to their discs, then the next turn comes
      txt = 'Ждём…';
      cls = 'wait';
    } else {
      txt = 'Ход врагов';
      cls = 'enemy';
    }
    // the faces of the heroes whose players already pressed, stuck on the button's edge
    const pressed = alive < 2 || this.team() ? [] : (S.phase === 'place' ? (g.online ? S.ready : []) : S.phase === 'throw' ? S.done : []).filter(i => here.includes(i));
    const who = pressed.map(i => g.heroOf(i)), whoKey = who.map(o => faceUrl(o)).join();
    if (this.whoKey !== whoKey) {
      this.whoKey = whoKey;
      $('turnWho').innerHTML = who.map(o => `<img src="${faceUrl(o)}" alt="" style="--c:${o.def.col}">`).join('');
    }
    b.hidden = false;
    txt = t(txt);
    b.className = 'turn-btn ' + cls + (txt.length > 11 ? ' long' : '');
    b.disabled = act === 'none';
    $('turnTxt').textContent = txt;
    $('turnSub').textContent = sub;
    $('turnSub').hidden = !sub;
    b.title = act === 'cancel' ? t('Нажми ещё раз, чтобы отменить') : '';
    this.act = act;
  }

  /** One player plays the whole party (the campaign of two or three): the turn button speaks for every hero. */
  private team() {
    return !this.g.online && this.g.alive().length > 1;
  }

  private pressTurn() {
    const g = this.g, h = g.hero, team = this.team(), all = team ? g.alive() : [h];
    const left = all.reduce((n, o) => n + (g.ended(o) ? 0 : o.hand), 0);
    if (this.act === 'fight') g.startFight();
    else if (this.act === 'cancel') for (const o of all) g.cancelEndTurn(o);
    else if (this.act === 'end') {
      if (left > 0 && performance.now() >= this.confirmUntil) {
        // discs left in hand: ask once, and fall back to the plain button if no second press comes
        this.confirmUntil = performance.now() + 2600;
        setTimeout(() => this.turnButton(), 2700);
      } else {
        this.confirmUntil = 0;
        for (const o of all) g.endTurn(o);
      }
    }
    this.turnButton();
  }

  // ------------------------------------------------------------ journal

  /** The enemy turn's journal under the scroll button: this turn's lines and the last one's, newest on top. */
  private log() {
    const S = this.g.S, list = S.log, btn = $('btnLog');
    // nothing to read in the ore cave: no enemies there
    if (this.g.cave()) { btn.hidden = true; $('logPanel').hidden = true; return; }
    btn.hidden = S.phase === 'place' && !list.length;
    btn.classList.toggle('new', list.length > this.logSeen && $('logPanel').hidden);
    if ($('logPanel').hidden) return;
    this.logSeen = list.length;
    const last = list.length ? list[list.length - 1].turn : 0;
    const rows = list.filter(e => e.turn >= last - 1).reverse();
    $('logList').innerHTML = rows.length ? rows.map(e => `<li class="${e.turn === last ? '' : 'old'}"><small>${t('ход {0}', e.turn)}</small> ${t(e.txt)}</li>`).join('') : `<li class="old">${t('Враги ещё не ходили')}</li>`;
  }

  private toggleLog(open = $('logPanel').hidden) {
    $('logPanel').hidden = !open;
    $('btnLog').setAttribute('aria-expanded', String(open));
    if (open) this.log();
    else $('btnLog').classList.toggle('new', this.g.S.log.length > this.logSeen);
  }

  /** Alone with a party (the campaign of two or three) the blacksmith's window serves every hero, a tab each. */
  private forgeTeam() {
    return !this.g.online && this.g.party.length > 1;
  }

  /**
   * The hero whose upgrades the blacksmith's window shows: online and alone this screen's own; for a party the one whose
   * tab is open, at first the first hero (when sharpening, the first still owed its free level).
   */
  private forgeHero() {
    const g = this.g;
    if (!this.forgeTeam()) return this.me();
    return g.party.find(o => o.i === this.forgeFor) ?? (g.whet ? g.party.find(o => g.freeUp(o)) : undefined) ?? g.party[0] ?? null;
  }

  /** The blacksmith's window: the smithy's picture and scene, and this screen's own hero's upgrades for the party's shared ore. */
  private forge() {
    const g = this.g;
    $('forgeScreen').hidden = !this.atForge;
    if (!g.forge) { this.forgeHtml = ''; this.forgeLeft = 0; }
    // a new visit (or the sharpening after an elite) opens on its first hero again
    if (this.forgeAt !== `${g.forge}:${g.whet}`) { this.forgeAt = `${g.forge}:${g.whet}`; this.forgeFor = -1; }
    if (!this.atForge) return;
    const pic = eventArt.get('forge') ?? uiArt.get('room_forge'), img = $<HTMLImageElement>('forgeImg');
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('forgeArt').classList.toggle('stub', !eventArt.has('forge'));
    const h = this.forgeHero();
    $('forgeTitle').textContent = g.whet ? t('Заточка') : t('Кузнец');
    $('forgeText').textContent = g.whet ? whetTxt(!!h && g.freeUp(h)) : forgeTxt(g.gift);
    const box = $('forgeMine'), html = h ? forgeRows(g, h, this.forgeTeam()) : '';
    if (html !== this.forgeHtml) {
      box.innerHTML = html;
      if (h) box.style.setProperty('--c', h.def.col);
      fillIcons(box);
      this.forgeHtml = html;
    }
  }

  /**
   * The party's ore on the strip and in the blacksmith's window. There a change plays (src/orefx.ts): the smith's gift
   * ticks in as the window opens, and ore bought with (here or by another player) ticks out, the buyer's face on the
   * sticker when it was another hero.
   */
  private ore() {
    const g = this.g, ore = g.bank.ore, at = this.atForge && !g.whet ? String(g.forge) : '', was = this.oreWas, visit = this.oreAt;
    const seen = this.levels, sp = g.S.spec, room = `${sp.floor}:${sp.depth}:${sp.seed}`, behind = this.oreRoom;
    this.levels = new Map(g.party.map(h => [h.i, [h.discs, ...UPS.map(u => h.up[u.k])]]));
    this.oreRoom = room;
    if (ore === was && at === visit) return;
    this.oreWas = ore;
    this.oreAt = at;
    if (at && at !== visit) {
      // only when this screen had the ore from before the gift, on the map over the same room: a campaign reopened at
      // the blacksmith's (or a player back at the table) just shows it
      if (g.gift > 0 && was === ore - g.gift && room === behind) this.counters.play(was, ore, { wait: 450 });
      else this.counters.show(ore);
      return;
    }
    if (!at || ore > was) { this.counters.show(ore); return; }
    const h = g.party.find(o => this.levels.get(o.i)!.some((v, k) => v > (seen.get(o.i)?.[k] ?? v)));
    this.counters.play(was, ore, h && h !== this.forgeHero() ? { who: { face: faceUrl(h), col: h.def.col } } : {});
  }
}
