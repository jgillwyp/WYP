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

export const SUBSCRIBER_FEATURES: { title: string; desc: string }[] = [
  {
    title: 'Voice dictation',
    desc: 'speak your Request and ToDo Description and Dialog entries instead of typing.',
  },
  {
    title: 'File attachments',
    desc: 'send and receive documents, photos, and PDFs with your Requests and Responses.',
  },
  {
    title: '5 GB of storage',
    desc: 'for attachments — additional storage available at $10 per 5 GB per year.',
  },
  {
    title: 'Automatic Repeating',
    desc: 'for Requests and ToDos.',
  },
  {
    title: 'Request Texting',
    desc: 'deliver Requests by SMS text in addition to email.',
  },
  {
    title: 'Ad-free',
    desc: 'removes the ad banner shown to Free accounts.',
  },
  {
    title: 'Priority support',
    desc: 'via email.',
  },
]

function SubscriberFeatureList({ heading }: { heading: string }) {
  return (
    <>
      <div className="promo-sub" style={{ marginTop: 10 }}>
        {heading}
      </div>
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
export function BecomeSubscriberPitch({ variant }: { variant: Variant }) {
  const [clicked, setClicked] = useState(false)

  return (
    <div className="promo" style={{ margin: '0 0 4px' }}>
      {variant === 'full' && <div className="promo-h">Become a Subscriber</div>}

      <SubscriberFeatureList heading="Subscriber Features" />

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
