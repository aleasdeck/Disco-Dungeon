// Hit effects: a struck figure rocks on its stand, a struck resource throws chips.
// While the look is being chosen, the page address picks a variant: ?fx=rock|hop|jelly,chips|chunk|bank[,still][,stand].

/** How a struck figure moves: rocks on the rim of its stand, is knocked up off the table, or bends like a spring. */
export type FigFx = 'rock' | 'hop' | 'jelly';
/** What a struck resource throws: a spray of chips, the very piece that broke off, or chips that fly into the counter. */
export type ResFx = 'chips' | 'chunk' | 'bank';

export const fx = { fig: 'rock' as FigFx, res: 'chips' as ResFx, ripple: true, topple: true };

if (typeof location !== 'undefined') {
  const want = new URLSearchParams(location.search).get('fx');
  for (const w of want ? want.split(',') : []) {
    if (w === 'rock' || w === 'hop' || w === 'jelly') fx.fig = w;
    else if (w === 'chips' || w === 'chunk' || w === 'bank') fx.res = w;
    // the table stays still on a hard hit, a beaten enemy just fades
    else if (w === 'still') fx.ripple = false;
    else if (w === 'stand') fx.topple = false;
  }
}

/**
 * A knock a figure took: seconds since it landed (below zero while it is still on its way), which way it pushed the
 * figure in world units (a unit vector) and how hard, 0 to 1.
 */
export interface Knock { t: number; x: number; y: number; p: number }

/** Seconds a knock keeps a figure moving. */
export const KNOCK_T = 1.2;

/** What a chip looks like. */
export type ChipKind = 'ore' | 'gold' | 'spk' | 'cap' | 'stem' | 'ice' | 'lump' | 'crystal' | 'shroom';

/** Where a chip flies once it has popped out, in the "into the counter" variant. */
export type ChipTo = 'ore' | 'spk' | 'hp';

/**
 * How a knocked figure stands this frame, in screen units: shifted by (jx, jy) and lifted by `lift`, turned by `rot`
 * about the point (px, py) off the centre of its stand; the figure on it (not the stand) is also stretched by `sy`
 * and leaned by `sh` (its top moves sideways by sh times its height) about its feet.
 */
export interface Pose { rot: number; px: number; py: number; jx: number; jy: number; lift: number; sy: number; sh: number }

export const STILL: Pose = { rot: 0, px: 0, py: 0, jx: 0, jy: 0, lift: 0, sy: 1, sh: 0 };

/**
 * The pose of a figure `k.t` seconds after a knock. (gx, gy) is the knock's direction on screen per world unit,
 * R the stand's radius in world units.
 */
export function knockPose(k: Knock, gx: number, gy: number, R: number, kind: FigFx = fx.fig): Pose {
  const t = k.t, p = k.p;
  if (t <= 0) return STILL;
  if (kind === 'rock') {
    // tipped away from the blow, it rocks from one edge of its stand to the other until it settles
    const th = p * 0.55 * Math.exp(-3.5 * t) * Math.sin(2 * Math.PI * 1.9 * t);
    return tilt(th, gx, gy, R);
  }
  if (kind === 'hop') {
    // knocked up off the table, leaning back; lands with a squash and a wobble
    const T = 0.24 + 0.12 * p;
    if (t < T) {
      const u = t / T, s = Math.sin(Math.PI * u);
      return { ...tilt(p * 0.5 * s, gx, gy, 0), lift: p * 11 * s };
    }
    const u = t - T, w = Math.exp(-6 * u);
    return { ...tilt(p * 0.14 * w * Math.sin(2 * Math.PI * 3 * u), gx, gy, R), sy: 1 - p * 0.22 * Math.exp(-14 * u) };
  }
  // the stand jolts, the figure on it bends away like a spring and swings back and forth
  const L = Math.hypot(gx, gy) || 1, nx = gx / L, ny = gy / L;
  const s = p * Math.exp(-3.2 * t) * Math.sin(2 * Math.PI * 2.4 * t), j = p * 1.6 * Math.exp(-12 * t);
  return { ...STILL, jx: nx * j, jy: ny * j, sy: (1 - 0.35 * s * ny) * (1 - 0.2 * p * Math.exp(-14 * t)), sh: 0.7 * s * nx };
}

/** A figure tipped over by angle th toward screen direction (gx, gy), on the rim of a stand of radius R. */
function tilt(th: number, gx: number, gy: number, R: number): Pose {
  // the figure's top swings over the floor: sideways it turns, toward the viewer it shortens, away it grows
  const tx = gx * Math.sin(th), ty = gy * Math.sin(th) - Math.cos(th);
  const sd = th >= 0 ? 1 : -1;
  return { ...STILL, rot: Math.atan2(tx, -ty), px: sd * gx * R, py: sd * gy * R, sy: Math.hypot(tx, ty) };
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
  return { ...STILL, rot: side * th, px: side * rx };
}
