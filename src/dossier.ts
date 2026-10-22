// The enemies' dossier in «Коллекция»: an enemy stays a dark shape there until this player has met it, and every enemy
// has two lines of its file that open by beating it, 10 and 50 times; a floor's boss has its two at its first win and
// its fifth, and keeps the count. Every screen counts for its own player: a room's enemies are met while it is on, and
// once it is over the ones lying beaten count, whoever's disc it was; a boss counts when the party wins its room.
// Kept in this browser (`discodungeon.dossier`); `?progress=full` opens every line for a test.

import { MOBS, type MobKind } from './data';
import { stored } from './demo';
import { stats } from './stats';
import { ALL } from './progress';
import type { State } from './game';

/** How many times an enemy is beaten to open each of its two lines; a boss, how many wins over it. */
export const DOS_BEATS = [10, 50];
export const DOS_WINS = [1, 5];

/** Each enemy's two lines, the first and the second to open; a boss's phases share its own. */
export const DOSSIER: Partial<Record<MobKind, [string, string]>> = {
  // ---------------------------------------------------------------- Тюремные казематы
  skel: ['Особые приметы: никаких. Совсем никаких, даже кожи. Работает за еду, но есть нечем.', 'Каждого собирают заново из того, что нашлось на полу. Поэтому у некоторых две левые ноги.'],
  archer: ['Стреляет из-за угла, но угол каждый раз выбирает неудачный.', 'Мечтал стать снайпером. Не прошёл медкомиссию ни по росту, ни по совести.'],
  rat: ['Бегает быстрее всех в казематах: от кота, от охраны, от ответственности.', 'Сидит за контрабанду пармезана. Вину не признаёт, сыр не отдаёт.'],
  necro: ['Поднимает мёртвых, а сам по утрам встать не может.', 'Диплом заочный. Скелеты получаются, но всегда с одной лишней костью.'],
  guard: ['Носит дверь как щит. Дома спит стоя, на петлях.', 'Двадцать лет на посту. Дверь ни разу не открывал: ключ потерял в первый день.'],
  six: ['Бегает за Пахана за сигаретами, за чаем и за героями.', 'Мечтает дорасти хотя бы до семёрки. Пахан против.'],
  headsman: ['Рубит головы с душой. Душу потом тоже рубит.', 'На работе в маске, чтобы не узнали соседи. Соседи знают: топор торчит из пакета.'],
  king: ['Король всех казематов. Корону выиграл в карты у прошлого короля, вместе с головой.', 'Стучит скипетром об пол, потому что снизу опять шумят крысы.'],
  ratswarm: ['Сто крыс, связанных хвостами. Каждая уверена, что главная она.', 'Когда-нибудь развяжутся и разбегутся. Но не сегодня: узел вязал моряк.'],
  pahan: ['Сидит на шконке тридцать лет. Шконка уже сидит на нём.', 'Заточку точит о совесть. Совесть стала совсем тонкой.'],
  // ---------------------------------------------------------------- Ледяной склеп
  ghoul: ['Кусается и морозит. На свидании его хватает ровно на один поцелуй.', 'Внутри столько холода, что в склепе им охлаждают пиво.'],
  ghost: ['Через ход становится прозрачным. Так же он исчезает, когда приносят счёт.', 'Умер от смеха. Так и не понял, над чем.'],
  yeti: ['Шкура толщиной с матрас. На ней же и спит.', 'Не любит фотографироваться: все снимки выходят размытыми.'],
  witch: ['Лечит своих. Чужих не лечит, даже за деньги.', 'Варит зелья во льду: котёл давно сдала на металлолом.'],
  undertaker: ['Кладёт павших в гроб. Через два хода выкидывает обратно: аренда кончилась.', 'Снял мерку со всех героев заранее. На Бастионе рулетка кончилась.'],
  banshee: ['Визжит так, что у героев звенит в ушах. Соседи по склепу трижды вызывали участкового.', 'Пела в церковном хоре. Из хора ушли все, кроме неё.'],
  lich: ['Хранит душу в ледышке, ледышку в морозилке, морозилку под замком.', 'Метель насылает от скуки: ему тысяча лет, а в склепе нет интернета.'],
  fridge: ['Был обычным холодильником, пока в нём не забыли шаурму.', 'Дверцу не закрывает из принципа: пусть все видят, что внутри пусто и обидно.'],
  dancer: ['Умер на танцполе в 1979-м и до сих пор этого не заметил.', 'Нога сломана в трёх местах, а шпагат держит. Профессионал.'],
  // ---------------------------------------------------------------- Кузня
  imp: ['Поджигает всё, что движется. Что не движется, тоже, на всякий случай.', 'Мама хотела, чтобы он стал пожарным. В каком-то смысле так и вышло.'],
  slime: ['Где прошёл, там лужа лавы. Убирать за ним никто не хочет.', 'В душе мягкий и тёплый. Снаружи тоже, градусов на тысячу.'],
  bomber: ['Фитиль поджигает дольше, чем кидает бомбу. Зато с выражением.', 'Бровей нет с девяти лет. Бороду бережёт, носит в ведре с водой.'],
  golem: ['Броня 3, ум 0. В сумме всё равно впечатляет.', 'Обнимается раз в год, на Новый год. Потом месяц собирают того, кого обнял.'],
  grinder: ['Сам хилый, зато все рядом с ним острые. Как хороший тренер.', 'Точит ножи, топоры и языки. Языки у него получаются острее всего.'],
  smasher: ['Бьёт молотом квадратом 3 × 3. Кругами не умеет: геометрию прогулял.', 'Гвозди забивает лбом, молот носит для красоты.'],
  forgelord: ['Раскаляет пол, чтобы гости не засиживались.', 'Ковал себе корону, вышла сковородка. Носит с гордостью.'],
  discoball: ['Отражает удары, свет и любые попытки с ним поговорить.', 'Сорок лет висел над танцполом. Сорвался, когда поставили шансон.'],
  dragon: ['Высиживает яйца, курит и смотрит сериалы. Декрет по уходу за бесами.', 'Дымыч, потому что бросил курить. Дым остался.'],
};

