// Events on the run map, the way Slay the Spire shows them: a picture with a gag, the scene, and a few choices.
// A choice may be safe, may cost ore, or may be a toss-up between a good and a bad outcome. Effects on heroes reach
// every hero of the party, ore goes to or from the party's shared pool.
// Some events take more than one tap: the slot machine is pulled again and again, the tattoo waits for the hero who lies
// down for it, the thimbles for the cup with the ball, the pawnshop for the trophy each hero hands over. The host (or a
// lone player) settles every tap and shares the event with the map, so every screen shows the same.

import { AB_COST, E_MAX, HAND_MAX, KINDS, UPS, UP_COST, type StatKey } from './data';
import type { Bank, HeroState } from './game';
import { ARTIFACTS, artDef, drop, give, room, type ArtKey } from './artifacts';
import { REST_ROW, nodeById, type MapNode, type Run } from './run';
import { makeRng } from './rng';

/** The floor of the next fight, from the foam party: discs keep their speed off the walls, or roll twice as far, or stick. */
export type Floor = 'slick' | 'soap' | 'sticky';
/** The bookie's bet on the next fight: won without a scratch (a trophy on it), or within three turns (a level on it). */
export type Bet = 'art' | 'up';
/** What the drunk cartographer's pen does to the floor's map. */
export type Redraw = 'cave' | 'beer' | 'camp';

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
  /** Free levels of a disc stat (`n`, one by default); without `stat`, of whatever each hero can still grow, picked at random. */
  | { k: 'up'; stat?: StatKey; n?: number }
  /** A level taken away, picked at random among the ones the hero has; a hero with none loses DOWN_MAX of the most health instead. */
  | { k: 'down' }
  /** One more disc a turn. */
  | { k: 'disc' }
  /** One more disc a turn in the next fight only. */
  | { k: 'extra' }
  /** A trophy: after the event the party shares out three, the same way as over a floor boss (src/artifacts.ts). */
  | { k: 'art' }
  /** A trophy for every hero with room for one, picked at random among those nobody has: the bookie pays a bet so. */
  | { k: 'gift' }
  /** Every hero loses one of its trophies, picked at random. */
  | { k: 'unart' }
  /** Every hero's sparks go out, and a gift of sparks waiting for the next fight with them. */
  | { k: 'nosparks' }
  /** The floor of the next fight. */
  | { k: 'floor'; f: Floor }
  /** A bet the next fight settles (not the ore cave: nobody fights there). */
  | { k: 'bet'; b: Bet }
  /** Robbers: half the pool, ROB_MIN at least. */
  | { k: 'rob' }
  /** The map of the floor redrawn ahead of the party. */
  | { k: 'map'; m: Redraw }
  /** A word on the choice that does nothing by itself: what goes into the slot machine's bank, what the thimbles pay. */
  | { k: 'note'; t: string; good?: boolean };

export interface Outcome { fx: Fx[]; txt: string }

/** One outcome of a lottery with more than two (the bottle): its chance, its name, and whether it falls on one hero only. */
export interface Slice { odds: number; name: string; one?: boolean; out: Outcome }

export interface Choice {
  label: string;
  /** Ore it costs; with less in the pool the choice is shut. */
  pay?: number;
  /** A toss-up: `win` comes with this chance, `lose` otherwise. */
  odds?: number;
  win: Outcome;
  lose?: Outcome;
  /** Open only with a living hero of this kind in the party, by its place in KINDS: «Толстяк в отряде». */
  kind?: number;
  /** Open only with this much ore in the pool, though it costs none up front (the robbers take their own share). */
  ore?: number;
  /** Open only while some hero owns a trophy. */
  arts?: boolean;
  /** What it does is kept secret until it is taken: the sphinx's answers. */
  blind?: boolean;
  /** One more step before it settles: the hero who gets it, the cup with the ball, the trophy each hero hands over. */
  then?: 'hero' | 'cups' | 'sell';
  /** It falls on one hero only (the tattoo). */
  one?: boolean;
  /** A lottery of more than two outcomes, rolled once taken; `cost` comes first whatever it rolls. */
  spread?: Slice[];
  cost?: Fx[];
  /** The thimbles: how fast the goblin shuffles, 0 to 2. */
  cups?: number;
}

export interface EventDef { key: string; title: string; txt: string; choices: Choice[] }

/** How a taken event turned out. */
export interface Done {
  /** Which choice, and whether its toss-up came out well. */
  opt: number;
  won: boolean;
  /** Since the second batch of events: the line over the outcome, the outcome, the ore paid and the hero it fell on. */
  head?: string;
  out?: Outcome;
  pay?: number;
  who?: number;
  /** What the dice picked that the outcome's line can't tell: the trophies lost, the levels taken, the ore the robbers took. */
  notes?: string[];
  /** What was paid for every hero whatever came of it (a finger on the bottle). */
  cost?: Fx[];
  /** The bottle: the slice it stopped at (its place in the bottle's four). The thimbles: the cup picked and the cup with the ball. */
  slice?: number;
  cup?: number;
  ball?: number;
}

/** The event the party stands in, the same on every screen: the host settles it and shares it with the map. */
export interface EventState {
  key: string;
  /** The room's seed: toss-ups and random upgrades roll from it. */
  seed: number;
  /** Online: the choice each player points at, by hero; the party takes one once everyone at the table points at it. */
  votes: Record<number, number>;
  /** «Жадная Люська»: the pulls that came off so far, a rung of the prize each. */
  pulls?: number;
  /** The choice taken whose second step is still open (`Choice.then`). */
  step?: number;
  /** The pawnshop: the trophy each hero hands over, by hero. */
  sold?: Record<number, ArtKey>;
  /** Once taken. */
  done?: Done;
}

/** What an event plays with: the party, the pool, and the run whose map the cartographer redraws. */
export interface Table { party: HeroState[]; bank: Bank; run?: Run }

/** The robbers take half the pool, this much at least. */
export const ROB_MIN = 3;
/** A level taken from a hero who has none costs this much of the most health. */
export const DOWN_MAX = 3;
/** The pawnshop: ore for a trophy handed over. */
export const SELL = 10;
/** The bookie's quick bet: the next fight won within this many turns. */
export const BET_TURNS = 3;
/** The friction of the discs on the foam party's floors. */
export const FLOOR_FR: Record<Floor, number> = { slick: 1, soap: 0.5, sticky: 1.6 };

// ------------------------------------------------------------ the slot machine

