// The party photo of the hero pick screens: the picked heroes standing in a backdrop, shot onto a square print. Online
// the players' names are written over it with a marker and arrows, so a screenshot or the saved print says who is who.

import { HEROES, HERO_FIG, heroFig } from './data';
import { sprites, uiArt } from './assets';

/** The print's side in canvas pixels. */
export const PHOTO = 1024;

/** One place in the photo: its hero, or the one its player is looking at (drawn pale), and online who stands there. */
export interface PhotoSeat { hero: number | null; look: number | null; name?: string; host?: boolean; ready?: boolean }

/**
 * The backdrops: a picture and the square cut from it. Until the photo's own backdrops are drawn they are three squares
 * of the menu's cardboard diorama.
 */
const BACKDROPS = [{ key: 'menu_bg', x: 256 }, { key: 'menu_bg', x: 0 }, { key: 'menu_bg', x: 512 }];
export const BACKDROP_COUNT = BACKDROPS.length;

/** Where each hero stands (its feet) and how big, by party size: in a trio the middle one stands further back. */
const SPOTS: Record<number, { x: number; y: number; s: number }[]> = {
  1: [{ x: 512, y: 930, s: 1.25 }],
  2: [{ x: 335, y: 925, s: 1.14 }, { x: 695, y: 905, s: 1.08 }],
  3: [{ x: 245, y: 940, s: 1.1 }, { x: 512, y: 845, s: 0.95 }, { x: 780, y: 940, s: 1.1 }],
};
/** A hero's height in the photo at scale 1, for a hero of the usual figure height. */
const TALL = 470;

/** A hero's picture trimmed to what is drawn on it, turned to look the given way; made once for each. */
const arts = new Map<string, HTMLCanvasElement>();
function artOf(i: number, look: 'left' | 'right') {
  const d = HEROES[i], sp = sprites.get(d.key);
  if (!sp) return null;
  const id = d.key + look;
  let cv = arts.get(id);
  if (cv) return cv;
  const img = sp.img, w = img.naturalWidth, h = img.naturalHeight;
  const wk = document.createElement('canvas');
  wk.width = w;
  wk.height = h;
  const c = wk.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, 0, 0);
  const a = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3] <= 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  cv = document.createElement('canvas');
  cv.width = x1 - x0 + 1;
  cv.height = y1 - y0 + 1;
  const o = cv.getContext('2d')!;
  if (sp.facing !== look) {
    o.translate(cv.width, 0);
    o.scale(-1, 1);
  }
  o.drawImage(img, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
  arts.set(id, cv);
  return cv;
}

/** A hero's height in the photo at a spot's scale: the fat ones stand shorter, the thin ones taller, as on the table. */
const tallOf = (i: number, s: number) => TALL * s * (heroFig(HEROES[i]) / HERO_FIG);

/** Words written on the print with a white marker, a dark edge round them so they read on any part of the picture. */
function marker(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot: number, col = '#fbf6ea') {
  c.save();
  c.translate(x, y);
  c.rotate((rot * Math.PI) / 180);
  c.font = `700 ${size}px Hand`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 10;
  c.strokeStyle = 'rgba(18,10,6,.82)';
  c.strokeText(text, 0, 0);
  c.fillStyle = col;
  c.fillText(text, 0, 0);
  c.restore();
}

/** A hand-drawn arrow: one bent stroke from the words to the figure and two strokes of a head. */
function arrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, bend: number) {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
  const a = Math.atan2(y2 - my, x2 - mx), L = 30;
  const path = () => {
    c.beginPath();
    c.moveTo(x1, y1);
    c.quadraticCurveTo(mx, my, x2, y2);
    c.moveTo(x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5));
    c.lineTo(x2, y2);
    c.lineTo(x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5));
  };
  c.save();
  c.lineCap = c.lineJoin = 'round';
  path();
  c.lineWidth = 13;
  c.strokeStyle = 'rgba(18,10,6,.8)';
  c.stroke();
  path();
  c.lineWidth = 6;
  c.strokeStyle = '#fbf6ea';
  c.stroke();
  c.restore();
}

/** Where the names go over a party of this size, and the bend of each arrow. */
const NOTES: Record<number, { x: number; y: number; rot: number; bend: number; dx: number }[]> = {
  1: [{ x: 512, y: 140, rot: -3, bend: 0.06, dx: 0 }],
  2: [{ x: 240, y: 160, rot: -5, bend: -0.22, dx: 30 }, { x: 790, y: 150, rot: 4, bend: 0.22, dx: -30 }],
  3: [{ x: 170, y: 150, rot: -6, bend: -0.22, dx: 30 }, { x: 512, y: 110, rot: 2, bend: 0.06, dx: 0 }, { x: 850, y: 160, rot: 5, bend: 0.22, dx: -30 }],
};

/**
 * Draw the photo: the backdrop, the party standing on its floor, a warm flash and dark corners, the film camera's date,
 * and with `names` each player's name with an arrow to their hero. Drawn only when something changes: no animation.
 */
