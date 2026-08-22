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
// Branded HTML wrapper (2026-08-22, owner request) — every HTML email body
// this module builds gets passed through wrapEmailHtml() before being sent,
// so the logo/colors live in one place rather than six. Table-based layout,
// every rule inline — no <style> block, no flexbox/grid, since Outlook
// desktop's Word rendering engine ignores both; this is the same
// lowest-common-denominator approach every transactional-email guide
// recommends. Logo is a PNG (public/email/wyp-logo-horizontal-dark.png,
// rasterized from the canonical wyp_logo_horizontal_dark_bg.svg asset
// source at 3.7x its 220px display width for retina sharpness, same
// rasterize-high-display-small pattern already used for the PWA icons,
// public/icons/icon-source.svg -> icon-192.png/icon-512.png) — SVG isn't
// reliably supported in an email <img> (Outlook desktop doesn't render it
// at all), so this follows the same PNG-fallback convention.
//
// Confirmed with the owner: brand-blue header band with the logo's white/
// light-blue "dark background" variant reversed out of it, not a white
// header with the outlined variant — see the decisions log for the
// rejected alternative.
//
// siteUrl is required on every field type from here down (added to
// TodoReminderEmailFields and the two digest builders' own signatures,
// neither of which needed it before this batch) purely to build the
// absolute logo URL — email clients don't resolve a relative image path.
// ----------------------------------------------------------------------------
const EMAIL_BRAND_BLUE = '#2A5FC8'
const EMAIL_INK = '#1F2933'
const EMAIL_LOGO_PATH = '/email/wyp-logo-horizontal-dark.png'

function wrapEmailHtml(siteUrl: string, bodyHtml: string): string {
  const logoUrl = `${siteUrl}${EMAIL_LOGO_PATH}`
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<body style="margin:0; padding:0; background:#F4F5F7;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:10px; overflow:hidden; font-family:Arial, Helvetica, sans-serif;">`,
    `<tr><td style="background:${EMAIL_BRAND_BLUE}; padding:20px 24px;"><img src="${logoUrl}" width="220" alt="Would You Please" style="display:block; border:0; outline:none; width:220px; max-width:100%; height:auto;"></td></tr>`,
    `<tr><td style="padding:28px 24px; color:${EMAIL_INK}; font-size:15px; line-height:1.5;">`,
    bodyHtml,
    '</td></tr>',
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ].join('\n')
}

// A single primary call-to-action rendered as a filled brand-blue button —
// every email here has exactly one (Click to respond, Open Request, Open
// ToDo); a digest's own per-row links stay plain text (a button per <li>
// in a list of several reads as visual noise, plain brand-blue link text
// doesn't).
function emailButton(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block; background:${EMAIL_BRAND_BLUE}; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:15px; padding:12px 22px; border-radius:8px; font-family:Arial, Helvetica, sans-serif;">${text}</a>`
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
    `<p style="margin:0 0 18px;">${emailButton(fields.link, 'Click to respond or mark as completed')}</p>`,
    `<p style="margin:0 0 14px;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`,
  ]

  if (fields.reminderPromised) {
    parts.push('<p style="margin:0 0 14px;">A reminder email will arrive the day before the Due Date.</p>')
  }

  parts.push(
    '<p style="margin:0 0 14px;">You can also see any attachments and add questions or comments to this Request with the above link.</p>',
    `<p style="margin:0; color:#5A6675; font-size:13px;">New to <a href="${fields.siteUrl}" style="color:${EMAIL_BRAND_BLUE};">Would You Please</a>? click to set up a free account.</p>`
  )

  return wrapEmailHtml(fields.siteUrl, parts.join('\n'))
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

// ============================================================================
// Chron notification templates — day-before Reminders (ToDos), individual
// Overdue notices/nudges (Recipients), and the two Requestor-facing digests.
// Added 2026-08-17 alongside app/api/cron/tick/route.ts and migration 032.
// Owner's own design pass (2026-08-17 chat) — see that migration's header
// comment and the decisions log for the full requirements. All pure/
// isomorphic, same reasoning as the rest of this module: no env access, no
// network call, safe to import from the cron route or (in principle) a
// future UI preview.
// ============================================================================

