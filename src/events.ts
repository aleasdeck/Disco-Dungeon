// Events on the run map, the way Slay the Spire shows them: a picture with a gag, the scene, and a few choices.
// A choice may be safe, may cost ore, or may be a toss-up between a good and a bad outcome. Effects on heroes reach
// every hero of the party, ore goes to or from the party's shared pool.

import { AB_COST, E_MAX, HAND_MAX, UPS, UP_COST, type StatKey } from './data';
import type { Bank, HeroState } from './game';
import { makeRng } from './rng';

export type Fx =
  /** Health now; a loss never takes a hero below 1, and the fallen stay down. */
  | { k: 'hp'; n: number }
  /** Full health; the fallen get up. */
  | { k: 'heal' }
  /** Most health; a gain heals by as much, a loss cuts what is over the new top. */
  | { k: 'max'; n: number }
  | { k: 'ore'; n: number }
  /** Every hero starts the next fight with full sparks. */
  | { k: 'sparks' }
  /** Every hero starts the next fight with this much shield: it takes the enemies' first blows. */
  | { k: 'shield'; n: number }
  /** The next fight's enemies hit this much harder. */
  | { k: 'rage'; n: number }
  /** «Дым-машина»: the next fight is in smoke, seen only a few steps around the heroes. */
  | { k: 'smoke' }
  /** «Стробоскоп»: the next fight has no aiming line. */
  | { k: 'strobe' }
  /** A free level of a disc stat; without `stat`, a level of whatever each hero can still grow, picked at random. */
  | { k: 'up'; stat?: StatKey }
  /** One more disc a turn. */
  | { k: 'disc' }
  /** A trophy: after the event the party shares out three, the same way as over a floor boss (src/artifacts.ts). */
  | { k: 'art' };

export interface Outcome { fx: Fx[]; txt: string }

export interface Choice {
  label: string;
  /** Ore it costs; with less in the pool the choice is shut. */
  pay?: number;
  /** A toss-up: `win` comes with this chance, `lose` otherwise. */
  odds?: number;
  win: Outcome;
  lose?: Outcome;
}

export interface EventDef { key: string; title: string; txt: string; choices: Choice[] }

/** The event the party stands in, the same on every screen: the host settles it and shares it with the map. */
export interface EventState {
  key: string;
  /** The room's seed: toss-ups and random upgrades roll from it. */
  seed: number;
  /** Online: the choice each player points at, by hero; the party takes one once everyone at the table points at it. */
  votes: Record<number, number>;
  /** Once taken: which choice, and whether its toss-up came out well. */
  done?: { opt: number; won: boolean };
}