/** «Жадная Люська»: each pull that comes off puts the next rung of the prize into her bank; the last one is the jackpot. */
const RUNGS: { fx: Fx[]; txt: string; reels: Reel[] }[] = [
  { fx: [{ k: 'hp', n: 6 }], reels: ['cherry', 'cherry', 'lips'],
    txt: 'Вишенка, вишенка, губки. Люська томно звякнула и выплюнула в лоток фляжку с чем-то целебным. Можно забрать, а можно дёрнуть ещё: «Ну же, не останавливайся».' },
  { fx: [{ k: 'sparks' }], reels: ['lips', 'cherry', 'lips'],
    txt: 'Губки, вишенка, губки. Из щели посыпались искры, корпус заходил ходуном, лампочки мигают всё чаще. В лотке прибавилось.' },
  { fx: [{ k: 'up' }], reels: ['cherry', 'cherry', 'cherry'],
    txt: 'Три вишенки! Люська застонала динамиком и выкатила в лоток точильный камень в форме сердечка. Скелет у рычага во сне завистливо скрипнул зубами.' },
  { fx: [{ k: 'art' }], reels: ['lips', 'lips', 'lips'],
    txt: 'ДЖЕКПОТ! Три губки, сирена, монеты из купальника сыплются на пол. Люська отдаёт всё, что копила для самого настойчивого, и без сил гасит лампочки.' },
];
/** The chance of each pull in turn to come off. */
export const PULL_ODDS = [0.8, 0.65, 0.5, 0.35];
/** A symbol on the slot machine's reels. */
export type Reel = 'cherry' | 'lips' | 'skull';
/** The reels as the slot machine shows them now: the last pull's, three skulls once it went bust, or none before any. */
export function reelsOf(ev: EventState): Reel[] | null {
  if (ev.done && ev.done.opt === 0 && !ev.done.won) return ['skull', 'skull', 'skull'];
  return ev.pulls ? RUNGS[ev.pulls - 1].reels : null;
}
const bankOf = (pulls: number) => RUNGS.slice(0, pulls).flatMap(r => r.fx);

function slotChoices(pulls: number): Choice[] {
  const pull: Choice = {
    label: pulls ? 'Дёрнуть ещё' : 'Дёрнуть рычаг', odds: PULL_ODDS[pulls],
    win: { fx: [{ k: 'note', t: pulls === RUNGS.length - 1 ? 'Джекпот:' : 'В банк:', good: true }, ...RUNGS[pulls].fx], txt: RUNGS[pulls].txt },
    lose: {
      fx: [...(pulls ? [{ k: 'note', t: 'Банк сгорит' } as Fx] : []), { k: 'hp', n: -4 }],
      txt: pulls ? 'Три черепа. Люська презрительно хрюкнула динамиком и проглотила весь банк. Рычаг отскочил и врезал по самому дорогому.'
        : 'Три черепа с первого же рывка. Рычаг отскочил и врезал по самому дорогому, а Люська хихикает лампочками.',
    },
  };
  return pulls
    ? [pull, { label: 'Забрать банк', win: { fx: bankOf(pulls), txt: 'Вы выгребли лоток, пока Люська не передумала. Автомат обиженно мигает: «Слабаки. Настоящие мужики дёргают до конца».' } }]
    : [pull, { label: 'Пнуть автомат и уйти', win: { fx: [], txt: 'Автомат получил пинка и в отместку высветил на табло неприличное слово. Скелет у рычага даже не проснулся.' } }];
}

// ------------------------------------------------------------ the sphinx

/** The sphinx's riddles: a dirty-sounding question, its innocent answer and a decoy. «То самое» is always the third answer. */
export const RIDDLES: { q: string; a: string; d: string }[] = [
  { q: 'Головка красная, сидит в чехле. Покрутишь, вылезает. Покрутишь обратно, прячется.', a: 'Губная помада', d: 'Черепаха' },
  { q: 'Белые, жидкие. Если долго трясти рукой, встают и держат форму.', a: 'Сливки', d: 'Кисель' },
  { q: 'Её вертят в пальцах, облизывают, а потом поджигают.', a: 'Самокрутка', d: 'Ириска' },
  { q: 'Кладёшь твёрдое, крутишь ручку, а выходит мягкое и длинное.', a: 'Мясорубка', d: 'Шарманка' },
  { q: 'Седая, длинная, висит у деда. По утрам её чешут, по праздникам заплетают.', a: 'Борода', d: 'Мочалка' },
  { q: 'Колючий, тёплый, бабушкин. Лезешь в него головой, а руки сами находят дырки.', a: 'Свитер', d: 'Ёж' },
  { q: 'Берёшь её за шейку, она булькает, а потом тебе хорошо.', a: 'Бутылка', d: 'Курица' },
  { q: 'Надувают ртом, а потом все хотят потрогать.', a: 'Воздушный шарик', d: 'Жаба' },
  { q: 'Мнут её, мнут, она пыхтит и поднимается, а потом её в печку.', a: 'Тесто', d: 'Подушка' },
  { q: 'Что у мужика в штанах парное, а у бабы в юбке нет?', a: 'Штанины', d: 'Карманы' },
  { q: 'Мокрый, волосатый, по лицу елозит, после него всё в пене.', a: 'Помазок', d: 'Пёс' },
  { q: 'Дёрнешь за верёвочку, внизу журчит.', a: 'Сливной бачок', d: 'Колокол' },
];
const RIGHT: Outcome = { fx: [{ k: 'up' }], txt: 'Сфинкс разочарованно дёргает усом: «Верно. А вы что подумали?» Он лениво лижет вас в макушку, и в голове проясняется: диски будто сами знают, куда лететь.' };
const WRONG: Outcome = { fx: [{ k: 'hp', n: -4 }], txt: 'Сфинкс облизывается: «Неверно». Кусает он, как обещал, больно и с удовольствием, а потом ещё долго вылизывается.' };
const SAME: Outcome = { fx: [{ k: 'hp', n: 3 }], txt: 'Сфинкс валится на спину и ржёт, дрыгая лапами: «Я же просил не думать о пошлом!» Отсмеявшись, он угощает молоком из бокала. Молоко подозрительно бодрит.' };

/** The sphinx's riddle at this event, and its two answers in the order the window shows them. */
export function riddleOf(seed: number) {
  const R = makeRng(seed * 7 + 11), r = R.pick(RIDDLES);
  return { q: r.q, answers: R.next() < 0.5 ? [r.a, r.d] : [r.d, r.a], right: r.a };
}

function sphinxChoices(seed: number): Choice[] {
  const r = riddleOf(seed);
  return [
    ...r.answers.map((a): Choice => ({ label: a, blind: true, win: a === r.right ? RIGHT : WRONG })),
    { label: 'То самое', blind: true, win: SAME },
  ];
}

// ------------------------------------------------------------ the bottle

