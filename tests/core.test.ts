import { describe, expect, it } from 'vitest';
import { Camera, FIT, KEEP, type Vec } from '../src/camera';
import { AB_BOUNCES, AB_BURN, AB_COST, AB_SHIELD, AB_SPEED, CRIT, E_MAX, HAND_COST, HAND_MAX, HAND_START, HEROES, MOBS, MOB_HP_MUL, NODE_E, RAGE_FROM, TILE, UP_COST, mobSize } from '../src/data';
import { Game, newBank, newParty, stepsOf, wayLen, type Action, type HeroState } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { CAVE, MOB_CAP, PARTY_SCALE, caveTurns, PIT_CELLS, PIT_KINDS, PIT_SHAPES, cellAt, cellCentre, clearOfRock, floorAt, generate, hazKey, inPit, isFloor, muAt, newMob, pitAt, tierOf, type Intent, type Layout, type Mob } from '../src/room';
import { FLOORS, FORGE_ROWS, LAYERS, agreed, genFloor, newRun } from '../src/run';
import { makeRng } from '../src/rng';
import { EVENTS, applyFx, canPick, eventDef, eventOf, fxParts, rolled } from '../src/events';
import { CAMP_HEAL, DIG_MAX, campDo, campLeave, canCamp, digOre, type CampState } from '../src/camp';

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

  it('always has four throw runes and at least one mob', () => {
    for (let seed = 1; seed < 60; seed++) {
      const f = seed % 3, L = generate({ seed, depth: f * LAYERS + 1 + (seed % 6), floor: f, type: seed % 5 ? 'fight' : 'boss' });
      expect(L.pads).toHaveLength(4);
      expect(L.mobs.length).toBeGreaterThan(0);
      for (const m of L.mobs) expect(clearOfRock(L, m.x, m.y, m.r)).toBe(true);
      for (const n of L.nodes) expect(clearOfRock(L, n.x, n.y, n.r)).toBe(true);
      for (const p of L.pads) expect(floorAt(L, p.x, p.y)).toBe(true);
    }
  });

  it('puts every enemy in the room from the start, tougher than the base stats', () => {
    const L = generate({ seed: 5, depth: 1, floor: 0, type: 'fight' });
    expect('waves' in L).toBe(false);
    for (const m of L.mobs) expect(m.max).toBe(Math.round(MOBS[m.k].hp * MOB_HP_MUL));
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
  it('puts one ore vein in a plain fight, two in an elite one and the most in the ore cave', () => {
    const veins = (type: 'fight' | 'elite' | 'treasure' | 'boss', seed: number) =>
      generate({ seed, depth: type === 'boss' ? LAYERS : 5, floor: 0, type }).nodes.filter(n => n.k === 'ore').length;
    for (let seed = 1; seed < 30; seed++) {
      expect(veins('fight', seed)).toBe(1);
      expect(veins('elite', seed)).toBe(2);
      expect(veins('boss', seed)).toBe(1);
      expect(veins('treasure', seed)).toBe(3);
    }
  });
});

