import { describe, expect, it } from 'vitest';
import { TILE } from '../src/data';
import { LAYERS } from '../src/run';
import { Game, newBank, newParty } from '../src/game';
import { cellAt, hazKey } from '../src/room';
import { applySnapshot, snapshot } from '../src/sync';
import { FALL, planFall, spill, type FallRoom } from '../src/collapse';

const placeAll = (g: Game) => g.alive().forEach((h, k) => g.movePad(h, k));
const endAll = (g: Game) => g.alive().forEach(h => g.endTurn(h));
const play = (g: Game, until: () => boolean) => { for (let k = 0; k < 20000 && !until(); k++) g.update(1 / 60); };
const cellOf = (g: Game, h = g.hero) => { const p = g.spot(h)!; return hazKey(...cellAt(p.x, p.y)); };

/** An ore cave for `picks`, the fight begun; online every hero keeps its own ore. */
const enter = (picks: number[], online = false, seed = 4) => {
  const g = new Game();
  g.party = newParty(picks);
  g.bank = newBank(0, online);
  g.online = online;
  g.loadRoom({ seed, depth: LAYERS + 2, floor: 1, type: 'treasure' });
  placeAll(g);
  if (online) g.party.forEach(h => g.startFight(h));
  else g.startFight();
  let won: boolean | null = null;
  g.onRoomEnd = w => { won = w; };
  return { g, won: () => won };
};

/** A turn with no throws: every hero stays where it stands and the marked ceiling comes down. */
const sitOut = (g: Game) => {
  const t = g.S.turn;
  endAll(g);
  play(g, () => (g.S.phase === 'throw' && g.S.turn > t) || g.S.phase === 'over');
};

describe('the ceiling coming down', () => {
  const room = (heroes: [number, number][] = [[2, 6]]): FallRoom => ({ gw: 16, gh: 13, open: () => true, veins: [[9, 4], [12, 8]], heroes });

  it('marks every hero\'s cell, more of the ceiling every turn, and slabs from the third turn on', () => {
    let last = 0;
    for (let turn = 1; turn < FALL.end; turn++) {
      const f = planFall(room([[2, 6], [5, 5]]), 77, turn);
      expect(f.marks).toEqual(expect.arrayContaining(['2,6', '5,5']));
      expect(new Set(f.marks).size).toBe(f.marks.length);
      if (turn < FALL.slabFrom) expect(f.slab).toHaveLength(0);
      for (const c of f.slab) expect(f.marks).toContain(c);
      expect(f.marks.length).toBeLessThanOrEqual(2 + FALL.pieces[turn - 1] * (turn >= FALL.slabFrom ? 9 : 4));
      // the same seed and turn mark the same cells on every screen
      expect(planFall(room([[2, 6], [5, 5]]), 77, turn)).toEqual(f);
      last = turn;
    }
    expect(last).toBe(FALL.end - 1);
    // over many caves the pieces grow turn by turn, and a third of them or so come down over a vein
    const mean = (turn: number) => { let n = 0; for (let s = 1; s <= 300; s++) n += planFall(room([]), s, turn).marks.length; return n / 300; };
    for (let turn = 2; turn < FALL.end; turn++) expect(mean(turn)).toBeGreaterThan(mean(turn - 1));
  });

  it('marks only open floor and veins, and lets the cracks creep out of last turn\'s rubble', () => {
    const shut = new Set(['3,3', '4,4']), r: FallRoom = { gw: 8, gh: 8, open: (i, j) => !shut.has(i + ',' + j), veins: [[3, 3]], heroes: [] };
    for (let s = 1; s < 200; s++) for (let turn = 1; turn < FALL.end; turn++) expect(planFall(r, s, turn).marks).not.toContain('4,4');
    let crept = 0;
    for (let s = 1; s < 400; s++) if (planFall({ ...r, open: () => true, veins: [] }, s, 1, ['6,6']).marks.some(c => ['5,6', '7,6', '6,5', '6,7'].includes(c))) crept++;
    expect(crept).toBeGreaterThan(0);
  });

  it('spills half the ore dug, rounded up', () => {
    expect([0, 1, 2, 5, 8].map(spill)).toEqual([0, 1, 1, 3, 4]);
  });
});

