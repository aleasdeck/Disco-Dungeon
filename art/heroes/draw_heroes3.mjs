// node art/heroes/draw_heroes3.mjs — draws stand-in pictures for the third trio of heroes until the FLUX ones are made, in
// the figures' cartoon look (thick black ink, flat colour with one shade, big head, stubby legs):
//   the kid Шкет, the bum Перегар and the ice genius Отморозок to public/assets/heroes/<key>.png (feet at the bottom edge,
//   640 tall; the game adds the sticker edge and the plastic plate), their disc tops to public/assets/env/disc_<key>.webp,
//   their ability glyphs (cream, inked) to public/assets/ui/ab_<key>.webp, the kid's firecracker to public/assets/env/petard.webp,
//   the gas and slow status icons to public/assets/ui/ico_gas|ico_slow.webp, and a contact sheet to art/heroes/contact_heroes3.png.
// Needs Playwright's Chromium (the npm package `playwright`). `node draw_heroes3.mjs kid` redraws one figure only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const need = createRequire(import.meta.url);
const { chromium } = (() => { try { return need('playwright'); } catch { return need('/opt/node-tools/node_modules/playwright'); } })();
const root = new URL('../../', import.meta.url).pathname;

const O = '#1b1412';
/** a shape inked all round */
const F = (d, fill, w = 7) => `<path d="${d}" fill="${fill}" stroke="${O}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
/** a shade or a highlight laid inside a shape, no ink */
const T = (d, fill, op = 1) => `<path d="${d}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`;
/** an ink line */
const L = (d, w = 5, col = O) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
const C = (x, y, r, fill, w = 6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${O}" stroke-width="${w}"/>`;
const E = (x, y, rx, ry, fill, w = 6, rot = 0) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${O}" stroke-width="${w}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}/>`;
const dot = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

/** A firecracker standing on end, its fuse curling up to a spark; (x, y) is the middle of its foot. */
const cracker = (x, y, h = 70, w = 26, rot = 0, spark = true) => `<g transform="rotate(${rot} ${x} ${y})">
  ${F(`M${x - w / 2} ${y} L${x - w / 2} ${y - h} Q${x} ${y - h - 8} ${x + w / 2} ${y - h} L${x + w / 2} ${y} Q${x} ${y + 7} ${x - w / 2} ${y}Z`, '#d63a35', 6)}
  ${T(`M${x + w / 2 - 8} ${y - h + 4} L${x + w / 2 - 8} ${y - 3} Q${x + w / 2 - 4} ${y - 1} ${x + w / 2 - 2} ${y - 3} L${x + w / 2 - 2} ${y - h + 2}Z`, '#a3221f')}
  ${T(`M${x - w / 2 + 4} ${y - h + 6} L${x - w / 2 + 4} ${y - 8} L${x - w / 2 + 8} ${y - 8} L${x - w / 2 + 8} ${y - h + 6}Z`, '#f07a6c')}
  <rect x="${x - w / 2}" y="${y - h * 0.62}" width="${w}" height="${h * 0.2}" fill="#f2c94c" stroke="${O}" stroke-width="4"/>
  ${E(x, y - h, w / 2, 5, '#efe3c6', 4)}
  ${L(`M${x} ${y - h} Q${x + 4} ${y - h - 18} ${x + 14} ${y - h - 22} Q${x + 22} ${y - h - 25} ${x + 18} ${y - h - 34}`, 4)}
  ${spark ? `<path d="M${x + 18} ${y - h - 50} L${x + 22} ${y - h - 39} L${x + 33} ${y - h - 42} L${x + 25} ${y - h - 34} L${x + 33} ${y - h - 25} L${x + 21} ${y - h - 29} L${x + 16} ${y - h - 19} L${x + 14} ${y - h - 30} L${x + 3} ${y - h - 31} L${x + 12} ${y - h - 37} L${x + 7} ${y - h - 47} L${x + 16} ${y - h - 40}Z" fill="#fff1a8" stroke="#f08a24" stroke-width="3.5" stroke-linejoin="round"/>` : ''}
