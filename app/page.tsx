'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
//
// Expired/invalid magic-link error handling (2026-08-18) — owner-reported:
// clicking a Sign In link landed him on the landing page with no visible
// explanation, address bar reading
// "...vercel.app/#error=access_denied&error_code=otp_expired&error_description=...".
// Supabase's own redirect-on-failure behavior sends a used/expired/invalid
// OTP link back to the project's configured Site URL (this root route, not
// app/auth/callback, which only ever runs on a *successful* verification)
// with the failure encoded in the URL hash rather than a query string or a
// page Supabase itself renders. Nothing here was reading that hash, so the
// failure was real but silent — indistinguishable from "nothing happened."
// Parsed once via a lazy useState initializer — reading window.location.hash
// synchronously during this component's first render, same pattern already
// used elsewhere in this codebase (ResponseDetailForm.tsx's
// cameFromCalendarLink) — rather than an effect that calls setState, which
// the lint rule (react-hooks/set-state-in-effect) flags as an avoidable
// cascading-render pattern here since nothing async is involved. Clearing
// the hash afterward is a real side effect (not a state update), so that
// part still belongs in a plain useEffect below.
// Retry-with-backoff for the session check below (2026-09-22, owner-
// reported — iPhone Chrome) — a real, live-tested bug: a completely valid,
// unexpired session sat in localStorage the whole time (confirmed via
// /debug-session's own getSession()/getUser() both succeeding moments
// later), but this screen's own single, un-retried getSession() call had
// already concluded "anon" and shown the sign-in page. Same class of
// transient Supabase-edge hiccup already diagnosed and fixed three times
// elsewhere in this app (MainScreen.tsx's load retry, 2026-08-18; the
// attachments upload auth-check retry, 2026-09-20) — this was the one
// remaining un-retried "is there a session" check, and it happens to gate
// the single highest-stakes decision in the app (whole-app landing-page-
// vs-signed-in-view). Only retries when a stored session actually exists
// (hasStoredSupabaseSession) — a genuinely new, never-signed-in visitor
// has no token to find, and shouldn't pay a multi-second delay before
// seeing the landing page just because this same code path also has to
// cover the "has a token but getSession() flaked" case.
function hasStoredSupabaseSession(): boolean {
  if (typeof window === 'undefined') return false
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key && key.startsWith('sb-') && key.includes('auth-token')) return true
  }
  return false
}

// Real, structural gap found and fixed 2026-11-22 — owner-reported:
// signing in with the numeric sign-in code (rather than clicking the
// emailed link) for a genuinely brand-new account landed straight on Main
// Screen, completely skipping Create Free Account (and, as a direct
// consequence, the new one-time Welcome dialog, 2026-11-21) — even though
// profiles.display_name was confirmed still null via a direct SQL check.
// Root cause: app/auth/callback/page.tsx is the ONLY place that ever
// checked profiles.display_name before deciding whether to route to '/'
// or '/account/new' — but that route is only ever reached by the emailed
// magic-link flow (its emailRedirectTo target). The code-entry flow
// (app/login/page.tsx's handleVerifyCode, built 2026-09-29 for the iOS-
// standalone-icon case but usable from any browser) calls
// `router.replace('/')` directly, never touching /auth/callback at all —
// and this component's own routing below only ever asked "is there a
// session," never "is this account's profile actually complete," so ANY
// authenticated session rendered MainScreen regardless. The same gap also
// applied to the cross-tab onAuthStateChange broadcast (2026-08-18) and to
// /login/page.tsx's own "someone already signed in has no business on
// this screen" redirect (line ~175, also a bare router.replace('/')) —
// every path that lands a session on `/` had the same hole. Fixed by
// making the profile-completeness check this screen's own responsibility,
// via resolveAuthedState() below, so it's enforced exactly once,
// regardless of which of those paths produced the session — rather than
// trying to patch each call site that might ever do `router.replace('/')`.
function parseAuthError(): string | null {
  if (typeof window === 'undefined' || !window.location.hash.includes('error=')) return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const errorCode = params.get('error_code')
  const description = params.get('error_description')
  if (errorCode === 'otp_expired') {
    return 'Your sign-in link has expired or was already used. Please request a new one below.'
  }
  if (description) return description.replace(/\+/g, ' ')
  return 'Something went wrong signing you in. Please try again below.'
}

export default function Home() {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>('checking')
  const [authError] = useState<string | null>(parseAuthError)

  useEffect(() => {
    if (authError && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [authError])

  useEffect(() => {
    let cancelled = false

    // The one place that decides a real session is actually ready to see
    // Main Screen — see this file's own header comment for why this has
    // to live here rather than in whichever flow happened to produce the
    // session. A profile with no display_name yet means Create Free
    // Account was never completed, same test app/auth/callback/page.tsx
    // already makes; redirecting there (not rendering anything here first)
    // keeps a half-set-up account from ever flashing Main Screen.
    async function resolveAuthedState(userId: string) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single()
      if (cancelled) return
      if (!profile?.display_name) {
        router.replace('/account/new')
        return
      }
      setStatus('authed')
    }

    async function checkSession() {
      const delaysMs = hasStoredSupabaseSession() ? [0, 600, 1600] : [0]
      for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          await resolveAuthedState(data.session.user.id)
          return
        }
        if (i === delaysMs.length - 1) {
          setStatus('anon')
        }
      }
    }

    checkSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (session) {
        resolveAuthedState(session.user.id)
      } else {
        setStatus('anon')
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [router])

  if (status === 'checking') return <div>Loading…</div>
  if (status === 'authed') return <MainScreen />
  return <LandingPage errorMessage={authError} />
}
