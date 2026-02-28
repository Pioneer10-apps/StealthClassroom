const CACHE_NAME = 'stealth-classroom-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/background.png',
  '/background2.png',
  '/background3.png',
  '/ninja1.png',
  '/ninja2.png',
  '/done.png',
  '/banner.png',
  '/jungle1.png',
  '/jungle2.png',
  '/jungle3.png',
  '/dino1.png',
  '/dino2.png',
  '/dino_done.png',
  '/dinobanner.png',
  '/candy1.png',
  '/candy2.png',
  '/candy3.png',
  '/bear1.png',
  '/bear2.png',
  '/bear_done.png',
  '/candybanner.png',
  '/santabackground1.png',
  '/santabackground2.png',
  '/santabackground3.png',
  '/santa1.png',
  '/santa2.png',
  '/santadone.png',
  '/santabanner.png',
  '/favicon.svg',
  '/favicon.ico',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
