'use client'

import { type CSSProperties, useEffect, useState } from 'react'

import { supabase } from '@/lib/supabaseClient'
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
  type SubscriptionPlan,
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
 * Shared Subscriber content (2026-08-26) — one source for the "Subscriber
 * Features" / "What's included" bullet list, the Renewal Date / Attachment
 * Storage Space / Plan Summary panels, and the dynamic Buy Add'l pricing
 * rule. Used at two call sites: the full-page `/account/subscription`
 * screen (`SubscriptionForm.tsx`, reached by "See Subscription Features and
 * Other Options") and Account Options' own embedded Subscriber section
 * (`AccountForm.tsx`). One file, reused both places, matching this
 * codebase's own `AttachmentsPanel.tsx`/`RepeatControl.tsx` precedent for
 * shared multi-screen components, rather than two independently maintained
 * copies that could drift apart — Jim's own design proposal, confirmed
 * 2026-08-26.
 *
 * Fully dynamic, not caption-based (Jim's own confirmed choice, "1)... 3)
 * show the real default values... as if they'd just subscribed"): both call
 * sites render whichever of BecomeSubscriberPitch / MySubscriptionSummary
 * matches the account's *real* tier (which, during Private Testing, the
 * "Subscribed? (testing only)" checkbox on both screens controls directly).
 * There is no separate "preview" mode or explanatory banner distinguishing
 * real subscription content from a testing-driven one — a Free account's
 * pitch is the same real pitch every future Free account will see, and a
 * testing-Subscriber account's summary shows the same real panels a genuine
 * subscriber will see, just backed by profiles.subscription_renewal_date/
 * subscription_storage_gb (migration 047) instead of a real billing record.
 *
 * variant controls two things that differ between the two call sites: (a)
 * whether the block renders its own "Become a Subscriber"/"My Subscription"
 * heading (the embedded Subscriber .subcard already has its own "Subscriber"
 * header from AccountForm.tsx's sectionHead(), so 'embedded' omits a second,
 * redundant one), and (b) — Subscribed content only — which intro sentence
 * to show, per Jim's own two differently-worded mockups: 'full' reads
 * "Thank you for subscribing," 'embedded' reads "...until the Renewal Date
 * shown below."
 *
 * Pricing repriced 2026-10-13 — Jim's own instruction: "$39/1st yr (a 20%
 * discount), $49/yr thereafter" (he'd meant to type $36, caught the typo,
 * and confirmed sticking with $39 anyway). The Monthly figure was first set
 * to a reasoned-but-unconfirmed $5.99/mo (ratio-matched to the old $2.95/mo
 * vs. $23.95/yr relationship); Jim then directly confirmed the real number
 * is $5/mo flat, which is what's used throughout.
 */
