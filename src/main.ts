import './style.css';
import { BOOT_GAGS, COMBAT_ROOMS, HEROES, MAX_PLAYERS, WALL_H, forgeOre } from './data';
import { Camera } from './camera';
import { Game, newBank, newParty } from './game';
import { Net, type Player } from './net';
import { applySnapshot, snapshot, type MapState } from './sync';
import { saveSettings, settings } from './settings';
import { bindSettings, lobbyStatus, renderCollection, renderHeroSelect, renderLobby, renderStats, resetLobby, show, startable } from './menu';
import { Input } from './input';
import { Hud, faceUrl } from './ui';
import { hl } from './hl';
import { MapView, type MapParty, type MapVotes } from './mapview';
import { SceneRenderer } from './draw/scene';
import { loadAll } from './assets';
import { sound, type Track } from './sound';
import { clearSeat, keepKey, keyFor, loadHost, loadSeat, newKey, saveHost, saveSeat, type Ending, type HostSave } from './resume';
import { FLOORS, LAYERS, agreed, depthOf, newRun, nodeById, reachable, type Run, type Votes } from './run';
import { applyFx, canPick, eventDef, eventOf, rolled, type EventState } from './events';
import { EventView, type EventVotes } from './eventview';
import { campDo, campLeave, type CampPick, type CampState } from './camp';
import { CampView } from './campview';
import { lootAgreed, newLoot, settleLoot, type LootState } from './artifacts';
import { LootView, type LootVotes } from './lootview';
import { beginRun, endRun, playTime, saveStats, syncRun } from './stats';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const cv = $<HTMLCanvasElement>('stage');
const ctx = cv.getContext('2d')!;
const cam = new Camera();
const game = new Game();
const hud = new Hud(game);
const mapView = new MapView();
const evView = new EventView();
const campView = new CampView();
const lootView = new LootView();
const scene = new SceneRenderer();

let run: Run = newRun();
/** True while the party stands between rooms and must pick the next one. */
let choosing = true;
/** Online: the room each player points at (the host keeps the count, clients get a copy). */
let votes: Votes = {};
/** Client: the heroes whose players the host waits for. */
let voters: number[] = [];
/** The event the party stands in between the map and the next room; null anywhere else. */
let ev: EventState | null = null;
/** The seed of the event whose outcome this player has read and closed: the window stays shut for it. */
let evShut = -1;
/** The camp the party sits at; the map stays open behind it, and the party walks on once everyone voted for a room. */
let camp: CampState | null = null;
/** The seed of the camp this player has left for the map: its window stays shut. */
let campShut = -1;
/** Client: what this player asked the host to do at the camp, while the answer is on its way. */
let campAsked: CampPick | undefined;
/** The floor boss's trophies the party shares out after the fight; the map waits until they are shared. */
let loot: LootState | null = null;
/** The seed of the trophies this player has read and closed: the window stays shut for them. */
let lootShut = -1;
let view = { w: 0, h: 0, dpr: 1 };

// ------------------------------------------------------------ camera

/**
 * Screen rectangle the room is fitted into and held to: below the top bar, with a little margin all round. A panel across
 * most of the bottom (the hero frame on a narrow screen) is kept clear too; one in a corner only covers a corner of the room.
 */
function playRect() {
  const m = 10, top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 50) + m;
  const fr = document.getElementById('frame')?.getBoundingClientRect();
  const bottom = fr && fr.height && fr.width > view.w / 2 ? Math.max(0, view.h - fr.top) + m : m;
  return { x: m, y: top, w: Math.max(120, view.w - 2 * m), h: Math.max(120, view.h - top - bottom) };
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
 * about 60 times a second while something moves (a 120 Hz screen draws every other frame), 20 while the room
 * stands still and only torches, runes and the HUD's pulses flicker (slow enough to look the same), and behind a
 * full-screen menu only when something changes. Milliseconds between drawn frames:
 */
const BUSY_GAP = 9.5, IDLE_GAP = 45;
/** `cleared`: the canvas was resized and is blank, draw right away; `stale`: the game changed, draw soon. */
let cleared = true, stale = true, drawnAt = -Infinity, drawnCam = '', drawnRoom: unknown = null;
/** A full-screen menu or map is up: the HUD's pulses under it stand still (see `.covered` in style.css). */
let covering = false;

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

// ------------------------------------------------------------ run flow

