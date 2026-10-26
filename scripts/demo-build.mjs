// The demo's own build (npm run build:demo → dist-demo/): the game with the demo always on (src/demo.ts), and without what
// the demo never opens. The heroes, enemies, floors, events, trophies and trinkets the demo can't reach are cut out of the
// code, their pictures and music are left out, the translations keep only the demo's lines, and the build fails if a name
// of anything cut is still in it. What stays is what src/demo.ts and src/progress.ts let the demo show: its heroes and the
// ones its first win may open, its floors with their enemies and trinkets, its events and the starting trophies.
//
// How the code is cut, in every source file as it is built: an element `{ key: 'lich', … }` of an array goes when its key
// is cut, and so does a property `lich: …` of an object that is a table of such keys (most of its properties are keys of
// heroes, enemies, events, trophies or trinkets), or of a table of floors by their art key (`ice: […]`), and a line of a
// list of lines that names anything cut. A list kept by place says itself what the demo leaves out:
// `...(DEMO_BUILD ? [] : [the later floors])`, and so does a statement for something cut that names it, under a comment
// with «demo-cut» (an `if` leaves its `else`). A line the demo never shows (`DEMO ? … : …`) goes with the minifier.

import ts from 'typescript';
import { createServer } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { catalog, hashOf, LANGS, loadTable } from './i18n.mjs';

/** The pictures of an event's own game on its window (src/eventview.ts), besides its picture: the reels, the bottle, the cups. */
const EVENT_UI = {
  slot: ['reel_cherry', 'reel_lips', 'reel_skull'], bottle: ['ev_bottle', 'wheel_toad', 'wheel_nerd', 'wheel_jock', 'wheel_drink'],
  thimble: ['ev_cup'], bookie: ['ico_bet'],
};

/** Every file under `dir` but hidden ones, as paths relative to it with forward slashes. */
const filesIn = (dir, sub = '') => readdirSync(join(dir, sub), { withFileTypes: true }).filter(e => !e.name.startsWith('.'))
  .flatMap(e => (e.isDirectory() ? filesIn(dir, `${sub}${e.name}/`) : [`${sub}${e.name}`]));

/**
 * What the demo keeps and cuts, read from the game's own tables (loaded as the full game): the keys cut, all the keys of
 * their kinds (to know a table of them), the names that must not be left in the build, and the files of the art kept.
 */
export async function demoContent(root) {
  const server = await createServer({
    root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, define: { __DEMO_BUILD__: 'false', __ASSETS__: '{}', __VERSION__: '""' },
  });
  try {
    const load = p => server.ssrLoadModule(p);
    const data = await load('/src/data.ts'), { EVENTS } = await load('/src/events.ts'), { ARTIFACTS } = await load('/src/artifacts.ts');
    const { TRINKETS } = await load('/src/trinkets.ts'), pr = await load('/src/progress.ts'), demo = await load('/src/demo.ts');
    const floors = demo.DEMO_FLOORS;
    const keepHeroes = new Set([...demo.DEMO_HEROES, ...pr.DEMO_OPENS]);
    const heroes = data.HEROES.filter(h => !keepHeroes.has(h.key));
    const mobs = Object.entries(data.MOBS).filter(([, m]) => m.floor >= floors).map(([k, m]) => ({ key: k, ...m }));
    const events = EVENTS.filter(e => !demo.DEMO_EVENTS.includes(e.key));
    const arts = ARTIFACTS.filter(a => !pr.START_ARTS.includes(a.key));
    const trinkets = TRINKETS.filter(t => t.floor >= floors);
    const biomes = data.BIOMES.slice(floors), kept = data.BIOMES.slice(0, floors);
    const cut = new Set([...heroes, ...mobs, ...events, ...arts, ...trinkets].map(o => o.key));
    const domain = new Set([...data.HEROES.map(h => h.key), ...Object.keys(data.MOBS), ...EVENTS.map(e => e.key), ...ARTIFACTS.map(a => a.key), ...TRINKETS.map(t => t.key)]);
    const names = [
      ...heroes.flatMap(h => [h.name, h.acc, h.dat]), ...mobs.flatMap(m => [m.name, m.acc]), ...events.map(e => e.title),
      ...arts.map(a => a.name), ...trinkets.map(t => t.name), ...biomes.map(b => b.name),
    ].filter(s => s && s.length > 3);
    return {
      cut, domain, names: [...new Set(names)],
      biomes: { all: new Set(data.BIOMES.map(b => b.art)), cut: new Set(biomes.map(b => b.art)) },
      /** The art and music the demo goes without. */
      art: {
        figures: cut,
        env: new Set([...heroes.map(h => `disc_${h.key}`), ...trinkets.map(t => t.art), ...biomes.flatMap(b => [`wall_${b.art}`, `cap_${b.art}`, `pillar_${b.art}`]),
          // the lava and the ice blocks of the floors cut
          ...(kept.some(b => b.haz === 'lava') ? [] : ['lava']), ...(kept.some(b => b.iceMu !== undefined) ? [] : ['icicle'])]),
        envPrefix: biomes.map(b => `slab_${b.art}_`),
        ui: new Set([...heroes.map(h => `ab_${h.key}`), ...arts.map(a => `art_${a.key}`), ...events.flatMap(e => EVENT_UI[e.key] ?? [])]),
        events: new Set([...events.map(e => e.key), ...mobs.map(m => `loot_${m.key}`)]),
        music: new Set(biomes.map((_, f) => `fight${f + floors}`)),
      },
    };
  } finally {
    await server.close();
  }
}

