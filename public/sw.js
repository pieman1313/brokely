/* Brokely service worker — makes the app installable and available offline.
 *
 * Everything stays on the device: this only caches Brokely's OWN static files
 * (HTML / JS / CSS / icons) so the app opens with no network. It never caches or
 * transmits your statement — your CSV is loaded fresh each session, in memory only.
 *
 * Strategy: navigations are network-first (so a new deploy always loads the latest
 * HTML, falling back to the cached shell when offline); hashed assets are served
 * cache-first with a background refresh. Bump CACHE to purge old versions. */
const CACHE = "brokely-v2";
const SHELL = new URL("./", self.location).href; // the app root, e.g. /spend/
const NAV_TIMEOUT = 3500; // ms before a stalled navigation falls back to the cached shell

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Precache the shell AND the hashed assets it references, so the app works
  // offline after a single visit (otherwise the first load's assets stream in
  // before the worker takes control and wouldn't be cached until a second visit).
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(SHELL, { cache: "reload" });
        await cache.put(SHELL, res.clone());
        const html = await res.text();
        const urls = new Set();
        const re = /(?:src|href)="([^"]+)"/g;
        let m;
        while ((m = re.exec(html))) {
          if (/\.(js|css|svg|png|webmanifest|woff2?)(\?|$)/i.test(m[1])) urls.add(new URL(m[1], SHELL).href);
        }
        await Promise.all([...urls].map((u) => cache.add(u).catch(() => {})));
      } catch {
        /* offline at install time — runtime caching fills the cache later */
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// fetch fresh (bypassing the HTTP cache), but give up after NAV_TIMEOUT so a
// stalled "lie-fi" connection falls back to the cached shell instead of hanging.
function fetchFresh(req) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT);
  return fetch(req, { cache: "reload", signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function navigate(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchFresh(req);
    // only cache a genuinely-good page — never let a transient 404/5xx or a
    // redirect poison the shell that offline reloads depend on.
    if (res && res.ok && !res.redirected) cache.put(SHELL, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match(SHELL)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // never touch cross-origin

  if (req.mode === "navigate") {
    event.respondWith(navigate(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