export const EVENTS: EventDef[] = [
  {
    key: 'bar', title: 'Бар «Последний глоток»',
    txt: 'За стойкой из бочек скелет в бабочке протирает кружку-череп. «Фирменный „Последний глоток“! — скрипит он. — Первый за счёт заведения. Последний тоже». В бокале что-то зелёное шевелит зонтиком.',
    choices: [
      {
        label: 'Выпить залпом', odds: 0.5,
        win: { fx: [{ k: 'hp', n: 10 }], txt: 'Горло обожгло до пяток, зато раны затянулись сами. Скелет одобрительно цокает челюстью.' },
        lose: { fx: [{ k: 'hp', n: -3 }, { k: 'strobe' }], txt: 'Зонтик оказался живым и полез обратно. Перед глазами всё мигает, как под стробоскопом: прицел в следующем бою не поймать.' },
      },
      {
        label: 'Фирменное с закуской', pay: 4,
        win: { fx: [{ k: 'max', n: 3 }, { k: 'hp', n: 5 }], txt: 'Скелет попробовал руду на зуб и налил с горкой. Закуска подмигивала, но была очень сытной.' },
      },
      { label: 'Уйти трезвым', win: { fx: [], txt: '«Трезвый в подземелье — покойник на полставки», — кричит вслед бармен.' } },
    ],
  },
  {
    key: 'mimic', title: 'Влюблённый сундук',
    txt: 'Сундук хлопает крышкой и строит глазки. Крышка вся в следах помады, изнутри что-то блестит и капают слюни. Похоже, он ждёт, что его приласкают.',
    choices: [
      {
        label: 'Сунуть руку', odds: 0.5,
        win: { fx: [{ k: 'art' }], txt: 'Сундук томно вздохнул и раскрыл душу: внутри подарки от прошлых ухажёров. Руку потом отмывали долго.' },
        lose: { fx: [{ k: 'hp', n: -6 }], txt: 'Сундук решил, что это предложение руки и сердца, и начал с руки.' },
      },
      {
        label: 'Поцеловать в крышку',
        win: { fx: [{ k: 'ore', n: 4 }, { k: 'hp', n: -2 }], txt: 'Поцелуй вышел долгим и с языком. Сундук покраснел, выплюнул пару самородков и оставил засос на память.' },
      },
      { label: 'Не связываться', win: { fx: [], txt: 'Сундук обиженно захлопнулся и смотрел вслед до самой двери.' } },
    ],
  },
  {
    key: 'altar', title: 'Алтарь диско-бога',
    txt: 'Над алтарём крутится зеркальный шар, а жрец-скелет в клешах шепчет: «Диско-бог любит жертвы. Ну, или хотя бы танцы». На алтаре уже лежат бутерброд, носок и чья-то вставная челюсть.',
    choices: [
      { label: 'Станцевать', win: { fx: [{ k: 'sparks' }], txt: 'Вы выдали такое, что шар заискрил, а жрец прослезился. Искры гудят в пальцах до самого боя.' } },
      {
        label: 'Пожертвовать руду', pay: 5,
        win: { fx: [{ k: 'sparks' }, { k: 'shield', n: 8 }], txt: 'Диско-бог принял подношение и подмигнул всеми гранями. Следующий бой вы начнёте под его крылом.' },
      },
      {
        label: 'Стащить подношения',
        win: { fx: [{ k: 'ore', n: 4 }, { k: 'rage', n: 1 }], txt: 'Золотой зуб из челюсти пошёл в дело, бутерброд так себе. Диско-бог всё видел и шепнул врагам пару слов.' },
      },
    ],
  },
  {
    key: 'doctor', title: 'Чумной доктор',
    txt: 'Тип в клюве распахивает плащ, как торговец часами: пилюли, пиявки и клизма размером с ведро. «Лечу всё, кроме смерти. Смерть тоже лечу, но по предоплате».',
    choices: [
      { label: 'Пилюлю', win: { fx: [{ k: 'max', n: 2 }], txt: 'Пилюля размером с кулак прошла со второго раза. Организм решил, что лучше окрепнуть, чем повторять.' } },
      {
        label: 'Клизму', pay: 4,
        win: { fx: [{ k: 'heal' }], txt: 'Процедура заняла минуту, а воспоминаний хватит на всю жизнь. Зато всё как новенькое, даже у павших.' },
      },
      {
        label: 'Пиявок',
        win: { fx: [{ k: 'hp', n: -5 }, { k: 'max', n: 5 }], txt: 'Пиявки высосали всю дурную кровь и немного хорошей. Зато в освободившееся место влезет больше.' },
      },
      { label: 'Послать к чёрту', win: { fx: [], txt: '«Ещё приползёте», — доктор запахивает плащ, и в нём что-то булькает.' } },
    ],
  },
  {
    key: 'gym', title: 'Качалка «Железный череп»',
    txt: 'Скелет в повязке жмёт от груди два валуна и рычит: «Без мяса качаться вдвое тяжелее, бро!» Рядом свободная скамья и банка протеина, в которой что-то шевелится.',
    choices: [
      {
        label: 'Пожать валуны',
        win: { fx: [{ k: 'up', stat: 'm' }, { k: 'hp', n: -6 }], txt: 'Пресс не появился, зато появились грыжа и уважение скелета. Броски теперь тяжелее.' },
      },
      {
        label: 'Хлебнуть протеина', odds: 0.5,
        win: { fx: [{ k: 'max', n: 4 }], txt: 'Черви оказались питательными. Мышцы вздулись, бицепс подмигнул.' },
        lose: { fx: [{ k: 'hp', n: -4 }], txt: 'Черви были против. Следующий час вы провели в обнимку с ведром.' },
      },
      { label: 'Поглазеть и уйти', win: { fx: [], txt: 'Скелет напряг то, что у него вместо пресса, и проводил вас презрительным щелчком.' } },
    ],
  },
  {
    key: 'seer', title: 'Гадалка',
    txt: 'Старуха в тюрбане дышит на хрустальный шар и протирает его рукавом. «Позолоти ручку, красавчик, всю правду скажу. Не позолотишь — тоже скажу, но тебе не понравится».',
    choices: [
      {
        label: 'Позолотить ручку', pay: 4,
        win: { fx: [{ k: 'up' }], txt: '«Вижу дальнюю дорогу и крепкий бросок». И ведь не соврала: диски будто сами знают, куда лететь.' },
      },
      {
        label: 'Гадать бесплатно', odds: 0.5,
        win: { fx: [{ k: 'up' }], txt: 'Бабка нагадала удачу и, на удивление, попала.' },
        lose: { fx: [{ k: 'max', n: -2 }, { k: 'smoke' }], txt: 'Бабка нагадала порчу на здоровье и дунула в шар, а оттуда повалил дым. Порча сработала, дым увязался за вами до конца следующего боя.' },
      },
      { label: 'Не верю', win: { fx: [], txt: 'Шар мигнул и показал вашу будущую лысину. Лучше бы не смотрели.' } },
    ],
  },
  {
    key: 'toilet', title: 'Королевский трон',
    txt: 'Золотой унитаз покойного короля. Король давно истлел, а запах нет. Где-то в глубине поблёскивает руда: кто-то явно уронил туда кошелёк.',
    choices: [
      { label: 'Лезть рукой', win: { fx: [{ k: 'ore', n: 8 }, { k: 'hp', n: -4 }], txt: 'Руда нашлась, а с ней всё, что король оставил потомкам. Руки теперь пахнут властью.' } },
      {
        label: 'Вантузом', odds: 0.5,
        win: { fx: [{ k: 'ore', n: 5 }], txt: 'Чпок! Руда вылетела вместе с короной какого-то предка.' },
        lose: { fx: [{ k: 'hp', n: -3 }], txt: 'Чпок! Вылетело совсем не то, и всё на вас.' },
      },
      { label: 'Посидеть на троне', win: { fx: [{ k: 'hp', n: 6 }], txt: 'Пять минут королевского покоя с газетой. Лучший отдых за весь забег.' } },
    ],
  },
  {
    key: 'ogre', title: 'Храпун на руде',
    txt: 'Огр в трусах в сердечко храпит на горе руды, обнимая плюшевого мишку. Каждый всхрап сдувает пыль со стен. Руды тут хватит на всех.',
    choices: [
      {
        label: 'Набить карманы', odds: 0.5,
        win: { fx: [{ k: 'ore', n: 12 }], txt: 'Огр только почесал пузо и перевернулся на другой бок. Карманы трещат по швам.' },
        lose: { fx: [{ k: 'ore', n: 3 }, { k: 'hp', n: -8 }], txt: 'Огр проснулся на третьем самородке и очень расстроился. Убежать удалось, но не сразу.' },
      },
      { label: 'Взять горсть', win: { fx: [{ k: 'ore', n: 4 }], txt: 'Огр пожевал губами во сне и пробормотал «мама». Лишнего брать не стали.' } },
      { label: 'Стащить мишку', win: { fx: [{ k: 'shield', n: 6 }], txt: 'Мишка тёплый и пахнет огром. С ним в обнимку не страшно, по крайней мере в начале следующего боя.' } },
    ],
  },
  {
    key: 'goblin', title: 'Чёрный рынок',
    txt: 'Гоблин распахивает плащ, а там вместо часов шайбы. «Диски краденые, но летают как родные. Денег не беру. Беру почку. Ну, или что там у тебя лишнее».',
    choices: [
      { label: 'Отдать почку', win: { fx: [{ k: 'disc' }, { k: 'max', n: -6 }], txt: 'Операция прошла быстро, под наркозом из пинка. Почку не вернуть, зато в руке лишняя шайба.' } },
      {
        label: 'Смазать диски', pay: 6,
        win: { fx: [{ k: 'up', stat: 'pw' }], txt: 'Гоблин долго жевал руду, потом намазал диски чем-то скользким. Летают быстрее, лучше не спрашивать чем.' },
      },
      {
        label: 'Сдать страже', odds: 0.5,
        win: { fx: [{ k: 'ore', n: 6 }], txt: 'Стражник-скелет выдал награду и увёл гоблина. Шайбы тоже увёл, себе.' },
        lose: { fx: [{ k: 'hp', n: -5 }], txt: 'Стражником оказался брат гоблина. Объяснялись кулаками.' },
      },
    ],
  },
  {
    key: 'dj', title: 'Будка диджея',
    txt: 'В нише гремит пульт: скелет-диджей в огромных наушниках уснул прямо на вертушках. Рядом пыхтит дым-машина и мигает стробоскоп, а в банке для чаевых блестит руда.',
    choices: [
      {
        label: 'Заказать хит', pay: 3,
        win: { fx: [{ k: 'sparks' }], txt: 'Скелет проснулся, поймал руду зубами и поставил такое, что кости сами пустились в пляс. Искры гудят в пальцах до самого боя.' },
      },
      {
        label: 'Покрутить ручки', odds: 0.5,
        win: { fx: [{ k: 'shield', n: 8 }], txt: 'Бас качнул так, что доспехи сами подтянулись. Следующий бой начнёте под защитой басов.' },
        lose: { fx: [{ k: 'smoke' }], txt: 'Не та ручка. Дым-машина выплюнула облако размером с огра, и оно поплыло за вами в следующий бой.' },
      },
      {
        label: 'Стащить чаевые',
        win: { fx: [{ k: 'ore', n: 7 }, { k: 'strobe' }], txt: 'Банку унесли, но скелет проснулся и врубил стробоскоп вам в глаза. Мигает до сих пор, прицел в следующем бою не поймать.' },
      },
    ],
  },
];

