import { mqttConnect, mqttLog, type Mqtt } from './mqtt';

/*
 * The relay: when a direct WebRTC link between the players can't be made (a strict NAT on a
 * mobile network, a firewall, STUN/TURN traffic cut on the way), the game's messages go
 * through public MQTT brokers instead. These need no account and run over an ordinary TLS
 * WebSocket. The host listens on every broker at once; a guest knocks on all of them and
 * stays on the first that answers.
 *
 * A broker passes messages at most once, so a channel numbers what it sends, the other side
 * acknowledges it, and whatever goes unacknowledged is sent again. Big messages go in parts.
 *
 * A channel runs over every broker at once, so one that stalls changes nothing while another
 * still gets through. Some networks let a connection start and then quietly stop passing
 * anything through it (Russian ones do this to foreign servers); when nothing gets acknowledged
 * for a few seconds, every connection that has gone quiet is swapped for a fresh one.
 */

/** Public brokers that take anyone over WebSockets; `?relay=url,url` replaces them (for tests). */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const TOPIC = 'discodungeon/1/';

/** Characters of a message per packet. */
export const PART = 8000;
/** A packet unacknowledged for this long is sent again. */
const RESEND_MS = 1500;
/** The guest knocks again this often until a broker answers. */
const KNOCK_MS = 1500;
/** A channel with something unacknowledged for this long has stalled: its quiet connections are renewed. */
export const STALL_MS = 2000;
/** Waits before connecting again to a broker that dropped or refused us. */
const BACKOFF = [1000, 2000, 5000, 10000];

export function brokers(): string[] {
  const custom = new URLSearchParams(location.search).get('relay');
  return custom ? custom.split(',').filter(Boolean) : BROKERS;
}

/**
 * Packets on the wire. `c` is the guest's connection; `knock` asks the host for a channel and
 * `hi` answers it; `d` carries part `p` of a message, numbered `n`, with `e` on the last part;
 * `a` acknowledges every packet up to `n`; `x` closes the channel.
 */
export type Packet =
  | { t: 'knock'; c: string }
  | { t: 'hi'; c: string }
  | { t: 'd'; c: string; n: number; p: string; e?: 1 }
  | { t: 'a'; c: string; n: number }
  | { t: 'x'; c: string };

type Listener = (d?: unknown) => void;

/**
 * One end of a channel. It looks like a PeerJS DataConnection to the code above it: `send`,
 * `close`, `open` and the `data`, `close` and `error` events.
 */
export class Channel {
  open = true;
  private next = 0;
  private expected = 0;
  /** Sent and not yet acknowledged: when it was first sent and when last. */
  private unacked = new Map<number, { pkt: Packet; since: number; at: number }>();
  /** The last acknowledgement sent, so the copies of a packet coming over the other brokers don't each get one. */
  private acked = { n: -1, at: 0 };
  private early = new Map<number, Extract<Packet, { t: 'd' }>>();
  private parts: string[] = [];
  private resend: ReturnType<typeof setInterval>;
  private listeners: Record<string, Listener[]> = {};

  constructor(
    readonly id: string,
    private out: (p: Packet) => void,
    private onEnd: () => void = () => {},
    /** The brokers the channel runs through, for the connection log. */
    readonly via = '',
  ) {
    this.resend = setInterval(() => this.flush(), RESEND_MS / 2);
  }

  /** Sends again what has gone unacknowledged for too long. */
  private flush() {
    const now = Date.now();
    for (const u of this.unacked.values()) {
      if (now - u.at < RESEND_MS) continue;
      u.at = now;
      this.out(u.pkt);
    }
  }

  /** Packets sent and not yet acknowledged. */
  get inFlight(): number {
    return this.unacked.size;
  }

  /** Whether something sent has gone unacknowledged for `ms`. */
  stalled(ms: number): boolean {
    const now = Date.now();
    for (const u of this.unacked.values()) if (now - u.since >= ms) return true;
    return false;
  }

  on(event: 'data' | 'close' | 'error', cb: Listener) {
    (this.listeners[event] ??= []).push(cb);
  }

  private emit(event: string, d?: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(d);
  }

  send(msg: unknown) {
    if (!this.open) return;
    const s = JSON.stringify(msg);
    for (let i = 0; i < s.length || i === 0; i += PART) {
      const last = i + PART >= s.length;
      const pkt: Packet = { t: 'd', c: this.id, n: this.next++, p: s.slice(i, i + PART), ...(last ? { e: 1 as const } : {}) };
      const now = Date.now();
      this.unacked.set(pkt.n, { pkt, since: now, at: now });
      this.out(pkt);
    }
  }

