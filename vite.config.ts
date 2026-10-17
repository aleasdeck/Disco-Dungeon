import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Every file under `dir` but hidden ones (.gitkeep), as paths relative to it with forward slashes. */
function filesIn(dir: string, sub = ''): string[] {
  return readdirSync(join(dir, sub), { withFileTypes: true }).filter(e => !e.name.startsWith('.')).flatMap(e =>
    e.isDirectory() ? filesIn(dir, `${sub}${e.name}/`) : [`${sub}${e.name}`]);
}

/** A file's content hash; the service worker checks what it downloads against the same hash. */
const revOf = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);

/**
 * Content hash and size of every file in public/assets: the game asks for each as `…?v=<hash>`, so a changed picture
 * gets a new address, and fills the loading bar by the sizes.
 */
function assetInfo(): Record<string, [string, number]> {
  const dir = resolve('public/assets');
  return Object.fromEntries(filesIn(dir).map(f => [f, [revOf(join(dir, f)), statSync(join(dir, f)).size]]));
}

/**
 * The offline cache: after the build, writes dist/sw.js (src/sw.js under the list of every file of the build with its
 * content hash), so a returning player loads the game from the device and downloads only what a new version changed.
 */
function serviceWorker(assets: Record<string, [string, number]>): Plugin {
  let outDir = '';
  return {
    name: 'dd-service-worker',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const files = filesIn(outDir).filter(f => f !== 'sw.js').map(f => {
        const rev = revOf(join(outDir, f)), pub = f.startsWith('assets/') && assets[f.slice(7)]?.[0];
        if (pub && pub !== rev) throw new Error(`${f} differs from public/${f}`);
        // the page is kept under the folder's address, the one it is opened by
        return [f === 'index.html' ? './' : pub ? `${f}?v=${rev}` : f, rev];
      });
      writeFileSync(join(outDir, 'sw.js'), `const FILES = ${JSON.stringify(files)};\n\n${readFileSync(resolve('src/sw.js'), 'utf8')}`);
    },
  };
}

// Relative base so the build works at https://<user>.github.io/<repo>/ whatever the repo is called.
export default defineConfig(({ command }) => {
  const assets = command === 'build' ? assetInfo() : {};
  return {
    base: './',
    build: { target: 'es2022' },
    define: { __ASSETS__: JSON.stringify(assets) },
    plugins: [serviceWorker(assets)],
  };
});
