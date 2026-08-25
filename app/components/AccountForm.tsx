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
 *   1. "Show Reminders" (Request Options) — a new master toggle for
 *      whether the Reminders-until-Done banner appears at all on the
 *      Request side. Defaults true (preserves existing live behavior —
 *      Jim's mockup checkbox states were "copies of what some settings
 *      were," not a specification of new-column defaults, confirmed on
 *      follow-up). Standalone, not gated on Show Due/Done Time — Jim's own
 *      mockup note text had referenced a "Show Due/Done Dates (Requests)"
 *      toggle that doesn't exist (Requests always have a required Due
 *      Date), flagged before this was built, and Jim confirmed standalone.
 *      Also gates the two recipient-facing screens via
 *      owner_request_reminders_enabled (migration 044) — confirmed via
 *      direct follow-up, consistent with the "rights come from the
 *      issuer" Entitlements rule this file's own comments above already
 *      describe for owner_request_time_enabled/owner_tier.
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
 *      doubled and independently adjustable.
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
  // banner; see the file-level comment. Default true — read once on
  // mount, matching every other toggle in this file.
  const [requestRemindersEnabled, setRequestRemindersEnabled] = useState(true)
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
  // Locked down, migration 035 — the whole Subscriber Options section is
  // hidden unless this is true, rather than shown and failing on click.
  // Defaults false so there is no flash of the section before
  // can_toggle_tier() resolves.
  const [canToggleTier, setCanToggleTier] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
          'private_category_enabled, request_time_enabled, todo_dates_enabled, todo_reminders_enabled, reminder_digest_enabled, request_reminders_enabled, always_show_send_reminder, request_reminder_default_day_before, request_reminder_default_day_of, request_reminder_default_day_after, todo_reminder_default_day_before, todo_reminder_default_day_of, todo_reminder_default_day_after, tier'
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
      setRequestRemindersEnabled(data?.request_reminders_enabled ?? true)
      setAlwaysShowSendReminder(data?.always_show_send_reminder ?? false)
      setRequestReminderDefaultDayBefore(data?.request_reminder_default_day_before ?? true)
      setRequestReminderDefaultDayOf(data?.request_reminder_default_day_of ?? false)
      setRequestReminderDefaultDayAfter(data?.request_reminder_default_day_after ?? false)
      setTodoReminderDefaultDayBefore(data?.todo_reminder_default_day_before ?? true)
      setTodoReminderDefaultDayOf(data?.todo_reminder_default_day_of ?? false)
      setTodoReminderDefaultDayAfter(data?.todo_reminder_default_day_after ?? false)
      setTier((data?.tier as 'free' | 'subscriber') ?? 'free')

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

    setSaving(false)

    if (updateError) {
      setTier(next ? 'free' : 'subscriber')
      setSaveError(updateError.message)
    }
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
                      private labeling (e.g. &ldquo;Personal Fin,&rdquo; &ldquo;Future Dev&rdquo;). Off by
                      default — turn it on any time.
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
                      Date, for you and whoever you send it to. Off by default. Turn it on
                      if you want to optionally set both the Date and the Time for a Request.
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
                      Adds a Reminders until Done panel (Day before / Day of / Day after) to
                      Create Requests and Request Detail, and to your Recipients&rsquo; own
                      response screens. On by default, since Reminders are already part of
                      every Request — turn it off if you&rsquo;d rather send Reminders manually
                      with the Send Reminder button above.
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
                      Request. You can still change it per item. Off by default.
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
                      new Request. You can still change it per item. Off by default.
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
                      just a Status of Open and Done. Off by default. Turn it on for more
                      precise ToDo tracking. Date created and Date Done are always captured
                      and shown in the ToDos list view.
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
                      Adds a Reminders until Done panel (Day before / Day of / Day after)
                      to Create ToDo and ToDo Detail, same as a Request&rsquo;s own Reminders.
                      Sent to your own account email — a ToDo has no recipient. Off by
                      default, and only available once Show Due/Done Dates above is
                      turned on.
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
                      ToDo. You can still change it per item. Off by default.
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
                      new ToDo. You can still change it per item. Off by default.
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
              testing toggle. */}
          <div className="subcard">
            {sectionHead('Subscriber', subscriberOpen, setSubscriberOpenAndStore)}
            {subscriberOpen && (
              <div className="subbody">
                {tier === 'subscriber' ? (
                  <p className="promo-p" style={{ margin: '0 0 4px' }}>
                    You have Subscriber features. Thank you for subscribing.
                  </p>
                ) : (
                  <BecomeSubscriberPromo />
                )}

                {canToggleTier && (
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
                        like Attachments can be tested. Off by default. This status only
                        lasts for the testing period — once testing ends, this checkbox goes
                        away and you would subscribe for real, through the button above.
                      </span>
                    </span>
                  </label>
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

// "Become a Subscriber" pitch (2026-08-24) — Jim's own written content
// ("Subscriber Features" / "Cost" / "Sign up for a 1st year discount"),
// lightly edited for wording only, shown to every non-subscriber who opens
// the Subscriber section of Account Options. Reuses the existing .promo/
// .promo-h/.promo-p/.promo .btn component (Request Response's "Free Account
// Features" pitch, §6.2x) rather than inventing a new container — new
// .promo-features/.promo-sub classes cover the parts that component didn't
// already have (a labeled feature list, a price block).
//
// The CTA has nowhere real to go yet — there is no eCommerce/checkout page
// in this app (PRD's own Scope Discipline defers payments on purpose). It's
// built as a real, clickable primary button rather than left silently inert,
// since a button that does nothing on click is worse than one that says so:
// clicking it reveals a small explanatory note instead of navigating
// anywhere. Swap this out for a real `next/link` to the checkout page once
// one exists.
function BecomeSubscriberPromo() {
  const [clicked, setClicked] = useState(false)

  return (
    <div className="promo" style={{ margin: '0 0 4px' }}>
      <div className="promo-h">Become a Subscriber</div>

      <div className="promo-sub">Subscriber Features</div>
      <ul className="promo-features">
        <li>
          <strong>Voice dictation</strong> — speak your Request and ToDo Description and
          Dialog entries instead of typing.
        </li>
        <li>
          <strong>File attachments</strong> — send and receive documents, photos, and PDFs
          with your Requests and Responses.
        </li>
        <li>
          <strong>5 GB of storage included</strong> for attachments (additional storage
          available at $10 per 5 GB per year).
        </li>
        <li>
          <strong>Request Texting</strong> — deliver Requests by SMS text in addition to
          email.
        </li>
        <li>
          <strong>Ad-free</strong> — removes the ad banner shown to Free accounts.
        </li>
        <li>
          <strong>Priority support</strong> — via email.
        </li>
      </ul>

      <div className="promo-sub" style={{ marginTop: 12 }}>
        Cost
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        1st year subscription — 25% discount, only <strong>$17.95</strong>
        <br />
        Per year subscription — <strong>$23.95</strong> thereafter
      </p>

      <button
        type="button"
        className="btn"
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => setClicked(true)}
      >
        Sign up for a 1st year discount
      </button>

      {clicked && (
        <p className="promo-p" style={{ margin: '8px 0 0' }}>
          Subscription checkout isn&rsquo;t available yet — check back soon.
        </p>
      )}
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
