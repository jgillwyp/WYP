'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

import { supabase } from '@/lib/supabaseClient'
import { FREE_TIER_STORAGE_LIMIT_BYTES } from '@/lib/attachments'
import {
  ANNUAL_FIRST_YEAR_PRICE,
  ANNUAL_RENEWAL_PRICE,
  MONTHLY_PRICE,
  STORAGE_ANNUAL_RATE_PER_BLOCK,
  STORAGE_BLOCK_GB,
  STORAGE_MONTHLY_RATE_PER_BLOCK,
  TESTER_FIRST_YEAR_PRICE,
  minAllowedStorageGb,
  parseIsoDate,
  storageRatePerBlock,
  type StripeReturnPath,
  type SubscriptionCadence,
} from '@/lib/subscriptionPricing'

/**
 * Real Stripe checkout wiring, 2026-11-04 (migration 088,
 * app/api/stripe/*) — supersedes every "checkout isn't available yet"
 * stub below. Each of the three write actions (Sign Up, Cancel Renewal,
 * Buy Add'l) POSTs to its own route under the caller's own access token
 * and redirects to the URL it returns (a real Stripe Checkout or Billing
 * Portal page) — no Stripe.js/publishable key needed client-side at all,
 * since every Checkout Session is created server-side and handed back as
 * a plain redirect URL.
 */
async function startStripeFlow(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    return { ok: false, message: 'Your sign-in has expired — please sign in again and retry.' }
  }

  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: 'Could not reach the server — check your connection and try again.' }
  }

  let json: { url?: string; error?: string; detail?: string }
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (!res.ok || !json.url) {
    const message =
      json.detail ??
      (json.error === 'server_misconfigured'
        ? 'Billing isn’t fully set up yet — check back soon.'
        : json.error === 'not_subscriber'
          ? 'This is a Subscriber-only option.'
          : json.error === 'no_subscription'
            ? 'No active subscription was found on this account.'
            : 'Something went wrong — please try again.')
    return { ok: false, message }
  }

  // Opens in Safari (SFSafariViewController) rather than this app's own
  // WebView on native iOS, 2026-11-10 — Apple's Guideline 3.1.1 external-
  // purchase-link exception (the reason WYP can use Stripe instead of
  // Apple's own In-App Purchase at all) is widely read as requiring the
  // link to leave the app's own WebView, not render a third-party
  // checkout inside it; this was flagged and deliberately parked in
  // CLAUDE.md until "close to going live" — submitting for TestFlight
  // External Testing is that moment, since Apple's own reviewer is about
  // to click through this exact flow. @capacitor/browser's Browser.open()
  // is the standard way to do this from Capacitor: a real, separate
  // browser context (not the main WKWebView), with its own "Done" button
  // the visitor taps to return. A one-time browserFinished listener
  // reloads the page on return so any tier/subscription change Stripe
  // just made is reflected immediately, replacing the role the old
  // same-WebView redirect's own return trip used to play. Android is
  // untouched — WYP isn't distributed through the Play Store yet (direct
  // APK sideload only, see /android), so no Play Store review applies to
  // second-guess here; same reasoning CLAUDE.md gives for not touching
  // Android App Links scope beyond what it already covers.
  if (Capacitor.getPlatform() === 'ios') {
    // Swallows a Browser.open() failure rather than letting it propagate --
    // neither caller below wraps this call in its own try/catch, so an
    // uncaught rejection here would leave their own busy/saving state stuck
    // forever (the exact "stuck on Starting checkout…" bug this file fixed
    // 2026-11-10).
    try {
      const handle = await Browser.addListener('browserFinished', () => {
        handle.remove()
        window.location.reload()
      })
      await Browser.open({ url: json.url })
    } catch (err) {
      console.error('[stripe] Browser.open() failed', err)
    }
  } else {
    window.location.href = json.url
  }
  return { ok: true }
}

/**
 * Account Status (2026-11-06, merged 2026-11-11). Jim, reviewing the
 * testing-only controls stacked under the real Stripe pitch: "to simplify
 * its use for respective users, I renamed the page/section 'Account Status'
 * instead of 'Subscriber'... and redesigned it to be three pages, one for
 * testers which does not offer the Stripe payment option... one for Free
 * Accounts, and one for Subscribers." That three-way split (plus a fourth,
 * Admin-only "Test Stripe Payments" screen just to preview the real panels)
 * turned out awkward on its own terms — Jim's own follow-up: showing a real
 * tester a wholly separate page just to use real Stripe felt indirect, and
 * the Free-account Stripe screen had nothing telling a tester how to toggle
 * Subscribed at all. **Redesigned into a single merged layout**, his own
 * mockup ("WYP dev changes" doc, 2026-11-11): a dashed-border Private
 * Tester box — informational, plus the self-toggle "Subscribed? (testing
 * only)" checkbox and Test Storage Cap field (migration 051) — shown ABOVE
 * the real tier content, not instead of it. The real Subscriber/Free panel
 * underneath is always the genuine one: its own Sign Up/Cancel buttons are
 * real Stripe calls, available to a private tester exactly like anyone
 * else. This answers Jim's own closing question from the first round of
 * this design ("even the increased storage capacity for an annual
 * subscription could be available to private testers") — yes: a tester who
 * actually subscribes for real (the test-only card) gets the real storage
 * controls too, gated only by hasRealSubscription below, never by
 * canToggleTier alone. Supersedes the old exclusive three-state branch and
 * retires the separate Admin > Test Stripe Payments screen entirely
 * (AdminTestStripeForm.tsx, deleted) — there is no longer a second page
 * whose only job was to bypass state 1.
 *
 * PrivateTesterBox renders additively (canToggleTier true), always
 * followed by the real SubscriberStatus or FreeStatus — never branching
 * instead of it.
 *
 * hasRealSubscription (profiles.stripe_subscription_id != null) is the one
 * thing that still needs distinguishing for a tester: Increase/Decrease on
 * Attachment Storage Capacity write to a REAL Stripe subscription item, so
 * they can't do anything for a checkbox-only "subscriber" with no real
 * subscription on file. SubscriberStatus computes
 * realStoragePurchaseDisabled = canToggleTier && !hasRealSubscription — a
 * tester who has actually subscribed for real sees fully real controls,
 * same as anyone else. Per Jim's own follow-up ("the same dialog could
 * present for each of the three buttons... to keep the above statement
 * accurate 'what you see is a normal Free/Subscriber page'"), the disabled
 * case does NOT greyed out or hide the controls — they look and behave
 * like a normal page, and only clicking one reveals, via a small dialog,
 * that modifying capacity needs a real subscription. See
 * AttachmentStoragePanel's own comment for that behavior.
 *
 * returnPath (2026-11-11, owner-reported: "private tester Stripe session
 * returns to Account Options instead of to the private tester 'account'
 * screen") carries each call site's own real path through Stripe's
 * Checkout/Billing Portal redirect (create-checkout-session/create-portal-
 * session route.ts, then /stripe-return/page.tsx) so it returns to
 * wherever the flow actually started — Account Options ("/account") or
 * /account/subscription — rather than always landing on
 * /account/subscription regardless.
 */
