// Static game data: biomes, heroes, mobs, resource nodes, room types.

import { makeRng } from './rng';

export const INK = '#1a1210';
export const ENEMY_BASE = '#b8323f';
export const TILE = 16;
export const WALL_H = 34;
/**
 * Discs each hero throws per turn at the start of a run, the most they can upgrade to, and what each extra disc costs in ore.
 * A second disc doubles a hero's throws, so it costs far more than a level of any stat.
 */
export const HAND_START = 1;
export const HAND_MAX = 3;
export const HAND_COST = [8, 16];
export const AB_COST = 3;
/**
 * An ability works through the hero's discs: it is switched on for the rest of the turn and every disc thrown after it carries it.
 * Bastion's hits shield the whole party, Ash's pile fire on the enemy (it burns that much and dies down by one each turn),
 * Ricochet's discs keep all their speed for a run of bounces, off enemies too.
 */
export const AB_SHIELD = 3;
export const AB_BURN = 4;
export const AB_BOUNCES = 8;
/** While a Ricochet disc still has sure bounces left it never rolls slower than this. */
export const AB_SPEED = 180;
/**
 * Electra's lightning: each hit of her disc strikes the enemy, then leaps on to the nearest enemy not struck yet within
 * ZAP_REACH of the last one, and on once more, weaker each time. It goes through armour.
 */
export const ZAP = [4, 3, 2];
export const ZAP_REACH = 6 * 16;
/**
 * The cook's food: her disc drops a dish at each of its first FOOD_PER_DISC bounces (walls, blocks, resources, enemies). It lands in
 * the middle of a cell about a cell off, one dish to a cell (a taken cell sends it to the nearest free one beside), and heals
 * FOOD_HEAL to the hero whose disc rolls over it, any disc but the one that dropped it; a hero at full health leaves it
 * lying. Discs roll over food, nothing bounces off it, and it lies there till the fight ends.
 */
export const FOOD_PER_DISC = 3;
export const FOOD_HEAL = 3;
/** Most dishes on the floor at once: a full floor takes no more. */
export const FOOD_MAX = 9;
/** Beating a floor's boss gives every hero back this share of their most health, up to the top; a fallen hero gets up with it. */
export const BOSS_HEAL = 0.5;
/** The card sharp's fan: two more discs fly out at this angle on each side of the thrown one, dealing this share of its damage. */
export const FAN_ANGLE = 0.16;
export const FAN_M = 0.7;
/**
 * The fan's side discs are phantoms: this share of his disc's size, pink and see-through, and one that drops into a hole
 * or stops on spikes or lava costs him no health.
 */
export const FAN_R = 0.7;
/**
 * The bum's «Амбре»: the first bounce of his disc lets out a cloud of green gas GAS_R cells each way with the corners
 * cut off (21 cells), for GAS_TURNS enemy turns. An enemy in it as its move begins loses GAS_PCT of its full health,
 * rounded up, through armour, and strikes GAS_WEAK weaker on that move. Clouds don't add up; past GAS_MAX the oldest clears.
 */
export const GAS_R = 2;
export const GAS_TURNS = 3;
export const GAS_PCT = 0.05;
export const GAS_WEAK = 0.3;
export const GAS_MAX = 6;
/**
 * The kid's «Отвлекуха»: his disc drops a firecracker at its first bounce off anything but an enemy, laid like the cook's
 * dishes, one on the field at a time (PETARD_MAX): while it lies there the ability won't go on. It crackles where it lies:
 * of the enemies within PETARD_HEAR cells of it that mean to go for a hero, the PETARD_LURE nearest go for the noise instead
 * and strike nobody on that move. In the enemies' turn the first enemy to come within a cell of it sets it off and takes
 * PETARD_DMG through armour, and it is gone; nobody comes in PETARD_TURNS enemy turns, it fizzles out.
 */
export const PETARD_MAX = 1;
export const PETARD_TURNS = 3;
export const PETARD_DMG = 2;
export const PETARD_HEAR = 3;
export const PETARD_LURE = 2;
/**
 * The ice genius's «Заморозка»: an enemy his disc hits once walks at most FROST_STEPS cells on its next move, hit twice it
 * skips the move. Till the frost wears off it takes more from the heroes' discs and tricks, rounded up: FROST_SLOW_VULN
 * slowed, FROST_VULN frozen stiff.
 */
