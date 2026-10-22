// The ore counters at the blacksmith's (his window's and the top strip's) follow the party's ore with a short play when it
// moves there: the smith's gift coming in as his window opens, a level or a disc bought going out, by this screen or by
// another player online. Every play runs once and stops (no endless animation: phones heat up); its steps are page
// animations, so a recording's stepped clock (e2e/rec-clip.mjs) steps them too.

import { icon } from './icons';

/** How the counters play a change: the number ticking with a sticker, lumps of ore flying, or a rolling reel with a stamp. */
type Look = 'tick' | 'fly' | 'reel';
const LOOK: Look = (['tick', 'fly', 'reel'] as const).find(k => k === new URLSearchParams(location.search).get('orefx')) ?? 'fly';

export interface OrePlay {
  /** Where the ore comes from (the smith's picture) or where it goes (the slab bought, the buyer's face). */
  from?: Element | null;
  to?: Element | null;
  /** Another hero bought it: its face and colour on the sticker. */
  who?: { face: string; col: string };
  /** A moment before it starts, for the window to come up first (ms). */
  wait?: number;
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `fn` after `ms`, on the page's animation clock. */
function later(ms: number, fn: () => void) {
  const a = document.body.animate([], { duration: Math.max(1, ms) });
  a.onfinish = fn;
  return a;
}

const mid = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };

/** A short jump of an element: the counter taking a lump, the slab taking the ore. */
const bump = (el: Element | null | undefined, k = 1.25, ms = 220) =>
  el?.animate([{ transform: 'none' }, { transform: `scale(${k})`, offset: 0.35 }, { transform: 'none' }], { duration: ms, easing: 'ease-out' });

export class OreCounters {
  /** Bumped by every play, so a newer one takes the counters over from an older one still running. */
  private run = 0;
  /** What the play running has put up beside the counters, gone when the next one starts. */
  private left: Element[] = [];

  /** The numbers: the window's first, then the strip's. */
  constructor(private nums: () => HTMLElement[]) {}

  /** The counters show `n` at once. */
  show(n: number) {
    this.run++;
    this.clear();
    this.write(n);
  }

  /** The counters go from `from` to `to` with the play. */
  play(from: number, to: number, o: OrePlay = {}) {
    const id = ++this.run;
    this.clear();
    if (from === to || still()) { this.write(to); this.mark(Math.sign(to - from), 700); return; }
    this.write(from);
    if (LOOK === 'tick') this.tick(id, from, to, o);
    else if (LOOK === 'fly') this.fly(id, from, to, o);
    else this.reel(id, from, to, o);
  }

  private write(n: number) {
    for (const b of this.nums()) b.textContent = String(n);
  }

  private step(id: number, n: number) {
    if (id !== this.run) return;
    this.write(n);
    for (const b of this.nums()) bump(b, 1.18, 160);
  }

  private clear() {
    for (const el of this.left) el.remove();
    this.left = [];
    for (const b of this.nums()) b.parentElement?.classList.remove('ore-up', 'ore-down');
  }

  /** The counters in green while ore comes, red while it goes, for `ms`. */
  private mark(dir: number, ms: number) {
    if (!dir) return;
    const id = this.run;
    for (const b of this.nums()) b.parentElement?.classList.add(dir > 0 ? 'ore-up' : 'ore-down');
    later(ms, () => { if (id === this.run) for (const b of this.nums()) b.parentElement?.classList.remove('ore-up', 'ore-down'); });
  }

  /** «−4» or «+3» on a sticker by the window's counter, with the buyer's face when another hero spent it. */
  private sticker(cls: string, d: number, o: OrePlay) {
    const box = this.nums()[0]?.parentElement;
    if (!box) return null;
    const s = document.createElement('span');
    s.className = `ore-fx ${cls} ${d > 0 ? 'up' : 'down'}`;
    s.innerHTML = (o.who ? `<img src="${o.who.face}" alt="" style="--c:${o.who.col}">` : '') + `<b>${d > 0 ? '+' : '−'}${Math.abs(d)}</b>`;
    box.appendChild(s);
    this.left.push(s);
    return s;
  }

  /** A: the number ticks one by one, a kraft sticker with the difference floats off beside it. */
  private tick(id: number, from: number, to: number, o: OrePlay) {
    const n = Math.abs(to - from), dir = Math.sign(to - from), gap = Math.max(45, Math.min(110, 560 / n)), wait = o.wait ?? 0;
    later(wait, () => {
      if (id !== this.run) return;
      this.mark(dir, n * gap + 500);
      const s = this.sticker('stk', to - from, o);
      s?.animate([
        { opacity: 0, transform: 'translateY(0) rotate(-4deg) scale(0.6)' },
        { opacity: 1, transform: 'translateY(0) rotate(-4deg) scale(1.08)', offset: 0.12 },
        { opacity: 1, transform: `translateY(${dir * -6}px) rotate(-4deg)`, offset: 0.7 },
        { opacity: 0, transform: `translateY(${dir * -22}px) rotate(-4deg)` },
      ], { duration: 1500 + n * gap, easing: 'ease-out', fill: 'both' });
      let k = 0;
      const next = () => {
        if (id !== this.run || k === n) return;
        this.step(id, from + dir * ++k);
        later(gap, next);
      };
      next();
    });
  }

