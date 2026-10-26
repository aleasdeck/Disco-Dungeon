import { describe, expect, it } from 'vitest';
import { cutSource, demoHtml, demoManifest, type DemoContent } from '../scripts/demo-build.mjs';

// the demo's own build (scripts/demo-build.mjs), on a game of two heroes, two enemies and two floors: the second of each cut
const c: DemoContent = {
  cut: new Set(['cop', 'lich']),
  domain: new Set(['bastion', 'cop', 'skel', 'lich']),
  names: ['Участковый', 'Участкового', 'Ледяной лич', 'Ледяного лича', 'Ледяной склеп'],
  biomes: { all: new Set(['prison', 'ice']), cut: new Set(['ice']) },
  art: { figures: new Set(['cop', 'lich']), env: new Set(['disc_cop', 'wall_ice']), envPrefix: ['slab_ice_'], ui: new Set(['ab_cop']), events: new Set(), music: new Set(['fight1']) },
};
const cut = (s: string) => cutSource(s, 'x.ts', c).replace(/\s+/g, ' ').trim();

describe("the demo's build", () => {
  it('takes out the entries of what is cut, by their key and in the tables of keys', () => {
    expect(cut(`const HEROES = [{ key: 'bastion', name: 'Бастион' }, { key: 'cop', name: 'Участковый' }];`))
      .toBe(`const HEROES = [{ key: 'bastion', name: 'Бастион' },];`);
    expect(cut(`const MOBS = { skel: { hp: 7 }, lich: { hp: 40 } };`)).toBe(`const MOBS = { skel: { hp: 7 }, };`);
    // a table with a few keys of the game among others of its own is no table of them
    expect(cut(`const ROOM = { fight: 1, camp: 2, lich: 3 };`)).toBe(`const ROOM = { fight: 1, camp: 2, lich: 3 };`);
    expect(cut(`const WORDS = { all: ['A'], prison: ['B'], ice: ['C'] };`)).toBe(`const WORDS = { all: ['A'], prison: ['B'], };`);
  });

  it('drops a line of a list that names anything cut, a name of two words also in the middle of a sentence', () => {
    expect(cut(`const GAGS = ['Скелет ищет кость', 'Участковый пишет протокол', 'Учим ледяного лича танцевать', 'Зовём участкового'];`))
      .toBe(`const GAGS = ['Скелет ищет кость', 'Зовём участкового'];`);
  });

  it('takes out a statement under «demo-cut», an if leaving its else', () => {
    const src = `function f(m) {
      // demo-cut: the cop
      if (m.cuffed) return 'В наручниках';
      if (m.k === 'egg') hatch(m);
      else /* demo-cut */ if (m.k === 'coffin') rise(m);
      else if (m.k === 'skel') walk(m);
      return '';
    }`;
    expect(cut(src)).toBe(`function f(m) { if (m.k === 'egg') hatch(m); else if (m.k === 'skel') walk(m); return ''; }`);
  });

  it("leaves the full game's lines of «Как играть» out of the page", () => {
    expect(demoHtml(`<ul><li class="demo-only">a</li>\n<li class="full-only">b</li>\n<li>c</li></ul>`))
      .toBe(`<ul><li class="demo-only">a</li>\n<li>c</li></ul>`);
  });

  it('keeps the art of what stays in the manifest', () => {
    const m = demoManifest({
      figures: { bastion: 'heroes/bastion.png', cop: 'heroes/cop.png', lich: 'mobs/lich.png', lich2: 'mobs/lich2.png', skel: 'mobs/skel.png' },
      env: { disc_cop: 'env/disc_cop.webp', wall_ice: 'env/wall_ice.webp', slab_ice_0: 'env/slab_ice_0.webp', wall_prison: 'env/wall_prison.webp' },
      ui: { ab_cop: 'ui/ab_cop.webp', ab_bastion: 'ui/ab_bastion.webp' }, events: {}, music: { fight0: 'music/a.mp3', fight1: 'music/b.mp3' },
    }, c);
    expect(Object.keys(m.figures)).toEqual(['bastion', 'skel']);
    expect(Object.keys(m.env)).toEqual(['wall_prison']);
    expect(Object.keys(m.ui)).toEqual(['ab_bastion']);
    expect(Object.keys(m.music)).toEqual(['fight0']);
  });
});