</g>`;

/** A fly: a black body, two pale wings and a loopy dashed trail behind it. */
const fly = (x, y, s = 1, trail = '') => `${trail ? `<path d="${trail}" fill="none" stroke="#1b1412" stroke-width="2.5" stroke-dasharray="5 6" stroke-linecap="round" opacity="0.8"/>` : ''}
  <g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="-6" cy="-9" rx="8" ry="5" fill="#e9f3f6" stroke="${O}" stroke-width="2.5" transform="rotate(-30 -6 -9)"/>
  <ellipse cx="6" cy="-9" rx="8" ry="5" fill="#e9f3f6" stroke="${O}" stroke-width="2.5" transform="rotate(30 6 -9)"/>
  <ellipse cx="0" cy="0" rx="7" ry="6" fill="#2a2a2a" stroke="${O}" stroke-width="2.5"/>
  <circle cx="4" cy="-2" r="2.2" fill="#c0392b"/></g>`;

// ---------------------------------------------------------------- the kid: Шкет

/** A small ginger brat in a pink hoodie, a bandolier of firecrackers, a lit one in his fist and a lighter in the other; faces right. */
function kid() {
  const skin = '#f0c09a', skinD = '#d99a72', hoodie = '#d0528b', hoodieD = '#a3386a', hoodieL = '#e57fad', hair = '#e8742a', hairD = '#b8521a';
  return `
  <!-- the back arm, up with a lighter -->
  ${F('M118 300 Q84 272 78 228 Q76 210 92 208 Q106 208 108 226 Q114 258 140 282Z', hoodie)}
  ${T('M84 222 Q90 258 116 286 L128 290 Q104 266 98 228Z', hoodieD)}
  ${F('M70 214 Q66 190 82 182 L100 186 Q110 200 104 214 Q90 222 70 214Z', skin)}
  <rect x="66" y="150" width="32" height="40" rx="6" fill="#c0c6cc" stroke="${O}" stroke-width="6"/>
  ${T('M86 156 L94 156 L94 184 L86 184Z', '#8e969d')}
  <rect x="64" y="146" width="36" height="12" rx="4" fill="#9aa2a9" stroke="${O}" stroke-width="5"/>
  <path d="M82 144 Q70 120 84 98 Q86 118 96 112 Q100 132 82 144Z" fill="#ffb02e" stroke="${O}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M83 138 Q78 124 85 112 Q88 124 91 122 Q92 132 83 138Z" fill="#fff1a8"/>
  <!-- legs: skinny, a plaster on the knee, striped socks, huge sneakers -->
  ${F('M150 500 L146 588 L172 588 L176 500Z', skin)}
  ${F('M224 500 L228 588 L254 588 L250 500Z', skin)}
  ${T('M166 500 L162 586 L172 586 L176 500Z', skinD)}
  ${T('M240 500 L244 586 L254 586 L250 500Z', skinD)}
  <rect x="222" y="532" width="30" height="13" rx="3" fill="#f3d9b0" stroke="${O}" stroke-width="4" transform="rotate(-12 237 538)"/>
  ${L('M231 534 l2 9 M240 532 l2 9', 2.5, '#c9a777')}
  ${F('M144 568 L174 568 L174 598 L144 598Z', '#f4f1ea', 5)}
  ${F('M226 568 L256 568 L256 598 L226 598Z', '#f4f1ea', 5)}
  ${L('M146 578 H172 M146 588 H172 M228 578 H254 M228 588 H254', 4, '#d0528b')}
  ${F('M126 600 Q124 584 146 584 L176 586 Q196 590 204 606 Q206 626 186 628 L136 628 Q122 626 126 600Z', '#3e8ed0')}
  ${F('M210 600 Q208 584 230 584 L262 586 Q290 590 300 606 Q302 626 280 628 L220 628 Q206 626 210 600Z', '#3e8ed0')}
  ${F('M124 616 L206 616 Q206 630 188 632 L134 632 Q124 630 124 616Z', '#f4f1ea', 5)}
  ${F('M208 616 L302 616 Q302 630 284 632 L220 632 Q208 630 208 616Z', '#f4f1ea', 5)}
  ${L('M152 594 l10 -6 M162 600 l10 -6 M240 594 l10 -6 M252 600 l10 -6', 3.5)}
  <!-- denim shorts -->
  ${F('M138 450 L268 450 L262 512 L212 514 L204 482 L196 514 L140 512Z', '#3d5f99')}
  ${T('M236 456 L262 456 L258 506 L240 508Z', '#2c4675')}
  ${L('M204 456 L204 480', 4)}
  <!-- the hoodie, a pocket on the belly and a bomb printed on the chest -->
  ${F('M132 300 Q150 278 200 276 Q252 278 270 300 L282 452 Q206 468 126 452Z', hoodie)}
  ${T('M236 286 Q258 290 268 304 L280 448 Q258 454 240 456Z', hoodieD)}
  ${T('M142 306 Q148 292 168 288 L160 440 L138 444Z', hoodieL, 0.7)}
  ${F('M156 396 L246 396 L254 448 L148 448Z', hoodie, 5)}
  ${T('M226 398 L246 398 L252 446 L232 446Z', hoodieD)}
  ${C(200, 344, 26, '#2a2626', 5)}
  ${T('M186 330 Q192 324 200 324 Q190 330 188 340Z', '#5a5555')}
  ${L('M214 324 Q222 312 232 314', 4)}
  <path d="M232 302 l4 9 l9 -2 l-6 7 l6 7 l-9 -2 l-4 9 l-2 -9 l-9 2 l6 -7 l-6 -7 l9 2z" fill="#ffd34d" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
  <!-- the bandolier of firecrackers across the chest -->
  ${F('M140 296 Q150 292 158 298 L270 420 Q262 432 250 428Z', '#7a4a2b', 5)}
  ${[0, 1, 2, 3, 4].map(k => { const x = 166 + k * 21, y = 324 + k * 22; return `<g transform="rotate(-48 ${x} ${y})"><rect x="${x - 7}" y="${y - 20}" width="14" height="34" rx="3" fill="#d63a35" stroke="${O}" stroke-width="4"/><rect x="${x - 7}" y="${y - 6}" width="14" height="7" fill="#f2c94c" stroke="${O}" stroke-width="3"/>${L(`M${x} ${y - 20} q3 -8 8 -9`, 3)}</g>`; }).join('')}
  <!-- the front arm with a lit firecracker in the fist -->
  ${F('M262 304 Q296 318 312 352 Q318 370 304 378 Q290 382 284 368 Q274 344 252 330Z', hoodie)}
  ${T('M300 356 Q306 370 300 374 Q292 376 288 368 Q284 356 276 346Z', hoodieD)}
  ${cracker(318, 372, 64, 24, 14)}
  ${F('M290 362 Q296 346 314 348 Q334 352 334 370 Q332 388 312 390 Q292 388 290 362Z', skin)}
  ${L('M300 356 Q312 352 322 358 M298 368 Q310 366 322 372 M300 380 Q310 380 318 384', 3.5)}
  <!-- the hood behind the neck -->
  ${F('M140 296 Q160 262 200 262 Q240 262 262 296 Q232 310 200 308 Q168 310 140 296Z', hoodieD)}
  <!-- head: big ears, freckles, a gap-toothed grin with the tongue out -->
  ${F('M88 196 Q70 186 72 208 Q76 232 100 230Z', skin)}
  ${F('M306 186 Q326 178 326 202 Q322 226 300 226Z', skin)}
  ${T('M312 194 Q318 194 318 204 Q314 214 306 214Z', skinD)}
  ${F('M98 168 Q100 96 196 90 Q296 92 302 172 Q306 248 254 274 Q200 296 146 274 Q96 250 98 168Z', skin)}
  ${T('M252 120 Q296 140 298 186 Q298 238 254 268 Q284 226 280 182 Q276 142 252 120Z', skinD)}
  ${[[132, 196], [146, 208], [124, 212], [140, 222], [258, 192], [272, 204], [250, 210], [266, 222], [196, 206], [186, 198], [208, 196]].map(([x, y]) => dot(x, y, 3.6, '#c8692e')).join('')}
  <!-- eyes: one wide, one squinting with a sly lid, brows up in mischief -->
  ${E(158, 170, 22, 25, '#ffffff', 5)}
  ${E(236, 168, 22, 22, '#ffffff', 5)}
  ${C(166, 174, 10, '#3a8f4a', 4)}${dot(168, 175, 4.5, O)}${dot(163, 169, 2.6, '#fff')}
  ${C(244, 172, 10, '#3a8f4a', 4)}${dot(246, 173, 4.5, O)}${dot(241, 168, 2.6, '#fff')}
  ${F('M212 158 Q236 142 260 156 L258 166 Q236 156 214 166Z', skin, 5)}
  ${L('M132 132 Q156 116 182 132', 7)}${L('M214 128 Q238 106 262 124', 7)}
  <!-- nose and the grin -->
  ${F('M196 186 Q214 196 210 214 Q200 222 188 214', skin, 5)}
  ${F('M136 226 Q196 268 266 220 Q252 268 200 272 Q150 270 136 226Z', '#7a1f2b', 6)}
  <path d="M146 232 Q196 256 256 228 L252 240 Q196 262 150 242Z" fill="#ffffff"/>
  <rect x="190" y="238" width="16" height="16" fill="#7a1f2b"/>
  ${L('M170 240 L172 250 M226 236 L224 248', 3)}
  ${F('M206 252 Q226 252 226 270 Q224 292 208 290 Q192 288 194 268 Q196 254 206 252Z', '#ec6f86', 5)}
  ${L('M209 260 L208 282', 3, '#b8435a')}
  <!-- ginger spikes over a big forehead -->
  ${F('M96 160 Q86 120 110 108 Q96 84 128 80 Q122 50 156 58 Q164 26 196 44 Q222 18 238 52 Q272 40 270 74 Q304 76 290 108 Q316 122 300 156 Q284 128 262 120 Q248 136 230 118 Q216 134 198 116 Q182 132 168 114 Q150 128 136 112 Q120 134 96 160Z', hair)}
  ${T('M268 76 Q296 84 288 108 Q300 120 296 144 Q284 126 262 118 Q276 100 268 76Z', hairD)}
  ${T('M140 70 Q160 70 156 90 L138 92Z', '#f6a05a')}
  ${L('M156 58 Q160 76 168 86 M196 44 Q196 66 202 80 M238 52 Q236 72 230 84', 4, hairD)}`;
}


// ---------------------------------------------------------------- the bum: Перегар

/** A skinny tramp in a black ragged coat over a striped vest, a raised bottle of vodka, flies and a green reek; faces right. */
function bum() {
  const skin = '#d9b08c', skinD = '#b48563', coat = '#2c2b30', coatD = '#19181c', coatL = '#4a4850', pants = '#6f6a5a', pantsD = '#514d41', fur = '#8b7656', furD = '#66543b', hatC = '#4e5b3f', reek = '#8fbf3a';
  return `
  <!-- the reek rising off him -->
  ${L('M96 330 Q80 306 96 284 Q112 262 96 238', 6, reek)}${L('M74 420 Q58 398 72 378 Q86 358 72 336', 5, reek)}
  ${L('M318 420 Q334 398 320 378 Q306 356 322 334', 5, reek)}
  <!-- the back arm hanging, a dried fish by the tail -->
  ${F('M136 300 Q112 330 108 384 Q106 412 116 430 L138 426 Q132 396 138 360 Q144 330 156 314Z', coat)}
  ${T('M112 392 Q110 414 118 426 L130 424 Q124 404 126 380Z', coatD)}
  ${F('M106 428 Q100 446 112 454 Q128 458 134 444 Q140 430 128 424Z', skin)}
  ${F('M118 448 Q104 470 106 512 Q110 548 124 560 Q140 544 140 508 Q138 470 118 448Z', '#c9a25a', 5)}
  ${T('M124 470 Q132 500 128 540 Q136 520 136 500 Q134 478 124 470Z', '#a07a3a')}
  ${F('M124 556 L110 584 L126 574 L138 586Z', '#c9a25a', 4)}
  ${C(118, 476, 3.5, O, 0)}
  ${L('M112 496 Q122 500 132 496 M112 516 Q122 520 132 516 M114 536 Q122 540 130 536', 2.5, '#7d5a26')}
  <!-- legs: baggy trousers, a torn knee, one shoe gaping open on its toes -->
  ${F('M150 492 L140 594 L180 594 L190 492Z', pants)}
  ${F('M218 492 L224 594 L266 594 L254 492Z', pants)}
  ${T('M172 492 L164 592 L180 592 L190 492Z', pantsD)}
  ${T('M240 492 L250 592 L266 592 L254 492Z', pantsD)}
  ${F('M226 536 Q240 528 252 538 Q248 552 236 552 Q226 548 226 536Z', skin, 4)}
  ${L('M222 534 l6 4 M256 536 l-5 5 M232 556 l3 -5', 3)}
  ${L('M144 560 L176 556 M150 574 l8 6 M168 572 l6 -6', 3, pantsD)}
  ${F('M120 600 Q118 584 140 584 L182 586 Q196 592 196 610 Q194 628 176 628 L130 628 Q116 624 120 600Z', '#4a3a2c')}
  ${T('M126 616 L190 616 Q188 626 176 626 L132 626Z', '#2e241b')}
  ${F('M212 598 Q212 582 234 582 L270 584 Q290 588 300 600 L302 608 L214 610Z', '#4a3a2c')}
  ${F('M214 620 L300 612 Q318 618 314 626 Q306 634 286 632 L222 632 Q210 630 214 620Z', '#2e241b', 5)}
  ${C(296, 612, 6, skin, 4)}${C(284, 612, 6, skin, 4)}${C(272, 613, 5.5, skin, 4)}
  ${L('M236 590 l6 10 M252 588 l6 10', 3, '#2e241b')}
  <!-- the long coat, black and tattered, open on a striped vest, a rope for a belt -->
  ${F('M134 300 Q150 280 200 278 Q248 280 266 300 L276 380 L286 506 L270 494 L262 516 L246 498 L234 520 L222 500 L206 522 L194 500 L180 518 L168 498 L154 516 L144 494 L124 506 L130 380Z', coat)}
  ${T('M240 290 Q262 296 266 310 L284 500 L270 492 L262 512 L248 496Z', coatD)}
  ${T('M146 304 Q156 292 172 290 L164 470 L140 482 L136 380Z', coatL, 0.75)}
  ${F('M180 286 L222 286 L226 420 L176 420Z', '#f1ede4', 5)}
  ${L('M180 300 H222 M179 316 H223 M178 332 H224 M178 348 H224 M177 364 H225 M177 380 H225 M176 396 H226 M176 412 H226', 7, '#2f4f8a')}
  ${F('M178 284 L200 300 L170 420 L150 410 L168 300Z', coat, 5)}
  ${F('M224 284 L202 300 L230 420 L252 410 L236 300Z', coat, 5)}
  ${T('M232 300 L246 404 L240 408 L226 304Z', coatD)}
  ${F('M150 424 Q200 438 254 424 L256 436 Q200 452 148 436Z', '#b99a62', 4)}
  ${L('M200 438 Q192 456 188 474 M200 438 Q210 458 206 478', 5, '#b99a62')}
  ${L('M200 438 Q192 456 188 474 M200 438 Q210 458 206 478', 1.5)}
  <!-- a patch on the chest, and a hole behind with his heart boxers showing -->
  ${F('M240 338 L268 334 L270 366 L242 368Z', '#7a5a8a', 4)}
  ${L('M244 342 l4 2 M262 340 l3 3 M246 362 l4 -2 M262 360 l4 -3', 2.5, '#e8dcc8')}
  ${F('M142 452 L152 440 L170 446 L176 462 L168 478 L150 480 L140 468Z', '#d23b48', 5)}
  <path d="M152 456 c-3 -5 -10 -1 -6 4 l6 5 l6 -5 c4 -5 -3 -9 -6 -4z M164 466 c-2 -4 -8 -1 -5 3 l5 4 l5 -4 c3 -4 -3 -7 -5 -3z" fill="#fff"/>
  ${L('M138 470 L134 478 M178 456 L184 452 M150 484 L148 490', 3)}
  <!-- the front arm raising the bottle -->
  ${F('M256 304 Q290 314 304 350 Q310 366 300 374 Q286 380 278 366 Q270 344 248 330Z', coat)}
  ${T('M296 352 Q302 366 296 370 Q288 372 284 362 Q280 352 272 344Z', coatD)}
  ${F('M280 362 L288 346 L296 360 L306 348 L308 372Z', coat, 4)}
  <g transform="rotate(16 316 290)">
    ${F('M298 330 L298 252 Q298 236 308 228 L308 196 L324 196 L324 228 Q334 236 334 252 L334 330 Q316 338 298 330Z', '#bfe3df', 6)}
    ${T('M322 236 Q330 244 330 256 L330 326 Q324 330 318 330 L318 250Z', '#93c2bd')}
    ${T('M304 250 L310 246 L310 320 L304 320Z', '#ffffff', 0.8)}
    <rect x="304" y="186" width="24" height="14" rx="3" fill="#c0392b" stroke="${O}" stroke-width="4"/>
    <rect x="298" y="262" width="36" height="44" fill="#f4efe2" stroke="${O}" stroke-width="4"/>
    <rect x="298" y="262" width="36" height="9" fill="#c0392b"/>
    <text x="316" y="294" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="9.5" text-anchor="middle" fill="#1b1412">ВОДКА</text>
    ${T('M302 300 H330', '#000')}
    ${L('M302 300 H330', 2, '#c0392b')}
  </g>
  ${F('M284 352 Q282 330 302 326 Q322 326 324 344 Q324 366 304 370 Q286 370 284 352Z', skin)}
  ${L('M292 334 Q306 330 318 336 M290 346 Q304 342 318 348 M292 358 Q304 356 314 360', 3.5)}
  <!-- head: a long hollow face, a red nose, droopy eyes and a crooked grin, under a ragged ushanka -->
  ${F('M120 196 Q104 190 106 210 Q110 232 128 230Z', skin)}
  ${F('M126 170 Q126 112 200 108 Q276 110 280 172 Q284 236 262 262 Q236 290 200 290 Q160 290 140 262 Q122 236 126 170Z', skin)}
  ${T('M248 130 Q278 150 278 190 Q278 238 256 264 Q270 226 268 190 Q266 152 248 130Z', skinD)}
  ${T('M146 222 Q156 242 170 246 Q160 252 152 246Z', skinD, 0.8)}
  ${T('M252 220 Q246 240 232 246 Q244 252 252 244Z', skinD, 0.8)}
  <!-- stubble and a scraggly chin beard -->
  ${F('M162 262 Q200 300 244 262 Q250 292 222 304 Q200 312 178 304 Q152 290 162 262Z', '#8d8a82', 5)}
  ${L('M176 284 l-2 10 M192 292 l-1 10 M210 292 l1 10 M226 286 l3 9', 3, '#5e5b55')}
  ${[[150, 240], [158, 252], [146, 254], [168, 258], [240, 252], [254, 240], [250, 256], [232, 258], [200, 258], [186, 256], [216, 256]].map(([x, y]) => dot(x, y, 2.6, '#6c6458')).join('')}
  <!-- droopy bloodshot eyes with bags under them -->
  ${E(176, 182, 20, 18, '#fbf4e6', 5)}
  ${E(236, 180, 20, 18, '#fbf4e6', 5)}
  ${C(182, 188, 8, '#6b5032', 3.5)}${dot(183, 189, 3.6, O)}
  ${C(242, 186, 8, '#6b5032', 3.5)}${dot(243, 187, 3.6, O)}
  ${L('M162 186 l6 3 M250 186 l5 4', 2, '#d0434f')}
  ${F('M154 180 Q176 160 198 178 L196 186 Q176 176 156 188Z', skin, 5)}
  ${F('M214 178 Q236 158 258 176 L258 184 Q236 174 216 186Z', skin, 5)}
  ${L('M160 206 Q176 214 194 204 M220 204 Q236 212 254 202', 3.5, '#9b6c50')}
  ${L('M152 156 Q172 146 194 158', 6)}${L('M218 156 Q240 144 260 156', 6)}
  <!-- the cherry nose -->
  ${C(222, 220, 22, '#d9434f', 6)}
  ${T('M212 208 Q220 202 228 206 Q218 210 214 216Z', '#ffb0b3')}
  ${dot(232, 230, 2.4, '#8c2230')}${dot(214, 230, 2.4, '#8c2230')}
  <!-- a crooked grin: gaps, one gold tooth -->
  ${F('M168 252 Q206 272 246 246 Q240 276 210 280 Q178 280 168 252Z', '#6e1e26', 5)}
  <path d="M176 256 L186 260 L186 268 L178 264Z M196 262 L208 263 L208 272 L196 271Z M226 260 L236 254 L236 264 L226 268Z" fill="#f2e6b8" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M212 262 L223 260 L223 270 L212 272Z" fill="#f2c230" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- the ushanka: one flap hanging, one sticking out -->
  ${F('M118 152 Q120 70 200 64 Q280 70 286 152Z', hatC)}
  ${T('M232 72 Q280 84 284 150 L254 150 Q254 100 232 72Z', '#3a4530')}
  ${F('M110 140 Q200 118 294 140 L294 168 Q200 150 108 168Z', fur)}
  ${T('M240 132 Q270 134 294 142 L294 166 Q268 158 238 156Z', furD)}
  ${L('M130 150 l6 8 M152 142 l4 9 M176 138 l4 9 M200 136 l3 9 M224 138 l3 9 M248 140 l3 9 M272 144 l3 9', 3, furD)}
  ${F('M104 160 Q96 200 104 240 Q118 248 132 238 Q132 200 126 162Z', fur)}
  ${L('M108 182 l8 4 M106 204 l9 3 M108 226 l9 2', 3, furD)}
  ${F('M282 146 Q306 110 342 104 Q354 124 344 146 Q322 172 290 178Z', fur)}
  ${T('M300 168 Q326 160 344 140 Q346 150 340 156 Q320 174 294 178Z', furD)}
  ${L('M302 130 l9 7 M318 118 l8 8 M332 112 l6 9', 3, furD)}
  ${L('M134 240 Q138 258 132 272', 3)}
  <!-- a tear in the crown with the padding poking out -->
  ${F('M168 88 L182 82 L186 98 L172 104Z', '#e7dfc8', 3.5)}
  <!-- flies -->
  ${fly(326, 172, 1.2, 'M326 172 Q352 150 340 128 Q326 110 344 92')}
  ${fly(96, 112, 1.1, 'M96 112 Q72 128 82 148 Q92 168 70 178')}
  ${fly(352, 312, 1.1, 'M352 312 Q372 290 360 270')}
  ${fly(64, 286, 1, 'M64 286 Q48 266 60 250')}`;
}

// ---------------------------------------------------------------- the ice genius: Отморозок

/** A mad scientist frozen to the bone: bald icy dome, wild frosted hair, goggles, a curled moustache and a snot icicle,
 *  lab coat, blue gloves and a freeze ray aimed ahead; faces left. */
function genius() {
  const skin = '#cfe0e4', skinD = '#9fbcc4', coat = '#f2f5f4', coatD = '#c3d1d6', glove = '#3a9cb8', gloveD = '#256f86', hair = '#ffffff', hairD = '#bcd8e2', ice = '#bdf2ff', iceD = '#6cc6e0';
  return `
  <!-- the back arm on his hip -->
  ${F('M264 308 Q300 330 304 372 Q306 398 286 408 Q272 412 266 400 Q284 380 278 352 Q272 334 252 322Z', coat)}
  ${T('M298 360 Q300 392 288 404 Q280 406 276 400 Q290 382 288 360Z', coatD)}
  ${F('M262 392 Q272 382 288 388 Q300 400 290 414 Q276 422 264 412Z', glove)}
  <!-- legs: dark trousers, heavy rubber boots, icicles on the toes -->
  ${F('M152 492 L148 590 L184 590 L190 492Z', '#33394a')}
  ${F('M212 492 L218 590 L254 590 L250 492Z', '#33394a')}
  ${T('M172 492 L168 588 L184 588 L190 492Z', '#232838')}
  ${T('M234 492 L240 588 L254 588 L250 492Z', '#232838')}
  ${F('M96 606 Q96 580 124 578 L184 580 Q194 592 192 612 Q190 628 172 628 L108 628 Q94 624 96 606Z', '#2f6fa0')}
  ${F('M206 606 Q206 580 234 578 L262 580 Q272 592 270 612 Q268 628 250 628 L218 628 Q204 624 206 606Z', '#2f6fa0')}
  ${T('M100 616 L190 616 Q188 626 172 626 L108 626Z', '#1f4c70')}
  ${T('M208 616 L268 616 Q266 626 250 626 L218 626Z', '#1f4c70')}
  ${L('M112 590 Q126 584 140 590', 3.5, '#8fc4e6')}
  ${F('M140 580 L142 562 L190 562 L188 582Z', ice, 4)}
  ${F('M214 580 L216 562 L256 562 L258 582Z', ice, 4)}
  <!-- the lab coat, open on a dark turtleneck, pens in the pocket, snow on the shoulders -->
  ${F('M130 300 Q150 278 200 276 Q250 278 270 300 L282 470 L272 506 L128 506 L118 470Z', coat)}
  ${T('M236 286 Q262 292 270 306 L282 468 L272 502 L246 504Z', coatD)}
  ${F('M182 284 L218 284 L224 470 L176 470Z', '#2d3a5c', 5)}
  ${T('M206 290 L218 290 L222 466 L208 466Z', '#1f2943')}
  ${F('M178 282 L200 304 L180 470 L160 470 L164 300Z', coat, 5)}
  ${F('M222 282 L200 304 L220 470 L240 470 L236 300Z', coat, 5)}
  ${T('M226 300 L236 300 L240 466 L230 466Z', coatD)}
  ${F('M236 380 L266 378 L268 418 L238 420Z', coat, 4)}
  <rect x="242" y="358" width="6" height="28" rx="2" fill="#c0392b" stroke="${O}" stroke-width="3"/>
  <rect x="252" y="362" width="6" height="24" rx="2" fill="#2f6fa0" stroke="${O}" stroke-width="3"/>
  ${F('M130 476 L150 476 L146 492 L140 478 L134 494Z', ice, 3.5)}
  ${F('M236 486 L262 486 L256 504 L250 488 L244 506Z', ice, 3.5)}
  ${F('M126 300 Q140 280 176 282 Q172 300 150 304 Q138 314 126 300Z', '#ffffff', 4)}
  ${F('M224 282 Q258 278 274 298 Q262 312 248 302 Q230 300 224 282Z', '#ffffff', 4)}
  <!-- the front arm and the freeze ray aimed ahead -->
  ${F('M140 306 Q108 320 92 350 Q86 366 98 374 Q110 380 118 368 Q130 348 152 336Z', coat)}
  ${T('M96 352 Q90 368 100 372 Q108 374 112 366 Q118 354 130 344Z', coatD)}
  <!-- the ray: a copper barrel, a tank of blue goo, a dish at the muzzle -->
  ${F('M36 348 L110 344 L114 380 L40 384Z', '#8a9aa6')}
  ${T('M40 368 L112 364 L114 380 L40 384Z', '#5f6f7a')}
  ${[56, 76, 96].map(x => `<rect x="${x - 5}" y="${342}" width="10" height="44" rx="3" fill="#d08a3c" stroke="${O}" stroke-width="4"/>`).join('')}
  ${F('M60 344 Q60 316 82 314 Q104 316 104 344Z', '#e8f7fb', 5)}
  ${T('M64 344 Q66 330 82 328 Q98 330 100 344Z', '#43c6ea')}
  ${dot(74, 336, 3, '#ffffff')}${dot(88, 332, 2.4, '#ffffff')}
  ${F('M20 334 Q36 340 38 366 Q36 392 20 398 Q12 366 20 334Z', '#b7c4cc')}
  ${F('M98 378 L120 378 L118 408 L104 410Z', '#5f6f7a', 5)}
  <!-- the blast: frost crystals bursting from the muzzle -->
  <path d="M8 366 l-10 -18 l-4 14 l-18 -4 l12 12 l-16 10 l18 0 l-2 18 l12 -14 l10 14 l0 -18z" fill="${ice}" stroke="#1b4d5c" stroke-width="3.5" stroke-linejoin="round"/>
  ${L('M-6 330 l6 10 M-12 336 l14 -2 M-2 328 l-4 14', 3, '#1b4d5c')}
  ${L('M-10 398 l6 10 M-16 404 l14 -2 M-6 396 l-4 14', 3, '#1b4d5c')}
  ${F('M98 360 Q100 344 118 344 Q132 348 132 362 Q130 380 114 382 Q98 380 98 360Z', glove)}
  ${T('M118 350 Q128 354 128 364 Q126 376 116 378 Q122 366 118 350Z', gloveD)}
  <!-- head: an icy bald dome, a wild frosted mane, goggles up, a hooked blue nose with an icicle, a wicked grin -->
  ${F('M300 196 Q318 186 316 210 Q312 232 292 230Z', skin)}
  ${F('M118 164 Q114 96 200 88 Q288 94 290 166 Q292 240 248 270 Q206 292 162 270 Q120 246 118 164Z', skin)}
  ${T('M252 108 Q288 132 288 178 Q288 232 250 264 Q276 226 274 182 Q272 138 252 108Z', skinD)}
  ${T('M150 104 Q170 94 190 96 Q166 104 154 120Z', '#ffffff', 0.8)}
  <!-- the mane: frosted tufts out the sides, icicles hanging from them -->
  ${F('M120 150 Q86 140 78 110 Q96 116 100 104 Q78 90 84 66 Q104 84 116 80 Q110 60 126 46 Q130 74 146 96 Q126 118 120 150Z', hair)}
  ${F('M286 150 Q320 140 330 110 Q312 116 308 104 Q330 90 324 66 Q304 84 292 80 Q298 60 282 46 Q278 74 262 96 Q282 118 286 150Z', hair)}
  ${T('M300 104 Q318 102 324 86 Q314 112 296 120Z', hairD)}${T('M104 104 Q90 102 84 86 Q94 112 110 120Z', hairD)}
  ${F('M86 128 L92 152 L98 130Z', ice, 3)}${F('M314 128 L308 154 L302 130Z', ice, 3)}${F('M298 140 L296 160 L290 142Z', ice, 3)}
  <!-- goggles up on the dome -->
  <path d="M120 128 Q200 108 290 128" fill="none" stroke="#3b2f2a" stroke-width="12"/>
  ${C(168, 116, 22, '#5a6872', 5)}${C(168, 116, 14, '#7fe0f6', 4)}
  ${C(232, 116, 22, '#5a6872', 5)}${C(232, 116, 14, '#7fe0f6', 4)}
  ${T('M160 108 Q166 104 172 106 Q164 110 162 116Z', '#ffffff')}${T('M224 108 Q230 104 236 106 Q228 110 226 116Z', '#ffffff')}
  <!-- narrow evil eyes, frosted brows down hard -->
  ${E(166, 176, 20, 14, '#ffffff', 5)}
  ${E(232, 176, 20, 14, '#ffffff', 5)}
  ${C(160, 178, 7.5, '#2a7fa0', 3.5)}${dot(159, 178, 3.5, O)}${dot(157, 175, 1.8, '#fff')}
  ${C(226, 178, 7.5, '#2a7fa0', 3.5)}${dot(225, 178, 3.5, O)}${dot(223, 175, 1.8, '#fff')}
  ${F('M140 150 Q166 152 194 170 L190 178 Q164 166 142 164Z', hair, 5)}
  ${F('M258 150 Q232 152 204 170 L208 178 Q234 166 256 164Z', hair, 5)}
  ${L('M146 192 Q166 198 184 190 M214 190 Q232 198 252 192', 3, skinD)}
  <!-- the nose, hooked to the left, its blue tip dripping an icicle -->
  ${F('M206 176 Q196 200 176 214 Q170 222 180 228 Q196 232 210 222', skin, 5)}
  ${T('M200 186 Q196 200 186 210 Q196 214 204 204Z', skinD)}
  ${E(182, 220, 14, 11, '#9fd0ea', 5, -15)}
  ${T('M174 214 Q178 210 184 211 Q178 215 176 220Z', '#ffffff')}
  <!-- the curled moustache and the wicked grin under it -->
  ${F('M154 250 Q178 270 210 252 Q236 270 252 248 Q248 286 204 290 Q160 288 154 250Z', '#3a1426', 5)}
  <path d="M160 254 Q180 266 204 258 Q228 268 248 252 L244 262 Q226 276 204 268 Q180 276 162 262Z" fill="#ffffff" stroke="${O}" stroke-width="2.5"/>
  ${L('M176 260 l2 8 M192 262 l0 8 M216 262 l0 8 M232 260 l-2 8', 2.5)}
  ${F('M200 238 Q174 230 156 244 Q134 258 122 238 Q118 222 132 220 Q140 222 136 232 Q142 240 152 232 Q172 216 200 226 Q228 216 248 232 Q258 240 264 232 Q260 222 268 220 Q282 222 278 238 Q266 258 244 244 Q226 230 200 238Z', hair, 4)}
  ${F('M172 222 L174 270 L184 224Z', ice, 3.5)}
  ${T('M176 230 L175 256 L179 230Z', '#ffffff')}
  <!-- a pointy beard tuft, frosted -->
  ${F('M190 286 Q204 316 200 330 Q216 314 214 286Z', hair, 4)}
