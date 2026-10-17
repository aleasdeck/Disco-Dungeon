// Static game data: biomes, heroes, mobs, resource nodes, room types.

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
}

export const BIOMES: Biome[] = [
  { name: 'Тюремные казематы', f: ['#6f6a64', '#79736b'], g: '#3b3631', w: ['#4a433c', '#5a5148'], cap: '#857b6e', mu: 70, haz: 'spikes', hazDmg: 3, bg: ['#2d2621', '#0e0b09'], torch: '255,160,70', art: 'prison' },
  { name: 'Ледяной склеп', f: ['#7c878c', '#869197'], g: '#4f6a74', w: ['#4a6470', '#56717e'], cap: '#a3bfc9', mu: 65, iceMu: 20, haz: 'spikes', hazDmg: 3, bg: ['#1f2d34', '#0a1013'], torch: '150,220,255', art: 'ice' },
  { name: 'Кузня', f: ['#7a5947', '#84624f'], g: '#3f2c24', w: ['#4c3128', '#5a3b30'], cap: '#8a634f', mu: 85, haz: 'lava', hazDmg: 4, bg: ['#30180f', '#0e0705'], torch: '255,130,50', art: 'forge' },
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
  /** 999 means it shoots across the whole room. */
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
}

/** Every enemy is in the room from the start (no reinforcements) and a room holds only a few, so each gets this much more HP. */
export const MOB_HP_MUL = 1.25;

export const MOBS: Record<MobKind, MobDef> = {
  skel: { name: 'Скелет', floor: 0, hp: 9, r: 7, speed: 34, reach: 30, dmg: 4, fig: 31, txt: 'Идёт к ближайшему герою и бьёт вблизи.' },
  archer: { name: 'Гоблин-лучник', floor: 0, hp: 6, r: 6, speed: 0, reach: 999, dmg: 3, fig: 26, txt: 'Стоит на месте и стреляет через всю комнату.' },
  rat: { name: 'Тюремная крыса', floor: 0, hp: 5, r: 6, speed: 64, reach: 26, dmg: 3, fig: 18, txt: 'Хилая, но очень быстрая: добегает до рун за ход-два.' },
  necro: {
    name: 'Некромант', floor: 0, hp: 12, r: 8, speed: 0, reach: 999, dmg: 2, fig: 36,
    acts: [{ k: 'summon', every: 2, at: 0, n: 1, kind: 'skel', cap: 3 }],
    txt: 'Каждый второй ход поднимает скелета из светящегося круга. Круг видно заранее: убей некроманта, пока не поздно.',
  },
  king: {
    size: 2, name: 'Король-в-короне', floor: 0, boss: true, hp: 60, r: 15, speed: 10, reach: 40, dmg: 9, armor: 3, fig: 50,
    acts: [{ k: 'slam', every: 3, at: 0 }],
    txt: 'Босс казематов. Каждый третий ход бьёт скипетром об пол и задевает весь отряд.',
  },
  ghoul: { name: 'Ледяной упырь', floor: 1, hp: 10, r: 7, speed: 36, reach: 30, dmg: 4, fig: 30, chill: true, txt: 'Бьёт вблизи и морозит: следующий бросок героя слабее.' },
  ghost: { name: 'Призрак', floor: 1, hp: 7, r: 7, speed: 0, reach: 999, dmg: 3, fig: 30, ghost: true, txt: 'Стреляет издалека. Каждый второй ход бесплотен: диски пролетают насквозь.' },
  yeti: { name: 'Йети', floor: 1, hp: 22, r: 9, speed: 18, reach: 34, dmg: 6, armor: 2, fig: 38, txt: 'Толстая шкура, броня 2. Медленный, но бьёт больно.' },
  witch: {
    name: 'Ледяная ведьма', floor: 1, hp: 14, r: 8, speed: 0, reach: 999, dmg: 2, fig: 36,
    acts: [{ k: 'heal', every: 2, at: 0, amt: 8 }],
    txt: 'Каждый второй ход лечит самого раненого моба на 8.',
  },
  lich: {
    size: 2, name: 'Ледяной лич', floor: 1, boss: true, hp: 64, r: 14, speed: 0, reach: 999, dmg: 6, armor: 2, fig: 52,
    acts: [{ k: 'summon', every: 3, at: 2, n: 2, kind: 'ghoul', cap: 4 }, { k: 'slam', every: 3, at: 0, chill: true }],
    txt: 'Босс склепа. Призывает упырей из ледяных кругов, а следом насылает метель на весь отряд.',
  },
  imp: { name: 'Бес-кочегар', floor: 2, hp: 7, r: 6, speed: 52, reach: 28, dmg: 3, fig: 24, fire: true, txt: 'Шустрый, поджигает: герой горит и в следующий ход теряет ещё 2.' },
  slime: { name: 'Лавовый слизень', floor: 2, hp: 14, r: 9, speed: 20, reach: 30, dmg: 5, fig: 24, lava: true, txt: 'Толстый и медленный. Где лопнет, там остаётся лужа лавы.' },
  bomber: { name: 'Гном-подрывник', floor: 2, hp: 8, r: 7, speed: 0, reach: 999, dmg: 4, fig: 28, charge: true, txt: 'Ход поджигает фитиль, следующий ход кидает бомбу на двойной урон.' },
  golem: { name: 'Голем', floor: 2, hp: 26, r: 9, speed: 14, reach: 34, dmg: 7, armor: 3, fig: 38, txt: 'Броня 3: удары слабее не проходят.' },
  forgelord: {
    size: 2, name: 'Владыка кузни', floor: 2, boss: true, hp: 70, r: 15, speed: 12, reach: 44, dmg: 9, armor: 4, fig: 54, rage: true,
    acts: [{ k: 'heat', every: 3, at: 0, n: 2 }],
    txt: 'Босс кузни, броня 4. Каждый третий ход раскаляет пол перед рунами, а раненый впадает в ярость (+3 к удару).',
  },
};

