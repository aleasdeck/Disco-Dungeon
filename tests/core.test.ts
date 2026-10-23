import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Camera, FIT, KEEP, type Vec } from '../src/camera';
import { AB_BOUNCES, AB_BURN, AB_COST, AB_SHIELD, AB_SPEED, BOSS_HEAL, CRIT, E_MAX, FAN_ANGLE, FAN_M, FAN_R, CUFF_TURNS, FOOD_HEAL, FOOD_PER_DISC, CLEAN_ORE, FORGE_ORE, FROST_SLOW_VULN, FROST_STEPS, FROST_VULN, GAS_TURNS, GAS_WEAK, HAND_COST, HAND_MAX, HAND_START, HEROES, HERO_FIG, KISS_TURNS, MAX_PLAYERS, MOBS, MOB_HP_MUL, NODES, NODE_E, PETARD_DMG, PETARD_LURE, PETARD_TURNS, KINDS, RAGE_FROM, RISE_HP, SHOVE_DMG, TILE, UP_COST, ZAP, ZAP_REACH, forgeOre, gasDmg, heroFig, heroesByKind, isRanged, kindOf, mobSize, toughOf } from '../src/data';
import { ART, DOOR_MUL, FOOD_FLY, FOOD_TOSS, Game, newBank, newParty, stepsOf, wayLen, type Action, type Disc, type HeroState } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { ARENA_TRIES, BOSS_UP, BURROW_APART, BURROW_NEAR, CASTS, CAVE, MOB_CAP, arenaFit, bossOf, fireCells, lanesOf, mobPool, caveStock, PARTY_SCALE, RUNE_AREA, SPK_AREA, caveTurns, crystals, runes, PIT_CELLS, PIT_KINDS, PIT_SHAPES, cellAt, cellCentre, clearOfRock, dmgBonus, floorAt, generate, hazKey, inPit, isFloor, mobDmg, muAt, newMob, pitAt, tierOf, type Intent, type Layout, type Mob, type ResNode } from '../src/room';
import { ELITES, FIGHTS, FLOORS, FORGE_ROWS, LAYERS, REST_ROW, agreed, floorOk, genFloor, isFight, newRun, nodeById, reachable, routes, runDone } from '../src/run';
import { makeRng } from '../src/rng';
import { t as shown } from '../src/i18n';
import { BOTTLE, CUPS, EVENTS, PULL_ODDS, RIDDLES, ROB_MIN, SELL, applyFx, canPick, choicesOf, cupPick, doneOf, eventDef, eventOf, fxParts, heroPick, redrawn, riddleOf, rolled, sellDone, sellPick, settleBet, shuffleOf, shutWhy, stageOf, take, type EventState, type Table } from '../src/events';
import { CAMP_HEAL, DIG_MAX, campDo, campLeave, canCamp, digOre, type CampState } from '../src/camp';
import { ARTIFACTS, BELLY, OFFER, PASS, SOCKETS, lootAgreed, lootFor, newLoot, rollOffer, settleLoot, takeKept, type ArtKey } from '../src/artifacts';

/** Put every living hero on its own rune, as players do before the fight. */
const placeAll = (g: Game) => g.alive().forEach((h, k) => g.movePad(h, k));
/** Every living hero's player presses «Конец хода». */
const endAll = (g: Game) => g.alive().forEach(h => g.endTurn(h));

describe('room generator', () => {
  it('builds the same room from the same seed', () => {
    const spec = { seed: 48213, depth: 4, floor: 1, type: 'fight' as const };
    const a = generate(spec), b = generate(spec);
    expect(JSON.stringify({ ...a, haz: [...a.haz] })).toBe(JSON.stringify({ ...b, haz: [...b.haz] }));
  });

  it('always has three to five throw runes by the size of the room and at least one mob', () => {
    for (let seed = 1; seed < 60; seed++) {
      const f = seed % 3, L = generate({ seed, depth: f * LAYERS + 1 + (seed % 6), floor: f, type: seed % 5 ? 'fight' : 'boss' });
      expect(L.pads).toHaveLength(runes(L.floor.reduce((a, b) => a + b, 0)));
      expect(L.mobs.length).toBeGreaterThan(0);
      for (const m of L.mobs) expect(clearOfRock(L, m.x, m.y, m.r)).toBe(true);
      for (const n of L.nodes) expect(clearOfRock(L, n.x, n.y, n.r)).toBe(true);
      for (const p of L.pads) expect(floorAt(L, p.x, p.y)).toBe(true);
    }
  });

  it('puts every enemy in the room from the start, tougher than the base stats', () => {
    const L = generate({ seed: 5, depth: 1, floor: 0, type: 'fight' });
    expect('waves' in L).toBe(false);
    for (const m of L.mobs) expect(m.max).toBe(Math.round(MOBS[m.k].hp * MOB_HP_MUL * toughOf(m.k)));
  });

  it('makes every blow toughOf harder on the average, a kind alike in a room, the warm-up dummies as they were', () => {
    expect(toughOf('skel')).toBe(1.1);
    expect(toughOf('headsman')).toBe(1.1);
    expect(toughOf('king')).toBe(1.05);
    expect(toughOf('pahan2')).toBe(1.05);
    for (const [k, dmgAdd, dmgMul] of [['archer', 0, 1], ['skel', 0, 0.8], ['ghoul', 3, 0.6], ['golem', 4, 1], ['king', 0, 1], ['lich', 3, 0.8]] as [keyof typeof MOBS, number, number][]) {
      const plain = mobDmg(k, dmgAdd, dmgMul), t = toughOf(k), blows = Array.from({ length: 4000 }, (_, seed) => mobDmg(k, dmgAdd, dmgMul, seed));
      for (const b of blows) expect([Math.floor(plain * t + 1e-9), Math.floor(plain * t + 1e-9) + 1]).toContain(b);
      expect(blows.reduce((a, b) => a + b, 0) / blows.length / plain).toBeCloseTo(t, 1);
    }
    const L = generate({ seed: 11, depth: 5, floor: 0, type: 'fight' });
    for (const m of L.mobs) expect(m.dmg).toBe(L.mobs.find(o => o.k === m.k)!.dmg);
    expect(newMob('dummy_boxer', 0, 0).dmg).toBe(MOBS.dummy_boxer.dmg);
  });

  it('makes rooms of different shapes, each one connected', () => {
    const shapes = new Set<string>();
    for (let seed = 1; seed < 200; seed++) {
      const L = generate({ seed, depth: 1 + (seed % LAYERS), floor: 0, type: seed % LAYERS === LAYERS - 1 ? 'boss' : 'fight' });
      shapes.add(L.shape);
      // flood fill from the first floor cell reaches every floor cell
      const start = L.floor.indexOf(1), seen = new Set([start]), stack = [start];
      while (stack.length) {
        const k = stack.pop()!, i = k % L.gw, j = Math.floor(k / L.gw);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj, nk = nj * L.gw + ni;
          if (isFloor(L, ni, nj) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      expect(seen.size).toBe(L.floor.reduce((a, b) => a + b, 0));
    }
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });
});

describe('resources', () => {
  it('puts one ore vein in a plain fight, two in an elite one and two to eight in the ore cave', () => {
    const veins = (type: 'fight' | 'elite' | 'treasure' | 'boss', seed: number) =>
      generate({ seed, depth: type === 'boss' ? LAYERS : 5, floor: 0, type }).nodes.filter(n => n.k === 'ore').length;
    for (let seed = 1; seed < 30; seed++) {
      expect(veins('fight', seed)).toBe(1);
      expect(veins('elite', seed)).toBe(2);
      expect(veins('boss', seed)).toBe(1);
      expect(veins('treasure', seed)).toBeGreaterThanOrEqual(2);
      expect(veins('treasure', seed)).toBeLessThanOrEqual(8);
    }
  });
});

describe('ore cave', () => {
  const cave = (seed: number, heroes: number) => generate({ seed, depth: LAYERS + 2, floor: 1, type: 'treasure', heroes });

  // the clump's veins stand next to each other, the other veins and the mushrooms well apart
  const clumped = (nodes: ResNode[]) => nodes.filter(n => n.k === 'ore' && nodes.some(o => o !== n && o.k === 'ore' && Math.hypot(o.x - n.x, o.y - n.y) === TILE));

  it('holds no enemies and its own stock: a clump of three veins or none, 2–5 small ones, 0–2 mushroom patches, the same for any party', () => {
    const seen = { clump: new Set<number>(), ore: new Set<number>(), herb: new Set<number>(), gap: new Set<number>() };
    for (let seed = 1; seed < 80; seed++) {
      const stock = caveStock({ seed, depth: LAYERS + 2 });
      for (const k of ['clump', 'ore', 'herb', 'gap'] as const) seen[k].add(stock[k]);
      for (const heroes of [1, 2, 3]) {
        const L = cave(seed, heroes), clump = clumped(L.nodes), rest = L.nodes.filter(n => !clump.includes(n));
        const small = rest.filter(n => n.k === 'ore'), herbs = rest.filter(n => n.k === 'herb');
        expect(L.mobs).toHaveLength(0);
        expect(clump).toHaveLength(3 * stock.clump);
        for (const n of L.nodes) expect(n.s).toBeUndefined();
        for (const n of clump) expect(n).toMatchObject({ k: 'ore', ch: CAVE.small.ch, left: CAVE.small.ch });
        // three cells of a 2 × 2 square: as much ore as the big vein had
        if (clump.length) {
          const xs = clump.map(n => n.x), ys = clump.map(n => n.y);
          expect(Math.max(...xs) - Math.min(...xs)).toBe(TILE);
          expect(Math.max(...ys) - Math.min(...ys)).toBe(TILE);
          expect(clump.reduce((t, n) => t + n.ch, 0)).toBe(6);
        }
        expect(small).toHaveLength(stock.ore);
        for (const n of small) expect(n).toMatchObject({ ch: CAVE.small.ch, left: CAVE.small.ch });
        expect(herbs).toHaveLength(stock.herb);
        expect(rest).toHaveLength(stock.ore + stock.herb);
        expect(L.nodes).toEqual(cave(seed, 1).nodes);
      }
    }
    // every count turns up
    expect([...seen.clump].sort()).toEqual([0, 1]);
    expect([...seen.gap].sort()).toEqual([0, 1, 2, 3]);
    expect([...seen.ore].sort()).toEqual([2, 3, 4, 5]);
    expect([...seen.herb].sort()).toEqual([0, 1, 2]);
  });

  it('gives 4 minus the heroes turns: three alone, one for three heroes', () => {
    expect([1, 2, 3].map(heroes => caveTurns({ heroes }))).toEqual([3, 2, 1]);
  });

  // a cave with the clump, in a clear line from the first rune, and a mushroom patch
  const FULL = 4;
  const enter = (picks: number[], seed = FULL) => {
    const g = new Game();
    g.party = newParty(picks);
    g.loadRoom({ seed, depth: LAYERS + 2, floor: 1, type: 'treasure' });
    placeAll(g); g.startFight();
    let won: boolean | null = null;
    g.onRoomEnd = w => { won = w; };
    return { g, won: () => won };
  };
  const play = (g: Game, until: () => boolean) => { for (let k = 0; k < 20000 && !until(); k++) g.update(1 / 60); };

  it('ends once the turns are up, with no enemy turn in between', () => {
    for (const picks of [[0], [0, 1], [0, 1, 2]]) {
      const { g, won } = enter(picks), seen = new Set<string>();
      expect(g.turnsMax()).toBe(4 - picks.length);
      for (let t = 1; t <= g.turnsMax(); t++) {
        expect(g.S.turn).toBe(t);
        expect(g.S.phase).toBe('throw');
        endAll(g);
        play(g, () => { seen.add(g.S.phase); return g.S.phase === 'throw' && g.S.turn > t || g.S.phase === 'over'; });
      }
      expect(g.S.phase).toBe('over');
      expect(won()).toBe(true);
      expect(seen.has('enemy')).toBe(false);
      expect(g.S.turn).toBe(4 - picks.length);
    }
  });

  it('stays open while mushrooms are left, ends at once when everything is spent, and counts the ore mined', () => {
    expect(caveStock({ seed: FULL, depth: LAYERS + 2 })).toMatchObject({ clump: 1, herb: 1 });
    const { g, won } = enter([0]);
    const p0 = g.spot(g.hero)!, big = clumped(g.S.nodes).sort((a, b) => Math.hypot(a.x - p0.x, a.y - p0.y) - Math.hypot(b.x - p0.x, b.y - p0.y))[0];
    // the veins spent, a mushroom patch left: a throw may still go for health
    for (const n of g.S.nodes) n.left = n.k === 'herb' ? 1 : 0;
    g.update(1 / 60);
    expect(g.cleared()).toBe(false);
    expect(g.S.phase).toBe('throw');
    // the last charge: the clump's nearest vein a hit away, the rest spent
    for (const n of g.S.nodes) n.left = n === big ? 1 : 0;
    const h = g.hero, p = g.spot(h)!;
    g.throwDisc(h, big.x - p.x, big.y - p.y);
    play(g, () => g.S.phase === 'over');
    expect(big.left).toBe(0);
    expect(g.cleared()).toBe(true);
    expect(g.S.turn).toBe(1);
    expect(won()).toBe(true);
    expect(g.mined).toBeGreaterThan(0);
    expect(g.bank.ore).toBe(g.mined);
  });
});

describe('difficulty along a floor', () => {
  const room = (f: number, row: number, seed: number, type: 'fight' | 'elite' = 'fight') => generate({ seed, depth: f * LAYERS + row + 1, floor: f, type });

  it('opens every floor with a small plain room and ends it with a big tangled one', () => {
    for (let f = 0; f < FLOORS; f++) for (let seed = 1; seed < 40; seed++) {
      const a = room(f, 0, seed), z = room(f, REST_ROW - 1, seed);
      expect(a.shape).toBe('rect');
      expect(a.pits).toHaveLength(0);
      expect(a.gw * a.gh).toBeLessThan(z.gw * z.gh);
      // since the map has 4–5 fights a path the last rooms hold 2–3 enemies, so one may hold no more than the first
      expect(a.mobs.length).toBeLessThanOrEqual(z.mobs.length);
      expect(a.haz.size).toBeLessThan(z.haz.size);
      expect(z.pits.length).toBeGreaterThan(0);
    }
  });

  it('places every enemy it asks for, in every row of every floor', () => {
    for (let f = 0; f < FLOORS; f++) for (let row = 0; row < REST_ROW; row++) for (const type of ['fight', 'elite'] as const) {
      for (let seed = 1; seed < 60; seed++) {
        const spec = { seed, depth: f * LAYERS + row + 1, floor: f, type }, L = generate(spec);
        expect(L.mobs.length).toBeGreaterThanOrEqual(Math.min(tierOf(spec).tier.mobs[0] + f, MOB_CAP));
        expect(L.mobs.length).toBeLessThanOrEqual(MOB_CAP);
        expect(L.pads).toHaveLength(runes(L.floor.reduce((a, b) => a + b, 0)));
      }
    }
  });

  it('lays three to five throw runes by the size of the room, apart along its near edges, always enough for the party', () => {
    expect([runes(80), runes(RUNE_AREA[0]), runes(RUNE_AREA[0] + 1), runes(RUNE_AREA[1]), runes(RUNE_AREA[1] + 1), runes(200)]).toEqual([3, 3, 4, 4, 5, 5]);
    const seen: Record<number, number[]> = {};
    for (let seed = 1; seed < 60; seed++)
      for (let row = 0; row < LAYERS; row++) {
        const f = seed % FLOORS, type = row === LAYERS - 1 ? 'boss' : seed % 4 ? 'fight' : 'treasure';
        const L = generate({ seed, depth: f * LAYERS + row + 1, floor: f, type, heroes: 1 + (seed % 3) });
        const cells = L.pads.map(p => cellAt(p.x, p.y, 1)), area = L.floor.reduce((a, b) => a + b, 0);
        expect(L.pads).toHaveLength(runes(area));
        expect(L.pads.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
        // each on its own cell of floor, two cells apart at least, on the near side of the room
        for (const [k, [i, j]] of cells.entries()) {
          expect(isFloor(L, i, j)).toBe(true);
          expect((i + 0.5) / L.gw + (j + 0.5) / L.gh).toBeGreaterThan(1);
          for (const [a, b] of cells.slice(k + 1)) expect(Math.max(Math.abs(a - i), Math.abs(b - j))).toBeGreaterThanOrEqual(2);
        }
        (seen[row] ??= []).push(L.pads.length);
      }
    // the first room of a floor is small, the middle rows mostly four, the boss's big
    expect(seen[0].every(n => n === 3)).toBe(true);
    expect(seen[3].filter(n => n === 4).length).toBeGreaterThan(seen[3].length / 2);
    expect(seen[LAYERS - 1].every(n => n === 5)).toBe(true);
  });

  it('puts one to three spark crystals in a fight by the size of the room, each holding one ability for any party', () => {
    expect([crystals(80), crystals(SPK_AREA[0]), crystals(SPK_AREA[0] + 1), crystals(SPK_AREA[1]), crystals(SPK_AREA[1] + 1), crystals(200)]).toEqual([1, 1, 2, 2, 3, 3]);
    const seen: Record<number, number[]> = {};
    let short = 0, n = 0;
    for (let seed = 1; seed < 60; seed++)
      for (let row = 0; row < LAYERS; row++) {
        const f = seed % FLOORS, type = row === LAYERS - 1 ? 'boss' : row === 4 && seed % 2 ? 'elite' : 'fight';
        if (type === 'boss' && seed % 4) continue;
        for (const heroes of [1, 3]) {
          const L = generate({ seed, depth: f * LAYERS + row + 1, floor: f, type, heroes }), spk = L.nodes.filter(k => k.k === 'spk');
          const open = L.floor.reduce((a, b) => a + b, 0) - L.pits.reduce((a, p) => a + p.cells.length, 0);
          // a second or third crystal stays out of the rare room with no fair place left for it
          expect(spk.length).toBeGreaterThanOrEqual(1);
          expect(spk.length).toBeLessThanOrEqual(crystals(open));
          n++;
          if (spk.length < crystals(open)) short++;
          for (const c of spk) expect([c.ch, c.left]).toEqual([AB_COST, AB_COST]);
          (seen[row] ??= []).push(spk.length);
        }
      }
    expect(short / n).toBeLessThan(0.05);
    // the first room of a floor is small, the boss's big
    expect(seen[0].every(n => n === 1)).toBe(true);
    expect(seen[LAYERS - 1].filter(n => n === 3).length).toBeGreaterThan(seen[LAYERS - 1].length / 2);
  });

  it('keeps even the last rooms of the last floor uncluttered', () => {
    for (let seed = 1; seed < 40; seed++) {
      const L = room(FLOORS - 1, REST_ROW - 1, seed), area = L.floor.reduce((a, b) => a + b, 0);
      const busy = L.mobs.length + L.blocks.length + L.pits.length + L.haz.size + L.nodes.length;
      // a vein, the trio's mushroom patches and up to three crystals
      expect(L.nodes.length).toBeGreaterThanOrEqual(3);
      expect(L.nodes.length).toBeLessThanOrEqual(1 + PARTY_SCALE[3].herbs + 3);
      expect(L.decals.length).toBeLessThanOrEqual(6);
      expect(busy / area).toBeLessThan(0.2);
    }
  });

  it('builds the boss a big open arena with columns and hazards, and never cuts the boss off from a rune', () => {
    const g = new Game();
    let middle = 0;
    for (let f = 0; f < FLOORS; f++) for (let seed = 1; seed < 60; seed++) {
      g.loadRoom({ seed, depth: f * LAYERS + LAYERS, floor: f, type: 'boss', heroes: 1 + (seed % 3) });
      const L = g.S, area = L.floor.reduce((a, b) => a + b, 0), boss = L.mobs.find(m => MOBS[m.k].boss)!;
      // a rectangle bigger than any room before it: the last fight rows are 15 × 12 at the most
      expect(area).toBe(L.gw * L.gh);
      expect(area).toBeGreaterThan(15 * 12);
      expect(L.blocks.length).toBeGreaterThanOrEqual(2);
      // the swarm's burrows aside, a hole at the most
      expect(L.pits.length).toBeLessThanOrEqual(boss.k === 'ratswarm' ? 3 : 1);
      if ([...L.haz].some(k => { const [i, j] = k.split(',').map(Number); return Math.abs((i + 0.5) / L.gw + (j + 0.5) / L.gh - 1) < 0.2; })) middle++;
      expect((L.mobs.length + L.blocks.length + L.pits.length + L.haz.size + L.nodes.length) / area).toBeLessThan(0.2);
      for (const p of L.pads) expect(g.route(boss, p, false)).not.toBeNull();
    }
    // hazards lie across the middle of the room too, not only along its walls
    expect(middle).toBeGreaterThan(FLOORS * 59 * 0.6);
  });

  it('hits harder on later floors and in the last rooms before the boss', () => {
    expect(room(0, 0, 3).dmgAdd).toBe(0);
    expect(room(0, REST_ROW - 1, 3).dmgAdd).toBe(1);
    expect(room(1, 0, 3).dmgAdd).toBe(2);
    expect(room(2, 0, 3).dmgAdd).toBe(3);
  });
});

describe('holes in the floor', () => {
  /** Rooms from the second half of every floor, where the holes are. */
  const rooms = Array.from({ length: 300 }, (_, k) => {
    const f = k % FLOORS, row = 2 + (k % (LAYERS - 3));
    return generate({ seed: 500 + k, depth: f * LAYERS + row + 1, floor: f, type: k % 5 ? 'fight' : 'elite' });
  });
  const inHole = (L: Layout, i: number, j: number) => L.pits.some(p => inPit(p, i, j));
  /** A shape's cells moved so its top-left corner is at 0, 0, in reading order, to compare shapes however they lie. */
  const norm = (cells: [number, number][]) => {
    const a0 = Math.min(...cells.map(c => c[0])), b0 = Math.min(...cells.map(c => c[1]));
    return cells.map(([a, b]) => [a - a0, b - b0]).sort((p, q) => p[1] - q[1] || p[0] - q[0]).join(';');
  };

  it('comes in squares, strips, a 2 × 3 and Г shapes, turned every way, each hole in a room a different shape', () => {
    expect(new Set(rooms.flatMap(L => L.pits.map(p => p.k)))).toEqual(new Set(PIT_KINDS));
    const ways = (k: string) => new Set(rooms.flatMap(L => L.pits.filter(p => p.k === k).map(p => norm(p.cells)))).size;
    expect(ways('L3')).toBe(4);
    expect(ways('3x1')).toBe(2);
    expect(ways('2x3')).toBe(2);
    for (const L of rooms) {
      const kinds = L.pits.map(p => p.k);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(L.pits.reduce((n, p) => n + p.cells.length, 0)).toBeLessThanOrEqual(PIT_CELLS);
      for (const p of L.pits) {
        expect(p.cells).toHaveLength(PIT_SHAPES[p.k].length);
        // the cells hang together
        const seen = new Set([0]);
        for (let grew = true; grew;) {
          grew = false;
          p.cells.forEach(([i, j], k) => {
            if (!seen.has(k) && p.cells.some(([a, b], m) => seen.has(m) && Math.abs(a - i) + Math.abs(b - j) === 1)) { seen.add(k); grew = true; }
          });
        }
        expect(seen.size).toBe(p.cells.length);
      }
    }
    // the first rows get only small ones, the boss small enough for it to walk round
    for (let seed = 1; seed < 40; seed++) {
      expect(generate({ seed, depth: 3, floor: 0, type: 'fight' }).pits.every(p => p.cells.length <= 2)).toBe(true);
      expect(generate({ seed, depth: LAYERS, floor: 0, type: 'boss' }).pits.every(p => p.cells.length <= 4)).toBe(true);
    }
  });

  it('opens on plain floor with a ring of floor around it, and nothing stands in it', () => {
    for (const L of rooms) for (const p of L.pits) {
      for (const [i, j] of p.cells) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        expect(isFloor(L, i + a, j + b)).toBe(true);
        expect(L.pads.some(q => Math.floor(q.x / TILE) === i + a && Math.floor(q.y / TILE) === j + b)).toBe(false);
      }
      for (const b of L.blocks) expect(inHole(L, b.x0 / TILE, b.y0 / TILE)).toBe(false);
      for (const o of [...L.mobs, ...L.nodes, ...L.decals]) expect(pitAt(L.pits, o.x, o.y)).toBeUndefined();
      for (const [i, j] of p.cells) expect(L.haz.has(hazKey(i, j))).toBe(false);
    }
  });

  it('never cuts the floor in two, for small walkers or for big 2 × 2 ones', () => {
    /** Pieces of floor an s × s walker can cross, with or without the holes cut out. */
    const pieces = (L: Layout, s: number, holes: boolean) => {
      const fits = (i: number, j: number) => {
        for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) if (!isFloor(L, i + a, j + b) || (holes && inHole(L, i + a, j + b))) return false;
        return true;
      };
      const seen = new Set<number>();
      let n = 0;
      for (let k = 0; k < L.gw * L.gh; k++) {
        if (seen.has(k) || !fits(k % L.gw, Math.floor(k / L.gw))) continue;
        n++;
        for (const stack = [k]; stack.length;) {
          const c = stack.pop()!, i = c % L.gw, j = (c - i) / L.gw;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = (j + dj) * L.gw + i + di;
            if (!seen.has(nk) && fits(i + di, j + dj)) { seen.add(nk); stack.push(nk); }
          }
        }
      }
      return n;
    };
    for (const L of rooms) {
      expect(pieces(L, 1, true)).toBe(1);
      expect(pieces(L, 2, true)).toBeLessThanOrEqual(pieces(L, 2, false));
    }
  });

  it('swallows a disc whose centre rolls over its edge, and the thrower gets hurt', () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('skel', cellCentre(1, 1).x, cellCentre(1, 1).y)];
    g.S.nodes = []; g.S.blocks = [];
    // a small Г: cells (4, 3), (5, 3) and (4, 4), with floor in the notch at (5, 4)
    g.S.pits = [{ k: 'L3', cells: [[4, 3], [5, 3], [4, 4]] }];
    placeAll(g); g.startFight();
    const h = g.party[0], hp = h.hp;
    const roll = (x: number, y: number, vx: number) => {
      g.S.discs = [];
      const d = { hero: h, x, y, vx, vy: 0, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0 };
      g.S.discs = [d];
      for (let k = 0; k < 120 && !d.fall; k++) g.step(1 / 120);
      return d;
    };
    // skimming past the top edge, centre outside the hole: rolls on
    expect(roll(TILE, 3 * TILE - 1, 300).fall).toBe(0);
    const d = roll(2 * TILE, 3.5 * TILE, 300);
    expect(d.fall).toBeGreaterThan(0);
    expect(d.x).toBeGreaterThan(4 * TILE);
    expect(d.x).toBeLessThan(4 * TILE + 4);
    expect(h.hp).toBe(hp - 2);
    // in from the right along the lower row: over the notch, which is floor, then down at the edge of (4, 4)
    const e = roll(8 * TILE, 4.5 * TILE, -300);
    expect(e.fall).toBeGreaterThan(0);
    expect(e.x).toBeLessThan(5 * TILE);
    expect(e.x).toBeGreaterThan(5 * TILE - 4);
  });
});

describe('hero health', () => {
  it('starts each hero with its own health: the tank the most, Ricochet the least', () => {
    const [bastion, ricochet, ash] = newParty();
    for (const h of [bastion, ricochet, ash]) expect([h.hp, h.max]).toEqual([h.def.hp, h.def.hp]);
    expect(bastion.max).toBeGreaterThan(ash.max);
    expect(ash.max).toBeGreaterThan(ricochet.max);
  });

  const beat = (type: 'boss' | 'fight', hp: (h: HeroState) => number) => {
    const g = new Game();
    g.party = newParty([0, 1, 2]);
    g.loadRoom({ seed: 7, depth: type === 'boss' ? LAYERS : 3, floor: 0, type });
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = hp(h);
    let won: boolean | null = null;
    g.onRoomEnd = w => { won = w; };
    for (const m of g.S.mobs) m.hp = 0;
    g.update(1 / 60);
    expect(won).toBe(true);
    return g.party;
  };

  it('gives every hero back half their most health when the floor boss falls; the fallen get up with half', () => {
    const [bastion, ricochet, ash] = beat('boss', h => (h.i === 0 ? 4 : h.i === 1 ? -3 : h.max - 2));
    expect(bastion.hp).toBe(4 + Math.ceil(bastion.max * BOSS_HEAL));
    expect(ricochet.hp).toBe(Math.ceil(ricochet.max * BOSS_HEAL));
    // never above the top
    expect(ash.hp).toBe(ash.max);
  });

  it('heals nobody after a plain fight', () => {
    expect(beat('fight', h => (h.i === 1 ? 0 : 5)).map(h => h.hp)).toEqual([5, 0, 5]);
  });

  it('gets a hero who fell in a won fight up with 1 HP as the next room begins, ready to be put on a rune and throw', () => {
    const g = new Game();
    g.party = newParty([0, 1, 2]);
    g.loadRoom({ seed: 7, depth: 3, floor: 0, type: 'fight' });
    g.party[1].hp = -4;
    g.party[2].hp = 0;
    g.loadRoom({ seed: 8, depth: 4, floor: 0, type: 'fight' });
    expect(RISE_HP).toBe(1);
    expect(g.party.map(h => h.hp)).toEqual([g.party[0].max, RISE_HP, RISE_HP]);
    expect(g.alive()).toHaveLength(3);
    expect(g.party.every(h => h.hand === HAND_START)).toBe(true);
    placeAll(g);
    expect(g.S.heroes.every(h => h.pad !== null)).toBe(true);
  });
});

