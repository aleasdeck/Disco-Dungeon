// node art/ui/draw_arts.mjs — draws stand-in pictures for the boss trophies until the FLUX ones are made: an icon per
// trophy as a die-cut cardboard sticker (flat print, black ink, beige rim, like the other UI icons) to
// public/assets/ui/art_<key>.webp, the boss hoard scenes to public/assets/events/loot_king|loot_lich.webp, and a contact
// sheet to art/ui/contact_arts.png. Needs Playwright's Chromium (the npm package `playwright`).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const need = createRequire(import.meta.url);
const { chromium } = (() => { try { return need('playwright'); } catch { return need('/opt/node-tools/node_modules/playwright'); } })();
const root = new URL('../../', import.meta.url).pathname;

const O = '#2b211c';
const C = {
  red: '#c0473b', redD: '#93342b', redL: '#e27a6c', gold: '#dcaa3a', goldD: '#b5832a', goldL: '#f2d273',
  pink: '#e78f9c', pinkL: '#f4b8c1', pinkD: '#c96f7d', skin: '#e9bb91', skinD: '#cf9a70',
  blue: '#5f89a8', blueL: '#93b8d1', blueD: '#466d8a', teal: '#4e9b8f', tealL: '#7cc0b3', tealD: '#3b7d73',
  green: '#7ea24c', greenL: '#a9c76f', brown: '#8b5a36', brownL: '#b27c4b', brownD: '#6a4227',
  gray: '#8e9297', grayL: '#c3c6ca', grayD: '#5d6166', white: '#f5f0e5', cream: '#efe3c6', yellow: '#f1c84c',
  orange: '#e08a3a', black: '#34302d',
};
/** ink of the given width */
const st = (w = 6) => `stroke="${O}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
/** a line inked twice: black under, colour on top */
const ink = (d, col, w = 6, ow = 6) => `<path d="${d}" fill="none" ${st(w + ow)}/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
const star = (x, y, r) => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="#fff6cf" ${st(4)}/>`;
const heart = (x, y, s, col = C.red) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -3 C-2 -9 -11 -9 -11 -2 C-11 5 -3 9 0 13 C3 9 11 5 11 -2 C11 -9 2 -9 0 -3Z" fill="${col}" stroke="${O}" stroke-width="${3 / s}" stroke-linejoin="round"/>`;
const lips = (x, y, a, s = 1) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">
  <path d="M-26 0 Q-16 -16 -4 -9 Q0 -12 4 -9 Q16 -16 26 0 Q14 5 0 3 Q-14 5 -26 0Z" fill="${C.red}"/>
  <path d="M-25 3 Q-12 8 0 6 Q12 8 25 3 Q14 22 0 22 Q-14 22 -25 3Z" fill="${C.red}"/>
  <path d="M-21 3 Q0 8 21 3" stroke="${C.redD}" stroke-width="3" fill="none" stroke-linecap="round"/></g>`;
/** a point on a quadratic curve */
const q = (a, b, c, t) => [(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * b[1] + t * t * c[1]];
const f1 = n => n.toFixed(1);

const ICONS = {
  xray() {
    const spiral = (cx, cy) => {
      let d = '';
      for (let t = 0; t <= 6 * Math.PI; t += 0.12) { const r = 3 + t * 1.75; d += `${d ? 'L' : 'M'}${f1(cx + r * Math.cos(t))} ${f1(cy + r * Math.sin(t))}`; }
      return `<path d="${d}" fill="none" ${st(5)}/>`;
    };
    return `${ink('M30 116 L8 90', C.red, 7)}${ink('M226 116 L248 90', C.red, 7)}
      ${ink('M112 118 Q128 98 144 118', C.red, 9)}
      <circle cx="76" cy="132" r="54" fill="${C.red}" ${st()}/><circle cx="180" cy="132" r="54" fill="${C.red}" ${st()}/>
      <path d="M36 112 A44 44 0 0 1 66 88" stroke="${C.redL}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M140 112 A44 44 0 0 1 170 88" stroke="${C.redL}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="76" cy="132" r="40" fill="${C.white}" ${st()}/><circle cx="180" cy="132" r="40" fill="${C.white}" ${st()}/>
      ${spiral(76, 132)}${spiral(180, 132)}
      <circle cx="76" cy="132" r="7" fill="${O}"/><circle cx="180" cy="132" r="7" fill="${O}"/>`;
  },
  polish: () => `
    <rect x="102" y="20" width="52" height="38" rx="8" fill="${C.red}" ${st()}/>
    <path d="M112 30 L112 48" stroke="${C.redL}" stroke-width="6" stroke-linecap="round"/>
    <rect x="112" y="56" width="32" height="24" fill="${C.gold}" ${st()}/>
    <path d="M86 96 Q86 80 112 80 L144 80 Q170 80 170 96 L178 210 Q178 236 152 236 L104 236 Q78 236 78 210 Z" fill="${C.gold}" ${st()}/>
    <path d="M154 96 Q160 100 160 112 L165 208 Q165 222 154 224" fill="none" stroke="${C.goldD}" stroke-width="10" stroke-linecap="round"/>
    <path d="M97 104 L93 200" stroke="${C.goldL}" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="128" cy="160" rx="38" ry="44" fill="${C.cream}" ${st(5)}/>
    <circle cx="106" cy="170" r="6" fill="${C.skin}" ${st(4)}/><circle cx="150" cy="170" r="6" fill="${C.skin}" ${st(4)}/>
    <circle cx="128" cy="166" r="22" fill="${C.skin}" ${st(5)}/>
    <path d="M108 162 q-7 -3 -6 -10 M148 162 q7 -3 6 -10" fill="none" ${st(4)}/>
    <path d="M117 172 q4 3 8 0 M131 172 q4 3 8 0" fill="none" ${st(3.5)}/>
    <path d="M122 180 q6 4 12 0" fill="none" ${st(3.5)}/>
    <ellipse cx="121" cy="153" rx="8" ry="4" fill="#fff" transform="rotate(-25 121 153)"/>
    ${star(200, 70, 20)}${star(52, 120, 12)}`,
  tray: () => `
    <ellipse cx="128" cy="170" rx="114" ry="58" fill="${C.grayD}" ${st()}/>
    <ellipse cx="128" cy="160" rx="114" ry="56" fill="${C.grayL}" ${st()}/>
    <ellipse cx="128" cy="160" rx="96" ry="44" fill="#d9dcdf" stroke="${C.gray}" stroke-width="4"/>
    <path d="M52 146 Q84 122 136 118" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.85"/>
    ${lips(80, 168, -14)}
    <ellipse cx="164" cy="172" rx="24" ry="8" fill="#dfeef1" ${st(5)}/>
    <path d="M164 170 L164 116" ${st(7)}/>
    <path d="M120 54 L208 54 L164 118 Z" fill="#d7ecef" ${st(5)}/>
    <path d="M129 64 L199 64 L164 112 Z" fill="${C.pink}"/>
    <path d="M190 30 L156 86" ${st(4)}/><circle cx="158" cy="82" r="10" fill="${C.green}" ${st(4)}/>
    <path d="M134 62 L148 82" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`,
  lube: () => `<g transform="rotate(26 128 128)">
    <path d="M84 30 L172 30 L172 46 L158 62 L150 186 L106 186 L98 62 L84 46 Z" fill="${C.teal}" ${st()}/>
    <rect x="80" y="20" width="96" height="24" rx="4" fill="${C.tealL}" ${st()}/>
    <path d="M94 26 v12 M106 26 v12 M118 26 v12 M130 26 v12 M142 26 v12 M154 26 v12 M166 26 v12" stroke="${C.tealD}" stroke-width="3"/>
    <path d="M150 72 L145 178" stroke="${C.tealD}" stroke-width="10" stroke-linecap="round"/>
    <path d="M109 72 L113 176" stroke="${C.tealL}" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="128" cy="118" rx="28" ry="32" fill="${C.cream}" ${st(4)}/>
    <path d="M128 126 Q118 114 110 120 Q104 126 100 120 Q102 134 114 132 Q122 130 128 126 Q134 130 142 132 Q154 134 156 120 Q152 126 146 120 Q138 114 128 126Z" fill="${C.brownD}" ${st(3)}/>
    <circle cx="118" cy="104" r="4.5" fill="${O}"/><path d="M132 105 q5 -5 10 0" fill="none" ${st(3.5)}/>
    <path d="M108 186 L148 186 L144 216 L112 216 Z" fill="${C.white}" ${st()}/>
    <path d="M115 197 h26 M115 206 h26" stroke="${C.grayL}" stroke-width="3"/>
    <path d="M128 226 Q116 242 128 250 Q140 242 128 226Z" fill="${C.blueL}" ${st(4)}/></g>`,
  bells() {
    const bell = (x, y, r) => `
      <circle cx="${x}" cy="${y - r - 6}" r="9" fill="none" ${st(11)}/><circle cx="${x}" cy="${y - r - 6}" r="9" fill="none" stroke="${C.goldD}" stroke-width="4"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${C.gold}" ${st()}/>
      <path d="M${x + r * 0.86} ${y + r * 0.1} A${r * 0.88} ${r * 0.88} 0 0 1 ${x + r * 0.05} ${y + r * 0.86}" stroke="${C.goldD}" stroke-width="9" fill="none" stroke-linecap="round"/>
      <path d="M${x - r * 0.75} ${y + r * 0.22} Q${x} ${y + r * 0.5} ${x + r * 0.75} ${y + r * 0.22}" fill="none" ${st(8)}/>
      <circle cx="${x - r * 0.75}" cy="${y + r * 0.22}" r="6" fill="${O}"/><circle cx="${x + r * 0.75}" cy="${y + r * 0.22}" r="6" fill="${O}"/>
      <path d="M${x - r * 0.58} ${y - r * 0.3} A${r * 0.62} ${r * 0.62} 0 0 1 ${x - r * 0.1} ${y - r * 0.68}" stroke="${C.goldL}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    return `${ink('M128 70 Q96 82 86 104', C.red, 6)}${ink('M128 70 Q164 78 176 100', C.red, 6)}
      ${bell(86, 162, 48)}${bell(178, 152, 44)}
      <path d="M128 66 Q96 28 86 56 Q84 80 128 66Z" fill="${C.red}" ${st(5)}/>
      <path d="M128 66 Q160 28 170 56 Q172 80 128 66Z" fill="${C.red}" ${st(5)}/>
      <circle cx="128" cy="66" r="10" fill="${C.redD}" ${st(5)}/>`;
  },
  glasseye() {
    let rays = '';
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; rays += `M${f1(140 + 22 * Math.cos(a))} ${f1(122 + 22 * Math.sin(a))}L${f1(140 + 35 * Math.cos(a))} ${f1(122 + 35 * Math.sin(a))}`; }
    return `<defs><clipPath id="eye"><circle cx="128" cy="128" r="92"/></clipPath></defs>
      <circle cx="128" cy="128" r="92" fill="#dcd4c4"/>
      <circle cx="116" cy="116" r="90" fill="${C.white}" clip-path="url(#eye)"/>
      <g clip-path="url(#eye)" stroke="${C.red}" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M36 122 Q58 116 64 128 Q70 136 84 132"/><path d="M56 54 Q72 70 70 84 Q84 88 88 100"/>
        <path d="M206 204 Q190 190 176 194 Q168 180 160 178"/><path d="M222 136 Q202 140 196 128"/><path d="M118 222 Q124 204 116 194"/>
        <path d="M200 60 Q186 72 190 86"/></g>
      <circle cx="140" cy="122" r="40" fill="${C.blue}" ${st(5)}/>
      <path d="${rays}" stroke="${C.blueD}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="140" cy="122" r="18" fill="${O}"/>
      <circle cx="128" cy="108" r="9" fill="#fff"/><circle cx="154" cy="138" r="4" fill="#fff"/>
      <path d="M62 92 A72 72 0 0 1 102 54" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/>
      <circle cx="128" cy="128" r="92" fill="none" ${st()}/>`;
  },
  chalk: () => `
    <path d="M128 64 L198 102 L198 184 L128 224 L58 184 L58 102 Z" fill="${C.blue}" ${st()}/>
    <path d="M128 140 L198 102 L198 184 L128 224 Z" fill="${C.blueD}" ${st()}/>
    <path d="M128 64 L198 102 L128 140 L58 102 Z" fill="${C.blueL}" ${st()}/>
    <ellipse cx="128" cy="102" rx="34" ry="17" fill="${C.blue}" ${st(4)}/>
    <ellipse cx="124" cy="106" rx="22" ry="9" fill="${C.blueD}" opacity="0.6"/>
    <path d="M70 122 L70 172 M84 132 L84 160" stroke="#7fa6c3" stroke-width="4" stroke-linecap="round"/>
    <circle cx="44" cy="64" r="11" fill="#d6e6f2" ${st(4)}/><circle cx="62" cy="40" r="7" fill="#d6e6f2" ${st(4)}/>
    <circle cx="214" cy="62" r="9" fill="#d6e6f2" ${st(4)}/><circle cx="224" cy="200" r="12" fill="#d6e6f2" ${st(4)}/>
    <circle cx="36" cy="200" r="8" fill="#d6e6f2" ${st(4)}/>`,
  spring() {
    const turns = 5, cx = 128, rx = 60, ry = 15, y0 = 50, y1 = 206, T = 2 * Math.PI * turns, segs = { back: [], front: [] };
    let cur = null, side = null;
    for (let t = 0; t <= T + 1e-6; t += 0.06) {
      const s = Math.sin(t) >= 0 ? 'front' : 'back', p = `${f1(cx + rx * Math.cos(t))} ${f1(y0 + (y1 - y0) * t / T + ry * Math.sin(t))}`;
      if (s !== side) { if (cur) { cur += `L${p}`; segs[side].push(cur); } cur = `M${p}`; side = s; } else cur += `L${p}`;
    }
    segs[side].push(cur);
    const draw = (ds, col) => ds.map(d => ink(d, col, 9, 7)).join('');
    return `${draw(segs.back, C.grayD)}${draw(segs.front, C.grayL)}
      ${ink(`M${cx + rx} ${y0} L${cx + rx + 4} ${y0 - 24}`, C.grayL, 9, 7)}${ink(`M${cx + rx} ${y1} L${cx + rx + 4} ${y1 + 24}`, C.grayL, 9, 7)}
      <path d="M34 104 q-14 12 0 24 M20 94 q-22 22 0 44 M222 104 q14 12 0 24 M236 94 q22 22 0 44" fill="none" ${st(5)}/>`;
  },
  insoles() {
    const sole = 'M0 -92 C28 -92 42 -66 40 -36 C38 -6 28 16 28 46 C28 78 18 94 0 94 C-18 94 -30 78 -30 48 C-30 18 -42 -8 -42 -40 C-42 -70 -28 -92 0 -92Z';
    const one = (x, y, a, fl) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${fl} 1)">
      <path d="${sole}" fill="${C.gray}" ${st()}/>
      <path d="M-32 -40 C-32 -64 -20 -80 -2 -82" fill="none" stroke="${C.grayL}" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="-14" cy="-60" rx="10" ry="13" fill="${C.grayD}"/><ellipse cx="12" cy="-64" rx="8" ry="11" fill="${C.grayD}"/>
      <ellipse cx="0" cy="60" rx="17" ry="21" fill="${C.grayD}"/>
      <circle cx="-18" cy="6" r="4.5" fill="${C.grayL}" ${st(2.5)}/><circle cx="14" cy="10" r="4.5" fill="${C.grayL}" ${st(2.5)}/></g>`;
    const stink = x => ink(`M${x} 52 q-12 -10 0 -22 q12 -12 0 -24`, C.green, 5, 6);
    return `${one(86, 146, -12, 1)}${one(172, 142, 12, -1)}${stink(96)}${stink(128)}${stink(160)}`;
  },
  opener: () => `
    <path d="M30 150 L30 218 Q30 236 80 236 Q130 236 130 218 L130 150" fill="${C.grayL}" ${st()}/>
    <path d="M30 170 L30 208 Q80 222 130 208 L130 170 Q80 184 30 170Z" fill="${C.red}" ${st(4)}/>
    <path d="M62 196 Q80 182 98 196 Q80 208 62 196Z M98 196 L108 188 L108 204Z" fill="${C.cream}" ${st(3)}/>
    <ellipse cx="80" cy="150" rx="50" ry="15" fill="#d9dcdf" ${st()}/>
    <path d="M52 146 L58 122 L64 132 L72 112 L78 126 L88 108 L94 124 L104 114 L108 144 Q80 154 52 146Z" fill="${C.grayL}" ${st(5)}/>
    <g transform="translate(166 108) rotate(-38)">
      <rect x="-96" y="-16" width="100" height="32" rx="15" fill="${C.brown}" ${st()}/>
      <path d="M-84 -5 Q-60 -9 -40 -3 M-80 6 Q-50 2 -20 8" stroke="${C.brownD}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M-88 -9 L-30 -10" stroke="${C.brownL}" stroke-width="4" stroke-linecap="round"/>
      <path d="M2 -11 L60 -11 Q78 -11 86 -32 L98 -28 Q94 -6 78 4 L86 11 L70 17 L56 10 L2 12 Z" fill="${C.grayL}" ${st()}/>
      <path d="M10 -5 L58 -5" stroke="#eef0f2" stroke-width="4" stroke-linecap="round"/>
      <circle cx="-10" cy="0" r="5" fill="${C.grayL}" ${st(3)}/></g>`,
  mirrorball() {
    const cx = 128, cy = 152, R = 78, rows = 9, cols = 10, L = [-0.45, -0.6, 0.66];
    let tiles = '', seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < rows; i++) {
      const pa = -Math.PI / 2 + Math.PI * i / rows, pb = -Math.PI / 2 + Math.PI * (i + 1) / rows, pm = (pa + pb) / 2;
      for (let j = 0; j < cols; j++) {
        const ta = -Math.PI / 2 + Math.PI * j / cols, tb = -Math.PI / 2 + Math.PI * (j + 1) / cols, tm = (ta + tb) / 2;
        const P = (p, t) => `${f1(cx + R * Math.cos(p) * Math.sin(t))} ${f1(cy + R * Math.sin(p))}`;
        const n = [Math.cos(pm) * Math.sin(tm), Math.sin(pm), Math.cos(pm) * Math.cos(tm)];
        const lit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), r = rnd();
        const col = r > 0.93 ? '#ffffff' : r > 0.86 ? '#f4c6cf' : r > 0.8 ? '#c5e2ee' : `hsl(210 8% ${Math.round(38 + lit * 52 + r * 8)}%)`;
        tiles += `<path d="M${P(pa, ta)}L${P(pa, tb)}L${P(pb, tb)}L${P(pb, ta)}Z" fill="${col}" stroke="${C.grayD}" stroke-width="1.6"/>`;
      }
    }
    return `<circle cx="128" cy="22" r="14" fill="none" ${st(10)}/><circle cx="128" cy="22" r="14" fill="none" stroke="${C.grayL}" stroke-width="4"/>
      ${[38, 52].map(y => `<ellipse cx="128" cy="${y}" rx="5" ry="8" fill="none" ${st(8)}/><ellipse cx="128" cy="${y}" rx="5" ry="8" fill="none" stroke="${C.grayL}" stroke-width="3"/>`).join('')}
      <rect x="118" y="62" width="20" height="16" rx="3" fill="${C.grayL}" ${st(5)}/>
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="${C.grayD}"/>${tiles}
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" ${st()}/>
      ${star(46, 96, 17)}${star(214, 118, 13)}${star(206, 222, 15)}${star(40, 214, 10)}`;
  },
  undies: () => `
    <path d="M42 72 Q128 62 214 72 Q226 130 228 186 Q196 208 152 196 Q140 162 128 144 Q116 162 104 196 Q60 208 28 186 Q30 130 42 72Z" fill="${C.pink}" ${st()}/>
    <path d="M54 110 Q49 150 46 176" stroke="${C.pinkL}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M202 110 Q207 150 210 176" stroke="${C.pinkD}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M128 98 L128 144" fill="none" ${st(4)}/>
    <path d="M40 72 Q128 62 216 72 L214 98 Q128 88 42 98Z" fill="${C.pinkL}" ${st(5)}/>
    ${heart(68, 130, 1.1)}${heart(92, 172, 0.9)}${heart(186, 128, 1.1)}${heart(198, 172, 0.9)}${heart(62, 172, 0.7)}
    <circle cx="128" cy="126" r="21" fill="${C.yellow}" ${st(5)}/>
    <path d="M146 126 Q166 122 164 132 Q156 138 144 134Z" fill="${C.orange}" ${st(4)}/>
    <circle cx="134" cy="120" r="4" fill="${O}"/><path d="M124 106 q2 -9 8 -8" fill="none" ${st(4)}/>
    <rect x="186" y="58" width="16" height="18" rx="3" fill="${C.white}" ${st(4)}/><rect x="183" y="48" width="22" height="12" rx="4" fill="${C.red}" ${st(4)}/>`,
  cup: () => `
    ${ink('M64 88 Q40 70 12 74', '#7d8288', 10, 7)}${ink('M192 88 Q216 70 244 74', '#7d8288', 10, 7)}
    <path d="M58 84 Q128 58 198 84 Q210 146 162 204 Q128 232 94 204 Q46 146 58 84Z" fill="${C.white}" ${st()}/>
    <path d="M186 102 Q188 150 154 194" stroke="#d9d2c4" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M58 84 Q128 58 198 84 Q210 146 162 204 Q128 232 94 204 Q46 146 58 84Z" fill="none" stroke="${C.blue}" stroke-width="8" transform="translate(128 142) scale(0.84) translate(-128 -142)"/>
    <path d="M78 102 Q76 132 92 160" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/>
    ${[[106, 112], [128, 108], [150, 112], [108, 132], [128, 128], [148, 132], [116, 152], [140, 152], [128, 172]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="${O}"/>`).join('')}
    <path d="M58 84 Q128 58 198 84 Q210 146 162 204 Q128 232 94 204 Q46 146 58 84Z" fill="none" ${st()}/>`,
  hedgehog() {
    let pts = [];
    for (let k = 0; k <= 26; k++) {
      const a = Math.PI + Math.PI * k / 26, r = k % 2 ? 0.8 : 1;
      pts.push(`${f1(124 + 94 * r * Math.cos(a))} ${f1(160 + 100 * r * Math.sin(a))}`);
    }
    let quills = '';
    for (let k = 1; k < 26; k += 2) { const a = Math.PI + Math.PI * k / 26; quills += `M${f1(124 + 50 * Math.cos(a))} ${f1(160 + 54 * Math.sin(a))}L${f1(124 + 72 * Math.cos(a))} ${f1(160 + 78 * Math.sin(a))}`; }
    return `<path d="M${pts.join('L')}Z" fill="${C.brownD}" ${st(5)}/>
      <path d="${quills}" stroke="${C.brownL}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="150" cy="104" r="10" fill="${C.cream}" ${st(4)}/>
      <path d="M150 104 Q206 108 228 140 Q208 168 160 166 Q130 160 130 134 Q134 108 150 104Z" fill="${C.cream}" ${st(5)}/>
      <circle cx="228" cy="140" r="9" fill="${O}"/>
      <circle cx="178" cy="126" r="7" fill="${O}"/><circle cx="180" cy="123" r="2.5" fill="#fff"/>
      <ellipse cx="190" cy="150" rx="9" ry="5" fill="${C.pink}"/>
      <path d="M14 158 L242 158 L236 238 Q128 250 20 238Z" fill="${C.blue}" ${st()}/>
      <path d="M14 158 L242 158 L241 184 L15 184Z" fill="${C.blueD}" ${st(5)}/>
      <path d="M22 192 L234 192" stroke="${C.blueL}" stroke-width="3" stroke-dasharray="8 6"/>
      <path d="M128 184 L128 240" fill="none" ${st(4)}/>
      <rect x="52" y="150" width="15" height="42" rx="3" fill="${C.blue}" ${st(4)}/><rect x="190" y="150" width="15" height="42" rx="3" fill="${C.blue}" ${st(4)}/>
      <circle cx="128" cy="171" r="10" fill="${C.gold}" ${st(4)}/>
      <ellipse cx="98" cy="158" rx="13" ry="10" fill="${C.cream}" ${st(4)}/><ellipse cx="164" cy="160" rx="13" ry="10" fill="${C.cream}" ${st(4)}/>`;
  },
  fangs() {
    const a = [34, 132], b = [128, 92], c = [222, 132];
    let teeth = '';
    for (let k = 0; k < 10; k++) {
      const t = 0.07 + 0.86 * k / 9, [x, y] = q(a, b, c, t), w = 9 * (1 - Math.abs(t - 0.5) * 0.5), fang = k === 2 || k === 7;
      teeth += fang
        ? `<path d="M${f1(x - w)} ${f1(y - 8)} L${f1(x - w)} ${f1(y + 14)} Q${f1(x - w + 2)} ${f1(y + 30)} ${f1(x)} ${f1(y + 50)} Q${f1(x + w - 2)} ${f1(y + 30)} ${f1(x + w)} ${f1(y + 14)} L${f1(x + w)} ${f1(y - 8)}Z" fill="${C.white}" ${st(5)}/>`
        : `<path d="M${f1(x - w)} ${f1(y - 8)} L${f1(x - w)} ${f1(y + 16)} Q${f1(x)} ${f1(y + 26)} ${f1(x + w)} ${f1(y + 16)} L${f1(x + w)} ${f1(y - 8)}Z" fill="${C.white}" ${st(5)}/>`;
    }
    return `${teeth}
      <path d="M26 98 Q128 36 230 98 Q236 122 222 134 Q128 94 34 134 Q20 122 26 98Z" fill="${C.red}" ${st()}/>
      <path d="M60 90 Q128 56 196 90" stroke="${C.redL}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M228 108 Q240 128 236 150" fill="none" ${st(3)}/>
      <g transform="rotate(14 236 176)"><path d="M218 150 L254 150 L254 202 L218 202 L210 176Z" fill="${C.yellow}" ${st(4)}/>
        <circle cx="222" cy="176" r="4" fill="${O}"/>
        <circle cx="234" cy="166" r="5" fill="none" ${st(3)}/><circle cx="246" cy="188" r="5" fill="none" ${st(3)}/><path d="M248 162 L232 192" ${st(3)}/></g>`;
  },
  belly: () => `<defs><clipPath id="bl"><circle cx="118" cy="140" r="96"/></clipPath></defs>
    <circle cx="118" cy="140" r="96" fill="${C.skinD}"/>
    <g clip-path="url(#bl)"><circle cx="104" cy="126" r="96" fill="${C.skin}"/>
      <path d="M10 20 L226 20 L226 98 Q118 124 10 98Z" fill="${C.white}"/>
      <path d="M180 30 L200 100" stroke="#ddd5c4" stroke-width="16"/>
      <ellipse cx="82" cy="70" rx="13" ry="8" fill="#e2c98c"/><ellipse cx="140" cy="56" rx="7" ry="5" fill="#e2c98c"/></g>
    <path d="M28 100 Q118 124 208 100" fill="none" ${st(5)}/>
    <path d="M60 120 Q78 110 100 112" stroke="#f3d0ac" stroke-width="8" fill="none" stroke-linecap="round"/>
    <ellipse cx="118" cy="160" rx="7" ry="5" fill="${C.brownD}"/><path d="M110 156 Q118 168 126 156" fill="none" ${st(4)}/>
    <path d="M112 186 q5 -5 0 -10 M124 192 q5 -5 0 -10 M118 178 q-5 -4 0 -8" fill="none" ${st(3)}/>
    <path d="M34 200 Q118 228 202 200 L194 220 Q118 246 42 220Z" fill="${C.brownD}" ${st(5)}/>
    <rect x="102" y="204" width="32" height="24" rx="4" fill="${C.gold}" ${st(4)}/><rect x="110" y="211" width="16" height="10" fill="${C.brownD}"/>
    <circle cx="118" cy="140" r="96" fill="none" ${st()}/>
    ${ink('M222 150 Q250 150 250 176 Q250 204 222 202', '#e9e2cf', 8, 10)}
    <path d="M168 126 L226 126 L222 222 Q222 232 210 232 L184 232 Q172 232 172 222 Z" fill="#e7a83a" ${st()}/>
    <path d="M178 140 L181 220" stroke="#f5cf72" stroke-width="7" stroke-linecap="round"/>
    <path d="M164 128 Q160 106 180 108 Q186 92 204 100 Q222 94 228 112 Q238 124 226 132 Q196 138 164 128Z" fill="${C.white}" ${st(5)}/>`,
  sock: () => {
    const S = 'M86 26 L166 26 L164 138 Q164 158 184 168 L216 182 Q242 196 232 222 Q222 244 190 238 L110 218 Q74 208 80 170 Z';
    let stripes = '';
    for (let y = 44, k = 0; y < 250; y += 22, k++) stripes += `<rect x="0" y="${y}" width="256" height="22" fill="${k % 2 ? C.white : C.red}"/>`;
    return `<defs><clipPath id="sk"><path d="${S}"/></clipPath></defs>
      <g clip-path="url(#sk)">${stripes}<path d="M150 40 L150 150 Q154 172 200 192" stroke="#000" stroke-opacity="0.12" stroke-width="18" fill="none"/></g>
      <path d="${S}" fill="none" ${st()}/>
      <rect x="80" y="18" width="92" height="28" rx="6" fill="${C.cream}" ${st(5)}/>
      <path d="M94 24 v16 M108 24 v16 M122 24 v16 M136 24 v16 M150 24 v16 M164 24 v16" stroke="#d6c6a2" stroke-width="3"/>
      <ellipse cx="216" cy="214" rx="13" ry="10" fill="${C.skin}" ${st(4)}/>
      <g transform="translate(120 102)">${[[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="${C.green}" ${st(4)}/>`).join('')}
        <path d="M6 14 Q14 30 8 40" fill="none" ${st(5)}/><circle cx="0" cy="0" r="5" fill="${C.greenL}"/></g>
      ${ink('M202 152 q-10 -10 0 -20 q10 -10 0 -20', C.green, 5, 6)}${ink('M232 164 q-10 -10 0 -20 q10 -10 0 -20', C.green, 5, 6)}`;
  },
  tea() {
    let petals = '';
    for (let k = 0; k < 11; k++) petals += `<ellipse cx="104" cy="150" rx="7" ry="15" transform="rotate(${k * 360 / 11} 104 170)" fill="${C.white}" ${st(3)}/>`;
    return `${ink('M100 66 q-12 -12 0 -24 q12 -12 0 -24', '#ece6da', 5, 6)}${ink('M132 62 q-12 -12 0 -24 q12 -12 0 -24', '#ece6da', 5, 6)}
      ${ink('M178 120 Q226 118 224 156 Q222 194 176 192', C.cream, 14, 12)}
      <path d="M56 92 L184 92 L178 206 Q176 228 152 228 L88 228 Q64 228 62 206 Z" fill="${C.cream}" ${st()}/>
      <path d="M168 104 L163 208" stroke="#d9cba8" stroke-width="12" stroke-linecap="round"/>
      <path d="M57 112 L183 112 L182 128 L58 128Z" fill="${C.blue}" ${st(4)}/>
      <ellipse cx="120" cy="92" rx="64" ry="14" fill="${C.cream}" ${st()}/>
      <ellipse cx="120" cy="94" rx="53" ry="8" fill="#c98a3c"/>
      ${petals}<circle cx="104" cy="170" r="12" fill="${C.yellow}" ${st(4)}/>
      <path d="M160 94 Q172 122 166 150" fill="none" ${st(3)}/>
      <rect x="154" y="148" width="24" height="28" rx="2" fill="${C.yellow}" ${st(4)}/><circle cx="166" cy="158" r="5" fill="${C.green}"/>`;
  },
  denture() {
    const row = (a, b, c, dir, n) => {
      let s = '';
      for (let k = 0; k < n; k++) {
        const t = 0.06 + 0.88 * k / (n - 1), [x, y] = q(a, b, c, t), w = 11 * (1 - Math.abs(t - 0.5) * 0.7), h = 30 * dir;
        s += `<path d="M${f1(x - w)} ${f1(y - 8 * dir)} L${f1(x - w)} ${f1(y + h * 0.7)} Q${f1(x)} ${f1(y + h * 1.05)} ${f1(x + w)} ${f1(y + h * 0.7)} L${f1(x + w)} ${f1(y - 8 * dir)}Z" fill="${C.gold}" ${st(4)}/>`
          + `<path d="M${f1(x - w * 0.45)} ${f1(y + 2 * dir)} L${f1(x - w * 0.45)} ${f1(y + h * 0.6)}" stroke="${C.goldL}" stroke-width="3.5" stroke-linecap="round"/>`;
      }
      return s;
    };
    return `<path d="M44 120 Q128 160 212 120 L212 170 Q128 206 44 170Z" fill="#5a2b28" ${st()}/>
      ${row([28, 96], [128, 140], [228, 96], 1, 9)}${row([40, 186], [128, 216], [216, 186], -1, 8)}
      <path d="M22 66 Q128 36 234 66 L230 98 Q128 140 26 98Z" fill="${C.pink}" ${st()}/>
      <path d="M50 70 Q128 50 206 70" stroke="${C.pinkL}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M32 188 Q128 230 224 188 L226 214 Q128 254 30 214Z" fill="${C.pink}" ${st()}/>
      ${star(222, 40, 16)}${star(36, 142, 11)}`;
  },
  battery: () => `
    ${ink('M70 34 L58 22 L72 22 L60 6', C.yellow, 5, 6)}${ink('M186 34 L198 22 L184 22 L196 6', C.yellow, 5, 6)}${ink('M128 30 L120 18 L134 16 L126 2', C.yellow, 5, 6)}
    <rect x="94" y="44" width="18" height="24" fill="${C.grayL}" ${st(4)}/><circle cx="103" cy="46" r="12" fill="${C.grayL}" ${st(5)}/>
    <path d="M140 48 L148 36 L164 36 L172 48 L164 60 L148 60Z" fill="${C.grayL}" ${st(5)}/><rect x="148" y="56" width="16" height="12" fill="${C.grayL}" ${st(4)}/>
    <rect x="66" y="64" width="124" height="170" rx="12" fill="${C.black}" ${st()}/>
    <path d="M66 150 L190 150 L190 222 Q190 234 178 234 L78 234 Q66 234 66 222Z" fill="${C.gold}" ${st(5)}/>
    <path d="M176 156 L176 226" stroke="${C.goldD}" stroke-width="9" stroke-linecap="round"/>
    <rect x="66" y="64" width="124" height="22" rx="8" fill="${C.grayD}" ${st(5)}/>
    <path d="M82 98 L82 140" stroke="#5a5550" stroke-width="7" stroke-linecap="round"/>
    <path d="M136 92 L110 124 L126 124 L118 146 L146 110 L130 110 L138 92Z" fill="${C.yellow}" ${st(4)}/>`,
  energy: () => `
    <path d="M76 60 L180 60 L184 78 L184 204 L178 222 L78 222 L72 204 L72 78 Z" fill="${C.red}" ${st()}/>
    <path d="M164 82 L164 200" stroke="${C.redD}" stroke-width="14"/>
    <path d="M90 84 L90 200" stroke="${C.redL}" stroke-width="8" stroke-linecap="round"/>
    <path d="M72 204 L184 204 L178 222 L78 222Z" fill="${C.grayL}" ${st(5)}/>
    <ellipse cx="128" cy="60" rx="52" ry="13" fill="#d9dcdf" ${st(5)}/>
    <ellipse cx="136" cy="58" rx="13" ry="5" fill="${C.grayL}" ${st(3)}/><circle cx="118" cy="59" r="3" fill="${O}"/>
    <path d="M104 116 Q82 108 84 86 Q96 102 114 104Z" fill="${C.cream}" ${st(4)}/>
    <path d="M152 116 Q174 108 172 86 Q160 102 142 104Z" fill="${C.cream}" ${st(4)}/>
    <path d="M138 106 L108 150 L126 150 L116 186 L152 136 L132 136 L144 106Z" fill="${C.yellow}" ${st(4)}/>
    ${ink('M96 196 Q84 176 98 166 Q110 158 102 146', C.brownD, 5, 6)}
    <circle cx="202" cy="62" r="7" fill="#f4efe4" ${st(3)}/><circle cx="214" cy="38" r="5" fill="#f4efe4" ${st(3)}/><circle cx="196" cy="24" r="4" fill="#f4efe4" ${st(3)}/>`,
  piggy: () => `<defs><clipPath id="pg"><ellipse cx="124" cy="150" rx="94" ry="70"/></clipPath></defs>
    ${[[70, 182], [98, 190], [146, 190], [174, 182]].map(([x, y]) => `<rect x="${x}" y="${y}" width="24" height="34" rx="7" fill="${C.pinkD}" ${st(5)}/>`).join('')}
    <path d="M100 86 L106 50 L130 82Z" fill="${C.pinkD}" ${st(5)}/>
    <ellipse cx="124" cy="150" rx="94" ry="70" fill="${C.pinkD}"/>
    <ellipse cx="116" cy="140" rx="94" ry="70" fill="${C.pink}" clip-path="url(#pg)"/>
    <ellipse cx="124" cy="150" rx="94" ry="70" fill="none" ${st()}/>
    <path d="M72 96 L62 58 L104 84Z" fill="${C.pinkD}" ${st(5)}/>
    <path d="M60 122 Q80 96 116 90" stroke="${C.pinkL}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <ellipse cx="216" cy="150" rx="18" ry="24" fill="${C.pinkL}" ${st(5)}/>
    <ellipse cx="210" cy="144" rx="4" ry="7" fill="${O}"/><ellipse cx="224" cy="146" rx="4" ry="7" fill="${O}"/>
    <circle cx="178" cy="122" r="7" fill="${O}"/><circle cx="180" cy="119" r="2.5" fill="#fff"/>
    <ellipse cx="184" cy="160" rx="10" ry="6" fill="${C.pinkL}"/>
    <path d="M32 140 q-18 -6 -12 -20 q10 -10 14 4 q2 12 -16 16" fill="none" ${st(6)}/>
    <rect x="104" y="84" width="40" height="9" rx="4.5" fill="${O}"/>
    <path d="M112 74 L116 54 L134 46 L148 60 L142 78Z" fill="#3a3532" ${st(5)}/>
    <circle cx="124" cy="60" r="3" fill="${C.goldL}"/><circle cx="136" cy="68" r="2.5" fill="${C.goldL}"/><circle cx="130" cy="56" r="2" fill="${C.goldL}"/>`,
  boomerang() {
    const P = 'M50 206 Q80 104 136 64 Q188 76 226 120';
    const flower = (x, y, r, col) => [0, 1, 2, 3, 4].map(k => {
      const a = k * Math.PI * 2 / 5 - Math.PI / 2;
      return `<circle cx="${f1(x + r * 0.62 * Math.cos(a))}" cy="${f1(y + r * 0.62 * Math.sin(a))}" r="${f1(r * 0.5)}" fill="${col}" ${st(3)}/>`;
    }).join('') + `<circle cx="${x}" cy="${y}" r="${f1(r * 0.3)}" fill="${C.yellow}" ${st(3)}/>`;
    return `${ink('M180 196 Q214 176 232 146', '#f5f0e5', 4, 6)}${ink('M156 226 Q204 214 238 182', '#f5f0e5', 4, 6)}
      <path d="${P}" fill="none" ${st(54)}/><path d="${P}" fill="none" stroke="${C.brownL}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M58 196 Q86 108 136 74 Q182 84 216 120" fill="none" stroke="#cd9360" stroke-width="6" stroke-linecap="round"/>
      <path d="M84 156 L96 166 M104 118 L116 126 M178 90 L174 104 M204 108 L198 120" stroke="${C.green}" stroke-width="7" stroke-linecap="round"/>
      ${flower(78, 172, 22, C.red)}${flower(120, 96, 18, C.pink)}${flower(186, 98, 20, C.orange)}
      <path d="M66 186 Q96 98 142 72" fill="none" stroke="${C.brownD}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>`;
  },
  hand() {
    const F = [['M110 124', 'L98 44'], ['M134 118', 'L136 32'], ['M156 124', 'L168 46'], ['M172 140', 'L198 78'], ['M100 160', 'L52 122']];
    const fingers = (col, w) => F.map(([a, b]) => `<path d="${a} ${b}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
    return `${fingers(O, 42)}<ellipse cx="138" cy="158" rx="52" ry="56" fill="${O}"/><path d="M110 188 L166 188 L172 244 L104 244Z" fill="${O}" ${st(12)}/>
      ${fingers(C.skin, 30)}<ellipse cx="138" cy="158" rx="46" ry="50" fill="${C.skin}"/><path d="M114 190 L162 190 L166 238 L110 238Z" fill="${C.skin}"/>
      <path d="M162 130 Q176 160 160 196" stroke="${C.skinD}" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="M98 50 L103 82 M134 38 L134 72 M196 84 L188 104" stroke="#f6dcc0" stroke-width="5" stroke-linecap="round"/>
      <path d="M104 106 q7 3 13 0 M128 98 q7 3 13 0 M154 106 q7 3 13 0 M78 132 q4 6 10 4" fill="none" ${st(3.5)}/>
      <path d="M118 150 Q138 170 162 156 M124 172 Q142 182 160 174" fill="none" ${st(3.5)}/>
      <ellipse cx="138" cy="238" rx="30" ry="10" fill="#7a4a3a" ${st(5)}/><ellipse cx="138" cy="240" rx="20" ry="5" fill="#4a2a22"/>`;
  },
};

/** The page that turns each picture into a sticker: rim and ink grown round the shape, then cut out and scaled. */
const PAGE = `<!doctype html><body style="margin:0"><script>
window.sticker = async (inner, out) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24 304 304" width="608" height="608">'
    + '<defs><filter id="stk" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">'
    + '<feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b2"/><feComponentTransfer in="b2" result="m2"><feFuncA type="linear" slope="40" intercept="-1.4"/></feComponentTransfer>'
    + '<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b1"/><feComponentTransfer in="b1" result="m1"><feFuncA type="linear" slope="40" intercept="-2.0"/></feComponentTransfer>'
    + '<feFlood flood-color="#2b211c"/><feComposite in2="m2" operator="in" result="ink"/>'
    + '<feFlood flood-color="#efe2c6"/><feComposite in2="m1" operator="in" result="rim"/>'
    + '<feMerge><feMergeNode in="ink"/><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
    + '<g filter="url(#stk)">' + inner + '</g></svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = c.height = 608;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, 608, 608).data;
  let x0 = 608, y0 = 608, x1 = 0, y1 = 0;
  for (let y = 0; y < 608; y++) for (let x = 0; x < 608; x++) if (a[(y * 608 + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, s = out / Math.max(w, h);
  const o = document.createElement('canvas'); o.width = Math.round(w * s); o.height = Math.round(h * s);
  const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
  window.last = o;
  return o.toDataURL('image/webp', 0.9);
};
/** The boss's hoard: the fallen boss on the floor, an open chest and trophies spilled round it. */
window.scene = async (bg, boss, bossTurn, chest, items) => {
  const S = 768, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S * 0.55, 60, S / 2, S * 0.55, S * 0.75);
  grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]); g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4;
  for (let y = 360; y < S; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); for (let x = (y / 64) % 2 ? 0 : 60; x < S; x += 120) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
  const load = async src => { const i = new Image(); i.src = src; await i.decode(); return i; };
  const b = await load(boss), ch = await load(chest);
  g.save(); g.translate(250, 460); g.rotate(bossTurn); const bh = 420, bw = b.width * bh / b.height;
  g.drawImage(b, -bw / 2, -bh / 2, bw, bh); g.restore();
  g.drawImage(ch, 430, 250, 300, 300 * ch.height / ch.width);
  for (const [src, x, y, sz, r] of items) { const i = await load(src); g.save(); g.translate(x, y); g.rotate(r); const k = sz / Math.max(i.width, i.height); g.drawImage(i, -i.width * k / 2, -i.height * k / 2, i.width * k, i.height * k); g.restore(); }
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = v; g.fillRect(0, 0, S, S);
  return c.toDataURL('image/webp', 0.86);
};
window.sheet = async (srcs) => {
  const n = srcs.length, cols = 8, cell = 180, c = document.createElement('canvas'); c.width = cols * cell; c.height = Math.ceil(n / cols) * cell;
  const g = c.getContext('2d'); g.fillStyle = '#3b322d'; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < n; k++) { const i = new Image(); i.src = srcs[k]; await i.decode(); const s = 160 / Math.max(i.width, i.height); g.drawImage(i, (k % cols) * cell + (cell - i.width * s) / 2, Math.floor(k / cols) * cell + (cell - i.height * s) / 2, i.width * s, i.height * s); }
  return c.toDataURL('image/png');
};
</script></body>`;

const CHEST = `<path d="M30 120 L226 120 L218 228 L38 228Z" fill="${C.brown}" ${st()}/>
  <path d="M30 120 Q128 40 226 120Z" fill="${C.brownD}" ${st()}/>
  <path d="M40 60 Q128 -10 216 60 L226 120 Q128 40 30 120Z" fill="${C.brownL}" ${st()}/>
  <path d="M30 150 L226 150 M34 190 L222 190" stroke="${C.brownD}" stroke-width="5"/>
  <path d="M62 120 L66 228 M194 120 L190 228" ${st(10)}/><path d="M62 120 L66 228 M194 120 L190 228" stroke="${C.gold}" stroke-width="5"/>
  <rect x="112" y="128" width="32" height="34" rx="4" fill="${C.gold}" ${st(5)}/><circle cx="128" cy="142" r="5" fill="${O}"/>
  ${lips(170, 80, 12, 0.8)}${lips(88, 172, -10, 0.7)}`;

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ICONS);
const b = await chromium.launch();
const pg = await b.newPage();
pg.on('pageerror', e => console.log('error:', e.message));
await pg.setContent(PAGE);
const urls = {};
for (const k of keys) {
  const url = await pg.evaluate(([inner]) => window.sticker(inner, 256), [ICONS[k]()]);
  urls[k] = url;
  writeFileSync(`${root}public/assets/ui/art_${k}.webp`, Buffer.from(url.split(',')[1], 'base64'));
}
const png = f => 'data:image/png;base64,' + readFileSync(root + 'public/assets/' + f).toString('base64');
const chest = await pg.evaluate(([inner]) => window.sticker(inner, 512), [CHEST]);
const all = Object.keys(ICONS), pick = (ks, at) => ks.map((k, i) => [urls[k] ?? 'data:image/webp;base64,' + readFileSync(`${root}public/assets/ui/art_${k}.webp`).toString('base64'), ...at[i]]);
const SCENES = {
  loot_king: [['#5b4636', '#1d1612'], 'mobs/king.png', -1.45, pick(['undies', 'hand', 'glasseye', 'sock', 'bells'], [[520, 250, 120, -0.3], [690, 220, 110, 0.4], [440, 570, 96, 0.2], [600, 600, 110, -0.5], [720, 540, 96, 0.3]])],
  loot_lich: [['#3d5566', '#121a20'], 'mobs/lich.png', 1.5, pick(['denture', 'tea', 'cup', 'mirrorball', 'fangs'], [[520, 250, 110, 0.3], [690, 220, 110, -0.3], [450, 580, 100, -0.2], [610, 600, 110, 0.4], [724, 530, 96, -0.2]])],
};
for (const [name, [bg, fig, turn, items]] of Object.entries(SCENES)) {
  const url = await pg.evaluate(args => window.scene(...args), [bg, png(fig), turn, chest, items]);
  writeFileSync(`${root}public/assets/events/${name}.webp`, Buffer.from(url.split(',')[1], 'base64'));
}
const sheet = await pg.evaluate(s => window.sheet(s), all.map(k => urls[k] ?? 'data:image/webp;base64,' + readFileSync(`${root}public/assets/ui/art_${k}.webp`).toString('base64')));
writeFileSync(`${root}art/ui/contact_arts.png`, Buffer.from(sheet.split(',')[1], 'base64'));
await b.close();
console.log('drew', keys.length, 'icons and', Object.keys(SCENES).length, 'scenes');
