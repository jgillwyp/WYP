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

// Owner's ask, 2026-08-10: the bolded text in his mockup is the Request's
// own Description, verbatim; everything else — the "A Would You Please
// Request from <name>:" opener and the "To mark it completed, click:"
// closer — is fixed boilerplate around it. Hardcoded here for now:
// "there will need to be a Would You Please administrative interface where
// such standard text can be modified... that can just be a 'will be done'
// item at this point" — flagged, not built; no admin surface or schema for
// editable boilerplate strings exists yet anywhere in the app.
// Owner-reported, 2026-08-10: with no owner_name (a test-data gap that
// "once the app is fully implemented could not happen" — see
// profiles.display_name in CLAUDE.md's Known gaps), the old fallback of
// 'Would You Please' produced "A Would You Please Request from Would You
// Please". Omit the "from <name>" clause entirely instead when the name is
// unknown, rather than papering over it with a value that reads as
// nonsensical.
export function buildIcsDescription(ownerName: string | null, description: string, link: string): string {
  const from = ownerName ? `A Would You Please Request from ${ownerName}: ` : 'A Would You Please Request: '
  return `${from}${description} To mark it completed, click: ${link}`
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

export function buildIcsContent(payload: IcsRequestFields, link: string): string {
  const [y, m, d] = (payload.due_date ?? todayISODate()).slice(0, 10).split('-').map(Number)
  const [hh, mm] = (payload.due_time ?? ICS_DEFAULT_DUE_TIME).split(':').map(Number)
  const start = new Date(y, m - 1, d, hh, mm)
  const end = new Date(start.getTime() + ICS_DURATION_MINUTES * 60000)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Would You Please//Request Response//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:request-${payload.id}@wouldyouplease.com`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsLocal(start)}`,
    `DTEND:${formatIcsLocal(end)}`,
    `SUMMARY:${icsEscapeText(`Would You Please: ${truncate(payload.description, 60)}`)}`,
    `DESCRIPTION:${icsEscapeText(buildIcsDescription(payload.owner_name, payload.description, link))}`,
    `URL:${link}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
