'use client'

import { type CSSProperties, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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

  window.location.href = json.url
  return { ok: true }
}

/**
 * Account Status (2026-11-06) — supersedes the earlier "Subscriber" section
 * (2026-08-26 on). Jim, reviewing the testing-only controls stacked under
 * the real Stripe pitch: "to simplify its use for respective users, I
 * renamed the page/section 'Account Status' instead of 'Subscriber' (since
 * all users of that page are not subscribers) and redesigned it to be
 * three pages, one for testers which does not offer the Stripe payment
 * option... one for Free Accounts, and one for Subscribers." Confirmed
 * via AskUserQuestion: "Private Tester" (not his own suggested "Product
 * Tester" — matches every other existing reference in this codebase), and
 * the split applies to both call sites — Account Options' embedded section
 * (AccountForm.tsx) and the full-page /account/subscription
 * (SubscriptionForm.tsx).
 *
 * AccountStatusSection is the one shared entry point both call sites (and
 * the new Admin > Test Stripe Payments screen, AdminTestStripeForm.tsx) now
 * render through, replacing the old exported BecomeSubscriberPitch/
 * MySubscriptionSummary pair and their own tier-only branch. Three states,
 * chosen in order:
 *
 *   1. Private Tester — can_toggle_tier() true (migration 035's
 *      tier_toggle_allowlist, not is_beta_tester()'s beta_allowlist — the
 *      two lists overlap for a tester added via migration 091's Add Private
 *      Tester screen going forward, but are NOT the same population: the
 *      owner's own account is seeded into tier_toggle_allowlist but was
 *      never added to beta_allowlist, since the signup gate never needed
 *      it. Gating on is_beta_tester() here (as first shipped 2026-11-06)
 *      sent the owner's own account to the Subscriber state instead of this
 *      one — fixed 2026-11-07, Jim-reported.). Informational only: no live
 *      Stripe button anywhere on this page (that's exactly the overlap Jim
 *      flagged — a real Sign Up button sitting right above a testing-only
 *      checkbox). The self-toggle "Subscribed? (testing only)" checkbox and
 *      Test Storage Cap field (migration 051) are shown within this same
 *      state, since canToggleTier is now what decides the state itself.
 *   2. Subscriber — real tier (or a testing-toggle "subscriber", handled via
 *      realStoragePurchaseDisabled below). Jim's own confirmed
 *      simplification: no separate dynamic "Your Plan Summary" box — the
 *      status paragraph itself states the plan type (annual/monthly) and
 *      renewal date, Cancel is an inline text link in that same sentence
 *      (not a standalone prominent button — Jim's original complaint), and
 *      Attachment Storage Capacity's existing stepper is the one place
 *      capacity gets modified. "Subscription Details" below is the same
 *      static reference content every state shows.
 *   3. Free — the real pitch, unchanged in substance from the old
 *      BecomeSubscriberPitch, just reusing the same "Subscription Details"
 *      box heading/content the other two states use instead of its own.
 *
 * forceRealVariant (Admin > Test Stripe Payments, 2026-11-06) skips state 1
 * even when can_toggle_tier() is true, so an admin can click through the
 * real Free/Subscriber panels — and their real Stripe calls — against
 * their own account. No separate write-back plumbing: it's the same
 * profiles row, so a real purchase there is simply the account's real
 * tier/renewal/storage the next time the ordinary page (not forced) reads
 * them — ordinarily landing back on the Private Tester variant, which
 * reflects it directly (the checkbox tracks tier === 'subscriber' either
 * way). Stripe's own success/cancel redirect targets
 * (create-checkout-session/create-portal-session route.ts) are unchanged —
 * they still land on /account/subscription, not back on the Admin screen;
 * acceptable since that's exactly "written back to the Private Tester
 * page" taken literally.
 */
