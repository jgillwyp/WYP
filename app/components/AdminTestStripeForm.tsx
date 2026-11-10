'use client'

// Test Stripe Payments (2026-11-06, Admin tab) — lets an admin click through
// the real Free/Subscriber Account Status panels — and their real Stripe
// calls — against their own account, even though an admin is also a
// Private Tester (and so would otherwise always see the informational-only
// Private Tester state, which has no live Stripe control on it at all —
// that's the whole point of the redesign this screen exists to test around).
//
// Jim's own ask: "That leaves the need to have a path to testing Stripe
// while in a Private Testing mode. So, my suggestion is to add a 'Test
// Stripe Payments' menu choice to the Admin menu... It would present the
// Free Account or Subscriber Account Status page based on the currently
// checked or unchecked 'Account Status: Product Tester' page. The results
// of the Stripe interaction should be written back to the Product/Private
// Tester page."
//
// No separate write-back plumbing needed: this renders AccountStatusSection
// with forceRealVariant, which only skips the "show the Private Tester
// state" branch — everything else (tier, renewal date, storage) is read
// from and written straight to the SAME profiles row the ordinary Private
// Tester state itself reads. A real Sign Up here is simply the account's
// real tier the next time the ordinary Account Status screens are opened —
// the self-toggle checkbox there already tracks tier === 'subscriber'
// regardless of how it got set.
//
// Stripe's own success/cancel redirect targets (create-checkout-session/
// create-portal-session route.ts) are unchanged and still hardcoded to
// /account/subscription, not back to this Admin screen — landing on the
// ordinary Account Status page afterward, now showing the real result, is
// exactly "written back to the Private Tester page" taken literally.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'
import { AccountStatusSection } from './SubscriptionPanels'

// RequireTester-wrapped at the page level (app/admin/stripe-test/page.tsx) —
// changed from RequireAdmin, 2026-11-09, once this screen also became
// reachable from the Private Tester menu (MainScreen.tsx), not just the
// Admin tab. Not wrapped here.
export default function AdminTestStripeForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [renewalDate, setRenewalDate] = useState<string | null>(null)
  const [storageGb, setStorageGb] = useState(5)
  // profiles.stripe_cancel_at_period_end -- same as AccountForm.tsx's own
  // copy (2026-11-11), drives SubscriberStatus's Cancel-vs-Renew wording.
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [isTester, setIsTester] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: userData, error: userError } = await getCurrentUser()
      if (cancelled) return

      if (userError || !userData.user) {
        setLoadError(userError?.message ?? 'Could not load your account.')
        setLoading(false)
        return
      }

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('tier, subscription_renewal_date, subscription_storage_gb, stripe_cancel_at_period_end')
        .eq('id', userData.user.id)
        .single()

      if (cancelled) return

      if (fetchError) {
        setLoadError(fetchError.message)
        setLoading(false)
        return
      }

      setTier((data?.tier as 'free' | 'subscriber') ?? 'free')
      setRenewalDate(data?.subscription_renewal_date ?? null)
      setStorageGb(data?.subscription_storage_gb ?? 5)
      setCancelAtPeriodEnd(data?.stripe_cancel_at_period_end ?? false)

      // is_beta_tester() — still read here even though forceRealVariant
      // skips the Private Tester state entirely: a real admin is almost
      // always also a tester, and Sign Up's own real price (create-
      // checkout-session/route.ts) is decided server-side from this exact
      // same check, so showing the real $19 rate here (rather than always
      // $39) keeps the preview honest about what will actually be charged.
      const { data: tester } = await supabase.rpc('is_beta_tester')
      if (!cancelled) setIsTester(tester === true)

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  function handleClose() {
    router.back()
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Test Stripe Payments</span>
          <button className="btn" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          {loading ? (
            <div className="subempty">Loading…</div>
          ) : loadError ? (
            <div className="subempty">{loadError}</div>
          ) : (
            <>
              {/* .testernote (2026-11-10) — Jim's own request: a deliberately
                  off-brand look for this to-tester explanation, "clearly-
                  not-part-of-WYP," plus his own rewritten wording (now
                  including the 4242... test-card details, which the prior
                  .noticeband copy never stated). See globals.css's own
                  comment at .testernote for the visual reasoning. */}
              <div className="testernote" style={{ margin: '4px var(--pad) 14px' }}>
                <b>What you see below this paragraph</b>{' '}
                is a real Free/Subscriber page
                including the &ldquo;My Status&rdquo;. It is responsive to how you may have
                checked or unchecked the Private Tester Subscription status under Account
                Options. Your actions here with Stripe updates your account status, storage
                capacity, and renewal date. A test-only credit card id of 4242 4242 4242 4242
                with any future renewal date and 3 digit CVC code can be used. You can see the
                results in Account Options.
              </div>
              {/* AccountStatusSection itself carries no horizontal padding
                  (2026-11-07) — this screen, like /account/subscription,
                  renders it directly in .scroll with no .subbody wrapper of
                  its own, so it supplies the padding here instead. */}
              <div style={{ padding: '0 var(--pad)' }}>
                <AccountStatusSection
                  tier={tier}
                  isBetaTester={isTester}
                  renewalDate={renewalDate}
                  storageGb={storageGb}
                  onStorageUpdated={setStorageGb}
                  cancelAtPeriodEnd={cancelAtPeriodEnd}
                  onRenewed={() => setCancelAtPeriodEnd(false)}
                  forceRealVariant
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