/** The bottle's four: two kisses and a punch for the one it points at, a round for everyone. */
export const BOTTLE: Slice[] = [
  { odds: 0.25, name: 'Жаба', one: true, out: { fx: [{ k: 'max', n: 5 }], txt: 'Бутылка показала на {acc}. Поцелуй с жабой вышел влажным и долгим. Принцессой она не стала, но от её слизи кожа задубела, как броня.' } },
  { odds: 0.25, name: 'Отличница', one: true, out: { fx: [{ k: 'up' }], txt: 'Бутылка показала на {acc}. Отличница поправила очки, чмокнула в щёку и шепнула на ухо, как правильно держать диск. Покраснели все вокруг.' } },
  { odds: 0.25, name: 'Качок', one: true, out: { fx: [{ k: 'hp', n: -6 }], txt: 'Бутылка показала на {acc}. Качок-выпускник сначала полез целоваться, а когда понял, что не по правилам, полез драться. Целуется он, кстати, тоже больно.' } },
  { odds: 0.25, name: 'На бутылку', out: { fx: [{ k: 'hp', n: 3 }], txt: 'Бутылка завертелась и легла горлышком в пустоту. По правилам это «на бутылку»: пьют все. Выпускники достали заначку, и стало хорошо.' } },
];
/** The bottle turned with a finger: the punch never comes up. */
const FIXED = BOTTLE.filter(s => s.name !== 'Качок').map(s => ({ ...s, odds: 1 / 3 }));

// ------------------------------------------------------------ the thimbles

/** The thimbles: how many times the goblin swaps two cups and how long a swap takes, by how fast he goes; ore for the right cup. */
export const CUPS = [
  { swaps: 5, ms: 700, prize: 6 },
  { swaps: 8, ms: 430, prize: 10 },
  { swaps: 12, ms: 270, prize: 16 },
];
/** How the goblin shuffles at this event: the cup the ball starts under, the swaps (places of the two cups), and where the ball ends. */
export function shuffleOf(seed: number, speed: number) {
  const R = makeRng(seed * 17 + speed * 5 + 3), start = R.int(0, 2), swaps: [number, number][] = [];
  let ball = start;
  for (let k = 0; k < CUPS[speed].swaps; k++) {
    const a = R.int(0, 2), b = (a + R.int(1, 2)) % 3;
    swaps.push([a, b]);
    if (ball === a) ball = b;
    else if (ball === b) ball = a;
  }
  return { start, swaps, ball, ms: CUPS[speed].ms };
}
const cupChoice = (label: string, speed: number): Choice => ({
  label, pay: 3, then: 'cups', cups: speed,
  win: { fx: [{ k: 'ore', n: CUPS[speed].prize }], txt: 'Шарик под этим стаканом! Гоблин побледнел, покойник перестал радоваться, а вы сгребли руду, пока никто не передумал.' },
  lose: { fx: [], txt: 'Пусто. Гоблин показывает шарик, который всё это время был совсем не там, и сочувственно хлопает по плечу. Покойник рядом радуется за вас обоих.' },
});

