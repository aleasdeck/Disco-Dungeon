// How electron-builder packs the desktop build for Steam (npm run pack:demo, on each system for its own): the demo's files
// (dist-demo), the app's own (electron/) and steamworks.js, into release/win-unpacked/, release/linux-unpacked/ (Linux and
// the Steam Deck) or release/mac-universal/ (a Mac with either chip). That folder is what goes up to Steam (SteamPipe),
// each system's into a depot of its own.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** The VERSION file's major.minor as the app's version; the build number stays the menu's (vite.config.ts). */
const version = `${fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim()}.0`;
const STEAMWORKS = 'node_modules/@pipelab/steamworks.js';

module.exports = {
  appId: 'com.aleasdeck.discounderground.demo',
  productName: 'Disco Underground Demo',
  executableName: 'DiscoUndergroundDemo',
  copyright: 'Disco Underground',
  extraMetadata: { version },
  directories: { output: 'release' },
  files: [
    'electron/{main,preload,steam}.cjs', 'electron/config.json', 'electron/icon.png', 'dist-demo/**/*', 'package.json',
    '!node_modules/{@types,undici-types}/**',
  ],
  // the native part of steamworks.js and Steam's own library next to it, out of the archive so they can be loaded
  asarUnpack: [`${STEAMWORKS}/dist/**`],
  // Chromium's own words (a text field's menu) in the game's languages only
  electronLanguages: ['en-US', 'ru', 'zh-CN', 'de', 'fr', 'es', 'pt-BR', 'ja', 'ko', 'pl'],
  icon: 'electron/icon.png',
  // Steam updates the game, so no updater's file
  publish: null,
  win: {
    target: 'dir',
    // Steam's library beside the game too, as Valve's documentation puts it (asarUnpack keeps one by the .node file)
    extraFiles: [{ from: `${STEAMWORKS}/dist/win64/steam_api64.dll`, to: 'steam_api64.dll' }],
  },
  linux: { target: 'dir', executableName: 'disco-underground-demo', category: 'Game' },
  mac: {
    target: [{ target: 'dir', arch: ['universal'] }],
    category: 'public.app-category.games',
    // No Apple Developer account: signed ad hoc, as a Mac with Apple's chip wants of any program. A game installed by Steam
    // runs so; Gatekeeper stops only what a browser downloaded (the CI's zip: right click → Open). Hardened runtime would
    // refuse Electron's own frameworks signed by another team.
    identity: '-',
    hardenedRuntime: false,
    // steamworks.js brings the modules for both chips, the same files in both halves of the universal build
    x64ArchFiles: `**/${STEAMWORKS}/dist/osx/*.node`,
  },
};
