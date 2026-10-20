// The camp window over the map, in the event window's dress: the picture of the fire taped on the left, the scene and
// the things a hero can do by the fire on the right. A bandage is one slab that opens the pick of whom to bandage. Once
// this screen's hero has done one, the same window tells what came of it and, online, what the others are up to.
// Alone with a party (the campaign of two or three) the window asks for each hero in turn and then tells what came of it all.

import { eventArt, uiArt } from './assets';
import type { HeroState } from './game';
import { CAMP_HEAL, DIG_MAX, canCamp, type CampDid, type CampPick, type CampState } from './camp';
import { fillIcons } from './icons';
import { faceUrl } from './ui';

const $ = (id: string) => document.getElementById(id)!;

/** The scene by the fire. */
export const CAMP_TXT = 'Скелет жарит сосиски на чьём-то мече и сушит над огнём труселя в сердечко. Пахнет одновременно ужином и носками. В стене за костром блестит рудная жила, в неё кто-то вогнал топор.';

/** What came of a hero's own pick, told to its player: the scene, what was picked, and what it gave. */
function outcome(d: CampDid, party: HeroState[]) {
  if (d.k === 'rest') return { txt: 'Сосиска, тепло и полчаса храпа под треск поленьев. Раны затянулись.', label: 'Отдохнуть у огня', fx: `+${d.hp} HP`, good: true };
  if (d.k === 'mend') {
    const t = party.find(h => h.i === d.to)!;
    return { txt: 'Бинт нашёлся в чьих-то запасных труселях, но держит крепко.', label: `Перевязать ${t.def.acc}`, fx: `+${d.hp} HP ${t.def.dat}`, good: true };
  }
  return d.ore
    ? { txt: 'Пара взмахов кирки, пара крепких слов, и руда твоя.', label: 'Добыть руду', fx: `+${d.ore} руды`, good: true }
    : { txt: 'Кирка звякнула, искры полетели, а руды ни крошки: сверху лежала одна позолоченная галька. Зато размялись.', label: 'Добыть руду', fx: 'Ни крошки руды', good: false };
}

/** A teammate's pick in a few words, for the row under the outcome. */
function brief(d: CampDid | undefined, party: HeroState[]) {
  if (!d) return 'ещё у костра';
  if (d.k === 'rest') return `отдых, +${d.hp} HP`;
  if (d.k === 'mend') return `бинт ${party.find(h => h.i === d.to)!.def.dat}, +${d.hp} HP`;
  return d.ore ? `руда, +${d.ore}` : 'руда, пусто';
}

const hpBar = (h: HeroState) => {
  const hp = Math.max(0, h.hp);
  return `<span class="mp-hp"><i style="width:${(hp / h.max) * 100}%"></i><u>${h.hp > 0 ? `${hp}/${h.max}` : 'пал'}</u></span>`;
};

export class CampView {
  onPick: (pick: CampPick) => void = () => {};
  onLeave: () => void = () => {};
  /** Alone with a party: a tap on a hero still by the fire asks for that hero's pick next. */
  onFor: (hero: number) => void = () => {};
  /** The bandage slab was pressed: the window asks whom to bandage, at the camp with this seed, for this hero. */
  private mates = '';
  /** The last render's arguments, to draw the window again when the bandage pick opens or closes. */
  private last?: Parameters<CampView['render']>;

