// Minimal service worker (2026-08-18) — exists only because Android Chrome
// requires an active service worker before it will offer a real "Install
// app" prompt (the beforeinstallprompt event never fires without one).
// Deliberately does no offline caching — WYP is a live Supabase-backed app
// with no offline story yet, and a caching layer here would be a much
// bigger, separate feature (and a good way to accidentally serve stale
// auth state). This just satisfies the installability criterion: register,
// skip the waiting phase, and pass every fetch straight through to the
// network untouched. See CLAUDE.md's Known gaps for the manifest/PWA batch
// this belongs to.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
