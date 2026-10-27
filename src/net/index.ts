// Online co-op. One browser hosts and runs the game; the others send their actions and draw the host's
// snapshots. Each player has its own link to the host, made the way Dark Realm makes them (src/net/link.ts):
// straight over WebRTC through the PeerJS broker, or through public MQTT brokers when WebRTC can't get
// through, moving over to a direct link once the relay has helped set one up. The desktop build for Steam makes them
// over Steam's P2P instead (src/net/steam.ts).

import type { CampPick } from '../camp';
import type { Action } from '../game';
import type { Ending } from '../resume';
import type { StandMat } from '../stands';
import type { MapState, Snapshot } from '../sync';
import { hostRoom, joinRoom, RoomError, type Accept, type HostedRoom, type JoinRoom, type Link, type OpenRoom } from './link';

/**
 * `key` is the player's secret for rejoining after a drop; only the host keeps it. `ready`: the player pressed
 * «Готов» in the lobby (the host has no such flag: pressing «Начать» is its word).
 */
/** `stand`: the stand the player put the hero picked on, of the ones their wins with it have earned (src/stands.ts). */
export interface Player { id: string; name: string; hero: number | null; key?: string; ready?: boolean; look?: number | null; stand?: StandMat }

export type Msg =
  /** A player's first word on every link: which browser it is, so a link made anew after a drop keeps its place. */
  | { t: 'me'; id: string }
  /** `demo`: the player plays the demo (src/demo.ts); a room takes only players of its own version. */
  | { t: 'hello'; name: string; key: string; demo?: boolean }
  /** The host turns a player away (the room is full, or the game started without them). */
  | { t: 'deny'; text: string }
  | { t: 'lobby'; players: Player[]; bg?: number; vol?: number }
  | { t: 'pick'; hero: number | null; stand?: StandMat }
  /** A player still without a hero points at one in the lobby: the others see it pale in the party photo. */
  | { t: 'look'; hero: number | null }
  /** A player in the lobby says they are ready to start, or takes it back. */
  | { t: 'ready'; on: boolean }
  | { t: 'start'; players: Player[] }
  | { t: 'act'; a: Action }
  | { t: 'snap'; s: Snapshot }
  /** The run map and how the vote for the next room stands, whenever either changes. */
  | { t: 'map'; m: MapState }
  /** A player points at the room they want to go to next. */
  | { t: 'vote'; id: string }
  /** A player points at one of the event's choices, by its place in the list. */
  | { t: 'evote'; opt: number }
  /** A player says what their hero does by the camp's fire. */
  | { t: 'camp'; pick: CampPick }
  /**
   * A player points at one of the floor boss's trophies for their hero, by its place in the offer; a hero with all sockets
   * taken may keep its own (PASS), take its pick back (UNDO), or name the trophy of its own it throws away (`drop`).
   */
  | { t: 'loot'; opt: number; drop?: string }
  /** A player back at the table takes one of the trophies kept for their hero while they were away. */
  | { t: 'kept'; k: string }
  /** A cleared room's result: each player reads it and walks over to the map on their own. */
  | { t: 'end'; e: Ending }
  /** A screen the players wait on until the host acts (the end of the run); an empty title hides it. */
  | { t: 'screen'; title: string; text: string; win?: boolean; lose?: boolean }
  | { t: 'lobbyBack' }
  /** The host closed the room on purpose, so there is nothing to reconnect to. */
  | { t: 'bye' };

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A link that hasn't said which browser it is by then is closed. */
const ME_MS = 10000;
/** How long a room opened again after a crash keeps trying for its code: the broker may still hold it for the old page. */
const REOPEN_MS = 60000;
/** How often a snapshot held back for a busy link is looked at again. */
const FLUSH_MS = 50;

