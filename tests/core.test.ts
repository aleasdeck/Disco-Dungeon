import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera';
import { HAND_MAX, HAND_START, HEROES, MOBS, TILE } from '../src/data';
import { Game, newParty, type Action } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { clearOfRock, floorAt, generate, isFloor, tierOf } from '../src/room';
import { FLOORS, LAYERS, genFloor, newRun } from '../src/run';

describe('room generator', () => {
  it('builds the same room from the same seed', () => {
    const spec = { seed: 48213, depth: 4, floor: 1, type: 'fight' as const };
    const a = generate(spec), b = generate(spec);
    expect(JSON.stringify({ ...a, haz: [...a.haz] })).toBe(JSON.stringify({ ...b, haz: [...b.haz] }));
  });

  it('always has five throw runes and at least one mob', () => {
    for (let seed = 1; seed < 60; seed++) {
      const f = seed % 3, L = generate({ seed, depth: f * LAYERS + 1 + (seed % 6), floor: f, type: seed % 5 ? 'fight' : 'boss' });
      expect(L.pads).toHaveLength(5);
      expect(L.mobs.length).toBeGreaterThan(0);
      for (const m of L.mobs) expect(clearOfRock(L, m.x, m.y, m.r)).toBe(true);
      for (const n of L.nodes) expect(clearOfRock(L, n.x, n.y, n.r)).toBe(true);
      for (const p of L.pads) expect(floorAt(L, p.x, p.y)).toBe(true);
    }
  });

  it('puts every enemy in the room from the start, tougher than the base stats', () => {
    const L = generate({ seed: 5, depth: 1, floor: 0, type: 'fight' });
    expect('waves' in L).toBe(false);
    for (const m of L.mobs) expect(m.max).toBe(Math.round(MOBS[m.k].hp * 1.6));
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
        expect(L.mobs.length).toBeGreaterThanOrEqual(Math.min(tierOf(spec).tier.mobs[0] + f, 7));
        expect(L.pads).toHaveLength(5);
      }
    }
  });

  it('hits harder on later floors and in the last rooms before the boss', () => {
    expect(room(0, 0, 3).dmgAdd).toBe(0);
    expect(room(0, LAYERS - 2, 3).dmgAdd).toBe(1);
    expect(room(2, 0, 3).dmgAdd).toBe(2);
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
    cam.fit(200, 176, 34, { x: 0, y: 0, w: 1200, h: 800 });
    const before = cam.screenToWorld(500, 420);
    cam.zoomAt(1.7, 500, 420);
    cam.rotateAt(1.1, 500, 420);
    const after = cam.screenToWorld(500, 420);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
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
});

describe('placement and discs', () => {
  const fresh = () => { const g = new Game(); g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' }); return g; };

  it('puts every hero on its own rune with one disc', () => {
    const g = fresh(), pads = g.party.map(h => h.pad);
    expect(g.S.phase).toBe('place');
    expect(new Set(pads).size).toBe(g.party.length);
    for (const h of g.party) { expect(h.pad).not.toBeNull(); expect(h.discs).toBe(HAND_START); expect(h.hand).toBe(1); }
  });

  it('swaps heroes when one is dragged onto an occupied rune', () => {
    const g = fresh(), [a, b] = g.party, pa = a.pad!, pb = b.pad!;
    expect(g.movePad(a, pb)).toBe(true);
    expect([a.pad, b.pad]).toEqual([pb, pa]);
    g.startFight();
    expect(g.S.phase).toBe('throw');
  });

  it('spends ore from one pool shared by the party', () => {
    const g = fresh();
    g.bank.ore = 4;
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
    g.bank.ore = 100;
    while (g.discCost(h)) g.buyDisc();
    expect(h.discs).toBe(HAND_MAX);
    expect(h.hand).toBe(HAND_MAX);
    expect(g.bank.ore).toBe(100 - 4 - 6);
  });
  it('ends the fight the moment the last enemy falls, with throws still left', () => {
    const g = fresh();
    let won: boolean | null = null;
    g.onRoomEnd = w => { won = w; };
    g.startFight();
    g.throwDisc(g.party[0], 1, 0);
    for (const m of g.S.mobs) m.hp = 0;
    g.update(1 / 60);
    expect(g.S.phase).toBe('over');
    expect(won).toBe(true);
    expect(g.party.some(h => h.hand > 0)).toBe(true);
  });
});

describe('discs and aiming', () => {
  it('every disc fits through a one-tile gap between blocks', () => {
    for (const d of HEROES) expect(d.r * 2).toBeLessThan(TILE - 2);
  });

  it('predicts a path that starts at the rune and heads where the throw points', () => {
    const g = new Game();
    g.loadRoom({ seed: 11, depth: 2, floor: 0, type: 'fight' });
    g.startFight();
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
    for (const g of [host, back]) { g.throwDisc(g.heroOf(2), -0.4, -1); for (let k = 0; k < 600; k++) g.update(1 / 60); }
    const plain = (g: Game) => { const s = snapshot(g); return JSON.stringify({ ...s, floats: [], sparks: [] }); };
    expect(plain(back)).toBe(plain(host));
  });

  it('lets a client control only its own hero', () => {
    const { cli } = pair();
    cli.select(0);
    expect(cli.act).toBe(2);
  });
});