describe('party size', () => {
  const kinds = ['fight', 'elite', 'treasure', 'boss'] as const;
  const specs = Array.from({ length: 120 }, (_, k) => {
    const f = k % FLOORS, type = kinds[k % kinds.length];
    return { seed: 300 + k, depth: f * LAYERS + (type === 'boss' ? LAYERS : 1 + (k % (LAYERS - 1))), floor: f, type };
  });
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

  it('builds rooms for three heroes unless told otherwise', () => {
    for (const spec of specs.slice(0, 20)) {
      const a = generate(spec), b = generate({ ...spec, heroes: 3 });
      expect(JSON.stringify({ ...a, haz: [...a.haz] })).toBe(JSON.stringify({ ...b, haz: [...b.haz] }));
    }
  });

  it('gives a smaller party fewer, weaker enemies and leaner ore veins, never an empty room', () => {
    const at = (heroes: number) => specs.map(spec => generate({ ...spec, heroes }));
    const [one, two, three] = [at(1), at(2), at(3)];
    const count = (rs: typeof one) => sum(rs.map(L => L.mobs.length));
    const hp = (rs: typeof one) => sum(rs.map(L => sum(L.mobs.map(m => m.max))));
    const dmg = (rs: typeof one) => sum(rs.map(L => sum(L.mobs.map(m => m.dmg))));
    expect(count(one)).toBeLessThan(count(two));
    expect(count(two)).toBeLessThan(count(three));
    expect(hp(one)).toBeLessThan(hp(two));
    expect(dmg(one)).toBeLessThan(dmg(two));
    one.forEach((L, k) => {
      // the ore cave has no enemies and the same veins for any party (see its own tests)
      if (specs[k].type === 'treasure') return;
      expect(L.mobs.length).toBeGreaterThan(0);
      expect(L.mobs.length).toBeLessThanOrEqual(three[k].mobs.length);
      // the boss and the elite stay whatever the party
      if (specs[k].type === 'boss') expect(L.mobs.filter(m => MOBS[m.k].boss)).toHaveLength(1);
      for (const n of L.nodes) expect(n.left).toBe(PARTY_SCALE[1].ch[n.k] ?? n.ch);
    });
    expect(sum(one.map(L => sum(L.nodes.filter(n => n.k === 'ore').map(n => n.left))))).toBeLessThan(sum(three.map(L => sum(L.nodes.filter(n => n.k === 'ore').map(n => n.left)))));
    // every hero buys their own upgrades, and the blacksmith's gift, the cave and the events pay the same to any party,
    // so a bigger party's veins hold more than a lone hero's for every hero
    for (const heroes of [2, 3]) expect(PARTY_SCALE[heroes].ch.ore! / heroes).toBeGreaterThan(PARTY_SCALE[1].ch.ore!);
  });

  it('gives a bigger party more mushroom patches, apart from each other, and as many heals for every hero', () => {
    const heals = (heroes: number) => PARTY_SCALE[heroes].herbs * (PARTY_SCALE[heroes].ch.herb ?? NODES.herb.ch);
    for (const heroes of [1, 2, 3]) {
      expect(heals(heroes) / heroes).toBe(heals(1));
      for (const spec of specs) {
        // the ore cave keeps its two patches for any party (see its own tests)
        if (spec.type === 'treasure') continue;
        const herbs = generate({ ...spec, heroes }).nodes.filter(n => n.k === 'herb');
        expect(herbs).toHaveLength(PARTY_SCALE[heroes].herbs);
        expect(sum(herbs.map(n => n.left))).toBe(heals(heroes));
        for (const [k, a] of herbs.entries()) for (const b of herbs.slice(k + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4 * TILE);
      }
    }
  });

  it('builds each room for the party that enters it, and the summoners raise fewer mobs for a lone hero', () => {
    const g = new Game();
    g.party = newParty([1]);
    g.loadRoom({ seed: 99, depth: LAYERS * 2, floor: 1, type: 'boss' });
    expect(g.S.spec.heroes).toBe(1);
    expect(g.S.mobs).toEqual(generate({ seed: 99, depth: LAYERS * 2, floor: 1, type: 'boss', heroes: 1 }).mobs);
    g.S.mobs = [newMob('lich', 120, 40, 1, 0)];
    placeAll(g); g.startFight();
    // the lich summons on its second turn: a party of three faces two ghouls, a lone hero one
    endAll(g);
    for (let k = 0; k < 900 && g.S.turn === 1; k++) g.update(1 / 60);
    expect(g.S.turn).toBe(2);
    expect(g.S.mobs[0].intent!.t).toBe('summon');
    expect(g.S.mobs[0].intent!.spots).toHaveLength(1);
  });
});

describe('camera', () => {
  it('maps world to screen and back at any rotation', () => {
    const cam = new Camera();
    cam.cx = 100; cam.cy = 80; cam.zoom = 2.3; cam.panX = 400; cam.panY = 300;
    for (const rot of [0, 0.4, Math.PI / 4, 2, 4.5]) {
      cam.setRot(rot);
      const [ix, iy] = cam.iso(37, 141);
      const [sx, sy] = cam.isoToScreen(ix, iy);
      const [wx, wy] = cam.screenToWorld(sx, sy);
      expect(wx).toBeCloseTo(37, 6);
      expect(wy).toBeCloseTo(141, 6);
    }
  });

  it('keeps the point under the cursor fixed while zooming and rotating', () => {
    const cam = new Camera();
    cam.cx = 100; cam.cy = 88; cam.zoom = 2; cam.panX = 600; cam.panY = 400;
    const before = cam.screenToWorld(500, 420);
    cam.zoomAt(1.7, 500, 420);
    cam.rotateAt(1.1, 500, 420);
    const after = cam.screenToWorld(500, 420);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  const Wx = 200, Wy = 176, wallH = 34, rect = { x: 10, y: 60, w: 1180, h: 730 };
  /** The room's box on screen, walls included, as the camera fits it. */
  const onScreen = (cam: Camera) => {
    const xs: number[] = [], ys: number[] = [];
    for (const [x, y] of [[0, 0], [Wx, 0], [Wx, Wy], [0, Wy]]) for (const h of [-10, wallH + 6]) {
      const [sx, sy] = cam.isoToScreen(...cam.iso(x, y, h));
      xs.push(sx); ys.push(sy);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const size = (b: ReturnType<typeof onScreen>) => Math.max((b.x1 - b.x0) / rect.w, (b.y1 - b.y0) / rect.h);
  /** The floor's corners on screen. */
  const floor = (cam: Camera): Vec[] => [[0, 0], [Wx, 0], [Wx, Wy], [0, Wy]].map(([x, y]) => cam.isoToScreen(...cam.iso(x, y)));
  /** How far apart two convex polygons are along the axis that parts them best: 0 or less when they overlap. */
  const gap = (P: Vec[], Q: Vec[]) => {
    let g = -Infinity;
    for (const S of [P, Q]) for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length], nx = b[1] - a[1], ny = a[0] - b[0], L = Math.hypot(nx, ny);
      const p = P.map(v => (v[0] * nx + v[1] * ny) / L), q = Q.map(v => (v[0] * nx + v[1] * ny) / L);
      g = Math.max(g, Math.min(...q) - Math.max(...p), Math.min(...p) - Math.max(...q));
    }
    return g;
  };
  /** The screen area shrunk by the depth the floor has to reach into it. */
  const m = Math.min(rect.w, rect.h) * KEEP;
  const inner: Vec[] = [[rect.x + m, rect.y + m], [rect.x + rect.w - m, rect.y + m], [rect.x + rect.w - m, rect.y + rect.h - m], [rect.x + m, rect.y + rect.h - m]];
  /** Never smaller than fitting the screen, and some of the floor still reaches KEEP into the area. */
  const held = (cam: Camera) => {
    expect(gap(floor(cam), inner)).toBeLessThan(1e-6);
    expect(size(onScreen(cam))).toBeGreaterThan(FIT - 1e-6);
  };

  it('fits the room with a margin, centred, never lets it shrink below that, and lets it be dragged', () => {
    const cam = new Camera();
    cam.fit(Wx, Wy, wallH, rect);
    held(cam);
    const b = onScreen(cam);
    expect(size(b)).toBeCloseTo(FIT, 6);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(rect.x + rect.w / 2, 6);
    expect((b.y0 + b.y1) / 2).toBeCloseTo(rect.y + rect.h / 2, 6);
    const z = cam.zoom;
    cam.zoomAt(0.5, 100, 700);
    expect(cam.zoom).toBeCloseTo(z, 9);
    expect(onScreen(cam)).toEqual(b);
    // zoomed all the way out the room still moves with the finger
    const [px, py] = [cam.panX, cam.panY];
    cam.panBy(400, -300);
    expect(cam.panX).toBeCloseTo(px + 400, 9);
    expect(cam.panY).toBeCloseTo(py - 300, 9);
    // turned, the room still just fits
    for (const rot of [0.3, Math.PI / 4, 2, 4]) {
      cam.rotateAt(rot, 300, 300);
      held(cam);
      expect(size(onScreen(cam))).toBeCloseTo(FIT, 6);
    }
  });

  it('lets the room be dragged nearly off the screen, but a piece of the floor always stays', () => {
    for (const rot of [0, 0.5, Math.PI / 4, 3]) for (const k of [1, 2.5, 100]) {
      for (const [dx, dy] of [[9000, 0], [0, 9000], [-9000, -9000], [9000, -9000], [-9000, 0], [0, -9000]]) {
        const cam = new Camera();
        cam.setRot(rot);
        cam.fit(Wx, Wy, wallH, rect);
        cam.zoomAt(k, 600, 400);
        cam.panBy(dx, dy);
        held(cam);
        // dragged as far as it goes: the floor just reaches KEEP in, and its middle is off the screen
        expect(gap(floor(cam), inner)).toBeGreaterThan(-1e-6);
        const [cx, cy] = cam.isoToScreen(...cam.iso(Wx / 2, Wy / 2));
        expect(cx < rect.x || cx > rect.x + rect.w || cy < rect.y || cy > rect.y + rect.h).toBe(true);
        // back from the edge, the first pixels of a drag move the room again
        const [px, py] = [cam.panX, cam.panY];
        cam.panBy(-Math.sign(dx) * 3, -Math.sign(dy) * 3);
        expect(cam.panX).toBeCloseTo(px - Math.sign(dx) * 3, 9);
        expect(cam.panY).toBeCloseTo(py - Math.sign(dy) * 3, 9);
      }
    }
  });

  it('turns a room dragged aside about its point nearest to the turn, not round the screen', () => {
    const cam = new Camera();
    cam.fit(Wx, Wy, wallH, rect);
    cam.zoomAt(2, 600, 425);
    cam.panBy(1300, 0);
    const [wx, wy] = cam.screenToWorld(600, 425);
    expect(wx < 0 || wx > Wx || wy < 0 || wy > Wy).toBe(true);
    const p = [Math.min(Wx, Math.max(0, wx)), Math.min(Wy, Math.max(0, wy))] as const;
    const before = cam.isoToScreen(...cam.iso(...p));
    cam.rotateAt(cam.rot + 0.3, 600, 425);
    held(cam);
    const after = cam.isoToScreen(...cam.iso(...p));
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('holds the room on screen through any mix of drags, zooms and turns, without jumps', () => {
    const cam = new Camera(), R = makeRng(4242);
    cam.fit(Wx, Wy, wallH, rect);
    for (let k = 0; k < 400; k++) {
      const big = k % 50 === 0, x = R.int(0, 1200), y = R.int(0, 800), [wx, wy] = cam.screenToWorld(x, y), op = R.int(0, 3);
      if (op === 0) cam.panBy((R.next() - 0.5) * (big ? 4000 : 10), (R.next() - 0.5) * (big ? 4000 : 10));
      else if (op === 1) cam.zoomAt(big ? 6 : 1 + (R.next() - 0.5) * 0.04, x, y);
      else if (op === 2) cam.rotateAt(cam.rot + (R.next() - 0.5) * (big ? 3 : 0.03), x, y);
      else cam.pinWorld(R.int(0, Wx), R.int(0, Wy), x, y);
      held(cam);
      // a small step moves the floor under the finger only a little, even where the room's edge holds it back
      if (!big && op < 3) {
        const [sx, sy] = cam.isoToScreen(...cam.iso(wx, wy));
        expect(Math.hypot(sx - x, sy - y)).toBeLessThan(25);
      }
    }
  });
});

describe('run map', () => {
  it('has 8 rows, 4 or 5 fights on every route, a camp and a blacksmith\'s before the boss, every room reachable and no paths crossing', () => {
    for (let seed = 10000; seed < 10200; seed++) {
      for (let f = 0; f < FLOORS; f++) {
        const layers = genFloor(seed, f), by = new Map(layers.flat().map(n => [n.id, n]));
        expect(layers).toHaveLength(LAYERS);
        expect(floorOk(layers)).toBe(true);
        for (const r of routes(layers)) {
          const fights = r.filter(n => isFight(n.type)).length;
          expect(fights).toBeGreaterThanOrEqual(FIGHTS[0]);
          expect(fights).toBeLessThanOrEqual(FIGHTS[1]);
          expect(r.filter(n => n.type === 'elite').length).toBeLessThanOrEqual(ELITES.path);
        }
        expect(layers[0].every(n => n.type === 'fight')).toBe(true);
        // the rest row: a camp and a blacksmith's, and a route comes to just one of them
        expect(layers[REST_ROW].map(n => n.type).sort()).toEqual(['camp', 'forge']);
        expect(layers[REST_ROW - 1].every(n => n.next.length === 1)).toBe(true);
        // discs are upgraded only at the blacksmith's, so every entrance has a route through one by the middle of the floor
        expect(layers[0].every(e => routes(layers).some(r => r[0] === e && r.some(n => n.type === 'forge' && FORGE_ROWS.includes(n.l))))).toBe(true);
        expect(layers[LAYERS - 1][0].type).toBe('boss');
        expect(layers.flat().filter(n => n.type === 'elite').length).toBeGreaterThanOrEqual(ELITES.floor);
        for (const n of layers.flat()) {
          const kids = n.next.map(id => by.get(id)!);
          // a fork is a choice between two different rooms
          if (kids.length === 2) expect(kids[0].type).not.toBe(kids[1].type);
          if (n.type !== 'fight') expect(kids.some(k => k.type === n.type)).toBe(false);
        }
        for (let l = 1; l < LAYERS; l++) {
          for (const n of layers[l]) expect(layers[l - 1].some(p => p.next.includes(n.id))).toBe(true);
          // rooms stand in a row by index, so two links cross when their ends go opposite ways
          const links = layers[l - 1].flatMap(a => a.next.map(id => [a.i, by.get(id)!.i]));
          expect(links.some(([i, j]) => links.some(([p, q]) => i < p && j > q))).toBe(false);
        }
      }
    }
  });

  it('starts a run on the first floor with empty paths', () => {
    const run = newRun(12345);
    expect(run.floor).toBe(0);
    expect(run.path.every(p => p.length === 0)).toBe(true);
  });

  it('moves an online party on only once every player here points at the same room', () => {
    expect(agreed({}, [0, 2])).toBeNull();
    expect(agreed({ 0: '0-0-1' }, [0, 2])).toBeNull();
    expect(agreed({ 0: '0-0-1', 2: '0-0-0' }, [0, 2])).toBeNull();
    expect(agreed({ 0: '0-0-1', 2: '0-0-1' }, [0, 2])).toBe('0-0-1');
    // a player who left has no say: the host plays their hero
    expect(agreed({ 0: '0-0-1' }, [0])).toBe('0-0-1');
    expect(agreed({ 0: '0-0-1', 1: '0-0-0' }, [0])).toBe('0-0-1');
  });
});

describe('map events', () => {
  it('gives every event a scene and two to four choices, a toss-up always with its bad side', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(EVENTS.map(e => e.key)).size).toBe(EVENTS.length);
    for (const e of EVENTS) {
      expect(e.txt.length).toBeGreaterThan(40);
      expect(e.choices.length).toBeGreaterThanOrEqual(2);
      expect(e.choices.length).toBeLessThanOrEqual(4);
      for (const c of e.choices) {
        expect(c.win.txt.length).toBeGreaterThan(10);
        if (c.odds) expect(c.lose?.txt.length).toBeGreaterThan(10);
      }
    }
    // there is something to win and something to lose
    const all = EVENTS.flatMap(e => e.choices.flatMap(c => [c.win, c.lose].filter(o => o).flatMap(o => fxParts(o!.fx, false))));
    expect(all.some(p => p.good) && all.some(p => !p.good)).toBe(true);
  });

  it('shows a run every event once before any comes back, the same on every screen', () => {
    const seen: string[] = [];
    for (let k = 0; k < EVENTS.length; k++) seen.push(eventOf(1000 + k * 131, seen));
    expect(new Set(seen).size).toBe(EVENTS.length);
    expect(eventOf(77, ['bar'])).toBe(eventOf(77, ['bar']));
    expect(EVENTS.map(e => e.key)).toContain(eventOf(5, seen));
  });

  it('rolls a toss-up from the room seed: the same each time, about as often as it says', () => {
    const c = eventDef('bar').choices[0];
    expect(rolled(c, 4242, 0)).toBe(rolled(c, 4242, 0));
    let wins = 0;
    for (let s = 0; s < 400; s++) if (rolled(c, s, 0)) wins++;
    expect(wins).toBeGreaterThan(150);
    expect(wins).toBeLessThan(250);
    // a sure thing always comes out the same way
    expect(rolled(eventDef('bar').choices[1], 9, 1)).toBe(true);
  });

  it('shuts a choice the party cannot pay for', () => {
    const c = eventDef('doctor').choices[1];
    expect(c.pay).toBe(4);
    expect(canPick(c, { ore: 3 })).toBe(false);
    expect(canPick(c, { ore: 4 })).toBe(true);
  });

  it('never kills with an event, keeps the fallen down unless it heals them, and keeps the ore at zero or more', () => {
    const party = newParty(), bank = { ore: 2 };
    party[0].hp = 3;
    party[1].hp = 0;
    applyFx([{ k: 'hp', n: -8 }, { k: 'ore', n: -5 }], party, bank, 1);
    expect(party[0].hp).toBe(1);
    expect(party[1].hp).toBe(0);
    expect(party[2].hp).toBe(party[2].max - 8);
    expect(bank.ore).toBe(0);
    applyFx([{ k: 'hp', n: 30 }], party, bank, 1);
    expect(party[1].hp).toBe(0);
    expect(party[2].hp).toBe(party[2].max);
    applyFx([{ k: 'heal' }], party, bank, 1);
    expect(party.every(h => h.hp === h.max)).toBe(true);
  });

  it('moves the top of health and the health under it together', () => {
    const party = newParty([2]), h = party[0], top = h.max;
    applyFx([{ k: 'max', n: 4 }], party, { ore: 0 }, 1);
    expect([h.max, h.hp]).toEqual([top + 4, top + 4]);
    applyFx([{ k: 'max', n: -6 }], party, { ore: 0 }, 1);
    expect([h.max, h.hp]).toEqual([top - 2, top - 2]);
  });

  it('hands out a free level or a disc only while there is one to have', () => {
    const party = newParty([0]), h = party[0];
    applyFx([{ k: 'up', stat: 'm' }], party, { ore: 0 }, 1);
    expect(h.up.m).toBe(1);
    h.up = { m: UP_COST.length, pw: UP_COST.length, e: 0 };
    applyFx([{ k: 'up' }], party, { ore: 0 }, 7);
    expect(h.up).toEqual({ m: UP_COST.length, pw: UP_COST.length, e: 1 });
    applyFx([{ k: 'up', stat: 'm' }], party, { ore: 0 }, 7);
    expect(h.up.m).toBe(UP_COST.length);
    h.discs = HAND_MAX - 1;
    applyFx([{ k: 'disc' }, { k: 'disc' }], party, { ore: 0 }, 1);
    expect(h.discs).toBe(HAND_MAX);
  });

  it('«Влюблённый сундук» can give a trophy, shared out in its own window afterwards', () => {
    const hand = eventDef('mimic').choices.find(c => c.win.fx.some(f => f.k === 'art'))!;
    expect(hand.odds).toBe(0.5);
    const party = newParty([0, 1]), bank = { ore: 3 }, before = JSON.stringify(party);
    applyFx(hand.win.fx, party, bank, 1);
    expect(JSON.stringify(party)).toBe(before);
    expect(bank.ore).toBe(3);
    expect(fxParts(hand.win.fx, true)[0]).toEqual({ t: 'Трофей: один из трёх на выбор', good: true });
  });

  it('leaves its shield and its curse for the next fight only', () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    const plain = g.S.mobs.map(m => m.dmg);
    applyFx([{ k: 'shield', n: 6 }, { k: 'rage', n: 1 }], g.party, g.bank, 1);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.party.map(h => h.shield)).toEqual([6, 6, 6]);
    expect(g.S.mobs.map(m => m.dmg)).toEqual(plain.map(d => d + 1));
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.party.map(h => h.shield)).toEqual([0, 0, 0]);
    expect(g.S.mobs.map(m => m.dmg)).toEqual(plain);
  });

  it('lays the smoke and the strobe on the next fight only, where every screen gets them with the room', () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    applyFx([{ k: 'smoke' }, { k: 'strobe' }], g.party, g.bank, 1);
    expect(g.bank).toMatchObject({ smoke: true, strobe: true });
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec).toMatchObject({ smoke: true, strobe: true });
    expect(g.bank.smoke).toBeUndefined();
    expect(g.bank.strobe).toBeUndefined();
    // a client rebuilds the room from the host's snapshot, curse and all
    const c = new Game();
    c.loadRoom({ seed: 1, depth: 1, floor: 0, type: 'fight' });
    applySnapshot(c, snapshot(g));
    expect(c.S.spec).toMatchObject({ smoke: true, strobe: true });
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.smoke).toBeUndefined();
    expect(g.S.spec.strobe).toBeUndefined();
  });

  it('says what a choice does for a lone hero or for each hero of a party', () => {
    expect(fxParts([{ k: 'hp', n: -5 }], true)).toEqual([{ t: '−5 HP', good: false }]);
    expect(fxParts([{ k: 'hp', n: 10 }], false)).toEqual([{ t: '+10 HP каждому', good: true }]);
    expect(fxParts([{ k: 'ore', n: 8 }], false)).toEqual([{ t: '+8 руды', good: true }]);
    expect(fxParts([{ k: 'smoke' }, { k: 'strobe' }], true)).toEqual([
      { t: 'Дым-машина: следующий бой в дыму', good: false },
      { t: 'Стробоскоп: следующий бой без прицела', good: false },
    ]);
  });

  it('takes an event choice online only once everyone here points at the same one', () => {
    expect(agreed<number>({ 0: 0 }, [0, 2])).toBeNull();
    expect(agreed<number>({ 0: 0, 2: 1 }, [0, 2])).toBeNull();
    expect(agreed<number>({ 0: 0, 2: 0 }, [0, 2])).toBe(0);
  });
});

describe('the second batch of events', () => {
  const at = (key: string, seed = 1000): EventState => ({ key, seed, votes: {} });
  const tbl = (party: HeroState[], ore = 0): Table => ({ party, bank: { ore } });
  const arts = (n: number, from = 0) => ARTIFACTS.slice(from, from + n).map(a => a.key) as string[];

  it('gives every new event its scene, choices with outcomes, and keeps no two events alike in key', () => {
    for (const k of ['slot', 'sphinx', 'gnome', 'bookie', 'pawn', 'mapper', 'foam', 'bottle', 'thimble', 'tattoo', 'gopnik', 'husband']) {
      const e = eventDef(k);
      expect(e.key).toBe(k);
      expect(e.txt.length).toBeGreaterThan(80);
    }
    expect(EVENTS.length).toBe(22);
  });

  it('«Жадная Люська» puts a rung in the bank on every pull that comes off, and a bust burns it', () => {
    // find a seed whose first two pulls come off and the third busts
    let seed = 0;
    const tries = (s: number) => [0, 1, 2].map(n => makeRng(s * 31 + n * 7919 + 101).next() < PULL_ODDS[n]);
    while (!(tries(seed)[0] && tries(seed)[1] && !tries(seed)[2])) seed++;
    const party = newParty([0, 1]), t = tbl(party), ev = at('slot', seed), hp = party.map(h => h.hp - 10);
    party.forEach((h, k) => (h.hp = hp[k]));
    expect(take(ev, 0, t)).toBe(true);
    expect([ev.pulls, ev.done]).toEqual([1, undefined]);
    // nothing is paid out until the bank is taken
    expect(party.map(h => h.hp)).toEqual(hp);
    expect(choicesOf(ev).map(c => c.label)).toEqual(['Дёрнуть ещё', 'Забрать банк']);
    take(ev, 0, t);
    expect(ev.pulls).toBe(2);
    take(ev, 0, t);
    expect(ev.done).toMatchObject({ opt: 0, won: false });
    expect(party.map(h => h.hp)).toEqual(hp.map(x => x - 4));
    expect(t.bank.boon ?? 0).toBe(0);
    // a bank taken after two pulls pays both rungs
    const ev2 = at('slot', seed), p2 = newParty([0]), t2 = tbl(p2);
    p2[0].hp -= 10;
    take(ev2, 0, t2); take(ev2, 0, t2); take(ev2, 1, t2);
    expect(p2[0].hp).toBe(p2[0].max - 4);
    expect(t2.bank.boon).toBe(AB_COST);
    expect(stageOf(ev2)).toBe('done');
  });

  it('pays the slot machine\'s jackpot as a trophy', () => {
    let seed = 0;
    while (![0, 1, 2, 3].every(n => makeRng(seed * 31 + n * 7919 + 101).next() < PULL_ODDS[n])) seed++;
    const party = newParty([2]), t = tbl(party), ev = at('slot', seed);
    for (let k = 0; k < 4; k++) take(ev, 0, t);
    expect(ev.done?.won).toBe(true);
    expect(doneOf(ev)!.out.fx.some(f => f.k === 'art')).toBe(true);
    // with all sockets taken the jackpot is still there to pull for: the new trophy replaces an old one
    const full = newParty([2]);
    full[0].arts = arts(SOCKETS);
    const ev2: EventState = { ...at('slot', seed), pulls: 3 };
    expect(shutWhy(choicesOf(ev2)[0], tbl(full))).toBeNull();
  });

  it('«Лысый Сфинкс» asks one of its riddles; the right answer is a level, a wrong one bites, «То самое» is safe', () => {
    const asked = new Set(Array.from({ length: 200 }, (_, s) => riddleOf(s).q));
    expect(asked.size).toBe(RIDDLES.length);
    const seed = 55, r = riddleOf(seed), cs = choicesOf(at('sphinx', seed));
    expect(cs.map(c => c.label)).toEqual([...r.answers, 'То самое']);
    expect(cs.every(c => c.blind)).toBe(true);
    const right = r.answers.indexOf(r.right), wrong = 1 - right;
    const p1 = newParty([0]), e1 = at('sphinx', seed);
    take(e1, right, tbl(p1));
    expect(Object.values(p1[0].up).reduce((a, b) => a + b)).toBe(1);
    const p2 = newParty([0]), e2 = at('sphinx', seed);
    take(e2, wrong, tbl(p2));
    expect(p2[0].hp).toBe(p2[0].max - 4);
    const p3 = newParty([0]), e3 = at('sphinx', seed);
    p3[0].hp -= 5;
    take(e3, 2, tbl(p3));
    expect(p3[0].hp).toBe(p3[0].max - 2);
  });

  it('«Застрявший гном» opens a choice only with a living hero of its kind in the party', () => {
    const cs = eventDef('gnome').choices;
    const fat = HEROES.findIndex(h => h.r === KINDS[0].r), slim = HEROES.findIndex(h => h.r === KINDS[2].r);
    expect(shutWhy(cs[0], tbl(newParty([slim])))).toBe('Толстяка в отряде нет');
    expect(shutWhy(cs[2], tbl(newParty([fat])))).toBe('Дрища в отряде нет');
    expect(shutWhy(cs[0], tbl(newParty([fat, slim])))).toBeNull();
    const party = newParty([fat, slim]);
    party[0].hp = 0;
    expect(shutWhy(cs[0], tbl(party))).toBe('Толстяка в отряде нет');
    expect(shutWhy(cs[3], tbl(party))).toBeNull();
  });

  it('«Букмекер» leaves its bet for the next fight (never the ore cave) and settles it as the fight is won', () => {
    const g = new Game();
    g.party = newParty([0, 1]);
    g.party[0].arts = arts(1);
    expect(shutWhy(eventDef('bookie').choices[0], tbl(newParty([0])))).toBe('У тебя нет трофеев');
    applyFx(eventDef('bookie').choices[0].win.fx, g.party, g.bank, 1);
    expect(g.bank.bet).toBe('art');
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'treasure' });
    expect(g.S.spec.bet).toBeUndefined();
    expect(g.bank.bet).toBe('art');
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.bet).toBe('art');
    expect(g.bank.bet).toBeUndefined();
    // won clean: a trophy for each, none the party has
    const party = newParty([0, 1]);
    party[0].arts = arts(1);
    const line = settleBet('art', true, party, 9);
    expect(party.map(h => h.arts!.length)).toEqual([2, 1]);
    expect(new Set(party.flatMap(h => h.arts!)).size).toBe(3);
    expect(line).toContain('Пари выиграно');
    // lost: each with a trophy loses one
    settleBet('art', false, party, 9);
    expect(party.map(h => h.arts!.length)).toEqual([1, 0]);
    // a level on three turns: one up for each, or one down (a hero with none pays with the top of its health)
    const p = newParty([0]), top = p[0].max;
    settleBet('up', true, p, 1);
    expect(Object.values(p[0].up).reduce((a, b) => a + b)).toBe(1);
    settleBet('up', false, p, 1);
    expect(Object.values(p[0].up).reduce((a, b) => a + b)).toBe(0);
    settleBet('up', false, p, 1);
    expect(p[0].max).toBe(top - 3);
  });

  it('«Ломбард» sells a trophy for SELL ore a hero and sells one for 20, each hero handing over its own', () => {
    const party = newParty([0, 1, 2]);
    party[0].arts = ['belly', ...arts(1, 2)];
    party[0].max += BELLY;
    party[1].arts = arts(1, 5);
    const top = party[0].max, t = tbl(party, 4), ev = at('pawn');
    expect(shutWhy(eventDef('pawn').choices[0], t)).toBe('Нужно 20 руды');
    expect(take(ev, 1, t)).toBe(true);
    expect(stageOf(ev)).toBe('sell');
    // hero 2 has nothing to hand over: the shop waits only for the first two
    expect(sellPick(ev, 0, 'belly' as ArtKey, t, [0, 1, 2])).toBe(true);
    expect(ev.done).toBeUndefined();
    sellPick(ev, 1, party[1].arts![0] as ArtKey, t, [0, 1, 2]);
    expect(stageOf(ev)).toBe('done');
    expect(t.bank.ore).toBe(4 + 2 * SELL);
    expect(party.map(h => h.arts!.length)).toEqual([1, 0, 0]);
    expect(party[0].max).toBe(top - BELLY);
    // online the shop doesn't wait for a player who dropped out
    const p2 = newParty([0, 1]);
    p2[0].arts = arts(1); p2[1].arts = arts(1, 3);
    const t2 = tbl(p2), e2 = at('pawn');
    take(e2, 1, t2);
    expect(sellDone(e2, t2, [0])).toBe(false);
    sellPick(e2, 0, p2[0].arts![0] as ArtKey, t2, [0]);
    expect(stageOf(e2)).toBe('done');
    expect(p2[1].arts).toHaveLength(1);
  });

  it('lets a hero with all sockets taken swap one of its trophies for a new one, or keep its own', () => {
    const party = newParty([0, 1]);
    party[0].arts = arts(SOCKETS);
    party[1].arts = arts(1, 3);
    // trophy choices stay open with every socket taken
    const t = tbl(party, 30);
    expect(shutWhy(eventDef('pawn').choices[0], t)).toBeNull();
    expect(shutWhy(eventDef('mimic').choices[0], t)).toBeNull();
    const loot = newLoot(5, 0, party), [a, b] = party.map(h => h.i);
    expect(loot.full).toEqual([a]);
    expect(lootFor(loot)).toBe(true);
    // the full hero's pick waits for the trophy of its own it throws away
    loot.picks[a] = 0;
    loot.picks[b] = 1;
    expect(lootAgreed(loot, [a, b])).toBe(false);
    const out = party[0].arts![1] as ArtKey;
    loot.drops = { [a]: out };
    expect(lootAgreed(loot, [a, b])).toBe(true);
    settleLoot(loot, party, [a, b]);
    expect(party[0].arts).toHaveLength(SOCKETS);
    expect(party[0].arts).not.toContain(out);
    expect(party[0].arts).toContain(loot.offer[0]);
    expect(party[1].arts).toEqual([...arts(1, 3), loot.offer[1]]);
    // or it keeps its own three
    const p2 = newParty([0, 1]);
    p2[0].arts = arts(SOCKETS);
    const l2 = newLoot(6, 0, p2), mine = [...p2[0].arts!];
    l2.picks[p2[0].i] = PASS;
    l2.picks[p2[1].i] = 0;
    expect(lootAgreed(l2, p2.map(h => h.i))).toBe(true);
    settleLoot(l2, p2, p2.map(h => h.i));
    expect(p2[0].arts).toEqual(mine);
    // a hero with room can't pass
    const l3 = newLoot(7, 0, p2.slice(1));
    l3.picks[p2[1].i] = PASS;
    expect(lootAgreed(l3, [p2[1].i])).toBe(false);
    // «Пивной живот» thrown away takes its health with it
    const p4 = newParty([0]);
    p4[0].arts = ['belly', ...arts(2, 5)];
    p4[0].max += BELLY;
    const top = p4[0].max, l4 = newLoot(8, 0, p4);
    l4.picks[p4[0].i] = l4.offer.findIndex(k => k !== 'belly');
    l4.drops = { [p4[0].i]: 'belly' };
    settleLoot(l4, p4, [p4[0].i]);
    expect(p4[0].max).toBe(top - BELLY + (p4[0].arts!.includes('belly') ? BELLY : 0));
  });

  it('«Пьяный картограф» redraws the floor ahead: a cave next, the elites gone, or a tunnel to the rest row', () => {
    const run = newRun(4242), f = 0, layers = run.floors[f];
    // stand in a room of the second row
    const here = layers[1][0];
    run.path[f].push(layers[0].find(n => n.next.includes(here.id))!.id, here.id);
    const t: Table = { party: newParty([0]), bank: { ore: 0 }, run };
    const tunnel = eventDef('mapper').choices[2];
    expect(shutWhy(tunnel, t)).toBeNull();
    applyFx(tunnel.win.fx, t.party, t.bank, 7, run);
    expect(reachable(run, f).map(id => nodeById(run, f, id).l)).toEqual([REST_ROW, REST_ROW]);
    expect(layers[REST_ROW].every(n => n.beer)).toBe(true);
    // the walk goes on through the rest row to the boss, and the run counts the floor as done
    run.path[f].push(layers[REST_ROW][0].id, layers[LAYERS - 1][0].id);
    expect(nodeById(run, f, run.path[f][run.path[f].length - 1]).type).toBe('boss');
    // next to the rest row there is no tunnel to dig
    const run2 = newRun(4242), l5 = run2.floors[0][REST_ROW - 1][0];
    run2.path[0].push(l5.id);
    expect(shutWhy(tunnel, { ...t, run: run2 })).toBe('Костёр и так за углом');
    // the elites ahead turn into plain fights
    const run3 = newRun(4242);
    run3.path[0].push(run3.floors[0][0][0].id);
    const elites = run3.floors[0].flat().filter(n => n.type === 'elite');
    expect(redrawn(run3, 'beer', 1).length).toBe(elites.length);
    applyFx([{ k: 'map', m: 'beer' }], t.party, t.bank, 1, run3);
    expect(run3.floors[0].flat().some(n => n.type === 'elite')).toBe(false);
    expect(shutWhy(eventDef('mapper').choices[1], { ...t, run: run3 })).toBe('Впереди нет элиты');
    // a room of the next row on the way becomes the ore cave
    const run4 = newRun(77);
    run4.path[0].push(run4.floors[0][0][0].id);
    const cave = redrawn(run4, 'cave', 3);
    applyFx([{ k: 'map', m: 'cave' }], t.party, t.bank, 3, run4);
    expect(cave).toHaveLength(1);
    expect(cave[0].type).toBe('treasure');
    expect(run4.floors[0][0][0].next).toContain(cave[0].id);
  });

  it('ends the run at the last boss even when the cartographer\'s tunnel skipped rows', () => {
    const run = newRun(5);
    const last = run.floors[FLOORS - 1];
    run.path[FLOORS - 1] = [last[0][0].id, last[REST_ROW][0].id];
    expect(runDone(run)).toBe(false);
    run.path[FLOORS - 1].push(last[LAYERS - 1][0].id);
    expect(runDone(run)).toBe(true);
  });

  it('«Пенная вечеринка» lays its floor on the next fight: slick discs, soap twice as far, sticky shorter', () => {
    const g = new Game();
    g.party = newParty([0]);
    applyFx([{ k: 'floor', f: 'soap' }], g.party, g.bank, 1);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.ground).toBe('soap');
    const h = g.party[0], fr = g.discFr(h);
    expect(fr).toBeCloseTo(h.def.fr * 0.5);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.S.spec.ground).toBeUndefined();
    expect(g.discFr(h)).toBeCloseTo(h.def.fr);
    applyFx([{ k: 'floor', f: 'slick' }], g.party, g.bank, 1);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(g.slickOf(h)).toBeGreaterThan(20);
    // the snapshot carries it to every screen
    const c = new Game();
    c.loadRoom({ seed: 1, depth: 1, floor: 0, type: 'fight' });
    applySnapshot(c, snapshot(g));
    expect(c.S.spec.ground).toBe('slick');
  });

  it('«Бутылочка» lands on one hero for a kiss or a punch, and a finger on it never lands on the punch', () => {
    const counts = [0, 0, 0, 0];
    for (let s = 0; s < 400; s++) {
      const party = newParty([0, 1, 2]), ev = at('bottle', s), t = tbl(party);
      take(ev, 0, t);
      counts[ev.done!.slice!]++;
      const s0 = BOTTLE[ev.done!.slice!];
      expect(ev.done!.who !== undefined).toBe(!!s0.one);
      const fixed = newParty([0, 1, 2]), e2 = at('bottle', s);
      take(e2, 1, tbl(fixed));
      expect(BOTTLE[e2.done!.slice!].name).not.toBe('Качок');
      expect(fixed.every(h => h.hp <= h.max - 2 || BOTTLE[e2.done!.slice!].name === 'На бутылку')).toBe(true);
    }
    for (const n of counts) expect(n).toBeGreaterThan(60);
    // the kiss goes to the hero it points at and nobody else
    let s = 0;
    while (true) { const ev = at('bottle', s), p = newParty([0, 1]); take(ev, 0, tbl(p)); if (BOTTLE[ev.done!.slice!].name === 'Жаба') break; s++; }
    const p = newParty([0, 1]), tops = p.map(h => h.max), ev = at('bottle', s);
    take(ev, 0, tbl(p));
    expect(p.filter((h, k) => h.max === tops[k] + 5).map(h => h.i)).toEqual([ev.done!.who]);
    expect(shown(doneOf(ev)!.out.txt)).toContain(HEROES[ev.done!.who!].acc);
  });

  it('«Наперсточник» shuffles the same on every screen and pays more the faster it goes', () => {
    expect(shuffleOf(9, 2)).toEqual(shuffleOf(9, 2));
    expect(CUPS.map(c => c.prize)).toEqual([...CUPS.map(c => c.prize)].sort((a, b) => a - b));
    for (let s = 0; s < 30; s++) {
      const sh = shuffleOf(s, 1);
      expect(sh.swaps).toHaveLength(CUPS[1].swaps);
      // the ball follows its cup through the swaps
      let ball = sh.start;
      for (const [a, b] of sh.swaps) ball = ball === a ? b : ball === b ? a : ball;
      expect(ball).toBe(sh.ball);
    }
    const party = newParty([0]), t = tbl(party, 5), ev = at('thimble', 31);
    take(ev, 2, t);
    expect([stageOf(ev), t.bank.ore]).toEqual(['cups', 2]);
    cupPick(ev, shuffleOf(31, 2).ball, t);
    expect(ev.done?.won).toBe(true);
    expect(t.bank.ore).toBe(2 + CUPS[2].prize);
    const e2 = at('thimble', 31), t2 = tbl(newParty([0]), 3);
    take(e2, 0, t2);
    cupPick(e2, (shuffleOf(31, 0).ball + 1) % 3, t2);
    expect([e2.done?.won, t2.bank.ore]).toEqual([false, 0]);
  });

  it('«Тату-салон» puts the tattoo on one hero: the party picks whom, a lone hero gets it at once', () => {
    const party = newParty([0, 1]), t = tbl(party), ev = at('tattoo');
    take(ev, 1, t);
    expect(stageOf(ev)).toBe('hero');
    expect(heroPick(ev, 1, t)).toBe(true);
    expect(party.map(h => h.up.m)).toEqual([0, 2]);
    const solo = newParty([2]), e2 = at('tattoo'), top = solo[0].max;
    take(e2, 0, tbl(solo));
    expect(stageOf(e2)).toBe('done');
    expect(solo[0].max).toBe(top + 8);
  });

  it('the bad events take ore, a trophy, health, sparks or a level', () => {
    const party = newParty([0, 1]), bank = { ore: 9 };
    party[0].arts = arts(2);
    party[0].sparks = 2;
    applyFx([{ k: 'rob' }], party, bank, 1);
    expect(bank.ore).toBe(4);
    applyFx([{ k: 'rob' }], party, bank, 1);
    expect(bank.ore).toBe(4 - ROB_MIN);
    expect(shutWhy(eventDef('gopnik').choices[0], tbl(party, 2))).toBe(`Нужно ${ROB_MIN} руды`);
    applyFx([{ k: 'unart' }], party, bank, 1);
    expect(party.map(h => h.arts!.length)).toEqual([1, 0]);
    applyFx([{ k: 'nosparks' }], party, bank, 1);
    expect(party[0].sparks).toBe(0);
    party[1].up.pw = 2;
    const top = party[0].max;
    applyFx([{ k: 'down' }], party, bank, 1);
    expect([party[0].max, party[1].up.pw]).toEqual([top - 3, 1]);
  });

  it('the guard\'s stolen discs give one more disc a turn in the next fight only', () => {
    const g = new Game();
    g.party = newParty([0]);
    const h = g.party[0], hand = g.handOf(h);
    applyFx([{ k: 'extra' }], g.party, g.bank, 1);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(h.hand).toBe(hand + 1);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    expect(h.hand).toBe(hand);
  });
});