export const eventDef = (key: string) => EVENTS.find(e => e.key === key) ?? EVENTS[0];

/** Which event an event room turns out to be: one the run hasn't met yet when there is one, the same on every screen. */
export function eventOf(seed: number, seen: readonly string[] = []): string {
  const fresh = EVENTS.filter(e => !seen.includes(e.key));
  return makeRng(seed).pick(fresh.length ? fresh : EVENTS).key;
}

/** A disc stat the hero can still raise: levels left to buy, and a bounce not yet at the limit. */
const canGrow = (h: HeroState, k: StatKey) =>
  UP_COST[h.up[k]] !== undefined && (k !== 'e' || h.def.e + h.up.e * UPS.find(u => u.k === 'e')!.step < E_MAX);

/** Whether the party can take a choice now: it has the ore it costs. */
export const canPick = (c: Choice, bank: Bank) => bank.ore >= (c.pay ?? 0);

/** How a choice turns out: a toss-up is rolled from the room's seed, so the host and a reloaded game agree. */
export const rolled = (c: Choice, seed: number, opt: number) => !c.odds || makeRng(seed * 31 + opt * 7919).next() < c.odds;

/** Do what an outcome does to the party and the pool. */
export function applyFx(fx: Fx[], party: HeroState[], bank: Bank, seed: number) {
  const R = makeRng(seed + 1);
  for (const f of fx) {
    if (f.k === 'ore') bank.ore = Math.max(0, bank.ore + f.n);
    else if (f.k === 'sparks') bank.boon = AB_COST;
    else if (f.k === 'shield') bank.shield = (bank.shield ?? 0) + f.n;
    else if (f.k === 'rage') bank.rage = (bank.rage ?? 0) + f.n;
    else if (f.k === 'smoke') bank.smoke = true;
    else if (f.k === 'strobe') bank.strobe = true;
    // the trophies are shared out in their own window once the event is over
    else if (f.k === 'art') continue;
    else for (const h of party) {
      if (f.k === 'heal') h.hp = h.max;
      else if (f.k === 'hp' && h.hp > 0) h.hp = f.n > 0 ? Math.min(h.max, h.hp + f.n) : Math.max(1, h.hp + f.n);
      else if (f.k === 'max') {
        h.max = Math.max(1, h.max + f.n);
        if (h.hp > 0) h.hp = f.n > 0 ? h.hp + f.n : Math.min(h.hp, h.max);
      } else if (f.k === 'disc' && h.discs < HAND_MAX) h.discs++;
      else if (f.k === 'up') {
        const ks = f.stat ? [f.stat].filter(k => canGrow(h, k)) : UPS.map(u => u.k).filter(k => canGrow(h, k));
        if (ks.length) h.up[R.pick(ks)]++;
      }
    }
  }
}

