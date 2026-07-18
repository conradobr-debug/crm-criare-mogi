const CACHE_NAME = "crm-criare-shell-v35";
const APP_SHELL = [
  "./",
  "./index.html",
  "./criare.css",
  "./whatsapp-data-service.js",
  "./whatsapp-crm-extension/capture-core.js",
  "./audio-import-matcher.js",
  "./batch-analysis.js?v=2.3.2-1",
  "./batch-analysis-ui.js?v=2.3.2-1",
  "./partners.js",
  "./manifest.webmanifest",
  "./assets/logo-criare.png",
  "./assets/app-icon.svg",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if(url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if(response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