describe('the camp', () => {
  const sit = (picks = [0, 1, 2]) => ({ party: newParty(picks), bank: newBank(), camp: { seed: 9001, did: {} } as CampState });

  it('digs 0 to 3 ore, the same on every screen, and each amount turns up', () => {
    expect(digOre(5150, 2)).toBe(digOre(5150, 2));
    const got = new Set<number>();
    for (let s = 0; s < 200; s++) for (let h = 0; h < 3; h++) {
      const n = digOre(s * 131, h);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(DIG_MAX);
      got.add(n);
    }
    expect([...got].sort()).toEqual([0, 1, 2, 3]);
  });

  it('lets every hero do one thing: rest, bandage a hurt teammate, or dig into the shared pool', () => {
    const { party, bank, camp } = sit();
    const [bastion, ricochet, ash] = party;
    bastion.hp = 10;
    ash.hp = ash.max - 3;
    expect(campDo(camp, bastion, { k: 'rest' }, party, bank)).toEqual({ k: 'rest', hp: CAMP_HEAL });
    expect(bastion.hp).toBe(10 + CAMP_HEAL);
    // one thing per camp
    expect(campDo(camp, bastion, { k: 'dig' }, party, bank)).toBeNull();
    // a bandage tops a teammate up to their most, no further
    expect(campDo(camp, ricochet, { k: 'mend', to: ash.i }, party, bank)).toEqual({ k: 'mend', to: ash.i, hp: 3 });
    expect(ash.hp).toBe(ash.max);
    const did = campDo(camp, ash, { k: 'dig' }, party, bank);
    expect(did).toEqual({ k: 'dig', ore: digOre(camp.seed, ash.i) });
    expect(bank.ore).toBe(digOre(camp.seed, ash.i));
  });

  it('gets the fallen up with half their health; they can do nothing else, and nobody bandages the healthy or himself', () => {
    const { party, bank, camp } = sit([0, 2]);
    const [bastion, ash] = party;
    ash.hp = 0;
    expect(canCamp(ash, { k: 'dig' }, party)).toBe(false);
    expect(canCamp(ash, { k: 'mend', to: bastion.i }, party)).toBe(false);
    expect(canCamp(bastion, { k: 'rest' }, party)).toBe(false);
    expect(canCamp(bastion, { k: 'mend', to: bastion.i }, party)).toBe(false);
    expect(campDo(camp, bastion, { k: 'mend', to: ash.i }, party, bank)).toEqual({ k: 'mend', to: ash.i, hp: Math.ceil(ash.max / 2) });
    expect(ash.hp).toBe(Math.ceil(ash.max / 2));
  });

  it('has a hero who did nothing (their player dropped out) rest when the party walks on', () => {
    const { party, bank, camp } = sit([0, 1]);
    party[1].hp = 5;
    campDo(camp, party[0], { k: 'dig' }, party, bank);
    campLeave(camp, party, bank);
    expect(party[1].hp).toBe(5 + CAMP_HEAL);
    expect(camp.did[party[0].i].k).toBe('dig');
  });
});

describe('boss trophies', () => {
  it('offers three different artifacts nobody in the party has, the same on every screen', () => {
    const party = newParty([0, 1, 2]);
    expect(rollOffer(4242, party)).toEqual(rollOffer(4242, party));
    for (let s = 0; s < 100; s++) {
      const offer = rollOffer(s * 977, party);
      expect(offer).toHaveLength(OFFER);
      expect(new Set(offer).size).toBe(OFFER);
    }
    party[0].arts = ARTIFACTS.slice(0, 10).map(a => a.key);
    party[2].arts = ARTIFACTS.slice(10, 20).map(a => a.key);
    for (let s = 0; s < 50; s++) for (const k of rollOffer(s, party)) expect(party.flatMap(h => h.arts!)).not.toContain(k);
    // every artifact turns up in some offer
    const seen = new Set(Array.from({ length: 300 }, (_, s) => rollOffer(s, [])).flat());
    expect(seen.size).toBe(ARTIFACTS.length);
  });

  it('gives a lone hero the one picked', () => {
    const party = newParty([1]), loot = newLoot(77, 0, party);
    loot.picks[party[0].i] = 2;
    expect(lootAgreed(loot, [party[0].i])).toBe(true);
    settleLoot(loot, party, [party[0].i]);
    expect(party[0].arts).toEqual([loot.offer[2]]);
    // once shared out it stays that way
    settleLoot(loot, party, [party[0].i]);
    expect(party[0].arts).toHaveLength(1);
  });

  it('online waits until every player here picks a different one; a duo leaves the third behind', () => {
    const party = newParty([0, 2]), loot = newLoot(78, 1, party), table = party.map(h => h.i);
    loot.picks[0] = 1;
    expect(lootAgreed(loot, table)).toBe(false);
    loot.picks[2] = 1;
    expect(lootAgreed(loot, table)).toBe(false);
    loot.picks[2] = 0;
    expect(lootAgreed(loot, table)).toBe(true);
    settleLoot(loot, party, table);
    expect(party[0].arts).toEqual([loot.offer[1]]);
    expect(party[1].arts).toEqual([loot.offer[0]]);
    expect(Object.values(loot.done!)).not.toContain(loot.offer[2]);
  });

  it('shares all three among a trio, and keeps what is left for a hero whose player dropped out', () => {
    const party = newParty([0, 1, 2]), loot = newLoot(79, 0, party, 'pahan'), table = [0, 2];
    loot.picks[0] = 2;
    loot.picks[2] = 0;
    expect(lootAgreed(loot, table)).toBe(true);
    settleLoot(loot, party, table);
    expect([party[0].arts, party[1].arts ?? [], party[2].arts]).toEqual([[loot.offer[2]], [], [loot.offer[0]]]);
    // the pile keeps whose hoard it was, for the window's picture
    expect(party[1].kept).toEqual({ seed: 79, floor: 0, offer: [loot.offer[1]], boss: 'pahan' });
    // back at the table, the player takes it
    expect(takeKept(party, 1, loot.offer[1])).toBe(true);
    expect(party[1].arts).toEqual([loot.offer[1]]);
    expect(party[1].kept).toBeNull();
  });

  it('has a hoard scene of its own for every boss that leaves trophies', () => {
    const events: Record<string, string> = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).events;
    for (const f of [0, 1]) for (const k of CASTS[f].bosses) {
      expect(events[`loot_${k}`], k).toBeDefined();
      expect(existsSync(`public/assets/${events[`loot_${k}`]}`), k).toBe(true);
    }
  });

  it('lets a fallen hero whose player was away pick their own once back, from what the others left', () => {
    const party = newParty([0, 2]), loot = newLoot(81, 0, party);
    party[1].hp = 0;
    loot.picks[0] = 1;
    // the fallen hero's player dropped out: the one here takes theirs, two stay on the pile
    expect(lootAgreed(loot, [0])).toBe(true);
    settleLoot(loot, party, [0]);
    expect(party[0].arts).toEqual([loot.offer[1]]);
    expect(party[1].arts ?? []).toEqual([]);
    expect(party[1].kept!.offer).toEqual([loot.offer[0], loot.offer[2]]);
    // the kept ones are offered to nobody else meanwhile
    for (let s = 0; s < 30; s++) for (const k of party[1].kept!.offer) expect(rollOffer(s, party)).not.toContain(k);
    // one the others took isn't theirs to take
    expect(takeKept(party, party[1].i, loot.offer[1])).toBe(false);
    expect(takeKept(party, party[1].i, loot.offer[2])).toBe(true);
    expect(party[1].arts).toEqual([loot.offer[2]]);
    expect(party[1].kept).toBeNull();
  });

  it('two heroes away from one share-out pick from one pile; away again, the old pile pays out its first', () => {
    const party = newParty([0, 1, 2]), loot = newLoot(82, 0, party);
    loot.offer = ['tea', 'cup', 'sock'];
    loot.picks[0] = 0;
    settleLoot(loot, party, [0]);
    expect(party[1].kept!.offer).toEqual(['cup', 'sock']);
    expect(party[2].kept!.offer).toEqual(['cup', 'sock']);
    expect(takeKept(party, 2, 'sock')).toBe(true);
    expect(party[1].kept!.offer).toEqual(['cup']);
    // the next boss falls while hero 1's player is still away
    const next = newLoot(83, 1, party);
    expect(next.offer).not.toContain('cup');
    next.picks[0] = 0;
    next.picks[2] = 1;
    settleLoot(next, party, [0, 2]);
    expect(party[1].arts).toEqual(['cup']);
    expect(party[1].kept).toEqual({ seed: 83, floor: 1, offer: [next.offer[2]] });
  });

  it('adds the beer belly\'s health at once', () => {
    const party = newParty([0]), loot = newLoot(80, 0, party);
    loot.offer = ['belly', 'tea', 'cup'];
    party[0].hp = 20;
    loot.picks[party[0].i] = 0;
    settleLoot(loot, party, [party[0].i]);
    expect(party[0].max).toBe(HEROES[0].hp + BELLY);
    expect(party[0].hp).toBe(20 + BELLY);
  });

  it('keeps the trophies a hero carries through a snapshot', () => {
    const g = new Game();
    g.party = newParty([0, 1]);
    g.party[1].arts = ['bells'];
    g.loadRoom({ seed: 5, depth: 1, floor: 0, type: 'fight' });
    const c = new Game();
    applySnapshot(c, JSON.parse(JSON.stringify(snapshot(g))));
    expect(c.party[1].arts).toEqual(['bells']);
  });
});

describe('placement and discs', () => {
  const fresh = () => { const g = new Game(); g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' }); return g; };

  it('starts with empty runes and every hero waiting with one disc', () => {
    const g = fresh();
    expect(g.S.phase).toBe('place');
    expect(g.S.pads.length).toBeGreaterThanOrEqual(g.party.length);
    for (const h of g.party) { expect(h.pad).toBeNull(); expect(h.discs).toBe(HAND_START); expect(h.hand).toBe(1); }
  });

  it('starts the fight only once every hero stands on a rune, then nobody moves', () => {
    const g = fresh(), [a, b, c] = g.party;
    g.startFight();
    expect(g.S.phase).toBe('place');
    expect(g.movePad(a, 0)).toBe(true);
    // placing one hero picks up the next one still waiting
    expect(g.act).toBe(b.i);
    expect(g.movePad(b, 0)).toBe(false);
    g.movePad(b, 1);
    g.movePad(c, 2);
    // a placed hero dragged onto a taken rune swaps with the hero there
    expect(g.movePad(a, 1)).toBe(true);
    expect([a.pad, b.pad]).toEqual([1, 0]);
    g.startFight();
    expect(g.S.phase).toBe('throw');
    expect(g.movePad(a, 2)).toBe(false);
    expect([a.pad, c.pad]).toEqual([1, 2]);
  });

  it('hands the party 0 to 3 ore at the blacksmith\'s, the same on every screen, and each amount turns up', () => {
    expect(FORGE_ORE).toBe(3);
    expect(forgeOre(5150)).toBe(forgeOre(5150));
    const got = new Set<number>();
    for (let s = 0; s < 200; s++) {
      const n = forgeOre(s * 131);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(FORGE_ORE);
      got.add(n);
    }
    expect([...got].sort()).toEqual([0, 1, 2, 3]);
  });

  it('sells disc upgrades only at the blacksmith\'s, between rooms', () => {
    const g = fresh(), h = g.hero;
    g.bank.ore = 100;
    g.buyDisc();
    g.upgrade('m');
    expect([h.discs, h.up.m, g.bank.ore]).toEqual([HAND_START, 0, 100]);
    g.forge = 1;
    g.buyDisc();
    g.upgrade('m');
    expect([h.discs, h.up.m]).toEqual([HAND_START + 1, 1]);
    // the next room closes the shop, and the new disc is in hand there
    g.loadRoom({ seed: 8, depth: 3, floor: 0, type: 'fight' });
    expect(g.forge).toBe(0);
    expect(h.hand).toBe(HAND_START + 1);
    const ore = g.bank.ore;
    g.upgrade('pw');
    expect(g.bank.ore).toBe(ore);
  });

  it('spends ore from one pool shared by the party', () => {
    const g = fresh();
    g.forge = 1;
    g.bank.ore = HAND_COST[0];
    g.select(1);
    g.buyDisc();
    expect(g.party[1].discs).toBe(HAND_START + 1);
    expect(g.bank.ore).toBe(0);
    g.select(0);
    g.buyDisc();
    expect(g.party[0].discs).toBe(HAND_START);
  });

  it('sells extra discs for ore up to the limit', () => {
    const g = fresh(), h = g.hero;
    g.forge = 1;
    g.bank.ore = 100;
    for (let k = 0; k < 9 && g.discCost(h); k++) g.buyDisc();
    expect(h.discs).toBe(HAND_MAX);
    expect(g.bank.ore).toBe(100 - HAND_COST.reduce((a, c) => a + c, 0));
  });

  it('sells two discs a turn at most, a third only comes with «Третья рука»', () => {
    const g = fresh(), h = g.hero;
    g.forge = 1;
    g.bank.ore = 100;
    for (let k = 0; k < 9 && g.discCost(h); k++) g.buyDisc();
    expect([h.discs, g.handOf(h)]).toEqual([2, 2]);
    h.arts = ['hand'];
    expect(g.handOf(h)).toBe(3);
  });

  it('prices an extra disc above any single stat level', () => {
    for (const c of HAND_COST) expect(c).toBeGreaterThan(Math.max(...UP_COST));
  });

  it('grows damage and speed by the same share for every hero, and stops the bounce at its limit', () => {
    const g = fresh();
    g.forge = 1;
    g.bank.ore = 100;
    for (const h of g.party) {
      g.select(h.i);
      g.upgrade('m');
      g.upgrade('pw');
      expect(g.stat(h, 'm')).toBeCloseTo(h.def.m * 1.25);
      expect(g.stat(h, 'pw')).toBeCloseTo(h.def.pw * 1.15);
    }
    // Ricochet's disc already keeps almost all its speed off a wall: one level reaches the limit, then nothing is for sale
    const r = g.party[1];
    g.select(r.i);
    g.upgrade('e');
    expect(g.stat(r, 'e')).toBe(E_MAX);
    expect(g.upCost(r, 'e')).toBe(0);
    const ore = g.bank.ore;
    g.upgrade('e');
    expect(g.bank.ore).toBe(ore);
  });

  it('carries every hero\'s sparks into the next room, and the altar fills them up', () => {
    const g = fresh(), sparks = () => g.party.map(h => h.sparks);
    g.party[0].sparks = 2; g.party[1].sparks = AB_COST; g.party[2].sparks = 0;
    g.bank.ore = 5;
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([2, AB_COST, 0]);
    expect(g.bank.ore).toBe(5);
    // a fallen hero keeps them too, for when they get up
    g.party[0].hp = 0;
    g.loadRoom({ seed: 3, depth: 3, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([2, AB_COST, 0]);
    g.party[0].hp = g.party[0].max;
    // the disco god's altar: a dance gives full sparks in the next fight, not this one
    applyFx(eventDef('altar').choices[0].win.fx, g.party, g.bank, 1);
    expect(sparks()).toEqual([2, AB_COST, 0]);
    g.loadRoom({ seed: 4, depth: 3, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([AB_COST, AB_COST, AB_COST]);
    // full sparks pay for the ability right away
    placeAll(g); g.startFight();
    expect(g.party.every(h => g.canUseAbility(h))).toBe(true);
    g.useAbility(g.party[0]);
    g.loadRoom({ seed: 5, depth: 4, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([0, AB_COST, AB_COST]);
    // a new run starts without them
    expect(newParty().map(h => h.sparks)).toEqual([0, 0, 0]);
  });
  it('ends the fight the moment the last enemy falls, with throws still left', () => {
    const g = fresh();
    let won: boolean | null = null;
    g.onRoomEnd = w => { won = w; };
    placeAll(g); g.startFight();
    g.throwDisc(g.party[0], 1, 0);
    for (const m of g.S.mobs) m.hp = 0;
    g.update(1 / 60);
    expect(g.S.phase).toBe('over');
    expect(won).toBe(true);
    expect(g.party.some(h => h.hand > 0)).toBe(true);
  });
});

describe('trophies in play', () => {
  /** A fight on floor 0 for one hero carrying the given trophies, with just the given enemies in a row along the top. */
  const arena = (arts: string[], kinds: (keyof typeof MOBS)[] = ['golem'], hero = 0) => {
    const g = new Game();
    g.party = newParty([hero]);
    g.party[0].arts = arts;
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, 40 + i * 30, 30, 1, 0));
    g.S.nodes = [];
    g.S.blocks = [];
    g.S.pits = [];
    g.S.haz = new Set();
    placeAll(g); g.startFight();
    return g;
  };
  const disc = (g: Game, x: number, y: number, vx: number, vy: number, more: Partial<Disc> = {}): Disc =>
    ({ hero: g.party[0], x, y, vx, vy, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0, ...more });
  /** Damage of one disc running square into the first enemy from below. */
  const blow = (arts: string[], more: Partial<Disc> = {}) => {
    const g = arena(arts), m = g.S.mobs[0];
    m.armor = 0;
    const hp = m.hp;
    g.S.discs = [disc(g, m.x, m.y + m.r + 5.5, 0, -200, more)];
    g.step(1 / 60);
    return hp - m.hp;
  };

  it('«Стеклянный глаз» makes a sure hit triple, «Бильярдный мел» counts one off the walls', () => {
    const plain = blow([], { bounces: 1 });
    expect(blow([])).toBe(Math.ceil(plain * CRIT));
    expect(blow(['glasseye'])).toBe(Math.ceil(plain * ART.critBig));
    expect(blow([], { bounces: 2 })).toBe(plain);
    expect(blow(['chalk'], { bounces: 2 })).toBe(Math.ceil(plain * CRIT));
  });

  it('«Пружина» adds a point a bounce up to four, «Нож» goes through armour', () => {
    const plain = blow([], { bounces: 3 });
    expect(blow(['spring'], { bounces: 3 })).toBe(plain + 3);
    expect(blow(['spring'], { bounces: 9 })).toBe(plain + ART.springMax);
    const arm = (arts: string[]) => {
      const g = arena(arts), m = g.S.mobs[0], hp = m.hp;
      m.armor = 99;
      g.S.discs = [disc(g, m.x, m.y + m.r + 5.5, 0, -200)];
      g.step(1 / 60);
      return hp - m.hp;
    };
    expect(arm([])).toBe(0);
    expect(arm(['opener'])).toBeGreaterThan(0);
  });

  it('«Бубенцы» ring a hero\'s own discs together and make the clash triple', () => {
    const clash = (arts: string[]) => {
      const g = arena(arts), a = disc(g, 100, 100, 150, 0), b = disc(g, 111, 100, -150, 0);
      g.S.discs = [a, b];
      g.step(1 / 120);
      return { charged: a.charged && b.charged, txt: g.S.floats.map(f => shown(f.txt)) };
    };
    expect(clash([]).charged).toBe(false);
    const rung = clash(['bells']);
    expect(rung.charged).toBe(true);
    expect(rung.txt).toContain('ЗВОН ×3');
    expect(blow(['bells'], { charged: true, bounces: 1 })).toBe(blow([], { bounces: 1 }) * ART.bells);
  });

  it('«Надувные труселя»: the disc rolls over the holes, and spikes under it don\'t hurt', () => {
    const roll = (arts: string[]) => {
      const g = arena(arts), h = g.party[0], hp = h.hp;
      g.S.pits = [{ k: '1x1', cells: [[6, 4]] }];
      const d = disc(g, 4 * TILE, 4.5 * TILE, 250, 0);
      g.S.discs = [d];
      let far = d.x;
      for (let k = 0; k < 240 && !d.fall; k++) { g.step(1 / 120); far = Math.max(far, d.x); }
      return { fall: d.fall, x: far, hurt: hp - h.hp };
    };
    expect(roll([]).fall).toBeGreaterThan(0);
    const safe = roll(['undies']);
    expect(safe.fall).toBe(0);
    expect(safe.x).toBeGreaterThan(7 * TILE);
    expect(safe.hurt).toBe(0);
    // the aim line runs on over the hole too
    const aim = (arts: string[]) => {
      const g = arena(arts), p = g.spot(g.party[0])!, i = Math.floor(p.x / TILE), j = Math.floor(p.y / TILE) - 2;
      g.S.mobs = [];
      g.S.pits = [{ k: '1x1', cells: [[i, j]] }];
      const pr = g.predict(g.party[0], 0, -40, 0);
      return pr.path[pr.path.length - 1][1] - j * TILE;
    };
    expect(aim([])).toBeGreaterThan(0);
    expect(aim(['undies'])).toBeLessThan(0);
    const spikes = (arts: string[]) => {
      const g = arena(arts), h = g.party[0], hp = h.hp;
      g.S.discs = [disc(g, 5 * TILE + 8, 5 * TILE + 8, 0, 0, { hits: 1 })];
      g.S.haz.add(hazKey(5, 5));
      endAll(g);
      g.update(0.02);
      return hp - h.hp;
    };
    expect(spikes([])).toBeGreaterThan(0);
    expect(spikes(['undies'])).toBe(0);
  });

  it('«Золотая челюсть» takes a whole vein in one hit', () => {
    const mine = (arts: string[]) => {
      const g = arena(arts), n = { k: 'ore' as const, name: 'Рудная жила', r: 7, ch: 3, x: 88, y: 88, left: 3, hit: 0, s: 1 };
      g.S.nodes = [n];
      g.S.discs = [disc(g, n.x, n.y + n.r + 5.5, 0, -60)];
      g.step(1 / 60);
      return { ore: g.bank.ore, left: n.left };
    };
    expect(mine([])).toEqual({ ore: 1, left: 2 });
    expect(mine(['denture'])).toEqual({ ore: 3, left: 0 });
  });

  it('«Ракушка» shields every turn, «Третья рука» adds a disc, «Батарейка» fills the sparks, «Энергетик» makes the ability cheaper', () => {
    const g = arena(['cup', 'hand', 'battery', 'energy']), h = g.party[0];
    expect(h.shield).toBe(ART.cup);
    expect(h.hand).toBe(h.discs + 1);
    expect(h.sparks).toBe(AB_COST);
    h.sparks = ART.energyCost;
    expect(g.canUseAbility(h)).toBe(true);
    g.useAbility(h);
    expect(h.sparks).toBe(0);
    endAll(g);
    for (let k = 0; k < 600 && g.S.turn === 1; k++) g.update(0.05);
    expect(g.S.turn).toBe(2);
    expect(h.shield).toBe(ART.cup);
    expect(h.hand).toBe(h.discs + 1);
    const plain = arena([]);
    expect(plain.party[0].shield).toBe(0);
    plain.party[0].sparks = ART.energyCost;
    expect(plain.canUseAbility(plain.party[0])).toBe(false);
  });

  it('«Носок» saves the hero from a deadly blow once a room', () => {
    const g = arena(['sock']), h = g.party[0];
    g.hurtHero(h, h.hp + 5);
    expect(h.hp).toBe(1);
    g.hurtHero(h, 3);
    expect(h.hp).toBeLessThanOrEqual(0);
  });

  it('a kill by the hero\'s disc mends it with «Клыки» and drops ore with «Копилка»', () => {
    const g = arena(['fangs', 'piggy'], ['skel', 'skel']), h = g.party[0], [a, b] = g.S.mobs;
    h.hp = 10;
    g.hurtMob(a, 99, '#fff', false, 0.6, h);
    expect(h.hp).toBe(10 + ART.fangs);
    expect(g.bank.ore).toBe(1);
    // a kill nobody's disc made pays nothing
    g.hurtMob(b, 99);
    expect(g.bank.ore).toBe(1);
  });

  it('«Ёж в штанах» pricks an enemy that strikes up close', () => {
    const g = arena(['hedgehog'], ['skel']), h = g.party[0], m = g.S.mobs[0], p = g.spot(h)!;
    m.x = p.x < g.S.Wx / 2 ? p.x + TILE : p.x - TILE; m.y = p.y; m.tx = m.x; m.ty = m.y;
    const hp = m.hp;
    m.intent = { t: 'hit', hero: h.i, dmg: 2 };
    endAll(g);
    for (let k = 0; k < 200 && g.S.turn === 1; k++) g.update(0.05);
    expect(hp - m.hp).toBe(ART.hedgehog);
  });

  it('«Ромашковый чай» puts the enemies\' rage off by three turns', () => {
    expect(arena(['tea']).rageFrom()).toBe(RAGE_FROM + ART.tea);
    expect(arena([]).rageFrom()).toBe(RAGE_FROM);
  });

  it('«Бумеранг» brings a miss back into the hand once a turn', () => {
    const g = arena(['boomerang']), h = g.party[0], hand = h.hand;
    g.throwDisc(h, 0, 5);
    expect(h.hand).toBe(hand - 1);
    for (let k = 0; k < 600 && g.moving(); k++) g.step(1 / 120);
    g.step(1 / 120);
    expect(h.hand).toBe(hand);
    expect(g.S.floats.some(f => f.txt === 'вернулся!')).toBe(true);
    g.throwDisc(h, 0, 5);
    for (let k = 0; k < 600 && g.moving(); k++) g.step(1 / 120);
    g.step(1 / 120);
    expect(h.hand).toBe(hand - 1);
  });

  it('«Поднос» widens the disc, «Полироль» lets it roll further, «Смазка» spares the speed of two bounces', () => {
    const g = arena(['tray', 'polish']), h = g.party[0];
    g.throwDisc(h, 0, 20);
    expect(g.S.discs[0].r).toBeCloseTo(h.def.r * ART.trayR);
    expect(g.S.discs[0].fr).toBeCloseTo(h.def.fr * ART.polishFr);
    const len = (arts: string[]) => {
      const a = arena(arts), at = a.spot(a.party[0])!, sx = at.x < a.S.Wx / 2 ? 1 : -1, sy = at.y < a.S.Wy / 2 ? 1 : -1;
      a.S.mobs = [];
      // into the open room, soft enough to stop before the far wall
      const p = a.predict(a.party[0], 9 * sx, 9 * sy, 9).path;
      return Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]);
    };
    expect(len(['polish'])).toBeGreaterThan(len([]) * 1.3);
    const wall = (arts: string[]) => {
      const a = arena(arts);
      a.throwDisc(a.party[0], 0, 0.0001 - 40);
      const d = a.S.discs[0];
      d.x = 100; d.y = d.r + 1; d.vx = 0; d.vy = -200;
      a.step(1 / 120);
      return Math.hypot(d.vx, d.vy);
    };
    expect(wall(['lube'])).toBeGreaterThan(wall([]) * 1.3);
  });

  it('«Диско-шар» throws a light spot off a bounce at the nearest enemy, three at most a throw', () => {
    const g = arena(['mirrorball'], ['skel']), m = g.S.mobs[0], hp = m.hp, d = disc(g, m.x + 30, 6, 0, -200);
    g.S.discs = [d];
    g.step(1 / 120);
    expect(hp - m.hp).toBe(ART.beamDmg);
    expect(g.S.zaps.some(z => z.beam)).toBe(true);
    d.beams = ART.beamMax;
    d.y = 6; d.vy = -200;
    g.step(1 / 120);
    expect(hp - m.hp).toBe(ART.beamDmg);
  });

  it('«Стельки» keep more of the disc\'s speed off an enemy', () => {
    const left = (arts: string[]) => {
      const g = arena(arts), m = g.S.mobs[0];
      const d = disc(g, m.x, m.y + m.r + 5.5, 0, -200);
      g.S.discs = [d];
      g.step(1 / 60);
      return Math.hypot(d.vx, d.vy);
    };
    expect(left(['insoles'])).toBeGreaterThan(left([]) * 1.5);
  });

  it('«Рентген-очки» show the aim line on through three bounces', () => {
    // Ricochet's disc keeps enough speed for three bounces and more
    const g = arena(['xray'], ['golem'], 1), at = g.spot(g.party[0])!, sx = at.x < g.S.Wx / 2 ? 1 : -1, sy = at.y < g.S.Wy / 2 ? 1 : -1;
    g.S.mobs = [];
    expect(g.predict(g.party[0], 50 * sx, 31 * sy, 0).bounces.length).toBe(1);
    expect(g.predict(g.party[0], 50 * sx, 31 * sy, ART.xrayBounces).bounces.length).toBe(ART.xrayBounces + 1);
  });
});

describe('ending the turn', () => {
  /** A floor 0 fight for the given heroes, one archer in the far corner and the floor otherwise bare. */
  const arena = (picks: number[]) => {
    const g = new Game();
    g.party = newParty(picks);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('archer', cellCentre(1, 1).x, cellCentre(1, 1).y, 1, 0)];
    g.S.nodes = []; g.S.blocks = []; g.S.pits = []; g.S.haz = new Set();
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = h.max = 99;
    return g;
  };
  const run = (g: Game, n: number) => { for (let k = 0; k < n; k++) g.update(1 / 60); };

  it('never passes on its own: alone, pressing passes at once, and the unthrown disc is lost', () => {
    const g = arena([1]), h = g.hero;
    g.throwDisc(h, 0, -30);
    run(g, 600);
    expect(g.moving()).toBe(false);
    expect(g.S.phase).toBe('throw');
    // another disc in hand when the press comes
    h.hand = 1;
    expect(g.canEndTurn()).toBe(true);
    g.endTurn();
    expect(g.ended()).toBe(true);
    expect(g.canEndTurn()).toBe(false);
    run(g, 1);
    expect(g.S.phase).toBe('resolve');
    expect(h.hand).toBe(0);
    for (let k = 0; k < 2000 && g.S.phase !== 'throw'; k++) g.update(1 / 60);
    expect(g.S.turn).toBe(2);
    expect(g.S.done).toEqual([]);
    expect(h.hand).toBe(h.discs);
  });

  it('waits for every living hero\'s player, and a press can be taken back while the turn lasts', () => {
    const g = arena([0, 1, 2]), [a, b, c] = g.party;
    g.endTurn(a);
    run(g, 5);
    expect(g.S.phase).toBe('throw');
    g.endTurn(b);
    g.cancelEndTurn(a);
    expect(g.ended(a)).toBe(false);
    expect(g.S.done).toEqual([b.i]);
    g.endTurn(c);
    run(g, 5);
    expect(g.S.phase).toBe('throw');
    // a fallen hero holds nobody up, and has nothing to press
    a.hp = 0;
    expect(g.canEndTurn(a)).toBe(false);
    run(g, 1);
    expect(g.S.phase).toBe('resolve');
    // the press can't be taken back once the turn has passed
    g.cancelEndTurn(b);
    expect(g.ended(b)).toBe(true);
  });

  it('a hero whose player is done throws no more until the press is taken back', () => {
    const g = arena([0, 2]), [a] = g.party;
    a.sparks = AB_COST;
    g.endTurn(a);
    g.throwDisc(a, 0, -30);
    expect(g.S.discs).toHaveLength(0);
    expect(a.hand).toBe(1);
    expect(g.canUseAbility(a)).toBe(false);
    g.cancelEndTurn(a);
    expect(g.canUseAbility(a)).toBe(true);
    g.throwDisc(a, 0, -30);
    expect(g.S.discs).toHaveLength(1);
  });

  it('a press while the discs still roll passes the turn once they stop', () => {
    const g = arena([2]), h = g.hero;
    g.throwDisc(h, 0, -60);
    run(g, 2);
    g.endTurn();
    run(g, 1);
    expect(g.moving()).toBe(true);
    expect(g.S.phase).toBe('throw');
    for (let k = 0; k < 2000 && g.moving(); k++) g.update(1 / 60);
    run(g, 1);
    expect(g.S.phase).toBe('resolve');
  });

  it('online, a client asks the host to end or take back its own turn, and every screen sees who is done', () => {
    const host = arena([0, 2]), cli = new Game(), sent: Action[] = [];
    host.online = true;
    cli.online = true;
    cli.send = a => sent.push(a);
    cli.canControl = h => h.i === 2;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.canEndTurn(cli.heroOf(0))).toBe(false);
    expect(cli.canEndTurn()).toBe(true);
    cli.endTurn();
    expect(cli.ended()).toBe(false);
    expect(sent).toEqual([{ k: 'end', h: 2, on: true }]);
    host.perform(sent[0]);
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.ended()).toBe(true);
    cli.cancelEndTurn();
    expect(sent[1]).toEqual({ k: 'end', h: 2, on: false });
    host.perform(sent[1]);
    expect(host.S.done).toEqual([]);
    host.perform({ k: 'end', h: 2, on: true });
    host.endTurn(host.heroOf(0));
    run(host, 1);
    expect(host.S.phase).toBe('resolve');
    // a new room starts with nobody done
    host.loadRoom({ seed: 8, depth: 3, floor: 0, type: 'fight' });
    expect(host.S.done).toEqual([]);
  });

  it('online, a player who dropped out holds nobody up, and every screen sees who is away', () => {
    const host = arena([0, 1, 2]), cli = new Game(), [a, b, c] = host.party;
    host.online = true;
    host.endTurn(a);
    host.endTurn(b);
    run(host, 5);
    expect(host.S.phase).toBe('throw');
    host.setAway([c.i]);
    expect(host.here(c)).toBe(false);
    run(host, 1);
    expect(host.S.phase).toBe('resolve');
    cli.online = true;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.S.away).toEqual([c.i]);
    expect(cli.here(cli.heroOf(c.i))).toBe(false);
    // the next room still knows, until the player comes back
    host.loadRoom({ seed: 8, depth: 3, floor: 0, type: 'fight' });
    expect(host.S.away).toEqual([c.i]);
    host.setAway([]);
    expect(host.here(c)).toBe(true);
  });

  it('online, placement ends without a player who dropped out: their hero takes a free rune', () => {
    const g = new Game();
    g.party = newParty([0, 1, 2]);
    g.online = true;
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    const [a, b, c] = g.party;
    g.movePad(a, 0); g.startFight(a);
    g.movePad(b, 1); g.startFight(b);
    expect(g.S.phase).toBe('place');
    g.setAway([c.i]);
    expect(g.S.phase).toBe('throw');
    expect(c.pad).not.toBeNull();
    expect(new Set(g.party.map(h => h.pad)).size).toBe(3);
  });

  it('alone, nobody is ever away', () => {
    const g = arena([1]), h = g.hero;
    g.S.away = [h.i];
    run(g, 5);
    expect(g.S.phase).toBe('throw');
    expect(g.here(h)).toBe(true);
  });
});

