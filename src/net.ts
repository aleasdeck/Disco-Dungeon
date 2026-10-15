// Online co-op over WebRTC. One browser hosts and runs the game; the others send their actions and draw
// the host's snapshots. Public relays (Nostr, MQTT and BitTorrent trackers, all at once) only introduce
// the browsers to each other; game traffic then goes peer to peer. If one network of relays is down or
// blocked, the others still connect, and each player talks over whichever link came up first.

import type { DataPayload, Room } from '@trystero-p2p/core';
import type { Action } from './game';
import type { Snapshot } from './sync';

/** `key` is the player's secret for rejoining after a drop; only the host keeps it. */
export interface Player { id: string; name: string; hero: number | null; key?: string }

export type Msg =
  | { t: 'hello'; name: string; key: string }
  /** The host turns a player away (the room is full, or the game started without them). */
  | { t: 'deny'; text: string }
  | { t: 'lobby'; players: Player[] }
  | { t: 'pick'; hero: number | null }
  | { t: 'start'; players: Player[] }
  | { t: 'act'; a: Action }
  | { t: 'snap'; s: Snapshot }
  /** A screen everyone sees while the host chooses (the map, the end of a room); an empty title hides it. */
  | { t: 'screen'; title: string; text: string }
  | { t: 'lobbyBack' }
  /** The host closed the room on purpose, so there is nothing to reconnect to. */
  | { t: 'bye' }
  /** The host tells each browser that turns up which peer runs the room. */
  | { t: 'host' }
  /** Heartbeat both ways: a closed tab does not always close its WebRTC channel. */
  | { t: 'ping' };

const APP = 'discodungeon';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A peer silent for this long counts as gone. */
const TIMEOUT = 8000;
/** How long a player waits to hear from the host before giving up on joining. */
const JOIN_WAIT = 25000;

