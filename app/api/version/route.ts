import { APP_VERSION, BUILD_DATE } from '@/version'

/**
 * GET /api/version — the currently-deployed build's own version stamp,
 * read fresh on every request (2026-09-18, owner-reported: an iPhone
 * tester was stuck 100 builds behind, iOS Safari's own well-documented
 * aggressive caching for installed PWAs — see the "An iPhone often fails
 * to update a Progressive Web App" writeup Jim forwarded).
 *
 * PWAProvider.tsx polls this on mount and on tab/window focus, comparing
 * it against the APP_VERSION baked into the JS bundle the visitor is
 * actually running. A mismatch means that bundle is stale regardless of
 * what any cache header claims, since this route's own response can never
 * itself be a cached copy of an old deploy — a dynamic route (not a static
 * file under public/) always executes fresh, and the explicit no-store
 * header below rules out any intermediate cache (CDN, browser, or iOS's
 * own aggressive layer) serving a stale response to this one request even
 * if it would to everything else.
 */
export async function GET() {
  return Response.json(
    { version: APP_VERSION, buildDate: BUILD_DATE },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
  )
}
