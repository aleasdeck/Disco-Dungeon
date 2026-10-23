// The game's languages. Everything is written in Russian, and every line the game shows goes through t(): its translation
// into the player's language is looked up by a hash of the Russian line in that language's table (src/i18n/<code>.json,
// fetched when the language is picked); a line the table lacks shows in Russian. A line may carry values: «+{0} руды» with
// t('+{0} руды', 3). Lines kept in the game's state, for later or for the other screens online (the floats over the field,
// the enemy-turn journal, how an event turned out), are kept as the Russian line and its values, made by M(), and each
// screen puts them in its own player's language when it shows them. The static text of index.html is translated in place.
//
// A value goes in as {0}, {1}… or {name} (with one object of named values). A word that changes with a number takes its
// forms after a bar, in the order of the language's plural forms (PLURAL): {0|руда|руды|руд} in Russian, {0|ore|ore} in
// English, {0|個} in Japanese. A pick on a flag: {2?ударила|ударил}, the first when the value is set. {0:l} puts a value in
// lower case, {0:u} gives it a capital. A value that is itself a line of the game (a hero's name, an enemy's) is translated too;
// a list of values comes out as a list, each translated: «Толстяк: «Каска», Дрищ: «Очки»».

export type Lang = 'ru' | 'en' | 'zh' | 'de' | 'fr' | 'es' | 'pt' | 'ja' | 'ko' | 'pl';

/** The languages, in the order the picker lists them: the name each goes by in itself, and its tag for the page. */
export const LANGS: { code: Lang; name: string; tag: string }[] = [
  { code: 'en', name: 'English', tag: 'en' },
  { code: 'ru', name: 'Русский', tag: 'ru' },
  { code: 'zh', name: '简体中文', tag: 'zh-Hans' },
  { code: 'es', name: 'Español', tag: 'es' },
  { code: 'pt', name: 'Português (Brasil)', tag: 'pt-BR' },
  { code: 'de', name: 'Deutsch', tag: 'de' },
  { code: 'fr', name: 'Français', tag: 'fr' },
  { code: 'ja', name: '日本語', tag: 'ja' },
  { code: 'ko', name: '한국어', tag: 'ko' },
  { code: 'pl', name: 'Polski', tag: 'pl' },
];

/** Each language's plural forms as Intl.PluralRules names them, in the order a line lists its forms; others take the last. */
export const PLURAL: Record<Lang, string[]> = {
  ru: ['one', 'few', 'many'], pl: ['one', 'few', 'many'],
  en: ['one', 'other'], de: ['one', 'other'], fr: ['one', 'other'], es: ['one', 'other'], pt: ['one', 'other'],
  ja: ['other'], ko: ['other'], zh: ['other'],
};

export const isLang = (s: unknown): s is Lang => LANGS.some(l => l.code === s);

/** The language a new player most likely reads, from the browser's: Russian for the neighbours who read it, else English. */
export function detectLang(): Lang {
  const all = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of all) {
    const s = (l ?? '').toLowerCase(), c = s.slice(0, 2);
    if (/^(ru|uk|be|kk|ky|uz|tg|hy|az)\b/.test(s)) return 'ru';
    if (isLang(c)) return c;
  }
  return 'en';
}

/** FNV-1a of the Russian line, in base 36: the key of its translation in every table. */
export function hashOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The tables of the languages, each fetched as a chunk of its own when first picked. */
const TABLES = import.meta.glob<Record<string, string>>('./i18n/*.json', { import: 'default' });

let cur: Lang = 'ru';
let table: Record<string, string> = {};
let rules = new Intl.PluralRules('ru');
/** Lines already looked up in the current language: as they are, and shown (the kept ones, M, with their values put in). */
const lines = new Map<string, string>();
const done = new Map<string, string>();
const listeners: (() => void)[] = [];

export const lang = () => cur;
export const langTag = () => LANGS.find(l => l.code === cur)!.tag;

/** Call `f` after each change of language, to show again what is on screen. */
export const onLang = (f: () => void) => { listeners.push(f); };

let asked: Lang = 'ru';
/** Switch the game to a language: fetch its table, then translate the page and tell everyone who shows text. */
export async function setLang(code: Lang): Promise<void> {
  asked = code;
  let next: Record<string, string> = {};
  if (code !== 'ru') {
    const load = TABLES[`./i18n/${code}.json`];
    try { next = load ? await load() : {}; } catch { next = {}; }
  }
  // a quicker pick made while this table was on its way wins
  if (asked !== code) return;
  cur = code;
  table = next;
  rules = new Intl.PluralRules(langTag());
  lines.clear();
  done.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = langTag();
    applyDom();
  }
  for (const f of listeners) f();
}

/** The current language's line for a Russian one, values still in their places. */
function tr(src: string) {
  if (cur === 'ru') return src;
  let s = lines.get(src);
  if (s === undefined) lines.set(src, (s = table[hashOf(src)] ?? src));
  return s;
}

type Val = string | number | boolean | null | undefined;
export type Arg = Val | Val[];
type Named = Record<string, Arg>;

