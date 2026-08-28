'use client'

import { useState } from 'react'

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
 */
type Variant = 'full' | 'embedded'

// Title Case throughout, per Jim's own explicit list (2026-08-27): "Voice
// Dictation, File Attachments with 5 GB of Storage, Automatic Repeating,
// Request Texting, Ad-Free, and Priority Support." Supersedes the
// "Unlimited File attachments"/"Unlimited Automatic Repeating" prefixes
// added earlier the same day — now that File Attachments' own title spells
// out the 5 GB/100 MB difference directly, and the new
// SubscriberComparisonTable below carries the Free-vs-Subscribed contrast
// for Automatic Repeating (up to 5 vs. Unlimited), the prefix was
// redundant; dropped per this same instruction rather than kept alongside.
export const SUBSCRIBER_FEATURES: { title: string; desc: string }[] = [
  {
    title: 'Voice Dictation',
    desc: 'speak your Request and ToDo Description and Dialog entries instead of typing.',
  },
  {
    // File Attachments and storage merged into one bullet, 2026-08-27 —
    // Jim's own drafted wording. Previously two separate bullets.
    title: 'File Attachments with 5 GB of Storage',
    desc: 'send and receive documents, photos, and PDFs with your Requests and Responses — additional storage available at $10 per 5 GB per year.',
  },
  {
    title: 'Automatic Repeating',
    desc: 'for all Requests and ToDos.',
  },
  {
    title: 'Request Texting',
    desc: 'deliver Requests by SMS text in addition to email.',
  },
  {
    title: 'Ad-Free',
    desc: 'removes the ad banner shown to Free accounts.',
  },
  {
    title: 'Priority Support',
    desc: 'via email.',
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
 * FREE_TIER_MAX_REPEAT_OCCURRENCES). File Attachments and storage merged
 * into one bullet the same day, matching SUBSCRIBER_FEATURES' own merge. */
export const FREE_TIER_ADVANCED_FEATURES: { title: string; desc: string }[] = [
  {
    title: 'File Attachments with 100 MB of Storage',
    desc: 'send and receive documents, photos, and PDFs with your Requests and Responses — additional storage available with a subscription.',
  },
  {
    title: 'Automatic Repeating',
    desc: 'for all Requests and ToDos — up to 5 occurrences; a subscription is unlimited.',
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
const COMPARISON_ROWS: { feature: string; free: string; subscribed: string }[] = [
  { feature: 'Voice Dictation', free: 'Not available', subscribed: 'Available' },
  { feature: 'File Attachments', free: '100 MB', subscribed: '5 GB' },
  { feature: 'Automatic Repeating', free: 'up to 5', subscribed: 'Unlimited' },
  { feature: 'Request Texting', free: 'Not available', subscribed: 'Available' },
  { feature: 'Ads', free: 'Shown', subscribed: 'Not shown' },
  { feature: 'Support', free: 'Help files', subscribed: 'Email' },
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
export function BecomeSubscriberPitch({ variant }: { variant: Variant }) {
  const [clicked, setClicked] = useState(false)
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
      <p className="promo-p" style={{ margin: '4px 0 0' }}>
        1st year subscription — 25% discount, only <strong>$17.95</strong>
        <br />
        Per year subscription — <strong>$23.95</strong> thereafter
        <br />
        {/* Monthly option added 2026-08-27, Jim's own drafted addition —
            no discount attaches to it (unlike the annual plan's 1st-year
            25% off), since it's meant as a low-commitment alternative, not
            a cheaper path to the same year of service. */}
        Monthly subscription — <strong>$2.95/mo</strong>, renews each month
        until cancelled
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

      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        Cancel anytime — your Subscriber features stay active through the end of the
        period you&rsquo;ve already paid for.
      </p>
    </div>
  )
}

// Parses a plain YYYY-MM-DD as a local calendar date, not a UTC instant, so
// the displayed day never shifts a day earlier/later depending on the
// viewer's own time zone — same reasoning as every other bare "date" field
// in this app (Due Date, Done Date, Before Done Date).
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
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

// Buy-Add'l pricing rule, confirmed with Jim: less than 6 months remaining
// until the Renewal Date -> $5 per 5 GB block (discounted); otherwise $10
// per 5 GB block. No known Renewal Date (shouldn't normally happen once
// migration 047 is backfilling it, but defensive) reads as the normal,
// undiscounted rate.
function isWithinSixMonths(renewalDate: string | null): boolean {
  if (!renewalDate) return false
  const sixMonthsOut = new Date()
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6)
  return parseIsoDate(renewalDate).getTime() <= sixMonthsOut.getTime()
}

function computeAddlStoragePrice(renewalDate: string | null, targetGb: 5 | 10): number {
  const perBlock = isWithinSixMonths(renewalDate) ? 5 : 10
  return (targetGb / 5) * perBlock
}

function RenewalDatePanel({ renewalDate }: { renewalDate: string | null }) {
  const [clicked, setClicked] = useState(false)
  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        Renewal Date
      </div>
      <div className="donerow" style={{ margin: '4px 0 0' }}>
        <span className="donenote">{formatRenewalDate(renewalDate)}</span>
        <button type="button" className="btn" onClick={() => setClicked(true)}>
          Cancel Renewal
        </button>
      </div>
      {clicked && (
        <p className="promo-p" style={{ margin: '6px 0 0' }}>
          Subscription changes aren&rsquo;t available yet — check back soon.
        </p>
      )}
    </>
  )
}

function AttachmentStoragePanel({
  renewalDate,
  storageGb,
}: {
  renewalDate: string | null
  storageGb: number
}) {
  const [targetGb, setTargetGb] = useState<5 | 10>(5)
  const [clicked, setClicked] = useState(false)
  const price = computeAddlStoragePrice(renewalDate, targetGb)

  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        Attachment Storage Space
      </div>
      <p className="promo-p" style={{ margin: '4px 0 8px' }}>
        Current: <strong>{storageGb} Gigabytes</strong>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="chips" role="group" aria-label="Additional storage size">
          <button
            type="button"
            className={`chip${targetGb === 5 ? ' sel' : ''}`}
            onClick={() => setTargetGb(5)}
          >
            5 GB
          </button>
          <button
            type="button"
            className={`chip${targetGb === 10 ? ' sel' : ''}`}
            onClick={() => setTargetGb(10)}
          >
            10 GB
          </button>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setClicked(true)}
        >
          Buy Add&rsquo;l (${price})
        </button>
      </div>
      <p className="promo-p" style={{ margin: '8px 0 0' }}>
        If less than 6 months remain until your Renewal Date, Additional Storage is
        discounted to $5 per 5 GB for that period; otherwise it&rsquo;s $10 per 5 GB, added
        to your annual subscription renewal cost.
      </p>
      {clicked && (
        <p className="promo-p" style={{ margin: '6px 0 0' }}>
          Subscription checkout isn&rsquo;t available yet — check back soon.
        </p>
      )}
    </>
  )
}

function PlanSummaryPanel() {
  return (
    <>
      <div className="promo-sub" style={{ marginTop: 12 }}>
        Plan Summary
      </div>
      <div className="planrow">
        <span className="plan-name">
          Subscriber — 1st year
          <span className="plan-sub">25% discount, billed today</span>
        </span>
        <span className="plan-price">$17.95</span>
      </div>
      <div className="planrow">
        <span className="plan-name">
          Renews at
          <span className="plan-sub">automatically, each year thereafter</span>
        </span>
        <span className="plan-price">$23.95/yr</span>
      </div>
      {/* Monthly option added 2026-08-27, Jim's own drafted addition — an
          alternative plan shown for reference alongside the annual one,
          not a live plan switch (no checkout path exists for either yet). */}
      <div className="planrow">
        <span className="plan-name">
          Monthly
          <span className="plan-sub">renews each month until cancelled</span>
        </span>
        <span className="plan-price">$2.95/mo</span>
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
}: {
  variant: Variant
  renewalDate: string | null
  storageGb: number
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
      <AttachmentStoragePanel renewalDate={renewalDate} storageGb={storageGb} />
      <PlanSummaryPanel />
    </div>
  )
}
