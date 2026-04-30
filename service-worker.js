/* =====================================================================
   FAMILY DOCUMENTS — Service Worker
   ---------------------------------------------------------------------
   Strategy:
   • Same-origin app code (HTML/CSS/JS/manifest)  → NETWORK-FIRST
       Always fetch fresh from network if online; fall back to cache only
       if offline. New deploys are picked up on the next page load with
       no manual "Unregister" dance.
   • Same-origin static assets (images/icons)     → cache-first
       These rarely change and benefit from instant offline display.
   • Google API calls                             → network-only
   • Cross-origin GETs                            → stale-while-revalidate
   ===================================================================== */

const VERSION = 'v1.4.4';
const SHELL_CACHE = `fdm-shell-${VERSION}`;
const RUNTIME_CACHE = `fdm-runtime-${VERSION}`;

// Files that make up the offline shell. Used only as offline fallback.
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

// File extensions for static assets (cache-first). Anything not matching
// these is treated as app code and uses network-first.
const STATIC_ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i;

// ---- Install: pre-cache shell -----------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()) // activate immediately, don't wait
  );
});

// ---- Activate: clean up old caches ------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // take control of open pages
  );
});

// ---- Fetch -----------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 0. Only handle http(s). Browser extensions inject chrome-extension://
  //    requests into the page scope which the Cache API can't store.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Never cache Google APIs / auth — must be live every call
  const NETWORK_ONLY_HOSTS = [
    'googleapis.com',
    'gstatic.com',
    'accounts.google.com',
    'apis.google.com',
    'content.googleapis.com'
  ];
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
    return; // fall through to network
  }

  // 2. Same-origin
  if (url.origin === self.location.origin) {
    const isStatic = STATIC_ASSET_EXT.test(url.pathname);
    if (isStatic) {
      // Cache-first for icons/images (rarely change)
      event.respondWith(
        caches.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(RUNTIME_CACHE)
                .then((c) => c.put(req, copy))
                .catch(() => {});
            }
            return res;
          }).catch(() => caches.match('./index.html'));
        })
      );
    } else {
      // NETWORK-FIRST for app code (HTML/CSS/JS/manifest). Updates
      // ship instantly on next reload — no Unregister-and-clear dance.
      event.respondWith(
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        }).catch(() =>
          // Offline → fall back to cache, then to index.html for SPA
          caches.match(req).then((cached) => cached || caches.match('./index.html'))
        )
      );
    }
    return;
  }

  // 3. Cross-origin GETs → stale-while-revalidate (best effort)
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

// ---- Messages from page (e.g. force update) ---------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
