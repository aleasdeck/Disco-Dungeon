// The end of the run: its photo album hung on a line to dry (ДО, a print for every floor boss beaten, ПОСЛЕ), the
// congratulation or the condolence, the run in six numbers and, for a party, who stood out at what. A lost run shows
// only what the party got through: no empty prints for the floors it never reached. The prints are drawn in src/album.ts.

import { BIOMES, HEROES, MOBS, type MobKind } from './data';
import { uiArt } from './assets';
import { faceUrl } from './ui';
import { FLOORS, LAYERS } from './run';
import { drawAfter, drawShot, drawStart, type Album } from './album';
import { saveCanvas } from './photo';
import type { Tally } from './game';
import { escapeHtml } from './menu';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The bosses' names short enough for a print's white strip. */
const SHORT: Record<string, string> = {
  king: 'Король', ratswarm: 'Свора', pahan: 'Пахан', lich: 'Лич', fridge: 'Холодильник', dancer: 'Танцор',
  forgelord: 'Владыка', discoball: 'Диско-шар', dragon: 'Дымыч',
};
/** A line under the victory, by the last boss beaten. */
const WON: Record<string, string> = {
  forgelord: 'Владыка кузни остыл. Наковальню сдали в металлолом, диско продолжается.',
  discoball: 'Диско-шар разбит. Семь лет без удачи, зато какая была вечеринка.',
  dragon: 'Дымыч докурил своё. Яйца сдали в зоопарк, диско продолжается.',
};
/** A line under the defeat, by the floor it came on. */
const LOST = [
  'Казематы оставили вас себе. Кости срастутся, приходите ещё.',
  'Склеп сохранит вас свежими. Кости срастутся, приходите ещё.',
  'Кузня переплавит вас на диски. Кости срастутся, приходите ещё.',
];

const plural = (n: number, one: string, few: string, many: string) => {
  const t = n % 10, h = n % 100;
  return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 10 || h >= 20) ? few : many;
};
const clock = (s: number) => {
  const m = Math.floor(s / 60), h = Math.floor(m / 60), dd = (v: number) => String(v).padStart(2, '0');
  return h ? `${h}:${dd(m % 60)}:${dd(Math.floor(s) % 60)}` : `${m}:${dd(Math.floor(s) % 60)}`;
};

/** One print on the line: its picture, its caption, and how big it hangs (ДО and ПОСЛЕ bigger than the bosses). */
interface Print { cv: HTMLCanvasElement; url: string; cap: string; big: boolean }

let prints: Print[] = [];

function paint(draw: (cv: HTMLCanvasElement) => void, cap: string, big: boolean): Print {
  const cv = document.createElement('canvas');
  draw(cv);
  return { cv, url: cv.toDataURL('image/jpeg', 0.86), cap, big };
}

/**
 * A line with prints pegged on it, sagging in the middle: each print hangs from its peg a little lower towards the
 * middle and turned a little, and comes in after the one before it. `widths` are the prints' widths in % of the line.
 */
function line(ps: Print[], widths: number[], caps: number[], sag: number, from: number) {
  const el = document.createElement('div');
  el.className = 're-line';
  el.innerHTML = `<svg class="re-rope" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1 Q50 ${1 + sag / 4} 100 1"/></svg>`;
  const row = document.createElement('div');
  row.className = 're-prints';
  ps.forEach((p, k) => {
    const t = (k + 0.5) / ps.length, f = document.createElement('figure');
    f.className = 'pol';
    f.style.cssText = `--i:${from + k};--r:${((k * 7 + from * 3) % 5) - 2}deg;--dy:${(sag * 4 * t * (1 - t)).toFixed(1)}px;width:min(${widths[k]}%, ${caps[k]}px)`;
    f.innerHTML = `<span class="peg" aria-hidden="true"></span><img alt="" src="${p.url}"><figcaption>${p.cap}</figcaption>`;
    f.addEventListener('click', () => zoom(p));
    row.append(f);
  });
  el.append(row);
  return el;
}