/** Free public TURN relay for networks that block direct connections (mobile carriers, strict NATs). */
const TURN: RTCIceServer[] = [
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

interface Strategy { join: (roomId: string) => Room; up: () => boolean }

/** True when at least one relay socket of a strategy is open. */
function anyOpen(sockets: unknown) {
  return Object.values((sockets ?? {}) as Record<string, { readyState?: number; connected?: boolean } | undefined>)
    .some(s => s?.readyState === 1 || s?.connected === true);
}

let strategies: Promise<Strategy[]> | null = null;

/** The relay networks to meet on. `?relay=ws://host:port` uses one self-hosted relay instead (local testing). */
function loadStrategies(): Promise<Strategy[]> {
  if (strategies) return strategies;
  const relay = new URLSearchParams(location.search).get('relay');
  const cfg = { appId: APP, turnConfig: TURN };
  strategies = relay
    ? import('@trystero-p2p/ws-relay').then(m => [{ join: id => m.joinRoom({ ...cfg, turnConfig: [], relayConfig: { urls: [relay] } }, id), up: () => anyOpen(m.getRelaySockets()) }])
    : Promise.all([
      import('@trystero-p2p/nostr').then((m): Strategy => ({ join: id => m.joinRoom({ ...cfg, relayConfig: { warnOnRelayFailure: false } }, id), up: () => anyOpen(m.getRelaySockets()) })),
      import('@trystero-p2p/mqtt').then((m): Strategy => ({ join: id => m.joinRoom({ ...cfg, relayConfig: { warnOnRelayFailure: false } }, id), up: () => anyOpen(m.getRelaySockets()) })),
      import('@trystero-p2p/torrent').then((m): Strategy => ({ join: id => m.joinRoom({ ...cfg, relayConfig: { warnOnRelayFailure: false } }, id), up: () => anyOpen(m.getRelaySockets()) })),
    ]);
  return strategies;
}

const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Net {
  isHost = false;
  code = '';
  /** This browser's id: 'host' for the host, else its peer id. */
  id = '';
  private rooms: { room: Room; send: (m: Msg, to?: string) => void }[] = [];
  private strats: Strategy[] = [];
  /** Which room (relay network) each connected peer talks through: the first that brought it. */
  private via = new Map<string, number>();
  /** Host: the players' peers. Client: only the host. */
  private peers = new Set<string>();
  /** Host: peers sent away; whatever they send is ignored. */
  private banned = new Set<string>();
  private hostPeer = '';
  private seen = new Map<string, number>();
  private beat = 0;
  /** Rooms being left; a room with the same name can only be joined again once they are gone. */
  private leaving: Promise<unknown> = Promise.resolve();
  /** Client: the host has been found (joinRoom resolves on this). */
  private found: (() => void) | null = null;
  onMsg: (from: string, m: Msg) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  /** The connection to the host dropped (clients only). */
  onLost: () => void = () => {};

  get active() { return this.rooms.length > 0; }

  /** Open a room; with `again`, reopen that code after a crash. */
  async hostRoom(again?: string): Promise<string> {
    this.close();
    const code = again ?? newCode();
    await this.open(code, true);
    // without any relay the room exists only here and nobody can find it
    if (!(await this.relaysUp(10000))) { this.close(); throw new Error('Нет связи с серверами знакомства. Проверь интернет или выключи VPN.'); }
    return code;
  }

  async joinRoom(code: string): Promise<void> {
    this.close();
    await this.open(code.toUpperCase(), false);
    const met = new Promise<boolean>(r => { this.found = () => r(true); setTimeout(() => r(false), JOIN_WAIT); });
    if (await met) { this.found = null; return; }
    this.found = null;
    const up = this.strats.some(s => s.up());
    this.close();
    throw new Error(up ? 'Комната не найдена. Проверь код, и чтобы хозяин комнаты был в лобби.' : 'Нет связи с серверами знакомства. Проверь интернет или выключи VPN.');
  }

  private async open(code: string, host: boolean) {
    this.strats = await loadStrategies();
    await this.leaving;
    this.isHost = host;
    this.code = code;
    this.id = host ? 'host' : (await import('@trystero-p2p/core')).selfId;
    this.rooms = this.strats.map((s, k) => {
      const room = s.join(`${APP}-${code}`);
      // messages are plain JSON; the relay library's JSON type just can't see that through our interfaces
      const act = room.makeAction('m');
      act.onMessage = (m, { peerId }) => this.receive(k, peerId, m as unknown as Msg);
      room.onPeerJoin = id => this.meet(k, id);
      room.onPeerLeave = id => this.part(k, id);
      return { room, send: (m: Msg, to?: string) => { act.send(m as unknown as DataPayload, to ? { target: to } : undefined).catch(() => {}); } };
    });
    this.startBeat();
  }

  private async relaysUp(wait: number) {
    for (let t = 0; t < wait; t += 250) {
      if (this.strats.some(s => s.up())) return true;
      await sleep(250);
    }
    return false;
  }

  /** A peer appeared on one relay network; the first network to bring it is the one used for it. */
  private meet(k: number, id: string) {
    if (!this.via.has(id)) this.via.set(id, k);
    if (this.isHost && !this.banned.has(id)) this.rooms[k].send({ t: 'host' }, id);
  }

  /** A peer's link on one network closed: switch to another network that still has it, else it is gone. */
  private part(k: number, id: string) {
    if (this.via.get(id) !== k) return;
    const other = this.rooms.findIndex((r, j) => j !== k && id in r.room.getPeers());
    if (other >= 0) { this.via.set(id, other); return; }
    this.via.delete(id);
    if (this.isHost) this.drop(id);
    else if (id === this.hostPeer) this.lose();
  }

  private receive(k: number, from: string, m: Msg) {
    if (!this.via.has(from)) this.via.set(from, k);
    if (this.via.get(from) !== k) return;
    if (this.isHost) {
      if (this.banned.has(from)) return;
      if (!this.peers.has(from)) { this.peers.add(from); this.onJoin(from); }
      this.seen.set(from, Date.now());
      if (m.t !== 'ping') this.onMsg(from, m);
      return;
    }
    if (m.t === 'host') {
      // the first host heard of is the room's host; a stale one from an earlier session is ignored
      if (!this.hostPeer || this.hostPeer === from) { this.hostPeer = from; this.peers.add(from); this.seen.set('host', Date.now()); this.found?.(); }
      // a new host while ours has gone quiet: the host came back on a fresh page, so start over with it
      else if (Date.now() - (this.seen.get('host') ?? 0) > 3000) this.lose();
      return;
    }
    if (from !== this.hostPeer) return;
    this.seen.set('host', Date.now());
    if (m.t !== 'ping') this.onMsg('host', m);
  }

  private to(id: string, m: Msg) {
    const k = this.via.get(id);
    if (k !== undefined) this.rooms[k]?.send(m, id);
  }

  private startBeat() {
    clearInterval(this.beat);
    this.beat = window.setInterval(() => {
      const now = Date.now();
      if (this.isHost) {
        this.broadcast({ t: 'ping' });
        for (const id of [...this.peers]) if (now - (this.seen.get(id) ?? now) > TIMEOUT) this.drop(id);
      } else if (this.hostPeer) {
        this.send({ t: 'ping' });
        if (now - (this.seen.get('host') ?? now) > TIMEOUT) this.lose();
      }
    }, 2000);
  }

  /** Host: a player is gone. */
  private drop(id: string) {
    if (!this.peers.delete(id)) return;
    this.seen.delete(id);
    this.onLeave(id);
  }

  /** Client: the host is gone. */
  private lose() {
    if (!this.hostPeer) return;
    this.hostPeer = '';
    this.peers.clear();
    this.onLost();
  }

  /** Client: message the host. */
  send(m: Msg) {
    if (this.hostPeer) this.to(this.hostPeer, m);
  }

  /** Host: message one player or everyone. */
  sendTo(id: string, m: Msg) {
    if (this.peers.has(id)) this.to(id, m);
  }

  broadcast(m: Msg) {
    for (const id of this.peers) this.to(id, m);
  }

  /** Host: is this player still connected? ('host' always is.) */
  has(id: string) {
    return id === 'host' || this.peers.has(id);
  }

  /** Host: stop listening to a peer (it was turned away, or its player came back on another link). */
  kick(id: string) {
    this.banned.add(id);
    this.drop(id);
  }

  close() {
    clearInterval(this.beat);
    this.leaving = Promise.all(this.rooms.map(r => r.room.leave().catch(() => {})));
    this.rooms = [];
    this.via.clear();
    this.peers.clear();
    this.banned.clear();
    this.seen.clear();
    this.hostPeer = '';
    this.found = null;
    this.isHost = false;
    this.code = '';
    this.id = '';
  }
}
