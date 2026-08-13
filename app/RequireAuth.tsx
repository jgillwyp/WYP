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
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function check() {
      setLoading(true)
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace('/login')
        return
      }
      setLoading(false)
    }
    check()
  }, [router])

  if (loading) return <div>Loading…</div>
  return <>{children}</>
}