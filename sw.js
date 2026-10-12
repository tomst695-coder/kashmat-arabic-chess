const CACHE_NAME = "kashmat-shell-v1.0.1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/style.css",
  "./src/chess.js",
  "./src/engine-worker.js",
  "./src/main.js",
  "./src/pwa.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("kashmat-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())));
      return response;
    }).catch(async () => (await caches.match(request)) || caches.match("./index.html")));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())));
    }
    return response;
  })));
});
