import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera';
import { generate } from '../src/room';
import { FLOORS, LAYERS, genFloor, newRun } from '../src/run';

describe('room generator', () => {
  it('builds the same room from the same seed', () => {
    const spec = { seed: 48213, depth: 4, floor: 1, type: 'fight' as const };
    const a = generate(spec), b = generate(spec);
    expect(JSON.stringify({ ...a, haz: [...a.haz] })).toBe(JSON.stringify({ ...b, haz: [...b.haz] }));
  });

  it('always has five throw runes and at least one mob', () => {
    for (let seed = 1; seed < 60; seed++) {
      const L = generate({ seed, depth: 1 + (seed % 15), floor: seed % 3, type: seed % 5 ? 'fight' : 'boss' });
      expect(L.pads).toHaveLength(5);
      expect(L.mobs.length).toBeGreaterThan(0);
      for (const m of L.mobs) {
        expect(m.x).toBeGreaterThan(0);
        expect(m.x).toBeLessThan(L.Wx);
      }
    }
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
  it('has at most 9 rooms before the boss and every room is reachable', () => {
    for (let seed = 10000; seed < 10040; seed++) {
      for (let f = 0; f < FLOORS; f++) {
        const layers = genFloor(seed, f);
        expect(layers).toHaveLength(LAYERS);
        expect(layers.slice(0, -1).flat().length).toBeLessThanOrEqual(9);
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
