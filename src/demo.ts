// The demo (…?demo=true in the address): three heroes, one floor with the king for its boss and a few of the events. The
// other heroes stand on the pick screens as dark shapes with a «?». The demo keeps its own saves and statistics, so a demo
// run never turns up in the full game and the other way round; an online room lets in only players of the same version.

import type { MobKind } from './data';

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('demo');
export const DEMO = flag === 'true' || flag === '1';

/** The heroes the demo plays, one of each kind: Бастион, Рикошет, Зажигалка. */
export const DEMO_HEROES = ['bastion', 'ricochet', 'ash'];
/** The demo's events: the bar, the disco god's altar and the plague doctor. */
export const DEMO_EVENTS = ['bar', 'altar', 'doctor'];
/** The demo's one boss. */
export const DEMO_BOSS: MobKind = 'king';

/** A hero the demo doesn't let anyone play, by its key. */
export const locked = (key: string) => DEMO && !DEMO_HEROES.includes(key);

/** The demo's own name for a thing kept in the browser. */
export const stored = (key: string) => (DEMO ? key + '.demo' : key);
