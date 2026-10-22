import { describe, expect, it } from 'vitest';
import { FLOORS, newRun } from '../src/run';
import { artLocked, bossStars, creditRun, dueEvents, eventLocked, featOf, locked, nextOf, openEvents, openedBy, opening, prevOf, runGains, START_ARTS, START_EVENTS, START_HEROES, STARS_TO_OPEN, starsOf } from '../src/progress';
import { eventOf, type EventState } from '../src/events';
import { rollOffer } from '../src/artifacts';

describe('hero unlocks', () => {
  it('starts with one hero of each kind open', () => {
    for (const k of START_HEROES) expect(locked(k)).toBe(false);
    for (const k of ['cook', 'electra', 'sharp', 'cop', 'model']) expect(locked(k)).toBe(true);
    expect(nextOf('bastion')).toBe('cook');
    expect(prevOf('cook')).toBe('bastion');
    expect(prevOf('bastion')).toBe(null);
    expect(nextOf('cop')).toBe(null);
    expect(opening('bastion')).toBe(true);
  });

  it("pays each floor's boss once, as many stars as the floor's number, and a won run opens the next hero", () => {
    expect(Array.from({ length: FLOORS }, (_, f) => bossStars(f)).reduce((a, b) => a + b, 0)).toBe(STARS_TO_OPEN);
    const run = newRun(5151);
    // no boss beaten yet
    creditRun(run, ['bastion'], { won: false });
    expect(starsOf('bastion')).toBe(0);
    run.floor = 1;
    creditRun(run, ['bastion'], { won: false });
    creditRun(run, ['bastion'], { won: false });
    expect(starsOf('bastion')).toBe(1);
    run.floor = 2;
    creditRun(run, ['bastion'], { won: false });
    expect(starsOf('bastion')).toBe(3);
    expect(locked('cook')).toBe(true);
    creditRun(run, ['bastion'], { won: true });
    creditRun(run, ['bastion'], { won: true });
    expect(starsOf('bastion')).toBe(6);
    expect(locked('cook')).toBe(false);
    expect(opening('bastion')).toBe(false);
    expect(runGains(run)).toEqual({ heroes: ['bastion'], got: { bastion: 6 }, opened: ['cook'], events: [], arts: [] });
    expect(runGains(newRun(1))).toBe(null);
  });

  it('opens a hero for each hero of a party that wins, and only up its own ladder', () => {
    const run = newRun(6262);
    creditRun(run, ['cook', 'ash', 'ricochet'], { won: true });
    expect(starsOf('cook')).toBe(6);
    expect(runGains(run)?.opened).toEqual(['bouncer', 'electra', 'sharp']);
    expect(locked('bum')).toBe(true);
    expect(locked('kid')).toBe(true);
    // stars past the opening stay with the hero, and a lost run's bosses still count
    const next = newRun(7373);
    next.floor = 2;
    creditRun(next, ['bastion', 'electra'], { won: false });
    expect(starsOf('bastion')).toBe(9);
    expect(starsOf('electra')).toBe(3);
    expect(locked('bum')).toBe(true);
  });
});

describe('event and trophy unlocks', () => {
  const done = (key: string, opt: number, extra: Partial<EventState> = {}): EventState => ({ key, seed: 1, votes: {}, done: { opt, won: true }, ...extra });

  it('opens an event by a choice at the one before it, and brings it to the next event room', () => {
    const run = newRun(8484);
    expect(eventLocked('mapper')).toBe(true);
    expect(openEvents()).not.toContain('mapper');
    expect(openEvents()).toHaveLength(START_EVENTS.length);
    // leaving the bar sober opens nothing
    creditRun(run, ['bastion'], { won: false, ev: done('bar', 2) });
    expect(eventLocked('mapper')).toBe(true);
    creditRun(run, ['bastion'], { won: false, ev: done('bar', 0) });
    expect(eventLocked('mapper')).toBe(false);
    expect(dueEvents()).toEqual(['mapper']);
    expect(openedBy(done('bar', 0), run)).toEqual({ events: ['mapper'], arts: [] });
    expect(eventOf(99, ['bar'], openEvents(), dueEvents())).toBe('mapper');
    // met: no longer waited for, and the draw comes from the open ones
    creditRun(run, ['bastion'], { won: false, ev: { key: 'mapper', seed: 2, votes: {} } });
    expect(dueEvents()).toEqual([]);
    for (let s = 0; s < 40; s++) expect(openEvents()).toContain(eventOf(s, [], openEvents(), dueEvents()));
    // a pull of the slot machine's lever counts whatever choice ends it
    creditRun(run, ['bastion'], { won: false, ev: done('goblin', 1) });
    creditRun(run, ['bastion'], { won: false, ev: done('thimble', 2) });
    creditRun(run, ['bastion'], { won: false, ev: done('slot', 1, { pulls: 2 }) });
    expect(eventLocked('bookie')).toBe(false);
    expect(runGains(run)?.events).toEqual(['mapper', 'thimble', 'slot', 'bookie']);
  });

  it('opens trophies by feats, and hands out only the open ones', () => {
    const run = newRun(9595);
    expect(artLocked('chalk')).toBe(true);
    expect(artLocked('tray')).toBe(false);
    const party = [{ arts: [], kept: undefined }];
    for (let s = 0; s < 60; s++) for (const k of rollOffer(s, party)) expect(START_ARTS).toContain(k);
    creditRun(run, ['ash'], { won: false, sum: { crits: 99, walls: 1000 } });
    expect(artLocked('chalk')).toBe(true);
    expect(artLocked('lube')).toBe(false);
    creditRun(run, ['ash'], { won: false, sum: { crits: 100 }, bosses: ['discoball'], ev: done('goblin', 0) });
    expect(artLocked('chalk')).toBe(false);
    expect(artLocked('mirrorball')).toBe(false);
    expect(artLocked('hand')).toBe(false);
    expect(runGains(run)?.arts).toEqual(['lube', 'hand', 'chalk', 'mirrorball']);
    expect(featOf('undies')).toMatchObject({ need: 25 });
  });
});