describe('discs and aiming', () => {
  it('every disc fits through a one-tile gap between blocks', () => {
    for (const d of HEROES) expect(d.r * 2).toBeLessThan(TILE - 2);
  });

  it('predicts a path that starts at the rune and heads where the throw points', () => {
    const g = new Game();
    g.loadRoom({ seed: 11, depth: 2, floor: 0, type: 'fight' });
    placeAll(g); g.startFight();
    const h = g.hero, p = g.S.pads[h.pad!];
    const cx = g.S.Wx / 2 - p.x, cy = g.S.Wy / 2 - p.y, L = Math.hypot(cx, cy);
    const pr = g.predict(h, (cx / L) * 60, (cy / L) * 60);
    expect(pr.path.length).toBeGreaterThan(2);
    const [x1, y1] = pr.path[1];
    expect((x1 - p.x) * cx + (y1 - p.y) * cy).toBeGreaterThan(0);
  });
});

describe('online play', () => {
  const pair = () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([0, 2]);
    host.online = true;
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    placeAll(host);
    const sent: Action[] = [];
    cli.online = true;
    cli.send = a => sent.push(a);
    cli.canControl = h => h.i === 2;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    return { host, cli, sent };
  };

  it('mirrors the host room and party on a client', () => {
    const { host, cli } = pair();
    expect(cli.party.map(h => h.i)).toEqual([0, 2]);
    expect(cli.S.spec).toEqual(host.S.spec);
    expect(cli.S.mobs.map(m => m.hp)).toEqual(host.S.mobs.map(m => m.hp));
    expect(cli.act).toBe(2);
  });

  it('sends client actions to the host instead of applying them', () => {
    const { host, cli, sent } = pair();
    cli.startFight();
    expect(cli.S.phase).toBe('place');
    expect(sent).toEqual([{ k: 'ready', h: 2 }]);
    host.perform(sent[0]);
    expect(host.S.phase).toBe('place');
    host.startFight(host.heroOf(0));
    expect(host.S.phase).toBe('throw');
  });

  it('lets a host reopen a saved game and play on exactly as before', () => {
    const { host } = pair();
    host.startFight(host.heroOf(0));
    host.startFight(host.heroOf(2));
    host.throwDisc(host.heroOf(0), 0.3, -1);
    for (let k = 0; k < 30; k++) host.update(1 / 60);
    const back = new Game();
    applySnapshot(back, JSON.parse(JSON.stringify(snapshot(host))));
    for (const g of [host, back]) { g.throwDisc(g.heroOf(2), -0.4, -1); endAll(g); for (let k = 0; k < 600; k++) g.update(1 / 60); }
    expect(host.S.turn).toBe(2);
    const plain = (g: Game) => { const s = snapshot(g); return JSON.stringify({ ...s, floats: [], sparks: [] }); };
    expect(plain(back)).toBe(plain(host));
  });

  it('keeps a scratch taken in a saved room, so the room pays no ore «Без царапины» after the game comes back', () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.hurt = true;
    const back = new Game();
    applySnapshot(back, JSON.parse(JSON.stringify(snapshot(g))));
    expect(back.S.hurt).toBe(true);
  });

  it('shows every player the same enemy moving', () => {
    const { host, cli } = pair();
    host.startFight(host.heroOf(0));
    host.startFight(host.heroOf(2));
    endAll(host);
    for (let k = 0; k < 2000 && !(host.S.phase === 'enemy' && host.S.actor >= 0 && host.S.clock > 0.05 && !host.S.attacked); k++) host.update(1 / 60);
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.S.phase).toBe('enemy');
    expect(cli.S.actor).toBe(host.S.actor);
    expect(cli.acted(cli.S.mobs[host.S.actor])).toBe(false);
    const still = cli.S.mobs.map(m => [m.x, m.y]);
    for (let k = 0; k < 3; k++) { cli.update(1 / 60); host.update(1 / 60); }
    // between snapshots the client plays the same move on its own: nobody else stirs
    cli.S.mobs.forEach((m, i) => { if (i !== cli.S.actor) expect([m.x, m.y]).toEqual(still[i]); });
    expect(cli.S.mobs[cli.S.actor].x).toBeCloseTo(host.S.mobs[host.S.actor].x, 5);
    expect(cli.S.mobs[cli.S.actor].y).toBeCloseTo(host.S.mobs[host.S.actor].y, 5);
  });

  it('opens the blacksmith\'s on every screen, and a client buys through the host', () => {
    const { host, cli, sent } = pair();
    host.forge = 4;
    host.gift = 2;
    host.bank.ore = 20;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect([cli.forge, cli.gift]).toEqual([4, 2]);
    cli.buyDisc(cli.heroOf(2));
    expect(sent).toEqual([{ k: 'disc', h: 2 }]);
    host.perform(sent[0]);
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.heroOf(2).discs).toBe(HAND_START + 1);
    expect(cli.bank.ore).toBe(20 - HAND_COST[0]);
    host.forge = 0;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.forge).toBe(0);
  });

  it('loads a save from before sparks were each hero\'s own, sharing the party\'s pool out', () => {
    const { host } = pair();
    const old = JSON.parse(JSON.stringify(snapshot(host)));
    for (const h of old.heroes) delete h.sparks;
    old.bank = { ore: 6, sparks: 4, boon: 0 };
    const back = new Game();
    applySnapshot(back, old);
    expect(back.party.map(h => h.sparks)).toEqual([AB_COST, 4 - AB_COST]);
    expect(back.bank.ore).toBe(6);
    expect(JSON.parse(JSON.stringify(snapshot(back))).bank).toEqual({ ore: 6, boon: 0, vol: 0 });
  });

  it('rolls the discs on a client step for step with the host, bounces and all, even from a late snapshot', () => {
    const { host, cli } = pair();
    let ms = 0;
    cli.clock = () => ms;
    host.startFight(host.heroOf(0));
    host.startFight(host.heroOf(2));
    // two throws that hit enemies, walls and each other
    host.throwDisc(host.heroOf(0), 40, -45);
    host.throwDisc(host.heroOf(2), -50, -30);
    const at = new Map<number, string>(), snaps = new Map<number, string>();
    const pos = (g: Game) => JSON.stringify(g.S.discs.map(d => [d.x, d.y, d.vx, d.vy]));
    for (let k = 0; k < 400; k++) { host.step(1 / 120); at.set(host.tick, pos(host)); snaps.set(host.tick, JSON.stringify(snapshot(host))); }
    expect(host.S.discs.some(d => d.bounces > 0 || d.hits > 0)).toBe(true);
    const t0 = host.tick - 400;
    // the first snapshot comes 3 steps after it was taken; then the client runs on its own clock
    ms = 0;
    applySnapshot(cli, JSON.parse(snaps.get(t0 + 3)!));
    expect(pos(cli)).toBe(at.get(t0 + 3));
    for (let k = 1; k <= 200; k++) {
      ms = (k * 1000) / 120;
      cli.update(1 / 120);
      expect(cli.tick).toBe(t0 + 3 + k);
      expect(pos(cli)).toBe(at.get(cli.tick));
    }
    // a snapshot held up on the way: the client plays it on to where it already was, and nothing moves
    applySnapshot(cli, JSON.parse(snaps.get(t0 + 150)!));
    expect(cli.tick).toBe(t0 + 203);
    expect(pos(cli)).toBe(at.get(t0 + 203));
    // a quicker one moves the client's clock up to it
    ms += 1000 / 120;
    applySnapshot(cli, JSON.parse(snaps.get(t0 + 210)!));
    expect(cli.tick).toBe(t0 + 210);
    expect(pos(cli)).toBe(at.get(t0 + 210));
  });

  it('plays each sound once on every screen: the physics on each, the rest from the host', () => {
    const { host, cli } = pair();
    let ms = 0;
    cli.clock = () => ms;
    const heard = (g: Game) => { const out: string[] = []; g.onSound = ev => out.push(`${g.tick} ${ev}`); return out; };
    const onHost = heard(host), onCli = heard(cli);
    const snap = () => JSON.parse(JSON.stringify({ ...snapshot(host), cues: host.recentCues() }));
    host.startFight(host.heroOf(0));
    host.startFight(host.heroOf(2));
    host.throwDisc(host.heroOf(0), 40, -45);
    host.throwDisc(host.heroOf(2), -50, -30);
    const snaps = new Map<number, ReturnType<typeof snap>>();
    for (let k = 0; k < 400; k++) { host.step(1 / 120); snaps.set(host.tick, snap()); }
    const t0 = host.tick - 400;
    applySnapshot(cli, snaps.get(t0 + 3)!);
    // hero 0 put on its rune, the turn starting and hero 0's throw come from the host; hero 2 is this player's own, heard on the spot
    expect(onCli).toEqual([`${t0 + 3} step`, `${t0 + 3} yourTurn`, `${t0 + 3} launch`]);
    for (let k = 1; k <= 200; k++) { ms = (k * 1000) / 120; cli.update(1 / 120); }
    // a late snapshot is played on to where the client was without a sound, its sounds from the host already heard
    applySnapshot(cli, snaps.get(t0 + 150)!);
    ms += 1000 / 120;
    applySnapshot(cli, snaps.get(t0 + 210)!);
    const physics = (out: string[]) => out.filter(e => { const t = Number(e.split(' ')[0]); return t > t0 + 3 && t <= t0 + 210; });
    expect(physics(onHost).length).toBeGreaterThan(2);
    expect(physics(onCli)).toEqual(physics(onHost));
    expect(onCli.length).toBe(physics(onCli).length + 3);
    // the enemies' turn: a sound only the host makes reaches the client once, however many snapshots carry it
    endAll(host);
    for (let k = 0; k < 2000 && host.S.phase !== 'enemy'; k++) host.update(1 / 60);
    const s = snap();
    applySnapshot(cli, s);
    applySnapshot(cli, JSON.parse(JSON.stringify(s)));
    expect(onCli.filter(e => e.endsWith('enemyTurn')).length).toBe(1);
  });

  it('lets a client control only its own hero', () => {
    const { cli } = pair();
    cli.select(0);
    expect(cli.act).toBe(2);
  });
});

describe('ice caves', () => {
  it('freeze the floor in patches and grow icicles that block like stone', () => {
    let iced = 0, total = 0, icicles = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const L = generate({ seed, depth: 10, floor: 1, type: 'fight' });
      L.floor.forEach((v, k) => { total += v; iced += v && L.ice[k]; });
      icicles += L.blocks.filter(b => b.ice).length;
      for (const b of L.blocks) expect(b.x1 - b.x0).toBe(TILE);
      const k = L.ice.indexOf(1), x = (k % L.gw) * TILE + 8, y = Math.floor(k / L.gw) * TILE + 8;
      expect(muAt(L, x, y)).toBeLessThan(L.biome.mu);
    }
    expect(iced / total).toBeGreaterThan(0.2);
    expect(iced / total).toBeLessThan(0.6);
    expect(icicles).toBeGreaterThan(20);
    const stone = generate({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(stone.ice.every(v => v === 0)).toBe(true);
    expect(stone.blocks.some(b => b.ice)).toBe(false);
  });

  it('icicles come big and small, chip under hits, shatter and stop blocking', () => {
    const all = Array.from({ length: 20 }, (_, k) => generate({ seed: k + 1, depth: 10, floor: 1, type: 'fight' }).blocks.filter(b => b.ice)).flat();
    expect(all.some(b => b.big)).toBe(true);
    expect(all.some(b => !b.big)).toBe(true);
    const g = new Game();
    let seed = 1;
    while (!generate({ seed, depth: 10, floor: 1, type: 'fight' }).blocks.some(o => o.ice && o.big)) seed++;
    g.loadRoom({ seed, depth: 10, floor: 1, type: 'fight' });
    placeAll(g); g.startFight();
    const b = g.S.blocks.find(o => o.ice && o.big)!;
    let hits = 0;
    while (b.hp! > 0 && hits < 10) {
      g.S.discs = [{ hero: g.hero, x: b.x0 - 6, y: (b.y0 + b.y1) / 2, vx: 260, vy: 0, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0 }];
      g.step(1 / 60);
      hits++;
    }
    expect(hits).toBeGreaterThan(1);
    expect(b.hp).toBe(0);
    expect(g.inBlock((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 2)).toBe(false);
    const cli = new Game();
    applySnapshot(cli, snapshot(g));
    expect(cli.S.blocks.find(o => o.x0 === b.x0 && o.y0 === b.y0 && o.ice)!.hp).toBe(0);
  });
});

describe('floor casts and enemy abilities', () => {
  it('fills each floor with its own enemies and its own boss', () => {
    const seen = [new Set<string>(), new Set<string>(), new Set<string>()];
    for (let f = 0; f < FLOORS; f++) for (let seed = 1; seed < 80; seed++) for (const type of ['fight', 'elite', 'boss'] as const) {
      const row = type === 'boss' ? LAYERS - 1 : seed % (LAYERS - 1);
      const L = generate({ seed, depth: f * LAYERS + row + 1, floor: f, type });
      for (const m of L.mobs) { expect(MOBS[m.k].floor).toBe(f); seen[f].add(m.k); }
      if (type === 'boss') expect(L.mobs.filter(m => MOBS[m.k].boss)).toHaveLength(1);
    }
    // one of the floor's three bosses, by the room's seed
    expect(seen.map(s => [...s].filter(k => MOBS[k as keyof typeof MOBS].boss).sort())).toEqual(CASTS.map(c => [...c.bosses].sort()));
    for (const s of seen) expect(s.size).toBeGreaterThanOrEqual(5);
  });

  const fight = (floor: number, kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: floor * LAYERS + 2, floor, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, 40 + i * 30, 30, 1, 0));
    placeAll(g); g.startFight();
    return g;
  };
  const enemyTurn = (g: Game) => {
    const t = g.S.turn;
    endAll(g);
    for (let k = 0; k < 600 && g.S.turn === t; k++) g.update(1 / 60);
  };

  it('a necromancer marks a circle a turn ahead and raises a skeleton there', () => {
    const g = fight(0, ['necro']);
    expect(g.S.mobs[0].intent!.t).not.toBe('summon');
    enemyTurn(g);
    expect(g.S.turn).toBe(2);
    const it = g.S.mobs[0].intent!;
    expect(it.t).toBe('summon');
    expect(it.spots).toHaveLength(1);
    const before = g.S.mobs.length;
    enemyTurn(g);
    expect(g.S.mobs.length).toBe(before + 1);
    const risen = g.S.mobs[before];
    expect(risen.k).toBe('skel');
    expect(risen.owner).toBe(0);
    expect(Math.hypot(risen.x - it.spots![0].x, risen.y - it.spots![0].y)).toBeLessThan(40);
  });

  it('counts down to each mob\'s special move by the rules that pick its intents', () => {
    /** Every mob's coming special move on the given turn, intents picked as they are at its start. */
    const on = (g: Game, turn: number) => { g.S.turn = turn; g.pickIntents(); return g.S.mobs.map(m => g.specialIn(m)); };
    const ice = fight(1, ['lich', 'witch', 'ghoul']), [, , ghoul] = ice.S.mobs;
    // the lich raises ghouls on turns 2, 5, 8 and sends the blizzard on 3, 6, 9; the witch mends on even turns
    expect(on(ice, 1)).toEqual([{ name: 'призыв', turns: 1 }, { name: 'лечение', turns: 1 }, null]);
    expect(on(ice, 3)).toEqual([{ name: 'метель', turns: 0 }, { name: 'лечение', turns: 1 }, null]);
    expect(on(ice, 4)).toEqual([{ name: 'призыв', turns: 1 }, { name: 'лечение', turns: 2 }, null]);
    // the witch mends this turn only with someone hurt; left alone, she has nobody to mend at all
    ghoul.hp -= 3;
    expect(on(ice, 4)[1]).toEqual({ name: 'лечение', turns: 0 });
    for (const m of ice.S.mobs) if (m.k !== 'witch') m.hp = 0;
    expect(ice.specialIn(ice.S.mobs[1])).toBeNull();

    const king = fight(0, ['king', 'skel']);
    expect(on(king, 1)).toEqual([{ name: 'удар по всем', turns: 2 }, null]);
    expect(on(king, 3)).toEqual([{ name: 'удар по всем', turns: 0 }, null]);
    // the forgelord's hammer falls on turns 2, 5, 8, a turn before the floor heats on 3, 6, 9
    const forge = fight(2, ['forgelord', 'bomber']);
    expect(on(forge, 1)).toEqual([{ name: 'удар молотом', turns: 1 }, { name: 'фитиль', turns: 0 }]);
    expect(on(forge, 2)).toEqual([{ name: 'удар молотом', turns: 0 }, { name: 'фитиль', turns: 1 }]);
    expect(on(forge, 3)).toEqual([{ name: 'жар', turns: 0 }, { name: 'фитиль', turns: 0 }]);
  });

  it('a summoner\'s countdown starts over once it has raised its mob, and stops at its limit', () => {
    const g = fight(0, ['necro']), [necro] = g.S.mobs;
    expect(g.specialIn(necro)).toEqual({ name: 'призыв', turns: 1 });
    enemyTurn(g);
    expect(g.specialIn(necro)).toEqual({ name: 'призыв', turns: 0 });
    endAll(g);
    for (let k = 0; k < 600 && !g.acted(necro); k++) g.update(1 / 60);
    expect(g.S.mobs).toHaveLength(2);
    expect(g.specialIn(necro)).toEqual({ name: 'призыв', turns: 2 });
    for (let k = 0; k < 2; k++) g.S.mobs.push(Object.assign(newMob('skel', 8, 8), { owner: 0 }));
    expect(g.specialIn(necro)).toBeNull();
    g.S.mobs[1].hp = 0;
    expect(g.specialIn(necro)).toEqual({ name: 'призыв', turns: 2 });
  });

  it('a ghost lets discs through on even turns', () => {
    const g = fight(1, ['ghost']);
    expect(g.solid(g.S.mobs[0])).toBe(true);
    g.S.turn = 2;
    expect(g.solid(g.S.mobs[0])).toBe(false);
  });

  it('a lava slime leaves lava where it dies, and the boss of the forge rages below half HP', () => {
    const g = fight(2, ['slime', 'forgelord']);
    const [s, b] = g.S.mobs;
    const n = g.S.haz.size;
    g.hurtMob(s, 999, '#fff', true);
    expect(g.S.haz.size).toBe(n + 1);
    const dmg = b.dmg;
    g.hurtMob(b, Math.ceil(b.max / 2) + 1, '#fff', true);
    expect(b.dmg).toBe(dmg + 3);
  });

  it('a chilled hero throws softer', () => {
    const g = fight(1, ['ghoul']), h = g.hero, p = g.power(h);
    h.chill = 1;
    expect(g.power(h)).toBeCloseTo(p * 0.7);
  });
});

describe('pressure in a fight', () => {
  /** A fight on floor 0 with just the given enemies standing in a row along the top. */
  const arena = (kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, 40 + i * 30, 30, 1, 0));
    g.S.nodes = [];
    g.S.blocks = [];
    placeAll(g); g.startFight();
    return g;
  };
  const disc = (g: Game, x: number, y: number, vx: number, vy: number, bounces = 0) =>
    ({ hero: g.party[0], x, y, vx, vy, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces, spin: 0, hits: 0, ab: false, rico: 0 });

  it('enemies hit one harder every turn once the fight drags on', () => {
    const g = arena(['archer']), m = g.S.mobs[0];
    expect(g.rage()).toBe(0);
    expect(m.intent!.dmg).toBe(m.dmg);
    g.S.turn = RAGE_FROM + 1;
    g.pickIntents();
    expect(g.rage()).toBe(2);
    expect(m.intent!.dmg).toBe(m.dmg + 2);
  });

  it('marks how much the coming enemy turn takes from each hero, minus the shield', () => {
    const g = arena(['archer', 'archer']);
    const h = g.heroOf(g.S.mobs[0].intent!.hero), aimed = g.S.mobs.filter(m => m.intent!.hero === h.i).reduce((n, m) => n + m.intent!.dmg, 0);
    expect(g.incoming(h)).toBe(aimed);
    h.shield = 1;
    expect(g.incoming(h)).toBe(aimed - 1);
  });

  it('a straight, square hit deals more than the same hit after a bounce', () => {
    const hit = (bounces: number) => {
      const g = arena(['golem']), m = g.S.mobs[0];
      m.armor = 0;
      const hp = m.hp;
      g.S.discs = [disc(g, m.x, m.y + m.r + 5.5, 0, -200, bounces)];
      g.step(1 / 60);
      return { dmg: hp - m.hp, sure: g.S.floats.some(f => f.txt === 'ТОЧНО!') };
    };
    const straight = hit(0), banked = hit(1);
    expect(straight.sure).toBe(true);
    expect(banked.sure).toBe(false);
    expect(straight.dmg).toBe(Math.ceil(banked.dmg * CRIT));
  });

  it('a spark crystal fills the sparks of every hero still standing, whoever threw, never past the cost of the ability', () => {
    const g = arena(['archer']), [a, b, c] = g.party;
    const n = { k: 'spk' as const, name: 'Кристалл искр', r: 6, ch: AB_COST, x: 88, y: 88, left: AB_COST, hit: 0 };
    g.S.nodes = [n];
    const hit = (h: HeroState) => {
      g.S.floats = [];
      g.S.discs = [{ ...disc(g, n.x, n.y + n.r + 6.5, 0, -200), hero: h }];
      g.step(1 / 60);
      g.S.discs = [];
      return g.S.floats.map(f => shown(f.txt));
    };
    // a fallen hero gets none; one nearly full gets only what is still missing
    c.hp = 0;
    a.sparks = 2;
    // a hard hit gives two, for everyone, and the crystal loses the two that b took
    expect(hit(b)).toContain('+2 искры всем');
    expect([a.sparks, b.sparks, c.sparks, n.left]).toEqual([AB_COST, 2, 0, 1]);
    // a full hero's disc still fills the others, with the crystal's last spark
    expect(hit(a)).toContain('+1 искра всем');
    expect([a.sparks, b.sparks, c.sparks, n.left]).toEqual([AB_COST, AB_COST, 0, 0]);
    // a hit that finds everyone full takes nothing from a fresh crystal
    n.left = AB_COST;
    expect(hit(b)).toContain('искры полны');
    expect(n.left).toBe(AB_COST);
    // each spends only its own
    expect(g.canUseAbility(a)).toBe(true);
    g.useAbility(a);
    expect([a.sparks, b.sparks]).toEqual([0, AB_COST]);
    expect(g.canUseAbility(b)).toBe(true);
  });

  it('online, a crystal one player hits fills the sparks on every screen', () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([0, 2]);
    host.online = true;
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    placeAll(host);
    host.startFight(host.heroOf(0)); host.startFight(host.heroOf(2));
    const n = { k: 'spk' as const, name: 'Кристалл искр', r: 6, ch: 3, x: 88, y: 88, left: 3, hit: 0 };
    host.S.nodes = [n]; host.S.blocks = [];
    host.S.discs = [{ ...disc(host, n.x, n.y + n.r + 6.5, 0, -200), hero: host.heroOf(2) }];
    host.step(1 / 60);
    cli.online = true;
    cli.canControl = o => o.i === 0;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect([cli.heroOf(0).sparks, cli.heroOf(2).sparks]).toEqual([2, 2]);
    // and they come along into the next room on every screen
    host.loadRoom({ seed: 22, depth: 3, floor: 0, type: 'fight' });
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect([cli.heroOf(0).sparks, cli.heroOf(2).sparks]).toEqual([2, 2]);
  });

  it('a crystal holds one ability: soft hits take a spark each, and it keeps what a hero had no room for', () => {
    const g = new Game();
    g.party = newParty([1]);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('archer', 40, 30, 1, 0)];
    g.S.nodes = []; g.S.blocks = [];
    placeAll(g); g.startFight();
    const h = g.party[0], n = { k: 'spk' as const, name: 'Кристалл искр', r: 6, ch: AB_COST, x: 88, y: 88, left: AB_COST, hit: 0 };
    g.S.nodes = [n];
    // Ricochet's light disc hits softly: a spark a hit, three hits for the crystal's three
    const hit = () => { g.S.discs = [{ ...disc(g, n.x, n.y + n.r + 6.5, 0, -200), m: h.def.m, hero: h }]; g.step(1 / 60); g.S.discs = []; };
    for (let k = 1; k <= AB_COST; k++) {
      hit();
      expect([h.sparks, n.left]).toEqual([k, AB_COST - k]);
    }
    // a hero one spark short takes one, and the rest waits for the ability to be spent
    n.left = AB_COST;
    h.sparks = AB_COST - 1;
    hit();
    expect([h.sparks, n.left]).toEqual([AB_COST, AB_COST - 1]);
    hit();
    expect([h.sparks, n.left]).toEqual([AB_COST, AB_COST - 1]);
  });

  it('a lone hero\'s spark crystal says nothing about the others', () => {
    const g = new Game();
    g.party = newParty([1]);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('archer', 40, 30, 1, 0)];
    g.S.nodes = []; g.S.blocks = [];
    placeAll(g); g.startFight();
    const n = { k: 'spk' as const, name: 'Кристалл искр', r: 6, ch: 3, x: 88, y: 88, left: 3, hit: 0 };
    g.S.nodes = [n];
    g.S.discs = [{ ...disc(g, n.x, n.y + n.r + 6.5, 0, -200), hero: g.party[0] }];
    g.step(1 / 60);
    expect(g.S.floats.map(f => shown(f.txt))).toContain('+2 искры');
    expect(g.party[0].sparks).toBe(2);
  });

  it('a resource soaks up the disc, so collecting costs the throw', () => {
    const g = arena(['archer']);
    const n = { k: 'ore' as const, name: 'Рудная жила', r: 7, ch: 3, x: 88, y: 88, left: 3, hit: 0 };
    g.S.nodes = [n];
    const d = disc(g, n.x, n.y + TILE / 2 + 5.5, 0, -200);
    g.S.discs = [d];
    g.step(1 / 60);
    expect(g.bank.ore).toBeGreaterThan(0);
    expect(Math.hypot(d.vx, d.vy)).toBeLessThan(200 * NODE_E + 5);
    expect(d.hits).toBe(1);
  });
});

