/**
 * PRD §7.3 "Notification Email Templates" (v12.9) — subject/body rendering
 * for the Initial Request email and its day-before Reminder, plus the
 * Tight-window rule that governs both. Week 5 Priority 1 (see
 * docs/WYP_Week5_Plan.md and the 2026-08-12 decisions log entry).
 *
 * This module is pure and isomorphic — no env var access, no network call,
 * safe to import from a client component (for the Tight-window advisory UI)
 * or a server Route Handler (for the actual send). The Resend API call
 * itself, which needs RESEND_API_KEY, lives only in
 * app/api/email/send-request/route.ts — a server-only boundary, same
 * reasoning CLAUDE.md already gives for keeping service_role out of the
 * browser, applied to a secret API key instead.
 *
 * Reuses app/src/lib/ics.ts's buildIcsContent for the .ics attachment
 * (PRD: "Carries the same .ics attachment as the Calendar (.ics) attachment
 * requirement above") rather than duplicating that RFC 5545 logic a third
 * time — see the route handler.
 */

// ----------------------------------------------------------------------------
// Reminder eligibility (PRD §7.3, revised 2026-08-15) — supersedes the
// original "less than 24 hours between Send and Due" Tight-window rule
// (isTightWindow/TIGHT_WINDOW_HOURS, now removed). The PRD's own text had
// already flagged that 24-hour figure as "a proposed default, not yet
// confirmed against a specific requirement"; the owner's replacement is
// simpler and calendar-based rather than clock-precise: "trying to hit a
// precisely 24-hour preceding time to a Request Due is not necessary — a
// day-before would suffice... if a Request is set for the next day, no
// reminder is needed." Extended one step further at the owner's own
// instruction (the Reminder checkbox should grey out until there's a real
// day-before day available to send on): a Reminder is only possible when
// the Due Date is MORE than two calendar days out — i.e. Due Date <= the
// day after tomorrow is ineligible, Due Date >= three days from now is
// eligible. Pure calendar-day arithmetic (both dates truncated to local
// midnight), not hours — a Request due at 11:59 PM three days out is exactly
// as eligible as one due at 12:01 AM the same calendar day.
//
// ICS_DEFAULT_DUE_TIME is no longer needed here — Due Time never enters this
// calculation at all, per the owner's own "the wording... could be used for
// requests either without a Due Time or if there was a Due Time set."
// ----------------------------------------------------------------------------
export const MIN_DAYS_FOR_REMINDER = 3

export function isReminderEligible(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return daysUntilDue >= MIN_DAYS_FOR_REMINDER
}

