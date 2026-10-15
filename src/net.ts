// Online co-op over WebRTC. One browser hosts and runs the game; the others send their actions and draw
// the host's snapshots. PeerJS's public broker only introduces the browsers; game traffic goes peer to peer.

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
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
  /** Heartbeat both ways: a closed tab does not always close its WebRTC channel. */
  | { t: 'ping' };

const PREFIX = 'discodungeon-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `?peer=host:port` points at a self-hosted PeerServer (used for local testing). */
function peerOptions(): Partial<PeerOptions> {
  const q = new URLSearchParams(location.search).get('peer');
  if (!q) return { debug: 0 };
  const [host, port] = q.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

/** A peer silent for this long counts as gone. */
const TIMEOUT = 8000;

const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

export class Net {
  peer: Peer | null = null;
  isHost = false;
  code = '';
  /** This browser's id: 'host' for the host, else its PeerJS id. */
  id = '';
  private conns = new Map<string, DataConnection>();
  private hostConn: DataConnection | null = null;
  private seen = new Map<string, number>();
  private beat = 0;
  onMsg: (from: string, m: Msg) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  /** The connection to the host dropped (clients only). */
  onLost: () => void = () => {};

  get active() { return !!this.peer; }

  /** Open a room; with `again`, reopen that code after a crash (the broker may hold it for a while). */
  hostRoom(again?: string): Promise<string> {
    this.close();
    return new Promise((resolve, reject) => {
      const tryCode = (left: number) => {
        const code = again ?? newCode(), peer = new Peer(PREFIX + code, peerOptions());
        peer.on('open', () => {
          this.peer = peer; this.isHost = true; this.code = code; this.id = 'host';
          this.startBeat();
          keepBroker(peer);
          resolve(code);
        });
        peer.on('error', e => {
          if (e.type === 'unavailable-id' && left > 0) {
            peer.destroy();
            if (again) setTimeout(() => tryCode(left - 1), 3000);
            else tryCode(left - 1);
            return;
          }
          if (!this.peer) { peer.destroy(); reject(new Error(explain(e.type))); }
        });
        peer.on('connection', conn => {
          conn.on('open', () => { this.conns.set(conn.peer, conn); this.seen.set(conn.peer, Date.now()); this.onJoin(conn.peer); });
          conn.on('data', d => { this.seen.set(conn.peer, Date.now()); if ((d as Msg).t !== 'ping') this.onMsg(conn.peer, d as Msg); });
          conn.on('close', () => this.drop(conn.peer));
          conn.on('error', () => this.drop(conn.peer));
        });
      };
      tryCode(again ? 20 : 3);
    });
  }

  joinRoom(code: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      let opened = false;
      const fail = (msg: string) => { if (!opened) { peer.destroy(); reject(new Error(msg)); } };
      const timer = setTimeout(() => fail('Не удалось соединиться. Проверь код и попробуй ещё раз.'), 15000);
      peer.on('error', e => fail(explain(e.type)));
      peer.on('open', id => {
        const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          opened = true;
          clearTimeout(timer);
          this.peer = peer; this.isHost = false; this.code = code.toUpperCase(); this.id = id; this.hostConn = conn;
          this.seen.set('host', Date.now());
          this.startBeat();
          keepBroker(peer);
          resolve();
        });
        conn.on('data', d => { this.seen.set('host', Date.now()); if ((d as Msg).t !== 'ping') this.onMsg('host', d as Msg); });
        conn.on('close', () => this.lose(conn));
      });
    });
  }

  private startBeat() {
    clearInterval(this.beat);
    this.beat = window.setInterval(() => {
      const now = Date.now();
      if (this.isHost) {
        this.broadcast({ t: 'ping' });
        for (const id of [...this.conns.keys()]) if (now - (this.seen.get(id) ?? now) > TIMEOUT) this.drop(id);
      } else if (this.hostConn) {
        this.send({ t: 'ping' });
        if (now - (this.seen.get('host') ?? now) > TIMEOUT) this.lose(this.hostConn);
      }
    }, 2000);
  }

  /** Host: a player is gone. */
  private drop(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    this.seen.delete(id);
    c.close();
    this.onLeave(id);
  }

  /** Client: the host is gone. */
  private lose(conn: DataConnection) {
    if (this.hostConn !== conn) return;
    this.hostConn = null;
    conn.close();
    this.onLost();
  }

  /** Client: message the host. */
  send(m: Msg) {
    if (this.hostConn?.open) this.hostConn.send(m);
  }

  /** Host: message one player or everyone. */
  sendTo(id: string, m: Msg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(m);
  }

  broadcast(m: Msg) {
    for (const c of this.conns.values()) if (c.open) c.send(m);
  }

  /** Host: is this player still connected? ('host' always is.) */
  has(id: string) {
    return id === 'host' || this.conns.has(id);
  }

  kick(id: string) {
    this.conns.get(id)?.close();
  }

  close() {
    clearInterval(this.beat);
    this.seen.clear();
    this.hostConn = null;
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
    this.isHost = false;
    this.code = '';
    this.id = '';
  }
}

/** A dropped link to the broker doesn't break open games, but the host needs it for players to rejoin. */
function keepBroker(peer: Peer) {
  peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000));
}

function explain(type: string) {
  if (type === 'peer-unavailable') return 'Комната с таким кодом не найдена.';
  if (type === 'browser-incompatible') return 'Этот браузер не поддерживает сетевую игру.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Нет связи с сервером знакомства. Проверь интернет.';
  return 'Не удалось соединиться. Попробуй ещё раз.';
}
