// A pretend Steam for trying the desktop build's online play without Steam: two windows on one computer (or tests) as
// two Steam players. It answers the few calls of steamworks.js that steam.cjs makes, the same way, and the windows meet
// on a small hub on a local port: the first window to start runs it inside itself, the others connect to it.
//
//   DD_FAKE_STEAM=27999 DD_PROFILE=b npm run desktop     a second window, with saves of its own
//
// Lobbies, their data and members, P2P packets and session requests behave as Steam's do. Steam's invite window has no
// pretend: opening it hands the invite to every other window at once, as if a friend there took it.

'use strict';
const net = require('node:net');

/** A lobby's Steam id: the upper half every lobby has, then a number of the hub's. */
const LOBBY = 0x01840000n << 32n;
/** The callbacks steam.cjs registers, numbered as steamworks.js numbers them. */
const SteamCallback = { LobbyDataUpdate: 4, LobbyChatUpdate: 5, P2PSessionRequest: 6, P2PSessionConnectFail: 7, GameLobbyJoinRequested: 8 };

/** Lines of JSON over a socket. */
function lines(sock, onMsg) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', chunk => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0; ) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) onMsg(JSON.parse(line));
    }
  });
  return m => sock.writable && sock.write(JSON.stringify(m) + '\n');
}

/** The hub: who is on, the lobbies, and the packets passed from one player to another. */
function hub(port, ready) {
  const players = new Map();
  const lobbies = new Map();
  let next = 1000 + Math.floor(Math.random() * 1e6);
  const state = l => ({ owner: l.owner, members: [...l.members], data: l.data });
  const tell = (id, l) => { for (const m of l.members) players.get(m)?.({ t: 'state', lobby: id, state: state(l) }); };
  const out = (who, id) => {
    const l = lobbies.get(id);
    if (!l || !l.members.delete(who)) return;
    if (!l.members.size) return lobbies.delete(id);
    if (l.owner === who) l.owner = [...l.members][0];
    tell(id, l);
  };
  const server = net.createServer(sock => {
    let me = '';
    const send = lines(sock, m => {
      if (m.t === 'hi') { me = m.id; players.set(me, send); }
      else if (m.t === 'create') {
        const id = String(LOBBY | BigInt(next++)), l = { owner: me, members: new Set([me]), data: {}, max: m.max };
        lobbies.set(id, l);
        send({ t: 're', q: m.q, lobby: id, state: state(l) });
      } else if (m.t === 'join') {
        const l = lobbies.get(m.lobby);
        if (!l || (l.members.size >= l.max && !l.members.has(me))) return send({ t: 're', q: m.q, error: 'Failed to join lobby' });
        l.members.add(me);
        send({ t: 're', q: m.q, lobby: m.lobby, state: state(l) });
        tell(m.lobby, l);
      } else if (m.t === 'leave') out(me, m.lobby);
      else if (m.t === 'set') {
        const l = lobbies.get(m.lobby);
        if (l?.owner !== me) return;
        Object.assign(l.data, m.data);
        tell(m.lobby, l);
      } else if (m.t === 'p2p') {
        const to = players.get(m.to);
        if (to) to({ t: 'p2p', from: me, data: m.data });
        else send({ t: 'fail', remote: m.to });
      } else if (m.t === 'invite') {
        for (const [id, p] of players) if (id !== me) p({ t: 'invited', lobby: m.lobby, from: me });
      }
    });
    sock.on('close', () => {
      if (players.get(me) === send) players.delete(me);
      for (const id of [...lobbies.keys()]) out(me, id);
    });
    sock.on('error', () => {});
  });
  server.on('error', () => ready(false));
  server.listen(port, '127.0.0.1', () => ready(true));
}