const PH = /\{(\w+)(?::([lu]))?(?:([|?])([^{}]*))?\}/g;

function plural(n: number, forms: string[]) {
  const k = PLURAL[cur].indexOf(rules.select(n));
  return forms[k < 0 || k >= forms.length ? forms.length - 1 : k];
}

function fill(tpl: string, args: (Arg | Named)[]) {
  const named = args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) ? (args[0] as Named) : null;
  return tpl.replace(PH, (_all, key: string, mod: string | undefined, op: string | undefined, rest: string) => {
    const v = named ? named[key] : /^\d+$/.test(key) ? (args[Number(key)] as Arg) : undefined;
    if (op === '|') return plural(Number(v), rest.split('|'));
    if (op === '?') { const [a, b = ''] = rest.split('|'); return v ? a : b; }
    let s = Array.isArray(v) ? v.map(x => (typeof x === 'string' ? t(x) : String(x ?? ''))).join(cur === 'ja' || cur === 'zh' ? '、' : ', ')
      : typeof v === 'string' ? t(v) : v === null || v === undefined || v === false ? '' : String(v);
    if (mod === 'l') s = s.toLocaleLowerCase(langTag());
    else if (mod === 'u') s = s.charAt(0).toLocaleUpperCase(langTag()) + s.slice(1);
    return s;
  });
}

/** Marks a line kept by M(): the Russian line and its values after it, as JSON. */
const KEPT = '\u0001';

/** A line of the game in the player's language, its values put in; a line kept by M() comes out the same way. */
export function t(src: string, ...args: (Arg | Named)[]): string {
  if (args.length) return fill(tr(src), args);
  let s = done.get(src);
  if (s === undefined) {
    if (src.charCodeAt(0) === 1) {
      try {
        const [line, ...vals] = JSON.parse(src.slice(1)) as [string, ...(Arg | Named)[]];
        s = fill(tr(line), vals);
      } catch { s = src; }
    } else s = tr(src);
    done.set(src, s);
  }
  return s;
}

/**
 * A line to keep in the game's state and show later, maybe on another screen in another language: the Russian line and
 * its values as they are, for t() to translate when it is shown. A line with no values is kept as it is.
 */
export function M(src: string, ...args: (Arg | Named)[]): string {
  return args.length ? KEPT + JSON.stringify([src, ...args]) : src;
}

/** The Russian line a kept one (M) was made from, its values left out: «+{0} руда»; any other line as it is. */
export function srcOf(s: string): string {
  if (s.charCodeAt(0) !== 1) return s;
  try { return (JSON.parse(s.slice(1)) as string[])[0]; } catch { return s; }
}

/** Kept lines (M) one after another, a text of a few sentences: each is translated when shown, a space between them. */
export function Mjoin(...parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length === 1 ? p[0] : M(p.map((_, i) => `{${i}}`).join(' '), ...p);
}

// ------------------------------------------------------------ the page's own text

/** A piece of index.html in Russian: a text, an attribute, or a paragraph with its markup (`data-t`). */
interface Spot { el: Element | Text; attr?: string; html?: boolean; src: string; lead: string; trail: string; shown: string }
const spots: Spot[] = [];
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
const CYR = /[А-Яа-яЁё]/;

/** How a Russian piece of the page is keyed: its text with the spaces between words made single. */
export const pageKey = (s: string) => s.trim().replace(/\s+/g, ' ');

function read(s: Spot) {
  return s.attr ? (s.el as Element).getAttribute(s.attr) ?? '' : s.html ? (s.el as Element).innerHTML : (s.el as Text).nodeValue ?? '';
}

function write(s: Spot) {
  const v = s.lead + t(s.src) + s.trail;
  if (s.attr) (s.el as Element).setAttribute(s.attr, v);
  else if (s.html) (s.el as Element).innerHTML = v;
  else (s.el as Text).nodeValue = v;
  s.shown = read(s);
}

/**
 * Find the Russian text of the page under `root` once, before the game writes anything into it, and put it in the current
 * language. A piece the game has since rewritten is the game's to translate and is left alone on later changes.
 */
export function scanDom(root: Element = document.body) {
  const walk = (el: Element) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && CYR.test(v)) spots.push({ el, attr: a, src: pageKey(v), lead: '', trail: '', shown: v });
    }
    if (el.hasAttribute('data-t')) {
      const v = el.innerHTML;
      spots.push({ el, html: true, src: pageKey(v), lead: '', trail: '', shown: v });
      return;
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 1) walk(n as Element);
      else if (n.nodeType === 3 && CYR.test(n.nodeValue ?? '')) {
        const v = n.nodeValue!;
        spots.push({ el: n as Text, src: pageKey(v), lead: v.match(/^\s*/)![0], trail: v.match(/\s*$/)![0], shown: v });
      }
    }
  };
  const from = spots.length;
  walk(root);
  for (const s of spots.slice(from)) write(s);
}

function applyDom() {
  for (const s of spots) if (read(s) === s.shown) write(s);
}
