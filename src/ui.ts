// DOM HUD in the corners, so the room keeps the middle of the screen: the top strip (the party, ore, where we are,
// the enemy queue with what each will do, map / journal / menu), my hero's corner (portrait with its statuses, a column of
// discs, health with the shield on it, the sparks under it and the ability gem) and one big button for the turn.

import { AB_COST, CRIT, E_MAX, ENEMY_BASE, FROST_STEPS, GAS_WEAK, HAND_MAX, HAND_START, MOBS, ROOM_TYPES, UPS, UP_COST, frostVuln, fullHit, gasDmg, isRanged, type MobKind, type RoomType, type StatKey } from './data';
import { envArt, eventArt, sprites, uiArt } from './assets';
import type { Game, HeroState } from './game';
import type { Mob } from './room';
import { BASE_TH, drawHeroFigure, drawMiniature, drawMobFigure } from './draw/figures';
import { lg } from './draw/util';
import { art, artIcon, fillIcons, icon } from './icons';
import { SOCKETS, artDef } from './artifacts';
import { hl } from './hl';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** "2 хода", "5 ходов". */
const turns = (n: number) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'ход' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'хода' : 'ходов');

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

/** A mob's head and shoulders on red for the round queue icons: the top of its picture, or the whole miniature until art loads. */
const mobFaces = new Map<string, string>();
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
    c.drawImage(sp.img, (iw - side) / 2, 0, side, side, 4, 8, n - 8, n - 8);
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
  const row = (k: string, name: string, txt: string, n: number, lv: number, val: string, tip: string) =>
    `<div class="up" title="${tip}">${art(UP_ART[k], 'up-ico')}<span class="up-name">${name}</span>`
    + `${pips(n, lv)}<b>${val}</b><small class="up-txt">${txt}</small></div>`;
  const dc = g.discCost(h), discTxt = 'Больше бросков за ход. Самое сильное улучшение';
  return row('n', 'Диски за ход', discTxt, HAND_MAX - HAND_START, h.discs - HAND_START, String(g.handOf(h)),
    `${discTxt}. ` + (dc ? `Следующий диск у кузнеца за ${dc} руды.` : 'Больше двух кузнец не продаёт, третий диск даёт только трофей «Третья рука».'))
    + UPS.map(u => {
      const lv = h.up[u.k], cost = g.upCost(h, u.k), v = g.stat(h, u.k);
      return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v),
        `${u.txt}. ${u.now?.(v) ?? ''}` + (cost ? `Следующий уровень у кузнеца за ${cost} руды.` : 'Больше не прокачать.'));
    }).join('');
}

/** The smithy's scene in the blacksmith's window. */
const forgeTxt = (ore: number) => 'Гном-кузнец закаляет раскалённый диск прямо в унитазе: шипит, парит, пахнет сталью и чем-то ещё. '
  + (ore ? `На радостях он отсыпает отряду ${ore} руды, остальное за плату.` : 'Руды он сегодня не дарит: самому мало, так что всё за плату.');

/**
 * The blacksmith's slab for each of a hero's upgrades: what it is, its level, where the stat goes with the next level,
 * and the price in the party's ore. A slab the ore does not cover, or a stat at its top, is shut.
 */
