// The hero's own lines (thread «Обучение от лица героя»): a scrap of kraft paper hanging under the top strip with the
// speaker's face stuck on its corner, and a chalk ring or a «тяни» arrow on what the line is about. The chalk is drawn
// once and stands still: it is drawn again only when what it points at has moved on screen, never animated.

import type { HeroDef } from './data';
import { faceUrl } from './ui';

/** A box on screen, in CSS pixels. */
export interface Box { x: number; y: number; w: number; h: number }

export interface Line {
  /** What it says; «» quotes come out as the button names they are. */
  text: string;
  /** Who says it. */
  by: HeroDef;
  /** 'tap' goes on a tap («дальше»), 'do' stays until the thing it asks for is done (whoever shows it takes it down). */
  kind: 'tap' | 'do';
  /** What the chalk rings, worked out afresh while the line is up; null while it isn't on screen. */
  ring?: () => Box | null;
  /** What a few chalk arrows point at from the open side of the screen, in place of a ring (the rune, the trick's button). */
  point?: () => Box | null;
  /** The pull: from the hero's feet, away from `to`, where the disc should fly; a dashed line goes from the feet to `to`. */
  pull?: () => { foot: [number, number]; to: [number, number] } | null;
  /** Buttons under the words, the first the main one; the line stays up until one is pressed. */
  btns?: { text: string; on: () => void }[];
  /** The room under the line dims, and taps on it are taken by the line (the offer before the warm-up). */
  dim?: boolean;
  /** Where it hangs: under the top strip, or lower, in the middle of the screen (over the map, whose top is the boss). */
  at?: 'top' | 'mid';
}

const ROUGH = '<defs><filter id="chalkRough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.6"/><feComponentTransfer><feFuncA type="table" tableValues="0 .55 .95 1"/></feComponentTransfer></filter></defs>';

const f1 = (v: number) => v.toFixed(1);

/** A hand-drawn chalk loop round a box, closed a little past where it began; kept on screen, so a corner button gets a whole ring. */
function ring(r: Box, pad: number) {
  const m = 6, x0 = Math.max(m + pad, r.x), y0 = Math.max(m + pad, r.y), x1 = Math.min(innerWidth - m - pad, r.x + r.w), y1 = Math.min(innerHeight - m - pad, r.y + r.h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + pad, ry = (y1 - y0) / 2 + pad * 0.8, pts: string[] = [];
  for (let k = 0; k <= 34; k++) {
    const a = -2.2 + (k / 30) * Math.PI * 2, wob = 1 + 0.035 * Math.sin(k * 1.7) + (k > 30 ? 0.06 : 0);
    pts.push(`${f1(cx + Math.cos(a) * rx * wob)} ${f1(cy + Math.sin(a) * ry * wob)}`);
  }
  return `<path class="chalk" d="M${pts.join(' L')}"/>`;
}

/** A chalk arrow from a to b, bowed a little, its head at b. */
function arrow(a: [number, number], b: [number, number], bow: number, dash = false) {
  const c = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * bow, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bow];
  const ang = Math.atan2(b[1] - c[1], b[0] - c[0]), L = 14;
  const h1 = [b[0] - Math.cos(ang - 0.5) * L, b[1] - Math.sin(ang - 0.5) * L], h2 = [b[0] - Math.cos(ang + 0.5) * L, b[1] - Math.sin(ang + 0.5) * L];
  const p = (q: number[]) => q.map(f1).join(' ');
  return `<path class="chalk${dash ? ' dash' : ''}" d="M${p(a)} Q${p(c)} ${p(b)}"/><path class="chalk" d="M${p(h1)} L${p(b)} L${p(h2)}"/>`;
}

/**
 * Two or three chalk arrows coming at a box from the side of the screen that has room for them (towards the screen's
 * middle first), their heads just off its edge; none starts off screen, under the line's paper or over another button.
 */