/**
 * The forms of the names of what is cut to look for: as written, and a name of two words or more also in the middle of a
 * sentence (`ледяного упыря`); a name of one word in lower case is an everyday word (`гроб`).
 */
const formsOf = names => [...new Set(names.flatMap(n => (/[ -]/.test(n) ? [n, n[0].toLowerCase() + n.slice(1)] : [n])))];
/** The name of anything cut that `s` says, or null. */
export const namesCut = (s, c) => formsOf(c.names).find(n => s.includes(n)) ?? null;

/** A name in a language's line: a word of its own in the languages that write words apart, anywhere in the others. */
const apart = new Set(['en', 'de', 'fr', 'es', 'pt', 'pl']);
const says = (lang, s, name) => (apart.has(lang)
  ? new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(s) : s.includes(name));
/** Names of what is cut that a language says the same as something kept: the event «Бутылочка» and the bar's bottle. */
const SAME = { es: ['La botella'], pl: ['Butelka'] };

/** The picture of a figure kept by its key: a boss's second look (`lich2`) and the fridge's open door go with their own. */
const figureKey = k => k.replace(/_open$/, '').replace(/\d+$/, '');

/** The manifest of the art the demo keeps (public/assets/manifest.json less the cut). */
export function demoManifest(m, c) {
  const keep = (sec, f) => Object.fromEntries(Object.entries(m[sec] ?? {}).filter(([k]) => f(k)));
  return {
    ...m,
    figures: keep('figures', k => !c.art.figures.has(figureKey(k))),
    env: keep('env', k => !c.art.env.has(k) && !c.art.envPrefix.some(p => k.startsWith(p))),
    ui: keep('ui', k => !c.art.ui.has(k)),
    events: keep('events', k => !c.art.events.has(k)),
    music: keep('music', k => !c.art.music.has(k)),
  };
}

/**
 * The files of public/ the demo's build carries: everything but the art and music its manifest leaves out (by the files the
 * full manifest names), and the manifest itself cut down.
 */
export function demoPublic(root, c) {
  const dir = join(root, 'public'), full = JSON.parse(readFileSync(join(dir, 'assets/manifest.json'), 'utf8')), man = demoManifest(full, c);
  const fileOf = e => (typeof e === 'string' ? e : e.file);
  const named = new Set(Object.values(full).flatMap(sec => Object.values(sec).map(fileOf)));
  const kept = new Set(Object.values(man).flatMap(sec => Object.values(sec).map(fileOf)));
  const files = new Map();
  for (const f of filesIn(dir)) {
    const a = f.startsWith('assets/') ? f.slice(7) : null;
    if (a === 'manifest.json') files.set(f, Buffer.from(JSON.stringify(man, null, 2) + '\n'));
    else if (!a || !named.has(a) || kept.has(a)) files.set(f, readFileSync(join(dir, f)));
  }
  return files;
}

/** Where the node's text starts and ends, with the comments before it and the comma after it. */
function span(n, text) {
  let end = n.end;
  const m = /^\s*,/.exec(text.slice(end));
  if (m) end += m[0].length;
  return [n.getFullStart(), end];
}

/** The name of a property as written, for a plain one. */
const nameOf = p => ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name
  && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);
/** An object's `key: '…'`. */
const keyOf = e => (ts.isObjectLiteralExpression(e)
  ? e.properties.map(p => (nameOf(p) === 'key' && ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer) ? p.initializer.text : null)).find(Boolean) ?? null
  : null);

