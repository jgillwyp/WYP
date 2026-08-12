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
export default function Home() {
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>('checking')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      setStatus(data.user ? 'authed' : 'anon')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'checking') return <div>Loading…</div>
  if (status === 'authed') return <MainScreen />
  return <LandingPage />
}
