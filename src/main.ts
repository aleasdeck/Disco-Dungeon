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
import { clearSeat, loadHost, loadSeat, newKey, saveHost, saveSeat, type HostSave } from './resume';
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

/**
 * The room is redrawn only as often as it needs, since redrawing every frame regardless is what heats phones:
 * about 60 times a second while something moves (a 120 Hz screen draws every other frame), 30 while the room
 * stands still and only torches and runes flicker (slow enough to look the same), and behind a full-screen
 * menu only when something changes. Milliseconds between drawn frames:
 */
const BUSY_GAP = 9.5, IDLE_GAP = 29;
/** `cleared`: the canvas was resized and is blank, draw right away; `stale`: the game changed, draw soon. */
let cleared = true, stale = true, drawnAt = -Infinity, drawnCam = '', drawnRoom: unknown = null;

function sizeCanvas() {
  const dpr = moving ? 1 : Math.min(window.devicePixelRatio || 1, dprCap);
  view = { w: window.innerWidth, h: window.innerHeight, dpr };
  cv.width = Math.round(view.w * dpr);
  cv.height = Math.round(view.h * dpr);
  cleared = true;
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
  if (open) {
    mapView.render(run, choosing);
    // on a short screen the map scrolls; bring the rooms to choose from into view
    document.querySelector('#map .mnode.reach, #map .mnode.cur')?.scrollIntoView({ block: 'center' });
  }
}

type Mode = 'menu' | 'solo' | 'host' | 'client';
/** 'menu' until a game starts; online the host runs the game and clients mirror it. */
let mode: Mode = 'menu';
const net = new Net();
/** Online: the lobby, and once the game starts, who plays which hero. */
let players: Player[] = [];
let started = false;
/** Host: something changed since the last snapshot. */
let dirty = false, lastSnap = 0, lastSave = 0;
/** This browser's secret for taking its seat back after a drop. */
let myKey = '';
/** Host: what the clients' waiting screen shows now, for players who rejoin. */
let lastScreen: HostSave['screen'] = { title: '', text: '' };
/** The room's result screen while it shows, so a reopened room can show it again. */
let ending: HostSave['ending'] = null;
/** Client: bumped to cancel a reconnect in progress. */
let reconnecting = 0;

const playerName = () => settings.name || 'Игрок';
const ownerOf = (i: number) => players.find(p => p.hero === i)?.id ?? 'host';
/** The players as the clients see them: without anyone's rejoin key. */
const pub = () => players.map(({ key: _key, ...p }) => p);

/** The waiting screen online clients see while the host is on the map or reading a room's result. */
function screen(title: string, text = '', win = false) {
  if (mode === 'host') { lastScreen = { title, text, win }; net.broadcast({ t: 'screen', title, text, win }); }
  if (mode === 'client') wait(title, text, false, win);
}

