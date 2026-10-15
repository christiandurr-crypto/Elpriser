/* Netvaerk foerst, gemt kopi hvis telefonen er offline.
   Gaelder app-skallen og data/latest.json. Kald til Energi Data Service roeres ikke. */
const CACHE = "elpris-v3";
const SKAL = ["./", "index.html", "beregn.js", "config.json", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SKAL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;           // API-kald roeres ikke
  e.respondWith(
    fetch(e.request).then(r => { const k = r.clone(); caches.open(CACHE).then(c => c.put(e.request, k)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