// ------------------------------------------------------------ the events

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
        win: { fx: [{ k: 'shield', n: 6 }, { k: 'hp', n: -2 }], txt: 'Поцелуй вышел долгим и с языком. Сундук покраснел, оставил засос на память и пообещал прикрыть в следующей драке. Ревнивые сундуки слово держат.' },
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
    txt: 'Золотой унитаз покойного короля булькает всё громче. Из глубины доносится царственный голос: «Засор! Кто последний пользовался?» Вода уже у края, а призрак короля держит дверь.',
    choices: [
      { label: 'Прочистить рукой', win: { fx: [{ k: 'hp', n: -5 }], txt: 'Вы засучили рукав и полезли в царские глубины. Засор вышел, а с ним всё, что король копил годами. Призрак кланяется, руки теперь пахнут властью.' } },
      { label: 'Бежать как есть', win: { fx: [{ k: 'smoke' }], txt: 'Вы бросились прочь, а королевская вонь бросилась следом и не отстаёт. В следующем бою дышать будет нечем, а видно ещё меньше.' } },
      { label: 'Заткнуть диском', win: { fx: [{ k: 'down' }], txt: 'Диск вошёл плотно, как родной. Вытащить его удалось, а вот чистым он уже не будет. Летает теперь как-то брезгливо.' } },
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
        win: { fx: [{ k: 'extra' }], txt: 'Стражник-скелет увёл гоблина, а пару краденых шайб выдал вам в награду. Поносить до конца следующей драки, потом сдать обратно.' },
        lose: { fx: [{ k: 'hp', n: -5 }], txt: 'Стражником оказался брат гоблина. Объяснялись кулаками.' },
      },
    ],
  },
  {
    key: 'dj', title: 'Будка диджея',
    txt: 'В нише гремит пульт. Скелет-диджей проснулся на вертушках от вашего топота, и он очень зол. «Кто трогал пульт?! Без заказа отсюда никто не выйдет». Дым-машина пыхтит, стробоскоп бьёт прямо в глаза.',
    choices: [
      { label: 'Сунуть чаевые', pay: 5, win: { fx: [], txt: 'Скелет поймал руду зубами, сменил гнев на милость и поставил что-то медленное. Можно идти, пока он не передумал.' } },
      { label: 'Танцевать до упаду', win: { fx: [{ k: 'hp', n: -4 }], txt: 'Он поставил хардбасс на час. Вы плясали, пока кости не загудели, а скелет не моргнул ни разу. Ему-то легко, у него нет мышц.' } },
      { label: 'Удрать через дым', win: { fx: [{ k: 'smoke' }, { k: 'strobe' }], txt: 'Вы нырнули в дым, но скелет врубил дым-машину и стробоскоп на полную и хохочет в микрофон. В следующем бою не видно ни зги, а прицел мигает.' } },
    ],
  },
  {
    key: 'slot', title: 'Жадная Люська',
    txt: 'В нише мигает игровой автомат: на корпусе нарисована пышная красотка в купальнике из монет, а рычаг такой формы, что дёргать его при всех неловко. Над щелью надпись: «Люська любит настойчивых». Рядом спит скелет, так и не отпустивший рычаг.',
    choices: slotChoices(0),
  },
  {
    key: 'sphinx', title: 'Лысый Сфинкс',
    txt: 'Поперёк коридора разлёгся лысый кот размером с телёнка, в леопардовом халате и с бокалом молока. «Я Сфинкс. Отгадаешь загадку, пропущу с подарком. Не отгадаешь, съем. Шучу. Покусаю». Он прищуривается: «И не думай о пошлом, путник. Мои загадки приличные».',
    choices: [
      { label: 'Верный ответ', blind: true, win: RIGHT },
      { label: 'Ложный ответ', blind: true, win: WRONG },
      { label: 'То самое', blind: true, win: SAME },
    ],
  },
  {
    key: 'gnome', title: 'Застрявший гном',
    txt: 'Из узкого лаза в стене торчит зад гнома в полосатых панталонах. Ножки болтаются, изнутри глухо орут: «Полез за заначкой, а она дальше, чем я думал! Вытащите, всё отдам! И не пяльтесь на панталоны, они парадные!»',
    choices: [
      { label: 'Протолкнуть пузом', kind: 0, win: { fx: [{ k: 'max', n: 4 }], txt: 'Толстяк разбежался и вогнал гнома в лаз, как пробку в бутылку. С той стороны донеслось «Спасибо, родной!», и через дыру прикатился бочонок самогона. Закусывать не стали, и так полегчало.' } },
      {
        label: 'Тянуть за ноги', kind: 1, odds: 0.5,
        win: { fx: [{ k: 'up', stat: 'm' }], txt: 'Гном вылетел, как пробка, вместе с заначкой и точильным камнем. На радостях он наточил всем диски, бормоча, что панталоны эти больше не наденет.' },
        lose: { fx: [{ k: 'hp', n: -4 }], txt: 'В руках остались одни панталоны. Гном застрял ещё глубже и лягался вслепую, но очень метко.' },
      },
      { label: 'Пролезть следом', kind: 2, win: { fx: [{ k: 'up', stat: 'pw' }], txt: 'Дрищ ввинтился в лаз ужом и добрался до заначки раньше гнома. Там нашлась банка смазки для дисков. Гном орал про воровство, но из лаза его не видно, так что не считается.' } },
      { label: 'Шлёпнуть и уйти', win: { fx: [], txt: 'Звонкий шлепок по парадным панталонам эхом разнёсся по коридору. Изнутри донеслось: «Ещё!» Вы ускорили шаг.' } },
    ],
  },
  {
    key: 'bookie', title: 'Букмекер',
    txt: 'Над конторкой парит призрак в клетчатом пиджаке, с сигарой, которую не может докурить уже лет двести. На доске мелом ваши рожицы и ставки против. «Ставлю свой сундучок, что следующий бой вы не выиграете чисто. Спорим? Проиграете, заберу кое-что на память».',
    choices: [
      { label: 'Спорим на трофей: без царапины', arts: true, win: { fx: [{ k: 'bet', b: 'art' }], txt: 'Призрак плюнул в ладонь, ударили по рукам. Ладонь прошла насквозь, но пари есть пари. «Без единой царапины, — затягивается он сигарой. — Посмотрим».' } },
      { label: 'Спорим на уровень: за три хода', win: { fx: [{ k: 'bet', b: 'up' }], txt: 'Призрак записал ставку мелом прямо у вас на лбу. «Три хода, не больше. Не успеете, заберу кое-что из вашей сноровки».' } },
      { label: 'Не спорить', win: { fx: [], txt: 'Призрак презрительно пускает кольцо дыма: «Скучные вы. Как покойники, только живые».' } },
    ],
  },
  {
    key: 'pawn', title: 'Ломбард «Золотой зуб»',
    txt: 'За решёткой окошка скелет с лупой в глазнице пробует на зуб чью-то корону. На полках чужие трофеи с бирками и ценниками. «Покупаю всё, продаю всё. Души не беру, у меня их полный подвал, и все ноют».',
    choices: [
      { label: 'Купить трофей', pay: 20, win: { fx: [{ k: 'art' }], txt: 'Скелет долго пробовал руду на зуб, потом кивнул на полку: «Выбирай, только не лапай». Ценники он отрывает с мясом.' } },
      { label: 'Сдать трофей', arts: true, then: 'sell', win: { fx: [{ k: 'note', t: `Каждый сдаёт один свой трофей: +${SELL} руды за каждый` }], txt: 'Скелет рассмотрел каждую вещицу в лупу, понюхал, лизнул и отсчитал руду. «Приходите ещё. Желательно с чужим».' } },
      { label: 'Поглазеть и уйти', win: { fx: [], txt: 'На витрине пылятся чужие трофеи с бирками «Не выкуплено». Скелет провожает вас взглядом, полным сострадания к вашей бедности.' } },
    ],
  },
  {
    key: 'mapper', title: 'Пьяный картограф',
    txt: 'Гном-картограф уснул лицом в собственной карте этажа: в бороде крошки, в руке перо, рядом пустой бочонок. Карта вся в пивных кругах, а на полях он рисовал русалок, и явно не с натуры. Перо ещё не высохло.',
    choices: [
      { label: 'Дорисовать пещеру', win: { fx: [{ k: 'map', m: 'cave' }], txt: 'Вы обмакнули перо в пиво и дорисовали пещеру с рудой. Картограф во сне одобрительно хрюкнул. В этом подземелье карта главнее камня: пещера там теперь правда есть.' } },
      { label: 'Замазать элиту пивом', win: { fx: [{ k: 'map', m: 'beer' }], txt: 'Вы плеснули пивом на самые страшные рожи на карте. Пятна расплылись, и рожи стали обычными. Где-то впереди элитные громилы вдруг почувствовали себя никем.' } },
      { label: 'Нарисовать лаз к костру', win: { fx: [{ k: 'map', m: 'camp' }], txt: 'Вы провели пером кривую линию прямо к костру. Картограф во сне пробормотал: «Так нельзя, там скала». Но перо уже высохло, и лаз остался.' } },
    ],
  },
  {
    key: 'foam', title: 'Пенная вечеринка',
    txt: 'Из-за двери гремит бас и ползёт пена: скелеты устроили пенную вечеринку. Пеногенератор плюётся, все скользят и визжат, кто-то потерял плавки и ищет их на ощупь. «Заходите! Только диски не мочите, а то потом не остановятся!»',
    choices: [
      { label: 'Натереть диски пеной', win: { fx: [{ k: 'floor', f: 'slick' }], txt: 'Диски натёрли пеной до скрипа. Теперь они отскакивают от стен так, будто стены их чем-то обидели.' } },
      { label: 'Нырнуть с разбегу', win: { fx: [{ k: 'hp', n: 5 }, { k: 'floor', f: 'soap' }], txt: 'Вы влетели в пену с разбега и пропали в ней с визгом. Вынырнули чистыми, бодрыми и в чужих плавках. Пена налипла на подошвы: в следующем бою пол будет как каток.' } },
      { label: 'Выдернуть шнур', win: { fx: [{ k: 'sparks' }, { k: 'floor', f: 'sticky' }], txt: 'Пеногенератор заглох, а вас шибануло так, что искры из ушей. Скелеты с горя разлили всё пиво, и пол следующего боя липкий, как стойка в баре.' } },
    ],
  },
  {
    key: 'bottle', title: 'Бутылочка',
    txt: 'Скелеты-выпускники в лентах сидят кружком и крутят пустую бутылку. Среди них жаба в фате, губы накрашены и вытянуты трубочкой. «Новенькие! Садитесь, на кого покажет, с тем и целуетесь. Жаба, между прочим, заколдованная принцесса. Наверное».',
    choices: [
      { label: 'Крутить бутылочку', spread: BOTTLE, win: BOTTLE[3].out },
      { label: 'Подкрутить пальцем', spread: FIXED, cost: [{ k: 'hp', n: -2 }], win: BOTTLE[3].out },
      { label: 'Отсидеться в углу', win: { fx: [], txt: 'Вы просидели в углу весь кон. Жаба смотрела на вас с укором, а выпускники шептались, что новенькие какие-то скучные.' } },
    ],
  },
  {
    key: 'thimble', title: 'Наперсточник',
    txt: 'Гоблин в спортивном костюме гоняет три напёрстка по крышке гроба. Покойник рядом только что «выиграл» и громко радуется, хотя глаза у него грустные. «Кручу-верчу, обмануть хочу! Ставь руду, выбирай, как крутить».',
    choices: [
      cupChoice('Медленно', 0),
      cupChoice('Быстро', 1),
      cupChoice('Как у шулера', 2),
      { label: 'Уйти', win: { fx: [], txt: 'Гоблин сплюнул сквозь зубы: «Фраера». Покойник рядом выиграл ещё раз и заплакал от счастья.' } },
    ],
  },
  {
    key: 'tattoo', title: 'Тату-салон «Мама, прости»',
    txt: 'Скелет-татуировщик в бандане протирает иглу из рыбьей кости. На стене эскизы: сердце «Мама», якорь, череп с розой и русалка в лифчике из ракушек. «Бью одну, зато от души. Краски мало, так что решайте, кто ляжет на кушетку».',
    choices: [
      { label: 'Сердце «Мама»', then: 'hero', one: true, win: { fx: [{ k: 'max', n: 8 }], txt: 'Скелет набил {dat} сердце с надписью «Мама» прямо на груди. Мама бы не одобрила, но от гордости грудь стала шире.' } },
      { label: 'Череп с розой', then: 'hero', one: true, win: { fx: [{ k: 'up', stat: 'm', n: 2 }], txt: 'Скелет набил {dat} череп с розой на бицепс. Бицепс от такой красоты налился силой, броски теперь тяжелее.' } },
      { label: 'Якорь', then: 'hero', one: true, win: { fx: [{ k: 'up', stat: 'pw', n: 2 }], txt: 'Скелет набил {dat} якорь на предплечье. Рука теперь машет, как у моряка в порту, и диски летят резвее.' } },
      { label: 'Обойтись без наколок', win: { fx: [], txt: 'Скелет обиженно убрал иглу: «Ну и ходите голые». На прощание он всё-таки нарисовал ручкой рожицу на чьём-то лбу.' } },
    ],
  },
  {
    key: 'gopnik', title: 'Гоп-стоп',
    txt: 'Из-за угла выходят три скелета в спортивных костюмах. Один лузгает семечки, и шелуха сыплется сквозь рёбра. «Слышь, диско-бой, руда есть? А если найдём? А цацки у тебя ничего такие». Вас уже окружили, добрым словом тут не обойтись.',
    choices: [
      { label: 'Отдать руду', ore: ROB_MIN, win: { fx: [{ k: 'rob' }], txt: 'Скелеты пересчитали руду, забрали половину и даже оставили на проезд. «Уважаем, — говорит главный. — Если чё, мы тут каждый вечер».' } },
      { label: 'Отдать цацку', arts: true, win: { fx: [{ k: 'unart' }], txt: 'Главный примерил вашу вещицу, покрутился перед осколком зеркала и остался доволен. «Нормально. Носить буду по праздникам».' } },
      { label: 'Отбиваться', win: { fx: [{ k: 'hp', n: -6 }], txt: 'Драка вышла короткой и некрасивой. Скелеты рассыпались, собрались обратно и ушли, а вы ещё долго собирали зубы. Свои.' } },
    ],
  },
  {
    key: 'husband', title: 'Ревнивый муж',
    txt: 'Вы зашли в склеп переждать, а хозяйка-скелетиха в бигуди оказалась очень гостеприимной. И тут хлопает дверь: «Дорогая, я дома!» Муж в майке и со скалкой, а шкаф в склепе всего один.',
    choices: [
      {
        label: 'Спрятаться в шкаф', odds: 0.5,
        win: { fx: [], txt: 'В шкафу пахло нафталином и чужими носками, но муж туда не заглянул. Посидели тихо, пока он не захрапел.' },
        lose: { fx: [{ k: 'hp', n: -8 }], txt: 'Муж открыл шкаф за чистой майкой. Скалка у него, оказывается, дубовая, а терпение короткое.' },
      },
      { label: 'Прыгать в окно', win: { fx: [{ k: 'max', n: -3 }], txt: 'Окно в склепе оказалось на третьем этаже. Вы прыгнули не раздумывая и приземлились на рёбра. Рёбра будут ныть до конца забега.' } },
      { label: 'Притвориться сантехником', win: { fx: [{ k: 'nosparks' }], txt: 'Вы сказали, что пришли по вызову, и муж обрадовался: «Наконец-то!» До утра пришлось чинить трубы. Все искры ушли в разводной ключ.' } },
    ],
  },
];

