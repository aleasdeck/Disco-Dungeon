// Offline cache of the whole game. The build turns this file into dist/sw.js with FILES above it: every file of the
// build as [address, content hash], pictures as `…?v=<hash>`. A returning player gets everything from the device; a new
// version downloads only the files whose hash changed and drops the ones it no longer has. The page is always asked of
// the network first, so a new version is played as soon as it is deployed; the cached one is for a dead connection.
/* global FILES */

const CACHE = 'dd-files';
/** Google Fonts: the stylesheet and the font files it points to, kept as they come. */
const FONTS = 'dd-fonts';
/** Header the cached copy carries its content hash in, so an unchanged file isn't downloaded again. */
const REV = 'x-dd-rev';
/** How long the page waits for the network before it opens from the cache. */
const PAGE_WAIT = 4000;

const scope = new URL('./', self.location.href).href;
const wanted = new Map(FILES.map(([url, rev]) => [new URL(url, scope).href, rev]));

async function hashOf(buf) {
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...sum.slice(0, 5)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Download one file and keep it, if what came is the file of this build (a stale copy on the way would stick until its next change). */
async function store(cache, url, rev) {
  for (const mode of ['no-cache', 'reload']) {
    const res = await fetch(url, { cache: mode });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = await res.arrayBuffer();
    if ((await hashOf(buf)) !== rev) continue;
    const headers = new Headers(res.headers);
    headers.set(REV, rev);
    return cache.put(url, new Response(buf, { status: res.status, statusText: res.statusText, headers }));
  }
  throw new Error(`${url} is not the file of this build`);
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // the page goes last: the cached page must never point to files that aren't in the cache yet
    const todo = [...wanted].filter(([url]) => url !== scope);
    const worker = async () => {
      for (let job; (job = todo.pop()); ) {
        const [url, rev] = job, have = await cache.match(url);
        if (have?.headers.get(REV) !== rev) await store(cache, url, rev);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await store(cache, scope, wanted.get(scope));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('dd-') && name !== CACHE && name !== FONTS) await caches.delete(name);
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const { origin, hostname } = new URL(req.url);
  if (req.mode === 'navigate') e.respondWith(page(req));
  else if (origin === self.location.origin) e.respondWith(caches.open(CACHE).then(c => c.match(req)).then(hit => hit ?? fetch(req)));
  else if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') e.respondWith(font(e, hostname === 'fonts.gstatic.com'));
});

/**
 * The page from the network, checked with the server every time (the browser would otherwise reuse its copy for ten
 * minutes after a deploy); from the cache when there's no network or it's too slow to answer.
 */
async function page(req) {
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => (res.redirected ? Response.redirect(res.url) : res));
  net.catch(() => {});
  const res = await Promise.race([net, new Promise(r => setTimeout(r, PAGE_WAIT))]).catch(() => null);
  if (res) return res;
  return (await (await caches.open(CACHE)).match(scope)) ?? net;
}

/** Font files never change at their address; the stylesheet is served from the cache and refreshed behind it. */
async function font(e, immutable) {
  const req = e.request, cache = await caches.open(FONTS), hit = await cache.match(req);
  if (hit && immutable) return hit;
  const net = fetch(req).then(async res => {
    if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
    return res;
  });
  if (!hit) return net;
  e.waitUntil(net.catch(() => {}));
  return hit;
}