`;
}


// ---------------------------------------------------------------- the small pictures

/** A ring of six arms with two twigs each, drawn as ink lines with a colour inside them. */
function flake(cx, cy, r, col, w = 8, ow = 6) {
  let d = '';
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3, ux = Math.cos(a), uy = Math.sin(a), x = cx + ux * r, y = cy + uy * r;
    d += `M${cx} ${cy} L${x.toFixed(1)} ${y.toFixed(1)} `;
    for (const t of [0.5, 0.75]) {
      const bx = cx + ux * r * t, by = cy + uy * r * t, l = r * (t === 0.5 ? 0.32 : 0.22);
      for (const s of [-1, 1]) { const b = a + s * 0.85; d += `M${bx.toFixed(1)} ${by.toFixed(1)} l${(Math.cos(b) * l).toFixed(1)} ${(Math.sin(b) * l).toFixed(1)} `; }
    }
  }
  return `<path d="${d}" fill="none" stroke="${O}" stroke-width="${w + ow}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
}
/** A puffy cloud of overlapping balls, laid without ink (the outline comes round the whole of it). */
const cloud = (x, y, s, fill) => [[0, 0, 30], [-30, 8, 22], [30, 8, 24], [-14, -20, 22], [16, -22, 24], [-44, 22, 14], [46, 24, 15], [0, 22, 24]]
  .map(([dx, dy, r]) => dot(x + dx * s, y + dy * s, r * s, fill)).join('');