export const FROST_STEPS = 1;
export const FROST_SLOW_VULN = 0.25;
export const FROST_VULN = 0.5;
/** How much more a frosted enemy takes from the heroes: nothing without frost, a quarter slowed, a half frozen. */
export const frostVuln = (frost = 0) => (frost >= 2 ? FROST_VULN : frost > 0 ? FROST_SLOW_VULN : 0);
/** Online, at most this many players sit at one table: rooms are built for one to three heroes. */
export const MAX_PLAYERS = 3;
/** Ore for each level of a disc stat; a party can't buy everything in one run, so it has to choose. */
export const UP_COST = [3, 4, 6];

/** Enemy turn from which every enemy hits one harder each turn ("ярость"): long fights get deadly. Bosses start later. */
export const RAGE_FROM = 5;
export const RAGE_FROM_BOSS = 7;
/** How much of its speed a disc keeps after hitting an enemy or a resource: one throw, one target, no pinball. */
export const MOB_E = 0.35;
export const NODE_E = 0.3;
/** A disc that flies straight into an enemy, nothing touched on the way, and hits it square on deals this much more. */
export const CRIT = 2;
export const CRIT_COS = 0.95;

export interface Biome {
  name: string;
  f: [string, string];
  g: string;
  w: [string, string];
  cap: string;
  mu: number;
  /** Friction on ice patches, for biomes whose floor freezes in places. */
  iceMu?: number;
  haz: 'spikes' | 'lava';
  hazDmg: number;
  bg: [string, string];
  torch: string;
  /** Suffix of this floor's room art in the manifest: slab_<art>_0..7, wall_<art>, pillar_<art>. */
  art: string;
  /** The floor's light on the figures: their pictures are multiplied by it, warm by the torches, cold in the crypt. */
  light: string;
}

/**
 * Words chalked on the walls: `all` on every floor, plus the floor's own list by its art key.
 * A line break splits a word over two lines.
 */
export const WALL_WORDS: Record<string, string[]> = {
  all: [
    'KILROY\nWAS HERE', 'WTF', 'LOSER', 'FUCK', 'FUCK\nTHIS', 'BUTT', 'LOL', 'YOLO', 'NO HOPE', 'HELP', 'RUN', 'TURN\nBACK',
    "IT'S A\nTRAP", 'GAME\nOVER', 'NOOB', 'GIT GUD', 'TRY\nAGAIN', 'DEAD\nEND', 'SEND\nHELP', 'I WAS\nHERE', 'NOBODY\nCARES',
    'NICE\nBUTT', 'WASH ME', 'BITE ME', 'KISS\nMY ASS', 'SUCKS', 'BOO', 'FREE\nHUGS', 'NO EXIT', 'THIS\nWAY', 'WRONG\nWAY',
    "DON'T\nLOOK UP", 'BEHIND\nYOU', 'DIG\nHERE', 'DAY 1', 'BORED', 'OUCH', 'OOPS', 'SHH', 'LOOT IS\nA LIE', 'NO\nREFUNDS',
    'BEER\nTOMORROW', 'PEE\nHERE', 'SMELLS\nLIKE FEET', 'HEROES\nSUCK', 'MIND\nTHE DISC', 'ROLL\nFOR DMG', 'NAT 1', 'CRIT!',
    'MISSED', 'SO CLOSE', 'NOT\nTODAY', 'WHO\nFARTED?', 'FART\nZONE', 'BRB', 'AFK', 'GG', 'EZ', 'REKT', 'OWNED', 'RIP',
    'RIP BOB', 'BOB WAS\nHERE', 'BOB\nSUCKS', 'ASS', 'BOOBS', 'DAMN', 'HELL\nYEAH', 'SHIT', 'HOLY\nSHIT', 'MEH', 'NO\nSMOKING',
    'WET\nPAINT', 'CALL\nMOM', 'U MAD?', 'NICE\nTRY', 'TOO\nEASY', 'PANTS\nOFF', 'WHERE\nAM I?', 'MONSTERS\nAHEAD',
    'ХУЙ', 'ЛОХ', 'ЖОПА', 'СУКА', 'БЛИН', 'ГОВНО', 'ПИПЕЦ', 'ДНО', 'ДУРАК', 'ТУТ БЫЛ\nВАСЯ', 'ВАСЯ\nЛОХ', 'МАМА\nПРОСТИ',
    'ВЫХОДА\nНЕТ', 'НЕ ВЛЕЗАЙ\nУБЬЁТ', 'ГЕРОИ\nЛОХИ', 'БЕГИ', 'ПОМОГИТЕ', 'ЗДЕСЬ\nНЕ ССАТЬ',
  ],
  prison: [
    'KING\nSUX', 'FREE ME', 'INNOCENT', "I DIDN'T\nDO IT", 'GUARDS\nSUCK', 'DIG\nTUNNEL', 'DAY 3652', 'LIFE\nSENTENCE',
    'ESCAPE\nPLAN', 'WARDEN\nIS FAT', 'RATS\nBITE', 'NO\nPAROLE', 'BONE\nAPPETIT', 'SKELETON\nCREW', 'LOCKED\nUP',
    'GOBLINS\nSTINK', 'SAW THE\nKING NAKED', 'KEY IS\nUNDER RAT', 'КОРОЛЬ\nЛОХ', 'НА ВОЛЮ', 'КРЫСЫ\nКУСАЮТ',
  ],
  ice: [
    'COLD\nAS HELL', 'FROZEN\nBUTT', 'BRRR', 'YETI\nSTINKS', 'LICH\nSUX', 'NO\nSKATING', 'THIN ICE', 'FREEZE!', 'CHILL',
    'COLD\nFEET', 'NUMB\nNUTS', 'WITCH\nIS UGLY', 'GHOST\nFARTS', 'SNOWBALL\nFIGHT', 'NO TONGUE\nON POLES',
    'ХОЛОДНО\nБЛИН', 'ЖОПА\nМЁРЗНЕТ', 'ЛИЧ\nЛОХ', 'ЙЕТИ\nСУКА',
  ],
  forge: [
    'HOT\nAS HELL', 'NO\nPEEING', 'SMITH\nSUX', 'BURN', 'HOT\nSTUFF', 'TOO HOT', 'LAVA\nFLOOR', "DON'T\nTOUCH", 'FIRE!',
    'SWEATY', 'MELTED', 'FORGE\nAHEAD', 'STRIKE\nWHILE HOT', 'SPICY', 'IMPS\nCHEAT', 'SLIME\nSMELLS', 'BOOM',
    'ЖАРКО\nКАК В АДУ', 'КУЗНЕЦ\nЛОХ', 'ГОРИ\nОНО ВСЁ',
  ],
};