// ----------------------------------------------------------------------------
// Overdue notice/nudge — sent to a Request's Recipient. One template covers
// both the first individual Overdue notice (owner's own ask: "Individual
// emails would be sent to Recipients when a Request is overdue") and every
// later hourly/daily nudge for a Due-Time Request (owner: "an hourly process
// could send a reminder email to the Recipient advising them the Due Date
// and Time have passed... providing a link to do so") — the wording already
// works unchanged for a repeat send, so there's no separate "nudge" template.
// ----------------------------------------------------------------------------
type OverdueRecipientEmailFields = {
  ownerName: string | null
  description: string
  dueDate: string
  dueTime: string | null
  link: string
  siteUrl: string
}

export function buildOverdueRecipientEmailSubject(
  ownerName: string | null,
  dueDate: string,
  dueTime: string | null
): string {
  const from = ownerName ? ` from ${ownerName}` : ''
  const due = formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
  return `OVERDUE: A Would You Please Request${from}, Due: ${due}`
}

// Link text — changed 2026-08-19 (owner's own concern: generic "Request
// Detail" anchor text on an unsolicited-feeling Overdue notice risked being
// reported as spam). This is the recipient's own /r/[token] link (see
// mintLink in app/api/cron/tick/route.ts) — the recipient can both mark the
// Request Done there and, as of migration 036/RequestResponseForm.tsx's own
// Reminder checkbox (2026-08-19), opt out of further Reminder emails, so the
// action-oriented wording is literally true, not just friendlier-sounding.
const OVERDUE_LINK_TEXT = 'Open Request to mark Done or to turn off notifications'

export function buildOverdueRecipientEmailHtml(fields: OverdueRecipientEmailFields): string {
  const due = formatMDY(fields.dueDate) + (fields.dueTime ? ` ${formatTime12h(fields.dueTime)}` : '')
  const body = [
    `<p style="margin:0 0 18px;">The Due Date${fields.dueTime ? '/Time' : ''} for this Request has passed (${due}) and it has not been reported as Done.</p>`,
    `<p style="margin:0 0 18px;">${emailButton(fields.link, OVERDUE_LINK_TEXT)}</p>`,
    `<p style="margin:0 0 14px;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`,
    `<p style="margin:0; color:#5A6675; font-size:13px;">New to <a href="${fields.siteUrl}" style="color:${EMAIL_BRAND_BLUE};">Would You Please</a>? click to set up a free account.</p>`,
  ].join('\n')
  return wrapEmailHtml(fields.siteUrl, body)
}

export function buildOverdueRecipientEmailText(fields: OverdueRecipientEmailFields): string {
  const due = formatMDY(fields.dueDate) + (fields.dueTime ? ` ${formatTime12h(fields.dueTime)}` : '')
  return [
    `The Due Date${fields.dueTime ? '/Time' : ''} for this Request has passed (${due}) and it has not been reported as Done.`,
    '',
    `${OVERDUE_LINK_TEXT}:`,
    fields.link,
    '',
    fields.description,
    '',
    'New to Would You Please? click to set up a free account:',
    fields.siteUrl,
  ].join('\n')
}

// ----------------------------------------------------------------------------
// ToDo day-before Reminder — sent to the owner's own account email (a ToDo
// has no Recipient). Gated entirely on todo_dates_enabled by the cron route,
// not by any per-ToDo checkbox (owner: "Gated on ToDo Dates enabled").
// ----------------------------------------------------------------------------
type TodoReminderEmailFields = {
  description: string
  dueDate: string
  link: string
  siteUrl: string
}

export function buildTodoReminderEmailSubject(dueDate: string): string {
  return `REMINDER: Your Would You Please ToDo, Due: ${formatMDY(dueDate)}`
}

// Link text — changed 2026-08-19, same spam-risk reasoning as
// OVERDUE_LINK_TEXT above, but a ToDo has no per-item Reminder toggle
// (todo_dates_enabled gates the whole feature, not a checkbox on any one
// ToDo — see TodoDetailForm.tsx, which carries no Reminder control at all),
// so this wording only promises what's actually there: marking it Done.
const TODO_REMINDER_LINK_TEXT = 'Open ToDo to mark Done'

