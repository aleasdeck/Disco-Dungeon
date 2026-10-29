// Disco Underground as a desktop app for Steam. Electron shows the game's own build (for now the demo's, from npm run
// build:demo) off the disk at app://game/, so it plays with no network and keeps its saves in one place, and gives the
// page Steam through preload.cjs: the player, lobbies, invites and P2P packets (steam.cjs).
//
//   npm run desktop                          the demo in a window (it builds dist-demo first)
//   DD_FAKE_STEAM=27999 npm run desktop      a pretend Steam on that local port instead (fake-steam.cjs), and with
//   DD_PROFILE=b                             a second window with saves of its own: two players on one computer
//   npm run pack:demo                        the Windows build for Steam, into release/
//
// Steam's AppID is in config.json: 480 (Valve's Spacewar, open to everyone) until the demo has its own. A game Steam
// starts gets its AppID from Steam itself.

'use strict';
const { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const config = require('./config.json');
const { startSteam } = require('./steam.cjs');

const ROOT = path.resolve(__dirname, '..', config.content);
const ORIGIN = 'app://game';
/** Only while trying things out: a pretend Steam, and a second player's own saves. */
const fake = !app.isPackaged && process.env.DD_FAKE_STEAM;
if (!app.isPackaged && process.env.DD_PROFILE) app.setPath('userData', `${app.getPath('userData')}-${process.env.DD_PROFILE}`);

/**
 * What this run went through, in log.txt beside the saves (%APPDATA%\disco-dungeon on Windows), written anew each start:
 * the file to ask for when the game misbehaves on someone's computer.
 */
const LOG = path.join(app.getPath('userData'), 'log.txt');
const log = (...args) => {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch {
    // no log is no reason to stop
  }
};

// The game's files as https would serve them: the page's storage, fetch() and modules work as on the web.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.exit(0);

try { fs.rmSync(LOG, { force: true }); } catch { /* as above */ }
log(`Disco Underground ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${process.getSystemVersion()}`);

const appId = Number(process.env.SteamAppId) || config.appId;
// Started outside Steam: Steam starts it again its own way. Not for 480, which Steam would start as Spacewar.
if (app.isPackaged && config.appId !== 480 && require('@pipelab/steamworks.js').restartAppIfNecessary(config.appId)) app.exit(0);

let win = null;
const toPage = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };
// `--no-overlay` in the game's launch options (Steam: the game's Properties) starts it without the Steam overlay, should
// the overlay's way of drawing not get on with someone's graphics card. Not on a Mac at all: the switches it needs are
// untried there, and a game nobody sees (as on Windows before) is worse than one without the overlay.
const overlay = !process.argv.includes('--no-overlay') && process.platform !== 'darwin';
const steam = startSteam({ appId, fake, page: toPage, overlay, log });
if (steam.error) console.warn(`Steam: ${steam.error}`);
log(steam.error ? `Steam: none (${steam.error})` : `Steam: AppID ${appId}, overlay ${overlay && !fake ? 'on' : 'off'}`);

/** The window's own settings, kept between runs: fullscreen or not. */
const PREFS = path.join(app.getPath('userData'), 'window.json');
function prefs() {
  try {
    return { fullscreen: app.isPackaged, ...JSON.parse(fs.readFileSync(PREFS, 'utf8')) };
  } catch {
    return { fullscreen: app.isPackaged };
  }
}

