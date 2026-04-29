/* =====================================================================
   FAMILY DOCUMENTS — Service Worker
   ---------------------------------------------------------------------
   Offline strategy:
   • App shell (HTML/CSS/JS/manifest/icons) → cache-first
   • Google API calls (drive/oauth2/identity)            → network-only
   • Other GETs                                           → stale-while-revalidate
   ===================================================================== */

const VERSION = 'v1.1.2';
const SHELL_CACHE = `fdm-shell-${VERSION}`;
const RUNTIME_CACHE = `fdm-runtime-${VERSION}`;

// Files that make up the offline shell. Keep this list small and stable.
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

// ---- Install: pre-cache shell -----------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
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
      .then(() => self.clients.claim())
  );
});

// ---- Fetch -----------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only intercept GETs

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

  // 2. Same-origin shell → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // Cache successful same-origin GETs in runtime cache
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => { /* best-effort */ });
          }
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // 3. Cross-origin GETs → stale-while-revalidate (best effort)
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) {
            cache.put(req, res.clone()).catch(() => { /* best-effort */ });
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

// ---- Optional: respond to messages (e.g. force update) ---------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