/** Show or hide the waiting screen on this browser; `away` is for a lost connection, which the player may give up on. */
function wait(title: string, text = '', away = false, win = false) {
  $('waitScreen').hidden = !title;
  victory($('waitScreen'), win && !!title);
  $('waitNote').textContent = win ? 'Хозяин комнаты вернёт всех в лобби.' : 'Хозяин комнаты выбирает, куда идти дальше.';
  $('waitTitle').textContent = title;
  $('waitText').innerHTML = text;
  $('waitNote').hidden = away || mode !== 'client';
  $('waitLeave').hidden = !away;
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
  hideEnd();
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

game.onChange = () => { hud.refresh(); dirty = true; stale = true; };
game.onRoomEnd = win => {
  const S = game.S, boss = S.spec.type === 'boss';
  const last = boss && run.floor === FLOORS - 1;
  setTimeout(() => {
    if (!win) return showEnd({ title: 'Отряд пал', text: `Забег окончен на этаже ${run.floor + 1}, сложность ${S.spec.depth}.`, kind: 'again' });
    if (last) {
      const left = game.alive().map(h => h.def.name).join(', ');
      return showEnd({ title: 'Вы победили!', kind: 'win',
        text: `Владыка кузни повержен, все три этажа позади. Комнат пройдено: ${run.path.reduce((a, p) => a + p.length, 0)}. Дошли до конца: ${left}.` });
    }
    if (boss) run.floor++;
    choosing = true;
    showEnd({ title: boss ? `Этаж ${run.floor} пройден` : 'Комната зачищена',
      text: `Ходов: ${S.turn}. Пройдено комнат: ${run.path.reduce((a, p) => a + p.length, 0)} из ${FLOORS * LAYERS}.`, kind: 'map' });
  }, 900);
};

/** The result of a room: on to the map, or (the run is over) a new run; online that means back to the lobby. */
function showEnd(e: NonNullable<HostSave['ending']>) {
  ending = e;
  $('roomEnd').hidden = false;
  victory($('roomEnd'), e.kind === 'win');
  $('endTitle').textContent = e.title;
  $('endText').textContent = e.text;
  $('endBtn').textContent = e.kind === 'map' ? 'К карте' : mode === 'host' ? 'В лобби' : 'Новый забег';
  $('endBtn').onclick = e.kind === 'map'
    ? () => { hideEnd(); showMap(true); screen('Выбор комнаты', 'Хозяин комнаты смотрит на карту забега.'); }
    : mode === 'host' ? backToLobby : () => startRun();
  screen(e.title, e.text, e.kind === 'win');
}

/** Dress a result screen up as the victory banner: a spinning disco ball and confetti falling over it. */
function victory(el: HTMLElement, on: boolean) {
  el.classList.toggle('win', on);
  el.querySelectorAll('.confetti').forEach(c => c.remove());
  if (!on) return;
  const cols = ['#d9b24a', '#d9733a', '#3fc4b6', '#b8323f', '#9a7bd9', '#f0e5d0'];
  for (let k = 0; k < 40; k++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.cssText = `left:${Math.random() * 100}%;background:${cols[k % cols.length]};animation-delay:${-Math.random() * 4}s;animation-duration:${3 + Math.random() * 3}s;--dx:${Math.random() * 80 - 40}px`;
    el.prepend(c);
  }
}

function hideEnd() {
  ending = null;
  $('roomEnd').hidden = true;
}

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
  hideEnd();
  openMenu();
});

// ------------------------------------------------------------ online

function leaveOnline() {
  reconnecting++;
  if (mode === 'host') net.broadcast({ t: 'bye' });
  if (net.active) net.close();
  clearSeat();
  players = [];
  started = false;
  wait('');
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
  net.broadcast({ t: 'lobby', players: pub() });
  lobbyView();
}

function backToLobby() {
  started = false;
  hideEnd();
  showMap(false);
  net.broadcast({ t: 'lobbyBack' });
  net.broadcast({ t: 'lobby', players: pub() });
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
  myKey = newKey();
  saveSeat({ code: net.code, key: myKey, host: true });
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
  net.broadcast({ t: 'start', players: pub() });
  setOnline('host');
  show(null);
  startRun(players.map(p => p.hero!).sort((a, b) => a - b));
});

/** Join a room; `key` takes back a seat this browser had before a crash or reload. */
async function join(code: string, key = newKey()) {
  if (code.length < 4) { lobbyStatus('Введи код комнаты.'); return; }
  lobbyStatus(key === myKey ? 'Возвращаюсь в игру…' : 'Подключаюсь…');
  try {
    await net.joinRoom(code);
  } catch (e) {
    lobbyStatus((e as Error).message);
    if (key === myKey) clearSeat();
    return;
  }
  lobbyStatus('');
  mode = 'client';
  myKey = key;
  saveSeat({ code: net.code, key, host: false });
  greet();
}

/** Client: say hello, and again every few seconds until the host answers (a hello can arrive before the host is ready). */
let answered = false;
function greet() {
  answered = false;
  const say = (left: number) => {
    if (answered || mode !== 'client' || !net.active || left <= 0) return;
    net.send({ t: 'hello', name: playerName(), key: myKey });
    setTimeout(() => say(left - 1), 3000);
  };
  say(10);
}