describe('hero abilities work through the discs', () => {
  /** A floor 0 fight with the given enemies along the top and nothing else in the room. */
  const arena = (kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, cellCentre(2 + i * 3, 1).x, cellCentre(2 + i * 3, 1).y, 1, 0));
    g.S.nodes = [];
    g.S.blocks = [];
    g.S.rock = [];
    g.S.pits = [];
    placeAll(g); g.startFight();
    return g;
  };
  const byKey = (g: Game, key: string) => g.party.find(h => h.def.key === key)!;
  /** A disc of hero h rolling straight up into mob m from just below it. */
  const into = (g: Game, h: ReturnType<typeof byKey>, m: { x: number; y: number; r: number }, ab: boolean, v = 200) => {
    const d = { hero: h, x: m.x, y: m.y + m.r + h.def.r + 1, vx: 0, vy: -v, r: h.def.r, m: g.stat(h, 'm'), e: g.stat(h, 'e'), fr: h.def.fr,
      fall: 0, gone: false, charged: false, bounces: 1, spin: 0, hits: 0, ab, rico: ab && h.def.key === 'ricochet' ? AB_BOUNCES : 0 };
    g.S.discs.push(d);
    return d;
  };

  it('goes on before a throw, costs the hero\'s own sparks, and lasts to the end of the turn', () => {
    const g = arena(['archer']), h = byKey(g, 'bastion'), other = byKey(g, 'ash');
    expect(g.canUseAbility(h)).toBe(false);
    h.sparks = AB_COST;
    // sparks are the hero's own: the others can't spend them
    expect(g.canUseAbility(other)).toBe(false);
    g.useAbility(h);
    expect(h.boost).toBe(true);
    expect(h.sparks).toBe(0);
    // once a turn: a second press would only waste sparks
    h.sparks = AB_COST;
    expect(g.canUseAbility(h)).toBe(false);
    g.throwDisc(h, 0, -40);
    expect(g.S.discs[0].ab).toBe(true);
    // a hero with no disc left in hand has nothing to carry it
    other.sparks = AB_COST;
    g.throwDisc(other, 0, -40);
    expect(g.canUseAbility(other)).toBe(false);
    const t0 = g.S.turn;
    for (const o of g.party) o.hp = o.max = 99;
    endAll(g);
    for (let k = 0; k < 4000 && g.S.turn === t0; k++) g.update(1 / 60);
    expect(g.S.turn).toBe(t0 + 1);
    expect(h.boost).toBe(false);
  });

  it('Bastion: every hit of his disc on an enemy shields the whole party', () => {
    const g = arena(['skel', 'skel']), h = byKey(g, 'bastion'), [a, b] = g.S.mobs;
    into(g, h, a, false);
    g.step(1 / 120);
    expect(g.party.map(o => o.shield)).toEqual([0, 0, 0]);
    into(g, h, b, true);
    g.step(1 / 120);
    expect(g.party.map(o => o.shield)).toEqual([AB_SHIELD, AB_SHIELD, AB_SHIELD]);
  });

  it('Ash: her hits pile fire on an enemy, it burns that much at its move and dies down by one', () => {
    const g = arena(['golem', 'archer']), h = byKey(g, 'ash'), [m] = g.S.mobs;
    m.hp = m.max = 200;
    into(g, h, m, true);
    g.step(1 / 120);
    g.S.discs = [];
    into(g, h, m, true);
    g.step(1 / 120);
    expect(m.burn).toBe(AB_BURN * 2);
    // fire goes through armour: the golem's 3 doesn't stop it
    for (const o of g.party) o.hp = o.max = 99;
    endAll(g);
    g.S.discs = [];
    const hp = m.hp;
    for (let k = 0; k < 4000 && !(g.S.phase === 'enemy' && g.S.actor === 0); k++) g.update(1 / 60);
    expect(hp - m.hp).toBe(AB_BURN * 2);
    expect(m.burn).toBe(AB_BURN * 2 - 1);
  });

  it('Ash: fire on an enemy that falls leaps onto the nearest one still standing', () => {
    const g = arena(['rat', 'archer', 'skel']), h = byKey(g, 'ash'), [rat, near, far] = g.S.mobs;
    rat.hp = 1;
    into(g, h, rat, true);
    g.step(1 / 120);
    expect(rat.hp).toBeLessThanOrEqual(0);
    expect(near.burn).toBe(AB_BURN);
    expect(far.burn).toBe(0);
  });

  it('Ricochet: a disc thrown with it bounces at least the promised number of times, even a soft throw', () => {
    const bounces = (ab: boolean) => {
      const g = arena(['archer']), h = byKey(g, 'ricochet');
      g.S.mobs[0].x = g.S.mobs[0].y = 8; // out of the way, in the corner
      h.sparks = AB_COST;
      if (ab) g.useAbility(h);
      g.throwDisc(h, 0.3, -5);
      const d = g.S.discs[0];
      for (let k = 0; k < 60 * 60 && g.moving(); k++) g.update(1 / 60);
      return d.bounces + d.hits;
    };
    expect(bounces(false)).toBeLessThan(2);
    expect(bounces(true)).toBeGreaterThanOrEqual(AB_BOUNCES);
  });

  it('Ricochet: with sure bounces left the disc comes off an enemy at full speed', () => {
    const g = arena(['skel']), h = byKey(g, 'ricochet'), [m] = g.S.mobs;
    const plain = into(g, h, m, false, 300);
    g.step(1 / 120);
    expect(Math.hypot(plain.vx, plain.vy)).toBeLessThan(150);
    g.S.discs = [];
    m.hp = m.max = 99;
    const sure = into(g, h, m, true, 300);
    g.step(1 / 120);
    expect(Math.hypot(sure.vx, sure.vy)).toBeGreaterThanOrEqual(Math.min(300, AB_SPEED) - 1);
    expect(sure.vy).toBeGreaterThan(0);
    expect(sure.rico).toBe(AB_BOUNCES - 1);
  });

  it('Ricochet: a disc thrown with it rolls over the holes the whole way, on every screen, and the aim line runs on over them', () => {
    /** A disc of Ricochet's rolling right along row 4 over a hole at (6, 4); `rico` sure bounces left. */
    const lay = (ab: boolean, rico = ab ? AB_BOUNCES : 0) => {
      const g = arena(['archer']), h = byKey(g, 'ricochet');
      g.S.mobs[0].x = g.S.mobs[0].y = 8; // out of the way, in the corner
      g.S.pits = [{ k: '1x1', cells: [[6, 4]] }];
      g.S.discs = [{ hero: h, x: 4 * TILE, y: 4.5 * TILE, vx: 250, vy: 0, r: h.def.r, m: g.stat(h, 'm'), e: g.stat(h, 'e'), fr: h.def.fr,
        fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab, rico }];
      return { g, h, hp: h.hp, d: g.S.discs[0] };
    };
    const roll = (g: Game, d: Disc) => {
      let far = d.x;
      for (let k = 0; k < 240 && !d.fall; k++) { g.step(1 / 120); far = Math.max(far, d.x); }
      return far;
    };
    const plain = lay(false);
    roll(plain.g, plain.d);
    expect(plain.d.fall).toBeGreaterThan(0);
    expect(plain.h.hp).toBe(plain.hp - 2);
    // with sure bounces left, and with them all spent: over the hole and on
    for (const rico of [AB_BOUNCES, 0]) {
      const { g, h, hp, d } = lay(true, rico);
      expect(roll(g, d)).toBeGreaterThan(7 * TILE);
      expect(d.fall).toBe(0);
      expect(h.hp).toBe(hp);
    }
    // an online client plays the same disc on from the host's state, over the hole too
    const host = lay(true), cli = new Game();
    cli.online = true;
    cli.send = () => {};
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host.g))));
    // the client builds the room from its seed: clear it as the host's was
    Object.assign(cli.S, { pits: host.g.S.pits, blocks: [], rock: [], nodes: [] });
    const cd = cli.S.discs[0];
    expect(roll(cli, cd)).toBeGreaterThan(7 * TILE);
    expect(cd.fall).toBe(0);
    // stopped right over the hole, the disc stays up, and once the turn is over Ricochet hops to the floor beside it
    const still = lay(true, 0);
    Object.assign(still.d, cellCentre(6, 4), { vx: 0, vy: 0, hits: 1 });
    endAll(still.g);
    for (let k = 0; k < 100 && still.g.S.phase === 'throw'; k++) still.g.update(1 / 60);
    expect(still.d.fall).toBe(0);
    const at = still.g.spot(still.h)!;
    expect(pitAt(still.g.S.pits, at.x, at.y)).toBeUndefined();
    expect(Math.hypot(at.x - still.d.x, at.y - still.d.y)).toBeLessThan(1.5 * TILE);
    // the aim line: it stops at the hole, with the ability on it runs over it
    const aim = (ab: boolean) => {
      const g = arena(['archer']), h = byKey(g, 'ricochet'), p = g.spot(h)!, i = Math.floor(p.x / TILE), j = Math.floor(p.y / TILE) - 2;
      g.S.mobs = [];
      g.S.pits = [{ k: '1x1', cells: [[i, j]] }];
      h.boost = ab;
      const pr = g.predict(h, 0, -40, 0);
      return pr.path[pr.path.length - 1][1] - j * TILE;
    };
    expect(aim(false)).toBeGreaterThan(0);
    expect(aim(true)).toBeLessThan(0);
  });

  it('online, a client asks the host for its ability and sees it on, and the fire on the enemies', () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([0, 2]);
    host.online = true;
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    placeAll(host);
    host.startFight(host.heroOf(0)); host.startFight(host.heroOf(2));
    const sent: Action[] = [];
    cli.online = true;
    cli.send = a => sent.push(a);
    cli.canControl = o => o.i === 2;
    host.heroOf(2).sparks = AB_COST;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.heroOf(2).sparks).toBe(AB_COST);
    expect(cli.heroOf(0).sparks).toBe(0);
    cli.useAbility(cli.heroOf(2));
    expect(cli.heroOf(2).boost).toBe(false);
    expect(sent).toEqual([{ k: 'ability', h: 2 }]);
    host.perform(sent[0]);
    host.S.mobs[0].burn = 5;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.heroOf(2).boost).toBe(true);
    expect(cli.heroOf(2).sparks).toBe(0);
    expect(cli.S.mobs[0].burn).toBe(5);
  });
});

