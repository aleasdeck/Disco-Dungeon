import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { demoBuild, demoContent, demoPublic } from './scripts/demo-build.mjs';

/** Every file under `dir` but hidden ones (.gitkeep), as paths relative to it with forward slashes. */
function filesIn(dir: string, sub = ''): string[] {
  return readdirSync(join(dir, sub), { withFileTypes: true }).filter(e => !e.name.startsWith('.')).flatMap(e =>
    e.isDirectory() ? filesIn(dir, `${sub}${e.name}/`) : [`${sub}${e.name}`]);
}

/** A file's content hash; the service worker checks what it downloads against the same hash. */
const hashOf = (data: Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 10);
const revOf = (path: string) => hashOf(readFileSync(path));

/**
 * Content hash and size of every file in public/assets (of the demo's build, the ones it carries): the game asks for each
 * as `…?v=<hash>`, so a changed picture gets a new address, and fills the loading bar by the sizes.
 */
function assetInfo(demo?: Map<string, Buffer>): Record<string, [string, number]> {
  if (demo) return Object.fromEntries([...demo].filter(([f]) => f.startsWith('assets/')).map(([f, b]) => [f.slice(7), [hashOf(b), b.length]]));
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
      // a build that failed wrote nothing
      if (!existsSync(outDir)) return;
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

/**
 * The game's version as the main menu shows it: major.minor from the VERSION file, set by hand, then the build number,
 * how many commits main has had since that file last changed. Every merge counts one up by itself, and a new major.minor
 * starts again from the bare «v0.2». Needs the whole history (the workflow checks out with fetch-depth 0); a shallow
 * clone or no git gives the version without the number.
 */
function version(): string {
  const base = readFileSync(resolve('VERSION'), 'utf8').trim();
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('shallow clone');
    const since = git('log', '-1', '--format=%H', '--', 'VERSION');
    const n = since ? Number(git('rev-list', '--count', `${since}..HEAD`)) : 0;
    return n ? `v${base}.${n}` : `v${base}`;
  } catch (e) {
    console.warn(`version: v${base} without a build number (${(e as Error).message})`);
    return `v${base}`;
  }
}

// Relative base so the build works at https://<user>.github.io/<repo>/ whatever the repo is called. `vite build --mode demo`
// is the demo's own build for Steam, into dist-demo/: its files of public/ come from its plugin (scripts/demo-build.mjs).
export default defineConfig(async ({ command, mode }) => {
  const root = resolve('.'), demo = command === 'build' && mode === 'demo' ? await demoContent(root) : null;
  const assets = command === 'build' ? assetInfo(demo ? demoPublic(root, demo) : undefined) : {};
  return {
    base: './',
    build: { target: 'es2022', ...(demo ? { outDir: 'dist-demo' } : {}) },
    ...(demo ? { publicDir: false as const } : {}),
    define: { __ASSETS__: JSON.stringify(assets), __VERSION__: JSON.stringify(version()), __DEMO_BUILD__: JSON.stringify(!!demo) },
    plugins: [...(demo ? [demoBuild(root, demo)] : []), serviceWorker(assets)],
  };
});