/** Client: the host is gone; keep trying the same room for a while, since the host may be coming back too. */
async function reconnect(code: string) {
  const my = ++reconnecting, until = Date.now() + 120_000;
  if (started) wait('Связь потеряна', 'Переподключаюсь к игре…', true);
  else lobbyStatus('Связь потеряна. Переподключаюсь…');
  while (Date.now() < until) {
    try {
      await net.joinRoom(code);
      if (my !== reconnecting) { net.close(); return; }
      greet();
      if (!started) lobbyStatus('');
      return;
    } catch {
      if (my !== reconnecting) return;
      await new Promise(r => setTimeout(r, 2000));
      if (my !== reconnecting) return;
    }
  }
  lost('Не удалось вернуться в игру: хозяин комнаты не отвечает.');
}

/** Client: give up on the room. */
function lost(text: string) {
  leaveOnline();
  showMap(false);
  hideEnd();
  resetLobby();
  show('lobby');
  lobbyStatus(text);
}

// a player is listed once they say hello; one who never does is let go
net.onJoin = id => setTimeout(() => { if (!players.some(p => p.id === id)) net.kick(id); }, 10_000);

/** Host: someone said hello. Their key either gives them their old seat back or they take a free one. */
function welcome(id: string, name: string, key: string) {
  name = name.slice(0, 16) || 'Игрок';
  const back = key ? players.find(p => p.key === key && p.id !== 'host') : undefined;
  if (back) {
    const old = back.id;
    Object.assign(back, { id, name });
    if (old !== id) net.kick(old);
    if (started) {
      net.sendTo(id, { t: 'start', players: pub() });
      net.sendTo(id, { t: 'screen', ...lastScreen });
      game.float(game.S.Wx / 2, 20, `${name} вернулся`, '#c7cbe0');
      setOnline('host');
      hud.buildAllies();
      hud.refresh();
      dirty = true;
    }
  } else if (started || players.length >= HEROES.length) {
    // three heroes, three seats; a game already under way takes no one new
    net.sendTo(id, { t: 'deny', text: started ? 'В этой комнате игра уже идёт.' : 'Комната заполнена.' });
    setTimeout(() => net.kick(id), 300);
    return;
  } else players.push({ id, name, hero: null, key });
  net.broadcast({ t: 'lobby', players: pub() });
  lobbyView();
}

net.onLeave = id => {
  if (!started) {
    players = players.filter(p => p.id !== id);
    net.broadcast({ t: 'lobby', players: pub() });
    lobbyView();
    return;
  }
  // mid-game the hero stays; the host plays it until its player comes back
  const p = players.find(o => o.id === id);
  if (!p) return;
  game.float(game.S.Wx / 2, 20, `${p.name} отключился`, '#c7cbe0');
  setOnline('host');
  hud.buildAllies();
  hud.refresh();
};

net.onLost = () => { if (mode === 'client') reconnect(net.code); };