  /** A packet for this channel from the other side. */
  receive(p: Packet) {
    if (!this.open) return;
    if (p.t === 'x') return this.end(false);
    if (p.t === 'a') {
      for (const n of this.unacked.keys()) if (n <= p.n) this.unacked.delete(n);
      return;
    }
    if (p.t !== 'd') return;
    // A page in the background runs its timers once a minute, so packets that arrive drive the
    // resending too.
    this.flush();
    const repeat = p.n < this.expected;
    if (!repeat) this.early.set(p.n, p);
    for (let d = this.early.get(this.expected); d; d = this.early.get(this.expected)) {
      this.early.delete(this.expected++);
      this.parts.push(d.p);
      if (!d.e) continue;
      const s = this.parts.join('');
      this.parts = [];
      let msg: unknown;
      try {
        msg = JSON.parse(s);
      } catch {
        continue;
      }
      this.emit('data', msg);
      if (!this.open) return;
    }
    // Acknowledged at once, for a repeat too (its ack was lost): a timer could wait a minute in a
    // hidden tab. A repeat just after the ack is the same packet over another broker.
    const now = Date.now();
    if (!this.open || (repeat && this.acked.n >= p.n && now - this.acked.at < RESEND_MS / 3)) return;
    this.acked = { n: this.expected - 1, at: now };
    this.out({ t: 'a', c: this.id, n: this.expected - 1 });
  }

  close() {
    this.end(true);
  }

  private end(tell: boolean) {
    if (!this.open) return;
    if (tell) this.out({ t: 'x', c: this.id });
    this.open = false;
    clearInterval(this.resend);
    this.onEnd();
    this.emit('close');
  }
}

function parse(payload: string): Packet | null {
  try {
    const p = JSON.parse(payload) as Packet;
    return p && typeof p.c === 'string' && typeof p.t === 'string' ? p : null;
  } catch {
    return null;
  }
}

const hostTopic = (code: string) => `${TOPIC}${code}/h`;
const guestTopic = (code: string, c: string) => `${TOPIC}${code}/g/${c}`;

/** A broker's short name for the connection log: hivemq for broker.hivemq.com. */
function short(url: string): string {
  const u = new URL(url);
  return /^[\d.]+$/.test(u.hostname) ? u.host : (u.hostname.split('.').slice(-2)[0] ?? u.hostname);
}

/**
 * A connection to one broker, subscribed to `topic`, that comes back when it is lost and can
 * be swapped for a fresh one when it has gone quiet. `onFail` hears of each attempt the broker
 * never took.
 */
class Line {
  /** The connection in use, and a fresh one on its way. */
  private mq: Mqtt | null = null;
  private next: Mqtt | null = null;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private renewed = 0;
  /** When anything last came over this line. */
  heard = 0;
  readonly name: string;

  constructor(
    readonly url: string,
    private topic: string,
    private onMessage: (payload: string) => void,
    private onUp: () => void = () => {},
    private onFail: () => void = () => {},
  ) {
    this.name = short(url);
    this.dial();
  }

  get up(): boolean {
    return !!this.mq?.open;
  }

  publish(topic: string, payload: string) {
    this.mq?.publish(topic, payload);
  }

  private dial() {
    clearTimeout(this.timer);
    if (this.closed || this.next) return;
    let opened = false;
    const conn: Mqtt = mqttConnect(this.url, {
      onOpen: () => {
        opened = true;
        this.tries = 0;
        conn.subscribe(this.topic);
        // The fresh connection takes over, and the one it replaces goes.
        const old = this.mq;
        this.mq = conn;
        this.next = null;
        this.heard = Date.now();
        old?.close();
        this.onUp();
      },
      onMessage: (_topic, payload) => {
        this.heard = Date.now();
        this.onMessage(payload);
      },
      onClose: () => {
        if (conn === this.next) this.next = null;
        else if (conn === this.mq) this.mq = null;
        else return;
        if (!opened) this.onFail();
        if (this.closed || this.mq || this.next) return;
        this.timer = setTimeout(() => this.dial(), BACKOFF[Math.min(this.tries++, BACKOFF.length - 1)]);
      },
    });
    this.next = conn;
  }

  /** Connects afresh beside a connection that has gone quiet; the new one takes over once the broker takes it. */
  renew() {
    const now = Date.now();
    if (this.closed || this.next || now - this.renewed < STALL_MS) return;
    this.renewed = now;
    if (this.mq) mqttLog(`${this.name} is silent, reconnecting`);
    this.dial();
  }

  /** Connects at once if the line is down and waiting to try again. */
  wake() {
    if (!this.mq && !this.next) this.dial();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    const conns = [this.next, this.mq];
    this.next = this.mq = null;
    for (const c of conns) c?.close();
  }
}