/** A player of the pretend Steam: steamworks.js's calls, over the hub on `port`. */
function client(port) {
  const id = String(76561190000000000n + BigInt(Math.floor(Math.random() * 1e9)));
  const name = process.env.DD_FAKE_STEAM_NAME || `Тестер ${id.slice(-3)}`;
  const handlers = new Map();
  const fire = (kind, value) => setTimeout(() => { for (const f of handlers.get(kind) ?? []) f(value); });
  const asked = new Map();
  let q = 0;
  /** What waits to go out until the hub answers, and the line to it. */
  let queue = [];
  let send = m => queue.push(m);
  const states = new Map();
  /** Packets let in, players whose packets are, and what came from others before they were. */
  const packets = [];
  const open = new Set();
  const held = new Map();

  const take = m => {
    if (m.t === 're') {
      const a = asked.get(m.q);
      asked.delete(m.q);
      if (m.error) return a.no(new Error(m.error));
      states.set(m.lobby, m.state);
      a.ok(lobby(m.lobby));
    } else if (m.t === 'state') {
      states.set(m.lobby, m.state);
      fire(SteamCallback.LobbyDataUpdate, { lobby: BigInt(m.lobby), member: BigInt(m.lobby), success: true });
    } else if (m.t === 'p2p') {
      const p = { from: m.from, data: Buffer.from(m.data, 'base64') };
      if (open.has(m.from)) return packets.push(p);
      if (!held.has(m.from)) {
        held.set(m.from, []);
        fire(SteamCallback.P2PSessionRequest, { remote: BigInt(m.from) });
      }
      held.get(m.from).push(p);
    } else if (m.t === 'fail') fire(SteamCallback.P2PSessionConnectFail, { remote: BigInt(m.remote), error: 1 });
    else if (m.t === 'invited') fire(SteamCallback.GameLobbyJoinRequested, { lobby_steam_id: BigInt(m.lobby), friend_steam_id: BigInt(m.from) });
  };
  const connect = (tries = 0) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.on('connect', () => {
      send = lines(sock, take);
      send({ t: 'hi', id });
      for (const m of queue) send(m);
      queue = [];
    });
    sock.on('error', () => {
      if (tries > 20) return;
      // nobody runs the hub yet: this window does (or another got there first, and it is connected to next time)
      hub(port, () => setTimeout(() => connect(tries + 1), 100));
    });
  };
  const ask = m => new Promise((ok, no) => { asked.set(++q, { ok, no }); send({ ...m, q }); });
  const lobby = lid => ({
    id: BigInt(lid),
    getData: k => states.get(lid)?.data[k] ?? null,
    getFullData: () => ({ ...states.get(lid)?.data }),
    mergeFullData: data => { send({ t: 'set', lobby: lid, data }); Object.assign(states.get(lid).data, data); return true; },
    getMembers: () => (states.get(lid)?.members ?? []).map(m => ({ steamId64: BigInt(m) })),
    getOwner: () => ({ steamId64: BigInt(states.get(lid)?.owner ?? 0) }),
    leave: () => { send({ t: 'leave', lobby: lid }); states.delete(lid); },
    openInviteDialog: () => send({ t: 'invite', lobby: lid }),
  });

  return {
    init() {
      connect();
      return {
        localplayer: { getSteamId: () => ({ steamId64: BigInt(id) }), getName: () => name },
        apps: { currentGameLanguage: () => process.env.DD_FAKE_STEAM_LANG || 'russian' },
        matchmaking: {
          createLobby: (_type, max) => ask({ t: 'create', max }),
          joinLobby: lid => ask({ t: 'join', lobby: String(lid) }),
        },
        networking: {
          sendP2PPacket(to, _type, data) {
            // talking first lets the other player's packets in, as with Steam
            open.add(String(to));
            send({ t: 'p2p', to: String(to), data: data.toString('base64') });
            return true;
          },
          isP2PPacketAvailable: () => packets[0]?.data.length ?? 0,
          readP2PPacket(size) {
            const p = packets.shift();
            if (!p) throw new Error('No packet available');
            const data = Buffer.alloc(Math.max(size, p.data.length));
            p.data.copy(data);
            return { data, size: p.data.length, steamId: { steamId64: BigInt(p.from) } };
          },
          acceptP2PSession(remote) {
            const r = String(remote);
            open.add(r);
            packets.push(...(held.get(r) ?? []));
            held.delete(r);
          },
        },
        callback: {
          register(kind, fn) {
            if (!handlers.has(kind)) handlers.set(kind, []);
            handlers.get(kind).push(fn);
            return { disconnect: () => handlers.set(kind, handlers.get(kind).filter(f => f !== fn)) };
          },
        },
      };
    },
    SteamCallback,
  };
}

module.exports = port => client(Number(port));