export function AccountStatusSection({
  tier,
  isBetaTester,
  canToggleTier = false,
  renewalDate,
  storageGb,
  onStorageUpdated,
  saving = false,
  onTierToggle,
  storageOverrideBytes = null,
  storageOverrideInput = '',
  storageOverrideSaving = false,
  storageOverrideError = null,
  onStorageOverrideInputChange,
  onSaveStorageOverride,
  onClearStorageOverride,
  forceRealVariant = false,
}: {
  tier: 'free' | 'subscriber'
  isBetaTester: boolean
  canToggleTier?: boolean
  renewalDate: string | null
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  saving?: boolean
  onTierToggle?: (next: boolean) => void | Promise<void>
  storageOverrideBytes?: number | null
  storageOverrideInput?: string
  storageOverrideSaving?: boolean
  storageOverrideError?: string | null
  onStorageOverrideInputChange?: (value: string) => void
  onSaveStorageOverride?: () => void
  onClearStorageOverride?: () => void
  forceRealVariant?: boolean
}) {
  if (canToggleTier && !forceRealVariant) {
    return (
      <PrivateTesterStatus
        tier={tier}
        canToggleTier={canToggleTier}
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
    )
  }

  if (tier === 'subscriber') {
    return (
      <SubscriberStatus
        renewalDate={renewalDate}
        storageGb={storageGb}
        onStorageUpdated={onStorageUpdated}
        realStoragePurchaseDisabled={!forceRealVariant && canToggleTier}
      />
    )
  }

  return <FreeStatus isTester={isBetaTester} />
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
}: {
  plan: 'annual' | 'monthly'
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    const result = await startStripeFlow('/api/stripe/create-checkout-session', { plan })
    if (!result.ok) {
      setError(result.message)
      setBusy(false)
    }
    // On success the page is already navigating away — leave busy=true so
    // the button stays disabled rather than flashing back to clickable
    // during the redirect.
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
          Subscriber Features
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'comparison'}
          className={view === 'comparison' ? 'sel' : ''}
          onClick={() => setView('comparison')}
        >
          Free vs. Subscriber Comparison
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

