// Run map overlay: the current floor's branching rooms as an SVG, climbing from the entrance at the bottom to the boss on top.

import { BIOMES, MOBS, ROOM_TYPES, type RoomType } from './data';
import type { HeroState } from './game';
import { uiArt } from './assets';
import { fillIcons, icon as ico } from './icons';
import { CASTS } from './room';
import { FLOORS, reachable, type Run } from './run';
import { faceUrl, mobFace } from './ui';

const NS = 'http://www.w3.org/2000/svg';
const $ = (id: string) => document.getElementById(id)!;

function icon(g: SVGGElement, type: RoomType, x: number, y: number) {
  const el = (tag: string, at: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const k in at) e.setAttribute(k, String(at[k]));
    g.appendChild(e);
    return e;
  };
  const st = { stroke: '#1a1210', 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  if (type === 'fight') {
    el('path', { d: `M${x - 7} ${y - 7}L${x + 6} ${y + 6}M${x + 7} ${y - 7}L${x - 6} ${y + 6}`, ...st, stroke: '#f3ead8', 'stroke-width': 2.6 });
    el('path', { d: `M${x - 7} ${y + 2}L${x - 2} ${y + 7}M${x + 7} ${y + 2}L${x + 2} ${y + 7}`, ...st, stroke: '#f3ead8', 'stroke-width': 2 });
  }
  if (type === 'elite') {
    el('circle', { cx: x, cy: y - 1, r: 7, fill: '#f3ead8', ...st });
    el('circle', { cx: x - 2.6, cy: y - 1.5, r: 1.8, fill: '#1a1210' });
    el('circle', { cx: x + 2.6, cy: y - 1.5, r: 1.8, fill: '#1a1210' });
    el('rect', { x: x - 3, y: y + 4, width: 6, height: 3, fill: '#f3ead8', ...st });
  }
  if (type === 'treasure') {
    el('path', { d: `M${x} ${y - 8}L${x + 7} ${y - 1}L${x} ${y + 8}L${x - 7} ${y - 1}Z`, fill: '#ffe07a', ...st });
    el('path', { d: `M${x - 7} ${y - 1}L${x + 7} ${y - 1}M${x} ${y - 8}L${x - 2} ${y - 1}L${x} ${y + 8}`, fill: 'none', ...st, 'stroke-width': 1 });
  }
  if (type === 'camp') {
    el('path', { d: `M${x} ${y - 9}C${x + 6} ${y - 3} ${x + 6} ${y + 5} ${x} ${y + 5}C${x - 6} ${y + 5} ${x - 6} ${y - 1} ${x - 2} ${y - 4}C${x - 1} ${y - 1} ${x + 1} ${y - 2} ${x} ${y - 9}Z`, fill: '#ffd34d', ...st });
    el('path', { d: `M${x - 7} ${y + 8}L${x + 7} ${y + 5}M${x + 7} ${y + 8}L${x - 7} ${y + 5}`, ...st, stroke: '#8a5a2b', 'stroke-width': 2.4 });
  }
  if (type === 'forge') el('path', { d: `M${x - 8} ${y - 4}L${x + 8} ${y - 4}L${x + 5} ${y}L${x + 2} ${y}L${x + 3} ${y + 6}L${x - 4} ${y + 6}L${x - 3} ${y}L${x - 6} ${y}Z`, fill: '#c7cbe0', ...st });
  if (type === 'event') {
    const t = el('text', { x, y: y + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: '#f3ead8', 'font-family': 'Oswald, sans-serif' });
    t.textContent = '?';
  }
  if (type === 'boss') el('path', { d: `M${x - 9} ${y + 6}L${x - 10} ${y - 6}L${x - 4} ${y - 1}L${x} ${y - 9}L${x + 4} ${y - 1}L${x + 10} ${y - 6}L${x + 9} ${y + 6}Z`, fill: '#ffd34d', ...st });
}

/** Map size in SVG units: tall, so a phone shows the whole floor without scrolling; the entrance sits under the first row. */
const W = 320, H = 672;
/** A painted room's radius in those units; the boss's face is a little bigger. */
const R_ROOM = 28, R_BOSS = 30;

/** Online: each player's face on the room they point at, and a line on how the vote stands. */
export interface MapVotes {
  pips: Record<string, { col: string; name: string; face: string }[]>;
  /** The room this player points at. */
  mine: string | null;
  note: string;
}

