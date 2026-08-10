/**
 * Time Zone list (Week 3 — profiles.time_zone / contacts.time_zone, migration
 * 007). Displayed and stored as raw IANA identifiers ("America/Chicago"), not
 * a friendly label ("Central Time (Chicago)") — every zone name from
 * Intl.supportedValuesOf('timeZone') is unique and sortable on its own, and
 * there's no standard-library mapping to a friendly label without hand-
 * maintaining one for 400+ entries. Every field that reads or writes a Time
 * Zone (Add Contact, Contact Detail, and the Create Free Account mockup's
 * demo script) reads from this file's shape so all three stay in sync by
 * construction rather than by remembering to copy a list three places.
 */

const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
]

/** Every IANA zone name the runtime knows about, alphabetical. */
export function getAllTimeZones(): string[] {
  try {
    return [...Intl.supportedValuesOf('timeZone')].sort((a, b) => a.localeCompare(b))
  } catch {
    // Intl.supportedValuesOf is broadly supported (evergreen browsers, Node
    // 18+), but this keeps the field from being a dead end if it's ever
    // missing rather than throwing on render.
    return [...FALLBACK_TIME_ZONES].sort((a, b) => a.localeCompare(b))
  }
}

/** The visitor's own zone, browser-detected — used as the last-resort default. */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}
