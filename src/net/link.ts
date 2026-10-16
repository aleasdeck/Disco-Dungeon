import Peer, { type PeerOptions } from 'peerjs';
import type { Msg } from '.';
import { logMqttTo } from './mqtt';
import { Channel, relayHost, relayJoin } from './relay';
import { directLink, rtcAllowed, type Direct, type Signal } from './rtc';

/*
 * Links between the host and each player, the same way Dark Realm does it. The host registers a
 * PeerJS id made from the room code on the public PeerJS broker and players connect to it over
 * WebRTC. When WebRTC can't get through, the same messages go through public MQTT brokers instead
 * (src/net/relay.ts): the host listens there too, and a player takes the relay when the direct link
 * fails or is slow to open. A link that runs over the relay then tries to go direct, trading the
 * WebRTC offer and answer over the relay itself (src/net/rtc.ts), so two devices on one network
 * talk directly even without PeerJS.
 *
 * Both sides ping each other, so a link that silently died (a reloaded or crashed page, a phone that
 * dropped off the network) is noticed within seconds.
 */

/** What goes over a link: the game's messages and the link's own. */
type Wire = Msg | { t: 'ping' } | { t: 'pong' } | { t: 'rtc'; sdp?: RTCSessionDescriptionInit; go?: 1 };

const PREFIX = 'discodungeon-';
/** How often each side pings, and how long a silent link lives before it counts as lost. */
const PING_MS = 2500;
const SILENT_MS = 10000;

/** How long a player waits for the direct link before taking the relay, and for either at all. */
const DIRECT_MS = 5000;
const JOIN_MS = 20000;
/** A link that goes silent sooner than this after opening counts against its way through. */
const SHORT_MS = 60000;

/** A link is busy while this many relay packets wait for their acknowledgement, or this many bytes for a data channel. */
const IN_FLIGHT = 2;
const BACKLOG = 256 * 1024;

/** Connection events for the console: which way the link goes and why it dropped. */
export function note(text: string) {
  console.info(`[net] ${text}`);
}
logMqttTo(note);

/**
 * The player's way through that went silent soon after it opened: the next join takes the
 * other one first. Some networks let a connection start and then stall it.
 */
let shaky: 'direct' | 'relay' | null = null;

/**
 * Where WebRTC looks for a way through NATs: several STUN servers, so one being down or
 * blocked doesn't matter, and PeerJS's own TURN relay (its default).
 */
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/**
 * `?peer=host:port` points at a self-hosted PeerJS server instead of the public broker;
 * `?peer=off` leaves WebRTC out, so only the relay is used (for tests).
 */
function peerOptions(): PeerOptions | null {
  const custom = new URLSearchParams(location.search).get('peer');
  const config = { iceServers: ICE };
  if (!custom) return { config };
  if (custom === 'off') return null;
  const [host, port] = custom.split(':');
  const local = host === 'localhost' || host === '127.0.0.1';
  return { host, port: Number(port) || (local ? 9000 : 443), secure: !local, path: '/', config };
}

export interface Link {
  send(msg: Msg): void;
  /** Whether the way through is still carrying what was sent before; a fresh game state can wait. */
  busy(): boolean;
  /** Closes the link on purpose: its `onClose` does not fire. */
  close(): void;
}

export interface LinkHandlers {
  onMessage(msg: Msg): void;
  /** The link was lost: the other side closed it, or it went silent. */
  onClose(): void;
}

/** Opens a link over an incoming connection. */
export type Accept = (h: LinkHandlers) => Link;

/** A connection under a link: a PeerJS DataConnection or a relay channel. */
interface Pipe {
  readonly open: boolean;
  send(msg: unknown): void;
  close(): void;
  on(event: 'data', cb: (d: unknown) => void): void;
  on(event: 'close' | 'error', cb: () => void): void;
}

/**
 * Opens a link over `conn`; `label` names it in the connection log. `onSilent` hears of a
 * link that went silent, with how long it had been open. A link over the relay tries to go
 * direct: the player's end (`upgrade: 'offer'`) starts it, the host's end answers.
 */
