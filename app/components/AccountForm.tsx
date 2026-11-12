'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'
import { AccountStatusSection } from './SubscriptionPanels'

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
 * Private Category split into request_category_enabled/
 * todo_category_enabled (migration 073, 2026-09-30) — supersedes the
 * single shared private_category_enabled (migration 018) above. Jim: "I
 * would like to be able to just use Private Categories for ToDos and think
 * that instead of a single option it should be optional for both ToDos and
 * Requests... These options can be placed at the top of the Requests and
 * ToDos sections." The underlying categories table/list stays one shared
 * list for both — only the two *visibility* toggles split, same "one
 * feature, two independently-gateable surfaces" shape already established
 * by request_time_enabled/todo_time_enabled. Each toggle now sits first in
 * its own section, with its own wording (Jim's own text, verbatim). Backed
 * up by dropping the old column outright in the same migration (Jim's own
 * data carried forward to both new columns as its starting value, per this
 * file's own established precedent for a split — see migration 044's own
 * header on the old shared reminder_default trio).
 *
 * The General section is removed as of this same batch (2026-09-30) — its
 * three items (Show Private Category, Notify Me When Reminders Are Sent,
 * Notify Me When Requests Are Marked Done) either split into the two new
 * per-section Category toggles above or moved to the bottom of the
 * Requests (sent) section (Notify Me When Reminders Are Sent / Notify Me
 * When Requests Are Marked Done — Jim's own instruction). Jim's own words
 * left this open-ended ("there is currently no need for the General
 * section, although there may be a need for it later. Perhaps it is only
 * hidden now.") — removed rather than kept as a visible-but-empty section,
 * an engineering-judgment call (not explicitly confirmed): the
 * sectionHead()/collapsible-section pattern stays fully reusable for a
 * future setting that needs a General-style home, but an empty section
 * with a Show/Hide chip pair and nothing under it would read as a bug, not
 * a placeholder. Flagged for Jim to correct if he'd rather it stayed
 * visible, just empty.
 *
 * Receipt Confirmation becomes a Subscriber feature (migration 074,
 * 2026-09-30) — Jim: "the Receipt Confirmation should be a Subscriber
 * feature, not a Free Account feature." The Account Options toggle below is
 * now hidden entirely unless tier === 'subscriber' (same "hidden entirely,
 * not .is-locked" precedent Repeat used before its own free-tier
 * expansion), and Create Request's own per-item checkbox gained the
 * identical tier check. Client-side hiding alone was never enough — this
 * field is set via a plain client insert on `requests` (RLS-protected
 * owner-insert-own, no SECURITY DEFINER function in front of it), so
 * migration 074 also adds a real trigger that silently forces the value
 * back to false on any insert/update attempting to set it true while the
 * owner isn't currently a subscriber (see that migration's own header for
 * why it's a silent downgrade, not a raised error). Per CLAUDE.md's own
 * Entitlements section ("gates govern adding, never viewing"), an already-
 * requested confirmation on an existing row is untouched even if the owner
 * later lapses tier — the trigger only fires on a genuine attempt to newly
 * set the value true.
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

// See CreateRequestForm.tsx's identical constant/comment.
const MINUTES_BEFORE_OPTIONS = Array.from({ length: 25 }, (_, i) => i * 5)

export default function AccountForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  // Split from the old single private_category_enabled, migration 073 —
  // see the file-level comment.
  const [requestCategoriesEnabled, setRequestCategoriesEnabled] = useState(false)
  const [todoCategoriesEnabled, setTodoCategoriesEnabled] = useState(false)
  // Default flipped to false, migration 023 — see the file-level comment.
  const [requestTimeEnabled, setRequestTimeEnabled] = useState(false)
  // profiles.request_repeat_enabled / todo_repeat_enabled (migration 086,
  // 2026-11-02) — whether RepeatControl is offered at all on each side,
  // same shape as the category/time splits above. Off by default — see
  // the file-level comment on this batch's own "Features exposure" design
  // thread for the full reasoning (most free-tier users won't use it).
  const [requestRepeatEnabled, setRequestRepeatEnabled] = useState(false)
  const [todoRepeatEnabled, setTodoRepeatEnabled] = useState(false)
  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)
  // profiles.todo_time_enabled (migration 067, 2026-09-16) — owner's own
  // request, mirroring request_time_enabled's identical role for Requests:
  // only meaningful, and only shown enabled, once todoDatesEnabled is also
  // on (there's no Due/Done Date row to attach a Time field to otherwise).
  // Off by default — ToDos have never had Due/Done Time before this.
  const [todoTimeEnabled, setTodoTimeEnabled] = useState(false)
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
  // profiles.notify_owner_on_done (migration 066, 2026-09-13; default
  // flipped to off by migration 090, 2026-11-06 — Jim: "Off by default" —
  // same reasoning reminder_digest_enabled above already used for a
  // low-signal digest email). Gates send-request-update-to-owner/route.ts's
  // own "a Sent Request was just marked Done" email — see that route's
  // header comment for the self-actor exception (never sent regardless of
  // this flag when the owner marked their own self-sent Request Done via
  // the recipient-facing screen).
  const [notifyOwnerOnDone, setNotifyOwnerOnDone] = useState(false)
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
  // profiles.offer_receipt_confirmation (migration 069, 2026-09-24) —
  // owner's own PDF spec, "Receipt Confirmation for Requests." Gates
  // whether Create Request shows its own per-item "Request a Receipt
  // Confirmation" checkbox at all. Off by default.
  const [offerReceiptConfirmation, setOfferReceiptConfirmation] = useState(false)
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
  // "Minutes before" (migration 077, 2026-10-09) — a fourth, independent
  // Reminders-until-Done default, same shape as the three above, split
  // Request/ToDo per migration 044's own precedent.
  const [requestReminderDefaultMinutesBeforeEnabled, setRequestReminderDefaultMinutesBeforeEnabled] = useState(false)
  const [requestReminderDefaultMinutesBeforeValue, setRequestReminderDefaultMinutesBeforeValue] = useState(10)
  const [todoReminderDefaultMinutesBeforeEnabled, setTodoReminderDefaultMinutesBeforeEnabled] = useState(false)
  const [todoReminderDefaultMinutesBeforeValue, setTodoReminderDefaultMinutesBeforeValue] = useState(10)
  // Testing-only tier toggle (migration 024) — the DB column is text
  // ('free'/'subscriber'), not boolean, so it gets its own state and
  // handler rather than joining the shared boolean handleToggle below.
  // Column default flipped 'free' -> 'subscriber', migration 052,
  // 2026-09-06, per Jim's own request ("Please change the Subscribed
  // (for testing) to be 'On' by default."). New signups now start
  // Subscribed; existing rows are unaffected. This useState('free')
  // initializer is just the pre-fetch placeholder and doesn't need to
  // change — the real value always comes from the loaded profile row
  // a few lines below.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  // profiles.subscription_renewal_date / subscription_storage_gb (migration
  // 047, 2026-08-26) — feed the "My Subscription" summary
  // (SubscriptionPanels.tsx) shown here and on the full /account/
  // subscription page. See that migration's own header comment for why
  // these stand in for real billing data during Private Testing.
  const [renewalDate, setRenewalDate] = useState<string | null>(null)
  const [storageGb, setStorageGb] = useState(5)
  // profiles.stripe_cancel_at_period_end (migration 088, kept in sync by
  // webhook/route.ts's own customer.subscription.updated handler) — drives
  // SubscriberStatus's Cancel-vs-Renew wording (2026-11-11).
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  // profiles.stripe_subscription_id != null — whether this account has a
  // REAL Stripe subscription on file, as opposed to a testing-toggle
  // "subscriber" (tier set via the Subscribed? checkbox alone). Drives
  // AccountStatusSection's realStoragePurchaseDisabled gate (2026-11-11
  // Account Status merge) — a private tester who has actually subscribed
  // for real (the test-only card) gets the real storage controls, same as
  // anyone else; only a checkbox-only tester is routed to the explanatory
  // "use the test-only card to enable this" dialog instead.
  const [hasRealSubscription, setHasRealSubscription] = useState(false)
  // Locked down, migration 035 — the whole Subscriber Options section is
  // hidden unless this is true, rather than shown and failing on click.
  // Defaults false so there is no flash of the section before
  // can_toggle_tier() resolves.
  const [canToggleTier, setCanToggleTier] = useState(false)
  const [isTester, setIsTester] = useState(false)
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

  // Stripe Checkout redirects back here with ?checkout=success|cancelled
  // (create-checkout-session/route.ts's own success_url/cancel_url) — same
  // mechanism SubscriptionForm.tsx's own copy already had (2026-11-05),
  // ported here for the first time (2026-11-11, owner-reported): this
  // screen had no checkoutStatus awareness at all, so its Close button was
  // always router.back() unconditionally — landing back on the just-
  // completed Stripe Checkout page's own "You're all done here" screen
  // every time Sign Up was reached from Account Options rather than
  // /account/subscription.
  //
  // Read once from the URL at mount only — no sessionStorage persistence.
  // A same-day attempt to survive a manual refresh via sessionStorage
  // caused a real, worse bug (owner-reported, same day): the banner got
  // stuck showing "Thanks — your payment was received" permanently,
  // surviving Close, reopening the screen, and a reload several minutes
  // later — exactly the kind of lingering-stale-flag risk that mechanism
  // introduced. Reverted outright rather than chased further; a banner
  // that occasionally doesn't survive a manual refresh is a far smaller
  // cost than one that can get stuck forever. checkoutBannerDismissed
  // below gives a direct, foolproof way to clear it regardless.
  const [checkoutStatus] = useState<'success' | 'cancelled' | null>(() => {
    if (typeof window === 'undefined') return null
    const value = new URLSearchParams(window.location.search).get('checkout')
    return value === 'success' || value === 'cancelled' ? value : null
  })
  const [checkoutBannerDismissed, setCheckoutBannerDismissed] = useState(false)

  // Collapsible section state (2026-08-23) — all three hidden by default;
  // persists per Jim's own "remain as last-used" wording within a session
  // (sessionStorage), resets on the next fresh tab. Lazy useState
  // initializers so the very first render already reflects any earlier
  // choice this session, matching MainScreen.tsx's own readStoredChip
  // convention. The General section itself (previously defaulted open) was
  // removed 2026-09-30 — see the file-level comment; sectionHead() stays
  // reusable if a future setting needs a similar home.
  // Deep-link from the Features band's own "Housekeeping, Account Options"
  // link (Create Request/Create ToDo, ?open=request / ?open=todo) — Jim's
  // own follow-up correction: forcing only the target section open wasn't
  // enough, since whichever other section was last left open (independent,
  // per-section sessionStorage) stayed open too — the target often wasn't
  // even the first thing visible. "When either... is clicked, the other
  // two sections are closed and the desired target is opened." So a forced
  // open is now exclusive: when ?open= is present, it decides all three
  // sections' state outright (target true, the other two false), not just
  // the target. Checked in each lazy initializer below (not a later
  // effect) so this is already correct on the very first render, no flash
  // of multiple sections open before collapsing. The matching mount effect
  // further down persists that exclusive state as the new last-used state
  // for every section — "it can then be remembered for a normal menu path
  // to the 3 sections" — and strips the query string once consumed.
  const [requestOpen, setRequestOpen] = useState(() => {
    const forced = forcedOpenSection()
    return forced ? forced === 'request' : readStoredOpen('wyp.acctRequestOpen', false)
  })
  const [todoOpen, setTodoOpen] = useState(() => {
    const forced = forcedOpenSection()
    return forced ? forced === 'todo' : readStoredOpen('wyp.acctTodoOpen', false)
  })
  const [subscriberOpen, setSubscriberOpen] = useState(() => {
    const forced = forcedOpenSection()
    return forced ? false : readStoredOpen('wyp.acctSubscriberOpen', false)
  })

  // Deep-link, continued — runs once on mount, after setRequestOpenAndStore/
  // setTodoOpenAndStore/setSubscriberOpenAndStore are in scope (hoisted
  // function declarations, so calling them from here before their own
  // textual definition is safe). Persists the exclusive forced state as
  // the new last-used sessionStorage value for all three sections (not
  // just a one-time visual override for this one visit) and strips
  // ?open= from the URL once consumed, same "read once, clean up the
  // query string" pattern CreateRequestForm.tsx's own ?newContactId
  // handling already uses.
  useEffect(() => {
    const forced = forcedOpenSection()
    if (!forced) return
    setRequestOpenAndStore(forced === 'request')
    setTodoOpenAndStore(forced === 'todo')
    setSubscriberOpenAndStore(false)
    router.replace('/account')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Strip ?checkout= from the address bar once read above — checkoutStatus
  // itself stays set in React state for this instance's whole lifetime
  // regardless of the URL change.
  useEffect(() => {
    if (checkoutStatus) {
      router.replace('/account')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


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
          'request_category_enabled, todo_category_enabled, request_time_enabled, request_repeat_enabled, todo_repeat_enabled, todo_dates_enabled, todo_time_enabled, todo_reminders_enabled, reminder_digest_enabled, notify_owner_on_done, request_reminders_enabled, always_show_send_reminder, offer_receipt_confirmation, request_reminder_default_day_before, request_reminder_default_day_of, request_reminder_default_day_after, todo_reminder_default_day_before, todo_reminder_default_day_of, todo_reminder_default_day_after, request_reminder_default_minutes_before_enabled, request_reminder_default_minutes_before_value, todo_reminder_default_minutes_before_enabled, todo_reminder_default_minutes_before_value, tier, subscription_renewal_date, subscription_storage_gb, storage_limit_override_bytes, stripe_cancel_at_period_end, stripe_subscription_id'
        )
        .eq('id', userData.user.id)
        .single()

      if (cancelled) return

      if (fetchError) {
        setLoadError(fetchError.message)
        setLoading(false)
        return
      }

      setRequestCategoriesEnabled(data?.request_category_enabled ?? false)
      setTodoCategoriesEnabled(data?.todo_category_enabled ?? false)
      setRequestTimeEnabled(data?.request_time_enabled ?? false)
      setRequestRepeatEnabled(data?.request_repeat_enabled ?? false)
      setTodoRepeatEnabled(data?.todo_repeat_enabled ?? false)
      setTodoDatesEnabled(data?.todo_dates_enabled ?? false)
      setTodoTimeEnabled(data?.todo_time_enabled ?? false)
      setTodoRemindersEnabled(data?.todo_reminders_enabled ?? false)
      setReminderDigestEnabled(data?.reminder_digest_enabled ?? false)
      setNotifyOwnerOnDone(data?.notify_owner_on_done ?? false)
      setRequestRemindersEnabled(data?.request_reminders_enabled ?? false)
      setAlwaysShowSendReminder(data?.always_show_send_reminder ?? false)
      setOfferReceiptConfirmation(data?.offer_receipt_confirmation ?? false)
      setRequestReminderDefaultDayBefore(data?.request_reminder_default_day_before ?? true)
      setRequestReminderDefaultDayOf(data?.request_reminder_default_day_of ?? false)
      setRequestReminderDefaultDayAfter(data?.request_reminder_default_day_after ?? false)
      setTodoReminderDefaultDayBefore(data?.todo_reminder_default_day_before ?? true)
      setTodoReminderDefaultDayOf(data?.todo_reminder_default_day_of ?? false)
      setTodoReminderDefaultDayAfter(data?.todo_reminder_default_day_after ?? false)
      setRequestReminderDefaultMinutesBeforeEnabled(data?.request_reminder_default_minutes_before_enabled ?? false)
      setRequestReminderDefaultMinutesBeforeValue(data?.request_reminder_default_minutes_before_value ?? 10)
      setTodoReminderDefaultMinutesBeforeEnabled(data?.todo_reminder_default_minutes_before_enabled ?? false)
      setTodoReminderDefaultMinutesBeforeValue(data?.todo_reminder_default_minutes_before_value ?? 10)
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

      // can_toggle_tier() (migration 035) — a failure here (RPC missing,
      // network hiccup) is treated as "not allowed" rather than surfaced
      // as a load error; the rest of the screen is still fully usable
      // either way, and this section staying hidden is the safe default.
      const { data: canToggle } = await supabase.rpc('can_toggle_tier')
      if (!cancelled) setCanToggleTier(canToggle === true)

      // is_beta_tester() (migration 088) — now also decides whether
      // AccountStatusSection shows the Private Tester state at all
      // (2026-11-06), not just the $19-vs-$39 1st-year price.
      const { data: tester } = await supabase.rpc('is_beta_tester')
      if (!cancelled) setIsTester(tester === true)

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(
    field:
      | 'request_category_enabled'
      | 'todo_category_enabled'
      | 'request_time_enabled'
      | 'request_repeat_enabled'
      | 'todo_repeat_enabled'
      | 'todo_dates_enabled'
      | 'todo_time_enabled'
      | 'todo_reminders_enabled'
      | 'reminder_digest_enabled'
      | 'notify_owner_on_done'
      | 'request_reminders_enabled'
      | 'always_show_send_reminder'
      | 'offer_receipt_confirmation'
      | 'request_reminder_default_day_before'
      | 'request_reminder_default_day_of'
      | 'request_reminder_default_day_after'
      | 'todo_reminder_default_day_before'
      | 'todo_reminder_default_day_of'
      | 'todo_reminder_default_day_after'
      | 'request_reminder_default_minutes_before_enabled'
      | 'todo_reminder_default_minutes_before_enabled',
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

  // "Minutes before" default value stepper (migration 077, 2026-10-09) —
  // same auto-save-on-change, optimistic-revert-on-failure shape as
  // handleToggle above, just for the numeric sibling column instead of a
  // boolean one.
  async function handleMinutesValueChange(
    field: 'request_reminder_default_minutes_before_value' | 'todo_reminder_default_minutes_before_value',
    next: number,
    previous: number,
    setLocal: (value: number) => void,
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
      setLocal(previous)
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

    // Migration 047 sets subscription_renewal_date server-side on the
    // subscriber transition — re-read the fresh row rather than guessing
    // the new date client-side, same pattern as SubscriptionForm.tsx's own
    // copy of this handler.
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
    // Reset the typed field immediately, whether or not anything was ever
    // saved (2026-11-11, owner-reported: unsaved typed MBs couldn't be
    // cleared without first saving them, since Clear used to be disabled
    // whenever storageOverrideBytes was still null). Only hit the server
    // when there's a real saved override to actually clear.
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
    // A Stripe redirect is a real top-level browser navigation, not an
    // in-app one — it breaks the history continuity router.back() normally
    // relies on, same reasoning as SubscriptionForm.tsx's own identical fix
    // (2026-11-05), ported here for the first time (2026-11-11,
    // owner-reported) since this screen never had it.
    if (checkoutStatus) {
      router.push('/')
      return
    }
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
          {checkoutStatus === 'success' && !checkoutBannerDismissed && (
            <div
              className="noticeband"
              style={{
                margin: '4px var(--pad) 14px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>
                Thanks — your payment was received. This can take a few seconds to show
                as Subscribed below; refresh if it still shows Free after a moment.
              </span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setCheckoutBannerDismissed(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  flexShrink: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          )}
          {checkoutStatus === 'cancelled' && !checkoutBannerDismissed && (
            <div
              className="noticeband"
              style={{
                margin: '4px var(--pad) 14px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>Checkout was cancelled — nothing was charged.</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setCheckoutBannerDismissed(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  flexShrink: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          )}
          {/* ---------------------------------------------------- Request */}
          {/* Retitled "Requests (sent)," 2026-09-30 — Jim: some of these
              options relate specifically to being in a Requests Sent state.
              The old General section is gone (see the file-level comment) —
              its Show Private Category split into a Requests-side toggle
              here (now first in the section, Jim's own placement) and a
              ToDos-side one below; Notify Me When Reminders Are Sent/Notify
              Me When Requests Are Marked Done moved to the bottom of this
              section, Jim's own instruction. */}
          <div className="subcard">
            {sectionHead('Requests (sent)', requestOpen, setRequestOpenAndStore)}
            {requestOpen && (
              <div className="subbody">
                {/* Reordered + given squint-test keyword prefixes, 2026-11-02
                    (Jim's own "Features Exposure" design) — matches the
                    order of the Features checkboxes planned for the top of
                    Create Request: Time, Categories, Confirmation, Repeat,
                    Reminders. */}
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
                    <span className="checkword">Time —</span> Show Due/Done Time
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
                    checked={requestCategoriesEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('request_category_enabled', e.target.checked, setRequestCategoriesEnabled)
                    }
                  />
                  <span className="checktext">
                    <span className="checkword">Categories —</span> Show Private Category
                    <span className="checknote">
                      Adds an optional Category field to Requests sent, for your own private
                      labeling, e.g., &ldquo;Personal Fin&rdquo;, &ldquo;Future Dev&rdquo;. A single list of
                      Categories you create are shared by Requests (sent) and ToDos. Off by
                      default.
                    </span>
                  </span>
                </label>

                {/* Subscriber-gated, 2026-09-30 — Jim: "the Receipt
                    Confirmation should be a Subscriber feature, not a Free
                    Account feature." Hidden entirely for Free, same
                    precedent as Repeat before its own free-tier expansion —
                    see the file-level comment on migration 074. Title
                    shortened 2026-11-02 (Jim's own mockup) to fit on one
                    line alongside its new checkword prefix. */}
                {tier === 'subscriber' && (
                  <label className="checkrow">
                    <input
                      type="checkbox"
                      checked={offerReceiptConfirmation}
                      disabled={saving}
                      onChange={(e) =>
                        handleToggle('offer_receipt_confirmation', e.target.checked, setOfferReceiptConfirmation)
                      }
                    />
                    <span className="checktext">
                      <span className="checkword">Confirmation —</span> Show optional Receipt
                      Confirmation
                      <span className="checknote">
                        This will add a check box to each Create Request screen to allow the
                        notification email or text to include a Receipt Confirmation. Off by
                        default.
                      </span>
                    </span>
                  </label>
                )}

                {/* Show Add Repeat option — profiles.request_repeat_enabled
                    (migration 086, 2026-11-02, new). Whether RepeatControl
                    is offered at all on Create Request/Request Detail — see
                    those files' own identical gate. Off by default: "I
                    expect that most free accounts users will not use it." */}
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestRepeatEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('request_repeat_enabled', e.target.checked, setRequestRepeatEnabled)
                    }
                  />
                  <span className="checktext">
                    <span className="checkword">Repeat —</span> Show Add Repeat option
                    <span className="checknote">
                      For each Create Request screen, this will show an optional Add Repeat
                      feature, available for setting a schedule for automatically created
                      Requests. Off by default.
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
                    <span className="checkword">Reminders —</span> Show Reminders
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

                {/* "Minutes before" default (migration 077, 2026-10-09) —
                    a fourth, independent Reminders-until-Done default. */}
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={requestReminderDefaultMinutesBeforeEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'request_reminder_default_minutes_before_enabled',
                        e.target.checked,
                        setRequestReminderDefaultMinutesBeforeEnabled
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Minutes-Before Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Minutes before&rdquo; Reminder checkbox with{' '}
                      <select
                        className="minuteselect"
                        value={requestReminderDefaultMinutesBeforeValue}
                        disabled={saving}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleMinutesValueChange(
                            'request_reminder_default_minutes_before_value',
                            Number(e.target.value),
                            requestReminderDefaultMinutesBeforeValue,
                            setRequestReminderDefaultMinutesBeforeValue
                          )
                        }
                      >
                        {MINUTES_BEFORE_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>{' '}
                      minutes when you create a new Request. You can still change it per
                      item. Changing this setting never affects anything already created.
                      Off by default.
                    </span>
                  </span>
                </label>

                {/* Moved from the now-removed General section, 2026-09-30 —
                    Jim's own instruction, to the bottom of this section. */}
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

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={notifyOwnerOnDone}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('notify_owner_on_done', e.target.checked, setNotifyOwnerOnDone)
                    }
                  />
                  <span className="checktext">
                    Notify Me When Requests Are Marked Done
                    <span className="checknote">
                      Unless I marked the Request as Done, send an email each time a Sent
                      Request is marked as Done, with a link to the Request. Off by default.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* ---------------------------------------------------- ToDo */}
          {/* Retitled "ToDos," 2026-09-30 — consistent with the Request
              section's own "Requests (sent)" rename, same day. */}
          <div className="subcard">
            {sectionHead('ToDos', todoOpen, setTodoOpenAndStore)}
            {todoOpen && (
              <div className="subbody">
                {/* Reordered + given squint-test keyword prefixes, 2026-11-02
                    — matches the order of the Features checkboxes planned
                    for the top of Create ToDo: Date, Time, Categories,
                    Repeat, Reminders. */}
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
                    <span className="checkword">Date —</span> Show Due/Done Dates
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
                    checked={todoTimeEnabled}
                    disabled={saving || !todoDatesEnabled}
                    onChange={(e) =>
                      handleToggle('todo_time_enabled', e.target.checked, setTodoTimeEnabled)
                    }
                  />
                  <span className="checktext">
                    <span className="checkword">Time —</span> Show Due/Done Time
                    <span className="checknote">
                      If &quot;Show Due/Done Dates&quot; above is checked, add a Due Time and
                      Done Time next to a ToDo&apos;s Due Date and Done Date. Turn it on if
                      you want to optionally set the Due/Done Times for a ToDo. Off by
                      default.
                    </span>
                  </span>
                </label>

                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={todoCategoriesEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle('todo_category_enabled', e.target.checked, setTodoCategoriesEnabled)
                    }
                  />
                  <span className="checktext">
                    <span className="checkword">Categories —</span> Show Private Category
                    <span className="checknote">
                      Adds an optional Category field to ToDos, for your own private
                      labeling, e.g., &ldquo;Personal Fin&rdquo;, &ldquo;Future Dev&rdquo;. A single list of
                      Categories you create are shared by Requests (sent) and ToDos. Off by
                      default.
                    </span>
                  </span>
                </label>

                {/* Show Add Repeat option — profiles.todo_repeat_enabled
                    (migration 086, 2026-11-02, new). Same Due-Date
                    dependency as Time/Reminders above — Repeat has no Due
                    Date to anchor generation on until Show Due/Done Dates
                    is on. */}
                <label
                  className={`checkrow${!todoDatesEnabled ? ' checkrow-disabled' : ''}`}
                  title={!todoDatesEnabled ? 'Please turn on Show Due/Done Dates first.' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={todoRepeatEnabled}
                    disabled={saving || !todoDatesEnabled}
                    onChange={(e) =>
                      handleToggle('todo_repeat_enabled', e.target.checked, setTodoRepeatEnabled)
                    }
                  />
                  <span className="checktext">
                    <span className="checkword">Repeat —</span> Show Add Repeat option
                    <span className="checknote">
                      For each Create ToDo screen, this will show an optional Add Repeat
                      feature, available for setting a schedule for automatically created
                      ToDos. Only available once Show Due/Done Dates above is turned on. Off
                      by default.
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
                    <span className="checkword">Reminders —</span> Show Reminders
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

                {/* "Minutes before" default (migration 077, 2026-10-09) —
                    a fourth, independent Reminders-until-Done default. */}
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={todoReminderDefaultMinutesBeforeEnabled}
                    disabled={saving}
                    onChange={(e) =>
                      handleToggle(
                        'todo_reminder_default_minutes_before_enabled',
                        e.target.checked,
                        setTodoReminderDefaultMinutesBeforeEnabled
                      )
                    }
                  />
                  <span className="checktext">
                    Default: Minutes-Before Reminder
                    <span className="checknote">
                      Pre-fills the &ldquo;Minutes before&rdquo; Reminder checkbox with{' '}
                      <select
                        className="minuteselect"
                        value={todoReminderDefaultMinutesBeforeValue}
                        disabled={saving}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleMinutesValueChange(
                            'todo_reminder_default_minutes_before_value',
                            Number(e.target.value),
                            todoReminderDefaultMinutesBeforeValue,
                            setTodoReminderDefaultMinutesBeforeValue
                          )
                        }
                      >
                        {MINUTES_BEFORE_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>{' '}
                      minutes when you create a new ToDo. You can still change it per item.
                      Changing this setting never affects anything already created. Off by
                      default.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ Account Status */}
          {/* Renamed from "Subscriber" (2026-11-06) — Jim: "I renamed the
              page/section 'Account Status' instead of 'Subscriber' (since
              all users of that page are not subscribers) and redesigned it
              to be three pages, one for testers which does not offer the
              Stripe payment option... one for Free Accounts, and one for
              Subscribers." AccountStatusSection (SubscriptionPanels.tsx)
              picks the state (is_beta_tester() first, then real tier) and
              owns all three presentations; this screen just supplies the
              account's own real data + the handlers the self-toggle
              checkbox/Test Storage Cap need when the Private Tester state
              renders. See that file's own header comment for the full
              design. */}
          <div className="subcard">
            {sectionHead('Account Status', subscriberOpen, setSubscriberOpenAndStore)}
            {subscriberOpen && (
              <div className="subbody">
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
                  onCanceled={() => setCancelAtPeriodEnd(true)}
                  saving={saving}
                  onTierToggle={handleTierToggle}
                  storageOverrideBytes={storageOverrideBytes}
                  storageOverrideInput={storageOverrideInput}
                  storageOverrideSaving={storageOverrideSaving}
                  storageOverrideError={storageOverrideError}
                  onStorageOverrideInputChange={setStorageOverrideInput}
                  onSaveStorageOverride={handleSaveStorageOverride}
                  onClearStorageOverride={handleClearStorageOverride}
                  returnPath="/account"
                />
              </div>
            )}
          </div>

          {saveError && (
            <p className="ferror" role="alert" style={{ margin: '10px var(--pad) 0' }}>
              {saveError}
            </p>
          )}
        </div>
        <AppFooter tier={tier} subscriptionDisabled={subscriberOpen} />
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

// Deep-link query param (?open=request|todo) from the Features band's own
// Housekeeping link — read via window.location.search, not
// useSearchParams(), matching AddContactForm.tsx's/CreateRequestForm.tsx's
// own established convention for a param that's only ever read once on
// mount and immediately stripped: no Suspense-boundary requirement that
// way, and this is always a fresh navigation to this screen, never a
// client-side param-only transition onto an already-mounted instance (the
// one case that convention doesn't cover — see /login's own history).
function forcedOpenSection(): 'request' | 'todo' | null {
  if (typeof window === 'undefined') return null
  const open = new URLSearchParams(window.location.search).get('open')
  return open === 'request' || open === 'todo' ? open : null
}