const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Net {
  isHost = false;
  code = '';
  /** This browser's id: 'host' for the host, else one made for this page. */
  id = '';
  private readonly self = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
  private room: HostedRoom | null = null;
  /** Host: each player's link. Client: the link to the host, under 'host'. */
  private links = new Map<string, Link>();
  /**
   * Host: the latest snapshot for a player whose link is still busy with the ones before. Over the relay a
   * state every 50 ms would pile up, so the player gets the newest one as soon as the link catches up.
   */
  private held = new Map<string, Msg>();
  private flush: ReturnType<typeof setInterval> | undefined;
  /** Bumped by close(), so an attempt still under way knows it was called off. */
  private gen = 0;
  onMsg: (from: string, m: Msg) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  /** The connection to the host dropped (clients only). */
  onLost: () => void = () => {};

  constructor(private open: OpenRoom = hostRoom, private join: JoinRoom = joinRoom) {}

  get active() { return this.code !== ''; }

  /** Open a room; with `again`, reopen that code after a crash. */
  async hostRoom(again?: string): Promise<string> {
    this.close();
    const gen = this.gen;
    const until = Date.now() + REOPEN_MS;
    for (;;) {
      const code = again ?? newCode();
      Object.assign(this, { isHost: true, code, id: 'host' });
      try {
        const room = await this.open(code, accept => this.accept(gen, accept), !!again);
        if (gen !== this.gen) { room.close(); throw new Error(''); }
        this.room = room;
        if (room.code) this.code = room.code;
        this.flush = setInterval(() => this.release(), FLUSH_MS);
        return this.code;
      } catch (e) {
        if (gen !== this.gen) throw e;
        this.reset();
        // a fresh room just takes another code; the same room after a crash waits for the broker to let the old page go
        if (!again && e instanceof RoomError && e.type === 'unavailable-id') continue;
        if (!again || Date.now() > until) throw e;
        await sleep(3000);
        if (gen !== this.gen) throw e;
      }
    }
  }

  async joinRoom(code: string): Promise<void> {
    this.close();
    const gen = this.gen;
    Object.assign(this, { isHost: false, code: code.toUpperCase(), id: this.self });
    let link: Link;
    try {
      link = await this.join(this.code, {
        onMessage: m => { if (this.links.get('host') === link) this.onMsg('host', m); },
        onClose: () => {
          if (this.links.get('host') !== link) return;
          this.links.delete('host');
          this.onLost();
        },
      });
    } catch (e) {
      if (gen === this.gen) this.close();
      throw e;
    }
    if (gen !== this.gen) { link.close(); throw new Error(''); }
    this.links.set('host', link);
    link.send({ t: 'me', id: this.self });
  }

  /** Host: a link opened; it becomes a player once it says which browser it is. */
  private accept(gen: number, accept: Accept) {
    let id = '';
    const link: Link = accept({
      onMessage: m => {
        if (id) { if (this.links.get(id) === link) this.onMsg(id, m); return; }
        if (m.t !== 'me' || typeof m.id !== 'string' || !m.id || m.id === 'host') return;
        id = m.id;
        const old = this.links.get(id);
        this.links.set(id, link);
        // the same browser on a new link: the old one is stale, and the player keeps its place
        if (old) { old.close(); this.held.delete(id); } else this.onJoin(id);
      },
      onClose: () => { if (id && this.links.get(id) === link) this.drop(id); },
    });
    if (gen !== this.gen) { link.close(); return; }
    setTimeout(() => { if (!id) link.close(); }, ME_MS);
  }

  /** Host: a player is gone. */
  private drop(id: string) {
    if (!this.links.delete(id)) return;
    this.held.delete(id);
    this.onLeave(id);
  }

  private deliver(id: string, m: Msg) {
    const link = this.links.get(id);
    if (!link) return;
    if (m.t === 'snap') {
      if (link.busy()) { this.held.set(id, m); return; }
    } else {
      // a held snapshot goes first, so the player sees things in the order they happened
      const held = this.held.get(id);
      if (held) link.send(held);
    }
    this.held.delete(id);
    link.send(m);
  }

  /** Host: send the snapshots held back for links that have caught up. */
  private release() {
    for (const [id, m] of this.held) {
      const link = this.links.get(id);
      if (!link) this.held.delete(id);
      else if (!link.busy()) { this.held.delete(id); link.send(m); }
    }
  }

  /** Client: message the host. */
  send(m: Msg) {
    this.links.get('host')?.send(m);
  }

  /** Host: message one player or everyone. */
  sendTo(id: string, m: Msg) {
    this.deliver(id, m);
  }

  broadcast(m: Msg) {
    for (const id of [...this.links.keys()]) this.deliver(id, m);
  }

  /** Host: is this player still connected? ('host' always is.) */
  has(id: string) {
    return id === 'host' || this.links.has(id);
  }

  /** Host: let a player go (it was turned away, or came back on another link). */
  kick(id: string) {
    this.links.get(id)?.close();
    this.drop(id);
  }

  close() {
    this.gen++;
    this.reset();
  }

  private reset() {
    clearInterval(this.flush);
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.held.clear();
    this.room?.close();
    this.room = null;
    this.isHost = false;
    this.code = '';
    this.id = '';
  }
}
