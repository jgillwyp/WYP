/**
 * RFC 5545 .ics generation for a Request's "Add to Calendar" button.
 *
 * Extracted 2026-08-11 out of RequestResponseForm.tsx (built there 2026-08-10
 * for the anonymous /r/[token] screen) when ResponseDetailForm.tsx needed the
 * identical logic for the signed-in-recipient equivalent. Every other pair of
 * near-duplicate helpers in this app (todayISODate, formatMDY, the Category/
 * Contact/Time-Zone "browsing" lookup pattern, the Add Dialog empty-body
 * guard, ...) stays intentionally duplicated per component, matching this
 * codebase's established convention — those are all short and tied to a
 * specific component's own state or JSX. This one is different: it's ~90
 * lines of stateless, non-trivial RFC logic (TEXT escaping, 75-octet line
 * folding, floating-vs-UTC time handling) with no component state involved
 * at all, and it now has two real call sites. Duplicating it a second time
 * risked exactly the kind of silent-drift bug this app has already hit with
 * copy-pasted logic elsewhere (a future escaping fix applied to one copy and
 * not the other) — worth the one-time exception to the no-shared-lib
 * convention.
 */

export const ICS_DEFAULT_DUE_TIME = '09:00'
export const ICS_DURATION_MINUTES = 30

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Local calendar date as "YYYY-MM-DD", matching the native date input's own
// value format — built from Y/M/D components (not toISOString(), which is
// UTC and can land on the wrong day near midnight in most US time zones).
export function todayISODate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  return `${y}-${m}-${day}`
}

export function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

// DTSTAMP is always UTC per RFC 5545.
export function formatIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  )
}

