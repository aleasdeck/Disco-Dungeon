// The demo (…?demo=true in the address): three heroes, one floor with its three bosses (one of them at the top of the map,
// the same as in the full game) and seven of the events. The run's first event is always the chest with the trophies, and
// the first boss beaten opens one more hero: the next up the ladder of the party's first hero, and never another (src/progress.ts).
// The other heroes stand on the pick screens as dark shapes with a «?», and the end of a run shows them as the full game's.
// The demo keeps its own saves and statistics, so a demo run never turns up in the full game and the other way round; an
// online room lets in only players of the same version. The demo's own build for Steam (npm run build:demo) is the demo
// whatever the address, and has none of what the demo never opens (scripts/demo-build.mjs).

declare const __DEMO_BUILD__: boolean;
/** The demo's own build: the other heroes, floors, events and trophies are not in it at all. */
export const DEMO_BUILD = __DEMO_BUILD__;
const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('demo');
export const DEMO = DEMO_BUILD || flag === 'true' || flag === '1';

/** The demo's floors, from the first. */
export const DEMO_FLOORS = 1;
/** The heroes the demo plays, one of each kind: Бастион, Рикошет, Зажигалка. */
export const DEMO_HEROES = ['bastion', 'ricochet', 'ash'];
/** The demo's events: the chest in love, the bar, the disco god's altar, the plague doctor, the black market, the snoring ogre and the DJ. */
export const DEMO_EVENTS = ['mimic', 'bar', 'altar', 'doctor', 'goblin', 'ogre', 'dj'];
/** The run's first event in the demo: «Влюблённый сундук», whose hand comes out with a trophy every time (src/events.ts). */
export const DEMO_CHEST = 'mimic';

/** The game's Steam page and the demo's feedback form, once they are up: the end of a demo run points at them. */
export const STORE_URL = '';
export const FEEDBACK_URL = '';

/** The demo's own name for a thing kept in the browser. */
export const stored = (key: string) => (DEMO ? key + '.demo' : key);
