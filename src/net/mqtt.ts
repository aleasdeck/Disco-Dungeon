/*
 * A tiny MQTT 3.1.1 client over a WebSocket: connect, subscribe and publish at QoS 0, which is
 * all the relay needs (src/net/relay.ts). Public brokers take anyone without an account, and
 * their WebSockets run over TLS like any web page, so they get through where WebRTC doesn't.
 */

export interface MqttHandlers {
  /** The broker took the connection; subscriptions can go out. */
  onOpen(): void;
  onMessage(topic: string, payload: string): void;
  /** The connection is gone, whether it opened or not. */
  onClose(): void;
}

export interface Mqtt {
  subscribe(topic: string): void;
  publish(topic: string, payload: string): void;
  close(): void;
  readonly open: boolean;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Seconds the broker waits for a word from us before it drops the connection. */
const KEEPALIVE = 60;
const PING_MS = 20000;
/** A broker that hasn't answered the connect by then is given up. */
const CONNECT_MS = 8000;

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type: number, body: number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  const head = [type, ...varint(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

export function connectPacket(clientId: string): Uint8Array<ArrayBuffer> {
  // Protocol name, level 4 (3.1.1), clean session, keep-alive; the payload is the client id.
  return packet(0x10, [...str('MQTT'), 4, 0x02, KEEPALIVE >> 8, KEEPALIVE & 255, ...str(clientId)]);
}

export function subscribePacket(id: number, topic: string): Uint8Array<ArrayBuffer> {
  return packet(0x82, [id >> 8, id & 255, ...str(topic), 0]);
}

export function publishPacket(topic: string, payload: string): Uint8Array<ArrayBuffer> {
  const t = str(topic);
  const p = enc.encode(payload);
  const body = new Uint8Array(t.length + p.length);
  body.set(t);
  body.set(p, t.length);
  return packet(0x30, body);
}

export interface Packet {
  type: number;
  flags: number;
  body: Uint8Array;
}

/** Splits a byte stream into whole packets; what's left over waits for the next bytes. */
export class PacketReader {
  private buf = new Uint8Array(0);

  push(bytes: Uint8Array): Packet[] {
    const all = new Uint8Array(this.buf.length + bytes.length);
    all.set(this.buf);
    all.set(bytes, this.buf.length);
    const out: Packet[] = [];
    let at = 0;
    for (;;) {
      if (all.length - at < 2) break;
      let len = 0;
      let mul = 1;
      let i = at + 1;
      let whole = false;
      while (i < all.length && i < at + 5) {
        const b = all[i++];
        len += (b & 127) * mul;
        mul *= 128;
        if (!(b & 128)) {
          whole = true;
          break;
        }
      }
      if (!whole || all.length < i + len) break;
      out.push({ type: all[at] >> 4, flags: all[at] & 15, body: all.slice(i, i + len) });
      at = i + len;
    }
    this.buf = all.slice(at);
    return out;
  }
}

/** The topic and payload of a PUBLISH packet. */
export function readPublish(p: Packet): { topic: string; payload: string; id?: number } {
  const n = (p.body[0] << 8) | p.body[1];
  const topic = dec.decode(p.body.subarray(2, 2 + n));
  let at = 2 + n;
  let id: number | undefined;
  if ((p.flags >> 1) & 3) {
    id = (p.body[at] << 8) | p.body[at + 1];
    at += 2;
  }
  return { topic, payload: dec.decode(p.body.subarray(at)), id };
}

/** Where a broker that dropped a working connection is reported (the console, via link.ts). */
let onLog: ((text: string) => void) | null = null;
export function logMqttTo(fn: (text: string) => void) {
  onLog = fn;
}
export function mqttLog(text: string) {
  onLog?.(text);
}

export function mqttConnect(url: string, h: MqttHandlers): Mqtt {
  let ws: WebSocket;
  let open = false;
  let closed = false;
  let nextId = 1;
  let heard = Date.now();
  const reader = new PacketReader();
  const clientId = 'dd' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6);

  const write = (b: Uint8Array<ArrayBuffer>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(b);
  };
  const shut = (why?: string) => {
    if (closed) return;
    if (open && why) mqttLog(`broker ${new URL(url).hostname} dropped: ${why}`);
    closed = true;
    open = false;
    clearInterval(beat);
    clearTimeout(timer);
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    h.onClose();
  };
  const timer = setTimeout(() => {
    if (!open) shut();
  }, CONNECT_MS);
  const beat = setInterval(() => {
    // The broker answers every ping; one that has said nothing for two rounds is gone.
    if (Date.now() - heard > PING_MS * 2 + 5000) return shut('not answering');
    if (open) write(new Uint8Array([0xc0, 0]));
  }, PING_MS);

  try {
    ws = new WebSocket(url, ['mqtt']);
  } catch {
    queueMicrotask(shut);
    return { subscribe() {}, publish() {}, close() {}, open: false };
  }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => write(connectPacket(clientId));
  ws.onmessage = (e) => {
    if (closed || !(e.data instanceof ArrayBuffer)) return;
    heard = Date.now();
    for (const p of reader.push(new Uint8Array(e.data))) {
      if (p.type === 2) {
        // CONNACK: a non-zero code is a refusal.
        if (p.body[1] !== 0) return shut();
        open = true;
        clearTimeout(timer);
        h.onOpen();
      } else if (p.type === 3) {
        const { topic, payload, id } = readPublish(p);
        if (id !== undefined) write(new Uint8Array([0x40, 2, id >> 8, id & 255]));
        h.onMessage(topic, payload);
      }
    }
  };
  ws.onclose = (e) => shut(`closed (${e.code}${e.reason ? ' ' + e.reason : ''})`);
  ws.onerror = () => shut('error');

  return {
    get open() {
      return open && !closed;
    },
    subscribe(topic) {
      const id = nextId++;
      if (nextId > 65535) nextId = 1;
      write(subscribePacket(id, topic));
    },
    publish(topic, payload) {
      write(publishPacket(topic, payload));
    },
    close() {
      if (closed) return;
      write(new Uint8Array([0xe0, 0]));
      shut();
    },
  };
}