/** Who walks the map: the heroes (this screen's own first) and the party's ore. */
export interface MapParty {
  heroes: HeroState[];
  me: HeroState | null;
  ore: number;
}

const el = <K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, at: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, String(at[k]));
  parent.appendChild(e);
  return e;
};

export class MapView {
  info = '';
  onChoose: (id: string) => void = () => {};

  render(run: Run, canChoose: boolean, party: MapParty, votes?: MapVotes) {
    const f = run.floor, layers = run.floors[f];
    // the floor, and the whole run as three gems: done, here, ahead
    const dots = Array.from({ length: FLOORS }, (_, k) => `<i class="${k < f ? 'done' : k === f ? 'cur' : ''}"></i>`).join('');
    $('mapFloor').innerHTML = `Этаж ${f + 1}<em class="fl-dots" title="Этаж ${f + 1} из ${FLOORS}">${dots}</em><span>${BIOMES[f].name}</span>`;
    this.partyRow(party);
    const svg = $('map');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    // layer 0 at the bottom; rooms of a layer spread across, zigzagging a little so the paths read; a pair stands wider so its names don't touch
    const pos: Record<string, [number, number]> = {};
    layers.forEach((L, l) => L.forEach((n, i) => {
      pos[n.id] = [W / 2 + (i - (L.length - 1) / 2) * (L.length > 2 ? 104 : 124) + (l % 2 ? 8 : -8) * (L.length > 1 ? 1 : 0), H - 92 - l * ((H - 150) / (layers.length - 1))];
    }));
    const path = run.path[f], reach = canChoose ? reachable(run, f) : [], gate: [number, number] = [W / 2, H - 22];
    const gl = el(svg, 'g', {});
    const edge = (a: [number, number], b: [number, number], cls: string) =>
      el(gl, 'path', { d: `M${a[0]} ${a[1]}C${a[0]} ${(a[1] + b[1]) / 2} ${b[0]} ${(a[1] + b[1]) / 2} ${b[0]} ${b[1]}`, class: cls });
    // from the stairs to the first row; the way the party came glows, the rooms it passed by fade
    for (const n of layers[0]) edge(gate, pos[n.id], path[0] === n.id ? 'edge walked' : path.length ? 'edge past' : 'edge');
    for (const n of layers.flat()) for (const id of n.next) {
      const walked = path.includes(n.id) && path.indexOf(id) === path.indexOf(n.id) + 1;
      edge(pos[n.id], pos[id], walked ? 'edge walked' : n.l < path.length - 1 || (n.l === path.length - 1 && !path.includes(n.id)) ? 'edge past' : 'edge');
    }
    const st = el(svg, 'g', { class: 'gate' });
    el(st, 'path', { d: `M${gate[0] - 15} ${gate[1] + 8}h30l-4-6h-22zM${gate[0] - 11} ${gate[1] + 2}h22l-4-6h-14z` });
    for (const n of layers.flat()) {
      const [x, y] = pos[n.id], t = ROOM_TYPES[n.type], g = el(svg, 'g', {});
      const isR = reach.includes(n.id), isV = path.includes(n.id), isCur = path[path.length - 1] === n.id;
      const past = !isV && n.l < path.length;
      g.setAttribute('class', 'mnode' + (isR ? ' reach' : '') + (isV ? ' visited' : '') + (isCur ? ' cur' : '') + (past ? ' past' : '')
        + (isR && votes?.mine === n.id ? ' mine' : ''));
      g.dataset.id = n.id;
      const boss = n.type === 'boss', r = boss ? R_BOSS : R_ROOM, pic = boss ? undefined : uiArt.get('room_' + n.type);
      // what is in the room, for a mouse resting on it
      el(g, 'title', {}).textContent = `${t.name}. ${boss ? `${MOBS[CASTS[f].boss].name} со свитой.` : t.txt}`;
      if (pic) {
        // a painted room is its own token: no disc under it, and it glows instead of a ring when it can be picked
        g.classList.add('art');
        el(g, 'circle', { cx: x, cy: y, r: r + 4, class: 'hit' });
        el(g, 'image', { href: pic.src, x: x - r - 6, y: y - r - 8, width: r * 2 + 12, height: r * 2 + 12, class: 'mart' });
      } else {
        el(g, 'circle', { cx: x, cy: y, r: r + 6, class: 'halo' });
        el(g, 'circle', { cx: x, cy: y, r, fill: t.col, class: 'disc' });
      }
      if (boss) {
        // who waits at the top: the floor's boss in a round frame, a crown on top
        const clip = el(el(g, 'defs', {}), 'clipPath', { id: 'bossFace' });
        el(clip, 'circle', { cx: x, cy: y, r: r - 2 });
        el(g, 'image', { href: mobFace(CASTS[f].boss), x: x - r, y: y - r, width: r * 2, height: r * 2, 'clip-path': 'url(#bossFace)', preserveAspectRatio: 'xMidYMid slice' });
        el(g, 'circle', { cx: x, cy: y, r, class: 'rim' });
        el(g, 'path', { d: `M${x - 13} ${y - r + 4}L${x - 14} ${y - r - 10}L${x - 6} ${y - r - 3}L${x} ${y - r - 14}L${x + 6} ${y - r - 3}L${x + 14} ${y - r - 10}L${x + 13} ${y - r + 4}Z`, class: 'crown' });
      } else if (!pic) icon(g, n.type, x, y);
      el(g, 'text', { x, y: y + r + (pic ? 17 : 14), class: 'mlabel' }).textContent = t.name;
      // the players' heroes stand on the room's top rim, each face in its hero's colour
      const ps = votes?.pips[n.id] ?? [];
      ps.forEach((p, k) => {
        const px = x + (k - (ps.length - 1) / 2) * 24, py = y - r + 4, id = `pip${n.id}-${k}`;
        const pg = el(g, 'g', { class: 'pip' });
        el(pg, 'title', {}).textContent = p.name;
        el(el(el(pg, 'defs', {}), 'clipPath', { id }), 'circle', { cx: px, cy: py, r: 11 });
        el(pg, 'circle', { cx: px, cy: py, r: 13, fill: p.col });
        el(pg, 'image', { href: p.face, x: px - 11, y: py - 11, width: 22, height: 22, 'clip-path': `url(#${id})` });
      });
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', t.name + (isR ? '' : isV ? ', пройдена' : ''));
      // one tap goes in; online it is the player's vote, and the party goes once everyone tapped the same room
      g.addEventListener('click', () => { if (isR) this.onChoose(n.id); });
      g.addEventListener('keydown', e => { if (isR && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.onChoose(n.id); } });
    }
    // the party's token: the heroes' faces on the room they are in, or at the stairs before the first room
    const at = path.length ? pos[path[path.length - 1]] : gate, hs = party.heroes;
    const tok = el(svg, 'g', { class: 'token' });
    hs.forEach((h, k) => {
      const tx = at[0] + (k - (hs.length - 1) / 2) * 15, ty = at[1] - (path.length ? 2 : 8), id = 'tokFace' + k;
      const clip = el(el(tok, 'defs', {}), 'clipPath', { id });
      el(clip, 'circle', { cx: tx, cy: ty, r: 13 });
      el(tok, 'circle', { cx: tx, cy: ty, r: 15, fill: h.def.col, class: 'tk-rim' + (h === party.me ? ' me' : '') });
      el(tok, 'image', { href: faceUrl(h), x: tx - 13, y: ty - 13, width: 26, height: 26, 'clip-path': `url(#${id})`, opacity: h.hp > 0 ? 1 : 0.4 });
    });
    // only the result of a rest room shows here; the map itself needs no explaining
    $('mapInfo').innerHTML = this.info;
    $('mapInfo').hidden = !this.info;
    fillIcons($('mapInfo'));
    $('mapVotes').textContent = votes?.note ?? '';
    $('mapVotes').hidden = !votes;
  }

  /** The heroes' health and the party's ore over the map: enough to choose between a camp and a fight. */
  private partyRow(party: MapParty) {
    const box = $('mapParty');
    box.innerHTML = party.heroes.map(h => {
      const hp = Math.max(0, h.hp), pct = (hp / h.max) * 100;
      return `<div class="mp-hero${h.hp <= 0 ? ' dead' : ''}${h === party.me ? ' me' : ''}" style="--c:${h.def.col}" title="${h.def.name}: ${hp} из ${h.max}">`
        + `<img src="${faceUrl(h)}" alt=""><span class="mp-hp"><i style="width:${pct}%"></i><u>${h.hp > 0 ? `${hp}/${h.max}` : 'пал'}</u></span></div>`;
    }).join('') + `<div class="mp-ore" title="Руда отряда">${ico('ore')}<b>${party.ore}</b></div>`;
  }
}
