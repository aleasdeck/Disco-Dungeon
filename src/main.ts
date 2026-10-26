import './style.css';
import { AB_COST, BOOT_GAGS, COMBAT_ROOMS, HEROES, MAX_PLAYERS, MOBS, RISE_HP, WALL_H, forgeOre, type MobKind } from './data';
import { Camera } from './camera';
import { Game, newBank, newParty, newTally, type HeroState } from './game';
import { Net, type Player } from './net';
import { applySnapshot, snapshot, type MapState } from './sync';
import { saveSettings, settings } from './settings';
import { bindSettings, campPhotoBg, lobbyStatus, renderHeroSelect, renderLobby, renderStats, resetLobby, show, startable } from './menu';
import { Input } from './input';
import { Hud, faceUrl, mobFace } from './ui';
import { hl } from './hl';
import { MapView, type MapParty, type MapVotes } from './mapview';
import { SceneRenderer } from './draw/scene';
import { assetUrl, loadAll } from './assets';
import { BACKDROP_COUNT } from './photo';
import { sound, type Track } from './sound';
import { CAMPAIGN, clearCampaign, clearSeat, keepKey, keyFor, loadCampaign, loadHost, loadSeat, newKey, saveCampaign, saveHost, saveSeat, type Ending, type HostSave } from './resume';
import { bossOf } from './room';
import { FLOORS, LAYERS, agreed, depthOf, newRun, nodeById, reachable, roomSeed, type Run, type Votes } from './run';
import { choicesOf, cupPick, doneOf, eventOf, heroPick, sellDone, sellPick, sellersLeft, stageOf, take, type EventState, type Table } from './events';
import { EventView, type EventVotes } from './eventview';
import { campDo, campLeave, newCamp, type CampPick, type CampState } from './camp';
import { CampView } from './campview';
import { PASS, UNDO, lootAgreed, lootDone, lootFor, newLoot, settleLoot, takeKept, type ArtKey, type LootState } from './artifacts';
import { LootView, type LootVotes } from './lootview';
import { beginRun, endRun, playTime, resumeRun, runCount, saveStats, stats, syncRun } from './stats';
import { BASTION_I, Tutor, hearAgain, heard, saveHeard } from './tutor';
import { ENTRANCES, SCRATCH_BEAT, bossKind, intro } from './intro';
import { cardOut, closeIntro, openIntro, showCard } from './introview';
import { collect } from './trinkets';
import type { Album } from './album';
import { hideAlbum, showAlbum } from './albumview';
import { DEMO } from './demo';
import { creditRun, demoLocked, dueEvents, locked, openEvents, openedBy, runGains, standFor, volTop } from './progress';
import { STAND_MATS, type StandMat } from './stands';
import { noteRoom } from './dossier';
import { setOut } from './volume';
import { bindCollection, renderCollection, type ColTab } from './collection';
import { LANGS, M, Mjoin, detectLang, isLang, lang, onLang, scanDom, setLang, t, type Lang } from './i18n';
import { initTips } from './tip';

// the page's own Russian text, found before the game writes anything into the page
scanDom();
initTips();

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
const tutor = new Tutor(game, cam);

let run: Run = newRun();
/** The run is over: the last boss fell, or the whole party did. A campaign then has nothing left to go on with. */
let runOver = false;
/** True while the party stands between rooms and must pick the next one. */
let choosing = true;
/** Online: the room each player points at (the host keeps the count, clients get a copy). */
let votes: Votes = {};
/** Client: the heroes whose players the host waits for. */
let voters: number[] = [];
/** Client: the heroes whose players pick the next room: the voters still on their feet. */
let walkers: number[] = [];
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
/** Alone with a party: the hero whose pick by the fire the camp window asks for (once all have picked, the last of them). */
let campFor = -1;
/** The floor boss's trophies the party shares out after the fight; the map waits until they are shared. */
let loot: LootState | null = null;
/** The seed of the trophies this player has read and closed: the window stays shut for them. */
let lootShut = -1;
/** Online: the window of the trophies kept for this player's hero while they were away (keptLoot), and the seed of the one they closed. */
let kept: LootState | null = null;
let keptShut = -1;
/** Which trophies the window shows now: the party's share-out, or the ones kept for this player's hero. */
let lootShows: 'loot' | 'kept' | null = null;
let view = { w: 0, h: 0, dpr: 1 };

// ------------------------------------------------------------ camera

/**
 * Screen rectangle the room is fitted into and held to: below the top bar, with a little margin all round. A panel across
 * most of the bottom (the hero frame on a narrow screen) is kept clear too; one in a corner only covers a corner of the room.
 */
function playRect() {
  // the warm-up keeps a strip under the top bar clear for Бастион's lines
  const m = 10, top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 50) + m + (game.S.spec.tut ? WARM_GAP : 0);
  const fr = document.getElementById('frame')?.getBoundingClientRect();
  // the camera buttons over the frame (a row above it on an upright phone) are kept clear with it
  const cc = document.getElementById('camctl')?.getBoundingClientRect();
  const over = fr && fr.height && fr.width > view.w / 2 ? Math.min(fr.top, cc && cc.height ? cc.top : Infinity) : view.h;
  const bottom = Math.max(0, view.h - over) + m;
  return { x: m, y: top, w: Math.max(120, view.w - 2 * m), h: Math.max(120, view.h - top - bottom) };
}

/** Room kept clear under the top bar in the warm-up, for the hero's lines (a few lines of handwriting). */
const WARM_GAP = 130;

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

// the camera buttons in the room's corner, the same steps as Q/E and +/− on a keyboard
$('rotL').addEventListener('click', () => controls.rotateBy(-Math.PI / 4));
$('rotR').addEventListener('click', () => controls.rotateBy(Math.PI / 4));
$('zoomIn').addEventListener('click', () => controls.zoomBy(1.25));
$('zoomOut').addEventListener('click', () => controls.zoomBy(0.8));
/** The zoom buttons go dull at the end of their way: all the way out (the room just fits) or in. */
function camButtons() {
  $<HTMLButtonElement>('zoomOut').disabled = cam.zoom <= cam.minZoom * (1 + 1e-6);
  $<HTMLButtonElement>('zoomIn').disabled = cam.zoom >= cam.maxZoom * (1 - 1e-6);
}

// ------------------------------------------------------------ run flow

