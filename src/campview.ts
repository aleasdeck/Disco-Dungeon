// The camp window over the map, in the event window's dress: the picture of the fire taped on the left, the scene and
// the things a hero can do by the fire on the right. Once this screen's hero has done one, the same window tells what
// came of it and, online, what the others are up to.

import { eventArt, uiArt } from './assets';
import type { HeroState } from './game';
import { CAMP_HEAL, DIG_MAX, canCamp, type CampDid, type CampPick, type CampState } from './camp';
import { fillIcons } from './icons';
import { faceUrl } from './ui';

const $ = (id: string) => document.getElementById(id)!;

/** The scene by the fire. */
export const CAMP_TXT = 'У огня храпит гоблин в труселях в сердечко, а скелет жарит над ним зефир. Рядом куча руды и чья-то кирка: хозяин спит, хозяин не узнает.';

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

  constructor() {
    $('campOpts').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pick]');
      if (!b || b.disabled) return;
      const k = b.dataset.pick as CampPick['k'];
      this.onPick(k === 'mend' ? { k, to: Number(b.dataset.to) } : { k });
    });
    $('campLeave').addEventListener('click', () => this.onLeave());
  }

  /**
   * `me` is this screen's hero (none: nothing to do here but read); `party` the whole party; online `nameOf` gives
   * the players' names, and a pick sent to the host but not yet back is `asked`.
   */
  render(camp: CampState, me: HeroState | null, party: HeroState[], nameOf?: (h: HeroState) => string, asked?: CampPick['k']) {
    const pic = eventArt.get('camp') ?? uiArt.get('room_camp'), img = $('campImg') as HTMLImageElement;
    if (pic && img.getAttribute('src') !== pic.src) img.src = pic.src;
    img.hidden = !pic;
    $('campArt').classList.toggle('stub', !eventArt.has('camp'));
    const mine = me ? camp.did[me.i] : undefined, done = !me || !!mine;
    $('campScreen').classList.toggle('done', done);
    const others = party.filter(h => h !== me);
    if (mine) {
      const o = outcome(mine, party);
      $('campText').textContent = o.txt;
      $('campOpts').innerHTML = `<div class="ev-out"><b>${o.label}</b><span class="ev-fx"><em class="${o.good ? 'good' : 'none'}">${o.fx}</em></span></div>`;
    } else if (me) {
      $('campText').textContent = CAMP_TXT;
      $('campOpts').innerHTML = this.options(me, party, others, asked);
    } else {
      $('campText').textContent = CAMP_TXT;
      $('campOpts').innerHTML = '';
    }
    // online: what each of the others does by the fire, and who is still deciding
    const row = nameOf && others.length
      ? others.map(h => `<span class="camp-who${h.hp <= 0 ? ' dead' : ''}" style="--c:${h.def.col}"><img src="${faceUrl(h)}" alt=""><b>${nameOf(h)}</b> ${brief(camp.did[h.i], party)}</span>`).join('')
      : '';
    $('campParty').innerHTML = row;
    $('campParty').hidden = !row;
    $('campLeave').hidden = !done;
    fillIcons($('campScreen'));
  }

  private options(me: HeroState, party: HeroState[], others: HeroState[], asked?: CampPick['k']) {
    const opt = (pick: CampPick, art: string, label: string, fx: string, shut: string, extra = '') => {
      const off = !canCamp(me, pick, party);
      const to = pick.k === 'mend' ? ` data-to="${pick.to}"` : '';
      return `<button class="ev-opt camp-opt${asked === pick.k ? ' mine' : ''}" data-pick="${pick.k}"${to}${off || asked ? ' disabled' : ''}>`
        + `<i data-art="${art}" aria-hidden="true"></i><b>${label}</b>${off ? `<small>${shut}</small>` : `<span class="ev-fx">${fx}</span>`}${extra}</button>`;
    };
    const fallen = me.hp <= 0;
    const rest = fallen
      ? opt({ k: 'rest' }, 'camp_rest', 'Встать на ноги', `<em class="good">Половина здоровья</em>`, '')
      : opt({ k: 'rest' }, 'camp_rest', 'Отдохнуть у огня', `<em class="good">+${Math.min(CAMP_HEAL, me.max - me.hp)} HP</em>`, 'Здоровье и так полное');
    // a bandage for each teammate: the party has more than one hero only online
    const mend = others.map(t => opt({ k: 'mend', to: t.i }, 'camp_mend', t.hp > 0 ? `Перевязать ${t.def.acc}` : `Поднять ${t.def.acc}`,
      `<em class="good">${t.hp > 0 ? `+${Math.min(CAMP_HEAL, t.max - t.hp)} HP ${t.def.dat}` : 'Встанет с половиной здоровья'}</em>`,
      fallen ? 'Сначала встань сам' : 'Здоровье и так полное',
      `<span class="camp-mate" style="--c:${t.def.col}"><img src="${faceUrl(t)}" alt="">${hpBar(t)}</span>`)).join('');
    const dig = opt({ k: 'dig' }, 'camp_dig', 'Добыть руду', `<em class="good">+0–${DIG_MAX} руды, как повезёт</em>`, 'Сначала встань на ноги');
    return rest + mend + dig;
  }
}
