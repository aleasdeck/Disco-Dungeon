// The game's lines and their translations (src/i18n.ts tells how lines are looked up).
//
//   node scripts/i18n.mjs              what is wrong: Russian glued into a line by code, translations missing or broken
//   node scripts/i18n.mjs todo en      the lines English still lacks, a line each: key, Russian, where it is (TSV)
//   node scripts/i18n.mjs add en f.tsv put translations into src/i18n/en.json, a line each: key, translation (TSV)
//   node scripts/i18n.mjs prune        drop translations of lines the game no longer has
//
// The lines are every Russian string in src/ (a whole line, with {0}… for its values, never glued from pieces by `+` or
// `${}`), the strings with words that go to t() or M() as they are, and the Russian text of index.html. A string under a comment with «i18n-skip» is not a line (words on the walls).
// In the TSV files a line break is written \n and a tab \t.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIR = join(SRC, 'i18n');
export const LANGS = ['en', 'zh', 'de', 'fr', 'es', 'pt', 'ja', 'ko', 'pl'];
/** How many plural forms a line gives a word in each language (PLURAL in src/i18n.ts). */
export const FORMS = { ru: 3, pl: 3, en: 2, de: 2, fr: 2, es: 2, pt: 2, ja: 1, ko: 1, zh: 1 };
/** A line to translate has Russian in it, or the quotes a language writes its own way: t('«{0}»', name). */
const CYR = /[А-Яа-яЁё«»]/;

/** The same hash as src/i18n.ts. */
export function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
export const pageKey = s => s.trim().replace(/\s+/g, ' ');

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : p.endsWith('.ts') && !p.endsWith('.d.ts') ? [p] : [];
  });
}

const skipped = (node, src) => {
  for (let n = node; n; n = n.parent) {
    const text = src.text.slice(n.pos, n.getStart(src));
    if (text.includes('i18n-skip')) return true;
  }
  return false;
};

/** The lines of the TypeScript sources, and the places where code glues Russian together; `read` gives a file's text. */
function scanTs(add, bad, read) {
  for (const f of tsFiles(SRC)) {
    const text = read(f), src = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true), rel = relative(ROOT, f);
    const at = n => `${rel}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
    const cyr = n => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text)
      || ts.isTemplateExpression(n) && [n.head, ...n.templateSpans.map(s => s.literal)].some(p => CYR.test(p.text));
    // a line in no Russian handed to t() or M() straight: «+{0} HP {1}» (a word in it may still read otherwise elsewhere)
    const handed = n => ts.isCallExpression(n.parent) && n.parent.arguments[0] === n && /^(t|M)$/.test(n.parent.expression.getText(src))
      && /\p{L}/u.test(n.text.replace(/\{[^{}]*\}/g, ''));
    const visit = n => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && (CYR.test(n.text) && n.text.length > 1 || handed(n)) && !skipped(n, src)) {
        // the name it goes under, to say what it is: a field of a table, the call it goes to
        const p = n.parent;
        const what = ts.isPropertyAssignment(p) ? p.name.getText(src) : ts.isCallExpression(p) ? p.expression.getText(src).slice(-24) : '';
        add(n.text, at(n) + (what ? ' ' + what : ''));
      } else if (ts.isTemplateExpression(n) && cyr(n) && !skipped(n, src)) bad.push(`${at(n)}: Russian in a \`…\${}…\` string, make it t('… {0} …', value)`);
      else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && (cyr(n.left) || cyr(n.right)) && !skipped(n, src))
        bad.push(`${at(n)}: Russian glued with +, make it one line with {0}`);
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip', 'data-tip-h', 'data-tip-f'];
const unent = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The Russian text of index.html (or of `html`), keyed the way src/i18n.ts scanDom keys it. */
function scanHtml(add, html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  const body = html.slice(html.indexOf('<body'));
  const tag = /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let last = 0, m, unit = null, depth = 0;
  const line = i => html.slice(0, html.indexOf('<body') + i).split('\n').length;
  while ((m = tag.exec(body))) {
    const between = body.slice(last, m.index);
    if (!unit && CYR.test(between)) add(pageKey(unent(between)), `index.html:${line(m.index)}`);
    last = tag.lastIndex;
    if (!m[1]) continue;
    const name = m[1].toLowerCase(), close = m[0][1] === '/', attrs = m[2] ?? '';
    if (unit) {
      if (VOID.has(name)) continue;
      if (close && --depth === 0) { add(pageKey(body.slice(unit.from, m.index)), `index.html:${unit.line} data-t`); unit = null; }
      else if (!close) depth++;
      continue;
    }
    if (close) continue;
    for (const a of ATTRS) {
      const v = attrs.match(new RegExp(`\\s${a}="([^"]*)"`))?.[1];
      if (v && CYR.test(v)) add(pageKey(unent(v)), `index.html:${line(m.index)} ${a}`);
    }
    if (/\sdata-t(\s|=|$)/.test(attrs)) { unit = { from: tag.lastIndex, line: line(m.index) }; depth = 1; }
  }
}

