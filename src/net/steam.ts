// Online play in the desktop build for Steam (electron/): a room is a Steam lobby, and the host and each player talk
// through Steam's P2P, straight or through Valve's relays when no direct way gets through. Friends come in by Steam's
// invite or by «Join game» in the friends list; anyone else types the room's code, the lobby's own Steam id written
// short. Only the way through differs from the browser's (src/net/link.ts): the same links, pings and messages run over it.

import { MAX_PLAYERS } from '../data';
import { note, RoomError, wrap, type Accept, type HostedRoom, type JoinRoom, type LinkHandlers, type OpenRoom, type Pipe } from './link';

/** What the desktop app gives the page (electron/preload.cjs). */
export interface Desktop {
  quit(): void;
  /** The game's language as picked for it in Steam, by the game's code; null without Steam. */
  lang: string | null;
  /** Steam, or null when it didn't start: not running, or the game not started through it. */
  steam: SteamBridge | null;
}

/** Steam as the main process gives it (electron/steam.cjs); players, lobbies and packets go by Steam ids, as strings. */
export interface SteamBridge {
  id: string;
  name: string;
  /** The lobby Steam started the game to join (`+connect_lobby`): a friend's invite taken while the game was closed. */
  launch: string | null;
  /** Makes a lobby for this many players with this data in it, and gives its id. */
  host(max: number, data: Record<string, string>): Promise<string>;
  /** Goes into a lobby, unless already in it, and gives its data. */
  enter(lobby: string): Promise<Record<string, string>>;
  leave(lobby: string): void;
  /** Steam's window for inviting friends into the lobby. */
  invite(lobby: string): void;
  send(to: string, data: string): void;
  onPacket(cb: (from: string, data: string) => void): void;
  /** Steam gave up reaching that player. */
  onFail(cb: (remote: string) => void): void;
  /** The player took a friend's invite, or «Join game» on a friend, while playing. */
  onInvite(cb: (lobby: string) => void): void;
}

export const desktop: Desktop | null = (globalThis as { desktop?: Desktop }).desktop ?? null;

/** The mark of the game's lobbies: AppID 480, the one for tests, is shared by every game being made. */
const GAME = 'disco-underground';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** The upper half of every lobby's Steam id (public universe, chat account, lobby instance): a code carries the rest. */
const LOBBY = 0x01840000n;

/** A lobby's code: 7 letters, 13 for a Steam id of some other shape (never seen). */
export function codeOf(lobby: string): string {
  let id = BigInt(lobby), s = '';
  const n = id >> 32n === LOBBY ? 7 : 13;
  if (n === 7) id &= 0xffffffffn;
  for (let i = 0; i < n; i++, id >>= 5n) s = LETTERS[Number(id & 31n)] + s;
  return s;
}

/** The lobby a code stands for; null for anything that is no lobby's code. */
export function lobbyOf(code: string): string | null {
  code = code.toUpperCase();
  if (code.length !== 7 && code.length !== 13) return null;
  let id = 0n;
  for (const ch of code) {
    const v = LETTERS.indexOf(ch);
    if (v < 0) return null;
    id = (id << 5n) | BigInt(v);
  }
  if (code.length === 13) return id < 1n << 64n ? String(id) : null;
  return id <= 0xffffffffn ? String((LOBBY << 32n) | id) : null;
}

/**
 * What goes between two Steam players, a link each (`c`, made by the player): the player knocks (`o`) until the host
 * answers (`a`), then messages (`m`) go both ways until either side closes the link (`x`). One who gets a message for a
 * link it doesn't have answers `x`, so a player still talking to a host that came back after a crash is told at once.
 */
type Packet = { c: string; k: 'o' | 'a' | 'm' | 'x'; m?: unknown };

/** How long a player waits for the host to answer, knocking every so often meanwhile. */
const JOIN_MS = 15000;
const KNOCK_MS = 1000;

const notFound = () => new RoomError('peer-unavailable', 'Комната не найдена. Проверь код, и чтобы хозяин комнаты был в лобби.');
const noAnswer = () => new RoomError('timeout', 'Не удалось подключиться к комнате. Проверь код, и чтобы хозяин комнаты был в лобби.');
const noSteam = () => new RoomError('steam', 'Сетевая игра идёт через Steam. Запусти Steam и открой игру снова.');

/** One link's connection, under the same pings and messages as the browser's links. */
class SteamPipe implements Pipe {
  open = true;
  private data: ((d: unknown) => void) | null = null;
  /** What came before the link listened. */
  private early: unknown[] = [];
  private gone: (() => void)[] = [];

  constructor(readonly peer: string, private post: (p: Packet) => void, readonly c: string, private done: () => void) {}

  send(m: unknown) {
    if (this.open) this.post({ c: this.c, k: 'm', m });
  }

  on(event: 'data', cb: (d: unknown) => void): void;
  on(event: 'close' | 'error', cb: () => void): void;
  on(event: 'data' | 'close' | 'error', cb: (d: unknown) => void) {
    if (event === 'data') {
      this.data = cb;
      for (const d of this.early.splice(0)) cb(d);
    } else if (event === 'close') this.gone.push(() => cb(undefined));
  }

  take(d: unknown) {
    if (!this.open) return;
    if (this.data) this.data(d);
    else this.early.push(d);
  }

  /** Closed on purpose: the other side hears of it. */
  close() {
    if (!this.open) return;
    this.open = false;
    this.post({ c: this.c, k: 'x' });
    this.done();
  }

  /** The other side closed it, or Steam can't reach it. */
  lost() {
    if (!this.open) return;
    this.open = false;
    this.done();
    for (const f of this.gone) f();
  }
}

