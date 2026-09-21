// Makes the installed app open fast and open at all with no signal.
//  - the page itself (index.html): network first, so a new deploy shows up right away; the last copy is used offline
//  - the app's own files (/assets/*, icons): cache first -- their names change whenever their contents do
//  - everything else (the database, ESPN, Google sign-in): never touched here
const CACHE = "cmu-hub-v1";
const MAX_ENTRIES = 120; // old builds' files age out instead of piling up

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("cmu-hub-") && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(new URL("./", self.registration.scope).href, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(new URL("./", self.registration.scope).href)) || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.includes("/assets/") || /\.(png|webmanifest|ico|svg)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        if (fresh.ok) {
          cache.put(req, fresh.clone());
          trim(cache);
        }
        return fresh;
      })()
    );
  }
});