function wrap(
  conn: Pipe,
  h: LinkHandlers,
  label: string,
  onSilent?: (age: number) => void,
  upgrade: 'offer' | 'answer' | null = null,
): Link {
  let closed = false;
  const opened = Date.now();
  let heard = opened;
  /** The direct link being set up or in use; whether this side sends over it, and whether the other side does. */
  let direct: Direct | null = null;
  let sendDirect = false;
  let theyDirect = false;
  /** What came over the direct link before the relay said the other side moved over: it waits for the rest from the relay. */
  let held: Wire[] = [];
  let release: ReturnType<typeof setTimeout> | undefined;
  const send = (msg: Wire) => {
    if (closed) return;
    if (sendDirect && direct) direct.send(msg);
    else if (conn.open) conn.send(msg);
  };
  const stop = () => {
    closed = true;
    clearInterval(beat);
    clearTimeout(release);
    direct?.close();
    try {
      conn.close();
    } catch {
      /* already gone */
    }
  };
  const lost = (why: string) => {
    if (closed) return;
    const now = Date.now();
    note(`связь (${label}) потеряна: ${why}, жила ${Math.round((now - opened) / 1000)} с`);
    if (why === 'тишина') onSilent?.(now - opened);
    stop();
    h.onClose();
  };
  const beat = setInterval(() => {
    if (Date.now() - heard > SILENT_MS) lost('тишина');
    else send({ t: 'ping' });
  }, PING_MS);
  const take = (msg: Wire) => {
    if (closed) return;
    heard = Date.now();
    // Each side hears the other at least as often as it pings itself, even when the other
    // page is in the background and its browser runs its timers once a minute.
    if (msg.t === 'ping') send({ t: 'pong' });
    else if (msg.t !== 'pong' && msg.t !== 'rtc') h.onMessage(msg);
  };
  const moved = () => {
    theyDirect = true;
    clearTimeout(release);
    const waiting = held;
    held = [];
    for (const m of waiting) take(m);
  };
  const goDirect = () => {
    direct = directLink(ICE, upgrade === 'offer', (s: Signal) => conn.open && conn.send({ t: 'rtc', ...s }), {
      onOpen: () => {
        if (closed) return;
        // The last word over the relay: what follows comes the direct way.
        conn.send({ t: 'rtc', go: 1 });
        sendDirect = true;
        note(`связь (${label}) переведена напрямую`);
        label = 'напрямую';
      },
      onData: (d) => {
        if (closed) return;
        if (theyDirect) return take(d as Wire);
        held.push(d as Wire);
        // A relay that died before the word got through: the direct link carries on.
        release ??= setTimeout(moved, 5000);
      },
      onClose: () => {
        direct = null;
        if (sendDirect || theyDirect) lost('прямая связь закрыта');
      },
    });
  };
  conn.on('data', (d) => {
    if (closed) return;
    const msg = d as Wire;
    if (msg.t !== 'rtc') return take(msg);
    heard = Date.now();
    if (msg.go) return moved();
    if (!msg.sdp) return;
    if (!direct && upgrade === 'answer' && rtcAllowed()) goDirect();
    direct?.take({ sdp: msg.sdp });
  });
  conn.on('close', () => lost('закрыта'));
  conn.on('error', () => lost('ошибка'));
  if (upgrade === 'offer' && rtcAllowed()) goDirect();
  return {
    send,
    busy: () => {
      if (sendDirect && direct) return direct.buffered() > BACKLOG;
      if (conn instanceof Channel) return conn.inFlight > IN_FLIGHT;
      return ((conn as { dataChannel?: RTCDataChannel }).dataChannel?.bufferedAmount ?? 0) > BACKLOG;
    },
    close: () => {
      if (!closed) stop();
    },
  };
}

