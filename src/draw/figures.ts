// Tabletop-miniature figures: a coloured round base plus the figure on top.
// The figure is the artist's picture when one is loaded, otherwise a code-drawn caricature.

import { HEROES, INK, type MobKind } from '../data';
import { sprites } from '../assets';
import { brow, circ, ell, eye, fs, lg, mix, pth, rg, rr, type Ctx } from './util';

export const BASE_TH = 3.2;

export interface MiniatureOpts {
  key: string;
  x: number;
  y: number;
  /** Base radius in world units. */
  baseR: number;
  baseCol: string;
  /** Figure height in iso units. */
  fig: number;
  faceRight: boolean;
  flash: boolean;
  hop: number;
  alpha: number;
  placeholder: (c: Ctx, x: number, y: number, flash: boolean) => void;
}

/** Round painted base, as on a board-game miniature. (x, y) is the centre of its bottom face. */
export function drawBase(c: Ctx, x: number, y: number, R: number, col: string) {
  const rx = R * 1.27, ry = R * 0.64, th = BASE_TH;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  c.lineTo(x - rx, y - th);
  c.ellipse(x, y - th, rx, ry, 0, Math.PI, 0, true);
  c.closePath();
  fs(c, lg(c, x - rx, 0, x + rx, 0, mix(col, '#000000', 0.25), mix(col, '#000000', 0.6)), 1);
  ell(c, x, y - th, rx, ry);
  fs(c, lg(c, 0, y - th - ry, 0, y - th + ry, mix(col, '#ffffff', 0.28), col), 1);
  // bevel highlight and a ring of texture, like flocking on a painted base
  c.strokeStyle = 'rgba(255,255,255,.35)';
  c.lineWidth = 0.6;
  c.beginPath();
  c.ellipse(x, y - th, rx * 0.86, ry * 0.8, 0, Math.PI * 1.05, Math.PI * 1.6);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.18)';
  c.beginPath();
  c.ellipse(x, y - th, rx * 0.62, ry * 0.6, 0, 0, Math.PI * 2);
  c.stroke();
}

export function drawMiniature(c: Ctx, o: MiniatureOpts) {
  c.save();
  c.globalAlpha *= o.alpha;
  const r = o.baseR;
  ell(c, o.x + 1.2, o.y + 1, r * 1.27 + 1.2, r * 0.64 + 0.8);
  c.fillStyle = 'rgba(15,8,4,.38)';
  c.fill();
  const y = o.y - o.hop;
  drawBase(c, o.x, y, r, o.baseCol);
  const feet = y - BASE_TH;
  const sp = sprites.get(o.key);
  c.save();
  const nativeRight = sp ? sp.facing === 'right' : true;
  if (o.faceRight !== nativeRight) {
    c.translate(o.x, 0);
    c.scale(-1, 1);
    c.translate(-o.x, 0);
  }
  if (sp) {
    const h = o.fig, w = (h * sp.img.naturalWidth) / sp.img.naturalHeight;
    if (o.flash) c.filter = 'brightness(3) saturate(0)';
    c.drawImage(sp.img, o.x - w / 2, feet - h + 1, w, h);
    c.filter = 'none';
  } else {
    o.placeholder(c, o.x, feet, o.flash);
  }
  c.restore();
  c.restore();
}

// ---------------------------------------------------------------- heroes

