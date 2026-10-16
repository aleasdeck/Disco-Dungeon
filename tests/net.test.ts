import { afterEach, describe, expect, it, vi } from 'vitest';
import { Net, type Msg } from '../src/net';
import { RoomError, type Accept, type JoinRoom, type LinkHandlers, type OpenRoom } from '../src/net/link';
import { PacketReader, connectPacket, publishPacket, readPublish, subscribePacket } from '../src/net/mqtt';
import { Channel, PART, STALL_MS, type Packet } from '../src/net/relay';
import type { Snapshot } from '../src/sync';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Two channel ends over a broker that may lose, repeat or reorder packets. */
function pair(mess: (p: Packet, deliver: () => void) => void = (_p, d) => d()) {
  const got: { a: unknown[]; b: unknown[] } = { a: [], b: [] };
  let a: Channel, b: Channel;
  a = new Channel('c1', (p) => mess(p, () => b.receive(structuredClone(p))));
  b = new Channel('c1', (p) => mess(p, () => a.receive(structuredClone(p))));
  a.on('data', (d) => got.a.push(d));
  b.on('data', (d) => got.b.push(d));
  return { a, b, got };
}

describe('relay channel', () => {
  it('passes messages both ways in order', () => {
    vi.useFakeTimers();
    const { a, b, got } = pair();
    a.send({ t: 'hello', name: 'Гость' });
    a.send({ t: 'ping' });
    b.send({ t: 'lobby', players: [] });
    expect(got.b).toEqual([{ t: 'hello', name: 'Гость' }, { t: 'ping' }]);
    expect(got.a).toEqual([{ t: 'lobby', players: [] }]);
  });

  it('splits a big message into parts and puts it back together', () => {
    vi.useFakeTimers();
    const sizes: number[] = [];
    const { a, got } = pair((p, d) => {
      if (p.t === 'd') sizes.push(p.p.length);
      d();
    });
    const big = { t: 'snap', text: 'ж'.repeat(PART * 3 + 17) };
    a.send(big);
    expect(sizes.length).toBe(4);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PART);
    expect(got.b).toEqual([big]);
  });

  it('sends lost packets again and drops repeats', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { a, b, got } = pair((_p, d) => {
      n++;
      // Every third packet is lost, every fifth arrives twice.
      if (n % 3 === 0) return;
      d();
      if (n % 5 === 0) d();
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({ t: 'act', seq: i, pad: 'x'.repeat(i % 4 === 0 ? PART + 5 : 10) }));
    for (const m of msgs) a.send(m);
    b.send({ t: 'bye' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(got.b).toEqual(msgs);
    expect(got.a).toEqual([{ t: 'bye' }]);
  });

  it('puts packets that arrive out of order back in order', () => {
    vi.useFakeTimers();
    const held: (() => void)[] = [];
    const { a, got } = pair((p, d) => {
      if (p.t === 'd' && p.n % 2 === 0) held.push(d);
      else d();
    });
    for (let i = 0; i < 6; i++) a.send({ i });
    expect(got.b).toEqual([]);
    for (const d of held.reverse()) d();
    expect(got.b).toEqual([0, 1, 2, 3, 4, 5].map((i) => ({ i })));
  });

  it('runs over several brokers at once and acks each packet once', () => {
    vi.useFakeTimers();
    let acks = 0;
    // Every packet goes over three brokers, so each end gets three copies.
    const { a, got } = pair((p, d) => {
      if (p.t === 'a') acks++;
      d();
      d();
      d();
    });
    for (let i = 0; i < 5; i++) a.send({ i });
    expect(got.b).toEqual([0, 1, 2, 3, 4].map((i) => ({ i })));
    expect(acks).toBe(5);
  });

  it('tells when what it sent has gone unacknowledged too long, and how much is in flight', async () => {
    vi.useFakeTimers();
    let through = true;
    const { a } = pair((_p, d) => through && d());
    a.send({ i: 1 });
    expect(a.stalled(STALL_MS)).toBe(false);
    expect(a.inFlight).toBe(0);
    through = false;
    a.send({ i: 2 });
    expect(a.inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(STALL_MS - 100);
    expect(a.stalled(STALL_MS)).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.stalled(STALL_MS)).toBe(true);
    // A fresh connection gets the resent packet through.
    through = true;
    await vi.advanceTimersByTimeAsync(1600);
    expect(a.stalled(STALL_MS)).toBe(false);
    expect(a.inFlight).toBe(0);
  });

  it('tells the other side when it closes', () => {
    vi.useFakeTimers();
    const { a, b } = pair();
    let closed = 0;
    b.on('close', () => closed++);
    a.close();
    expect(a.open).toBe(false);
    expect(b.open).toBe(false);
    expect(closed).toBe(1);
  });
});

describe('mqtt packets', () => {
  it('reads packets split across and joined in WebSocket frames', () => {
    const msg = publishPacket('discodungeon/1/ABCDE/h', JSON.stringify({ t: 'knock', c: 'x', pad: 'ё'.repeat(300) }));
    const two = new Uint8Array([...msg, ...msg]);
    const r = new PacketReader();
    expect(r.push(two.subarray(0, 3))).toEqual([]);
    const got = [...r.push(two.subarray(3, msg.length + 5)), ...r.push(two.subarray(msg.length + 5))];
    expect(got).toHaveLength(2);
    for (const p of got) {
      expect(p.type).toBe(3);
      expect(readPublish(p).topic).toBe('discodungeon/1/ABCDE/h');
      expect(JSON.parse(readPublish(p).payload).pad).toBe('ё'.repeat(300));
    }
  });

  it('encodes connect and subscribe as MQTT 3.1.1', () => {
    const c = connectPacket('dd123');
    expect([...c.subarray(0, 2)]).toEqual([0x10, c.length - 2]);
    expect(new TextDecoder().decode(c.subarray(4, 8))).toBe('MQTT');
    expect(c[8]).toBe(4);
    const s = subscribePacket(7, 'a/b');
    expect([...s]).toEqual([0x82, 8, 0, 7, 0, 3, 97, 47, 98, 0]);
  });
});

/** One player's link to the host, as both ends see it. */
interface Wire {
  /** What the host sent down it. */
  sent: Msg[];
  closed: boolean;
  busy: boolean;
  /** The link breaks under both ends. */
  drop(): void;
  /** The player's end says something. */
  say(m: Msg): void;
}

/** Rooms in memory: links open at once and carry messages straight across. */
function switchboard() {
  const rooms = new Map<string, (a: Accept) => void>();
  const taken = new Set<string>();
  const wires: Wire[] = [];
  const open: OpenRoom = async (code, onConnection) => {
    if (taken.has(code)) throw new RoomError('unavailable-id', 'Комната с таким кодом уже существует.');
    rooms.set(code, onConnection);
    return { close: () => void rooms.delete(code) };
  };
  const join: JoinRoom = async (code, guest) => {
    const onConnection = rooms.get(code);
    if (!onConnection) throw new RoomError('peer-unavailable', 'Комната не найдена.');
    let host!: LinkHandlers;
    const w: Wire = {
      sent: [], closed: false, busy: false,
      drop: () => { if (w.closed) return; w.closed = true; host.onClose(); guest.onClose(); },
      say: m => { if (!w.closed) host.onMessage(structuredClone(m)); },
    };
    onConnection(h => {
      host = h;
      return {
        send: m => { if (w.closed) return; w.sent.push(m); guest.onMessage(structuredClone(m)); },
        busy: () => w.busy,
        close: () => { if (w.closed) return; w.closed = true; guest.onClose(); },
      };
    });
    wires.push(w);
    return { send: w.say, busy: () => false, close: () => { if (w.closed) return; w.closed = true; host.onClose(); } };
  };
  return { open, join, taken, wires };
}

/** A host and a log of what it hears. */
function hosting(sb: ReturnType<typeof switchboard>) {
  const net = new Net(sb.open, sb.join);
  const log: string[] = [];
  net.onJoin = id => log.push(`join ${id}`);
  net.onLeave = id => log.push(`leave ${id}`);
  net.onMsg = (from, m) => log.push(`${from} ${m.t}`);
  return { net, log };
}

function player(sb: ReturnType<typeof switchboard>) {
  const net = new Net(sb.open, sb.join);
  const got: Msg[] = [];
  let lost = 0;
  net.onMsg = (_from, m) => got.push(m);
  net.onLost = () => lost++;
  return { net, got, lost: () => lost };
}

const snap = (turn: number): Msg => ({ t: 'snap', s: { turn } as Snapshot });

describe('online rooms', () => {
  it('lets players in and carries messages both ways', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host, log } = hosting(sb);
    const code = await host.hostRoom();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    const a = player(sb), b = player(sb);
    await a.net.joinRoom(code.toLowerCase());
    await b.net.joinRoom(code);
    a.net.send({ t: 'hello', name: 'Аня', key: 'k1' });
    expect(log).toEqual([`join ${a.net.id}`, `join ${b.net.id}`, `${a.net.id} hello`]);
    expect(host.has(a.net.id) && host.has(b.net.id)).toBe(true);
    host.broadcast({ t: 'lobbyBack' });
    host.sendTo(b.net.id, { t: 'deny', text: 'Комната заполнена.' });
    expect(a.got).toEqual([{ t: 'lobbyBack' }]);
    expect(b.got).toEqual([{ t: 'lobbyBack' }, { t: 'deny', text: 'Комната заполнена.' }]);
  });

  it('keeps a player in place when its browser comes back on a new link', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host, log } = hosting(sb);
    const code = await host.hostRoom();
    const a = player(sb);
    await a.net.joinRoom(code);
    // the old link died without a word to either end, and the player made a new one before the host noticed
    sb.wires[0].closed = true;
    await a.net.joinRoom(code);
    a.net.send({ t: 'pick', hero: 1 });
    expect(log).toEqual([`join ${a.net.id}`, `${a.net.id} pick`]);
    expect(host.has(a.net.id)).toBe(true);
  });

  it('tells the host when a player drops and the player when the host does', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host, log } = hosting(sb);
    const code = await host.hostRoom();
    const a = player(sb);
    await a.net.joinRoom(code);
    sb.wires[0].drop();
    expect(log).toEqual([`join ${a.net.id}`, `leave ${a.net.id}`]);
    expect(host.has(a.net.id)).toBe(false);
    expect(a.lost()).toBe(1);
    // the player still knows its room, to come back to it
    expect(a.net.code).toBe(code);
  });

  it('lets a kicked player go and closes its link', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host, log } = hosting(sb);
    const code = await host.hostRoom();
    const a = player(sb);
    await a.net.joinRoom(code);
    host.kick(a.net.id);
    expect(sb.wires[0].closed).toBe(true);
    expect(log).toEqual([`join ${a.net.id}`, `leave ${a.net.id}`]);
    expect(a.lost()).toBe(1);
  });

  it('closes a link that never says which browser it is', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host, log } = hosting(sb);
    const code = await host.hostRoom();
    // a bare link straight into the host's room, without a `me`
    let closed = false;
    const link = await sb.join(code, { onMessage() {}, onClose: () => { closed = true; } });
    link.send({ t: 'hello', name: 'Кто-то', key: '' });
    await vi.advanceTimersByTimeAsync(11000);
    expect(closed).toBe(true);
    expect(log).toEqual([]);
  });

  it('holds snapshots back while a link is busy and sends only the newest', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host } = hosting(sb);
    const code = await host.hostRoom();
    const a = player(sb), b = player(sb);
    await a.net.joinRoom(code);
    await b.net.joinRoom(code);
    const [wa, wb] = sb.wires;
    wa.busy = true;
    for (let k = 1; k <= 5; k++) host.broadcast(snap(k));
    expect(b.got.map(m => m.t === 'snap' && m.s.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(a.got).toEqual([]);
    wa.busy = false;
    await vi.advanceTimersByTimeAsync(60);
    expect(a.got).toEqual([snap(5)]);
    // anything else goes after the snapshot held before it
    wa.busy = true;
    host.broadcast(snap(6));
    host.sendTo(a.net.id, { t: 'screen', title: 'Победа', text: '' });
    expect(a.got).toEqual([snap(5), snap(6), { t: 'screen', title: 'Победа', text: '' }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.got).toHaveLength(3);
    expect(wb.sent).toHaveLength(6);
  });

  it('takes another code when a fresh room finds its code taken', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    const { net: host } = hosting(sb);
    const real = Math.random;
    let calls = 0;
    // the first code drawn is AAAAA, which someone already has
    vi.spyOn(Math, 'random').mockImplementation(() => (calls++ < 5 ? 0 : real()));
    sb.taken.add('AAAAA');
    const code = await host.hostRoom();
    expect(calls).toBeGreaterThan(5);
    expect(code).not.toBe('AAAAA');
    expect(host.code).toBe(code);
  });

  it('reopens the same code after a crash once the broker lets it go', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    sb.taken.add('ABCDE');
    const { net: host } = hosting(sb);
    const opening = host.hostRoom('ABCDE');
    await vi.advanceTimersByTimeAsync(7000);
    sb.taken.delete('ABCDE');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(opening).resolves.toBe('ABCDE');
    expect(host.active).toBe(true);
  });

  it('gives up reopening when the code stays taken', async () => {
    vi.useFakeTimers();
    const sb = switchboard();
    sb.taken.add('ABCDE');
    const { net: host } = hosting(sb);
    const opening = host.hostRoom('ABCDE');
    const failed = expect(opening).rejects.toThrow('уже существует');
    await vi.advanceTimersByTimeAsync(65000);
    await failed;
    expect(host.active).toBe(false);
  });

  it('fails to join a room that is not there and is left inactive', async () => {
    const sb = switchboard();
    const a = player(sb);
    await expect(a.net.joinRoom('QQQQQ')).rejects.toThrow('не найдена');
    expect(a.net.active).toBe(false);
  });
});
