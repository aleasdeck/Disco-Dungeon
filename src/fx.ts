// Hit effects: a struck figure rocks on its stand, a beaten enemy topples over, a struck resource throws chips.

/**
 * A knock a figure took: seconds since it landed (below zero while it is still on its way), which way it pushed the
 * figure in world units (a unit vector) and how hard, 0 to 1.
 */
export interface Knock { t: number; x: number; y: number; p: number }

/** Seconds a knock keeps a figure moving. */
export const KNOCK_T = 1.2;

/** What a chip looks like. */
export type ChipKind = 'ore' | 'gold' | 'spk' | 'cap' | 'stem' | 'ice';

/**
 * How a knocked figure stands this frame, in screen units: turned by `rot` about the point (px, py) off the centre
 * of its stand; the figure on it (not the stand) is also stretched by `sy` about its feet.
 */
export interface Pose { rot: number; px: number; py: number; sy: number }

/**
 * The pose of a figure `k.t` seconds after a knock: tipped away from the blow, it rocks from one edge of its stand
 * to the other until it settles. (gx, gy) is the knock's direction on screen per world unit, R the stand's radius
 * in world units.
 */
export function knockPose(k: Knock, gx: number, gy: number, R: number): Pose {
  const t = Math.max(0, k.t), th = k.p * 0.55 * Math.exp(-3.5 * t) * Math.sin(2 * Math.PI * 1.9 * t);
  // the figure's top swings over the floor: sideways it turns, toward the viewer it shortens, away it grows
  const tx = gx * Math.sin(th), ty = gy * Math.sin(th) - Math.cos(th);
  const sd = th >= 0 ? 1 : -1;
  return { rot: Math.atan2(tx, -ty), px: sd * gx * R, py: sd * gy * R, sy: Math.hypot(tx, ty) };
}

/**
 * A beaten enemy toppling over: `u` seconds after it fell, sideways toward screen direction `side` (+1 right, -1 left),
 * pivoting on the rim of its stand (rx: the rim's half-width on screen).
 */
export function topplePose(u: number, side: number, rx: number): Pose {
  const FALL = 0.28, FLAT = Math.PI / 2 * 0.9;
  let th = FLAT;
  if (u < FALL) th = FLAT * (u / FALL) ** 2;
  else if (u < FALL + 0.16) th = FLAT - 0.16 * Math.sin((Math.PI * (u - FALL)) / 0.16);
  return { rot: side * th, px: side * rx, py: 0, sy: 1 };
}
