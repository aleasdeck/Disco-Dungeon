// What the desktop app gives the game's page, as window.desktop (src/net/steam.ts says what each call does): the way out
// of the game, Steam's language for it, and Steam itself, or null when Steam didn't start.

'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const steam = ipcRenderer.sendSync('steam:hello');
const listen = channel => cb => { ipcRenderer.on(channel, (_e, ...args) => cb(...args)); };

contextBridge.exposeInMainWorld('desktop', {
  quit: () => ipcRenderer.send('app:quit'),
  lang: steam?.lang ?? null,
  steam: steam && {
    id: steam.id,
    name: steam.name,
    launch: steam.launch,
    host: (max, data) => ipcRenderer.invoke('steam:host', max, data),
    enter: lobby => ipcRenderer.invoke('steam:enter', lobby),
    leave: lobby => ipcRenderer.send('steam:leave', lobby),
    invite: lobby => ipcRenderer.invoke('steam:invite', lobby),
    send: (to, data) => ipcRenderer.send('steam:send', to, data),
    onPacket: listen('steam:packet'),
    onFail: listen('steam:fail'),
    onInvite: listen('steam:invited'),
  },
});
