'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase, getCurrentUser } from '@/lib/supabaseClient'

type Tier = 'free' | 'subscriber'

export default function AppFooter({
  tier: providedTier,
  subscriptionDisabled = false,
}: {
  // `null` (2026-11-10) is distinct from omitting the prop entirely: it
  // means "a caller that fetches its own tier, but hasn't resolved it yet"
  // — skips this component's own self-fetch (same as a real value would)
  // while still rendering as "unknown" (ad hidden) rather than guessing
  // 'free'. Owner-reported: several Create/Main screens defaulted their own
  // local tier state to 'free' before their real fetch resolved and passed
  // that default straight through, so a genuine Subscriber briefly saw the
  // ad flash on every open. No internal logic change needed here — `tier =
  // providedTier ?? loadedTier` already collapses null the same way
  // undefined would (loadedTier's own initializer runs the identical `??`
  // once at mount), so this is a type-only widening to let a caller pass
  // null while its own fetch is still in flight.
  tier?: Tier | null
  subscriptionDisabled?: boolean
}) {
  const router = useRouter()
  const [loadedTier, setLoadedTier] = useState<Tier | null>(providedTier ?? null)

  useEffect(() => {
    if (providedTier !== undefined) {
      return
    }

    let cancelled = false
    getCurrentUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', data.user.id)
        .single()
      if (!cancelled) {
        setLoadedTier(profile?.tier === 'subscriber' ? 'subscriber' : 'free')
      }
    })

    return () => {
      cancelled = true
    }
  }, [providedTier])

  const tier = providedTier ?? loadedTier

  return (
    <footer className="app-footer">
      <div className="subbanner-row">
        <button
          className="btn-secondary"
          type="button"
          disabled={subscriptionDisabled}
          aria-disabled={subscriptionDisabled}
          onClick={() => router.push('/account/subscription')}
        >
          Subscription Features
        </button>
        <button className="btn-secondary" type="button" onClick={() => router.push('/privacy')}>
          Terms and Privacy Policy
        </button>
      </div>
      <p className="subcopyright">
        {`© ${new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
        }).format(new Date())} Would You Please, Inc. All rights reserved.`}
      </p>
      {/* Simplified 2026-11-10 — was is_beta_tester()-gated (colored preview
          for a registered tester, plain "AD — 320×50 RESERVED" placeholder
          for anyone else), built 2026-11-06. Jim: "simplify now" — during
          private testing essentially every real account is a tester in
          spirit even when it isn't in beta_allowlist specifically (e.g. an
          account set up before that list existed), so every Free account
          sees the explanatory preview for now. The plain .adbox placeholder
          CSS is left in globals.css, unreferenced here, for when the real
          tester/public distinction is worth reinstating closer to actual
          launch — see CLAUDE.md's own history for the exact prior
          is_beta_tester() branch to restore. */}
      {tier === 'free' && (
        <div className="adslot adslot-preview" aria-hidden="true">
          <span className="adbox-preview">For Free Accounts, ads will appear in this location.</span>
        </div>
      )}
    </footer>
  )
}
