import { describe, expect, it } from 'vitest';
import { HEROES, MOBS, type MobKind } from '../src/data';
import { Game, newParty } from '../src/game';
import { CASTS, WARM, generate, mobPool } from '../src/room';
import { LAYERS } from '../src/run';
import { BASTION_I, HINT_LINES, WARM_LINES } from '../src/tutor';

const DUMMIES: MobKind[] = ['dummy', 'dummy_lady', 'dummy_boxer'];

/** Бастион alone in the warm-up room, on its rune, the fight on. */
function warm() {
  const g = new Game();
  g.party = newParty([BASTION_I]);
  g.loadRoom({ seed: 3, depth: 1, floor: 0, type: 'fight', tut: true });
  g.movePad(g.party[0], 0);
  g.startFight();
  return g;
}

const enemyTurn = (g: Game) => {
  const t = g.S.turn;
  g.endTurn(g.party[0]);
  for (let k = 0; k < 3000 && g.S.turn === t; k++) g.update(1 / 60);
  expect(g.S.turn).toBe(t + 1);
};

describe('the warm-up room', () => {
  it('is built by hand, the same for any seed: one rune, three dummies, a spark crystal, a column, no holes or spikes', () => {
    const a = generate({ seed: 1, depth: 1, floor: 0, type: 'fight', tut: true }), b = generate({ seed: 999, depth: 5, floor: 2, type: 'boss', tut: true });
    for (const L of [a, b]) {
      expect([L.gw, L.gh]).toEqual([WARM.gw, WARM.gh]);
      expect(L.pads).toHaveLength(1);
      expect(L.mobs.map(m => m.k).sort()).toEqual([...DUMMIES].sort());
      expect(L.nodes.map(n => n.k)).toEqual(['spk']);
      expect(L.blocks).toHaveLength(WARM.column.length);
      expect(L.pits).toHaveLength(0);
      expect(L.haz.size).toBe(0);
      // the dummies come as they are drawn up, the room's depth and floor don't toughen them
      for (const m of L.mobs) { expect(m.max).toBe(MOBS[m.k].hp); expect(m.dmg).toBe(Math.max(1, MOBS[m.k].dmg)); }
    }
    expect(a.mobs.map(m => [m.x, m.y])).toEqual(b.mobs.map(m => [m.x, m.y]));
  });

  it('hides the lady dummy behind the column from the rune, and a disc off a wall still gets to her', () => {
    const g = warm(), h = g.party[0], rune = g.spot(h)!, lady = g.S.mobs.find(m => m.k === 'dummy_lady')!;
    expect(g.clearShot(rune, lady)).toBe(false);
    const plain = g.S.mobs.find(m => m.k === 'dummy')!;
    expect(g.clearShot(rune, plain)).toBe(true);
    let banks = 0;
    for (let a = 0; a < 360; a++) {
      const r = g.predict(h, Math.cos((a * Math.PI) / 180) * 60, Math.sin((a * Math.PI) / 180) * 60, 2);
      if (r.hit === lady) banks++;
    }
    expect(banks).toBeGreaterThan(4);
  });

  it('has two dummies that just stand there and a boxer that punches the hero it sees, softly', () => {
    const g = warm(), h = g.party[0];
    const by = (k: MobKind) => g.S.mobs.find(m => m.k === k)!;
    expect(by('dummy').intent!.t).toBe('idle');
    expect(by('dummy_lady').intent!.t).toBe('idle');
    expect(by('dummy_boxer').intent).toMatchObject({ t: 'hit', hero: h.i, dmg: MOBS.dummy_boxer.dmg });
    expect(g.incoming(h)).toBe(MOBS.dummy_boxer.dmg);
    enemyTurn(g);
    expect(h.hp).toBe(h.max - MOBS.dummy_boxer.dmg);
    // nothing has walked
    expect(g.S.mobs.map(m => [m.x, m.y])).toEqual(generate({ seed: 3, depth: 1, floor: 0, type: 'fight', tut: true }).mobs.map(m => [m.x, m.y]));
  });

  it('lays nobody down: a blow that would leaves the hero on its last drop, and says so', () => {
    const g = warm(), h = g.party[0];
    g.hurtHero(h, 999);
    expect(h.hp).toBe(1);
    expect(g.spared).toBe(true);
    // in a real fight the same blow lays the hero down
    const f = new Game();
    f.party = newParty([BASTION_I]);
    f.loadRoom({ seed: 3, depth: 1, floor: 0, type: 'fight' });
    f.movePad(f.party[0], 0);
    f.startFight();
    f.hurtHero(f.party[0], 999);
    expect(f.party[0].hp).toBeLessThanOrEqual(0);
    expect(f.spared).toBe(false);
  });

  it('never gets angry, however long it takes', () => {
    const g = warm();
    for (let k = 0; k < 8; k++) enemyTurn(g);
    expect(g.rage()).toBe(0);
  });

  it('is cleared once the three dummies are down', () => {
    const g = warm();
    expect(g.cleared()).toBe(false);
    for (const m of g.S.mobs) m.hp = 0;
    expect(g.cleared()).toBe(true);
  });
});

describe('the dummies', () => {
  it('belong to the warm-up only: no room of a run draws them, and the bestiary leaves them out', () => {
    for (const k of DUMMIES) expect(MOBS[k].dummy).toBe(true);
    for (const [f, c] of CASTS.entries()) {
      for (let row = 0; row < LAYERS; row++) for (const k of mobPool(f, row)) expect(MOBS[k].dummy).toBeFalsy();
      expect(MOBS[c.elite].dummy).toBeFalsy();
      for (const k of c.bosses) expect(MOBS[k].dummy).toBeFalsy();
    }
  });
});

describe('the hero\'s lines', () => {
  it('are Бастион\'s, without a single number in them', () => {
    expect(HEROES[BASTION_I].key).toBe('bastion');
    for (const t of [...Object.values(WARM_LINES), ...Object.values(HINT_LINES)]) {
      expect(t).not.toMatch(/\d/);
      expect(t.length).toBeLessThan(200);
    }
  });
});
