'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
// import { supabase } from './src/lib/supabaseClient'
import { supabase } from '@/lib/supabaseClient'

// getSession(), not getUser() — bug fix, 2026-08-13, same root cause as
// app/page.tsx's own fix (see that file's comment for the full owner
// report). getUser() is a live round-trip to Supabase's Auth server; this
// code was treating any failure of that call — including a transient
// network hiccup right after the browser reopens — as "not signed in" and
// bouncing to /login. getSession() reads the already-initialized/refreshed
// local session instead, matching app/login/page.tsx's own existing
// already-signed-in check. UI-routing only, not a security boundary — the
// real access control is Supabase's RLS/JWT verification on every actual
// data call, unaffected by which check picks the screen to render.
//
// onAuthStateChange subscription (2026-08-18) — same cross-window fix as
// app/page.tsx (see that file's comment for the full write-up). Here it
// matters for the opposite transition: if a sign-out happens in another
// tab/window of the same origin while this screen is still mounted, redirect
// immediately instead of leaving a screen with no valid session on it until
// the next navigation happens to remount this component.
//
// Retry-with-backoff (2026-09-22, owner-reported — iPhone Chrome) — same
// fix, same reasoning, as app/page.tsx's own identical addition: a live-
// tested bug where a completely valid, unexpired session sat in
// localStorage the whole time, but this component's single, un-retried
// getSession() call had already bounced to /login. Every authenticated
// route in the app goes through this component, so this was the more
// consequential of the two — see app/page.tsx's own comment for the full
// write-up, including why the retry is skipped entirely when there's no
// stored session at all (hasStoredSupabaseSession) rather than adding
// delay to a genuinely signed-out visitor's redirect.
function hasStoredSupabaseSession(): boolean {
  if (typeof window === 'undefined') return false
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key && key.startsWith('sb-') && key.includes('auth-token')) return true
  }
  return false
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      setLoading(true)
      const delaysMs = hasStoredSupabaseSession() ? [0, 600, 1600] : [0]
      for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          setLoading(false)
          return
        }
        if (i === delaysMs.length - 1) {
          router.replace('/login')
        }
      }
    }
    check()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (!session) {
        router.replace('/login')
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [router])

  if (loading) return <div>Loading…</div>
  return <>{children}</>
}