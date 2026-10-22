// The event window over the map, laid out like Slay the Spire's: the picture with its gag on the left, the scene on the
// right and the choices under it. Once a choice is taken the same window tells what came of it.
// Between the scene and the choices some events play something out: the slot machine's reels, the sphinx's riddle, the
// bottle on its wheel, the goblin's cups. A step after the choice asks for a hero (the tattoo), a cup (the thimbles) or
// each hero's trophy to hand over (the pawnshop).

import { eventArt, uiArt } from './assets';
import { artDef } from './artifacts';
import type { HeroState } from './game';
import { artIcon } from './icons';
import { faceUrl } from './ui';
import { UPS } from './data';
import {
  BOTTLE, SELL, choicesOf, doneOf, eventDef, fxParts, needOf, reelsOf, riddleOf, sceneOf, shuffleOf, shutWhy, stageOf,
  type Choice, type EventState, type Fx, type Reel, type Table,
} from './events';

const $ = (id: string) => document.getElementById(id)!;

/** Online: the faces of the players on the choices they point at, and a line on how the vote stands. */
export interface EventVotes {
  faces: Record<number, { col: string; name: string; face: string; me: boolean }[]>;
  /** The choice this player points at. */
  mine: number | null;
  note: string;
}

const pct = (x: number) => Math.round(x * 100) + '%';

/** What a choice or an outcome does, the good in green and the bad in red; what it costs in ore comes first. `to` names whom it falls on. */
function line(fx: Fx[], solo: boolean, pay = 0, to?: string) {
  const parts = [...(pay ? fxParts([{ k: 'ore', n: -pay }], solo) : []), ...fxParts(fx, solo, to)];
  return parts.length ? parts.map(p => `<em class="${p.mid ? 'mid' : p.good ? 'good' : 'bad'}">${p.t}</em>`).join(' ') : '<em class="none">Ничего не случится</em>';
}

/** The slot machine's symbols: the painted ones, or a sign while they haven't loaded. */
const REEL_SIGN: Record<Reel, string> = { cherry: '🍒', lips: '💋', skull: '💀' };
const reelPic = (r: Reel) => { const img = uiArt.get('reel_' + r); return img ? `<img src="${img.src}" alt="" draggable="false">` : `<span>${REEL_SIGN[r]}</span>`; };
const REELS: Reel[] = ['cherry', 'lips', 'skull'];

/** The bottle's slices round the wheel, clockwise from the top, by their place in BOTTLE. */
const SLICE_PIC = ['wheel_toad', 'wheel_nerd', 'wheel_jock', 'wheel_drink'];

/** What the tattoo gives, for the hero slabs: how the hero stands on it now. */
function heroNow(h: HeroState, c: Choice) {
  const up = c.win.fx.find(f => f.k === 'up');
  if (up?.k === 'up' && up.stat) { const u = UPS.find(o => o.k === up.stat)!; return `«${u.name}»: уровень ${h.up[up.stat]}`; }
  return h.hp > 0 ? `${h.hp}/${h.max} HP` : 'пал';
}

export class EventView {
  onPick: (opt: number) => void = () => {};
  onLeave: () => void = () => {};
  /** What the play strip shows now, so a vote coming in doesn't play it over again. */
  private played = '';
  /** The goblin's shuffle under way: its timers, to stop when the window moves on. */
  private timers: number[] = [];

