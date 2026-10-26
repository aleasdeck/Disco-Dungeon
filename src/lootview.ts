// The window of the floor boss's trophies, in the event window's dress: the boss's hoard taped on the left, the floor
// cleared and the scene on the right, and a slab for each trophy under it (an event's trophies come under the event's
// picture and name). Alone a tap takes one; online each player points at the one for their own hero, and once nobody
// shares a pick the trophies are handed out. Alone with a party the player picks one for each hero in turn. Then the
// same window tells who got what. Online a player who was away at the share-out gets the trophies kept for their hero in
// it once back, and picks their own.

import { eventArt, uiArt } from './assets';
import { PASS, UNDO, artDef, type ArtKey, type LootState } from './artifacts';
import { eventDef } from './events';
import type { HeroState } from './game';
import { artIcon } from './icons';
import { faceUrl } from './ui';
import { t } from './i18n';
import { tipAttrs } from './tip';

const $ = (id: string) => document.getElementById(id)!;

/** The boss's hoard after the fight, by the boss that fell; its picture is `loot_<boss>` among the events in the manifest. */
const SCENES: Record<string, string> = {
  king: 'Король-в-короне грохнулся с трона, корона укатилась под лавку. Под мантией нашёлся сундучок с личными вещами его величества: всё подписано, всё немного липкое.',
  ratswarm: 'Крысиная свора разбежалась по норам, самые медленные прилегли кверху пузом. В гнезде из краденых носков нашлась их общая заначка. Пахнет так себе, зато блестит.',
  pahan: 'Пахан прилёг на пол и больше не командует. Под матрасом у него нашёлся общак: вся отжатая руда и пара вещиц на чёрный день. День настал.',
  lich: 'Ледяной лич рассыпался горкой инея. В его морозилке, между пельменями и чьей-то челюстью, лежат странные штуки. Холодные, но в хозяйстве пригодятся.',
  fridge: 'Холодильник-людоед опрокинулся кверху валенками и потёк от обиды. Из него вывалились огурцы, курица и всё, что он так и не смог переварить.',
  dancer: 'Мёртвый танцор диско рухнул посреди танцпола, штаны лопнули первыми. Из карманов пиджака высыпалось всё, что ему кидали поклонницы.',
};

/** Whose hoard a save from before the boss was written down shows: the floor's first boss. */
const FLOOR_BOSS = ['king', 'lich'];

/** Trophies an event gave: what the party finds, by the event's key. */
const FOUND: Record<string, string> = {
  mimic: 'На бархатном дне сундука лежат подарки от прошлых ухажёров, все с бантиками и записками. Сундук краснеет и разрешает взять.',
  pawn: 'Руда уплачена. Скелет снимает с полки три вещицы и раскладывает на бархатной тряпочке: «Бери одну. Остальное не лапать».',
  slot: 'Из лотка Люськи вывалился джекпот: три вещицы в ленточках, тёплые и немного липкие. Бери, пока она не передумала.',
};



/** Online: the faces of the players on the trophies they point at, and a line on how the share-out stands. */
export interface LootVotes {
  faces: Record<number, { col: string; name: string; face: string; me: boolean }[]>;
  mine: number | null;
  note: string;
}

export class LootView {
  onPick: (opt: number) => void = () => {};
  /** A hero with all sockets taken throws this trophy of its own away for the one picked. */
  onDrop: (k: ArtKey) => void = () => {};
  onLeave: () => void = () => {};