/** Disc tops, 160 across: a dark rim, the hero's colour on the face, and his mark in the middle. */
const DISCS = {
  kid: { rim: '#6b2347', face: '#d9578f', mark: `<g filter="url(#o)" transform="rotate(-24 80 82)">${cracker(78, 118, 56, 24, 0, true).replace(/#d63a35/g, '#f7f0e2').replace(/#a3221f/g, '#d8cdb8').replace(/#f07a6c/g, '#ffffff')}</g>` },
  bum: { rim: '#3b3224', face: '#7b6a4e', mark: `<g filter="url(#o)">${cloud(80, 82, 0.95, '#b9e34f')}</g>${L('M66 80 l8 6 M74 80 l-8 6 M90 80 l8 6 M98 80 l-8 6', 3.5)}${L('M70 98 Q76 94 82 98 Q88 102 94 98', 3.5)}` },
  genius: { rim: '#1b4d5c', face: '#3a9cb8', mark: flake(80, 80, 40, '#f4fbff', 8, 6) },
};
const disc = ({ rim, face, mark }) => `<defs><filter id="o" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d"/><feFlood flood-color="${O}"/><feComposite in2="d" operator="in" result="ink"/><feMerge><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <circle cx="80" cy="80" r="77" fill="${rim}" stroke="${O}" stroke-width="3"/>
  <circle cx="80" cy="80" r="63" fill="${face}" stroke="${O}" stroke-width="3"/>
  <path d="M30 62 A54 54 0 0 1 78 22" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <path d="M8 96 A74 74 0 0 0 46 146" fill="none" stroke="#000000" stroke-width="6" stroke-linecap="round" opacity="0.22"/>
  ${mark}`;