export function drawPhoto(cv: HTMLCanvasElement, seats: PhotoSeat[], o: { bg: number; names: boolean }) {
  const c = cv.getContext('2d')!, b = BACKDROPS[((o.bg % BACKDROP_COUNT) + BACKDROP_COUNT) % BACKDROP_COUNT], bg = uiArt.get(b.key);
  c.fillStyle = '#1a120d';
  c.fillRect(0, 0, PHOTO, PHOTO);
  if (bg) c.drawImage(bg, b.x, 0, bg.naturalHeight, bg.naturalHeight, 0, 0, PHOTO, PHOTO);
  const n = Math.max(1, Math.min(3, seats.length)), spots = SPOTS[n];
  // the back row first, so the front figures stand over it
  const order = spots.map((_, k) => k).sort((a, b) => spots[a].y - spots[b].y);
  for (const k of order) {
    const s = seats[k], p = spots[k], i = s.hero ?? s.look;
    // the ones at the sides turn to the middle, as people do on a group photo
    const look = n === 1 || k === 1 ? null : k === 0 ? 'right' : 'left';
    const art = i !== null ? artOf(i, look ?? sprites.get(HEROES[i].key)?.facing ?? 'right') : null;
    if (art && i !== null) {
      const h = tallOf(i, p.s), w = (art.width / art.height) * h, feet = p.y + 14 * p.s;
      c.save();
      c.translate(p.x, feet);
      c.scale(1, 0.32);
      const sh = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
      sh.addColorStop(0, 'rgba(10,6,4,.6)');
      sh.addColorStop(1, 'rgba(10,6,4,0)');
      c.fillStyle = sh;
      c.fillRect(-w, -w, w * 2, w * 2);
      c.restore();
      c.save();
      if (s.hero === null) c.globalAlpha = 0.42;
      c.drawImage(art, p.x - w / 2, feet - h, w, h);
      c.restore();
    } else {
      // nobody yet: a chalk ring on the floor where the hero will stand
      c.save();
      c.setLineDash([22, 16]);
      c.lineWidth = 7;
      c.strokeStyle = 'rgba(251,246,234,.75)';
      c.beginPath();
      c.ellipse(p.x, p.y, 105 * p.s, 46 * p.s, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      marker(c, '?', p.x, p.y - 150 * p.s, 150 * p.s, 6);
    }
  }
  // the print: a warm flash on the party, darker corners
  c.save();
  c.globalCompositeOperation = 'soft-light';
  const fl = c.createRadialGradient(PHOTO / 2, PHOTO * 0.62, 40, PHOTO / 2, PHOTO * 0.62, PHOTO * 0.6);
  fl.addColorStop(0, 'rgba(255,236,200,.55)');
  fl.addColorStop(1, 'rgba(255,236,200,0)');
  c.fillStyle = fl;
  c.fillRect(0, 0, PHOTO, PHOTO);
  c.restore();
  const vg = c.createRadialGradient(PHOTO / 2, PHOTO / 2, PHOTO * 0.38, PHOTO / 2, PHOTO / 2, PHOTO * 0.75);
  vg.addColorStop(0, 'rgba(10,6,4,0)');
  vg.addColorStop(1, 'rgba(10,6,4,.5)');
  c.fillStyle = vg;
  c.fillRect(0, 0, PHOTO, PHOTO);
  // the film camera's orange date in the corner
  const d = new Date(), dd = (v: number) => String(v).padStart(2, '0');
  c.save();
  c.font = '600 34px Oswald';
  c.textAlign = 'right';
  c.fillStyle = '#ff9a3c';
  c.shadowColor = 'rgba(255,120,40,.8)';
  c.shadowBlur = 8;
  c.fillText(`'${String(d.getFullYear()).slice(2)} ${dd(d.getMonth() + 1)} ${dd(d.getDate())}`, PHOTO - 34, PHOTO - 34);
  c.restore();
  if (!o.names) return;
  // online: who is who, the same words on every player's screen, so everyone's screenshot is the same photo
  seats.slice(0, n).forEach((s, k) => {
    const m = NOTES[n][k], p = spots[k], i = s.hero ?? s.look;
    const head = i !== null ? p.y + 14 * p.s - tallOf(i, p.s) : p.y - 230 * p.s;
    marker(c, (s.host ? '♛ ' : '') + (s.name ?? ''), m.x, m.y, 68, m.rot);
    const sub = s.hero === null ? 'выбирает…' : s.ready ? 'готов ✓' : s.host ? '' : 'думает…';
    if (sub) marker(c, sub, m.x + 6, m.y + 62, 48, m.rot, s.ready ? '#9ff08a' : '#f6e7b8');
    arrow(c, m.x + m.dx, m.y + (sub ? 98 : 44), p.x - m.dx * 0.7, head - 18, m.bend);
  });
}

/** Save the print in its white edge, as the players see it; a phone offers to share it instead. */
export function savePhoto(cv: HTMLCanvasElement) {
  const m = 34, out = document.createElement('canvas');
  out.width = PHOTO + m * 2;
  out.height = PHOTO + m * 2;
  const c = out.getContext('2d')!;
  c.fillStyle = '#f3ead8';
  c.fillRect(0, 0, out.width, out.height);
  c.drawImage(cv, m, m);
  out.toBlob(b => {
    if (!b) return;
    const file = new File([b], 'discodungeon-otryad.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