  /** B: lumps of ore fly from the smith's picture into the counter, or out of it to the slab bought or the buyer's face. */
  private fly(id: number, from: number, to: number, o: OrePlay) {
    const n = Math.abs(to - from), dir = Math.sign(to - from), wait = o.wait ?? 0, gap = Math.max(55, Math.min(90, 700 / n));
    const num = this.nums()[0], cnt = num?.parentElement?.querySelector('.ico') ?? num;
    later(wait, () => {
      if (id !== this.run) return;
      this.mark(dir, wait + n * gap + 700);
      const a = dir > 0 ? o.from : cnt, b = dir > 0 ? cnt : o.to;
      if (!a) { this.tick(id, from, to, {}); return; }
      const p = mid(a), size = Math.max(18, Math.min(30, cnt ? mid(cnt).w : 26));
      // no place to go: the lumps jump up off the counter and are gone
      const q = b ? mid(b) : { x: p.x + 10, y: p.y - 70, w: 0 };
      const dx = q.x - p.x, dy = q.y - p.y, lift = Math.min(140, 40 + Math.hypot(dx, dy) * 0.3);
      for (let k = 0; k < n; k++) {
        const lump = document.createElement('i');
        lump.className = 'ore-lump';
        lump.style.cssText = `left:${p.x - size / 2}px;top:${p.y - size / 2}px;width:${size}px;height:${size}px`;
        lump.innerHTML = icon('ore');
        document.body.appendChild(lump);
        // a little scatter so they don't fly as one, along a curve over the straight line
        const sx = (k % 3 - 1) * 7, turn = (k % 2 ? 1 : -1) * (160 + k * 23);
        const at = (t: number) => {
          const x = 2 * (1 - t) * t * (dx / 2 + sx) + t * t * dx, y = 2 * (1 - t) * t * (dy / 2 - lift) + t * t * dy;
          return `translate(${x}px, ${y}px) rotate(${turn * t}deg) scale(${0.7 + Math.sin(Math.PI * t) * 0.45 - (b ? 0 : t * 0.3)})`;
        };
        const fly = lump.animate([0, 0.2, 0.4, 0.6, 0.8, 1].map(t => ({ transform: at(t), opacity: !b && t === 1 ? 0 : 1 })),
          { duration: 520, delay: k * gap, easing: 'cubic-bezier(0.35, 0, 0.6, 1)', fill: 'backwards' });
        const v = from + dir * (k + 1);
        // ore going out leaves the counter as the lump takes off; coming in it counts as the lump lands
        if (dir < 0) later(k * gap, () => this.step(id, v));
        fly.onfinish = () => {
          lump.remove();
          if (dir > 0) this.step(id, v);
          else if (b && k === n - 1) bump(b, 1.15, 260);
        };
      }
    });
  }

  /** C: the number rolls like a counter's wheel to the new one, and a stamp with the difference slaps down beside it. */
  private reel(id: number, from: number, to: number, o: OrePlay) {
    const n = Math.abs(to - from), dir = Math.sign(to - from), wait = o.wait ?? 0, ms = Math.min(1100, 320 + 70 * n);
    later(wait, () => {
      if (id !== this.run) return;
      this.mark(dir, ms + 600);
      // the wheel runs up when ore comes, down when it goes: the numbers in a column, the window over it moving along
      const list = Array.from({ length: n + 1 }, (_, k) => from + dir * k), col = dir > 0 ? list : list.reverse();
      const end = dir > 0 ? n : 0, start = dir > 0 ? 0 : n;
      for (const b of this.nums()) {
        b.innerHTML = `<span class="ore-reel"><span>${col.map(v => `<span>${v}</span>`).join('')}</span></span>`;
        const strip = b.querySelector<HTMLElement>('.ore-reel > span')!;
        strip.animate([{ transform: `translateY(${-start * 1.2}em)` }, { transform: `translateY(${-end * 1.2}em)` }],
          { duration: ms, easing: 'cubic-bezier(0.25, 0.75, 0.35, 1)', fill: 'both' });
      }
      const ico = this.nums()[0]?.parentElement?.querySelector('.ico');
      ico?.animate([{ transform: 'none' }, { transform: 'rotate(-14deg) scale(1.15)', offset: 0.2 }, { transform: 'rotate(10deg)', offset: 0.45 }, { transform: 'rotate(-5deg)', offset: 0.7 }, { transform: 'none' }],
        { duration: 600, easing: 'ease-out' });
      const s = this.sticker('stamp', to - from, o);
      s?.animate([
        { opacity: 0, transform: 'rotate(-12deg) scale(2.4)' },
        { opacity: 1, transform: 'rotate(-9deg) scale(0.92)', offset: 0.1 },
        { opacity: 1, transform: 'rotate(-9deg) scale(1)', offset: 0.16 },
        { opacity: 1, transform: 'rotate(-9deg) scale(1)', offset: 0.75 },
        { opacity: 0, transform: 'rotate(-9deg) scale(1)' },
      ], { duration: 1900, easing: 'ease-out', fill: 'both' });
      later(ms, () => { if (id === this.run) this.write(to); });
    });
  }
}