/** Ability glyphs: a cream silhouette (the ink comes round it), as on the other heroes' ability gems. */
const CREAM = '#f1e4c4';
const GLYPHS = {
  kid: () => `<g transform="rotate(-22 128 140)">
    <rect x="96" y="96" width="64" height="146" rx="12" fill="${CREAM}"/>
    <path d="M128 98 Q132 66 158 58 Q178 52 176 30" fill="none" stroke="${CREAM}" stroke-width="12" stroke-linecap="round"/>
    <path d="M178 -4 l9 24 l25 -7 l-17 19 l17 19 l-25 -6 l-9 24 l-6 -25 l-25 5 l18 -18 l-17 -20 l25 7z" fill="${CREAM}"/></g>`,
  bum: () => `${cloud(128, 150, 2.1, CREAM)}
    <path d="M70 52 Q56 34 70 18 M128 40 Q114 22 128 4 M186 52 Q172 34 186 18" fill="none" stroke="${CREAM}" stroke-width="13" stroke-linecap="round"/>`,
  genius: () => flake(128, 128, 112, CREAM, 20, 0),
};

/** The kid's firecracker standing in its cell: 60 by 100, its fuse's tip at (42, 7) where the game lights the spark. */
const PETARD = `<path d="M30 34 Q30 22 36 16 Q42 10 42 7" fill="none" stroke="${O}" stroke-width="3.2" stroke-linecap="round"/>
  ${F('M14 96 L14 36 Q30 28 46 36 L46 96 Q30 101 14 96Z', '#d63a35', 3.5)}
  ${T('M38 38 L44 39 L44 94 L38 96Z', '#a3221f')}
  ${T('M18 42 L22 40 L22 90 L18 90Z', '#f07a6c')}
  <path d="M14 58 L46 58 L46 70 L14 70Z" fill="#f2c94c" stroke="${O}" stroke-width="2.5"/>
  ${L('M20 64 l4 0 M28 64 l4 0 M36 64 l4 0', 2, '#b88a1f')}
  ${E(30, 36, 16, 5, '#efe3c6', 3)}`;

