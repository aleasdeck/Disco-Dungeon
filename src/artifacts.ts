// Artifacts: the floor boss's trophies. After the boss of the first and the second floor falls (and in an event that gives
// one), the party is offered three that nobody in it has yet. A lone hero takes one; online each player takes a different
// one for their own hero (two players leave the third behind, three share all of them), and the heroes of players who
// dropped out get what is left.
// An artifact works for the hero who owns it, all fight long and all run long; the rules that read it live in src/game.ts.

import type { HeroState } from './game';
import { makeRng } from './rng';

export type ArtKey =
  | 'xray' | 'polish' | 'tray' | 'lube'
  | 'bells' | 'glasseye' | 'chalk' | 'spring' | 'insoles' | 'opener' | 'mirrorball'
  | 'undies' | 'cup' | 'hedgehog' | 'fangs' | 'belly' | 'sock' | 'tea'
  | 'denture' | 'battery' | 'energy' | 'piggy' | 'boomerang' | 'hand';

export interface ArtDef {
  key: ArtKey;
  name: string;
  /** What it does, in a line. */
  txt: string;
  /** The joke that comes with it once taken. */
  gag: string;
}

export const ARTIFACTS: ArtDef[] = [
  { key: 'xray', name: 'Рентген-очки из журнала', txt: 'Прицел показывает путь диска с тремя отскоками', gag: 'Заказаны по объявлению с последней страницы. Сквозь одежду не видно, зато видно отскоки.' },
  { key: 'polish', name: 'Полироль для лысины', txt: 'Меньше трения: диск катится на треть дальше', gag: 'Дядя Боря натирал им макушку перед свиданиями. Блестит так, что диск скользит сам.' },
  { key: 'tray', name: 'Поднос официантки', txt: 'Диск на треть шире: проще попасть, теснее в проходах', gag: 'С отпечатком помады и номером телефона на обороте. Чаевые прилагаются.' },
  { key: 'lube', name: 'Смазка «Скользкий Джо»', txt: 'Первые два отскока от стен и камней без потери скорости', gag: 'На тюбике подмигивает усатый Джо. Для дисков, только для дисков.' },
  { key: 'bells', name: 'Позолоченные бубенцы', txt: 'Звон бьёт ×3, а не ×2; твои диски звенят и друг о друга', gag: 'Звенят при каждом шаге, особенно когда не надо. Зато как звенят.' },
  { key: 'glasseye', name: 'Стеклянный глаз деда', txt: '«ТОЧНО!» бьёт ×3 вместо ×2', gag: 'Дед им не видел ничего, но всегда попадал. Подмигивает сам по себе.' },
  { key: 'chalk', name: 'Бильярдный мел', txt: '«ТОЧНО!» засчитывается и после отскоков от стен', gag: 'Украден из бара, где бармен до сих пор ищет, кто натёр кий о его усы.' },
  { key: 'spring', name: 'Скрипучая пружина от кровати', txt: 'Каждый отскок от стены +1 к удару, до +4', gag: 'Из номера для молодожёнов. Скрипит так, что соседи стучат в стену.' },
  { key: 'insoles', name: 'Свинцовые стельки', txt: 'После удара по врагу диск почти не тормозит и бьёт следующего', gag: 'Тяжёлые, вонючие и пробивные. Как и их прошлый владелец.' },
  { key: 'opener', name: 'Консервный нож', txt: 'Твой диск бьёт сквозь броню', gag: 'Вскрывает банки, латы и кошельки. Рыцари его боятся больше, чем дракона.' },
  { key: 'mirrorball', name: 'Карманный диско-шар', txt: 'Отскок от стены пускает зайчик: 1 урона ближайшему врагу, до 3 за бросок', gag: 'Крутится на цепочке, как брелок. Слепит врагов и случайных прохожих.' },
  { key: 'undies', name: 'Надувные труселя', txt: 'Диск перелетает ямы, а шипы и лава тебя не ранят', gag: 'В сердечко, с уточкой и клапаном сзади. Держат на плаву даже над пропастью. Надувать лучше не ртом.' },
  { key: 'cup', name: 'Спортивная ракушка', txt: '+3 щита в начале каждого хода', gag: 'Защищает самое ценное. Стучит при ходьбе, зато спокойно.' },
  { key: 'hedgehog', name: 'Ёж в штанах', txt: 'Кто бьёт тебя вблизи, сам получает 3', gag: 'Как он туда попал, лучше не спрашивать. Он и сам не знает.' },
  { key: 'fangs', name: 'Вампирские клыки с распродажи', txt: '+2 HP за каждого добитого тобой врага', gag: 'Пластиковые, светятся в темноте. Кровь пьют, но шепелявят.' },
  { key: 'belly', name: 'Пивной живот', txt: '+8 к наибольшему здоровью', gag: 'Годы тренировок в баре. Мягкий, тёплый и держит удар.' },
  { key: 'sock', name: 'Счастливый носок', txt: 'Раз за бой смертельный удар оставляет тебя с 1 HP', gag: 'Ни разу не стирался. Смерть подходит, нюхает и уходит.' },
  { key: 'tea', name: 'Ромашковый чай', txt: 'Враги звереют на 3 хода позже: на весь отряд', gag: 'Подливать врагам в кружки. Успокаивает, расслабляет, немного слабит.' },
  { key: 'denture', name: 'Золотая вставная челюсть', txt: 'Руда, грибы и кристалл отдают всё за один удар', gag: 'С алтаря диско-бога. Кусает жилу целиком и не морщится.' },
  { key: 'battery', name: 'Батарейка на язык', txt: 'Каждый бой начинаешь с полными искрами', gag: 'Лизнёшь, и искры из ушей. Проверено на скелетах.' },
  { key: 'energy', name: 'Энергетик «Бычий хвост»', txt: 'Умение стоит 2 искры вместо 3', gag: 'Сделан из того, о чём на банке писать стесняются. Бодрит.' },
  { key: 'piggy', name: 'Свинья-копилка', txt: '+1 руда за каждого добитого тобой врага', gag: 'Хрюкает от каждой монетки. Щель в спине для руды, вторая не для руды.' },
  { key: 'boomerang', name: 'Бумеранг с Ибицы', txt: 'Раз за ход диск, который ничего не задел, возвращается в руку', gag: 'Привезён с пенной вечеринки. Всегда возвращается, как бывшая.' },
  { key: 'hand', name: 'Третья рука', txt: '+1 диск за ход, даже сверх трёх', gag: 'Резиновая, из магазина приколов. Откуда растёт, лучше не смотреть.' },
];

