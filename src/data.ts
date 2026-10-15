// Static game data: biomes, heroes, mobs, resource nodes, room types.

export const INK = '#1a1210';
export const ENEMY_BASE = '#b8323f';
export const TILE = 16;
export const WALL_H = 34;
/** Discs each hero throws per turn at the start of a run, the most they can upgrade to, and what each extra disc costs in ore. */
export const HAND_START = 1;
export const HAND_MAX = 3;
export const HAND_COST = [4, 6];
export const AB_COST = 3;
export const UP_COST = [2, 3, 4];

export interface Biome {
  name: string;
  f: [string, string];
  g: string;
  w: [string, string];
  cap: string;
  mu: number;
  haz: 'spikes' | 'lava';
  hazDmg: number;
  bg: [string, string];
  torch: string;
}

export const BIOMES: Biome[] = [
  { name: 'Тюремные казематы', f: ['#6f6a64', '#79736b'], g: '#3b3631', w: ['#4a433c', '#5a5148'], cap: '#857b6e', mu: 70, haz: 'spikes', hazDmg: 3, bg: ['#2d2621', '#0e0b09'], torch: '255,160,70' },
  { name: 'Ледяной склеп', f: ['#8fb0bb', '#9bbcc6'], g: '#4f6a74', w: ['#4a6470', '#56717e'], cap: '#a3bfc9', mu: 20, haz: 'spikes', hazDmg: 3, bg: ['#1f2d34', '#0a1013'], torch: '150,220,255' },
  { name: 'Кузня', f: ['#7a5947', '#84624f'], g: '#3f2c24', w: ['#4c3128', '#5a3b30'], cap: '#8a634f', mu: 85, haz: 'lava', hazDmg: 4, bg: ['#30180f', '#0e0705'], torch: '255,130,50' },
];

export type MobKind = 'skel' | 'archer' | 'slime' | 'golem' | 'king';

export interface MobDef {
  name: string;
  hp: number;
  r: number;
  speed: number;
  reach: number;
  dmg: number;
  armor?: number;
  /** Height of the figure above its base, in world units; used to scale sprites. */
  fig: number;
}

export const MOBS: Record<MobKind, MobDef> = {
  skel: { name: 'Скелет', hp: 9, r: 7, speed: 34, reach: 30, dmg: 3, fig: 31 },
  archer: { name: 'Гоблин-лучник', hp: 6, r: 6, speed: 0, reach: 999, dmg: 2, fig: 26 },
  slime: { name: 'Слизень', hp: 14, r: 9, speed: 20, reach: 30, dmg: 4, fig: 24 },
  golem: { name: 'Голем', hp: 26, r: 12, speed: 14, reach: 34, dmg: 6, armor: 3, fig: 38 },
  king: { name: 'Король-в-короне', hp: 60, r: 15, speed: 10, reach: 40, dmg: 7, armor: 3, fig: 50 },
};

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

export const UPS: { k: StatKey; name: string; step: number; fmt: (v: number) => string }[] = [
  { k: 'm', name: 'Масса', step: 0.8, fmt: v => v.toFixed(1) },
  { k: 'pw', name: 'Сила', step: 0.15, fmt: v => String(Math.round(v * 260)) },
  { k: 'e', name: 'Упругость', step: 0.08, fmt: v => v.toFixed(2) },
];

export type RoomType = 'fight' | 'elite' | 'treasure' | 'camp' | 'forge' | 'event' | 'boss';

export const ROOM_TYPES: Record<RoomType, { name: string; col: string; min: number; txt: string }> = {
  fight: { name: 'Бой', col: '#c2364f', min: 2, txt: 'Обычные мобы, пара жил и кристаллов.' },
  elite: { name: 'Элитный бой', col: '#7a1d33', min: 3, txt: 'Голем с бронёй и свита. Больше награда.' },
  treasure: { name: 'Рудная пещера', col: '#d39612', min: 1.5, txt: 'Девять ресурсных точек и всего два моба, но подкрепления приходят быстро.' },
  camp: { name: 'Костёр', col: '#e8642c', min: 0.5, txt: 'Отряд лечится на 6 HP. Павшие встают с половиной здоровья.' },
  forge: { name: 'Кузнец', col: '#5d6488', min: 0.75, txt: 'Отряд получает 6 руды на прокачку дисков.' },
  event: { name: 'Событие', col: '#6b4fa8', min: 0.75, txt: 'Сцена с неожиданным исходом: алтарь, торговец, ловушка.' },
  boss: { name: 'Босс этажа', col: '#2a1a3a', min: 3.5, txt: 'Король-в-короне со свитой, подкрепления каждые два хода.' },
};

export const COMBAT_ROOMS: RoomType[] = ['fight', 'elite', 'treasure', 'boss'];