/** Status stickers, 256 across: the gas a hero's cloud chokes enemies with, and the snail of an enemy slowed by frost. */
const STICKERS = {
  ico_gas: () => `${cloud(128, 140, 2, '#a9d65a').replace(/<circle /g, `<circle stroke="${O}" stroke-width="7" `)}${cloud(128, 140, 2, '#a9d65a')}
    ${dot(150, 120, 34, '#c4e67e')}
    <path d="M60 168 Q100 196 150 186 Q190 178 214 150 Q206 196 160 210 Q100 222 60 168Z" fill="#7fae2e"/>
    ${L('M84 118 l22 16 M106 118 l-22 16 M150 118 l22 16 M172 118 l-22 16', 8)}
    ${F('M96 168 Q128 150 160 168 Q150 184 136 178 Q124 196 108 184 Q100 178 96 168Z', '#5c1f2c', 6)}
    ${F('M118 176 Q128 172 136 178 Q138 196 126 198 Q114 196 118 176Z', '#ec6f86', 4)}
    ${L('M66 52 Q52 34 66 18 M128 40 Q114 22 128 6 M190 52 Q176 34 190 18', 9, '#7fae2e')}`,
  ico_slow: () => `
    ${F('M20 196 Q30 168 70 170 L190 168 Q236 166 240 196 Q238 214 210 214 L44 214 Q18 214 20 196Z', '#9fd6ea', 7)}
    ${T('M40 206 L220 206 Q236 204 236 196 Q226 212 210 212 L44 212Z', '#6cb6d2')}
    ${F('M196 172 Q200 120 214 92 L226 96 Q216 128 214 170Z', '#9fd6ea', 6)}
    ${F('M220 96 Q226 78 240 82 Q248 92 240 104Z', '#9fd6ea', 5)}
    ${L('M210 92 L196 62 M224 90 L230 58', 6)}${C(196, 58, 10, '#ffffff', 5)}${C(230, 54, 10, '#ffffff', 5)}${dot(198, 60, 4.5, O)}${dot(232, 56, 4.5, O)}
    ${C(110, 120, 74, '#e0a050', 7)}
    ${T('M150 74 Q186 104 182 146 Q172 186 126 194 Q172 166 164 128 Q160 96 150 74Z', '#b8782e')}
    <path d="M110 120 m-8 0 a8 8 0 1 1 16 0 a20 20 0 1 1 -40 0 a34 34 0 1 1 68 0 a50 50 0 1 1 -100 0" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/>
    ${F('M60 72 L64 46 L74 70Z', '#dff6ff', 4)}${F('M150 66 L158 40 L164 68Z', '#dff6ff', 4)}
    ${flake(48, 64, 24, '#ffffff', 6, 5)}`,
};

