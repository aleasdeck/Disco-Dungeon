import './style.css';
import { COMBAT_ROOMS, HEROES, ROOM_TYPES, WALL_H } from './data';
import { Camera } from './camera';
import { Game, newBank, newParty } from './game';
import { Net, type Player } from './net';
import { applySnapshot, snapshot } from './sync';
import { saveSettings, settings } from './settings';
import { bindSettings, lobbyStatus, renderCollection, renderLobby, resetLobby, show } from './menu';
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

type Mode = 'menu' | 'solo' | 'host' | 'client';
/** 'menu' until a game starts; online the host runs the game and clients mirror it. */
let mode: Mode = 'menu';
const net = new Net();
/** Online: the lobby, and once the game starts, who plays which hero. */
let players: Player[] = [];
let started = false;
/** Host: something changed since the last snapshot. */
let dirty = false, lastSnap = 0;

const playerName = () => settings.name || 'Игрок';
const ownerOf = (i: number) => players.find(p => p.hero === i)?.id ?? 'host';

/** The waiting screen online clients see while the host is on the map or reading a room's result. */
function screen(title: string, text = '') {
  if (mode === 'host') net.broadcast({ t: 'screen', title, text });
  if (mode === 'client') { $('waitScreen').hidden = !title; $('waitTitle').textContent = title; $('waitText').innerHTML = text; }
}

function setOnline(m: Mode) {
  mode = m;
  game.online = m === 'host' || m === 'client';
  game.send = m === 'client' ? a => net.send({ t: 'act', a }) : null;
  const myHero = players.find(p => p.id === net.id)?.hero ?? null;
  game.canControl = m === 'client' ? h => h.i === myHero
    // the host also takes over heroes whose players left
    : m === 'host' ? h => ownerOf(h.i) === 'host' || !net.has(ownerOf(h.i))
    : () => true;
  if (myHero !== null) game.act = myHero;
  $('btnMap').hidden = m === 'client';
  $('newRun').hidden = m === 'client';
}

function startRun(picks?: number[]) {
  run = newRun();
  game.party = newParty(picks);
  game.bank = newBank();
  game.pickActiveParty();
  hud.buildAllies();
  choosing = true;
  mapView.info = '';
  // a quiet room behind the map so the screen is never empty
  game.loadRoom({ seed: run.seed, depth: 1, floor: 0, type: 'fight' });
  controls.fit();
  $('roomEnd').hidden = true;
  showMap(true);
  screen('Выбор комнаты', 'Хозяин комнаты смотрит на карту забега.');
}

function startCampaign() {
  leaveOnline();
  setOnline('solo');
  show(null);
  startRun();
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
    screen('');
  } else {
    mapView.info = `<b>${ROOM_TYPES[n.type].name}.</b> ${restRoom(n.type, game.party, game.bank, run.seed + depth * 131)}`;
    hud.buildAllies();
    hud.refresh();
    showMap(true);
    screen(ROOM_TYPES[n.type].name, mapView.info);
  }
};

game.onChange = () => { hud.refresh(); dirty = true; };
game.onRoomEnd = win => {
  const S = game.S, boss = S.spec.type === 'boss';
  const last = boss && run.floor === FLOORS - 1;
  const done = (title: string, text: string, btn: string, go: () => void) => {
    $('roomEnd').hidden = false;
    $('endTitle').textContent = title;
    $('endText').textContent = text;
    $('endBtn').textContent = btn;
    $('endBtn').onclick = go;
    screen(title, text);
  };
  // online, a finished run sends everyone back to the lobby to pick heroes again
  const again: [string, () => void] = mode === 'host' ? ['В лобби', backToLobby] : ['Новый забег', () => startRun()];
  setTimeout(() => {
    if (!win) return done('Отряд пал', `Забег окончен на этаже ${run.floor + 1}, сложность ${S.spec.depth}.`, ...again);
    if (last) return done('Забег пройден!', 'Король-в-короне повержен на последнем этаже.', ...again);
    if (boss) run.floor++;
    choosing = true;
    done(boss ? `Этаж ${run.floor} пройден` : 'Комната зачищена',
      `Ходов: ${S.turn}. Пройдено комнат: ${run.path.reduce((a, p) => a + p.length, 0)} из ${FLOORS * LAYERS}.`,
      'К карте', () => { $('roomEnd').hidden = true; showMap(true); screen('Выбор комнаты', 'Хозяин комнаты смотрит на карту забега.'); });
  }, 900);
};

