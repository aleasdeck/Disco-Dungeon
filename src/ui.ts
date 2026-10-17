// DOM HUD in the corners, so the room keeps the middle of the screen: the top strip (the party, ore, where we are,
// the enemy queue with what each will do, map / journal / menu), my hero's corner (portrait with its statuses, discs,
// health with the shield on it, the sparks bar running into the ability button) and one big button for the turn.

import { AB_COST, CRIT, ENEMY_BASE, FORGE_ORE, HAND_MAX, HAND_START, MOBS, ROOM_TYPES, UPS, UP_COST, fullHit, type MobKind, type StatKey } from './data';
import { sprites } from './assets';
import type { Game, HeroState } from './game';
import type { Mob } from './room';
import { BASE_TH, drawHeroFigure, drawMiniature, drawMobFigure } from './draw/figures';
import { lg } from './draw/util';
import { art, fillIcons, icon } from './icons';
import { hl } from './hl';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** "2 хода", "5 ходов". */
const turns = (n: number) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'ход' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'хода' : 'ходов');

/** Hero names as the object of a blow ("ударит Пепельницу") and as where a walker heads ("идёт к Пепельнице"). */
const ACC: Record<string, string> = { bastion: 'Бастиона', ash: 'Пепельницу', ricochet: 'Рикошета' };
const DAT: Record<string, string> = { bastion: 'Бастиону', ash: 'Пепельнице', ricochet: 'Рикошету' };

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

/** Each upgrade's picture in public/assets/ui: more discs, damage, speed, bounce. */
const UP_ART: Record<string, string> = { n: 'up_discs', m: 'up_dmg', pw: 'up_speed', e: 'up_bounce' };

/**
 * A hero's disc upgrades, one row each: level pips and where the stat stands. Each says what it does in a line
 * under the name (the phone pop-up) or a tooltip (the desktop). At the blacksmith's (`shop`) a row also sells the next level.
 */
function upRows(g: Game, h: HeroState, shop: boolean) {
  const canBuy = (c: number) => !!c && g.bank.ore >= c && g.canControl(h);
  const row = (k: string, name: string, txt: string, pips: number, lv: number, val: string, cost: number, tip: string) =>
    `<div class="up" title="${tip}">${art(UP_ART[k], 'up-ico')}<span class="up-name">${name}</span>`
    + `<span class="lvl">${Array.from({ length: pips }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><b>${val}</b>`
    + (shop ? `<button class="btn sm" data-h="${h.i}" data-k="${k}" ${canBuy(cost) ? '' : 'disabled'}>${cost ? '+ ' + cost + ' руды' : 'макс'}</button>` : '')
    + `<small class="up-txt">${txt}</small></div>`;
  const dc = g.discCost(h), discTxt = 'Больше бросков за ход. Самое сильное улучшение';
  return row('n', 'Диски за ход', discTxt, HAND_MAX - HAND_START, h.discs - HAND_START, String(h.discs), dc,
    `${discTxt}. ` + (dc ? `Следующий диск у кузнеца за ${dc} руды.` : 'Больше дисков не бывает.'))
    + UPS.map(u => {
      const lv = h.up[u.k], cost = g.upCost(h, u.k), v = g.stat(h, u.k);
      return row(u.k, u.name, u.txt, UP_COST.length, lv, u.fmt(lv * u.step, v), cost,
        `${u.txt}. ${u.now?.(v) ?? ''}` + (cost ? `Следующий уровень у кузнеца за ${cost} руды.` : 'Больше не прокачать.'));
    }).join('');
}

/** Whose turn it is, as the HUD tells it: the heroes throw (and the discs settle), then the enemies go. */
export type Side = 'place' | 'heroes' | 'enemies' | 'over';

/** One status as a little icon with a number: on the portrait for heroes, on the card for enemies. */
interface Status { k: string; n?: number; t: string }
const statusHtml = (list: Status[]) => list.map(s => `<i class="st st-${s.k}" title="${s.t}">${icon(s.k)}${s.n ? `<b>${s.n}</b>` : ''}</i>`).join('');

/** The turn button's job right now. */
type TurnAct = 'fight' | 'end' | 'cancel' | 'none';