// ---------------------------------------------------------------- figures to pictures

const FIGURES = { kid: { svg: kid, vb: '30 0 340 640' }, bum: { svg: bum, vb: '40 30 340 610' }, genius: { svg: genius, vb: '-30 30 370 610' } };

/** The page that turns a figure into a picture: the drawing, a thicker ink grown round its whole silhouette, cut to its box. */
const PAGE = `<!doctype html><body style="margin:0"><script>
window.figure = async (inner, vb, H) => {
  const [x, y, w, h] = vb.split(' ').map(Number), S = 2, W = w * S, Hh = h * S;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (x - 20) + ' ' + (y - 20) + ' ' + (w + 40) + ' ' + (h + 40) + '" width="' + (W + 80) + '" height="' + (Hh + 80) + '">'
    + '<defs><filter id="ink" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">'
    + '<feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d"/><feFlood flood-color="#1b1412"/><feComposite in2="d" operator="in" result="ink"/>'
    + '<feMerge><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
    + '<g filter="url(#ink)">' + inner + '</g></svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) if (a[(yy * c.width + xx) * 4 + 3] > 8) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, s = H / ch;
  const o = document.createElement('canvas'); o.width = Math.round(cw * s); o.height = H;
  const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
};
/** Any drawing on a fixed frame (no cropping): the frame's viewBox drawn at the given size, with an inked outline of r if given. */
window.frame = async (inner, vb, w, h, type, r) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + w + '" height="' + h + '">'
    + (r ? '<defs><filter id="ink" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="' + r + '" result="d"/><feFlood flood-color="#1b1412"/><feComposite in2="d" operator="in" result="ink"/><feMerge><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#ink)">' + inner + '</g>' : inner) + '</svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL(type, 0.92);
};
/** A drawing cut to its own box with an ink outline (r) or a sticker's cream rim and ink (r = 0), the long side out. */
window.cut = async (inner, r, out) => {
  const ink = r ? '<feMorphology in="SourceAlpha" operator="dilate" radius="' + r + '" result="d"/><feFlood flood-color="#1b121e"/><feComposite in2="d" operator="in" result="ink"/><feMerge><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge>'
    : '<feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b2"/><feComponentTransfer in="b2" result="m2"><feFuncA type="linear" slope="40" intercept="-1.4"/></feComponentTransfer>'
    + '<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b1"/><feComponentTransfer in="b1" result="m1"><feFuncA type="linear" slope="40" intercept="-2.0"/></feComponentTransfer>'
    + '<feFlood flood-color="#2b211c"/><feComposite in2="m2" operator="in" result="ink"/><feFlood flood-color="#efe2c6"/><feComposite in2="m1" operator="in" result="rim"/>'
    + '<feMerge><feMergeNode in="ink"/><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 336 336" width="672" height="672"><defs><filter id="f" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">' + ink + '</filter></defs><g filter="url(#f)">' + inner + '</g></svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const N = 672, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, N, N).data;
  let x0 = N, y0 = N, x1 = 0, y1 = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (a[(y * N + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, s = out / Math.max(w, h);
  const o = document.createElement('canvas'); o.width = Math.round(w * s); o.height = Math.round(h * s);
  const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
  return o.toDataURL('image/webp', 0.92);
};
window.sheet = async (srcs, bg) => {
  // the figures in a row, the small pictures in a row under them
  const big = srcs.filter(u => u.startsWith('data:image/png')), sm = srcs.filter(u => !u.startsWith('data:image/png'));
  const cell = 330, c = document.createElement('canvas'); c.width = Math.max(big.length * cell, sm.length * 180, 180); c.height = (big.length ? 520 : 0) + (sm.length ? 190 : 0);
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < big.length; k++) { const i = new Image(); i.src = big[k]; await i.decode(); const s = Math.min(300 / i.width, 500 / i.height); g.drawImage(i, k * cell + (cell - i.width * s) / 2, 510 - i.height * s, i.width * s, i.height * s); }
  const top = big.length ? 520 : 0;
  for (let k = 0; k < sm.length; k++) { const i = new Image(); i.src = sm[k]; await i.decode(); const s = Math.min(160 / i.width, 170 / i.height); g.drawImage(i, k * 180 + (180 - i.width * s) / 2, top + 180 - i.height * s, i.width * s, i.height * s); }
  return c.toDataURL('image/png');
};
</script></body>`;