/** Lines the loading screen cycles through while the pictures and fonts come in. */
export const BOOT_GAGS = [
  'Натираем диско-шар до блеска',
  'Скелет ищет свою вторую берцовую кость',
  'Король-в-короне ищет корону. Она на нём',
  'Некромант будит скелетов. Скелеты просят ещё пять минут',
  'Йети бреет спину к вечеринке',
  'Бастион втягивает живот перед зеркалом',
  'Зажигалка чиркает. Загорелось с пятого раза',
  'Рикошет отскакивает от стен. Просто так, для разминки',
  'Шкет поджёг петарду в почтовом ящике. Опять',
  'Перегар ищет закуску. Нашёл воблу у себя в кармане',
  'Отморозок замораживает пиво. Пиво против',
  'Ледяная ведьма жалуется, что ей холодно',
  'Ледяной лич размораживает пельмени',
  'Бес-кочегар подкидывает в печь чужие носки',
  'Гном-подрывник ищет спички. Лучше бы не нашёл',
  'Голем считает до трёх. Сбился на двух',
  'Владыка кузни куёт себе новые трусы',
  'Призрак прошёл сквозь стену. Стена в шоке',
  'Тюремные крысы делят руду. Крысы проигрывают',
  'Учим ледяного упыря танцевать хастл',
  'Пишем на стенах слово из трёх букв. ДНО',
  'Стираем со стены «ВАСЯ ЛОХ». Вася очень просил',
  'Подметаем подземелье. Под ковёр, разумеется',
  'Подтачиваем шипы. Для остроты ощущений',
  'Прячем руду поглубже, чтобы было интересно',
  'Кузнец пересчитывает цены. Ржёт',
  'Грибы в комнатах съедобные. Почти все',
  'Выкинули кубики, достали диски',
  'Убеждаем скелетов, что диско не умерло',
];

export const BIOMES: Biome[] = [
  { name: 'Тюремные казематы', f: ['#6f6a64', '#79736b'], g: '#3b3631', w: ['#4a433c', '#5a5148'], cap: '#857b6e', mu: 70, haz: 'spikes', hazDmg: 3, bg: ['#2d2621', '#0e0b09'], torch: '255,160,70', art: 'prison', light: '#ffdcb4' },
  { name: 'Ледяной склеп', f: ['#7c878c', '#869197'], g: '#4f6a74', w: ['#4a6470', '#56717e'], cap: '#a3bfc9', mu: 65, iceMu: 20, haz: 'spikes', hazDmg: 3, bg: ['#1f2d34', '#0a1013'], torch: '150,220,255', art: 'ice', light: '#bcd6ee' },
  { name: 'Кузня', f: ['#7a5947', '#84624f'], g: '#3f2c24', w: ['#4c3128', '#5a3b30'], cap: '#8a634f', mu: 85, haz: 'lava', hazDmg: 4, bg: ['#30180f', '#0e0705'], torch: '255,130,50', art: 'forge', light: '#ffc6a0' },
];