// Manage Storage — a title-row button right-aligned with "Attachment
// Storage Capacity" itself, shown this way on every Account Status state
// (Private Tester, Free, Subscriber) and on both call sites (Account
// Options' embedded section, /account/subscription).
function ManageStorageButton() {
  const router = useRouter()
  return (
    <button type="button" className="btn-secondary" onClick={() => router.push('/account/storage')}>
      Manage Storage
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
      &ldquo;Manage Storage&rdquo; button above).
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

// Cancel — now a quiet inline text link inside the status sentence rather
// than a standalone prominent button (2026-11-06; the old RenewalDatePanel
// is gone). Jim's own stated trigger for this whole redesign: "One of the
// first things that got me going down this path is the current 'Cancel
// Renewal' button being such a prominent feature of a Subscriber's page."
// Errors surface through onError so the parent can show them below the
// status paragraph, not nested inside it (a <p> can't validly contain a
// block-level error line).
function CancelRenewalLink({ onError }: { onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    onError(null)
    // Redirects to Stripe's own hosted Billing Portal — it already shows
    // this same renewal date and offers Cancel there, so there's nothing
    // further to build here beyond starting that session.
    const result = await startStripeFlow('/api/stripe/create-portal-session', {})
    if (!result.ok) {
      onError(result.message)
      setBusy(false)
    }
  }

  return (
    <button type="button" className="linkbtn" onClick={handleClick} disabled={busy}>
      {busy ? 'opening…' : 'Cancel'}
    </button>
  )
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
// Confirm dialog added the same day, same conversation — Jim: "Since there
// will not be an immediate Stripe interaction for a monthly subscription
// incremental Attachment capacity - there should be a dialog confirming the
// additional storage and additional charge." Clicking Update Capacity now
// opens a .scrim/.modal (§6.12) confirmation instead of charging
// immediately, for both cadences (not just Monthly) — the dialog states the
// real target GB and, once cadence is known, the real resulting price and
// timing (charged now vs. next billing date). cadence is fetched the same
// way SubscriberStatus's own status sentence fetches it, so the dialog can
// show accurate wording before the server call, not just after.
function AttachmentStoragePanel({
  storageGb,
  onStorageUpdated,
  realPurchaseDisabled = false,
}: {
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  // Testing accounts (can_toggle_tier()) use the separate "Test Storage Cap
  // (MB, testing only)" override field instead of touching real recurring
  // billing — Jim's own call, 2026-11-05, after testing the real feature
  // surfaced several real-Stripe side effects (orphaned subscriptions from
  // repeated Sign Up tests) that a testing account shouldn't be creating in
  // the first place. The controls stay visible, just disabled — never
  // hidden — so "Current: X Gigabytes" is still legible. The server
  // (update-storage/route.ts) independently refuses the same request
  // regardless of this prop, same "the locked button is a courtesy" rule
  // this app already applies everywhere else.
  realPurchaseDisabled?: boolean
}) {
  const [target, setTarget] = useState(storageGb)
  const [minGb, setMinGb] = useState(STORAGE_BLOCK_GB)
  const [cadence, setCadence] = useState<SubscriptionCadence | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  useEffect(() => {
    if (realPurchaseDisabled) return
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
  }, [realPurchaseDisabled])

  useEffect(() => {
    if (realPurchaseDisabled) return
    let cancelled = false
    async function loadCadence() {
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
        // cadence stays null — the confirm dialog falls back to generic wording.
      }
    }
    loadCadence()
    return () => {
      cancelled = true
    }
  }, [realPurchaseDisabled])

  async function handleUpdate() {
    if (realPurchaseDisabled) return
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
  const controlsDisabled = realPurchaseDisabled || busy

  return (
    <>
      <StorageCapacityTitleRow title="Attachment Storage Capacity" />
      <p className="promo-p" style={{ margin: '4px 0 8px' }}>
        Current: <strong>{storageGb} Gigabytes</strong>
        {extraGb > 0 && (
          <> ({STORAGE_BLOCK_GB} GB included, {extraGb} GB additional)</>
        )}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setTarget((t) => Math.max(minGb, t - STORAGE_BLOCK_GB))}
          disabled={controlsDisabled || atFloor}
        >
          {atFloor ? 'N/A' : `− ${STORAGE_BLOCK_GB} GB`}
        </button>
        <span style={{ minWidth: 64, textAlign: 'center' }}>
          <strong>{target} GB</strong>
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setTarget((t) => t + STORAGE_BLOCK_GB)}
          disabled={controlsDisabled}
        >
          + {STORAGE_BLOCK_GB} GB
        </button>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowConfirm(true)}
          disabled={controlsDisabled || !changed}
        >
          {busy ? 'Updating…' : 'Update Capacity'}
        </button>
      </div>
      {showConfirm && (
        <>
          <div className="scrim" onClick={() => setShowConfirm(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="storage-confirm-title">
            <div className="modalhead">
              <p className="modal-title" id="storage-confirm-title">
                {target > storageGb ? 'Increase' : 'Reduce'} Attachment Storage Capacity?
              </p>
            </div>
            <p className="subnote">
              {target > storageGb ? 'Increase' : 'Reduce'} your Attachment Storage Capacity to{' '}
              <strong>{target} GB</strong>
              {cadence === 'annual' && (
                <>
                  {' '}
                  — this is prorated and charged now, then{' '}
                  <strong>${computeStoragePreviewTotal('annual', target)}/yr</strong> starting your next renewal.
                </>
              )}
              {cadence === 'monthly' && (
                <>
                  {' '}
                  — this takes effect on your next billing date, with no charge today. Your subscription will
                  become <strong>${computeStoragePreviewTotal('monthly', target)}/mo</strong> from then on.
                </>
              )}
              {!cadence && <> This will change your billed amount.</>}
            </p>
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn-secondary" type="button" onClick={() => setShowConfirm(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
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
      {realPurchaseDisabled ? (
        <p className="promo-p" style={{ margin: '8px 0 0' }}>
          Real storage purchases are disabled for testing accounts — no Stripe billing
          applies. Use <strong>Test Storage Cap (MB, testing only)</strong> below to simulate a
          different storage cap instead.
        </p>
      ) : (
        <>
          <p className="promo-p" style={{ margin: '8px 0 0' }}>
            Subscribers are provided {STORAGE_BLOCK_GB} GB of storage space for Attachments.
            Additional storage capacity can be added in increments of {STORAGE_BLOCK_GB} GB for
            ${STORAGE_MONTHLY_RATE_PER_BLOCK}/month. On an <strong>Annual</strong> plan, a
            change is prorated for the remainder of your current year and charged now, then $
            {STORAGE_ANNUAL_RATE_PER_BLOCK}/yr per {STORAGE_BLOCK_GB} GB each year thereafter.
            On a <strong>Monthly</strong> plan, a change takes effect on your next billing
            date — no charge today — at ${STORAGE_MONTHLY_RATE_PER_BLOCK}/mo per{' '}
            {STORAGE_BLOCK_GB} GB from then on.
          </p>
          <p className="promo-p" style={{ margin: '8px 0 0' }}>
            A reduction can&rsquo;t currently go below {minGb} GB — the greater of your
            plan&rsquo;s base {STORAGE_BLOCK_GB} GB allowance and however much capacity your
            Attachments actually require right now, rounded up to the nearest{' '}
            {STORAGE_BLOCK_GB} GB. Storage capacity can be reduced further once less is in
            use — the &ldquo;Manage Storage&rdquo; button above offers the ability to download
            and/or delete selected Attachments.
          </p>
        </>
      )}
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

// State 1 — Private Tester. is_beta_tester() true. Informational only: no
// live Stripe control anywhere on this page. canToggleTier gates the
// self-toggle checkbox + Test Storage Cap field (migration 051) — moved
// here verbatim from AccountForm.tsx/SubscriptionForm.tsx's own former
// inline copies, now driven by props so both call sites (and their own
// Supabase calls, unchanged) can share this one presentation.
function PrivateTesterStatus({
  tier,
  canToggleTier,
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
  canToggleTier: boolean
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
    <div style={{ margin: '0 0 4px', padding: '0 var(--pad)' }}>
      {canToggleTier && (
        <label className="checkrow" style={{ marginBottom: 10 }}>
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
      )}

      <div className="promo-sub" style={{ marginTop: 4 }}>
        My Status: Private Tester
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Thank you for helping us launch Would You Please. As a private tester, you can
        temporarily turn on Subscriber features without charge. Your feedback is important
        and appreciated — please use the Housekeeping &ldquo;Private Tester&rdquo; button to
        provide feedback by email and to monitor your own progress through various features.
      </p>

      <StorageCapacityTitleRow title="Attachment Storage Capacity" />
      <StorageCapacityExplainer />

      {canToggleTier && (
        <>
          <p className="promo-p" style={{ margin: '8px 0 0' }}>
            If you want to see what happens when you exceed the provided Attachment storage
            capacity, you can set a limit to exceed below. Unless you change it below, the
            Tester Attachment storage capacity is based on the Subscribed check box above
            (unchecked — 100 MB, or checked — {STORAGE_BLOCK_GB} GB).
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
                disabled={storageOverrideSaving || storageOverrideBytes === null}
                onClick={onClearStorageOverride}
              >
                Clear
              </button>
            </div>
            <span className="checknote" style={{ display: 'block', marginTop: 6 }}>
              {storageOverrideBytes != null
                ? `Overriding your real storage cap with ${formatBytesForOverride(storageOverrideBytes)} for testing.`
                : 'Not overridden — using your real tier-based storage cap.'}{' '}
              Replaces the account&rsquo;s real Attachment storage allowance (100 MB free, or
              your Subscriber allowance) while set, on both Requests and ToDos. Clear it to go
              back to the real number.
            </span>
            {storageOverrideError && (
              <p className="ferror" role="alert" style={{ marginTop: 6 }}>
                {storageOverrideError}
              </p>
            )}
          </div>
        </>
      )}

      <div className="promo" style={{ marginTop: 14 }}>
        <div className="promo-h">Subscription Details</div>
        <SubscriptionFeaturesAndCost />
      </div>
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
// realStoragePurchaseDisabled). No separate dynamic plan/cadence box — the
// status paragraph itself states the plan type and renewal date (Jim's own
// confirmed simplification, 2026-11-06), Cancel is the inline link above,
// and Attachment Storage Capacity's existing stepper is the one place
// capacity gets modified.
function SubscriberStatus({
  renewalDate,
  storageGb,
  onStorageUpdated,
  realStoragePurchaseDisabled,
}: {
  renewalDate: string | null
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
  realStoragePurchaseDisabled: boolean
}) {
  const [cadence, setCadence] = useState<SubscriptionCadence | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    if (realStoragePurchaseDisabled) return
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
  }, [realStoragePurchaseDisabled])

  return (
    <div style={{ margin: '0 0 4px', padding: '0 var(--pad)' }}>
      <div className="promo-sub" style={{ marginTop: 0 }}>
        My Status: Subscriber
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Thank you for being {cadence === 'annual' ? 'an annual' : cadence === 'monthly' ? 'a monthly' : 'a'}{' '}
        Would You Please subscriber. Your Renewal Date is: <strong>{formatRenewalDate(renewalDate)}</strong>. If
        you wish to do so, you can <CancelRenewalLink onError={setCancelError} />
        {' '}
        anytime — your Subscriber features stay active through the end of the period you&rsquo;ve already paid
        for.
      </p>
      {cancelError && (
        <p className="ferror" role="alert" style={{ margin: '6px 0 0' }}>
          {cancelError}
        </p>
      )}

      <AttachmentStoragePanel
        storageGb={storageGb}
        onStorageUpdated={onStorageUpdated}
        realPurchaseDisabled={realStoragePurchaseDisabled}
      />

      <div className="promo" style={{ marginTop: 14 }}>
        <div className="promo-h">Subscription Details</div>
        <SubscriptionFeaturesAndCost />
      </div>
    </div>
  )
}

// State 3 — Free Account. The real Sign Up pitch, unchanged in substance
// from the old exported BecomeSubscriberPitch — just reusing the same
// "Subscription Details" box heading/content every state now shows.
// isTester only matters here via Admin > Test Stripe Payments
// (forceRealVariant) — an ordinary real Free user is never a tester under
// this routing (is_beta_tester() true always routes to PrivateTesterStatus
// instead), so isTester reflects the real $19-vs-$39 price Stripe will
// actually charge in that one admin-preview case.
function FreeStatus({ isTester }: { isTester: boolean }) {
  return (
    <div style={{ margin: '0 0 4px', padding: '0 var(--pad)' }}>
      <div className="promo-sub" style={{ marginTop: 0 }}>
        My Status: Free Account
      </div>
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        Thank you for using Would You Please. The advantages and costs for a Subscription are
        shown below.
      </p>

      <FreeAccountStorageCapacityPanel />

      <div className="promo" style={{ marginTop: 14 }}>
        <div className="promo-h">Subscription Details</div>
        <SubscriptionFeaturesAndCost isTester={isTester} />
        <SubscriptionCheckoutButton plan="annual" style={{ width: '100%', marginTop: 12 }} />
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <SubscriptionCheckoutButton plan="monthly" label="Or sign up monthly instead" className="btn-quiet" />
        </div>
        <p className="promo-p" style={{ margin: '8px 0 0' }}>
          Cancel anytime — your Subscriber features stay active through the end of the period
          you&rsquo;ve already paid for.
        </p>
      </div>
    </div>
  )
}
