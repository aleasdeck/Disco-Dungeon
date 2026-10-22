// The ore counters at the blacksmith's (his window's and the top strip's) follow the party's ore with a short play when it
// moves there: the smith's gift coming in as his window opens, a level or a disc bought going out, by this screen or by
// another player online. The number ticks one by one, green as ore comes and red as it goes, and a kraft sticker with the
// difference floats off beside it (Vladislav picked this of three, 2026-10-22). Every play runs once and stops (no endless
// animation: phones heat up); its steps are page animations, so a recording's stepped clock (e2e/rec-clip.mjs) steps them too.

export interface OrePlay {
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

export class OreCounters {
  /** Bumped by every play, so a newer one takes the counters over from an older one still running. */
  private run = 0;
  /** The sticker the play running has put up beside the counter, gone when the next one starts. */
  private left: Element | null = null;

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
    const n = Math.abs(to - from), dir = Math.sign(to - from), gap = Math.max(45, Math.min(110, 560 / n));
    later(o.wait ?? 0, () => {
      if (id !== this.run) return;
      this.mark(dir, n * gap + 500);
      this.sticker(to - from, o)?.animate([
        { opacity: 0, transform: 'translateY(0) rotate(-4deg) scale(0.6)' },
        { opacity: 1, transform: 'translateY(0) rotate(-4deg) scale(1.08)', offset: 0.12 },
        { opacity: 1, transform: `translateY(${dir * -6}px) rotate(-4deg)`, offset: 0.7 },
        { opacity: 0, transform: `translateY(${dir * -22}px) rotate(-4deg)` },
      ], { duration: 1500 + n * gap, easing: 'ease-out', fill: 'both' });
      let k = 0;
      const next = () => {
        if (id !== this.run || k === n) return;
        this.step(from + dir * ++k);
        later(gap, next);
      };
      next();
    });
  }

  private write(n: number) {
    for (const b of this.nums()) b.textContent = String(n);
  }

  /** One tick: the number moves on with a little hop. */
  private step(n: number) {
    this.write(n);
    for (const b of this.nums()) b.animate([{ transform: 'none' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
  }

  private clear() {
    this.left?.remove();
    this.left = null;
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
  private sticker(d: number, o: OrePlay) {
    const box = this.nums()[0]?.parentElement;
    if (!box) return null;
    const s = document.createElement('span');
    s.className = `ore-fx ${d > 0 ? 'up' : 'down'}`;
    s.innerHTML = (o.who ? `<img src="${o.who.face}" alt="" style="--c:${o.who.col}">` : '') + `<b>${d > 0 ? '+' : '−'}${Math.abs(d)}</b>`;
    box.appendChild(s);
    this.left = s;
    return s;
  }
}