export function AccountStatusSection({
  tier,
  isBetaTester,
  canToggleTier = false,
  hasRealSubscription = false,
  renewalDate,
  storageGb,
  onStorageUpdated,
  cancelAtPeriodEnd = false,
  onRenewed,
  onCanceled,
  saving = false,
  onTierToggle,
  storageOverrideBytes = null,
  storageOverrideInput = '',
  storageOverrideSaving = false,
  storageOverrideError = null,
  onStorageOverrideInputChange,
  onSaveStorageOverride,
  onClearStorageOverride,
  returnPath = '/account/subscription',
}: {
  tier: 'free' | 'subscriber'
  isBetaTester: boolean
  canToggleTier?: boolean
  // profiles.stripe_subscription_id != null (2026-11-11) — see this file's
  // header comment above.
  hasRealSubscription?: boolean
  renewalDate: string | null
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  // profiles.stripe_cancel_at_period_end (migration 088) — true once
  // Cancel Renewal has been used; flips SubscriberStatus's status line and
  // link from Cancel to Renew (2026-11-11, owner-asked).
  cancelAtPeriodEnd?: boolean
  onRenewed?: () => void
  // profiles.stripe_cancel_at_period_end's own opposite flip (2026-11-11) —
  // CancelRenewalLink's own direct in-app action calls this once the real
  // cancel_at_period_end:true write succeeds, same immediate-local-update
  // pattern onRenewed already uses.
  onCanceled?: () => void
  saving?: boolean
  onTierToggle?: (next: boolean) => void | Promise<void>
  storageOverrideBytes?: number | null
  storageOverrideInput?: string
  storageOverrideSaving?: boolean
  storageOverrideError?: string | null
  onStorageOverrideInputChange?: (value: string) => void
  onSaveStorageOverride?: () => void
  onClearStorageOverride?: () => void
  // The screen this call site actually renders on (2026-11-11) — carried
  // through Stripe's own Checkout/Billing Portal redirect so it returns to
  // wherever the flow started, not always /account/subscription. Each
  // caller passes its own real path; see subscriptionPricing.ts's own
  // STRIPE_RETURN_PATHS comment.
  returnPath?: StripeReturnPath
}) {
  return (
    <div style={{ margin: '0 0 4px' }}>
      {canToggleTier && (
        <PrivateTesterBox
          tier={tier}
          saving={saving}
          onTierToggle={onTierToggle}
          storageOverrideBytes={storageOverrideBytes}
          storageOverrideInput={storageOverrideInput}
          storageOverrideSaving={storageOverrideSaving}
          storageOverrideError={storageOverrideError}
          onStorageOverrideInputChange={onStorageOverrideInputChange}
          onSaveStorageOverride={onSaveStorageOverride}
          onClearStorageOverride={onClearStorageOverride}
        />
      )}

      {tier === 'subscriber' ? (
        <SubscriberStatus
          canToggleTier={canToggleTier}
          hasRealSubscription={hasRealSubscription}
          renewalDate={renewalDate}
          storageGb={storageGb}
          onStorageUpdated={onStorageUpdated}
          cancelAtPeriodEnd={cancelAtPeriodEnd}
          onRenewed={onRenewed}
          onCanceled={onCanceled}
        />
      ) : (
        <FreeStatus isTester={isBetaTester} returnPath={returnPath} />
      )}
    </div>
  )
}

// Title Case throughout. Replaced 2026-10-08 with Jim's own revised list
// ("sales lit and main page updates.pdf") to add Receipt Confirmation
// (migration 074, Subscriber-only) and Data Retention as real bullets of
// their own — Data Retention supersedes the landing page's old standalone
// "Keep everything forever" <li>, which lived outside this array and is
// now removed as a duplicate (see LandingPage.tsx's own comment). Priority
// Support is dropped outright, per the same PDF, which lists it nowhere —
// neither the bullet list nor its own comparison table below.
export const SUBSCRIBER_FEATURES: { title: string; desc: string }[] = [
  {
    title: 'Receipt Confirmation',
    desc: 'Request recipients are offered an opportunity to confirm their receipt of requests you consider to be important.',
  },
  {
    title: 'Voice Dictation',
    desc: 'speak your Request and ToDo Description and Dialog entries instead of typing.',
  },
  {
    title: 'File Attachments Storage (expanded to 5 GB)',
    desc: 'send and receive documents, photos, and PDFs with your Requests and Responses (additional storage available at $1/mo or $12/yr per 5 GB, matching your plan).',
  },
  {
    title: 'Automatic Repeating (expanded to unlimited)',
    desc: 'for selected Requests and ToDos.',
  },
  {
    title: 'Request Texting',
    desc: 'on a per-contact basis, deliver Requests by SMS text instead of by email.',
  },
  {
    title: 'Ad-Free',
    desc: 'removes the ad banner shown to Free accounts.',
  },
  {
    title: 'Data Retention (expanded from 1 year)',
    desc: 'perpetual history for your requests and attachments while subscribed.',
  },
]

/** Free-tier's own "Advanced Subscription Features" card (2026-08-27) —
 * Jim's own wording, expanding Free from no Attachments/no Repeat at all
 * to a real, limited version of both: "There needs to be more feature
 * access for Free Accounts... let users get familiar with more features
 * (with limits)." Consumed by LandingPage.tsx's free feature grid, same
 * single-source-of-truth pattern as SUBSCRIBER_FEATURES above — keeps the
 * landing page's marketing copy from drifting out of sync with what's
 * actually enforced server-side (app/api/attachments/_shared.ts's
 * getOwnerStorageStatus(), app/src/lib/repeatRule.ts's
 * FREE_TIER_MAX_CONCURRENT_REPEATS — redesigned 2026-11-02 from a
 * per-series occurrence cap to a concurrent-series cap, see that
 * constant's own header comment). File Attachments and storage merged
 * into one bullet the same day, matching SUBSCRIBER_FEATURES' own merge. */
export const FREE_TIER_ADVANCED_FEATURES: { title: string; desc: string }[] = [
  {
    title: 'File Attachments with 100 MB of Storage',
    desc: 'send and receive documents, photos, and PDFs with your Requests and Responses — additional storage available with a subscription.',
  },
  {
    title: 'Automatic Repeating',
    desc: 'for all Requests and ToDos — up to 3 repeating at once; a subscription is unlimited.',
  },
]