/**
 * Rooms and links over Steam. `leave` lets go of the lobby for good (the player left the room): a player whose link
 * dropped stays in it meanwhile, so a host back from a crash finds its lobby still there and its players in it.
 */
export function steamNet(steam: SteamBridge | null): { open: OpenRoom; join: JoinRoom; leave(): void; invite(): void } {
  /** Live links by `<Steam id>/<link>`, and the player's knocks still waiting for an answer. */
  const pipes = new Map<string, SteamPipe>();
  const knocks = new Map<string, { peer: string; ok(): void; no(e: RoomError): void }>();
  /** Where the room this side hosts takes new links. */
  let hosting: ((accept: Accept) => void) | null = null;
  /** The lobbies this side is in, and the one the room it plays in lives in. */
  const inside = new Set<string>();
  let using: string | null = null;
  /** Bumped by each attempt and by leave(), so an attempt overtaken by another lets its lobby go. */
  let turn = 0;

  const post = (to: string, p: Packet) => steam?.send(to, JSON.stringify(p));
  const pipe = (peer: string, c: string) => {
    const key = `${peer}/${c}`, p = new SteamPipe(peer, m => post(peer, m), c, () => pipes.delete(key));
    pipes.set(key, p);
    return p;
  };
  const keepOnly = (lobby: string | null) => {
    using = lobby;
    for (const l of inside) if (l !== lobby) { steam?.leave(l); inside.delete(l); }
  };
  /** The lobby an attempt got into: the room's now, or let go if a newer attempt came meanwhile. */
  const settle = (my: number, lobby: string) => {
    inside.add(lobby);
    if (my === turn) return keepOnly(lobby);
    if (lobby !== using) { steam?.leave(lobby); inside.delete(lobby); }
    throw new RoomError('cancelled', '');
  };

  steam?.onPacket((from, data) => {
    let p: Packet;
    try {
      p = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof p?.c !== 'string') return;
    const key = `${from}/${p.c}`, have = pipes.get(key);
    if (p.k === 'm') {
      if (have) have.take(p.m);
      else post(from, { c: p.c, k: 'x' });
    } else if (p.k === 'x') {
      have?.lost();
      knocks.get(key)?.no(notFound());
    } else if (p.k === 'a') knocks.get(key)?.ok();
    else if (p.k === 'o') {
      // a knock again before the answer got there
      if (have) return post(from, { c: p.c, k: 'a' });
      if (!hosting) return post(from, { c: p.c, k: 'x' });
      const fresh = pipe(from, p.c);
      post(from, { c: p.c, k: 'a' });
      note('player joined through Steam');
      hosting(h => wrap(fresh, h, 'steam'));
    }
  });
  steam?.onFail(remote => {
    note(`Steam can't reach ${remote}`);
    for (const p of [...pipes.values()]) if (p.peer === remote) p.lost();
    for (const k of [...knocks.values()]) if (k.peer === remote) k.no(noAnswer());
  });

  const open: OpenRoom = async (code, onConnection, again) => {
    if (!steam) throw noSteam();
    const my = ++turn;
    let lobby: string | null = null;
    // back from a crash: the players wait in the old lobby, so the host goes back into it if it is still its own
    const old = again ? lobbyOf(code) : null;
    if (old) {
      const d = await steam.enter(old).catch(() => null);
      if (d?.game === GAME && d.host === steam.id) lobby = old;
      else if (d) steam.leave(old);
    }
    lobby ??= await steam.host(MAX_PLAYERS, { game: GAME, host: steam.id }).catch(() => {
      throw new RoomError('network', 'Нет связи с сервером комнат. Проверь интернет.');
    });
    settle(my, lobby);
    hosting = onConnection;
    const room: HostedRoom = {
      code: codeOf(lobby),
      close: () => {
        if (hosting === onConnection) hosting = null;
        if (inside.delete(lobby)) steam.leave(lobby);
        if (using === lobby) using = null;
      },
    };
    note(`room ${room.code} open (Steam)`);
    return room;
  };

  const join: JoinRoom = async (code, h: LinkHandlers) => {
    if (!steam) throw noSteam();
    const my = ++turn, lobby = lobbyOf(code);
    if (!lobby) throw notFound();
    const d = await steam.enter(lobby).catch(() => null);
    if (!d) throw notFound();
    const host = d.host;
    // another game's lobby (they share AppID 480 while testing), or this side's own room
    if (d.game !== GAME || !host || host === steam.id) {
      if (!inside.has(lobby)) steam.leave(lobby);
      throw notFound();
    }
    settle(my, lobby);
    const c = Math.random().toString(36).slice(2, 10), key = `${host}/${c}`;
    const link = await new Promise<SteamPipe>((ok, no) => {
      const knock = () => post(host, { c, k: 'o' });
      const timer = setInterval(knock, KNOCK_MS);
      const give = setTimeout(() => k.no(noAnswer()), JOIN_MS);
      const end = () => {
        clearInterval(timer);
        clearTimeout(give);
        knocks.delete(key);
      };
      // the link is in place the moment the answer comes, before anything the host sends after it
      const k = { peer: host, ok: () => { end(); ok(pipe(host, c)); }, no: (e: RoomError) => { end(); no(e); } };
      knocks.set(key, k);
      knock();
    });
    note(`${code}: steam`);
    return wrap(link, h, 'steam');
  };

  return {
    open,
    join,
    leave: () => {
      turn++;
      hosting = null;
      keepOnly(null);
    },
    invite: () => { if (using) steam?.invite(using); },
  };
}
