import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera';
import { CRIT, E_MAX, HAND_COST, HAND_MAX, HAND_START, HEROES, MOBS, MOB_HP_MUL, NODE_E, RAGE_FROM, TILE, UP_COST, mobSize } from '../src/data';
import { Game, newParty, stepsOf, wayLen, type Action } from '../src/game';
import { applySnapshot, snapshot } from '../src/sync';
import { MOB_CAP, cellAt, cellCentre, clearOfRock, floorAt, generate, isFloor, muAt, newMob, tierOf } from '../src/room';
import { FLOORS, LAYERS, agreed, genFloor, newRun, restRoom } from '../src/run';

/** Put every living hero on its own rune, as players do before the fight. */
const placeAll = (g: Game) => g.alive().forEach((h, k) => g.movePad(h, k));

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

  it('spends ore from one pool shared by the party', () => {
    const g = fresh();
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
    g.bank.ore = 100;
    while (g.discCost(h)) g.buyDisc();
    expect(h.discs).toBe(HAND_MAX);
    expect(h.hand).toBe(HAND_MAX);
    expect(g.bank.ore).toBe(100 - HAND_COST[0] - HAND_COST[1]);
  });

  it('prices an extra disc above any single stat level', () => {
    for (const c of HAND_COST) expect(c).toBeGreaterThan(Math.max(...UP_COST));
  });

  it('grows damage and speed by the same share for every hero, and stops the bounce at its limit', () => {
    const g = fresh();
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

  it('starts every fight without sparks, except the altar gift for the next one', () => {
    const g = fresh();
    g.bank.sparks = 7;
    g.bank.ore = 5;
    g.loadRoom({ seed: 3, depth: 2, floor: 0, type: 'fight' });
    expect(g.bank.sparks).toBe(0);
    expect(g.bank.ore).toBe(5);
    // the altar of sparks is one of the events; find a seed that rolls it
    let seed = 0;
    while (!restRoom('event', newParty(), { ore: 0, sparks: 0 }, seed).startsWith('Алтарь')) seed++;
    restRoom('event', g.party, g.bank, seed);
    expect(g.bank.sparks).toBe(0);
    g.loadRoom({ seed: 4, depth: 3, floor: 0, type: 'fight' });
    expect(g.bank.sparks).toBe(4);
    g.loadRoom({ seed: 5, depth: 4, floor: 0, type: 'fight' });
    expect(g.bank.sparks).toBe(0);
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
    for (const g of [host, back]) { g.throwDisc(g.heroOf(2), -0.4, -1); for (let k = 0; k < 600; k++) g.update(1 / 60); }
    const plain = (g: Game) => { const s = snapshot(g); return JSON.stringify({ ...s, floats: [], sparks: [] }); };
    expect(plain(back)).toBe(plain(host));
  });

  it('shows every player the same enemy moving', () => {
    const { host, cli } = pair();
    host.startFight(host.heroOf(0));
    host.startFight(host.heroOf(2));
    for (const h of host.party) { h.hand = 0; h.thrown = true; }
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
      g.S.discs = [{ hero: g.hero, x: b.x0 - 6, y: (b.y0 + b.y1) / 2, vx: 260, vy: 0, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces: 0, spin: 0, hits: 0 }];
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
    for (const h of g.party) h.hand = 0;
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
    ({ hero: g.party[0], x, y, vx, vy, r: 5, m: 4, e: 0.6, fr: 1, fall: 0, gone: false, charged: false, bounces, spin: 0, hits: 0 });

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

describe('enemy turn order', () => {
  /** A floor 0 fight with just the given enemies on the cells along the top, nobody throwing. */
  const arena = (kinds: (keyof typeof MOBS)[]) => {
    const g = new Game();
    g.loadRoom({ seed: 7, depth: 2, floor: 0, type: 'fight' });
    g.S.mobs = kinds.map((k, i) => newMob(k, cellCentre(2 + i * 2, 1).x, cellCentre(2 + i * 2, 1).y, 1, 0));
    g.S.nodes = [];
    g.S.blocks = [];
    placeAll(g); g.startFight();
    for (const h of g.party) { h.hp = h.max = 99; h.hand = 0; h.thrown = true; }
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
    for (const h of g.party) { h.hand = 0; h.thrown = true; }
    expect(g.S.mobs[0].intent!.t).toBe('summon');
    const actors = new Set<number>();
    for (let k = 0; k < 2000 && g.S.turn === t0 + 1; k++) { g.update(1 / 60); if (g.S.phase === 'enemy' && g.S.actor >= 0) actors.add(g.S.actor); }
    expect(g.S.mobs).toHaveLength(3);
    expect([...actors]).toEqual([0, 1]);
    expect(g.S.mobs[2].intent).not.toBeNull();
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
      for (const n of L.nodes) claim(n.x, n.y, 1);
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
          for (const h of g.alive()) { h.hand = 0; h.thrown = true; }
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
