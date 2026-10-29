// The party photo of the hero pick screens: the picked heroes standing in a backdrop, shot onto a square print. Online
// the players' names are written over it with a marker and arrows, so a screenshot or the saved print says who is who.

import { HEROES, HERO_FIG, heroFig } from './data';
import { sprites, uiArt } from './assets';

/** The print's side in canvas pixels. */
export const PHOTO = 1024;

/** One place in the photo: its hero, or the one its player is looking at (drawn pale), and online who stands there. */
export interface PhotoSeat { hero: number | null; look: number | null; name?: string; host?: boolean; ready?: boolean }

/** The backdrops, square rooms with an empty floor in the middle, and how strongly each one's light tints the heroes. */
export const BACKDROPS = [
  { key: 'photo_disco', tint: 0.7 },
  { key: 'photo_bar', tint: 0.7 },
  { key: 'photo_camp', tint: 0.7 },
  { key: 'photo_throne', tint: 0.3 },
];
export const BACKDROP_COUNT = BACKDROPS.length;

/** Where each hero stands (its feet) and how big, by party size: in a trio the middle one stands further back. */
export const SPOTS: Record<number, { x: number; y: number; s: number }[]> = {
  1: [{ x: 512, y: 930, s: 1.25 }],
  2: [{ x: 335, y: 925, s: 1.14 }, { x: 695, y: 905, s: 1.08 }],
  3: [{ x: 245, y: 940, s: 1.1 }, { x: 512, y: 845, s: 0.95 }, { x: 780, y: 940, s: 1.1 }],
};
/** A hero's height in the photo at scale 1, for a hero of the usual figure height. */
export const TALL = 470;

/** A hero's picture trimmed to what is drawn on it, turned to look the given way; made once for each. */
const arts = new Map<string, HTMLCanvasElement>();
export function artOf(i: number, look: 'left' | 'right') {
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

/**
 * The light of a backdrop on the heroes standing in it: its average colour brought up to full brightness, mixed into
 * white by `tint` and dimmed by half that, so the figures take the room's colour instead of looking pasted on.
 */
const lights = new Map<HTMLImageElement, [number, number, number]>();
export function lightOf(bg: HTMLImageElement) {
  let l = lights.get(bg);
  if (!l) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(bg, 0, 0, 16, 16);
    const a = c.getImageData(0, 0, 16, 16).data, sum = [0, 0, 0];
    for (let k = 0; k < a.length; k += 4) for (let j = 0; j < 3; j++) sum[j] += a[k + j];
    const top = Math.max(...sum, 1);
    l = [sum[0] / top, sum[1] / top, sum[2] / top];
    lights.set(bg, l);
  }
  return l;
}
/** A hero's picture in a backdrop's light, made once for each pair. */
const lit = new Map<string, HTMLCanvasElement>();
function tinted(art: HTMLCanvasElement, id: string, light: [number, number, number], tint: number) {
  let cv = lit.get(id);
  if (!cv) lit.set(id, (cv = inLight(art, light, tint)));
  return cv;
}
/** A picture in a light, drawn anew: for the album's figures, each drawn once with its own bruises and trophies. */
export function inLight(art: HTMLCanvasElement, light: [number, number, number], tint: number) {
  const cv = document.createElement('canvas');
  cv.width = art.width;
  cv.height = art.height;
  const c = cv.getContext('2d')!, dim = 1 - tint / 2;
  c.drawImage(art, 0, 0);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = `rgb(${light.map(v => Math.round(255 * (1 - tint + tint * v) * dim)).join(',')})`;
  c.fillRect(0, 0, cv.width, cv.height);
  // multiplying fills the empty corners too; the picture's own outline cuts them away again
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(art, 0, 0);
  return cv;
}

/** A hero's height in the photo at a spot's scale: the fat ones stand shorter, the thin ones taller, as on the table. */
export const tallOf = (i: number, s: number) => TALL * s * (heroFig(HEROES[i]) / HERO_FIG);

/**
 * Words written on the print with a marker, a dark edge round them so they read on any part of the picture: one colour,
 * or pieces of different colours on one line.
 */
export function marker(c: CanvasRenderingContext2D, text: string | [string, string][], x: number, y: number, size: number, rot: number, col = '#fbf6ea') {
  const parts: [string, string][] = typeof text === 'string' ? [[text, col]] : text;
  c.save();
  c.translate(x, y);
  c.rotate((rot * Math.PI) / 180);
  c.font = `700 ${size}px Hand`;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 10;
  c.strokeStyle = 'rgba(18,10,6,.82)';
  let at = -parts.reduce((w, [t]) => w + c.measureText(t).width, 0) / 2;
  for (const [t, cl] of parts) {
    c.strokeText(t, at, 0);
    c.fillStyle = cl;
    c.fillText(t, at, 0);
    at += c.measureText(t).width;
  }
  c.restore();
}