  constructor() {
    $('evOpts').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-opt]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.opt));
    });
    $('evPlay').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cup]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.cup));
    });
    $('evLeave').addEventListener('click', () => this.onLeave());
  }

  /**
   * `me` is the hero this screen speaks for: online the player's, for a party with one player the one whose trophy goes to
   * the pawnshop now. `votes` online shows who points at what.
   */
  render(ev: EventState, t: Table, me: HeroState | null, votes?: EventVotes) {
    const def = eventDef(ev.key), pic = eventArt.get(ev.key) ?? uiArt.get('room_event'), solo = t.party.length === 1;
    const img = $('evImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('evArt').classList.toggle('stub', !eventArt.has(ev.key));
    $('evTitle').textContent = def.title;
    const stage = stageOf(ev), done = stage === 'done';
    $('eventScreen').classList.toggle('done', done);
    this.play(ev, t, votes);
    // what the reels and the bottle settle on is told once they stop
    const wait = $('evPlay').dataset.wait === '1';
    $('evText').classList.toggle('ev-later', wait);
    $('evOpts').classList.toggle('ev-later', wait);
    if (done) {
      const d = doneOf(ev)!, h = t.party.find(o => o.i === d.who);
      const notes = (ev.done!.notes ?? []).map(n => `<em class="none">${n}</em>`).join(' ');
      $('evText').textContent = d.out.txt;
      $('evOpts').innerHTML = `<div class="ev-out"><b>${d.head}</b><span class="ev-fx">${ev.done!.cost ? line(ev.done!.cost, solo) + ' ' : ''}${line(d.out.fx, solo, d.pay, h && !solo ? h.def.dat : undefined)}</span>`
        + (notes ? `<span class="ev-fx">${notes}</span>` : '') + '</div>';
    } else if (stage === 'hero') {
      const c = choicesOf(ev)[ev.step!];
      $('evText').textContent = 'Скелет хлопает по кушетке: «Кто первый? Он же последний, краски на одного».';
      $('evOpts').innerHTML = `<p class="camp-ask">${c.label}: ${fxParts(c.win.fx, true).map(p => p.t).join(', ')}. Кому?</p>`
        + t.party.map(h => this.heroOpt(h, c, votes)).join('');
    } else if (stage === 'cups') {
      $('evText').textContent = 'Гоблин накрыл шарик стаканом: «Кручу-верчу!» Следи, под каким он окажется, и жми на этот стакан.';
      $('evOpts').innerHTML = '';
    } else if (stage === 'sell') {
      $('evText').textContent = 'Скелет протягивает костлявую ладонь: «Ну, показывай, что не жалко». Каждый сдаёт одну свою вещицу.';
      $('evOpts').innerHTML = this.sell(ev, t, me);
    } else {
      $('evText').textContent = sceneOf(ev);
      $('evOpts').innerHTML = choicesOf(ev).map((c, k) => this.option(c, k, t, solo, votes)).join('');
    }
    $('evLeave').hidden = !done;
    $('evNote').textContent = (!done && votes?.note) || '';
    $('evNote').hidden = done || !votes;
  }

  private option(c: Choice, k: number, t: Table, solo: boolean, votes?: EventVotes) {
    const why = shutWhy(c, t), need = needOf(c), one = solo ? undefined : 'одному герою';
    const fx = c.blind ? ''
      // the bottle's outcomes stand by its wheel: a slab says only how many of them it can land on
      : c.spread ? `<span class="ev-fx">${c.cost ? line(c.cost, solo) + ' ' : ''}<em class="mid">${c.spread.length === BOTTLE.length ? 'Любой из четырёх' : `${c.spread.map(o => o.name).join(', ')}: без Качка`}, по ${pct(c.spread[0].odds)}</em></span>`
      : c.then === 'cups' ? `<span class="ev-fx">${line([{ k: 'note', t: 'Угадаешь:', good: true }, ...c.win.fx], solo, c.pay)}</span>`
      : c.odds ? `<span class="ev-fx"><i class="odds">${pct(c.odds)}</i>${line(c.win.fx, solo, c.pay)}</span><span class="ev-fx"><i class="odds">${pct(1 - c.odds)}</i>${line(c.lose!.fx, solo, c.pay)}</span>`
      : `<span class="ev-fx">${line(c.win.fx, solo, c.pay, c.one ? one : undefined)}</span>`;
    const who = (votes?.faces[k] ?? []).map(p => `<img src="${p.face}" alt="" title="${p.name}" style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    return `<button class="ev-opt${votes?.mine === k ? ' mine' : ''}" data-opt="${k}"${why ? ' disabled' : ''}>`
      + `<b>${c.label}${need && !why ? `<i class="ev-need">${need}</i>` : ''}</b>${fx}${why ? `<small>${why}</small>` : ''}${who ? `<span class="ev-who">${who}</span>` : ''}</button>`;
  }

  /** A hero who could lie down on the tattooist's couch: face, name and where it stands on what the tattoo gives. */
  private heroOpt(h: HeroState, c: Choice, votes?: EventVotes) {
    const who = (votes?.faces[h.i] ?? []).map(p => `<img src="${p.face}" alt="" title="${p.name}" style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    return `<button class="ev-opt ev-hero${votes?.mine === h.i ? ' mine' : ''}" data-opt="${h.i}" style="--c:${h.def.col}">`
      + `<img class="ev-face" src="${faceUrl(h)}" alt=""><b>${h.def.name}</b><span class="ev-fx"><em class="none">${heroNow(h, c)}</em></span>`
      + (who ? `<span class="ev-who">${who}</span>` : '') + '</button>';
  }

  /** The pawnshop: this screen's hero's trophies to hand over, and who of the others has picked theirs. */
  private sell(ev: EventState, t: Table, me: HeroState | null) {
    const mine = me?.arts ?? [], picked = me ? ev.sold?.[me.i] : undefined, solo = t.party.length === 1;
    const ask = !me ? '' : !mine.length ? '<p class="camp-ask">Тебе сдавать нечего. Ждём остальных.</p>'
      : `<p class="camp-ask${solo ? '' : ' camp-for'}" style="--c:${me.def.col}">${solo ? '' : `<img src="${faceUrl(me)}" alt="">`}${solo ? 'Что сдаёшь?' : `Что сдаёт ${me.def.name}?`}</p>`;
    const opts = mine.map((k, i) => {
      const a = artDef(k);
      return `<button class="ev-opt loot-opt${picked === k ? ' mine' : ''}" data-opt="${i}" title="${a.gag}"><i class="loot-ico" aria-hidden="true">${artIcon(k)}</i>`
        + `<b>${a.name}</b><span class="ev-fx"><em class="good">+${SELL} руды</em><em class="bad">Пропадёт: ${a.txt}</em></span></button>`;
    }).join('');
    const others = t.party.filter(h => h !== me && h.arts?.length).map(h => {
      const k = ev.sold?.[h.i];
      return `<span class="camp-who" style="--c:${h.def.col}"><img src="${faceUrl(h)}" alt=""><b>${h.def.name}</b>${k ? `сдаёт «${artDef(k).name}»` : 'выбирает'}</span>`;
    }).join('');
    return ask + opts + (others ? `<div class="camp-party">${others}</div>` : '');
  }

  /** The strip between the scene and the choices: the riddle, the reels, the bottle, the cups; played once as it changes. */
  private play(ev: EventState, t: Table, votes?: EventVotes) {
    const box = $('evPlay'), stage = stageOf(ev), d = ev.done;
    const kind = ev.key === 'sphinx' ? 'riddle' : ev.key === 'slot' ? 'reels' : ev.key === 'bottle' && (!d || d.slice !== undefined) ? 'wheel'
      : ev.key === 'thimble' && (stage === 'cups' || d?.cup !== undefined) ? 'cups' : '';
    box.hidden = !kind;
    const key = `${ev.key}:${ev.seed}:${kind}:${ev.pulls ?? 0}:${stage}:${d?.slice ?? ''}:${d?.cup ?? ''}`;
    if (key === this.played) { if (kind === 'cups') this.cupFaces(votes); return; }
    this.played = key;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    box.dataset.wait = '';
    box.className = 'ev-play ' + kind;
    if (kind === 'riddle') {
      const r = riddleOf(ev.seed), each = t.party.length > 1 ? ' каждому' : '';
      box.innerHTML = `<p class="ev-riddle">«${r.q}»</p><p class="ev-fx"><em class="good">Отгадаешь: +1 уровень${each}</em> <em class="bad">Не отгадаешь: −4 HP${each}</em></p>`;
    } else if (kind === 'reels') this.reels(ev);
    else if (kind === 'wheel') this.wheel(ev, t.party.length === 1);
    else if (kind === 'cups') this.cups(ev, votes);
    else box.innerHTML = '';
  }

  /** The slot machine's three reels: spinning to the last pull's symbols, staggered, the first time they show them. */
  private reels(ev: EventState) {
    const box = $('evPlay'), end = reelsOf(ev), R = (k: number) => REELS[(ev.seed + k * 7) % 3];
    const spin = !!end;
    box.innerHTML = `<div class="ev-reels${end ? '' : ' idle'}">` + [0, 1, 2].map(k => {
      const last = end?.[k] ?? REELS[k % 2];
      const strip = spin ? [R(k), R(k + 1), R(k + 2), R(k + 3), R(k + 4), last] : [last];
      return `<div class="ev-reel"><div class="ev-strip${spin ? ' spin' : ''}" style="--n:${strip.length - 1};--d:${0.7 + k * 0.25}s">${strip.map(reelPic).join('')}</div></div>`;
    }).join('') + '</div>';
    if (spin) this.hold(1200);
  }

  /** The bottle in the middle of its four: it spins to where it stopped the first time it shows that. */
  private wheel(ev: EventState, solo: boolean) {
    const box = $('evPlay'), k = ev.done?.slice, bottle = uiArt.get('ev_bottle');
    const slices = BOTTLE.map((s, i) => {
      const img = uiArt.get(SLICE_PIC[i]);
      return `<div class="ev-slice s${i}${k === i ? ' hit' : ''}" title="${s.name}">${img ? `<img src="${img.src}" alt="" draggable="false">` : ''}<span>${s.name}</span></div>`;
    }).join('');
    const turn = k === undefined ? 0 : 1440 + k * 90;
    // before the spin, what each of the four does, by the wheel
    const legend = k !== undefined ? '' : '<ul class="ev-legend">' + BOTTLE.map(s =>
      `<li><b>${s.name}:</b> ${line(s.out.fx, solo, 0, s.one && !solo ? 'тому, на кого покажет' : undefined)}</li>`).join('') + '</ul>';
    box.innerHTML = `<div class="ev-wheel">${slices}<div class="ev-bottle" style="--a:0deg">${bottle ? `<img src="${bottle.src}" alt="" draggable="false">` : '<i></i>'}</div></div>${legend}`;
    if (k !== undefined) {
      const b = box.querySelector<HTMLElement>('.ev-bottle')!;
      requestAnimationFrame(() => requestAnimationFrame(() => { b.classList.add('go'); b.style.setProperty('--a', turn + 'deg'); }));
      this.hold(2300);
    }
  }

  /**
   * The goblin's cups: the ball shown under its cup, then the swaps one after another, then the cups to tap; once one is
   * picked, it and the cup with the ball are lifted. Every screen plays the same shuffle, from the room's seed.
   */
  private cups(ev: EventState, votes?: EventVotes) {
    const box = $('evPlay'), d = ev.done, c = choicesOf(ev)[d ? d.opt : ev.step!], sh = shuffleOf(ev.seed, c.cups ?? 0);
    const cup = uiArt.get('ev_cup'), face = cup ? `<img src="${cup.src}" alt="" draggable="false">` : '<i></i>';
    // cup k starts in place k, the ball under cup `start`; once it is over, the places are all that count
    box.innerHTML = '<div class="ev-cups">' + [0, 1, 2].map(k =>
      `<button class="ev-cup" data-cup="${k}" style="--x:${k}" disabled>${face}<span class="ev-who"></span></button>`).join('')
      + `<i class="ev-ball" style="--x:${d ? sh.ball : sh.start}"></i></div>`;
    const cups = [...box.querySelectorAll<HTMLButtonElement>('.ev-cup')], ball = box.querySelector<HTMLElement>('.ev-ball')!;
    if (d) {
      // the cup picked and the one over the ball come up
      for (const b of cups) if (Number(b.dataset.cup) === d.cup || Number(b.dataset.cup) === d.ball) b.classList.add('up');
      ball.classList.add('show');
      box.classList.toggle('won', d.won);
      return;
    }
    const later = (ms: number, f: () => void) => this.timers.push(window.setTimeout(f, ms));
    // the ball under its cup for a moment, then the swaps, then the cups to tap
    const lift = cups[sh.start];
    ball.classList.add('show');
    lift.classList.add('up');
    let t = 1100;
    later(t, () => { lift.classList.remove('up'); later(300, () => ball.classList.remove('show')); });
    t += 600;
    const pos = [0, 1, 2];
    box.style.setProperty('--ms', sh.ms + 'ms');
    for (const [a, b] of sh.swaps) {
      later(t, () => {
        const x = pos.indexOf(a), y = pos.indexOf(b);
        pos[x] = b; pos[y] = a;
        cups[x].style.setProperty('--x', String(b)); cups[x].dataset.cup = String(b);
        cups[y].style.setProperty('--x', String(a)); cups[y].dataset.cup = String(a);
        // one of the two goes round the front, the other round the back
        cups[x].classList.add('front'); cups[y].classList.remove('front');
      });
      t += sh.ms + 60;
    }
    later(t, () => { for (const b of cups) b.disabled = false; box.classList.add('ready'); this.cupFaces(votes); });
  }

  /** Online: the faces of the players over the cup each points at. */
  private cupFaces(votes?: EventVotes) {
    for (const b of document.querySelectorAll<HTMLElement>('#evPlay .ev-cup')) {
      const k = Number(b.dataset.cup), who = b.querySelector('.ev-who')!;
      b.classList.toggle('mine', votes?.mine === k);
      who.innerHTML = (votes?.faces[k] ?? []).map(p => `<img src="${p.face}" alt="" title="${p.name}" style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    }
  }

  /** The outcome waits under a veil while the reels or the bottle still turn. */
  private hold(ms: number) {
    const box = $('evPlay');
    box.dataset.wait = '1';
    this.timers.push(window.setTimeout(() => {
      box.dataset.wait = '';
      $('evText').classList.remove('ev-later');
      $('evOpts').classList.remove('ev-later');
    }, ms));
  }
}
