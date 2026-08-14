'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Account (2026-08-13) — new, deliberately minimal. Every other time this
 * screen has come up (Housekeeping's "Account" row, Create Free Account's
 * own header comments) it's been left "intentionally undesigned pending
 * further product evolution" on the owner's own instruction. This is that
 * evolution, scoped to exactly one thing: owner — "In the interest of
 * keeping this app as simple as possible, I think the Private Category
 * should be an account option, not a standard presented data element...
 * A single option could control its availability for both Requests and
 * ToDos." Offered a choice between building this sliver of Account now vs.
 * adding the toggle to Housekeeping instead, the owner picked building
 * Account. Nothing else about Account (Name/Email/Phone/Time Zone/tier
 * display/Change Email — see the still-mockup-only
 * WYP_your_account_palette1_floating.html) is built here; this screen is
 * not a conversion of that mockup, just a new one-field screen reusing the
 * app's existing `.checkrow` component (§6.2, first used by "Keep me
 * signed in" on Sign In).
 *
 * profiles.private_category_enabled (migration 018) — off by default, any
 * account (free or subscriber) may turn it on; not a tier gate. Read once
 * on mount, written immediately on toggle (no separate Save step — a
 * single boolean has nothing worth staging), matching the immediacy of
 * this app's other one-click settings (e.g. the quick-Done bands) rather
 * than the multi-field Save/Cancel forms elsewhere in this app.
 *
 * profiles.request_time_enabled (migration 019) — originally defaulted to
 * true (Due Time/Done Time was pre-existing, already-relied-upon behavior,
 * so defaulting a brand-new column off would have silently hidden
 * already-set data). Owner: "As another account option, when turned off
 * the four-value two-line presentation of Due Date Due Time Done Date Done
 * Time on Requests would become like a ToDo one-line two-value
 * presentation of Due Date and Done Date." Scoped, per the owner's own
 * confirmation, to include recipient-facing screens (Request Response,
 * Response Detail) — those read the *issuer's* own setting via
 * owner_request_time_enabled (migrations 020/021), same "rights come from
 * the issuer" precedent as owner_tier/Attachments. Governs Requests only;
 * ToDos have never had a Due Time/Done Time field. **Default flipped to
 * false, migration 023, 2026-08-14** — this app has no real users other
 * than the owner yet, so the "don't hide existing data" concern no longer
 * applies; see that migration's own header for the full reasoning.
 *
 * profiles.todo_dates_enabled (migration 022, 2026-08-14) — off by
 * default, continuing the same "Keep It as Simple as Possible" path.
 * Owner: "please add another Account option related to ToDos... showing
 * the Status element as an Open or Done chip... it does not seem that any
 * database changes are needed [for Status itself]" — correct: Status is a
 * UI-only reinterpretation of the existing done_date column, not a new
 * fact to store. See CreateTodoForm.tsx/TodoDetailForm.tsx for the actual
 * Status chip gating.
 *
 * profiles.tier (migration 024, 2026-08-14, TESTING ONLY) — writable by
 * `authenticated` for the first time; migration 002 deliberately excluded
 * it from the owner's own column grant ("writable only by service_role,
 * the billing webhook, later"), specifically so no free user could grant
 * themselves subscriber features. Owner's own request explicitly frames
 * this control as temporary: "For the development and Attachments
 * testing, perhaps an Account 'Subscribed?' option is appropriate. Later,
 * this option would present differently and only able to be set by
 * opening a subscription page with appropriate eCommerce links..." — a
 * real "Subscription Details" flow is meant to replace this checkbox
 * outright, not extend it. Flagged, not silently reopened — see migration
 * 024's own header and CLAUDE.md's Known gaps.
 */
