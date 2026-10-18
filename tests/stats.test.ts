import { describe, expect, it } from 'vitest';
import { Game, newParty, type Action } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { FLOORS, newRun } from '../src/run';
import { beginRun, endRun, favourite, playTime, stats, syncRun } from '../src/stats';

/** A room with the party's heroes on their runes and the fight on. */
function fightWith(g: Game) {
  g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
  g.alive().forEach((h, k) => g.movePad(h, k));
  g.startFight();
}

describe('player statistics', () => {
  it('counts a run once, its time, and what the hero did in it', () => {
    const run = newRun(4242), g = new Game();
    g.party = newParty([0], run.seed);
    beginRun(run, 'bastion', false);
    beginRun(run, 'bastion', false);
    expect(stats.runs).toBe(1);
    expect(stats.heroes.bastion.runs).toBe(1);
    playTime(run, 3);
    expect(stats.time).toBe(3);
    fightWith(g);
    const h = g.party[0];
    g.throwDisc(h, -30, -40);
    for (const m of g.S.mobs) g.hurtMob(m, 50, '#fff', true, 0.6, h);
    run.path[0].push(run.floors[0][0][0].id);
    syncRun(run, h, false);
    syncRun(run, h, false);
    expect(stats.sum.throws).toBe(1);
    expect(stats.sum.kills).toBe(g.S.mobs.length);
    expect(stats.heroes.bastion.kills).toBe(g.S.mobs.length);
    // the health the blows took off, not the overkill; the blow itself is the record
    expect(stats.sum.dmg).toBe(g.S.mobs.reduce((a, m) => a + m.max, 0));
    expect(stats.sum.top).toBe(50);
    expect(stats.best.topBy).toBe('bastion');
    // the room the party stands in is passed once it stands between rooms again
    expect(stats.rooms).toBe(0);
    syncRun(run, h, true);
    expect(stats.rooms).toBe(1);
  });

  it("leaves a hero's numbers from another run alone and ends a run once", () => {
    const old = newRun(1), run = newRun(4243), g = new Game();
    g.party = newParty([2], old.seed);
    g.party[0].tally!.kills = 9;
    beginRun(run, g.party[0].def.key, true);
    expect(stats.runs).toBe(2);
    expect(stats.online).toBe(1);
    const kills = stats.sum.kills;
    syncRun(run, g.party[0], true);
    expect(stats.sum.kills).toBe(kills);
    playTime(run, 5);
    endRun(run, g.party[0], true);
    endRun(run, g.party[0], false);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.best.fast).toBe(5);
    expect(stats.bosses).toBe(FLOORS);
    // the run is over: its time stands still
    playTime(run, 5);
    expect(stats.time).toBe(8);
    // one run each: the favourite is the one played longer
    expect(favourite()).toBe(g.party[0].def.key);
  });

  it("online, a client reads its own hero's numbers from the host's snapshots", () => {
    const run = newRun(4244), host = new Game(), cli = new Game(), sent: Action[] = [];
    host.party = newParty([0, 2], run.seed);
    fightWith(host);
    host.online = cli.online = true;
    cli.send = a => sent.push(a);
    cli.canControl = h => h.i === 2;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    const mine = cli.heroOf(2);
    cli.throwDisc(mine, -20, -40);
    // the throw goes to the host, and the host counts it
    expect(mine.tally!.throws).toBe(0);
    host.perform(sent[0]);
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.heroOf(2).tally).toMatchObject({ run: run.seed, throws: 1 });
    expect(cli.heroOf(0).tally!.throws).toBe(0);
  });
});
