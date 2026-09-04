'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { formatBytes } from '@/lib/attachments'
import { BecomeSubscriberPitch, MySubscriptionSummary } from './SubscriptionPanels'

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
 * Restructured into four collapsible sections, 2026-08-23 (Jim's own
 * mockup, drawn as this list of toggles kept growing) — "General Options,"
 * "Request Options," "ToDo Options," "Subscriber Options," each a
 * `.subcard`/`.subhead`/`.subbody` (the same component Main Screen's own
 * Sent/Received/ToDos sections use) with a Show/Hide `.chip` pair in the
 * header instead of filter chips. Jim: "the default Account presentation
 * per session should be Open for General Options and Hide for all other
 * options - during a session, the Open/Hide status should remain as
 * last-used." Persisted to sessionStorage via the same readStoredChip
 * pattern MainScreen.tsx already uses for its own chip state — within-
 * session only, resets to the General-open/rest-hidden default the next
 * time the tab is closed and reopened, deliberately not promoted to a
 * cross-session profiles column the way Main Screen's own chip prefs were
 * (migration 016) — Jim's own wording here was "per session," not
 * "last-used account-wide."
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
 * outright, not extend it.
 *
 * Locked down, migration 035 (2026-08-19) — owner: "We should lock down
 * the Subscribe[d toggle]... in a way which is similar to the Private
 * Testing method in place for opening a Free Account" (migration 015),
 * once other people started being invited to test. Migration 024's direct
 * `update (tier) on profiles to authenticated` grant is revoked; the only
 * remaining path is `set_tier_for_testing(p_tier)`, a SECURITY DEFINER
 * function gated by the same app_settings-flag + allowlist shape as the
 * signup gate (`tier_toggle_gate_enabled` / `tier_toggle_allowlist`,
 * unlike `beta_allowlist` — a deliberately separate table, since "may
 * create an account" and "may self-grant Subscriber for testing" are
 * different questions). `can_toggle_tier()` is called on mount so the row
 * (and now, the whole Subscriber Options section) is hidden entirely for
 * anyone not allowed, rather than shown and then failing on click.
 *
 * profiles.reminder_default_day_before/day_of/day_after (migration 043,
 * 2026-08-22) — superseded 2026-08-23, migration 044, by
 * request_reminder_default_* / todo_reminder_default_* below. See that
 * migration's own header for the split.
 *
 * profiles.request_reminders_enabled / always_show_send_reminder /
 * request_reminder_default_day_before/day_of/day_after /
 * todo_reminder_default_day_before/day_of/day_after (migration 044,
 * 2026-08-23) — Jim's own mockup, three changes:
 *   1. "Show Reminders" (Request Options) — a master toggle for whether
 *      the Reminders-until-Done banner appears at all on the Request
 *      side. Originally defaulted true and, per migration 044's own
 *      comment at the time, also AND-gated actual sending in
 *      app/api/cron/tick/route.ts. **Both changed 2026-08-25 (migration
 *      045), per Jim's own rewritten wording**: "Without regard to
 *      whether Reminders are shown, Reminders are sent as indicated with
 *      Default (Day before / Day of / Day after) settings. Off by
 *      default." Show Reminders (and its ToDo-side counterpart,
 *      todo_reminders_enabled) is now a pure UI-visibility toggle for the
 *      banner only — sending in cron/tick/route.ts depends solely on each
 *      row's own reminder_enabled/reminder_day_of_enabled/
 *      overdue_reminder_enabled columns, which are pre-filled from the
 *      Default settings below at creation time regardless of whether the
 *      banner was ever shown. ToDo's own todo_reminders_enabled was
 *      already false by default (migration 041); Request's own default
 *      flipped true -> false (migration 045) to match "Off by default."
 *      Standalone, not gated on Show Due/Done Time — Jim's own mockup note
 *      text had referenced a "Show Due/Done Dates (Requests)" toggle that
 *      doesn't exist (Requests always have a required Due Date), flagged
 *      before this was built, and Jim confirmed standalone. Still gates
 *      the two recipient-facing screens' *banner visibility* via
 *      owner_request_reminders_enabled (migration 044) — consistent with
 *      the "rights come from the issuer" Entitlements rule this file's own
 *      comments above already describe for owner_request_time_enabled/
 *      owner_tier — but, as of 2026-08-25, no longer affects whether the
 *      issuer's own Reminders actually go out.
 *   2. "Always show Send Reminder button" (Request Options) — Jim's own
 *      new mockup item, defaults false (preserves the existing
 *      only-when-overdue behavior, §6.44). Read only by
 *      RequestDetailForm.tsx.
 *   3. The shared reminder_default_day_before/day_of/day_after trio
 *      (migration 043) is split into independent Request-side and
 *      ToDo-side triplets — Jim: "I prefer to send out Requests with a day
 *      before reminder and ToDos are best for me with a day of reminder,"
 *      which the old shared trio couldn't express. Same defaults as
 *      before the split (day before true, day of/day after false), just
 *      doubled and independently adjustable. Each of the six checknotes
 *      now reads "Changing this setting never affects anything already
 *      created." (2026-08-25, Jim's own instruction — originally present
 *      only on the two Day Before notes; now on Day Of/Day After too).
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
  // profiles.todo_reminders_enabled (migration 041, 2026-08-22) — owner's
  // own itemized request: only meaningful, and only shown enabled, once
  // todoDatesEnabled is also on (a ToDo has no Due Date to remind about
  // otherwise). Reuses the same reminder_enabled/overdue_reminder_enabled
  // columns a Request already uses, on the shared `requests` table.
  // Retitled "Show Reminders" (from "Add Reminders (ToDos)") 2026-08-23,
  // for symmetry with the new Request-side toggle below — same field,
  // same gating, just a wording change inside the new ToDo Options section.
  const [todoRemindersEnabled, setTodoRemindersEnabled] = useState(false)
  // profiles.reminder_digest_enabled (migration 032, 2026-08-17) — off by
  // default, same "opt-in, plain boolean, immediate write" pattern as every
  // toggle above. See app/api/cron/tick/route.ts's own header comment for
  // the full Chron notification design.
  const [reminderDigestEnabled, setReminderDigestEnabled] = useState(false)
  // profiles.request_reminders_enabled (migration 044, 2026-08-23) —
  // standalone master toggle for the Request-side Reminders-until-Done
  // banner; see the file-level comment. Originally defaulted true
  // (preserved existing live behavior at the time). Default flipped to
  // false, migration 045, 2026-08-25, per Jim's own rewritten checknote
  // wording ("Off by default.") — existing rows are unaffected, only new
  // signups.
  const [requestRemindersEnabled, setRequestRemindersEnabled] = useState(false)
  // profiles.always_show_send_reminder (migration 044) — see the
  // file-level comment. Default false.
  const [alwaysShowSendReminder, setAlwaysShowSendReminder] = useState(false)
  // profiles.request_reminder_default_day_before/day_of/day_after and
  // todo_reminder_default_day_before/day_of/day_after (migration 044,
  // 2026-08-23) — replace the single shared reminder_default_day_before/
  // day_of/day_after trio (migration 043); see the file-level comment for
  // the split. Pre-fill only, never a live gate. Read once by Create
  // Request/Create ToDo on their own mount, to set the initial state of
  // their own Reminders-until-Done checkboxes; changing a value here never
  // touches any already-created Request or ToDo.
  const [requestReminderDefaultDayBefore, setRequestReminderDefaultDayBefore] = useState(true)
  const [requestReminderDefaultDayOf, setRequestReminderDefaultDayOf] = useState(false)
  const [requestReminderDefaultDayAfter, setRequestReminderDefaultDayAfter] = useState(false)
  const [todoReminderDefaultDayBefore, setTodoReminderDefaultDayBefore] = useState(true)
  const [todoReminderDefaultDayOf, setTodoReminderDefaultDayOf] = useState(false)
  const [todoReminderDefaultDayAfter, setTodoReminderDefaultDayAfter] = useState(false)
  // Testing-only tier toggle (migration 024) — the DB column is text
  // ('free'/'subscriber'), not boolean, so it gets its own state and
  // handler rather than joining the shared boolean handleToggle below.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  // profiles.subscription_renewal_date / subscription_storage_gb (migration
  // 047, 2026-08-26) — feed the "My Subscription" summary
  // (SubscriptionPanels.tsx) shown here and on the full /account/
  // subscription page. See that migration's own header comment for why
  // these stand in for real billing data during Private Testing.
  const [renewalDate, setRenewalDate] = useState<string | null>(null)
  const [storageGb, setStorageGb] = useState(5)
  // Locked down, migration 035 — the whole Subscriber Options section is
  // hidden unless this is true, rather than shown and failing on click.
  // Defaults false so there is no flash of the section before
  // can_toggle_tier() resolves.
  const [canToggleTier, setCanToggleTier] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Test Storage Cap (migration 051, 2026-09-03) — a private-testing-only
  // override of the account's real Attachment storage allowance, gated by
  // the same canToggleTier flag above rather than a second allowlist (see
  // that migration's own header comment for why). storageOverrideBytes is
  // what's actually saved (null = no override, using the real tier-based
  // cap); storageOverrideInput is the free-typed MB text in the field,
  // kept separate so a not-yet-saved edit doesn't fight the loaded value.
  const [storageOverrideBytes, setStorageOverrideBytes] = useState<number | null>(null)
  const [storageOverrideInput, setStorageOverrideInput] = useState('')
  const [storageOverrideSaving, setStorageOverrideSaving] = useState(false)
  const [storageOverrideError, setStorageOverrideError] = useState<string | null>(null)

  // Collapsible section state (2026-08-23) — General Options open, the
  // other three hidden, by default; persists per Jim's own "remain as
  // last-used" wording within a session (sessionStorage), resets on the
  // next fresh tab. Lazy useState initializers so the very first render
  // already reflects any earlier choice this session, matching
  // MainScreen.tsx's own readStoredChip convention.
  const [generalOpen, setGeneralOpen] = useState(() => readStoredOpen('wyp.acctGeneralOpen', true))
  const [requestOpen, setRequestOpen] = useState(() => readStoredOpen('wyp.acctRequestOpen', false))
  const [todoOpen, setTodoOpen] = useState(() => readStoredOpen('wyp.acctTodoOpen', false))
  const [subscriberOpen, setSubscriberOpen] = useState(() => readStoredOpen('wyp.acctSubscriberOpen', false))

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
        .select(
          'private_category_enabled, request_time_enabled, todo_dates_enabled, todo_reminders_enabled, reminder_digest_enabled, request_reminders_enabled, always_show_send_reminder, request_reminder_default_day_before, request_reminder_default_day_of, request_reminder_default_day_after, todo_reminder_default_day_before, todo_reminder_default_day_of, todo_reminder_default_day_after, tier, subscription_renewal_date, subscription_storage_gb, storage_limit_override_bytes'
        )
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
      setTodoRemindersEnabled(data?.todo_reminders_enabled ?? false)
      setReminderDigestEnabled(data?.reminder_digest_enabled ?? false)
      setRequestRemindersEnabled(data?.request_reminders_enabled ?? false)
      setAlwaysShowSendReminder(data?.always_show_send_reminder ?? false)
      setRequestReminderDefaultDayBefore(data?.request_reminder_default_day_before ?? true)
      setRequestReminderDefaultDayOf(data?.request_reminder_default_day_of ?? false)
      setRequestReminderDefaultDayAfter(data?.request_reminder_default_day_after ?? false)
      setTodoReminderDefaultDayBefore(data?.todo_reminder_default_day_before ?? true)
      setTodoReminderDefaultDayOf(data?.todo_reminder_default_day_of ?? false)
      setTodoReminderDefaultDayAfter(data?.todo_reminder_default_day_after ?? false)
      setTier((data?.tier as 'free' | 'subscriber') ?? 'free')
      setRenewalDate(data?.subscription_renewal_date ?? null)
      setStorageGb(data?.subscription_storage_gb ?? 5)
      const overrideBytes = data?.storage_limit_override_bytes ?? null
      setStorageOverrideBytes(overrideBytes)
      setStorageOverrideInput(
        overrideBytes != null ? String(Math.round((overrideBytes / (1024 * 1024)) * 100) / 100) : ''
      )

      // can_toggle_tier() (migration 035) — a failure here (RPC missing,
      // network hiccup) is treated as "not allowed" rather than surfaced
      // as a load error; the rest of the screen is still fully usable
      // either way, and this section staying hidden is the safe default.
      const { data: canToggle } = await supabase.rpc('can_toggle_tier')
      if (!cancelled) setCanToggleTier(canToggle === true)

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(
    field:
      | 'private_category_enabled'
      | 'request_time_enabled'
      | 'todo_dates_enabled'
      | 'todo_reminders_enabled'
      | 'reminder_digest_enabled'
      | 'request_reminders_enabled'
      | 'always_show_send_reminder'
      | 'request_reminder_default_day_before'
      | 'request_reminder_default_day_of'
      | 'request_reminder_default_day_after'
      | 'todo_reminder_default_day_before'
      | 'todo_reminder_default_day_of'
      | 'todo_reminder_default_day_after',
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

  // Testing-only — see the file-level comment on migration 024/035. Same
  // optimistic-update-reverted-on-failure shape as handleToggle above, but
  // goes through set_tier_for_testing() (a SECURITY DEFINER RPC) rather
  // than a raw table update — migration 035 revoked the direct
  // `update (tier)` grant migration 024 had opened, so a plain
  // .from('profiles').update() would fail regardless now.
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

    // Migration 047 sets subscription_renewal_date server-side on the
    // subscriber transition — re-read the fresh row rather than guessing
    // the new date client-side, same pattern as SubscriptionForm.tsx's own
    // copy of this handler.
    const { data } = await supabase
      .from('profiles')
      .select('subscription_renewal_date, subscription_storage_gb')
      .eq('id', userId)
      .single()

    setRenewalDate(data?.subscription_renewal_date ?? null)
    setStorageGb(data?.subscription_storage_gb ?? 5)
    setSaving(false)
  }

  // Test Storage Cap (migration 051) — same shape as handleTierToggle
  // above: goes through the gated set_storage_limit_override() RPC, never
  // a raw table update (there is no direct grant to write this column).
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
    setStorageOverrideSaving(true)
    setStorageOverrideError(null)

    const { error: rpcError } = await supabase.rpc('set_storage_limit_override', { p_bytes: null })

    setStorageOverrideSaving(false)
    if (rpcError) {
      setStorageOverrideError(rpcError.message)
      return
    }
    setStorageOverrideBytes(null)
    setStorageOverrideInput('')
  }

  function handleClose() {
    router.back()
  }

  // Show/Hide chip pair for one section's header — reused four times below
  // rather than extracted to a separate component file, matching this
  // app's own established per-file-duplication convention for small
  // repeated bits of markup. onSetOpen already closes over both the
  // section's own setState and its sessionStorage key (see the four
  // wrapper functions below), so this only ever needs a plain
  // boolean-in setter.
  function sectionHead(title: string, open: boolean, onSetOpen: (v: boolean) => void) {
    return (
      <div className="subhead acct-head">
        <span className="subname">{title}</span>
        <div className="chips" role="tablist" aria-label={`${title} visibility`}>
          <button
            className={`chip${open ? ' sel' : ''}`}
            type="button"
            role="tab"
            aria-selected={open}
            onClick={() => onSetOpen(true)}
          >
            Show
          </button>
          <button
            className={`chip${!open ? ' sel' : ''}`}
            type="button"
            role="tab"
            aria-selected={!open}
            onClick={() => onSetOpen(false)}
          >
            Hide
          </button>
        </div>
      </div>
    )
  }

  function setGeneralOpenAndStore(v: boolean) {
    setGeneralOpen(v)
    window.sessionStorage.setItem('wyp.acctGeneralOpen', v ? '1' : '0')
  }
  function setRequestOpenAndStore(v: boolean) {
    setRequestOpen(v)
    window.sessionStorage.setItem('wyp.acctRequestOpen', v ? '1' : '0')
  }
  function setTodoOpenAndStore(v: boolean) {
    setTodoOpen(v)
    window.sessionStorage.setItem('wyp.acctTodoOpen', v ? '1' : '0')
  }
  function setSubscriberOpenAndStore(v: boolean) {
    setSubscriberOpen(v)
    window.sessionStorage.setItem('wyp.acctSubscriberOpen', v ? '1' : '0')
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
          <span className="glabel">Account Options</span>
          <button className="btn" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          {/* ---------------------------------------------------- General */}
          <div className="subcard">
            {sectionHead('General', generalOpen, setGeneralOpenAndStore)}
            {generalOpen && (
              <div className="subbody">
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
                      private labeling (e.g. &ldquo;Personal Fin,&rdquo; &ldquo;Future Dev&rdquo;). Turn it
                      on any time. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={reminderDigestEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('reminder_digest_enabled', e.target.checked, setReminderDigestEnabled)
                    }
                  />
                  <span className="checktext">
                    Notify Me When Reminders Are Sent
                    <span className="checknote">
                      A daily summary email listing which of your Sent Requests just had a
                      day-before Reminder go out to their Recipient, with a link to each
                      Request. Off by default.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* ---------------------------------------------------- Request */}
          <div className="subcard">
            {sectionHead('Request', requestOpen, setRequestOpenAndStore)}
            {requestOpen && (
              <div className="subbody">
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
                    Show Due/Done Time
                    <span className="checknote">
                      Adds a Due Time and Done Time next to a Request&rsquo;s Due Date and Done
                      Date, for you and whoever you send it to. Turn it on if you want to
                      optionally set both the Date and the Time for a Request. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={alwaysShowSendReminder}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('always_show_send_reminder', e.target.checked, setAlwaysShowSendReminder)
                    }
                  />
                  <span className="checktext">
                    Always show Send Reminder button
                    <span className="checknote">
                      The Send Reminder button is shown on the Request Detail when a Request
                      is overdue. If this is checked, it is always shown on the Request
                      Detail. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestRemindersEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('request_reminders_enabled', e.target.checked, setRequestRemindersEnabled)
                    }
                  />
                  <span className="checktext">
                    Show Reminders
                    <span className="checknote">
                      Adds a Reminders until Done panel to Create Requests and Request Detail
                      and to your Recipients&rsquo; response screen with choices to set or
                      change (Day before / Day of / Day after) Reminders. Without regard to
                      whether Reminders are shown, Reminders are sent as indicated with
                      Default (Day before / Day of / Day after) settings. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestReminderDefaultDayBefore}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'request_reminder_default_day_before',
                        e.target.checked,
                        setRequestReminderDefaultDayBefore
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day Before Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day before&rdquo; Reminder checkbox when you create a
                      new Request. You can still change it per item. Changing this setting
                      never affects anything already created. On by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestReminderDefaultDayOf}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'request_reminder_default_day_of',
                        e.target.checked,
                        setRequestReminderDefaultDayOf
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day Of Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day of&rdquo; Reminder checkbox when you create a new
                      Request. You can still change it per item. Changing this setting
                      never affects anything already created. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestReminderDefaultDayAfter}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'request_reminder_default_day_after',
                        e.target.checked,
                        setRequestReminderDefaultDayAfter
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day After Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day after&rdquo; Reminder checkbox when you create a
                      new Request. You can still change it per item. Changing this setting
                      never affects anything already created. Off by default.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* ---------------------------------------------------- ToDo */}
          <div className="subcard">
            {sectionHead('ToDo', todoOpen, setTodoOpenAndStore)}
            {todoOpen && (
              <div className="subbody">
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
                    Show Due/Done Dates
                    <span className="checknote">
                      Adds Due Date and Done Date for creating and editing ToDos instead of
                      just a Status of Open and Done. Turn it on for more precise ToDo
                      tracking. Date created and Date Done are always captured and shown in
                      the ToDos list view. Off by default.
                    </span>
                  </span>
                </label>

                <label
                  className={`checkrow${!todoDatesEnabled ? ' checkrow-disabled' : ''}`}
                  title={!todoDatesEnabled ? 'Please turn on Show Due/Done Dates first.' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={todoRemindersEnabled}
                    disabled={saving || !todoDatesEnabled}
                    onChange={(e) =>
                      handleToggle('todo_reminders_enabled', e.target.checked, setTodoRemindersEnabled)
                    }
                  />
                  <span className="checktext">
                    Show Reminders
                    <span className="checknote">
                      Adds a Reminders until Done panel to Create ToDos and ToDo Detail to
                      offer choices for setting or changing (Day before / Day of / Day
                      after) Reminders. Without regard to whether Reminders are shown,
                      Reminders are sent as indicated with Default (Day before / Day of /
                      Day after) settings. Only available once Show Due/Done Dates above
                      is turned on. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={todoReminderDefaultDayBefore}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'todo_reminder_default_day_before',
                        e.target.checked,
                        setTodoReminderDefaultDayBefore
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day Before Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day before&rdquo; Reminder checkbox when you create a
                      new ToDo. You can still change it per item. Changing this setting
                      never affects anything already created. On by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={todoReminderDefaultDayOf}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'todo_reminder_default_day_of',
                        e.target.checked,
                        setTodoReminderDefaultDayOf
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day Of Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day of&rdquo; Reminder checkbox when you create a new
                      ToDo. You can still change it per item. Changing this setting never
                      affects anything already created. Off by default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={todoReminderDefaultDayAfter}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'todo_reminder_default_day_after',
                        e.target.checked,
                        setTodoReminderDefaultDayAfter
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Day After Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Day after&rdquo; Reminder checkbox when you create a
                      new ToDo. You can still change it per item. Changing this setting
                      never affects anything already created. Off by default.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* ---------------------------------------------------- Subscriber */}
          {/* Un-gated from canToggleTier, 2026-08-24 — that flag now governs
              only the testing checkbox below it, not the section itself.
              Every non-subscriber sees the real "Become a Subscriber" pitch
              (Jim's own written content) instead; the section only used to
              be worth showing for the handful of people allowed to flip the
              testing toggle. Content as of 2026-08-26 comes from the shared
              SubscriptionPanels.tsx (variant="embedded") rather than a
              local copy — see that file's own header comment. */}
          <div className="subcard">
            {sectionHead('Subscriber', subscriberOpen, setSubscriberOpenAndStore)}
            {subscriberOpen && (
              <div className="subbody">
                {tier === 'subscriber' ? (
                  <MySubscriptionSummary variant="embedded" renewalDate={renewalDate} storageGb={storageGb} />
                ) : (
                  <BecomeSubscriberPitch variant="embedded" />
                )}

                {/* Storage Management (2026-09-03) — reachable regardless of
                    tier, since Attachments are now free-with-a-cap, not
                    subscriber-only (2026-08-27). Sits in this section because
                    storage allowance is the one piece of it that IS tier-
                    driven (100 MB free vs. the account's Subscriber
                    allowance). */}
                <button
                  className="btn-secondary"
                  type="button"
                  style={{ marginTop: 14 }}
                  onClick={() => router.push('/account/storage')}
                >
                  Manage Storage
                </button>

                {canToggleTier && (
                  <>
                    <label className="checkrow" style={{ marginTop: tier === 'subscriber' ? 0 : 14 }}>
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

                    {/* Test Storage Cap (migration 051, 2026-09-03) — same
                        gate as the checkbox above. Replaces the account's
                        real Attachment storage allowance outright while
                        set, so the warning/blocked states can be reached
                        with a couple of small test uploads instead of
                        actually approaching 100 MB. */}
                    <div className="fgroup" style={{ marginTop: 14 }}>
                      <label className="flabel" htmlFor="storage-override-mb">
                        Test Storage Cap (MB, testing only)
                      </label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          id="storage-override-mb"
                          className="finput"
                          style={{ maxWidth: 120 }}
                          type="number"
                          min={0}
                          step="0.1"
                          placeholder="e.g. 2"
                          value={storageOverrideInput}
                          disabled={storageOverrideSaving}
                          onChange={(e) => setStorageOverrideInput(e.target.value)}
                        />
                        <button
                          className="btn-secondary"
                          type="button"
                          disabled={storageOverrideSaving || storageOverrideInput === ''}
                          onClick={handleSaveStorageOverride}
                        >
                          Save
                        </button>
                        <button
                          className="btn-secondary"
                          type="button"
                          disabled={storageOverrideSaving || storageOverrideBytes === null}
                          onClick={handleClearStorageOverride}
                        >
                          Clear
                        </button>
                      </div>
                      <span className="checknote" style={{ display: 'block', marginTop: 6 }}>
                        {storageOverrideBytes != null
                          ? `Overriding your real storage cap with ${formatBytes(storageOverrideBytes)} for testing.`
                          : 'Not overridden — using your real tier-based storage cap.'}{' '}
                        Replaces the account&rsquo;s real Attachment storage allowance (100 MB
                        free, or your Subscriber allowance) while set, on both Requests and
                        ToDos. Clear it to go back to the real number.
                      </span>
                      {storageOverrideError && (
                        <p className="ferror" role="alert" style={{ marginTop: 6 }}>
                          {storageOverrideError}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
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

// Same shape as MainScreen.tsx's own readStoredChip — a boolean stored as
// '1'/'0' rather than a string union, since a section is only ever
// open/hidden, nothing else to validate against.
function readStoredOpen(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = window.sessionStorage.getItem(key)
  return v === '1' ? true : v === '0' ? false : fallback
}
