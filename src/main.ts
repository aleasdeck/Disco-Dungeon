import './style.css';
import { COMBAT_ROOMS, ROOM_TYPES, WALL_H } from './data';
import { Camera } from './camera';
import { Game, newParty } from './game';
import { Input } from './input';
import { Hud } from './ui';
import { MapView } from './mapview';
import { SceneRenderer } from './draw/scene';
import { loadSprites } from './assets';
import { FLOORS, LAYERS, depthOf, newRun, nodeById, restRoom, type Run } from './run';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const cv = $<HTMLCanvasElement>('stage');
const ctx = cv.getContext('2d')!;
const cam = new Camera();
const game = new Game();
const hud = new Hud(game);
const mapView = new MapView();
const scene = new SceneRenderer();

let run: Run = newRun();
/** True while the party stands between rooms and must pick the next one. */
let choosing = true;
let view = { w: 0, h: 0, dpr: 1 };

// ------------------------------------------------------------ camera

/** Screen rectangle not covered by the top bar and the hero frame. */
function playRect() {
  const top = 50, fr = $('frame').getBoundingClientRect();
  const bottom = Math.max(0, view.h - fr.top) + 6;
  return { x: 0, y: top, w: view.w, h: Math.max(120, view.h - top - bottom) };
}

let anim: { from: number; to: number; t: number; cx: number; cy: number } | null = null;

const controls = {
  rotateBy(delta: number) {
    const [cx, cy] = controls.center();
    const from = anim ? anim.to : cam.rot;
    anim = { from, to: from + delta, t: 0, cx, cy };
  },
  zoomBy(k: number) {
    const [cx, cy] = controls.center();
    cam.zoomAt(k, cx, cy);
  },
  fit() {
    anim = null;
    // a tall phone screen fits the room better seen straight on, a wide one corner-first
    cam.setRot(view.h > view.w * 1.1 ? Math.PI / 4 : 0);
    cam.fit(game.S.Wx, game.S.Wy, WALL_H, playRect());
  },
  center(): [number, number] {
    const r = playRect();
    return [r.x + r.w / 2, r.y + r.h / 2];
  },
  changed() { movedAt = performance.now(); },
};

/** Highest canvas resolution allowed; lowered at run time when the device can't keep up. */
let dprCap = 2;

/** While the camera turns, zooms or pans, frames are drawn at one pixel per CSS pixel and sharpen again once it stops. */
let moving = false, movedAt = -1;

function sizeCanvas() {
  const dpr = moving ? 1 : Math.min(window.devicePixelRatio || 1, dprCap);
  view = { w: window.innerWidth, h: window.innerHeight, dpr };
  cv.width = Math.round(view.w * dpr);
  cv.height = Math.round(view.h * dpr);
}

function resize() {
  sizeCanvas();
  if (game.S) controls.fit();
}

const input = new Input(cv, cam, game, controls);

$('zoomIn').addEventListener('click', () => controls.zoomBy(1.25));
$('zoomOut').addEventListener('click', () => controls.zoomBy(0.8));
$('rotL').addEventListener('click', () => controls.rotateBy(-Math.PI / 4));
$('rotR').addEventListener('click', () => controls.rotateBy(Math.PI / 4));
$('camFit').addEventListener('click', () => controls.fit());

// ------------------------------------------------------------ run flow

function showMap(open: boolean) {
  $('mapScreen').hidden = !open;
  $('mapClose').hidden = choosing;
  if (open) { mapView.view = run.floor; mapView.render(run, choosing); }
}

function startRun() {
  run = newRun();
  game.party = newParty();
  hud.buildAllies();
  choosing = true;
  mapView.info = '';
  // a quiet room behind the map so the screen is never empty
  game.loadRoom({ seed: run.seed, depth: 1, floor: 0, type: 'fight' });
  controls.fit();
  $('roomEnd').hidden = true;
  showMap(true);
}