/** A source file as the demo builds it: the entries of everything cut taken out. `log` gets each key cut and where. */
export function cutSource(text, file, c, log = () => {}) {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true), out = [];
  const at = n => `${file}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
  const visit = n => {
    if (n.kind >= ts.SyntaxKind.FirstStatement && n.kind <= ts.SyntaxKind.LastStatement && text.slice(n.getFullStart(), n.getStart(src)).includes('demo-cut')) {
      log('demo-cut', at(n));
      if (!ts.isIfStatement(n) || !n.elseStatement) { out.push(span(n, text)); return; }
      out.push([n.getFullStart(), n.elseStatement.getFullStart()]);
      return visit(n.elseStatement);
    }
    if (ts.isArrayLiteralExpression(n) && n.elements.length >= 2 && n.elements.every(ts.isStringLiteral)) {
      for (const e of n.elements) {
        const k = namesCut(e.text, c);
        if (k) { out.push(span(e, text)); log(k, at(e)); }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(n) && n.elements.filter(keyOf).length >= 2) {
      for (const e of n.elements) {
        const k = keyOf(e);
        if (k && c.cut.has(k)) { out.push(span(e, text)); log(k, at(e)); } else visit(e);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(n)) {
      const names = n.properties.map(nameOf).filter(Boolean);
      const table = names.length >= 2 && names.filter(k => c.domain.has(k)).length >= 0.6 * names.length;
      const floors = names.length >= 2 && names.every(k => k === 'all' || c.biomes.all.has(k));
      if (table || floors) {
        for (const p of n.properties) {
          const k = nameOf(p);
          if (k && (table ? c.cut.has(k) : c.biomes.cut.has(k))) { out.push(span(p, text)); log(k, at(p)); } else visit(p);
        }
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  if (!out.length) return text;
  let s = '', from = 0;
  for (const [a, b] of out.sort((x, y) => x[0] - y[0])) { s += text.slice(from, a); from = b; }
  return s + text.slice(from);
}

/** The page as the demo builds it: the full game's lines of «Как играть» out. */
export const demoHtml = html => html.replace(/<li class="full-only">[\s\S]*?<\/li>\s*/g, '');

/**
 * The plugin of the demo's build: cuts the sources and the page, keeps the translations of the demo's lines only, carries
 * the demo's files of public/ and fails on any name of what is cut left in the build.
 */
export function demoBuild(root, c) {
  const src = join(root, 'src'), cuts = new Map();
  let lines = new Set();
  return {
    name: 'dd-demo-build',
    enforce: 'pre',
    apply: 'build',
    buildStart() {
      // the demo's lines: the ones of its sources and its page as it builds them, but a line naming anything cut, which
      // is left only where the demo never shows it
      const read = f => cutSource(readFileSync(f, 'utf8'), relative(root, f), c);
      const all = catalog({ read, html: demoHtml(readFileSync(join(root, 'index.html'), 'utf8')) }).lines.keys();
      lines = new Set([...all].filter(s => !namesCut(s, c)).map(hashOf));
      for (const [f, buf] of demoPublic(root, c)) this.emitFile({ type: 'asset', fileName: f, source: buf });
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.startsWith(src)) return null;
      if (/\/i18n\/[a-z]+\.json$/.test(file)) {
        const table = JSON.parse(code);
        return { code: JSON.stringify(Object.fromEntries(Object.entries(table).filter(([h]) => lines.has(h)))), map: null };
      }
      if (!file.endsWith('.ts')) return null;
      const rel = relative(root, file), out = cutSource(code, rel, c, (k, at) => cuts.set(at, k));
      return out === code ? null : { code: out, map: null };
    },
    transformIndexHtml: demoHtml,
    generateBundle(_, bundle) {
      // the names of what is cut, in Russian anywhere and in every language's table
      const ru = formsOf(c.names), tr = Object.fromEntries(LANGS.map(l => {
        const t = loadTable(l);
        return [l, [...new Set(c.names.map(s => t[hashOf(s)]))].filter(s => s && s.length > 3 && !SAME[l]?.includes(s))];
      }));
      const left = [];
      for (const [name, o] of Object.entries(bundle)) {
        const text = o.type === 'chunk' ? o.code : /\.(html|json|js|css|txt)$/.test(name) ? Buffer.from(o.source).toString('utf8') : null;
        if (text === null) continue;
        const lang = o.type === 'chunk' && o.moduleIds.map(m => /\/i18n\/([a-z]+)\.json$/.exec(m)?.[1]).find(Boolean);
        for (const s of lang ? tr[lang] : ru) if (lang ? says(lang, text, s) : text.includes(s)) left.push(`${name}: «${s}»`);
      }
      this.info(`the demo cut ${cuts.size} entries: ${[...new Set(cuts.values())].sort().join(' ')}`);
      if (process.env.DEMO_CUTS) this.info([...cuts].map(([at, k]) => `${at} ${k}`).sort().join('\n'));
      if (left.length) this.error(`the demo's build still has what it cuts:\n${left.join('\n')}`);
    },
  };
}
