// The boss's entrance (thread «Появление босса»): when the party comes into a boss room, the boss makes an entrance of its
// own on the field, then a title card with its name and a line of its says hello. Every screen plays it for itself at the
// start of the placement, once per room, while the host goes on running the fight; a tap skips it. The scene draws the
// entrance from `intro.now` (draw/scene.ts), the card is introview.ts, the sounds and the music come from main.ts.

import { MOBS, type MobKind } from './data';
import { mulberry32 } from './rng';
import type { Sfx } from './sound';

/** The bosses' nicknames for the card and their lines: one of them comes out at random, the same on every screen. */
export const BOSS_LINES: Record<string, { epi: string; lines: string[] }> = {
  king: {
    epi: 'Его Жирнейшество',
    lines: [
      'Я звонил в колокольчик, чтоб несли жареного гуся. Принесли вас. Ну, тоже мясо.',
      'На колени, чернь! И не пялься на трусы: это королевский герб.',
      'Я помазанник божий! Ну, в основном куриным жиром.',
      'Кто без записи? Я принимаю по вторникам. И то сплю.',
      'Целуйте перстень! Нет, не этот. Этим я в носу ковырял.',
    ],
  },
  ratswarm: {
    epi: 'Сорок хвостов, один узел',
    lines: [
      'Мы связаны хвостами. Не спрашивай как. Была пятница, был самогон...',
      'Сыр принесли? Нет? Ну, будем грызть, что принесли.',
      'Удрать не можем: хвосты запутались. Значит, придётся вас сожрать.',
      'Нас тут сорок. А вас... ну, на закуску хватит.',
      'Кто первый дёрнется, того и сгрызём. Остальных тоже, но потом.',
    ],
  },
  pahan: {
    epi: 'Смотрящий по казематам',
    lines: [
      'Опа, свежее мясо в хату заехало. По какой статье, пассажиры?',
      'Руду в общак, и разойдёмся по-хорошему. Не хотите? Я не тороплюсь, у меня пожизненное.',
      'Шестёрки, чифиру мне! А этих к параше.',
      'Что за шум, а драки нет? Щас будет.',
      'Я тут не сижу, я отдыхаю. Двадцать лет уже отдыхаю.',
    ],
  },
  lich: {
    epi: 'Сутенёр склепа',
    lines: [
      'Нравится шуба, детка? Натуральная. Из прошлых гостей.',
      'Холодно? Это не склеп, детка. Это мой характер.',
      'Курица на посохе — символ власти. И закуска на чёрный день.',
      'Я тут главный по холоду. Морозилка за стенкой — мой младший.',
      'Не бойся, детка. Больно только первые триста лет.',
    ],
  },
  fridge: {
    epi: 'Голодный с девяносто первого',
    lines: [
      'Тридцать лет вы лазили в меня ночью в одних трусах. Теперь моя очередь жрать.',
      'Свежее мясо! А то у меня одна сгущёнка с девяносто первого.',
      'Я не людоед. Я на белковой диете.',
      'Ночной дожор отменяется. Сегодня дожрут вас.',
      'Слышите, как я гужу? Это я думаю, с кого из вас начать.',
    ],
  },
  dancer: {
    epi: 'Король танцпола, посмертно',
    lines: [
      'В таких ботинках? На МОЙ танцпол? Фейс-контроль не пройден.',
      'Я сорок лет как мёртв, а двигаюсь лучше вас всех вместе взятых.',
      'Объявляю медляк! Прижмись поближе, детка, я холодненький.',
      'Диджей, давай нашу! Эти танцуют последний раз.',
      'Ещё шаг, и я пройдусь лунной походкой по вашим рёбрам.',
    ],
  },
  forgelord: {
    epi: 'Горячий мужчина',
    lines: [
      'Пар из ушей? Это я ещё спокойный. Злым вы меня не видели.',
      'Технику безопасности я сжёг. Вместе с инспектором.',
      'Я горячий мужчина. Буквально: у меня борода плавится.',
      'Добро пожаловать в кузню! Руки не совать. Головы тоже. Хотя ладно, суйте.',
      'Куй железо, пока горячо. А горячо у меня всегда.',
    ],
  },
  discoball: {
    epi: 'Звезда потолка',
    lines: [
      'Только не в лицо! Я тысяча зеркал, это семь тысяч лет несчастья.',
      'Полвека висел над танцполом. Видел, как вы танцуете. Вы заслужили смерть.',
      'Посмотри в мои грани: тысяча неудачников, и все на одно лицо.',
      'Я сиял над каждой свадьбой в этом городе. И над каждым разводом.',
      'Кинешь в меня диском, получишь его обратно. В лоб.',
    ],
  },
  dragon: {
    epi: 'Курит на яйцах',
    lines: [
      'Руки прочь от моих яиц! ...Я про те, что в гнезде, извращенцы.',
      'Врач велел бросить курить. Я бросил. Окурок. Во врача.',
      'Кхе... кхе-кхе... КХА-А-А! Пардон, утренний кашель. Щас и вас подкопчу.',
      'Третью неделю сижу на яйцах. Знаете, как это бесит?',
      'Кто пришёл? Курьер? Сигареты принёс?',
    ],
  },
};

/**
 * How long each boss's entrance on the field takes, in seconds, and its sounds on the way: [seconds in, sound, how hard].
 * The scene draws each entrance from the same clock (draw/scene.ts, introLook and the drawIntro* methods).
 */