export type MobKind =
  | 'skel' | 'archer' | 'rat' | 'necro' | 'king'
  | 'ghoul' | 'ghost' | 'yeti' | 'witch' | 'lich'
  | 'imp' | 'slime' | 'bomber' | 'golem' | 'forgelord';

/**
 * Something a mob does instead of its usual attack on turns where `turn % every === at`.
 * summon: raises `n` mobs of `kind` on circles marked a turn ahead; heal: mends the most hurt ally by `amt`;
 * slam: hits every hero at once (`chill` also chills them); heat: turns tiles in front of the heroes' runes into lava.
 */
export interface MobAct {
  k: 'summon' | 'heal' | 'slam' | 'heat';
  every: number;
  at: number;
  n?: number;
  kind?: MobKind;
  amt?: number;
  chill?: boolean;
  /** Most of this mob's summons alive at once. */
  cap?: number;
}

export interface MobDef {
  name: string;
  /** Floor the mob lives on, 0..2. */
  floor: number;
  hp: number;
  r: number;
  speed: number;
  /** 999 means it shoots across the whole room, at a hero it sees; out of sight it walks to where it sees one. */
  reach: number;
  dmg: number;
  armor?: number;
  /** Cells it covers on each side: big enemies stand on 2 × 2 cells, the rest on one. */
  size?: 2;
  /** Height of the figure above its base, in world units; used to scale sprites. */
  fig: number;
  boss?: boolean;
  acts?: MobAct[];
  /** Its hits chill: the hero's throws are weaker next turn. */
  chill?: boolean;
  /** Its hits set the hero on fire: 2 more damage at the start of the next enemy turn. */
  fire?: boolean;
  /** Bodiless on even turns: discs pass through it. */
  ghost?: boolean;
  /** Leaves a pool of lava where it dies. */
  lava?: boolean;
  /** Hits harder (+3) once below half HP. */
  rage?: boolean;
  /** Spends odd turns lighting a bomb and throws it for double damage on even turns. */
  charge?: boolean;
  txt: string;
  /** The name in the accusative, for the enemy-turn journal: «подлечила Скелета». */
  acc: string;
  /** A feminine name: the journal says «ударила», not «ударил». */
  fem?: boolean;
}

/** Every enemy is in the room from the start (no reinforcements) and a room holds only a few, so each gets this much more HP. */
export const MOB_HP_MUL = 1.25;