/** Renews the lines that have heard nothing for a while, if one of the channels over them has stalled. */
function watch(channels: Iterable<Channel>, lines: Line[]) {
  let stalled = false;
  for (const ch of channels) stalled ||= ch.stalled(STALL_MS);
  if (!stalled) return;
  const now = Date.now();
  for (const l of lines) if (now - l.heard >= STALL_MS) l.renew();
}

const names = (lines: Line[]) => lines.filter((l) => l.up).map((l) => l.name).join(', ');

export interface RelayHost {
  /** Whether at least one broker is listening for guests. */
  readonly listening: boolean;
  /** Connects again at once to brokers that were lost, e.g. when the page comes back to the front. */
  wake(): void;
  close(): void;
}

/**
 * The host's end: listens for guests on every broker and keeps the brokers connected for as
 * long as the room is open. `onListening` fires each time a broker starts listening.
 */
export function relayHost(code: string, onChannel: (ch: Channel) => void, onListening: () => void, urls = brokers()): RelayHost {
  const channels = new Map<string, Channel>();
  /** Channels closed here, so late packets for them don't open them again. */
  const ended = new Set<string>();

  const packet = (line: Line, payload: string) => {
    const p = parse(payload);
    if (!p) return;
    if (p.t === 'knock') return line.publish(guestTopic(code, p.c), JSON.stringify({ t: 'hi', c: p.c }));
    let ch = channels.get(p.c);
    if (!ch) {
      // A channel starts with its first message. A later one may come over a quicker broker
      // before it; anything for a channel that ended here is left over.
      if (ended.has(p.c)) {
        if (p.t !== 'x') line.publish(guestTopic(code, p.c), JSON.stringify({ t: 'x', c: p.c }));
        return;
      }
      if (p.t !== 'd' || p.n !== 0) return;
      const id = p.c;
      ch = new Channel(
        id,
        (r) => {
          const s = JSON.stringify(r);
          for (const l of lines) l.publish(guestTopic(code, id), s);
        },
        () => {
          channels.delete(id);
          ended.add(id);
        },
        names(lines),
      );
      channels.set(id, ch);
      onChannel(ch);
    }
    ch.receive(p);
    watch(channels.values(), lines);
  };

  const lines: Line[] = urls.map((url) => {
    const line: Line = new Line(url, hostTopic(code), (payload) => packet(line, payload), onListening);
    return line;
  });
  const dog = setInterval(() => watch(channels.values(), lines), 1000);
  return {
    get listening() {
      return lines.some((l) => l.up);
    },
    wake() {
      for (const l of lines) l.wake();
    },
    close() {
      clearInterval(dog);
      for (const ch of [...channels.values()]) ch.close();
      for (const l of lines) l.close();
    },
  };
}

export interface RelayJoin {
  /** The channel, once a broker has answered; the attempt fails when every broker is gone. */
  ready: Promise<Channel>;
  /** Gives the attempt up (a channel already made stays). */
  cancel(): void;
}

/** The guest's end: knocks on every broker, and once the host answers on one, talks over all of them. */
export function relayJoin(code: string, urls = brokers()): RelayJoin {
  const c = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let ch: Channel | null = null;
  let done = false;
  const failed = new Set<Line>();
  let dog: ReturnType<typeof setInterval> | undefined;
  let resolve!: (ch: Channel) => void;
  let reject!: (e: Error) => void;
  const ready = new Promise<Channel>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const send = (p: Packet) => {
    const s = JSON.stringify(p);
    for (const l of lines) l.publish(hostTopic(code), s);
  };
  const knock = () => send({ t: 'knock', c });
  const knocking = setInterval(knock, KNOCK_MS);
  const finish = () => {
    done = true;
    clearInterval(knocking);
  };
  const shut = () => {
    clearInterval(dog);
    for (const l of lines) l.close();
  };
  const packet = (payload: string) => {
    const p = parse(payload);
    if (!p || p.c !== c) return;
    if (ch) {
      ch.receive(p);
      return watch([ch], lines);
    }
    if (p.t !== 'hi' || done) return;
    finish();
    ch = new Channel(c, send, () => setTimeout(shut, 200), names(lines));
    const made = ch;
    dog = setInterval(() => watch([made], lines), 1000);
    resolve(ch);
  };
  const lines: Line[] = urls.map((url) => {
    const line: Line = new Line(url, guestTopic(code, c), packet, () => !done && knock(), () => {
      failed.add(line);
      if (done || failed.size < lines.length || lines.some((l) => l.up)) return;
      finish();
      shut();
      reject(new Error('relay'));
    });
    return line;
  });
  return {
    ready,
    cancel() {
      if (done) return;
      finish();
      shut();
      reject(new Error('cancelled'));
    },
  };
}
