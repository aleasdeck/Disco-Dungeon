// «Подставки мастерства»: a hero's stand shows how many runs this player has won with it, from the painted plastic every
// hero starts on up to a mirror-ball one. Nothing about the hero changes, only the look: the top of the stand turns to
// the material with the hero's colour left as a ring round its edge (src/draw/figures.ts), and its front rim stays the
// health bar. Online every player's own wins dress their own hero, and the others see it.

/** What a stand can be made of. */
export type StandMat = 'plastic' | 'card' | 'wood' | 'bronze' | 'gold' | 'mirror';

/** The stands in the order they come: the runs won with the hero each takes, and its name as the hero's card says it. */
export const STANDS: { mat: StandMat; wins: number; name: string; gen: string }[] = [
  { mat: 'plastic', wins: 0, name: 'пластик', gen: 'пластика' },
  { mat: 'card', wins: 1, name: 'картон', gen: 'картона' },
  { mat: 'wood', wins: 3, name: 'дерево', gen: 'дерева' },
  { mat: 'bronze', wins: 6, name: 'бронза', gen: 'бронзы' },
  { mat: 'gold', wins: 10, name: 'золото', gen: 'золота' },
  { mat: 'mirror', wins: 20, name: 'зеркало', gen: 'зеркала' },
];

export const STAND_MATS = STANDS.map(s => s.mat);

/** A stand's place in STANDS; plastic for anything unknown. */
export const standDef = (mat: StandMat | undefined) => STANDS.find(s => s.mat === mat) ?? STANDS[0];

/** The stand `wins` runs won with a hero have earned. */
export const standOf = (wins: number) => STANDS.reduce((got, s) => (wins >= s.wins ? s : got), STANDS[0]).mat;

/** The stand that comes after `mat`, null after the mirror. */
export const nextStand = (mat: StandMat) => STANDS[STANDS.indexOf(standDef(mat)) + 1] ?? null;
