// node art/sound/render.mjs funk [lounge bfunk …] — renders each song of music.js, one pass plus its tail, to out/<name>.f32;
// post.py makes the seamless loop and the mp3 of it. Needs Playwright's Chromium (the npm package `playwright`).
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const need = createRequire(import.meta.url);
const { chromium } = (() => { try { return need('playwright'); } catch { return need('/opt/node-tools/node_modules/playwright'); } })();
const dir = new URL('.', import.meta.url).pathname;
mkdirSync(join(dir, 'out'), { recursive: true });
const srv = http.createServer((q, r) => {
  try { const p = join(dir, decodeURIComponent(q.url.split('?')[0])); const b = readFileSync(p); r.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' }); r.end(b); }
  catch { r.writeHead(404); r.end(); }
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage();
pg.on('console', m => console.log('page:', m.text()));
pg.on('pageerror', e => console.log('error:', e.message));
await pg.goto(`http://127.0.0.1:${port}/render.html`);
await pg.waitForFunction('window.ready');
const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const suffix = args.find(a => a.startsWith('--suffix='))?.slice(9) ?? '';
for (const name of args.filter(a => !a.startsWith('--'))) {
  const r = await pg.evaluate(n => window.renderSong(n), name);
  writeFileSync(join(dir, 'out', name + suffix + '.f32'), Buffer.from(r.data, 'base64'));
  writeFileSync(join(dir, 'out', name + suffix + '.json'), JSON.stringify({ L: r.L, sr: 44100 }));
  console.log(name, 'peak', r.peak.toFixed(3), 'loop', r.L.toFixed(3), 's', 'render', Math.round(r.ms), 'ms');
}
await b.close(); srv.close();
