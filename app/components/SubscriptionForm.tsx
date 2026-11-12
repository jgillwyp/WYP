'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'
import { AccountStatusSection } from './SubscriptionPanels'

/**
 * Account Status — the full-page click-through screen (2026-08-26, Jim's own
 * five mockups + design proposal confirmed the same day). Reached from a
 * link at the bottom of Account Options (per Jim's own placement
 * instruction — "the banner already shows on the bottom of the page when
 * viewing the Housekeeping [Account Options] part of the main screen"), and
 * from the same wording wherever else it already appears (e.g. Response
 * Detail/Request Response's own upsell, unaffected by this batch).
 *
 * Renamed from "My Subscription"/"Become a Subscriber" to a single, static
 * "Account Status" band title, 2026-11-06 — Jim: "I renamed the page/
 * section 'Account Status' instead of 'Subscriber' (since all users of that
 * page are not subscribers) and redesigned it to be three pages, one for
 * testers which does not offer the Stripe payment option... one for Free
 * Accounts, and one for Subscribers." Content is identical to Account
 * Options' own embedded Account Status section — both call sites now render
 * through the one shared AccountStatusSection (SubscriptionPanels.tsx),
 * which picks the state (is_beta_tester() first, then real tier) and owns
 * all three presentations. The self-toggle "Subscribed?" checkbox and Test
 * Storage Cap field (previously this screen's own checkbox with no Test
 * Storage Cap at all — a pre-existing asymmetry with Account Options' own
 * embedded section) are both supplied here now, closing that gap so the
 * Private Tester state looks and behaves identically on both call sites.
 */
