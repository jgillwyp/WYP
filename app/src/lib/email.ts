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

import { ICS_DEFAULT_DUE_TIME } from './ics'

// ----------------------------------------------------------------------------
// Tight-window rule (PRD §7.3): "if a Request's Due Date leaves less than 24
// hours between Send and Due, no day-before Reminder email is possible: the
// sender is advised of this at Send time, and the Initial Request email's
// reminder sentence is omitted." The PRD's own text flags the 24-hour figure
// itself as "a proposed default, not yet confirmed against a specific
// requirement" — still open, see docs/WYP_Week5_Plan.md.
//
// A missing Due Time falls back to ICS_DEFAULT_DUE_TIME (9:00 AM) — the same
// default the .ics attachment already uses for an unspecified time, rather
// than inventing a second convention for the same ambiguity.
// ----------------------------------------------------------------------------
export const TIGHT_WINDOW_HOURS = 24

export function isTightWindow(
  dueDate: string | null,
  dueTime: string | null,
  now: Date = new Date()
): boolean {
  if (!dueDate) return false
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  const [hh, mm] = (dueTime && dueTime.trim() !== '' ? dueTime : ICS_DEFAULT_DUE_TIME)
    .split(':')
    .map(Number)
  const due = new Date(y, m - 1, d, hh, mm)
  const hoursUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60)
  return hoursUntilDue < TIGHT_WINDOW_HOURS
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
// Body — PRD's four required parts, in order: the Request Description; a
// "Click the following link." sentence with the secure response link; a
// note that a reminder arrives the day before Due Date (omitted under the
// Tight-window rule); a note that Dialog can be added via the same link;
// and a closing link to the Would You Please product page ("destination
// not yet built" per the PRD's own text) for setting up a Free Account.
//
// Destination for that closing link: /login, not a marketing product page —
// "there is no sign-up screen... /login serves both" (CLAUDE.md's Auth
// section). This is the one live account-creation entry point that exists
// anywhere in the app today; wouldyouplease.com's own homepage/product page
// isn't built.
// ----------------------------------------------------------------------------
export function buildRequestEmailBody(fields: {
  description: string
  link: string
  tightWindow: boolean
  siteUrl: string
}): string {
  const lines = [fields.description, '', 'Click the following link.', fields.link]

  if (!fields.tightWindow) {
    lines.push('', 'A reminder email will arrive the day before the Due Date.')
  }

  lines.push(
    '',
    'You can add questions or comments to this Request as Dialog using the same link.',
    '',
    'New to Would You Please? Set up a free account:',
    `${fields.siteUrl}/login`
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
