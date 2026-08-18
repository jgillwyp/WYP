'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import MainScreen from './components/MainScreen'
import LandingPage from './components/LandingPage'

// `/` deliberately does NOT use RequireAuth (app/RequireAuth.tsx), which
// unconditionally router.replace('/login')s an anonymous visitor — that's
// exactly the behavior the owner asked to change, 2026-08-13: "I want to
// have people come to the website and see the WYP_landing_page.html...
// [not] be directed to /login and presented with the sign-in page." A
// returning, already-signed-in visitor on the same device still lands
// straight on MainScreen, same as today — Keep Me Signed In's session
// persists via localStorage (supabaseClient.ts's own REMEMBER_KEY/
// hybridStorage), so this only changes what a *new or signed-out* visitor
// sees at the root URL. Every other authenticated route in the app keeps
// using RequireAuth unchanged; this carve-out is specific to `/`.
//
// getSession(), not getUser() — bug fix, 2026-08-13. Owner-reported: closed
// the browser signed in, reopened it a few minutes later, and landed on
// the landing page instead of Main Screen; revisiting a bit later (no
// action taken in between) correctly showed Main Screen again. getUser()
// makes a live round-trip to Supabase's Auth server to validate the
// current token, and this code was treating *any* non-success from that
// call as "not signed in" — including a transient network hiccup right
// after the browser reopens, not just a genuinely absent session.
// getSession() reads the already-initialized/refreshed local session
// instead (no network round-trip of its own), so it isn't vulnerable to
// that race — and it's already the pattern app/login/page.tsx's own
// already-signed-in check uses, so this brings page.tsx in line with the
// established convention rather than introducing a new one. This is a
// UI-routing decision only, not a security boundary — every actual data
// read/write still goes through Supabase's own RLS/JWT verification
// server-side regardless of which check picks the screen to render.
//
// onAuthStateChange subscription (2026-08-18) — added on top of the
// one-time getSession() check above/below, not instead of it. Owner-
// reported cross-window bug: signing in via a magic link in a regular
// Chrome tab, while an already-open standalone "installed" WYP window (see
// CLAUDE.md's Known gaps, same-day manifest/PWA batch) was still sitting on
// this page from before — the standalone window kept showing LandingPage
// indefinitely, since its own getSession() check only ever ran once, at
// its original mount. supabase-js already broadcasts SIGNED_IN/SIGNED_OUT
// across same-origin tabs/windows via a BroadcastChannel internally — the
// gap was that this component never listened for it. Same fix applied to
// RequireAuth.tsx.
export default function Home() {
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>('checking')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setStatus(data.session ? 'authed' : 'anon')
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setStatus(session ? 'authed' : 'anon')
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (status === 'checking') return <div>Loading…</div>
  if (status === 'authed') return <MainScreen />
  return <LandingPage />
}