describe('the heroes past the first three', () => {
  const at = (key: string) => HEROES.findIndex(d => d.key === key);
  /** A floor 0 fight for the given heroes, the given enemies at the given cells and nothing else in the room. */
  const arena = (picks: number[], mobs: [keyof typeof MOBS, number, number][]) => {
    const g = new Game();
    g.party = newParty(picks);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = mobs.map(([k, i, j]) => newMob(k, cellCentre(i, j).x, cellCentre(i, j).y, 1, 0));
    g.S.nodes = []; g.S.blocks = []; g.S.rock = []; g.S.pits = [];
    g.S.haz = new Set();
    placeAll(g); g.startFight();
    for (const m of g.S.mobs) m.hp = m.max = 99;
    return g;
  };
  /** A disc of hero h rolling straight up into mob m from just below it. */
  const into = (g: Game, h: HeroState, m: { x: number; y: number; r: number }, ab: boolean, v = 200) => {
    const d = { id: 900 + g.S.discs.length, hero: h, x: m.x, y: m.y + m.r + h.def.r + 1, vx: 0, vy: -v, r: h.def.r, m: g.stat(h, 'm'), e: g.stat(h, 'e'), fr: h.def.fr,
      fall: 0, gone: false, charged: false, bounces: 1, spin: 0, hits: 0, ab, rico: 0 };
    g.S.discs.push(d);
    return d;
  };

  it('twelve heroes to pick from, each with its own colour, disc and ability, four of each kind; online still three seats', () => {
    // new heroes go on the end, so the saves' hero numbers keep meaning the same heroes
    expect(HEROES.map(d => d.key)).toEqual(['bastion', 'ricochet', 'ash', 'cook', 'sharp', 'electra', 'kid', 'bum', 'genius', 'bouncer', 'cop', 'model']);
    // the pick screens lay them out a row per disc size, the biggest first: four «толстяки», four «чуваки», four «дрищи»
    expect(KINDS.map(k => k.row)).toEqual(['Толстяки', 'Чуваки', 'Дрищи']);
    expect(heroesByKind().map(row => row.map(i => HEROES[i].key))).toEqual([['bastion', 'cook', 'bouncer', 'cop'], ['ash', 'electra', 'bum', 'genius'], ['ricochet', 'sharp', 'kid', 'model']]);
    expect(heroesByKind().flat().length).toBe(HEROES.length);
    // a heroine's card says it her way
    expect(HEROES.map(kindOf)).toEqual(['Толстяк', 'Дрищ', 'Чувиха', 'Толстуха', 'Дрищ', 'Чувиха', 'Дрищ', 'Чувак', 'Чувак', 'Толстяк', 'Толстяк', 'Дрищ']);
    expect(new Set(HEROES.map(d => d.col)).size).toBe(HEROES.length);
    expect(new Set(HEROES.map(d => d.ab)).size).toBe(HEROES.length);
    expect(HEROES[at('electra')].fem && HEROES[at('cook')].fem && !HEROES[at('sharp')].fem && !HEROES[at('bum')].fem).toBe(true);
    // the kid is a child: the only figure shorter than the grown-ups
    expect(HEROES.filter(d => heroFig(d) < HERO_FIG).map(d => d.key)).toEqual(['kid']);
    // the cook is the tank: the most health of all
    expect(HEROES[at('cook')].hp).toBe(Math.max(...HEROES.map(d => d.hp)));
    expect(MAX_PLAYERS).toBe(3);
    // the campaign's party and the tests' default stay the old trio
    expect(newParty().map(h => h.def.key)).toEqual(['bastion', 'ricochet', 'ash']);
  });

  it('Electra: her hit strikes lightning that leaps to the nearest enemies, weaker each time, through armour', () => {
    // a golem struck, a skeleton two cells off, an archer two past that, a rat out of reach far away
    const g = arena([at('electra')], [['golem', 2, 1], ['skel', 4, 1], ['archer', 6, 1], ['rat', 2, 8]]);
    const h = g.party[0], [golem, skel, archer, rat] = g.S.mobs;
    expect(Math.hypot(rat.x - archer.x, rat.y - archer.y)).toBeGreaterThan(ZAP_REACH);
    const d = into(g, h, golem, true);
    g.step(1 / 120);
    const hit = Math.ceil((d.m * 200) / 120);
    expect(golem.max - golem.hp).toBe(hit - 0 + ZAP[0]);
    expect(skel.max - skel.hp).toBe(ZAP[1]);
    expect(archer.max - archer.hp).toBe(ZAP[2]);
    expect(rat.hp).toBe(rat.max);
    expect(g.S.zaps.length).toBe(3);
    // without the ability her disc is just a disc
    const g2 = arena([at('electra')], [['skel', 2, 1], ['skel', 4, 1]]);
    into(g2, g2.party[0], g2.S.mobs[0], false);
    g2.step(1 / 120);
    expect(g2.S.mobs[1].hp).toBe(g2.S.mobs[1].max);
    expect(g2.S.zaps).toEqual([]);
  });

  it('Electra: when the disc fells the enemy, the lightning starts from it and its first stroke goes to the next', () => {
    const g = arena([at('electra')], [['rat', 2, 1], ['skel', 4, 1], ['archer', 7, 1]]);
    const [rat, skel, archer] = g.S.mobs;
    rat.hp = 1;
    into(g, g.party[0], rat, true);
    g.step(1 / 120);
    expect(rat.hp).toBeLessThanOrEqual(0);
    expect(skel.max - skel.hp).toBe(ZAP[0]);
    expect(archer.max - archer.hp).toBe(ZAP[1]);
  });

  it('the cook: her disc drops a dish at each of its first bounces, and a hurt hero\'s disc eats it', () => {
    const g = arena([at('cook'), at('ricochet')], [['archer', 1, 1]]);
    const [cook, rico] = g.party;
    cook.sparks = AB_COST;
    g.useAbility(cook);
    // a lively disc of hers rolling along a row: off the far wall, back and off the near one, many times
    g.throwDisc(cook, 60, 0);
    const d = g.S.discs[0];
    expect(d.ab).toBe(true);
    Object.assign(d, { vx: 420, vy: 0, e: 0.95 });
    for (let k = 0; k < 60 * 30 && g.moving(); k++) g.update(1 / 60);
    expect(d.bounces).toBeGreaterThan(FOOD_PER_DISC);
    expect(g.S.food).toHaveLength(FOOD_PER_DISC);
    for (const f of g.S.food) {
      expect(f.t).toBe(FOOD_FLY);
      expect(isFloor(g.S, Math.floor(f.x / TILE), Math.floor(f.y / TILE))).toBe(true);
      // each dish lies in the middle of a cell, one to a cell
      expect(cellCentre(...cellAt(f.x, f.y))).toEqual({ x: f.x, y: f.y });
      expect(f.by).toBe(d.id);
    }
    expect(new Set(g.S.food.map(f => hazKey(...cellAt(f.x, f.y)))).size).toBe(FOOD_PER_DISC);
    // the cook's own disc rolled over its dishes and left them; a hurt Ricochet's disc eats one
    const f = g.S.food[0];
    g.S.food = [f];
    rico.hp = rico.max - 5;
    const full = { ...d, id: 77, hero: cook, x: f.x - 20, y: f.y, vx: 120, vy: 0, gone: false, held: false, food: 0, ab: false };
    cook.hp = cook.max;
    g.S.discs = [full];
    for (let k = 0; k < 30; k++) g.step(1 / 120);
    expect(g.S.food).toHaveLength(1);
    g.S.discs = [{ ...full, id: 78, hero: rico, x: f.x - 20, y: f.y, vx: 120, vy: 0, r: rico.def.r }];
    for (let k = 0; k < 30; k++) g.step(1 / 120);
    expect(rico.hp).toBe(rico.max - 5 + FOOD_HEAL);
    expect(g.S.food).toHaveLength(0);
  });

  it('the cook: her disc drops a dish off ore, a crystal or mushrooms too', () => {
    for (const k of ['ore', 'spk', 'herb'] as const) {
      const g = arena([at('cook')], [['archer', 1, 1]]);
      const cook = g.party[0], c = cellCentre(5, 5), n = { k, name: k, r: 7, ch: 3, x: c.x, y: c.y, left: 3, hit: 0 };
      g.S.nodes = [n];
      // a soft touch as well as a hard hit: both are bounces
      for (const v of [20, 200]) {
        g.S.food = [];
        const d = into(g, cook, n, true, v);
        // already touching, so even a slow disc meets the resource before it stops
        d.y -= 1.5;
        g.S.discs = [d];
        g.step(1 / 120);
        expect(d.vy).toBeGreaterThan(0);
        expect(g.S.food).toHaveLength(1);
        expect(g.S.food[0].by).toBe(d.id);
      }
    }
  });

  it('the cook: a dish flung at a cell already holding one lands on the free cell beside it, never on anything standing', () => {
    const g = arena([at('cook')], [['skel', 9, 1]]), cook = g.party[0];
    const drop = (d: object, nx: number, ny: number) => (g as unknown as { dropFood: (d: object, nx: number, ny: number) => void }).dropFood(d, nx, ny);
    // her disc bounces three times on the same spot, one cell left of the cell (4, 4), which the dishes fly toward
    const c = cellCentre(4, 4), d = { id: 5, hero: cook, x: c.x - 16, y: c.y, food: 0 };
    for (let k = 0; k < FOOD_PER_DISC; k++) drop(d, 1, 0);
    const cells = g.S.food.map(f => cellAt(f.x, f.y));
    expect(cells[0]).toEqual([4, 4]);
    expect(new Set(cells.map(q => hazKey(...q))).size).toBe(FOOD_PER_DISC);
    for (const [i, j] of cells) expect(Math.max(Math.abs(i - 4), Math.abs(j - 4))).toBeLessThanOrEqual(1);
    // an enemy on that cell, spikes above and below it, a hole right of it and a hero left of it: the dish goes
    // to a corner cell beside it
    g.S.food = [];
    const m = g.S.mobs[0];
    m.x = m.tx = c.x; m.y = m.ty = c.y;
    g.S.haz = new Set([hazKey(4, 3), hazKey(4, 5)]);
    g.S.pits = [{ k: '1x1', cells: [[5, 4]] }];
    cook.at = cellCentre(3, 4);
    drop({ ...d, food: 0 }, 1, 0);
    expect(g.S.food).toHaveLength(1);
    const [i, j] = cellAt(g.S.food[0].x, g.S.food[0].y);
    expect([Math.abs(i - 4), Math.abs(j - 4)]).toEqual([1, 1]);
    // with every cell around taken there's nowhere to put one, and nothing drops
    g.S.food = [];
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) g.S.haz.add(hazKey(4 + a, 4 + b));
    drop({ ...d, food: 0 }, 1, 0);
    expect(g.S.food).toEqual([]);
  });

  it('the cook: dishes travel to the other screens with the snapshot', () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([at('cook'), 0]);
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    host.S.food = [{ x: 40, y: 40, fx: 30, fy: 40, k: 2, by: 5, t: FOOD_FLY }];
    cli.send = () => {};
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.S.food).toEqual(host.S.food);
  });

  it('the card sharp: with his ability a throw fans out three discs for one from the hand, the side ones weaker', () => {
    const g = arena([at('sharp')], [['archer', 1, 1]]), h = g.party[0];
    h.discs = h.hand = 2;
    g.throwDisc(h, 0, -40);
    expect(g.S.discs).toHaveLength(1);
    g.S.discs[0].gone = true;
    h.sparks = AB_COST;
    g.useAbility(h);
    g.throwDisc(h, 0, -40);
    expect(h.hand).toBe(0);
    const fan = g.S.discs.slice(1);
    expect(fan).toHaveLength(3);
    const [l, r, mid] = fan;
    expect([l.fan, r.fan, mid.fan]).toEqual([true, true, undefined]);
    expect(l.m).toBeCloseTo(mid.m * FAN_M, 6);
    // the side ones are phantoms, smaller than his disc
    expect(mid.r).toBe(h.def.r);
    expect(l.r).toBeCloseTo(h.def.r * FAN_R, 6);
    expect(r.r).toBeCloseTo(h.def.r * FAN_R, 6);
    expect(new Set(fan.map(d => d.vol)).size).toBe(1);
    const ang = (d: typeof mid) => Math.atan2(d.vy, d.vx);
    expect(Math.abs(ang(l) - ang(mid))).toBeCloseTo(FAN_ANGLE, 6);
    expect(Math.abs(ang(r) - ang(mid))).toBeCloseTo(FAN_ANGLE, 6);
    // launched from one point they would knock each other aside: a fan's discs pass through each other
    const v = fan.map(d => [d.vx, d.vy]);
    g.step(1 / 120);
    fan.forEach((d, k) => expect(Math.atan2(d.vy, d.vx)).toBeCloseTo(Math.atan2(v[k][1], v[k][0]), 6));
    // after the throws he goes over to the middle disc, the one he aimed
    expect(g.S.discs.filter(d => d.hero === h).pop()).toBe(mid);
  });

  it('the card sharp: a phantom that drops into a hole or stops on spikes costs him no health, his own disc still does', () => {
    const g = arena([at('sharp')], [['archer', 1, 1]]), h = g.party[0], hp = h.hp;
    const disc = (i: number, j: number, vx: number, fan: boolean) => ({ hero: h, ...cellCentre(i, j), vx, vy: 0, r: h.def.r * (fan ? FAN_R : 1), m: 1, e: 0.8, fr: 1,
      fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: true, rico: 0, ...(fan ? { fan } : {}) });
    g.S.pits = [{ k: '1x1', cells: [[6, 4]] }];
    g.S.haz = new Set([hazKey(8, 6)]);
    const fell = disc(4, 4, 200, true), spiked = disc(8, 6, 0, true);
    g.S.discs = [fell, spiked, disc(3, 6, 0, false)];
    for (let k = 0; k < 120 && !fell.fall; k++) g.step(1 / 120);
    expect(fell.fall).toBeGreaterThan(0);
    g.endTurn(h);
    for (let k = 0; k < 120 && g.S.phase === 'throw'; k++) g.update(1 / 60);
    expect(g.S.phase).toBe('resolve');
    expect(h.hp).toBe(hp);
    expect(g.S.floats.some(f => f.txt === 'шипы!' || f.txt === 'провал')).toBe(false);
    // the same two places under his own disc hurt
    const o = arena([at('sharp')], [['archer', 1, 1]]), oh = o.party[0];
    o.S.pits = [{ k: '1x1', cells: [[6, 4]] }];
    const own = { ...disc(4, 4, 200, false), hero: oh };
    o.S.discs = [own];
    for (let k = 0; k < 120 && !own.fall; k++) o.step(1 / 120);
    expect(oh.hp).toBe(hp - 2);
    o.S.haz = new Set([hazKey(8, 6)]);
    o.S.discs = [{ ...disc(8, 6, 0, false), hero: oh }];
    o.endTurn(oh);
    for (let k = 0; k < 120 && o.S.phase === 'throw'; k++) o.update(1 / 60);
    expect(oh.hp).toBe(hp - 2 - o.S.biome.hazDmg);
  });

  /** Ends the heroes' turn and plays the enemies' out, to the start of the next turn. */
  const turn = (g: Game) => {
    const t = g.S.turn;
    g.S.discs = [];
    endAll(g);
    for (let k = 0; k < 4000 && g.S.turn === t; k++) g.update(1 / 60);
  };

  it('the kid: his disc drops one firecracker, at its first bounce off a wall, where the cook\'s would drop a dish', () => {
    const g = arena([at('kid')], [['archer', 1, 1]]), kid = g.party[0];
    kid.sparks = AB_COST;
    g.useAbility(kid);
    g.throwDisc(kid, 60, 0);
    const d = g.S.discs[0];
    expect(d.ab).toBe(true);
    Object.assign(d, { vx: 420, vy: 0, e: 0.95 });
    for (let k = 0; k < 60 * 30 && g.moving(); k++) g.update(1 / 60);
    expect(d.bounces).toBeGreaterThan(1);
    expect(g.S.bombs).toHaveLength(1);
    const [b] = g.S.bombs;
    expect(b.t).toBe(FOOD_FLY);
    expect(cellCentre(...cellAt(b.x, b.y))).toEqual({ x: b.x, y: b.y });
    expect([b.by, b.h, b.left]).toEqual([d.id, kid.i, PETARD_TURNS]);
    expect(g.S.food).toEqual([]);
  });

  it('the kid: one firecracker on the field at a time, and nobody coming, it fizzles out after three enemy turns', () => {
    const g = arena([at('kid')], [['archer', 1, 1]]), kid = g.party[0];
    kid.hp = kid.max = 99;
    kid.hand = 2;
    kid.sparks = 2 * AB_COST;
    g.useAbility(kid);
    // two discs this turn, both bouncing round the room: only the first lays one
    const bounce = () => {
      g.throwDisc(kid, 60, 0);
      Object.assign(g.S.discs[g.S.discs.length - 1], { vx: 420, vy: 0, e: 0.95 });
      for (let k = 0; k < 60 * 30 && g.moving(); k++) g.update(1 / 60);
    };
    bounce();
    const first = g.S.bombs[0];
    bounce();
    expect(g.S.bombs).toEqual([first]);
    // far from the archer, nobody comes
    Object.assign(first, cellCentre(9, 2));
    expect(PETARD_TURNS).toBe(3);
    for (const left of [2, 1]) {
      turn(g);
      expect(g.S.bombs.map(o => o.left)).toEqual([left]);
    }
    turn(g);
    expect(g.S.bombs).toEqual([]);
    expect(g.S.floats.some(f => f.txt === 'пшик')).toBe(true);
  });

  it('the kid: switched on again, his ability moves the firecracker, which lasts three turns from there', () => {
    const g = arena([at('kid')], [['skel', 1, 1]]), kid = g.party[0], [skel] = g.S.mobs;
    kid.hp = kid.max = 99;
    const old = { ...cellCentre(9, 2), fx: 0, fy: 0, h: kid.i, t: FOOD_FLY - 1e-6, left: 1, turn: 0 };
    g.S.bombs = [old];
    g.step(1 / 120);
    expect(skel.intent!.bang).toEqual(cellCentre(9, 2));
    // the ability goes on with one lying there
    kid.sparks = AB_COST;
    expect(g.canUseAbility(kid)).toBe(true);
    g.useAbility(kid);
    g.throwDisc(kid, 60, 0);
    const d = g.S.discs[0];
    Object.assign(d, { vx: 420, vy: 0, e: 0.95 });
    for (let k = 0; k < 60 * 30 && g.moving(); k++) g.update(1 / 60);
    // the old one is gone, the new one lies where this disc dropped it
    expect(g.S.bombs).toHaveLength(1);
    const [b] = g.S.bombs;
    expect(b).not.toBe(old);
    expect([b.by, b.left, b.turn]).toEqual([d.id, PETARD_TURNS, g.S.turn]);
    // the skeleton it drew now goes for the new one
    expect(skel.intent!.bang).toEqual({ x: b.x, y: b.y });
    turn(g);
    expect(g.S.bombs.map(o => o.left)).toEqual([PETARD_TURNS - 1]);
  });

  it('the kid: a bounce off an enemy drops no firecracker, one off another disc does', () => {
    const g = arena([at('kid'), at('cook')], [['skel', 5, 3]]), [kid, cook] = g.party, [skel] = g.S.mobs;
    const d = into(g, kid, skel, true);
    g.step(1 / 120);
    expect(d.vy).toBeGreaterThan(0);
    expect(g.S.bombs).toEqual([]);
    // his disc runs into the cook's lying still in the middle of the room
    const c = cellCentre(5, 6);
    g.S.discs = [];
    const rest = into(g, cook, { ...c, r: cook.def.r }, false, 0);
    Object.assign(rest, { x: c.x, y: c.y });
    const hit = into(g, kid, rest, true);
    for (let k = 0; k < 3; k++) g.step(1 / 120);
    expect(g.S.bombs).toHaveLength(1);
    expect(g.S.bombs[0].by).toBe(hit.id);
  });

  it('the kid: in the enemies\' turn a firecracker goes off on the first enemy within a cell of it, and only that one is hurt', () => {
    const g = arena([at('kid')], [['skel', 7, 5], ['king', 2, 2], ['archer', 5, 9]]), kid = g.party[0];
    const [skel, king, archer] = g.S.mobs;
    const put = (m: Mob, i: number, j: number) => { const c = cellCentre(i, j, mobSize(m.k)); m.x = m.tx = c.x; m.y = m.ty = c.y; };
    put(king, 2, 2);
    g.S.bombs = [{ ...cellCentre(5, 5), fx: 0, fy: 0, h: kid.i, t: FOOD_FLY, left: PETARD_TURNS, turn: 0 }];
    // in the heroes' turn it only crackles, even with an enemy right by it
    put(skel, 6, 5);
    g.step(1 / 120);
    expect(g.S.bombs).toHaveLength(1);
    g.S.phase = 'enemy';
    put(skel, 7, 5);
    // two cells off is out of its reach
    g.step(1 / 120);
    expect(g.S.bombs).toHaveLength(1);
    // the skeleton steps right next to it, the big king's corner a cell off on the slant: it goes off on the nearer
    // skeleton alone, and the archer far off doesn't feel it either
    put(skel, 6, 5);
    put(king, 3, 3);
    g.step(1 / 120);
    expect(g.S.bombs).toEqual([]);
    expect([skel.hp, king.hp, archer.hp]).toEqual([99 - PETARD_DMG, 99, 99]);
    // the king alone by one: it goes off on him, through his armour
    g.S.bombs = [{ ...cellCentre(5, 5), fx: 0, fy: 0, h: kid.i, t: FOOD_FLY, left: PETARD_TURNS, turn: 0 }];
    put(skel, 8, 5);
    g.step(1 / 120);
    expect(g.S.bombs).toEqual([]);
    expect([skel.hp, king.hp]).toEqual([99 - PETARD_DMG, 99 - PETARD_DMG]);
    put(skel, 6, 5);
    put(king, 2, 2);
    expect(g.S.floats.some(f => f.txt === 'БАХ!')).toBe(true);
    // still in the air it doesn't go off, only as it lands
    g.S.bombs = [{ ...cellCentre(5, 5), fx: cellCentre(5, 2).x, fy: cellCentre(5, 2).y, h: kid.i, t: 0, left: PETARD_TURNS, turn: 0 }];
    g.step(1 / 120);
    expect(g.S.bombs).toHaveLength(1);
    for (let k = 0; k < 120 && g.S.bombs.length; k++) g.step(1 / 120);
    expect(g.S.bombs).toEqual([]);
    expect(skel.hp).toBe(99 - 2 * PETARD_DMG);
  });

  it('the kid: an enemy hears a firecracker from anywhere in the room, runs up and sets it off, and one it fells stops where it fell', () => {
    // two cells off it or four, the rat hears it and runs to it, and across the room as well (below)
    for (const [far, hp] of [[4, 99], [4, PETARD_DMG], [6, 99]]) {
      const g = arena([at('kid')], [['rat', 1, 1]]), kid = g.party[0], [rat] = g.S.mobs;
      kid.hp = kid.max = 99;
      // the rat along the row, the firecracker two cells from the hero on its way
      const [i, j] = cellAt(g.spot(kid)!.x, g.spot(kid)!.y), dx = isFloor(g.S, i + 4, j) ? 1 : -1, start = cellCentre(i + far * dx, j);
      rat.x = rat.tx = start.x; rat.y = rat.ty = start.y; rat.hp = hp;
      g.pickIntents();
      g.S.bombs = [{ ...cellCentre(i + 2 * dx, j), fx: 0, fy: 0, h: kid.i, t: FOOD_FLY - 1e-6, left: PETARD_TURNS, turn: 0 }];
      g.step(1 / 120);
      expect(!!rat.intent!.bang).toBe(true);
      turn(g);
      expect(g.S.bombs).toEqual([]);
      if (hp > PETARD_DMG) {
        expect(rat.hp).toBe(hp - PETARD_DMG);
        expect(kid.hp).toBe(99);
        continue;
      }
      // felled a cell short of the firecracker, it lies there in the middle of its cell and never gets to bite
      expect(rat.hp).toBeLessThanOrEqual(0);
      expect(cellAt(rat.x, rat.y)).toEqual([i + 3 * dx, j]);
      expect(cellCentre(i + 3 * dx, j)).toEqual({ x: rat.x, y: rat.y });
      expect(kid.hp).toBe(99);
    }
  });

  it('the kid: a skeleton across the room hears the firecracker too, and walks to it turn by turn', () => {
    const g = arena([at('kid')], [['skel', 1, 1]]), kid = g.party[0], [skel] = g.S.mobs;
    kid.hp = kid.max = 99;
    // six cells off along the top: two cells a turn, it gets there on the last turn the firecracker lasts
    const b = cellCentre(7, 2);
    g.pickIntents();
    g.S.bombs = [{ ...b, fx: 0, fy: 0, h: kid.i, t: FOOD_FLY - 1e-6, left: PETARD_TURNS, turn: 0 }];
    g.step(1 / 120);
    expect(skel.intent!.bang).toEqual(b);
    turn(g);
    // still on its way the next turn, and still drawn
    expect(g.S.bombs).toHaveLength(1);
    expect(skel.intent!.bang).toEqual(b);
    for (let k = 0; k < 3 && g.S.bombs.length; k++) turn(g);
    expect(g.S.bombs).toEqual([]);
    expect(skel.hp).toBe(99 - PETARD_DMG);
    expect(kid.hp).toBe(99);
  });

  it('the kid: a firecracker draws the two enemies nearest it, and they strike nobody that turn', () => {
    const g = arena([at('kid')], [['skel', 9, 7], ['skel', 6, 6], ['skel', 8, 3], ['skel', 2, 2]]), kid = g.party[0];
    const [close, near, third, far] = g.S.mobs;
    kid.hp = kid.max = 99;
    // the hero in the corner, the first skeleton right by him and about to strike
    expect(cellAt(g.spot(kid)!.x, g.spot(kid)!.y)).toEqual([10, 8]);
    g.pickIntents();
    expect(close.intent!.t).toBe('hit');
    const blow = g.incoming(kid);
    expect(blow).toBeGreaterThan(0);
    // a firecracker lands two cells up the slant from him: the skeleton by him is a cell off it, the next two and three cells
    const b = cellCentre(8, 6);
    g.S.bombs = [{ ...b, fx: 0, fy: 0, h: kid.i, t: FOOD_FLY - 1e-6, left: PETARD_TURNS, turn: 0 }];
    g.step(1 / 120);
    expect(PETARD_LURE).toBe(2);
    expect([close, near, third, far].map(m => m.intent!.bang ?? null)).toEqual([b, b, null, null]);
    expect(close.intent).toMatchObject({ t: 'move', dmg: 0 });
    expect(g.incoming(kid)).toBe(0);
    turn(g);
    // the one by it set it off as the enemies' turn began, the other ran up to where it crackled
    expect(g.S.bombs).toEqual([]);
    expect([close.hp, near.hp, third.hp, far.hp]).toEqual([99 - PETARD_DMG, 99, 99, 99]);
    expect(kid.hp).toBe(99);
    const [ni, nj] = cellAt(near.x, near.y);
    expect(Math.max(Math.abs(ni - 8), Math.abs(nj - 6))).toBe(1);
    // with it gone they go for the hero again
    expect([close, near].map(m => m.intent!.bang)).toEqual([undefined, undefined]);
    expect(close.intent!.t).toBe('hit');
  });

  it('the kid: an enemy casting a spell goes on with it, past the crackle', () => {
    const g = arena([at('kid')], [['skel', 2, 2], ['skel', 5, 2], ['king', 7, 5]]), kid = g.party[0], [a, b, king] = g.S.mobs;
    g.pickIntents();
    king.intent = { t: 'slam', hero: -1, dmg: 3 };
    const p = cellCentre(4, 3);
    g.S.bombs = [{ ...p, fx: 0, fy: 0, h: kid.i, t: FOOD_FLY - 1e-6, left: PETARD_TURNS, turn: 0 }];
    g.step(1 / 120);
    expect([a.intent!.bang, b.intent!.bang]).toEqual([p, p]);
    expect(king.intent!.t).toBe('slam');
  });

  it('the bum: his disc lets out a cloud of gas at its first bounce, five cells across with the corners cut off', () => {
    const g = arena([at('bum')], [['skel', 6, 6]]), bum = g.party[0], [skel] = g.S.mobs;
    const d = into(g, bum, skel, true);
    g.step(1 / 120);
    // on the cell the disc bounced in, just under the skeleton
    expect(g.S.gas).toEqual([{ i: 6, j: 7, left: GAS_TURNS, t: 0 }]);
    expect(d).toMatchObject({ gas: true });
    let n = 0;
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) if (g.gasAt(6 + a, 7 + b)) n++;
    expect(n).toBe(21);
    expect([g.gasAt(8, 9), g.gasAt(8, 8), g.gasAt(6, 9), g.gasAt(9, 7)]).toEqual([false, true, true, false]);
    // without the ability, or on its later bounces, his disc lets nothing out
    g.S.discs = [];
    g.S.gas[0].left = 1;
    into(g, bum, skel, false);
    g.step(1 / 120);
    expect(g.S.gas[0].left).toBe(1);
    // a second cloud on the same cell starts its turns over instead of piling up
    g.S.discs = [];
    into(g, bum, skel, true);
    g.step(1 / 120);
    expect(g.S.gas).toEqual([{ i: 6, j: 7, left: GAS_TURNS, t: 0 }]);
  });

  it('the bum: an enemy in his gas strikes 30% weaker and chokes at the start of each move; the cloud lasts three turns', () => {
    // the gas takes 5% of an enemy's full health a move, rounded up, at least 1, a boss's too
    expect([gasDmg(99), gasDmg(28), gasDmg(20), gasDmg(4), gasDmg(235)]).toEqual([5, 2, 1, 1, 12]);
    const g = arena([at('bum')], [['archer', 6, 6]]), bum = g.party[0], [archer] = g.S.mobs;
    bum.hp = bum.max = 99;
    const full = archer.intent!.dmg;
    expect(archer.intent!.t).toBe('hit');
    into(g, bum, archer, true);
    g.step(1 / 120);
    expect(g.inGas(archer)).toBe(true);
    // the badge shows the weaker shot straight away
    const weak = Math.max(1, Math.round(full * (1 - GAS_WEAK)));
    expect(weak).toBeLessThan(full);
    expect(archer.intent!.dmg).toBe(weak);
    const hp = archer.hp;
    turn(g);
    expect(hp - archer.hp).toBe(gasDmg(archer.max));
    expect(bum.max - bum.hp).toBe(weak);
    expect(g.S.gas[0].left).toBe(GAS_TURNS - 1);
    turn(g);
    turn(g);
    expect(hp - archer.hp).toBe(GAS_TURNS * gasDmg(archer.max));
    expect(g.S.gas).toEqual([]);
    // the air clears and it shoots full again
    expect(archer.intent!.dmg).toBe(full + g.rage());
  });

  it('the ice genius: one hit of his disc slows an enemy to a cell on its next move, two freeze it for that turn', () => {
    /** His disc with the ability on hits m: from below, or from above if there's wall below it. */
    const hit = (g: Game, h: HeroState, m: Mob) => {
      g.S.discs = [];
      const d = into(g, h, m, true);
      if (!isFloor(g.S, ...cellAt(d.x, d.y))) { d.y = 2 * m.y - d.y; d.vy = -d.vy; }
      g.step(1 / 120);
    };
    const moved = (frost: number) => {
      const g = arena([at('genius')], frost >= 2 ? [['rat', 1, 1], ['archer', 1, 1]] : [['rat', 1, 1]]), h = g.party[0], [rat, archer] = g.S.mobs;
      h.hp = h.max = 99;
      // the rat six cells off along the row; once frozen, an archer halfway
      const [i, j] = cellAt(g.spot(h)!.x, g.spot(h)!.y), dx = isFloor(g.S, i + 6, j) ? 1 : -1;
      const put = (m: Mob, n: number) => { const c = cellCentre(i + n * dx, j); m.x = m.tx = c.x; m.y = m.ty = c.y; };
      put(rat, 6);
      if (archer) put(archer, 3);
      g.pickIntents();
      for (let k = 0; k < frost; k++) hit(g, h, rat);
      expect(rat.frost).toBe(frost || undefined);
      expect(g.frozen(rat)).toBe(frost >= 2);
      // a frozen shooter doesn't shoot: it counts for nothing on the hero's health bar
      if (frost >= 2) {
        for (let k = 0; k < 2; k++) hit(g, h, archer);
        expect(g.incoming(h)).toBe(0);
      }
      turn(g);
      const [ri] = cellAt(rat.x, rat.y);
      if (frost >= 2) {
        expect(h.hp).toBe(99);
        // the next turn the frost is gone and the archer shoots again
        expect([rat.frost, archer.frost]).toEqual([undefined, undefined]);
        expect(archer.intent!.t).toBe('hit');
        turn(g);
        expect(h.hp).toBeLessThan(99);
      }
      return Math.abs(ri - (i + 6 * dx));
    };
    expect(moved(0)).toBeGreaterThan(FROST_STEPS);
    expect(moved(1)).toBe(FROST_STEPS);
    expect(moved(2)).toBe(0);
  });

  it('the ice genius: a slowed enemy takes a quarter more from the heroes\' discs, a frozen one half as much again, fire and gas the same as ever', () => {
    const g = arena([at('genius'), at('cook')], [['skel', 3, 3], ['skel', 7, 3]]), [ice, cook] = g.party, [cold, warm] = g.S.mobs;
    const hit = (h: HeroState, m: Mob, ab: boolean) => { g.S.discs = []; const d = into(g, h, m, ab); g.step(1 / 120); return d; };
    // his own frosting hit does as much as ever, the cook's after it more
    const d = hit(ice, cold, true);
    const first = Math.ceil((d.m * 200) / 120);
    expect(99 - cold.hp).toBe(first);
    expect(cold.frost).toBe(1);
    const c = hit(cook, warm, false), plain = Math.ceil((c.m * 200) / 120);
    expect(99 - warm.hp).toBe(plain);
    hit(cook, cold, false);
    expect(99 - first - cold.hp).toBe(Math.ceil(plain * (1 + FROST_SLOW_VULN)));
    expect([FROST_SLOW_VULN, FROST_VULN]).toEqual([0.25, 0.5]);
    // frozen stiff, the cook's disc hits it half as hard again
    cold.frost = 2;
    const before = cold.hp;
    hit(cook, cold, false);
    expect(before - cold.hp).toBe(Math.ceil(plain * (1 + FROST_VULN)));
    // burning, it loses no more than its fire
    cold.burn = 4;
    const hp = cold.hp;
    g.S.phase = 'enemy'; g.S.actor = -1;
    (g as unknown as { nextActor: () => boolean }).nextActor();
    expect(hp - cold.hp).toBe(4);
  });

  /** Puts the hero in the far corner of the arena, away from the enemies the tests set up in the other one. */
  const corner = (g: Game, h: HeroState) => { h.at = cellCentre(10, 8); g.pickIntents(); };
  /** The cell an enemy stands on. */
  const cell = (m: Mob) => cellAt(m.x, m.y, mobSize(m.k));
  /** The bouncer's disc with the ability on, rolling straight up into m. */
  const shoved = (g: Game, m: Mob) => { g.S.discs = []; const d = into(g, g.party[0], m, true); g.step(1 / 120); return Math.ceil((d.m * 200) / 120); };

  it('the bouncer: his hit throws an enemy a cell on, away from the disc, and it slides over', () => {
    const g = arena([at('bouncer')], [['skel', 4, 4]]), [skel] = g.S.mobs;
    corner(g, g.party[0]);
    const hit = shoved(g, skel);
    expect(cell(skel)).toEqual([4, 3]);
    expect([skel.x, skel.y]).toEqual([skel.tx, skel.ty]);
    expect(skel.slid).toMatchObject({ x: cellCentre(4, 4).x, y: cellCentre(4, 4).y });
    expect(skel.max - skel.hp).toBe(hit);
    // its route to the hero is worked out from the new cell
    expect(skel.intent!.way![0]).toEqual({ x: skel.x, y: skel.y });
    // without the ability his disc just hits
    g.S.discs = [];
    into(g, g.party[0], skel, false);
    g.step(1 / 120);
    expect(cell(skel)).toEqual([4, 3]);
  });

  it('the bouncer: an enemy thrown into another enemy or a wall is slammed, both enemies take two more', () => {
    const g = arena([at('bouncer')], [['skel', 4, 4], ['rat', 4, 3], ['skel', 7, 0]]), [skel, rat, top] = g.S.mobs;
    corner(g, g.party[0]);
    const hit = shoved(g, skel);
    expect([cell(skel), cell(rat)]).toEqual([[4, 4], [4, 3]]);
    expect(skel.max - skel.hp).toBe(hit + SHOVE_DMG);
    expect(rat.max - rat.hp).toBe(SHOVE_DMG);
    // the top row has rock behind it
    const hit2 = shoved(g, top);
    expect(cell(top)).toEqual([7, 0]);
    expect(top.max - top.hp).toBe(hit2 + SHOVE_DMG);
  });

  it('the bouncer: over a hole an enemy drops in and is out of the fight; onto spikes it takes what a hero would', () => {
    const g = arena([at('bouncer')], [['skel', 4, 4], ['skel', 2, 4]]), [skel, other] = g.S.mobs, h = g.party[0];
    g.S.pits = [{ k: PIT_KINDS[0], cells: [[4, 3]] }];
    g.S.haz.add(hazKey(2, 3));
    corner(g, h);
    shoved(g, skel);
    expect(cell(skel)).toEqual([4, 3]);
    expect(skel.hp).toBeLessThanOrEqual(0);
    expect(skel.fell).toBeGreaterThan(0);
    expect(h.tally?.kills).toBe(1);
    const hit = shoved(g, other);
    expect(cell(other)).toEqual([2, 3]);
    expect(other.max - other.hp).toBe(hit + g.S.biome.hazDmg);
  });

  it('the bouncer: a boss or the floor\'s elite doesn\'t budge and takes two more instead', () => {
    for (const k of ['headsman', 'king'] as const) {
      const g = arena([at('bouncer')], [[k, 4, 5]]), [m] = g.S.mobs, was = cell(m);
      corner(g, g.party[0]);
      m.armor = 0;
      const hit = shoved(g, m);
      expect(g.heavy(m)).toBe(true);
      expect(cell(m)).toEqual(was);
      expect(m.max - m.hp).toBe(hit + SHOVE_DMG);
    }
  });

  it('the cop: the first two enemies his discs hit are cuffed, and whatever one takes the other takes too, through armour', () => {
    const g = arena([at('cop')], [['skel', 2, 2], ['golem', 6, 2], ['rat', 2, 6]]), cop = g.party[0], [skel, golem, rat] = g.S.mobs;
    corner(g, cop);
    const hit = (m: Mob, ab = true) => { g.S.discs = []; const d = into(g, cop, m, ab); g.step(1 / 120); return Math.ceil((d.m * 200) / 120); };
    // one enemy hit: the cuffs don't close yet
    const a = hit(skel);
    expect(g.S.cuffs).toBe(null);
    expect(cop.cuffing).toEqual([0]);
    // the second closes them, and its own hit already goes to both
    const b = hit(golem);
    expect(g.S.cuffs).toEqual({ a: 0, b: 1, left: CUFF_TURNS });
    expect(golem.max - golem.hp).toBe(b);
    expect(skel.max - skel.hp).toBe(a + b);
    // a third enemy that turn changes nothing
    hit(rat);
    expect(g.S.cuffs).toEqual({ a: 0, b: 1, left: CUFF_TURNS });
    expect(rat.max - rat.hp).toBe(a);
    // fire, gas, anything: the other one loses as much, through its armour, and the blow isn't passed back
    let [s0, g0] = [skel.hp, golem.hp];
    g.hurtMob(golem, 4, '#f00', true);
    expect([s0 - skel.hp, g0 - golem.hp]).toEqual([4, 4]);
    [s0, g0] = [skel.hp, golem.hp];
    g.hurtMob(skel, 2);
    expect([s0 - skel.hp, g0 - golem.hp]).toEqual([2, 2]);
    // a blow the golem's armour stops isn't passed on: it took nothing
    [s0, g0] = [skel.hp, golem.hp];
    g.hurtMob(golem, 2);
    expect([s0 - skel.hp, g0 - golem.hp]).toEqual([0, 0]);
    // one falls: the cuffs drop
    skel.hp = 1;
    g0 = golem.hp;
    g.hurtMob(skel, 5);
    expect(g0 - golem.hp).toBe(5);
    expect(g.S.cuffs).toBe(null);
    // without the ability his discs cuff nobody
    const g2 = arena([at('cop')], [['skel', 2, 2], ['skel', 6, 2]]), c2 = g2.party[0];
    for (const m of g2.S.mobs) { g2.S.discs = []; into(g2, c2, m, false); g2.step(1 / 120); }
    expect(g2.S.cuffs).toBe(null);
  });

  it('the cop: the cuffs hold three enemy turns, he cuffs anew each turn and a new pair takes the old one\'s place', () => {
    const g = arena([at('cop')], [['skel', 1, 1], ['skel', 3, 1], ['skel', 1, 3], ['skel', 3, 3]]), cop = g.party[0], [a, b, c, d] = g.S.mobs;
    cop.hp = cop.max = 99;
    corner(g, cop);
    const hit = (m: Mob) => { g.S.discs = []; into(g, cop, m, true); g.step(1 / 120); };
    hit(a); hit(b);
    expect(g.S.cuffs).toMatchObject({ a: 0, b: 1 });
    turn(g);
    expect(cop.cuffing).toBeUndefined();
    expect(g.S.cuffs).toMatchObject({ a: 0, b: 1, left: CUFF_TURNS - 1 });
    hit(c); hit(d);
    expect(g.S.cuffs).toEqual({ a: 2, b: 3, left: CUFF_TURNS });
    for (let k = 0; k < CUFF_TURNS - 1; k++) turn(g);
    expect(g.S.cuffs).toMatchObject({ left: 1 });
    turn(g);
    expect(g.S.cuffs).toBe(null);
  });

  it('the model: a kissed enemy strikes the nearest other enemy on its move instead of the heroes, at full strength', () => {
    const g = arena([at('model')], [['skel', 2, 2], ['skel', 3, 2], ['golem', 7, 1]]), h = g.party[0], [kissed, near, far] = g.S.mobs;
    h.hp = h.max = 99;
    // the others go for it now, it lives through their blows
    kissed.hp = kissed.max = 99;
    corner(g, h);
    g.S.discs = [];
    into(g, h, kissed, true);
    g.step(1 / 120);
    expect(kissed.kiss).toBe(h.i);
    expect(kissed.intent).toMatchObject({ t: 'hit', hero: -1, foe: 1, dmg: kissed.dmg });
    // it means the heroes no harm this turn
    expect(g.incoming(h)).toBe(0);
    const hp = near.hp, fh = far.hp;
    turn(g);
    expect(hp - near.hp).toBe(kissed.dmg);
    expect(far.hp).toBe(fh);
    expect(h.hp).toBe(99);
    // the kiss holds for KISS_TURNS enemy turns: next turn it goes for an enemy again, then for the hero
    expect(kissed.kiss).toBe(h.i);
    expect(kissed.kissLeft).toBe(KISS_TURNS - 1);
    expect(kissed.intent).toMatchObject({ hero: -1 });
    expect(g.incoming(h)).toBe(0);
    for (let k = 1; k < KISS_TURNS; k++) turn(g);
    expect(kissed.kiss).toBeUndefined();
    expect(kissed.kissLeft).toBeUndefined();
    expect(kissed.intent!.hero).toBe(h.i);
  });

  it('the model: the other enemies go for a kissed one as for a hero, and leave it once it falls', () => {
    const g = arena([at('model')], [['skel', 2, 2], ['skel', 3, 2], ['skel', 9, 6]]), h = g.party[0], [kissed, near, far] = g.S.mobs;
    h.hp = h.max = 99;
    kissed.hp = kissed.max = 99;
    corner(g, h);
    expect(near.intent!.hero).toBe(h.i);
    g.S.discs = []; into(g, h, kissed, true); g.step(1 / 120);
    // the one beside it turns on it at once, the one by the hero keeps to the hero
    expect(near.intent).toMatchObject({ t: 'hit', hero: -1, foe: 0, dmg: near.dmg });
    expect(far.intent!.hero).toBe(h.i);
    const hp = kissed.hp;
    turn(g);
    expect(hp - kissed.hp).toBe(near.dmg);
    // next turn it picks it again, as the nearest
    expect(near.intent).toMatchObject({ hero: -1, foe: 0 });
    // the kissed one falls in the heroes' turn: the other goes back to the hero
    g.hurtMob(kissed, 999);
    expect(near.intent!.hero).toBe(h.i);
    expect(near.intent!.foe).toBeUndefined();
  });

  it('the model: a shooter takes a kissed enemy it sees in turn with the heroes', () => {
    const g = arena([at('model')], [['skel', 2, 2], ['archer', 2, 6]]), h = g.party[0], [kissed, archer] = g.S.mobs;
    h.hp = h.max = 99;
    kissed.hp = kissed.max = 99;
    corner(g, h);
    g.S.discs = []; into(g, h, kissed, true); g.step(1 / 120);
    // the archer sees both: it takes the hero and the kissed one in turn, by the turn and its place in the queue
    const marks = new Set<number>();
    for (let t = 0; t < 2; t++) { g.S.turn = 1 + t; g.pickIntents(); marks.add(archer.intent!.foe ?? -10 - archer.intent!.hero); }
    expect(marks.has(0)).toBe(true);
    expect(marks.has(-10 - h.i)).toBe(true);
  });

  it('the model: a kiss on one still kissed starts its turns afresh', () => {
    const g = arena([at('model')], [['skel', 2, 2], ['golem', 7, 1]]), h = g.party[0], [kissed] = g.S.mobs;
    h.hp = h.max = 99;
    corner(g, h);
    g.S.discs = []; into(g, h, kissed, true); g.step(1 / 120);
    expect(kissed.kissLeft).toBe(KISS_TURNS);
    turn(g);
    expect(kissed.kissLeft).toBe(KISS_TURNS - 1);
    corner(g, h);
    expect(kissed.intent).toMatchObject({ hero: -1, foe: 1 });
    g.S.floats = [];
    g.S.discs = []; into(g, h, kissed, true); g.step(1 / 120);
    expect(kissed.kissLeft).toBe(KISS_TURNS);
    expect(g.S.floats.some(f => f.txt === 'чмок!')).toBe(true);
  });

  it('the model: a kissed enemy walks to the other enemy, the other\'s armour counts, a shooter shoots one it sees', () => {
    const g = arena([at('model')], [['grinder', 1, 1], ['golem', 4, 1], ['archer', 1, 5], ['rat', 4, 5]]), h = g.party[0], [grinder, golem, archer, rat] = g.S.mobs;
    h.hp = h.max = 99;
    corner(g, h);
    for (const m of [grinder, archer]) { g.S.discs = []; into(g, h, m, true); g.step(1 / 120); }
    // the grinder walks up to the golem and strikes, but its blow of 2 can't get through armour 3
    expect(grinder.intent).toMatchObject({ t: 'hit', hero: -1, foe: 1 });
    expect(grinder.intent!.way!.length).toBeGreaterThan(1);
    // the archer sees the rat and shoots it from where it stands
    expect(archer.intent).toMatchObject({ t: 'hit', hero: -1, foe: 3 });
    const gh = golem.hp, rh = rat.hp;
    turn(g);
    expect(cell(grinder)).toEqual([3, 1]);
    expect(golem.hp).toBe(gh);
    expect(rh - rat.hp).toBe(archer.dmg);
    expect(h.hp).toBe(99);
    // too far to get there this turn, it just walks toward it
    const g2 = arena([at('model')], [['skel', 1, 1], ['skel', 7, 1]]), h2 = g2.party[0], [walker] = g2.S.mobs;
    corner(g2, h2);
    g2.S.discs = []; into(g2, h2, walker, true); g2.step(1 / 120);
    expect(walker.intent).toMatchObject({ t: 'move', hero: -1, foe: 1, eta: 3 });
    turn(g2);
    expect(cell(walker)).toEqual([3, 1]);
  });

  it('the model: with no other enemy a kissed one just sighs, and bosses don\'t care for kisses', () => {
    const g = arena([at('model')], [['skel', 9, 7]]), h = g.party[0], [skel] = g.S.mobs;
    h.hp = h.max = 99;
    corner(g, h);
    expect(skel.intent!.t).toBe('hit');
    g.S.discs = []; into(g, h, skel, true); g.step(1 / 120);
    expect(skel.intent).toMatchObject({ t: 'move', hero: -1, sigh: true });
    turn(g);
    expect(h.hp).toBe(99);
    expect(g.S.log.some(l => shown(l.txt).includes('вздыхает по Вешалке'))).toBe(true);
    const g2 = arena([at('model')], [['king', 4, 4], ['skel', 1, 1]]), [king] = g2.S.mobs;
    g2.S.discs = []; into(g2, g2.party[0], king, true); g2.step(1 / 120);
    expect(king.kiss).toBeUndefined();
  });

  it('the cop\'s cuffs and the model\'s kisses travel to the other screens with the snapshot', () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([at('cop'), at('model')]);
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    host.S.cuffs = { a: 0, b: 1, left: 2 };
    host.S.mobs[0].kiss = at('model');
    host.S.mobs[0].kissLeft = 2;
    cli.send = () => {};
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.S.cuffs).toEqual({ a: 0, b: 1, left: 2 });
    expect(cli.S.mobs[0].kiss).toBe(at('model'));
    expect(cli.S.mobs[0].kissLeft).toBe(2);
    expect(cli.cuffedTo(cli.S.mobs[1])).toBe(cli.S.mobs[0]);
  });

  it('the kid\'s firecrackers and the bum\'s gas travel to the other screens with the snapshot', () => {
    const host = new Game(), cli = new Game();
    host.party = newParty([at('kid'), at('bum')]);
    host.loadRoom({ seed: 21, depth: 2, floor: 0, type: 'fight' });
    host.S.bombs = [{ x: 40, y: 40, fx: 30, fy: 40, by: 5, h: at('kid'), t: FOOD_FLY, left: 2, turn: 1 }];
    host.S.gas = [{ i: 4, j: 5, left: 2, t: 1.5 }];
    cli.send = () => {};
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.S.bombs).toEqual(host.S.bombs);
    expect(cli.S.gas).toEqual(host.S.gas);
    expect(cli.gasAt(6, 6)).toBe(true);
  });
});

describe('enemy turn order', () => {
  /** A floor 0 fight with just the given enemies on the cells along the top, nobody throwing. */
  const arena = (kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, cellCentre(2 + i * 2, 1).x, cellCentre(2 + i * 2, 1).y, 1, 0));
    g.S.nodes = [];
    g.S.blocks = [];
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = h.max = 99;
    endAll(g);
    return g;
  };

  it('enemies take their moves one at a time, from the top of the list down', () => {
    const g = arena(['archer', 'skel', 'archer', 'rat']), t0 = g.S.turn;
    const order: number[] = [], drops: number[] = [];
    let hp = g.party.reduce((n, h) => n + h.hp, 0);
    for (let k = 0; k < 2000 && g.S.turn === t0; k++) {
      g.update(1 / 60);
      const now = g.party.reduce((n, h) => n + h.hp, 0);
      if (now < hp) drops.push(k);
      hp = now;
      if (g.S.phase !== 'enemy') continue;
      if (g.S.actor >= 0 && order[order.length - 1] !== g.S.actor) order.push(g.S.actor);
      // only the enemy whose move it is leaves its cell or lifts off the floor
      const off = g.S.mobs.filter((m, i) => i !== g.S.actor && (m.hop > 0 || m.x !== m.tx || m.y !== m.ty));
      expect(off).toEqual([]);
    }
    expect(g.S.turn).toBe(t0 + 1);
    expect(order).toEqual([0, 1, 2, 3]);
    // the two archers shoot in their own moves, a good while apart
    expect(drops.length).toBeGreaterThanOrEqual(2);
    expect(drops[1] - drops[0]).toBeGreaterThan(20);
  });

  it('counts only the blows still to come against a hero while the enemies move', () => {
    const g = arena(['archer', 'archer']);
    const [a, b] = g.S.mobs, ha = g.heroOf(a.intent!.hero), hb = g.heroOf(b.intent!.hero);
    const before = g.incoming(hb);
    for (let k = 0; k < 2000 && !(g.S.phase === 'enemy' && g.S.actor === 0 && g.S.attacked); k++) g.update(1 / 60);
    expect(g.acted(a)).toBe(true);
    expect(g.acted(b)).toBe(false);
    expect(g.incoming(hb)).toBe(ha === hb ? before - a.intent!.dmg : before);
  });

  it('a mob raised in the enemy turn waits for the next turn to move', () => {
    const g = arena(['necro', 'archer']), t0 = g.S.turn;
    // the necromancer raises its skeleton on the second turn
    for (let k = 0; k < 2000 && g.S.turn === t0; k++) g.update(1 / 60);
    endAll(g);
    expect(g.S.mobs[0].intent!.t).toBe('summon');
    const actors = new Set<number>();
    for (let k = 0; k < 2000 && g.S.turn === t0 + 1; k++) { g.update(1 / 60); if (g.S.phase === 'enemy' && g.S.actor >= 0) actors.add(g.S.actor); }
    expect(g.S.mobs).toHaveLength(3);
    expect([...actors]).toEqual([0, 1]);
    expect(g.S.mobs[2].intent).not.toBeNull();
  });
});