export const MOBS: Record<MobKind, MobDef> = {
  skel: { name: 'Скелет', floor: 0, hp: 9, r: 7, speed: 34, reach: 30, dmg: 4, fig: 31, txt: 'Идёт к ближайшему герою и бьёт вблизи.', acc: 'Скелета' },
  archer: { name: 'Гоблин-лучник', floor: 0, hp: 6, r: 6, speed: 32, reach: 999, dmg: 3, fig: 26, txt: 'Стреляет через всю комнату, но только в того, кого видит. За колонной не достанет: сперва выйдет на линию огня.', acc: 'Гоблина-лучника' },
  rat: { name: 'Тюремная крыса', floor: 0, hp: 5, r: 6, speed: 64, reach: 26, dmg: 3, fig: 18, txt: 'Хилая, но очень быстрая: добегает до рун за ход-два.', acc: 'Тюремную крысу', fem: true },
  necro: {
    name: 'Некромант', acc: 'Некроманта', floor: 0, hp: 12, r: 8, speed: 16, reach: 999, dmg: 2, fig: 36,
    acts: [{ k: 'summon', every: 2, at: 0, n: 1, kind: 'skel', cap: 3 }],
    txt: 'Каждый второй ход поднимает скелета из светящегося круга. Круг видно заранее: убей некроманта, пока не поздно.',
  },
  king: {
    size: 2, name: 'Король-в-короне', acc: 'Короля-в-короне', floor: 0, boss: true, hp: 60, r: 15, speed: 10, reach: 40, dmg: 9, armor: 3, fig: 50,
    acts: [{ k: 'slam', every: 3, at: 0 }],
    txt: 'Босс казематов. Каждый третий ход бьёт скипетром об пол и задевает весь отряд.',
  },
  ghoul: { name: 'Ледяной упырь', floor: 1, hp: 10, r: 7, speed: 36, reach: 30, dmg: 4, fig: 30, chill: true, txt: 'Бьёт вблизи и морозит: следующий бросок героя слабее.', acc: 'Ледяного упыря' },
  ghost: { name: 'Призрак', floor: 1, hp: 7, r: 7, speed: 32, reach: 999, dmg: 3, fig: 30, ghost: true, txt: 'Стреляет издалека в того, кого видит. Каждый второй ход бесплотен: диски пролетают насквозь.', acc: 'Призрака' },
  yeti: { name: 'Йети', floor: 1, hp: 22, r: 9, speed: 18, reach: 34, dmg: 6, armor: 2, fig: 38, txt: 'Толстая шкура, броня 2. Медленный, но бьёт больно.', acc: 'Йети' },
  witch: {
    name: 'Ледяная ведьма', acc: 'Ледяную ведьму', fem: true, floor: 1, hp: 14, r: 8, speed: 16, reach: 999, dmg: 2, fig: 36,
    acts: [{ k: 'heal', every: 2, at: 0, amt: 8 }],
    txt: 'Каждый второй ход лечит самого раненого моба на 8.',
  },
  lich: {
    size: 2, name: 'Ледяной лич', acc: 'Ледяного лича', floor: 1, boss: true, hp: 64, r: 14, speed: 10, reach: 999, dmg: 6, armor: 2, fig: 52,
    acts: [{ k: 'summon', every: 3, at: 2, n: 2, kind: 'ghoul', cap: 4 }, { k: 'slam', every: 3, at: 0, chill: true }],
    txt: 'Босс склепа. Призывает упырей из ледяных кругов, а следом насылает метель на весь отряд.',
  },
  imp: { name: 'Бес-кочегар', floor: 2, hp: 7, r: 6, speed: 52, reach: 28, dmg: 3, fig: 24, fire: true, txt: 'Шустрый, поджигает: герой горит и в следующий ход теряет ещё 2.', acc: 'Беса-кочегара' },
  slime: { name: 'Лавовый слизень', floor: 2, hp: 14, r: 9, speed: 20, reach: 30, dmg: 5, fig: 24, lava: true, txt: 'Толстый и медленный. Где лопнет, там остаётся лужа лавы.', acc: 'Лавового слизня' },
  bomber: { name: 'Гном-подрывник', floor: 2, hp: 8, r: 7, speed: 16, reach: 999, dmg: 4, fig: 28, charge: true, txt: 'Ход поджигает фитиль, следующий кидает бомбу на двойной урон в того, кого видит.', acc: 'Гнома-подрывника' },
  golem: { name: 'Голем', floor: 2, hp: 26, r: 9, speed: 14, reach: 34, dmg: 7, armor: 3, fig: 38, txt: 'Броня 3: удары слабее не проходят.', acc: 'Голема' },
  forgelord: {
    size: 2, name: 'Владыка кузни', acc: 'Владыку кузни', floor: 2, boss: true, hp: 70, r: 15, speed: 12, reach: 44, dmg: 9, armor: 4, fig: 54, rage: true,
    acts: [{ k: 'heat', every: 3, at: 0, n: 2 }],
    txt: 'Босс кузни, броня 4. Каждый третий ход раскаляет пол перед рунами, а раненый впадает в ярость (+3 к удару).',
  },
};

/** Shoots across the room, at a hero it sees, instead of walking up to strike. */
export const isRanged = (k: MobKind) => MOBS[k].reach >= 999;

/** What the bum's gas takes off an enemy of full health `max` at the start of its move: a share of it, at least 1. */
export const gasDmg = (max: number) => Math.max(1, Math.ceil(max * GAS_PCT));

/** Cells a mob covers on each side. */
export const mobSize = (k: MobKind) => MOBS[k].size ?? 1;

export type NodeKind = 'ore' | 'spk' | 'herb';

/**
 * Charges a resource holds: ore and mushrooms lose one per hit, the spark crystal one per spark it gives (a soft hit
 * one, a hard one two), so for any party a crystal holds one ability for every hero.
 */
export const NODES: Record<NodeKind, { name: string; r: number; ch: number }> = {
  ore: { name: 'Рудная жила', r: 7, ch: 3 },
  spk: { name: 'Кристалл искр', r: 6, ch: AB_COST },
  herb: { name: 'Грибы', r: 6, ch: 2 },
};

