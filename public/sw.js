const cacheName = 'bookconverter-v2';
const assets = ['', 'index.html', 'styles.css', 'app.js', 'storage.js', 'epub.js', 'zip.js', 'manifest.webmanifest', 'icon.svg']
  .map(path => new URL(path, self.registration.scope).href);
const assetPaths = new Set(assets.map(asset => new URL(asset).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bookconverter-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !assetPaths.has(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
