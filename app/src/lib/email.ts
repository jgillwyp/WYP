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

// Added 2026-08-22 — owner: on Create Request/Request Detail, the "morning
// before" Reminder checkbox shouldn't need a Contact selected first (only to
// know the recipient's time zone) if the Due Date already has a wide enough
// margin that a time-zone shift can't push it out of eligibility either way.
// One day of buffer past MIN_DAYS_FOR_REMINDER's own 3-day floor comfortably
// absorbs any real-world zone difference (at most a calendar day). Below
// this threshold, Contact is still required — close to the floor, a zone
// shift really could flip eligibility, so the UI keeps asking for it.
export const MIN_DAYS_TO_SKIP_CONTACT_CHECK = 4

export function hasAmpleReminderLeadTime(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return daysUntilDue >= MIN_DAYS_TO_SKIP_CONTACT_CHECK
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
//
// Revised 2026-08-22, same day, from the owner's own screenshots of the
// first version rendered in Outlook Web and Gmail: (1) card widened from
// 600px to 1200px and left-aligned rather than centered — the owner's own
// call, a deliberate departure from the 600px-safe-width convention most
// transactional-email guides recommend, since he wanted more breathing
// room than a centered 600px card gives on a wide reading pane. (2) The
// body area's background is now Strip (--strip, #E5ECF7, the same token
// the live app uses for Row Tint/optional-field backgrounds) instead of
// plain white, with the Request/ToDo Description itself highlighted in a
// white box (buildDescriptionBox()) so it visually pops against the
// Strip backdrop — same white-vs-tint contrast language the app's own UI
// already uses. (3) The closing "New to Would You Please?" line is now a
// standalone, larger, Blue-Pressed-colored (--blue-pressed, #1E4AA0)
// question, with its own emailButton() below reading "Learn more or set
// up a free account" — previously a single small inline sentence with an
// embedded text link.
// ----------------------------------------------------------------------------
const EMAIL_BRAND_BLUE = '#2A5FC8'
const EMAIL_BLUE_PRESSED = '#1E4AA0'
const EMAIL_STRIP = '#E5ECF7'
const EMAIL_INK = '#1F2933'
// Switched from the white-reversed "dark_bg" logo variant to the brand-blue/
// navy "light_bg" variant, 2026-08-22, per Jim's own clarification: the
// header band itself is now Strip-colored (matching the rest of the card),
// not brand-blue, so the logo needs the counterpart asset meant for a light
// background — see wyp_assets_source.md's own `wyp_logo_horizontal_light_
// bg.svg` entry (Project knowledge base), copied into public/email/ the
// same way the dark variant was.
//
// This copy of the wordmark diverges from the canonical asset in two ways,
// both scoped to public/email/wyp-logo-horizontal-light.svg only — not
// proposed as a change to wyp_assets_source.md or the live app's own header
// (LandingPage.tsx), which render it as real vector SVG rather than a fixed-
// resolution raster and may not have the same problem:
//   1. Wordmark font-weight 800 -> 700. Jim's own test, at increasing
//      display widths (220 -> 340 -> 480px), kept reading as "letters run
//      together" regardless of size — the tell that this was never a
//      resolution/blur problem sizing could fix, but Arial's synthetic-bold
//      rendering at weight 800 visually crowding adjacent glyphs once
//      rasterized. 700 reads as clearly separated letterforms at every size
//      tested.
//   2. viewBox/canvas widened 820x220 -> 900x220. Attempts to *loosen*
//      letter-spacing (from the canonical -0.5 up toward 0 or positive)
//      to fix the same symptom instead clipped the wordmark against the
//      right edge of the 820-wide canvas — this rasterizer (ImageMagick's
//      librsvg delegate) appears to apply letter-spacing values much more
//      aggressively than a browser would, so even a small positive value
//      pushed "Please" partly off-canvas. Left letter-spacing at 0 (safe,
//      predictable) and gave the wordmark 80 extra units of room instead —
//      the mark and text block's own coordinates are unchanged, only the
//      canvas got wider. Verified visually (Read tool) before finalizing,
//      not just by inspecting the SVG source.
// Cache-busted with a trailing ?v= — the path itself never changes across
// edits to the underlying PNG, and both Outlook's own image proxy (which
// fetches and caches external images server-side, keyed by URL) and some
// mobile mail clients hold onto that cached copy well past when the file on
// disk changed. Jim confirmed this exact symptom 2026-08-22: two of three
// fixes in one deploy showed correctly (no border, tighter spacing) while
// the third (wider tagline) kept showing the old, smaller version — since
// all three shipped in the same file, a stale deploy can't explain a partial
// result, but a stale cached image can. Bump the version number any time
// this PNG's pixel content changes; a new query string is a new cache key.
const EMAIL_LOGO_PATH = '/email/wyp-logo-horizontal-light.png?v=2'

// Root-caused 2026-08-22, from Jim's own Outlook Web screenshot showing a
// broken-image icon in the header band: wouldyouplease.com (the bare apex
// domain, no "www") 308-redirects to www.wouldyouplease.com at the Vercel
// domain-config level — confirmed directly by fetching the logo URL through
// both hosts. A clicked link (the "Click to respond" button, or the closing
// signup button) follows a redirect like this transparently in every mail
// client, but a hotlinked <img src> does not always survive one — Outlook
// Web's own image proxy is the one that visibly failed on it. NEXT_PUBLIC_
// SITE_URL is presumably set to the bare apex form, which every email in
// this module inherits as its own siteUrl. Rather than depend on Jim
// changing that env var (which would fix this but is a Vercel dashboard
// change outside this codebase), the logo URL specifically is normalized to
// the www host here — narrow enough that a local/preview siteUrl (localhost,
// a *.vercel.app preview) is untouched, since neither hostname matches.
function emailAssetUrl(siteUrl: string, path: string): string {
  try {
    const u = new URL(siteUrl)
    if (u.hostname === 'wouldyouplease.com') u.hostname = 'www.wouldyouplease.com'
    return `${u.origin}${path}`
  } catch {
    return `${siteUrl}${path}`
  }
}

function wrapEmailHtml(siteUrl: string, bodyHtml: string): string {
  const logoUrl = emailAssetUrl(siteUrl, EMAIL_LOGO_PATH)
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<body style="margin:0; padding:0; background:#F4F5F7;">',
    // Outer wrapper padding removed and the card's own HTML width attribute
    // changed from a fixed "1200" to "100%", 2026-08-22, seventh same-day
    // follow-up — Jim's own phone screenshots: the 24px/12px outer padding
    // plus a fixed pixel width attribute meant several mobile mail apps
    // rendered the full 1200px-wide table at its literal size and shrank
    // the whole thing to fit the screen, leaving grey letterboxing down
    // both sides that ate roughly a third of the usable width. A fixed
    // HTML width attribute is what old desktop clients (Outlook's Word
    // engine) fall back to when they ignore CSS, but it's exactly what
    // defeats `max-width` on a client that *does* respect it — the
    // standard fluid-table fix is to keep the pixel cap in `style` only
    // and let the HTML attribute itself say "100%", so the table is
    // genuinely fluid up to 1200px rather than fixed-then-scaled.
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="left" style="padding:0;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1200px; width:100%; background:${EMAIL_STRIP}; border-radius:10px; overflow:hidden; font-family:Arial, Helvetica, sans-serif;">`,
    // Logo width history: 220 -> 340 -> 480 -> 300px, 2026-08-22, fourth
    // same-day follow-up. 480px was itself the overcorrection — Jim's next
    // test called it "larger than desired" and flagged too much vertical
    // space in the header. The real fix for "letters run together" turned
    // out not to be size at all (see EMAIL_LOGO_PATH's comment: the
    // wordmark's own font-weight was the actual cause), so once that was
    // fixed at the source, the display width could come back down — 300px
    // is comfortably smaller than either prior attempt.
    //
    // Header band switched from brand-blue to Strip, same day, third
    // follow-up — Jim's own clarification: the logo's background in his
    // reference mockup is the same Strip color already used for the rest
    // of the card, with the logo itself in its normal brand-blue/navy
    // "light background" coloring rather than the white-reversed "dark
    // background" variant. See EMAIL_LOGO_PATH's own comment above. Header
    // padding cut from 28px to 16px (top/bottom) in the same pass, to
    // directly address "too much vertical space" — the smaller logo alone
    // already reduces the header's height substantially, since it scales
    // with width, but the padding was worth trimming too.
    // Vertical gap between the logo and the button tightened, same
    // follow-up — header bottom padding 16px -> 8px, body top padding
    // 28px -> 8px (its bottom/side padding is untouched, so the rest of
    // the body's own spacing is unaffected).
    `<tr><td style="background:${EMAIL_STRIP}; padding:16px 24px 8px;"><img src="${logoUrl}" width="300" alt="Would You Please" style="display:block; border:0; outline:none; width:300px; max-width:100%; height:auto;"></td></tr>`,
    `<tr><td style="padding:8px 24px 28px; color:${EMAIL_INK}; font-size:15px; line-height:1.5;">`,
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
// ToDo, or the closing signup CTA); a digest's own per-row links stay
// plain text (a button per <li> in a list of several reads as visual
// noise, plain brand-blue link text doesn't).
//
// emailButtonRaw takes inner HTML rather than plain text, so
// buildRequestEmailHtml can nest a de-emphasized <span> around the
// Requestor's own name inside the button (2026-08-22) without that name
// fighting the rest of the label for visual weight. emailButton is the
// plain-text convenience wrapper every other call site still uses.
function emailButtonRaw(href: string, innerHtml: string): string {
  return `<a href="${href}" style="display:inline-block; background:${EMAIL_BRAND_BLUE}; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:15px; padding:12px 22px; border-radius:8px; font-family:Arial, Helvetica, sans-serif;">${innerHtml}</a>`
}

function emailButton(href: string, text: string): string {
  return emailButtonRaw(href, text)
}

// Highlights the sender's own Description text in a white box against the
// Strip-colored body — the one piece of real user content in every email
// that includes it, so it's the one thing given its own visual weight.
function emailDescriptionBox(html: string): string {
  return `<div style="background:#FFFFFF; border-radius:8px; padding:14px 16px; margin:0 0 14px;">${html}</div>`
}

// Closing "New to Would You Please?" signup CTA — a standalone question in
// Blue Pressed, larger than body text, followed by its own button (not an
// inline text link) below it.
function emailSignupFooter(siteUrl: string): string {
  return [
    `<p style="margin:18px 0 8px; font-size:17px; font-weight:700; color:${EMAIL_BLUE_PRESSED};">New to Would You Please?</p>`,
    `<p style="margin:0;">${emailButton(siteUrl, 'Learn more or set up a free account')}</p>`,
  ].join('\n')
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
// 'reminder_day_of' added 2026-08-22 (owner's own follow-up to the itemized-
// docx batch) — the third Reminders-until-Done checkbox, "Day of." Reuses
// this same subject builder and the same buildRequestEmailHtml/Text body
// as 'reminder' (the day-before Reminder) — only the subject prefix differs
// ("DUE TODAY:" rather than "REMINDER:"), since "reminder" as a prefix on
// an email arriving the same morning something is due reads as ambiguous
// about how much runway is left; "DUE TODAY" doesn't.
// 'updated' added 2026-09-02 (owner request, with his own mocked-up email
// screenshot) — sent to the Recipient whenever the owner edits an existing
// Request via Request Detail. Reuses this same subject builder/prefix
// convention rather than a separate function, matching 'reminder'/
// 'reminder_day_of''s own precedent.
export function buildRequestEmailSubject(
  kind: 'initial' | 'reminder' | 'reminder_day_of' | 'updated',
  ownerName: string | null,
  dueDate: string,
  dueTime: string | null
): string {
  const from = ownerName ? ` from ${ownerName}` : ''
  const due = formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
  const base = `A Would You Please Request${from}, Due: ${due}`
  if (kind === 'reminder') return `REMINDER: ${base}`
  if (kind === 'reminder_day_of') return `DUE TODAY: ${base}`
  if (kind === 'updated') return `UPDATED: ${base}`
  return base
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
// Change-notification fields (2026-09-02, owner request, with his own
// mocked-up email screenshot — "I think all changes warrant an email to the
// other party... We don't currently need an option not to send an email.")
// — every edit to an existing Request's tracked fields, or an added Dialog
// entry/Attachment, sends an "UPDATED:" email to the other party (owner
// edits -> Recipient; Recipient edits -> owner). CHANGED_FIELD_LABELS is the
// one canonical vocabulary both the owner-to-Recipient and Recipient-to-
// owner email builders below draw from, and the one allow-list the two API
// routes validate a client-supplied field list against before it can appear
// in an email sent to a third party — a client can only ever request one of
// these fixed labels, never arbitrary text. Deliberately excludes the
// Reminders-until-Done checkboxes and Repeat (both a sender's own internal
// preference, not something the PRD's or Jim's own mockup described
// reporting) — flagged as a scoping call, not a literal instruction.
export const CHANGED_FIELD_LABELS = [
  'Due Date',
  'Due Time',
  'Description',
  'Category',
  'Done Date',
  'Done Time',
  'Dialog',
  'Attachments',
] as const
export type ChangedFieldLabel = (typeof CHANGED_FIELD_LABELS)[number]

export function sanitizeChangedFields(fields: unknown): ChangedFieldLabel[] {
  if (!Array.isArray(fields)) return []
  const allowed = new Set<string>(CHANGED_FIELD_LABELS)
  const seen = new Set<string>()
  const out: ChangedFieldLabel[] = []
  for (const f of fields) {
    if (typeof f !== 'string' || !allowed.has(f) || seen.has(f)) continue
    seen.add(f)
    out.push(f as ChangedFieldLabel)
  }
  return out
}

// Singular/plural-aware "what changed" sentence, plain text (no markup) —
// shared by both the HTML box below and the plain-text builders, so the
// one field/fields distinction only has to be written once. 2026-09-02,
// owner-reported: a single changed field ("Due Date") had read "The
// following data fields... has changed" — wrong grammar either way, since
// the old wording never varied "field(s)"/"has"/"have" on count.
function changedFieldsSentence(fields: string[], list: string): string {
  const noun = fields.length === 1 ? 'data field' : 'data fields'
  const verb = fields.length === 1 ? 'has' : 'have'
  return `The following ${noun} for this Request ${verb} changed: ${list}.`
}

// Notice box for the "what changed" sentence plus the button, grouped
// together in one white callout against the Strip-colored body — matches
// Jim's own mocked-up screenshot, which shows the sentence directly above
// the button inside one highlighted box. Reuses emailDescriptionBox's own
// white-box treatment rather than a new visual language.
function emailChangedFieldsBox(fields: string[], buttonHtml: string): string {
  const list = fields.map((f) => `<b>${escapeHtml(f)}</b>`).join(', ')
  return [
    '<div style="background:#FFFFFF; border-radius:8px; padding:14px 16px; margin:0 0 18px;">',
    `<p style="margin:0 0 12px;">${changedFieldsSentence(fields, list)}</p>`,
    `<p style="margin:0;">${buttonHtml}</p>`,
    '</div>',
  ].join('\n')
}

type RequestEmailBodyFields = {
  description: string
  link: string
  // Set only for the 'updated' subject kind — see emailChangedFieldsBox
  // above. null/omitted (every other kind) renders the button on its own,
  // unchanged from before this batch.
  changedFields?: string[] | null
  // Replaced 2026-08-22 (second same-day follow-up) — was a single boolean
  // (reminderPromised) gating one fixed "day before" sentence. Now a full
  // ReminderSchedule describing all three independent Reminders-until-Done
  // checkboxes, since the old sentence went stale the moment "Day of" and
  // "Daily thereafter" existed as options of their own. null/undefined
  // omits the sentence entirely — used by the day-before/day-of Reminder
  // emails themselves (app/api/cron/tick/route.ts Phases A1/A1b), which
  // don't restate the full schedule inside a reminder that's already part
  // of it. A real ReminderSchedule value always renders a sentence, even
  // when every flag is false, per Jim's own explicit "none" example — the
  // Initial Request email (the only current caller that supplies one)
  // should say "no Reminders" rather than stay silent about it.
  reminderSchedule?: ReminderSchedule | null
  siteUrl: string
  // Added 2026-08-22 (same-day follow-up): the reminder sentence now names
  // the actual Due Date/Time it's promising, and the CTA button now names
  // the Requestor, per Jim's own literal wording — both need data this
  // type didn't previously carry through from the caller.
  dueDate: string
  dueTime: string | null
  ownerName: string | null
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

// Both the button text and the reminder sentence below were extended
// 2026-08-22 per Jim's own literal wording: "Click to respond or mark this
// Request from <RequestorName> as completed" (the Requestor's name nested
// inline, since Outlook/Gmail both render the Subject line far enough from
// the body that Jim didn't want to rely on it alone for "whose Request is
// this"), and "A reminder email will arrive the day before the Due Date of
// <DueDate>." / "...Due Date and Time of <DueDate> <DueTime>." when a Due
// Time is set.
//
// The name was originally wrapped in a de-emphasized <span style="font-
// weight:400;">, on the reasoning that a lighter weight would read as a
// secondary detail rather than competing with the core instruction —
// reversed same day per Jim's own test: against the button's bold 700
// weight, the unbolded name read as a rendering/formatting error rather
// than an intentional style choice. The name is now the same weight as
// the rest of the label.
// Replaced 2026-08-22 (second same-day follow-up), then simplified again
// the same day when "Daily thereafter" itself was retired — Jim's own
// spam-complaint concern about an open-ended recurring nudge — in favor of
// a single-shot "Day after" notice, the direct replacement for what used
// to be the automatic Overdue-transition email (cron Phase B/C). This
// collapses what had been a deliberately asymmetric three-way branch (Day
// before/Day of took an "on the day ___" phrase, Daily thereafter took a
// bare adverb with no "on") into one uniform shape — all three Reminder
// types are now "on the day ___", so a single withOn() helper handles
// every case:
//   none:      "...you are scheduled to receive no Reminders."
//   one:       "...Reminders only on the day before." / "...only on the
//              day of." / "...only on the day after."
//   two:       "...Reminders: <A> and <B>." (whichever two)
//   all three: "...Reminders: the day before, the day of, and the day
//              after."
//
// Jim confirmed separately: the "Day of" Reminder needs no Due-Time-passed
// check of its own — a morning-of notice is sufficient regardless of
// whether the Due Time later passes that same day; the new "Day after"
// notice (once, the calendar day following Due Date) is what covers a
// lapsed Due Time, not a same-day check.
//
// Exported so app/src/lib/ics.ts's buildIcsDescription (the .ics
// attachment's own DESCRIPTION field, kept deliberately in sync with this
// email body's wording since 2026-08-16) can call this directly rather
// than duplicate an 8-branch sentence generator a second time and risk the
// two drifting apart — the same kind of exception ics.ts's own module
// comment already carves out of this app's usual per-file-duplication
// convention for exactly this reason (shared, non-trivial logic with more
// than one real caller).
export type ReminderSchedule = {
  dayBefore: boolean
  dayOf: boolean
  dayAfter: boolean
}

export function buildReminderScheduleSentence(
  dueDate: string,
  dueTime: string | null,
  schedule: ReminderSchedule
): string {
  const due = formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
  const dateLabel = dueTime && dueTime.trim() !== '' ? 'Due Date and Time' : 'Due Date'
  const prefix = `For the ${dateLabel} of ${due}, you are scheduled to receive `

  type Key = 'dayBefore' | 'dayOf' | 'dayAfter'
  const active: Key[] = []
  if (schedule.dayBefore) active.push('dayBefore')
  if (schedule.dayOf) active.push('dayOf')
  if (schedule.dayAfter) active.push('dayAfter')

  if (active.length === 0) return `${prefix}no Reminders.`

  const noun = (key: Key): string => (key === 'dayBefore' ? 'day before' : key === 'dayOf' ? 'day of' : 'day after')
  const withOn = (key: Key): string => `on the ${noun(key)}`

  if (active.length === 1) return `${prefix}Reminders only ${withOn(active[0])}.`
  if (active.length === 2) return `${prefix}Reminders: ${withOn(active[0])} and ${withOn(active[1])}.`
  return `${prefix}Reminders: the day before, the day of, and the day after.`
}

export function buildRequestEmailHtml(fields: RequestEmailBodyFields): string {
  const buttonInner = fields.ownerName
    ? `Click to respond or mark this Request from ${escapeHtml(fields.ownerName)} as completed`
    : 'Click to respond or mark this Request as completed'

  const buttonHtml = emailButtonRaw(fields.link, buttonInner)
  const parts =
    fields.changedFields && fields.changedFields.length > 0
      ? [emailChangedFieldsBox(fields.changedFields, buttonHtml)]
      : [`<p style="margin:0 0 18px;">${buttonHtml}</p>`]
  parts.push(emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`))

  if (fields.reminderSchedule) {
    parts.push(
      `<p style="margin:0 0 14px;">${buildReminderScheduleSentence(fields.dueDate, fields.dueTime, fields.reminderSchedule)}</p>`
    )
  }

  parts.push(
    '<p style="margin:0 0 14px;">You can also see any attachments and add questions or comments to this Request with the above link.</p>',
    emailSignupFooter(fields.siteUrl)
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
  const buttonLine = fields.ownerName
    ? `Click to respond or mark this Request from ${fields.ownerName} as completed:`
    : 'Click to respond or mark this Request as completed:'
  const lines =
    fields.changedFields && fields.changedFields.length > 0
      ? [
          changedFieldsSentence(fields.changedFields, fields.changedFields.join(', ')),
          '',
          buttonLine,
          fields.link,
          '',
          fields.description,
        ]
      : [buttonLine, fields.link, '', fields.description]

  if (fields.reminderSchedule) {
    lines.push('', buildReminderScheduleSentence(fields.dueDate, fields.dueTime, fields.reminderSchedule))
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
// "Day after" notice — sent once to a Request's Recipient, the calendar day
// following Due Date. Originally built 2026-08-17 as an open-ended
// hourly-then-daily recurring "Overdue nudge"; simplified 2026-08-22 (Jim's
// own spam-complaint concern) into a single-shot send, the direct
// replacement for the old moment-of-lapse Overdue transition email —
// function/variable names below still say "Overdue" since the wording
// itself ("the Due Date... has passed and it has not been reported as
// Done") is equally accurate for a single day-after send; only the cron
// route's own call pattern changed, not this template.
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
    emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`),
    emailSignupFooter(fields.siteUrl),
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
    emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`),
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
// ToDo "Day of" Reminder — same shape as the day-before Reminder above, sent
// the morning the ToDo is actually due rather than the morning before.
// Added 2026-08-22 alongside the third Reminders-until-Done checkbox
// (reminder_day_of_enabled, migration 042) — owner's own follow-up: still
// using ToDos for real business needs, a day-before Reminder alone isn't
// always enough lead time, and a same-day option was requested. Gated by
// the cron route on both profiles.todo_reminders_enabled and the per-ToDo
// reminder_day_of_enabled column, independent of the day-before Reminder's
// own reminder_enabled/reminder_sent_at.
// ----------------------------------------------------------------------------
type TodoDayOfEmailFields = {
  description: string
  dueDate: string
  link: string
  siteUrl: string
}

export function buildTodoDayOfEmailSubject(dueDate: string): string {
  return `DUE TODAY: Your Would You Please ToDo, Due: ${formatMDY(dueDate)}`
}

export function buildTodoDayOfEmailHtml(fields: TodoDayOfEmailFields): string {
  const body = [
    `<p style="margin:0 0 18px;">This ToDo is due today, ${formatMDY(fields.dueDate)}.</p>`,
    `<p style="margin:0 0 18px;">${emailButton(fields.link, TODO_REMINDER_LINK_TEXT)}</p>`,
    emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`),
  ].join('\n')
  return wrapEmailHtml(fields.siteUrl, body)
}

export function buildTodoDayOfEmailText(fields: TodoDayOfEmailFields): string {
  return [
    `This ToDo is due today, ${formatMDY(fields.dueDate)}.`,
    '',
    `${TODO_REMINDER_LINK_TEXT}:`,
    fields.link,
    '',
    fields.description,
  ].join('\n')
}

// ----------------------------------------------------------------------------
// ToDo "Day after" notice — the ToDo counterpart to a Request's own "Day
// after" notice above. Sent once, the calendar day after Due Date, to the
// owner's own account email — same recipient as the day-before/day-of ToDo
// Reminders, since a ToDo has no Recipient of its own. Gated by the cron
// route on profiles.todo_reminders_enabled AND the per-ToDo
// overdue_reminder_enabled column (shared with Requests, same table).
// Originally built 2026-08-22 as "Daily thereafter" (a genuine recurring
// daily cadence — the first new-capability piece added for ToDos, since
// they'd never had any Overdue mechanism before that batch); simplified to
// single-shot the same day, alongside the Request-side change, per Jim's
// own spam-complaint concern. Function/variable names below still say
// "Overdue" for the same reason the Request-side template comment gives.
// ----------------------------------------------------------------------------
type TodoOverdueEmailFields = {
  description: string
  dueDate: string
  link: string
  siteUrl: string
}

export function buildTodoOverdueEmailSubject(dueDate: string): string {
  return `OVERDUE: Your Would You Please ToDo, Due: ${formatMDY(dueDate)}`
}

// Same action-oriented wording and reasoning as OVERDUE_LINK_TEXT above,
// scoped to what a ToDo Detail screen actually offers.
const TODO_OVERDUE_LINK_TEXT = 'Open ToDo to mark Done or to turn off notifications'

export function buildTodoOverdueEmailHtml(fields: TodoOverdueEmailFields): string {
  const body = [
    `<p style="margin:0 0 18px;">The Due Date for this ToDo has passed (${formatMDY(fields.dueDate)}) and it has not been marked Done.</p>`,
    `<p style="margin:0 0 18px;">${emailButton(fields.link, TODO_OVERDUE_LINK_TEXT)}</p>`,
    emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`),
  ].join('\n')
  return wrapEmailHtml(fields.siteUrl, body)
}