export type StatKey = 'm' | 'pw' | 'e';

export interface HeroDef {
  key: string;
  name: string;
  /** The name in the accusative and the dative, for the enemy-turn journal: «ударил Бастиона», «идёт к Бастиону». */
  acc: string;
  dat: string;
  /** A feminine name: the journal says «пала», not «пал». */
  fem?: boolean;
  col: string;
  dk: string;
  skin: string;
  /** Health at the start of a run: the tank has the most, the light fast disc the least. */
  hp: number;
  r: number;
  m: number;
  e: number;
  fr: number;
  pw: number;
  ab: string;
  abTxt: string;
  /** The rest of how the ability works, for the tooltip and the collection: the button has room for a line or two. */
  abMore: string;
  /** Glow of the hero's discs while the ability is on. */
  abCol: string;
  /** Figure height on the field, when not HERO_FIG: Шкет is a child, so he stands shorter than the grown-ups. */
  fig?: number;
}

export const HEROES: HeroDef[] = [
  {
    key: 'bastion', name: 'Бастион', acc: 'Бастиона', dat: 'Бастиону', col: '#4f9a8f', dk: '#2b5a53', skin: '#e3a882', hp: 30, r: 6, m: 4, e: 0.55, fr: 1.1, pw: 0.75,
    ab: 'Щитобой', abTxt: `До конца хода каждое попадание его диска по врагу даёт всем героям +${AB_SHIELD} щита.`, abCol: '#3fc4b6',
    abMore: 'Щиты копятся с каждым попаданием и держатся до следующего хода.',
  },
  {
    key: 'ricochet', name: 'Рикошет', acc: 'Рикошета', dat: 'Рикошету', col: '#c9a03a', dk: '#6f5420', skin: '#e3a882', hp: 18, r: 4, m: 1.2, e: 0.95, fr: 0.8, pw: 1.25,
    ab: 'Шальной диск', abTxt: `До конца хода его диски первые ${AB_BOUNCES} отскоков не теряют скорость, даже от врагов.`, abCol: '#ffd34d',
    abMore: 'Один бросок прошивает всю толпу, а слабый бросок всё равно летит быстро. Ресурс гасит такой диск, как обычный.',
  },
  {
    key: 'ash', name: 'Зажигалка', acc: 'Зажигалку', dat: 'Зажигалке', fem: true, col: '#b85a2e', dk: '#5e2a14', skin: '#d8b59a', hp: 22, r: 5, m: 2, e: 0.75, fr: 1, pw: 1,
    ab: 'Поджог', abTxt: `До конца хода каждое попадание её диска добавляет врагу ${AB_BURN} огня. Огонь копится.`, abCol: '#ff7a3d',
    abMore: 'В свой ход враг теряет столько HP, сколько на нём огня, сквозь броню, и огонь стихает на 1. С павшего огонь перекидывается на ближайшего врага.',
  },
  {
    key: 'cook', name: 'Поварёшка', acc: 'Поварёшку', dat: 'Поварёшке', fem: true, col: '#7f8f3a', dk: '#434b1c', skin: '#e3a882', hp: 32, r: 6, m: 3.2, e: 0.6, fr: 1.1, pw: 0.8,
    ab: 'Добавка', abTxt: `До конца хода её диск на первых ${FOOD_PER_DISC} отскоках роняет еду: +${FOOD_HEAL} HP тому, чей диск её подберёт.`, abCol: '#9fe06a',
    abMore: 'Еда ложится в клетку, по одной на клетку. Подбирает её любой диск, кроме уронившего; раненому нужнее, поэтому здоровый её не трогает. Отскакивать от еды нельзя, диски катятся по ней, и лежит она до конца боя.',
  },
  {
    key: 'sharp', name: 'Шулер', acc: 'Шулера', dat: 'Шулеру', col: '#7d4fa6', dk: '#3f2659', skin: '#e3a882', hp: 20, r: 4, m: 1.8, e: 0.85, fr: 0.85, pw: 1.2,
    ab: 'Веер', abTxt: `До конца хода вместо одного диска летят веером три: крайние фантомные и бьют на ${Math.round((1 - FAN_M) * 100)}% слабее.`, abCol: '#ff7ad1',
    abMore: 'Фантомы поменьше и розовые, летят из рукавов чуть в стороны от прицела. Фантом в дыре, на шипах или в лаве Шулера не ранит. Ходит он за средним диском, а фантомы лежат, где остановились, до конца хода.',
  },
  {
    key: 'electra', name: 'Электра', acc: 'Электру', dat: 'Электре', fem: true, col: '#3f74c2', dk: '#1f3a66', skin: '#e8b994', hp: 22, r: 5, m: 2.0, e: 0.8, fr: 0.9, pw: 1.1,
    ab: 'Цепная молния', abTxt: `До конца хода каждое попадание её диска бьёт молнией: ${ZAP[0]} по врагу, потом ${ZAP.slice(1).join(' и ')} по соседям.`, abCol: '#7fe3ff',
    abMore: `Молния бьёт сквозь броню и перескакивает на ближайшего врага в ${ZAP_REACH / 16} клетках, которого ещё не била. Если диск добил врага, молния начинает с соседа.`,
  },
  {
    key: 'kid', name: 'Шкет', acc: 'Шкета', dat: 'Шкету', col: '#d0528b', dk: '#6b2347', skin: '#f0c09a', hp: 20, r: 4, m: 1.7, e: 0.9, fr: 0.85, pw: 1, fig: 26,
    ab: 'Отвлекуха', abTxt: `До конца хода его диск на первом отскоке не от врага роняет петарду. На поле она одна и лежит ${PETARD_TURNS} хода. На треск бегут ${PETARD_LURE} ближайших врага.`, abCol: '#ffb347',
    abMore: `Петарда ложится в клетку, как еда Поварёшки, и трещит ${PETARD_TURNS} хода врагов, а потом гаснет. Пока она лежит, новую не поставить. Из врагов в ${PETARD_HEAR} клетках от неё ${PETARD_LURE} ближайших идут к ней, а не к героям, и в этот ход никого не бьют. Первый враг, который подойдёт к ней на клетку, её подорвёт: ${PETARD_DMG} урона ему сквозь броню, и петарды больше нет. Призыв, лечение и удар по всем враги делают как обычно.`,
  },
  {
    key: 'bum', name: 'Перегар', acc: 'Перегара', dat: 'Перегару', col: '#7b6a4e', dk: '#3b3224', skin: '#d9b08c', hp: 24, r: 5, m: 2.2, e: 0.7, fr: 1.05, pw: 1,
    ab: 'Амбре', abTxt: `До конца хода первый отскок его диска пускает газ на ${GAS_TURNS} хода: враги в нём теряют ${Math.round(GAS_PCT * 100)}% HP за ход и бьют слабее.`, abCol: '#b9e34f',
    abMore: `Облако круглое, ${GAS_R * 2 + 1} на ${GAS_R * 2 + 1} клеток без углов. Враг, который начинает в нём свой ход, теряет ${Math.round(GAS_PCT * 100)}% здоровья (не меньше 1) сквозь броню и бьёт на ${Math.round(GAS_WEAK * 100)}% слабее. Облака не складываются.`,
  },
  {
    key: 'genius', name: 'Отморозок', acc: 'Отморозка', dat: 'Отморозку', col: '#3a9cb8', dk: '#1b4d5c', skin: '#cfe0e4', hp: 22, r: 5, m: 2, e: 0.85, fr: 0.9, pw: 1,
    ab: 'Заморозка', abTxt: `До конца хода его диск морозит: после одного попадания враг еле ползёт, после двух пропускает ход. Урон по замедленному +${Math.round(FROST_SLOW_VULN * 100)}%, по замороженному +${Math.round(FROST_VULN * 100)}%.`, abCol: '#bdf2ff',
    abMore: `Замедленный враг в свой ход проходит не больше ${FROST_STEPS === 1 ? 'клетки' : FROST_STEPS + ' клеток'}, но бьёт и стреляет, как обычно. Замороженный стоит и ничего не делает: ни удара, ни выстрела, ни призыва. Пока мороз держится, а это до конца ближайшего хода врагов, диски и умения героев бьют замедленного врага на ${Math.round(FROST_SLOW_VULN * 100)}% сильнее, замороженного на ${Math.round(FROST_VULN * 100)}%.`,
  },
];

