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

// Only intercept GET (2026-09-29, owner-reported — iPhone attachment
// uploads failed server-side with "Failed to parse body as FormData," in
// both Chrome and the home-screen icon on iOS, which are both WebKit under
// Apple's rules). Passing a Request with a multipart/FormData body (a
// File upload) through fetch(event.request) is a known WebKit bug: it
// doesn't reliably reconstruct the body, corrupting the multipart
// boundary before it ever reaches the server. This SW does no caching
// either way, so there's no reason to intercept a POST at all — Chrome's
// installability check only requires an active fetch listener to exist,
// not that it handle every request; letting non-GET requests fall through
// untouched (no respondWith call) avoids the bug entirely.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})