type Variant = 'full' | 'embedded'

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
 * views on Account Options' Subscriber section doesn't jump/pop the
 * layout — his own design goal). Exported so LandingPage.tsx can render it
 * directly (always visible there, no toggle — see that file's own comment)
 * as well as BecomeSubscriberPitch below (toggle-gated). Colors/borders use
 * the same design tokens (--rule/--strip/--row-tint/--ink) every other
 * panel in this app already reads from `:root`, not new one-off values. */
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
  plan: SubscriptionPlan
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

// heading is now optional (2026-08-27) — BecomeSubscriberPitch's new
// Subscriber Features/Comparison toggle buttons serve as the visible
// heading for that context, so passing no heading there avoids a
// redundant second "Subscriber Features" label; PlanSummaryPanel's own
// "What's included" call site is unaffected, still passing a heading.
function SubscriberFeatureList({ heading }: { heading?: string }) {
  return (
    <>
      {heading && (
        <div className="promo-sub" style={{ marginTop: 10 }}>
          {heading}
        </div>
      )}
      <ul className="promo-features">
        {SUBSCRIBER_FEATURES.map((f) => (
          <li key={f.title}>
            <strong>{f.title}</strong> — {f.desc}
          </li>
        ))}
      </ul>
    </>
  )
}

// "Become a Subscriber" — the Free-account pitch (Jim's own written content,
// unchanged from the 2026-08-24 batch, just relocated into this shared
// file so both call sites read the identical copy).
//
// Subscriber Features / Free vs. Subscriber Comparison toggle added
// 2026-08-27, Jim's own drafted mockups (two pasted screenshots): a
// two-button view switch above the feature content, with "Subscription
// Cost" (renamed from "Cost") and everything below it staying fixed
// regardless of which view is showing — his own explicit design goal,
// so the sign-up button and cancel-anytime note don't jump position when
// the person switches views.
export function BecomeSubscriberPitch({ variant, isTester = false }: { variant: Variant; isTester?: boolean }) {
  const [view, setView] = useState<'features' | 'comparison'>('features')

  return (
    <div className="promo" style={{ margin: '0 0 4px' }}>
      {variant === 'full' && <div className="promo-h">Become a Subscriber</div>}

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
      {/* Simplified 2026-08-28, Jim's own drafted wording — drops the
          repeated "subscription" suffix on each line and states the
          renewal behavior directly ("renews each year/month until
          canceled") rather than the vaguer "thereafter". "canceled" is
          Jim's identified preferred spelling — see this file's other
          "cancelled" fix at the note below and in PlanSummaryPanel. */}
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        1st year — {isTester ? 'private tester rate' : '20% discount'}, only{' '}
        <strong>${isTester ? TESTER_FIRST_YEAR_PRICE : ANNUAL_FIRST_YEAR_PRICE}</strong>
        <br />
        Per year — <strong>${ANNUAL_RENEWAL_PRICE}</strong>, renews each year until canceled
        <br />
        {/* Monthly option added 2026-08-27, Jim's own drafted addition —
            no discount attaches to it (unlike the annual plan's 1st-year
            20% off), since it's meant as a low-commitment alternative, not
            a cheaper path to the same year of service. Price repriced
            2026-10-13 alongside the annual figures — Jim's own confirmed
            $5/mo flat (not a 49/12 division or a ratio match). */}
        Monthly — <strong>${MONTHLY_PRICE}/mo</strong>, renews each month until canceled
      </p>

      {isTester && (
        // Tester-only visible text (2026-11-04), per Jim's own ask —
        // explains why this account sees $19 rather than $39, so it never
        // reads as a pricing mistake. Shown directly on the Subscribe
        // screen itself, not gated behind any "testing complete" moment —
        // Jim's own confirmed scope: every private tester (beta_allowlist)
        // sees this any time they're on this screen during testing.
        <p className="promo-p" style={{ margin: '6px 0 0', fontStyle: 'italic' }}>
          Private tester rate — thank you for testing Would You Please. This $
          {TESTER_FIRST_YEAR_PRICE} 1st-year rate is available to private testers only.
        </p>
      )}

      <SubscriptionCheckoutButton plan="annual" style={{ width: '100%', marginTop: 12 }} />
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <SubscriptionCheckoutButton
          plan="monthly"
          label="Or sign up monthly instead"
          className="btn-quiet"
        />
      </div>

      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Cancel anytime — your Subscriber features stay active through the end of the
        period you&rsquo;ve already paid for.
      </p>
    </div>
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

function RenewalDatePanel({ renewalDate }: { renewalDate: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancelRenewal() {
    setBusy(true)
    setError(null)
    // Redirects to Stripe's own hosted Billing Portal — it already shows
    // this same renewal date and offers Cancel there, so there's nothing
    // further to build here beyond starting that session.
    const result = await startStripeFlow('/api/stripe/create-portal-session', {})
    if (!result.ok) {
      setError(result.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        Renewal Date
      </div>
      <div className="donerow" style={{ margin: '4px 0 0' }}>
        <span className="donenote">{formatRenewalDate(renewalDate)}</span>
        <button type="button" className="btn" onClick={handleCancelRenewal} disabled={busy}>
          {busy ? 'Opening…' : 'Cancel Renewal'}
        </button>
      </div>
      {error && (
        <p className="promo-p" style={{ margin: '6px 0 0', color: 'var(--alert-red)' }}>
          {error}
        </p>
      )}
    </>
  )
}

// Redesigned 2026-11-04 from a one-time purchase into an in-place target-
// storage stepper riding the subscription's own recurring price (Jim's own
// design — see update-storage/route.ts's header comment). A reduction is
// allowed, but never below minGb — whatever's actually in use right now,
// per Jim's own follow-up instruction; the server re-validates this
// regardless of what the stepper shows, so a stale/unfetched minGb here is
// never a security gap, only a slightly late error message.
function AttachmentStoragePanel({
  storageGb,
  onStorageUpdated,
}: {
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
}) {
  const [target, setTarget] = useState(storageGb)
  const [minGb, setMinGb] = useState(STORAGE_BLOCK_GB)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

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
        // real floor on Update Storage regardless.
      }
    }
    loadUsage()
    return () => {
      cancelled = true
    }
  }, [])

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
    setConfirmation(
      `Storage updated to ${json.newStorageGb} GB. Your ${planLabel} subscription is now $${json.newRecurringTotal}${unit}.`
    )
    if (typeof json.newStorageGb === 'number') {
      setTarget(json.newStorageGb)
      onStorageUpdated(json.newStorageGb)
    }
    setBusy(false)
  }

  const changed = target !== storageGb

  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        Attachment Storage Space
      </div>
      <p className="promo-p" style={{ margin: '4px 0 8px' }}>
        Current: <strong>{storageGb} Gigabytes</strong>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setTarget((t) => Math.max(minGb, t - STORAGE_BLOCK_GB))}
          disabled={busy || target <= minGb}
        >
          − {STORAGE_BLOCK_GB} GB
        </button>
        <span style={{ minWidth: 64, textAlign: 'center' }}>
          <strong>{target} GB</strong>
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setTarget((t) => t + STORAGE_BLOCK_GB)}
          disabled={busy}
        >
          + {STORAGE_BLOCK_GB} GB
        </button>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={handleUpdate}
          disabled={busy || !changed}
        >
          {busy ? 'Updating…' : 'Update Storage'}
        </button>
      </div>
      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Billed as part of your subscription, at the same cadence it already renews on —{' '}
        <strong>${STORAGE_MONTHLY_RATE_PER_BLOCK}/mo</strong> per {STORAGE_BLOCK_GB} GB on a
        Monthly plan, or <strong>${STORAGE_ANNUAL_RATE_PER_BLOCK}/yr</strong> per{' '}
        {STORAGE_BLOCK_GB} GB on an Annual plan (prorated for the remainder of your current
        year if added mid-cycle). No separate charges — the rate simply changes, and a
        reduction can&rsquo;t go below what&rsquo;s already in use ({minGb} GB right now).
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