/** A hero's colour brought towards white, so its name reads in marker on the dark print (as on the hero's card). */
export function light(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${[v >> 16, (v >> 8) & 255, v & 255].map(x => Math.round(x * 0.62 + 255 * 0.38)).join(',')})`;
}

/** A hand-drawn arrow: one bent stroke from the words to the figure and two strokes of a head. */
export function arrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, bend: number) {
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
export function drawPhoto(cv: HTMLCanvasElement, seats: PhotoSeat[], o: { bg: number; names: boolean; date?: number }) {
  const c = cv.getContext('2d')!, b = BACKDROPS[((o.bg % BACKDROP_COUNT) + BACKDROP_COUNT) % BACKDROP_COUNT], bg = uiArt.get(b.key);
  c.fillStyle = '#1a120d';
  c.fillRect(0, 0, PHOTO, PHOTO);
  if (bg) c.drawImage(bg, 0, 0, PHOTO, PHOTO);
  const n = Math.max(1, Math.min(3, seats.length)), spots = SPOTS[n];
  // the back row first, so the front figures stand over it
  const order = spots.map((_, k) => k).sort((a, b) => spots[a].y - spots[b].y);
  for (const k of order) {
    // a client can draw the lobby a moment before the host's list of players comes: the places are empty till then
    const s = seats[k] ?? { hero: null, look: null }, p = spots[k], i = s.hero ?? s.look;
    // the ones at the sides turn to the middle, as people do on a group photo
    const look = n === 1 || k === 1 ? null : k === 0 ? 'right' : 'left';
    let art = i !== null ? artOf(i, look ?? sprites.get(HEROES[i].key)?.facing ?? 'right') : null;
    if (art && bg && i !== null) art = tinted(art, `${i}${look}${b.key}`, lightOf(bg), b.tint);
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
  finish(c, o.date);
  if (!o.names) return;
  // online: who is who, the same words on every player's screen, so everyone's screenshot is the same photo
  seats.slice(0, n).forEach((s, k) => {
    const m = NOTES[n][k], p = spots[k], i = s.hero ?? s.look;
    const head = i !== null ? p.y + 14 * p.s - tallOf(i, p.s) : p.y - 230 * p.s;
    marker(c, (s.host ? '♛ ' : '') + (s.name ?? ''), m.x, m.y, 68, m.rot);
    // under the name its hero, a green tick once its player is ready; or that the player is still choosing
    const sub: [string, string][] = s.hero === null ? [['выбирает…', '#f6e7b8']] : [[HEROES[s.hero].name, light(HEROES[s.hero].col)]];
    if (s.hero !== null && s.ready) sub.push([' ✓', '#9ff08a']);
    marker(c, sub, m.x + 6, m.y + 62, 50, m.rot);
    arrow(c, m.x + m.dx, m.y + 100, p.x - m.dx * 0.7, head - 18, m.bend);
  });
}

/**
 * The print's finish over a picture: a warm flash on the middle (`flash`), darker corners, and the film camera's orange
 * date in the corner, the day it is shot (or `date`, in ms).
 */
export function finish(c: CanvasRenderingContext2D, date?: number, flash = true) {
  if (flash) {
    c.save();
    c.globalCompositeOperation = 'soft-light';
    const fl = c.createRadialGradient(PHOTO / 2, PHOTO * 0.62, 40, PHOTO / 2, PHOTO * 0.62, PHOTO * 0.6);
    fl.addColorStop(0, 'rgba(255,236,200,.55)');
    fl.addColorStop(1, 'rgba(255,236,200,0)');
    c.fillStyle = fl;
    c.fillRect(0, 0, PHOTO, PHOTO);
    c.restore();
  }
  const vg = c.createRadialGradient(PHOTO / 2, PHOTO / 2, PHOTO * 0.38, PHOTO / 2, PHOTO / 2, PHOTO * 0.75);
  vg.addColorStop(0, 'rgba(10,6,4,0)');
  vg.addColorStop(1, 'rgba(10,6,4,.5)');
  c.fillStyle = vg;
  c.fillRect(0, 0, PHOTO, PHOTO);
  const d = new Date(date ?? Date.now()), dd = (v: number) => String(v).padStart(2, '0');
  c.save();
  c.font = '600 34px Oswald';
  c.textAlign = 'right';
  c.fillStyle = '#ff9a3c';
  c.shadowColor = 'rgba(255,120,40,.8)';
  c.shadowBlur = 8;
  c.fillText(`'${String(d.getFullYear()).slice(2)} ${dd(d.getMonth() + 1)} ${dd(d.getDate())}`, PHOTO - 34, PHOTO - 34);
  c.restore();
}

/** The still pictures standing in for the photo canvases on screen, and the latest drawing each one waits for. */
const stills = new WeakMap<HTMLCanvasElement, { img: HTMLImageElement; drawn: number; url: string }>();

/**
 * Show a photo canvas just drawn as a still picture of it once that is ready. Over the live hall a canvas is composited
 * again on every frame of the hall under it, which costs as much as the hall itself, while a picture is drawn into the
 * screen once. The canvas shows meanwhile, so a hero under the mouse steps into the photo at once.
 */
export function stillPhoto(cv: HTMLCanvasElement) {
  let s = stills.get(cv);
  if (!s) {
    const img = document.createElement('img');
    img.hidden = true;
    cv.after(img);
    stills.set(cv, (s = { img, drawn: 0, url: '' }));
  }
  const st = s, n = ++st.drawn;
  st.img.hidden = true;
  cv.hidden = false;
  cv.toBlob(b => {
    if (!b || n !== st.drawn) return;
    if (st.url) URL.revokeObjectURL(st.url);
    st.img.src = st.url = URL.createObjectURL(b);
    st.img.decode().then(() => {
      if (n !== st.drawn) return;
      st.img.alt = cv.getAttribute('aria-label') ?? '';
      st.img.hidden = false;
      cv.hidden = true;
    }, () => {});
  }, 'image/jpeg', 0.95);
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
  saveCanvas(out, 'discodungeon-otryad.png');
}

/** Save a picture as a PNG file of that name; a phone offers to share it instead. */
export function saveCanvas(out: HTMLCanvasElement, name: string) {
  out.toBlob(b => {
    if (!b) return;
    const file = new File([b], name, { type: 'image/png' });
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
