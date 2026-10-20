// Minimale service worker: maakt de app installeerbaar en laat de "schil"
// (HTML/JS/CSS) sneller laden. Data (Supabase) gaat altijd live over het
// netwerk, zodat picks en scores nooit verouderd zijn.
const CACHE = "pronostiek-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Alleen onze eigen bestanden cachen; alles van Supabase/Google Fonts e.d. gaat gewoon door.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Netwerk eerst (altijd de nieuwste versie na een deploy), cache als vangnet offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