export function buildTodoOverdueEmailText(fields: TodoOverdueEmailFields): string {
  return [
    `The Due Date for this ToDo has passed (${formatMDY(fields.dueDate)}) and it has not been marked Done.`,
    '',
    `${TODO_OVERDUE_LINK_TEXT}:`,
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

// ----------------------------------------------------------------------------
// Owner-facing change notice (2026-09-02) — the other direction of the
// change-notification feature above: sent to the Requestor/owner when the
// Recipient edits an existing Request (Response Detail's signed-in path, or
// Request Response's anonymous /r/[token] path — Done Date/Time, Dialog, or
// Attachments). Deliberately its own template, not a reuse of
// buildRequestEmailHtml/Text: that template's "from <ownerName>... mark as
// completed" framing is written for the Recipient, and its button links to
// the /r/[token] response screen — neither is right for an email arriving in
// the owner's own inbox about their own Request. This one names the
// Recipient instead ("to <recipientName>"), matching the existing digest
// rows' own convention, and its button links straight to the owner's own
// Request Detail screen (/requests/[id]) — no response-link token needs
// minting for this direction at all, since only the owner can open that
// route (RLS owner-only).
// ----------------------------------------------------------------------------
type OwnerUpdateEmailFields = {
  recipientName: string | null
  description: string
  dueDate: string
  dueTime: string | null
  changedFields: string[]
  link: string
  siteUrl: string
}

export function buildOwnerUpdateEmailSubject(
  recipientName: string | null,
  dueDate: string,
  dueTime: string | null
): string {
  const to = recipientName ? ` to ${recipientName}` : ''
  const due = formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
  return `UPDATED: A Would You Please Request${to}, Due: ${due}`
}

const OWNER_UPDATE_LINK_TEXT = 'Open Request to view or modify'

export function buildOwnerUpdateEmailHtml(fields: OwnerUpdateEmailFields): string {
  const buttonHtml = emailButtonRaw(fields.link, OWNER_UPDATE_LINK_TEXT)
  const body = [
    emailChangedFieldsBox(fields.changedFields, buttonHtml),
    emailDescriptionBox(`<p style="margin:0;">${escapeHtml(fields.description).replace(/\r?\n/g, '<br>')}</p>`),
  ].join('\n')
  return wrapEmailHtml(fields.siteUrl, body)
}

export function buildOwnerUpdateEmailText(fields: OwnerUpdateEmailFields): string {
  return [
    changedFieldsSentence(fields.changedFields, fields.changedFields.join(', ')),
    '',
    `${OWNER_UPDATE_LINK_TEXT}:`,
    fields.link,
    '',
    fields.description,
  ].join('\n')
}
