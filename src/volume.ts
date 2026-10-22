// «Громкость»: the steps of difficulty that open after the first won run, like Ascension in Slay the Spire. Before a run
// the player turns the knob to any step they have opened; a step keeps the rules of the ones under it and adds one of its
// own. A run won at the highest step opens the next. Online the host turns it for the whole table, and every player opens
// their own steps. This file says which step brings each rule and by how much; the rules work where the thing they change
// lives: the rooms (src/room.ts), the fights and the blacksmith's (src/game.ts), the camp, the trophies, the run's start.

/** The knob's steps: 0 is the game as it is, then 1 to VOL_MAX. */
export const VOL_MAX = 10;

/** The step each rule comes in at. */
export const VOL = { elite: 1, forge: 2, rage: 3, camp: 4, boss: 5, herb: 6, start: 7, loot: 8, blow: 9, bossRage: 10 } as const;

/** Each step's rule as the knob tells it, from the first step on. */
export const VOL_RULES = [
  'В элитных боях на одного врага больше',
  'Кузнец берёт за всё на 1 руду больше',
  'Враги звереют на ход раньше',
  'Костёр лечит 5 здоровья, а не 8',
  'Боссы толще на 15%',
  'На грибных полянках по грибу меньше',
  'Отряд начинает забег с 80% здоровья',
  'После босса два трофея на выбор, а не три',
  'Обычные враги бьют на 1 сильнее',
  'В бою с боссом враги звереют с первого хода',
];

/** Whether a run at step `vol` has the rule that comes in at step `at`. */
export const loud = (vol: number | undefined, at: number) => (vol ?? 0) >= at;

/** What a rest or a bandage by the fire gives back from VOL.camp on. */
export const VOL_CAMP_HEAL = 5;
/** How much more health the floor bosses have from VOL.boss on. */
export const VOL_BOSS_HP = 1.15;
/** The share of their health the heroes start the run with from VOL.start on. */
export const VOL_START_HP = 0.8;
/** Trophies a boss leaves to pick from VOL.loot on; a party of three still gets one for each hero. */
export const VOL_OFFER = 2;

/** The heroes setting out on a run at step `vol`: from VOL.start on, short of their full health. */
export function setOut(party: { hp: number; max: number }[], vol: number) {
  if (loud(vol, VOL.start)) for (const h of party) h.hp = Math.ceil(h.max * VOL_START_HP);
}