/** A file of the game for an address of app://game/, or null for anything outside its folder. */
function fileOf(url) {
  const { host, pathname } = new URL(url);
  if (host !== 'game') return null;
  const file = path.join(ROOT, decodeURIComponent(pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  return pathname.endsWith('/') ? path.join(file, 'index.html') : file;
}

/**
 * Everything the page loads is its own, from the disk; the inline styles are the ones the game writes into its HTML. Steam
 * goes through preload.cjs, so the page needs no network at all.
 */
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Only the game's page talks to Steam and the app. */
const fromGame = e => e.senderFrame?.url.startsWith(`${ORIGIN}/`);
const ID = /^\d{1,20}$/;

ipcMain.on('steam:hello', e => { e.returnValue = fromGame(e) && !steam.error ? steam.hello() : null; });
ipcMain.handle('steam:host', (e, max, data) => {
  if (!fromGame(e) || steam.error) throw new Error('no Steam');
  return steam.host(Math.min(Math.max(Number(max) || 1, 1), 8), Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [String(k), String(v)])));
});
ipcMain.handle('steam:enter', (e, id) => {
  if (!fromGame(e) || steam.error || !ID.test(id)) throw new Error('no such lobby');
  return steam.enter(id);
});
ipcMain.on('steam:leave', (e, id) => { if (fromGame(e) && !steam.error && ID.test(id)) steam.leave(id); });
ipcMain.handle('steam:invite', (e, id) => (fromGame(e) && !steam.error && ID.test(id) ? steam.invite(id) : null));
ipcMain.handle('steam:friendLobbies', e => (fromGame(e) && !steam.error ? steam.friendLobbies() : []));
ipcMain.on('steam:send', (e, to, data) => { if (fromGame(e) && !steam.error && ID.test(to) && typeof data === 'string') steam.send(to, data); });
ipcMain.on('app:quit', e => { if (fromGame(e)) app.quit(); });

function open() {
  const p = prefs();
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540, show: false, fullscreen: p.fullscreen,
    backgroundColor: '#16110d', title: 'Disco Underground', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      // the host's game runs on while its window is behind another, as the players' games wait on it
      backgroundThrottling: false,
      // a game plays its music from the start, without waiting for a first click as a web page must
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => win.show());
  // fullscreen or not, however it was switched (the keys below, or a Mac's green button and menu), stays so next time
  const keep = () => fs.writeFileSync(PREFS, JSON.stringify({ ...prefs(), fullscreen: win.isFullScreen() }));
  win.on('enter-full-screen', keep);
  win.on('leave-full-screen', keep);
  win.webContents.on('did-finish-load', () => log('page loaded'));
  win.webContents.on('console-message', e => { if (e.level === 'warning' || e.level === 'error') log(`page ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`); });
  // F11 or Alt+Enter: fullscreen and back (a Mac's own Ctrl+Cmd+F is in its menu); F12 the developer tools, only while
  // trying things out
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  // the page never goes anywhere but the game; links out (the Steam page, the feedback form) open in the browser
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // a page that crashed comes back: the game takes its room or campaign up again as after a reload
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`page gone: ${d.reason} (${d.exitCode})`);
    if (d.reason !== 'clean-exit') win.loadURL(`${ORIGIN}/index.html`);
  });
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

// started again while it runs: by Steam with a friend's lobby to join, or by hand
app.on('second-instance', (_e, argv) => {
  if (!steam.error) steam.again(argv);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('child-process-gone', (_e, d) => log(`${d.type} process gone: ${d.reason} (${d.exitCode})`));

app.whenReady().then(() => {
  log(`switches: ${['in-process-gpu', 'disable-direct-composition', 'disable-gpu'].filter(s => app.commandLine.hasSwitch(s)).join(' ') || 'none'}`);
  log(`GPU: ${JSON.stringify(app.getGPUFeatureStatus())}`);
  app.getGPUInfo('basic').then(i => log(`GPU devices: ${JSON.stringify(i.gpuDevice)}`)).catch(() => {});
  // No menu, but a Mac's: without it there Cmd+Q doesn't quit and Cmd+V doesn't paste a room's code
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }] }, { role: 'windowMenu' }])
    : null);
  protocol.handle('app', async req => {
    const file = fileOf(req.url);
    if (!file) return new Response('', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith('.html')) return res;
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
  // copying the room's code is all the page asks for
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));
  open();
});

app.on('window-all-closed', () => app.quit());