function forgeRows(g: Game, h: HeroState, team: boolean) {
  // a stat level an elite owes the hero costs nothing; in the sharpening window that is all there is
  const free = g.freeUp(h);
  const row = (k: string, name: string, txt: string, n: number, lv: number, now: string, next: string, cost: number, gratis = false) => {
    const sold = !g.whet || gratis, short = !gratis && cost > g.bank.ore;
    return `<button class="ev-opt fg-up" data-k="${k}" title="${txt}"${cost && sold && !short ? '' : ' disabled'}>`
      + `<i data-art="${UP_ART[k]}" aria-hidden="true"></i><span class="fg-name"><b>${name}</b>${pips(n, lv)}</span>`
      + `<span class="fg-fx">${cost ? `${now}<i>→</i>${next}` : `${now}, больше некуда`}</span>`
      + (!cost || !sold ? '' : gratis ? '<span class="fg-cost free">даром</span>' : `<span class="fg-cost${short ? ' short' : ''}">${cost}${icon('ore')}</span>`) + '</button>';
  };
  // alone with a party the window serves every hero: a tab with each face, the shown one lit, a free level marked on its tab
  const head = team
    ? `<div class="fg-team">${g.party.map(o => `<button class="fg-tab${o === h ? ' on' : ''}" data-hero="${o.i}" style="--c:${o.def.col}" aria-pressed="${o === h}">`
      + `<img src="${faceUrl(o)}" alt=""><b>${o.def.name}</b>${g.freeUp(o) ? '<em>даром</em>' : ''}</button>`).join('')}</div>`
    : `<div class="fg-me"><img src="${faceUrl(h)}" alt=""><b>${h.def.name}</b><span>${h.hp > 0 ? `${h.hp}/${h.max} HP` : 'пал'}</span></div>`;
  return head
    + (g.whet ? '' : row('n', 'Диски за ход', 'Больше бросков за ход. Самое сильное улучшение', HAND_MAX - HAND_START, h.discs - HAND_START, String(g.handOf(h)), String(g.handOf(h) + 1), g.discCost(h)))
    + UPS.map(u => {
      const lv = h.up[u.k], v = g.stat(h, u.k), next = u.k === 'e' ? Math.min(E_MAX, v + u.step) : v;
      return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v), u.fmt((lv + 1) * u.step, next), g.upCost(h, u.k), free);
    }).join('');
}

/** The sharpening window's scene after an elite: the hero still owed a level picks it, then it is done. */
const whetTxt = (free: boolean) => free
  ? 'Гном-кузнец прибежал на грохот боя с элитой и бесплатно точит каждому один диск. Выбери, что подтянуть.'
  : 'Диск заточен. Гном уже ворчит, что дальше только за руду.';

/** Whose turn it is, as the HUD tells it: the heroes throw (and the discs settle), then the enemies go. */
export type Side = 'place' | 'heroes' | 'enemies' | 'over';

/** One status as a little icon with a number: on the portrait for heroes, on the card for enemies. */
interface Status { k: string; n?: number; t: string }
const statusHtml = (list: Status[]) => list.map(s => `<i class="st st-${s.k}" title="${s.t}">${icon(s.k)}${s.n ? `<b>${s.n}</b>` : ''}</i>`).join('');