export const ENTRANCES: Record<string, { len: number; sfx: [number, Sfx, number][] }> = {
  // a red carpet rolls out, the king drops onto its end and the floor rings round him
  king: { len: 2.4, sfx: [[0.05, 'fanfare', 1], [1.45, 'thud', 1]] },
  // rats run in from all over and knot their tails into the heap
  ratswarm: { len: 2.1, sfx: [[0.1, 'squeak', 0.6], [0.45, 'squeak', 0.9], [0.8, 'squeak', 0.7], [1.4, 'thud', 0.6]] },
  // the bunk stands empty, Пахан drops onto it and its springs bounce him
  pahan: { len: 2.4, sfx: [[0.95, 'thud', 0.8], [1.0, 'boing', 1], [1.32, 'boing', 0.7], [1.62, 'boing', 0.45]] },
  // frost runs over the floor and the lich comes up through it
  lich: { len: 2.3, sfx: [[0.1, 'freeze', 0.6], [0.55, 'shatter', 0.8], [1.7, 'freeze', 1]] },
  // the door flies open, the light comes on, food flies out, the door slams
  fridge: { len: 2.5, sfx: [[0.45, 'door', 0.5], [0.6, 'launch', 0.4], [0.78, 'launch', 0.4], [0.95, 'launch', 0.4], [1.75, 'door', 1]] },
  // the floor lights up and the dancer moonwalks in backwards, then strikes his pose
  dancer: { len: 2.5, sfx: [[0.25, 'launch', 0.7], [1.65, 'herb', 1], [1.7, 'sparks', 0.6]] },
  // the floor glows red round his cell, he lands with a hammer blow, sparks fly and steam comes out of his ears
  forgelord: { len: 2.4, sfx: [[0.05, 'steam', 0.5], [1.05, 'slam', 1], [1.5, 'steam', 0.8]] },
  // lowered on its chain from the ceiling, it lands and its lights sweep the floor
  discoball: { len: 2.7, sfx: [[0.15, 'chain', 0.8], [0.9, 'chain', 0.5], [1.75, 'thud', 0.5], [1.85, 'sparks', 1]] },
  // a cloud of smoke, the dragon on its eggs shows through, coughs and blows a smoke ring
  dragon: { len: 2.6, sfx: [[0.2, 'puff', 1], [0.6, 'puff', 0.7], [1.7, 'cough', 1]] },
};

/** The beat before the entrance while the record is scratched (sound.ts), so the scratch is heard on its own. */
export const SCRATCH_BEAT = 0.5;
/** The beat between the entrance and the card, so the boss is seen on its own first, and how long the card takes to go. */
export const CARD_GAP = 0.35;
export const CARD_OUT = 0.3;
/** How long the card stays: long enough to read its line. */
export const cardHold = (line: string) => Math.min(4.6, Math.max(2.8, 2.2 + line.length / 24));

/** A boss's own kind, past its second and third forms. */
export const bossKind = (k: MobKind) => (MOBS[k].of ?? k) as string;

/** The line a boss says in a room: picked by the room's seed, so it is random from run to run and the same on every screen. */
export function lineOf(seed: number, k: string) {
  const lines = BOSS_LINES[k]?.lines ?? [];
  return lines[Math.floor(mulberry32(seed ^ 0x5eed)() * lines.length)] ?? '';
}

export interface Intro {
  /** The boss's own kind: king, ratswarm… */
  k: string;
  /** Seconds since the entrance began: below zero while the beat before it lasts. */
  t: number;
  /** The entrance on the field takes this long; the card shows from `card` to `end` (and is gone by then). */
  len: number;
  card: number;
  end: number;
  line: string;
  /** Sounds of the entrance already played. */
  heard: number;
}

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The entrance going on, if any; the scene reads it. */
export const intro = {
  now: null as Intro | null,
  /** What the screen does along the way (main.ts): play a sound, put the card up, take it down, the entrance is over. */
  on: {
    sfx: (_ev: Sfx, _p: number) => {},
    card: (_it: Intro) => {},
    cardOut: () => {},
    done: () => {},
  },

  /** The boss `k` comes in, `beat` seconds from now. */
  start(k: string, seed: number, beat = 0) {
    const e = ENTRANCES[k];
    if (!e) return;
    // with the motion turned down the boss just stands there and the card comes at once
    const len = reduce ? 0 : e.len, line = lineOf(seed, k), card = len ? len + CARD_GAP : 0.2;
    this.now = { k, t: -beat, len, card, end: card + cardHold(line) + CARD_OUT, line, heard: 0 };
    this.shown = false;
  },

  shown: false,

  update(dt: number) {
    const it = this.now;
    if (!it) return;
    it.t += dt;
    const e = ENTRANCES[it.k];
    if (it.len) while (it.heard < e.sfx.length && e.sfx[it.heard][0] <= it.t) { const [, ev, p] = e.sfx[it.heard++]; this.on.sfx(ev, p); }
    if (!this.shown && it.t >= it.card) { this.shown = true; this.on.card(it); }
    if (this.shown && it.t >= it.end - CARD_OUT && it.t - dt < it.end - CARD_OUT) this.on.cardOut();
    if (it.t >= it.end) this.finish();
  },

  /** A tap, or the fight starting: the boss stands in its place at once and the card goes. */
  skip() {
    if (this.now) this.finish();
  },

  finish() {
    this.now = null;
    this.on.done();
  },
};
