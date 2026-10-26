// The demo (…?demo=true in the address): three heroes, one floor with its three bosses (one of them at the top of the map,
// the same as in the full game) and six of the events. The run's first event ends with a trophy to pick, and the first
// boss beaten opens one more hero: the next up the ladder of the party's first hero, and never another (src/progress.ts).
// The other heroes stand on the pick screens as dark shapes with a «?», and the end of a run shows them as the full game's.
// The demo keeps its own saves and statistics, so a demo run never turns up in the full game and the other way round; an
// online room lets in only players of the same version.

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('demo');
export const DEMO = flag === 'true' || flag === '1';

/** The heroes the demo plays, one of each kind: Бастион, Рикошет, Зажигалка. */
export const DEMO_HEROES = ['bastion', 'ricochet', 'ash'];
/** The demo's events: the bar, the disco god's altar, the plague doctor, the black market, the snoring ogre and the DJ. */
export const DEMO_EVENTS = ['bar', 'altar', 'doctor', 'goblin', 'ogre', 'dj'];

/** The game's Steam page and the demo's feedback form, once they are up: the end of a demo run points at them. */
export const STORE_URL = '';
export const FEEDBACK_URL = '';

/** The demo's own name for a thing kept in the browser. */
export const stored = (key: string) => (DEMO ? key + '.demo' : key);
