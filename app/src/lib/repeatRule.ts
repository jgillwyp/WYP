// src/lib/repeatRule.ts
//
// Pure recurrence logic for the Repeat feature (Create Request/Request
// Detail, Create ToDo/ToDo Detail — Jim's own recurrence-method design,
// uploaded 2026-08-21, "WYP Repeat design.docx"). No date library, same
// convention as ics.ts/cronTime.ts — date-only arithmetic done on y/m/d
// integers (via Date.UTC, never local time) since due_date is a plain
// `date` column (yyyy-mm-dd), not a timestamp, and this file must never
// drift a date by a timezone offset.
//
// Word-wrap rule (Jim, 2026-08-21): the descriptive text should only ever
// wrap between comma-separated phrases, never mid-phrase. Enforced here,
// not in CSS — phrases are joined with an ordinary breakable ", " while
// every space *inside* a phrase is replaced with a non-breaking space
// ( ), so every consumer (the Repeat band, the recipient's read-only
// footnote, print reports) gets correct wrapping for free.

export type RepeatType = 'day' | 'week' | 'month' | 'year'
export type MonthMode = 'day' | 'weekday'
export type StopType = 'never' | 'on' | 'after'

export interface RepeatRule {
  type: RepeatType
  interval: number // 1-99 for day/week/month, 1-10 for year
  weekdaysOnly?: boolean // day only — "Monday through Friday only"
  monthMode?: MonthMode // month only — which of the two chips is selected
  stopType: StopType
  stopDate?: string | null // yyyy-mm-dd, 'on' only
  stopCount?: number | null // 1+, 'after' only
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function nbsp(s: string): string {
  return s.replace(/ /g, ' ')
}

export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function parseISO(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { y, m, d }
}
function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function addDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
// Same-day-of-month, clamped to the target month's last day (e.g. Jan 31 + 1
// month -> Feb 28/29, standard calendar-app convention).
function addMonthsClamped(y: number, m: number, d: number, deltaMonths: number): { y: number; m: number; d: number } {
  const total = y * 12 + (m - 1) + deltaMonths
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const nd = Math.min(d, daysInMonth(ny, nm))
  return { y: ny, m: nm, d: nd }
}
function nthWeekdayOfMonth(y: number, m: number, weekday: number, nth: number): { y: number; m: number; d: number } | null {
  const firstDow = dayOfWeek(y, m, 1)
  const firstOccurrence = 1 + ((weekday - firstDow + 7) % 7)
  const day = firstOccurrence + (nth - 1) * 7
  if (day > daysInMonth(y, m)) return null // nth doesn't exist this month (rare — a "5th X" pattern)
  return { y, m, d: day }
}
// Same "invalid projected date -> closest earlier one" convention
// addMonthsClamped already applies to day-of-month mode (Jan 31 -> Feb 28),
// applied here for weekday mode: if the target month has no Nth occurrence
// of the weekday (a "5th Wednesday" most months don't have), step down to
// the 4th, 3rd, etc. within that *same* month rather than searching forward
// for a future month that does have a 5th. Every month has at least four
// occurrences of any given weekday, so nth=1 always resolves.
function nthWeekdayOfMonthClamped(y: number, m: number, weekday: number, nth: number): { y: number; m: number; d: number } {
  for (let n = nth; n >= 1; n--) {
    const found = nthWeekdayOfMonth(y, m, weekday, n)
    if (found) return found
  }
  return { y, m, d: 1 } // unreachable — n=1 always exists
}
function nthOfWeekdayInMonth(y: number, m: number, d: number): number {
  return Math.floor((d - 1) / 7) + 1
}

/** Reads the day-of-week name straight off a Due Date — matches the modal's
 * read-only "Repeats on <day of week>" line, which has no user selection. */
export function dueDateWeekday(dueDate: string): string {
  const { y, m, d } = parseISO(dueDate)
  return DAY_NAMES[dayOfWeek(y, m, d)]
}

/** The two Month chip labels ("Day 15" / "2nd Wednesday"), both derived
 * from the same Due Date — the modal shows both as choices. */
export function monthChipLabel(dueDate: string, mode: MonthMode): string {
  const { y, m, d } = parseISO(dueDate)
  if (mode === 'day') return `Day ${d}`
  const dow = dayOfWeek(y, m, d)
  const nth = nthOfWeekdayInMonth(y, m, d)
  return `${ordinal(nth)} ${DAY_NAMES[dow]}`
}
export function monthChipOptions(dueDate: string): { dayLabel: string; weekdayLabel: string } {
  return { dayLabel: monthChipLabel(dueDate, 'day'), weekdayLabel: monthChipLabel(dueDate, 'weekday') }
}

export function clampInterval(type: RepeatType, value: number): number {
  const max = type === 'year' ? 10 : 99
  if (!Number.isFinite(value)) return 1
  return Math.min(max, Math.max(1, Math.round(value)))
}

export function defaultRepeatRule(): RepeatRule {
  return { type: 'day', interval: 1, weekdaysOnly: false, monthMode: 'day', stopType: 'never', stopDate: null, stopCount: null }
}

/** currentDueDate is the anchor — CLAUDE.md/Jim's own instruction (2026-08-21):
 * Due Date is the determinant for generating the next Request, never Done
 * Date. */
export function computeNextDueDate(currentDueDate: string, rule: RepeatRule): string {
  const { y, m, d } = parseISO(currentDueDate)
  switch (rule.type) {
    case 'day': {
      if (rule.weekdaysOnly) {
        let cy = y
        let cm = m
        let cd = d
        let remaining = rule.interval
        while (remaining > 0) {
          const next = addDays(cy, cm, cd, 1)
          cy = next.y
          cm = next.m
          cd = next.d
          const dow = dayOfWeek(cy, cm, cd)
          if (dow !== 0 && dow !== 6) remaining--
        }
        return toISO(cy, cm, cd)
      }
      const next = addDays(y, m, d, rule.interval)
      return toISO(next.y, next.m, next.d)
    }
    case 'week': {
      const next = addDays(y, m, d, rule.interval * 7)
      return toISO(next.y, next.m, next.d)
    }
    case 'month': {
      if (rule.monthMode === 'weekday') {
        const weekday = dayOfWeek(y, m, d)
        const nth = nthOfWeekdayInMonth(y, m, d)
        const total = y * 12 + (m - 1) + rule.interval
        const ny = Math.floor(total / 12)
        const nm = (total % 12) + 1
        const found = nthWeekdayOfMonthClamped(ny, nm, weekday, nth)
        return toISO(found.y, found.m, found.d)
      }
      const next = addMonthsClamped(y, m, d, rule.interval)
      return toISO(next.y, next.m, next.d)
    }
    case 'year': {
      const next = addMonthsClamped(y, m, d, rule.interval * 12)
      return toISO(next.y, next.m, next.d)
    }
  }
}

/** nextOccurrenceIndex is 1-based and counts the *original* Request as 1 —
 * so the first generated successor is index 2. Checked by the cron job
 * before it inserts that successor. */
export function shouldStopBeforeGenerating(rule: RepeatRule, nextOccurrenceIndex: number, nextDueDate: string): boolean {
  if (rule.stopType === 'on' && rule.stopDate) return nextDueDate > rule.stopDate
  if (rule.stopType === 'after' && rule.stopCount) return nextOccurrenceIndex > rule.stopCount
  return false
}

function formatStopOnDate(iso: string): string {
  const { y, m, d } = parseISO(iso)
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y).slice(-2)}`
}

function stopPhrase(rule: RepeatRule): string {
  if (rule.stopType === 'on' && rule.stopDate) return `stops on ${formatStopOnDate(rule.stopDate)}`
  if (rule.stopType === 'after' && rule.stopCount) {
    return rule.stopCount === 1 ? 'stops after 1 time' : `stops after ${rule.stopCount} times`
  }
  return 'stops never'
}

/** The single descriptive-text builder every consumer uses verbatim — the
 * Repeat band on Create Request/Request Detail/Create ToDo/ToDo Detail, the
 * recipient's read-only footnote, and the "Repeats: ..." print-report line.
 * One implementation means the wording can never drift between screens.
 *
 * Each phrase is nbsp()'d as it's built, then joined with a plain breakable
 * ", " — wrap only between phrases, never mid-phrase (Jim, 2026-08-21).
 * Exception, same day: the week phrase ("Repeats every 2nd week on
 * Wednesday") has no comma to break at and, unlike every other type's
 * phrasing, runs long enough on its own to overlap the Edit Repeat button
 * in the band. Built as two nbsp'd halves joined by one ordinary breakable
 * space instead of one fully-rigid phrase, so it can wrap between "week"
 * and "on" but nowhere else. */
export function describeRepeat(rule: RepeatRule, dueDate: string): string {
  const phrases: string[] = []
  switch (rule.type) {
    case 'day': {
      phrases.push(nbsp(rule.interval === 1 ? 'Repeats every day' : `Repeats every ${ordinal(rule.interval)} day`))
      if (rule.weekdaysOnly) phrases.push(nbsp('M-F only'))
      break
    }
    case 'week': {
      const dayName = dueDateWeekday(dueDate)
      const lead = nbsp(rule.interval === 1 ? 'Repeats every week' : `Repeats every ${ordinal(rule.interval)} week`)
      const tail = nbsp(`on ${dayName}`)
      phrases.push(`${lead} ${tail}`)
      break
    }
    case 'month': {
      phrases.push(nbsp(rule.interval === 1 ? 'Repeats every month' : `Repeats every ${ordinal(rule.interval)} month`))
      phrases.push(nbsp(monthChipLabel(dueDate, rule.monthMode ?? 'day')))
      break
    }
    case 'year': {
      phrases.push(nbsp(rule.interval === 1 ? 'Repeats every year' : `Repeats every ${ordinal(rule.interval)} year`))
      break
    }
  }
  phrases.push(nbsp(stopPhrase(rule)))
  return phrases.join(', ')
}
