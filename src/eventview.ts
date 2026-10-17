// The event window over the map, laid out like Slay the Spire's: the picture with its gag on the left, the scene on the
// right and the choices under it. Once a choice is taken the same window tells what came of it.

import { eventArt, uiArt } from './assets';
import type { Bank } from './game';
import { canPick, eventDef, fxParts, type Choice, type EventState, type Fx } from './events';

const $ = (id: string) => document.getElementById(id)!;

/** Online: the faces of the players on the choices they point at, and a line on how the vote stands. */
export interface EventVotes {
  faces: Record<number, { col: string; name: string; face: string; me: boolean }[]>;
  /** The choice this player points at. */
  mine: number | null;
  note: string;
}

const pct = (x: number) => Math.round(x * 100) + '%';

/** What a choice or an outcome does, the good in green and the bad in red; what it costs in ore comes first. */
function line(fx: Fx[], solo: boolean, pay = 0) {
  const parts = fxParts(pay ? [{ k: 'ore', n: -pay }, ...fx] : fx, solo);
  return parts.length ? parts.map(p => `<em class="${p.good ? 'good' : 'bad'}">${p.t}</em>`).join(' ') : '<em class="none">Ничего не случится</em>';
}

export class EventView {
  onPick: (opt: number) => void = () => {};
  onLeave: () => void = () => {};

  constructor() {
    $('evOpts').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-opt]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.opt));
    });
    $('evLeave').addEventListener('click', () => this.onLeave());
  }

  render(ev: EventState, bank: Bank, solo: boolean, votes?: EventVotes) {
    const def = eventDef(ev.key), pic = eventArt.get(ev.key) ?? uiArt.get('room_event');
    const img = $('evImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('evArt').classList.toggle('stub', !eventArt.has(ev.key));
    $('evTitle').textContent = def.title;
    const done = ev.done;
    $('eventScreen').classList.toggle('done', !!done);
    if (done) {
      const c = def.choices[done.opt], out = done.won ? c.win : c.lose!;
      $('evText').textContent = out.txt;
      $('evOpts').innerHTML = `<div class="ev-out"><b>${c.label}${c.odds ? (done.won ? ': повезло' : ': не повезло') : ''}</b><span class="ev-fx">${line(out.fx, solo, c.pay)}</span></div>`;
    } else {
      $('evText').textContent = def.txt;
      $('evOpts').innerHTML = def.choices.map((c, k) => this.option(c, k, bank, solo, votes)).join('');
    }
    $('evLeave').hidden = !done;
    $('evNote').textContent = (!done && votes?.note) || '';
    $('evNote').hidden = !!done || !votes;
  }

  private option(c: Choice, k: number, bank: Bank, solo: boolean, votes?: EventVotes) {
    const shut = !canPick(c, bank);
    const fx = c.odds
      ? `<span class="ev-fx"><i class="odds">${pct(c.odds)}</i>${line(c.win.fx, solo, c.pay)}</span><span class="ev-fx"><i class="odds">${pct(1 - c.odds)}</i>${line(c.lose!.fx, solo, c.pay)}</span>`
      : `<span class="ev-fx">${line(c.win.fx, solo, c.pay)}</span>`;
    const who = (votes?.faces[k] ?? []).map(p => `<img src="${p.face}" alt="" title="${p.name}" style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    return `<button class="ev-opt${votes?.mine === k ? ' mine' : ''}" data-opt="${k}"${shut ? ' disabled' : ''}>`
      + `<b>${c.label}</b>${fx}${shut ? `<small>Нужно ${c.pay} руды</small>` : ''}${who ? `<span class="ev-who">${who}</span>` : ''}</button>`;
  }
}