export default function SubscriptionForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [renewalDate, setRenewalDate] = useState<string | null>(null)
  const [storageGb, setStorageGb] = useState(5)
  // profiles.stripe_cancel_at_period_end -- same as AccountForm.tsx's own
  // copy (2026-11-11), drives SubscriberStatus's Cancel-vs-Renew wording.
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  // profiles.stripe_subscription_id != null — same as AccountForm.tsx's own
  // copy (2026-11-11 Account Status merge); see that file's own comment.
  const [hasRealSubscription, setHasRealSubscription] = useState(false)
  const [canToggleTier, setCanToggleTier] = useState(false)
  const [isTester, setIsTester] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Test Storage Cap (migration 051) — same shape as AccountForm.tsx's own
  // copy. storageOverrideBytes is what's actually saved (null = no
  // override); storageOverrideInput is the free-typed MB text, kept
  // separate so a not-yet-saved edit doesn't fight the loaded value.
  const [storageOverrideBytes, setStorageOverrideBytes] = useState<number | null>(null)
  const [storageOverrideInput, setStorageOverrideInput] = useState('')
  const [storageOverrideSaving, setStorageOverrideSaving] = useState(false)
  const [storageOverrideError, setStorageOverrideError] = useState<string | null>(null)

  // Stripe Checkout/Billing Portal both redirect back here with
  // ?checkout=success|cancelled (create-checkout-session/create-portal-
  // session route.ts's own success_url/cancel_url/return_url). Read via
  // window.location.search directly rather than useSearchParams(), same
  // precedent AddContactForm.tsx's own ?from=create-request already
  // established — safe here because this redirect is a real top-level
  // browser navigation (Stripe's hosted page sending the browser back),
  // never a same-instance client-router reuse, so there's no staleness
  // risk the way /login's own ?intent=signup once had.
  const [checkoutStatus] = useState<'success' | 'cancelled' | null>(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const value = params.get('checkout')
    return value === 'success' || value === 'cancelled' ? value : null
  })

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

      setUserId(userData.user.id)

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select(
          'tier, subscription_renewal_date, subscription_storage_gb, storage_limit_override_bytes, stripe_cancel_at_period_end, stripe_subscription_id'
        )
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
      setHasRealSubscription(data?.stripe_subscription_id != null)
      const overrideBytes = data?.storage_limit_override_bytes ?? null
      setStorageOverrideBytes(overrideBytes)
      setStorageOverrideInput(
        overrideBytes != null ? String(Math.round((overrideBytes / (1024 * 1024)) * 100) / 100) : ''
      )

      // can_toggle_tier() (migration 035) — same "failure reads as not
      // allowed" posture as AccountForm.tsx's own copy of this check.
      const { data: canToggle } = await supabase.rpc('can_toggle_tier')
      if (!cancelled) setCanToggleTier(canToggle === true)

      // is_beta_tester() (migration 088) — now also decides whether this
      // screen shows the Private Tester state at all (2026-11-06), not just
      // the $19-vs-$39 1st-year price.
      const { data: tester } = await supabase.rpc('is_beta_tester')
      if (!cancelled) setIsTester(tester === true)

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (checkoutStatus) {
      router.replace('/account/subscription')
    }
    // Strip the ?checkout= query string once, right after reading it —
    // deliberately excludes checkoutStatus/router from deps so this never
    // re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Same shape as AccountForm.tsx's own handleTierToggle — goes through
  // set_tier_for_testing() (migration 035/047) or /api/stripe/testing-
  // downgrade, never a raw table update. Migration 047 also sets
  // subscription_renewal_date server-side whenever the transition is to
  // 'subscriber', so this re-reads the fresh row afterward rather than
  // guessing the new date client-side.
  async function handleTierToggle(next: boolean) {
    if (!userId) return
    setSaving(true)
    setSaveError(null)

    if (!next) {
      // Unchecking — goes through /api/stripe/testing-downgrade, not the
      // plain RPC, so any real Stripe subscription(s) this testing account
      // picked up along the way get canceled too, and storage resets to the
      // base 5 GB. See that route's own header comment.
      setTier('free')
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setTier('subscriber')
        setSaveError('Your sign-in has expired — please sign in again and retry.')
        setSaving(false)
        return
      }
      let res: Response
      try {
        res = await fetch('/api/stripe/testing-downgrade', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        setTier('subscriber')
        setSaveError('Could not reach the server — check your connection and try again.')
        setSaving(false)
        return
      }
      let json: { ok?: boolean; detail?: string; error?: string } = {}
      try {
        json = await res.json()
      } catch {
        json = {}
      }
      if (!res.ok || !json.ok) {
        setTier('subscriber')
        setSaveError(json.detail ?? 'Something went wrong — please try again.')
        setSaving(false)
        return
      }
      setRenewalDate(null)
      setStorageGb(5)
      setHasRealSubscription(false)
      setSaving(false)
      return
    }

    // Checking — purely local testing state, no Stripe involved.
    setTier('subscriber')

    const { error: updateError } = await supabase.rpc('set_tier_for_testing', { p_tier: 'subscriber' })

    if (updateError) {
      setTier('free')
      setSaveError(updateError.message)
      setSaving(false)
      return
    }

    const { data } = await supabase
      .from('profiles')
      .select('subscription_renewal_date, subscription_storage_gb, stripe_cancel_at_period_end')
      .eq('id', userId)
      .single()

    setRenewalDate(data?.subscription_renewal_date ?? null)
    setStorageGb(data?.subscription_storage_gb ?? 5)
    setCancelAtPeriodEnd(data?.stripe_cancel_at_period_end ?? false)
    setSaving(false)
  }

  // Test Storage Cap (migration 051) — same shape as AccountForm.tsx's own
  // copy: goes through the gated set_storage_limit_override() RPC, never a
  // raw table update (there is no direct grant to write this column).
  async function handleSaveStorageOverride() {
    if (!userId) return
    const mb = parseFloat(storageOverrideInput)
    if (!Number.isFinite(mb) || mb < 0) {
      setStorageOverrideError('Enter a number of MB, 0 or greater.')
      return
    }
    const bytes = Math.round(mb * 1024 * 1024)
    setStorageOverrideSaving(true)
    setStorageOverrideError(null)

    const { error: rpcError } = await supabase.rpc('set_storage_limit_override', { p_bytes: bytes })

    setStorageOverrideSaving(false)
    if (rpcError) {
      setStorageOverrideError(rpcError.message)
      return
    }
    setStorageOverrideBytes(bytes)
  }

  async function handleClearStorageOverride() {
    if (!userId) return
    // See AccountForm.tsx's own identical handler for the full reasoning
    // (2026-11-11) — reset the field immediately, only hit the server when
    // there's a real saved override to clear.
    setStorageOverrideInput('')
    setStorageOverrideError(null)
    if (storageOverrideBytes === null) return
    setStorageOverrideSaving(true)

    const { error: rpcError } = await supabase.rpc('set_storage_limit_override', { p_bytes: null })

    setStorageOverrideSaving(false)
    if (rpcError) {
      setStorageOverrideError(rpcError.message)
      return
    }
    setStorageOverrideBytes(null)
  }

  function handleClose() {
    // A Stripe redirect (Checkout or the Billing Portal) is a real top-level
    // browser navigation, not an in-app one — it breaks the history
    // continuity router.back() normally relies on. Jim-reported, 2026-11-05:
    // got stuck unable to leave this screen, landing back on a blank or
    // timed-out Stripe page instead of the app. checkoutStatus is captured
    // once at mount, before router.replace() strips the query string below,
    // so it stays a reliable signal for "did we just arrive from Stripe" for
    // this component's whole lifetime.
    if (checkoutStatus) {
      router.push('/')
      return
    }
    router.back()
  }

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">Loading…</div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Account Status</span>
          <button className="btn" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          {checkoutStatus === 'success' && (
            <div className="noticeband" style={{ margin: '4px var(--pad) 14px' }}>
              Thanks — your payment was received. This can take a few seconds to show
              below; refresh if it still shows Free after a moment.
            </div>
          )}
          {checkoutStatus === 'cancelled' && (
            <div className="noticeband" style={{ margin: '4px var(--pad) 14px' }}>
              Checkout was cancelled — nothing was charged.
            </div>
          )}

          {/* AccountStatusSection itself carries no horizontal padding
              (2026-11-07) — Account Options' own embedded call site already
              gets it from .subbody, so this screen (no such wrapper, direct
              child of .scroll, same shell as Admin > Test Stripe Payments)
              supplies it here instead. */}
          <div style={{ padding: '0 var(--pad)' }}>
            <AccountStatusSection
              tier={tier}
              isBetaTester={isTester}
              canToggleTier={canToggleTier}
              hasRealSubscription={hasRealSubscription}
              renewalDate={renewalDate}
              storageGb={storageGb}
              onStorageUpdated={setStorageGb}
              cancelAtPeriodEnd={cancelAtPeriodEnd}
              onRenewed={() => setCancelAtPeriodEnd(false)}
              saving={saving}
              onTierToggle={handleTierToggle}
              storageOverrideBytes={storageOverrideBytes}
              storageOverrideInput={storageOverrideInput}
              storageOverrideSaving={storageOverrideSaving}
              storageOverrideError={storageOverrideError}
              onStorageOverrideInputChange={setStorageOverrideInput}
              onSaveStorageOverride={handleSaveStorageOverride}
              onClearStorageOverride={handleClearStorageOverride}
              returnPath="/account/subscription"
            />
          </div>

          {saveError && (
            <p className="ferror" role="alert" style={{ margin: '10px var(--pad) 0' }}>
              {saveError}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