/** A line of what a choice does, split into the good and the bad bits; `solo` words it for a lone hero. */
export function fxParts(fx: Fx[], solo: boolean): { t: string; good: boolean }[] {
  const each = solo ? '' : ' каждому';
  return fx.map(f => {
    if (f.k === 'hp') return { t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} HP${each}`, good: f.n > 0 };
    if (f.k === 'heal') return { t: solo ? 'Полное здоровье' : 'Полное здоровье всем, павшие встают', good: true };
    if (f.k === 'max') return { t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} к макс. HP${each}`, good: f.n > 0 };
    if (f.k === 'ore') return { t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} руды`, good: f.n > 0 };
    if (f.k === 'sparks') return { t: 'Полные искры в следующем бою', good: true };
    if (f.k === 'shield') return { t: `Щит ${f.n}${each} в начале следующего боя`, good: true };
    if (f.k === 'rage') return { t: `Враги следующего боя бьют на ${f.n} сильнее`, good: false };
    if (f.k === 'smoke') return { t: 'Дым-машина: следующий бой в дыму', good: false };
    if (f.k === 'strobe') return { t: 'Стробоскоп: следующий бой без прицела', good: false };
    if (f.k === 'disc') return { t: `Второй диск за ход${each}`, good: true };
    if (f.k === 'art') return { t: solo ? 'Трофей: один из трёх на выбор' : 'Трофей каждому: три на выбор', good: true };
    const u = f.stat && UPS.find(o => o.k === f.stat);
    return { t: u ? `+1 уровень «${u.name}»${each}` : `+1 уровень случайного улучшения${each}`, good: true };
  });
}