describe('«Обвал» in the game', () => {
  it('marks where the ceiling comes down as the turn begins, and drops it once the heroes have hopped', () => {
    const { g } = enter([0, 1, 2]);
    expect(g.S.turn).toBe(1);
    const f = g.S.fall!;
    for (const h of g.party) expect(f.marks).toContain(cellOf(g, h));
    const hp = g.party.map(h => h.hp), veins = g.S.nodes.filter(n => n.left > 0 && f.marks.includes(hazKey(...cellAt(n.x, n.y)))).map(n => [n, n.left] as const);
    const blocks = g.S.blocks.length;
    sitOut(g);
    expect(g.S.turn).toBe(2);
    // nobody moved: a stone on everyone, a vein under the dust an ore poorer, rubble on the rest
    for (const [k, h] of g.party.entries()) expect(h.hp).toBe(hp[k] - (f.slab.includes(cellOf(g, h)) ? FALL.slab : FALL.stone));
    for (const [n, left] of veins) expect(n.left).toBe(left - 1);
    const rub = g.S.blocks.filter(b => b.rub);
    expect(rub.length).toBeGreaterThan(0);
    expect(g.S.blocks.length).toBe(blocks + rub.length);
    for (const b of rub) expect(f.marks).toContain(hazKey(b.x0 / TILE, b.y0 / TILE));
    expect(g.S.fall!.marks.length).toBeGreaterThan(0);
  });

  it('takes the whole party out at once from the second turn on, alone with a party, before any hero has thrown', () => {
    const { g, won } = enter([0, 1, 2]);
    const [a, b] = g.party;
    expect(g.mayLeave(a)).toBe(false);
    sitOut(g);
    // a hero that has thrown this turn keeps the party in for it
    b.hp = 99;
    g.throwDisc(b, 10, 0);
    g.leave(a);
    expect(g.party.some(h => h.out)).toBe(false);
    expect(g.S.phase).toBe('throw');
    endAll(g);
    play(g, () => g.S.turn > 2 || g.S.phase === 'over');
    expect(g.S.turn).toBe(3);
    g.leave(a);
    expect(g.party.every(h => h.out)).toBe(true);
    expect(g.S.phase).toBe('over');
    expect(won()).toBe(true);
    expect(g.S.turn).toBe(3);
    expect(g.caved).toBe(false);
  });

  it('online walks the party out once every player at the table wants out, and a wish lasts the turn', () => {
    const { g, won } = enter([0, 1, 2], true);
    const [a, b, c] = g.party;
    for (const h of g.party) h.hp = h.max = 99;
    sitOut(g);
    // Петя wants out: his hero throws no more this turn, and he may take it back
    g.leave(a);
    expect(g.S.vote).toEqual([a.i]);
    expect(a.out).toBe(false);
    expect(g.ended(a)).toBe(true);
    expect(g.canThrow(a)).toBe(false);
    g.cancelEndTurn(a);
    expect(g.S.vote).toEqual([]);
    expect(g.ended(a)).toBe(false);
    expect(a.hand).toBeGreaterThan(0);
    g.leave(a);
    // Оля digs on: the party stays, and Петя stands still as the stones come down
    g.throwDisc(b, 10, 0);
    g.leave(c);
    expect(g.S.vote).toEqual([a.i, c.i]);
    expect(g.party.some(h => h.out)).toBe(false);
    const hp = a.hp;
    endAll(g);
    play(g, () => g.S.turn > 2 || g.S.phase === 'over');
    expect(g.S.turn).toBe(3);
    expect(a.hp).toBeLessThan(hp);
    expect(g.S.vote).toEqual([]);
    // the next turn they all want out: everyone goes at once, before the stones
    g.leave(a);
    g.leave(b);
    expect(g.S.phase).toBe('throw');
    const hp3 = g.party.map(h => h.hp);
    g.leave(c);
    expect(g.party.every(h => h.out)).toBe(true);
    expect(g.S.phase).toBe('over');
    expect(won()).toBe(true);
    expect(g.party.map(h => h.hp)).toEqual(hp3);
    expect(g.caved).toBe(false);
  });

  it('online doesn\'t wait for the players who dropped out', () => {
    const { g } = enter([0, 1, 2], true);
    const [a, b, c] = g.party;
    for (const h of g.party) h.hp = h.max = 99;
    sitOut(g);
    g.setAway([c.i]);
    g.leave(a);
    expect(g.S.phase).toBe('throw');
    g.leave(b);
    expect(g.S.phase).toBe('over');
    expect(c.out).toBe(true);
  });

  it('brings the whole ceiling down on whoever stays to the last turn: a blow and half their ore', () => {
    const { g, won } = enter([0], true);
    const h = g.hero;
    h.hp = h.max = 99;
    g.S.took = { [h.i]: 7 };
    h.ore = 9;
    for (let t = 1; t < FALL.end; t++) sitOut(g);
    expect(g.S.phase).toBe('over');
    expect(g.caved).toBe(true);
    expect(won()).toBe(true);
    expect(g.S.turn).toBe(FALL.end - 1);
    expect(h.ore).toBe(9 - spill(7));
    expect(h.hp).toBeLessThanOrEqual(99 - FALL.endDmg - (FALL.end - 1) * FALL.stone);
  });

  it('pays twice from a vein under the dust, dealt out to the party online, and a hero the stones bury spills half its share', () => {
    const { g } = enter([0, 1], true);
    const [a, b] = g.party, p = g.spot(a)!;
    const v = g.S.nodes.filter(n => n.k === 'ore' && n.left > 0).sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y))[0];
    const key = hazKey(...cellAt(v.x, v.y));
    if (!g.S.fall!.marks.includes(key)) g.S.fall!.marks.push(key);
    expect(g.cracked(v)).toBe(true);
    g.throwDisc(a, v.x - p.x, v.y - p.y);
    play(g, () => !g.moving());
    expect(g.mined % FALL.crack).toBe(0);
    expect(g.mined).toBeGreaterThan(0);
    // dealt out as in a fight, the digger first: nobody more than one ore ahead
    const ores = [a.ore ?? 0, b.ore ?? 0];
    expect(ores[0] + ores[1]).toBe(g.mined);
    expect(ores[0] - ores[1]).toBeGreaterThanOrEqual(0);
    expect(ores[0] - ores[1]).toBeLessThanOrEqual(1);
    expect(g.S.took).toEqual(ores[1] ? { [a.i]: ores[0], [b.i]: ores[1] } : { [a.i]: ores[0] });
    // the stones bury the digger: half its share stays in the cave
    a.hp = 1;
    a.shield = 0;
    const share = ores[0];
    endAll(g);
    play(g, () => g.S.turn > 1 || g.S.phase === 'over');
    if (a.hp <= 0) expect(a.ore).toBe(share - spill(share));
  });

  it('carries the ceiling, the rubble, the ore got and who wants out to every screen', () => {
    const { g } = enter([0, 1], true);
    sitOut(g);
    g.leave(g.party[1]);
    g.S.took = { [g.party[0].i]: 3 };
    const c = new Game();
    applySnapshot(c, JSON.parse(JSON.stringify(snapshot(g))));
    expect(c.S.fall).toEqual(g.S.fall);
    expect(c.S.took).toEqual(g.S.took);
    expect(c.S.vote).toEqual([g.party[1].i]);
    expect(c.party.map(h => h.out)).toEqual([false, false]);
    expect(c.S.blocks.filter(b => b.rub)).toEqual(g.S.blocks.filter(b => b.rub));
  });
});