export function PlanSummaryPanel({ heading = 'Plan Summary' }: { heading?: string }) {
  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        {heading}
      </div>
      <div className="planrow">
        <span className="plan-name">
          Subscriber — 1st year
          <span className="plan-sub">20% discount, billed today</span>
        </span>
        <span className="plan-price">${ANNUAL_FIRST_YEAR_PRICE}</span>
      </div>
      <div className="planrow">
        <span className="plan-name">
          Renews at
          <span className="plan-sub">automatically, each year thereafter</span>
        </span>
        <span className="plan-price">${ANNUAL_RENEWAL_PRICE}/yr</span>
      </div>
      {/* Monthly option added 2026-08-27, Jim's own drafted addition — an
          alternative plan shown for reference alongside the annual one.
          Wired to a real checkout 2026-11-04 (migration 088). Repriced
          2026-10-13 alongside the annual figures. */}
      <div className="planrow">
        <span className="plan-name">
          Monthly
          <span className="plan-sub">renews each month until canceled</span>
        </span>
        <span className="plan-price">${MONTHLY_PRICE}/mo</span>
      </div>

      <SubscriberFeatureList heading="What's included" />

      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Cancel anytime — your Subscriber features stay active through the end of the
        period you&rsquo;ve already paid for.
      </p>
    </>
  )
}

// "My Subscription" — the Subscribed-account summary. renewalDate is the
// raw ISO date string from profiles.subscription_renewal_date (migration
// 047, null for an account that has never once been a testing Subscriber);
// storageGb is the account's actual granted storage
// (profiles.subscription_storage_gb, currently always 5 — no real Buy
// Add'l purchase path exists yet).
export function MySubscriptionSummary({
  variant,
  renewalDate,
  storageGb,
  onStorageUpdated,
}: {
  variant: Variant
  renewalDate: string | null
  storageGb: number
  onStorageUpdated: (newStorageGb: number) => void
}) {
  return (
    <div style={{ margin: '0 0 4px', padding: '0 var(--pad)' }}>
      {variant === 'full' && <div className="promo-h">My Subscription</div>}
      <p className="promo-p" style={{ margin: '0 0 4px' }}>
        {variant === 'full'
          ? 'You have Subscriber features. Thank you for subscribing.'
          : 'You have subscriber features until the Renewal Date shown below.'}
      </p>

      <RenewalDatePanel renewalDate={renewalDate} />
      <AttachmentStoragePanel storageGb={storageGb} onStorageUpdated={onStorageUpdated} />
      <PlanSummaryPanel />
    </div>
  )
}
