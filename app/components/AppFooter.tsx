'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

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

  // Impression tracking (2026-11-15, migration 097) — one log_ad_event()
  // call per real mount where the ad actually renders. AppFooter mounts
  // fresh on almost every screen navigation (it isn't persisted across
  // routes), so this naturally logs one impression per screen view that
  // shows the ad — the ordinary meaning of "impression." loggedRef guards
  // against a second call from React re-running this effect (e.g. Strict
  // Mode's dev-only double-invoke) without actually unmounting first; the
  // RPC call itself is fire-and-forget — a failed/slow log must never
  // affect what's on screen, but a failure is now at least visible in the
  // console (2026-11-17, owner-reported: real impressions/clicks as a
  // Free user, zero rows in Admin > Ad Activity — this call had no error
  // handling at all before, so a failure here would have been completely
  // silent, with nothing to confirm or rule it out).
  const loggedImpressionRef = useRef(false)
  useEffect(() => {
    if (tier !== 'free' || loggedImpressionRef.current) return
    loggedImpressionRef.current = true
    supabase.rpc('log_ad_event', { p_kind: 'impression' }).then(({ error }) => {
      if (error) console.error('log_ad_event(impression) failed:', error)
    })
  }, [tier])

  function handleAdClick() {
    supabase.rpc('log_ad_event', { p_kind: 'click' }).then(({ error }) => {
      if (error) console.error('log_ad_event(click) failed:', error)
    })
  }

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
      {/* Real, accurately-sized sample ad (2026-11-15) — supersedes the
          auto-height "ads will appear in this location" explanatory banner
          (built 2026-11-06, simplified 2026-11-10) as what every Free
          account now sees here. Jim: "The app should accurately represent
          the intended size in live use - for the ads... We should create a
          dummy landing page for an ad... and link the ad to that page."
          This is a genuine 320x50 (the IAB mobile-banner standard this slot
          was always sized for — see .adbox in globals.css) clickable
          creative, built from the two images Jim supplied: the circular,
          transparent-background crop as the ad's own icon
          (public/ads/sample-ad-icon.png), and a wider landscape photo as the
          hero on its destination, /ad-landing (public/ads/ad-landing-hero.jpg).
          "Sunset River Outfitters" is placeholder sample copy, not a real
          advertiser. The old .adslot-preview/.adbox-preview CSS (globals.css)
          is left in place, unreferenced, same precedent as the even older
          dashed "AD — 320×50 RESERVED" .adbox it itself superseded — all
          three keep the gated is_beta_tester()/public distinction easy to
          reinstate later if that ever matters again. There is still no real
          ad network behind this — one hardcoded creative, no bidding or
          rotation — but impression/click tracking is now real (2026-11-15,
          migration 097): every render of this block logs one 'impression'
          via log_ad_event() below, and the link itself logs a 'click' on
          the way out. See Admin > Ad Activity (admin_get_ad_activity()) for
          the resulting report. */}
      {tier === 'free' && (
        <div className="adslot">
          <Link
            href="/ad-landing"
            className="ad-live-link"
            aria-label="Advertisement — Sunset River Outfitters — opens a sample landing page"
            onClick={handleAdClick}
          >
            <span className="ad-live">
              <Image
                src="/ads/sample-ad-icon.png"
                alt=""
                width={40}
                height={40}
                className="ad-live-img"
              />
              <span className="ad-live-copy">
                <span className="ad-live-label">Ad</span>
                <span className="ad-live-title">Sunset River Outfitters</span>
                <span className="ad-live-sub">Guided trips &amp; gear rentals</span>
              </span>
            </span>
          </Link>
        </div>
      )}
    </footer>
  )
}
