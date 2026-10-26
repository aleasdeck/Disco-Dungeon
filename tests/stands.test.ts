import { describe, expect, it } from 'vitest';
import { newRun } from '../src/run';
import { bestStand, creditRun, runGains, standFor, wearStand } from '../src/progress';
import { stats } from '../src/stats';
import { STANDS, nextStand, standDef, standOf } from '../src/stands';
import { Game, newParty } from '../src/game';
import { snapshot } from '../src/sync';

describe('«Подставки мастерства»', () => {
  it('goes plastic, cardboard, wood, bronze, gold and mirror at 1, 3, 6, 10 and 20 wins with the hero', () => {
    expect(STANDS.map(s => s.wins)).toEqual([0, 1, 3, 6, 10, 20]);
    expect([0, 1, 2, 3, 5, 6, 9, 10, 19, 20, 400].map(standOf)).toEqual(
      ['plastic', 'card', 'card', 'wood', 'wood', 'bronze', 'bronze', 'gold', 'gold', 'mirror', 'mirror']);
    expect(nextStand('plastic')?.mat).toBe('card');
    expect(nextStand('gold')?.mat).toBe('mirror');
    expect(nextStand('mirror')).toBe(null);
    expect(standDef(undefined).mat).toBe('plastic');
  });

  it("dresses the hero by this player's wins with it", () => {
    stats.heroes.sharp = { runs: 9, wins: 7, time: 0, kills: 0 };
    expect(standFor('sharp')).toBe('bronze');
    expect(standFor('electra')).toBe('plastic');
  });

  it('tells the run that crossed a step which heroes it put on a new stand, once', () => {
    // the statistics count the win before the run is credited
    stats.heroes.kid = { runs: 4, wins: 3, time: 0, kills: 0 };
    stats.heroes.bum = { runs: 4, wins: 4, time: 0, kills: 0 };
    const run = newRun(7373);
    creditRun(run, ['kid', 'bum'], { won: false });
    expect(runGains(run)?.stands).toBeUndefined();
    creditRun(run, ['kid', 'bum'], { won: true });
    creditRun(run, ['kid', 'bum'], { won: true });
    expect(runGains(run)?.stands).toEqual({ kid: 'wood' });
  });

  it('lets the player put the hero back on any stand earned, until a win earns the next one', () => {
    stats.heroes.cop = { runs: 9, wins: 5, time: 0, kills: 0 };
    expect(standFor('cop')).toBe('wood');
    wearStand('cop', 'card');
    expect(standFor('cop')).toBe('card');
    expect(bestStand('cop')).toBe('wood');
    // a stand not earned yet can't be worn
    wearStand('cop', 'gold');
    expect(standFor('cop')).toBe('card');
    // the win that earns bronze puts the hero on it
    stats.heroes.cop.wins = 6;
    creditRun(newRun(4242), ['cop'], { won: true });
    expect(standFor('cop')).toBe('bronze');
    wearStand('cop', 'plastic');
    expect(standFor('cop')).toBe('plastic');
    // a win that earns nothing new leaves it where the player put it
    stats.heroes.cop.wins = 7;
    creditRun(newRun(4243), ['cop'], { won: true });
    expect(standFor('cop')).toBe('plastic');
    // the best one again: the next stand earned dresses it at once
    wearStand('cop', 'bronze');
    stats.heroes.cop.wins = 10;
    expect(standFor('cop')).toBe('gold');
  });

  it('travels with the hero to the players online', () => {
    const g = new Game();
    g.party = newParty([0, 1]);
    g.party[1].stand = 'gold';
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    const snap = snapshot(g);
    expect(snap.heroes.map(h => h.stand)).toEqual([undefined, 'gold']);
  });
});
