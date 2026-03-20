// A persistent SW that re-registers itself on install/activation to simulate aggressive tracking
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim().then(() => {
    // Attempt re-registration to trigger amber badge watcher
    return self.registration.update();
  }));
});