net.onMsg = (from, m) => {
  if (mode === 'host') {
    if (m.t === 'hello') welcome(from, m.name, m.key);
    else if (m.t === 'pick') pick(from, m.hero);
    else if (m.t === 'act' && started && ownerOf(m.a.h) === from) game.perform(m.a);
    return;
  }
  answered = true;
  if (m.t === 'lobby') { players = m.players; lobbyView(); }
  else if (m.t === 'deny') lost(m.text);
  else if (m.t === 'bye') lost('Хозяин комнаты закрыл игру.');
  else if (m.t === 'start') {
    players = m.players;
    started = true;
    setOnline('client');
    show(null);
    screen('Начинаем', 'Хозяин комнаты выбирает первую комнату.');
  } else if (m.t === 'snap') {
    const ch = applySnapshot(game, m.s);
    stale = true;
    if (ch.party) hud.buildAllies();
    if (ch.room) controls.fit();
    hud.refresh();
  } else if (m.t === 'screen') screen(m.title, m.text, m.win);
  else if (m.t === 'lobbyBack') { started = false; wait(''); lobbyView(); show('lobby'); }
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

/** Remember the room in this browser every second or so, so a crash or reload can bring it back. */
function keepSeat(now: number) {
  if (!net.active || now - lastSave < 1000) return;
  lastSave = now;
  if (mode === 'client') { saveSeat({ code: net.code, key: myKey, host: false }); return; }
  if (mode !== 'host') return;
  saveSeat({ code: net.code, key: myKey, host: true });
  saveHost({
    code: net.code, players, started, run, choosing, mapInfo: mapView.info, ending, screen: lastScreen,
    snap: started && game.S ? snapshot(game) : null,
  });
}

/** Host after a crash or reload: open the same room again and carry on where the game was. */
async function reopen(code: string) {
  const s = loadHost();
  if (!s || s.code !== code) { clearSeat(); openMenu(); return; }
  show(null);
  // the game comes back first, so players who reconnect the moment the room opens find their seats
  // (everyone else is away until they rejoin; the host plays their heroes meanwhile)
  players = s.players;
  started = s.started;
  setOnline('host');
  if (started && s.snap) {
    run = s.run;
    choosing = s.choosing;
    mapView.info = s.mapInfo;
    applySnapshot(game, s.snap);
    setOnline('host');
    game.pickActiveParty();
    hud.buildAllies();
    hud.refresh();
    controls.fit();
    lastScreen = s.screen;
  }
  wait('Возвращаюсь в игру', 'Открываю комнату заново, игроки подключатся сами.');
  try {
    await net.hostRoom(code);
  } catch (e) {
    wait('');
    leaveOnline();
    openMenu();
    alert(`Не удалось вернуть комнату. ${(e as Error).message}`);
    return;
  }
  wait('');
  dirty = true;
  if (!started || !s.snap) { lobbyView(); show('lobby'); return; }
  if (s.ending) showEnd(s.ending);
  else if (choosing) showMap(true);
  else if (!game.liveMobs().length || !game.alive().length) game.onRoomEnd(game.alive().length > 0);
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
  keepSeat(now);
  const camKey = `${cam.panX},${cam.panY},${cam.zoom},${cam.rot}`;
  const changed = stale || camKey !== drawnCam || game.S !== drawnRoom || busy();
  const covered = document.querySelector('.overlay:not([hidden])') !== null;
  const gap = covered ? (changed ? IDLE_GAP : Infinity) : changed ? BUSY_GAP : IDLE_GAP;
  if (cleared || now - drawnAt >= gap) {
    scene.draw(ctx, cam, game, T, view, input.aim, input.carry);
    cleared = stale = false;
    drawnAt = now;
    drawnCam = camKey;
    drawnRoom = game.S;
  }
  requestAnimationFrame(frame);
}

/** Something on the field moves, fades or follows a finger right now. */
function busy() {
  if (anim || moving || input.aim || input.carry) return true;
  const S = game.S;
  return S.phase === 'resolve' || S.phase === 'enemy' || S.shake > 0 || S.sparks.length > 0 || S.floats.length > 0 || game.moving()
    || S.mobs.some(m => m.flash > 0 || m.born > 0 || (m.dead > 0 && m.dead <= 1))
    || S.heroes.some(h => h.flash > 0) || S.nodes.some(n => n.hit > 0);
}

applyQuality();
resize();
// a quiet room behind the main menu so the screen is never empty
game.loadRoom({ seed: Math.floor(Math.random() * 1e6), depth: 1, floor: 0, type: 'fight' });
controls.fit();
window.addEventListener('resize', resize);
// closing the tab tells the others right away instead of after the heartbeat timeout
window.addEventListener('pagehide', () => { if (net.active) net.close(); });
loadSprites(() => { hud.buildAllies(); hud.refresh(); stale = true; });
// a shared link (…#CODE) opens straight into that room's lobby; a room this browser dropped out of is rejoined
const linkCode = location.hash.slice(1).toUpperCase(), seat = loadSeat();
if (linkCode) history.replaceState(null, '', location.pathname + location.search);
if (seat && (!linkCode || linkCode === seat.code)) {
  myKey = seat.key;
  if (seat.host) reopen(seat.code);
  else {
    $<HTMLInputElement>('lobbyCode').value = seat.code;
    resetLobby();
    show('lobby');
    join(seat.code, seat.key);
  }
} else if (/^[A-Z0-9]{4,6}$/.test(linkCode)) {
  $<HTMLInputElement>('lobbyCode').value = linkCode;
  resetLobby();
  show('lobby');
  join(linkCode);
} else openMenu();
$('waitLeave').addEventListener('click', () => { leaveOnline(); hideEnd(); showMap(false); openMenu(); });
requestAnimationFrame(frame);

// handle for automated checks
Object.assign(window, { __dd: { game, cam, scene, ctx, net, get view() { return view; }, get run() { return run; }, get mode() { return mode; } } });
