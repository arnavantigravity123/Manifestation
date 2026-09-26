// Manifestation PWA Service Worker (Network-First Pass-Through)
// Ensures 100% PWA installability compliance in Chrome/Edge while keeping code fresh from the server
const CACHE_NAME = 'manifestation-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Always fetch live from network first so code updates take effect instantly
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