function showMap(open: boolean) {
  // the blacksmith's screen stands in for the map until this player is done there
  if (hud.atForge) open = false;
  const was = !$('mapScreen').hidden;
  $('mapScreen').hidden = !open;
  $('mapClose').hidden = choosing;
  if (open) {
    // the host's or a lone player's own new event comes in the next event room; a client's map can't tell
    mapView.fresh = mode !== 'client' && dueEvents().some(k => !(run.seen ?? []).includes(k));
    mapView.vol = game.bank.vol ?? 0;
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
/** Online: the backdrop of the lobby's party photo; the host picks it, everyone sees the same. */
let photoBg = 0;
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

const playerName = () => settings.name || t('Игрок');
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
  if (ev && !ev.done) {
    // the pawnshop waits only for the players here; a vote goes on with the ones here
    if (stageOf(ev) === 'sell') { if (sellDone(ev, table(), atTable())) afterEvent(); else shareMap(); }
    else { const go = agreed(ev.votes, atTable()); if (go !== null) settleEvent(go); else shareMap(); }
  }
  if (loot && !loot.done) { if (lootAgreed(loot, atTable())) shareLoot(); else shareMap(); }
}
const myHero = () => players.find(p => p.id === net.id)?.hero ?? null;
/** This screen's own hero: online the player's, alone the first hero of the campaign's party. */
const meHero = () => (game.online ? game.party.find(h => h.i === myHero()) ?? null : game.party[0] ?? null);
/** One player plays every hero of the party: the campaign of two or three. The windows between rooms then ask for each hero. */
const team = () => !game.online && game.party.length > 1;
/** The heroes this screen's player plays, for the statistics: online their own, in the campaign the whole party. */
const myHeroes = (): HeroState[] => (game.online ? [meHero()].filter(h => h !== null) : game.party);
/** The players as the clients see them: without anyone's rejoin key. */
const pub = () => players.map(({ key: _key, ...p }) => p);

/** The «Громкость» step the knob stands at: the one last turned to, as far as this player has opened. */
const knobVol = () => Math.max(0, Math.min(settings.vol, volTop()));
/** Online client: the step the host's knob stands at, as the host last said. */
let roomVol = 0;
/** Host: tell the table who sits at it, the photo's backdrop and the knob. */
const shareLobby = () => net.broadcast({ t: 'lobby', players: pub(), bg: photoBg, vol: knobVol() });

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
  $('waitTitle').textContent = t(title);
  $('waitText').textContent = t(text);
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

/** A new run of the heroes `picks` at «Громкость» step `vol`. */
function startRun(picks?: number[], vol = 0) {
  flushStats();
  run = newRun();
  // the party photo the run begins with, for its album: online the lobby's, with the players' names
  run.photo = mode === 'host'
    ? { bg: photoBg, heroes: players.map(p => p.hero!), names: players.map(p => p.name), host: players.findIndex(p => p.id === 'host') }
    : { bg: campPhotoBg(), heroes: picks ?? [0, 1, 2] };
  game.party = newParty(picks, run.seed);
  // every hero on the stand its player put it on, of the ones their wins with it have earned: online each player told the
  // host theirs with the pick
  for (const h of game.party) h.stand = mode === 'host' ? players.find(p => p.hero === h.i)?.stand : standFor(h.def.key);
  const mine = myHeroes();
  if (mine.length) beginRun(run, mine.map(h => h.def.key), mode === 'host');
  game.bank = newBank(vol);
  setOut(game.party, vol);
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
  // a room keeps the heroes away from the room before, so a new run would greet whoever took the hero of a player
  // who had dropped out of the last game as «нет связи»: it starts with the table as it is now
  seatAway();
  controls.fit();
  hideEnd();
  showMap(true);
  screen('');
  shareMap();
  runOver = false;
  keepRun(performance.now(), true);
}

/**
 * The campaign: the player picks how many heroes go (1 to 3) and which, on its own screen, and plays them all through the
 * whole run. A tap on a hero takes it into the party or out of it; once the party is full, a new pick pushes the first out.
 */
function openHeroSelect() {
  const size = Math.min(3, Math.max(1, settings.size || 1));
  // heroes not opened can't go (the demo's other heroes), even when the full game or a test last picked them
  let party = settings.party.filter((i, k, a) => HEROES[i] && !locked(HEROES[i].key) && a.indexOf(i) === k).slice(-size);
  if (!party.length) party = [0];
  let shown = party[party.length - 1];
  const draw = () => {
    settings.size = size;
    settings.party = party;
    settings.hero = party[0] ?? 0;
    saveSettings();
    renderHeroSelect({ size, party, shown, vol: knobVol(), onPick, onSize, onVol });
  };
  const onPick = (i: number) => {
    // a hero of the party with another hero's card open: the tap opens its card, where its stand is picked, and the
    // next tap takes it out
    const read = party.includes(i) && shown !== i;
    shown = i;
    // a hero not opened yet is only read: its card says how it opens
    if (read || locked(HEROES[i].key)) { draw(); return; }
    if (party.includes(i)) { if (size > 1) party = party.filter(o => o !== i); }
    else party = [...party, i].slice(-size);
    draw();
  };
  const onVol = (n: number) => {
    settings.vol = n;
    draw();
  };
  // a smaller party keeps the heroes picked last
  const onSize = (n: number) => {
    settings.size = n;
    openHeroSelect();
  };
  draw();
  show('heroSelect');
}

function startCampaign(heroes: number[]) {
  leaveOnline();
  setOnline('solo');
  show(null);
  startRun(heroes, knobVol());
}

/**
 * The warm-up before the first campaign: Бастион alone in the dummies' room, offering to show the ropes. Nothing of it is
 * kept or counted; won (or turned down), the run of the party picked begins.
 */
function startWarmup(heroes: number[]) {
  leaveOnline();
  setOnline('solo');
  show(null);
  flushStats();
  // a run of its own that is never begun, so no statistics count the warm-up, and nothing to go on with in the menu
  run = newRun();
  runOver = true;
  game.party = newParty([BASTION_I], run.seed);
  game.party[0].stand = standFor(game.party[0].def.key);
  game.bank = newBank();
  game.pickActiveParty();
  hud.buildAllies();
  choosing = false;
  votes = {};
  ev = null;
  showEvent();
  camp = null;
  showCamp();
  loot = null;
  showLoot();
  game.loadRoom({ seed: run.seed, depth: 1, floor: 0, type: 'fight', tut: true });
  // a crystal's touch short of the hero's trick, so the warm-up gets to it
  game.party[0].sparks = AB_COST - 1;
  controls.fit();
  hideEnd();
  showMap(false);
  screen('');
  warmFor = heroes;
  tutor.offer(() => startCampaign(heroes));
}
/** The party picked for the campaign the warm-up leads into. */
let warmFor: number[] = [];

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
    game.loadRoom({ seed: roomSeed(run, f, n), depth, floor: f, type: n.type });
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
    // the events this player has opened; one just opened by a choice at another comes first, with a «Новое» sticker
    const seed = run.seed + depth * 131, due = dueEvents(), key = eventOf(seed, run.seen, openEvents(), due);
    (run.seen ??= []).push(key);
    ev = { key, seed, votes: {}, ...(due.includes(key) ? { fresh: true } : {}) };
    choosing = false;
    showMap(false);
    showEvent();
  } else {
    // the camp: every hero does one thing by the fire in its own window; the map waits behind it for the vote
    camp = newCamp(run.seed + depth * 131, game.bank.vol);
    campFor = -1;
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
  const nameOf = game.online ? (h: HeroState) => players.find(p => p.hero === h.i)?.name ?? t(h.def.name) : team() ? (h: HeroState) => t(h.def.name) : undefined;
  campView.render(camp!, campHero(), game.party, nameOf, campAsked, team());
}

/**
 * The hero the camp window speaks for: online and alone this screen's own; for a party the one whose pick it asks for now
 * (the one tapped, else the first still by the fire), and once all have picked, the last of them.
 */
function campHero(): HeroState | null {
  if (!team()) {
    const mine = game.online ? myHero() : game.party[0]?.i ?? null;
    return game.party.find(h => h.i === mine) ?? null;
  }
  const left = game.party.filter(h => !camp?.did[h.i]);
  return left.find(h => h.i === campFor) ?? left[0] ?? game.party.find(h => h.i === campFor) ?? game.party[game.party.length - 1] ?? null;
}

// alone the pick is done at once; online the host does it and tells everyone
campView.onPick = pick => {
  if (!camp) return;
  const me = campHero()?.i ?? null;
  if (me === null) return;
  if (mode === 'client') {
    campAsked = pick;
    showCamp();
    net.send({ t: 'camp', pick });
  } else {
    campFor = me;
    campPick(me, pick);
  }
};
campView.onFor = hero => {
  if (!camp || !team() || camp.did[hero]) return;
  campFor = hero;
  showCamp();
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
  if (!open) return;
  // the choice taken may have opened an event or a trophy: the window says so at once
  creditStars();
  evView.render(ev!, table(), evHero(), eventVotes(), openedBy(ev!, run));
}

/** What the event plays with: the party, its ore and the run's map. */
const table = (): Table => ({ party: game.party, bank: game.bank, run });

/** The heroes who take part in the event's steps: online the ones whose players are here, alone the whole party. */
const evTable = () => (game.online ? atTable() : game.party.map(h => h.i));

/**
 * The hero the event window speaks for at the pawnshop: online and alone this screen's own; for a party with one player
 * the first still to hand a trophy over (once all have, the last of them).
 */
function evHero(): HeroState | null {
  if (!team()) return meHero();
  const left = ev ? sellersLeft(ev, game.party, evTable()) : [];
  return left[0] ?? game.party.filter(h => h.arts?.length).pop() ?? null;
}

