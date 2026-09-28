// Network first, cache as fallback: new deploys show up at once, and the app still opens offline.
// The API is never cached here. The app keeps its own copy of paints and recipes in localStorage.
const CACHE = 'paint-mixer-v2';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'mix.js',
  'paints.js',
  'worker.js',
  'style.css',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // A redirect means Cloudflare Access wants a new login. Do not cache the login page.
        if (res.ok && !res.redirected && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
  );
});