export const eventDef = (key: string) => EVENTS.find(e => e.key === key) ?? EVENTS[0];

/** Which event an event room turns out to be: one the run hasn't met yet when there is one, the same on every screen. */
export function eventOf(seed: number, seen: readonly string[] = []): string {
  const fresh = EVENTS.filter(e => !seen.includes(e.key));
  return makeRng(seed).pick(fresh.length ? fresh : EVENTS).key;
}

/** The choices the event offers now: the slot machine's change with every pull, the sphinx's are the answers to its riddle. */
export function choicesOf(ev: Pick<EventState, 'key' | 'seed' | 'pulls'>): Choice[] {
  if (ev.key === 'slot') return slotChoices(ev.pulls ?? 0);
  if (ev.key === 'sphinx') return sphinxChoices(ev.seed);
  return eventDef(ev.key).choices;
}

/** What the window asks for now: a choice, the hero who gets it, the cup with the ball, each hero's trophy to sell; or nothing. */
export function stageOf(ev: EventState): 'choose' | 'hero' | 'cups' | 'sell' | 'done' {
  if (ev.done) return 'done';
  return ev.step === undefined ? 'choose' : choicesOf(ev)[ev.step]?.then ?? 'choose';
}

/** The scene: the event's own, or what the slot machine did on the last pull. */
export function sceneOf(ev: EventState): string {
  if (ev.key === 'slot' && ev.pulls && !ev.done) return RUNGS[ev.pulls - 1].txt;
  return eventDef(ev.key).txt;
}

