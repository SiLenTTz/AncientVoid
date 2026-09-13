/*
 * UACC service worker — K10: offline tolerance.
 * Network-first for API projections; on failure serve the cached projection
 * with an X-UACC-Cached-At timestamp so the UI can badge "Daten vom <ts>".
 * Versioned cache — hard-bust by bumping CACHE_VERSION on deploy.
 */
const CACHE_VERSION = "uacc-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(req, url));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

async function networkFirstApi(req, url) {
  try {
    const res = await fetch(req);
    if (res.ok && url.pathname === "/api/sessions") {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: {
          ...Object.fromEntries(cached.headers.entries()),
          "X-UACC-Cached-At": new Date().toISOString(),
        },
      });
    }
    return new Response(JSON.stringify({ error: "offline", noCache: true }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}