function arrows(r: Box, paper: DOMRect | null, phone: boolean) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, hw = r.w / 2 + 6, hh = r.h / 2 + 6, len = phone ? 54 : 66, m = 14;
  const toMid = Math.atan2(innerHeight / 2 - cy, innerWidth / 2 - cx), fan = [-0.75, 0, 0.75], d2r = Math.PI / 180;
  const make = (a: number, k: number) => {
    const ux = Math.cos(a), uy = Math.sin(a), R = 1 / Math.hypot(ux / hw, uy / hh), L = len * [0.9, 1.12, 0.96][k];
    const end: [number, number] = [cx + ux * (R + 4), cy + uy * (R + 4)], start: [number, number] = [cx + ux * (R + 4 + L), cy + uy * (R + 4 + L)];
    const off = start[0] < m || start[0] > innerWidth - m || start[1] < m || start[1] > innerHeight - m;
    const under = !!paper && start[0] > paper.left - 6 && start[0] < paper.right + 6 && start[1] > paper.top - 6 && start[1] < paper.bottom + 6;
    // nor across another button, whose label it would cross out
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], onBtn = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('button');
    return off || under || onBtn(start[0], start[1]) || onBtn(mid[0], mid[1]) ? null : arrow(start, end, [0.1, -0.05, 0.08][k]);
  };
  // the fan is turned away from the middle a little at a time until most of it fits
  let best: string[] = [];
  for (const turn of [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90]) {
    const got = fan.map((f, k) => make(toMid + f + turn * d2r, k)).filter((a): a is string => a !== null);
    if (got.length > best.length) best = got;
    if (best.length === fan.length) break;
  }
  return best.join('');
}

const word = (x: number, y: number, t: string, rot: number) => `<text class="chalk-t" x="${f1(x)}" y="${f1(y)}" transform="rotate(${rot} ${f1(x)} ${f1(y)})">${t}</text>`;

/** «В бой!» in a line comes out as the label of the button it names. */
const words = (t: string) => t.replace(/«([^»]+)»/g, '<q>$1</q>');

export class Coach {
  private box: HTMLElement;
  private dim: HTMLElement;
  private svg: SVGSVGElement;
  private wrap: HTMLElement | null = null;
  /** The line up now. */
  line: Line | null = null;
  /** The chalk drawn last, so it is drawn again only when what it points at moves. */
  private drawn = '';
  /** Pressed on a 'tap' line, or on its «дальше». */
  onTap: (() => void) | null = null;
  /** Where the line hangs from: just under the top strip and the queue of enemies. */
  top: () => number = () => 80;

  constructor() {
    this.box = document.createElement('div');
    this.box.id = 'coach';
    this.box.hidden = true;
    this.dim = document.createElement('div');
    this.dim.className = 'coach-dim';
    this.dim.hidden = true;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('coach-chalk');
    this.svg.setAttribute('aria-hidden', 'true');
    this.box.append(this.dim, this.svg);
    document.body.append(this.box);
    window.addEventListener('resize', () => { if (this.line) this.place(); });
  }

  get up() { return this.line !== null; }

