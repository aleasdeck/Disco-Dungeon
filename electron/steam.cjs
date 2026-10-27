// Steam for the game, in the main process: who plays, the lobby a room lives in, friends' invites, and the packets
// between the host and each player over Steam's P2P (straight, or through Valve's relays when no direct way gets
// through). preload.cjs hands it to the page, and src/net/steam.ts makes the game's links of it.
//
// steamworks.js is @pipelab/steamworks.js, the kept-up fork of ceifa's: the same calls, with steam_api64.dll of a newer
// Steamworks SDK inside. Its ISteamNetworkingMessages call sends unreliable whatever it is asked, so the game uses the
// older ISteamNetworking P2P: reliable and in order, up to 1 MB a packet.

'use strict';

/** steamworks.js's numbers for what its typings keep as const enums. */
const FRIENDS_ONLY = 1; // matchmaking.LobbyType: friends see the room in their list and join it from there
const RELIABLE = 2; // networking.SendType
/** How often packets are taken off Steam, in ms. */
const READ_MS = 4;
/** How long a player who isn't in any of this side's lobbies yet may wait for their packets to be let in. */
const ACCEPT_MS = 5000;

/** Steam's names of its languages (ISteamApps::GetCurrentGameLanguage), by the game's codes. */
const LANGS = {
  russian: 'ru', ukrainian: 'ru', english: 'en', schinese: 'zh', tchinese: 'zh', german: 'de', french: 'fr',
  spanish: 'es', latam: 'es', brazilian: 'pt', portuguese: 'pt', japanese: 'ja', koreana: 'ko', polish: 'pl',
};

/** The lobby Steam started the game for (`+connect_lobby <id>`): an invite taken while the game was closed. */
function launchLobby(argv) {
  const i = argv.indexOf('+connect_lobby'), id = i >= 0 ? argv[i + 1] : null;
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * Starts Steam for `appId`; `fake` is the port of the pretend Steam (fake-steam.cjs) to take instead. `page(channel,
 * ...args)` tells the page what came. Gives the calls the page may make, or `{ error }` when Steam can't be had.
 */
function startSteam({ appId, fake, page, overlay = true }) {
  let sw, client;
  try {
    sw = fake ? require('./fake-steam.cjs')(fake) : require('@pipelab/steamworks.js');
    client = sw.init(appId);
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
  // The overlay (Shift+Tab, the invite window) draws into the window only with the GPU in the main process. On Windows
  // that also takes Chromium's DirectComposition off, as ceifa's steamworks.js did and the fork no longer does: with it
  // on, the window showed a dark blur over a game that ran and took clicks, unseen.
  if (!fake && overlay) {
    sw.electronEnableSteamOverlay();
    require('electron').app.commandLine.appendSwitch('disable-direct-composition');
  }
  const me = String(client.localplayer.getSteamId().steamId64);
  /** The lobbies this side is in, by id. */
  const lobbies = new Map();
  let launch = launchLobby(process.argv);

  const p2p = client.networking;
  setInterval(() => {
    try {
      for (let n; (n = p2p.isP2PPacketAvailable()) > 0; ) {
        const p = p2p.readP2PPacket(n);
        page('steam:packet', String(p.steamId.steamId64), p.data.subarray(0, p.size).toString('utf8'));
      }
    } catch {
      // gone between the two calls
    }
  }, READ_MS);

  // Packets are let in only from players in a lobby with this side; one who just joined may knock before Steam says so.
  const inLobby = id => [...lobbies.values()].some(l => l.getMembers().some(m => String(m.steamId64) === id));
  const accept = (id, until) => {
    if (inLobby(id)) p2p.acceptP2PSession(BigInt(id));
    else if (Date.now() < until) setTimeout(() => accept(id, until), 250);
  };
  const on = (kind, fn) => client.callback.register(sw.SteamCallback[kind], fn);
  on('P2PSessionRequest', ({ remote }) => accept(String(remote), Date.now() + ACCEPT_MS));
  on('P2PSessionConnectFail', ({ remote }) => page('steam:fail', String(remote)));
  on('GameLobbyJoinRequested', ({ lobby_steam_id }) => page('steam:invited', String(lobby_steam_id)));

  return {
    /** What the page learns as it starts; a page loaded anew starts out of every lobby, as a fresh one would. */
    hello() {
      for (const l of lobbies.values()) l.leave();
      lobbies.clear();
      const lang = client.apps.currentGameLanguage();
      const info = { id: me, name: client.localplayer.getName(), lang: LANGS[lang] ?? null, launch };
      launch = null;
      return info;
    },
    async host(max, data) {
      const l = await client.matchmaking.createLobby(FRIENDS_ONLY, max);
      lobbies.set(String(l.id), l);
      l.mergeFullData(data);
      return String(l.id);
    },
    async enter(id) {
      let l = lobbies.get(id);
      if (!l) {
        l = await client.matchmaking.joinLobby(BigInt(id));
        lobbies.set(id, l);
      }
      return l.getFullData();
    },
    leave(id) {
      lobbies.get(id)?.leave();
      lobbies.delete(id);
    },
    invite(id) {
      lobbies.get(id)?.openInviteDialog();
    },
    send(to, data) {
      p2p.sendP2PPacket(BigInt(to), RELIABLE, Buffer.from(data, 'utf8'));
    },
  };
}

module.exports = { startSteam, launchLobby };