$('btnMap').addEventListener('click', () => showMap(true));
$('mapClose').addEventListener('click', () => showMap(false));
$('newRun').addEventListener('click', () => startRun(mode === 'host' ? game.party.map(h => h.i) : undefined));
$('helpClose').addEventListener('click', () => { $('help').hidden = true; });

// ------------------------------------------------------------ menu

function openMenu() {
  $('mContinue').hidden = mode !== 'solo';
  show('menu');
}

$('mContinue').addEventListener('click', () => show(null));
$('mCampaign').addEventListener('click', startCampaign);
$('mOnline').addEventListener('click', () => { $<HTMLInputElement>('lobbyName').value = settings.name; resetLobby(); show('lobby'); });
$('mCollection').addEventListener('click', () => { renderCollection('heroes'); show('collection'); });
$('mSettings').addEventListener('click', () => { syncSettings(); show('settingsScreen'); });
document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => b.addEventListener('click', () => renderCollection(b.dataset.tab as 'heroes' | 'mobs')));
$('colBack').addEventListener('click', openMenu);
$('setBack').addEventListener('click', openMenu);
const syncSettings = bindSettings(() => { applyQuality(); sizeCanvas(); });

$('btnMenu').addEventListener('click', () => show('pause'));
$('pResume').addEventListener('click', () => show(null));
$('pHelp').addEventListener('click', () => { show(null); $('help').hidden = false; });
$('pMenu').addEventListener('click', () => {
  if (game.online && !confirm('Выйти из сетевой игры?')) return;
  leaveOnline();
  showMap(false);
  $('roomEnd').hidden = true;
  openMenu();
});

// ------------------------------------------------------------ online

function leaveOnline() {
  if (net.active) net.close();
  players = [];
  started = false;
  $('waitScreen').hidden = true;
  if (mode !== 'solo') setOnline('menu');
}

function lobbyView() {
  renderLobby({
    code: net.code, players, me: net.id, host: mode === 'host',
    onPick: hero => {
      if (mode === 'host') { pick('host', hero); return; }
      net.send({ t: 'pick', hero });
    },
  });
}

/** Host: a player picks a hero, if it is free. */
function pick(id: string, hero: number | null) {
  const p = players.find(o => o.id === id);
  if (!p || started) return;
  if (hero !== null && players.some(o => o.hero === hero && o.id !== id)) return;
  p.hero = hero;
  net.broadcast({ t: 'lobby', players });
  lobbyView();
}

function backToLobby() {
  started = false;
  $('roomEnd').hidden = true;
  showMap(false);
  net.broadcast({ t: 'lobbyBack' });
  net.broadcast({ t: 'lobby', players });
  lobbyView();
  show('lobby');
}

$('lobbyBack').addEventListener('click', () => { leaveOnline(); resetLobby(); openMenu(); });
$('lobbyName').addEventListener('input', () => { settings.name = $<HTMLInputElement>('lobbyName').value.trim(); saveSettings(); });
$('lobbyHost').addEventListener('click', async () => {
  lobbyStatus('Создаю комнату…');
  try {
    await net.hostRoom();
  } catch (e) {
    lobbyStatus((e as Error).message);
    return;
  }
  lobbyStatus('');
  players = [{ id: 'host', name: playerName(), hero: null }];
  started = false;
  setOnline('host');
  lobbyView();
});
$('lobbyJoin').addEventListener('click', () => join($<HTMLInputElement>('lobbyCode').value.trim()));
$('lobbyCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('lobbyJoin').click(); });
$('lobbyCopy').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}${location.search}#${net.code}`;
  navigator.clipboard?.writeText(url).then(() => lobbyStatus('Ссылка скопирована.'), () => lobbyStatus(url));
});
$('lobbyStartBtn').addEventListener('click', () => {
  if (!players.every(p => p.hero !== null)) return;
  started = true;
  net.broadcast({ t: 'start', players });
  setOnline('host');
  show(null);
  startRun(players.map(p => p.hero!).sort((a, b) => a - b));
});

async function join(code: string) {
  if (code.length < 4) { lobbyStatus('Введи код комнаты.'); return; }
  lobbyStatus('Подключаюсь…');
  try {
    await net.joinRoom(code);
  } catch (e) {
    lobbyStatus((e as Error).message);
    return;
  }
  lobbyStatus('');
  mode = 'client';
  net.send({ t: 'hello', name: playerName() });
}