function showMap(open: boolean) {
  // the blacksmith's screen stands in for the map until this player is done there
  if (hud.atForge) open = false;
  const was = !$('mapScreen').hidden;
  $('mapScreen').hidden = !open;
  $('mapClose').hidden = choosing;
  if (open) {
    mapView.render(run, choosing, mapParty(), mapVotes());
    // on a short screen the map scrolls; bring the rooms to choose from into view
    if (!was) document.querySelector('#map .mnode.reach, #map .mnode.cur')?.scrollIntoView({ block: 'center' });
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

/** A player who drops out mid-game is waited for this long before the others go on without them: a reload is back sooner. */
const GRACE = 30_000;
/** Host: when the player of each hero dropped out, while they are gone. */
const leftAt = new Map<number, number>();

/** Host: this player is at the table: connected, or dropped out only a moment ago and likely on their way back. */
const seated = (p: Player) => net.has(p.id) || (p.hero !== null && Date.now() - (leftAt.get(p.hero) ?? -GRACE) < GRACE);

/** Host: tell the game whose players are not at the table right now, so nobody waits for them. */
function seatAway() {
  if (mode !== 'host' || !started || !game.S) return;
  game.setAway(players.filter(p => p.hero !== null && p.id !== 'host' && !seated(p)).map(p => p.hero!).sort());
}

/** Host: whoever dropped out and isn't back yet stops holding the others up: the turn, a vote, the trophies go on without them. */
function goOn() {
  if (mode !== 'host' || !started) return;
  seatAway();
  hud.buildAllies();
  hud.refresh();
  // the others may already agree
  settle();
  if (ev && !ev.done) { const go = agreed(ev.votes, atTable()); if (go !== null) settleEvent(go); else shareMap(); }
  if (loot && !loot.done) { if (lootAgreed(loot, atTable())) shareLoot(); else shareMap(); }
}
const myHero = () => players.find(p => p.id === net.id)?.hero ?? null;
/** This screen's own hero: online the player's, alone the one hero of the campaign. */
const meHero = () => (game.online ? game.party.find(h => h.i === myHero()) ?? null : game.party[0] ?? null);
/** The players as the clients see them: without anyone's rejoin key. */
const pub = () => players.map(({ key: _key, ...p }) => p);

/** The waiting screen online clients see while the host is on the map or reading a room's result. */
function screen(title: string, text = '', win = false, lose = false) {
  if (mode === 'host') { lastScreen = { title, text, win, lose }; net.broadcast({ t: 'screen', title, text, win, lose }); }
  if (mode === 'client') wait(title, text, false, win, lose);
}

/** Show or hide the waiting screen on this browser; `away` is for a lost connection, which the player may give up on. */
function wait(title: string, text = '', away = false, win = false, lose = false) {
  $('waitScreen').hidden = !title;
  victory($('waitScreen'), win && !!title);
  $('waitScreen').classList.toggle('lose', lose);
  $('waitTitle').textContent = title;
  $('waitText').innerHTML = text;
  $('waitNote').hidden = away || mode !== 'client';
  $('waitLeave').hidden = !away;
}

function setOnline(m: Mode) {
  mode = m;
  game.online = m === 'host' || m === 'client';
  game.send = m === 'client' ? a => net.send({ t: 'act', a }) : null;
  const mine = myHero();
  game.canControl = m === 'client' ? h => h.i === mine
    // the host also takes over heroes whose players left
    : m === 'host' ? h => ownerOf(h.i) === 'host' || !net.has(ownerOf(h.i))
    : () => true;
  if (mine !== null) game.act = mine;
}

function startRun(picks?: number[]) {
  flushStats();
  run = newRun();
  game.party = newParty(picks, run.seed);
  const me = meHero();
  if (me) beginRun(run, me.def.key, mode === 'host');
  game.bank = newBank();
  game.pickActiveParty();
  hud.buildAllies();
  choosing = true;
  votes = {};
  ev = null;
  showEvent();
  camp = null;
  showCamp();
  loot = null;
  showLoot();
  // a quiet room behind the map so the screen is never empty
  game.loadRoom({ seed: run.seed, depth: 1, floor: 0, type: 'fight' });
  controls.fit();
  hideEnd();
  showMap(true);
  screen('');
  shareMap();
}

/** The campaign: one hero, picked on its own screen, goes through the whole run. */
function openHeroSelect() {
  const pick = (i: number) => { settings.hero = i; saveSettings(); renderHeroSelect(i, pick); };
  pick(HEROES[settings.hero] ? settings.hero : 0);
  show('heroSelect');
}

function startCampaign(hero: number) {
  leaveOnline();
  setOnline('solo');
  show(null);
  startRun([hero]);
}

/** Go into a room on the map. */
function choose(id: string) {
  const f = run.floor, n = nodeById(run, f, id), depth = depthOf(f, n);
  run.path[f].push(id);
  votes = {};
  // the party walks on, so the blacksmith's shop closes, and whoever did nothing at the camp has rested by the fire
  game.forge = 0;
  game.whet = false;
  if (camp) {
    campLeave(camp, game.party, game.bank);
    camp = null;
    showCamp();
  }
  // the boss's hoard stays behind on the last floor
  loot = null;
  showLoot();
  if (COMBAT_ROOMS.includes(n.type)) {
    choosing = false;
    game.loadRoom({ seed: run.seed + depth * 97 + n.i, depth, floor: f, type: n.type });
    controls.fit();
    showMap(false);
  } else if (n.type === 'forge') {
    // the blacksmith's gives the party 0 to 3 ore; everyone upgrades their own discs and goes back to the map when done
    game.gift = forgeOre(run.seed + depth * 131);
    game.bank.ore += game.gift;
    game.forge = depth;
    showMap(false);
    game.onChange();
  } else if (n.type === 'event') {
    // everyone reads the scene and the party takes one of its choices; the map waits until then
    const seed = run.seed + depth * 131, key = eventOf(seed, run.seen);
    (run.seen ??= []).push(key);
    ev = { key, seed, votes: {} };
    choosing = false;
    showMap(false);
    showEvent();
  } else {
    // the camp: every hero does one thing by the fire in its own window; the map waits behind it for the vote
    camp = { seed: run.seed + depth * 131, did: {} };
    showMap(false);
    showCamp();
  }
  shareMap();
}

/** The top strip stays in sight over the event's and the camp's windows: the heroes' health and the ore while deciding. */
function liftStrip() {
  const at = !$('eventScreen').hidden ? 'event' : !$('campScreen').hidden ? 'camp' : null;
  hud.setWindow(at && { floor: run.floor, type: at });
}

/** Show the camp window while the party sits at a camp, until this player leaves it for the map. */
function showCamp() {
  const open = !!camp && campShut !== camp.seed;
  $('campScreen').hidden = !open;
  liftStrip();
  if (!open) return;
  const mine = game.online ? myHero() : game.party[0]?.i ?? null, me = game.party.find(h => h.i === mine) ?? null;
  campView.render(camp!, me, game.party, game.online ? h => players.find(p => p.hero === h.i)?.name ?? h.def.name : undefined, campAsked);
}

// alone the pick is done at once; online the host does it and tells everyone
campView.onPick = pick => {
  if (!camp) return;
  const me = game.online ? myHero() : game.party[0]?.i ?? null;
  if (me === null) return;
  if (mode === 'client') {
    campAsked = pick;
    showCamp();
    net.send({ t: 'camp', pick });
  } else campPick(me, pick);
};
campView.onLeave = () => {
  if (camp) campShut = camp.seed;
  showCamp();
  showMap(true);
};

/** A hero does one thing by the fire; the host (or a lone player) does it and shows everyone what came of it. */
function campPick(hero: number, pick: CampPick) {
  const h = game.party.find(o => o.i === hero);
  if (camp && h && campDo(camp, h, pick, game.party, game.bank)) {
    hud.buildAllies();
    game.onChange();
    showCamp();
  }
  // a pick that came too late (a teammate got healed meanwhile) is answered too, so its player can pick again
  shareMap();
}

/** Show the event window while the party stands in an event, until this player has read its outcome and closed it. */
function showEvent() {
  const open = !!ev && !(ev.done && evShut === ev.seed);
  $('eventScreen').hidden = !open;
  liftStrip();
  if (open) evView.render(ev!, game.bank, game.party.length === 1, eventVotes());
}

// alone a tap takes the choice; online it is the player's vote, and the party takes it once everyone here picked it
evView.onPick = opt => {
  if (!ev || ev.done) return;
  const me = myHero();
  if (!game.online) settleEvent(opt);
  else if (me === null) return;
  else if (mode === 'host') evVote(me, opt);
  else {
    ev = { ...ev, votes: { ...ev.votes, [me]: opt } };
    showEvent();
    net.send({ t: 'evote', opt });
  }
};
evView.onLeave = () => {
  if (ev) evShut = ev.seed;
  showEvent();
  showMap(true);
  showLoot();
};

/** Host: a player points at one of the event's choices. */
function evVote(hero: number, opt: number) {
  if (!ev || ev.done || !eventDef(ev.key).choices[opt]) return;
  ev.votes[hero] = opt;
  const go = agreed(ev.votes, atTable());
  if (go !== null) settleEvent(go);
  else { showEvent(); shareMap(); }
}

/** Take a choice: pay for it, roll its toss-up, and do what comes of it to the party; then the map is open again. */
function settleEvent(opt: number) {
  if (!ev || ev.done) return;
  const c = eventDef(ev.key).choices[opt];
  if (!c || !canPick(c, game.bank)) return;
  const won = rolled(c, ev.seed, opt), out = won ? c.win : c.lose!;
  game.bank.ore -= c.pay ?? 0;
  applyFx(out.fx, game.party, game.bank, ev.seed);
  ev.done = { opt, won };
  // a trophy: the party shares out three before the map opens again, once the outcome is read
  const l = out.fx.some(f => f.k === 'art') ? newLoot(ev.seed * 7 + 3, run.floor, game.party) : null;
  if (l?.offer.length) loot = { ...l, from: ev.key };
  choosing = !loot;
  votes = {};
  hud.buildAllies();
  game.onChange();
  showEvent();
  showLoot();
  shareMap();
}

/** Online: whose face stands on which choice, and whom the party still waits for. Alone there is nothing to show. */
function eventVotes(): EventVotes | undefined {
  const table = mode === 'host' ? atTable() : mode === 'client' ? voters : [];
  if (!ev || table.length < 2) return undefined;
  const me = myHero(), cast = ev.votes;
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? HEROES[h].name;
  const faces: EventVotes['faces'] = {};
  for (const h of table) if (cast[h] !== undefined) (faces[cast[h]] ??= []).push({ col: HEROES[h].col, name: nameOf(h), me: h === me, face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => cast[h] === undefined).map(h => (h === me ? 'ты' : nameOf(h)));
  const note = idle.length === table.length ? 'Выбор общий: отряд сделает то, что нажмут все.'
    : idle.length ? `Ещё не выбрали: ${idle.join(', ')}.`
    : 'Голоса разошлись. Договоритесь и нажмите одно и то же.';
  return { faces, mine: me !== null ? cast[me] ?? null : null, note };
}

/**
 * Show the trophies' window while the party stands over the boss's hoard, until this player has read who got what and
 * closed it. An event's trophies wait until this player has read the event's outcome.
 */
function showLoot() {
  const open = !!loot && !(loot.done && lootShut === loot.seed) && !(loot.from && ev && evShut !== ev.seed);
  $('lootScreen').hidden = !open;
  if (!open) return;
  const mine = game.online ? myHero() : game.party[0]?.i ?? null, me = game.party.find(h => h.i === mine) ?? null;
  lootView.render(loot!, me, game.party, lootVotes(), game.online ? h => players.find(p => p.hero === h.i)?.name ?? h.def.name : undefined);
}

// alone a tap takes the trophy; online it points at the one the player wants, and they are shared out once no two want the same
lootView.onPick = opt => {
  if (!loot || loot.done) return;
  const me = game.online ? myHero() : game.party[0]?.i ?? null;
  if (me === null) return;
  if (mode === 'client') {
    loot = { ...loot, picks: { ...loot.picks, [me]: opt } };
    showLoot();
    net.send({ t: 'loot', opt });
  } else lootPick(me, opt);
};
lootView.onLeave = () => {
  if (loot) lootShut = loot.seed;
  showLoot();
  showMap(true);
};

/** The heroes whose players share the trophies out: online the ones here, alone the lone hero. */
const lootTable = () => (game.online ? atTable() : game.party.slice(0, 1).map(h => h.i));

/** Host (or a lone player): a player points at a trophy for their hero. */
function lootPick(hero: number, opt: number) {
  if (!loot || loot.done || loot.offer[opt] === undefined) return;
  loot.picks[hero] = opt;
  if (lootAgreed(loot, lootTable())) shareLoot();
  else { showLoot(); shareMap(); }
}

/** Hand the trophies out as picked (the heroes of players who dropped out get what is left); then the map is open again. */
function shareLoot() {
  if (!loot || loot.done) return;
  settleLoot(loot, game.party, lootTable());
  choosing = true;
  votes = {};
  hud.buildAllies();
  game.onChange();
  showLoot();
  shareMap();
}

/** Online: whose face stands on which trophy, and whom the share-out still waits for. Alone there is nothing to show. */
function lootVotes(): LootVotes | undefined {
  const table = mode === 'host' ? atTable() : mode === 'client' ? voters : [];
  if (!loot || table.length < 2) return undefined;
  const me = myHero(), picks = loot.picks;
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? HEROES[h].name;
  const faces: LootVotes['faces'] = {};
  for (const h of table) if (picks[h] !== undefined) (faces[picks[h]] ??= []).push({ col: HEROES[h].col, name: nameOf(h), me: h === me, face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => picks[h] === undefined).map(h => (h === me ? 'ты' : nameOf(h)));
  const clash = Object.values(faces).some(f => f.length > 1);
  const note = clash ? 'Двое тянут один трофей. Договоритесь, кому что.'
    : idle.length === table.length ? (table.length < loot.offer.length ? 'Каждый берёт свой трофей, лишний останется лежать.' : 'Каждый берёт свой трофей, один на двоих не взять.')
    : `Ещё не выбрали: ${idle.join(', ')}.`;
  return { faces, mine: me !== null ? picks[me] ?? null : null, note };
}

// alone a click on the map goes there; online it is a vote, and the party goes once everyone here picked the same room
mapView.onChoose = id => {
  const me = myHero();
  if (!game.online) choose(id);
  else if (me === null) return;
  else if (mode === 'host') vote(me, id);
  else {
    // the token moves at once; the host's count follows
    votes = { ...votes, [me]: id };
    showMap(true);
    net.send({ t: 'vote', id });
  }
};

/** Host: the heroes whose players are here to vote; the host plays the others, and they have no say. */
const atTable = () => players.filter(p => p.hero !== null && seated(p)).map(p => p.hero!);

/** Host: a player points at a room. */
function vote(hero: number, id: string) {
  if (!choosing || !reachable(run, run.floor).includes(id)) return;
  votes[hero] = id;
  settle();
}

/** Host: go where everyone here agreed, or show them all how the vote stands. */
function settle() {
  if (!choosing) return;
  const go = agreed(votes, atTable());
  if (go) choose(go);
  else shareMap();
}

/** Host: tell everyone where the party stands on the map, and show it on the host's own map too. */
function shareMap() {
  if (mode !== 'host' || !started) return;
  const m: MapState = { run, choosing, votes, voters: atTable(), ev, camp, loot };
  net.broadcast({ t: 'map', m });
  if (!$('mapScreen').hidden) showMap(true);
}

/** Who walks the map, this screen's own hero first, and the party's ore. */
function mapParty(): MapParty {
  const mine = game.online ? myHero() : game.party[0]?.i ?? null, me = game.party.find(h => h.i === mine) ?? null;
  return { heroes: me ? [me, ...game.party.filter(h => h !== me)] : game.party, me, ore: game.bank.ore };
}

/** Online: whose token stands on which room, and whom the party still waits for. Alone there is nothing to show. */
function mapVotes(): MapVotes | undefined {
  const table = mode === 'host' ? atTable() : mode === 'client' ? voters : [];
  if (!choosing || table.length < 2) return undefined;
  const me = myHero();
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? HEROES[h].name;
  const pips: MapVotes['pips'] = {};
  for (const h of table) if (votes[h]) (pips[votes[h]] ??= []).push({ hero: h, col: HEROES[h].col, name: nameOf(h), face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => !votes[h]).map(h => (h === me ? 'ты' : nameOf(h)));
  const note = idle.length === table.length ? 'Идём, когда все нажмут одну и ту же комнату.'
    : idle.length ? `Ещё не выбрали: ${idle.join(', ')}.`
    : 'Голоса разошлись. Договоритесь и нажмите одну комнату.';
  return { pips, mine: me !== null ? votes[me] ?? null : null, note };
}

game.onChange = () => { hud.refresh(); dirty = true; stale = true; };
game.onSound = (ev, p) => sound.play(ev, p);
// online every party head says whose hero it is
hud.nameOf = i => (game.online ? players.find(p => p.hero === i)?.name ?? null : null);
hud.me = meHero;
hl.changed = () => { dirty = true; };
game.onRoomEnd = win => {
  const S = game.S, boss = S.spec.type === 'boss';
  const last = boss && run.floor === FLOORS - 1;
  setTimeout(() => {
    if (!win || last) endRun(run, meHero(), win);
    if (!win) return showEnd({ title: game.party.length > 1 ? 'Отряд пал' : 'Герой пал', text: `Забег окончен на этаже ${run.floor + 1}, сложность ${S.spec.depth}.`, kind: 'again' });
    if (last) {
      const left = game.alive().map(h => h.def.name).join(', ');
      return showEnd({ title: 'Вы победили!', kind: 'win',
        text: `Владыка кузни повержен, все три этажа позади. Комнат пройдено: ${run.path.reduce((a, p) => a + p.length, 0)}.`
          + (game.party.length > 1 ? ` Дошли до конца: ${left}.` : '') });
    }
    if (boss) run.floor++;
    votes = {};
    // the floor's boss leaves trophies: the party shares them out before the map opens again
    if (boss) {
      const l = newLoot(run.seed + run.floor * 977 + S.spec.depth, S.spec.floor, game.party);
      if (l.offer.length) {
        loot = l;
        choosing = false;
        showLoot();
        shareMap();
        return;
      }
    }
    choosing = true;
    // the ore cave ends when its turns are up or everything in it is spent: it tells how much ore it gave
    const cave = game.cave(), rooms = `Пройдено комнат: ${run.path.reduce((a, p) => a + p.length, 0)} из ${FLOORS * LAYERS}.`;
    // the boss gave every hero back half their health as it fell (Game.bossHeal)
    const solo = game.party.length === 1 && game.party[0].def;
    const healed = !boss ? '' : solo ? `${solo.name} ${solo.fem ? 'восстановила' : 'восстановил'} половину здоровья. ` : 'Герои восстановили половину здоровья. ';
    const clean = game.clean ? `Без царапины: +${game.clean} руды. ` : '';
    // an elite pays a stat level for every hero, taken in the sharpening window the result screen leads to
    const elite = S.spec.type === 'elite';
    if (elite) game.sharpen(S.spec.depth);
    showEnd({ title: boss ? `Этаж ${run.floor} пройден` : cave ? (game.cleared() ? 'Пещера выбрана дочиста' : 'Ходы кончились') : elite ? 'Элита повержена' : 'Комната зачищена',
      text: cave ? `Добыто руды: ${game.mined}. ${rooms}` : `Ходов: ${S.turn}. ${healed}${clean}${elite ? 'Гном-кузнец бесплатно заточит каждому диск. ' : ''}${rooms}`,
      kind: 'map', next: elite ? 'whet' : undefined });
    shareMap();
  }, 900);
};

/** The result of a room: on to the map, or (the run is over) a new run; online that means back to the lobby. */
function showEnd(e: Ending) {
  ending = e;
  $('roomEnd').hidden = false;
  victory($('roomEnd'), e.kind === 'win');
  $('roomEnd').classList.toggle('lose', e.kind === 'again');
  $('endTitle').textContent = e.title;
  $('endText').textContent = e.text;
  $('endBtn').textContent = e.next === 'whet' ? 'К заточке' : e.kind === 'map' ? 'К карте' : mode === 'host' ? 'В лобби' : 'Новый забег';
  // after an elite the sharpening window is under the result screen: the map opens once the hero has taken its level
  $('endBtn').onclick = e.next === 'whet' ? () => { hideEnd(); hud.refresh(); }
    : e.kind === 'map' ? () => { hideEnd(); showMap(true); }
    : mode === 'host' ? backToLobby : openHeroSelect;
  // online every player reads a cleared room's result and walks to the map themselves; the end of the run waits for the host
  if (e.kind !== 'map') screen(e.title, e.text, e.kind === 'win', e.kind === 'again');
  else if (mode === 'host') net.broadcast({ t: 'end', e });
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

$('forgeDone').addEventListener('click', () => {
  hud.leaveForge();
  showMap(true);
});
$('btnMap').addEventListener('click', () => showMap(true));
$('mapClose').addEventListener('click', () => showMap(false));
$('helpClose').addEventListener('click', () => { $('help').hidden = true; });

// ------------------------------------------------------------ menu

function openMenu() {
  $('mContinue').hidden = mode !== 'solo';
  show('menu');
}

$('mContinue').addEventListener('click', () => show(null));
$('mCampaign').addEventListener('click', openHeroSelect);
$('heroBack').addEventListener('click', openMenu);
$('heroGo').addEventListener('click', () => startCampaign(settings.hero));
$('mOnline').addEventListener('click', () => { $<HTMLInputElement>('lobbyName').value = settings.name; resetLobby(); show('lobby'); });
$('mCollection').addEventListener('click', () => { renderCollection('heroes'); show('collection'); });
$('mStats').addEventListener('click', () => { flushStats(); renderStats(); show('statsScreen'); });
$('statsBack').addEventListener('click', openMenu);
/** The settings open from the main menu or from the pause menu in a game, and «Назад» goes back where they came from. */
let settingsFrom: 'menu' | 'pause' = 'menu';
function openSettings(from: typeof settingsFrom) {
  settingsFrom = from;
  syncSettings();
  show('settingsScreen');
}
$('mSettings').addEventListener('click', () => openSettings('menu'));
document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => b.addEventListener('click', () => renderCollection(b.dataset.tab as 'heroes' | 'mobs' | 'arts')));
$('colBack').addEventListener('click', openMenu);
$('setBack').addEventListener('click', () => (settingsFrom === 'pause' ? show('pause') : openMenu()));
const syncSettings = bindSettings(() => { applyQuality(); sizeCanvas(); });

$('btnMenu').addEventListener('click', () => show('pause'));
$('pResume').addEventListener('click', () => show(null));
$('pSettings').addEventListener('click', () => openSettings('pause'));
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
  flushStats();
  reconnecting++;
  // a client thrown out of the blacksmith's would keep the shop on screen over the menu
  if (game.forge) { game.forge = 0; game.whet = false; hud.refresh(); }
  if (mode === 'host') net.broadcast({ t: 'bye' });
  if (net.active) net.close();
  clearSeat();
  players = [];
  leftAt.clear();
  started = false;
  wait('');
  if (mode !== 'solo') { setOnline('menu'); ev = null; showEvent(); camp = null; showCamp(); loot = null; showLoot(); }
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

/** Host: a player picks a hero, if it is free; one who changes their hero has to press «Готов» again. */
function pick(id: string, hero: number | null) {
  const p = players.find(o => o.id === id);
  if (!p || started) return;
  if (hero !== null && players.some(o => o.hero === hero && o.id !== id)) return;
  if (p.hero !== hero) p.ready = false;
  p.hero = hero;
  net.broadcast({ t: 'lobby', players: pub() });
  lobbyView();
}

/** Host: a player presses «Готов» or takes it back; only with a hero picked. */
function readyUp(id: string, on: boolean) {
  const p = players.find(o => o.id === id);
  if (!p || started || p.id === 'host') return;
  p.ready = on && p.hero !== null;
  net.broadcast({ t: 'lobby', players: pub() });
  lobbyView();
}

function backToLobby() {
  started = false;
  // a new run asks everyone for their «Готов» again
  for (const p of players) p.ready = false;
  ev = null;
  showEvent();
  loot = null;
  showLoot();
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
  // a room of one's own: a seat still being tried after a reload is given up
  reconnecting++;
  if (mode === 'client') setOnline('menu');
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
  if (!startable(players)) return;
  started = true;
  net.broadcast({ t: 'start', players: pub() });
  setOnline('host');
  show(null);
  startRun(players.map(p => p.hero!).sort((a, b) => a - b));
});

$('lobbyReadyBtn').addEventListener('click', () => {
  if (mode !== 'client' || myHero() === null) return;
  net.send({ t: 'ready', on: !players.find(p => p.id === net.id)?.ready });
});

/**
 * Join a room. A browser that was in it lately comes back with its old key and gets its hero back; `seat` is the key a
 * reload or crash left behind, and then the room is tried for a while, as the network may take a moment to come back.
 */
async function join(code: string, seat?: string) {
  if (code.length < 4) { lobbyStatus('Введи код комнаты.'); return; }
  code = code.toUpperCase();
  const old = seat ?? keyFor(code), my = ++reconnecting;
  myKey = old ?? newKey();
  lobbyStatus(old ? 'Возвращаюсь в игру…' : 'Подключаюсь…');
  try {
    await net.joinRoom(code);
  } catch (e) {
    if (my !== reconnecting) return;
    // one failed try right after a reload doesn't give the seat up
    if (seat) { mode = 'client'; reconnect(code); return; }
    lobbyStatus((e as Error).message);
    return;
  }
  lobbyStatus('');
  mode = 'client';
  saveSeat({ code: net.code, key: myKey, host: false });
  keepKey(net.code, myKey);
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
      keepKey(code, myKey);
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

/**
 * Host: someone said hello. Their key either gives them their old seat back or they take a free one. Mid-game a player
 * whose browser lost its key (or who came back on another device) takes a hero whose player is away, by name if one fits.
 */
function welcome(id: string, name: string, key: string) {
  name = name.slice(0, 16) || 'Игрок';
  const away = started ? players.filter(p => p.id !== 'host' && p.hero !== null && !net.has(p.id)) : [];
  const back = (key ? players.find(p => p.key === key && p.id !== 'host') : undefined) ?? away.find(p => p.name === name) ?? away[0];
  if (back) {
    const old = back.id;
    Object.assign(back, { id, name, key });
    // in the lobby a player who comes back says «Готов» anew
    if (!started) back.ready = false;
    if (old !== id) net.kick(old);
    if (started) {
      net.sendTo(id, { t: 'start', players: pub() });
      // everyone hears they are back at the table: the vote now waits for them too
      shareMap();
      net.sendTo(id, { t: 'screen', ...lastScreen });
      if (ending?.kind === 'map') net.sendTo(id, { t: 'end', e: ending });
      game.float(game.S.Wx / 2, 20, `${name} вернулся`, '#c7cbe0');
      if (back.hero !== null) leftAt.delete(back.hero);
      setOnline('host');
      seatAway();
      hud.buildAllies();
      hud.refresh();
      dirty = true;
    }
  } else if (started || players.length >= MAX_PLAYERS) {
    // three seats at the table; a game already under way takes no one new
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
  // mid-game the hero stays; the host may play it until its player comes back, and the others wait a little for them
  const p = players.find(o => o.id === id);
  if (!p) return;
  game.float(game.S.Wx / 2, 20, `${p.name} отключился`, '#c7cbe0');
  if (p.hero !== null) leftAt.set(p.hero, Date.now());
  setOnline('host');
  hud.buildAllies();
  hud.refresh();
  setTimeout(goOn, GRACE + 100);
};

net.onLost = () => { if (mode === 'client') reconnect(net.code); };

net.onMsg = (from, m) => {
  if (mode === 'host') {
    if (m.t === 'hello') welcome(from, m.name, m.key);
    else if (m.t === 'pick') pick(from, m.hero);
    else if (m.t === 'ready') readyUp(from, m.on);
    else if (m.t === 'vote' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) vote(h, m.id); }
    else if (m.t === 'evote' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) evVote(h, m.opt); }
    else if (m.t === 'camp' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) campPick(h, m.pick); }
    else if (m.t === 'loot' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) lootPick(h, m.opt); }
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
    wait('');
  } else if (m.t === 'map') {
    const went = choosing && !m.m.choosing;
    ({ run, choosing, votes, voters } = m.m);
    const mine = myHero();
    if (started && mine !== null) beginRun(run, HEROES[mine].key, true);
    ev = m.m.ev ?? null;
    camp = m.m.camp ?? null;
    loot = m.m.loot ?? null;
    campAsked = undefined;
    showEvent();
    showCamp();
    // the boss's trophies take the room's result screen's place
    if (loot) hideEnd();
    showLoot();
    // the party agreed on a fight and walks in; at the camp its window stands in for the map until this player leaves
    // it; otherwise the map shows the vote as it stands
    if (went || !$('campScreen').hidden) { if (went) hideEnd(); showMap(false); }
    else if ((choosing && $('roomEnd').hidden) || !$('mapScreen').hidden) showMap(true);
  } else if (m.t === 'end') showEnd(m.e);
  else if (m.t === 'snap') {
    const shop = hud.atForge;
    const ch = applySnapshot(game, m.s);
    stale = true;
    if (ch.party) hud.buildAllies();
    if (ch.room) controls.fit();
    hud.refresh();
    // health and ore by the fire come with the game state: the camp window and the map's party row show them
    if (camp) { showCamp(); if (!$('mapScreen').hidden) showMap(true); }
    // the party walked into the blacksmith's: the shop takes the map's place
    if (!shop && hud.atForge) showMap(false);
  } else if (m.t === 'screen') {
    // the host's word that the run is over: the last boss fell, or the whole party did
    if (started && (m.win || m.lose)) endRun(run, meHero(), !!m.win);
    screen(m.title, m.text, m.win, m.lose);
  }
  else if (m.t === 'lobbyBack') { started = false; ev = null; showEvent(); camp = null; showCamp(); loot = null; showLoot(); wait(''); hideEnd(); showMap(false); lobbyView(); show('lobby'); }
};

/** Host: send the game state to everyone, often while things move, and whenever something changed. */
function shareState(now: number) {
  if (mode !== 'host' || !started || !game.S) return;
  const busy = game.moving() || game.hopping() || game.S.phase === 'resolve' || game.S.phase === 'enemy';
  if (!(dirty || busy) || now - lastSnap < 50) return;
  net.broadcast({ t: 'snap', s: { ...snapshot(game), cues: game.recentCues() } });
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
    code: net.code, players, started, run, choosing, votes, ev, camp, loot, ending, screen: lastScreen,
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
    votes = s.votes ?? {};
    ev = s.ev ?? null;
    camp = s.camp ?? null;
    loot = s.loot ?? null;
    applySnapshot(game, s.snap);
    setOnline('host');
    const mine = myHero();
    if (mine !== null) beginRun(run, HEROES[mine].key, true);
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
  if (!started || !s.snap) {
    // a player who doesn't come back to the lobby is let go, so the start doesn't wait for their «Готов»
    setTimeout(() => {
      if (mode !== 'host' || started || players.every(p => net.has(p.id))) return;
      players = players.filter(p => net.has(p.id));
      net.broadcast({ t: 'lobby', players: pub() });
      lobbyView();
    }, 15_000);
    lobbyView();
    show('lobby');
    return;
  }
  // players get a moment to find their seats again; whoever is still missing after it stops holding the others up
  for (const p of players) if (p.id !== 'host' && p.hero !== null) leftAt.set(p.hero, Date.now());
  seatAway();
  setTimeout(goOn, GRACE + 100);
  if (s.ending) showEnd(s.ending);
  else if (camp) showCamp();
  else if (loot) { showEvent(); showLoot(); if (choosing) showMap(true); }
  else if (choosing) showMap(true);
  else if (ev) showEvent();
  else if (game.cleared() || game.S.phase === 'over' || !game.alive().length) game.onRoomEnd(game.alive().length > 0);
}

/** The main menu and its screens; the settings count among them when opened from the main menu, not from a game. */
const MENU_SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'statsScreen'];
const inMenu = () => MENU_SCREENS.some(id => !$(id).hidden) || (settingsFrom === 'menu' && !$('settingsScreen').hidden);

/** What plays now: the funk in the main menu, a floor's fight tune in a fight, the lounge everywhere else. */
function track(): Track | null {
  if (!booted) return null;
  if (inMenu()) return 'menu';
  const S = game.S;
  if (mode !== 'menu' && !choosing && COMBAT_ROOMS.includes(S.spec.type) && S.phase !== 'over') return `fight${Math.min(2, S.spec.floor)}`;
  return 'calm';
}

// ------------------------------------------------------------ statistics

/** A player who hasn't touched the game for this long has walked away: the run's time stops until they are back. */
const AWAY_MS = 5 * 60 * 1000;
let touchedAt = performance.now(), statsAt = 0;
for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(ev, () => { touchedAt = performance.now(); }, { capture: true, passive: true });

/** Put what the run has come to so far into the statistics and write them down. */
function flushStats() {
  syncRun(run, meHero(), choosing);
  saveStats();
}

/** The run's time goes on while it is on screen and the player is at it; its numbers are written down every couple of seconds. */
function countStats(now: number, raw: number) {
  if (mode !== 'solo' && !(started && (mode === 'host' || mode === 'client'))) return;
  if (!document.hidden && now - touchedAt < AWAY_MS && !inMenu()) playTime(run, Math.min(raw, 1));
  // a client's discs still rolling may run ahead of the host's count for a moment: the numbers wait until they stop
  if (now - statsAt < 2000 || game.moving()) return;
  statsAt = now;
  flushStats();
}

/**
 * The HUD's pulses (a hatched blow about to land, the full gem, the lit turn button…) beat with the room's redraws,
 * at most 20 times a second: each is 0 to 1 and back over its period in seconds, as --p09, --p14 and --p16 on the
 * pieces that pulse (see style.css). A CSS animation of their own would have the phone redraw the whole screen 60 or
 * 120 times a second while the room stands still at 20; with the motion turned off in the system they stand still.
 */
const PULSES: [string, number][] = [['--p09', 0.9], ['--p14', 1.4], ['--p16', 1.6]];
const pulsed = ['allies', 'fHpWrap', 'fSpk', 'abBtn', 'turnBtn'].map(id => $(id));
const stillMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let pulsedAt = -Infinity;
function pulse(t: number) {
  if (stillMotion || Math.abs(t - pulsedAt) < IDLE_GAP / 1000) return;
  pulsedAt = t;
  for (const [k, per] of PULSES) {
    const v = (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / per)).toFixed(2);
    for (const el of pulsed) el.style.setProperty(k, v);
  }
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
  const t = track();
  sound.music(t);
  sound.muffle(t?.startsWith('fight') === true && game.S.phase === 'enemy');
  shareState(now);
  keepSeat(now);
  countStats(now, raw);
  const camKey = `${cam.panX},${cam.panY},${cam.zoom},${cam.rot}`;
  const changed = stale || camKey !== drawnCam || game.S !== drawnRoom || busy();
  const covered = document.querySelector('.overlay:not([hidden])') !== null;
  if (covered !== covering) { covering = covered; document.documentElement.classList.toggle('covered', covered); }
  const gap = covered ? (changed ? IDLE_GAP : Infinity) : changed ? BUSY_GAP : IDLE_GAP;
  if (cleared || now - drawnAt >= gap) {
    scene.draw(ctx, cam, game, T, view, input.aim, input.carry);
    pulse(T);
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
    || S.mobs.some(m => m.flash > 0 || m.born > 0 || m.knock || (m.dead > 0 && m.dead <= 1))
    || S.heroes.some(h => h.flash > 0 || h.knock || h.from) || S.nodes.some(n => n.hit > 0);
}

applyQuality();
resize();
// a quiet room behind the main menu so the screen is never empty
game.loadRoom({ seed: Math.floor(Math.random() * 1e6), depth: 1, floor: 0, type: 'fight' });
controls.fit();
window.addEventListener('resize', resize);
// closing the tab tells the others right away instead of after the heartbeat timeout
window.addEventListener('pagehide', () => { flushStats(); if (net.active) net.close(); });
// a phone may kill a page in the background without a pagehide
document.addEventListener('visibilitychange', () => { if (document.hidden) flushStats(); });

// ------------------------------------------------------------ start

/** How long each gag stays on the loading screen, in ms. */
const GAG_TIME = 2800;
/** The loading screen is gone. */
let booted = false;

// the loading screen's gags, in a fresh order each time, faded from one to the next
const gags = BOOT_GAGS.slice();
for (let i = gags.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [gags[i], gags[j]] = [gags[j], gags[i]];
}
let gagAt = 0;
$('bootGag').textContent = gags[0];
const gagTimer = setInterval(() => {
  const note = $('bootGag');
  note.classList.add('out');
  setTimeout(() => { note.textContent = gags[(gagAt = (gagAt + 1) % gags.length)]; note.classList.remove('out'); }, 300);
}, GAG_TIME);

/** Leaves the loading screen for the menu, or for the lobby of a shared link or a room this browser dropped out of. */
function start() {
  if (booted) return;
  booted = true;
  $('boot').hidden = true;
  clearInterval(gagTimer);
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
}

// every picture and font before the menu, so nothing loads mid-game
loadAll(part => {
  const pct = Math.round(part * 100);
  $('bootFill').style.width = pct + '%';
  $('bootBar').setAttribute('aria-valuenow', String(pct));
}).then(() => {
  hud.buildAllies();
  hud.refresh();
  stale = true;
  start();
  // the offline cache, filled once the game has what it needs, so the two don't share the first download
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
});
$('waitLeave').addEventListener('click', () => { leaveOnline(); hideEnd(); showMap(false); openMenu(); });
requestAnimationFrame(frame);

// handle for automated checks
Object.assign(window, { __dd: { game, cam, hud, scene, ctx, net, sound, choose, get view() { return view; }, get run() { return run; }, get mode() { return mode; }, get ev() { return ev; }, get camp() { return camp; }, get loot() { return loot; } } });
