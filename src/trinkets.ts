// Trinkets: small gag things lying about the rooms. Now and then a room has one, never more, on a cell of its own; a disc
// rolling over it takes it, and the hero who threw the disc says a line about it. The collection keeps the lines: each
// hero's line about a trinket opens once that hero has picked it up on this device (online the player's own hero, in the
// campaign any hero of the party).

import type { HeroState } from './game';

export interface TrinketDef {
  key: string;
  name: string;
  /** The floor it lies on, 0 to 2. */
  floor: number;
  /** Its picture among the room art (`env` in the manifest); a trinket turns up only once it has one. */
  art: string;
  /** Whether the picture is drawn yet: the rooms are built the same on every screen, so this can't wait on the loading. */
  drawn: boolean;
  /** What the collection says about it. */
  txt: string;
  /** What each hero says on picking it up, by the hero's key. */
  lines: Record<string, string>;
}

export const TRINKETS: TrinketDef[] = [
  // ------------------------------------------------------------ Тюремные казематы
  {
    key: 'bucket', name: 'Параша', floor: 0, art: 'bucket', drawn: true,
    txt: 'Казённое ведро с крышкой. Мухи прописаны тут с прошлого века.',
    lines: {
      bastion: 'Шлем! Великоват... и это точно не шлем.',
      ricochet: 'Мухи тут танцуют лучше, чем в моём клубе.',
      ash: 'Дорогуша, это даже поджигать противно.',
      cook: 'Компот вчерашний. Кто не допил?!',
      sharp: 'Ставлю на то, что внутри не золото. Выиграл.',
      electra: 'Сунуть туда провод? Нет. Даже я — нет.',
      kid: 'Кину туда петарду — будет салют! Коричневый.',
      bum: 'Пахнет, как я в лучшие годы.',
      genius: 'Заморожу и продам как пломбир.',
      bouncer: 'Тебя нет в списке. На выход. С мухами.',
      cop: 'Изъять, опечатать. Нюхать будет следователь.',
      model: 'Фу. Такое даже в Милане не носят.',
    },
  },
  {
    key: 'soap', name: 'Мыло на верёвке', floor: 0, art: 'trinket_soap', drawn: true,
    txt: 'Привязано, чтобы не ронять. В казематах это вопрос чести.',
    lines: {
      bastion: 'Не уроню. Ни за что. Даже не просите.',
      ricochet: 'На верёвочке, чтобы не нагибаться. Умно.',
      ash: 'Пахнет ромашкой и плохими решениями.',
      cook: 'Хозяйственное! И котлы, и руки, и повара.',
      sharp: 'Уронить мыло — худшая ставка в жизни.',
      electra: 'Мыло на верёвке? Мне не страшно, у меня шокер.',
      kid: 'За ушами мыть? Пусть мамка сама моет!',
      bum: 'Мыло... А его разве пьют?',
      genius: 'Замёрзшее мыло не выскользнет. Наука!',
      bouncer: 'Кто уронил мыло, сам виноват.',
      cop: 'Верёвку изымаю как улику. Мыло — себе.',
      model: 'Бренд не тот, но верёвочка стильная.',
    },
  },
  {
    key: 'chifir', name: 'Чифирбак', floor: 0, art: 'trinket_chifir', drawn: true,
    txt: 'Мятая алюминиевая кружка с чаем, в котором ложка стоит сама.',
    lines: {
      bastion: 'Чай! Крепкий, как мой пресс. Ну, живот.',
      ricochet: 'Глоток — и танцую до четверга.',
      ash: 'Чёрный, горький, горячий. Как мой бывший.',
      cook: 'Заварку не жалели. Уважаю!',
      sharp: 'Глотнул — и вижу карты сквозь рубашку.',
      electra: 'Кофеин?! Мне?! Я и так искрю!',
      kid: 'Мамка не даёт чай после шести. А тут!',
      bum: 'Не водка. Но цвет — как моя жизнь.',
      genius: 'Чай со льдом. Я сказал: со льдом!',
      bouncer: 'Попил — и трое суток на входе, не моргая.',
      cop: 'Нарушение режима! Отпиваю для проверки.',
      model: 'Детокс? Ой, это не детокс. Это тюрьма.',
    },
  },
  {
    key: 'dice', name: 'Кубики из хлеба', floor: 0, art: 'trinket_dice', drawn: true,
    txt: 'Слеплены из пайки и высушены на батарее. Тут играли в кости, пока не придумали диски.',
    lines: {
      bastion: 'Кубики! А их можно съесть? Можно.',
      ricochet: 'Кубики? Прошлый век. Мы теперь в диски, детка.',
      ash: 'Подсушу огоньком — будут гренки.',
      cook: 'Хлеб на игрушки переводить?! Убью!',
      sharp: 'Утяжелю на шестёрку. Привычка.',
      electra: 'Кубики? А где у них батарейка?',
      kid: 'Сгрызу, пока никто не видит!',
      bum: 'Закуска! Из хлеба, ещё и в крапинку.',
      genius: 'Ржаной хлеб, двести лет выдержки. Шедевр.',
      bouncer: 'Азартные игры в зале? На выход.',
      cop: 'Подпольное казино. Опечатываю. Кубик — на обед.',
      model: 'Хлеб?! Углеводы?! Убери от меня!',
    },
  },
  {
    key: 'letter', name: 'Письмо заочнице', floor: 0, art: 'trinket_letter', drawn: true,
    txt: 'Конверт в сердечках, заклеен поцелуем. Адрес: «Самой красивой, до востребования».',
    lines: {
      bastion: 'Мне? От девушки?! Мама, я популярен!',
      ricochet: 'Ещё одна поклонница. Положу к остальным сорока.',
      ash: 'Прочитаю и сожгу. Как все любовные письма.',
      cook: '«Жду, люблю»... Петрович так же писал. Из пивной.',
      sharp: 'Помада дорогая. Значит, дама при деньгах.',
      electra: 'Любовное письмо! Волосы дыбом. Ещё дыбее.',
      kid: 'Фу, сюси-муси! Ща всем вслух прочитаю!',
      bum: 'Мне никто не пишет... Возьму. Будто мне.',
      genius: 'Чувства — глупая химия. Но пахнет приятно.',
      bouncer: 'Без имени? Значит, мне. Я тут фейсконтроль.',
      cop: 'Переписка с заключёнными! Изучу лично. Дважды.',
      model: 'Помада не моего оттенка. Подделка!',
    },
  },
  // ------------------------------------------------------------ Ледяной склеп
  {
    key: 'skull', name: 'Череп в чепчике', floor: 1, art: 'bones_bra', drawn: true,
    txt: 'Чей-то череп нашёл, чем укрыть макушку от сквозняка. Кружевной чепчик на две чашечки.',
    lines: {
      bastion: 'Тёплая шапочка! С двумя отделениями.',
      ricochet: 'Кто-то отлично провёл вечер. И не вернулся.',
      ash: 'Мой размер, кстати. Был.',
      cook: 'Голову прикрыл, а кости наружу. Мужики!',
      sharp: 'Шапка с двумя карманами. Для тузов.',
      electra: 'Кружевная антенна! Ловит радио «Шансон».',
      kid: 'Хи-хи. Лифчик. Хи-хи-хи.',
      bum: 'Братан, ты вечер провёл, как я по пятницам.',
      genius: 'Образец № 17: мужчина, череп, вечер удался.',
      bouncer: 'В таком виде в клуб нельзя. Хотя ты и не дышишь.',
      cop: 'Личность не установлена. Приметы — особые.',
      model: 'Кружево прошлого сезона. Беру как винтаж.',
    },
  },
  {
    key: 'snow', name: 'Жёлтый снежок', floor: 1, art: 'trinket_snow', drawn: true,
    txt: 'Снежок как снежок. Только жёлтый. Лимоном не пахнет.',
    lines: {
      bastion: 'Лимонное мороженое! ...Ой.',
      ricochet: 'Жёлтый, но не золото. Совсем не золото.',
      ash: 'Растопить? Нет. Пусть лучше будет снегом.',
      cook: 'Кто тут лимонад разливает?! А ну признавайтесь!',
      sharp: 'Первое правило: не бери жёлтый снег. Я нарушил.',
      electra: 'Жёлтый снег проводит ток. Проверено. Больно.',
      kid: 'Это не я. Ну... не только я.',
      bum: 'Моё. Подписано.',
      genius: 'Заморожено идеально. Происхождение — тайна.',
      bouncer: 'Кто метит территорию? Выйдем.',
      cop: 'Улика. На анализ. Хотя анализ уже ясен.',
      model: 'Это лимонный скраб? НЕТ?! Фу-фу-фу!',
    },
  },
  {
    key: 'urn', name: 'Урна с прахом', floor: 1, art: 'trinket_urn', drawn: true,
    txt: 'Глиняная, с бантиком и трещиной. Кто внутри, не подписано, но крышку держат крепко.',
    lines: {
      bastion: 'Тяжёлая. Тут кто-то живёт? Жил.',
      ricochet: 'Прах танцора. Последний выход на танцпол.',
      ash: 'О, моя работа. Помню, горел красиво.',
      cook: 'Перец молотый? А, нет... Ну, врагам сойдёт.',
      sharp: 'Тут лежит тот, кто поймал меня на тузе.',
      electra: 'Если пустить ток — он встанет? Нет? Жаль.',
      kid: 'Чур, я понесу! Ой. Ой-ой. Апчхи!',
      bum: 'Пепельница! Наконец-то нормальная.',
      genius: 'Человек в удобной для хранения форме. Чудесно.',
      bouncer: 'Этого я уже выносил. Как видишь, до конца.',
      cop: 'Подозреваемый задержан. Показаний не даёт.',
      model: 'Пудра? Слишком серая для моего тона.',
    },
  },
  {
    key: 'carrot', name: 'Морковка снеговика', floor: 1, art: 'trinket_carrot', drawn: true,
    txt: 'Снеговик где-то бродит без носа и очень обижен.',
    lines: {
      bastion: 'Морковка! Витамины для бицепса.',
      ricochet: 'Нос снеговика. У меня длиннее. Нос, детка, нос.',
      ash: 'Снеговик без носа. Растаял, когда я прошла.',
      cook: 'В суп! И нечего хихикать.',
      sharp: 'Снеговик проиграл мне нос. Сам ставил.',
      electra: 'Два провода в морковку! Ничего. Но красиво.',
      kid: 'Снеговик теперь безносый! Так ему!',
      bum: 'Закуска. Холодная, как я люблю.',
      genius: 'Кто обидел снеговика?! Он один меня понимал!',
      bouncer: 'Нос сломан. Снеговик дерзил на входе.',
      cop: 'Тяжкие телесные снеговику. Ищем свидетелей.',
      model: 'Морковка — весь мой ужин на неделю!',
    },
  },
  {
    key: 'hotbottle', name: 'Грелка', floor: 1, art: 'trinket_hotbottle', drawn: true,
    txt: 'Красная, резиновая и ещё тёплая. В склепе её берегут пуще золота.',
    lines: {
      bastion: 'Грелка! Как у мамы под одеялом.',
      ricochet: 'Тёплая, мягкая, красная. Как моя бывшая.',
      ash: 'Я и так горячая, но спасибо.',
      cook: 'Кому к пояснице? В очередь, мужики!',
      sharp: 'Тёплая. Значит, за этим столом недавно играли.',
      electra: 'Резина! Изолятор! Моё любимое!',
      kid: 'Надую и подложу кому-нибудь! Пррр!',
      bum: 'Грелка. Самая верная баба в моей жизни.',
      genius: 'Тепло? Фу. Уберите. Нет, оставьте, ноги мёрзнут.',
      bouncer: 'Тёплая. Ладно, проходи. Только тихо.',
      cop: 'Не положено. Конфискую. До весны.',
      model: 'Сошью из резины платье — и в Париж!',
    },
  },
  // ------------------------------------------------------------ Кузня
  {
    key: 'anvil', name: 'Наковальня', floor: 2, art: 'anvil', drawn: true,
    txt: 'С раскалённой подковой. Кузнец ушёл на обед лет триста назад.',
    lines: {
      bastion: 'Ха! Подушка для моей головы!',
      ricochet: 'Подкова горячая. Как я на танцполе.',
      ash: 'Подковка раскалилась. Не я. Почти не я.',
      cook: 'Котлеты отбивать! Наконец-то нормальная доска!',
      sharp: 'Подкова на удачу? Мне не надо, у меня рукава.',
      electra: 'Железо! Проводит! Ай, горячо!',
      kid: 'Петарду сюда — бабахнет на всю кузню!',
      bum: 'Сдам в металлолом. На ящик хватит.',
      genius: 'Заморожу и расколю. Наука против кузнецов!',
      bouncer: 'Беру. Дверь в клубе подпирать нечем.',
      cop: 'Самогонный аппарат? Нет? Всё равно изымаю.',
      model: 'Дорого-богато, но не к платью.',
    },
  },
  {
    key: 'kebab', name: 'Шашлык на шампуре', floor: 2, art: 'trinket_kebab', drawn: true,
    txt: 'Жарили на лаве, вышло с дымком. И чуть-чуть с серой.',
    lines: {
      bastion: 'Шашлык! Лучшее в моей жизни! После мамы.',
      ricochet: 'Мясо с огоньком. Как я.',
      ash: 'Пережарен. Моя слабость.',
      cook: 'Кто так маринует?! Дай сюда, доведу!',
      sharp: 'Мясо съем, шампур в рукав. Пригодится.',
      electra: 'Шампур — это просто антенна с мясом!',
      kid: 'Мамке не скажу! Съем сам!',
      bum: 'Закуска есть! Осталось найти, чем запить.',
      genius: 'Горячее мясо. Отвратительно. В морозилку.',
      bouncer: 'Со своей едой нельзя. Конфискую. В себя.',
      cop: 'Изъято. Проверено. Съедено. Вкусно.',
      model: 'Только понюхаю. Нюхать — ноль калорий.',
    },
  },
  {
    key: 'pan', name: 'Сковородка с вмятиной', floor: 2, art: 'trinket_pan', drawn: true,
    txt: 'Чугунная. Вмятина на боку очень похожа на чьё-то лицо.',
    lines: {
      bastion: 'Вмятина как моя голова! Ой... это моя голова.',
      ricochet: 'Знакомая вмятина. Дискотека, восемьдесят пятый.',
      ash: 'Яичницу на сковородку, сковородку на мужа.',
      cook: 'Моя! Ею ж я Петровича...',
      sharp: 'Против чугуна мои карты бессильны.',
      electra: 'Заземлена? Головой проверено!',
      kid: 'Мамкина! Она за ней прибежит! Тикаем!',
      bum: 'Знакомое лицо... Похоже, это я.',
      genius: 'Отпечаток лица в чугуне. Прекрасный образец.',
      bouncer: 'Кто ей махал? Договаривались: бьёт только бита.',
      cop: 'Орудие бытового конфликта. Изымаю.',
      model: 'Этим бьют мужей? Беру. На всякий случай.',
    },
  },
  {
    key: 'bellows', name: 'Кузнечные меха', floor: 2, art: 'trinket_bellows', drawn: true,
    txt: 'Раздувают горн. Звук при этом такой, что все косятся на соседа.',
    lines: {
      bastion: 'Ха, пукают! Как я после маминых голубцов!',
      ricochet: 'Дуну — и вся кузня танцует!',
      ash: 'Ветерок! Раздуваю огонь в сердцах.',
      cook: 'Раздувать мехами, а не губами! Беру на кухню.',
      sharp: 'Дутые, как ставки моих соперников.',
      electra: 'Сжатый воздух! Почти энергия!',
      kid: 'Пук-пук! Буду так под дверью у сестры!',
      bum: 'Мне такие не нужны. У меня свои.',
      genius: 'Горячий воздух. Враг номер один. Изъят.',
      bouncer: 'Кто испортил воздух? А, это меха. Живите.',
      cop: 'Нарушение тишины и воздуха. Протокол.',
      model: 'Фен! А, не фен. Ну, укладка всё равно будет.',
    },
  },
  {
    key: 'kettlebell', name: 'Гиря', floor: 2, art: 'trinket_kettlebell', drawn: true,
    txt: 'Двухпудовая, ржавая, с отпечатками богатырских ладошек.',
    lines: {
      bastion: 'Двухпудовка! На разминку... Ой, спина.',
      ricochet: 'Не мой вес, детка. Мой вес — пять кило золота.',
      ash: 'Тяжёлая, как мои мысли по утрам.',
      cook: 'Мужикам на зарядку, мне тесто прижать!',
      sharp: 'Тянет вниз, как долги.',
      electra: 'Зарядила. Всё равно гиря. Обидно.',
      kid: 'Не поднять! Ничего, подорву!',
      bum: 'Буду за неё держаться. Чтоб не штормило.',
      genius: 'Культ мышц. Отвратительно. Заморожу.',
      bouncer: 'Моя! Потерял её в девяносто шестом!',
      cop: 'Бой с тенью? Нет, с гирей. Изымаю для тренировок.',
      model: 'Она тяжелее меня! Не смейтесь.',
    },
  },
];