function peerError(err: unknown): string {
  const type = (err as { type?: string }).type;
  if (type === 'unavailable-id') return 'Комната с таким кодом уже существует.';
  if (type === 'peer-unavailable') return 'Комната не найдена. Проверь код, и чтобы хозяин комнаты был в лобби.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Нет связи с сервером комнат. Проверь интернет.';
  if (type === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
  return 'Ошибка соединения: ' + (type ?? String(err));
}

/** An error opening a room or joining one, with PeerJS's error type kept for retries. */
export class RoomError extends Error {
  constructor(readonly type: string, message: string) {
    super(message);
  }
}

function roomError(err: unknown): RoomError {
  return new RoomError((err as { type?: string }).type ?? '', peerError(err));
}

export interface HostedRoom {
  /** Takes the room down: the code is free again and every connection closes. */
  close(): void;
}

export type OpenRoom = (code: string, onConnection: (accept: Accept) => void) => Promise<HostedRoom>;

/** Calls `fn` whenever the page comes back to the front, until the returned function is called. */
function onFront(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const h = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', h);
  window.addEventListener('online', h);
  return () => {
    document.removeEventListener('visibilitychange', h);
    window.removeEventListener('online', h);
  };
}

/**
 * Opens a room and resolves once players can find it, on the PeerJS broker or on a relay
 * broker. Every connection that opens goes to `onConnection`. A broker that drops the room gets
 * it registered again, at once when the page comes back to the front (a phone switching to a
 * messenger to send the code puts the page to sleep).
 */
export const hostRoom: OpenRoom = (code, onConnection) =>
  new Promise((resolve, reject) => {
    const options = peerOptions();
    const started = Date.now();
    let opened = false;
    let closed = false;
    let peer: Peer | null = null;
    let peerFailed: RoomError | null = options ? null : new RoomError('off', 'WebRTC отключён.');
    let retry: ReturnType<typeof setTimeout> | undefined;
    const room: HostedRoom = {
      close: () => {
        closed = true;
        clearTimeout(retry);
        clearTimeout(giveUp);
        stopFront();
        peer?.destroy();
        relay.close();
      },
    };
    const ready = (via: string) => {
      if (opened || closed) return;
      note(`комната ${code} открыта (${via})`);
      opened = true;
      clearTimeout(giveUp);
      resolve(room);
    };
    const fail = (err: RoomError) => {
      if (opened || closed) return;
      room.close();
      reject(err);
    };
    // Without the PeerJS broker the room still opens if a relay broker answers in time.
    const check = () => {
      if (peerFailed && !relay.listening && Date.now() - started >= 10000) fail(peerFailed);
    };
    const giveUp = setTimeout(check, 10000);

    const startPeer = () => {
      if (!options || closed) return;
      const p = new Peer(PREFIX + code, options);
      peer = p;
      p.on('open', () => ready('PeerJS'));
      p.on('error', (err) => {
        if (p !== peer || closed || opened) return;
        const e = roomError(err);
        // The code is someone else's room: players coming straight would end up there.
        if (e.type === 'unavailable-id') return fail(e);
        peerFailed = e;
        check();
      });
      // Connections already open live on without the broker, but a player coming back needs it.
      // A peer that lost the broker connects again; one that never got on is made anew.
      const later = () => {
        clearTimeout(retry);
        retry = setTimeout(() => {
          if (closed || p !== peer) return;
          if (p.destroyed) startPeer();
          else if (p.disconnected) p.reconnect();
        }, 3000);
      };
      p.on('disconnected', later);
      p.on('close', later);
      p.on('connection', (conn) => {
        conn.on('open', () => {
          note('игрок подключился напрямую');
          onConnection((h) => wrap(conn, h, 'напрямую'));
        });
      });
    };

    const relay = relayHost(
      code,
      (ch) => {
        note(`игрок подключился через ретранслятор ${ch.via}`);
        onConnection((h) => wrap(ch, h, `ретранслятор ${ch.via}`, undefined, 'answer'));
      },
      () => ready('ретранслятор'),
    );
    const stopFront = onFront(() => {
      relay.wake();
      if (!peer || peer.destroyed) {
        clearTimeout(retry);
        startPeer();
      } else if (peer.disconnected) {
        clearTimeout(retry);
        peer.reconnect();
      }
    });
    startPeer();
  });

export type JoinRoom = (code: string, h: LinkHandlers) => Promise<Link>;

interface Attempt {
  ready: Promise<Pipe>;
  cancel(): void;
}

/** A direct WebRTC connection to the host through the PeerJS broker. */
function joinDirect(code: string): Attempt {
  const options = peerOptions();
  if (!options) return { ready: Promise.reject(new RoomError('off', 'WebRTC отключён.')), cancel() {} };
  const peer = new Peer(options);
  let done = false;
  let fail!: (e: RoomError) => void;
  const ready = new Promise<Pipe>((resolve, reject) => {
    fail = (e) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(e);
    };
    peer.on('error', (err) => fail(roomError(err)));
    peer.on('open', () => {
      // PeerJS's binary serialization splits big messages into chunks; its JSON one drops
      // anything over 16 KB. The host's end of the connection takes the serialization picked here.
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'binary' });
      // ICE found no way through: there is no point waiting any longer.
      conn.on('error', () => fail(new RoomError('negotiation', 'Не удалось подключиться к комнате.')));
      conn.on('open', () => {
        if (done) return;
        done = true;
        const pipe: Pipe = conn;
        // The peer goes when its connection does.
        conn.on('close', () => peer.destroy());
        resolve(pipe);
      });
    });
  });
  return { ready, cancel: () => fail(new RoomError('cancelled', '')) };
}