  constructor() {
    $('lootOpts').addEventListener('click', e => {
      const d = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-drop]');
      if (d) return this.onDrop(d.dataset.drop as ArtKey);
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-opt]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.opt));
    });
    $('lootLeave').addEventListener('click', () => this.onLeave());
  }

  /**
   * `me` is this screen's hero; online `nameOf` gives the players' names and `votes` the picks as they stand. With `team`
   * one player picks for every hero: `me` is the hero whose trophy is picked now, and `votes` shows the heroes' picks.
   * With `kept` the trophies are the ones kept for `me` while their player was away.
   */
  render(loot: LootState, me: HeroState | null, party: HeroState[], votes?: LootVotes, nameOf?: (h: HeroState) => string, team = false, kept = false) {
    // an event's trophies come with the event's own picture and name
    const boss = loot.boss ?? FLOOR_BOSS[loot.floor] ?? FLOOR_BOSS[0];
    const key = loot.from ?? `loot_${boss}`, pic = eventArt.get(key) ?? uiArt.get(loot.from ? 'room_event' : 'room_boss'), img = $('lootImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('lootArt').classList.toggle('stub', !eventArt.has(key));
    $('lootTitle').textContent = loot.from ? t(eventDef(loot.from).title) : t('Этаж {0} пройден', loot.floor + 1);
    const solo = party.length === 1, done = loot.done;
    // the boss gave every hero back half their health as it fell (Game.bossHeal)
    const healed = solo ? t('{0} {1?восстановила|восстановил} половину здоровья.', party[0].def.name, party[0].def.fem) : t('Герои восстановили половину здоровья.');
    const nm = (h: HeroState) => nameOf?.(h) ?? t(h.def.name);
    $('lootScreen').classList.toggle('done', !!done);
    if (done) {
      const mine = me ? done[me.i] : undefined;
      $('lootText').textContent = t(mine ? artDef(mine).gag : 'Трофеи поделены.');
      // what this screen's hero took first, then the others'; a trophy nobody took stays with the boss
      const order = me ? [me, ...party.filter(h => h !== me)] : party;
      // a hero whose player was away still has their own to pick once back
      const away = party.filter(h => !done[h.i] && h.kept?.seed === loot.seed);
      $('lootOpts').innerHTML = order.filter(h => done[h.i]).map(h => this.got(h, done[h.i], h === me || solo ? '' : nm(h), loot.drops?.[h.i])).join('')
        + away.map(h => `<p class="camp-ask">${t('{0} выберет свой трофей, когда вернётся.', nm(h))}</p>`).join('')
        + order.filter(h => loot.picks[h.i] === PASS).map(h => `<p class="camp-ask">${h === me && !team ? t('Ты оставляешь свои три трофея.') : t('{0} оставляет свои три трофея.', nm(h))}</p>`).join('');
    } else {
      $('lootText').textContent = kept ? t('Пока тебя не было, остальные разобрали свои трофеи. Твой отложили до твоего возвращения.')
        : loot.from ? t(FOUND[loot.from] ?? 'Здесь нашлись трофеи.') : `${t(SCENES[boss] ?? SCENES.king)} ${healed}`;
      // a hero with all sockets taken takes a new one for one of its own, or keeps its own
      const full = !kept && !!me && !!loot.full?.includes(me.i), p = me ? loot.picks[me.i] : undefined, out = me ? loot.drops?.[me.i] : undefined;
      const face = team && me ? `<img src="${faceUrl(me)}" alt="">` : '', whose = team && me ? me.def.dat : '';
      const head = (ask: string) => `<p class="camp-ask${face ? ' camp-for' : ''}"${me ? ` style="--c:${me.def.col}"` : ''}>${face}${ask}</p>`;
      if (full && me && p !== undefined && p >= 0 && !out) {
        $('lootOpts').innerHTML = head(t('Все три гнезда заняты. Что выбросить ради «{0}»?', artDef(loot.offer[p]).name))
          + (me.arts ?? []).map(k => this.dropOpt(k)).join('')
          + `<button class="ev-opt camp-back" data-opt="${UNDO}"><b>${t('Передумать')}</b></button>`;
      } else {
        const ask = full ? (out && p !== undefined && p >= 0 ? t('Берёшь «{0}» вместо «{1}»', artDef(loot.offer[p]).name, artDef(out).name)
          : whose ? t('Выбери трофей {0}: все три гнезда заняты, новый встанет вместо одного из своих', whose) : t('Все три гнезда заняты: новый трофей встанет вместо одного из своих'))
          : solo || kept ? t('Забери один трофей') : team && me ? t('Выбери трофей {0}', me.def.dat) : t('Каждый берёт по трофею');
        $('lootOpts').innerHTML = head(ask) + loot.offer.map((k, i) => this.option(k, i, votes)).join('')
          + (full ? `<button class="ev-opt camp-back${p === PASS ? ' mine' : ''}" data-opt="${PASS}"><b>${t('Оставить свои')}</b></button>` : '');
      }
    }
    $('lootNote').textContent = (!done && votes?.note) || '';
    $('lootNote').hidden = !!done || !votes?.note;
    $('lootLeave').hidden = !done;
  }

  /** One of a full hero's own trophies, to throw away for the new one. */
  private dropOpt(k: string) {
    const a = artDef(k);
    return `<button class="ev-opt loot-opt" data-drop="${k}"${tipAttrs({ p: t(a.gag) })}><i class="loot-ico" aria-hidden="true">${artIcon(k)}</i>`
      + `<b>${t(a.name)}</b><span class="ev-fx"><em class="bad">${t('Выбросить: {0}', a.txt)}</em></span></button>`;
  }

  private option(k: string, i: number, votes?: LootVotes) {
    const a = artDef(k);
    const who = (votes?.faces[i] ?? []).map(p => `<img src="${p.face}" alt=""${tipAttrs({ h: p.name })} style="--c:${p.col}"${p.me ? ' class="me"' : ''}>`).join('');
    return `<button class="ev-opt loot-opt${votes?.mine === i ? ' mine' : ''}${who ? ' picked' : ''}" data-opt="${i}"${tipAttrs({ p: t(a.gag) })}>`
      + `<i class="loot-ico" aria-hidden="true">${artIcon(k)}</i><b>${t(a.name)}</b><span class="ev-fx"><em class="good">${t(a.txt)}</em></span>`
      + (who ? `<span class="ev-who">${who}</span>` : '') + '</button>';
  }

  /** A trophy a hero took: its picture, its name, what it does, and online whose it is. */
  private got(h: HeroState, k: string, who: string, out?: string) {
    const a = artDef(k);
    return `<div class="ev-out loot-opt loot-got"><i class="loot-ico" aria-hidden="true">${artIcon(k)}</i>`
      + `<b>${t(a.name)}</b><span class="ev-fx"><em class="good">${t(a.txt)}</em>${out ? `<em class="bad">${t('вместо «{0}»', artDef(out).name)}</em>` : ''}</span>`
      + (who ? `<span class="loot-whose" style="--c:${h.def.col}"><img src="${faceUrl(h)}" alt="">${who}</span>` : '') + '</div>';
  }
}
