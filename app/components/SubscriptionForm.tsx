'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { BecomeSubscriberPitch, MySubscriptionSummary } from './SubscriptionPanels'

/**
 * "See Subscription Features and Other Options" — the full-page click-
 * through screen (2026-08-26, Jim's own five mockups + design proposal
 * confirmed the same day). Reached from a link at the bottom of Account
 * Options (per Jim's own placement instruction — "the banner already shows
 * on the bottom of the page when viewing the Housekeeping [Account Options]
 * part of the main screen"), and from the same wording wherever else it
 * already appears (e.g. Response Detail/Request Response's own upsell,
 * unaffected by this batch).
 *
 * Fully dynamic — see SubscriptionPanels.tsx's own header comment for why
 * there's no separate "preview" caption. The testing-only "Subscribed?"
 * checkbox (only rendered for canToggleTier accounts, same gate as Account
 * Options' own copy) sits at the top; everything below reacts live to the
 * real tier value, which the checkbox itself controls during testing.
 * Content is otherwise identical to Account Options' own embedded
 * Subscriber section, just full-page and with variant="full" (its own
 * "Become a Subscriber"/"My Subscription" heading, since there's no
 * .subcard header to supply one here).
 */
export default function SubscriptionForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [renewalDate, setRenewalDate] = useState<string | null>(null)
  const [storageGb, setStorageGb] = useState(5)
  const [canToggleTier, setCanToggleTier] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (cancelled) return

      if (userError || !userData.user) {
        setLoadError(userError?.message ?? 'Could not load your account.')
        setLoading(false)
        return
      }

      setUserId(userData.user.id)

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('tier, subscription_renewal_date, subscription_storage_gb')
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

      // can_toggle_tier() (migration 035) — same "failure reads as not
      // allowed" posture as AccountForm.tsx's own copy of this check.
      const { data: canToggle } = await supabase.rpc('can_toggle_tier')
      if (!cancelled) setCanToggleTier(canToggle === true)

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Same shape as AccountForm.tsx's own handleTierToggle — goes through
  // set_tier_for_testing() (migration 035/047), never a raw table update.
  // Migration 047 also sets subscription_renewal_date server-side whenever
  // the transition is to 'subscriber', so this re-reads the fresh row
  // afterward rather than guessing the new date client-side.
  async function handleTierToggle(next: boolean) {
    if (!userId) return
    const nextTier: 'free' | 'subscriber' = next ? 'subscriber' : 'free'
    setTier(nextTier)
    setSaving(true)
    setSaveError(null)

    const { error: updateError } = await supabase.rpc('set_tier_for_testing', { p_tier: nextTier })

    if (updateError) {
      setTier(next ? 'free' : 'subscriber')
      setSaveError(updateError.message)
      setSaving(false)
      return
    }

    const { data } = await supabase
      .from('profiles')
      .select('subscription_renewal_date, subscription_storage_gb')
      .eq('id', userId)
      .single()

    setRenewalDate(data?.subscription_renewal_date ?? null)
    setStorageGb(data?.subscription_storage_gb ?? 5)
    setSaving(false)
  }

  function handleClose() {
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
          <span className="glabel">{tier === 'subscriber' ? 'My Subscription' : 'Become a Subscriber'}</span>
          <button className="btn" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          {canToggleTier && (
            <label className="checkrow" style={{ margin: '4px var(--pad) 14px' }}>
              <input
                type="checkbox"
                checked={tier === 'subscriber'}
                disabled={saving}
                onChange={(e) => handleTierToggle(e.target.checked)}
              />
              <span className="checktext">
                Subscribed? (testing only)
                <span className="checknote">
                  Sets your account to the Subscriber tier so subscriber-only features
                  like Attachments can be tested. This status only lasts for the
                  testing period — once testing ends, this checkbox goes away and you
                  would subscribe for real, through the button below. Off by default.
                </span>
              </span>
            </label>
          )}

          {tier === 'subscriber' ? (
            <MySubscriptionSummary variant="full" renewalDate={renewalDate} storageGb={storageGb} />
          ) : (
            <BecomeSubscriberPitch variant="full" />
          )}

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