/**
 * Joins a room. The direct WebRTC link and the relay are tried at once: the direct one is
 * taken if it opens within a few seconds, the relay otherwise. A room neither finds fails
 * with the direct attempt's reason, which tells "no such room" from "no network".
 */
export const joinRoom: JoinRoom = (code, h) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const direct = joinDirect(code);
    const relay = relayJoin(code);
    let directErr: RoomError | null = null;
    let relayFailed = false;
    let parked: Pipe | null = null;
    let done = false;
    const take = (pipe: Pipe, via: string) => {
      if (done) return pipe.close();
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (via === 'direct') relay.cancel();
      else direct.cancel();
      if (parked && parked !== pipe) parked.close();
      const label = via === 'direct' ? 'напрямую' : `ретранслятор ${(pipe as Channel).via}`;
      // Why PeerJS didn't get there first, for the log.
      const why = via === 'direct' ? '' : ` (PeerJS: ${directErr ? directErr.type || 'ошибка' : 'не успел'})`;
      note(`${code}: ${label}${why}`);
      const way = via === 'direct' ? 'direct' : 'relay';
      resolve(
        wrap(
          pipe,
          h,
          label,
          (age) => {
            shaky = age < SHORT_MS ? way : null;
          },
          via === 'direct' ? null : 'offer',
        ),
      );
    };
    const fail = (err: RoomError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      direct.cancel();
      relay.cancel();
      parked?.close();
      reject(err);
    };
    // The direct link gets a few seconds' head start, none if it stalled last time, and
    // twice as long if the relay did.
    const head = shaky === 'direct' ? 0 : shaky === 'relay' ? 2 * DIRECT_MS : DIRECT_MS;
    const settle = () => {
      if (done) return;
      if (parked && (directErr || Date.now() - started >= head)) return take(parked, 'relay');
      if (directErr && relayFailed) fail(directErr.type === 'off' ? new RoomError('network', 'Нет связи с сервером комнат. Проверь интернет.') : directErr);
    };
    const timer = setTimeout(
      () => fail(directErr?.type === 'peer-unavailable' ? directErr : new RoomError('timeout', 'Не удалось подключиться к комнате. Проверь код, и чтобы хозяин комнаты был в лобби.')),
      JOIN_MS,
    );
    const grace = setTimeout(settle, head);
    direct.ready.then(
      (pipe) => take(pipe, 'direct'),
      (err: RoomError) => {
        directErr = err;
        settle();
      },
    );
    relay.ready.then(
      (ch) => {
        if (done) return ch.close();
        parked = ch;
        settle();
      },
      () => {
        relayFailed = true;
        settle();
      },
    );
  });
