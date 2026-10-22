import { describe, expect, it } from 'vitest';
import { MOBS, type MobKind } from '../src/data';
import { Game, newParty } from '../src/game';
import type { RoomSpec } from '../src/room';
import { DOSSIER, DOS_BEATS, dosKind, dossierOf, inDossier, noteRoom } from '../src/dossier';

/** A room of the given spec, as a party of two walks into it. */
function room(spec: RoomSpec) {
  const g = new Game();
  g.party = newParty([0, 1]);
  g.loadRoom(spec);
  return g;
}

/** The room over: every enemy in it beaten. */
function win(g: Game) {
  for (const m of g.S.mobs) m.hp = 0;
  g.S.phase = 'over';
}

describe('the enemies\' dossier', () => {
  it('has two lines for every enemy of the collection, and only for them', () => {
    const kinds = (Object.keys(MOBS) as MobKind[]).filter(inDossier);
    expect(kinds).toHaveLength(28);
    for (const k of kinds) {
      expect(DOSSIER[k]).toHaveLength(2);
      for (const line of DOSSIER[k]!) expect(line.length).toBeGreaterThan(20);
    }
    expect(Object.keys(DOSSIER).sort()).toEqual([...kinds].sort());
    expect(dosKind('ratswarm3')).toBe('ratswarm');
  });

  it('meets the enemies of a room as it plays and counts the beaten ones once the room is over, once', () => {
    const g = room({ seed: 41, depth: 2, floor: 1, type: 'fight' });
    const kinds = [...new Set(g.S.mobs.map(m => dosKind(m.k)).filter(inDossier))];
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.some(k => dossierOf(k).met)).toBe(false);
    noteRoom(g.S);
    for (const k of kinds) expect(dossierOf(k)).toMatchObject({ met: true, n: 0, open: 0 });
    win(g);
    noteRoom(g.S);
    noteRoom(g.S);
    const k = kinds[0], beaten = g.S.mobs.filter(m => dosKind(m.k) === k).length;
    expect(dossierOf(k).n).toBe(beaten);
  });

  it('opens a line at 10 and at 50 beaten', () => {
    const k: MobKind = 'skel';
    for (let seed = 1; dossierOf(k).n < DOS_BEATS[1]; seed++) {
      const g = room({ seed, depth: 2, floor: 0, type: 'fight' });
      noteRoom(g.S);
      win(g);
      noteRoom(g.S);
      const f = dossierOf(k);
      expect(f.open).toBe(DOS_BEATS.filter(x => f.n >= x).length);
    }
    expect(dossierOf(k).open).toBe(2);
  });

  it('counts a boss once its room is won, its later phase as the boss, and not when the party falls', () => {
    const g = room({ seed: 8, depth: 8, floor: 0, type: 'boss', boss: 'ratswarm' });
    noteRoom(g.S);
    expect(dossierOf('ratswarm')).toMatchObject({ met: true, n: 0, open: 0 });
    g.S.mobs[0].k = 'ratswarm2';
    win(g);
    noteRoom(g.S);
    expect(dossierOf('ratswarm')).toMatchObject({ n: 1, open: 1 });
    const lost = room({ seed: 9, depth: 8, floor: 0, type: 'boss', boss: 'ratswarm' });
    for (const h of lost.S.heroes) h.hp = 0;
    lost.S.phase = 'over';
    noteRoom(lost.S);
    expect(dossierOf('ratswarm').n).toBe(1);
  });

  it('leaves the warm-up out', () => {
    const all = () => (Object.keys(MOBS) as MobKind[]).filter(inDossier).map(k => dossierOf(k));
    const before = all();
    const g = room({ seed: 3, depth: 1, floor: 0, type: 'fight', tut: true });
    noteRoom(g.S);
    win(g);
    noteRoom(g.S);
    expect(all()).toEqual(before);
  });
});