// alone a tap takes the choice; online it is the player's vote, and the party takes it once everyone here picked it; at the
// pawnshop each hero hands over its own trophy
evView.onPick = opt => {
  if (!ev || ev.done) return;
  const sell = stageOf(ev) === 'sell';
  if (!game.online) {
    if (sell) evSell(evHero()?.i ?? -1, opt);
    else settleEvent(opt);
    return;
  }
  const me = myHero();
  if (me === null) return;
  if (mode === 'host') evVote(me, opt);
  else {
    const k = game.party.find(h => h.i === me)?.arts?.[opt] as ArtKey | undefined;
    if (sell && !k) return;
    ev = sell ? { ...ev, sold: { ...ev.sold, [me]: k! } } : { ...ev, votes: { ...ev.votes, [me]: opt } };
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

/** Host: a player points at one of the event's choices (or a hero, a cup), or hands over a trophy at the pawnshop. */
function evVote(hero: number, opt: number) {
  if (!ev || ev.done) return;
  const st = stageOf(ev);
  if (st === 'sell') return evSell(hero, opt);
  const ok = st === 'choose' ? !!choicesOf(ev)[opt] : st === 'hero' ? game.party.some(h => h.i === opt) : opt >= 0 && opt < 3;
  if (!ok) return;
  ev.votes[hero] = opt;
  const go = agreed(ev.votes, atTable());
  if (go !== null) settleEvent(go);
  else { showEvent(); shareMap(); }
}

/** A hero hands the trophy at `opt` among its own over at the pawnshop; the shop pays once every hero here has. */
function evSell(hero: number, opt: number) {
  const k = game.party.find(h => h.i === hero)?.arts?.[opt] as ArtKey | undefined;
  if (!ev || !k || !sellPick(ev, hero, k, table(), evTable())) return;
  afterEvent();
}

/**
 * Take a choice, or the hero, or the cup it asks for next: pay, roll, and do what comes of it to the party; once the event
 * is over the map is open again (after the trophies, if it gave any).
 */
function settleEvent(opt: number) {
  if (!ev || ev.done) return;
  const st = stageOf(ev), t = table();
  const ok = st === 'choose' ? take(ev, opt, t) : st === 'hero' ? heroPick(ev, opt, t) : st === 'cups' ? cupPick(ev, opt, t) : false;
  if (!ok) { showEvent(); shareMap(); return; }
  // nobody here has a trophy to hand over at the pawnshop: it pays nothing and is over
  if (stageOf(ev) === 'sell') sellDone(ev, t, evTable());
  afterEvent();
}

/**
 * The event has moved on: once it is over, a trophy is shared out before the map opens again, once the outcome is read. The
 * demo's first event of the run gives one whatever came of it, so every demo run has a trophy to try.
 */
function afterEvent() {
  if (!ev) return;
  if (ev.done) {
    const gift = DEMO && run.seen?.length === 1;
    const l = gift || doneOf(ev)!.out.fx.some(f => f.k === 'art') ? newLoot(ev.seed * 7 + 3, run.floor, game.party) : null;
    if (l && lootFor(l)) loot = { ...l, from: ev.key, ...(gift ? { gift } : {}) };
    choosing = !loot;
    votes = {};
  }
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
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? t(HEROES[h].name);
  const faces: EventVotes['faces'] = {};
  if (stageOf(ev) === 'sell') {
    // at the pawnshop nobody votes: each hands over their own
    const left = sellersLeft(ev, game.party, table).map(h => (h.i === me ? t('ты') : nameOf(h.i)));
    return { faces, mine: null, note: left.length ? t('Ещё выбирают: {0}.', left) : '' };
  }
  for (const h of table) if (cast[h] !== undefined) (faces[cast[h]] ??= []).push({ col: HEROES[h].col, name: nameOf(h), me: h === me, face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => cast[h] === undefined).map(h => (h === me ? t('ты') : nameOf(h)));
  const stage = stageOf(ev);
  const note = idle.length === table.length ? t('Выбор общий: отряд сделает то, что нажмут все.')
    : idle.length ? t('Ещё не выбрали: {0}.', idle)
    : t(stage === 'hero' ? 'Голоса разошлись. Договоритесь и нажмите одного героя.' : stage === 'cups' ? 'Голоса разошлись. Договоритесь и нажмите один стакан.'
      : 'Голоса разошлись. Договоритесь и нажмите одно и то же.');
  return { faces, mine: me !== null ? cast[me] ?? null : null, note };
}

/**
 * Show the trophies' window while the party stands over the boss's hoard, until this player has read who got what and
 * closed it. An event's trophies wait until this player has read the event's outcome. Online a player who was away at the
 * share-out gets the trophies kept for their hero instead, and picks one.
 */
function showLoot() {
  // a player back at the table picks from what was kept for them, unless a share-out they take part in is under way
  const mine = !loot || loot.done ? keptLoot() : null;
  const open = !mine && !!loot && !(loot.done && lootShut === loot.seed) && !(loot.from && ev && evShut !== ev.seed);
  lootShows = open ? 'loot' : mine ? 'kept' : null;
  $('lootScreen').hidden = !lootShows;
  if (!lootShows) return;
  const nameOf = game.online ? (h: HeroState) => players.find(p => p.hero === h.i)?.name ?? t(h.def.name) : team() ? (h: HeroState) => t(h.def.name) : undefined;
  if (mine) lootView.render(mine, meHero(), game.party, undefined, nameOf, false, true);
  else lootView.render(loot!, lootHero(), game.party, lootVotes(), nameOf, team());
}

/**
 * Online: the trophies kept for this player's hero while they were away, as a window to pick one from once the party is
 * between rooms; after the pick it shows what they took until they close it.
 */
function keptLoot(): LootState | null {
  const me = game.online ? meHero() : null, pile = me?.kept;
  if (kept?.done) {
    // the pick stands, unless a teammate back a moment sooner took that very trophy: then the pile is offered again
    const k = me ? kept.done[me.i] : undefined;
    if (!(pile && pile.seed === kept.seed && k && !pile.offer.includes(k))) return kept;
  }
  kept = me && pile?.offer.length && pile.seed !== keptShut && game.S?.phase === 'over' ? { ...pile, picks: {} } : null;
  return kept;
}
/** What the window of kept trophies hangs on: a snapshot that changes it opens, updates or shuts the window. */
const keptSign = () => { const me = game.online ? meHero() : null; return `${me?.i}:${game.S?.phase === 'over'}:${me?.kept?.seed}:${me?.kept?.offer.join()}`; };
let keptSeen = '';

/**
 * The hero the trophies' window speaks for: online and alone this screen's own; for a party the first still without a
 * trophy while they are being picked, and nobody once they are shared out (the window then shows every hero's).
 */
function lootHero(): HeroState | null {
  if (!team()) {
    const mine = game.online ? myHero() : game.party[0]?.i ?? null;
    return game.party.find(h => h.i === mine) ?? null;
  }
  // a hero with all sockets taken still has to say which of its own goes before the next one picks
  return loot?.done ? null : game.party.find(h => loot && !lootDone(loot, h.i)) ?? null;
}

// alone a tap takes the trophy; online it points at the one the player wants, and they are shared out once no two want the
// same; for a party it goes to the hero whose turn it is, and a tap on a trophy another hero took takes it back from them
lootView.onPick = opt => {
  if (lootShows === 'kept') return keptTake(opt);
  if (!loot || loot.done) return;
  if (team() && opt >= 0) {
    const by = game.party.find(h => loot!.picks[h.i] === opt);
    if (by) { delete loot.picks[by.i]; delete loot.drops?.[by.i]; showLoot(); return; }
  }
  const me = lootHero()?.i ?? null;
  if (me === null) return;
  if (mode === 'client') {
    const picks = { ...loot.picks, [me]: opt }, drops = { ...loot.drops };
    if (opt === UNDO) { delete picks[me]; delete drops[me]; }
    loot = { ...loot, picks, drops };
    showLoot();
    net.send({ t: 'loot', opt });
  } else lootPick(me, opt);
};
// a hero with all three sockets taken says which of its own it throws away for the one picked
lootView.onDrop = k => {
  if (!loot || loot.done || lootShows !== 'loot') return;
  const me = lootHero()?.i ?? null, opt = me !== null ? loot.picks[me] : undefined;
  if (me === null || opt === undefined || opt < 0) return;
  if (mode === 'client') {
    loot = { ...loot, drops: { ...loot.drops, [me]: k } };
    showLoot();
    net.send({ t: 'loot', opt, drop: k });
  } else lootPick(me, opt, k);
};
lootView.onLeave = () => {
  // the kept trophies' window shuts over whatever the party is at: the map, the camp, the blacksmith's
  if (lootShows === 'kept') {
    // the hoard they came back to has been read with it
    if (kept) { keptShut = kept.seed; if (loot?.seed === kept.seed) lootShut = loot.seed; }
    kept = null;
    showLoot();
    return;
  }
  if (loot) lootShut = loot.seed;
  showLoot();
  showMap(true);
};

/** Online: this player, back at the table, takes one of the trophies kept for their hero; the host hands it over. */
function keptTake(opt: number) {
  const me = meHero(), k = kept?.offer[opt];
  if (!me || !kept || kept.done || !k) return;
  kept = { ...kept, done: { [me.i]: k } };
  showLoot();
  if (mode === 'client') net.send({ t: 'kept', k });
  else keptPick(me.i, k);
}

/** Host: a player back at the table takes one of the trophies kept for their hero. */
function keptPick(hero: number, k: ArtKey) {
  const seed = game.party.find(h => h.i === hero)?.kept?.seed;
  if (!takeKept(game.party, hero, k)) return;
  // the boss's window, while the party still stands over the hoard, lists it among who got what
  if (loot?.done && loot.seed === seed) loot.done[hero] = k;
  hud.buildAllies();
  game.onChange();
  showLoot();
  shareMap();
}

/** The heroes whose players share the trophies out: online the ones here, alone every hero of the party. */
const lootTable = () => (game.online ? atTable() : game.party.map(h => h.i));

/**
 * Host (or a lone player): a player points at a trophy for their hero. A hero with all sockets taken names the one of its
 * own it throws away for it (`drop`), or keeps its own (PASS); UNDO takes the pick back.
 */
function lootPick(hero: number, opt: number, drop?: ArtKey) {
  if (!loot || loot.done) return;
  const full = !!loot.full?.includes(hero), h = game.party.find(o => o.i === hero);
  if (opt === UNDO) { delete loot.picks[hero]; delete loot.drops?.[hero]; }
  else if (opt === PASS ? !full : loot.offer[opt] === undefined) return;
  else {
    if (loot.picks[hero] !== opt) delete loot.drops?.[hero];
    loot.picks[hero] = opt;
    if (drop && full && opt >= 0 && h?.arts?.includes(drop)) (loot.drops ??= {})[hero] = drop;
  }
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

/**
 * Online: whose face stands on which trophy, and whom the share-out still waits for. For a party: the faces of the heroes
 * on the trophies already picked for them. Alone with one hero there is nothing to show.
 */
function lootVotes(): LootVotes | undefined {
  if (team()) {
    if (!loot) return undefined;
    const faces: LootVotes['faces'] = {};
    for (const h of game.party) if (loot.picks[h.i] !== undefined) (faces[loot.picks[h.i]] ??= []).push({ col: h.def.col, name: h.def.name, me: false, face: faceUrl(h) });
    return { faces, mine: null, note: '' };
  }
  const table = mode === 'host' ? atTable() : mode === 'client' ? voters : [];
  if (!loot || table.length < 2) return undefined;
  const me = myHero(), picks = loot.picks;
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? t(HEROES[h].name);
  const faces: LootVotes['faces'] = {};
  for (const h of table) if (picks[h] !== undefined) (faces[picks[h]] ??= []).push({ col: HEROES[h].col, name: nameOf(h), me: h === me, face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => picks[h] === undefined).map(h => (h === me ? t('ты') : nameOf(h)));
  const clash = Object.values(faces).some(f => f.length > 1);
  const note = clash ? t('Двое тянут один трофей. Договоритесь, кому что.')
    : idle.length === table.length ? t(table.length < loot.offer.length ? 'Каждый берёт свой трофей, лишний останется лежать.' : 'Каждый берёт свой трофей, один на двоих не взять.')
    : t('Ещё не выбрали: {0}.', idle);
  return { faces, mine: me !== null ? picks[me] ?? null : null, note };
}

// alone a click on the map goes there; online it is a vote, and the party goes once everyone here on their feet picked the same room
mapView.onChoose = id => {
  const me = myHero();
  if (!game.online) choose(id);
  else if (me === null || !mapTable().includes(me)) return;
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

/**
 * Host: the heroes whose players pick the next room: the ones here still on their feet. A fallen hero's player watches the
 * others choose and goes along; with everyone here fallen (the host plays a standing one) they all choose as before.
 */
function walking() {
  const t = atTable(), up = t.filter(h => (game.party.find(o => o.i === h)?.hp ?? 0) > 0);
  return up.length ? up : t;
}

/** Online: the heroes whose players pick the next room, as the host counts them. */
const mapTable = () => (mode === 'host' ? walking() : mode === 'client' ? walkers : []);

/** Host: a player points at a room. */
function vote(hero: number, id: string) {
  if (!choosing || !reachable(run, run.floor).includes(id) || !walking().includes(hero)) return;
  votes[hero] = id;
  settle();
}

/** Host: go where everyone here agreed, or show them all how the vote stands. */
function settle() {
  if (!choosing) return;
  const go = agreed(votes, walking());
  if (go) choose(go);
  else shareMap();
}

/** Host: tell everyone where the party stands on the map, and show it on the host's own map too. */
function shareMap() {
  if (mode !== 'host' || !started) return;
  const m: MapState = { run, choosing, votes, voters: atTable(), walkers: walking(), ev, camp, loot };
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
  const table = mapTable(), me = myHero();
  // this player's hero has fallen: the others pick the room, and the map says so
  const out = me !== null && (mode === 'host' ? atTable() : mode === 'client' ? voters : []).includes(me) && !table.includes(me);
  if (!choosing || (table.length < 2 && !out)) return undefined;
  const nameOf = (h: number) => players.find(p => p.hero === h)?.name ?? t(HEROES[h].name);
  const pips: MapVotes['pips'] = {};
  for (const h of table) if (votes[h]) (pips[votes[h]] ??= []).push({ hero: h, col: HEROES[h].col, name: nameOf(h), face: faceUrl(game.party.find(o => o.i === h) ?? { i: h, def: HEROES[h] }) });
  const idle = table.filter(h => !votes[h]).map(h => (h === me ? t('ты') : nameOf(h)));
  const note = out ? t('Ты {0?пала|пал}: комнату выбирают живые, ты идёшь с ними.', HEROES[me].fem)
    : idle.length === table.length ? t('Идём, когда все нажмут одну и ту же комнату.')
    : idle.length ? t('Ещё не выбрали: {0}.', idle)
    : t('Голоса разошлись. Договоритесь и нажмите одну комнату.');
  return { pips, mine: me !== null ? votes[me] ?? null : null, note };
}

game.onChange = () => {
  hud.refresh();
  // the warm-up has no run map to look at
  $('btnMap').hidden = game.S.spec.tut === true;
  dirty = true;
  stale = true;
};
game.onSound = (ev, p) => sound.play(ev, p);
// online every party head says whose hero it is
hud.nameOf = i => (game.online ? players.find(p => p.hero === i)?.name ?? null : null);
hud.me = meHero;
hl.changed = () => { dirty = true; };
game.onRoomEnd = win => {
  const S = game.S, boss = S.spec.type === 'boss';
  // the warm-up is won (nobody falls there): Бастион sends the player on into the run
  if (S.spec.tut) { setTimeout(() => tutor.won(() => startCampaign(warmFor)), 900); return; }
  const last = boss && run.floor === FLOORS - 1;
  setTimeout(() => {
    // the album's photo of the floor's boss: the heroes as it fell, before it gave them half their health back
    if (win && boss) (run.shots ??= [])[run.floor] = { boss: bossOf(S.spec), heroes: game.wounds ?? game.party.map(h => ({ i: h.i, hp: Math.max(0, h.hp), max: h.max })) };
    if (!win || last) {
      endRun(run, myHeroes(), win);
      creditStars();
      runOver = true;
      if (mode === 'solo') clearCampaign();
    }
    // the lines of the result are kept as they are and put in each player's language on their own screen
    if (!win) return showEnd({ title: game.party.length > 1 ? 'Отряд пал' : 'Герой пал', text: M('Забег окончен на этаже {0}, сложность {1}.', run.floor + 1, S.spec.depth), kind: 'again', album: albumOf(false) });
    if (last) {
      const fell = MOBS[bossOf(S.spec)], went = run.path.reduce((a, p) => a + p.length, 0);
      return showEnd({ title: 'Вы победили!', kind: 'win',
        text: Mjoin(DEMO ? M('{0} {1?повержена|повержен}, демо пройдено. Комнат пройдено: {2}.', fell.name, fell.fem, went)
          : M('{0} {1?повержена|повержен}, все три этажа позади. Комнат пройдено: {2}.', fell.name, fell.fem, went),
        game.party.length > 1 ? M('Дошли до конца: {0}.', game.alive().map(h => h.def.name)) : ''),
        album: albumOf(true) });
    }
    if (boss) run.floor++;
    votes = {};
    // the floor's boss leaves trophies: the party shares them out before the map opens again
    if (boss) {
      const l = newLoot(run.seed + run.floor * 977 + S.spec.depth, S.spec.floor, game.party, bossOf(S.spec), game.bank.vol);
      if (lootFor(l)) {
        loot = l;
        choosing = false;
        showLoot();
        shareMap();
        return;
      }
    }
    choosing = true;
    // the ore cave ends when its turns are up or everything in it is spent: it tells how much ore it gave
    const cave = game.cave(), rooms = M('Пройдено комнат: {0} из {1}.', run.path.reduce((a, p) => a + p.length, 0), FLOORS * LAYERS);
    // the boss gave every hero back half their health as it fell (Game.bossHeal)
    const solo = game.party.length === 1 && game.party[0].def;
    const healed = !boss ? '' : solo ? M('{0} {1?восстановила|восстановил} половину здоровья.', solo.name, solo.fem) : 'Герои восстановили половину здоровья.';
    // a hero who fell in a room the others won gets up as the next fight begins (Game.loadRoom), or with half by the fire
    const down = game.party.filter(h => h.hp <= 0).map(h => h.def.name);
    const rise = !down.length ? '' : down.length === 1 ? M('{0} встанет с {1} HP к следующему бою, у костра с половиной.', down[0], RISE_HP)
      : M('{0} и {1} встанут с {2} HP к следующему бою, у костра с половиной.', down.slice(0, -1), down[down.length - 1], RISE_HP);
    const clean = game.clean ? M('Без царапины: +{0} руды.', game.clean) : '';
    // an elite pays a stat level for every hero, taken in the sharpening window the result screen leads to
    const elite = S.spec.type === 'elite';
    if (elite) game.sharpen(S.spec.depth);
    showEnd({ title: boss ? M('Этаж {0} пройден', run.floor) : cave ? (game.cleared() ? 'Пещера выбрана дочиста' : 'Ходы кончились') : elite ? 'Элита повержена' : 'Комната зачищена',
      // the bookie's bet comes after the ore
      text: cave ? Mjoin(M('Добыто руды: {0}.', game.mined), rooms)
        : Mjoin(M('Ходов: {0}.', S.turn), healed, rise, clean, game.betLine, elite ? 'Гном-кузнец бесплатно заточит каждому диск.' : '', rooms),
      kind: 'map', next: elite ? 'whet' : undefined });
    shareMap();
  }, 900);
};

/** The result of a room: on to the map, or (the run is over) a new run; online that means back to the lobby. */
function showEnd(e: Ending) {
  ending = e;
  if (e.album) {
    creditStars();
    // the end of the run: its album instead of the plain result; online every player sees it, the host takes them back
    $('roomEnd').hidden = true;
    if (mode === 'client') wait('');
    showAlbum(e.album, {
      gains: runGains(run),
      button: mode === 'client' ? null : t(mode === 'host' ? 'В лобби' : 'Новый забег'),
      onButton: mode === 'host' ? backToLobby : () => { hideEnd(); openHeroSelect(); },
    });
    victory($('runEnd'), e.album.win);
    if (mode === 'host') { screen(e.title, e.text, e.kind === 'win', e.kind === 'again'); net.broadcast({ t: 'end', e }); }
    return;
  }
  $('roomEnd').hidden = false;
  victory($('roomEnd'), e.kind === 'win');
  $('roomEnd').classList.toggle('lose', e.kind === 'again');
  $('endTitle').textContent = t(e.title);
  $('endText').textContent = t(e.text);
  $('endBtn').textContent = t(e.next === 'whet' ? 'К заточке' : e.kind === 'map' ? 'К карте' : mode === 'host' ? 'В лобби' : 'Новый забег');
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
  hideAlbum();
}

/**
 * The run's album as it ends: the party photo it began with, the bosses beaten and the party as it is left, after a win
 * with the health it had as the last boss fell. Made by the host (or alone) and sent with the result to everyone.
 */
function albumOf(win: boolean): Album {
  const S = game.S, shots = (run.shots ?? []).filter(s => s !== null), last = shots[shots.length - 1];
  return {
    win,
    floor: run.floor,
    boss: !win && S.spec.type === 'boss' ? bossOf(S.spec) : undefined,
    photo: run.photo ?? { bg: 0, heroes: game.party.map(h => h.i) },
    shots,
    heroes: game.party.map(h => {
      const was = win ? last?.heroes.find(o => o.i === h.i) : undefined;
      return { i: h.i, hp: Math.max(0, was?.hp ?? h.hp), max: was?.max ?? h.max, arts: h.arts ?? [], t: h.tally ?? newTally() };
    }),
    rooms: run.path.reduce((a, p) => a + p.length, 0),
    time: runCount(run)?.time ?? 0,
    at: Date.now(),
    ...(game.bank.vol ? { vol: game.bank.vol } : {}),
  };
}

$('forgeDone').addEventListener('click', () => {
  hud.leaveForge();
  showMap(true);
});
$('btnMap').addEventListener('click', () => showMap(true));
$('mapClose').addEventListener('click', () => showMap(false));
$('helpClose').addEventListener('click', () => { $('help').hidden = true; });
/** «Как играть» in tabs: the one picked shows, the window keeps it for the next time it opens. */
function helpTab(tab: string) {
  document.querySelectorAll<HTMLButtonElement>('#help .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('#help .help-body > [data-tab]').forEach(el => (el.hidden = el.dataset.tab !== tab));
  $('help').querySelector('.help-body')!.scrollTop = 0;
}
document.querySelectorAll<HTMLButtonElement>('#help .tab').forEach(b => b.addEventListener('click', () => helpTab(b.dataset.tab!)));

// ------------------------------------------------------------ menu

/** v<major.minor>.<build>, put in by vite.config.ts at the build. */
declare const __VERSION__: string;
const showVer = () => { $('menuVer').textContent = DEMO ? t('{0} · демо', __VERSION__) : __VERSION__; };
showVer();
onLang(showVer);
document.body.classList.toggle('demo', DEMO);

/** A campaign to go on with: the one on screen, or after the game was closed (or played online) the one this browser kept. */
const unfinished = () => (mode === 'solo' ? !runOver : !!loadCampaign());

function openMenu() {
  $('mContinue').hidden = !unfinished();
  show('menu');
}

$('mContinue').addEventListener('click', () => (mode === 'solo' ? show(null) : resumeCampaign()));
$('mCampaign').addEventListener('click', openHeroSelect);
$('heroBack').addEventListener('click', openMenu);
$('heroGo').addEventListener('click', () => {
  if (settings.party.length !== settings.size) return;
  // the run under way would be gone
  if (unfinished() && !confirm(t('Начать новый забег? Начатый забег пропадёт.'))) return;
  if (tutor.offers) startWarmup(settings.party);
  else startCampaign(settings.party);
});
$('mOnline').addEventListener('click', () => { shelveCampaign(); $<HTMLInputElement>('lobbyName').value = settings.name; resetLobby(); show('lobby'); });
$('mCollection').addEventListener('click', () => { renderCollection(); show('collection'); });
$('mStats').addEventListener('click', () => { flushStats(); renderStats(); show('statsScreen'); });
$('statsBack').addEventListener('click', openMenu);
/** The settings open from the main menu or from the pause menu in a game, and «Назад» goes back where they came from. */
let settingsFrom: 'menu' | 'pause' = 'menu';
function openSettings(from: typeof settingsFrom) {
  settingsFrom = from;
  syncSettings();
  $<HTMLInputElement>('setTips').checked = !heard.off;
  show('settingsScreen');
}
// the hero's hints on or off; turned back on, they all come once more from the start, the warm-up too
$('setTips').addEventListener('change', () => {
  const on = $<HTMLInputElement>('setTips').checked;
  if (on) hearAgain();
  heard.off = !on;
  saveHeard();
});

/** Where the player is, for the hero's lines: a menu over the game, or a card over the room, puts them away for the while. */
tutor.where = () => {
  const open = (id: string) => !$(id).hidden;
  if (intro.now || open('boot') || inMenu() || open('pause') || open('settingsScreen') || open('help') || open('waitScreen')) return 'menu';
  if (open('roomEnd') || open('runEnd')) return 'end';
  if (open('lootScreen')) return 'loot';
  if (open('eventScreen')) return 'event';
  if (open('campScreen')) return 'camp';
  if (open('forgeScreen')) return game.whet ? 'whet' : 'forge';
  if (open('mapScreen')) return 'map';
  if (open('mobCard') || open('heroPeek') || open('ups') || open('logPanel')) return 'menu';
  return 'room';
};
tutor.me = meHero;
$('mSettings').addEventListener('click', () => openSettings('menu'));
document.querySelectorAll<HTMLButtonElement>('#collection .tab').forEach(b => b.addEventListener('click', () => renderCollection(b.dataset.tab as ColTab)));
bindCollection();
$('colBack').addEventListener('click', openMenu);
$('setBack').addEventListener('click', () => (settingsFrom === 'pause' ? show('pause') : openMenu()));
const syncSettings = bindSettings(() => { applyQuality(); sizeCanvas(); });

$('btnMenu').addEventListener('click', () => show('pause'));
$('pResume').addEventListener('click', () => show(null));
$('pSettings').addEventListener('click', () => openSettings('pause'));
$('pHelp').addEventListener('click', () => {
  show(null);
  // the enemy types go by the faces the enemy queue shows, cut from the figures once their pictures are in
  document.querySelectorAll<HTMLElement>('#help [data-face]').forEach(el => { el.innerHTML = `<img src="${mobFace(el.dataset.face as MobKind)}" alt="">`; });
  $('help').hidden = false;
  $('help').querySelector('.help-body')!.scrollTop = 0;
});
$('pMenu').addEventListener('click', () => {
  // the campaign waits behind the menu as it is, the map or a window between rooms included, until «Продолжить»
  if (mode === 'solo') { keepRun(performance.now(), true); openMenu(); return; }
  if (game.online && !confirm(t('Выйти из сетевой игры?'))) return;
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
    code: net.code, players, me: net.id, host: mode === 'host', bg: photoBg, vol: mode === 'host' ? knobVol() : roomVol,
    // the host turns the knob for the whole table; whoever was ready says so again for the new step
    onVol: n => {
      if (mode !== 'host' || started) return;
      settings.vol = n;
      saveSettings();
      for (const p of players) p.ready = false;
      shareLobby();
      lobbyView();
    },
    onPick: hero => {
      if (mode === 'host') { pick('host', hero); return; }
      net.send({ t: 'pick', hero, ...(hero === null ? {} : { stand: standFor(HEROES[hero].key) }) });
    },
    onLook: hero => {
      if (mode === 'host') { look('host', hero); return; }
      net.send({ t: 'look', hero });
    },
    onBg: () => {
      if (mode !== 'host') return;
      photoBg++;
      shareLobby();
      lobbyView();
    },
  });
}

/** Host: a player still without a hero points at one; the others see it pale in the party photo. */
function look(id: string, hero: number | null) {
  const p = players.find(o => o.id === id);
  if (!p || started || p.hero !== null) return;
  const h = hero !== null && HEROES[hero] && !players.some(o => o.hero === hero) ? hero : null;
  if ((p.look ?? null) === h) return;
  p.look = h;
  shareLobby();
  lobbyView();
}

/**
 * Host: a player picks a hero, if it is free; one who changes their hero has to press «Готов» again. Every player picks
 * from the heroes opened on their own device: the host checks its own, and keeps only the demo's heroes for everyone.
 */
function pick(id: string, hero: number | null, stand?: StandMat) {
  const p = players.find(o => o.id === id);
  if (!p || started) return;
  if (hero !== null && (players.some(o => o.hero === hero && o.id !== id) || !HEROES[hero] || (id === 'host' ? locked : demoLocked)(HEROES[hero].key))) return;
  if (p.hero !== hero) p.ready = false;
  p.hero = hero;
  p.look = null;
  // the hero's stand comes with it: the host knows its own, a player says theirs, and anything else is plain
  p.stand = hero === null ? undefined : id === 'host' ? standFor(HEROES[hero].key) : stand && STAND_MATS.includes(stand) ? stand : undefined;
  shareLobby();
  lobbyView();
}

/** Host: a player presses «Готов» or takes it back; only with a hero picked. */
function readyUp(id: string, on: boolean) {
  const p = players.find(o => o.id === id);
  if (!p || started || p.id === 'host') return;
  p.ready = on && p.hero !== null;
  shareLobby();
  lobbyView();
}

function backToLobby() {
  started = false;
  // a player who dropped out of the run and isn't back can't press «Готов»: they'd hold the start up, so they are let go
  players = players.filter(p => net.has(p.id));
  // a new run asks everyone for their «Готов» again
  for (const p of players) p.ready = false;
  ev = null;
  showEvent();
  loot = null;
  showLoot();
  hideEnd();
  showMap(false);
  net.broadcast({ t: 'lobbyBack' });
  shareLobby();
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
  photoBg = Math.floor(Math.random() * BACKDROP_COUNT);
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
  startRun(players.map(p => p.hero!).sort((a, b) => a - b), knobVol());
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
    net.send({ t: 'hello', name: playerName(), key: myKey, demo: DEMO });
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
function welcome(id: string, name: string, key: string, demo: boolean) {
  // the demo and the full game play different runs: a room lets in only its own version
  if (demo !== DEMO) {
    // a line the player who is let in or not reads in their own language
    net.sendTo(id, { t: 'deny', text: DEMO ? 'Это комната демо-версии. Зайди по ссылке хозяина.' : 'Это комната полной версии, а у тебя демо. Зайди по ссылке хозяина.' });
    setTimeout(() => net.kick(id), 300);
    return;
  }
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
      if (ending?.kind === 'map' || ending?.album) net.sendTo(id, { t: 'end', e: ending });
      game.float(game.S.Wx / 2, 20, M('{0} вернулся', name), '#c7cbe0');
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
  // one who dropped out mid-run and is back once it ended still has «Связь потеряна» over the game: the lobby takes its place
  if (!started) net.sendTo(id, { t: 'lobbyBack' });
  shareLobby();
  lobbyView();
}

net.onLeave = id => {
  if (!started) {
    players = players.filter(p => p.id !== id);
    shareLobby();
    lobbyView();
    return;
  }
  // mid-game the hero stays; the host may play it until its player comes back, and the others wait a little for them
  const p = players.find(o => o.id === id);
  if (!p) return;
  game.float(game.S.Wx / 2, 20, M('{0} отключился', p.name), '#c7cbe0');
  if (p.hero !== null) leftAt.set(p.hero, Date.now());
  setOnline('host');
  hud.buildAllies();
  hud.refresh();
  setTimeout(goOn, GRACE + 100);
};

net.onLost = () => { if (mode === 'client') reconnect(net.code); };

net.onMsg = (from, m) => {
  if (mode === 'host') {
    if (m.t === 'hello') welcome(from, m.name, m.key, !!m.demo);
    else if (m.t === 'pick') pick(from, m.hero, m.stand);
    else if (m.t === 'look') look(from, m.hero);
    else if (m.t === 'ready') readyUp(from, m.on);
    else if (m.t === 'vote' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) vote(h, m.id); }
    else if (m.t === 'evote' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) evVote(h, m.opt); }
    else if (m.t === 'camp' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) campPick(h, m.pick); }
    else if (m.t === 'loot' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) lootPick(h, m.opt, m.drop as ArtKey | undefined); }
    else if (m.t === 'kept' && started) { const h = players.find(p => p.id === from)?.hero; if (h != null) keptPick(h, m.k as ArtKey); }
    else if (m.t === 'act' && started && ownerOf(m.a.h) === from) game.perform(m.a);
    return;
  }
  answered = true;
  if (m.t === 'lobby') { players = m.players; if (m.bg !== undefined) photoBg = m.bg; roomVol = m.vol ?? 0; lobbyView(); }
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
    ({ run, choosing, votes, voters, walkers } = m.m);
    const mine = myHero();
    if (started && mine !== null) beginRun(run, [HEROES[mine].key], true);
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
    // a player back at the table: the trophies' window speaks for their hero once it comes, and the ones kept for it show up
    const sign = keptSign();
    if (ch.party || sign !== keptSeen) { keptSeen = sign; showLoot(); }
    if (ch.room) controls.fit();
    hud.refresh();
    // health and ore by the fire come with the game state: the camp window and the map's party row show them
    if (camp) { showCamp(); if (!$('mapScreen').hidden) showMap(true); }
    // the party walked into the blacksmith's: the shop takes the map's place
    if (!shop && hud.atForge) showMap(false);
  } else if (m.t === 'screen') {
    // the host's word that the run is over: the last boss fell, or the whole party did
    if (started && (m.win || m.lose)) { endRun(run, myHeroes(), !!m.win); creditStars(); }
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
    if (mine !== null) beginRun(run, [HEROES[mine].key], true);
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
    alert(t('Не удалось вернуть комнату. {0}', (e as Error).message));
    return;
  }
  wait('');
  dirty = true;
  if (!started || !s.snap) {
    // a player who doesn't come back to the lobby is let go, so the start doesn't wait for their «Готов»
    setTimeout(() => {
      if (mode !== 'host' || started || players.every(p => net.has(p.id))) return;
      players = players.filter(p => net.has(p.id));
      shareLobby();
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

// ------------------------------------------------------------ campaign save

let runAt = -Infinity;

/** The campaign is kept in this browser every second or so, and as the page goes away, so a run closed mid-way goes on later. */
function keepRun(now: number, force = false) {
  if (mode !== 'solo' || runOver || (!force && now - runAt < 1000)) return;
  runAt = now;
  saveCampaign({
    v: CAMPAIGN, run, choosing, ev, camp, campFor, loot, shut: { ev: evShut, camp: campShut, loot: lootShut }, ending,
    forgeLeft: game.forge > 0 && !hud.atForge, act: game.act, mined: game.mined, clean: game.clean, bet: game.betLine,
    // what only flashes by is left out, so a room standing still isn't written again every second
    snap: { ...snapshot(game), floats: [], sparks: [], shake: 0 },
    count: runCount(run),
  });
}

/** The campaign this browser kept goes on where it was left: on the map, in a window between rooms, or mid-fight. */
function resumeCampaign() {
  const s = loadCampaign();
  if (!s) { openMenu(); return; }
  leaveOnline();
  setOnline('solo');
  try {
    run = s.run;
    choosing = s.choosing;
    votes = {};
    ev = s.ev;
    evShut = s.shut.ev;
    camp = s.camp;
    campShut = s.shut.camp;
    campFor = s.campFor;
    loot = s.loot;
    lootShut = s.shut.loot;
    game.act = s.act;
    // the room is built afresh from its spec, then everything in it put back as it was, the heroes as new
    game.party = [];
    game.showRoom(s.snap.spec);
    applySnapshot(game, s.snap);
    game.mined = s.mined;
    game.clean = s.clean;
    game.betLine = s.bet ?? '';
  } catch (e) {
    // a save the game can no longer read (a much older make): it is let go, so it doesn't fail every time
    console.error(e);
    clearCampaign();
    setOnline('menu');
    game.party = newParty();
    game.loadRoom({ seed: Math.floor(Math.random() * 1e6), depth: 1, floor: 0, type: 'fight' });
    hud.buildAllies();
    controls.fit();
    openMenu();
    alert(t('Не удалось продолжить сохранённый забег.'));
    return;
  }
  runOver = false;
  resumeRun(run, game.party.map(h => h.def.key), s.count);
  show(null);
  hud.leaveForge(s.forgeLeft);
  hud.buildAllies();
  hud.refresh();
  controls.fit();
  hideEnd();
  showMap(false);
  showEvent();
  showCamp();
  showLoot();
  if (s.ending) showEnd(s.ending);
  // the map opens once the window between rooms is closed, as it did before
  else if (choosing) { if (['eventScreen', 'campScreen', 'lootScreen'].every(id => $(id).hidden)) showMap(true); }
  // the fight was just over, its result not up yet
  else if (game.S.phase === 'over' && !loot && !(ev && !ev.done)) game.onRoomEnd(game.alive().length > 0);
}

/** Off to play online: the campaign under way waits in this browser's save for «Продолжить». */
function shelveCampaign() {
  if (mode !== 'solo') return;
  keepRun(performance.now(), true);
  setOnline('menu');
  leaveOnline();
  showMap(false);
  hideEnd();
}

/** The main menu and its screens; the settings count among them when opened from the main menu, not from a game. */
const MENU_SCREENS = ['menu', 'heroSelect', 'lobby', 'collection', 'statsScreen'];
const inMenu = () => MENU_SCREENS.some(id => !$(id).hidden) || (settingsFrom === 'menu' && !$('settingsScreen').hidden);

/** What plays now: the funk in the main menu, a floor's fight tune in a fight, the lounge everywhere else. */
function track(): Track | null {
  if (!booted) return null;
  if (inMenu()) return 'menu';
  const S = game.S;
  if (mode !== 'menu' && !choosing && COMBAT_ROOMS.includes(S.spec.type) && S.phase !== 'over') {
    if (S.spec.type !== 'boss') return `fight${Math.min(2, S.spec.floor)}`;
    // the record is scratched when the boss comes in, and its theme strikes up with its card; from half its health on
    // the theme's second phase takes over
    if (intro.now && !intro.shown) return null;
    const b = game.liveMobs().find(m => MOBS[m.k].boss);
    return b && b.hp <= b.max / 2 ? 'bossRage' : 'boss';
  }
  return 'calm';
}

// ------------------------------------------------------------ the boss's entrance

/** Rooms whose boss has made its entrance on this screen: once a room, and a reload doesn't bring it back. */
const INTRO_SEEN = 'discodungeon.bossIntro';
let introRoom = '';
const introSeen = (): string[] => { try { return JSON.parse(sessionStorage.getItem(INTRO_SEEN) ?? '[]'); } catch { return []; } };

/**
 * The boss's entrance plays on each screen for itself as the party comes into the boss's room, while the placement
 * waits (intro.ts); a tap skips it, and so does the fight starting without this screen (a player's while the host
 * started it).
 */
function bossIntro() {
  const S = game.S, key = `${S.spec.seed}:${S.spec.floor}:${S.spec.depth}`;
  if (intro.now) {
    if (S.phase !== 'place' || key !== introRoom || inMenu() || mode === 'menu') intro.skip();
    return;
  }
  if (key === introRoom || S.spec.type !== 'boss' || S.spec.tut || S.phase !== 'place' || S.turn !== 1 || mode === 'menu' || choosing || inMenu()) return;
  introRoom = key;
  const b = game.liveMobs().find(m => MOBS[m.k].boss), seen = introSeen();
  if (!b || !ENTRANCES[bossKind(b.k)] || seen.includes(key)) return;
  try { sessionStorage.setItem(INTRO_SEEN, JSON.stringify([...seen, key].slice(-12))); } catch { /* a private window: it may play again after a reload */ }
  // the record playing is scratched first, and the boss comes in after it
  intro.start(bossKind(b.k), S.spec.seed, sound.scratch() ? SCRATCH_BEAT : 0);
  openIntro(() => intro.skip());
  sound.prepare('boss', 'bossRage');
}
intro.on.sfx = (ev, p) => sound.play(ev, p);
intro.on.card = it => showCard(it, game.S.spec.floor);
intro.on.cardOut = cardOut;
intro.on.done = closeIntro;

// ------------------------------------------------------------ statistics

/** A player who hasn't touched the game for this long has walked away: the run's time stops until they are back. */
const AWAY_MS = 5 * 60 * 1000;
let touchedAt = performance.now(), statsAt = 0;
for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(ev, () => { touchedAt = performance.now(); }, { capture: true, passive: true });

/** Put what the run has come to so far into the statistics and write them down. */
function flushStats() {
  syncRun(run, myHeroes(), choosing);
  saveStats();
  creditStars();
}

/**
 * What the run has done so far for this player's heroes counted in it (src/progress.ts): the stars of the bosses beaten
 * and the heroes they open, the event the party stands in and what its choice opens, the trophies of the feats done.
 */
function creditStars() {
  const c = runCount(run);
  if (!c) return;
  // the last boss's photo comes with the end of the run: an online player's map never shows it
  const bosses = [...(run.shots ?? []), ...(ending?.album?.shots ?? [])].flatMap(s => (s ? [s.boss] : []));
  creditRun(run, c.heroes, { won: c.end === 'win', ev, sum: stats.sum, bosses, vol: game.bank.vol });
}

/** The run's time goes on while it is on screen and the player is at it; its numbers are written down every couple of seconds. */
function countStats(now: number, raw: number) {
  if (mode !== 'solo' && !(started && (mode === 'host' || mode === 'client'))) return;
  // a trinket's line opens in the collection as soon as the snapshot says the hero picked it up
  collect(myHeroes());
  // the enemies' dossier: the room the party is in (not the quiet one behind the map), counted the moment it is over
  if (!choosing) noteRoom(game.S);
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
  bossIntro();
  intro.update(dt);
  tutor.look();
  const t = track();
  sound.music(t);
  sound.muffle((t?.startsWith('fight') === true || t?.startsWith('boss') === true) && game.S.phase === 'enemy');
  shareState(now);
  keepSeat(now);
  keepRun(now);
  countStats(now, raw);
  const camKey = `${cam.panX},${cam.panY},${cam.zoom},${cam.rot}`;
  const changed = stale || camKey !== drawnCam || game.S !== drawnRoom || busy();
  const covered = document.querySelector('.overlay:not([hidden])') !== null;
  if (covered !== covering) { covering = covered; document.documentElement.classList.toggle('covered', covered); }
  const gap = covered ? (changed ? IDLE_GAP : Infinity) : changed ? BUSY_GAP : IDLE_GAP;
  if (cleared || now - drawnAt >= gap) {
    if (camKey !== drawnCam) camButtons();
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
  if (anim || moving || input.aim || input.carry || intro.now) return true;
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
window.addEventListener('pagehide', () => { keepRun(performance.now(), true); flushStats(); if (net.active) net.close(); });
// a phone may kill a page in the background without a pagehide
document.addEventListener('visibilitychange', () => { if (document.hidden) { keepRun(performance.now(), true); flushStats(); } });

// ------------------------------------------------------------ start

/** How long each gag stays on the loading screen, in ms. */
const GAG_TIME = 2800;
/** The loading screen is gone. */
let booted = false;
/** Every picture and font is in. */
let loaded = false;

// the language: the one picked before, or for a new player the browser's until they pick one on the loading screen; its
// table comes in beside the pictures
let langIn = setLang(isLang(settings.lang) ? settings.lang : detectLang());

/**
 * The game's name on the loading screen and in the main menu is a picture (art/logo in the README): «Диско-подполье» in
 * Russian, Disco Underground in every other language. Put in at once in the language being fetched, so a Russian player
 * never sees the English one first, and again on each change of language.
 */
// i18n-skip: each name as its picture spells it, not a line to translate
const LOGOS = { en: { w: 1080, h: 531, alt: 'Disco Underground' }, ru: { w: 1080, h: 458, alt: 'Диско-подполье' } };
function showLogo(code: Lang) {
  const k = code === 'ru' ? 'ru' : 'en', l = LOGOS[k], src = assetUrl(`ui/logo_${k}.webp`);
  for (const img of document.querySelectorAll<HTMLImageElement>('img.logo-pic')) {
    if (img.getAttribute('src') === src) continue;
    img.width = l.w;
    img.height = l.h;
    img.alt = l.alt;
    img.src = src;
  }
}
showLogo(isLang(settings.lang) ? settings.lang : detectLang());
onLang(() => showLogo(lang()));

/** The languages on the loading screen, each by its own name, the one on (or just tapped) lit. */
function bootLangs(on: Lang = lang()) {
  $('bootLangs').innerHTML = LANGS.map(l =>
    `<button type="button" role="radio" lang="${l.tag}" data-lang="${l.code}" aria-checked="${l.code === on}">${l.name}</button>`).join('');
}
bootLangs();
$('bootLangs').addEventListener('click', e => {
  const code = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-lang]')?.dataset.lang;
  if (!isLang(code)) return;
  settings.lang = code;
  saveSettings();
  bootLangs(code);
  langIn = setLang(code);
  go();
});

// the loading screen's gags, in a fresh order each time, faded from one to the next, in the language once its table is in
const gags = BOOT_GAGS.slice();
for (let i = gags.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [gags[i], gags[j]] = [gags[j], gags[i]];
}
let gagAt = 0;
langIn.then(() => { $('bootGag').textContent = t(gags[gagAt]); });
const gagTimer = setInterval(() => {
  const note = $('bootGag');
  note.classList.add('out');
  setTimeout(() => { note.textContent = t(gags[(gagAt = (gagAt + 1) % gags.length)]); note.classList.remove('out'); }, 300);
}, GAG_TIME);

/**
 * Once everything is in, the game goes on in the language picked. On the first start it waits for the pick: the bar and the
 * gags make way for the languages alone.
 */
function go() {
  if (!loaded) return;
  if (!isLang(settings.lang)) { $('boot').classList.add('langs-only'); return; }
  langIn.then(start);
}

// a change of language writes again what the game wrote itself; the page's own text is put in it by src/i18n.ts
onLang(() => {
  bootLangs();
  hud.relang();
  if (!booted) { $('bootGag').textContent = t(gags[gagAt]); return; }
  showEvent();
  showCamp();
  showLoot();
  if (!$('mapScreen').hidden) showMap(true);
  if (!$('lobby').hidden) lobbyView();
  stale = true;
  dirty = true;
});

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
  loaded = true;
  go();
  // the offline cache, filled once the game has what it needs, so the two don't share the first download
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
});
$('waitLeave').addEventListener('click', () => { leaveOnline(); hideEnd(); showMap(false); openMenu(); });
requestAnimationFrame(frame);

// handle for automated checks
Object.assign(window, { __dd: { game, cam, hud, scene, ctx, net, sound, choose, get view() { return view; }, get run() { return run; }, get mode() { return mode; }, get ev() { return ev; }, get camp() { return camp; }, get loot() { return loot; } } });