export class Hud {
  private lastPortrait = '';
  /** Whose turn the HUD showed last, so a change of turn gets its banner. */
  private side: Side | null = null;
  /** Whose cards the blacksmith's screen holds now; the cards are built once per visit, then only their rows change. */
  private forgeCards = '';
  /** The blacksmith's (by depth) this player is done at and left for the map, while the others may still be buying. */
  private forgeLeft = 0;
  /** Mobs (by index) and their art the queue was built for; it is rebuilt only when that changes, so hovers survive refreshes. */
  private queueKey = '';
  /** The enemy whose card is open, and whether a tap pinned it (a hover card goes when the pointer leaves). */
  private card = -1;
  private pinned = false;
  /** Online: the name of the player whose hero this is. */
  nameOf: (i: number) => string | null = () => null;
  /** The first press of «Конец хода» with discs still in hand only asks «ТОЧНО?»; a second press within a moment ends. */
  private confirmUntil = 0;
  private act: TurnAct = 'none';
  /** Whose faces the turn button shows now, so it is redrawn only when that changes. */
  private whoKey = '';
  /** Journal lines already seen, so the scroll button says when there are new ones. */
  private logSeen = 0;

  /** The blacksmith's screen is up on this screen. */
  get atForge() { return this.g.forge > 0 && this.g.forge !== this.forgeLeft; }

  leaveForge() {
    this.forgeLeft = this.g.forge;
    this.forge();
  }