describe('enemy-turn journal', () => {
  /** Bastion on the rune at (10, 8) and Ash on the one at (1, 8) of a bare floor 0 room, the given enemies on the given cells. */
  const arena = (mobs: [keyof typeof MOBS, number, number][]) => {
    const g = new Game();
    g.party = newParty([0, 2]);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.nodes = []; g.S.blocks = []; g.S.pits = []; g.S.haz = new Set();
    g.S.mobs = mobs.map(([k, i, j]) => { const c = cellCentre(i, j, mobSize(k)); return newMob(k, c.x, c.y, 1, 0); });
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = h.max = 99;
    return g;
  };
  /** The enemy makes the given move at once. */
  const act = (g: Game, m: Mob, it: Intent) => { m.intent = it; (g as unknown as { mobAct: (m: Mob) => void }).mobAct(m); };
  const lines = (g: Game) => g.S.log.map(l => shown(l.txt));

  it('writes a line for every enemy move as it lands, burns and shields included', () => {
    const g = arena([['skel', 9, 7], ['skel', 5, 1], ['archer', 5, 0], ['rat', 2, 2]]), [b, a] = g.party, [near, far, archer, rat] = g.S.mobs;
    expect(cellAt(g.spot(b)!.x, g.spot(b)!.y)).toEqual([10, 8]);
    b.shield = 3;
    a.fire = 1;
    archer.burn = 2;
    rat.burn = 50;
    expect(near.intent!.t).toBe('hit');
    expect(far.intent!.t).toBe('move');
    const goes = g.heroOf(far.intent!.hero), shot = g.heroOf(archer.intent!.hero);
    endAll(g);
    for (let k = 0; k < 2000 && g.S.turn === 1; k++) g.update(1 / 60);
    expect(lines(g)).toEqual([
      'Зажигалка горит: −2',
      'Скелет ударил Бастиона на 4, щит принял 3',
      `Скелет идёт к ${goes.def.dat}`,
      'Гоблин-лучник горит: −2',
      `Гоблин-лучник выстрелил в ${shot.def.acc} на 3`,
      'Тюремная крыса горит: −50',
      'Тюремная крыса сгорела',
    ]);
    expect(g.S.log.every(l => l.turn === 1)).toBe(true);
  });

  it('tells every kind of enemy move, and a hero falling', () => {
    const g = arena([['king', 2, 2], ['lich', 6, 2], ['necro', 1, 1], ['witch', 9, 1], ['bomber', 5, 4], ['rat', 9, 7], ['skel', 4, 4]]);
    const [king, lich, necro, witch, bomber, rat, skel] = g.S.mobs, [b, a] = g.party;
    b.shield = 3;
    a.hp = 5;
    g.S.log = [];
    act(g, king, { t: 'slam', hero: -1, dmg: 9 });
    act(g, lich, { t: 'slam', hero: -1, dmg: 3, chill: true });
    act(g, necro, { t: 'summon', hero: -1, dmg: 0, spots: [cellCentre(2, 5)] });
    act(g, lich, { t: 'summon', hero: -1, dmg: 0, spots: [cellCentre(3, 5), cellCentre(4, 5)] });
    skel.hp -= 8;
    act(g, witch, { t: 'heal', hero: -1, dmg: 6, mob: g.S.mobs.indexOf(skel) });
    act(g, bomber, { t: 'charge', hero: b.i, dmg: 0 });
    act(g, bomber, { t: 'hit', hero: b.i, dmg: 8 });
    act(g, rat, { t: 'hit', hero: b.i, dmg: 3 });
    act(g, skel, { t: 'hit', hero: b.i, dmg: 4 });
    expect(lines(g)).toEqual([
      'Король-в-короне: удар по всем на 9',
      'Бастион: щит принял 3',
      'Зажигалка пала',
      'Ледяной лич: метель по всем на 3',
      'Некромант призвал скелета',
      'Ледяной лич призвал ледяного упыря ×2',
      'Ледяная ведьма подлечила Скелета на 6',
      'Гном-подрывник поджёг фитиль',
      'Гном-подрывник бросил бомбу в Бастиона на 8',
      'Тюремная крыса ударила Бастиона на 3',
      'Скелет не достал Бастиона',
    ]);
  });

  it('keeps the last 40 lines of the room, on every screen, and starts empty in the next room', () => {
    const g = arena([['bomber', 5, 4]]), [bomber] = g.S.mobs;
    for (let k = 0; k < 50; k++) act(g, bomber, { t: 'charge', hero: 0, dmg: 0 });
    expect(g.S.log).toHaveLength(40);
    const cli = new Game();
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(g))));
    expect(cli.S.log).toEqual(g.S.log);
    g.loadRoom({ seed: 8, depth: 3, floor: 0, type: 'fight' });
    expect(g.S.log).toEqual([]);
  });
});

describe('every floor plays out', () => {
  it('boss and elite fights run turn after turn with their abilities', () => {
    for (let f = 0; f < FLOORS; f++) for (const type of ['boss', 'elite'] as const) {
      const g = new Game();
      g.loadRoom({ seed: 99 + f, depth: f * LAYERS + (type === 'boss' ? LAYERS : 4), floor: f, type, boss: CASTS[f].boss });
      for (const h of g.party) h.hp = h.max = 999;
      placeAll(g); g.startFight();
      const seen = new Set<string>();
      const over = () => g.S.phase === 'over';
      for (let turn = 0; turn < 7 && !over(); turn++) {
        for (const m of g.liveMobs()) if (m.intent) seen.add(m.intent.t);
        const t = g.S.turn;
        for (const h of g.party) g.throwDisc(h, -30, -40);
        endAll(g);
        for (let k = 0; k < 2000 && g.S.turn === t && !over(); k++) g.update(1 / 60);
      }
      if (type === 'boss') expect([...seen].some(t => ['slam', 'summon', 'heat'].includes(t))).toBe(true);
    }
  });
});

describe('enemy walking', () => {
  // routes every walker in 80 rooms: a few seconds locally, more on a busy CI runner
  it('routes walkers cell by cell around blocks and resources to the rune they go for and says when they strike', () => {
    let detours = 0, shots = 0;
    for (let seed = 1; seed < 200; seed++) {
      const g = new Game();
      g.loadRoom({ seed, depth: 1 + (seed % 12), floor: seed % 3, type: 'fight' });
      placeAll(g); g.startFight();
      const taken = g.occupied(null, false);
      for (const m of g.liveMobs()) {
        const it = m.intent;
        if (!it?.way || (it.t !== 'hit' && it.t !== 'move')) continue;
        const pad = g.S.pads[g.heroOf(it.hero).pad!], end = it.way[it.way.length - 1], shooter = isRanged(m.k);
        // a walker's way runs on to the rune; a shooter's ends on the nearest cell that sees it, out of sight where it stands
        if (shooter) {
          expect(g.clearShot(end, pad)).toBe(true);
          expect(g.clearShot(m, pad)).toBe(false);
          shots++;
        } else expect(end).toEqual({ x: pad.x, y: pad.y });
        const cells = shooter ? it.way : it.way.slice(0, -1), sz = mobSize(m.k);
        if (!shooter && wayLen(cells) > Math.hypot(pad.x - m.x, pad.y - m.y) + 24) detours++;
        // every stop is a whole footprint on free floor; steps go to a neighbouring cell
        for (let k = 1; k < cells.length; k++) {
          const [i, j] = cellAt(cells[k].x, cells[k].y, sz);
          expect(cellCentre(i, j, sz)).toEqual(cells[k]);
          for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) expect(isFloor(g.S, i + a, j + b) && !taken[(j + b) * g.S.gw + i + a]).toBe(true);
          expect(Math.max(Math.abs(cells[k].x - cells[k - 1].x), Math.abs(cells[k].y - cells[k - 1].y))).toBe(TILE);
        }
        const n = cells.length - 1;
        expect(it.eta).toBe(it.t === 'hit' ? 1 : Math.ceil(n / stepsOf(m)));
        if (it.t === 'move') expect(it.eta).toBeGreaterThan(1);
      }
    }
    expect(detours).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
  }, 20_000);

  it('stands every enemy and resource on the cell grid, big ones on 2 × 2 cells, never two on one cell', () => {
    for (let seed = 1; seed < 60; seed++) for (const type of ['fight', 'elite', 'boss', 'treasure'] as const) {
      const L = generate({ seed, depth: 1 + (seed % 12), floor: seed % 3, type });
      const seen = new Set<string>();
      const claim = (x: number, y: number, sz: number) => {
        const [i, j] = cellAt(x, y, sz);
        expect(cellCentre(i, j, sz)).toEqual({ x, y });
        for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) {
          const k = (i + a) + ',' + (j + b);
          expect(isFloor(L, i + a, j + b)).toBe(true);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      };
      for (const b of L.blocks) claim(b.x0 + 8, b.y0 + 8, 1);
      for (const m of L.mobs) claim(m.x, m.y, mobSize(m.k));
      for (const n of L.nodes) claim(n.x, n.y, n.s ?? 1);
      if (type === 'boss') expect(mobSize(L.mobs[0].k)).toBe(2);
    }
  });

  it('walkers end every turn on whole cells, never two on one cell', () => {
    for (let seed = 1; seed < 30; seed++) {
      const g = new Game();
      g.loadRoom({ seed, depth: 1 + (seed % 12), floor: seed % 3, type: seed % 4 ? 'fight' : 'boss' });
      placeAll(g); g.startFight();
      for (let turn = 0; turn < 4 && g.S.phase !== 'over'; turn++) {
        // nobody throws: the enemies walk up turn after turn
        const t0 = g.S.turn;
        for (let t = 0; t < 600 && g.S.turn === t0 && (g.S.phase as string) !== 'over'; t++) {
          endAll(g);
          g.update(1 / 60);
        }
        expect(g.S.turn > t0 || (g.S.phase as string) === 'over').toBe(true);
        const cells = new Set<string>();
        for (const m of g.liveMobs()) {
          const sz = mobSize(m.k), [i, j] = cellAt(m.x, m.y, sz);
          expect(cellCentre(i, j, sz)).toEqual({ x: m.x, y: m.y });
          for (let b = 0; b < sz; b++) for (let a = 0; a < sz; a++) {
            expect(cells.has(i + a + ',' + (j + b))).toBe(false);
            cells.add(i + a + ',' + (j + b));
          }
        }
      }
    }
  }, 20_000);
});

describe('heroes go where their last disc stopped', () => {
  /** A floor 0 fight with one archer in the far corner, the floor otherwise bare, every hero on its rune. */
  const arena = () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('archer', cellCentre(1, 1).x, cellCentre(1, 1).y, 1, 0)];
    g.S.nodes = []; g.S.blocks = []; g.S.pits = []; g.S.haz = new Set();
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = h.max = 99;
    return g;
  };
  /** A disc of hero h lying still at (x, y), as if thrown and stopped there. */
  const lying = (g: Game, h: HeroState, x: number, y: number, fall = 0) =>
    ({ hero: h, x, y, vx: 0, vy: 0, r: 5, m: 4, e: 0.6, fr: 1, fall, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0 });
  /** Every hero has thrown: play on until the throws are settled and the heroes have moved. */
  const settle = (g: Game) => {
    endAll(g);
    for (let k = 0; k < 100 && g.S.phase === 'throw'; k++) g.update(1 / 60);
    expect(g.S.phase).toBe('resolve');
  };
  /** Play on until the hero's discs have stopped. */
  const follow = (g: Game, h: HeroState) => {
    for (let k = 0; k < 3000 && g.waits(h); k++) g.update(1 / 60);
    expect(g.waits(h)).toBe(false);
  };
  const cell = (g: Game, h: HeroState) => cellAt(g.spot(h)!.x, g.spot(h)!.y);

  it('alone with a party, hands the throw to the next hero with discs once the one in hand has thrown its last and it stopped', () => {
    const g = arena(), [a, b, c] = g.party;
    g.select(a.i);
    g.throwDisc(a, -30, 0);
    g.update(1 / 60);
    // the disc still rolls: the hero in hand stays picked
    expect(g.act).toBe(a.i);
    follow(g, a);
    g.update(1 / 60);
    expect(g.act).toBe(b.i);
    // a hero the player picks afterwards stays picked, discs or not
    g.select(a.i);
    g.update(1 / 60);
    expect(g.act).toBe(a.i);
    g.select(b.i);
    // a hero with no discs left is passed over
    c.hand = 0;
    g.throwDisc(b, 0, -30);
    follow(g, b);
    g.update(1 / 60);
    expect(g.act).toBe(b.i);
    // online every player throws for their own hero: nobody is switched over
    const o = arena();
    o.online = true;
    o.select(o.party[0].i);
    o.throwDisc(o.party[0], -30, 0);
    follow(o, o.party[0]);
    o.update(1 / 60);
    expect(o.act).toBe(o.party[0].i);
  });

  it('throws every disc of the turn from where it stands, and its own discs lying on the table can be played off', () => {
    const g = arena(), [a] = g.party, r = g.S.pads[a.pad!];
    a.discs = 2;
    a.hand = 2;
    // the first disc goes off towards the middle of the room and stops there
    const c = { x: g.S.Wx / 2, y: g.S.Wy / 2 }, L = Math.hypot(c.x - r.x, c.y - r.y), ux = (c.x - r.x) / L, uy = (c.y - r.y) / L;
    g.throwDisc(a, ux * 30, uy * 30);
    // the hero may throw again while it rolls, and stays put when it stops
    expect(g.canThrow(a)).toBe(true);
    follow(g, a);
    const first = g.S.discs[0];
    expect(first.gone).toBe(false);
    expect(g.spot(a)).toEqual(r);
    expect(a.from).toBe(null);
    expect(g.canThrow(a)).toBe(true);
    // the second leaves from the same cell, straight at the first one lying there, and knocks it on
    const was = { x: first.x, y: first.y };
    g.throwDisc(a, first.x - r.x, first.y - r.y);
    const d = g.S.discs[1];
    expect(Math.hypot(d.x - r.x, d.y - r.y)).toBeLessThan(8);
    expect(g.predict(a, first.x - r.x, first.y - r.y).path[0]).toEqual([d.x, d.y]);
    follow(g, a);
    expect(Math.hypot(first.x - was.x, first.y - was.y)).toBeGreaterThan(4);
    expect(g.spot(a)).toEqual(r);
    expect(a.hand).toBe(0);
  });

  it('starts the next turn on the cell holding most of its last disc, and throws from there', () => {
    const g = arena(), [a, b, c] = g.party;
    for (const [i, j] of [[5, 4], [6, 4], [3, 5]]) expect(isFloor(g.S, i, j)).toBe(true);
    // a's first disc is forgotten, its last one lies mostly on (5, 4) and a little on (6, 4)
    g.S.discs = [lying(g, a, cellCentre(3, 5).x, cellCentre(3, 5).y), lying(g, b, cellCentre(3, 5).x + 2, cellCentre(3, 5).y), lying(g, a, 94, 72)];
    // nobody moves while the turn lasts
    g.update(1 / 60);
    expect(g.spot(a)).toEqual(g.S.pads[a.pad!]);
    expect(g.spot(b)).toEqual(g.S.pads[b.pad!]);
    settle(g);
    expect(cell(g, a)).toEqual([5, 4]);
    expect(g.spot(a)).toEqual(cellCentre(5, 4));
    expect(cell(g, b)).toEqual([3, 5]);
    // a hero who threw nothing stays where it stood
    expect(g.spot(c)).toEqual(g.S.pads[c.pad!]);
    // the figure hops over for a moment
    g.update(0.2);
    const mid = g.figureAt(a)!, from = g.S.pads[a.pad!];
    expect(mid.lift).toBeGreaterThan(3);
    expect(Math.hypot(mid.x - from.x, mid.y - from.y)).toBeGreaterThan(1);
    expect(Math.hypot(mid.x - 88, mid.y - 72)).toBeGreaterThan(1);
    // a hero that lands picks its last disc up; the earlier one was cleared away as the turn ended
    g.update(0.4);
    expect(g.figureAt(a)).toEqual({ ...cellCentre(5, 4), lift: 0 });
    expect(g.S.discs.map(d => d.gone)).toEqual([true, true, true]);
    for (let k = 0; k < 2000 && g.S.phase !== 'throw'; k++) g.update(1 / 60);
    expect(g.S.turn).toBe(2);
    expect(g.figureAt(a)).toEqual({ ...cellCentre(5, 4), lift: 0 });
    expect(g.spot(a)).toEqual(cellCentre(5, 4));
    // the next throw leaves from the new cell
    g.throwDisc(a, -30, 0);
    const d = g.S.discs[g.S.discs.length - 1];
    expect(Math.hypot(d.x - cellCentre(5, 4).x, d.y - cellCentre(5, 4).y)).toBeLessThan(8);
    expect(g.predict(a, -30, 0).path[0]).toEqual([d.x, d.y]);
  });

  it('two heroes after one cell: the one whose disc covers more of it gets it, the other the cell next most of its disc lies on', () => {
    const g = arena(), [a, b] = g.party;
    g.S.discs = [lying(g, b, 93, 72), lying(g, a, 88, 72)];
    settle(g);
    expect(cell(g, a)).toEqual([5, 4]);
    expect(cell(g, b)).toEqual([6, 4]);
  });

  it('a hero already standing on the cell keeps it: the one whose disc stopped there takes the next cell', () => {
    const g = arena(), [a, b] = g.party;
    b.at = cellCentre(5, 4);
    g.S.discs = [lying(g, a, 88, 72)];
    settle(g);
    expect(g.spot(b)).toEqual(cellCentre(5, 4));
    expect(cell(g, a)).not.toEqual([5, 4]);
    expect(Math.max(...cell(g, a).map((v, k) => Math.abs(v - [5, 4][k])))).toBe(1);
  });

  it('a cell taken by an enemy or a block sends the hero to the next cell under its disc, else the nearest free one', () => {
    const g = arena(), [a, b] = g.party;
    g.S.mobs.push(newMob('skel', cellCentre(5, 4).x, cellCentre(5, 4).y, 1, 0));
    g.S.blocks = [{ x0: 9 * 16, y0: 2 * 16, x1: 10 * 16, y1: 3 * 16, v: 0 }];
    g.pickIntents();
    g.S.discs = [lying(g, a, 94, 72), lying(g, b, 9 * 16 + 8, 3 * 16 + 5.5)];
    settle(g);
    expect(cell(g, a)).toEqual([6, 4]);
    expect(cell(g, b)).toEqual([9, 3]);
  });

  it('a hero whose last disc fell into a pit goes over to the one before it, and with every disc in a pit stays where it stood', () => {
    const g = arena(), [a] = g.party;
    a.at = cellCentre(5, 4);
    a.discs = 2;
    a.hand = 1;
    // the first disc dropping into a hole moves nobody, and the next one leaves from the same cell
    g.S.discs = [lying(g, a, 120, 60, 0.3)];
    g.update(1 / 60);
    expect(g.spot(a)).toEqual(cellCentre(5, 4));
    g.throwDisc(a, 0, 30);
    expect(Math.hypot(g.S.discs[1].x - cellCentre(5, 4).x, g.S.discs[1].y - cellCentre(5, 4).y)).toBeLessThan(8);
    // the last one went down a hole (long gone by now): a goes over to the one before it
    g.S.discs = [lying(g, a, cellCentre(3, 5).x, cellCentre(3, 5).y), { ...lying(g, a, 120, 60, 0.6), gone: true }];
    settle(g);
    expect(cell(g, a)).toEqual([3, 5]);
    // three discs, the last in a hole: to the second, the last one still on the floor; the first is cleared away
    const t = arena(), [c] = t.party;
    t.S.discs = [lying(t, c, cellCentre(3, 5).x, cellCentre(3, 5).y), lying(t, c, 94, 72), lying(t, c, 120, 60, 0.3)];
    settle(t);
    expect(cell(t, c)).toEqual([5, 4]);
    expect(t.S.discs[0].gone).toBe(true);
    // every disc in a hole: the hero stays on the cell it began the turn on
    const n = arena(), [x] = n.party;
    x.at = cellCentre(5, 4);
    n.S.discs = [lying(n, x, 120, 60, 0.3), { ...lying(n, x, 120, 60, 0.6), gone: true }];
    settle(n);
    expect(n.spot(x)).toEqual(cellCentre(5, 4));
    expect(x.from).toBe(null);
  });

  it('walkers go after the hero where it now stands, and never stop on a hero', () => {
    const g = arena(), [a] = g.party;
    const sk = newMob('skel', cellCentre(2, 5).x, cellCentre(2, 5).y, 1, 0);
    g.S.mobs = [sk];
    for (const h of g.party) if (h !== a) h.hp = 0;
    g.pickIntents();
    expect(sk.intent!.hero).toBe(a.i);
    // a's disc stops two cells off the skeleton
    g.S.discs = [lying(g, a, cellCentre(4, 5).x, cellCentre(4, 5).y)];
    settle(g);
    expect(cell(g, a)).toEqual([4, 5]);
    const it = sk.intent!;
    expect(it.t).toBe('hit');
    expect(it.way![it.way!.length - 1]).toEqual(cellCentre(4, 5));
    const hp = a.hp;
    for (let k = 0; k < 2000 && g.S.phase !== 'throw'; k++) g.update(1 / 60);
    expect(a.hp).toBeLessThan(hp);
    expect(cellAt(sk.x, sk.y)).not.toEqual([4, 5]);
    expect(Math.max(...cellAt(sk.x, sk.y).map((v, k) => Math.abs(v - [4, 5][k])))).toBe(1);
  });

  it('shows a client the hero where the host moved it', () => {
    const host = arena(), [a] = host.party;
    host.S.discs = [lying(host, a, 94, 72)];
    settle(host);
    const client = new Game();
    applySnapshot(client, JSON.parse(JSON.stringify(snapshot(host))));
    expect(client.spot(client.heroOf(a.i))).toEqual(cellCentre(5, 4));
  });

  it('online, a client throws one disc after another from the same cell, and its hero moves only once the turn is over', () => {
    const host = arena(), [, b] = host.party, cli = new Game(), sent: Action[] = [];
    host.online = true;
    cli.online = true;
    cli.send = x => sent.push(x);
    cli.canControl = h => h.i === b.i;
    const sync = () => applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    b.discs = 2;
    b.hand = 2;
    sync();
    const cb = cli.heroOf(b.i), r = host.S.pads[b.pad!];
    cli.throwDisc(cb, -30, 0);
    expect(cli.canThrow(cb)).toBe(true);
    host.perform(sent[0]);
    sync();
    expect(cli.canThrow(cb)).toBe(true);
    cli.throwDisc(cb, 0, -30);
    expect(sent).toHaveLength(2);
    host.perform(sent[1]);
    expect(host.S.discs).toHaveLength(2);
    for (const d of host.S.discs) expect(Math.hypot(d.x - r.x, d.y - r.y)).toBeLessThan(8);
    for (let k = 0; k < 600 && host.moving(); k++) host.update(1 / 60);
    sync();
    expect(cli.spot(cb)).toEqual(r);
    expect(cb.hand).toBe(0);
    const last = host.S.discs[1];
    settle(host);
    sync();
    expect(cli.spot(cb)).not.toEqual(r);
    expect(Math.hypot(cli.spot(cb)!.x - last.x, cli.spot(cb)!.y - last.y)).toBeLessThan(1.5 * TILE);
  });
});

describe('shooters fire only at a hero they see', () => {
  /** A floor 0 fight in a bare room, the first hero alone (the rest fallen) standing on cell `at`, the shooter on `from`. */
  const arena = (k: keyof typeof MOBS, from: [number, number], at: [number, number], blocks: [number, number][] = []) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob(k, cellCentre(...from).x, cellCentre(...from).y, 1, 0)];
    g.S.nodes = []; g.S.pits = []; g.S.haz = new Set();
    g.S.blocks = blocks.map(([i, j]) => ({ x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE, v: 0 }));
    placeAll(g); g.startFight();
    const [h] = g.party;
    for (const o of g.party) o.hp = o === h ? (o.max = 99) : 0;
    h.at = cellCentre(...at);
    g.pickIntents();
    return { g, h, m: g.S.mobs[0] };
  };
  /** Play the enemy turn through. */
  const enemyTurn = (g: Game) => {
    const t = g.S.turn;
    endAll(g);
    for (let k = 0; k < 3000 && g.S.turn === t; k++) g.update(1 / 60);
    expect(g.S.turn).toBe(t + 1);
  };
  const box = (i: number, j: number) => ({ x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE, v: 0 });

  it('a wall, a block, a standing icicle or a resource blocks the line; holes, enemies and spent things do not', () => {
    const { g } = arena('archer', [1, 4], [9, 4]), a = cellCentre(1, 4), b = cellCentre(9, 4);
    expect(g.clearShot(a, b)).toBe(true);
    g.S.blocks = [box(5, 4)];
    expect(g.clearShot(a, b)).toBe(false);
    // a line that only grazes the corner of a block flies past it
    expect(g.clearShot(cellCentre(4, 2), cellCentre(7, 5))).toBe(true);
    expect(g.clearShot(cellCentre(4, 3), cellCentre(6, 5))).toBe(false);
    g.S.blocks = [{ ...box(5, 4), ice: true, hp: 3, max: 3 }];
    expect(g.clearShot(a, b)).toBe(false);
    g.S.blocks[0].hp = 0;
    expect(g.clearShot(a, b)).toBe(true);
    g.S.rock = [...g.S.rock, box(5, 4)];
    expect(g.clearShot(a, b)).toBe(false);
    g.S.rock.pop();
    const n = { k: 'ore' as const, name: 'Рудная жила', r: 7, ch: 3, ...cellCentre(5, 4), left: 3, hit: 0 };
    g.S.nodes = [n];
    expect(g.clearShot(a, b)).toBe(false);
    n.left = 0;
    expect(g.clearShot(a, b)).toBe(true);
    g.S.pits = [{ k: '1x1', cells: [[5, 4]] }];
    g.S.mobs.push(newMob('skel', cellCentre(5, 4).x, cellCentre(5, 4).y, 1, 0));
    expect(g.clearShot(a, b)).toBe(true);
  });

  it('in sight, it fires from where it stands', () => {
    const { g, h, m } = arena('archer', [1, 4], [9, 4]);
    expect(m.intent).toMatchObject({ t: 'hit', hero: h.i, dmg: m.dmg });
    enemyTurn(g);
    expect(cellAt(m.x, m.y)).toEqual([1, 4]);
    expect(h.hp).toBe(99 - m.dmg);
  });

  it('behind a column it steps out to where it sees the hero and fires the same turn', () => {
    const { g, h, m } = arena('archer', [1, 4], [9, 4], [[5, 4]]);
    expect(g.sees(m, h)).toBe(false);
    const it = m.intent!;
    expect(it.t).toBe('hit');
    expect(it.eta).toBe(1);
    expect(g.clearShot(it.way![it.way!.length - 1], cellCentre(9, 4))).toBe(true);
    enemyTurn(g);
    expect(cellAt(m.x, m.y)).not.toEqual([1, 4]);
    expect(g.sees(m, h)).toBe(true);
    expect(h.hp).toBe(99 - m.dmg);
    expect(g.S.log.map(l => shown(l.txt))).toContain(`Гоблин-лучник выстрелил в ${h.def.acc} на ${m.dmg}`);
  });

  it('far out of sight it walks towards the hero, says when it will fire, and holds its shot', () => {
    // a wall of blocks down the middle of the room with a gap only at the bottom
    const wall: [number, number][] = [0, 1, 2, 3, 4, 5, 6, 7].map(j => [5, j]);
    const { g, h, m } = arena('archer', [1, 1], [9, 1], wall);
    const it = m.intent!;
    expect(it.t).toBe('move');
    expect(it.hero).toBe(h.i);
    expect(it.eta).toBeGreaterThan(1);
    expect(g.incoming(h)).toBe(0);
    enemyTurn(g);
    expect(h.hp).toBe(99);
    expect(cellAt(m.x, m.y)).not.toEqual([1, 1]);
    expect(g.S.log.map(l => shown(l.txt))).toContain(`Гоблин-лучник идёт к ${h.def.dat}`);
  });

  it('fires at a hero it sees rather than one hidden, whoever\'s turn it would be', () => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = [newMob('archer', cellCentre(1, 4).x, cellCentre(1, 4).y, 1, 0)];
    g.S.nodes = []; g.S.pits = []; g.S.blocks = [box(5, 4)];
    placeAll(g); g.startFight();
    const [a, b] = g.party;
    g.party[2].hp = 0;
    a.at = cellCentre(9, 4);
    b.at = cellCentre(9, 1);
    const m = g.S.mobs[0];
    for (let t = 1; t <= 4; t++) { g.S.turn = t; g.pickIntents(); expect(m.intent).toMatchObject({ t: 'hit', hero: b.i }); }
  });

  it('a hero who steps out of its sight after the throws makes it walk instead of fire', () => {
    // a wall of blocks down the middle with gaps at the top and the bottom: the hero is in sight through the top one
    const { g, h, m } = arena('archer', [1, 1], [9, 1], [2, 3, 4, 5, 6, 7].map(j => [5, j] as [number, number]));
    expect(m.intent!.t).toBe('hit');
    expect(g.incoming(h)).toBe(m.dmg);
    // its disc took the hero behind the wall
    h.at = cellCentre(8, 5);
    (g as unknown as { rechase: () => void }).rechase();
    expect(g.sees(m, h)).toBe(false);
    expect(m.intent).toMatchObject({ t: 'move', hero: h.i });
    expect(g.incoming(h)).toBe(0);
  });

  it('a shot whose line closed since it was aimed misses', () => {
    const { g, h, m } = arena('archer', [1, 4], [9, 4]);
    g.S.blocks = [box(5, 4)];
    g.S.log = [];
    (g as unknown as { mobAct: (m: Mob) => void }).mobAct(m);
    expect(h.hp).toBe(99);
    expect(g.S.log.map(l => shown(l.txt))).toEqual([`Гоблин-лучник не увидел ${h.def.acc}`]);
  });

  it('a bomber out of sight lights its fuse on the way, and throws once it sees the hero', () => {
    const { g, h, m } = arena('bomber', [1, 4], [9, 4], [[5, 4]]);
    expect(g.S.turn % 2).toBe(1);
    expect(m.intent!.t).toBe('charge');
    enemyTurn(g);
    expect(g.sees(m, h)).toBe(true);
    expect(g.S.log.map(l => shown(l.txt))).toContain(`Гном-подрывник поджёг фитиль и пошёл к ${h.def.dat}`);
    expect(m.intent).toMatchObject({ t: 'hit', hero: h.i, dmg: m.dmg * 2 });
    enemyTurn(g);
    expect(h.hp).toBe(99 - m.dmg * 2);
  });
});

describe('hit effects', () => {
  /** A floor 0 fight with the given enemies in a row and nothing else in the room. */
  const arena = (kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, cellCentre(2 + i * 3, 3).x, cellCentre(2 + i * 3, 3).y, 1, 0));
    g.S.nodes = []; g.S.blocks = []; g.S.rock = []; g.S.pits = [];
    placeAll(g); g.startFight();
    return g;
  };
  const disc = (g: Game, x: number, y: number, vx: number, vy: number) =>
    ({ hero: g.hero, x, y, vx, vy, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0 });

  it('a struck enemy rocks away from the disc, a big one less, and a sure hit jolts the figures nearby a moment later', () => {
    const g = arena(['skel', 'skel']), [a, b] = g.S.mobs;
    a.hp = a.max = 99;
    g.S.discs = [disc(g, a.x, a.y + 11, 0, -220)];
    g.step(1 / 120);
    expect(a.knock!.y).toBeLessThan(-0.99);
    expect(a.knock!.p).toBeGreaterThan(0.5);
    // the neighbour three cells off feels it, but later and softer
    expect(b.knock!.t).toBeLessThan(0);
    expect(b.knock!.p).toBeLessThan(a.knock!.p);
    const p = a.knock!.p;
    for (let k = 0; k < 160; k++) g.update(1 / 120);
    expect(a.knock).toBeUndefined();
    expect(p).toBeGreaterThan(0.75);

    const big = arena(['golem']), m = big.S.mobs[0];
    m.hp = m.max = 99;
    big.S.discs = [disc(big, m.x, m.y + m.r + 4, 0, -220)];
    big.step(1 / 120);
    expect(m.knock!.p).toBeLessThan(p - 0.1);
  });

  it('an enemy lunges at the hero it hits, and the hero rocks away from it', () => {
    const g = arena([]);
    const [h] = g.alive(), p = g.spot(h)!;
    const sk = newMob('skel', p.x + TILE, p.y, 1, 0);
    g.S.mobs = [sk];
    sk.intent = { t: 'hit', hero: h.i, dmg: 3 };
    (g as unknown as { mobAct: (m: typeof sk) => void }).mobAct(sk);
    expect(sk.knock!.x).toBeLessThan(-0.99);
    expect(h.knock!.x).toBeLessThan(-0.99);
    expect(h.knock!.t).toBeLessThan(0);
  });

  it('a struck resource throws chips that land, stop and vanish, and a client throws the very same ones', () => {
    const g = arena(['archer']);
    g.S.nodes = [{ k: 'ore', name: 'Рудная жила', r: 7, ch: 3, x: 88, y: 88, left: 3, hit: 0 }];
    g.S.discs = [disc(g, 88, 88 + TILE / 2 + 5.5, 0, -200)];
    const cli = new Game();
    let ms = 0;
    Object.assign(cli, { online: true, send: () => {}, clock: () => ms });
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(g))));
    Object.assign(cli.S, { nodes: structuredClone(g.S.nodes), blocks: [], rock: [], pits: [] });
    g.step(1 / 120);
    const chips = g.S.sparks.filter(p => p.k);
    expect(chips.length).toBeGreaterThanOrEqual(5);
    expect(chips.some(p => p.k === 'gold') || chips.some(p => p.k === 'ore')).toBe(true);
    // they don't travel in the snapshot: the client's own disc knocks them off, one step on
    expect(snapshot(g).sparks.filter(p => p.k)).toEqual([]);
    ms += 1000 / 120;
    cli.update(0);
    expect(cli.S.sparks.filter(p => p.k)).toEqual(chips);
    let landed = 0;
    for (let k = 0; k < 90; k++) { g.update(1 / 60); landed = Math.max(landed, g.S.sparks.filter(p => p.k && p.h === 0).length); }
    expect(landed).toBeGreaterThan(0);
    expect(g.S.sparks.some(p => p.k)).toBe(false);
  });
});