/** The enemy a kind is counted as: a boss's later phases are the boss. */
export const dosKind = (k: MobKind): MobKind => MOBS[k].of ?? k;

/** Whether the kind has a card in the dossier: not a thing (a coffin, an egg, the bunk), a phase or a warm-up dummy. */
export const inDossier = (k: MobKind) => !MOBS[k].prop && !MOBS[k].of && !MOBS[k].dummy;

interface Dossier {
  v: 1;
  /** The enemies met. */
  met: string[];
  /** Enemies of each kind lying beaten when their room was over. */
  beat: Record<string, number>;
  /** Rooms won over each floor boss. */
  wins: Record<string, number>;
  /** The last room counted, so a room comes back from a save or a reconnect without counting twice. */
  last: string;
}

const KEY = stored('discodungeon.dossier');

/**
 * Read the dossier. A player from before there was one has met every enemy (not the bosses) of the floors they have
 * reached, by the statistics; the bosses wait for the next meeting, as nothing says which of a floor's three they beat.
 */
function load(): Dossier {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null') as Dossier | null;
    if (o && o.v === 1) return { v: 1, met: o.met ?? [], beat: o.beat ?? {}, wins: o.wins ?? {}, last: o.last ?? '' };
  } catch { /* unreadable: start over below */ }
  const met = (Object.keys(MOBS) as MobKind[]).filter(k => inDossier(k) && !MOBS[k].boss && MOBS[k].floor < stats.best.floor);
  return { v: 1, met, beat: {}, wins: {}, last: '' };
}

const dossier: Dossier = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(dossier)); } catch { /* private mode: the dossier lasts for this visit */ }
}

/**
 * The room on screen: its enemies are met, and once it is over, the enemies lying beaten in it and its boss, if the party
 * won, are counted, once a room. The warm-up's dummies don't count.
 */
export function noteRoom(S: State | undefined) {
  if (!S?.spec || S.spec.tut || !S.mobs.length) return;
  let changed = false;
  for (const m of S.mobs) {
    const k = dosKind(m.k);
    if (!inDossier(k) || dossier.met.includes(k)) continue;
    dossier.met.push(k);
    changed = true;
  }
  const id = `${S.spec.seed}:${S.spec.floor}:${S.spec.depth}:${S.spec.type}`;
  if (S.phase === 'over' && dossier.last !== id) {
    dossier.last = id;
    for (const m of S.mobs) {
      const k = dosKind(m.k);
      if (m.hp <= 0 && inDossier(k) && !MOBS[k].boss) dossier.beat[k] = (dossier.beat[k] ?? 0) + 1;
    }
    const boss = S.spec.type === 'boss' && S.heroes.some(h => h.hp > 0) ? S.mobs.map(m => dosKind(m.k)).find(k => MOBS[k].boss) : undefined;
    if (boss) dossier.wins[boss] = (dossier.wins[boss] ?? 0) + 1;
    changed = true;
  }
  if (changed) save();
}

/** What the dossier says of the kind `k`: met or not, how often beaten (a boss: won over), and how many of its lines are open. */
export function dossierOf(k: MobKind) {
  const boss = !!MOBS[k].boss, n = boss ? dossier.wins[k] ?? 0 : dossier.beat[k] ?? 0, need = boss ? DOS_WINS : DOS_BEATS;
  return { met: ALL || dossier.met.includes(k), n, need, open: ALL ? need.length : need.filter(x => n >= x).length, lines: DOSSIER[k] ?? null };
}
