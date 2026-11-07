'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase, getCurrentUser } from '@/lib/supabaseClient'

type Tier = 'free' | 'subscriber'

export default function AppFooter({
  tier: providedTier,
  subscriptionDisabled = false,
}: {
  tier?: Tier
  subscriptionDisabled?: boolean
}) {
  const router = useRouter()
  const [loadedTier, setLoadedTier] = useState<Tier | null>(providedTier ?? null)
  // is_beta_tester() (2026-11-06) — Jim: "I would like to see a mock ad
  // presented when a tester is working with a free account version." Only
  // fetched when it matters (tier resolves to 'free' — the ad slot renders
  // at all), so a real subscriber or a non-tester account never pays for
  // this extra round trip.
  const [isBetaTester, setIsBetaTester] = useState(false)

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

  useEffect(() => {
    if (tier !== 'free') return
    let cancelled = false
    supabase.rpc('is_beta_tester').then(({ data }) => {
      if (!cancelled) setIsBetaTester(data === true)
    })
    return () => {
      cancelled = true
    }
  }, [tier])

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
      {tier === 'free' && (
        <div className={`adslot${isBetaTester ? ' adslot-preview' : ''}`} aria-hidden="true">
          {isBetaTester ? (
            <span className="adbox-preview">
              This is where product advertisements will appear for Free Accounts after Would You
              Please private testing is completed.
            </span>
          ) : (
            <span className="adbox">AD — 320×50 RESERVED</span>
          )}
        </div>
      )}
    </footer>
  )
}
