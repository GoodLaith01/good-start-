// Minimal service worker: makes Grab installable so it can appear in the phone's Share menu.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