/** Free vs. Subscriber comparison table (2026-08-27) — Jim's own drafted
 * mockup, an alternative to the bulleted Subscriber Features list that
 * takes roughly the same vertical space (so switching between the two
 * views on Account Status doesn't jump/pop the layout — his own design
 * goal). Exported so LandingPage.tsx can render it directly (always
 * visible there, no toggle — see that file's own comment) as well as
 * SubscriptionFeaturesAndCost below (toggle-gated). Colors/borders use the
 * same design tokens (--rule/--strip/--row-tint/--ink) every other panel
 * in this app already reads from `:root`, not new one-off values. */
// Receipt Confirmation and Data Retention rows added, Support row dropped,
// 2026-10-08 — see SUBSCRIBER_FEATURES' own comment above for the same
// revision applied to the bullet list.
const COMPARISON_ROWS: { feature: string; free: string; subscribed: string }[] = [
  { feature: 'Receipt Confirmation', free: 'Not available', subscribed: 'Available' },
  { feature: 'Voice Dictation', free: 'Not available', subscribed: 'Available' },
  { feature: 'File Attachments Storage', free: '100 MB', subscribed: '5 GB' },
  { feature: 'Automatic Repeating', free: 'up to 3 at once', subscribed: 'Unlimited' },
  { feature: 'Request Texting', free: 'Not available', subscribed: 'Available' },
  { feature: 'Ads', free: 'Shown', subscribed: 'Not shown' },
  { feature: 'Data Retention', free: '1 year', subscribed: 'Unlimited' },
]