describe('enemies by map row, the new enemies and the elite\'s reward', () => {
  it('thins the weak enemies out along a floor: the prison rat is in the first rooms, rarer half way and gone by the fifth row', () => {
    const rats = (row: number) => mobPool(0, row).filter(k => k === 'rat').length / mobPool(0, row).length;
    expect(rats(0)).toBeGreaterThan(rats(2));
    expect(rats(2)).toBeGreaterThan(0);
    expect(rats(4)).toBe(0);
    expect(rats(5)).toBe(0);
    for (let seed = 1; seed < 60; seed++) for (const row of [4, 5]) {
      expect(generate({ seed, depth: row + 1, floor: 0, type: 'fight' }).mobs.some(m => m.k === 'rat')).toBe(false);
    }
    // the new enemies come in half way; the floor's elite leads only elite fights
    for (let f = 0; f < FLOORS; f++) {
      const late = new Set(mobPool(f, 5)), first = new Set(mobPool(f, 0));
      expect([...late].some(k => !first.has(k))).toBe(true);
      for (let row = 0; row < 6; row++) expect(mobPool(f, row)).not.toContain(CASTS[f].elite);
    }
    expect(CASTS.map(c => c.elite)).toEqual(['headsman', 'banshee', 'smasher']);
  });

  /** A room of the floor with these enemies standing on these cells and the party on the runes, the first hero at `at`. */
  const room = (floor: number, mobs: [keyof typeof MOBS, number, number][], at: [number, number] = [9, 6]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: floor * LAYERS + 3, floor, type: 'fight' });
    g.S.mobs = mobs.map(([k, i, j]) => newMob(k, cellCentre(i, j).x, cellCentre(i, j).y, 1, 0));
    g.S.nodes = []; g.S.pits = []; g.S.haz = new Set(); g.S.blocks = [];
    placeAll(g); g.startFight();
    g.party[0].at = cellCentre(...at);
    g.pickIntents();
    return g;
  };
  const enemyTurn = (g: Game) => {
    const t = g.S.turn;
    endAll(g);
    for (let k = 0; k < 4000 && g.S.turn === t && g.S.phase !== 'over'; k++) g.update(1 / 60);
  };

  it('the guard\'s door takes the hits from the side it faces its hero, not from the back or the flanks', () => {
    const g = room(0, [['guard', 4, 6]]), [m] = g.S.mobs, h = g.heroOf(m.intent!.hero), p = g.spot(h)!;
    const fx = p.x - m.x, fy = p.y - m.y, L = Math.hypot(fx, fy);
    expect(g.shielded(m, m.x + (fx / L) * 10, m.y + (fy / L) * 10)).toBe(true);
    expect(g.shielded(m, m.x - (fx / L) * 10, m.y - (fy / L) * 10)).toBe(false);
    expect(g.shielded(m, m.x - (fy / L) * 10, m.y + (fx / L) * 10)).toBe(false);
    expect(g.shielded(newMob('skel', m.x, m.y), m.x + fx / L, m.y + fy / L)).toBe(false);
  });

  it('a disc into the guard\'s door still wounds it, by half the blow rounded up, «ТОЧНО!» counted first', () => {
    const blow = (side: number) => {
      const g = room(0, [['guard', 4, 6]]), [m] = g.S.mobs, p = g.spot(g.heroOf(m.intent!.hero))!;
      const L = Math.hypot(p.x - m.x, p.y - m.y), fx = (side * (p.x - m.x)) / L, fy = (side * (p.y - m.y)) / L, at = m.r + 5.5;
      m.hp = m.max = 99;
      g.S.discs = [{ hero: g.party[0], x: m.x + fx * at, y: m.y + fy * at, vx: -fx * 200, vy: -fy * 200, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0 }];
      g.step(1 / 60);
      return { dmg: 99 - m.hp, door: g.S.floats.some(f => f.txt === 'дверь!'), sure: g.S.floats.some(f => f.txt === 'ТОЧНО!') };
    };
    const front = blow(1), back = blow(-1);
    expect(back.door).toBe(false);
    expect(front.door).toBe(true);
    expect(front.sure && back.sure).toBe(true);
    expect(back.dmg).toBeGreaterThan(2);
    expect(front.dmg).toBe(Math.max(1, Math.ceil(back.dmg * DOOR_MUL)));
  });

  it('the headsman goes after the most hurt hero and strikes twice as hard every third turn', () => {
    const g = room(0, [['headsman', 2, 2]]);
    const [a, b] = g.alive();
    b.hp = 3;
    g.pickIntents();
    expect(g.S.mobs[0].intent!.hero).toBe(b.i);
    a.hp = 2;
    g.pickIntents();
    expect(g.S.mobs[0].intent!.hero).toBe(a.i);
    const [m] = g.S.mobs;
    expect(g.executes(m)).toBe(false);
    g.S.turn = 3;
    expect(g.executes(m)).toBe(true);
    expect(g.specialIn(m)).toEqual({ name: 'казнь', turns: 0 });
    g.S.turn = 4;
    g.pickIntents();
    expect(g.specialIn(m)).toEqual({ name: 'казнь', turns: 2 });
  });

  it('the grinder hones the enemies next to it, not itself or the ones far off', () => {
    const g = room(2, [['grinder', 4, 4], ['imp', 5, 4], ['imp', 9, 1]]), [gr, near, far] = g.S.mobs;
    expect(g.honed(near)).toBe(2);
    expect(g.honed(far)).toBe(0);
    expect(g.honed(gr)).toBe(0);
    gr.hp = 0;
    expect(g.honed(near)).toBe(0);
  });

  it('the undertaker lays an enemy that falls near it in a coffin, which gets up two enemy turns later unless broken', () => {
    const g = room(1, [['undertaker', 2, 2], ['ghoul', 3, 2], ['ghost', 9, 0]]), [u, ghoul] = g.S.mobs;
    g.hurtMob(ghoul, 99);
    const coffin = g.S.mobs[3];
    expect(coffin).toMatchObject({ k: 'coffin', hold: 'ghoul', rise: 2, owner: 0 });
    expect(coffin.intent).toMatchObject({ t: 'rise', eta: 2 });
    expect(g.specialIn(coffin)).toEqual({ name: 'подъём', turns: 1 });
    expect(g.solid(coffin)).toBe(false);
    for (let k = 0; k < 60; k++) g.update(1 / 60);
    expect(g.solid(coffin)).toBe(true);
    enemyTurn(g);
    expect(coffin).toMatchObject({ k: 'coffin', rise: 1 });
    enemyTurn(g);
    expect(coffin.k).toBe('ghoul');
    expect(coffin.hp).toBe(coffin.max);
    // an enemy falling far off isn't reached; a broken coffin stays shut
    const len = g.S.mobs.length;
    g.hurtMob(g.S.mobs[2], 99);
    expect(g.S.mobs.length).toBe(len);
    g.hurtMob(coffin, 99);
    const box = g.S.mobs[len];
    expect(box.k).toBe('coffin');
    g.hurtMob(box, 99);
    enemyTurn(g);
    enemyTurn(g);
    expect(box.k).toBe('coffin');
    expect(g.S.mobs.filter(m => m.hp > 0)).toEqual([u]);
  });

  it('the banshee\'s scream takes the aiming line off every hero standing for one turn', () => {
    const g = room(1, [['banshee', 2, 2]]);
    g.S.turn = 2;
    g.pickIntents();
    expect(g.S.mobs[0].intent!.t).toBe('scream');
    enemyTurn(g);
    for (const h of g.alive()) { expect(h.daze).toBeGreaterThan(0); expect(h.chill).toBe(0); }
    // the next enemy turn has no scream, and the ringing is gone by the heroes' turn after it
    enemyTurn(g);
    for (const h of g.alive()) expect(h.daze).toBe(0);
  });

  it('the smasher\'s hammer comes down on the square marked round a hero a turn ahead: a hero who moved off it is spared', () => {
    for (const leave of [false, true]) {
      const g = room(2, [['smasher', 1, 1]], [8, 6]);
      for (const o of g.party) if (o !== g.party[0]) o.hp = 0;
      const h = g.party[0];
      h.hp = h.max = 99;
      g.S.turn = 3;
      g.pickIntents();
      const it = g.S.mobs[0].intent!;
      expect(it.t).toBe('smash');
      expect(it.spots!.length).toBeGreaterThan(3);
      expect(g.incoming(h)).toBe(it.dmg);
      if (leave) h.at = cellCentre(3, 6);
      enemyTurn(g);
      expect(h.hp).toBe(leave ? 99 : 99 - it.dmg);
    }
  });

  it('an elite owes every hero a free stat level, taken in the sharpening window where nothing is for sale', () => {
    const g = new Game();
    g.party = newParty([0, 1]);
    g.bank.ore = 50;
    g.sharpen(9);
    expect([g.forge, g.whet]).toEqual([9, true]);
    const [a, b] = g.party;
    expect(g.party.map(h => h.free)).toEqual([1, 1]);
    g.upgrade('m', a);
    expect([a.up.m, a.free, g.bank.ore]).toEqual([1, 0, 50]);
    g.upgrade('m', a);
    g.buyDisc(a);
    expect([a.up.m, a.discs, g.bank.ore]).toEqual([1, HAND_START, 50]);
    // a level not taken waits for the next blacksmith's, where it costs nothing either
    g.whet = false;
    g.upgrade('pw', b);
    expect([b.up.pw, b.free, g.bank.ore]).toEqual([1, 0, 50]);
    g.upgrade('pw', b);
    expect([b.up.pw, g.bank.ore]).toEqual([2, 50 - UP_COST[1]]);
  });

  it('a fight won without a scratch pays the party ore, as much for any party; a scratch or the ore cave pays nothing', () => {
    for (const hurt of [false, true]) {
      const g = room(0, [['skel', 2, 2]]);
      if (hurt) g.hurtHero(g.party[0], 1);
      const ore = g.bank.ore;
      g.hurtMob(g.S.mobs[0], 99);
      g.update(1 / 60);
      expect(g.S.phase).toBe('over');
      expect(g.party.length).toBeGreaterThan(1);
      expect(g.bank.ore - ore).toBe(hurt ? 0 : CLEAN_ORE);
    }
    const cave = new Game();
    cave.loadRoom({ seed: 3, depth: LAYERS + 2, floor: 1, type: 'treasure' });
    placeAll(cave); cave.startFight();
    for (const n of cave.S.nodes) n.left = 0;
    cave.update(1 / 60);
    expect(cave.clean).toBe(0);
  });
});

describe("the floors' other bosses", () => {
  type K = keyof typeof MOBS;
  /** A bare 11 × 9 floor 0 room, the heroes on the runes at (10, 8), (1, 8) and (10, 1), the enemies with their top-left cells where given. */
  const arena = (mobs: [K, number, number][], picks = [0, 1, 2]) => {
    const g = new Game();
    g.party = newParty(picks);
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.nodes = []; g.S.blocks = []; g.S.pits = []; g.S.haz = new Set();
    g.S.mobs = mobs.map(([k, i, j]) => { const c = cellCentre(i, j, mobSize(k)); return newMob(k, c.x, c.y, 1, 0); });
    placeAll(g); g.startFight();
    for (const h of g.party) h.hp = h.max = 99;
    return g;
  };
  const act = (g: Game, m: Mob, it: Intent) => { m.intent = it; (g as unknown as { mobAct: (m: Mob) => void }).mobAct(m); };
  const disc = (g: Game, x: number, y: number, vx: number, vy: number, more: Partial<Disc> = {}): Disc =>
    ({ hero: g.party[0], x, y, vx, vy, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0, ab: false, rico: 0, ...more });
  /** A disc rolls till it stops or drops into a hole. */
  const roll = (g: Game, d: Disc) => { g.S.discs = [d]; for (let k = 0; k < 900 && !d.fall && Math.hypot(d.vx, d.vy) > 2; k++) g.step(1 / 120); return d; };
  const enemyTurn = (g: Game) => { const t = g.S.turn; endAll(g); for (let k = 0; k < 4000 && g.S.turn === t && g.S.phase !== 'over'; k++) g.update(1 / 60); };
  const on = (g: Game, h: HeroState, spots: { x: number; y: number }[]) => spots.some(c => Math.abs(c.x - g.spot(h)!.x) <= 8 && Math.abs(c.y - g.spot(h)!.y) <= 8);

  it("meets the party with one of the floor's three bosses, the one its seed picks or the one named", () => {
    for (let f = 0; f < FLOORS; f++) {
      const met = new Set<string>();
      for (let seed = 1; seed < 60; seed++) {
        const spec = { seed, depth: f * LAYERS + LAYERS, floor: f, type: 'boss' as const };
        expect(generate(spec).mobs[0].k).toBe(bossOf(spec));
        met.add(bossOf(spec));
      }
      expect([...met].sort()).toEqual([...CASTS[f].bosses].sort());
      for (const k of CASTS[f].bosses) expect(generate({ seed: 3, depth: f * LAYERS + LAYERS, floor: f, type: 'boss', boss: k }).mobs[0].k).toBe(k);
    }
  });

  it('builds each its room: burrows for the swarm, no escort for Пахан, eggs round the dragon for every hero', () => {
    for (let seed = 1; seed < 30; seed++) {
      const at = (boss: K, f: number, heroes = 3) => generate({ seed, depth: f * LAYERS + LAYERS, floor: f, type: 'boss', boss, heroes });
      const rats = at('ratswarm', 0);
      expect(rats.pits.length).toBeGreaterThanOrEqual(2);
      expect(rats.pits.length).toBeLessThanOrEqual(3);
      for (const p of rats.pits) expect(p.cells.length).toBeLessThanOrEqual(3);
      expect(at('pahan', 0).mobs.map(m => m.k)).toEqual(['pahan']);
      for (const n of [1, 2, 3]) {
        const L = at('dragon', 2, n), [d] = L.mobs, eggs = L.mobs.filter(m => m.k === 'egg');
        expect(eggs).toHaveLength(n);
        for (const e of eggs) { expect(Math.max(Math.abs(e.x - d.x), Math.abs(e.y - d.y))).toBeLessThanOrEqual(1.5 * TILE + 1); expect(e.owner).toBe(0); }
      }
    }
  });

  it("builds a boss's arena over until it suits the boss, and the same seed always gives the same arena", () => {
    for (let f = 0; f < FLOORS; f++) for (const k of CASTS[f].bosses) {
      const rooms = new Set<string>();
      let fit = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const spec = { seed, depth: f * LAYERS + LAYERS, floor: f, type: 'boss' as const, boss: k };
        const key = (L: Layout) => JSON.stringify([L.blocks, L.pits, L.mobs.map(m => [m.x, m.y])]), L = generate(spec);
        expect(key(generate(spec))).toBe(key(L));
        expect(L.mobs[0].k).toBe(k);
        if (arenaFit(L, k) >= 1) fit++;
        rooms.add(key(L));
      }
      // the rare arena that never suits in ARENA_TRIES tries is the best of them; the rooms stay random
      expect(fit, k).toBeGreaterThanOrEqual(15);
      expect(rooms.size, k).toBe(16);
    }
    expect(ARENA_TRIES).toBe(20);
  }, 60000);

  it('gives each boss what it needs: sight, burrows, a dancefloor, runs to roll down, fire that reaches', () => {
    const cheb = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    for (let seed = 1; seed <= 12; seed++) {
      const at = (boss: K) => {
        const f = MOBS[boss].floor, g = new Game();
        g.loadRoom({ seed, depth: f * LAYERS + LAYERS, floor: f, type: 'boss', boss });
        return { g, L: g.S, b: g.S.mobs.find(m => m.k === boss)! };
      };
      for (const [k, n] of [['pahan', 3], ['lich', 2], ['fridge', 2]] as const) {
        const { g, L, b } = at(k);
        if (arenaFit(L, k) >= 1) expect(L.pads.filter(p => g.clearShot(b, p)).length, k).toBeGreaterThanOrEqual(n);
      }
      const rats = at('ratswarm').L;
      if (arenaFit(rats, 'ratswarm') >= 1) {
        for (const [a, p] of rats.pits.entries()) for (const q of rats.pits.slice(a + 1)) for (const c of p.cells) for (const d of q.cells) expect(cheb(c, d)).toBeGreaterThanOrEqual(BURROW_APART);
        expect(rats.pads.some(r => rats.pits.some(p => p.cells.some(c => cheb(c, cellAt(r.x, r.y)) <= BURROW_NEAR)))).toBe(true);
      }
      const dance = at('dancer').L, i0 = Math.floor(dance.gw / 2) - 2, j0 = Math.floor(dance.gh / 2) - 2;
      if (arenaFit(dance, 'dancer') >= 1) {
        for (let j = j0; j < j0 + 4; j++) for (let i = i0; i < i0 + 4; i++) {
          const c = cellCentre(i, j);
          expect(dance.blocks.some(b => c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1) || dance.pits.some(p => inPit(p, i, j)) || dance.nodes.some(n => cellAt(n.x, n.y).join() === [i, j].join())).toBe(false);
        }
      }
      const ball = at('discoball');
      if (arenaFit(ball.L, 'discoball') >= 1) expect(lanesOf(ball.L, ball.b).filter(n => n >= 5).length).toBeGreaterThanOrEqual(2);
      const drake = at('dragon');
      if (arenaFit(drake.L, 'dragon') >= 1) expect(drake.L.pads.filter(p => fireCells(drake.L, drake.b, p).some(c => c.x === p.x && c.y === p.y)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every one of them plays seven turns through with its own moves', () => {
    const moves: Record<string, string[]> = { ratswarm: ['dive', 'emerge'], pahan: ['summon', 'brew'], fridge: ['zone', 'toss'], dancer: ['zone'], discoball: ['zone'], dragon: ['zone', 'rise'] };
    for (const [k, want] of Object.entries(moves)) {
      const f = MOBS[k as K].floor, g = new Game();
      g.loadRoom({ seed: 41, depth: f * LAYERS + LAYERS, floor: f, type: 'boss', boss: k as K });
      for (const h of g.party) h.hp = h.max = 999;
      placeAll(g); g.startFight();
      const seen = new Set<string>();
      for (let turn = 0; turn < 7 && g.S.phase !== 'over'; turn++) {
        for (const m of g.liveMobs()) if (m.intent) seen.add(m.intent.t);
        for (const h of g.party) g.throwDisc(h, -30, -40);
        enemyTurn(g);
      }
      for (const t of want) expect(seen, k).toContain(t);
    }
  });

  it('the rat swarm dives into the hole nearest its hero, a disc into that hole hits it twice, and it comes up biting all round', () => {
    const g = arena([['ratswarm', 4, 2]], [0]), [m] = g.S.mobs, [h] = g.party;
    g.S.pits = [{ k: '1x1', cells: [[1, 1]] }, { k: '1x1', cells: [[8, 6]] }];
    g.pickIntents();
    expect(m.intent!.t).toBe('dive');
    expect(m.intent!.hero).toBe(h.i);
    act(g, m, m.intent!);
    expect(m.under).toBe(1);
    expect(g.solid(m)).toBe(false);
    g.pickIntents();
    const it = m.intent!;
    expect(it.t).toBe('emerge');
    expect(on(g, h, it.spots!)).toBe(true);
    expect(g.incoming(h)).toBe(it.dmg);
    // a disc into the hole with the eyes: on its heads, twice, and its hero loses nothing for the drop
    const hp = h.hp, c = cellCentre(8, 6);
    roll(g, disc(g, c.x - 14, c.y, 120, 0));
    expect(m.max - m.hp).toBeGreaterThan(0);
    expect((m.max - m.hp) % 2).toBe(0);
    expect(h.hp).toBe(hp);
    act(g, m, it);
    expect(m.under).toBeUndefined();
    expect(m.x).toBe(it.to!.x);
    expect(h.hp).toBe(hp - it.dmg);
  });

  it('the rat swarm sheds prison rats and shrinks as it is hurt, and its last rats run from the heroes', () => {
    const g = arena([['ratswarm', 4, 3]]), [m] = g.S.mobs;
    g.hurtMob(m, 20, '#fff', true);
    expect(m.k).toBe('ratswarm2');
    expect(mobSize(m.k)).toBe(1);
    expect(g.S.mobs.filter(o => o.k === 'rat')).toHaveLength(3);
    g.hurtMob(m, 20, '#fff', true);
    expect(m.k).toBe('ratswarm3');
    expect(g.S.mobs.filter(o => o.k === 'rat')).toHaveLength(6);
    expect(m.hp).toBe(m.max - 40);
    g.pickIntents();
    expect(m.intent!.flee).toBe(true);
    // a smaller party gets fewer
    const solo = arena([['ratswarm', 4, 3]], [0]), [s] = solo.S.mobs;
    solo.hurtMob(s, 20, '#fff', true);
    expect(solo.S.mobs.filter(o => o.k === 'rat')).toHaveLength(1);
  });

  it('Пахан: a шестёрка by him takes the disc, his shiv takes ore into the pot, and at half health he gets up off his bunk', () => {
    const g = arena([['pahan', 4, 2], ['six', 6, 2]]), [p, six] = g.S.mobs;
    six.owner = 0;
    const hp = p.hp;
    roll(g, disc(g, p.x - 30, p.y, 220, 0));
    expect(p.hp).toBe(hp);
    expect(six.hp).toBeLessThan(six.max);
    g.bank.ore = 10;
    act(g, p, { t: 'hit', hero: 0, dmg: 6 });
    expect(g.bank.ore).toBe(8);
    expect(p.pot).toBe(2);
    g.hurtMob(p, p.hp - Math.floor(p.max / 2), '#fff', true);
    expect(p.k).toBe('pahan2');
    const bunk = g.S.mobs.find(o => o.k === 'bunk')!;
    expect(bunk).toBeDefined();
    expect(g.liveMobs()).not.toContain(bunk);
    expect(mobSize(p.k)).toBe(1);
    expect(Math.max(Math.abs(p.x - bunk.x), Math.abs(p.y - bunk.y))).toBe(1.5 * TILE);
    // the bunk is cover: a disc bounces off it and nothing hurts it
    const d = disc(g, bunk.x, bunk.y + 40, 0, -200);
    g.S.discs = [d];
    let top = d.y;
    for (let k = 0; k < 60; k++) { g.step(1 / 120); top = Math.min(top, d.y); }
    expect(d.vy).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(bunk.y);
    expect(bunk.hp).toBe(1);
    expect(g.clearShot({ x: bunk.x, y: bunk.y - 30 }, { x: bunk.x, y: bunk.y + 30 })).toBe(false);
    g.hurtMob(p, 999, '#fff', true);
    expect(g.bank.ore).toBe(12);
    expect(g.cleared()).toBe(true);
  });

  it('Пахан calls шестёрки and treats them: they hit harder, up to a limit', () => {
    const g = arena([['pahan', 4, 2], ['six', 6, 2]]), [p, six] = g.S.mobs;
    six.owner = 0;
    const dmg = six.dmg, max = six.max;
    for (let k = 0; k < 3; k++) act(g, p, { t: 'brew', hero: -1, dmg: 0 });
    expect(six.dmg).toBe(dmg + 4);
    expect(six.max).toBe(max + 9);
    g.S.turn = 2;
    g.pickIntents();
    expect(p.intent!.t).toBe('summon');
  });

  it('the fridge throws food with its door open, a disc into the open door hits twice, up close it bites with the door shut', () => {
    const blow = (open: boolean, from: number) => {
      const g = arena([['fridge', 4, 3]]), [m] = g.S.mobs;
      if (open) m.open = { x: 1, y: 0 };
      roll(g, disc(g, m.x + from * 40, m.y, -from * 200, 0));
      return m.max - m.hp;
    };
    expect(blow(true, 1)).toBe(2 * blow(false, 1));
    expect(blow(true, -1)).toBe(blow(false, -1));
    const g = arena([['fridge', 4, 3]]), [m] = g.S.mobs;
    expect(m.intent!.t).toBe('toss');
    const it = m.intent!, h = g.heroOf(it.hero), hp = h.hp;
    act(g, m, it);
    expect(m.open).toBeDefined();
    expect(h.hp).toBe(hp - it.dmg);
    if (FOOD_TOSS[it.item!].daze) expect(h.daze).toBe(2);
    const [b] = g.party;
    b.at = cellCentre(6, 4);
    g.pickIntents();
    expect(m.intent!.t).toBe('hit');
    expect(m.intent!.hero).toBe(b.i);
    act(g, m, m.intent!);
    expect(m.open).toBeUndefined();
  });

  it("the fridge's freezer hits and freezes whoever stays in its cone: next turn that hero throws but stays where it stands", () => {
    const g = arena([['fridge', 4, 3]]), [m] = g.S.mobs, [h] = g.party;
    h.at = cellCentre(7, 4);
    g.S.turn = 2;
    g.pickIntents();
    const it = m.intent!, hp = h.hp;
    expect(it.z).toBe('cold');
    expect(it.dmg).toBe(m.dmg);
    expect(on(g, h, it.spots!)).toBe(true);
    expect(g.incoming(h)).toBe(it.dmg);
    act(g, m, it);
    expect(h.hp).toBe(hp - it.dmg);
    expect(h.pin).toBe(2);
    expect(h.chill).toBe(2);
    (g as unknown as { nextTurn: () => void }).nextTurn();
    expect(h.pin).toBe(1);
    g.S.discs = [disc(g, 30, 30, 0, 0, { hits: 1 })];
    g.update(1 / 60);
    expect(g.spot(h)).toEqual(cellCentre(7, 4));
  });

  it('the dancer lights half the floor on its beat, hits the heroes on lit cells, and moonwalks off a hero right by it', () => {
    const g = arena([['dancer', 4, 3]]), [m] = g.S.mobs, [h] = g.party;
    g.S.turn = 2;
    g.pickIntents();
    const it = m.intent!, lit = it.spots!;
    expect(it.z).toBe('dance');
    expect(lit.length).toBeGreaterThan(20);
    const hp = g.party.map(o => o.hp);
    act(g, m, it);
    g.party.forEach((o, k) => expect(o.hp).toBe(on(g, o, lit) ? hp[k] - it.dmg : hp[k]));
    g.S.turn = 3;
    h.at = cellCentre(6, 3);
    g.pickIntents();
    expect(m.intent!.flee).toBe(true);
  });

  it('the bosses parties beat too often have more health and a harder blow, by party size', () => {
    expect(Object.keys(BOSS_UP).sort()).toEqual(['dancer', 'dragon', 'forgelord', 'fridge', 'pahan']);
    for (const [k, up] of Object.entries(BOSS_UP) as [K, { hp: number[]; dmg: number[] }][]) {
      const f = MOBS[k].floor;
      for (const heroes of [1, 2, 3]) {
        const spec = { seed: 5, depth: f * LAYERS + LAYERS, floor: f, type: 'boss' as const, boss: k, heroes };
        const now = generate(spec).mobs[0];
        delete BOSS_UP[k];
        const was = generate(spec).mobs[0];
        BOSS_UP[k] = up;
        expect(now.k).toBe(k);
        expect(now.max).toBe(Math.round(was.max * up.hp[heroes - 1]));
        expect(now.hp).toBe(now.max);
        // the boss's extra goes into its blow before `toughOf`, so the whole blow grows by it
        expect(now.dmg).toBe(mobDmg(k, dmgBonus(f, tierOf(spec).t), PARTY_SCALE[heroes].dmg, spec.seed, up.dmg[heroes - 1]));
        expect(now.dmg).toBeGreaterThanOrEqual(was.dmg + up.dmg[heroes - 1]);
        expect(up.hp[heroes - 1]).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('at half health the dancer catches disco fever: the floor lights up on every turn', () => {
    const g = arena([['dancer', 4, 3]]), [m] = g.S.mobs;
    g.S.turn = 3;
    g.pickIntents();
    expect(m.intent!.t).not.toBe('zone');
    g.hurtMob(m, m.hp - Math.floor(m.max / 2), '#fff', true);
    expect(m.k).toBe('dancer2');
    for (const turn of [3, 4, 5]) {
      g.S.turn = turn;
      g.pickIntents();
      expect(m.intent!.z).toBe('dance');
    }
  });

  it('Пахан calls up to three шестёрки for a party of three, two for a pair and one for a lone hero', () => {
    for (const [picks, most] of [[[0, 1, 2], 3], [[0, 1], 2], [[0], 1]] as const) {
      const g = arena([['pahan', 4, 2]], [...picks]), [p] = g.S.mobs;
      for (let turn = 2; turn <= 16; turn += 2) {
        g.S.turn = turn;
        g.pickIntents();
        if (p.intent!.t === 'summon') act(g, p, p.intent!);
      }
      expect(g.liveMobs().filter(o => o.k === 'six' && o.owner === 0)).toHaveLength(most);
    }
  });

  it("the forgelord brings its hammer down on a 3 × 3 square round its hero a turn before the floor heats", () => {
    const g = arena([['forgelord', 4, 3]]), [m] = g.S.mobs;
    g.S.turn = 2;
    g.pickIntents();
    const it = m.intent!, h = g.party.find(o => on(g, o, it.spots ?? []))!, hp = h.hp;
    expect(it.t).toBe('smash');
    expect(it.spots!.length).toBeGreaterThan(3);
    act(g, m, it);
    expect(h.hp).toBe(hp - it.dmg);
    g.S.turn = 3;
    g.pickIntents();
    expect(m.intent!.t).toBe('heat');
  });

  it("the dragon's belch hits whoever is on the fire line and sets them on fire", () => {
    const g = arena([['dragon', 4, 3]]), [d] = g.S.mobs;
    g.S.turn = 2;
    g.pickIntents();
    const it = d.intent!, h = g.heroOf(it.hero), hp = h.hp;
    expect(it.z).toBe('fire');
    expect(it.dmg).toBe(d.dmg);
    expect(on(g, h, it.spots!)).toBe(true);
    act(g, d, it);
    expect(h.hp).toBe(hp - it.dmg);
    expect(h.fire).toBe(2);
  });

  it('the disco ball on its chain turns a straight disc away; a ricochet hurts it and knocks off mirror tiles that cut like spikes', () => {
    const g = arena([['discoball', 4, 3]]), [m] = g.S.mobs, [h] = g.party;
    roll(g, disc(g, m.x - 40, m.y, 200, 0));
    expect(m.hp).toBe(m.max);
    roll(g, disc(g, m.x - 40, m.y, 200, 0, { bounces: 1 }));
    expect(m.hp).toBeLessThan(m.max);
    expect(m.shards).toHaveLength(1);
    const [i, j] = m.shards![0].split(',').map(Number), c = cellCentre(i, j), hp = h.hp;
    g.S.discs = [disc(g, c.x, c.y, 0, 0, { hits: 1 })];
    endAll(g);
    for (let k = 0; k < 120 && g.S.phase === 'throw'; k++) g.update(1 / 60);
    expect(h.hp).toBe(hp - g.S.biome.hazDmg);
    g.S.turn = 3;
    g.pickIntents();
    expect(m.intent!.z).toBe('beam');
    g.hurtMob(m, m.hp - Math.floor(m.max / 2), '#fff', true);
    expect(m.k).toBe('discoball2');
    const was = m.hp;
    roll(g, disc(g, m.x - 40, m.y, 200, 0));
    expect(m.hp).toBeLessThan(was);
    expect(m.shards).toHaveLength(3);
  });

  it('the fallen disco ball rolls down the lane with a hero in it and crushes that hero', () => {
    const g = arena([['discoball2', 4, 3]]), [m] = g.S.mobs, [h] = g.party;
    h.at = cellCentre(8, 3);
    g.S.turn = 2;
    g.pickIntents();
    const it = m.intent!;
    expect(it.z).toBe('roll');
    expect(it.to!.x).toBeGreaterThan(m.x);
    expect(on(g, h, it.spots!)).toBe(true);
    const hp = h.hp;
    enemyTurn(g);
    expect(h.hp).toBe(hp - it.dmg);
    expect(m.x).toBe(it.to!.x);
  });

  it('breaking a dragon egg sends the dragon after that hero twice as hard; eggs hatch one a third turn, and all at half its health', () => {
    const g = arena([['dragon', 4, 3], ['egg', 3, 3], ['egg', 7, 4]]), [d, e1, e2] = g.S.mobs;
    for (const e of [e1, e2]) { e.owner = 0; e.hold = 'imp'; }
    g.pickIntents();
    expect([e1.intent!.eta, e2.intent!.eta]).toEqual([3, 6]);
    const b = g.party[1];
    b.at = cellCentre(3, 5);
    g.hurtMob(e1, 99, '#fff', true, 0.6, b);
    expect(d.mad).toBe(b.i);
    expect(d.intent).toMatchObject({ t: 'hit', hero: b.i, dmg: 2 * d.dmg });
    expect(e2.intent!.eta).toBe(6);
    act(g, d, d.intent!);
    expect(d.mad).toBeUndefined();
    expect(d.speed).toBe(0);
    g.hurtMob(d, d.hp - Math.floor(d.max / 2), '#fff', true);
    expect(d.k).toBe('dragon2');
    expect(e2.k).toBe('imp');
    expect(g.liveMobs().filter(o => o.k === 'egg')).toHaveLength(0);
  });

  it('a client sees what the host has: the swarm in its burrow, the open door, the shards, the bunk and the frozen hero', () => {
    const g = arena([['ratswarm', 4, 3], ['fridge', 0, 0]]), [r, f] = g.S.mobs;
    g.S.pits = [{ k: '1x1', cells: [[8, 6]] }];
    r.under = 0; f.open = { x: 1, y: 0 }; f.shards = ['3,3'];
    g.S.mobs.push(newMob('bunk', 100, 100));
    g.party[0].pin = 2;
    const cli = new Game();
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(g))));
    expect(cli.S.mobs[0].under).toBe(0);
    expect(cli.S.mobs[1].open).toEqual({ x: 1, y: 0 });
    expect(cli.shardAt(3, 3)).toBe(true);
    expect(cli.fixtures()).toHaveLength(1);
    expect(cli.party[0].pin).toBe(2);
  });
});