  /** Put a line up in place of the one before. */
  say(line: Line) {
    this.line = line;
    this.wrap?.remove();
    const el = document.createElement('div');
    el.className = 'coach-line';
    el.style.setProperty('--c', line.by.col);
    el.setAttribute('role', 'status');
    const face = document.createElement('div');
    face.className = 'coach-face';
    const img = document.createElement('img');
    img.src = faceUrl({ i: 0, def: line.by });
    img.alt = '';
    face.append(img);
    const paper = document.createElement('div');
    paper.className = 'coach-paper';
    paper.innerHTML = `<p>${words(line.text)}</p>`;
    const name = document.createElement('b');
    name.className = 'coach-name';
    name.textContent = line.by.name;
    if (line.btns) {
      const row = document.createElement('div');
      row.className = 'coach-btns';
      line.btns.forEach((b, k) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = k ? 'no' : 'go';
        btn.textContent = b.text;
        btn.addEventListener('click', e => { e.stopPropagation(); b.on(); });
        row.append(btn);
      });
      paper.append(row);
    } else if (line.kind === 'tap') {
      const more = document.createElement('span');
      more.className = 'coach-more';
      more.textContent = 'дальше ▸';
      paper.append(more);
    }
    el.append(paper, name, face);
    // a tap anywhere on a line to read and forget takes it down; one asking for something stays
    if (line.kind === 'tap' && !line.btns) el.addEventListener('click', () => this.onTap?.());
    this.box.append(el);
    this.wrap = el;
    this.drawn = '-';
    this.box.hidden = false;
    this.place();
  }

  /** Take the line down. */
  hush() {
    this.line = null;
    this.wrap?.remove();
    this.wrap = null;
    this.svg.innerHTML = '';
    this.drawn = '';
    this.box.hidden = true;
  }

  /** Lines step aside while a menu is open over the game, and come back with it. */
  hide(on: boolean) {
    if (this.line) this.box.hidden = on;
  }

  /** Hang the line where it goes and draw its chalk; called again whenever the view may have moved. */
  place() {
    const line = this.line, el = this.wrap;
    if (!line || !el) return;
    const W = innerWidth, H = innerHeight, phone = W < 700;
    const w = phone ? W - 40 : Math.min(560, W - 40);
    el.style.width = w + 'px';
    el.style.left = (phone ? 26 : (W - w) / 2) + 'px';
    el.classList.toggle('big', !phone);
    const top = line.at === 'mid' ? Math.max(this.top(), H * 0.42 - el.offsetHeight / 2) : this.top();
    el.style.top = Math.round(top) + 'px';
    this.chalk(phone);
  }

  /** The chalk of the line up now, drawn again only if it would come out different. */
  chalk(phone = innerWidth < 700) {
    const line = this.line;
    if (!line) return;
    let svg = '', hole: [number, number, number] | null = null;
    const r = line.ring?.();
    if (r) {
      svg += ring(r, phone ? 6 : 10);
      hole = [r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) / 2 + 26];
    }
    const pt = line.point?.();
    if (pt) {
      svg += arrows(pt, this.wrap?.getBoundingClientRect() ?? null, phone);
      hole = [pt.x + pt.w / 2, pt.y + pt.h / 2, Math.max(pt.w, pt.h) / 2 + 70];
    }
    const pl = line.pull?.();
    if (pl) {
      const { foot, to } = pl, dx = foot[0] - to[0], dy = foot[1] - to[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      // the arrow pulls straight back from the target, shorter where the screen's edge is near
      let len = phone ? 70 : 110;
      while (len > 40 && (foot[1] + uy * len > innerHeight - 34 || foot[0] + ux * len > innerWidth - 60 || foot[0] + ux * len < 20 || foot[1] + uy * len < 20)) len -= 4;
      const back: [number, number] = [foot[0] + ux * len, foot[1] + uy * len];
      svg += arrow([foot[0] + ux * 16, foot[1] + uy * 16], back, 0.12);
      // the word stands off the arrow's end to the side, below it rather than above, clear of the figure
      const nx = uy > 0 ? -uy : uy, ny = Math.abs(ux), side = nx < 0 ? -1 : 1;
      svg += word(back[0] + nx * 26 + (side < 0 ? -40 : 0), back[1] + ny * 26 + 6, 'тяни', -8);
      svg += arrow([foot[0] - ux * 22, foot[1] - uy * 22], [to[0] + ux * 18, to[1] + uy * 18], -0.06, true);
      hole = [foot[0], foot[1], phone ? 120 : 170];
    }
    const key = svg + (line.dim ? 'dim' : '');
    if (key === this.drawn) return;
    this.drawn = key;
    this.svg.innerHTML = svg ? ROUGH + svg : '';
    this.dim.hidden = !line.dim;
    if (line.dim) this.dim.style.background = hole ? `radial-gradient(circle at ${f1(hole[0])}px ${f1(hole[1])}px, transparent ${hole[2]}px, rgba(12,8,5,.58) ${hole[2] + 40}px)` : 'rgba(12,8,5,.58)';
  }
}