/** A disc stat the hero can still raise: levels left to buy, and a bounce not yet at the limit. */
const canGrow = (h: HeroState, k: StatKey) =>
  UP_COST[h.up[k]] !== undefined && (k !== 'e' || h.def.e + h.up.e * UPS.find(u => u.k === 'e')!.step < E_MAX);

/** Whether the party can take a choice now: it has the ore it costs. */
export const canPick = (c: Choice, bank: Bank) => bank.ore >= (c.pay ?? 0);

const KIND_NONE = ['Толстяка в отряде нет', 'Чувака в отряде нет', 'Дрища в отряде нет'];
const MAP_NONE: Record<Redraw, string> = { cave: 'Впереди негде рисовать', beer: 'Впереди нет элиты', camp: 'Костёр и так за углом' };

/** Why a choice is shut now, in a line on its slab; null while it can be taken. */
export function shutWhy(c: Choice, t: Table): string | null {
  const solo = t.party.length === 1;
  if (!canPick(c, t.bank)) return `Нужно ${c.pay} руды`;
  if (c.ore && t.bank.ore < c.ore) return `Нужно ${c.ore} руды`;
  if (c.kind !== undefined && !t.party.some(h => h.hp > 0 && h.def.r === KINDS[c.kind!].r)) return KIND_NONE[c.kind];
  if (c.arts && !t.party.some(h => h.arts?.length)) return solo ? 'У тебя нет трофеев' : 'Трофеев ни у кого нет';
  const m = c.win.fx.find(f => f.k === 'map');
  if (m?.k === 'map' && t.run && !redrawn(t.run, m.m, 0).length) return MAP_NONE[m.m];
  return null;
}

/** The kind a choice wants in the party, for its slab: «Толстяк в отряде». */
export const needOf = (c: Choice) => (c.kind !== undefined ? `${KINDS[c.kind].one} в отряде` : '');

/** How a choice turns out: a toss-up is rolled from the room's seed, so the host and a reloaded game agree. */
export const rolled = (c: Choice, seed: number, opt: number) => !c.odds || makeRng(seed * 31 + opt * 7919).next() < c.odds;

/** Online: the heroes who still have to hand a trophy over at the pawnshop, of those at the table. */
export const sellersLeft = (ev: EventState, party: HeroState[], table: number[]) =>
  party.filter(h => h.arts?.length && table.includes(h.i) && ev.sold?.[h.i] === undefined);

/**
 * Take a choice at the event (the host, or a lone player): pay, roll, and do what comes of it to the party. A choice with a
 * second step only opens it. False when the choice can't be taken now.
 */
export function take(ev: EventState, opt: number, t: Table): boolean {
  if (stageOf(ev) !== 'choose') return false;
  const c = choicesOf(ev)[opt];
  if (!c || shutWhy(c, t)) return false;
  ev.votes = {};
  t.bank.ore -= c.pay ?? 0;
  if (ev.key === 'slot' && opt === 0) return pull(ev, c, t);
  if (c.then) {
    // a lone hero lies down on the couch himself
    if (c.then === 'hero' && t.party.length === 1) settle(ev, opt, true, c.label, c.win, t, { pay: c.pay, who: t.party[0].i });
    else ev.step = opt;
    return true;
  }
  if (c.spread) {
    const R = makeRng(ev.seed * 31 + opt * 7919);
    let x = R.next(), k = 0;
    while (k < c.spread.length - 1 && (x -= c.spread[k].odds) >= 0) k++;
    const s = c.spread[k], alive = t.party.filter(h => h.hp > 0), who = s.one ? R.pick(alive.length ? alive : t.party).i : undefined;
    if (c.cost) applyFx(c.cost, t.party, t.bank, ev.seed, t.run);
    settle(ev, opt, s.out.fx.every(f => f.k !== 'hp' || f.n > 0), `${c.label}: ${s.name}`, s.out, t,
      { pay: c.pay, who, slice: BOTTLE.findIndex(b => b.name === s.name) }, c.cost);
    return true;
  }
  const won = rolled(c, ev.seed, opt);
  settle(ev, opt, won, c.label + (c.odds ? (won ? ': повезло' : ': не повезло') : ''), won ? c.win : c.lose!, t, { pay: c.pay });
  return true;
}

/** «Жадная Люська»: a pull that comes off puts the next rung in the bank; the last rung is the jackpot, a bust burns the bank. */
function pull(ev: EventState, c: Choice, t: Table) {
  const n = ev.pulls ?? 0, won = makeRng(ev.seed * 31 + n * 7919 + 101).next() < c.odds!;
  if (!won) settle(ev, 0, false, 'Три черепа', { fx: [{ k: 'hp', n: -4 }], txt: c.lose!.txt }, t, {});
  else if ((ev.pulls = n + 1) === RUNGS.length) settle(ev, 0, true, 'Джекпот', { fx: bankOf(RUNGS.length), txt: RUNGS[n].txt }, t, {});
  return true;
}

/** The hero who lies down for the tattoo. */
export function heroPick(ev: EventState, hero: number, t: Table): boolean {
  if (stageOf(ev) !== 'hero' || !t.party.some(h => h.i === hero)) return false;
  const c = choicesOf(ev)[ev.step!];
  settle(ev, ev.step!, true, c.label, c.win, t, { pay: c.pay, who: hero });
  return true;
}

/** The cup picked at the thimbles: the ball under it wins the prize. */
export function cupPick(ev: EventState, cup: number, t: Table): boolean {
  if (stageOf(ev) !== 'cups' || !(cup >= 0 && cup < 3)) return false;
  const c = choicesOf(ev)[ev.step!], ball = shuffleOf(ev.seed, c.cups ?? 0).ball, won = cup === ball;
  settle(ev, ev.step!, won, c.label + (won ? ': угадал' : ': мимо'), won ? c.win : c.lose!, t, { pay: c.pay, cup, ball });
  return true;
}

/**
 * The trophy a hero hands over at the pawnshop. Once every hero with trophies at the `table` has picked one (online the
 * heroes of players who dropped out keep theirs), they go and the ore comes.
 */
export function sellPick(ev: EventState, hero: number, k: ArtKey, t: Table, table: number[]): boolean {
  const h = t.party.find(o => o.i === hero);
  if (stageOf(ev) !== 'sell' || !h?.arts?.includes(k)) return false;
  (ev.sold ??= {})[hero] = k;
  sellDone(ev, t, table);
  return true;
}

/** The pawnshop takes the trophies picked once nobody at the `table` still has one to pick; true once it has. */
export function sellDone(ev: EventState, t: Table, table: number[]): boolean {
  if (stageOf(ev) !== 'sell' || sellersLeft(ev, t.party, table).length) return false;
  const c = choicesOf(ev)[ev.step!], sold = Object.entries(ev.sold ?? {});
  const notes = sold.map(([i, a]) => {
    const o = t.party.find(p => p.i === Number(i))!;
    drop(o, a as ArtKey);
    return `${o.def.name}: «${artDef(a).name}»`;
  });
  settle(ev, ev.step!, true, c.label, { fx: [{ k: 'ore', n: SELL * sold.length }], txt: c.win.txt }, t, { pay: c.pay, notes });
  return true;
}