  constructor(private g: Game) {
    fillIcons();
    $('abBtn').addEventListener('click', () => g.useAbility());
    $('turnBtn').addEventListener('click', () => this.pressTurn());
    $('pfBtn').addEventListener('click', e => { e.stopPropagation(); this.toggleCard(); });
    $('btnLog').addEventListener('click', e => { e.stopPropagation(); this.toggleLog(); });
    $('forgeHeroes').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'), h = b && g.party.find(o => o.i === Number(b.dataset.h));
      if (!h || !g.canControl(h)) return;
      if (b.dataset.k === 'n') g.buyDisc(h);
      else g.upgrade(b.dataset.k as StatKey, h);
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
    document.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (this.pinned && !t.closest('#mobCard')) { this.pinned = false; this.closeCard(); }
      if (!t.closest('#logPanel')) this.toggleLog(false);
      if (!t.closest('#ups')) this.toggleCard(false);
    });
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
      b.addEventListener('click', () => this.g.select(h.i));
      b.disabled = !this.g.canControl(h);
      box.appendChild(b);
    }
    this.lastPortrait = '';
    fillIcons();
  }

  refresh() {
    const g = this.g, S = g.S;
    fillIcons();
    $('locName').textContent = `Этаж ${S.spec.floor + 1} · ${ROOM_TYPES[S.spec.type].name}`;
    $('hTurn').textContent = S.phase === 'place' ? 'Расстановка' : `Ход ${S.turn}`;
    $('hOre').textContent = String(g.bank.ore);
    // enemies grow angrier every turn once a fight drags on; warn a turn ahead
    const rage = $('hRage'), fighting = S.phase !== 'place' && S.phase !== 'over', soon = g.rageFrom() - S.turn;
    rage.hidden = !fighting || (g.rage() === 0 && soon > 1);
    rage.classList.toggle('soon', g.rage() === 0);
    rage.textContent = g.rage() ? `ярость +${g.rage()}` : 'ярость со след. хода';
    rage.title = `С ${g.rageFrom()}-го хода каждый враг с каждым ходом бьёт на 1 сильнее.`;

    const side: Side = S.phase === 'place' || S.phase === 'over' ? S.phase : S.phase === 'enemy' || S.phase === 'resolve' ? 'enemies' : 'heroes';
    const sd = $('hSide');
    sd.className = 'side ' + side;
    sd.textContent = { place: '', heroes: 'ваш ход', enemies: 'ход врагов', over: g.alive().length ? 'победа' : g.party.length > 1 ? 'отряд пал' : 'герой пал' }[side];
    document.body.dataset.turn = side;
    if (this.side !== side) {
      // the fight starts or the turn passes to the other side: a banner across the room says so
      if (this.side && (side === 'heroes' || side === 'enemies')) this.banner(side === 'heroes' ? 'Ваш ход' : 'Ход врагов', side === 'heroes' ? `Ход ${S.turn} · бросайте диски` : 'враги ходят по очереди', side);
      this.side = side;
    }

    this.heads();
    this.queue();
    this.boss();
    this.corner();
    this.turnButton();
    this.log();
    if (this.card >= 0) this.openCard(this.card);
    if (!$('ups').hidden) this.fillCard();
    this.forge();
  }

  // ------------------------------------------------------------ top strip

  private heads() {
    const g = this.g, S = g.S;
    for (const o of g.party) {
      const t = $('ally' + o.i);
      if (!t) continue;
      t.classList.toggle('me', o === g.hero);
      t.classList.toggle('dead', o.hp <= 0);
      // online: the player's name on their hero, greyed with a pulled plug while they are disconnected
      const who = this.nameOf(o.i), away = !g.here(o);
      t.querySelector('.who')!.textContent = who ?? '';
      t.classList.toggle('away', away);
      const tot = Math.max(o.max, o.hp + o.shield), inc = g.incoming(o);
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
      const done = S.phase === 'place' ? g.online && S.ready.includes(o.i) : S.phase === 'throw' && g.ended(o);
      t.classList.toggle('done', done);
      t.title = (who ? `${who}, ` : '') + `${o.def.name}: ${Math.max(0, o.hp)}/${o.max}` + (o.shield ? `, щит ${o.shield}` : '')
        + (o.hp <= 0 ? ', пал' : done ? (S.phase === 'place' ? ', готов' : ', закончил ход') : '') + (away ? '. Нет связи: пока играет хозяин комнаты, ход его не ждёт' : '');
    }
  }

  /** What an enemy's badge on its queue icon says; the same in words for its card. */
  private intent(m: Mob): { badge: string; txt: string } {
    const g = this.g, it = m.intent;
    if (!it) return { badge: '', txt: 'Ничего не делает' };
    const tgt = it.hero >= 0 ? g.heroOf(it.hero) : null, key = tgt?.def.key ?? '';
    if (it.t === 'hit') return { badge: `<span class="ib hit" style="--c:${tgt!.def.col}">${it.dmg}</span>`, txt: `Ударит ${ACC[key] ?? tgt!.def.name} на ${it.dmg}` };
    if (it.t === 'move') {
      return {
        badge: `<span class="ib go" style="--c:${tgt!.def.col}">${it.eta ?? icon('move')}</span>`,
        txt: `Идёт к ${DAT[key] ?? tgt!.def.name}` + (it.eta ? `, ударит через ${turns(it.eta)}` : ''),
      };
    }
    if (it.t === 'slam') {
      const cols = g.alive().map(o => o.def.col), n = cols.length;
      const pie = cols.map((c, k) => `${c} ${(k / n) * 360}deg ${((k + 1) / n) * 360}deg`).join(',');
      return { badge: `<span class="ib all" style="--pie:conic-gradient(${pie})">${it.dmg}</span>`, txt: `${it.chill ? 'Метель' : 'Удар'} по всем на ${it.dmg}` + (it.chill ? ', морозит' : '') };
    }
    const sp = { charge: ['fuse', 'Поджигает фитиль: в следующий ход бомба на двойной урон'], heal: ['heal', `Лечит союзника на ${it.dmg}`], summon: ['summon', 'Призывает подмогу на светящийся круг'], heat: ['heat', 'Раскаляет пол: отмеченные клетки станут лавой'] }[it.t];
    return { badge: `<span class="ib sp">${icon(sp[0])}</span>`, txt: sp[1] };
  }

  private mobStatus(m: Mob): Status[] {
    const g = this.g, out: Status[] = [];
    if (m.burn > 0) out.push({ k: 'fire', n: m.burn, t: `Горит: в начале своего хода потеряет ${Math.min(m.burn, m.hp)}` });
    if (m.armor) out.push({ k: 'armor', n: m.armor, t: `Броня ${m.armor}` });
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
      box.innerHTML = live.map(m => `<li data-m="${S.mobs.indexOf(m)}"><button type="button" class="qb"><img src="${mobFace(m.k)}" alt=""><span class="qi"></span></button><small class="cd"></small></li>`).join('');
      if (this.card >= 0 && !live.some(m => S.mobs.indexOf(m) === this.card)) { this.pinned = false; this.closeCard(); }
    }
    const now = S.phase === 'enemy' ? S.mobs[S.actor] : undefined;
    box.querySelectorAll<HTMLElement>('li[data-m]').forEach(li => {
      const m = S.mobs[Number(li.dataset.m)], it = this.intent(m), sp = g.specialIn(m);
      li.classList.toggle('now', m === now);
      li.classList.toggle('done', g.acted(m));
      li.classList.toggle('boss', !!MOBS[m.k].boss);
      const qi = li.querySelector('.qi')!;
      if (qi.innerHTML !== it.badge) qi.innerHTML = it.badge;
      // a special move coming up later says how soon; this turn's shows on the badge itself
      li.querySelector('.cd')!.textContent = sp && sp.turns > 0 && sp.turns <= 3 ? `${sp.name} ${sp.turns}` : '';
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

  /** A boss gets a wide bar under the top strip: its health, its fire and how soon it hits everyone. */
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
    const sp = g.specialIn(m), hpPct = (Math.max(0, m.hp) / m.max) * 100, burn = (Math.min(m.burn, Math.max(0, m.hp)) / m.max) * 100;
    bar.querySelector('b')!.textContent = m.name + (sp ? ` · ${sp.name} ${sp.turns ? 'через ' + turns(sp.turns) : 'в этот ход'}` : '');
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
    if (h.fire > 0) st.push({ k: 'fire', n: 2, t: 'Горит: в ход врагов потеряет 2' });
    $('fStatus').innerHTML = statusHtml(st);

    // the discs of this turn as a little stack: the ones still in hand in the hero's colour, the thrown ones dark
    const out = S.phase === 'throw' && g.ended(h) ? h.discs : h.discs - h.hand;
    $('fDiscs').innerHTML = Array.from({ length: h.discs }, (_, k) => `<i class="${k < h.discs - out ? 'on' : ''}"></i>`).join('');
    $('fDiscs').title = `Диски: ${h.hand} из ${h.discs} за ход`;

    // health and the shield on top of it: the bar holds both, squeezing when they add up to more than the most health
    const inc = g.incoming(h), dead = h.hp > 0 && inc >= h.hp, tot = Math.max(h.max, h.hp + h.shield);
    const hpPct = (Math.max(0, h.hp) / tot) * 100, shPct = (h.shield / tot) * 100, risk = (Math.min(inc, Math.max(0, h.hp)) / tot) * 100;
    $('fHpBar').style.width = hpPct + '%';
    $('fShBar').style.left = hpPct + '%';
    $('fShBar').style.width = shPct + '%';
    // a blow that gets past the shield takes all of it first: the whole shield chunk is hatched then
    $('fShBar').classList.toggle('risk', inc > 0);
    $('fRisk').style.left = hpPct - risk + '%';
    $('fRisk').style.width = risk + '%';
    $('fHp').textContent = `${Math.max(0, h.hp)}/${h.max}`;
    $('fShBadge').hidden = h.shield <= 0;
    $('fShield').textContent = String(h.shield);
    const wrap = $('fHpWrap');
    wrap.classList.toggle('shielded', h.shield > 0);
    wrap.classList.toggle('lethal', dead);
    wrap.title = inc ? `Враги в этот ход снимут ${inc} HP, если их не остановить.` : '';

    // the sparks bar beside the ability button: three cells, one per spark; full, they light up and the button pulses
    const sp = Math.min(AB_COST, h.sparks), full = sp >= AB_COST;
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
    ab.title = `${h.def.ab}: ${h.def.abTxt} ${h.def.abMore} Стоит ${AB_COST} искры, включается до броска.` + (h.boost ? ' Включено до конца хода.' : '');
  }

  /** My hero's card from the portrait: how hard the disc hits, its upgrades and the ability in full. */
  private toggleCard(open = $('ups').hidden) {
    $('ups').hidden = !open;
    $('pfBtn').setAttribute('aria-expanded', String(open));
    if (open) this.fillCard();
  }

  private fillCard() {
    const g = this.g, h = g.hero, hit = Math.round(fullHit(g.stat(h, 'm'), g.stat(h, 'pw')) * (h.chill > 0 ? 0.7 : 1));
    $('ups').innerHTML = `<h3 style="color:${h.def.col}">${h.def.name}</h3>`
      + `<p class="hc-hit" title="Сильнее всего диск бьёт на полной натяжке; прямо в лоб урон удваивается">удар до ${hit}, в лоб ×${CRIT}</p>`
      + upRows(g, h, false) + '<small class="ups-note">Прокачка у кузнеца на карте</small>'
      + `<p class="hc-ab"><b>${h.def.ab}.</b> ${h.def.abTxt} ${h.def.abMore}</p>`;
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
    if (S.phase === 'over' || h.hp <= 0 && S.phase !== 'enemy' && S.phase !== 'resolve') {
      b.hidden = true;
      this.act = 'none';
      return;
    }
    if (S.phase === 'place') {
      const ready = S.ready.includes(h.i);
      if (g.online && ready) { txt = 'Ждём'; sub = `готовы ${S.ready.filter(i => here.includes(i)).length} из ${alive}`; cls = 'wait'; }
      else if (g.online ? g.placed(h) : g.placed()) { txt = g.online ? 'Готов' : 'В бой!'; cls = 'lit'; act = 'fight'; }
      else { txt = g.party.length > 1 && !g.online ? 'Поставь героев' : 'Поставь героя'; }
    } else if (S.phase === 'throw') {
      const done = S.done.filter(i => here.includes(i)).length;
      if (g.ended(h)) { txt = 'Ждём…'; sub = alive > 1 ? `готовы ${done} из ${alive}` : ''; cls = 'wait'; act = 'cancel'; }
      else if (h.hand > 0 && performance.now() < this.confirmUntil) { txt = 'Точно?'; sub = `не брошено: ${h.hand}`; cls = 'confirm'; act = 'end'; }
      else { txt = 'Конец хода'; cls = h.hand > 0 ? 'idle' : 'lit'; act = g.canEndTurn(h) ? 'end' : 'none'; sub = alive > 1 && done ? `готовы ${done} из ${alive}` : ''; }
    } else {
      txt = 'Ход врагов';
      cls = 'enemy';
    }
    // the faces of the heroes whose players already pressed, stuck on the button's edge
    const pressed = alive < 2 ? [] : (S.phase === 'place' ? (g.online ? S.ready : []) : S.phase === 'throw' ? S.done : []).filter(i => here.includes(i));
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

  private pressTurn() {
    const g = this.g, h = g.hero;
    if (this.act === 'fight') g.startFight();
    else if (this.act === 'cancel') g.cancelEndTurn(h);
    else if (this.act === 'end') {
      if (h.hand > 0 && performance.now() >= this.confirmUntil) {
        // discs left in hand: ask once, and fall back to the plain button if no second press comes
        this.confirmUntil = performance.now() + 2600;
        setTimeout(() => this.turnButton(), 2700);
      } else {
        this.confirmUntil = 0;
        g.endTurn(h);
      }
    }
    this.turnButton();
  }

  // ------------------------------------------------------------ journal

  /** The enemy turn's journal under the scroll button: this turn's lines and the last one's, newest on top. */
  private log() {
    const S = this.g.S, list = S.log, btn = $('btnLog');
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

  /** The blacksmith's screen: every hero's upgrades with the next level for sale, paid from the party's shared ore. */
  private forge() {
    const g = this.g;
    $('forgeScreen').hidden = !this.atForge;
    if (!g.forge) { this.forgeCards = ''; this.forgeLeft = 0; }
    if (!this.atForge) return;
    const key = g.party.map(h => h.i + (sprites.has(h.def.key) ? '+img' : '')).join();
    if (this.forgeCards !== key) {
      const box = $('forgeHeroes');
      box.innerHTML = '';
      for (const h of g.party) {
        const c = document.createElement('div');
        c.className = 'fcard';
        c.id = 'fcard' + h.i;
        c.style.setProperty('--c', h.def.col);
        c.innerHTML = `<canvas></canvas><div class="fc-head"><b>${h.def.name}</b><span class="fc-hp"></span></div><div class="ups"></div>`;
        drawPortrait(c.querySelector('canvas')!, h);
        box.appendChild(c);
      }
      this.forgeCards = key;
    }
    $('forgeText').textContent = `Кузнец дал отряду ${FORGE_ORE} руды. Диски прокачиваются только здесь, а руда общая на всех: решайте, кому что.`;
    $('forgeOre').textContent = String(g.bank.ore);
    for (const h of g.party) {
      const c = $('fcard' + h.i);
      c.classList.toggle('mine', g.online && g.canControl(h));
      c.querySelector('.fc-hp')!.textContent = h.hp > 0 ? `${h.hp}/${h.max} HP` : 'пал';
      c.querySelector('.ups')!.innerHTML = upRows(g, h, true);
    }
    $('forgeNote').textContent = g.online ? 'Каждый прокачивает своего героя. Кто закончил, идёт на карту выбирать комнату.' : '';
  }
}
