/* Netvaerk foerst, gemt kopi hvis telefonen er offline.
   Gaelder app-skallen og data/latest.json. Kald til Energi Data Service roeres ikke.
   "no-cache" = spoerg altid serveren, om der er en nyere version. Saa ses en ny udgivelse
   med det samme i stedet for efter GitHub Pages' 10 minutters cache. */
const CACHE = "elpris-v10";
const SKAL = ["./", "index.html", "beregn.js", "config.json", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SKAL.map((u) => new Request(u, { cache: "no-cache" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;           // API-kald roeres ikke
  const noegle = u.origin + u.pathname;                // ?x=123 ignoreres i den gemte kopi
  e.respondWith(
    fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" }))
      .then((r) => {
        if (r.ok) { const k = r.clone(); caches.open(CACHE).then((c) => c.put(noegle, k)); }
        return r;
      })
      .catch(() => caches.match(noegle).then((r) => {
        if (r) return r;
        if (req.mode === "navigate") return caches.match(new URL("index.html", self.registration.scope).href);
        return Response.error();
      }))
  );
});