  constructor() {
    $('campOpts').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled || !this.last) return;
      if (b.dataset.mates != null || b.dataset.back != null) {
        this.mates = b.dataset.mates != null ? `${this.last[0].seed}:${this.last[1]?.i}` : '';
        this.render(...this.last);
        return;
      }
      const k = b.dataset.pick as CampPick['k'] | undefined;
      if (k) this.onPick(k === 'mend' ? { k, to: Number(b.dataset.to) } : { k });
    });
    $('campParty').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-for]');
      if (b) this.onFor(Number(b.dataset.for));
    });
    $('campLeave').addEventListener('click', () => this.onLeave());
  }

  /**
   * `me` is this screen's hero (none: nothing to do here but read); `party` the whole party; online `nameOf` gives
   * the players' names, and a pick sent to the host but not yet back is `asked`. With `team` one player picks for every
   * hero: `me` is the hero asked now (once all have picked, the last of them), and `nameOf` gives the heroes' names.
   */
  render(camp: CampState, me: HeroState | null, party: HeroState[], nameOf?: (h: HeroState) => string, asked?: CampPick, team = false) {
    this.last = [camp, me, party, nameOf, asked, team];
    const pic = eventArt.get('camp') ?? uiArt.get('room_camp'), img = $('campImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('campArt').classList.toggle('stub', !eventArt.has('camp'));
    const mine = me ? camp.did[me.i] : undefined, done = team ? party.every(h => camp.did[h.i]) : !me || !!mine;
    $('campScreen').classList.toggle('done', done);
    const others = party.filter(h => h !== me);
    if (team && done) {
      // the whole party has picked: what the last pick came to, and a line for every hero
      $('campText').textContent = mine ? outcome(mine, party).txt : CAMP_TXT;
      $('campOpts').innerHTML = party.map(h => {
        const o = outcome(camp.did[h.i], party);
        return `<div class="ev-out camp-out" style="--c:${h.def.col}"><img src="${faceUrl(h)}" alt=""><b>${o.label}</b><span class="ev-fx"><em class="${o.good ? 'good' : 'none'}">${o.fx}</em></span></div>`;
      }).join('');
    } else if (mine) {
      const o = outcome(mine, party);
      $('campText').textContent = o.txt;
      $('campOpts').innerHTML = `<div class="ev-out"><b>${o.label}</b><span class="ev-fx"><em class="${o.good ? 'good' : 'none'}">${o.fx}</em></span></div>`;
    } else if (me) {
      $('campText').textContent = CAMP_TXT;
      const mates = this.mates === `${camp.seed}:${me.i}` && others.length > 0;
      // for a party the window says whose pick it asks for
      const ask = !team ? '' : `<p class="camp-ask camp-for" style="--c:${me.def.col}"><img src="${faceUrl(me)}" alt="">${mates ? `Кого перевяжет ${me.def.name}?` : `Что сделает ${me.def.name}?`}</p>`;
      $('campOpts').innerHTML = ask + (mates ? this.matePick(me, party, others, asked, team) : this.options(me, party, others, asked));
    } else {
      $('campText').textContent = CAMP_TXT;
      $('campOpts').innerHTML = '';
    }
    // online: what each of the others does by the fire, and who is still deciding; for a party a tap on a hero still by the
    // fire asks for that hero's pick
    const row = nameOf && others.length && !(team && done)
      ? others.map(h => {
        const tag = team && !camp.did[h.i] ? 'button' : 'span';
        return `<${tag} class="camp-who${h.hp <= 0 ? ' dead' : ''}" style="--c:${h.def.col}"${tag === 'button' ? ` data-for="${h.i}"` : ''}><img src="${faceUrl(h)}" alt=""><b>${nameOf(h)}</b> ${brief(camp.did[h.i], party)}</${tag}>`;
      }).join('')
      : '';
    $('campParty').innerHTML = row;
    $('campParty').hidden = !row;
    $('campLeave').hidden = !done;
    fillIcons($('campScreen'));
  }

  /** A slab for one pick: its sticker, what it is, and what it gives, or why it is shut. */
  private opt(me: HeroState, party: HeroState[], pick: CampPick, art: string, label: string, fx: string, shut: string, asked?: CampPick, extra = '') {
    const off = !canCamp(me, pick, party);
    const to = pick.k === 'mend' ? ` data-to="${pick.to}"` : '';
    const was = asked?.k === pick.k && (pick.k !== 'mend' || (asked.k === 'mend' && asked.to === pick.to));
    return `<button class="ev-opt camp-opt${was ? ' mine' : ''}" data-pick="${pick.k}"${to}${off || asked ? ' disabled' : ''}>`
      + `<i data-art="${art}" aria-hidden="true"></i><b>${label}</b>${off ? `<small>${shut}</small>` : `<span class="ev-fx">${fx}</span>`}${extra}</button>`;
  }

  private options(me: HeroState, party: HeroState[], others: HeroState[], asked?: CampPick) {
    const fallen = me.hp <= 0;
    const rest = fallen
      ? this.opt(me, party, { k: 'rest' }, 'camp_rest', 'Встать на ноги', `<em class="good">Половина здоровья</em>`, '', asked)
      : this.opt(me, party, { k: 'rest' }, 'camp_rest', 'Отдохнуть у огня', `<em class="good">+${Math.min(CAMP_HEAL, me.max - me.hp)} HP</em>`, 'Здоровье и так полное', asked);
    // one bandage slab, which opens the pick of whom to bandage, for a party of two or three
    let mend = '';
    if (others.length) {
      const can = others.some(t => canCamp(me, { k: 'mend', to: t.i }, party));
      mend = `<button class="ev-opt camp-opt${asked?.k === 'mend' ? ' mine' : ''}" data-mates${can && !asked ? '' : ' disabled'}>`
        + `<i data-art="camp_mend" aria-hidden="true"></i><b>Перевязать товарища</b>`
        + (can ? `<span class="ev-fx"><em class="good">+${CAMP_HEAL} HP, кому выберешь</em></span>` : `<small>${fallen ? 'Сначала встань сам' : 'Все и так целы'}</small>`) + '</button>';
    }
    const dig = this.opt(me, party, { k: 'dig' }, 'camp_dig', 'Добыть руду', `<em class="good">+0–${DIG_MAX} руды, как повезёт</em>`, 'Сначала встань на ноги', asked);
    return rest + mend + dig;
  }

  /** Whom to bandage: a slab for each teammate with their face and health, and the way back to the other picks. */
  private matePick(me: HeroState, party: HeroState[], others: HeroState[], asked?: CampPick, team = false) {
    const fallen = me.hp <= 0;
    // for a party the question over the slabs already names who bandages
    return (team ? '' : '<p class="camp-ask">Кого перевязать?</p>') + others.map(t => this.opt(me, party, { k: 'mend', to: t.i }, 'camp_mend', t.hp > 0 ? `Перевязать ${t.def.acc}` : `Поднять ${t.def.acc}`,
      `<em class="good">${t.hp > 0 ? `+${Math.min(CAMP_HEAL, t.max - t.hp)} HP ${t.def.dat}` : 'Встанет с половиной здоровья'}</em>`,
      fallen ? 'Сначала встань сам' : 'Здоровье и так полное', asked,
      `<span class="camp-mate" style="--c:${t.def.col}"><img src="${faceUrl(t)}" alt="">${hpBar(t)}</span>`)).join('')
      + `<button class="ev-opt camp-back" data-back${asked ? ' disabled' : ''}><b>Назад</b></button>`;
  }
}
