/**
 * Pure time-zone helpers for the cron notification system
 * (app/api/cron/tick/route.ts). Node has full ICU support, so
 * Intl.DateTimeFormat with a `timeZone` option is enough — no date library
 * dependency needed.
 *
 * "Local" throughout this file means "as of right now, in the given IANA
 * zone" — not the naive due_date/due_time values themselves, which are
 * already plain wall-clock strings with no zone attached (CLAUDE.md's
 * Database section) and need no conversion of their own. These helpers only
 * answer "what day/hour is it right now, somewhere" — used to decide
 * *when* a cron pass is allowed to act, not to reinterpret a stored date.
 */

const DEFAULT_ZONE = 'UTC'

function safeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_ZONE
  try {
    // Throws RangeError on an invalid zone name — fall back rather than
    // let one bad contacts.time_zone/profiles.time_zone value crash an
    // entire cron run for every owner.
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_ZONE
  }
}

/** Today's date, as "YYYY-MM-DD", in the given zone, right now. */
export function localDateISO(tz: string | null | undefined, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

/** The current hour (0-23), in the given zone, right now. */
export function localHour(tz: string | null | undefined, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz),
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  // hour12: false can still render "24" for midnight in some ICU builds —
  // normalize to the 0-23 range this file's callers expect.
  const raw = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  return raw % 24
}

/** dateISO shifted by `days` (may be negative), pure calendar-day
 * arithmetic — matches isReminderEligible's own "truncate to local midnight,
 * count whole days" convention in app/src/lib/email.ts. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** True once the given zone's own wall clock has reached (or passed)
 * dueDate/dueTime — used for Overdue detection. dueTime defaults to
 * end-of-day (23:59:59) when not set, so a Due-Date-only Request is only
 * "overdue" once its entire calendar day, in the owner's own zone, has
 * elapsed — not the moment it merely begins. */
export function hasLocalDateTimePassed(
  tz: string | null | undefined,
  dueDate: string,
  dueTime: string | null,
  now: Date = new Date()
): boolean {
  const nowDate = localDateISO(tz, now)
  if (nowDate > dueDate) return true
  if (nowDate < dueDate) return false
  // Same local calendar day — compare time-of-day only when Due Time is
  // set; otherwise the day itself passing (handled above) is what matters,
  // and "today, no specific time" is never yet overdue.
  if (!dueTime) return false
  const nowParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const nh = nowParts.find((p) => p.type === 'hour')?.value ?? '00'
  const nm = nowParts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${nh}:${nm}` >= dueTime.slice(0, 5)
}

/** True once at least `hours` have elapsed, in wall-clock terms, since
 * dueDate/dueTime in the given zone — used for the Due-Time-Overdue "the
 * hour after" first-nudge condition. Only meaningful when dueTime is set;
 * callers should gate on that separately. */
export function hoursSinceLocalDateTime(
  tz: string | null | undefined,
  dueDate: string,
  dueTime: string,
  now: Date = new Date()
): number {
  // Building a real Date from local-zone Y/M/D/H/M requires knowing that
  // zone's UTC offset at this moment (DST-safe) — derived by formatting
  // `now` itself in the target zone and diffing against its own UTC
  // representation, then applying that offset to the due date/time's own
  // Y/M/D/H/M components. Good enough for hour-granularity nudge cadence;
  // not attempting sub-minute precision.
  const zone = safeZone(tz)
  const offsetMinutes = tzOffsetMinutes(zone, now)
  const [y, m, d] = dueDate.split('-').map(Number)
  const [dh, dmin] = dueTime.slice(0, 5).split(':').map(Number)
  const dueUtcMs = Date.UTC(y, m - 1, d, dh, dmin) - offsetMinutes * 60_000
  return (now.getTime() - dueUtcMs) / (1000 * 60 * 60)
}

function tzOffsetMinutes(zone: string, now: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  const asUTC = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')) % 24,
    Number(get('minute')),
    Number(get('second'))
  )
  return (asUTC - now.getTime()) / 60_000
}