/** The event is over: do what came of it, to the hero it fell on or the whole party, and keep it for every screen to show. */
function settle(ev: EventState, opt: number, won: boolean, head: string, out: Outcome, t: Table, at: Partial<Done>, cost?: Fx[]) {
  const h = at.who !== undefined ? t.party.find(o => o.i === at.who) : undefined;
  const notes = [...(at.notes ?? []), ...applyFx(out.fx, h ? [h] : t.party, t.bank, ev.seed, t.run)];
  const txt = h ? out.txt.replace('{acc}', h.def.acc).replace('{dat}', h.def.dat).replace('{name}', h.def.name) : out.txt;
  delete ev.step;
  ev.votes = {};
  ev.done = { opt, won, head, out: { fx: out.fx, txt }, ...at, ...(notes.length ? { notes } : {}), ...(cost ? { cost } : {}) };
}

/** The outcome of a taken event and the line over it; saves from before the second batch of events keep only the choice. */
export function doneOf(ev: EventState): { head: string; out: Outcome; pay: number; who?: number } | null {
  const d = ev.done;
  if (!d) return null;
  if (d.out) return { head: d.head ?? '', out: d.out, pay: d.pay ?? 0, who: d.who };
  const c = eventDef(ev.key).choices[d.opt];
  return { head: c.label + (c.odds ? (d.won ? ': повезло' : ': не повезло') : ''), out: d.won ? c.win : c.lose!, pay: c.pay ?? 0 };
}

/** One level more of a stat the hero can still grow (`stat`, or one picked at random); false when there is none. */
function levelUp(h: HeroState, R: ReturnType<typeof makeRng>, stat?: StatKey) {
  const ks = stat ? [stat].filter(k => canGrow(h, k)) : UPS.map(u => u.k).filter(k => canGrow(h, k));
  if (ks.length) h.up[R.pick(ks)]++;
  return ks.length > 0;
}

/** A level taken away at random; a hero with none pays with the top of its health. Says what went. */
function levelDown(h: HeroState, R: ReturnType<typeof makeRng>) {
  const ks = UPS.filter(u => h.up[u.k] > 0);
  if (ks.length) {
    const u = R.pick(ks);
    h.up[u.k]--;
    return `${h.def.name}: −1 «${u.name}»`;
  }
  h.max = Math.max(1, h.max - DOWN_MAX);
  h.hp = Math.min(h.hp, h.max);
  return `${h.def.name}: уровней нет, −${DOWN_MAX} к макс. HP`;
}

/** A trophy for every hero with room for one, picked at random among those nobody in the party has. Says who got what. */
export function giftArts(party: HeroState[], seed: number) {
  const owned = new Set(party.flatMap(h => [...(h.arts ?? []), ...(h.kept?.offer ?? [])]));
  const left = ARTIFACTS.map(a => a.key).filter(k => !owned.has(k)), R = makeRng(seed * 19 + 5), notes: string[] = [];
  for (const h of party) {
    if (!room(h) || !left.length) continue;
    const k = left.splice(R.int(0, left.length - 1), 1)[0];
    give(h, k);
    notes.push(`${h.def.name}: «${artDef(k).name}»`);
  }
  return notes;
}

/** Every hero with trophies loses one at random. Says who lost what. */
export function loseArts(party: HeroState[], seed: number) {
  const R = makeRng(seed * 23 + 9), notes: string[] = [];
  for (const h of party) {
    if (!h.arts?.length) continue;
    const k = R.pick(h.arts) as ArtKey;
    drop(h, k);
    notes.push(`${h.def.name} без «${artDef(k).name}»`);
  }
  return notes;
}

/**
 * The bookie's bet settled by the fight just won (`ok`: on its terms): a trophy or a level for every hero, or one taken from
 * each. A line for the room's result.
 */
export function settleBet(b: Bet, ok: boolean, party: HeroState[], seed: number) {
  const R = makeRng(seed * 29 + 1), each = party.length > 1 ? ' каждому' : '';
  if (b === 'art') {
    const notes = ok ? giftArts(party, seed) : loseArts(party, seed);
    return ok ? `Пари выиграно, букмекер отдал трофеи: ${notes.join(', ') || 'свободных гнёзд не было'}.` : `Пари проиграно, букмекер забрал трофеи: ${notes.join(', ') || 'забирать было нечего'}.`;
  }
  if (ok) { for (const h of party) levelUp(h, R); return `Пари выиграно: +1 уровень${each}.`; }
  return `Пари проиграно: ${party.map(h => levelDown(h, R)).join(', ')}.`;
}

/** Do what an outcome does to the party, the pool and the map; says what the dice picked that the line of it can't tell. */
export function applyFx(fx: Fx[], party: HeroState[], bank: Bank, seed: number, run?: Run): string[] {
  const R = makeRng(seed + 1), notes: string[] = [];
  for (const f of fx) {
    if (f.k === 'ore') bank.ore = Math.max(0, bank.ore + f.n);
    else if (f.k === 'sparks') bank.boon = AB_COST;
    else if (f.k === 'shield') bank.shield = (bank.shield ?? 0) + f.n;
    else if (f.k === 'rage') bank.rage = (bank.rage ?? 0) + f.n;
    else if (f.k === 'smoke') bank.smoke = true;
    else if (f.k === 'strobe') bank.strobe = true;
    else if (f.k === 'extra') bank.extra = 1;
    else if (f.k === 'floor') bank.ground = f.f;
    else if (f.k === 'bet') bank.bet = f.b;
    else if (f.k === 'rob') {
      const n = Math.min(bank.ore, Math.max(ROB_MIN, Math.ceil(bank.ore / 2)));
      bank.ore -= n;
      notes.push(`Забрали ${n} руды`);
    } else if (f.k === 'nosparks') {
      bank.boon = 0;
      for (const h of party) h.sparks = 0;
    } else if (f.k === 'map') { if (run) redraw(run, f.m, seed); }
    else if (f.k === 'gift') notes.push(...giftArts(party, seed));
    else if (f.k === 'unart') notes.push(...loseArts(party, seed));
    // the trophies are shared out in their own window once the event is over
    else if (f.k === 'art' || f.k === 'note') continue;
    else for (const h of party) {
      if (f.k === 'heal') h.hp = h.max;
      else if (f.k === 'hp' && h.hp > 0) h.hp = f.n > 0 ? Math.min(h.max, h.hp + f.n) : Math.max(1, h.hp + f.n);
      else if (f.k === 'max') {
        h.max = Math.max(1, h.max + f.n);
        if (h.hp > 0) h.hp = f.n > 0 ? h.hp + f.n : Math.min(h.hp, h.max);
      } else if (f.k === 'disc' && h.discs < HAND_MAX) h.discs++;
      else if (f.k === 'up') for (let k = 0; k < (f.n ?? 1); k++) levelUp(h, R, f.stat);
      else if (f.k === 'down') notes.push(levelDown(h, R));
    }
  }
  return notes;
}

