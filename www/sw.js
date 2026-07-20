const CACHE = 'gesthote-v1.8.11';
const ASSETS = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/update-check.js', 'autobackup.js', '/img/icon-flat.png', '/img/icon-192.png', '/img/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  // Ne pas intercepter les requêtes vers d'autres origines (ex. synchro iCal externe) :
  // laisser passer telles quelles pour que les erreurs réseau/CORS remontent à l'appelant.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Toujours récupérer version.json depuis le réseau (pour les MAJ)
  if (e.request.url.includes('version.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'CHECK_UPDATE') {
    self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SW_ACTIVE', cache: CACHE }));
    });
  }
});
