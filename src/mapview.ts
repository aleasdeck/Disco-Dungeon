// Run map overlay: the current floor's branching rooms as an SVG, climbing from the entrance at the bottom to the boss on top.

import { BIOMES, ROOM_TYPES, type RoomType } from './data';
import { reachable, type Run } from './run';

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

/** Map size in SVG units: tall, so a phone shows the whole floor without scrolling. */
const W = 320, H = 560;

export class MapView {
  info = '';
  onChoose: (id: string) => void = () => {};

  render(run: Run, canChoose: boolean) {
    const f = run.floor, layers = run.floors[f];
    $('mapFloor').innerHTML = `Этаж ${f + 1} <span>${BIOMES[f].name}</span>`;
    const svg = $('map');
    svg.innerHTML = '';
    // layer 0 at the bottom; rooms of a layer spread across, zigzagging a little so the paths read
    const pos: Record<string, [number, number]> = {};
    layers.forEach((L, l) => L.forEach((n, i) => {
      pos[n.id] = [W / 2 + (i - (L.length - 1) / 2) * 104 + (l % 2 ? 8 : -8) * (L.length > 1 ? 1 : 0), H - 46 - l * ((H - 104) / (layers.length - 1))];
    }));
    const path = run.path[f], reach = canChoose ? reachable(run, f) : [];
    const gl = document.createElementNS(NS, 'g');
    svg.appendChild(gl);
    for (const n of layers.flat()) for (const id of n.next) {
      const [x1, y1] = pos[n.id], [x2, y2] = pos[id];
      const walked = path.includes(n.id) && path.indexOf(id) === path.indexOf(n.id) + 1;
      const ln = document.createElementNS(NS, 'path');
      ln.setAttribute('d', `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
      ln.setAttribute('class', walked ? 'edge walked' : 'edge');
      gl.appendChild(ln);
    }
    for (const n of layers.flat()) {
      const [x, y] = pos[n.id], t = ROOM_TYPES[n.type], g = document.createElementNS(NS, 'g');
      const isR = reach.includes(n.id), isV = path.includes(n.id), isCur = path[path.length - 1] === n.id;
      g.setAttribute('class', 'mnode' + (isR ? ' reach' : '') + (isV ? ' visited' : '') + (isCur ? ' cur' : ''));
      const boss = n.type === 'boss';
      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('cx', String(x)); halo.setAttribute('cy', String(y)); halo.setAttribute('r', boss ? '30' : '25'); halo.setAttribute('class', 'halo');
      g.appendChild(halo);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', boss ? '24' : '19'); c.setAttribute('fill', t.col); c.setAttribute('class', 'disc');
      g.appendChild(c);
      icon(g, n.type, x, y);
      const lb = document.createElementNS(NS, 'text');
      lb.setAttribute('x', String(x)); lb.setAttribute('y', String(y + (boss ? 38 : 33))); lb.setAttribute('class', 'mlabel');
      lb.textContent = t.name;
      g.appendChild(lb);
      if (isR) {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', t.name);
        g.addEventListener('click', () => this.onChoose(n.id));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onChoose(n.id); } });
      }
      svg.appendChild(g);
    }
    // only the result of a rest room shows here; the map itself needs no explaining
    $('mapInfo').innerHTML = this.info;
    $('mapInfo').hidden = !this.info;
  }
}
