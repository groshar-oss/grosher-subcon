// Service worker: שומר את קבצי המערכת כדי שתיפתח גם בלי קליטה. נתונים תמיד מהרשת.
const V = 'subcon-v6';
const FILES = ['./', 'index.html', 'css/app.css?v=1', 'js/app.js', 'manifest.json', 'icons/icon-192.png', 'icons/logo-neg.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // קודם רשת, ואם אין קליטה מהמטמון
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