mapView.onChoose = id => {
  const f = run.floor, n = nodeById(run, f, id), depth = depthOf(f, n);
  run.path[f].push(id);
  if (COMBAT_ROOMS.includes(n.type)) {
    choosing = false;
    mapView.info = '';
    game.loadRoom({ seed: run.seed + depth * 97 + n.i, depth, floor: f, type: n.type });
    controls.fit();
    showMap(false);
  } else {
    mapView.info = `<b>${ROOM_TYPES[n.type].name}.</b> ${restRoom(n.type, game.party, run.seed + depth * 131)}`;
    hud.buildAllies();
    hud.refresh();
    showMap(true);
  }
};

game.onChange = () => hud.refresh();
game.onRoomEnd = win => {
  const S = game.S, boss = S.spec.type === 'boss';
  const last = boss && run.floor === FLOORS - 1;
  setTimeout(() => {
    $('roomEnd').hidden = false;
    if (!win) {
      $('endTitle').textContent = 'Отряд пал';
      $('endText').textContent = `Забег окончен на этаже ${run.floor + 1}, сложность ${S.spec.depth}.`;
      $('endBtn').textContent = 'Новый забег';
      $('endBtn').onclick = startRun;
      return;
    }
    if (last) {
      $('endTitle').textContent = 'Забег пройден!';
      $('endText').textContent = 'Король-в-короне повержен на последнем этаже.';
      $('endBtn').textContent = 'Новый забег';
      $('endBtn').onclick = startRun;
      return;
    }
    if (boss) run.floor++;
    choosing = true;
    $('endTitle').textContent = boss ? `Этаж ${run.floor} пройден` : 'Комната зачищена';
    $('endText').textContent = `Ходов: ${S.turn}. Пройдено комнат: ${run.path.reduce((a, p) => a + p.length, 0)} из ${FLOORS * LAYERS}.`;
    $('endBtn').textContent = 'К карте';
    $('endBtn').onclick = () => { $('roomEnd').hidden = true; showMap(true); };
  }, 900);
};

$('btnMap').addEventListener('click', () => showMap(true));
$('mapClose').addEventListener('click', () => showMap(false));
$('newRun').addEventListener('click', startRun);
$('btnHelp').addEventListener('click', () => { $('help').hidden = false; });
$('helpClose').addEventListener('click', () => { $('help').hidden = true; });

// ------------------------------------------------------------ loop

let last = performance.now(), T = 0, slow = 0;
function frame(now: number) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw);
  last = now;
  T += dt;
  // a device that keeps missing frames gets a coarser canvas, step by step, down to one pixel per CSS pixel
  if (moving) slow = 0;
  else if (raw < 0.5) slow = Math.max(0, slow + (raw > 1 / 40 ? raw : -raw / 2));
  if (slow > 1.5 && !moving && view.dpr > 1) { dprCap = Math.max(1, view.dpr - 0.5); slow = 0; sizeCanvas(); }
  if (anim) movedAt = now;
  const nowMoving = now - movedAt < 250;
  if (nowMoving !== moving) { moving = nowMoving; sizeCanvas(); }
  if (anim) {
    anim.t = Math.min(1, anim.t + dt / 0.28);
    const e = anim.t * anim.t * (3 - 2 * anim.t);
    cam.rotateAt(anim.from + (anim.to - anim.from) * e, anim.cx, anim.cy);
    if (anim.t >= 1) anim = null;
  }
  game.update(dt);
  scene.draw(ctx, cam, game, T, view, input.aim, input.carry);
  requestAnimationFrame(frame);
}

resize();
startRun();
window.addEventListener('resize', resize);
loadSprites(() => { hud.buildAllies(); hud.refresh(); });
try {
  if (!localStorage.getItem('dd-help-seen')) { $('help').hidden = false; localStorage.setItem('dd-help-seen', '1'); }
} catch { /* storage blocked: skip the first-run hint */ }
requestAnimationFrame(frame);

// handle for automated checks and the future netcode
Object.assign(window, { __dd: { game, cam, scene, ctx, get view() { return view; }, get run() { return run; } } });
