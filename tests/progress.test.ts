import { describe, expect, it } from 'vitest';
import { FLOORS, newRun } from '../src/run';
import { bossStars, creditRun, locked, nextOf, opening, prevOf, runGains, START_HEROES, STARS_TO_OPEN, starsOf } from '../src/progress';

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
    creditRun(run, ['bastion'], false);
    expect(starsOf('bastion')).toBe(0);
    run.floor = 1;
    creditRun(run, ['bastion'], false);
    creditRun(run, ['bastion'], false);
    expect(starsOf('bastion')).toBe(1);
    run.floor = 2;
    creditRun(run, ['bastion'], false);
    expect(starsOf('bastion')).toBe(3);
    expect(locked('cook')).toBe(true);
    creditRun(run, ['bastion'], true);
    creditRun(run, ['bastion'], true);
    expect(starsOf('bastion')).toBe(6);
    expect(locked('cook')).toBe(false);
    expect(opening('bastion')).toBe(false);
    expect(runGains(run)).toEqual({ heroes: ['bastion'], got: { bastion: 6 }, opened: ['cook'] });
    expect(runGains(newRun(1))).toBe(null);
  });

  it('opens a hero for each hero of a party that wins, and only up its own ladder', () => {
    const run = newRun(6262);
    creditRun(run, ['cook', 'ash', 'ricochet'], true);
    expect(starsOf('cook')).toBe(6);
    expect(runGains(run)?.opened).toEqual(['bouncer', 'electra', 'sharp']);
    expect(locked('bum')).toBe(true);
    expect(locked('kid')).toBe(true);
    // stars past the opening stay with the hero, and a lost run's bosses still count
    const next = newRun(7373);
    next.floor = 2;
    creditRun(next, ['bastion', 'electra'], false);
    expect(starsOf('bastion')).toBe(9);
    expect(starsOf('electra')).toBe(3);
    expect(locked('bum')).toBe(true);
  });
});