// ----------------------------------------------------------------------------
// Formatting — MM-DD-YY / 12-hour time, matching the app-wide formatMDY /
// formatTime12h convention already duplicated per-component elsewhere
// (RequestDetailForm.tsx, RequestResponseForm.tsx, ...). This module is
// itself the shared home for email rendering, so there's exactly one copy
// here rather than a second duplication.
// ----------------------------------------------------------------------------
function formatMDY(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function formatTime12h(value: string): string {
  const [hStr, mStr] = value.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${ampm}`
}

// ----------------------------------------------------------------------------
// Subject — PRD: "A Would You Please Request from <sender Display Name>,
// Due: <Due Date>[ <Due Time>]" — the "from <name>" clause is omitted when
// the sender has no Display Name on file, "matching the existing .ics
// description fallback" (buildIcsDescription in ics.ts). Reminder: identical
// subject, prefixed "REMINDER: ".
// ----------------------------------------------------------------------------
export function buildRequestEmailSubject(
  kind: 'initial' | 'reminder',
  ownerName: string | null,
  dueDate: string,
  dueTime: string | null
): string {
  const from = ownerName ? ` from ${ownerName}` : ''
  const due = formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
  const base = `A Would You Please Request${from}, Due: ${due}`
  return kind === 'reminder' ? `REMINDER: ${base}` : base
}

// ----------------------------------------------------------------------------
// Body — redesigned 2026-08-16 (owner request), replacing the original PRD
// §7.3 plain-text layout. Owner: showing the bare response link was meant to
// build confidence the recipient wasn't being sent somewhere untrusted, but
// with the link sitting at the very end of the Request Description (the old
// layout), a mobile mail app's own calendar-event preview — which truncates
// a long description with an ellipsis — could hide the link entirely,
// leaving the recipient unaware a link was ever offered. New order,
// corrected same day per the owner's own follow-up (his first example had
// Description before the link; he then asked for the two reversed so the
// link is the very first thing in the body): the call-to-action link
// ("Click to respond or mark as completed") first, then the Description,
// then the conditional Reminder note, then one combined note about
// attachments/Dialog, then a closing "New to Would You Please?" signup
// link. The link text itself is now a real HTML anchor (see
// buildRequestEmailHtml) rather than a bare URL the recipient has to trust
// on sight — a clickable, labeled link plus the existing Reply-To (set to
// the sender's own account email, not a spoofed From) already gives more
// confidence than pasting the raw URL ever did.
//
// Closing link destination changed from /login to the bare site root
// (fields.siteUrl, no path) — owner's own example uses "WYP URL, currently
// https://wyp-three.vercel.app" verbatim. The original 2026-08-11 reasoning
// for linking straight to /login predates the real marketing landing page
// (LandingPage.tsx, shipped 2026-08-13) — the root URL now serves a proper
// sales-first page with its own Start Free Account / Sign In CTAs, so
// sending a new recipient there first is no longer a dead end the way it
// would have been when /login was the only thing living at "/".
// ----------------------------------------------------------------------------
type RequestEmailBodyFields = {
  description: string
  link: string
  reminderPromised: boolean
  siteUrl: string
}

// Minimal HTML-escaping for the one piece of this email that's real user
// text (the sender's own Description) — everything else here is a fixed
// string this module itself wrote. Order matters: & first, so the escapes
// just added for the other four characters don't get re-escaped.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildRequestEmailHtml(fields: RequestEmailBodyFields): string {
  const parts = [
    `<p><a href="${fields.link}">Click to respond or mark as completed</a></p>`,
    `<p>${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`,
  ]

  if (fields.reminderPromised) {
    parts.push('<p>A reminder email will arrive the day before the Due Date.</p>')
  }

  parts.push(
    '<p>You can also see any attachments and add questions or comments to this Request with the above link.</p>',
    `<p>New to <a href="${fields.siteUrl}">Would You Please</a>? click to set up a free account.</p>`
  )

  return parts.join('\n')
}

// Plain-text alternative part — not something the owner asked for by name,
// but standard multipart/alternative practice alongside an HTML body: some
// mail clients and spam filters weight a text-only message more favorably,
// and a few older/text-only clients can't render the HTML part at all.
// Same content and order as buildRequestEmailHtml, bare URLs instead of
// anchors.
export function buildRequestEmailText(fields: RequestEmailBodyFields): string {
  const lines = ['Click to respond or mark as completed:', fields.link, '', fields.description]

  if (fields.reminderPromised) {
    lines.push('', 'A reminder email will arrive the day before the Due Date.')
  }

  lines.push(
    '',
    'You can also see any attachments and add questions or comments to this Request with the above link.',
    '',
    'New to Would You Please? click to set up a free account:',
    fields.siteUrl
  )

  return lines.join('\n')
}

// ----------------------------------------------------------------------------
// From / Reply-To — PRD: "From: Would You Please's own sending domain, with
// the display name set to '<sender Display Name> via Would You Please' and
// Reply-To set to the sender's own account Email — not the sender's literal
// address as the header From, since mail providers generally reject or
// spam-flag transactional mail claiming to be From a domain they do not
// control." The sending address itself (the part after @) is
// wouldyouplease.com once Jim's domain DNS is configured.
// ----------------------------------------------------------------------------
export const EMAIL_FROM_ADDRESS = 'notifications@wouldyouplease.com'

export function buildRequestEmailFromName(ownerName: string | null): string {
  return ownerName ? `${ownerName} via Would You Please` : 'Would You Please'
}