/** The kinds of heroes by disc size, the biggest first, a row each on the pick screens: the row's tab, the word on a hero's card, a heroine's own. */
export const KINDS = [
  { r: 6, row: 'Толстяки', one: 'Толстяк', fem: 'Толстуха' },
  { r: 5, row: 'Нормисы', one: 'Нормис', fem: 'Нормиска' },
  { r: 4, row: 'Дрищи', one: 'Дрищ', fem: 'Дрищ' },
];

/** What kind of hero this is, by its disc: «Толстяк», or «Толстуха» for a heroine. */
export const kindOf = (def: HeroDef) => {
  const k = KINDS.find(k => k.r === def.r)!;
  return def.fem ? k.fem : k.one;
};

/** Hero indexes grouped by kind, a list per kind in KINDS order, each in HEROES order. */
export const heroesByKind = () => KINDS.map(k => HEROES.flatMap((h, i) => (h.r === k.r ? [i] : [])));

export const HERO_FIG = 34;
/** How tall a hero's figure stands. */
export const heroFig = (def: HeroDef) => def.fig ?? HERO_FIG;
/** Hero stand radius in world units: a cell is 16 across, so the stand sits inside its cell with a rim of floor around it. */
export const HERO_BASE = 7;

/** Most of its speed a disc can keep off a wall. */
export const E_MAX = 0.99;