/**
 * Every line of the game: Russian → where it is used; and what is wrong in the code. The demo's build (scripts/demo-build.mjs)
 * passes the sources as it builds them: `read` gives a file's text, `html` the page's.
 */
export function catalog(o = {}) {
  const lines = new Map(), bad = [];
  const add = (s, at) => { if (!lines.has(s)) lines.set(s, []); lines.get(s).push(at); };
  scanTs(add, bad, o.read ?? (f => readFileSync(f, 'utf8')));
  scanHtml(add, o.html);
  return { lines, bad };
}

export const tablePath = lang => join(DIR, `${lang}.json`);
export const loadTable = lang => (existsSync(tablePath(lang)) ? JSON.parse(readFileSync(tablePath(lang), 'utf8')) : {});

/** The values a line takes: {0}, {who:l}, the plural and flag picks, and its markup. */
export function shape(s) {
  const vals = new Set(), plurals = [], picks = new Set(), keys = new Set();
  for (const m of s.matchAll(/\{(\w+)(?::([lu]))?(?:([|?])([^{}]*))?\}/g)) {
    keys.add(m[1]);
    if (m[3] === '|') plurals.push({ key: m[1], n: m[4].split('|').length });
    else if (m[3] === '?') picks.add(m[1]);
    else vals.add(m[1]);
  }
  const tags = [...s.matchAll(/<[^>]+>/g)].map(m => m[0]).sort();
  return { vals, plurals, picks, keys, tags };
}

/** What is wrong with one translation of a line. */
export function checkLine(lang, ru, tr) {
  const a = shape(ru), b = shape(tr), out = [];
  for (const k of b.keys) if (!a.keys.has(k)) out.push(`{${k}} is not a value of the line`);
  for (const k of a.vals) if (!b.vals.has(k)) out.push(`{${k}} is missing`);
  for (const p of b.plurals) if (p.n !== FORMS[lang]) out.push(`{${p.key}|…} has ${p.n} forms, ${lang} takes ${FORMS[lang]}`);
  if (a.tags.join('') !== b.tags.join('')) out.push('the markup differs');
  if (!tr.trim() && ru.trim()) out.push('empty');
  return out;
}

/** Problems over the whole game: code that glues Russian, lines with no translation, broken translations. */
export function problems() {
  const { lines, bad } = catalog(), out = [...bad], hashes = new Map();
  for (const ru of lines.keys()) {
    const h = hashOf(ru);
    if (hashes.has(h) && hashes.get(h) !== ru) out.push(`two lines share the key ${h}: «${hashes.get(h)}» and «${ru}»`);
    hashes.set(h, ru);
  }
  for (const lang of LANGS) {
    const table = loadTable(lang);
    let missing = 0;
    for (const [h, ru] of hashes) {
      if (table[h] === undefined) { missing++; continue; }
      for (const p of checkLine(lang, ru, table[h])) out.push(`${lang} ${h} «${ru.slice(0, 60)}»: ${p}`);
    }
    if (missing) out.push(`${lang}: ${missing} lines without a translation (node scripts/i18n.mjs todo ${lang})`);
  }
  return out;
}

const esc = s => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
const unesc = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

function save(lang, table) {
  // in the order the lines come in the game, so a change shows up as a small diff
  const order = [...catalog().lines.keys()].map(hashOf), seen = new Set(order);
  const out = {};
  for (const h of order) if (table[h] !== undefined) out[h] = table[h];
  for (const h of Object.keys(table)) if (!seen.has(h)) out[h] = table[h];
  writeFileSync(tablePath(lang), JSON.stringify(out, null, 0).replace(/^\{/, '{\n').replace(/",("[0-9a-z]+":)/g, '",\n$1').replace(/\}$/, '\n}\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, lang, file] = process.argv.slice(2);
  if (cmd === 'todo') {
    const table = loadTable(lang);
    for (const [ru, at] of catalog().lines) if (table[hashOf(ru)] === undefined) console.log(`${hashOf(ru)}\t${esc(ru)}\t${at.join(' ')}`);
  } else if (cmd === 'add') {
    const table = loadTable(lang);
    for (const row of readFileSync(file, 'utf8').split('\n')) {
      if (!row.trim()) continue;
      const [h, ...rest] = row.split('\t');
      table[h.trim()] = unesc(rest.join('\t'));
    }
    save(lang, table);
  } else if (cmd === 'prune') {
    const live = new Set([...catalog().lines.keys()].map(hashOf));
    for (const l of LANGS) {
      const table = loadTable(l);
      for (const h of Object.keys(table)) if (!live.has(h)) delete table[h];
      save(l, table);
    }
  } else if (cmd === 'lines') {
    for (const [ru, at] of catalog().lines) console.log(`${hashOf(ru)}\t${esc(ru)}\t${at.join(' ')}`);
  } else {
    const p = problems();
    for (const s of p) console.log(s);
    console.log(p.length ? `${p.length} problems` : 'all lines translated');
    process.exitCode = p.length ? 1 : 0;
  }
}