/** Shoots across the room instead of walking up. */
export const isRanged = (k: MobKind) => MOBS[k].reach >= 999;

/** Cells a mob covers on each side. */
export const mobSize = (k: MobKind) => MOBS[k].size ?? 1;

export type NodeKind = 'ore' | 'spk' | 'herb';

export const NODES: Record<NodeKind, { name: string; r: number; ch: number }> = {
  ore: { name: 'Рудная жила', r: 7, ch: 3 },
  spk: { name: 'Кристалл искр', r: 6, ch: 3 },
  herb: { name: 'Грибы', r: 6, ch: 2 },
};

export type StatKey = 'm' | 'pw' | 'e';

export interface HeroDef {
  key: string;
  name: string;
  col: string;
  dk: string;
  skin: string;
  r: number;
  m: number;
  e: number;
  fr: number;
  pw: number;
  ab: string;
  abTxt: string;
}

export const HEROES: HeroDef[] = [
  { key: 'bastion', name: 'Бастион', col: '#4f9a8f', dk: '#2b5a53', skin: '#e3a882', r: 6, m: 4, e: 0.55, fr: 1.1, pw: 0.75, ab: 'Стена', abTxt: 'Все герои получают +3 щита до конца хода.' },
  { key: 'ricochet', name: 'Рикошет', col: '#c9a03a', dk: '#6f5420', skin: '#e3a882', r: 4, m: 1.2, e: 0.95, fr: 0.8, pw: 1.25, ab: 'Град чакр', abTxt: '4 урона каждому мобу в комнате.' },
  { key: 'ash', name: 'Пепельница', col: '#b85a2e', dk: '#5e2a14', skin: '#d8b59a', r: 5, m: 2, e: 0.75, fr: 1, pw: 1, ab: 'Поджог', abTxt: 'Самый живучий моб горит 3 хода по 4 урона.' },
];

export const HERO_FIG = 34;
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

/** Ore the blacksmith hands the party. */
export const FORGE_ORE = 5;

export type RoomType = 'fight' | 'elite' | 'treasure' | 'camp' | 'forge' | 'event' | 'boss';

export const ROOM_TYPES: Record<RoomType, { name: string; col: string; min: number; txt: string }> = {
  fight: { name: 'Бой', col: '#c2364f', min: 2, txt: 'Обычные мобы, рудная жила, кристалл искр и грибы.' },
  elite: { name: 'Элитный бой', col: '#7a1d33', min: 3, txt: 'Сильный враг этажа и свита. Две рудные жилы вместо одной.' },
  treasure: { name: 'Рудная пещера', col: '#d39612', min: 1.5, txt: 'Три рудные жилы и всего два моба.' },
  camp: { name: 'Костёр', col: '#e8642c', min: 0.5, txt: 'Отряд лечится на 8 HP. Павшие встают с половиной здоровья.' },
  forge: { name: 'Кузнец', col: '#5d6488', min: 0.75, txt: `Отряд получает ${FORGE_ORE} руды на прокачку дисков.` },
  event: { name: 'Событие', col: '#6b4fa8', min: 0.75, txt: 'Сцена с неожиданным исходом: алтарь, торговец, ловушка.' },
  boss: { name: 'Босс этажа', col: '#2a1a3a', min: 3.5, txt: 'Свой босс на каждом этаже, со свитой.' },
};

export const COMBAT_ROOMS: RoomType[] = ['fight', 'elite', 'treasure', 'boss'];