export default function AccountForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [categoriesEnabled, setCategoriesEnabled] = useState(false)
  // Default flipped to false, migration 023 — see the file-level comment.
  const [requestTimeEnabled, setRequestTimeEnabled] = useState(false)
  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)
  // Testing-only tier toggle (migration 024) — the DB column is text
  // ('free'/'subscriber'), not boolean, so it gets its own state and
  // handler rather than joining the shared boolean handleToggle below.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
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
        .select('private_category_enabled, request_time_enabled, todo_dates_enabled, tier')
        .eq('id', userData.user.id)
        .single()

      if (cancelled) return

      if (fetchError) {
        setLoadError(fetchError.message)
        setLoading(false)
        return
      }

      setCategoriesEnabled(data?.private_category_enabled ?? false)
      setRequestTimeEnabled(data?.request_time_enabled ?? false)
      setTodoDatesEnabled(data?.todo_dates_enabled ?? false)
      setTier((data?.tier as 'free' | 'subscriber') ?? 'free')
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(
    field: 'private_category_enabled' | 'request_time_enabled' | 'todo_dates_enabled',
    next: boolean,
    setLocal: (value: boolean) => void,
  ) {
    if (!userId) return
    setLocal(next)
    setSaving(true)
    setSaveError(null)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ [field]: next })
      .eq('id', userId)

    setSaving(false)

    if (updateError) {
      // Revert the optimistic flip — the toggle only reflects what's
      // actually saved, same reasoning as every other settings control in
      // this app that writes on change rather than on a separate Save.
      setLocal(!next)
      setSaveError(updateError.message)
    }
  }

  // Testing-only — see the file-level comment on migration 024. Same
  // optimistic-update-reverted-on-failure shape as handleToggle above, but
  // writes a text value ('free'/'subscriber') rather than a boolean.
  async function handleTierToggle(next: boolean) {
    if (!userId) return
    const nextTier: 'free' | 'subscriber' = next ? 'subscriber' : 'free'
    setTier(nextTier)
    setSaving(true)
    setSaveError(null)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ tier: nextTier })
      .eq('id', userId)

    setSaving(false)

    if (updateError) {
      setTier(next ? 'free' : 'subscriber')
      setSaveError(updateError.message)
    }
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
          <span className="glabel">Account</span>
          <button className="btn" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          <label className="checkrow">
            <input
              type="checkbox"
              checked={categoriesEnabled}
              disabled={saving}
              onChange={(e) =>
                handleToggle('private_category_enabled', e.target.checked, setCategoriesEnabled)
              }
            />
            <span className="checktext">
              Show Private Category
              <span className="checknote">
                Adds an optional Category field to Requests and ToDos, for your own
                private labeling (e.g. &ldquo;Personal Fin,&rdquo; &ldquo;Future Dev&rdquo;). Off by
                default to keep things simple — turn it on any time.
              </span>
            </span>
          </label>

          <label className="checkrow">
            <input
              type="checkbox"
              checked={requestTimeEnabled}
              disabled={saving}
              onChange={(e) =>
                handleToggle('request_time_enabled', e.target.checked, setRequestTimeEnabled)
              }
            />
            <span className="checktext">
              Show Due/Done Time (Requests)
              <span className="checknote">
                Adds a Due Time and Done Time next to a Request&rsquo;s Due Date and Done
                Date, for you and whoever you send it to. Off by default. Turn it on
                if you want to optionally set both the Date and the Time for a Request.
              </span>
            </span>
          </label>

          <label className="checkrow">
            <input
              type="checkbox"
              checked={todoDatesEnabled}
              disabled={saving}
              onChange={(e) =>
                handleToggle('todo_dates_enabled', e.target.checked, setTodoDatesEnabled)
              }
            />
            <span className="checktext">
              Show Due/Done Dates (ToDos)
              <span className="checknote">
                Adds Due Date and Done Date for ToDos instead of just a Status of Open
                and Done. Off by default. Turn it on for more precise ToDo tracking.
              </span>
            </span>
          </label>

          <label className="checkrow">
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
                like Attachments can be tested. Off by default. This is a stand-in for
                real billing — later, a Subscription Details page with actual
                eCommerce links will replace this checkbox.
              </span>
            </span>
          </label>

          {saveError && (
            <p className="ferror" role="alert">
              {saveError}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
