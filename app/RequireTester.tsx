'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

// Gates a screen on can_toggle_tier() (migration 035's tier_toggle_allowlist)
// rather than profiles.is_admin. Built 2026-11-09 when "Test Stripe Payments"
// moved onto the Private Tester menu (Jim: "if testers wanted to use it they
// could do so") — that screen (AdminTestStripeForm.tsx) was previously
// RequireAdmin-only, which happened to work for Jim's own account (seeded
// into tier_toggle_allowlist, migration 035, so the owner could still test
// Attachments/tier features while "Subscribed?" is itself testing-gated) but
// would refuse every other real private tester outright.
//
// Mirrors RequireAdmin.tsx's own shape exactly, substituting the RPC
// checked — same disclaimer applies: this is UI-routing only, not the real
// security boundary. Every server-side route this screen's Sign Up/Cancel/
// Buy Add'l buttons call (create-checkout-session/route.ts, etc.) already
// re-checks can_toggle_tier() itself where that matters, so a non-tester who
// somehow bypassed this redirect would still be refused there.
//
// Redirects to '/' (not '/login') for a signed-in-but-not-eligible account —
// unlike RequireAuth's "you're not signed in at all" case, this person has a
// real account and a real destination to land on.
export default function RequireTester({ children }: { children: React.ReactNode }) {
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

      const { data: canToggle, error } = await supabase.rpc('can_toggle_tier')

      if (cancelled) return

      if (error || !canToggle) {
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