// ------------------------------------------------------------ the map

/** The room the party stands in on its floor, or null at the stairs. */
export const hereOf = (run: Run): MapNode | null => {
  const p = run.path[run.floor];
  return p.length ? nodeById(run, run.floor, p[p.length - 1]) : null;
};

/**
 * The rooms the cartographer's pen would change: a room of the next row on the way becomes the ore cave, the elites ahead
 * on this floor become plain fights, or the rest row (the camp and the blacksmith's) comes right after this room.
 */
export function redrawn(run: Run, m: Redraw, seed: number): MapNode[] {
  const here = hereOf(run);
  if (!here) return [];
  const f = run.floor, layers = run.floors[f];
  if (m === 'cave') {
    const can = here.next.map(id => nodeById(run, f, id)).filter(n => n.type === 'fight' || n.type === 'elite' || n.type === 'event');
    return can.length ? [makeRng(seed * 3 + 1).pick(can)] : [];
  }
  if (m === 'beer') return layers.flat().filter(n => n.l > here.l && n.type === 'elite');
  return here.l < REST_ROW - 1 && layers[REST_ROW] ? layers[REST_ROW] : [];
}

/** Redraw the floor's map ahead of the party; the rooms changed get a beer stain. */
export function redraw(run: Run, m: Redraw, seed: number) {
  const ns = redrawn(run, m, seed), here = hereOf(run);
  if (!here || !ns.length) return;
  for (const n of ns) {
    if (m === 'cave') n.type = 'treasure';
    if (m === 'beer') n.type = 'fight';
    n.beer = true;
  }
  if (m === 'camp') here.next = ns.map(n => n.id);
}

// ------------------------------------------------------------ the words

const WHO_FLOOR: Record<Floor, { t: string; good?: boolean; mid?: boolean }> = {
  slick: { t: 'Следующий бой: диски не теряют скорость о стены', good: true },
  soap: { t: 'Следующий бой на мыльном полу: диски катятся вдвое дальше', mid: true },
  sticky: { t: 'Следующий бой на липком полу: диски тормозят быстрее' },
};

export interface Part { t: string; good: boolean; mid?: boolean }

/**
 * A line of what a choice does, split into the good and the bad bits; `solo` words it for a lone hero, `to` names whom it
 * falls on when that is one hero («тому, на кого покажет»).
 */
export function fxParts(fx: Fx[], solo: boolean, to?: string): Part[] {
  const each = to ? ' ' + to : solo ? '' : ' каждому';
  return fx.flatMap((f): Part[] => {
    if (f.k === 'hp') return [{ t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} HP${each}`, good: f.n > 0 }];
    if (f.k === 'heal') return [{ t: solo ? 'Полное здоровье' : 'Полное здоровье всем, павшие встают', good: true }];
    if (f.k === 'max') return [{ t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} к макс. HP${each}`, good: f.n > 0 }];
    if (f.k === 'ore') return [{ t: `${f.n > 0 ? '+' : '−'}${Math.abs(f.n)} руды`, good: f.n > 0 }];
    if (f.k === 'sparks') return [{ t: 'Полные искры в следующем бою', good: true }];
    if (f.k === 'shield') return [{ t: `Щит ${f.n}${each} в начале следующего боя`, good: true }];
    if (f.k === 'rage') return [{ t: `Враги следующего боя бьют на ${f.n} сильнее`, good: false }];
    if (f.k === 'smoke') return [{ t: 'Дым-машина: следующий бой в дыму', good: false }];
    if (f.k === 'strobe') return [{ t: 'Стробоскоп: следующий бой без прицела', good: false }];
    if (f.k === 'disc') return [{ t: `Второй диск за ход${each}`, good: true }];
    if (f.k === 'extra') return [{ t: `+1 диск за ход в следующем бою${each}`, good: true }];
    if (f.k === 'art') return [{ t: solo ? 'Трофей: один из трёх на выбор' : 'Трофей каждому: три на выбор', good: true }];
    if (f.k === 'gift') return [{ t: `Случайный трофей в свободное гнездо${each}`, good: true }];
    if (f.k === 'unart') return [{ t: solo ? 'Теряешь случайный свой трофей' : 'Каждый теряет случайный свой трофей', good: false }];
    if (f.k === 'down') return [{ t: `−1 случайный уровень${each}, без уровней −${DOWN_MAX} к макс. HP`, good: false }];
    if (f.k === 'nosparks') return [{ t: 'Все искры сгорят', good: false }];
    if (f.k === 'rob') return [{ t: `Половина руды отряда, не меньше ${ROB_MIN}`, good: false }];
    if (f.k === 'floor') { const w = WHO_FLOOR[f.f]; return [{ t: w.t, good: !!w.good, ...(w.mid ? { mid: true } : {}) }]; }
    if (f.k === 'note') return [{ t: f.t, good: !!f.good, ...(f.good === undefined ? { mid: true } : {}) }];
    if (f.k === 'bet') return f.b === 'art'
      ? [{ t: 'Итог после следующего боя', good: true, mid: true }, { t: `Без царапины: случайный трофей в свободное гнездо${each}`, good: true }, { t: solo ? 'Иначе теряешь случайный свой трофей' : 'Иначе каждый теряет случайный свой трофей', good: false }]
      : [{ t: 'Итог после следующего боя', good: true, mid: true }, { t: `Победа за ${BET_TURNS} хода: +1 случайный уровень${each}`, good: true }, { t: `Иначе −1 случайный уровень${each}`, good: false }];
    if (f.k === 'map') return f.m === 'cave' ? [{ t: 'Комната следующего ряда на пути станет рудной пещерой', good: true }]
      : f.m === 'beer' ? [{ t: 'Элиты этого этажа станут обычными боями', good: true }, { t: 'Бесплатных уровней с них не будет', good: false }]
      : [{ t: 'Следующая комната: костёр или кузнец', good: true }, { t: 'Комнаты между ними пропускаете', good: false }];
    const u = f.stat && UPS.find(o => o.k === f.stat), n = f.n ?? 1, lv = n === 1 ? 'уровень' : 'уровня';
    return [{ t: u ? `+${n} ${lv} «${u.name}»${each}` : `+${n} ${lv} случайного улучшения${each}`, good: true }];
  });
}
