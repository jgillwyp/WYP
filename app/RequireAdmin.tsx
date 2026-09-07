'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

// Gates the /admin/stats/* screens on profiles.is_admin (migration 053).
// Mirrors RequireAuth.tsx's own shape exactly: getSession() for the same
// transient-network-hiccup reason documented there, an onAuthStateChange
// subscription for the same cross-tab sign-out case, and the same
// disclaimer — this is UI-routing only, not the real security boundary.
// The real gate is each admin aggregate RPC re-checking is_admin itself
// server-side (see docs/WYP_Admin_Statistics_Plan.md); a non-admin who
// somehow lands on one of these screens gets bounced here, but even if
// they didn't, the RPCs would refuse them regardless.
//
// Redirects to '/' (not '/login') for a signed-in-but-not-admin account —
// unlike RequireAuth's "you're not signed in at all" case, this person has
// a real account and a real destination to land on.
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      setLoading(true)
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        router.replace('/login')
        return
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', sessionData.session.user.id)
        .single()

      if (cancelled) return

      if (error || !profile?.is_admin) {
        router.replace('/')
        return
      }
      setLoading(false)
    }
    check()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