export const artDef = (k: string) => ARTIFACTS.find(a => a.key === k) ?? ARTIFACTS[0];

/** Trophies the floor boss leaves for the party to choose from. */
export const OFFER = 3;

/** Whether a hero owns this artifact (saves from before artifacts have none). */
export const has = (h: Pick<HeroState, 'arts'>, k: ArtKey) => !!h.arts?.includes(k);

/** The boss's trophies the party stands over, the same on every screen: the host keeps them and shares them with the map. */
export interface LootState {
  /** The room's seed: the trophies offered were rolled from it. */
  seed: number;
  /** The floor whose boss fell, 0 or 1. */
  floor: number;
  offer: ArtKey[];
  /** Online: the trophy each player points at, by hero, by its place in `offer`. */
  picks: Record<number, number>;
  /** Once shared out: which trophy each hero took, by hero (a duo leaves one behind). */
  done?: Record<number, ArtKey>;
  /** The event whose outcome gave them (its key); none for a floor boss's hoard. */
  from?: string;
}

/** The trophies a boss leaves: OFFER of the artifacts nobody in the party has yet, the same on every screen. */
export function rollOffer(seed: number, party: Pick<HeroState, 'arts'>[]): ArtKey[] {
  const owned = new Set(party.flatMap(h => h.arts ?? []));
  const left = ARTIFACTS.map(a => a.key).filter(k => !owned.has(k)), R = makeRng(seed * 13 + 7), out: ArtKey[] = [];
  while (out.length < OFFER && left.length) out.push(left.splice(R.int(0, left.length - 1), 1)[0]);
  return out;
}

export function newLoot(seed: number, floor: number, party: Pick<HeroState, 'arts'>[]): LootState {
  return { seed, floor, offer: rollOffer(seed, party), picks: {} };
}

/** Online the trophies are shared out once every player here points at one and no two point at the same. */
export function lootAgreed(loot: LootState, table: number[]) {
  const ps = table.map(h => loot.picks[h]);
  return ps.length > 0 && ps.every(p => p !== undefined && loot.offer[p] !== undefined) && new Set(ps).size === ps.length;
}

/**
 * Share the trophies out: every player here gets the one they point at; the heroes of players who dropped out get what
 * is left, in the party's order, one each while it lasts. A trophy that changes the hero at once (more health) does it now.
 */
export function settleLoot(loot: LootState, party: HeroState[], table: number[]) {
  if (loot.done) return;
  const done: Record<number, ArtKey> = {}, taken = new Set<number>();
  for (const h of table) {
    const p = loot.picks[h];
    if (p === undefined || taken.has(p) || !loot.offer[p]) continue;
    done[h] = loot.offer[p];
    taken.add(p);
  }
  const rest = loot.offer.filter((_, k) => !taken.has(k));
  for (const h of party) if (done[h.i] === undefined && !table.includes(h.i) && rest.length) done[h.i] = rest.shift()!;
  for (const h of party) {
    const k = done[h.i];
    if (!k) continue;
    (h.arts ??= []).push(k);
    if (k === 'belly') { h.max += BELLY; if (h.hp > 0) h.hp += BELLY; }
  }
  loot.done = done;
}

/** «Пивной живот»: this much more of the most health, and as much health at once. */
export const BELLY = 8;