/** A print at full size over the screen; a tap anywhere puts it back. */
function zoom(p: Print) {
  const lb = $('reLb');
  lb.innerHTML = `<figure><img alt="" src="${p.url}"><figcaption>${p.cap}</figcaption></figure>`;
  lb.hidden = false;
  lb.onclick = () => { lb.hidden = true; };
}

/** The whole line of prints on one picture, with the title over it: what «Сохранить альбом» saves. */
function sheet(title: string) {
  const W = 420, m = 34, gap = 40, cap = 70, n = prints.length, out = document.createElement('canvas');
  out.width = n * (W + m * 2) + (n + 1) * gap;
  out.height = 190 + W + m + cap + 70;
  const c = out.getContext('2d')!;
  c.fillStyle = '#2a211b';
  c.fillRect(0, 0, out.width, out.height);
  c.fillStyle = '#d9b24a';
  c.font = '700 84px Oswald';
  c.textAlign = 'center';
  c.fillText(title.toUpperCase(), out.width / 2, 110);
  // the line, then the prints on it
  c.strokeStyle = '#c9b08a';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(0, 170);
  c.quadraticCurveTo(out.width / 2, 230, out.width, 170);
  c.stroke();
  prints.forEach((p, k) => {
    const x = gap + k * (W + m * 2 + gap), t = (k + 0.5) / n, y = 175 + 30 * 4 * t * (1 - t);
    c.save();
    c.translate(x + W / 2 + m, y);
    c.rotate((((k * 7) % 5) - 2) * 0.012);
    c.shadowColor = 'rgba(0,0,0,.55)';
    c.shadowBlur = 18;
    c.shadowOffsetY = 8;
    c.fillStyle = '#f3ead8';
    c.fillRect(-W / 2 - m, 0, W + m * 2, W + m + cap);
    c.shadowColor = 'transparent';
    c.drawImage(p.cv, -W / 2, m, W, W);
    c.fillStyle = '#2a1a0d';
    c.font = '700 44px Hand';
    c.fillText(p.cap, 0, m + W + 52);
    c.fillStyle = '#b88a54';
    c.fillRect(-9, -26, 18, 46);
    c.restore();
  });
  return out;
}

/**
 * Show the run's end: `button` is what the main button says (a new run, the lobby), or null for an online player who
 * waits for the host to take everyone back to the lobby.
 */
