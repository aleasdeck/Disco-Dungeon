import { describe, expect, it } from 'vitest';
import { Game, newParty, type Action } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { FLOORS, newRun } from '../src/run';
import { beginRun, endRun, favourite, playTime, resumeRun, runCount, stats, syncRun } from '../src/stats';

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
    beginRun(run, ['bastion'], false);
    beginRun(run, ['bastion'], false);
    expect(stats.runs).toBe(1);
    expect(stats.heroes.bastion.runs).toBe(1);
    playTime(run, 3);
    expect(stats.time).toBe(3);
    fightWith(g);
    const h = g.party[0];
    g.throwDisc(h, -30, -40);
    for (const m of g.S.mobs) g.hurtMob(m, 50, '#fff', true, 0.6, h);
    run.path[0].push(run.floors[0][0][0].id);
    syncRun(run, [h], false);
    syncRun(run, [h], false);
    expect(stats.sum.throws).toBe(1);
    expect(stats.sum.kills).toBe(g.S.mobs.length);
    expect(stats.heroes.bastion.kills).toBe(g.S.mobs.length);
    // the health the blows took off, not the overkill; the blow itself is the record
    expect(stats.sum.dmg).toBe(g.S.mobs.reduce((a, m) => a + m.max, 0));
    expect(stats.sum.top).toBe(50);
    expect(stats.best.topBy).toBe('bastion');
    // the room the party stands in is passed once it stands between rooms again
    expect(stats.rooms).toBe(0);
    syncRun(run, [h], true);
    expect(stats.rooms).toBe(1);
  });

  it("leaves a hero's numbers from another run alone and ends a run once", () => {
    const old = newRun(1), run = newRun(4243), g = new Game();
    g.party = newParty([2], old.seed);
    g.party[0].tally!.kills = 9;
    beginRun(run, [g.party[0].def.key], true);
    expect(stats.runs).toBe(2);
    expect(stats.online).toBe(1);
    const kills = stats.sum.kills;
    syncRun(run, g.party, true);
    expect(stats.sum.kills).toBe(kills);
    playTime(run, 5);
    endRun(run, g.party, true);
    endRun(run, g.party, false);
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

  it('counts a campaign party once, with a run for each hero and what all of them did', () => {
    const run = newRun(4245), g = new Game();
    g.party = newParty([0, 2], run.seed);
    const keys = g.party.map(h => h.def.key), runs = stats.runs, kills = stats.sum.kills;
    const was = keys.map(k => stats.heroes[k]?.runs ?? 0);
    beginRun(run, keys, false);
    beginRun(run, keys, false);
    expect(stats.runs).toBe(runs + 1);
    expect(keys.map(k => stats.heroes[k].runs)).toEqual(was.map(n => n + 1));
    fightWith(g);
    const [a, b] = g.party, [m1, m2] = g.S.mobs;
    g.hurtMob(m1, 99, '#fff', true, 0.6, a);
    g.hurtMob(m2, 99, '#fff', true, 0.6, b);
    syncRun(run, g.party, false);
    expect(stats.sum.kills).toBe(kills + 2);
    expect(stats.best.kills).toBeGreaterThanOrEqual(2);
    const wins = keys.map(k => stats.heroes[k].wins);
    endRun(run, g.party, true);
    expect(keys.map(k => stats.heroes[k].wins)).toEqual(wins.map(n => n + 1));
  });

  it('goes on counting a saved campaign as the same run, even after an online game was counted', () => {
    const run = newRun(4246), g = new Game();
    g.party = newParty([1], run.seed);
    const keys = [g.party[0].def.key];
    beginRun(run, keys, false);
    fightWith(g);
    const h = g.party[0];
    g.throwDisc(h, -30, -40);
    syncRun(run, g.party, false);
    // the campaign's save: the game and how far the statistics had counted it
    const save = JSON.parse(JSON.stringify({ snap: snapshot(g), count: runCount(run) }));
    const runs = stats.runs, throws = stats.sum.throws, kills = stats.sum.kills;
    // the game comes back the same visit: nothing new to count yet
    resumeRun(run, keys, save.count);
    expect(stats.runs).toBe(runs);
    // an online game is counted, then the campaign goes on from its save
    beginRun(newRun(4247), ['bastion'], true);
    const back = new Game();
    applySnapshot(back, save.snap);
    resumeRun(run, keys, save.count);
    expect(stats.runs).toBe(runs + 1);
    expect(stats.cur?.seed).toBe(run.seed);
    // what was counted before the save isn't counted again, what the run does on is
    syncRun(run, back.party, false);
    expect(stats.sum.throws).toBe(throws);
    back.hurtMob(back.S.mobs[0], 99, '#fff', true, 0.6, back.party[0]);
    syncRun(run, back.party, false);
    expect(stats.sum.kills).toBe(kills + 1);
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