export const trinketDef = (k: string) => TRINKETS.find(t => t.key === k);

/** The trinkets that turn up on this floor: those with a picture. */
export const trinketsOf = (floor: number) => TRINKETS.filter(t => t.drawn && t.floor === Math.min(floor, 2));

/** The share of rooms with a fight that have a trinket lying about. */
export const TRINKET_CHANCE = 0.17;
/** How close to a trinket a disc's edge has to pass to take it, in world units: about the middle half of its cell. */
export const TRINKET_R = 3.5;
/** Seconds the hero's line stays up after the pickup. */
export const SAY_TIME = 4.5;

// ------------------------------------------------------------ the collection

const KEY = 'discodungeon.trinkets';

/** The heroes who have picked up each trinket on this device, by the trinket's key: their lines are open in the collection. */
export type Collection = Record<string, string[]>;

function load(): Collection {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export const collection: Collection = load();

/** When each line was opened in this visit, by `trinket:hero`: the speech bubble marks a line just opened. */
const openedAt = new Map<string, number>();

/** Whether this hero's line about this trinket was opened in the last few seconds. */
export const justOpened = (trinket: string, hero: string) => performance.now() - (openedAt.get(trinket + ':' + hero) ?? -Infinity) < (SAY_TIME + 1) * 1000;

/** Whether this hero's line about this trinket is open. */
export const opened = (trinket: string, hero: string) => !!collection[trinket]?.includes(hero);

/**
 * Open the lines of what this player's heroes (online the own one, in the campaign the party) have picked up so far in the
 * run: the host lists each hero's finds (`HeroState.found`) and the snapshots carry them. Returns the lines opened just now.
 */
export function collect(heroes: HeroState[]): { trinket: string; hero: string }[] {
  const fresh: { trinket: string; hero: string }[] = [];
  for (const h of heroes) {
    for (const k of h.found ?? []) {
      if (!trinketDef(k) || opened(k, h.def.key)) continue;
      (collection[k] ??= []).push(h.def.key);
      openedAt.set(k + ':' + h.def.key, performance.now());
      fresh.push({ trinket: k, hero: h.def.key });
    }
  }
  if (fresh.length) {
    try { localStorage.setItem(KEY, JSON.stringify(collection)); } catch { /* private mode: the lines stay open for this visit */ }
  }
  return fresh;
}