export function buildTodoReminderEmailHtml(fields: TodoReminderEmailFields): string {
  const body = [
    `<p style="margin:0 0 18px;">This ToDo is due tomorrow, ${formatMDY(fields.dueDate)}.</p>`,
    `<p style="margin:0 0 18px;">${emailButton(fields.link, TODO_REMINDER_LINK_TEXT)}</p>`,
    `<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`,
  ].join('\n')
  return wrapEmailHtml(fields.siteUrl, body)
}

export function buildTodoReminderEmailText(fields: TodoReminderEmailFields): string {
  return [
    `This ToDo is due tomorrow, ${formatMDY(fields.dueDate)}.`,
    '',
    `${TODO_REMINDER_LINK_TEXT}:`,
    fields.link,
    '',
    fields.description,
  ].join('\n')
}

// ----------------------------------------------------------------------------
// Requestor-facing digests — one row per Request, each with a "Request
// Detail" link (owner's own specified link title, reused verbatim from the
// Overdue-Recipient template above). Two digests share this one row shape
// and HTML/text list-building logic, differing only in subject line and
// intro sentence:
//   - Reminders-sent digest (opt-in, profiles.reminder_digest_enabled) —
//     owner: "The Email could report the Recipient Name, the Request
//     Description and the Due Time if used."
//   - New-Overdue digest (not gated by any toggle) — owner: "the email
//     should state something along those lines, e.g., 'Requests that just
//     became Overdue'" — new items only, never a repeat of yesterday's list.
// ----------------------------------------------------------------------------
export type DigestItem = {
  recipientName: string
  description: string
  dueTime: string | null
  link: string
}

// Link text — changed 2026-08-19, same reasoning and wording as
// OVERDUE_LINK_TEXT above. These digest rows link to the same /r/[token]
// recipient path (see pushDigestItem/mintLink in
// app/api/cron/tick/route.ts) — the Requestor reading the digest is
// clicking through to their own Recipient's response screen, where Done and
// the Reminder checkbox both genuinely live.
function digestRowHtml(item: DigestItem): string {
  const time = item.dueTime ? ` &nbsp; ${formatTime12h(item.dueTime)}` : ''
  return `<li style="margin-bottom:10px;"><b>${escapeHtml(item.recipientName)}</b> — ${escapeHtml(item.description)}${time} — <a href="${item.link}" style="color:${EMAIL_BRAND_BLUE}; font-weight:600;">${OVERDUE_LINK_TEXT}</a></li>`
}

function digestRowText(item: DigestItem): string {
  const time = item.dueTime ? `  ${formatTime12h(item.dueTime)}` : ''
  return `${item.recipientName} — ${item.description}${time} — ${OVERDUE_LINK_TEXT}: ${item.link}`
}

export function buildReminderDigestEmailSubject(): string {
  return 'Would You Please: Reminders Sent to Recipients'
}

export function buildReminderDigestEmailHtml(items: DigestItem[], siteUrl: string): string {
  const body = [
    '<p style="margin:0 0 16px;">A day-before Reminder email was just sent to the Recipient of each of these Requests:</p>',
    `<ul style="margin:0; padding-left:20px;">${items.map(digestRowHtml).join('\n')}</ul>`,
  ].join('\n')
  return wrapEmailHtml(siteUrl, body)
}

export function buildReminderDigestEmailText(items: DigestItem[]): string {
  return [
    'A day-before Reminder email was just sent to the Recipient of each of these Requests:',
    '',
    ...items.map(digestRowText),
  ].join('\n')
}

export function buildOverdueDigestEmailSubject(): string {
  return 'Would You Please: Requests That Just Became Overdue'
}

export function buildOverdueDigestEmailHtml(items: DigestItem[], siteUrl: string): string {
  const body = [
    '<p style="margin:0 0 16px;">These Requests just became Overdue — their Due Date has passed and they have not been reported as Done:</p>',
    `<ul style="margin:0; padding-left:20px;">${items.map(digestRowHtml).join('\n')}</ul>`,
  ].join('\n')
  return wrapEmailHtml(siteUrl, body)
}

export function buildOverdueDigestEmailText(items: DigestItem[]): string {
  return [
    'These Requests just became Overdue — their Due Date has passed and they have not been reported as Done:',
    '',
    ...items.map(digestRowText),
  ].join('\n')
}