/** The turn button's job right now. */
type TurnAct = 'fight' | 'end' | 'cancel' | 'none';

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

  leaveForge() {
    this.forgeLeft = this.g.forge;
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

  /** The party's heads in the top strip: health under each, a tick once that player has ended the turn. */
  buildAllies() {
    const box = $('allies');
    box.innerHTML = '';
    for (const h of this.g.party) {
      const b = document.createElement('button');
      b.className = 'head';
      b.id = 'ally' + h.i;
      b.style.setProperty('--c', h.def.col);
      b.setAttribute('aria-label', h.def.name);
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
    $('locName').innerHTML = `<span class="fl">Этаж ${(this.at?.floor ?? S.spec.floor) + 1} · </span><span>${ROOM_TYPES[this.at?.type ?? S.spec.type].name}</span>`;
    // the ore cave counts its turns down: «Ход 2 из 3»
    const max = g.turnsMax(), last = max > 0 && S.turn >= max;
    $('hTurn').textContent = S.phase === 'place' ? 'Расстановка' : max ? `Ход ${S.turn} из ${max}` : `Ход ${S.turn}`;
    $('hOre').textContent = String(g.bank.ore);
    // enemies grow angrier every turn once a fight drags on; warn a turn ahead
    const rage = $('hRage'), fighting = S.phase !== 'place' && S.phase !== 'over' && !g.cave(), soon = g.rageFrom() - S.turn;
    rage.hidden = !fighting || (g.rage() === 0 && soon > 1);
    rage.classList.toggle('soon', g.rage() === 0);
    rage.textContent = g.rage() ? `ярость +${g.rage()}` : 'ярость со след. хода';
    rage.title = `С ${g.rageFrom()}-го хода каждый враг с каждым ходом бьёт на 1 сильнее.`;
    // an event's curse on this fight
    const curse = $('hCurse'), cs = [S.spec.smoke && 'дым-машина', S.spec.strobe && 'стробоскоп'].filter(Boolean);
    curse.hidden = !cs.length || S.phase === 'over';
    curse.textContent = cs.join(' · ');
    curse.title = [S.spec.smoke && 'Дым-машина: видно только вокруг героев.', S.spec.strobe && 'Стробоскоп: нет линии прицела.'].filter(Boolean).join(' ');

    // in the ore cave nobody moves against the party: the heroes hop to their discs and throw again
    const side: Side = S.phase === 'place' || S.phase === 'over' ? S.phase : S.phase === 'enemy' || (S.phase === 'resolve' && !g.cave()) ? 'enemies' : 'heroes';
    const sd = $('hSide');
    sd.className = 'side ' + side;
    sd.textContent = { place: max ? `${max} ${max === 1 ? 'ход' : 'хода'}` : '', heroes: last ? 'последний ход' : 'ваш ход', enemies: 'ход врагов', over: !g.alive().length ? (g.party.length > 1 ? 'отряд пал' : 'герой пал') : g.cave() ? 'пещера пройдена' : 'победа' }[side];
    document.body.dataset.turn = side;
    if (this.side !== side || (g.cave() && side === 'heroes' && this.bannerTurn !== S.turn)) {
      // the fight starts or the turn passes to the other side: a banner across the room says so
      if (this.side && (side === 'heroes' || side === 'enemies')) {
        const sub = max ? `${last ? 'Последний ход' : `Ход ${S.turn} из ${max}`} · бросайте диски` : `Ход ${S.turn} · бросайте диски`;
        this.banner(side === 'heroes' ? 'Ваш ход' : 'Ход врагов', side === 'heroes' ? sub : 'враги ходят по очереди', side);
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
  }

  // ------------------------------------------------------------ top strip

  private heads() {
    // over an event or the camp the room behind has nothing to say: no blows coming, nobody ready or done
    const g = this.g, S = g.S, ev = !!this.at;
    for (const o of g.party) {
      const t = $<HTMLButtonElement>('ally' + o.i);
      if (!t) continue;
      t.classList.toggle('me', o === g.hero);
      t.classList.toggle('dead', o.hp <= 0);
      // online: the player's name on their hero, greyed with a pulled plug while they are disconnected
      const who = this.nameOf(o.i), away = !g.here(o);
      t.querySelector('.who')!.textContent = who ?? '';
      t.classList.toggle('away', away);
      const tot = Math.max(o.max, o.hp + o.shield), inc = ev ? 0 : g.incoming(o);
      const hpPct = (Math.max(0, o.hp) / tot) * 100, risk = (Math.min(inc, Math.max(0, o.hp)) / tot) * 100;
      (t.querySelector('.a-hp i') as HTMLElement).style.width = hpPct + '%';
      const sh = t.querySelector('.a-hp s') as HTMLElement;
      sh.style.left = hpPct + '%';
      sh.style.width = (o.shield / tot) * 100 + '%';
      const em = t.querySelector('.a-hp em') as HTMLElement;
      em.style.left = hpPct - risk + '%';
      em.style.width = risk + '%';
      t.classList.toggle('lethal', o.hp > 0 && inc >= o.hp);
      // a tick: placed and ready (online placement), or done with the turn
      const done = !ev && (S.phase === 'place' ? g.online && S.ready.includes(o.i) : S.phase === 'throw' && g.ended(o));
      t.classList.toggle('done', done);
      t.title = (who ? `${who}, ` : '') + `${o.def.name}: ${Math.max(0, o.hp)}/${o.max}` + (o.shield ? `, щит ${o.shield}` : '')
        + (o.hp <= 0 ? ', пал' : done ? (S.phase === 'place' ? ', готов' : ', закончил ход') : '') + (away ? '. Нет связи: пока играет хозяин комнаты, ход его не ждёт' : '');
    }
  }

  /**
   * What an enemy's badge on its queue icon says; the same in words for its card. A shooter fires only at a hero it sees,
   * so its words say whether it fires from where it stands, steps out to fire or is still walking to where it sees the hero.
   */
  private intent(m: Mob): { badge: string; txt: string } {
    const g = this.g, it = m.intent;
    if (!it) return { badge: '', txt: 'Ничего не делает' };
    // frozen stiff, whatever it meant to do
    if (g.frozen(m) && !g.acted(m)) return { badge: `<span class="ib sp">${icon('chill')}</span>`, txt: `${MOBS[m.k].fem ? 'Заморожена' : 'Заморожен'}: пропустит ход` };
    const tgt = it.hero >= 0 ? g.heroOf(it.hero) : null, far = isRanged(m.k), bomb = !!MOBS[m.k].charge;
    // a shooter's blow and its walk to where it sees the hero carry a bow by the badge
    const acc = tgt?.def.acc ?? '', out = far && !!it.way && it.way.length > 1, bow = far ? icon('bow', 'qbow') : '';
    // kissed by the model: it goes for another enemy, or sighs with nobody left to go for
    if (it.sigh) return { badge: `<span class="ib sp">${icon('kiss')}</span>`, txt: 'Поцелован: вздыхает и никого не ударит' };
    // going for an enemy the model has kissed, as it would for a hero
    if (it.foe !== undefined && m.kiss === undefined && it.t !== 'charge') {
      const o = MOBS[g.S.mobs[it.foe].k], who = o.acc.toLowerCase(), kissed = o.fem ? 'поцелована' : 'поцелован';
      if (it.t === 'hit') {
        const how = !far ? `ударит ${who}` : bomb ? `бросит бомбу в ${who}` : `выстрелит в ${who}`;
        return { badge: `${bow}<span class="ib hit" style="--c:#ff5a8a">${it.dmg}</span>`, txt: cap(`${out ? 'выйдет на линию огня и ' : ''}${how} на ${it.dmg}: ${o.fem ? 'та' : 'тот'} ${kissed} Вешалкой, броня считается`) };
      }
      return { badge: `${bow}<span class="ib go" style="--c:#ff5a8a">${it.eta ?? icon('move')}</span>`, txt: `Идёт ${far ? 'стрелять в' : 'бить'} ${who}: ${o.fem ? 'та' : 'тот'} ${kissed} Вешалкой` };
    }
    if (it.foe !== undefined && m.kiss !== undefined) {
      const o = g.S.mobs[it.foe], who = MOBS[o.k].acc.toLowerCase(), kiss = icon('kiss', 'qbow');
      if (it.t === 'hit') {
        const how = !far ? `ударит ${who}` : bomb ? `бросит бомбу в ${who}` : `выстрелит в ${who}`;
        return { badge: `${kiss}<span class="ib hit" style="--c:#ff5a8a">${it.dmg}</span>`, txt: `Поцелован: ${out ? 'выйдет на линию огня и ' : ''}${how} на ${it.dmg}, броня считается` };
      }
      return { badge: `${kiss}<span class="ib go" style="--c:#ff5a8a">${it.eta ?? icon('move')}</span>`, txt: `Поцелован: идёт ${far ? 'стрелять в' : 'бить'} ${who}, героев не тронет` };
    }
    if (it.t === 'hit') {
      const how = !far ? `ударит ${acc}` : bomb ? `бросит бомбу в ${acc}` : `выстрелит в ${acc}`;
      return { badge: `${bow}<span class="ib hit" style="--c:${tgt!.def.col}">${it.dmg}</span>`, txt: (g.executes(m) ? 'Казнь: ' : '') + cap(out ? `выйдет на линию огня и ${how}` : how) + ` на ${it.dmg}` };
    }
    if (it.t === 'rise') {
      const who = MOBS[m.hold ?? 'skel'].name.toLowerCase();
      return { badge: `<span class="ib go">${it.eta}</span>`, txt: (it.eta ?? 1) > 1 ? `Через ${turns(it.eta!)} встанет ${who}, если не разбить гроб` : `В этот ход встанет ${who}, если не разбить гроб` };
    }
    if (it.t === 'smash') return { badge: `<span class="ib hit" style="--c:#d9434f">${it.dmg}</span>`, txt: `Ударит молотом по красному квадрату на ${it.dmg}: уходи оттуда броском` };
    // drawn by the kid's firecracker: it runs to the noise and strikes nobody this turn
    if (it.bang) return { badge: `<span class="ib sp">${icon('petard')}</span>`, txt: `Бежит на треск петарды и в этот ход ${!far ? 'никого не ударит' : bomb ? 'не бросит бомбу' : 'не выстрелит'}` };
    if (it.t === 'move') {
      const txt = !far ? `Идёт к ${tgt!.def.dat}` + (it.eta ? `, ударит через ${turns(it.eta)}` : '')
        : `Не видит ${acc}` + (it.way ? ': идёт на линию огня' + (it.eta && !bomb ? `, выстрелит через ${turns(it.eta)}` : '') : '');
      return { badge: `${bow}<span class="ib go" style="--c:${tgt!.def.col}">${it.eta ?? icon('move')}</span>`, txt };
    }
    if (it.t === 'slam') {
      const cols = g.alive().map(o => o.def.col), n = cols.length;
      const pie = cols.map((c, k) => `${c} ${(k / n) * 360}deg ${((k + 1) / n) * 360}deg`).join(',');
      return { badge: `<span class="ib all" style="--pie:conic-gradient(${pie})">${it.dmg}</span>`, txt: `${it.chill ? 'Метель' : 'Удар'} по всем на ${it.dmg}` + (it.chill ? ', морозит' : '') };
    }
    const sp = { charge: ['fuse', `Поджигает фитиль${out ? ' и идёт на линию огня' : ''}: в следующий ход бомба на двойной урон`], heal: ['heal', `Лечит союзника на ${it.dmg}`], summon: ['summon', 'Призывает подмогу на светящийся круг'], heat: ['heat', 'Раскаляет пол: отмеченные клетки станут лавой'], scream: ['daze', 'Визг: в следующий ход у всего отряда нет линии прицела'] }[it.t];
    return sp ? { badge: `<span class="ib sp">${icon(sp[0])}</span>`, txt: sp[1] } : { badge: '', txt: '' };
  }

  private mobStatus(m: Mob): Status[] {
    const g = this.g, out: Status[] = [];
    if (m.burn > 0) out.push({ k: 'fire', n: m.burn, t: `Горит: в начале своего хода потеряет ${Math.min(m.burn, m.hp)}` });
    if (g.inGas(m)) out.push({ k: 'gas', t: `В газу: в начале своего хода потеряет ${Math.min(gasDmg(m.max), m.hp)} и ударит на ${Math.round(GAS_WEAK * 100)}% слабее` });
    const brittle = `; урон от дисков и умений героев +${Math.round(frostVuln(m.frost) * 100)}%`;
    if (g.frozen(m)) out.push({ k: 'chill', t: 'Заморожен: пропустит ход' + brittle });
    else if (m.frost) out.push({ k: 'slow', t: `Замедлен: в свой ход пройдёт не больше ${FROST_STEPS === 1 ? 'клетки' : FROST_STEPS + ' клеток'}` + brittle });
    if (m.kiss !== undefined) out.push({ k: 'kiss', n: m.kissLeft, t: `Поцелуй Вешалки: бьёт ближайшего другого врага, а не героев, и другие враги могут пойти на него; ещё ${turns(m.kissLeft ?? 1)}` });
    const mate = g.cuffedTo(m);
    if (mate && mate.hp > 0) out.push({ k: 'cuffs', n: g.S.cuffs!.left, t: `В наручниках, в паре: ${MOBS[mate.k].name}. Урон по одному достаётся и другому, ещё ${turns(g.S.cuffs!.left)}` });
    if (isRanged(m.k)) out.push({ k: 'bow', t: 'Дальний бой: стреляет только в того, кого видит' });
    if (m.armor) out.push({ k: 'armor', n: m.armor, t: `Броня ${m.armor}` });
    if (MOBS[m.k].shield) out.push({ k: 'shield', t: 'Дверь вместо щита: диск спереди ранит вполовину, бей сбоку или рикошетом' });
    const honed = g.honed(m);
    if (honed) out.push({ k: 'hit', n: honed, t: `Наточен: точильщик рядом, бьёт на ${honed} сильнее` });
    if (!g.solid(m)) out.push({ k: 'ghost', t: 'Бесплотен в этот ход: диски пролетают насквозь' });
    if (m.intent?.t === 'charge') out.push({ k: 'fuse', t: 'Фитиль горит' });
    if (g.rage() > 0) out.push({ k: 'rage', n: g.rage(), t: `Ярость: бьёт на ${g.rage()} сильнее` });
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
      li.querySelector('button')!.setAttribute('aria-label', `${m.name}, ${m.hp} из ${m.max}. ${it.txt}`);
    });
  }

  private openCard(i: number) {
    const g = this.g, m = g.S.mobs[i];
    const li = $('queue').querySelector<HTMLElement>(`li[data-m="${i}"]`);
    if (!m || m.hp <= 0 || !li) { this.pinned = false; this.closeCard(); return; }
    const d = MOBS[m.k], it = this.intent(m), sp = g.specialIn(m), card = $('mobCard');
    const hpPct = (Math.max(0, m.hp) / m.max) * 100, burn = (Math.min(m.burn, Math.max(0, m.hp)) / m.max) * 100;
    card.innerHTML = `<div class="mc-head"><img src="${mobFace(m.k)}" alt=""><div><b>${m.name}</b><span class="mc-hp"><i style="width:${hpPct}%"></i>`
      + (m.burn > 0 ? `<em style="left:${hpPct - burn}%;width:${burn}%"></em>` : '') + `<u>${m.hp}/${m.max}</u></span></div></div>`
      + `<p class="mc-act">${it.badge}<span>${it.txt}</span></p>`
      + (sp && sp.turns > 0 ? `<p class="mc-cd">${sp.name[0].toUpperCase() + sp.name.slice(1)} через ${turns(sp.turns)}</p>` : '')
      + `<div class="mc-st">${statusHtml(this.mobStatus(m))}</div><p class="mc-txt">${d.txt}</p>`;
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
    bar.querySelector('b')!.textContent = m.name;
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
    $('fName').textContent = h.def.name;
    $('fName').classList.toggle('long', h.def.name.length > 8);
    $('pfBtn').setAttribute('aria-label', `${h.def.name}: прокачка и умение`);

    const st: Status[] = [];
    if (h.chill > 0) st.push({ k: 'chill', n: h.chill, t: `Озноб: бросок слабее ещё ${turns(h.chill)}` });
    if (h.daze > 0) st.push({ k: 'daze', n: h.daze, t: `Звон в ушах: без линии прицела ещё ${turns(h.daze)}` });
    if (h.fire > 0) st.push({ k: 'fire', n: 2, t: 'Горит: в ход врагов потеряет 2' });
    $('fStatus').innerHTML = statusHtml(st);

    // the discs of this turn as chips in a row, the first on the left, only the ones the hero has: the ones still in hand
    // show the hero's disc, the thrown ones (from the right) are dark ghosts
    const per = g.handOf(h), out = S.phase === 'throw' && g.ended(h) ? per : per - h.hand, discPic = envArt.get('disc_' + h.def.key);
    const discs = $('fDiscs');
    discs.innerHTML = Array.from({ length: per }, (_, k) => `<i class="${k < per - out ? 'on' : ''}"></i>`).join('');
    if (discPic) discs.style.setProperty('--disc', `url("${discPic.src}")`);
    else discs.style.removeProperty('--disc');
    discs.title = `Диски: ${h.hand} из ${per} за ход`;

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
    wrap.title = [h.shield > 0 ? `Щит ${h.shield}: снимается первым.` : '', inc ? `Враги в этот ход снимут ${inc} HP, если их не остановить.` : ''].filter(Boolean).join(' ');

    // the sparks under the health: two pieces, the gem itself being the third; full, they light up and the gem pulses
    // «Энергетик» makes the ability cheaper: the button lights up as soon as there are enough
    const sp = Math.min(AB_COST, h.sparks), cost = g.abCost(h), full = sp >= cost;
    $('fSpk').querySelectorAll('i').forEach((c, k) => c.classList.toggle('on', k < sp));
    $('fSpk').classList.toggle('full', full);
    $('abName').textContent = h.def.ab;
    // each hero's ability has its own picture in the gem (ab_<hero>); the name stays for when it has not loaded
    const ico = $('abIco'), pic = 'ab_' + h.def.key;
    if (ico.dataset.art !== pic) { ico.dataset.art = pic; fillIcons($('abBtn')); }
    const ab = $<HTMLButtonElement>('abBtn');
    ab.disabled = !g.canUseAbility();
    ab.classList.toggle('full', full);
    ab.classList.toggle('on', h.boost);
    ab.style.setProperty('--ab', h.def.abCol);
    ab.title = `${h.def.ab}: ${h.def.abTxt} ${h.def.abMore} Стоит ${cost} искры, включается до броска.` + (h.boost ? ' Включено до конца хода.' : '');
  }

  /** My hero's card from the portrait: how hard the disc hits, its upgrades and the ability in full. */
  private toggleCard(open = $('ups').hidden) {
    $('ups').hidden = !open;
    $('pfBtn').setAttribute('aria-expanded', String(open));
    if (open) this.fillCard();
  }

  private fillCard() {
    const h = this.g.hero;
    $('ups').innerHTML = `<h3 style="color:${h.def.col}">${h.def.name}</h3>` + this.cardBody(h);
  }

  /** A hero's card under the name: how hard the disc hits, its upgrades, the ability in full and the bosses' trophies. */
  private cardBody(h: HeroState) {
    const g = this.g, hit = Math.round(fullHit(g.stat(h, 'm'), g.stat(h, 'pw')) * (h.chill > 0 ? 0.7 : 1));
    return `<p class="hc-hit" title="Сильнее всего диск бьёт на полной натяжке; прямо в лоб урон в ${CRIT} раза больше">удар до ${hit}, в лоб ×${CRIT}</p>`
      + upRows(g, h) + '<small class="ups-note">Прокачка у кузнеца на карте</small>'
      + `<p class="hc-ab"><b>${h.def.ab}.</b> ${h.def.abTxt} ${h.def.abMore}</p>`
      + (h.arts?.length ? `<div class="hc-arts"><small class="ups-note">Трофеи боссов</small>${h.arts.map(k => {
        const a = artDef(k);
        return `<div class="hc-art" title="${a.gag}">${artIcon(k, 'hc-art-ico')}<b>${a.name}</b><small>${a.txt}</small></div>`;
      }).join('')}</div>` : '');
  }

  /** Any hero's card from its face on the strip: the face, the health in numbers, then the same card as from the portrait. */
  private openHero(i: number) {
    const h = this.g.party.find(o => o.i === i), head = $('ally' + i), card = $('heroPeek');
    if (!h || !head) { this.closeHero(); return; }
    const hp = Math.max(0, h.hp), tot = Math.max(h.max, h.hp + h.shield), hpPct = (hp / tot) * 100;
    const html = `<div class="mc-head"><img src="${faceUrl(h)}" alt="" style="--c:${h.def.col}"><div><b style="color:${h.def.col}">${h.def.name}</b>`
      + `<span class="mc-hp"><i style="width:${hpPct}%"></i>${h.shield ? `<s style="left:${hpPct}%;width:${(h.shield / tot) * 100}%"></s>` : ''}`
      + `<u>${h.hp > 0 ? `${hp}/${h.max}` : 'пал'}${h.shield ? ` +${h.shield} щит` : ''}</u></span></div></div>`
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
        ? `<button class="sock" type="button" data-k="${k}" aria-label="${artDef(arts[k]).name}"><i class="tok">${artIcon(arts[k])}</i></button>`
        : `<button class="sock empty" type="button" data-k="${k}" aria-label="Пустое место под трофей"><b aria-hidden="true">?</b></button>`).join('');
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
      html = `<div class="mc-head"><i class="tok">${artIcon(key)}</i><b>${a.name}</b></div><p>${a.txt}</p><small>${a.gag}</small>`
        + (st ? `<span class="at-state">${st}</span>` : '');
    } else html = '<div class="mc-head"><b>Пустое место</b></div><p>Трофеи дают боссы первого и второго этажа, а иногда «Влюблённый сундук».</p>';
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
      if (g.online && ready) { txt = 'Ждём'; sub = `готовы ${S.ready.filter(i => here.includes(i)).length} из ${alive}`; cls = 'wait'; }
      else if (g.online ? g.placed(h) : g.placed()) { txt = g.online ? 'Готов' : 'В бой!'; cls = 'lit'; act = 'fight'; }
      else { txt = g.party.length > 1 && !g.online ? 'Поставь героев' : 'Поставь героя'; }
    } else if (S.phase === 'throw' && this.team()) {
      // alone with a party the one press ends the turn for every hero, and the discs left are counted over all of them
      const left = g.alive().reduce((n, o) => n + (g.ended(o) ? 0 : o.hand), 0);
      if (g.allDone()) { txt = 'Ждём…'; cls = 'wait'; act = 'cancel'; }
      else if (left > 0 && performance.now() < this.confirmUntil) { txt = 'Точно?'; sub = `не брошено: ${left}`; cls = 'confirm'; act = 'end'; }
      else { txt = 'Конец хода'; cls = left > 0 ? 'idle' : 'lit'; act = 'end'; }
    } else if (S.phase === 'throw') {
      const done = S.done.filter(i => here.includes(i)).length;
      if (g.ended(h)) { txt = 'Ждём…'; sub = alive > 1 ? `готовы ${done} из ${alive}` : ''; cls = 'wait'; act = 'cancel'; }
      else if (h.hand > 0 && performance.now() < this.confirmUntil) { txt = 'Точно?'; sub = `не брошено: ${h.hand}`; cls = 'confirm'; act = 'end'; }
      else { txt = 'Конец хода'; cls = h.hand > 0 ? 'idle' : 'lit'; act = g.canEndTurn(h) ? 'end' : 'none'; sub = alive > 1 && done ? `готовы ${done} из ${alive}` : ''; }
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
    b.className = 'turn-btn ' + cls + (txt.length > 11 ? ' long' : '');
    b.disabled = act === 'none';
    $('turnTxt').textContent = txt;
    $('turnSub').textContent = sub;
    $('turnSub').hidden = !sub;
    b.title = act === 'cancel' ? 'Нажми ещё раз, чтобы отменить' : '';
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
    $('logList').innerHTML = rows.length ? rows.map(e => `<li class="${e.turn === last ? '' : 'old'}"><small>ход ${e.turn}</small> ${e.txt}</li>`).join('') : '<li class="old">Враги ещё не ходили</li>';
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
    $('forgeTitle').textContent = g.whet ? 'Заточка' : 'Кузнец';
    $('forgeText').textContent = g.whet ? whetTxt(!!h && g.freeUp(h)) : forgeTxt(g.gift);
    $('forgeOre').textContent = String(g.bank.ore);
    const box = $('forgeMine'), html = h ? forgeRows(g, h, this.forgeTeam()) : '';
    if (html !== this.forgeHtml) {
      box.innerHTML = html;
      if (h) box.style.setProperty('--c', h.def.col);
      fillIcons(box);
      this.forgeHtml = html;
    }
  }
}