/** Caricature hero, feet at (x, y), s = scale. */
export function drawHeroFigure(c: Ctx, i: number, x: number, y: number, s: number, flash: boolean, t = 0) {
  const h = HEROES[i], W = flash ? '#fff' : null, L = (v: number) => v * s;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (i === 0) {
    rr(c, x - L(6), y - L(5), L(5), L(5), L(1.2)); fs(c, W || '#3b2c22', L(0.9));
    rr(c, x + L(1), y - L(5), L(5), L(5), L(1.2)); fs(c, W || '#3b2c22', L(0.9));
    ell(c, x, y - L(13), L(9), L(9)); fs(c, W || lg(c, x - L(9), 0, x + L(9), 0, '#b9bfbf', '#5f6866'), L(1.1));
    c.strokeStyle = 'rgba(26,18,16,.5)'; c.lineWidth = L(0.6); c.beginPath(); c.arc(x - L(3), y - L(15), L(2), 0.3, 2); c.stroke();
    pth(c, [[x - L(4), y - L(21)], [x + L(4), y - L(21)], [x + L(4.5), y - L(7)], [x + L(3), y - L(5.5)], [x + L(1.5), y - L(7)], [x, y - L(5)], [x - L(1.5), y - L(7)], [x - L(3), y - L(5.5)], [x - L(4.5), y - L(7)]]); fs(c, W || h.col, L(0.9));
    rr(c, x - L(8.5), y - L(12), L(17), L(2.4), L(1)); fs(c, W || '#6b4423', L(0.8));
    rr(c, x - L(1.2), y - L(12.3), L(2.4), L(3), L(0.4)); fs(c, W || '#d9b24a', L(0.6));
    circ(c, x - L(10), y - L(10), L(3)); fs(c, W || '#8a9391', L(0.9));
    circ(c, x + L(10), y - L(10), L(3)); fs(c, W || '#8a9391', L(0.9));
    ell(c, x + L(0.5), y - L(21), L(4.5), L(3.2)); fs(c, W || h.skin, L(0.9));
    if (!W) { c.fillStyle = 'rgba(60,40,30,.55)'; for (const [dx, dy] of [[-2, -0.5], [-1, 0.8], [0, 0], [1.2, 0.9], [2.2, -0.3], [0.4, 1.6]]) { circ(c, x + L(dx + 0.5), y - L(21 - dy), L(0.3)); c.fill(); } }
    rr(c, x - L(6), y - L(35), L(12), L(13), L(2.5)); fs(c, W || lg(c, x - L(6), 0, x + L(6), 0, '#d6dbd9', '#6d7674'), L(1.1));
    c.strokeStyle = INK; c.lineWidth = L(0.6); c.beginPath(); c.moveTo(x + L(2), y - L(35)); c.lineTo(x + L(3), y - L(32)); c.lineTo(x + L(1.5), y - L(31)); c.stroke();
    rr(c, x - L(4.6), y - L(29.5), L(9.2), L(2.2), L(0.8)); c.fillStyle = W || INK; c.fill();
    if (!W) { circ(c, x - L(2.4), y - L(28.4), L(0.75)); c.fillStyle = '#f4ead2'; c.fill(); circ(c, x + L(2), y - L(28.4), L(0.45)); c.fill(); }
    for (const dx of [-4, -2, 0, 2, 4]) { circ(c, x + L(dx), y - L(25), L(0.35)); c.fillStyle = '#2a2a2a'; c.fill(); }
    c.beginPath(); c.moveTo(x - L(1), y - L(22.6)); c.bezierCurveTo(x - L(5), y - L(24), x - L(9), y - L(22), x - L(9.5), y - L(18.5)); c.bezierCurveTo(x - L(7), y - L(20.5), x - L(4), y - L(20.5), x, y - L(21.2));
    c.bezierCurveTo(x + L(4), y - L(20.5), x + L(7), y - L(20.5), x + L(9.5), y - L(18.5)); c.bezierCurveTo(x + L(9), y - L(22), x + L(5), y - L(24), x + L(1), y - L(22.6)); c.closePath(); fs(c, W || '#8a5528', L(0.9));
    c.beginPath(); c.moveTo(x - L(1), y - L(35)); c.bezierCurveTo(x + L(2), y - L(41), x + L(9), y - L(40), x + L(10), y - L(33)); c.bezierCurveTo(x + L(7), y - L(36), x + L(3), y - L(36), x + L(1), y - L(34.5)); c.closePath(); fs(c, W || h.col, L(0.8));
  } else if (i === 1) {
    rr(c, x - L(4), y - L(10), L(2.2), L(10), L(1)); fs(c, W || '#3b2c22', L(0.8));
    rr(c, x + L(1.5), y - L(10), L(2.2), L(10), L(1)); fs(c, W || '#3b2c22', L(0.8));
    ell(c, x - L(3.4), y - L(0.6), L(2.6), L(1.2)); fs(c, W || '#2a1d16', L(0.7));
    ell(c, x + L(3), y - L(0.6), L(2.6), L(1.2)); fs(c, W || '#2a1d16', L(0.7));
    pth(c, [[x - L(5), y - L(9)], [x - L(6.5), y - L(20)], [x - L(2), y - L(26)], [x + L(4), y - L(25)], [x + L(6), y - L(17)], [x + L(5), y - L(9)]]); fs(c, W || lg(c, 0, y - L(26), 0, y - L(9), h.col, h.dk), L(1));
    rr(c, x - L(4.2), y - L(16), L(3.4), L(3), L(0.4)); fs(c, W || '#8b6a3d', L(0.6));
    if (!W) { c.strokeStyle = INK; c.lineWidth = L(0.4); c.beginPath(); for (let k = 0; k < 3; k++) { c.moveTo(x - L(4.2) + L(k * 1.2 + 0.4), y - L(16.4)); c.lineTo(x - L(4.2) + L(k * 1.2 + 0.4), y - L(15.6)); } c.stroke(); }
    circ(c, x + L(8), y - L(14), L(3.2)); fs(c, W || '#d9b24a', L(0.9));
    circ(c, x + L(8), y - L(14), L(1.6)); c.fillStyle = INK; c.fill();
    circ(c, x + L(6), y - L(14), L(1.6)); fs(c, W || h.skin, L(0.7));
    c.beginPath(); c.moveTo(x - L(6.5), y - L(21)); c.bezierCurveTo(x - L(9), y - L(29), x - L(3), y - L(36), x + L(3), y - L(34)); c.bezierCurveTo(x + L(7), y - L(32), x + L(7), y - L(26), x + L(5), y - L(22)); c.closePath(); fs(c, W || h.dk, L(1));
    ell(c, x + L(1.5), y - L(27), L(4), L(4.6)); fs(c, W || h.skin, L(0.9));
    if (!W) {
      eye(c, x + L(0.2), y - L(29), L(1.2), 0.55, 1, s, '#b07c55'); eye(c, x + L(3.2), y - L(29.2), L(1.1), 0.55, 1, s, '#b07c55');
      brow(c, x - L(1.3), y - L(31), x + L(1.5), y - L(30.4), s); brow(c, x + L(2.2), y - L(30.6), x + L(4.4), y - L(31.4), s);
      c.fillStyle = 'rgba(60,40,30,.5)'; for (const [dx, dy] of [[0, -23], [1.5, -22.6], [3, -23.2], [-0.8, -24]]) { circ(c, x + L(dx), y + L(dy), L(0.28)); c.fill(); }
    }
    c.beginPath(); c.moveTo(x + L(1.8), y - L(28.5)); c.bezierCurveTo(x + L(6), y - L(29), x + L(9.5), y - L(26.5), x + L(7.5), y - L(24)); c.bezierCurveTo(x + L(6.5), y - L(25.5), x + L(4.5), y - L(25.6), x + L(2.6), y - L(25.4)); c.closePath(); fs(c, W || '#e0a27a', L(0.8));
    if (!W) { c.beginPath(); c.moveTo(x - L(0.5), y - L(24.4)); c.quadraticCurveTo(x + L(2), y - L(22.6), x + L(4.5), y - L(24.5)); c.lineWidth = L(0.7); c.strokeStyle = INK; c.stroke(); rr(c, x + L(2.4), y - L(24.1), L(1), L(1.1), L(0.2)); fs(c, '#ffd34d', L(0.4)); }
  } else {
    pth(c, [[x - L(7.5), y], [x - L(5.5), y - L(17)], [x - L(1), y - L(22)], [x + L(4), y - L(20)], [x + L(6), y - L(14)], [x + L(7.5), y], [x + L(5), y - L(1.5)], [x + L(2.5), y], [x, y - L(1.5)], [x - L(2.5), y], [x - L(5), y - L(1.5)]]);
    fs(c, W || lg(c, 0, y - L(22), 0, y, h.col, h.dk), L(1));
    rr(c, x + L(1), y - L(9), L(3.5), L(3.2), L(0.5)); fs(c, W || '#6b7a4a', L(0.6));
    circ(c, x + L(6), y - L(15), L(1.7)); fs(c, W || h.skin, L(0.7));
    ell(c, x - L(0.5), y - L(25.5), L(4.6), L(4.4)); fs(c, W || h.skin, L(0.9));
    if (!W) {
      c.strokeStyle = '#b8b2a6'; c.lineWidth = L(0.8); c.beginPath();
      for (const [ax, ay, bx, by] of [[-4.5, -26, -7, -24], [-4.8, -24.5, -7.5, -21.5], [3.5, -27, 5.8, -25], [-4, -28, -6.5, -28.5]]) { c.moveTo(x + L(ax), y + L(ay)); c.lineTo(x + L(bx), y + L(by)); }
      c.stroke();
      eye(c, x - L(2.2), y - L(27), L(1.7), 0, 0.4, s, '#c9a585'); eye(c, x + L(1.6), y - L(26.6), L(0.9), 0.7, 0.4, s, '#c9a585');
      brow(c, x - L(4), y - L(29.6), x - L(0.8), y - L(29.2), s, 1.1); brow(c, x + L(0.5), y - L(28.4), x + L(3), y - L(28.9), s, 1.1);
      c.strokeStyle = 'rgba(60,40,30,.5)'; c.lineWidth = L(0.4); c.beginPath(); c.arc(x - L(2.2), y - L(25.4), L(1.6), 0.3, 2.8); c.stroke();
    }
    ell(c, x + L(1.2), y - L(23.6), L(2), L(2.8)); fs(c, W || '#c99b7c', L(0.8));
    if (!W) { circ(c, x + L(2.4), y - L(23), L(0.55)); fs(c, '#8a6a4a', L(0.3)); }
    if (!W) {
      c.strokeStyle = '#4a2e1c'; c.lineWidth = L(0.9); c.beginPath(); c.moveTo(x + L(1), y - L(21.2)); c.lineTo(x + L(5.5), y - L(20.6)); c.stroke();
      rr(c, x + L(5), y - L(23), L(2.2), L(2.8), L(0.5)); fs(c, '#6b4423', L(0.6));
      const ph = (t * 0.6) % 1;
      for (let k = 0; k < 3; k++) { const q = (ph + k / 3) % 1; circ(c, x + L(6.2 + q * 3), y - L(24 + q * 9), L(0.8 + q * 1.4)); c.fillStyle = `rgba(200,195,185,${0.7 * (1 - q)})`; c.fill(); }
    }
    ell(c, x - L(0.5), y - L(29), L(9), L(2.2)); fs(c, W || '#3a2a33', L(1));
    c.beginPath(); c.moveTo(x - L(5), y - L(29.5)); c.bezierCurveTo(x - L(4), y - L(36), x - L(1), y - L(40), x + L(2), y - L(42)); c.bezierCurveTo(x + L(5), y - L(43), x + L(8), y - L(41), x + L(9), y - L(38));
    c.bezierCurveTo(x + L(6), y - L(39), x + L(4), y - L(38), x + L(3.5), y - L(36.5)); c.bezierCurveTo(x + L(3.5), y - L(34), x + L(4), y - L(31), x + L(4.5), y - L(29.5)); c.closePath(); fs(c, W || lg(c, 0, y - L(43), 0, y - L(29), '#55404d', '#2d2028'), L(1));
    rr(c, x - L(4.8), y - L(32), L(9.4), L(2), L(0.6)); fs(c, W || h.col, L(0.6));
    rr(c, x - L(2.5), y - L(37), L(2.6), L(2.4), L(0.3)); fs(c, W || '#6b7a4a', L(0.5));
  }
}