const only = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('error:', e.message));
await pg.setContent(PAGE);
const out = {};
for (const [k, f] of Object.entries(FIGURES)) {
  if (only.length && !only.includes(k)) continue;
  out[k] = await pg.evaluate(([inner, vb]) => window.figure(inner, vb, 640), [f.svg(), f.vb]);
  writeFileSync(`${root}public/assets/heroes/${k}.png`, Buffer.from(out[k].split(',')[1], 'base64'));
}
/** writes a picture under public/assets and hands back its path there */
const save = (file, url) => (writeFileSync(`${root}public/assets/${file}`, Buffer.from(url.split(',')[1], 'base64')), file);
const small = [];
if (!only.length) {
  for (const [k, d] of Object.entries(DISCS)) small.push(save(`env/disc_${k}.webp`, await pg.evaluate(a => window.frame(...a), [disc(d), '0 0 160 160', 160, 160, 'image/webp', 0])));
  for (const [k, f] of Object.entries(GLYPHS)) small.push(save(`ui/ab_${k}.webp`, await pg.evaluate(a => window.cut(...a), [f(), 7, 256])));
  for (const [k, f] of Object.entries(STICKERS)) small.push(save(`ui/${k}.webp`, await pg.evaluate(a => window.cut(...a), [f(), 0, 256])));
  small.push(save('env/petard.webp', await pg.evaluate(a => window.frame(...a), [PETARD, '0 0 60 100', 120, 200, 'image/webp', 0])));
}
const pics = [...Object.values(out), ...small.map(f => 'data:image/webp;base64,' + readFileSync(`${root}public/assets/${f}`).toString('base64'))];
const sheet = await pg.evaluate(([s, bg]) => window.sheet(s, bg), [pics, '#3b322d']);
writeFileSync(`${root}art/heroes/contact_heroes3.png`, Buffer.from(sheet.split(',')[1], 'base64'));
await b.close();
console.log('drew', Object.keys(out).join(', '));