/**
 * Disc upgrades, named for what they do. Damage and speed grow by a share of the hero's own value per level,
 * so "+25% урона" means the same for every hero; the bounce adds to the share of speed kept off walls.
 */
export interface Upgrade {
  k: StatKey;
  name: string;
  /** What it does, in a line. */
  txt: string;
  step: number;
  /** What a level adds, shown over the hero when bought. */
  next: string;
  /** The value shown in the hero frame: `bonus` is the share gained so far, `v` the stat itself. */
  fmt: (bonus: number, v: number) => string;
  /** Where the stat stands now, for the tooltip. */
  now?: (v: number) => string;
}

const pct = (x: number) => Math.round(x * 100) + '%';

export const UPS: Upgrade[] = [
  { k: 'm', name: 'Урон', txt: 'Диск бьёт сильнее: +25% за уровень', step: 0.25, next: '+25% урона', fmt: b => '+' + pct(b) },
  { k: 'pw', name: 'Скорость', txt: 'Летит быстрее и дальше, а быстрый диск и бьёт сильнее: +15% за уровень', step: 0.15, next: '+15% скорости', fmt: b => '+' + pct(b) },
  {
    k: 'e', name: 'Отскок', txt: 'Меньше теряет скорость о стены и камни', step: 0.08, next: '+8% отскока',
    fmt: (_, v) => pct(v), now: v => `Сейчас после отскока у диска остаётся ${pct(v)} скорости. `,
  },
];

/** Damage of a full-strength throw that hits square on before the disc slows down (no precise-hit bonus). */
export const fullHit = (m: number, pw: number) => Math.ceil((m * 270 * pw) / 120);

/** Most ore the blacksmith hands the party on a visit, on top of selling disc upgrades; the least is none. */
export const FORGE_ORE = 3;
/** Ore the blacksmith hands the party at this visit, 0 to FORGE_ORE: the same on every screen and after a reload. */
export const forgeOre = (seed: number) => makeRng(seed * 11 + 3).int(0, FORGE_ORE);

export type RoomType = 'fight' | 'elite' | 'treasure' | 'camp' | 'forge' | 'event' | 'boss';

export const ROOM_TYPES: Record<RoomType, { name: string; col: string; min: number; txt: string }> = {
  fight: { name: 'Бой', col: '#c2364f', min: 2, txt: 'Обычные мобы, рудная жила, кристалл искр и грибы.' },
  elite: { name: 'Элитный бой', col: '#7a1d33', min: 3, txt: 'Сильный враг этажа и свита. Две рудные жилы вместо одной.' },
  treasure: { name: 'Рудная пещера', col: '#d39612', min: 1, txt: 'Врагов нет: от двух до пяти малых жил, иногда большая и до двух грядок грибов. Ходов 4 минус число героев, втроём один.' },
  camp: { name: 'Костёр', col: '#e8642c', min: 0.5, txt: 'У огня каждый делает одно: отдыхает, перевязывает товарища или копает руду.' },
  forge: { name: 'Кузнец', col: '#5d6488', min: 1, txt: `Прокачка дисков за руду, только здесь. И ещё 0–${FORGE_ORE} руды в подарок, как повезёт.` },
  event: { name: 'Событие', col: '#6b4fa8', min: 0.75, txt: 'Странная встреча и выбор: награда, риск или беда.' },
  boss: { name: 'Босс этажа', col: '#2a1a3a', min: 3.5, txt: 'Свой босс на каждом этаже, со свитой.' },
};

export const COMBAT_ROOMS: RoomType[] = ['fight', 'elite', 'treasure', 'boss'];
