/*
 * UACC service worker — K10: offline tolerance.
 * Network-first for API projections; on failure serve the cached projection
 * with an X-UACC-Cached-At timestamp so the UI can badge "Daten vom <ts>".
 * Versioned cache — hard-bust by bumping CACHE_VERSION on deploy.
 */
const CACHE_VERSION = "uacc-v2";
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
    // Real bug, found via a live report ("UI shows old colors/layout after
    // a rebuild"): this used to be cache-first (`caches.match(req).then(hit
    // => hit || fetch(...))`), so once the app shell (/, /index.html, the
    // hashed JS/CSS bundle) was cached once, a phone would NEVER see a
    // newer build again — every subsequent load served the frozen-in-time
    // cache, silently, forever, regardless of how many times the PWA was
    // rebuilt. Network-first (mirroring networkFirstApi below) fixes that:
    // the shell only falls back to cache when actually offline, which is
    // K10's real purpose, not "prefer stale over fresh while online".
    event.respondWith(networkFirstShell(req));
  }
});

async function networkFirstShell(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error("offline and nothing cached for " + req.url);
  }
}

// T1.5-3: the account-level usage/quota endpoint (ADR-0004) needs the same
// offline tolerance as the session list — an adapter's usage doesn't
// change per session, so a stale-but-labeled value is still useful.
const CACHEABLE_API_PATTERNS = [/^\/api\/sessions$/, /^\/api\/adapters\/[^/]+\/usage$/];

async function networkFirstApi(req, url) {
  try {
    const res = await fetch(req);
    if (res.ok && CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname))) {
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
