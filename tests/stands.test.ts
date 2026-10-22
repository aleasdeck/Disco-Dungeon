import { describe, expect, it } from 'vitest';
import { newRun } from '../src/run';
import { creditRun, runGains, standFor } from '../src/progress';
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

  it('travels with the hero to the players online', () => {
    const g = new Game();
    g.party = newParty([0, 1]);
    g.party[1].stand = 'gold';
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    const snap = snapshot(g);
    expect(snap.heroes.map(h => h.stand)).toEqual([undefined, 'gold']);
  });
});
