'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

// Forward a Supabase auth-failure hash to the landing page (2026-08-27) —
// owner-reported: a used/already-consumed magic link ("sending took longer
// than usual and I got 2 emails... the second brought me back to the
// landing page") landed on a bare landing page with no explanation, even
// though app/page.tsx's own parseAuthError() (2026-08-18) already knows how
// to turn a "#error=..." hash into a friendly message. That fix only ever
// fires if the failure hash actually reaches `/` — the 2026-08-18 write-up's
// own example showed Supabase's project-level Site URL as the failure
// redirect target (a "...vercel.app/#error=..." address bar), but Supabase
// does not always honor that consistently over emailRedirectTo (this route)
// for every failure type — an already-used/expired token can land here
// instead, and until now this route had zero awareness of an error hash: it
// only ever checked getSession() and, finding none, silently sent the
// visitor to /login with the failure reason dropped on the floor. Checking
// the hash first, before ever calling getSession(), and forwarding it to `/`
// (unchanged, verbatim) closes that gap regardless of which of the two
// targets Supabase actually used this time.
function hasAuthErrorHash(): boolean {
  return typeof window !== 'undefined' && window.location.hash.includes('error=')
}

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    if (hasAuthErrorHash()) {
      router.replace(`/${window.location.hash}`)
      return
    }

    ;(async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('getSession error:', error)
        router.replace('/login')
        return
      }

      if (!data.session) {
        router.replace('/login')
        return
      }

      // First-run redirect (2026-08-11, owner decision) — completes the
      // design the Week 1 schema comment on profiles.display_name already
      // described: "NULL means account setup is incomplete, which is how
      // /auth/callback decides whether to route to Create my Free Account."
      // The profiles row itself always exists by this point (handle_new_user
      // trigger creates it the moment signInWithOtp creates the auth.users
      // row), so a missing row here is treated the same as an incomplete one
      // rather than as a separate error state.
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', data.session.user.id)
        .single()

      router.replace(profile?.display_name ? '/' : '/account/new')
    })()
  }, [router])

  return <div>Signing you in…</div>
}