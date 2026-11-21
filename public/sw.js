/* Wraith service worker: push notifications + keeping the app usable when the connection drops.
   Screens you opened are kept on the device: if the network fails (or is gone) the last copy of that screen opens instead of an error, and the app code
   (/_next/static, immutable files) is kept too, so that copy can start. The branded offline page is the last resort. API calls are never touched. */
const OFFLINE_CACHE = "wraith-offline-v2";
const PAGES = "wraith-pages-v1";
const STATIC = "wraith-static-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.addAll([OFFLINE_URL, "/icon-192.png"])).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("wraith-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) { // app code: never changes under the same name, so the copy on the device is always right
    event.respondWith(caches.open(STATIC).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }));
    return;
  }
  if (req.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && url.pathname.startsWith("/app")) { const c = await caches.open(PAGES); c.put(url.pathname, res.clone()); }
      return res;
    } catch {
      const c = await caches.open(PAGES);
      return (await c.match(url.pathname)) || (await c.match("/app")) || (await caches.match(OFFLINE_URL)) || Response.error();
    }
  })());
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : "" }; }
  const opts = {
    body: d.body || "",
    icon: d.icon || "/icon-192.png",
    data: { url: d.url || "/app" },
  };
  if (d.tag) { opts.tag = d.tag; opts.renotify = true; }
  event.waitUntil(self.registration.showNotification(d.title || "Wraith", opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          if ("navigate" in c) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