// DTSTART/DTEND use "floating" local time (no trailing Z, no TZID) — a
// Request has no stored time zone of its own, so the calendar app importing
// the file interprets the time in whatever zone the recipient is actually
// in, which is the closest match to "9am, wherever you are" without a real
// TZID to offer.
export function formatIcsLocal(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

// RFC 5545 §3.3.11 TEXT escaping — backslash first, so the escapes just
// added for the other characters don't get re-escaped.
export function icsEscapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// RFC 5545 §3.1 line folding — content lines over 75 octets are split with
// a CRLF followed by a single leading space, which un-folding parsers strip
// back out. Approximated on UTF-16 length rather than true octet count,
// which matches for the plain-ASCII text every field here is built from.
export function foldIcsLine(line: string): string {
  const max = 75
  if (line.length <= max) return line
  let out = line.slice(0, max)
  let rest = line.slice(max)
  while (rest.length > 0) {
    out += `\r\n ${rest.slice(0, max - 1)}`
    rest = rest.slice(max - 1)
  }
  return out
}

// Rewritten 2026-08-16 (owner request) — matches
// buildRequestEmailHtml/buildRequestEmailText's new structure in
// app/src/lib/email.ts (call-to-action link first, then the Description,
// then the conditional Reminder note, then one combined attachments/Dialog
// note, then a closing signup link). The old layout put the link at the
// very end, after the full Description — a mobile mail app's own
// calendar-event preview truncates a long DESCRIPTION field with an
// ellipsis, and the link (the whole point of a "click here" invitation)
// could disappear into that truncation before the recipient ever saw it.
// Putting the link first, ahead of the Description, gives it the best
// realistic chance of surviving a short preview (the owner's own
// follow-up correction, after an initial draft that put Description
// first — matches buildRequestEmailHtml/Text's own ordering exactly).
//
// Drops the old "A Would You Please Request from <name>:" opener entirely,
// matching the owner's own literal example (his email template has no name
// attribution in the body — that information already lives in the email's
// own Subject line and From header). RFC 5545 TEXT has no markup, so the
// link renders as a bare URL here, unlike the HTML email's real anchor —
// most calendar/mail clients auto-linkify a bare URL in an event
// description on their own.
//
// reminderPromised defaults to false — the two client-side "Add to
// Calendar" call sites (RequestResponseForm.tsx, ResponseDetailForm.tsx)
// only know a Request's due_date, never the sender's own reminder_enabled
// preference, so they can't honestly promise a reminder either way; only
// the emailed .ics (built server-side in send-request/route.ts, which has
// already computed the real reminderPromised value) passes it explicitly.
export function buildIcsDescription(
  description: string,
  link: string,
  siteUrl: string,
  reminderPromised = false
): string {
  const parts = [`Click to respond or mark as completed: ${link}`, description]

  if (reminderPromised) {
    parts.push('A reminder email will arrive the day before the Due Date.')
  }

  parts.push(
    'You can also see any attachments and add questions or comments to this Request with the above link.',
    `New to Would You Please? click to set up a free account: ${siteUrl}`
  )

  return parts.join(' ')
}

// Minimal shape either ResponsePayload (RequestResponseForm.tsx) or
// ReceivedDetailPayload (ResponseDetailForm.tsx) already satisfies — no
// import cycle between the two components needed.
export type IcsRequestFields = {
  id: string
  description: string
  due_date: string | null
  due_time: string | null
  owner_name: string | null
}

// Local calendar date as "YYYYMMDD" (no time component) — the DATE form
// RFC 5545 §3.3.4 requires for an all-day VEVENT's DTSTART/DTEND;VALUE=DATE.
function formatIcsDateOnly(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

// Owner's ask, 2026-08-13: hide the Request Response page's own "Add to
// Calendar" button when the visitor arrived by clicking the event's link
// *from inside their calendar app* — they already have it on their
// calendar at that point, so the button is redundant. buildIcsContent
// below stamps every link it embeds (both DESCRIPTION's inline link and
// the VEVENT's own URL property) with this marker; RequestResponseForm.tsx
// and ResponseDetailForm.tsx read it back via cameFromCalendarLink() on
// mount to decide whether to render the button at all.
//
// This is a per-click signal, not a persistent "already added" flag on the
// Request itself — Request links are multi-use (CLAUDE.md, Database
// section), so the same recipient can still reach this page via the
// original email link (no marker, button shows) even after having already
// added the event once via the calendar link. That's judged the right
// trade-off: a false "not yet added" is harmless (the button just
// reappears), where a false "already added" would hide a button someone
// genuinely still needed.
//
// Applied unconditionally inside buildIcsContent, including the client-side
// "Add to Calendar" button's own call (handleAddToCalendar in both forms,
// which passes window.location.href as `link`) — a manually re-downloaded
// .ics also deserves the marker on its own embedded link, so a *future*
// visit via that link hides the button too, same reasoning either way.
export function calendarLinkFor(link: string): string {
  // Idempotent — cameFromCalendarLink already hides the button that's the
  // only path back into buildIcsContent with an already-marked link, but
  // guarding here too costs nothing and avoids a duplicated ?src=calendar
  // query param if that ever changes.
  if (cameFromCalendarLink(link.includes('?') ? link.slice(link.indexOf('?')) : '')) return link
  return `${link}${link.includes('?') ? '&' : '?'}src=calendar`
}

export function cameFromCalendarLink(search: string): boolean {
  return new URLSearchParams(search).get('src') === 'calendar'
}

// options.reminderPromised is passed through to buildIcsDescription — only
// the server-side send-request route has a real value to give it (it
// already computes reminderPromised for the email body); the two
// client-side "Add to Calendar" call sites (RequestResponseForm.tsx,
// ResponseDetailForm.tsx) omit it and get the function's own false default,
// same reasoning as buildIcsDescription's own doc comment above. siteUrl is
// derived from the response link's own origin rather than threaded through
// as a required parameter, since every caller already has a full link and
// none currently has a separate site-root value handy.
export function buildIcsContent(
  payload: IcsRequestFields,
  link: string,
  options?: { reminderPromised?: boolean }
): string {
  const [y, m, d] = (payload.due_date ?? todayISODate()).slice(0, 10).split('-').map(Number)
  const hasTime = payload.due_time != null && payload.due_time.trim() !== ''

  // Owner-reported, 2026-08-13, testing the live email: with no Due Time,
  // the old behavior (default to ICS_DEFAULT_DUE_TIME, 9:00 AM, and build a
  // 30-minute timed event) made Google Calendar and Outlook both offer an
  // "Invite Others" control on the resulting event — noise for a WYP
  // Request/ToDo, which was never a scheduled meeting with attendees to
  // begin with. A Due Time the sender actually set is unaffected and still
  // renders as a timed event; only the "no time given" case changes, to an
  // all-day (VALUE=DATE) event instead of a fabricated 9:00 AM slot.
  let dtstartLine: string
  let dtendLine: string
  if (hasTime) {
    const [hh, mm] = payload.due_time!.split(':').map(Number)
    const start = new Date(y, m - 1, d, hh, mm)
    const end = new Date(start.getTime() + ICS_DURATION_MINUTES * 60000)
    dtstartLine = `DTSTART:${formatIcsLocal(start)}`
    dtendLine = `DTEND:${formatIcsLocal(end)}`
  } else {
    // DTEND is exclusive per RFC 5545 §3.6.1 — a single-day all-day event
    // still needs DTEND one calendar day past DTSTART, not the same date.
    dtstartLine = `DTSTART;VALUE=DATE:${formatIcsDateOnly(new Date(y, m - 1, d))}`
    dtendLine = `DTEND;VALUE=DATE:${formatIcsDateOnly(new Date(y, m - 1, d + 1))}`
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Would You Please//Request Response//EN',
    'CALSCALE:GREGORIAN',
    // Owner-reported, 2026-08-13: Outlook (mobile and web) rejected the
    // emailed .ics — "Invalid ICAL element: Inbound Mime method and ICAL
    // method mismatch" — while Google Calendar accepted the identical file
    // without complaint. Root cause: the email route (app/api/email/
    // send-request/route.ts) attached this content as
    // `text/calendar; method=REQUEST`, but the VCALENDAR body itself carried
    // no METHOD property at all — Outlook checks the two against each other
    // and Google apparently doesn't. REQUEST was also the wrong choice on
    // its own terms: it's iTIP's meeting-invitation method, implying an
    // ORGANIZER/ATTENDEE who can accept or decline, neither of which this
    // event has — a WYP Request's due date was never a meeting. PUBLISH is
    // the correct iTIP method for a one-way informational calendar entry
    // like this one; the email route's attachment content-type now declares
    // method=PUBLISH to match.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:request-${payload.id}@wouldyouplease.com`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    dtstartLine,
    dtendLine,
    `SUMMARY:${icsEscapeText(`Would You Please: ${truncate(payload.description, 60)}`)}`,
    `DESCRIPTION:${icsEscapeText(buildIcsDescription(payload.description, calendarLinkFor(link), new URL(link).origin, options?.reminderPromised))}`,
    `URL:${calendarLinkFor(link)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