export function SubscriberComparisonTable() {
  return (
    <table className="comparetable">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Free</th>
          <th>Subscribed</th>
        </tr>
      </thead>
      <tbody>
        {COMPARISON_ROWS.map((r) => (
          <tr key={r.feature}>
            <td>{r.feature}</td>
            <td>{r.free}</td>
            <td>{r.subscribed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SubscriptionCheckoutButton({
  plan,
  label,
  className = 'btn',
  style,
  returnPath = '/account/subscription',
}: {
  plan: 'annual' | 'monthly'
  label?: string
  className?: string
  style?: CSSProperties
  returnPath?: StripeReturnPath
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    const result = await startStripeFlow('/api/stripe/create-checkout-session', { plan, returnPath })
    if (!result.ok) {
      setError(result.message)
    }
    // Always reset, success or failure (2026-11-10, owner-reported: stuck
    // forever on "Starting checkout…") — the old comment here assumed the
    // page always navigates away on success, which stopped being true once
    // native iOS started opening Stripe in Safari instead
    // (startStripeFlow's own 2026-11-10 fix) while this screen stays
    // mounted. Harmless on web/Android, where the page really is about to
    // unload anyway.
    setBusy(false)
  }

  return (
    <>
      <button type="button" className={className} style={style} onClick={handleClick} disabled={busy}>
        {busy ? 'Starting checkout…' : label ?? 'Sign up for a 1st year discount'}
      </button>
      {error && (
        <p className="promo-p" style={{ margin: '8px 0 0', color: 'var(--alert-red)' }}>
          {error}
        </p>
      )}
    </>
  )
}

function SubscriberFeatureList() {
  return (
    <ul className="promo-features">
      {SUBSCRIBER_FEATURES.map((f) => (
        <li key={f.title}>
          <strong>{f.title}</strong> — {f.desc}
        </li>
      ))}
    </ul>
  )
}

// Subscriber Features / Free vs. Subscriber Comparison toggle + Subscription
// Cost — the one static block all three Account Status states now show
// inside their own "Subscription Details" box (2026-11-06, replacing the
// old per-state copies: BecomeSubscriberPitch's inline version, and the
// Subscriber state's old dynamic "Your Plan Summary" — Jim, confirmed: "a
// text paragraph states their subscription type, renewal date, and offers
// a cancellation option... I prefer this new presentation method," i.e. no
// separate dynamic plan/cadence box at all, just this same static
// reference content everywhere). isTester only ever applies to the real
// Free-account pitch (FreeStatus) — the Private Tester and Subscriber
// states always show the plain $39 reference price, confirmed against
// Jim's own mockup (his page 1 "Subscription Cost" box shows $39, not the
// $19 tester rate — this page is "what it costs for real," not a pitch).
function SubscriptionFeaturesAndCost({ isTester = false }: { isTester?: boolean }) {
  const [view, setView] = useState<'features' | 'comparison'>('features')

  return (
    <>
      <div className="viewtoggle" role="tablist" aria-label="Subscriber Features view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'features'}
          className={view === 'features' ? 'sel' : ''}
          onClick={() => setView('features')}
        >
          Features
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'comparison'}
          className={view === 'comparison' ? 'sel' : ''}
          onClick={() => setView('comparison')}
        >
          Free vs. Subscriber
        </button>
      </div>

      {view === 'features' ? <SubscriberFeatureList /> : <SubscriberComparisonTable />}

      <div className="promo-sub" style={{ marginTop: 12 }}>
        Subscription Cost
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        1st year — {isTester ? 'private tester rate' : '20% discount'}, only{' '}
        <strong>${isTester ? TESTER_FIRST_YEAR_PRICE : ANNUAL_FIRST_YEAR_PRICE}</strong>
        <br />
        Per year — <strong>${ANNUAL_RENEWAL_PRICE}</strong>, renews each year until canceled
        <br />
        Monthly — <strong>${MONTHLY_PRICE}/mo</strong>, renews each month until canceled
      </p>

      {isTester && (
        <p className="promo-p" style={{ margin: '6px 0 0', fontStyle: 'italic' }}>
          Private tester rate — thank you for testing Would You Please. This $
          {TESTER_FIRST_YEAR_PRICE} 1st-year rate is available to private testers only.
        </p>
      )}
    </>
  )
}

// Manage Use — a title-row button right-aligned with "Attachment Storage
// Capacity" itself, shown this way on every Account Status state (Private
// Tester, Free, Subscriber) and on both call sites (Account Options'
// embedded section, /account/subscription). Renamed from "Manage Storage"
// 2026-11-11 (Jim's own mockup).
function ManageStorageButton() {
  const router = useRouter()
  return (
    <button type="button" className="btn-secondary" onClick={() => router.push('/account/storage')}>
      Manage Use
    </button>
  )
}

function StorageCapacityTitleRow({ title }: { title: string }) {
  return (
    <div
      className="promo-sub"
      style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
    >
      <span>{title}</span>
      <ManageStorageButton />
    </div>
  )
}

// The generic free-vs-subscriber capacity explanation (2026-11-06, Jim's
// own mockup wording) — shown on both the Private Tester and Free states;
// the Subscriber state has its own, more specific paragraph inside
// AttachmentStoragePanel below, since a real subscriber needs the actual
// proration/billing-cycle rules, not this generic overview.
function StorageCapacityExplainer() {
  return (
    <p className="promo-p" style={{ margin: '4px 0 0' }}>
      Free Account users are provided 100 MB of capacity for Attachments. Subscribers are
      provided a {STORAGE_BLOCK_GB} GB capacity and are offered the ability to add increments
      of {STORAGE_BLOCK_GB} GB for ${STORAGE_MONTHLY_RATE_PER_BLOCK}/month. Attachment Storage
      can be managed with an ability to download and/or delete selected Attachments (the
      &ldquo;Manage Use&rdquo; button above).
    </p>
  )
}

const FREE_TIER_STORAGE_LIMIT_MB = Math.round(FREE_TIER_STORAGE_LIMIT_BYTES / (1024 * 1024))

function FreeAccountStorageCapacityPanel() {
  return (
    <>
      <StorageCapacityTitleRow title="Attachment Storage Capacity" />
      <StorageCapacityExplainer />
      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Current: <strong>{FREE_TIER_STORAGE_LIMIT_MB} MB</strong>. Additional capacity is
        available with a subscription.
      </p>
    </>
  )
}

function formatRenewalDate(iso: string | null): string {
  if (!iso) return '—'
  return parseIsoDate(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// MM-DD-YYYY — the short form used in SubscriberStatus's own "(until
// 11-08-2027)" title suffix and Renew wording (2026-11-11), distinct from
// formatRenewalDate()'s long weekday/month form used in the status sentence
// itself.
function formatRenewalDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = parseIsoDate(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}-${d.getFullYear()}`
}

// Cancel — now a quiet inline text link inside the status sentence rather
// than a standalone prominent button (2026-11-06; the old RenewalDatePanel
// is gone). Jim's own stated trigger for this whole redesign: "One of the
// first things that got me going down this path is the current 'Cancel
// Renewal' button being such a prominent feature of a Subscriber's page."
//
// Rebuilt 2026-11-11 as a direct in-app action, mirroring
// RenewSubscriptionLink exactly — no more redirect to Stripe's own hosted
// Billing Portal. Jim, after using the Portal's own Cancel flow: "It would
// be a better UI to just return to the app with a dialog confirming the
// cancellation." Same reasoning Renew already established the same day:
// cancel_at_period_end only schedules a non-renewal, no Checkout/charge/
// payment method involved, so there's a real .scrim/.modal confirm dialog
// here instead of a Stripe hand-off. Errors surface through onError so the
// parent can show them below the status paragraph, not nested inside it (a
// <p> can't validly contain a block-level error line).
function CancelRenewalLink({
  renewalDate,
  onError,
  onCanceled,
}: {
  renewalDate: string | null
  onError: (message: string | null) => void
  onCanceled?: () => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setShowConfirm(false)
    setBusy(true)
    onError(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      onError('Your sign-in has expired — please sign in again and retry.')
      setBusy(false)
      return
    }

    let res: Response
    try {
      res = await fetch('/api/stripe/cancel-subscription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      onError('Could not reach the server — check your connection and try again.')
      setBusy(false)
      return
    }

    let json: { ok?: boolean; error?: string; detail?: string }
    try {
      json = await res.json()
    } catch {
      json = {}
    }

    if (!res.ok || !json.ok) {
      onError(json.detail ?? 'Something went wrong — please try again.')
      setBusy(false)
      return
    }

    onCanceled?.()
    setBusy(false)
  }

  return (
    <>
      <button type="button" className="linkbtn" onClick={() => setShowConfirm(true)} disabled={busy}>
        {busy ? 'canceling…' : 'Cancel'}
      </button>
      {showConfirm && (
        <>
          <div className="scrim" onClick={() => setShowConfirm(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-confirm-title">
            <div className="modalhead">
              <p className="modal-title" id="cancel-confirm-title">
                Cancel Your Subscription?
              </p>
            </div>
            <p className="subnote">
              {`Your Subscriber features will stay active through ${formatRenewalDateShort(renewalDate)} — the end of the period you've already paid for. You won't be charged again after that unless you Renew first.`}
            </p>
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn-secondary" type="button" onClick={() => setShowConfirm(false)}>
                Keep Subscription
              </button>
              <button className="btn" type="button" onClick={handleConfirm}>
                Cancel Subscription
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// Renew — the Cancel link's own opposite, shown once cancelAtPeriodEnd is
// true (2026-11-11, owner-asked: "I am not sure if this has to be a Stripe
// transaction with a $0 charge or just a confirmation dialog and an api
// call to update Stripe"). It's the latter — cancel_at_period_end merely
// un-schedules an already-scheduled non-renewal; no Checkout/charge
// involved at all (see renew-subscription/route.ts's own header comment).
// Unlike Cancel, which hands off to Stripe's own hosted Billing Portal
// (which shows its own confirmation), this is a direct API call with
// nothing else to confirm it — so, reversing a deliberate cancellation
// being a real billing-affecting action, it gets its own small .scrim/
// .modal (§6.12) confirm step first, matching AttachmentStoragePanel's own
// confirm-before-charging precedent.
function RenewSubscriptionLink({
  renewalDate,
  onError,
  onRenewed,
}: {
  renewalDate: string | null
  onError: (message: string | null) => void
  onRenewed?: () => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setShowConfirm(false)
    setBusy(true)
    onError(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      onError('Your sign-in has expired — please sign in again and retry.')
      setBusy(false)
      return
    }

    let res: Response
    try {
      res = await fetch('/api/stripe/renew-subscription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      onError('Could not reach the server — check your connection and try again.')
      setBusy(false)
      return
    }

    let json: { ok?: boolean; error?: string; detail?: string }
    try {
      json = await res.json()
    } catch {
      json = {}
    }

    if (!res.ok || !json.ok) {
      onError(json.detail ?? 'Something went wrong — please try again.')
      setBusy(false)
      return
    }

    onRenewed?.()
    setBusy(false)
  }

  return (
    <>
      <button type="button" className="linkbtn" onClick={() => setShowConfirm(true)} disabled={busy}>
        {busy ? 'renewing…' : 'Renew'}
      </button>
      {showConfirm && (
        <>
          <div className="scrim" onClick={() => setShowConfirm(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="renew-confirm-title">
            <div className="modalhead">
              <p className="modal-title" id="renew-confirm-title">
                Renew Your Subscription?
              </p>
            </div>
            <p className="subnote">
              Your Subscriber features will continue uninterrupted after{' '}
              <strong>{formatRenewalDateShort(renewalDate)}</strong>. You&rsquo;ll be charged at the end of your
              current subscription period, same as before you cancelled.
            </p>
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn-secondary" type="button" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={handleConfirm}>
                Renew
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// Whole dollars display plain ("$49"); a real cents-level proration (from
// preview-storage-update/route.ts) displays with exactly two decimals
// ("$8.50") rather than risking a dropped trailing zero.
function formatDollarAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

// Client-side preview only, for the confirm dialog below — the server
// (update-storage/route.ts) always recomputes this for real from the
// actual Stripe subscription, never trusts this value.
function computeStoragePreviewTotal(cadence: SubscriptionCadence, targetTotalGb: number): number {
  const basePrice = cadence === 'annual' ? ANNUAL_RENEWAL_PRICE : MONTHLY_PRICE
  const ratePerBlock = storageRatePerBlock(cadence)
  const extraGb = targetTotalGb - STORAGE_BLOCK_GB
  return basePrice + (extraGb / STORAGE_BLOCK_GB) * ratePerBlock
}

// Redesigned 2026-11-04 from a one-time purchase into an in-place target-
// storage stepper riding the subscription's own recurring price (Jim's own
// design — see update-storage/route.ts's header comment). A reduction is
// allowed, but never below minGb — whatever's actually in use right now,
// per Jim's own follow-up instruction; the server re-validates this
// regardless of what the stepper shows, so a stale/unfetched minGb here is
// never a security gap, only a slightly late error message.
//
// Explanatory text and the Update confirmation message both corrected
// 2026-11-06 (Jim: "monthly account storage capacity charges would apply
// to the following month" — he'd first said "changes," then corrected
// himself to "charges") — an Annual plan's change is still prorated and
// charged immediately, but a Monthly plan's change now takes effect
// starting the next billing date with no charge today, matching
// update-storage/route.ts's own cadence-conditional proration_behavior.
//
// Rebuilt 2026-11-11, same conversation as the Account Status merge above,
// per Jim's own "Modified increase/decrease storage capacity UI" spec:
//   1. The action button's own label now names the pending result
//      ("Increase Capacity to 10 GB" / "Decrease Capacity to 5 GB"), or
//      reads "Awaiting Increase/Decrease" (greyed) when nothing is pending
//      — replacing the old static "Update Capacity" label.
//   2. For a real annual INCREASE, the confirm dialog states the exact
//      prorated dollar amount that will be charged right now — computed via
//      a genuine Stripe invoice preview (new preview-storage-update/
//      route.ts), not a hand-rolled day-count estimate, per Jim: "Yes,
//      please for an annual subscription capacity increase calculate it...
//      I am not hung up on the calculation needing to be in whole dollars
//      related to starting in the next month, if it is easier to exactly
//      calculate it - that is fine." An annual DECREASE and every monthly
//      change need no such preview — Stripe's always_invoice proration on
//      a decrease only ever credits the account (never charges), and a
//      monthly change is proration_behavior: 'none' (no charge today
//      either way) — both already fully known from the plain recurring-
//      rate math below.
//   3. realPurchaseDisabled (a tester with no real Stripe subscription,
//      see SubscriberStatus's own comment) no longer greys the controls or
//      shows a special "disabled for testing" paragraph — Jim: "the same
//      dialog could present for each of the three buttons... to keep the
//      above statement accurate 'what you see is a normal Free/Subscriber
//      page'." All three buttons render and behave exactly like a real
//      subscriber's page; clicking any of them instead opens a small
//      explanatory dialog pointing at the test-only card / Sign Up path.
//      The server (update-storage/route.ts, preview-storage-update/
//      route.ts) independently refuses the real write regardless of this
//      prop either way — "the locked button is a courtesy."
function AttachmentStoragePanel({
  storageGb,
  onStorageUpdated,
  cadence,
  realPurchaseDisabled = false,
}: {
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  // Fetched once by the caller (SubscriberStatus), not here — avoids a
  // second /api/stripe/plan-summary round trip and any chance of the two
  // disagreeing (2026-11-11).
  cadence: SubscriptionCadence | null
  realPurchaseDisabled?: boolean
}) {
  const [target, setTarget] = useState(storageGb)
  const [minGb, setMinGb] = useState(STORAGE_BLOCK_GB)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showDisabledInfo, setShowDisabledInfo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  // Exact prorated "charged now" amount for an annual increase — fetched
  // only when the confirm dialog actually needs it (see handleActionClick).
  // requestIdRef guards against a stale response landing after the user has
  // already cancelled and reopened on a different target.
  const [chargeNowAmount, setChargeNowAmount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRequestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function loadUsage() {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      try {
        const res = await fetch('/api/attachments/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        })
        const json: { usedBytes?: number } = await res.json()
        if (!cancelled && typeof json.usedBytes === 'number') {
          setMinGb(minAllowedStorageGb(json.usedBytes))
        }
      } catch {
        // Floor just stays at the base block — the server re-validates the
        // real floor on Update Capacity regardless.
      }
    }
    loadUsage()
    return () => {
      cancelled = true
    }
  }, [])

  async function fetchChargePreview(forTarget: number) {
    const requestId = ++previewRequestIdRef.current
    setPreviewLoading(true)
    setPreviewError(null)
    setChargeNowAmount(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      if (requestId === previewRequestIdRef.current) {
        setPreviewError('Your sign-in has expired — please sign in again and retry.')
        setPreviewLoading(false)
      }
      return
    }

    let res: Response
    try {
      res = await fetch('/api/stripe/preview-storage-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetTotalGb: forTarget }),
      })
    } catch {
      if (requestId === previewRequestIdRef.current) {
        setPreviewError('Could not reach the server to calculate the exact charge.')
        setPreviewLoading(false)
      }
      return
    }

    let json: { ok?: boolean; chargeNowAmount?: number; detail?: string }
    try {
      json = await res.json()
    } catch {
      json = {}
    }

    if (requestId !== previewRequestIdRef.current) return // stale — a newer click superseded this one

    if (!res.ok || !json.ok || typeof json.chargeNowAmount !== 'number') {
      setPreviewError(json.detail ?? 'Could not calculate the exact charge.')
      setPreviewLoading(false)
      return
    }

    setChargeNowAmount(json.chargeNowAmount)
    setPreviewLoading(false)
  }

  async function handleUpdate() {
    setBusy(true)
    setError(null)
    setConfirmation(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setError('Your sign-in has expired — please sign in again and retry.')
      setBusy(false)
      return
    }

    let res: Response
    try {
      res = await fetch('/api/stripe/update-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetTotalGb: target }),
      })
    } catch {
      setError('Could not reach the server — check your connection and try again.')
      setBusy(false)
      return
    }

    let json: {
      ok?: boolean
      newStorageGb?: number
      cadence?: 'annual' | 'monthly'
      newRecurringTotal?: number
      error?: string
      detail?: string
    }
    try {
      json = await res.json()
    } catch {
      json = {}
    }

    if (!res.ok || !json.ok) {
      setError(
        json.detail ??
          (json.error === 'no_subscription'
            ? 'No active subscription was found on this account.'
            : 'Something went wrong — please try again.')
      )
      setBusy(false)
      return
    }

    const unit = json.cadence === 'annual' ? '/yr' : '/mo'
    const planLabel = json.cadence === 'annual' ? 'Annual' : 'Monthly'
    const message =
      json.cadence === 'annual'
        ? `Storage updated to ${json.newStorageGb} GB. Your ${planLabel} subscription is now $${json.newRecurringTotal}${unit}.`
        : `Storage updated to ${json.newStorageGb} GB. Your ${planLabel} subscription will be $${json.newRecurringTotal}${unit} starting your next billing date — no charge today.`
    setConfirmation(message)
    if (typeof json.newStorageGb === 'number') {
      setTarget(json.newStorageGb)
      onStorageUpdated(json.newStorageGb)
    }
    setBusy(false)
  }

  const changed = target !== storageGb
  const extraGb = storageGb - STORAGE_BLOCK_GB
  const atFloor = target <= minGb
  const isIncrease = target > storageGb
  // "Modify" rather than "Increase"/"Decrease" on the action button
  // (2026-11-11, Jim: "I see a problem with the words Increase/Decrease
  // being used both for the 'modify' and 'buy' buttons... The action 'buy'
  // button could use 'Modify' instead") — the two small Increase/Decrease
  // buttons keep those names; only the action button's own wording changed,
  // so the two don't collide. Also drops the "xx GB" text that used to sit
  // between the small buttons, per the same message — the action button
  // already states the target, so it was redundant and was why that button
  // could wrap onto a second line.
  const actionLabel = changed ? `Modify Capacity to ${target} GB` : 'Modify Capacity'
  const needsExactPreview = cadence === 'annual' && isIncrease

  function handleIncreaseClick() {
    if (realPurchaseDisabled) {
      setShowDisabledInfo(true)
      return
    }
    setTarget((t) => t + STORAGE_BLOCK_GB)
  }

  function handleDecreaseClick() {
    if (realPurchaseDisabled) {
      setShowDisabledInfo(true)
      return
    }
    setTarget((t) => Math.max(minGb, t - STORAGE_BLOCK_GB))
  }

  function handleActionClick() {
    if (realPurchaseDisabled) {
      setShowDisabledInfo(true)
      return
    }
    setShowConfirm(true)
    if (needsExactPreview) {
      void fetchChargePreview(target)
    }
  }

  function closeConfirm() {
    setShowConfirm(false)
    setChargeNowAmount(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }

  return (
    <>
      <StorageCapacityTitleRow title="Attachment Storage Capacity" />
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Current: <strong>{storageGb} Gigabytes</strong>
        {extraGb > 0 && (
          <> ({STORAGE_BLOCK_GB} GB included, {extraGb} GB additional)</>
        )}
      </p>
      {/* "Modify Capacity" subtitle (2026-11-11, Jim's own mockup) — smaller
          and a softer color than the "Attachment Storage Capacity" heading
          above, so the two read as heading/subheading rather than two
          headings of equal weight. */}
      <p
        className="promo-sub"
        style={{ margin: '6px 0 8px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)' }}
      >
        Modify Capacity
      </p>
      {/* disabled is never gated on realPurchaseDisabled here — a real
          Subscriber page would disable Decrease at the floor and the action
          button with nothing changed regardless of billing status, so
          testers see the identical disabled/greyed states a real page
          would show (2026-11-11, owner-reported: "the 'Awaiting...' version
          of the button should be greyed - it is currently shown as a
          button to click"). realPurchaseDisabled only ever intercepts a
          click that would otherwise be ENABLED (Increase always, Decrease
          off the floor, or the action button once something's changed) —
          see the three handle*Click functions above. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={handleIncreaseClick} disabled={busy}>
          Increase
        </button>
        <button type="button" className="btn-secondary" onClick={handleDecreaseClick} disabled={busy || atFloor}>
          {atFloor ? 'N/A' : 'Decrease'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={handleActionClick}
          disabled={busy || !changed}
        >
          {busy ? 'Updating…' : actionLabel}
        </button>
      </div>
      {showConfirm && (
        <>
          <div className="scrim" onClick={closeConfirm} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="storage-confirm-title">
            <div className="modalhead">
              <p className="modal-title" id="storage-confirm-title">
                {isIncrease ? 'Increase' : 'Reduce'} Attachment Storage Capacity?
              </p>
            </div>
            {/* Each branch is one flat JS template-literal string, not
                JSX text interleaved with {expressions} — this file's own
                history (CLAUDE.md, 2026-09-02/09-03) documents a real,
                confirmed Next/SWC compiler bug that can silently drop a
                space at exactly this kind of number+word junction when it
                wraps across source lines, with no simple rule for which
                junctions it hits. These dialog sentences state real dollar
                amounts during live Stripe testing, so the established fix
                (a single string expression, verified correct regardless of
                source formatting) is used here from the start rather than
                risking it and finding out from a Jim bug report. */}
            <p className="subnote">
              {needsExactPreview
                ? previewLoading
                  ? 'Calculating the exact charge…'
                  : previewError
                    ? `Increase your Attachment Storage Capacity to ${target} GB — this is prorated and charged now, then $${computeStoragePreviewTotal('annual', target)}/yr starting your next renewal. (${previewError})`
                    : `The increase of ${target - storageGb} GB for a new capacity of ${target} GB, for the remainder of this annual subscription period, will be charged now at $${chargeNowAmount !== null ? formatDollarAmount(chargeNowAmount) : '—'} and will be billed thereafter at $${STORAGE_ANNUAL_RATE_PER_BLOCK}/yr per ${STORAGE_BLOCK_GB} GB. Including the increased storage capacity of ${target} GB, your annual renewal cost will increase from $${computeStoragePreviewTotal('annual', storageGb)} to $${computeStoragePreviewTotal('annual', target)}.`
                : cadence === 'annual'
                  ? `The decrease from ${storageGb} GB to ${target} GB will reduce your annual renewal cost from $${computeStoragePreviewTotal('annual', storageGb)} to $${computeStoragePreviewTotal('annual', target)}.`
                  : cadence === 'monthly' && isIncrease
                    ? `The increase of ${target - storageGb} GB for a new capacity of ${target} GB, for your monthly subscription, will be charged next month and thereafter at the rate of $${STORAGE_MONTHLY_RATE_PER_BLOCK}/month. Including the increased storage capacity of ${target} GB, your monthly renewal cost will be increased from $${computeStoragePreviewTotal('monthly', storageGb)} to $${computeStoragePreviewTotal('monthly', target)}.`
                    : cadence === 'monthly'
                      ? `Starting next month, the decrease from ${storageGb} GB to ${target} GB will reduce your monthly renewal cost from $${computeStoragePreviewTotal('monthly', storageGb)} to $${computeStoragePreviewTotal('monthly', target)}.`
                      : `${isIncrease ? 'Increase' : 'Reduce'} your Attachment Storage Capacity to ${target} GB. This will change your billed amount.`}
            </p>
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn-secondary" type="button" onClick={closeConfirm} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || (needsExactPreview && previewLoading)}
                onClick={() => {
                  setShowConfirm(false)
                  handleUpdate()
                }}
              >
                {busy ? 'Updating…' : 'Confirm'}
              </button>
            </div>
          </div>
        </>
      )}
      {showDisabledInfo && (
        <>
          <div className="scrim" onClick={() => setShowDisabledInfo(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="storage-disabled-title">
            <div className="modalhead">
              <p className="modal-title" id="storage-disabled-title">
                Modify Capacity Not Available
              </p>
            </div>
            <p className="subnote">
              Modify Capacity is only available when the test-only credit card is used to subscribe. You can
              uncheck the &ldquo;Subscribed?&rdquo; check box above and then use the normal &ldquo;Sign up&rdquo;
              for a monthly or annual subscription to use this feature.
            </p>
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={() => setShowDisabledInfo(false)}>
                Close
              </button>
            </div>
          </div>
        </>
      )}
      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Subscribers are provided {STORAGE_BLOCK_GB} GB of storage space for Attachments. Additional storage
        capacity can be added in increments of {STORAGE_BLOCK_GB} GB for ${STORAGE_MONTHLY_RATE_PER_BLOCK}/month.
        On an <strong>Annual</strong> plan, a change is prorated for the remainder of your current year and
        charged now, then ${STORAGE_ANNUAL_RATE_PER_BLOCK}/yr per {STORAGE_BLOCK_GB} GB each year thereafter. On a{' '}
        <strong>Monthly</strong> plan, a change takes effect on your next billing date — no charge today — at $
        {STORAGE_MONTHLY_RATE_PER_BLOCK}/mo per {STORAGE_BLOCK_GB} GB from then on.
      </p>
      {/* Merged from two separate paragraphs into one (2026-11-11, Jim's own
          mockup pasted-in image) — same substance (the real floor is
          whatever's actually in use, and Manage Use is how to lower that),
          one paragraph instead of two. */}
      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        {`If storage capacity has been increased above the base ${STORAGE_BLOCK_GB} GB, it can be reduced back down as long as the reduction does not go below the actual storage being used. The storage being used can be reduced by clicking the "Manage Use" button above and deleting selected Attachments.`}
      </p>
      {confirmation && (
        <p className="promo-p" style={{ margin: '6px 0 0', color: 'var(--brand-blue)' }}>
          {confirmation}
        </p>
      )}
      {error && (
        <p className="promo-p" style={{ margin: '6px 0 0', color: 'var(--alert-red)' }}>
          {error}
        </p>
      )}
    </>
  )
}

// Private Tester box (2026-11-11 Account Status merge, renamed/simplified
// from the old exclusive PrivateTesterStatus). Renders ABOVE the real
// Subscriber/Free content, never instead of it — see AccountStatusSection's
// own header comment. No longer carries its own "My Status"/Attachment
// Storage Capacity/Subscription Details; those belong to whichever real
// state renders underneath. Wording and field order match Jim's own
// mockup verbatim (the checkbox comes LAST in the box, after the
// explanatory text and the storage-cap tester field — not first, as the
// old exclusive layout had it).
function PrivateTesterBox({
  tier,
  saving,
  onTierToggle,
  storageOverrideBytes,
  storageOverrideInput,
  storageOverrideSaving,
  storageOverrideError,
  onStorageOverrideInputChange,
  onSaveStorageOverride,
  onClearStorageOverride,
}: {
  tier: 'free' | 'subscriber'
  saving: boolean
  onTierToggle?: (next: boolean) => void | Promise<void>
  storageOverrideBytes: number | null
  storageOverrideInput: string
  storageOverrideSaving: boolean
  storageOverrideError: string | null
  onStorageOverrideInputChange?: (value: string) => void
  onSaveStorageOverride?: () => void
  onClearStorageOverride?: () => void
}) {
  return (
    // .testernote (2026-11-10, now wrapping the whole box rather than just
    // the checkbox, 2026-11-11) — Jim's own request: a deliberately
    // off-brand look, "clearly-not-part-of-WYP," distinguishing this
    // testing-only scaffolding from the app's own real UI below it. See
    // globals.css's own comment at .testernote.
    <div className="testernote" style={{ marginBottom: 14 }}>
      <p className="checktext" style={{ margin: 0 }}>
        As a Private Tester, what you see below is a normal Free/Subscriber page based on how
        you may have checked or unchecked the &ldquo;Subscribed?&rdquo; check box below and how
        you may have &ldquo;paid for&rdquo; subscriptions or storage with a test-only credit
        card.
      </p>
      <p className="checktext" style={{ margin: '8px 0 0' }}>
        We use the Stripe payment platform. They provide a test-only credit card as follows: ID
        4242 4242 4242 4242, any future month and year for a card renewal date, and a made-up
        3-digit number for a CVC code. You can test &ldquo;purchasing&rdquo; activities with
        this card.
      </p>

      <p className="checktext" style={{ margin: '10px 0 0', fontWeight: 700 }}>
        Attachment Storage Capacity testing
      </p>
      <p className="checktext" style={{ margin: '4px 0 0' }}>
        You can reduce the storage capacity limit to a small number of Megabytes below to see
        how Would You Please handles that issue.
      </p>
      <div className="fgroup" style={{ marginTop: 10 }}>
        <label className="flabel" htmlFor="tester-storage-override-mb">
          Test Storage Cap (MB, testing only)
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            id="tester-storage-override-mb"
            className="finput"
            style={{ maxWidth: 120 }}
            type="number"
            min={0}
            step="0.1"
            placeholder="e.g. 2"
            value={storageOverrideInput}
            disabled={storageOverrideSaving}
            onChange={(e) => onStorageOverrideInputChange?.(e.target.value)}
          />
          <button
            className="btn-secondary"
            type="button"
            disabled={storageOverrideSaving || storageOverrideInput === ''}
            onClick={onSaveStorageOverride}
          >
            Save
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={storageOverrideSaving || (storageOverrideBytes === null && storageOverrideInput === '')}
            onClick={onClearStorageOverride}
          >
            Clear
          </button>
        </div>
        {storageOverrideBytes != null && (
          <span className="checknote" style={{ display: 'block', marginTop: 6 }}>
            {`Overriding your real storage cap with ${formatBytesForOverride(storageOverrideBytes)} for testing.`}
          </span>
        )}
        {storageOverrideError && (
          <p className="ferror" role="alert" style={{ marginTop: 6 }}>
            {storageOverrideError}
          </p>
        )}
      </div>

      <label className="checkrow" style={{ marginTop: 14, marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={tier === 'subscriber'}
          disabled={saving}
          onChange={(e) => onTierToggle?.(e.target.checked)}
        />
        <span className="checktext">
          Subscribed? (testing only)
          <span className="checknote">
            Sets your account to the Subscriber tier so subscriber-only features like
            Attachments can be tested. This status only lasts for the testing period —
            once testing ends, this checkbox goes away. Off by default.
          </span>
        </span>
      </label>
    </div>
  )
}

// Small, local formatter — avoids importing attachments.ts's formatBytes()
// just for this one override-note sentence, matching this file's existing
// FREE_TIER_STORAGE_LIMIT_MB precedent of deriving its own small display
// value rather than pulling in a whole helper module for one line.
function formatBytesForOverride(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  const rounded = Math.round(mb * 100) / 100
  return `${rounded} MB`
}

// State 2 — Subscriber (real tier, or a testing-toggle "subscriber" via
// realStoragePurchaseDisabled, now derived from hasRealSubscription rather
// than canToggleTier alone — see AccountStatusSection's own header comment,
// 2026-11-11). No separate dynamic plan/cadence box — the status paragraph
// itself states the plan type and renewal date (Jim's own confirmed
// simplification, 2026-11-06), Cancel is the inline link above, and
// Attachment Storage Capacity's existing stepper is the one place capacity
// gets modified. The heading itself now names the cadence ("My Account
// Status: Annual Subscriber" / "...Monthly Subscriber") per Jim's own
// follow-up — "I just realized that the 'My Account Status: Subscriber'
// should be more specific."
//
// cadence is fetched here UNCONDITIONALLY now (previously skipped whenever
// realStoragePurchaseDisabled was already known up front via the old
// forceRealVariant plumbing) — it's now the very thing that determines
// whether a tester has a real subscription, via hasRealSubscription (a
// plain profiles.stripe_subscription_id != null check, passed down from the
// caller, never derived from this fetch — plan-summary/route.ts's own
// header comment says it "deliberately degrades to cadence: null on
// anything short of a clean answer," including a transient Stripe error,
// so it would be the wrong signal for an all-or-nothing gate like this
// one). cadence is passed down to AttachmentStoragePanel too, so it only
// ever fetches it once here, not a second time there.
function SubscriberStatus({
  canToggleTier,
  hasRealSubscription,
  renewalDate,
  storageGb,
  onStorageUpdated,
  cancelAtPeriodEnd,
  onRenewed,
  onCanceled,
}: {
  canToggleTier: boolean
  hasRealSubscription: boolean
  renewalDate: string | null
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  cancelAtPeriodEnd: boolean
  onRenewed?: () => void
  onCanceled?: () => void
}) {
  const [cadence, setCadence] = useState<SubscriptionCadence | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const realStoragePurchaseDisabled = canToggleTier && !hasRealSubscription

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      try {
        const res = await fetch('/api/stripe/plan-summary', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const json: { cadence?: SubscriptionCadence | null } = await res.json()
        if (!cancelled) setCadence(json.cadence ?? null)
      } catch {
        // cadence stays null — the status sentence falls back to generic wording.
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const cadenceWord = cadence === 'annual' ? 'Annual' : cadence === 'monthly' ? 'Monthly' : null

  return (
    <div style={{ margin: '0 0 4px' }}>
      <div className="promo-sub" style={{ marginTop: 0 }}>
        My Account Status: {cadenceWord ? `${cadenceWord} ` : ''}Subscriber
        {cancelAtPeriodEnd && <> (until {formatRenewalDateShort(renewalDate)})</>}
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Thank you for being {cadence === 'annual' ? 'an annual' : cadence === 'monthly' ? 'a monthly' : 'a'}{' '}
        Would You Please subscriber. Your Renewal Date is: <strong>{formatRenewalDate(renewalDate)}</strong>. If
        you wish to do so, you can{' '}
        {cancelAtPeriodEnd ? (
          <>
            <RenewSubscriptionLink renewalDate={renewalDate} onError={setCancelError} onRenewed={onRenewed} />
            {' anytime — so your Subscriber features will stay active after '}
            {formatRenewalDateShort(renewalDate)}
            {'. The renewal will be charged at the end of the current subscription period.'}
          </>
        ) : (
          <>
            <CancelRenewalLink renewalDate={renewalDate} onError={setCancelError} onCanceled={onCanceled} />
            {' anytime — your Subscriber features stay active through the end of the period you’ve already paid for.'}
          </>
        )}
      </p>
      {cancelError && (
        <p className="ferror" role="alert" style={{ margin: '6px 0 0' }}>
          {cancelError}
        </p>
      )}

      <AttachmentStoragePanel
        storageGb={storageGb}
        onStorageUpdated={onStorageUpdated}
        cadence={cadence}
        realPurchaseDisabled={realStoragePurchaseDisabled}
      />

      <div className="promo" style={{ marginTop: 14, marginLeft: 0, marginRight: 0 }}>
        <div className="promo-h">Subscription Details</div>
        <SubscriptionFeaturesAndCost />
      </div>
    </div>
  )
}

// State 3 — Free Account. The real Sign Up pitch, unchanged in substance
// from the old exported BecomeSubscriberPitch — just reusing the same
// "Subscription Details" box heading/content every state now shows. isTester
// (is_beta_tester(), a separate allowlist from canToggleTier — see
// AccountStatusSection's own header comment) reflects the real $19-vs-$39
// price Stripe will actually charge — true independent of whether the
// Private Tester box above is also showing, since a tester may have one
// allowlist membership without the other.
function FreeStatus({ isTester, returnPath }: { isTester: boolean; returnPath: StripeReturnPath }) {
  return (
    <div style={{ margin: '0 0 4px' }}>
      <div className="promo-sub" style={{ marginTop: 0 }}>
        My Account Status: Free Account
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Thank you for using Would You Please. The advantages and costs for a Subscription are
        shown below.
      </p>

      <FreeAccountStorageCapacityPanel />

      <div className="promo" style={{ marginTop: 14, marginLeft: 0, marginRight: 0 }}>
        <div className="promo-h">Subscription Details</div>
        <SubscriptionFeaturesAndCost isTester={isTester} />
        <SubscriptionCheckoutButton
          plan="annual"
          style={{ width: '100%', marginTop: 12 }}
          returnPath={returnPath}
        />
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <SubscriptionCheckoutButton
            plan="monthly"
            label="Or sign up monthly instead"
            className="btn-quiet"
            returnPath={returnPath}
          />
        </div>
        <p className="promo-p" style={{ margin: '8px 0 0' }}>
          Cancel anytime — your Subscriber features stay active through the end of the period
          you&rsquo;ve already paid for.
        </p>
      </div>
    </div>
  )
}
