// The window of the floor boss's trophies, in the event window's dress: the boss's hoard taped on the left, the floor
// cleared and the scene on the right, and a slab for each trophy under it (an event's trophies come under the event's
// picture and name). Alone a tap takes one; online each player points at the one for their own hero, and once nobody
// shares a pick the trophies are handed out. Then the same window tells who got what.

import { eventArt, uiArt } from './assets';
import { artDef, type LootState } from './artifacts';
import { eventDef } from './events';
import type { HeroState } from './game';
import { artIcon } from './icons';
import { faceUrl } from './ui';

const $ = (id: string) => document.getElementById(id)!;

/** The boss's hoard after the fight, by the floor whose boss fell. */
const SCENES = [
  'Король-в-короне грохнулся с трона, корона укатилась под лавку. Под мантией нашёлся сундучок с личными вещами его величества: всё подписано, всё немного липкое.',
  'Ледяной лич рассыпался горкой инея. В его морозилке, между пельменями и чьей-то челюстью, лежат странные штуки. Холодные, но в хозяйстве пригодятся.',
  'Владыка кузни остыл и треснул пополам. Из трещины вываливается всё, что он годами прятал от гномов.',
];

/** Picture of the hoard by the floor (events in the manifest), until painted the boss room's sticker. */
const ART = ['loot_king', 'loot_lich', 'loot_forge'];

/** Trophies an event gave: what the party finds, by the event's key. */
const FOUND: Record<string, string> = {
  mimic: 'На бархатном дне сундука лежат подарки от прошлых ухажёров, все с бантиками и записками. Сундук краснеет и разрешает взять.',
};

/** Online: the faces of the players on the trophies they point at, and a line on how the share-out stands. */
export interface LootVotes {
  faces: Record<number, { col: string; name: string; face: string; me: boolean }[]>;
  mine: number | null;
  note: string;
}

export class LootView {
  onPick: (opt: number) => void = () => {};
  onLeave: () => void = () => {};

  constructor() {
    $('lootOpts').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-opt]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.opt));
    });
    $('lootLeave').addEventListener('click', () => this.onLeave());
  }

  /** `me` is this screen's hero; online `nameOf` gives the players' names and `votes` the picks as they stand. */
  render(loot: LootState, me: HeroState | null, party: HeroState[], votes?: LootVotes, nameOf?: (h: HeroState) => string) {
    // an event's trophies come with the event's own picture and name
    const key = loot.from ?? ART[loot.floor] ?? ART[0], pic = eventArt.get(key) ?? uiArt.get(loot.from ? 'room_event' : 'room_boss'), img = $('lootImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('lootArt').classList.toggle('stub', !eventArt.has(key));
    $('lootTitle').textContent = loot.from ? eventDef(loot.from).title : `Этаж ${loot.floor + 1} пройден`;
    const solo = party.length === 1, done = loot.done;
    // the boss gave every hero back half their health as it fell (Game.bossHeal)
    const healed = solo ? `${party[0].def.name} ${party[0].def.fem ? 'восстановила' : 'восстановил'} половину здоровья.` : 'Герои восстановили половину здоровья.';
    $('lootScreen').classList.toggle('done', !!done);
    if (done) {
      const mine = me ? done[me.i] : undefined;
      $('lootText').textContent = mine ? artDef(mine).gag : 'Трофеи поделены.';
      // what this screen's hero took first, then the others'; a trophy nobody took stays with the boss
      const order = me ? [me, ...party.filter(h => h !== me)] : party;
      $('lootOpts').innerHTML = order.filter(h => done[h.i]).map(h => this.got(h, done[h.i], h === me || solo ? '' : nameOf?.(h) ?? h.def.name)).join('');
    } else {
      $('lootText').textContent = loot.from ? FOUND[loot.from] ?? 'Здесь нашлись трофеи.' : `${SCENES[loot.floor] ?? SCENES[0]} ${healed}`;
      $('lootOpts').innerHTML = `<p class="camp-ask">${solo ? 'Забери один трофей' : 'Каждый берёт по трофею'}</p>`
        + loot.offer.map((k, i) => this.option(k, i, votes)).join('');
    }
    $('lootNote').textContent = (!done && votes?.note) || '';
    $('lootNote').hidden = !!done || !votes;
    $('lootLeave').hidden = !done;
  }

  private option(k: string, i: number, votes?: LootVotes) {
    const a = artDef(k);
    const who = (votes?.faces[i] ?? []).map(p => `<img src="${p.face}" alt="" title="${p.name}" style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    return `<button class="ev-opt loot-opt${votes?.mine === i ? ' mine' : ''}${who ? ' picked' : ''}" data-opt="${i}" title="${a.gag}">`
      + `<i class="loot-ico" aria-hidden="true">${artIcon(k)}</i><b>${a.name}</b><span class="ev-fx"><em class="good">${a.txt}</em></span>`
      + (who ? `<span class="ev-who">${who}</span>` : '') + '</button>';
  }

  /** A trophy a hero took: its picture, its name, what it does, and online whose it is. */
  private got(h: HeroState, k: string, who: string) {
    const a = artDef(k);
    return `<div class="ev-out loot-opt loot-got"><i class="loot-ico" aria-hidden="true">${artIcon(k)}</i>`
      + `<b>${a.name}</b><span class="ev-fx"><em class="good">${a.txt}</em></span>`
      + (who ? `<span class="loot-whose" style="--c:${h.def.col}"><img src="${faceUrl(h)}" alt="">${who}</span>` : '') + '</div>';
  }
}