export function showAlbum(a: Album, o: { button: string | null; onButton: () => void }) {
  const party = a.heroes, solo = party.length === 1 && HEROES[party[0].i], lastBoss = a.shots[a.shots.length - 1]?.boss;
  const killer = a.boss && MOBS[a.boss as MobKind];
  $('reRibbon').textContent = a.win ? 'Подземелье пройдено' : `Этаж ${a.floor + 1} · ${BIOMES[a.floor]?.name ?? ''}`;
  $('reRibbon').classList.toggle('lose', !a.win);
  $('reTitle').textContent = a.win ? (solo ? (solo.fem ? 'Ты победила!' : 'Ты победил!') : 'Вы победили!')
    : solo ? (solo.fem ? 'Героиня пала' : 'Герой пал') : 'Отряд пал';
  $('reTitle').classList.toggle('lose', !a.win);
  $('reGag').textContent = a.win ? WON[lastBoss ?? ''] ?? 'Все три этажа позади. Диско продолжается.'
    : killer ? `${killer.name} ${killer.fem ? 'оставила' : 'оставил'} вас себе. Кости срастутся, приходите ещё.` : LOST[a.floor] ?? LOST[0];
  // the prints: ДО, the bosses beaten floor by floor, ПОСЛЕ
  prints = [
    paint(cv => drawStart(cv, a), 'ДО', true),
    ...a.shots.map((s, f) => paint(cv => drawShot(cv, a, s), `${(MOBS[s.boss as MobKind]?.floor ?? f) + 1} · ${SHORT[s.boss] ?? MOBS[s.boss as MobKind]?.name ?? ''}`, false)),
    paint(cv => drawAfter(cv, a), 'ПОСЛЕ', true),
  ];
  const ropes = $('reRopes'), bosses = prints.slice(1, -1), ends = [prints[0], prints[prints.length - 1]];
  ropes.innerHTML = '';
  // wide screens: one line, ДО to ПОСЛЕ; an upright phone: ДО and ПОСЛЕ on the first line, the bosses on the second
  const wide = document.createElement('div');
  wide.className = 're-wide';
  const weight = prints.map(p => (p.big ? 1.3 : 1)), sum = weight.reduce((s, v) => s + v, 0), room = 96 - 2 * (prints.length - 1);
  wide.append(line(prints, weight.map(v => (v / sum) * room), prints.map(p => (p.big ? 300 : 230)), 26, 0));
  const tall = document.createElement('div');
  tall.className = 're-tall';
  tall.append(line(ends, [46, 46], [260, 260], 14, 0));
  if (bosses.length) tall.append(line(bosses, bosses.map(() => 30), bosses.map(() => 180), 12, 2));
  ropes.append(wide, tall);
  // the run in numbers: the party's sums, the best blow and who dealt it
  const sumOf = (k: keyof Tally) => party.reduce((s, h) => s + h.t[k], 0);
  const best = (k: keyof Tally) => party.reduce((p, h) => (h.t[k] > p.t[k] ? h : p));
  const top = best('top'), nameOf = (i: number) => HEROES[i].name;
  const tiles: [string, string, string][] = [
    ['ico_move', clock(a.time), 'время забега'],
    ['ico_map', `${a.rooms}/${FLOORS * LAYERS}`, 'комнат'],
    ['ico_rage', String(sumOf('kills')), 'врагов повержено'],
    ['ico_hit', sumOf('dmg').toLocaleString('ru'), 'урона'],
    ['ico_disc', String(top.t.top), party.length > 1 ? `лучший удар, ${nameOf(top.i)}` : 'лучший удар'],
    ['ico_ore', String(sumOf('ore')), 'руды добыто'],
  ];
  $('reTiles').innerHTML = tiles.map(([ico, v, l]) => {
    const img = uiArt.get(ico);
    return `<div class="re-tile">${img ? `<img alt="" src="${img.src}">` : ''}<b>${v}</b><span>${escapeHtml(l)}</span></div>`;
  }).join('');
  // a party's nominations: who dealt the most, who took the most, who dug the most, whose discs bounced best
  const player = (i: number) => {
    const k = a.photo.heroes.indexOf(i), n = a.photo.names?.[k];
    return n ? ` (${escapeHtml(n)})` : '';
  };
  const hurt = best('hurt'), rico = best('rico'), crit = best('crits');
  const noms = party.length < 2 ? [] : [
    { t: 'Мясник', h: best('dmg'), v: `${best('dmg').t.dmg} урона` },
    { t: 'Груша для битья', h: hurt, v: `${HEROES[hurt.i].fem ? 'приняла' : 'принял'} ${hurt.t.hurt}` },
    { t: 'Шахтёр', h: best('ore'), v: `${best('ore').t.ore} руды` },
    rico.t.rico > 0 ? { t: 'Бильярдист', h: rico, v: `${rico.t.rico} ${plural(rico.t.rico, 'отскок', 'отскока', 'отскоков')} в цель` }
      : { t: 'Снайпер', h: crit, v: `${crit.t.crits} «ТОЧНО!»` },
  ];
  $('reNoms').innerHTML = noms.map(n => `<div class="re-nom"><img alt="" src="${faceUrl({ i: n.h.i, def: HEROES[n.h.i] })}" style="--c:${HEROES[n.h.i].col}">`
    + `<div><b>${n.t}</b><span>${nameOf(n.h.i)}${player(n.h.i)}, ${n.v}</span></div></div>`).join('');
  $('reNoms').hidden = !noms.length;
  $('reSave').onclick = () => saveCanvas(sheet($('reTitle').textContent ?? ''), 'discodungeon-albom.png');
  const btn = $<HTMLButtonElement>('reBtn');
  btn.hidden = o.button === null;
  btn.textContent = o.button ?? '';
  btn.onclick = o.onButton;
  $('reNote').hidden = o.button !== null;
  $('reLb').hidden = true;
  $('runEnd').hidden = false;
  $('runEnd').scrollTop = 0;
}

export function hideAlbum() {
  $('runEnd').hidden = true;
  $('reLb').hidden = true;
  prints = [];
}