// ---------------------------------------------------------------- mobs

/** Caricature mob with feet at (x, y). */
export function drawMobFigure(c: Ctx, k: MobKind, x: number, y: number, flash: boolean) {
  const W = flash ? '#fff' : null;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (k === 'skel') {
    const B = W || '#e3d8bc';
    c.strokeStyle = INK; c.lineWidth = 2.6; c.beginPath(); c.moveTo(x - 2.5, y); c.lineTo(x - 1.5, y - 7); c.moveTo(x + 2.5, y); c.lineTo(x + 1.5, y - 7); c.stroke();
    c.strokeStyle = B; c.lineWidth = 1.2; c.stroke();
    ell(c, x, y - 8, 3.2, 1.6); fs(c, B, 0.8);
    c.strokeStyle = INK; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x - 0.5, y - 17); c.stroke(); c.strokeStyle = B; c.lineWidth = 1.1; c.stroke();
    for (const q of [0, 1, 2]) { c.beginPath(); c.ellipse(x - 0.3, y - 15.5 + q * 2.2, 3.6 - q * 0.4, 1.1, 0, Math.PI * 0.1, Math.PI * 0.9); c.strokeStyle = INK; c.lineWidth = 2; c.stroke(); c.strokeStyle = B; c.lineWidth = 0.9; c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x + 2, y - 16); c.lineTo(x + 6, y - 11); c.stroke(); c.strokeStyle = B; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.moveTo(x + 6, y - 11); c.lineTo(x + 8, y - 18); c.lineTo(x + 7, y - 22); c.lineTo(x + 9.5, y - 25); c.strokeStyle = INK; c.lineWidth = 2.4; c.stroke(); c.strokeStyle = W || '#a8743f'; c.lineWidth = 1.2; c.stroke();
    c.save(); c.translate(x - 0.5, y - 22); c.rotate(-0.15);
    c.save(); c.rotate(0.35); rr(c, -2.6, 2.4, 5.2, 3, 1.2); fs(c, B, 0.8); c.restore();
    ell(c, 0, 0, 5, 4.4); fs(c, B, 1);
    c.strokeStyle = INK; c.lineWidth = 0.6; c.beginPath(); c.moveTo(1, -4.3); c.lineTo(1.8, -2); c.lineTo(0.8, -1); c.stroke();
    ell(c, -2, 0.2, 1.6, 1.9); c.fillStyle = INK; c.fill(); circ(c, -1.8, 0.5, 0.5); c.fillStyle = '#ff5a3a'; c.fill();
    ell(c, 2, 0.4, 1.2, 1.5); c.fillStyle = INK; c.fill();
    c.fillStyle = INK; c.fillRect(-1.6, 3, 0.7, 1.4); c.fillRect(0.4, 3.2, 0.7, 1.2);
    c.beginPath(); c.arc(0.3, -2.4, 5.2, Math.PI * 1.05, Math.PI * 1.95); c.closePath(); fs(c, W || '#7d7f7a', 0.9); rr(c, -5.6, -3, 11.6, 1.4, 0.6); fs(c, W || '#5e605b', 0.7);
    c.restore();
  } else if (k === 'archer') {
    rr(c, x - 3, y - 4, 2, 4, 0.8); fs(c, W || '#4f6b2f', 0.7); rr(c, x + 1, y - 4, 2, 4, 0.8); fs(c, W || '#4f6b2f', 0.7);
    pth(c, [[x - 4.5, y - 3], [x - 3.5, y - 11], [x + 3.5, y - 11], [x + 4.5, y - 3], [x + 2.5, y - 4], [x, y - 2.5], [x - 2.5, y - 4]]); fs(c, W || '#7a5a36', 0.9);
    const hy = y - 15;
    pth(c, [[x - 4, hy - 1], [x - 13, hy - 5], [x - 4, hy + 2]]); fs(c, W || '#8fae4f', 0.9);
    pth(c, [[x + 4, hy - 1], [x + 13, hy - 6], [x + 4, hy + 2]]); fs(c, W || '#8fae4f', 0.9);
    ell(c, x, hy, 5, 4.6); fs(c, W || rg(c, x, hy, 5, '#b6d07a', '#6f8f3a'), 1);
    if (!W) {
      eye(c, x - 2, hy - 1.4, 1.2, 0.3, -0.6, 1, '#6f8f3a'); eye(c, x + 2, hy - 1.2, 0.9, 0.3, -0.6, 1, '#6f8f3a');
      c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - 3.8, hy - 3.6); c.lineTo(x, hy - 2.4); c.lineTo(x + 3.6, hy - 3.6); c.stroke();
      rr(c, x - 1.4, hy + 2.6, 1.3, 1.6, 0.2); fs(c, '#f4ead2', 0.5); rr(c, x + 0.2, hy + 2.6, 1.3, 1.6, 0.2); fs(c, '#f4ead2', 0.5);
    }
    c.beginPath(); c.moveTo(x + 0.5, hy - 1); c.bezierCurveTo(x - 3, hy + 1, x - 6, hy + 3, x - 5.5, hy + 4.5); c.bezierCurveTo(x - 3, hy + 4, x - 1, hy + 2.5, x + 1.2, hy + 1.6); c.closePath(); fs(c, W || '#9cb85a', 0.8);
    c.strokeStyle = INK; c.lineWidth = 2.6; c.beginPath(); c.arc(x + 6, y - 11, 10, -1.25, 1.25); c.stroke(); c.strokeStyle = W || '#8a5a2b'; c.lineWidth = 1.3; c.stroke();
    c.strokeStyle = '#d8d0bc'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(x + 9.2, y - 20.5); c.lineTo(x + 9.2, y - 1.5); c.stroke();
  } else if (k === 'slime') {
    c.beginPath(); c.moveTo(x - 11, y); c.bezierCurveTo(x - 12, y - 9, x - 6, y - 14, x, y - 13); c.bezierCurveTo(x + 7, y - 14, x + 12, y - 8, x + 11, y); c.closePath();
    c.fillStyle = W || 'rgba(140,180,80,.88)'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
    if (!W) {
      c.save(); c.globalAlpha *= 0.55; rr(c, x - 7, y - 6, 4, 4, 1); fs(c, '#4a3324', 0.6); rr(c, x - 7, y - 3, 6, 2, 0.8); fs(c, '#4a3324', 0.6);
      c.strokeStyle = '#efe6cf'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + 2, y - 3); c.lineTo(x + 7, y - 6); c.stroke(); c.restore();
      c.fillStyle = 'rgba(255,255,255,.35)'; ell(c, x - 5, y - 10, 2.2, 1); c.fill();
    }
    c.strokeStyle = INK; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x + 1, y - 12); c.quadraticCurveTo(x + 3, y - 16, x + 1.5, y - 19); c.stroke(); c.strokeStyle = W || '#8cb450'; c.lineWidth = 1; c.stroke();
    circ(c, x + 1.5, y - 21, 3.6); fs(c, W || '#f4ead2', 1);
    if (!W) {
      c.strokeStyle = '#d9434f'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(x - 1.5, y - 21.5); c.lineTo(x, y - 21); c.moveTo(x + 4.5, y - 20); c.lineTo(x + 3, y - 20.6); c.stroke();
      circ(c, x + 2.2, y - 20.6, 1.4); c.fillStyle = INK; c.fill();
    }
  } else {
    const king = k === 'king', z = king ? 1.2 : 1;
    rr(c, x - 8 * z, y - 5 * z, 5 * z, 5 * z, 1.5); fs(c, W || '#4e4a45', 0.9); rr(c, x + 3 * z, y - 5 * z, 5 * z, 5 * z, 1.5); fs(c, W || '#4e4a45', 0.9);
    if (king) {
      ell(c, x, y - 13 * z, 11 * z, 10 * z); fs(c, W || lg(c, 0, y - 23 * z, 0, y, '#7b3a6b', '#3f1c38'), 1.2);
      rr(c, x - 11 * z, y - 9 * z, 22 * z, 3 * z, 1.4); fs(c, W || '#e6e0d0', 0.8);
      const hy = y - 25 * z;
      ell(c, x, hy, 6.5 * z, 6 * z); fs(c, W || '#e2a888', 1.1);
      ell(c, x - 5 * z, hy + 3.5 * z, 3 * z, 2.6 * z); fs(c, W || '#d99878', 0.8); ell(c, x + 5 * z, hy + 3.5 * z, 3 * z, 2.6 * z); fs(c, W || '#d99878', 0.8);
      if (!W) { eye(c, x - 2.2 * z, hy - 1.5 * z, 1.1, 0.5, 0, 1, '#c98a6a'); eye(c, x + 2.2 * z, hy - 1.5 * z, 1.1, 0.5, 0, 1, '#c98a6a'); ell(c, x + 1, hy + 3.8 * z, 1.4, 1.8); fs(c, '#d9434f', 0.6); }
      ell(c, x, hy + 0.8 * z, 1.8 * z, 1.5 * z); fs(c, W || '#d08868', 0.7);
      pth(c, [[x - 3, hy - 5.5 * z], [x - 3.5, hy - 9 * z], [x - 1.5, hy - 7 * z], [x, hy - 10 * z], [x + 1.5, hy - 7 * z], [x + 3.5, hy - 9 * z], [x + 3, hy - 5.5 * z]]); fs(c, W || '#e6b54a', 0.8);
    } else {
      ell(c, x, y - 14, 12, 10.5); fs(c, W || lg(c, x - 12, 0, x + 12, 0, '#9a948a', '#575049'), 1.2);
      c.strokeStyle = INK; c.lineWidth = 0.7; c.beginPath(); c.moveTo(x - 4, y - 22); c.lineTo(x - 2, y - 17); c.lineTo(x - 4.5, y - 13); c.moveTo(x + 6, y - 9); c.lineTo(x + 3, y - 7); c.stroke();
      c.fillStyle = W || '#6f8f3a'; ell(c, x - 5, y - 23, 5, 1.8); c.fill();
      circ(c, x - 13, y - 9, 4.5); fs(c, W || '#7d776d', 1.1); circ(c, x + 13, y - 9, 4.5); fs(c, W || '#7d776d', 1.1);
      ell(c, x + 1, y - 26, 3.6, 3.2); fs(c, W || '#a8a296', 1);
      if (!W) { circ(c, x - 0.3, y - 26, 0.55); c.fillStyle = '#ffd34d'; c.fill(); circ(c, x + 2.3, y - 26, 0.55); c.fill(); brow(c, x - 1.8, y - 27.4, x + 0.2, y - 28.4, 1, 0.8); brow(c, x + 1.8, y - 28.4, x + 3.8, y - 27.4, 1, 0.8); }
    }
  }
}

/** Head-room above the feet for HP bars and intent badges. */
export const MOB_TOP: Record<MobKind, number> = { skel: 33, archer: 27, slime: 30, golem: 37, king: 52 };
