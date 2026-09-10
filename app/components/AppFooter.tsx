'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabaseClient'

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

  useEffect(() => {
    if (providedTier !== undefined) {
      return
    }

    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
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
          Subscription Features and Options
        </button>
        <button className="btn-secondary" type="button" onClick={() => router.push('/privacy')}>
          Privacy
        </button>
      </div>
      <p className="subcopyright">
        {`© ${new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
        }).format(new Date())} Would You Please, Inc. All rights reserved.`}
      </p>
      {tier === 'free' && (
        <div className="adslot" aria-hidden="true">
          <span className="adbox">AD — 320×50 RESERVED</span>
        </div>
      )}
    </footer>
  )
}