net.onJoin = id => {
  // three heroes, three seats; a game already under way takes no one new
  if (started || players.length >= HEROES.length) { net.kick(id); return; }
  players.push({ id, name: 'Игрок', hero: null });
  net.broadcast({ t: 'lobby', players });
  lobbyView();
};

net.onLeave = id => {
  if (!started) {
    players = players.filter(p => p.id !== id);
    net.broadcast({ t: 'lobby', players });
    lobbyView();
    return;
  }
  // mid-game the hero stays; the host plays it from now on
  const p = players.find(o => o.id === id);
  if (p) game.float(game.S.Wx / 2, 20, `${p.name} вышел`, '#c7cbe0');
  setOnline('host');
  hud.buildAllies();
  hud.refresh();
};

net.onLost = () => {
  leaveOnline();
  showMap(false);
  $('roomEnd').hidden = true;
  resetLobby();
  show('lobby');
  lobbyStatus('Связь с хозяином комнаты потеряна.');
};

net.onMsg = (from, m) => {
  if (mode === 'host') {
    if (m.t === 'hello') {
      const p = players.find(o => o.id === from);
      if (p) p.name = m.name.slice(0, 16) || 'Игрок';
      net.broadcast({ t: 'lobby', players });
      lobbyView();
    } else if (m.t === 'pick') pick(from, m.hero);
    else if (m.t === 'act' && started && ownerOf(m.a.h) === from) game.perform(m.a);
    return;
  }
  if (m.t === 'lobby') { players = m.players; lobbyView(); }
  else if (m.t === 'start') {
    players = m.players;
    started = true;
    setOnline('client');
    show(null);
    screen('Начинаем', 'Хозяин комнаты выбирает первую комнату.');
  } else if (m.t === 'snap') {
    const ch = applySnapshot(game, m.s);
    if (ch.party) hud.buildAllies();
    if (ch.room) controls.fit();
    hud.refresh();
  } else if (m.t === 'screen') screen(m.title, m.text);
  else if (m.t === 'lobbyBack') { started = false; $('waitScreen').hidden = true; lobbyView(); show('lobby'); }
};

/** Host: send the game state to everyone, often while things move, and whenever something changed. */
function shareState(now: number) {
  if (mode !== 'host' || !started || !game.S) return;
  const busy = game.moving() || game.S.phase === 'resolve' || game.S.phase === 'enemy';
  if (!(dirty || busy) || now - lastSnap < 50) return;
  net.broadcast({ t: 'snap', s: snapshot(game) });
  dirty = false;
  lastSnap = now;
}

function applyQuality() {
  dprCap = settings.quality === 'low' ? 1 : 2;
}

// ------------------------------------------------------------ loop

let last = performance.now(), T = 0, slow = 0;
function frame(now: number) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw);
  last = now;
  T += dt;
  // a device that keeps missing frames gets a coarser canvas, step by step, down to one pixel per CSS pixel
  if (moving) slow = 0;
  else if (raw < 0.5) slow = Math.max(0, slow + (raw > 1 / 40 ? raw : -raw / 2));
  if (settings.quality === 'auto' && slow > 1.5 && !moving && view.dpr > 1) { dprCap = Math.max(1, view.dpr - 0.5); slow = 0; sizeCanvas(); }
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
  shareState(now);
  scene.draw(ctx, cam, game, T, view, input.aim, input.carry);
  requestAnimationFrame(frame);
}

applyQuality();
resize();
// a quiet room behind the main menu so the screen is never empty
game.loadRoom({ seed: Math.floor(Math.random() * 1e6), depth: 1, floor: 0, type: 'fight' });
controls.fit();
window.addEventListener('resize', resize);
// closing the tab tells the others right away instead of after the heartbeat timeout
window.addEventListener('pagehide', () => { if (net.active) net.close(); });
loadSprites(() => { hud.buildAllies(); hud.refresh(); });
// a shared link (…#CODE) opens straight into that room's lobby
const linkCode = location.hash.slice(1).toUpperCase();
if (/^[A-Z0-9]{4,6}$/.test(linkCode)) {
  history.replaceState(null, '', location.pathname + location.search);
  $<HTMLInputElement>('lobbyCode').value = linkCode;
  resetLobby();
  show('lobby');
  join(linkCode);
} else openMenu();
requestAnimationFrame(frame);

// handle for automated checks
Object.assign(window, { __dd: { game, cam, scene, ctx, net, get view() { return view; }, get run() { return run; }, get mode() { return mode; } } });
