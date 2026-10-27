import { afterEach, describe, expect, it, vi } from 'vitest';
import { Net, type Msg } from '../src/net';
import { codeOf, lobbyOf, steamNet, type SteamBridge } from '../src/net/steam';

afterEach(() => {
  vi.useRealTimers();
});

/** Pretend Steam for a few players: lobbies with data and members, and packets passed on a tick later, as over IPC. */
function steamWorld() {
  const players = new Map<string, { packet: ((from: string, data: string) => void)[]; invite: ((lobby: string) => void)[] }>();
  const lobbies = new Map<string, { data: Record<string, string>; members: Set<string> }>();
  let next = 7000;
  const later = (f: () => void) => setTimeout(f, 1);
  const player = (id: string, name = id): SteamBridge & { lobbies(): string[] } => {
    const me = { packet: [] as ((from: string, data: string) => void)[], invite: [] as ((lobby: string) => void)[] };
    players.set(id, me);
    return {
      id, name, launch: null,
      host: async (_max, data) => {
        const lobby = String((0x01840000n << 32n) | BigInt(next++));
        lobbies.set(lobby, { data: { ...data }, members: new Set([id]) });
        return lobby;
      },
      enter: async lobby => {
        const l = lobbies.get(lobby);
        if (!l) throw new Error('Failed to join lobby');
        l.members.add(id);
        return { ...l.data };
      },
      leave: lobby => {
        const l = lobbies.get(lobby);
        l?.members.delete(id);
        if (l && !l.members.size) lobbies.delete(lobby);
      },
      invite: lobby => { for (const [other, p] of players) if (other !== id) later(() => p.invite.forEach(f => f(lobby))); },
      send: (to, data) => later(() => players.get(to)?.packet.forEach(f => f(id, data))),
      onPacket: cb => { me.packet.push(cb); },
      onFail: () => {},
      onInvite: cb => { me.invite.push(cb); },
      lobbies: () => [...lobbies].filter(([, l]) => l.members.has(id)).map(([k]) => k),
    };
  };
  /** A player's page closing: its packets stop being heard, and a page opened anew listens afresh. */
  const gone = (id: string) => players.delete(id);
  return { player, gone, lobbies };
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** A Net over one player's Steam, and what reached it. */
function netOf(steam: SteamBridge) {
  const way = steamNet(steam), net = new Net(way.open, way.join), got: [string, Msg][] = [], joined: string[] = [];
  net.onMsg = (from, m) => got.push([from, m]);
  net.onJoin = id => joined.push(id);
  return { way, net, got, joined, lost: vi.fn(() => {}), left: vi.fn(() => {}) };
}

describe('Steam room codes', () => {
  it('writes a lobby in seven letters and reads it back', () => {
    for (const low of [0n, 1n, 123456789n, 0xffffffffn]) {
      const lobby = String((0x01840000n << 32n) | low), code = codeOf(lobby);
      expect(code).toMatch(/^[A-Z2-9]{7}$/);
      expect(lobbyOf(code)).toBe(lobby);
      expect(lobbyOf(code.toLowerCase())).toBe(lobby);
    }
  });

  it('takes a Steam id of another shape in thirteen', () => {
    const id = '76561197960287930', code = codeOf(id);
    expect(code).toHaveLength(13);
    expect(lobbyOf(code)).toBe(id);
  });

  it('is no lobby for the browser\'s codes or anything mistyped', () => {
    for (const code of ['ABCDE', 'ABCDEF', 'ABCDEF0', 'ABCDEFI', '', '99999999']) expect(lobbyOf(code)).toBeNull();
  });
});

describe('online play over Steam', () => {
  it('opens a room in a lobby of its own and lets a player in by its code', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    const host = netOf(a), client = netOf(b);
    const code = await host.net.hostRoom();
    expect(code).toHaveLength(7);
    expect(host.net.code).toBe(code);
    expect(w.lobbies.get(lobbyOf(code)!)?.data).toEqual({ game: 'disco-underground', host: '100' });

    const joining = client.net.joinRoom(code);
    await wait(50);
    await joining;
    await wait(50);
    expect(host.joined).toHaveLength(1);
    expect(b.lobbies()).toEqual([lobbyOf(code)]);

    client.net.send({ t: 'hello', name: 'Гость', key: 'k' });
    host.net.broadcast({ t: 'lobby', players: [] });
    await wait(50);
    expect(host.got).toEqual([[host.joined[0], { t: 'hello', name: 'Гость', key: 'k' }]]);
    expect(client.got).toEqual([['host', { t: 'lobby', players: [] }]]);
    // the pings keep the link alive past the silence limit
    await wait(30000);
    expect(host.net.has(host.joined[0])).toBe(true);
    client.net.close();
    host.net.close();
  });

  it('turns away a code no room of the game has', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    // another game testing on AppID 480
    const other = await a.host(4, { game: 'spacewar' });
    const client = netOf(b);
    await expect(client.net.joinRoom(codeOf(other))).rejects.toMatchObject({ type: 'peer-unavailable' });
    expect(b.lobbies()).toEqual([]);
    await expect(client.net.joinRoom('ZZZZZZZ')).rejects.toMatchObject({ type: 'peer-unavailable' });
  });

  it('tells a player at once when the host has no room open any more', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    const host = netOf(a), client = netOf(b);
    const code = await host.net.hostRoom();
    // the host's page went to the menu without leaving the lobby for good
    host.net.close();
    w.lobbies.set(lobbyOf(code)!, { data: { game: 'disco-underground', host: '100' }, members: new Set(['100']) });
    const joining = client.net.joinRoom(code).catch(e => e);
    await wait(100);
    expect(await joining).toMatchObject({ type: 'peer-unavailable' });
  });

  it('gives up on a host that never answers', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    const code = codeOf(await a.host(3, { game: 'disco-underground', host: '100' }));
    w.gone('100');
    const client = netOf(b);
    const joining = client.net.joinRoom(code).catch(e => e);
    await wait(16000);
    expect(await joining).toMatchObject({ type: 'timeout' });
  });

  it('lets go of the lobby when the player leaves the room, and not when the link drops', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    const host = netOf(a), client = netOf(b);
    const code = await host.net.hostRoom();
    const joining = client.net.joinRoom(code);
    await wait(50);
    await joining;
    client.net.onLost = client.lost;
    // the host's page is gone: the link goes silent, the player stays in the lobby for the host to come back to
    w.gone('100');
    await wait(15000);
    expect(client.lost).toHaveBeenCalled();
    expect(b.lobbies()).toEqual([lobbyOf(code)]);
    client.way.leave();
    expect(b.lobbies()).toEqual([]);
  });

  it('opens the same room again after a crash, and its player finds it under the same code', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), b = w.player('200');
    const host = netOf(a), client = netOf(b);
    const code = await host.net.hostRoom();
    const joining = client.net.joinRoom(code);
    await wait(50);
    await joining;
    // the host's game crashed: Steam took it out of the lobby, the player is still in it
    w.gone('100');
    a.leave(lobbyOf(code)!);
    await wait(15000);
    const back = netOf(w.player('100'));
    expect(await back.net.hostRoom(code)).toBe(code);
    const again = client.net.joinRoom(code);
    await wait(50);
    await again;
    await wait(50);
    expect(back.joined).toHaveLength(1);
    client.net.send({ t: 'ready', on: true });
    await wait(50);
    expect(back.got.map(([, m]) => m)).toEqual([{ t: 'ready', on: true }]);
  });

  it('opens a new room when the old lobby is gone', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), host = netOf(w.player('100'));
    const code = await host.net.hostRoom();
    host.net.close();
    expect(w.lobbies.size).toBe(0);
    const again = await host.net.hostRoom(code);
    expect(again).not.toBe(code);
    expect(again).toHaveLength(7);
  });

  it('a host who starts another room leaves the first one\'s lobby', async () => {
    vi.useFakeTimers();
    const w = steamWorld(), a = w.player('100'), host = netOf(a);
    await host.net.hostRoom();
    const second = await host.net.hostRoom();
    expect(a.lobbies()).toEqual([lobbyOf(second)]);
  });

  it('fails plainly without Steam', async () => {
    const way = steamNet(null), net = new Net(way.open, way.join);
    await expect(net.joinRoom('ABCDEFG')).rejects.toMatchObject({ type: 'steam' });
    await expect(net.hostRoom()).rejects.toMatchObject({ type: 'steam' });
  });
});