describe('ore cave', () => {
  const cave = (seed: number, heroes: number) => generate({ seed, depth: LAYERS + 2, floor: 1, type: 'treasure', heroes });
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

  it('holds no enemies, one big vein on 2 × 2 cells, two small ones and two mushroom patches, the same for any party', () => {
    for (let seed = 1; seed < 40; seed++) for (const heroes of [1, 2, 3]) {
      const L = cave(seed, heroes), [big, ...rest] = L.nodes;
      const small = rest.filter(n => n.k === 'ore'), herbs = rest.filter(n => n.k === 'herb');
      expect(L.mobs).toHaveLength(0);
      expect(big).toMatchObject({ k: 'ore', s: 2, r: CAVE.big.r, ch: CAVE.big.ch, left: CAVE.big.ch });
      expect(small).toHaveLength(2);
      for (const n of small) { expect(n).toMatchObject({ ch: CAVE.small, left: CAVE.small }); expect(n.s).toBeUndefined(); }
      expect(herbs).toHaveLength(2);
      expect(rest).toHaveLength(4);
    }
    expect(sum(cave(7, 1).nodes.map(n => n.ch))).toBe(sum(cave(7, 3).nodes.map(n => n.ch)));
  });

  it('gives 4 minus the heroes turns: three alone, one for three heroes', () => {
    expect([1, 2, 3].map(heroes => caveTurns({ heroes }))).toEqual([3, 2, 1]);
  });

  const enter = (picks: number[], seed = 11) => {
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
    const { g, won } = enter([0]);
    const [big] = g.S.nodes;
    // the veins spent, a mushroom patch left: a throw may still go for health
    for (const n of g.S.nodes) n.left = n.k === 'herb' ? 1 : 0;
    g.update(1 / 60);
    expect(g.cleared()).toBe(false);
    expect(g.S.phase).toBe('throw');
    // the last charge: the big vein a hit away, the rest spent
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
      const a = room(f, 0, seed), z = room(f, LAYERS - 2, seed);
      expect(a.shape).toBe('rect');
      expect(a.pits).toHaveLength(0);
      expect(a.gw * a.gh).toBeLessThan(z.gw * z.gh);
      expect(a.mobs.length).toBeLessThan(z.mobs.length);
      expect(a.haz.size).toBeLessThan(z.haz.size);
      expect(z.pits.length).toBeGreaterThan(0);
    }
  });

  it('places every enemy it asks for, in every row of every floor', () => {
    for (let f = 0; f < FLOORS; f++) for (let row = 0; row < LAYERS - 1; row++) for (const type of ['fight', 'elite'] as const) {
      for (let seed = 1; seed < 60; seed++) {
        const spec = { seed, depth: f * LAYERS + row + 1, floor: f, type }, L = generate(spec);
        expect(L.mobs.length).toBeGreaterThanOrEqual(Math.min(tierOf(spec).tier.mobs[0] + f, MOB_CAP));
        expect(L.mobs.length).toBeLessThanOrEqual(MOB_CAP);
        expect(L.pads).toHaveLength(4);
      }
    }
  });

  it('keeps even the last rooms of the last floor uncluttered', () => {
    for (let seed = 1; seed < 40; seed++) {
      const L = room(FLOORS - 1, LAYERS - 2, seed), area = L.floor.reduce((a, b) => a + b, 0);
      const busy = L.mobs.length + L.blocks.length + L.pits.length + L.haz.size + L.nodes.length;
      expect(L.nodes).toHaveLength(3);
      expect(L.decals.length).toBeLessThanOrEqual(6);
      expect(busy / area).toBeLessThan(0.2);
    }
  });

  it('hits harder on later floors and in the last rooms before the boss', () => {
    expect(room(0, 0, 3).dmgAdd).toBe(0);
    expect(room(0, LAYERS - 2, 3).dmgAdd).toBe(1);
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
    // the first rows get only small ones, the boss fights on whole floor
    for (let seed = 1; seed < 40; seed++) {
      expect(generate({ seed, depth: 3, floor: 0, type: 'fight' }).pits.every(p => p.cells.length <= 2)).toBe(true);
      expect(generate({ seed, depth: LAYERS, floor: 0, type: 'boss' }).pits).toHaveLength(0);
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
  it('has 7 rows, 12 to 16 rooms before the boss, rest rows in the middle and every room reachable', () => {
    for (let seed = 10000; seed < 10040; seed++) {
      for (let f = 0; f < FLOORS; f++) {
        const layers = genFloor(seed, f);
        expect(layers).toHaveLength(LAYERS);
        const n = layers.slice(0, -1).flat().length;
        expect(n).toBeGreaterThanOrEqual(12);
        expect(n).toBeLessThanOrEqual(16);
        for (const r of [3, 5]) expect(layers[r].some(m => m.type === 'camp' || m.type === 'forge')).toBe(true);
        // discs are upgraded only at the blacksmith's, so every floor has one by its middle
        expect(FORGE_ROWS.some(r => layers[r].some(m => m.type === 'forge'))).toBe(true);
        expect(layers[LAYERS - 1][0].type).toBe('boss');
        for (let l = 1; l < LAYERS; l++) {
          for (const n of layers[l]) expect(layers[l - 1].some(p => p.next.includes(n.id))).toBe(true);
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

describe('placement and discs', () => {
  const fresh = () => { const g = new Game(); g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' }); return g; };

  it('starts with four empty runes and every hero waiting with one disc', () => {
    const g = fresh();
    expect(g.S.phase).toBe('place');
    expect(g.S.pads).toHaveLength(4);
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
    g.movePad(c, 3);
    // a placed hero dragged onto a taken rune swaps with the hero there
    expect(g.movePad(a, 1)).toBe(true);
    expect([a.pad, b.pad]).toEqual([1, 0]);
    g.startFight();
    expect(g.S.phase).toBe('throw');
    expect(g.movePad(a, 2)).toBe(false);
    expect(a.pad).toBe(1);
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
    expect(g.bank.ore).toBe(100 - HAND_COST[0] - HAND_COST[1]);
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

  it('starts every fight without sparks, except full ones for every hero after the altar', () => {
    const g = fresh(), sparks = () => g.party.map(h => h.sparks);
    for (const h of g.party) h.sparks = 2;
    g.bank.ore = 5;
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([0, 0, 0]);
    expect(g.bank.ore).toBe(5);
    // the disco god's altar: a dance gives full sparks in the next fight, not this one
    applyFx(eventDef('altar').choices[0].win.fx, g.party, g.bank, 1);
    expect(sparks()).toEqual([0, 0, 0]);
    g.loadRoom({ seed: 4, depth: 3, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([AB_COST, AB_COST, AB_COST]);
    // full sparks pay for the ability right away
    placeAll(g); g.startFight();
    expect(g.party.every(h => g.canUseAbility(h))).toBe(true);
    g.loadRoom({ seed: 5, depth: 4, floor: 0, type: 'fight' });
    expect(sparks()).toEqual([0, 0, 0]);
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
    host.bank.ore = 20;
    applySnapshot(cli, JSON.parse(JSON.stringify(snapshot(host))));
    expect(cli.forge).toBe(4);
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
    expect(JSON.parse(JSON.stringify(snapshot(back))).bank).toEqual({ ore: 6, boon: 0 });
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
    expect(seen.map(s => [...s].filter(k => MOBS[k as keyof typeof MOBS].boss))).toEqual([['king'], ['lich'], ['forgelord']]);
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
    const forge = fight(2, ['forgelord', 'bomber']);
    expect(on(forge, 1)).toEqual([{ name: 'жар', turns: 2 }, { name: 'фитиль', turns: 0 }]);
    expect(on(forge, 2)).toEqual([{ name: 'жар', turns: 1 }, { name: 'фитиль', turns: 1 }]);
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
    const n = { k: 'spk' as const, name: 'Кристалл искр', r: 6, ch: 3, x: 88, y: 88, left: 9, hit: 0 };
    g.S.nodes = [n];
    const hit = (h: HeroState) => {
      g.S.floats = [];
      g.S.discs = [{ ...disc(g, n.x, n.y + n.r + 6.5, 0, -200), hero: h }];
      g.step(1 / 60);
      return g.S.floats.map(f => f.txt);
    };
    // a fallen hero gets none; one nearly full gets only what is still missing
    c.hp = 0;
    a.sparks = 2;
    // a hard hit chips off two, for everyone
    expect(hit(b)).toContain('+2 искры всем');
    expect([a.sparks, b.sparks, c.sparks]).toEqual([AB_COST, 2, 0]);
    // a full hero's disc still fills the others
    expect(hit(a)).toContain('+1 искра всем');
    expect([a.sparks, b.sparks, c.sparks]).toEqual([AB_COST, AB_COST, 0]);
    expect(hit(b)).toContain('искры полны');
    expect([a.sparks, b.sparks]).toEqual([AB_COST, AB_COST]);
    // the crystal still gives one charge less for the hit that found everyone full
    expect(n.left).toBe(6);
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
    expect(g.S.floats.map(f => f.txt)).toContain('+2 искры');
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
  const lines = (g: Game) => g.S.log.map(l => l.txt);

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
      'Пепельница горит: −2',
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
      'Пепельница пала',
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
      g.loadRoom({ seed: 99 + f, depth: f * LAYERS + (type === 'boss' ? LAYERS : 4), floor: f, type });
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
    let detours = 0;
    for (let seed = 1; seed < 80; seed++) {
      const g = new Game();
      g.loadRoom({ seed, depth: 1 + (seed % 12), floor: seed % 3, type: 'fight' });
      placeAll(g); g.startFight();
      const taken = g.occupied(null, false);
      for (const m of g.liveMobs()) {
        const it = m.intent;
        if (!it?.way || (it.t !== 'hit' && it.t !== 'move')) continue;
        const pad = g.S.pads[g.heroOf(it.hero).pad!], end = it.way[it.way.length - 1];
        expect(end).toEqual({ x: pad.x, y: pad.y });
        const cells = it.way.slice(0, -1), sz = mobSize(m.k);
        if (wayLen(cells) > Math.hypot(pad.x - m.x, pad.y - m.y) + 24) detours++;
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
  const cell = (g: Game, h: HeroState) => cellAt(g.spot(h)!.x, g.spot(h)!.y);

  it('starts the next turn on the cell holding most of its last disc, and throws from there', () => {
    const g = arena(), [a, b, c] = g.party;
    for (const [i, j] of [[5, 4], [6, 4], [3, 5]]) expect(isFloor(g.S, i, j)).toBe(true);
    // a's first disc is forgotten, its last one lies mostly on (5, 4) and a little on (6, 4)
    g.S.discs = [lying(g, a, cellCentre(3, 5).x, cellCentre(3, 5).y), lying(g, b, cellCentre(3, 5).x + 2, cellCentre(3, 5).y), lying(g, a, 94, 72)];
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
    // a hero that lands picks its last disc up; an earlier disc lies there till the turn ends
    g.update(0.4);
    expect(g.figureAt(a)).toEqual({ ...cellCentre(5, 4), lift: 0 });
    expect(g.S.discs.map(d => d.gone)).toEqual([false, true, true]);
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

  it('a hero whose last disc fell into a pit goes back to its rune', () => {
    const g = arena(), [a, b] = g.party;
    a.at = cellCentre(5, 4);
    // b's disc stopped on a's rune, but a's way back comes first
    const r = g.S.pads[a.pad!];
    g.S.discs = [lying(g, a, 60, 60), lying(g, b, r.x, r.y), lying(g, a, 120, 60, 0.3)];
    settle(g);
    expect(g.spot(a)).toEqual(r);
    expect(g.spot(b)).not.toEqual(r);
    expect(Math.hypot(g.spot(b)!.x - r.x, g.spot(b)!.y - r.y)).toBeLessThanOrEqual(TILE * Math.SQRT2);
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
