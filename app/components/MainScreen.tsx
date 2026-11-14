'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'
import { usePWAInstall } from './PWAProvider'
import { printWithExpandedWindow } from '@/lib/platform'
import { useSpeechDictation } from '@/lib/useSpeechDictation'
import {
  isIOSDevice,
  isMacOSDevice,
  isMobileDevice,
  isSafariBrowser,
  isStandaloneDisplay,
} from '@/lib/platform'
import { type RepeatRule, describeRepeat } from '@/lib/repeatRule'

/**
 * Main Screen (§6.7) — converted from
 * design/screens/WYP_main_screen_palette1.html for the first working landing
 * screen after sign-in ("I would like to see the WYP app retain the
 * device-login validation and be able to test it in a more normal way", 2026-08-08).
 *
 * Scope for this pass, confirmed with the owner via two rounds of questions:
 * - Sent and ToDos are LIVE — real `requests` rows, default sort pills
 *   working (Due ▼ descending for Sent, Priority ▼ ascending for ToDos).
 * - **Received is now LIVE too (migration 012, 2026-08-11)** — superseding
 *   the placeholder note that used to be here. There's still no column
 *   linking a `requests` row to its recipient's own account, so this isn't a
 *   plain owner-scoped RLS select the way Sent/ToDos are; instead,
 *   `get_received_requests()` matches the signed-in caller's own session
 *   email against the sending Contact's email, server-side, and returns only
 *   the columns a recipient is entitled to see (no Category — PRD §2.3,
 *   enforced inside the function itself). Design proposed and confirmed with
 *   the owner 2026-08-11 — see decisions log and `WYP_Week4_Plan.md` for the
 *   full reasoning, including why this needed functions rather than an RLS
 *   policy. Self-sent Requests (a Contact whose email is the sender's own)
 *   are deliberately NOT excluded — owner: "I can imagine circumstances
 *   where a person might choose to send themselves requests instead of using
 *   ToDos." Received rows route to `/requests/[id]/respond` (Response
 *   Detail), not `/requests/[id]` (Request Detail) — that's the sender's own
 *   edit screen.
 * - Search bar and the All/Open/Overdue/Done (Sent, Received) / All/Open/Done
 *   (ToDos) filter chips are all functional (2026-08-09, extended to Received
 *   2026-08-11) — client-side, over the already-fetched rows: no re-query per
 *   keystroke or chip click, since these lists are personal-scale (same
 *   reasoning as the Recipient/Category lookups elsewhere in the app).
 *   Search matches description plus contact name (Sent) / owner name
 *   (Received) / category name (ToDos), case-insensitive substring, in the
 *   default "All" scope. **Search Mode redesign, 2026-08-19** — supersedes
 *   the "scope button stays visual-only" note that used to be here. The
 *   scope control is a real two-item picker: "All" (the text search above)
 *   or "Date Range," which swaps the text field for paired From/To Due Date
 *   fields — either side alone is
 *   a valid search (matchesDateRange below). Results still render inside
 *   Sent/Received/ToDos' own three sections, never a separate screen or a
 *   blended list ("showing results within the main screen would be more
 *   logical," owner) — Sent and Received were never blended in the first
 *   place (filteredSent/filteredReceived always ran independently). While
 *   any search criteria is active (isSearching, derived from searchText/
 *   fromDate/toDate — never a separate stored "mode" flag, so clearing a
 *   field by hand exits immediately with nothing further to reset): the
 *   status chips (Open/Overdue/Done) are replaced by a plain "Search
 *   Results" notice per section rather than still narrowing results
 *   (matchesStatusFilter only applies at rest now); Archived items are
 *   automatically included and tagged with a small "Archived" badge next to
 *   the row's icons, rather than needing a separate opt-in ("at this
 *   point... maybe an 'Advanced' search option can be offered later," owner);
 *   and a "Clear Search ×" control appears next to the field(s) as one
 *   reliable, always-visible way out regardless of scope, alongside the text
 *   field's own inline × once it holds a value.
 * - Chip state survives a trip to a Detail screen and back (2026-08-09 —
 *   "It would be appropriate to return to the same chip state on the main
 *   screen"). This screen fully remounts on router.back() (no Cache
 *   Components/Activity in this app — see CLAUDE.md), so plain useState alone
 *   lost these on every round trip. Persisted to sessionStorage, not
 *   localStorage: a within-session view preference, not a durable account
 *   setting like "Keep me signed in" (supabaseClient.ts's REMEMBER_KEY) — it's
 *   fine for it to reset when the tab actually closes. Scoped to the chips
 *   themselves (Sent filter, Received filter, ToDos filter, Housekeeping's
 *   Tasks/How-to Videos tab), matching the owner's own wording — the search
 *   text box is a separate control and is NOT persisted (flagged as a scoping
 *   call, not confirmed with the owner; easy to add if it turns out to
 *   matter).
 * - Housekeeping's "Contacts" row (renamed from "My Contacts" 2026-08-09 —
 *   a nav row's label must repeat the destination screen's own title
 *   exactly, owner's rule) navigates to /contacts. "Account" (renamed from
 *   "My Account" the same day, same rule) now navigates to /account too
 *   (2026-08-13) — see AccountForm.tsx's own header comment for why this
 *   is the one sliver of the previously-undesigned Account screen that
 *   exists so far (a single Private Category on/off toggle), not a full
 *   conversion of the Your Account mockup. Log Out is real — it is the one
 *   piece that directly serves the "test the login loop normally" goal
 *   this screen was built for.
 *
 * Icons are inline SVG (currentColor, driven by .iconbtn/.ii's own color),
 * not the mockup's base64 PNGs — matches how every other screen in this app
 * was converted. Shapes are adapted from the canonical wyp_icon_*.svg source
 * (see design/README.md), except Print, which reuses the exact icon already
 * used on Create Request / Request Response for consistency with that
 * existing precedent rather than the asset-source printer glyph.
 */

type SentRow = {
  id: string
  description: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  created_at: string
  contacts: { display_name: string } | null
  dialog: { count: number }[] | null
  // Week 5 Priority 3 (Attachments, 2026-08-14) — same PostgREST count-embed
  // technique as dialog(count) above.
  attachments: { count: number }[] | null
  // categories(name) added 2026-08-15 for the Print Reports Category-prefix
  // feature below — Requests have always had a category_id (same as ToDos).
  // Gated by sentCategoriesEnabled (split from the old shared
  // categoriesEnabled, migration 073, 2026-09-30) since Sent's own Category
  // display (added 2026-08-24, see below) is now independently toggleable
  // from ToDos'.
  categories: { name: string } | null
  // archived_at added by migration 028 (Archive, 2026-08-14) — the row's own
  // owner archived it via /archive. Deliberately still selected/fetched here
  // rather than filtered out server-side: PRD §9.5 keeps an archived record
  // "available through Search," so this list hides an archived row when
  // resting but re-includes it once the owner is actively searching (see
  // filteredSent below).
  archived_at: string | null
  // repeat_rule — Jim's own recurrence-method design, 2026-08-21, for the
  // print report's own "Repeats: ..." line only (no on-screen use here).
  repeat_rule: RepeatRule | null
  // repeat_occurrence_index/repeat_series_id (2026-09-18, revised
  // 2026-09-23) — the "Repeating" chip shows the current, most-recent
  // active occurrence of each series; see repeatingHeadIds() below.
  repeat_occurrence_index: number | null
  repeat_series_id: string | null
  // Receipt Confirmation (migration 069, 2026-09-24, owner's own PDF spec)
  // — Sent-only (a recipient confirming receipt is only meaningful to the
  // Requestor who asked for it); drives the new icon in .r2 below and the
  // print report's own status line.
  receipt_confirmation_requested: boolean
  receipt_confirmed_at: string | null
}

type TodoRow = {
  id: string
  description: string
  priority: number | null
  due_date: string | null
  done_date: string | null
  // created_at added 2026-08-17 — the ToDos colbar now shows a Date column
  // (creation date) matching Sent/Received's own, always present regardless
  // of todo_dates_enabled (owner: "Date created and Date Done are always
  // captured and shown in the ToDos list view").
  created_at: string
  categories: { name: string } | null
  dialog: { count: number }[] | null
  // archived_at — same reasoning as SentRow above. A ToDo has no recipient,
  // so this is its only archive state (there is no received_archived_at
  // counterpart for ToDos).
  archived_at: string | null
  repeat_rule: RepeatRule | null
  // repeat_occurrence_index/repeat_series_id — see SentRow's own identical
  // field comment.
  repeat_occurrence_index: number | null
  repeat_series_id: string | null
}

// Shape returned by the get_received_requests() RPC (migration 012, plus
// due_time added by migration 017 for the Print Reports feature below) —
// deliberately close to SentRow so the row-rendering JSX below barely
// diverges: owner_name stands in for contacts.display_name (this is the
// sender, not a contact of the signed-in user's own), dialog_count stands
// in for the dialog(count) embed a plain PostgREST select gets for free
// (an RPC has to compute it server-side instead). No category anywhere —
// PRD §2.3, enforced inside the function itself, not just left off here.
type ReceivedRow = {
  id: string
  description: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  created_at: string
  owner_name: string | null
  // owner_request_time_enabled added by migration 021, alongside due_time —
  // each Received row can have a different sender, so the Print Received
  // Due Time sub-line has to be gated per-row by that row's own sender's
  // setting, not the signed-in viewer's own (see requestTimeEnabled below,
  // which only governs Sent).
  owner_request_time_enabled: boolean
  dialog_count: number
  // attachment_count added by migration 027, alongside dialog_count above —
  // same reasoning as owner_request_time_enabled: an RPC has to compute
  // this server-side, a plain PostgREST embed isn't available the way it
  // is for Sent's attachments(count).
  attachment_count: number
  // received_archived_at added by migration 028 (Archive, 2026-08-14) — the
  // signed-in recipient archived their own copy of this Request via
  // /archive. Independent of the row's own archived_at (SentRow) — the
  // sender's Sent view of the same row is untouched by this. Same
  // still-fetched-but-hidden-at-rest treatment as SentRow.archived_at; see
  // filteredReceived below.
  received_archived_at: string | null
  // repeat_rule — migration 040, alongside this batch's other Repeat print
  // additions. The issuer's own rule, read-only here same as everywhere
  // else Received shows issuer-owned information.
  repeat_rule: RepeatRule | null
  // Receipt Confirmation (migration 071, 2026-09-25) — Jim, for consistency
  // with Dialog/Attachments already showing on Received: "the confirmed
  // icons should be shown in the Requests Received list." The issuer's own
  // setting/state, read-only here same as repeat_rule above.
  receipt_confirmation_requested: boolean
  receipt_confirmed_at: string | null
}

// Print Reports detail (2026-08-15) — the owner's own xlsx print mockups
// (Main Screen sections - Sent/Received/ToDos) show each record's full
// Dialog thread and full Attachments/Locations list, not just an icon
// indicating either exists. None of the three sections' own Main Screen
// list queries load that content today — Sent and ToDos only fetch
// dialog(count)/attachments(count) PostgREST embeds, Received only fetches
// dialog_count/attachment_count from get_received_requests() — since the
// on-screen rows only ever needed a count for the icon, not the text.
// Deliberately not switching the main list queries to load full content by
// default (that would add real payload weight to every ordinary Main
// Screen load for content the screen itself never shows) — instead this is
// fetched only once, at the moment a Print button is actually clicked, for
// just the ids currently on screen. See loadOwnedPrintDetail/
// loadReceivedPrintDetail and startPrint below.
type PrintDialogEntry = {
  id: string
  kind: string
  body: string
  who: string | null
  replies_to_id: string | null
}

type PrintAttachmentEntry = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  reference_url: string | null
  reference_note: string | null
}

type PrintDetail = { dialog: PrintDialogEntry[]; attachments: PrintAttachmentEntry[] }
type PrintDetailMap = Record<string, PrintDetail>

const PRIORITY_LABEL: Record<number, string> = { 1: 'ASAP', 2: 'SOON', 3: 'LATER' }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// due_date/done_date/created_at all arrive as 'YYYY-MM-DD' (dates) or a full
// ISO timestamp (created_at) — slicing to the first 10 characters handles
// both before splitting, matching the app-wide MM-DD-YY display convention.
function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

// formatMDYFromTimestamp (2026-09-02, owner-reported: Dialog entries and the
// "Date" column showing tomorrow's date) — for a real timestamptz like
// created_at, unlike formatMDY above. formatMDY slices the ISO string's
// first 10 characters, correct for a date-only column (due_date/done_date)
// but wrong for created_at: it reads the UTC calendar date, which has
// already rolled to the next day whenever local time is evening or later in
// a negative-UTC-offset zone. new Date(value)'s getFullYear/getMonth/
// getDate are local-time-based, so they read the correct calendar day for
// the viewer.
function formatMDYFromTimestamp(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}-${String(y).slice(2)}`
}

// Same helper as RequestResponseForm.tsx/ResponseDetailForm.tsx — duplicated
// per this codebase's established convention for small stateless formatters
// rather than extracted to a shared lib file. Only needed here for the
// Print Reports feature below (2026-08-13): Due Time has never been shown
// anywhere on the live Main Screen rows themselves.
function formatTime12h(value: string | null): string {
  if (!value) return ''
  const [hStr, mStr] = value.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${ampm}`
}

// Print-only Due/Done date format (2026-08-15) — the owner's own xlsx
// example shows a combined date+time on one line, "7/15/26  8:30 AM": no
// zero-padding on month/day, slash-separated, 2-digit year. Deliberately
// different from formatMDY's dash/zero-padded convention used everywhere
// else (Date column here, and every on-screen row app-wide) — scoped to
// just the Due/Done columns that can also carry a Time, so a row with a
// time reads as one plain sentence instead of mixing two date-punctuation
// styles. Flagged to the owner as an asymmetry, not silently generalized.
function formatMDYSlash(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(2)}`
}


const CHIP_LABEL: Record<FilterValue, string> = {
  all: 'All',
  open: 'Open',
  overdue: 'Overdue',
  done: 'Done',
  repeating: 'Repeating',
}

// Shared by Sent, Received, and (as of 2026-08-12) ToDos — all three now
// carry the same Open/Overdue/Done lifecycle over due_date/done_date. A
// null due_date can never read as overdue, which is exactly the rule that
// keeps a ToDo with no Due Date out of the Overdue chip: PRD/UI spec v2.9
// both still say "Overdue does not apply to ToDos... due date is optional"
// (true before ToDos ever had a due_date column to test), but the owner's
// own request treats "no due date" as "never overdue" rather than "the
// concept doesn't apply" — same outcome for a ToDo with no Due Date, but
// now a real ToDo with a real, past Due Date reads as Overdue like a
// Request does. See CLAUDE.md/decisions log, 2026-08-12.
function statusFor(due_date: string | null, done_date: string | null): 'open' | 'overdue' | 'done' {
  if (done_date) return 'done'
  if (due_date && due_date < todayIso()) return 'overdue'
  return 'open'
}

function sentStatus(r: SentRow): 'open' | 'overdue' | 'done' {
  return statusFor(r.due_date, r.done_date)
}

function receivedStatus(r: ReceivedRow): 'open' | 'overdue' | 'done' {
  return statusFor(r.due_date, r.done_date)
}

function todoStatus(t: TodoRow): 'open' | 'overdue' | 'done' {
  return statusFor(t.due_date, t.done_date)
}

// Owner-reported, 2026-08-13: the Open chip on Sent/Received/ToDos was
// excluding Overdue rows entirely — "Overdue items ... should be shown -
// because they are open." statusFor() above is a three-way exclusive
// status (open/overdue/done) so a plain equality check against the 'open'
// filter naturally missed them; Overdue is a stricter subset of "not done,"
// not a sibling category disjoint from Open. The Overdue chip itself still
// narrows to just status === 'overdue', unchanged — only the Open chip's
// own matching rule changes, to treat overdue rows as open too.
function matchesStatusFilter(status: 'open' | 'overdue' | 'done', filter: FilterValue): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return status === 'open' || status === 'overdue'
  // 'repeating' never reaches here in practice — Received (the only caller
  // that can't special-case it the way filteredSent/filteredTodos do above)
  // never renders a Repeating chip, so receivedFilter can never actually
  // hold this value — but the type is shared across all three filters (see
  // FilterValue's own comment), so this still needs to be an exhaustive,
  // harmless no-match rather than a type error.
  if (filter === 'repeating') return false
  return status === filter
}

// "Repeating" chip (2026-09-18, owner's own design; revised 2026-09-23) —
// Sent/ToDos only. Originally showed only occurrence_index <= 1 ("the
// initial Request for the repeat"), but that anchor turned out fragile:
// repeat_rule is copied onto every generated occurrence and never cleared
// by cron Phase E, so if occurrence 1 specifically lost its own rule (a
// manual Remove, or simply being superseded), no row satisfied "occurrence
// 1 AND has a rule" any more even though the series was still actively
// generating. Owner's own fix: show "the most recent item in the series,"
// since that's also where future generation and any Repeat edits actually
// happen — grouped by repeat_series_id (migration 068), falling back to
// the row's own id for a pre-migration series (no backfill — see that
// migration's own header comment), so an old chain still shows every
// qualifying row individually rather than being silently hidden.
function repeatingHeadIds<
  T extends { id: string; repeat_rule: RepeatRule | null; repeat_occurrence_index: number | null; repeat_series_id: string | null; archived_at: string | null }
>(rows: T[]): Set<string> {
  const heads = new Map<string, T>()
  for (const r of rows) {
    if (r.repeat_rule == null || r.archived_at) continue
    const key = r.repeat_series_id ?? r.id
    const current = heads.get(key)
    if (!current || (r.repeat_occurrence_index ?? 1) > (current.repeat_occurrence_index ?? 1)) {
      heads.set(key, r)
    }
  }
  return new Set(Array.from(heads.values(), (r) => r.id))
}

// Date Range search scope (2026-08-19) — either side alone is a valid
// search: From with no To means "on or after," To with no From means "on or
// before," both means inclusive between. A row with no Due Date at all never
// matches a Date Range search (nothing to compare) — same reasoning as
// Archive's own "Before Done Date" filter treating a missing date as not a
// match, just generalized to two sides instead of one.
function matchesDateRange(dueDate: string | null, from: string, to: string): boolean {
  if (!dueDate) return false
  const d = dueDate.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

// Advanced Search Filters (2026-11-13, owner's own mockup) — a third scope
// alongside All/Date Range, reached by its own "Advanced" chip rather than
// an inline field set, since it needs more room than the search band gives.
// Applied (not live-as-typed): a draft is edited inside the dialog and only
// takes effect on Search, so a half-finished edit never narrows the lists
// behind it. Date Range here matches ANY checked date type (Created/Due/
// Done), not all of them — confirmed with the owner — same as Text below
// matching ANY checked field (Dialog/Description). Contact Type doubles as
// the Sent/Received scope gate (From -> Received, To -> Sent, confirmed),
// so Requests/Contact Type/Contact Name together decide which of those two
// sections participate at all, independent of ToDos.
//
// Layout redesign (2026-11-14, owner's own "Suggested" mockup, comparing a
// real Windows/Android screenshot against it) — each section's own label
// ("Date Type," renamed from "Date Range"; "Text Type," renamed from "Text";
// "Contact Type") now sits inline with its own checkbox row instead of
// stacked above it (new .advlabelrow/.advrow-label, globals.css), and the
// Status radios lay out horizontally in one row instead of stacked
// (.stopgroup.advstatus-inline) — both conserve vertical space on a phone,
// the owner's stated goal; the underlying matching logic (ANY-of-checked OR
// logic, Contact Type's Sent/Received cascade) is unchanged, this is a pure
// layout pass. Category and Contact Name are now real lookup fields
// (LookupGlyph, .ffloat/.flabel/.lookup-results — the exact pattern Create
// Request/Create ToDo already use for Recipient/Category), per the owner's
// own explicit request — but the underlying match stays a plain substring
// against advDraft.category/contactName, same as before: picking a row from
// the dropdown just fills the field with that exact name rather than
// narrowing to one id, so free-typed partial text (no exact match required)
// still works exactly as it always has.
type AdvancedStatusValue = 'all' | 'open' | 'overdue' | 'done'

type AdvancedSearchFilter = {
  dateCreated: boolean
  dateDue: boolean
  dateDone: boolean
  fromDate: string
  toDate: string
  // category (2026-11-14, owner: "I forgot to add Category") — the field
  // itself is a lookup/dropdown picker (same as contactName below, added
  // same day), but the stored value and its match are still a plain
  // substring, same convention as contactName; only ever matches a Sent
  // row (when sentCategoriesEnabled) or a ToDo (when todoCategoriesEnabled)
  // — Received never has one, PRD §2.3. Narrows on top of everything else
  // rather than gating a whole
  // section's participation the way Contact Type does, since there's no
  // paired "is Category even relevant" checkbox for it to cascade from.
  category: string
  status: AdvancedStatusValue
  textDialog: boolean
  textDescription: boolean
  searchText: string
  requests: boolean
  contactTo: boolean
  contactFrom: boolean
  contactName: string
  todos: boolean
}

const ADVANCED_SEARCH_DEFAULT: AdvancedSearchFilter = {
  dateCreated: true,
  dateDue: true,
  dateDone: true,
  fromDate: '',
  toDate: '',
  category: '',
  status: 'all',
  textDialog: true,
  textDescription: true,
  searchText: '',
  requests: true,
  contactTo: true,
  contactFrom: true,
  contactName: '',
  todos: true,
}

// Advanced Search's own Category/Contact Name lookup lists (2026-11-14) —
// a plain id+name/display_name shape, same fields CreateRequestForm.tsx
// fetches for its own Recipient/Category lookups, lazily loaded once on
// first dialog open (see openAdvancedSearch below) rather than on every
// Main Screen mount, since most visits never open this dialog at all.
type AdvLookupContact = { id: string; display_name: string }
type AdvLookupCategory = { id: string; name: string }

// Same browse-on-focus-when-short threshold as CreateRequestForm.tsx's own
// LOOKUP_BROWSE_THRESHOLD (2026-08-09/08-10) — duplicated here rather than
// imported, matching this codebase's established per-file convention for
// small shared constants.
const ADV_LOOKUP_BROWSE_THRESHOLD = 12

function inDateRange(dateStr: string, from: string, to: string): boolean {
  if (from && dateStr < from) return false
  if (to && dateStr > to) return false
  return true
}

// ANY of the checked date types matching the range counts as a match — the
// owner's own confirmed answer ("ANY Created, Due, Done"). No range entered
// at all (both sides blank) means Date Range isn't constraining this search,
// regardless of which boxes are checked.
function matchesAdvancedDateRange(
  f: AdvancedSearchFilter,
  createdAt: string,
  dueDate: string | null,
  doneDate: string | null
): boolean {
  if (!f.fromDate && !f.toDate) return true
  const checks: boolean[] = []
  if (f.dateCreated) checks.push(inDateRange(createdAt.slice(0, 10), f.fromDate, f.toDate))
  if (f.dateDue) checks.push(dueDate != null && inDateRange(dueDate.slice(0, 10), f.fromDate, f.toDate))
  if (f.dateDone) checks.push(doneDate != null && inDateRange(doneDate.slice(0, 10), f.fromDate, f.toDate))
  if (checks.length === 0) return true
  return checks.some(Boolean)
}

// Same ANY-of-checked-types logic as dates above, confirmed by the owner
// for Text (Dialog/Description) too. dialogBlob is the lowercased, joined
// body text of every Dialog entry on this item — see loadOwnedPrintDetail/
// loadReceivedPrintDetail above, reused rather than a new fetch path, and
// fetchAdvancedDialogText below, which builds this map only when Dialog
// text matching is actually requested.
function matchesAdvancedText(f: AdvancedSearchFilter, description: string, dialogBlob: string): boolean {
  const q = f.searchText.trim().toLowerCase()
  if (!q) return true
  const checks: boolean[] = []
  if (f.textDescription) checks.push(description.toLowerCase().includes(q))
  if (f.textDialog) checks.push(dialogBlob.includes(q))
  if (checks.length === 0) return true
  return checks.some(Boolean)
}

const MAIN_SEARCH_ADVANCED_KEY = 'wyp.mainSearchAdvanced'

function readStoredAdvancedFilter(): AdvancedSearchFilter | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(MAIN_SEARCH_ADVANCED_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AdvancedSearchFilter>
    return { ...ADVANCED_SEARCH_DEFAULT, ...parsed }
  } catch {
    return null
  }
}

function dialogCount(dialog: { count: number }[] | null): number {
  return dialog?.[0]?.count ?? 0
}

// Same shape as dialogCount above, for Sent's attachments(count) embed
// (Week 5 Priority 3, 2026-08-14).
function attachmentCount(attachments: { count: number }[] | null): number {
  return attachments?.[0]?.count ?? 0
}

// Sent/ToDos are both rows in the same `requests` table the signed-in owner
// already has plain RLS SELECT access to (migration 025: "SELECT is
// owner-only" on dialog/attachments) — no RPC needed, unlike Received below.
// Field lists match RequestDetailForm.tsx's own dialog select and the
// attachments API route's own select (see PrintDialogEntry/
// PrintAttachmentEntry's own comments) — no new fields invented.
async function loadOwnedPrintDetail(ids: string[]): Promise<PrintDetailMap> {
  const map: PrintDetailMap = {}
  for (const id of ids) map[id] = { dialog: [], attachments: [] }
  if (ids.length === 0) return map

  const [dlgRes, attRes] = await Promise.all([
    supabase.from('dialog').select('id, request_id, kind, body, who, replies_to_id').in('request_id', ids).order('id'),
    supabase
      .from('attachments')
      .select('id, request_id, kind, file_name, reference_url, reference_note')
      .in('request_id', ids)
      .is('deleted_at', null)
      .order('created_at'),
  ])

  for (const d of (dlgRes.data as unknown as (PrintDialogEntry & { request_id: string })[]) ?? []) {
    map[d.request_id]?.dialog.push(d)
  }
  for (const a of (attRes.data as unknown as (PrintAttachmentEntry & { request_id: string })[]) ?? []) {
    map[a.request_id]?.attachments.push(a)
  }
  return map
}

// Received rows belong to a different owner — Dialog/Attachments RLS is
// owner-only, so the recipient can't query those tables directly the same
// way Sent/ToDos can. Migration 029's get_received_print_detail() is the
// parallel to get_received_requests() itself: same contacts.email match
// against the caller's own session email, just returning full content
// instead of counts, only for the ids actually being printed right now.
async function loadReceivedPrintDetail(ids: string[]): Promise<PrintDetailMap> {
  const map: PrintDetailMap = {}
  for (const id of ids) map[id] = { dialog: [], attachments: [] }
  if (ids.length === 0) return map

  const { data } = await supabase.rpc('get_received_print_detail', { p_ids: ids })
  for (const row of (data as { request_id: string; dialog: PrintDialogEntry[]; attachments: PrintAttachmentEntry[] }[]) ?? []) {
    map[row.request_id] = { dialog: row.dialog ?? [], attachments: row.attachments ?? [] }
  }
  return map
}

// Advanced Search's own Dialog-text matching (2026-11-13) — reuses
// loadOwnedPrintDetail/loadReceivedPrintDetail verbatim rather than a new
// fetch path or RPC: those already fetch full Dialog content, lazily, for
// whatever ids are passed, which is exactly what's needed here. Owned ids
// cover both Sent and ToDos (same `requests` table, same owner-RLS read);
// Received goes through the same RPC the Print feature already uses.
// Called only when Search is clicked with real search text AND the Dialog
// checkbox on — skipped entirely otherwise, so an ordinary Advanced Search
// (Description-only, or no text at all) never pays for this fetch.
async function fetchAdvancedDialogText(
  ownedIds: string[],
  receivedIds: string[]
): Promise<Record<string, string>> {
  const [ownedMap, receivedMap] = await Promise.all([
    loadOwnedPrintDetail(ownedIds),
    loadReceivedPrintDetail(receivedIds),
  ])
  const blob: Record<string, string> = {}
  for (const [id, detail] of Object.entries(ownedMap)) {
    blob[id] = detail.dialog.map((d) => d.body).join(' ').toLowerCase()
  }
  for (const [id, detail] of Object.entries(receivedMap)) {
    blob[id] = detail.dialog.map((d) => d.body).join(' ').toLowerCase()
  }
  return blob
}

// Column-header sorting (2026-08-11) — owner: "Main screen sorting was
// referring to the various column headings and the ascending and
// descending sort options with the yellow background for the selected
// column title." Before this, only Due (Sent/Received) and Priority
// (ToDos) ever rendered as the yellow .pill, and it was a fixed default —
// not a live, clickable, direction-toggling control; every other .colbar
// header (To/From, Date, Done; Category — Description) was plain text.
// Client-side, over the already-fetched/filtered rows — same reasoning as
// the filter chips and search: these lists are personal-scale, so a
// re-query per click isn't worth the complexity.
type SortDir = 'asc' | 'desc'
// Received never shows or sorts by Category (PRD §2.3 withholds it from the
// recipient entirely — see ReceivedRow's own comment) — ReqSortKey stays
// exactly what Received's colbar needs. Sent's own Category column
// (reinstated 2026-08-24, see SentSortKey below) needs one more key than
// Received does, so the two are no longer the same type.
type ReqSortKey = 'name' | 'date' | 'due' | 'done'
// 'category' retired 2026-08-17 as a ToDos colbar heading (the .colbar.dcols
// redesign replaced it with the plain "Description" label), then reinstated
// 2026-08-24 — Category becomes the column heading in place of Description
// whenever Private Category is on (owner: "replace the column heading of
// 'Description'... with Category (including it being a sort option)").
// Sent gains the identical column/sort for the first time in this same
// batch — SentSortKey below, not a change to ReqSortKey, since Received
// must never gain it.
type TodoSortKey = 'priority' | 'date' | 'due' | 'done' | 'category'
// Sent-only — see the comment on ReqSortKey above.
type SentSortKey = ReqSortKey | 'category'

// Each column's own sensible starting direction the first time it's
// clicked — matching the defaults this screen already had (Due descending,
// Priority ascending) rather than forcing every column to start ascending.
// A second click on the already-active column reverses direction instead
// of re-consulting this table.
const REQ_SORT_DEFAULT_DIR: Record<ReqSortKey, SortDir> = {
  name: 'asc',
  date: 'desc',
  due: 'desc',
  done: 'desc',
}

// Extends REQ_SORT_DEFAULT_DIR with Category's own starting direction
// (alphabetical, same convention as name/To) — Sent-only, see SentSortKey.
const SENT_SORT_DEFAULT_DIR: Record<SentSortKey, SortDir> = {
  ...REQ_SORT_DEFAULT_DIR,
  category: 'asc',
}

const TODO_SORT_DEFAULT_DIR: Record<TodoSortKey, SortDir> = {
  priority: 'asc',
  date: 'desc',
  due: 'desc',
  done: 'desc',
  category: 'asc',
}

// Each list's own starting sort, used both to seed sessionStorage on first
// load (readStoredSort's own fallback below) and, as of 2026-11-08, to
// revert to when a filter-chip click leaves a "done" sort key stranded —
// see selectSentFilter/selectReceivedFilter/selectTodoFilter.
const SENT_SORT_LIST_DEFAULT: { key: SentSortKey; dir: SortDir } = { key: 'due', dir: 'desc' }
const RECEIVED_SORT_LIST_DEFAULT: { key: ReqSortKey; dir: SortDir } = { key: 'due', dir: 'desc' }
const TODO_SORT_LIST_DEFAULT: { key: TodoSortKey; dir: SortDir } = { key: 'priority', dir: 'asc' }

function toggleSort<K extends string>(
  current: { key: K; dir: SortDir },
  key: K,
  defaults: Record<K, SortDir>
): { key: K; dir: SortDir } {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key, dir: defaults[key] }
}

// Nulls always sort last, regardless of direction — an empty Due/Done/
// Category shouldn't jump to the top of an ascending sort just because
// null compares "less than" a real value. Applied uniformly to every
// column, including Date, even though created_at is never actually null in
// practice.
function compareNullable<T>(a: T | null, b: T | null, dir: SortDir, cmp: (a: T, b: T) => number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const result = cmp(a, b)
  return dir === 'asc' ? result : -result
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function compareNumbers(a: number, b: number): number {
  return a - b
}

// Secondary tie-break, 2026-08-24 — owner: "if To, From, or Category is
// selected - secondarily sort the output by descending Due Date (except for
// ToDos if Due Dates are not shown - then for ToDos secondarily sort by
// descending Date)." Always descending, regardless of the primary column's
// own asc/desc direction — a fixed tie-break, not a second user-controlled
// sort. Only ever consulted when the primary comparison above returns 0
// (equal), so an already-decisive primary sort is never disturbed.
function compareDueDesc(a: string | null, b: string | null): number {
  return compareNullable(a, b, 'desc', compareStrings)
}

// Sort state persistence mirrors the existing chip-state pattern below
// (readStoredChip/sessionStorage) — a within-session view preference, not a
// scoping call confirmed with the owner but a direct extension of the
// precedent he already set for filter chips and the Housekeeping tab.
// Stored as "key:dir" in one string rather than two separate keys.
function readStoredSort<K extends string>(
  storageKey: string,
  allowedKeys: readonly K[],
  fallback: { key: K; dir: SortDir }
): { key: K; dir: SortDir } {
  if (typeof window === 'undefined') return fallback
  const raw = window.sessionStorage.getItem(storageKey)
  if (!raw) return fallback
  const [k, d] = raw.split(':')
  if ((allowedKeys as readonly string[]).includes(k) && (d === 'asc' || d === 'desc')) {
    return { key: k as K, dir: d as SortDir }
  }
  return fallback
}

function writeStoredSort(storageKey: string, sort: { key: string; dir: SortDir }) {
  window.sessionStorage.setItem(storageKey, `${sort.key}:${sort.dir}`)
}

// One column-header cell — renders as plain text at rest, or the existing
// yellow .pill plus a direction arrow when it's the active sort column.
// className carries the cell's own existing alignment rule (.c-nm/.c-dt/
// .c-due/.c-dn/.c-pri/.c-cat) unchanged; only the element itself (span ->
// button) and the pill/arrow are new.
function ColSort({
  className,
  label,
  active,
  dir,
  onClick,
  disabled = false,
}: {
  className: string
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  // Done column, Sent/Received only, 2026-08-17 — see the caller's own
  // comment. When true, this cell renders as plain inert text: no .pill,
  // no arrow, no click, regardless of whether it's still the stored sort
  // key underneath.
  disabled?: boolean
}) {
  // aria-sort is only valid on elements with role="columnheader"/"rowheader"
  // (or a native <th>) per jsx-a11y/role-supports-aria-props — this is a
  // plain <button> (implicit role="button"), so the sort state is conveyed
  // via aria-label instead. The visible ▲/▼ inside .pill already carries
  // the same information sighted users get.
  const showActive = active && !disabled
  const stateLabel = showActive ? `, currently sorted ${dir === 'asc' ? 'ascending' : 'descending'}` : ''
  return (
    <button
      type="button"
      className={className}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={`Sort by ${label}${stateLabel}`}
    >
      {showActive ? <span className="pill">{label}&nbsp;{dir === 'asc' ? '▲' : '▼'}</span> : label}
    </button>
  )
}

// Chip-state persistence (2026-08-09) — "It would be appropriate to return
// to the same chip state on the main screen." Main Screen fully remounts on
// router.back() (no Cache Components/Activity in this app — see CLAUDE.md),
// so plain useState alone loses these on every trip to a Detail screen and
// back. sessionStorage, not localStorage: this is a within-session view
// preference, not a durable account setting like "Keep me signed in"
// (supabaseClient.ts's REMEMBER_KEY) — it's fine, even arguably correct, for
// it to reset the next time the tab is actually closed and reopened. Scoped
// to filter chips specifically (Sent, ToDos, Housekeeping's Tasks/How-to
// Videos tab), matching the owner's own wording ("chip state") — the search
// text box is a separate control and stays session-only/unpersisted unless
// asked.
//
// Extended cross-session, per-account, 2026-08-13 (migration 016,
// profiles.main_chip_prefs) — owner: "keep track of the chip settings
// last-used for an account user... these defaults should only be used the
// first time an account user sees the main screen." sessionStorage above
// is kept as-is, unchanged, purely as a same-tab fast path (it resolves
// synchronously on mount, so a quick round trip to a Detail screen and back
// shows the right chips instantly, with no flash of default state while the
// slower DB read below is still in flight). The DB column is the actual
// source of truth across sessions and devices: read once on mount and
// applied on top of whatever sessionStorage/hardcoded default already
// rendered, then kept in sync on every change via loadMainChipPrefs/
// MAIN_CHIP_PREFS_DEFAULT below. An empty `{}` (a brand new account's
// initial default value, migration 016) is the one and only condition that
// means "first time" — real values, once saved, are never overwritten by
// the hardcoded defaults again for that account.
const SENT_FILTER_KEY = 'wyp.mainSentFilter'
const RECEIVED_FILTER_KEY = 'wyp.mainReceivedFilter'
const TODO_FILTER_KEY = 'wyp.mainTodoFilter'
const HK_TAB_KEY = 'wyp.mainHkTab'
const SENT_SORT_KEY = 'wyp.mainSentSort'
const RECEIVED_SORT_KEY = 'wyp.mainReceivedSort'
const TODO_SORT_KEY = 'wyp.mainTodoSort'
// .scroll (globals.css) is an internally-scrolling div, not the window —
// browsers only restore window.scrollY across a client-side navigation,
// never an arbitrary overflow:auto element's own scrollTop. router.back()
// alone (2026-08-09, Request/ToDo/Contact Detail) was never enough on its
// own for that reason; it just happened to go unnoticed until reported
// 2026-08-13 ("returns to the top of the screen and shows Requests Sent"
// after adding/editing a ToDo). Saved on every scroll, restored once after
// the data fetch that follows a fresh mount has actually resolved — restoring
// any earlier, while the section still shows "Loading…", would land on a
// stray offset once real content changes the page's height.
const MAIN_SCROLL_KEY = 'wyp.mainScrollTop'

// Refetch-on-focus debounce (2026-09-16) — see the effect's own comment
// further below. Only guards against 'visibilitychange' and 'focus' both
// firing for the same tab-switch; not a rate limit meant to matter beyond
// that.
const REFOCUS_REFRESH_MIN_INTERVAL_MS = 5000

// Search round-trip persistence (2026-08-26) — owner-reported: clicking a
// Search Results row (Sent/Received/ToDos) to open its Request/ToDo/
// Response Detail, then Close/Cancel back, dropped straight into a normal,
// non-searching Main Screen instead of the same Search results the row was
// opened from. Root cause is the same one this file's own 2026-08-09
// scroll-position/chip-filter fixes already solved for other state:
// router.back() from a Detail screen still fully remounts this component
// (this app deliberately doesn't use Next 16's opt-in Cache Components/
// Activity — see next.config.ts — so the remount is real, not cached), and
// plain useState resets to its initial value on every remount. The three
// row-click handlers below already had nothing marking "this navigation
// should come back to what I had" the way ArchiveForm.tsx's own
// ARCHIVE_ROUNDTRIP_KEY already does for that screen's filters/selection —
// same shape, applied here to searchText/searchScope/fromDate/toDate.
// Deliberately scoped to the one round trip, not a permanent persistence
// like the sentFilter/receivedFilter/todoFilter chips above: a fresh visit
// to Main Screen (not returning from a just-opened Detail row) still starts
// with Search cleared, matching this file's own 2026-08-09 decision that a
// search-in-progress shouldn't survive indefinitely across visits.
const MAIN_SEARCH_TEXT_KEY = 'wyp.mainSearchText'
const MAIN_SEARCH_SCOPE_KEY = 'wyp.mainSearchScope'
const MAIN_SEARCH_FROM_KEY = 'wyp.mainSearchFrom'
const MAIN_SEARCH_TO_KEY = 'wyp.mainSearchTo'
const MAIN_SEARCH_ROUNDTRIP_KEY = 'wyp.mainSearchRoundTrip'

// Read-only check of the round-trip marker the three row-click handlers set
// — used by the search useState lazy initializers below to decide whether
// to restore stored search state or start blank. Checked synchronously
// inside each initializer (React guarantees these run exactly once per
// mount, before first paint) rather than via a setState call in a
// useEffect, matching ArchiveForm.tsx's own isArchiveRoundTrip() and its
// own comment on why (avoids an extra render and the
// react-hooks/set-state-in-effect lint rule, for no benefit here since the
// value is already known synchronously at mount time).
function isMainSearchRoundTrip(): boolean {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(MAIN_SEARCH_ROUNDTRIP_KEY) === '1'
}

function readStoredString(key: string): string {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(key) ?? ''
}

// 'repeating' (2026-09-18) — only ever offered on Sent/ToDos (never
// Received, per Jim's own scoping); shared across all three filter types
// anyway since restoring a stored 'repeating' value for Received is
// harmless — that section's own chip row simply never renders a button
// that could produce it.
type FilterValue = 'all' | 'open' | 'overdue' | 'done' | 'repeating'
const FILTER_VALUES = ['all', 'open', 'overdue', 'done', 'repeating'] as const

type MainChipPrefs = {
  sentFilter?: FilterValue
  receivedFilter?: FilterValue
  todoFilter?: FilterValue
  hkTab?: 'tasks' | 'videos' | 'statistics' | 'tester'
}

function readStoredChip<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback
  const v = window.sessionStorage.getItem(key)
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function DialogIcon() {
  return (
    <svg className="iico" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <title>Dialog present</title>
      <path
        d="M23,6 H37 A5,5 0 0 1 42,11 V19 A5,5 0 0 1 37,24 H30 L36,31 L28,24 H23 A5,5 0 0 1 18,19 V11 A5,5 0 0 1 23,6 Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M11,20 H25 A5,5 0 0 1 30,25 V33 A5,5 0 0 1 25,38 H17 L10,44 L13,38 H11 A5,5 0 0 1 6,33 V25 A5,5 0 0 1 11,20 Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Paperclip — Attachments present (Week 5 Priority 3, 2026-08-14). Same
// viewBox/sizing convention as DialogIcon above so the two sit evenly
// alongside each other wherever both can appear.
function AttachmentIcon() {
  return (
    <svg className="iico" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <title>Attachments present</title>
      <path
        d="M32,14 L20,26 A6,6 0 0 0 28.5,34.5 L39,24 A10,10 0 0 0 24.5,9.5 L12.5,21.5 A14,14 0 0 0 32,41"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Receipt Confirmation icons (migration 069, 2026-09-24, owner's own PDF
// spec — "the Receipt Confirmation icon should be the first on the left").
// <title> supplies the hover-text callout the owner's spec asked for, same
// mechanism as Dialog/Attachments' own.
//
// Redesigned 2026-09-25 — the first two drafts (varying only strokeWidth,
// then a hollow-outline-vs-solid-fill pair) were both flagged as too subtle
// or too thin to read reliably at this app's ~14-15px icon size. Jim's own
// third idea, adopted: keep one identical bold checkmark shape for both
// states (same path/thickness this icon has used since it first shipped —
// no legibility risk, nothing new to prove out) and distinguish them by
// color instead — Awaiting is hardcoded to --alert-red ("Awaiting deserves
// a red highlighting"), Confirmed stays on currentColor (this app's usual
// --icon-grey, matching Dialog/Attachments) since a confirmed item needs no
// attention at all. Color reads instantly regardless of icon size, unlike
// either geometric alternative that was tried first.
function ReceiptAwaitingIcon() {
  return (
    <svg className="iico" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <title>Awaiting receipt confirmation</title>
      <path d="M9,25 L19,35 L39,12" stroke="var(--alert-red)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ReceiptConfirmedIcon() {
  return (
    <svg className="iico" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <title>Receipt confirmed</title>
      <path d="M9,25 L19,35 L39,12" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Category prefix (2026-08-15, owner's own xlsx print mockups, comment #3:
// "If a Private Category is used, it would prefix the description text as
// it does in the Main Screen"). Applied literally to print only — on
// screen, ToDos show Category as its own .cat column, never a description
// prefix, and Sent has never shown Category anywhere on Main Screen at all
// (only ToDos' row has a Category column today), so this print behavior is
// new rather than matching an existing on-screen pattern in either case;
// flagged rather than silently done. Deliberately NOT applied to Received —
// PRD §2.3 withholds Category from the recipient entirely (already enforced
// inside get_received_requests()/get_received_print_detail() themselves,
// which return no category field to prefix with), so honoring comment #3 on
// the Received sheet as literally written would leak the sender's private
// Category to the recipient it's private from.
function categoryPrefix(name: string | null | undefined): string {
  return name ? `[${name}] ` : ''
}

// "Repeats: ..." print line (Jim's own instruction, 2026-08-21, "preceding
// the Dialog") — same shared describeRepeat() builder every consumer uses.
function PrintRepeatLine({ rule, dueDate }: { rule: RepeatRule | null; dueDate: string | null }) {
  if (!rule || !dueDate) return null
  return (
    <div className="prepeat">
      <span className="prepeathead">Repeats:</span> {describeRepeat(rule, dueDate)}
    </div>
  )
}

// Receipt Confirmation print line (migration 069, 2026-09-24) — same
// .prepeat/.prepeathead shape as PrintRepeatLine above, reused rather than
// a near-duplicate class for one more label:value print line. Sent only —
// see SentRow's own field comment.
function PrintReceiptConfirmationLine({
  requested,
  confirmedAt,
}: {
  requested: boolean
  confirmedAt: string | null
}) {
  if (!requested) return null
  return (
    <div className="prepeat">
      <span className="prepeathead">Receipt Confirmation:</span>{' '}
      {confirmedAt ? `Confirmed on ${formatMDYFromTimestamp(confirmedAt)}` : 'Awaiting confirmation'}
    </div>
  )
}

// Full Dialog thread for one printed record (2026-08-15) — see PrintDetail's
// own comment above. No sort-arrow/column-header row here, since this only
// ever renders inside a single record's block, never a list.
function PrintDialogList({ entries }: { entries: PrintDialogEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="pdlg">
      <div className="pdlghead">Dialog</div>
      {entries.map((e) => {
        const kindLabel = e.kind === 'question' ? 'Question' : e.kind === 'answer' ? 'Answer' : 'Comment'
        return (
          <div className="pdlgitem" key={e.id}>
            <span className="pdlgkind">{kindLabel}</span> {e.body}
          </div>
        )
      })}
    </div>
  )
}

// Attachments (Sent/Received, kind='file') or Locations (ToDos, kind=
// 'reference') for one printed record — same component, caller supplies the
// heading text ("Attachments" vs. "Locations") matching each object type's
// own on-screen wording.
function PrintAttachmentList({ entries, heading }: { entries: PrintAttachmentEntry[]; heading: string }) {
  if (entries.length === 0) return null
  return (
    <div className="patt">
      <div className="patthead">{heading}</div>
      {entries.map((a) => (
        <div className="pattitem" key={a.id}>
          {a.kind === 'file'
            ? a.file_name
            : a.reference_note
              ? `${a.reference_note} — ${a.reference_url ?? ''}`
              : a.reference_url}
        </div>
      ))}
    </div>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="17" cy="11" r="1" fill="currentColor" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Duplicated per-file, same convention as DialogIcon/AttachmentIcon above and
// as every other screen's own MicIcon (RequestDetailForm.tsx etc.) — this
// file had no Description-style voice dictation before the Private Tester
// Feedback dialog (2026-10-21).
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="2.5" />
      <line x1="30" y1="30" x2="44" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// Advanced Search's own Category/Contact Name lookup fields (2026-11-14,
// owner: "the Contact Name and Category should interact as is done on the
// Create Request and Create Todo - with a pull-down and/or lookup") reuse
// this exact icon verbatim from CreateRequestForm.tsx's Recipient/Category
// fields — factored into one shared function here since both usages live
// in this same file, unlike those two screens' own per-file duplication.
function LookupGlyph() {
  return (
    <span className="lglyph" aria-hidden="true">
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
      </svg>
    </span>
  )
}

// VoiceSearchIcon removed 2026-08-19 — owner: drop the mic icon from Search
// now, both to reclaim horizontal space and because it was never wired to
// anything (always decorative); voice input on Description fields, where it
// would actually matter, is its own separate, not-yet-scoped idea.

export default function MainScreen() {
  const router = useRouter()
  const { canInstall, promptInstall } = usePWAInstall()
  // Apple/Safari has no `beforeinstallprompt` event at all, so `canInstall`
  // above is never true there — this is the fallback path (2026-09-03):
  // sense the platform once after mount and, if it's one with a real manual
  // install step Apple actually supports, show an Install row that opens an
  // instructions modal instead of `promptInstall()`. `isStandaloneDisplay()`
  // is checked first and wins outright (both branches stay 'none') so an
  // already-installed visitor is never offered a second icon, matching the
  // existing Chromium behavior where `canInstall` also goes false forever
  // once real installation happens.
  const [installGuidance, setInstallGuidance] = useState<
    'none' | 'ios-safari' | 'ios-other' | 'mac-safari' | 'desktop-chromium'
  >('none')
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  // Jim: "the actual Icon Installation could be named Homepage Icon
  // Installation or Desktop Icon Installation" — sensed from the OS, not
  // fixed text, so the same row reads correctly for both the Chromium
  // (`canInstall`) and Apple (`installGuidance`) paths below. Starts at the
  // desktop wording (matches every existing account until this effect runs)
  // rather than an empty string, so there's no flash of blank/placeholder
  // text on the rare frame before the mount effect resolves.
  const [installLabel, setInstallLabel] = useState<'Homepage' | 'Desktop'>('Desktop')

  const [sent, setSent] = useState<SentRow[]>([])
  const [received, setReceived] = useState<ReceivedRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped by the loadError block's own "Try Again" button (2026-08-18) —
  // see the main load() effect's own header comment for why a manual retry
  // needed to exist at all.
  const [reloadTick, setReloadTick] = useState(0)
  const [hkTab, setHkTab] = useState<'tasks' | 'videos' | 'statistics' | 'tester'>(() =>
    readStoredChip(HK_TAB_KEY, ['tasks', 'videos', 'statistics', 'tester'] as const, 'tasks')
  )
  const [signingOut, setSigningOut] = useState(false)

  // Private Tester menu (2026-10-26, moved onto its own Housekeeping chip
  // 2026-11-11 — see the chip row's own comment below) — Feedback and the
  // in-app Checklist (app/testers/checklist) are now plain rows under a
  // fourth "Private Tester" chip, same shape as Tasks/Help/Admin, rather
  // than a separate modal menu opened from a standalone button. Jim: "a
  // 'cleaner' approach would be to add a chip for 'Private Tester' and show
  // the two remaining options as menu items as are offered in Tasks/Help."

  // Private Tester Feedback (2026-10-21) — see openFeedbackDialog's own
  // comment below.
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const [feedbackEmail, setFeedbackEmail] = useState<string | null>(null)
  const [feedbackSubject, setFeedbackSubject] = useState('Error')
  const [feedbackBody, setFeedbackBody] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [feedbackSent, setFeedbackSent] = useState(false)
  // No tier gate here, unlike Description's own voice dictation elsewhere
  // (CreateRequestForm.tsx etc.) — this is a temporary tester-only channel,
  // not a Subscriber feature, so it's offered to anyone whose browser
  // supports it.
  const feedbackDictation = useSpeechDictation(feedbackBody, setFeedbackBody)

  const [sentFilter, setSentFilter] = useState<FilterValue>(() =>
    readStoredChip(SENT_FILTER_KEY, FILTER_VALUES, 'all')
  )
  const [receivedFilter, setReceivedFilter] = useState<FilterValue>(() =>
    readStoredChip(RECEIVED_FILTER_KEY, FILTER_VALUES, 'all')
  )
  const [todoFilter, setTodoFilter] = useState<FilterValue>(() =>
    readStoredChip(TODO_FILTER_KEY, FILTER_VALUES, 'open')
  )
  // Search round-trip persistence (2026-08-26) — see the MAIN_SEARCH_*_KEY
  // constants' own comment above for the full reasoning. Each lazy
  // initializer restores its stored value only when isMainSearchRoundTrip()
  // is true (i.e. this mount is the return leg of a Search Results row
  // click); any other mount — including a plain page reload or clicking
  // Main Screen from elsewhere — starts blank, same as before this fix.
  const [searchText, setSearchText] = useState(() =>
    isMainSearchRoundTrip() ? readStoredString(MAIN_SEARCH_TEXT_KEY) : ''
  )

  // Search Mode redesign (2026-08-19) — owner: showing search results within
  // Main Screen itself (not a separate screen) is "more logical," the Date
  // scope button (previously visual-only, see the file header comment above)
  // becomes a real "Date Range" scope with From/To fields replacing the text
  // field, Archived items are automatically included while searching (no
  // separate opt-in — "at this point... maybe an 'Advanced' search option can
  // be offered later"), and the status chips (Open/Overdue/Done) disappear in
  // favor of a plain "Search Results" notice while any search criteria is
  // active. Sent and Received deliberately stay two separate sections/lists
  // during a search, same as at rest — search was never blending them (see
  // filteredSent/filteredReceived below, each filtered independently).
  //
  // searchScope only ever holds two values today; Date Range clears
  // searchText on entry and All clears fromDate/toDate on entry, so only one
  // field-set is ever "live" at a time — no stale hidden criteria silently
  // narrowing a result set the person can no longer see.
  // 'advanced' added 2026-11-13 — see AdvancedSearchFilter's own header
  // comment above. Mutual exclusivity with All/Date Range is unchanged in
  // spirit (only one scope's fields are ever "live"), just reached through
  // its own dialog rather than instant field-clearing on the chip click —
  // Advanced only actually takes effect once Search is pressed inside it.
  const [searchScope, setSearchScope] = useState<'all' | 'daterange' | 'advanced'>(() =>
    isMainSearchRoundTrip()
      ? (readStoredString(MAIN_SEARCH_SCOPE_KEY) === 'daterange'
          ? 'daterange'
          : readStoredString(MAIN_SEARCH_SCOPE_KEY) === 'advanced'
          ? 'advanced'
          : 'all')
      : 'all'
  )
  const [fromDate, setFromDate] = useState(() =>
    isMainSearchRoundTrip() ? readStoredString(MAIN_SEARCH_FROM_KEY) : ''
  )
  const [toDate, setToDate] = useState(() =>
    isMainSearchRoundTrip() ? readStoredString(MAIN_SEARCH_TO_KEY) : ''
  )
  // The *applied* Advanced Search — null means no advanced search is active.
  // Round-trip-restored the same way as searchText/fromDate/toDate above,
  // just as one serialized JSON blob instead of several separate keys,
  // since it's a single structured value rather than a handful of scalars.
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedSearchFilter | null>(() =>
    isMainSearchRoundTrip() ? readStoredAdvancedFilter() : null
  )
  // Dialog state — a *draft* copy, edited freely while the dialog is open
  // and only committed to advancedFilter on a valid Search click; Cancel
  // discards it with no effect on whatever search (if any) was already
  // applied. advDialogText is the lazily-fetched per-id Dialog-body blob
  // (see fetchAdvancedDialogText above), rebuilt fresh each time a search
  // with Dialog-text matching actually runs.
  const [advDialogOpen, setAdvDialogOpen] = useState(false)
  const [advDraft, setAdvDraft] = useState<AdvancedSearchFilter>(ADVANCED_SEARCH_DEFAULT)
  const [advError, setAdvError] = useState<string | null>(null)
  const [advSearching, setAdvSearching] = useState(false)
  const [advDialogText, setAdvDialogText] = useState<Record<string, string>>({})
  // Category/Contact Name lookup state (2026-11-14) — null means "not yet
  // fetched," distinct from an empty list; see loadAdvLookupLists below.
  // *ResultsOpen/*Browsing mirror CreateRequestForm.tsx's own
  // showContactResults/contactBrowsing pair exactly (focus shows the full
  // list regardless of the field's current value, until the first
  // keystroke narrows it) — kept outside advDraft since they're ephemeral
  // dropdown-open UI state, never part of the committed filter.
  const [advContacts, setAdvContacts] = useState<AdvLookupContact[] | null>(null)
  const [advCategories, setAdvCategories] = useState<AdvLookupCategory[] | null>(null)
  const [advContactResultsOpen, setAdvContactResultsOpen] = useState(false)
  const [advContactBrowsing, setAdvContactBrowsing] = useState(false)
  const [advCategoryResultsOpen, setAdvCategoryResultsOpen] = useState(false)
  const [advCategoryBrowsing, setAdvCategoryBrowsing] = useState(false)
  // Snapshot of each section's own status chip, taken once right before an
  // Advanced search first overwrites them with its own Status choice —
  // Clear Search restores from this (2026-11-13, owner: the chips "need to
  // reflect the setting in the search" and "be changed to the prior
  // settings upon clearing"). A ref, not state: it's never rendered, only
  // read back by clearSearch — written once per Advanced search, not on
  // every render.
  const advPriorFiltersRef = useRef<{ sent: FilterValue; received: FilterValue; todo: FilterValue } | null>(null)

  // Persist every change so the round-trip restore above always reads the
  // latest values, not just whatever was live at the moment of navigation.
  useEffect(() => {
    window.sessionStorage.setItem(MAIN_SEARCH_TEXT_KEY, searchText)
  }, [searchText])
  useEffect(() => {
    window.sessionStorage.setItem(MAIN_SEARCH_SCOPE_KEY, searchScope)
  }, [searchScope])
  useEffect(() => {
    window.sessionStorage.setItem(MAIN_SEARCH_FROM_KEY, fromDate)
  }, [fromDate])
  useEffect(() => {
    window.sessionStorage.setItem(MAIN_SEARCH_TO_KEY, toDate)
  }, [toDate])
  useEffect(() => {
    if (advancedFilter) {
      window.sessionStorage.setItem(MAIN_SEARCH_ADVANCED_KEY, JSON.stringify(advancedFilter))
    } else {
      window.sessionStorage.removeItem(MAIN_SEARCH_ADVANCED_KEY)
    }
  }, [advancedFilter])

  // Consumed-once marker: clears on every mount so the *next* mount defaults
  // back to "fresh" (blank search) unless openDetailRow() below runs again
  // first, matching ArchiveForm.tsx's own ARCHIVE_ROUNDTRIP_KEY convention.
  // No setState involved, so this can't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    window.sessionStorage.removeItem(MAIN_SEARCH_ROUNDTRIP_KEY)
  }, [])

  // Senses platform once after mount, for the Install Housekeeping row below
  // (2026-09-03) — deferred a microtask before calling setState, same
  // pattern CreateRequestForm.tsx's own `voiceSupported` effect already
  // established, to satisfy react-hooks/set-state-in-effect since there's no
  // real async event to key off here. Already-installed (`isStandaloneDisplay`)
  // wins outright and leaves `installGuidance` at its 'none' default, so the
  // Apple-guidance row never shows alongside — or instead of — an icon
  // that's already there.
  //
  // 'desktop-chromium' fallback (2026-10-01, owner-reported) — Jim removed
  // his desktop icon, signed out and back in, and expected the Install row
  // back but saw nothing at all. Root cause: `canInstall` depends entirely
  // on Chrome firing `beforeinstallprompt`, which isn't guaranteed to fire
  // every session — Chrome's own engagement/re-prompt heuristics can
  // suppress it for a while after an uninstall, and there's no API to force
  // it. Until now, a non-Apple desktop browser with no live prompt had no
  // fallback at all (only iOS/Mac Safari did) — this covers every other
  // desktop case (Windows on any browser, Mac on a non-Safari browser) with
  // generic manual instructions, the same way the Apple branches already
  // cover their own platforms. Not narrowed to a specific Chromium-only
  // check (no reliable one exists without more UA-sniffing surface than
  // this file's other platform checks use) — worst case is slightly wrong
  // instructions for an unsupported browser (e.g. desktop Firefox), never a
  // data-access decision, same tradeoff platform.ts's own header comment
  // already accepts for every other check here.
  useEffect(() => {
    Promise.resolve().then(() => {
      setInstallLabel(isMobileDevice() ? 'Homepage' : 'Desktop')
      if (isStandaloneDisplay()) return
      if (isIOSDevice()) {
        setInstallGuidance(isSafariBrowser() ? 'ios-safari' : 'ios-other')
      } else if (isMacOSDevice() && isSafariBrowser()) {
        setInstallGuidance('mac-safari')
      } else if (!isMobileDevice()) {
        setInstallGuidance('desktop-chromium')
      }
    })
  }, [])

  // Sets the round-trip marker, then navigates to a Sent/Received/ToDo row's
  // own Detail screen — used by all three sections' row click/Enter-key
  // handlers below, so a returning Close/Cancel lands back on the same
  // Search results rather than a cleared, non-searching Main Screen.
  function openDetailRow(path: string) {
    window.sessionStorage.setItem(MAIN_SEARCH_ROUNDTRIP_KEY, '1')
    router.push(path)
  }

  function selectSearchScope(next: 'all' | 'daterange') {
    setSearchScope(next)
    setAdvancedFilter(null)
    if (next === 'daterange') {
      setSearchText('')
    } else {
      setFromDate('')
      setToDate('')
    }
  }

  // Deliberately derived, not a separate "in search mode" boolean — the
  // owner's own instruction ("the text box emptying by hand should auto-exit
  // search mode immediately") falls out for free this way: there is no mode
  // flag to separately reset, so the instant the relevant field(s) go empty,
  // every downstream isSearching read (filters, chip-row swap, Archived
  // inclusion) reverts on the very next render. Advanced's own equivalent is
  // whether a search has actually been applied (advancedFilter !== null) —
  // the dialog being open with an unsubmitted draft doesn't count.
  const isSearching =
    searchScope === 'all'
      ? searchText.trim() !== ''
      : searchScope === 'daterange'
      ? fromDate !== '' || toDate !== ''
      : advancedFilter !== null

  function clearSearch() {
    setSearchText('')
    setFromDate('')
    setToDate('')
    setAdvancedFilter(null)
    setSearchScope('all')
    // Restore each section's own status chip to whatever it held right
    // before Advanced Search first overwrote it (2026-11-13, owner) — a
    // no-op when no Advanced search was ever active (the ref stays null).
    if (advPriorFiltersRef.current) {
      setSentFilter(advPriorFiltersRef.current.sent)
      setReceivedFilter(advPriorFiltersRef.current.received)
      setTodoFilter(advPriorFiltersRef.current.todo)
      advPriorFiltersRef.current = null
    }
  }

  // Opens the Advanced Search Filters dialog — seeded from whatever's
  // already applied (so reopening it to tweak an active search starts from
  // the real current state), or the owner's own documented defaults
  // otherwise. Clicking the chip itself never applies or clears anything by
  // itself, unlike All/Date Range's selectSearchScope — only a successful
  // Search click inside the dialog does that (see handleAdvancedSearch).
  function openAdvancedSearch() {
    setAdvDraft(advancedFilter ?? ADVANCED_SEARCH_DEFAULT)
    setAdvError(null)
    setAdvDialogOpen(true)
    // Lazy-fetch Category/Contact Name's own lookup lists once, the first
    // time this dialog is actually opened — most visits never open it, so
    // this avoids an unconditional extra query on every Main Screen load.
    // Owner-RLS-scoped, same as every other contacts/categories read in the
    // app; fire-and-forget, the dropdown just shows "Loading…" until it
    // resolves.
    if (advContacts === null) {
      supabase
        .from('contacts')
        .select('id, display_name')
        .order('display_name')
        .then(({ data }) => setAdvContacts(data ?? []))
    }
    if (advCategories === null) {
      supabase
        .from('categories')
        .select('id, name')
        .order('name')
        .then(({ data }) => setAdvCategories(data ?? []))
    }
  }

  function closeAdvancedSearch() {
    setAdvDialogOpen(false)
    setAdvError(null)
  }

  // Requests checkbox cascades to Contact Type (owner, confirmed): checking
  // it checks both To and From; unchecking it unchecks both. Either can
  // still be independently toggled afterward while Requests stays checked.
  function setAdvRequests(checked: boolean) {
    setAdvDraft((d) => ({ ...d, requests: checked, contactTo: checked, contactFrom: checked }))
  }

  // Validates, then — only if Dialog-text matching is actually needed —
  // fetches the Dialog-body blob for every currently-loaded owned (Sent +
  // ToDos) and Received id before applying, so the very first render under
  // the new filter already has real data to match against rather than a
  // flash of too-broad (or empty) results. Skipped entirely when there's no
  // search text to match, or the Dialog checkbox is off — the common case
  // pays no fetch cost at all.
  async function handleAdvancedSearch() {
    const d = advDraft
    if ((d.fromDate || d.toDate) && !d.dateCreated && !d.dateDue && !d.dateDone) {
      setAdvError('Please select at least one of Created, Due, or Done to apply the date range.')
      return
    }
    if (d.contactName.trim() !== '' && !d.contactTo && !d.contactFrom) {
      setAdvError('Please select To and/or From to search by Contact Name.')
      return
    }
    if (d.searchText.trim() !== '' && !d.textDialog && !d.textDescription) {
      setAdvError('Please select Dialog and/or Description to search by that text.')
      return
    }
    if (!d.requests && !d.todos) {
      setAdvError('Please select Requests and/or ToDos.')
      return
    }
    setAdvError(null)

    if (d.searchText.trim() !== '' && d.textDialog) {
      setAdvSearching(true)
      const ownedIds = [...sent.map((r) => r.id), ...todos.map((t) => t.id)]
      const receivedIds = received.map((r) => r.id)
      const blob = await fetchAdvancedDialogText(ownedIds, receivedIds)
      setAdvDialogText(blob)
      setAdvSearching(false)
    }

    // Chips reflect the search (owner, confirmed) — each section's own
    // status chip becomes a live, further-adjustable filter seeded from
    // the dialog's own Status choice, shown in place of the "Search
    // Results" notice while this scope is active (see the per-section chip
    // ternaries and matchesStatusFilter calls below). The pre-search
    // values are snapshotted only the first time Advanced actually takes
    // effect (advancedFilter was still null) — reapplying an edit to an
    // already-active Advanced search must not clobber that original
    // snapshot, or Clear Search would restore the wrong thing.
    if (!advancedFilter) {
      advPriorFiltersRef.current = { sent: sentFilter, received: receivedFilter, todo: todoFilter }
    }
    setSentFilter(d.status)
    setReceivedFilter(d.status)
    setTodoFilter(d.status)

    setAdvancedFilter(d)
    setSearchScope('advanced')
    setSearchText('')
    setFromDate('')
    setToDate('')
    setAdvDialogOpen(false)
  }

  // Print Reports (2026-08-13) — owner: the current Print buttons print the
  // live, internally-scrolling on-screen layout as-is, which only captures
  // whatever currently fits the viewport ("only shows what can fit onto a
  // page"). Fixed with a dedicated print-only report per section instead of
  // printing the live UI at all — see the .print-report JSX/CSS below.
  // "The print should follow the chip and sort set for the section by the
  // user" (owner, confirmed) — sourced from sortedSent/sortedReceived/
  // sortedTodos below, the same already-filtered-and-sorted arrays the
  // on-screen rows themselves render from, so no separate filtering logic
  // is needed here. No own masthead/timestamp is rendered (2026-08-15,
  // dropped — see below): the browser's own print header already shows a
  // date/time and the page title, so ours was a literal duplicate,
  // "repeated... in reverse order" per the owner's own report, comparing a
  // real printout against the design.
  const [printSection, setPrintSection] = useState<'sent' | 'received' | 'todos' | null>(null)
  const [printTick, setPrintTick] = useState(0)
  // Full Dialog/Attachments content for whatever's currently being printed
  // (2026-08-15) — see loadOwnedPrintDetail/loadReceivedPrintDetail above
  // for why this is a print-time fetch rather than part of the main list
  // queries. Keyed by request id; printSection only flips (triggering the
  // print effect below) once this has actually resolved, so the report
  // never renders — and window.print() never fires — against stale/empty
  // detail.
  const [printDetail, setPrintDetail] = useState<PrintDetailMap>({})

  useEffect(() => {
    if (printTick === 0) return
    // Fires after the .print-report JSX below has actually committed to the
    // DOM (effects run post-paint), so window.print() sees the real report,
    // not a stale one-render-behind version. 'afterprint' — not a timeout —
    // is what clears printSection back to null, since the browser's print
    // dialog is modal and there's no other reliable signal it closed.
    printWithExpandedWindow()
    function handleAfterPrint() {
      setPrintSection(null)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [printTick])

  // Cross-session, per-account chip persistence (2026-08-13, migration
  // 016) — see the comment above MAIN_CHIP_PREFS' storage-key block for
  // the full reasoning. userId is filled in by the fetch effect below;
  // prefsLoaded gates the save effect so it can't fire (and overwrite a
  // real saved preference with the initial default) before the one-time
  // load has actually completed.
  const [userId, setUserId] = useState<string | null>(null)
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  // profiles.is_admin (migration 053, 2026-09-07) — gates the Housekeeping
  // Admin chip below (renamed from "Statistics" 2026-11-06, per Jim's own
  // request to fold Add Private Tester in alongside the stats screens — the
  // internal hkTab value stays 'statistics', same precedent the Help chip's
  // 'videos' value already set for a label-only rename). Read on the same
  // profiles round trip as main_chip_prefs/tier/etc. Chip visibility is UX
  // only; every admin aggregate-query RPC re-checks is_admin server-side on
  // its own (see docs/WYP_Admin_Statistics_Plan.md).
  const [isAdmin, setIsAdmin] = useState(false)

  // Private Category is now an opt-in account preference, split into
  // independent Requests(sent)/ToDos toggles (migration 073, 2026-09-30,
  // superseding the single shared private_category_enabled, migration 018)
  // — see AccountForm.tsx. Read on the same profiles round trip as
  // main_chip_prefs above, rather than a separate call. Received has never
  // shown Category on Main Screen at all (PRD §2.3), so there's nothing to
  // gate on that section.
  const [sentCategoriesEnabled, setSentCategoriesEnabled] = useState(false)
  const [todoCategoriesEnabled, setTodoCategoriesEnabled] = useState(false)

  // profiles.tier — 2026-08-25, closing a real gap the owner spotted: the
  // bottom-of-screen .adslot ("AD — 320×50 RESERVED") was rendering
  // unconditionally, for every account regardless of tier, contradicting
  // this app's own "Ad-free — removes the ad banner shown to Free accounts"
  // Subscriber Features pitch (SubscriptionPanels.tsx's BecomeSubscriberPitch,
  // shared with AccountForm.tsx and SubscriptionForm.tsx). Read on the same
  // profiles round trip as sentCategoriesEnabled/requestTimeEnabled/
  // todoDatesEnabled above, no extra query. .subbanner ("See Subscription
  // Features and Other Options") stays unconditional and, as of 2026-08-26,
  // is wired to navigate to /account/subscription (SubscriptionForm.tsx) —
  // it shows real Subscriber content for a subscriber too (Renewal Date,
  // Attachment Storage, Plan Summary), not just a Free-account pitch.
  //
  // Defaults to null, not 'free' (2026-11-10) — owner-reported: "when
  // opening the WYP app, it now flashes the ad even though the user is set
  // as a subscriber." AppFooter is rendered unconditionally on this screen
  // (no full-page loading gate the way Detail screens have), so the old
  // 'free' default was passed straight through to AppFooter for the brief
  // window before this effect resolves, flashing the ad for every account
  // regardless of real tier. null renders as "unknown" there instead (ad
  // hidden) — see AppFooter.tsx's own comment on its tier prop.
  const [tier, setTier] = useState<'free' | 'subscriber' | null>(null)

  // Due/Done Time is now an opt-in account preference too (migration 019,
  // 2026-08-13) — see AccountForm.tsx. On by default. Governs the Print
  // Sent report's Due Time sub-line, gated by the signed-in owner's own
  // setting (Sent Requests are always this account's own). Print Received
  // is gated per-row instead, by each row's own owner_request_time_enabled
  // (migration 021) — a different sender may have this on or off.
  const [requestTimeEnabled, setRequestTimeEnabled] = useState(true)

  // Show Due/Done Dates (ToDos) is also opt-in (migration 022, 2026-08-14,
  // off by default) — see AccountForm.tsx. When off, Create ToDo/ToDo
  // Detail collapse to the simple Open/Done Status chip pair and never
  // touch due_date, so a ToDo's Overdue status is meaningless in that mode
  // (owner, 2026-08-14: "the Overdue chip for ToDos should not be shown for
  // either the Main or the Archive screen" when this is off). Governs only
  // whether the Overdue chip itself renders — statusFor() below still
  // computes a real status off whatever due_date happens to already be in
  // the database (nothing is cleared by toggling this off), so a ToDo
  // switched back to All/Open/Done still sorts/filters correctly either way.
  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)

  const [sentSort, setSentSort] = useState<{ key: SentSortKey; dir: SortDir }>(() =>
    readStoredSort(SENT_SORT_KEY, ['name', 'date', 'due', 'done', 'category'] as const, SENT_SORT_LIST_DEFAULT)
  )
  const [receivedSort, setReceivedSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(RECEIVED_SORT_KEY, ['name', 'date', 'due', 'done'] as const, RECEIVED_SORT_LIST_DEFAULT)
  )
  const [todoSort, setTodoSort] = useState<{ key: TodoSortKey; dir: SortDir }>(() =>
    readStoredSort(TODO_SORT_KEY, ['priority', 'date', 'due', 'done', 'category'] as const, TODO_SORT_LIST_DEFAULT)
  )

  useEffect(() => {
    window.sessionStorage.setItem(SENT_FILTER_KEY, sentFilter)
    window.sessionStorage.setItem(RECEIVED_FILTER_KEY, receivedFilter)
    window.sessionStorage.setItem(TODO_FILTER_KEY, todoFilter)
    window.sessionStorage.setItem(HK_TAB_KEY, hkTab)
  }, [sentFilter, receivedFilter, todoFilter, hkTab])

  // One-time load, on mount: the signed-in user's own saved chip prefs
  // (profiles.main_chip_prefs, migration 016) take precedence over
  // whatever sessionStorage/hardcoded default already rendered on first
  // paint — an empty `{}` (a brand-new account, never saved before) is
  // left alone, which is exactly what makes the hardcoded defaults above
  // apply on a real first-ever visit and never again after that.
  useEffect(() => {
    let cancelled = false

    async function loadPrefs() {
      const { data: userData } = await getCurrentUser()
      const uid = userData.user?.id ?? null
      if (cancelled) return
      setUserId(uid)

      if (!uid) {
        setPrefsLoaded(true)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('main_chip_prefs, request_category_enabled, todo_category_enabled, request_time_enabled, todo_dates_enabled, tier, is_admin')
        .eq('id', uid)
        .single()
      if (cancelled) return

      setSentCategoriesEnabled(data?.request_category_enabled ?? false)
      setTodoCategoriesEnabled(data?.todo_category_enabled ?? false)
      setRequestTimeEnabled(data?.request_time_enabled ?? true)
      setTier(data?.tier === 'subscriber' ? 'subscriber' : 'free')
      setIsAdmin(data?.is_admin === true)
      const datesEnabled = data?.todo_dates_enabled ?? false
      setTodoDatesEnabled(datesEnabled)
      // A stale sessionStorage/main_chip_prefs value of 'overdue' from
      // before this was turned off would otherwise silently show an empty
      // ToDos list with no visible way back to All — fall back to All
      // rather than leave an unreachable filter selected.
      if (!datesEnabled) {
        setTodoFilter((f) => (f === 'overdue' ? 'all' : f))
      }

      const prefs = (data?.main_chip_prefs ?? {}) as MainChipPrefs
      if (prefs.sentFilter && (FILTER_VALUES as readonly string[]).includes(prefs.sentFilter)) {
        setSentFilter(prefs.sentFilter)
      }
      if (prefs.receivedFilter && (FILTER_VALUES as readonly string[]).includes(prefs.receivedFilter)) {
        setReceivedFilter(prefs.receivedFilter)
      }
      if (prefs.todoFilter && (FILTER_VALUES as readonly string[]).includes(prefs.todoFilter)) {
        setTodoFilter(prefs.todoFilter)
      }
      if (prefs.hkTab === 'tasks' || prefs.hkTab === 'videos' || prefs.hkTab === 'tester') {
        setHkTab(prefs.hkTab)
      } else if (prefs.hkTab === 'statistics' && data?.is_admin === true) {
        setHkTab(prefs.hkTab)
      }
      setPrefsLoaded(true)
    }

    loadPrefs()
    return () => {
      cancelled = true
    }
  }, [])

  // Save on every change, once the initial load above has actually
  // resolved — never before, or the hardcoded/sessionStorage defaults this
  // effect would otherwise fire with first could stomp a real saved
  // preference the fetch just hadn't returned yet.
  useEffect(() => {
    if (!prefsLoaded || !userId) return
    const prefs: MainChipPrefs = { sentFilter, receivedFilter, todoFilter, hkTab }
    supabase
      .from('profiles')
      .update({ main_chip_prefs: prefs })
      .eq('id', userId)
      .then(({ error }) => {
        if (error) console.error('Failed to save Main Screen chip preferences:', error.message)
      })
  }, [prefsLoaded, userId, sentFilter, receivedFilter, todoFilter, hkTab])

  useEffect(() => {
    writeStoredSort(SENT_SORT_KEY, sentSort)
  }, [sentSort])

  useEffect(() => {
    writeStoredSort(RECEIVED_SORT_KEY, receivedSort)
  }, [receivedSort])

  useEffect(() => {
    writeStoredSort(TODO_SORT_KEY, todoSort)
  }, [todoSort])

  // Scroll-position restore for the .scroll div — see MAIN_SCROLL_KEY's own
  // comment above for why this can't just rely on the browser. Restored
  // once loading finishes on a fresh mount (real row heights are in place by
  // then); scrollRestored guards it from re-firing on every later re-render
  // loading happens to cause (e.g. a chip change that re-triggers a fetch).
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRestored = useRef(false)

  useEffect(() => {
    if (loading || scrollRestored.current) return
    scrollRestored.current = true
    const saved = Number(window.sessionStorage.getItem(MAIN_SCROLL_KEY) ?? '0')
    if (saved > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = saved
    }
  }, [loading])


  // Retry-with-backoff (2026-08-18, owner-reported) — a bare Postgrest/
  // GoTrue error, "JWT issued at future," was showing up as the literal
  // content of all three lists, indefinitely, with no way to recover short
  // of a full reload. That specific message is a known, well-documented
  // Supabase-infra clock-skew symptom (the access token's own `iat`
  // momentarily reads as later than the node validating it — nodes across
  // Supabase's edge aren't perfectly clock-synced, and a request can land on
  // one a beat behind another) — self-correcting within a second or two on
  // a retry, not something fixable from this app's own code, and not
  // something worth telling the person about by name; they don't have a
  // JWT to check. Two retries (600ms, then 1600ms) before giving up
  // silently absorb the transient case; if every attempt still fails (a
  // real outage, not clock skew), a generic message plus a manual Try Again
  // control replaces the raw error text, which should never have been
  // user-facing regardless of what caused it.
  // Extracted out of the load effect below (2026-09-16) so the new
  // refetch-on-focus effect can issue the same three queries without
  // duplicating them. No reactive deps of its own — a plain closure over
  // the stable `supabase` import — so it doesn't need useCallback.
  async function fetchMainScreenData() {
    return Promise.all([
      supabase
        .from('requests')
        .select('id, description, due_date, due_time, done_date, created_at, contacts(display_name), dialog(count), attachments(count), categories(name), archived_at, repeat_rule, repeat_occurrence_index, repeat_series_id, receipt_confirmation_requested, receipt_confirmed_at')
        .not('contact_id', 'is', null)
        .order('due_date', { ascending: false, nullsFirst: false }),
      // get_received_requests() (migration 012, +due_time via migration 017) — a plain owner-scoped RLS
      // select can't do this: there's no column linking a requests row to
      // its recipient's own account, only to the sender's Contact record
      // for them. The function matches on that Contact's email against
      // the signed-in caller's own session email instead. Already sorted
      // server-side (due_date desc nulls last), matching Sent's own order.
      supabase.rpc('get_received_requests'),
      supabase
        .from('requests')
        .select('id, description, priority, due_date, done_date, created_at, categories(name), dialog(count), archived_at, repeat_rule, repeat_occurrence_index, repeat_series_id')
        .is('contact_id', null)
        .order('priority', { ascending: true, nullsFirst: false }),
    ])
  }

  // Last time sent/received/todos were successfully refreshed, from either
  // the load effect below or the refetch-on-focus effect — guards the
  // latter from firing again within REFRESH_MIN_INTERVAL_MS of a fetch that
  // already just happened (e.g. a 'visibilitychange' and a 'focus' event
  // both firing for the same tab switch).
  const lastLoadedAtRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const delaysMs = [0, 600, 1600]
      for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))
        if (cancelled) return

        const [sentRes, receivedRes, todoRes] = await fetchMainScreenData()
        if (cancelled) return

        const firstError = sentRes.error ?? receivedRes.error ?? todoRes.error
        if (!firstError) {
          setSent((sentRes.data as unknown as SentRow[]) ?? [])
          setReceived((receivedRes.data as unknown as ReceivedRow[]) ?? [])
          setTodos((todoRes.data as unknown as TodoRow[]) ?? [])
          setLoading(false)
          lastLoadedAtRef.current = Date.now()
          return
        }

        console.error(`Main Screen load attempt ${i + 1} failed:`, firstError.message)
        if (i === delaysMs.length - 1) {
          setLoadError('Could not load your Requests and ToDos. Check your connection and try again.')
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  // Refetch-on-focus (2026-09-16) — a test user expected a Request added on
  // his phone to show up on his already-open desktop tab without a manual
  // reload; as a web app (not native, no push), the only signal available
  // is "the person came back to this tab/window." Deliberately silent — no
  // setLoading(true), so returning to the tab doesn't flash "Loading…" over
  // rows that are probably still correct; a failed background refetch just
  // leaves whatever's already on screen in place rather than surfacing
  // loadError (same posture as AttachmentsPanel.tsx's own silent-refresh
  // precedent, 2026-08-27). Both 'visibilitychange' and 'focus' are
  // listened for — some browsers only reliably fire one or the other
  // depending on whether it's a tab switch or an alt-tab to another
  // application — with lastLoadedAtRef as a shared debounce so a tab switch
  // that fires both doesn't fetch twice.
  useEffect(() => {
    let cancelled = false

    async function silentRefresh() {
      const [sentRes, receivedRes, todoRes] = await fetchMainScreenData()
      if (cancelled) return
      if (sentRes.error || receivedRes.error || todoRes.error) return
      setSent((sentRes.data as unknown as SentRow[]) ?? [])
      setReceived((receivedRes.data as unknown as ReceivedRow[]) ?? [])
      setTodos((todoRes.data as unknown as TodoRow[]) ?? [])
      lastLoadedAtRef.current = Date.now()
    }

    function handleWake() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoadedAtRef.current < REFOCUS_REFRESH_MIN_INTERVAL_MS) return
      silentRefresh()
    }

    document.addEventListener('visibilitychange', handleWake)
    window.addEventListener('focus', handleWake)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleWake)
      window.removeEventListener('focus', handleWake)
    }
  }, [])

  async function handleLogOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // Private Tester Feedback (2026-10-21, owner's own mockup) — a
  // deliberately temporary channel for the 12-tester/14-day Android
  // closed-testing period, not a permanent feature; the dialog itself says
  // so. Sends to feedback@wouldyouplease.com (forwarded to the owner's own
  // address), Reply-To the tester's own email, via a new
  // /api/feedback/send route — same forwarded-JWT posture as every other
  // owner-session email route, never trusting the client for the sender's
  // own address.
  async function openFeedbackDialog() {
    setFeedbackDialogOpen(true)
    setFeedbackSent(false)
    setFeedbackError(null)
    if (!feedbackEmail) {
      const { data } = await getCurrentUser()
      setFeedbackEmail(data.user?.email ?? null)
    }
  }

  async function handleSendFeedback() {
    if (!feedbackBody.trim()) {
      setFeedbackError('Enter a message before sending.')
      return
    }
    setFeedbackSending(true)
    setFeedbackError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setFeedbackError('Not signed in.')
        return
      }
      const res = await fetch('/api/feedback/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ subject: feedbackSubject, body: feedbackBody }),
      })
      const json = (await res.json().catch(() => ({}))) as { sent?: boolean }
      if (json.sent) {
        setFeedbackSent(true)
        setFeedbackBody('')
      } else {
        setFeedbackError('Could not send feedback. Please try again.')
      }
    } catch {
      setFeedbackError('Could not send feedback. Please try again.')
    } finally {
      setFeedbackSending(false)
    }
  }

  const query = searchText.trim().toLowerCase()

  // Archived-but-still-searchable (2026-08-14, PRD §9.5's own drafted text:
  // an archived record is "no longer displayed" on the Main Screen "while
  // remaining available through Search"). Sent/Received/ToDos are always
  // fetched in full (migration 028 adds the archive columns to every
  // existing SELECT rather than filtering by them) — the hide-when-resting/
  // show-when-searching split happens only here, client-side.
  //
  // Search Mode redesign (2026-08-19) — while isSearching, the status chips
  // (Open/Overdue/Done) are bypassed entirely rather than still narrowing
  // results (matchesStatusFilter only runs at rest now), and matching
  // switches to either the text query or the Date Range, whichever scope is
  // active — never both, since selectSearchScope keeps the other scope's
  // fields cleared. At rest, behavior is unchanged from before this batch.
  const repeatingSentIds = useMemo(() => repeatingHeadIds(sent), [sent])
  const hasRepeatingSent = repeatingSentIds.size > 0

  const filteredSent = useMemo(() => {
    return sent.filter((r) => {
      if (!isSearching) {
        if (r.archived_at) return false
        if (sentFilter === 'repeating') return repeatingSentIds.has(r.id)
        return matchesStatusFilter(sentStatus(r), sentFilter)
      }
      if (searchScope === 'advanced' && advancedFilter) {
        const f = advancedFilter
        // Contact Type doubles as the Sent/Received scope gate (owner,
        // confirmed: "To -> Sent") — Requests has to be checked too, since
        // unchecking it already forces both To/From off (setAdvRequests).
        if (!f.requests || !f.contactTo) return false
        if (!matchesAdvancedDateRange(f, r.created_at, r.due_date, r.done_date)) return false
        // Status now reads the live sentFilter chip, not f.status directly
        // — the dialog's own Status choice only ever seeds that chip once
        // (handleAdvancedSearch); from then on the chip itself is the real,
        // further-adjustable status filter (owner, confirmed: "the section
        // chips need to reflect the setting in the search"). 'repeating' is
        // special-cased the same way the "at rest" branch above already
        // does — matchesStatusFilter alone would otherwise reject it
        // outright and hide every row with no explanation.
        if (sentFilter === 'repeating' ? !repeatingSentIds.has(r.id) : !matchesStatusFilter(sentStatus(r), sentFilter)) return false
        if (!matchesAdvancedText(f, r.description, advDialogText[r.id] ?? '')) return false
        const name = f.contactName.trim().toLowerCase()
        if (name && !(r.contacts?.display_name ?? '').toLowerCase().includes(name)) return false
        const cat = f.category.trim().toLowerCase()
        if (sentCategoriesEnabled && cat && !(r.categories?.name ?? '').toLowerCase().includes(cat)) return false
        return true
      }
      if (searchScope === 'daterange') return matchesDateRange(r.due_date, fromDate, toDate)
      return (
        r.description.toLowerCase().includes(query) ||
        (r.contacts?.display_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [sent, sentFilter, query, isSearching, searchScope, fromDate, toDate, repeatingSentIds, advancedFilter, advDialogText, sentCategoriesEnabled])

  const filteredReceived = useMemo(() => {
    return received.filter((r) => {
      if (!isSearching) {
        if (r.received_archived_at) return false
        return matchesStatusFilter(receivedStatus(r), receivedFilter)
      }
      if (searchScope === 'advanced' && advancedFilter) {
        const f = advancedFilter
        // "From -> Received" (owner, confirmed) — same gate as Sent above,
        // mirrored onto the From side of Contact Type instead of To.
        if (!f.requests || !f.contactFrom) return false
        if (!matchesAdvancedDateRange(f, r.created_at, r.due_date, r.done_date)) return false
        // Live receivedFilter chip, not f.status — see Sent's identical
        // comment above.
        if (!matchesStatusFilter(receivedStatus(r), receivedFilter)) return false
        if (!matchesAdvancedText(f, r.description, advDialogText[r.id] ?? '')) return false
        const name = f.contactName.trim().toLowerCase()
        if (name && !(r.owner_name ?? '').toLowerCase().includes(name)) return false
        // No Category check here — Received never has one (PRD §2.3).
        return true
      }
      if (searchScope === 'daterange') return matchesDateRange(r.due_date, fromDate, toDate)
      return (
        r.description.toLowerCase().includes(query) ||
        (r.owner_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [received, receivedFilter, query, isSearching, searchScope, fromDate, toDate, advancedFilter, advDialogText])

  // Hidden fields excluded from search (2026-08-22, owner) — a ToDo's
  // due_date/category_id can still hold a value from before the owner
  // turned Show Due/Done Dates (ToDos) or Private Category off (CLAUDE.md's
  // own documented convention: the underlying data stays put, only the UI
  // stops showing/editing it). Matching against a field the account can't
  // currently see would surface a ToDo the searcher has no way to make
  // sense of. Sent/Received never matched Category at all (neither screen
  // shows it, matching PRD §2.3's own recipient-visibility rule), so no
  // change needed there.
  const repeatingTodoIds = useMemo(() => repeatingHeadIds(todos), [todos])
  const hasRepeatingTodos = repeatingTodoIds.size > 0

  const filteredTodos = useMemo(() => {
    return todos.filter((t) => {
      if (!isSearching) {
        if (t.archived_at) return false
        if (todoFilter === 'repeating') return repeatingTodoIds.has(t.id)
        return matchesStatusFilter(todoStatus(t), todoFilter)
      }
      if (searchScope === 'advanced' && advancedFilter) {
        const f = advancedFilter
        if (!f.todos) return false
        // Due Date only participates when the account's own Show Due/Done
        // Dates (ToDos) toggle is on — same "hidden field, excluded from
        // search" rule the existing Date Range scope already enforces below
        // — but Created/Done are always shown regardless of that toggle
        // (TodoRow's own comment), so only Due is conditioned here rather
        // than excluding the whole ToDo the way the simple Date Range scope
        // does.
        if (!matchesAdvancedDateRange(f, t.created_at, todoDatesEnabled ? t.due_date : null, t.done_date)) return false
        // Live todoFilter chip, not f.status — see Sent's identical
        // comment above, 'repeating' special-case included.
        if (todoFilter === 'repeating' ? !repeatingTodoIds.has(t.id) : !matchesStatusFilter(todoStatus(t), todoFilter)) return false
        if (!matchesAdvancedText(f, t.description, advDialogText[t.id] ?? '')) return false
        const cat = f.category.trim().toLowerCase()
        if (todoCategoriesEnabled && cat && !(t.categories?.name ?? '').toLowerCase().includes(cat)) return false
        return true
      }
      if (searchScope === 'daterange') return todoDatesEnabled && matchesDateRange(t.due_date, fromDate, toDate)
      return (
        t.description.toLowerCase().includes(query) ||
        (todoCategoriesEnabled && (t.categories?.name ?? '').toLowerCase().includes(query))
      )
    })
  }, [
    todos,
    todoFilter,
    query,
    isSearching,
    searchScope,
    fromDate,
    toDate,
    todoDatesEnabled,
    todoCategoriesEnabled,
    repeatingTodoIds,
    advancedFilter,
    advDialogText,
  ])

  // Sorted on top of the already-filtered rows — filtering and sorting are
  // independent concerns (which rows show vs. what order they show in), so
  // this stays a second pass rather than folding sort comparisons into the
  // filter predicates above.
  const sortedSent = useMemo(() => {
    const list = [...filteredSent]
    list.sort((a, b) => {
      switch (sentSort.key) {
        // Both branches below tie-break on descending Due Date — see
        // compareDueDesc's own comment above.
        case 'name': {
          const primary = compareNullable(a.contacts?.display_name ?? null, b.contacts?.display_name ?? null, sentSort.dir, compareStrings)
          return primary !== 0 ? primary : compareDueDesc(a.due_date, b.due_date)
        }
        case 'date':
          return compareNullable(a.created_at, b.created_at, sentSort.dir, compareStrings)
        case 'due':
          return compareNullable(a.due_date, b.due_date, sentSort.dir, compareStrings)
        case 'done':
          return compareNullable(a.done_date, b.done_date, sentSort.dir, compareStrings)
        // Reinstated 2026-08-24 — see SentSortKey's own comment above.
        case 'category': {
          const primary = compareNullable(a.categories?.name ?? null, b.categories?.name ?? null, sentSort.dir, compareStrings)
          return primary !== 0 ? primary : compareDueDesc(a.due_date, b.due_date)
        }
      }
    })
    return list
  }, [filteredSent, sentSort])

  const sortedReceived = useMemo(() => {
    const list = [...filteredReceived]
    list.sort((a, b) => {
      switch (receivedSort.key) {
        // Tie-break on descending Due Date — see compareDueDesc's own
        // comment above (2026-08-24).
        case 'name': {
          const primary = compareNullable(a.owner_name, b.owner_name, receivedSort.dir, compareStrings)
          return primary !== 0 ? primary : compareDueDesc(a.due_date, b.due_date)
        }
        case 'date':
          return compareNullable(a.created_at, b.created_at, receivedSort.dir, compareStrings)
        case 'due':
          return compareNullable(a.due_date, b.due_date, receivedSort.dir, compareStrings)
        case 'done':
          return compareNullable(a.done_date, b.done_date, receivedSort.dir, compareStrings)
      }
    })
    return list
  }, [filteredReceived, receivedSort])

  const sortedTodos = useMemo(() => {
    const list = [...filteredTodos]
    list.sort((a, b) => {
      switch (todoSort.key) {
        case 'priority':
          return compareNullable(a.priority, b.priority, todoSort.dir, compareNumbers)
        case 'date':
          return compareNullable(a.created_at, b.created_at, todoSort.dir, compareStrings)
        case 'due':
          return compareNullable(a.due_date, b.due_date, todoSort.dir, compareStrings)
        case 'done':
          return compareNullable(a.done_date, b.done_date, todoSort.dir, compareStrings)
        // Reinstated 2026-08-24 — see TodoSortKey's own comment above.
        // Tie-break: descending Due Date when Due Dates are shown, else
        // descending Date (created) — owner's own carve-out for ToDos,
        // since a ToDo's due_date is meaningless UI-wise while
        // todoDatesEnabled is off (same reasoning the Overdue chip already
        // uses elsewhere in this file).
        case 'category': {
          const primary = compareNullable(a.categories?.name ?? null, b.categories?.name ?? null, todoSort.dir, compareStrings)
          if (primary !== 0) return primary
          return todoDatesEnabled ? compareDueDesc(a.due_date, b.due_date) : compareDueDesc(a.created_at, b.created_at)
        }
      }
    })
    return list
  }, [filteredTodos, todoSort, todoDatesEnabled])

  // Placed after sortedSent/sortedReceived/sortedTodos above (not beside
  // printSection/printDetail's own state, further up) — the React Compiler
  // couldn't preserve those three useMemo's memoization when this closure
  // referencing them was defined earlier in the component body.
  async function startPrint(section: 'sent' | 'received' | 'todos') {
    const ids =
      section === 'sent' ? sortedSent.map((r) => r.id) :
      section === 'received' ? sortedReceived.map((r) => r.id) :
      sortedTodos.map((t) => t.id)
    const detail = section === 'received' ? await loadReceivedPrintDetail(ids) : await loadOwnedPrintDetail(ids)
    setPrintDetail(detail)
    setPrintSection(section)
    // Owner-reported 2026-08-15: clicking the same Print icon twice in a
    // row (e.g. Print Sent, then Print Sent again) did nothing the second
    // time, but worked again after printing a different section first. Root
    // cause: the effect above keyed on printSection alone — 'sent' -> 'sent'
    // is not a value change, so React never re-runs it, and 'afterprint'
    // doesn't reliably fire in every browser/print-flow to reset printSection
    // back to null in between. printTick strictly increases on every click,
    // guaranteeing the effect always re-fires regardless of section repeats
    // or afterprint reliability. Same fix as ArchiveForm.tsx/
    // RequestDetailForm.tsx/TodoDetailForm.tsx's identical prints.
    setPrintTick((t) => t + 1)
  }

  function sortSent(key: SentSortKey) {
    setSentSort((s) => toggleSort(s, key, SENT_SORT_DEFAULT_DIR))
  }

  function sortReceived(key: ReqSortKey) {
    setReceivedSort((s) => toggleSort(s, key, REQ_SORT_DEFAULT_DIR))
  }

  function sortTodos(key: TodoSortKey) {
    setTodoSort((s) => toggleSort(s, key, TODO_SORT_DEFAULT_DIR))
  }

  // Filter-chip selection also clears a stranded "done" sort (2026-11-08,
  // owner-reported): "if All or Done chip is selected and the sort
  // selection is by done date and then the open chip is selected, no sort
  // selection is shown." Done's own ColSort column is disabled (greyed,
  // no active pill) for any chip other than All/Done, and nothing else
  // becomes active just because Done did — the list stayed sorted by Done
  // with no column anywhere showing as the active one. Reverting to the
  // list's own default sort whenever the newly-selected chip would disable
  // Done keeps a visible active column at all times.
  function selectSentFilter(value: FilterValue) {
    setSentFilter(value)
    if (value !== 'all' && value !== 'done') {
      setSentSort((s) => (s.key === 'done' ? SENT_SORT_LIST_DEFAULT : s))
    }
  }

  function selectReceivedFilter(value: FilterValue) {
    setReceivedFilter(value)
    if (value !== 'all' && value !== 'done') {
      setReceivedSort((s) => (s.key === 'done' ? RECEIVED_SORT_LIST_DEFAULT : s))
    }
  }

  function selectTodoFilter(value: FilterValue) {
    setTodoFilter(value)
    if (value !== 'all' && value !== 'done') {
      setTodoSort((s) => (s.key === 'done' ? TODO_SORT_LIST_DEFAULT : s))
    }
  }

  // Advanced Search's own Category/Contact Name lookup dropdowns
  // (2026-11-14) — same filtering shape as CreateRequestForm.tsx's own
  // filteredContacts/filteredCategories: focus (advContactBrowsing/
  // advCategoryBrowsing) shows the whole list regardless of what's typed;
  // otherwise an empty field shows the whole list only if it's short
  // enough to browse, and a non-empty field narrows by substring. The
  // *committed* match (matchesAdvancedText's callers) stays a plain
  // substring against advDraft.contactName/category either way — picking a
  // row here is a UI convenience, not a switch to exact-id matching.
  const advContactQueryEmpty = advDraft.contactName.trim() === ''
  const advContactsBrowsable = (advContacts?.length ?? 0) < ADV_LOOKUP_BROWSE_THRESHOLD
  const filteredAdvContacts = advContactBrowsing
    ? advContacts ?? []
    : advContactQueryEmpty
      ? advContactsBrowsable
        ? advContacts ?? []
        : []
      : (advContacts ?? []).filter((c) =>
          c.display_name.toLowerCase().includes(advDraft.contactName.trim().toLowerCase())
        )
  const showAdvContactDropdown = !advContactQueryEmpty || advContactsBrowsable

  const advCategoryQueryEmpty = advDraft.category.trim() === ''
  const advCategoriesBrowsable = (advCategories?.length ?? 0) < ADV_LOOKUP_BROWSE_THRESHOLD
  const filteredAdvCategories = advCategoryBrowsing
    ? advCategories ?? []
    : advCategoryQueryEmpty
      ? advCategoriesBrowsable
        ? advCategories ?? []
        : []
      : (advCategories ?? []).filter((c) =>
          c.name.toLowerCase().includes(advDraft.category.trim().toLowerCase())
        )
  const showAdvCategoryDropdown = !advCategoryQueryEmpty || advCategoriesBrowsable

  function selectAdvContact(name: string) {
    setAdvDraft((d) => ({ ...d, contactName: name }))
    setAdvContactResultsOpen(false)
  }

  function selectAdvCategory(name: string) {
    setAdvDraft((d) => ({ ...d, category: name }))
    setAdvCategoryResultsOpen(false)
  }

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader />

        <div
          className="scroll"
          ref={scrollRef}
          onScroll={(e) => window.sessionStorage.setItem(MAIN_SCROLL_KEY, String(e.currentTarget.scrollTop))}
        >
          {/* ---------------------------------------------------------- Requests */}
          <div className="band">
            <span className="glabel">Requests</span>
            <Link className="btn" href="/requests/new">Create&nbsp;Request</Link>
          </div>

          {/* Sent — live */}
          <div className="subcard">
            <div className="subhead">
              <div className="subhead-top">
                <span className="subname">Sent</span>
                <span className="subicons">
                  <button className="iconbtn" type="button" aria-label="Print Sent" onClick={() => startPrint('sent')}><PrintIcon /></button>
                  <button className="iconbtn" type="button" aria-label="Calendar View: Sent" onClick={() => router.push(`/calendar?section=sent&status=${sentFilter}`)}><CalendarIcon /></button>
                </span>
              </div>
              {isSearching && searchScope !== 'advanced' ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${sentFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => selectSentFilter('all')}>All</button>
                  <button className={`chip${sentFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => selectSentFilter('open')}>Open</button>
                  <button className={`chip over${sentFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => selectSentFilter('overdue')}>Overdue</button>
                  <button className={`chip done${sentFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => selectSentFilter('done')}>Done</button>
                  <button
                    className={`chip${sentFilter === 'repeating' ? ' sel' : ''}`}
                    type="button"
                    disabled={!hasRepeatingSent}
                    onClick={() => selectSentFilter('repeating')}
                  >
                    Repeating
                  </button>
                </div>
              )}
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <span className="namecell">
                  <ColSort className="c-nm" label="To" active={sentSort.key === 'name'} dir={sentSort.dir} onClick={() => sortSent('name')} />
                  {/* Description -> Category, sortable, when Private Category
                      is on; removed entirely (no heading at all) when off —
                      2026-08-24, owner. Mirrors the ToDos colbar below, and
                      is new for Sent: unlike ToDos, Sent has never had a
                      Category column heading before. */}
                  {sentCategoriesEnabled && (
                    <ColSort className="c-cat" label="Category" active={sentSort.key === 'category'} dir={sentSort.dir} onClick={() => sortSent('category')} />
                  )}
                </span>
                <ColSort className="c-dt" label="Created" active={sentSort.key === 'date'} dir={sentSort.dir} onClick={() => sortSent('date')} />
                <ColSort className="c-due" label="Due" active={sentSort.key === 'due'} dir={sentSort.dir} onClick={() => sortSent('due')} />
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={sentSort.key === 'done'}
                  dir={sentSort.dir}
                  onClick={() => sortSent('done')}
                  disabled={
                    searchScope === 'advanced'
                      ? sentFilter !== 'all' && sentFilter !== 'done'
                      : !isSearching && sentFilter !== 'all' && sentFilter !== 'done'
                  }
                />
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && (
                  <div className="subempty">
                    {loadError}
                    <br />
                    <button className="btn-secondary" type="button" onClick={() => setReloadTick((t) => t + 1)} style={{ marginTop: 8 }}>
                      Try Again
                    </button>
                  </div>
                )}
                {!loading && !loadError && sent.length === 0 && (
                  <div className="subempty">
                    No Sent Requests yet.
                    <br />
                    <button className="btn" type="button" onClick={() => router.push('/requests/new')} style={{ marginTop: 8 }}>
                      Create your first Request
                    </button>
                  </div>
                )}
                {!loading && !loadError && sent.length > 0 && filteredSent.length === 0 && (
                  <div className="subempty">No Sent Requests match this filter.</div>
                )}
                {!loading && !loadError && sortedSent.map((r) => {
                  const status = sentStatus(r)
                  const late = status === 'done' && !!r.due_date && !!r.done_date && r.done_date > r.due_date
                  return (
                    <div
                      key={r.id}
                      className={`row${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetailRow(`/requests/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openDetailRow(`/requests/${r.id}`) }}
                    >
                      <div className="r1">
                        <span className="nm">{r.contacts?.display_name ?? '—'}</span>
                        <span className="dt">{formatMDYFromTimestamp(r.created_at)}</span>
                        <span className="due">{formatMDY(r.due_date)}</span>
                        <span className={`dn${late ? ' late' : ''}`}>{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="r2">
                        {r.archived_at && <span className="archtag">Archived</span>}
                        {r.receipt_confirmation_requested && (
                          <span className="ii">
                            {r.receipt_confirmed_at ? <ReceiptConfirmedIcon /> : <ReceiptAwaitingIcon />}
                          </span>
                        )}
                        {dialogCount(r.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        {attachmentCount(r.attachments) > 0 && (
                          <span className="ii"><AttachmentIcon /></span>
                        )}
                        <span className="desc">
                          {/* Category, on screen, for Sent — new 2026-08-24
                              (owner: "the only place the Category is
                              currently displayed on a detail item in a list
                              is on the main screen for ToDos, it should also
                              be displayed on the main screen Requests Sent").
                              Identical .cat + em-dash treatment as the ToDos
                              row below. */}
                          {sentCategoriesEnabled && (
                            <>
                              <span className="cat">{r.categories?.name ?? '—'}</span>
                              {' — '}
                            </>
                          )}
                          {r.description}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Received — live (migration 012, 2026-08-11). Matched on the
              signed-in user's own session email against the sending Contact's
              email, server-side, inside get_received_requests() — there's no
              column linking a requests row to its recipient's own account,
              only to the sender's Contact record for them, so this can't be
              a plain owner-scoped RLS select the way Sent/ToDos are. */}
          <div className="subcard">
            <div className="subhead">
              <div className="subhead-top">
                <span className="subname">Received</span>
                <span className="subicons">
                  <button className="iconbtn" type="button" aria-label="Print Received" onClick={() => startPrint('received')}><PrintIcon /></button>
                  <button className="iconbtn" type="button" aria-label="Calendar View: Received" onClick={() => router.push(`/calendar?section=received&status=${receivedFilter}`)}><CalendarIcon /></button>
                </span>
              </div>
              {isSearching && searchScope !== 'advanced' ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${receivedFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => selectReceivedFilter('all')}>All</button>
                  <button className={`chip${receivedFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => selectReceivedFilter('open')}>Open</button>
                  <button className={`chip over${receivedFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => selectReceivedFilter('overdue')}>Overdue</button>
                  <button className={`chip done${receivedFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => selectReceivedFilter('done')}>Done</button>
                </div>
              )}
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <span className="namecell">
                  <ColSort className="c-nm" label="From" active={receivedSort.key === 'name'} dir={receivedSort.dir} onClick={() => sortReceived('name')} />
                  {/* Description heading removed entirely, 2026-08-24 —
                      owner: "for consistency" with Sent/ToDos, where it now
                      either becomes Category or disappears. Received never
                      shows Category (PRD §2.3), so there is nothing left for
                      this heading to become — it's just dropped. */}
                </span>
                <ColSort className="c-dt" label="Created" active={receivedSort.key === 'date'} dir={receivedSort.dir} onClick={() => sortReceived('date')} />
                <ColSort className="c-due" label="Due" active={receivedSort.key === 'due'} dir={receivedSort.dir} onClick={() => sortReceived('due')} />
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={receivedSort.key === 'done'}
                  dir={receivedSort.dir}
                  onClick={() => sortReceived('done')}
                  disabled={
                    searchScope === 'advanced'
                      ? receivedFilter !== 'all' && receivedFilter !== 'done'
                      : !isSearching && receivedFilter !== 'all' && receivedFilter !== 'done'
                  }
                />
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && (
                  <div className="subempty">
                    {loadError}
                    <br />
                    <button className="btn-secondary" type="button" onClick={() => setReloadTick((t) => t + 1)} style={{ marginTop: 8 }}>
                      Try Again
                    </button>
                  </div>
                )}
                {!loading && !loadError && received.length === 0 && (
                  <div className="subempty">
                    No Received Requests yet. Requests others send you will appear here.
                    <br />
                    <button className="btn-secondary" type="button" onClick={() => router.push('/help/getting-started')} style={{ marginTop: 8 }}>
                      See Getting Started
                    </button>
                  </div>
                )}
                {!loading && !loadError && received.length > 0 && filteredReceived.length === 0 && (
                  <div className="subempty">No Received Requests match this filter.</div>
                )}
                {!loading && !loadError && sortedReceived.map((r) => {
                  const status = receivedStatus(r)
                  const late = status === 'done' && !!r.due_date && !!r.done_date && r.done_date > r.due_date
                  return (
                    <div
                      key={r.id}
                      className={`row${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetailRow(`/requests/${r.id}/respond`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openDetailRow(`/requests/${r.id}/respond`) }}
                    >
                      <div className="r1">
                        <span className="nm">{r.owner_name ?? '—'}</span>
                        <span className="dt">{formatMDYFromTimestamp(r.created_at)}</span>
                        <span className="due">{formatMDY(r.due_date)}</span>
                        <span className={`dn${late ? ' late' : ''}`}>{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="r2">
                        {r.received_archived_at && <span className="archtag">Archived</span>}
                        {r.receipt_confirmation_requested && (
                          <span className="ii">
                            {r.receipt_confirmed_at ? <ReceiptConfirmedIcon /> : <ReceiptAwaitingIcon />}
                          </span>
                        )}
                        {r.dialog_count > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        {r.attachment_count > 0 && (
                          <span className="ii"><AttachmentIcon /></span>
                        )}
                        <span className="desc">{r.description}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- ToDos */}
          <div className="band">
            <span className="glabel">ToDos</span>
            <Link className="btn" href="/todos/new">Create&nbsp;ToDo</Link>
          </div>

          <div className="subcard">
            <div className="subhead todos-head">
              {isSearching && searchScope !== 'advanced' ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${todoFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => selectTodoFilter('all')}>All</button>
                  <button className={`chip${todoFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => selectTodoFilter('open')}>Open</button>
                  {todoDatesEnabled && (
                    <button className={`chip over${todoFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => selectTodoFilter('overdue')}>Overdue</button>
                  )}
                  <button className={`chip done${todoFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => selectTodoFilter('done')}>Done</button>
                  {todoDatesEnabled && (
                    <button
                      className={`chip${todoFilter === 'repeating' ? ' sel' : ''}`}
                      type="button"
                      disabled={!hasRepeatingTodos}
                      onClick={() => selectTodoFilter('repeating')}
                    >
                      Repeating
                    </button>
                  )}
                </div>
              )}
              <span className="subicons">
                <button className="iconbtn" type="button" aria-label="Print ToDos" onClick={() => startPrint('todos')}><PrintIcon /></button>
                <button className="iconbtn" type="button" aria-label="Calendar View: ToDos" onClick={() => router.push(`/calendar?section=todo&status=${todoFilter}`)}><CalendarIcon /></button>
              </span>
            </div>
            <div className="subbody">
              <div className={`colbar dcols${todoDatesEnabled ? ' wide' : ''}${todoCategoriesEnabled ? ' catcol' : ''}`}>
                <span className="namecell">
                  <ColSort className="c-pri" label="Priority" active={todoSort.key === 'priority'} dir={todoSort.dir} onClick={() => sortTodos('priority')} />
                  {/* Description -> Category, sortable, when Private
                      Category is on; removed entirely when off — 2026-08-24,
                      owner. Category was a plain static colbar heading here
                      through 2026-08-17's redesign; this reinstates it as a
                      live sort column (retired 2026-08-17, see TodoSortKey's
                      own comment above). */}
                  {todoCategoriesEnabled && (
                    <ColSort className="c-cat" label="Category" active={todoSort.key === 'category'} dir={todoSort.dir} onClick={() => sortTodos('category')} />
                  )}
                </span>
                <ColSort className="c-dt" label="Created" active={todoSort.key === 'date'} dir={todoSort.dir} onClick={() => sortTodos('date')} />
                {todoDatesEnabled && (
                  <ColSort className="c-due" label="Due" active={todoSort.key === 'due'} dir={todoSort.dir} onClick={() => sortTodos('due')} />
                )}
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={todoSort.key === 'done'}
                  dir={todoSort.dir}
                  onClick={() => sortTodos('done')}
                  disabled={
                    searchScope === 'advanced'
                      ? todoFilter !== 'all' && todoFilter !== 'done'
                      : !isSearching && todoFilter !== 'all' && todoFilter !== 'done'
                  }
                />
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && (
                  <div className="subempty">
                    {loadError}
                    <br />
                    <button className="btn-secondary" type="button" onClick={() => setReloadTick((t) => t + 1)} style={{ marginTop: 8 }}>
                      Try Again
                    </button>
                  </div>
                )}
                {!loading && !loadError && todos.length === 0 && (
                  <div className="subempty">
                    No ToDos yet.
                    <br />
                    <button className="btn" type="button" onClick={() => router.push('/todos/new')} style={{ marginTop: 8 }}>
                      Create your first ToDo
                    </button>
                  </div>
                )}
                {!loading && !loadError && todos.length > 0 && filteredTodos.length === 0 && (
                  <div className="subempty">No ToDos match this filter.</div>
                )}
                {!loading && !loadError && sortedTodos.map((t) => {
                  const status = todoStatus(t)
                  return (
                    <div
                      key={t.id}
                      className={`row td${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetailRow(`/todos/${t.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openDetailRow(`/todos/${t.id}`) }}
                    >
                      <div className={`trd${todoDatesEnabled ? ' wide' : ''}`}>
                        <span className="pri">{t.priority ? PRIORITY_LABEL[t.priority] : ''}</span>
                        <span className="dt">{formatMDYFromTimestamp(t.created_at)}</span>
                        {todoDatesEnabled && <span className="due">{formatMDY(t.due_date)}</span>}
                        <span className="dn">{formatMDY(t.done_date)}</span>
                      </div>
                      <div className="r2">
                        {t.archived_at && <span className="archtag">Archived</span>}
                        {dialogCount(t.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        <span className="desc">
                          {todoCategoriesEnabled && (
                            <>
                              <span className="cat">{t.categories?.name ?? '—'}</span>
                              {' — '}
                            </>
                          )}
                          {t.description}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- Housekeeping
              Hidden while isSearching (2026-08-19, owner: "I don't think we
              need to show the Housekeeping section" while search results are
              showing) — the Search band itself, just below, stays visible
              regardless, since the field needs to stay reachable to change
              or clear what's been typed. */}
          {!isSearching && (
            <>
          {/* Owner-reported, 2026-10-21: "Housekeeping" + both buttons
              crammed onto one row overflowed a phone's width, pushing Log
              Out off-screen with no way to scroll to it — fixed at the time
              by giving the standalone "Private Tester" button its own
              second row. That button is gone now (2026-11-11, moved onto
              its own chip below, next to Tasks/Help/Admin — Jim: "the
              current button location does not look good"), so this band is
              back to one row; the hk-band/hk-band-row classes stay in case
              a future addition needs the same stacking idea again. */}
          <div className="band hk-band">
            <div className="hk-band-row">
              <span className="glabel">Housekeeping</span>
              <button className="btn-quiet" type="button" onClick={handleLogOut} disabled={signingOut}>
                {signingOut ? 'Logging out…' : 'Log Out'}
              </button>
            </div>
          </div>

          <div className="subcard">
            <div className="subhead hk-head">
              <div className="subhead-top">
                <div className="chips" role="tablist" aria-label="Housekeeping section">
                  <button
                    className={`chip${hkTab === 'tasks' ? ' sel' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={hkTab === 'tasks'}
                    onClick={() => setHkTab('tasks')}
                  >
                    Tasks
                  </button>
                  <button
                    className={`chip${hkTab === 'videos' ? ' sel' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={hkTab === 'videos'}
                    onClick={() => setHkTab('videos')}
                  >
                    {/* Label only, 2026-09-01 — Jim: "Replace 'How-to
                        Videos' chip with 'Help'." The internal `hkTab`
                        value stays 'videos' (sessionStorage + the
                        server-side main_chip_prefs jsonb column, migration
                        016, already persist that literal string) — renaming
                        it would need a backward-compat read for anyone with
                        an already-stored 'videos' preference, for no
                        visible benefit, since only the label was asked to
                        change. */}
                    Help
                  </button>
                  {isAdmin && (
                    <button
                      className={`chip${hkTab === 'statistics' ? ' sel' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={hkTab === 'statistics'}
                      onClick={() => setHkTab('statistics')}
                    >
                      Admin
                    </button>
                  )}
                  {/* Private Tester chip (2026-11-11) — replaces the
                      standalone blue "Private Tester" button; unconditional,
                      matching that button's own availability (every signed-in
                      account during this testing period, not isAdmin-gated
                      like Admin above). Jim: "I wanted to be sure Private
                      Testers realize these options are not part of the
                      normal application - but the title does that and the
                      current button location does not look good." */}
                  <button
                    className={`chip${hkTab === 'tester' ? ' sel' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={hkTab === 'tester'}
                    onClick={() => setHkTab('tester')}
                  >
                    Private Tester
                  </button>
                </div>
              </div>
            </div>
            {hkTab === 'tasks' ? (
              <div className="subbody">
                <div className="hkrows">
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/about')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/about') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">About</span>
                      <span className="hknote"> — Would You Please application information</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/account')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/account') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Account Options</span>
                      <span className="hknote"> — personalize Would You Please</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/archive')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/archive') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Archive</span>
                      <span className="hknote"> — view, edit, or delete archived items</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/contacts')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/contacts') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Contacts</span>
                      <span className="hknote"> — add, view, edit, or delete</span>
                    </span>
                  </div>
                  {/* Private Categories (2026-09-28) — closes a real gap:
                      Add Category (Create Request/Create ToDo) could only
                      ever add one, never rename or remove it. Gated on
                      either Category toggle being on (migration 073 split
                      the old single private_category_enabled into
                      request_category_enabled/todo_category_enabled) since
                      the underlying list is shared by both — a category can
                      only be created while at least one is on, so hiding
                      this management screen while both are off is
                      consistent, not a loss. */}
                  {(sentCategoriesEnabled || todoCategoriesEnabled) && (
                    <div
                      className="hkrow"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push('/categories')}
                      onKeyDown={(e) => { if (e.key === 'Enter') router.push('/categories') }}
                    >
                      <span className="hktext">
                        <span className="hktitle">Private Categories</span>
                        <span className="hknote"> — add, rename, or delete</span>
                      </span>
                    </div>
                  )}
                  {/* Storage Management (2026-09-03) — converts
                      design/screens/WYP_storage_maintenance_palette1.html to
                      live. Also reachable from Account Options' own
                      Subscriber section ("Manage Storage" button); this row
                      is the same shortcut precedent Archive/Install already
                      set for a screen that's also reachable another way. */}
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/account/storage')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/account/storage') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Storage Management</span>
                      <span className="hknote"> — view, download, or remove attachments</span>
                    </span>
                  </div>
                  {/* Owner-reported, 2026-08-18: accepted the browser's own
                      one-shot install offer during a magic-link sign-in and
                      couldn't find the resulting icon afterward — see
                      PWAProvider.tsx's own header comment for the full
                      diagnosis (Android's "Install" adds to the app drawer,
                      not directly to the home screen, and the browser's own
                      prompt only ever appears once, opportunistically).
                      This row is the deliberate, findable, repeatable
                      alternative — only rendered when canInstall is true, so
                      it's never a dead control on a browser that doesn't
                      support installation or a device that already has it
                      installed. Title reads "Add to Home Screen" or "Add to
                      Desktop" (installLabel, sensed via isMobileDevice() —
                      "Homepage" on a phone/tablet, "Desktop" on a laptop/
                      desktop) — Jim's own 2026-09-03 follow-up correction:
                      his first-round suggestion ("Homepage/Desktop Icon
                      Installation") wasn't the platform-standard phrasing;
                      the "icon" detail now lives in the .hknote text
                      instead. Applies to this Chromium row and the
                      Apple-guidance row just below it alike. */}
                  {canInstall && (
                    <div
                      className="hkrow"
                      role="button"
                      tabIndex={0}
                      onClick={() => { promptInstall() }}
                      onKeyDown={(e) => { if (e.key === 'Enter') promptInstall() }}
                    >
                      <span className="hktext">
                        <span className="hktitle">
                          {installLabel === 'Homepage' ? 'Add to Home Screen' : 'Add to Desktop'}
                        </span>
                        <span className="hknote">
                          {' '}— add a Would You Please icon to your{' '}
                          {installLabel === 'Homepage' ? 'home screen' : 'desktop'}
                        </span>
                      </span>
                    </div>
                  )}
                  {/* Apple/Safari (iOS, iPadOS, macOS) never fires
                      `beforeinstallprompt` at all, so `canInstall` above is
                      always false there — this is the fallback, per Jim's
                      2026-09-03 request ("extend that process to incorporate
                      an explanation for Apple/Safari users when appropriate,
                      can you sense for platform type?"). `installGuidance`
                      is computed once after mount (see the effect above) and
                      stays 'none' — hiding this row entirely — on any
                      platform that has real `beforeinstallprompt` support
                      instead, and on any platform (including these) where
                      `isStandaloneDisplay()` shows the app is already
                      installed, so a returning visitor is never offered a
                      second icon. */}
                  {!canInstall && installGuidance !== 'none' && (
                    <div
                      className="hkrow"
                      role="button"
                      tabIndex={0}
                      onClick={() => { setInstallHelpOpen(true) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') setInstallHelpOpen(true) }}
                    >
                      <span className="hktext">
                        <span className="hktitle">
                          {installLabel === 'Homepage' ? 'Add to Home Screen' : 'Add to Desktop'}
                        </span>
                        <span className="hknote">
                          {' '}— add a Would You Please icon to your{' '}
                          {installLabel === 'Homepage' ? 'home screen' : 'desktop'}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : hkTab === 'videos' ? (
              <div className="subbody">
                <div className="hkrows">
                  {/* Help topics (2026-09-03) — replaces the three inert
                      placeholder rows with real navigation to
                      app/help/*, plus a new fourth "ToDo Features" row
                      (Jim: "The three topics work, and add a ToDo
                      features item."). Same onClick/onKeyDown pattern
                      the Tasks tab's own rows already use. */}
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/help/getting-started')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/help/getting-started') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Getting Started</span>
                      <span className="hknote"> — a quick tour and efficiency tips</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/help/creating-a-request')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/help/creating-a-request') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Creating a Request</span>
                      <span className="hknote"> — Reminders, Repeat, and Attachments</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/help/responding-to-a-request')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/help/responding-to-a-request') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Responding to a Request</span>
                      <span className="hknote"> — quick Done, Dialog, no account needed</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/help/todo-features')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/help/todo-features') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">ToDo Features</span>
                      <span className="hknote"> — Status, Reminders, Repeat, and Attachments</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : hkTab === 'tester' ? (
              // Private Tester tab (2026-11-11) — replaces the old
              // testerMenuOpen modal with two plain rows, same shape as
              // Tasks/Help's own rows. Test Stripe Payments is gone
              // outright (not moved here) — the Account Status merge made
              // that screen unnecessary, see SubscriptionPanels.tsx's own
              // header comment.
              <div className="subbody">
                <div className="hkrows">
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => openFeedbackDialog()}
                    onKeyDown={(e) => { if (e.key === 'Enter') openFeedbackDialog() }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Feedback</span>
                      <span className="hknote"> — send comments or report an issue by email</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/testers/checklist')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/testers/checklist') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Checklist</span>
                      <span className="hknote"> — track your own testing progress</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              // Admin tab (2026-09-07, relabeled from "Statistics" and
              // gained Add Private Tester 2026-11-06) — admin-only
              // utilization screens plus the new tester-provisioning
              // screen. Chip visibility above is already gated on isAdmin;
              // this body only ever renders once that chip has been
              // clicked, so no separate isAdmin check is needed here. See
              // docs/WYP_Admin_Statistics_Plan.md for the five stats
              // screens.
              <div className="subbody">
                <div className="hkrows">
                  {/* Add Private Tester (2026-11-06) — replaces running
                      docs/add-tester.mjs from a terminal. Jim: "The entry of
                      the time zone is really awkward, the Grant Subscriber
                      access is not required... Perhaps we could add this to
                      the Statistics tab, rename the tab Admin and add an
                      'Add Private Tester' choice." */}
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/testers/new')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/testers/new') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Add Private Tester</span>
                      <span className="hknote"> — allow someone new to sign in and test</span>
                    </span>
                  </div>
                  {/* Stripe Audit (2026-11-12, migration 093) — Jim: "create
                      an audit of purchase/cancel/reduction transactions...
                      expose it as a view under the Admin chip as
                      'Account/Stripe Audit'." */}
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stripe-audit')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stripe-audit') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Stripe Audit</span>
                      <span className="hknote"> — purchase, cancel, and capacity-change transactions</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stats/accounts')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stats/accounts') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Accounts</span>
                      <span className="hknote"> — new free and subscribed accounts by period</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stats/contacts')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stats/contacts') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Contacts</span>
                      <span className="hknote"> — added, deleted, and current totals</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stats/requests')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stats/requests') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Requests</span>
                      <span className="hknote"> — created, changed, done, archived, deleted</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stats/todos')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stats/todos') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">ToDos</span>
                      <span className="hknote"> — created, changed, done, archived, deleted</span>
                    </span>
                  </div>
                  <div
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push('/admin/stats/summary')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/admin/stats/summary') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Sum and Averages</span>
                      <span className="hknote"> — grand totals and per-account roster</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
            </>
          )}

          {/* ---------------------------------------------------------- Search
              Relocated 2026-08-19 (owner: search is infrequently used, and a
              fixed footer costs permanent scroll space on every visit; "I
              prefer placing the Search as scrollable under the Housekeeping
              section"). Was a fixed-footer sibling of .scroll (outside it,
              alongside .subbanner/.adslot, which stay pinned there — owner's
              explicit call: "subscription banner and ad stays pinned and
              only Search itself relocates"); now its own band inside .scroll,
              right after Housekeeping, so it only costs space once someone
              has actually scrolled down to it. Unlike Housekeeping just
              above, this band is NOT hidden while isSearching — the field
              itself has to stay reachable to change or clear what's typed.
              The scope button is a real All/Date Range picker — Date Range
              swaps the text field for paired From/To date fields, either
              side alone a valid search. A Clear Search control appears next
              to the field(s) whenever isSearching (a second one also lives
              in each section's own "Search Results" notice above, on the
              owner's own request — "having Clear Search in both places is
              useful"); the text field also gets its own inline × once it
              holds text. Clearing the text field to empty by hand
              (backspace) exits automatically, with no separate step —
              isSearching is derived, not a stored mode flag, so there is
              nothing left to reset once the field itself is empty. The
              voice-search icon is gone (2026-08-19, see VoiceSearchIcon's
              own removal comment above) — was always decorative, and
              dropping it also gives the scope select and field(s) more of
              the line's width now that this band isn't squeezed into a
              fixed-height footer strip either. */}
          <div className="band">
            <span className="glabel">Search</span>
            <span className="bandcluster">
              <div className="scopechips" role="group" aria-label="Search scope">
                <button
                  className={`chip${searchScope === 'all' ? ' sel' : ''}`}
                  type="button"
                  onClick={() => selectSearchScope('all')}
                >
                  All
                </button>
                <button
                  className={`chip${searchScope === 'daterange' ? ' sel' : ''}`}
                  type="button"
                  onClick={() => selectSearchScope('daterange')}
                >
                  Dates
                </button>
                {/* Advanced Search Filters (2026-11-13, owner's own mockup) —
                    a third scope, reached through its own dialog rather than
                    an inline field set: clicking the chip opens it (seeded
                    from whatever's already applied), it never itself applies
                    or clears a search the way the two chips above do. */}
                <button
                  className={`chip${searchScope === 'advanced' ? ' sel' : ''}`}
                  type="button"
                  onClick={openAdvancedSearch}
                >
                  Advanced
                </button>
              </div>
            </span>
          </div>

          <div className="searchbar sb">
            {searchScope === 'advanced' ? (
              <div className="fieldwrap">
                <button className="btn-secondary" type="button" onClick={openAdvancedSearch}>
                  Edit Advanced Filters
                </button>
              </div>
            ) : searchScope === 'all' ? (
              <div className="fieldwrap">
                <input
                  className="field"
                  type="text"
                  placeholder="Search Would You Please"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                {searchText !== '' && (
                  <button
                    className="fclear"
                    type="button"
                    aria-label="Clear search text"
                    onClick={() => setSearchText('')}
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <div className="daterange-fields">
                <label className="drfield">
                  <span className="drlabel">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7" y="10" width="34" height="32" rx="4" fill="none" stroke="#5A6675" strokeWidth="3.5" />
                        <line x1="7" y1="19" x2="41" y2="19" stroke="#5A6675" strokeWidth="3.5" />
                        <line x1="16" y1="5" x2="16" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                        <line x1="32" y1="5" x2="32" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                        <circle cx="16" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="24" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="32" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="16" cy="35" r="2.2" fill="#5A6675" />
                        <circle cx="24" cy="35" r="2.2" fill="#5A6675" />
                      </svg>
                    </span>
                    From
                  </span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    aria-label="Search Due Date from"
                  />
                </label>
                <label className="drfield">
                  <span className="drlabel">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7" y="10" width="34" height="32" rx="4" fill="none" stroke="#5A6675" strokeWidth="3.5" />
                        <line x1="7" y1="19" x2="41" y2="19" stroke="#5A6675" strokeWidth="3.5" />
                        <line x1="16" y1="5" x2="16" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                        <line x1="32" y1="5" x2="32" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                        <circle cx="16" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="24" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="32" cy="27" r="2.2" fill="#5A6675" />
                        <circle cx="16" cy="35" r="2.2" fill="#5A6675" />
                        <circle cx="24" cy="35" r="2.2" fill="#5A6675" />
                      </svg>
                    </span>
                    To
                  </span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label="Search Due Date to"
                  />
                </label>
              </div>
            )}

            {/* Clear Search + the magnifying glass wrapped together as one
                flex item (2026-11-15, owner-reported on a Dates search,
                phone screenshot): previously two separate .searchbar
                children, so a wrap could split them — Clear Search staying
                on the FROM/TO line while only the icon dropped to its own
                line below, squeezing the date fields (one showed "11/"
                truncated) in the process. Grouped, the pair can only wrap
                as a unit — when there isn't room for both beside the date
                fields, they move down together, leaving .daterange-fields
                the full line (and its own flex-grow:1) to itself, same fix
                for the All/Advanced scopes' field+button pairing too. */}
            <span className="searchbar-actions">
              {isSearching && (
                <button className="clearsearch" type="button" onClick={clearSearch}>
                  Clear&nbsp;Search&nbsp;×
                </button>
              )}
              <span className="iconbtn" role="button" tabIndex={0} aria-label="Search"><SearchIcon /></span>
            </span>
          </div>

          <div className="scroll-pad" />
        </div>

        <AppFooter tier={tier} />
      </div>

      {/* Print Reports (2026-08-13) — a dedicated, print-only layout per
          section, built from the owner's own xlsx mockup rather than a
          styled copy of the live on-screen rows: the two differ in real
          ways (ToDos shows Description/Due/Done here, not the on-screen
          Priority/Category; descriptions are never 2-line-truncated here).
          Only ever rendered for the brief window between a Print click and
          the browser's print dialog closing (see printSection/startPrint
          above) — .no-print above and @media print in globals.css hide the
          two from each other so exactly one is ever visible at a time,
          on screen or on paper. Sourced from sortedSent/sortedReceived/
          sortedTodos — the same chip-filtered, sort-applied arrays the live
          rows render from — per the owner's own confirmation: "The print
          should follow the chip and sort set for the section by the user."
          Dialog icon reused from the live rows (DialogIcon); Attachments
          has no data model yet (CLAUDE.md, deferred) so there is no icon
          slot to reserve here beyond the Dialog one already present. */}
      {printSection && (
        <div className="print-report">
          {printSection === 'sent' && (
            <>
              <div className="ptitle">Requests Sent — {CHIP_LABEL[sentFilter]}</div>
              <div className="pcolbar psr">
                <span className="namecell">
                  <span className="c-nm">To</span>
                  {/* Same rule as the on-screen colbar above: Category when
                      shown, nothing at all when not — 2026-08-24. */}
                  {sentCategoriesEnabled && (
                    <span className="c-desc">Category{sentSort.key === 'category' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  )}
                </span>
                <span className="c-dt">Created{sentSort.key === 'date' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                <span className="c-due">Due{sentSort.key === 'due' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                <span className="c-dn">Done{sentSort.key === 'done' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              </div>
              <div className="prows">
                {sortedSent.length === 0 && <div className="pempty">No Sent Requests match this report.</div>}
                {sortedSent.map((r) => {
                  const status = sentStatus(r)
                  const detail = printDetail[r.id]
                  return (
                    <div key={r.id} className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                      <div className="pr1">
                        <span className="pnm">{r.contacts?.display_name ?? '—'}</span>
                        <span className="pdt">{formatMDYFromTimestamp(r.created_at)}</span>
                        <span className="pdue">
                          {formatMDYSlash(r.due_date)}
                          {/* Due Time, inline on the same line as the date
                              (2026-08-15, was a stacked sub-line) — gated by
                              the signed-in owner's own request_time_enabled
                              (migration 019), since every Sent row is this
                              account's own. */}
                          {requestTimeEnabled && r.due_time && (
                            <span className="ptime">{'  '}{formatTime12h(r.due_time)}</span>
                          )}
                        </span>
                        <span className="pdn">{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="pr2">
                        <span className="pdesc">
                          {sentCategoriesEnabled && categoryPrefix(r.categories?.name)}
                          {r.description}
                        </span>
                      </div>
                      <PrintRepeatLine rule={r.repeat_rule} dueDate={r.due_date} />
                      <PrintReceiptConfirmationLine
                        requested={r.receipt_confirmation_requested}
                        confirmedAt={r.receipt_confirmed_at}
                      />
                      {detail && <PrintDialogList entries={detail.dialog} />}
                      {detail && <PrintAttachmentList entries={detail.attachments} heading="Attachments" />}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {printSection === 'received' && (
            <>
              <div className="ptitle">Requests Received — {CHIP_LABEL[receivedFilter]}</div>
              <div className="pcolbar psr">
                <span className="namecell">
                  <span className="c-nm">From</span>
                  {/* Description heading removed, 2026-08-24 — same
                      consistency rule as the on-screen colbar above.
                      Received never shows Category (PRD §2.3, see the
                      pr2/pdesc comment below). */}
                </span>
                <span className="c-dt">Created{receivedSort.key === 'date' ? (receivedSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                <span className="c-due">Due{receivedSort.key === 'due' ? (receivedSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                <span className="c-dn">Done{receivedSort.key === 'done' ? (receivedSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              </div>
              <div className="prows">
                {sortedReceived.length === 0 && <div className="pempty">No Received Requests match this report.</div>}
                {sortedReceived.map((r) => {
                  const status = receivedStatus(r)
                  const detail = printDetail[r.id]
                  return (
                    <div key={r.id} className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                      <div className="pr1">
                        <span className="pnm">{r.owner_name ?? '—'}</span>
                        <span className="pdt">{formatMDYFromTimestamp(r.created_at)}</span>
                        <span className="pdue">
                          {formatMDYSlash(r.due_date)}
                          {/* Inline, same line as the date (2026-08-15) —
                              gated per-row by that row's own sender's setting
                              (migration 021) — Received rows can come from
                              different accounts, each with its own
                              request_time_enabled. */}
                          {r.owner_request_time_enabled && r.due_time && (
                            <span className="ptime">{'  '}{formatTime12h(r.due_time)}</span>
                          )}
                        </span>
                        <span className="pdn">{formatMDY(r.done_date)}</span>
                      </div>
                      {/* No Category prefix here — PRD §2.3 withholds Category
                          from the recipient entirely; see categoryPrefix's own
                          comment above. */}
                      <div className="pr2">
                        <span className="pdesc">{r.description}</span>
                      </div>
                      <PrintRepeatLine rule={r.repeat_rule} dueDate={r.due_date} />
                      <PrintReceiptConfirmationLine
                        requested={r.receipt_confirmation_requested}
                        confirmedAt={r.receipt_confirmed_at}
                      />
                      {detail && <PrintDialogList entries={detail.dialog} />}
                      {detail && <PrintAttachmentList entries={detail.attachments} heading="Attachments" />}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {printSection === 'todos' && (
            <>
              <div className="ptitle">ToDos — {CHIP_LABEL[todoFilter]}</div>
              {/* Redesigned 2026-08-17 — owner-reported: the old report was
                  "missing the Priority value for each item" and asked for
                  "the Priority value and the appropriate dates on a first
                  line... to match the on-screen view" (.trd's own Priority/
                  Date/[Due]/Done row). .pcolbar.pdcols/.pr1.pdcols mirror
                  that grid, with .namecell/.c-desc reused verbatim for the
                  same muted "Description" heading the screen now shows.
                  Superseded the old .pcolbar.ptdc/.ptdc-nodates single-
                  column-plus-Due/Done shape, which never had a Priority
                  column at all — TodoDetailForm.tsx's own single-item print
                  still uses that older shape unchanged, see CLAUDE.md. */}
              <div className={`pcolbar pdcols${todoDatesEnabled ? ' wide' : ''}`}>
                <span className="namecell">
                  <span>Priority{todoSort.key === 'priority' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  {/* Same rule as Sent's print colbar above — Category when
                      shown, nothing at all when not — 2026-08-24. */}
                  {todoCategoriesEnabled && (
                    <span className="c-desc">Category{todoSort.key === 'category' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  )}
                </span>
                <span className="c-dt">Created{todoSort.key === 'date' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                {todoDatesEnabled && (
                  <span className="c-due">Due{todoSort.key === 'due' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                )}
                <span className="c-dn">Done{todoSort.key === 'done' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              </div>
              <div className="prows">
                {sortedTodos.length === 0 && <div className="pempty">No ToDos match this report.</div>}
                {sortedTodos.map((t) => {
                  const status = todoDatesEnabled ? todoStatus(t) : 'open'
                  const detail = printDetail[t.id]
                  return (
                    <div key={t.id} className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                      <div className={`pr1 pdcols${todoDatesEnabled ? ' wide' : ''}`}>
                        <span className="ppri">{t.priority ? PRIORITY_LABEL[t.priority] : ''}</span>
                        <span className="pdt">{formatMDYFromTimestamp(t.created_at)}</span>
                        {todoDatesEnabled && <span className="pdue">{formatMDY(t.due_date)}</span>}
                        <span className="pdn">{formatMDY(t.done_date)}</span>
                      </div>
                      <div className="pr2">
                        <span className="pdesc">
                          {todoCategoriesEnabled && categoryPrefix(t.categories?.name)}
                          {t.description}
                        </span>
                      </div>
                      <PrintRepeatLine rule={t.repeat_rule} dueDate={t.due_date} />
                      {detail && <PrintDialogList entries={detail.dialog} />}
                      {detail && <PrintAttachmentList entries={detail.attachments} heading="Locations" />}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Advanced Search Filters (2026-11-13, owner's own mockup, §6.4x
          PROPOSED) — reuses .scrim/.modal (§6.12) verbatim, with its own
          .advsearch-modal modifier for the extra height/scroll this dialog
          needs over every other modal in the app (Repeat's Add/Edit modal,
          the closest existing precedent for this many fields, has never
          needed one — but it's noticeably shorter than this). A draft, not
          the live applied search: Cancel discards every change here with no
          effect on whatever search (if any) is already showing; only Search
          commits advDraft to advancedFilter, after validation.

          Redesigned 2026-11-14 (owner's own "Suggested" mockup, comparing a
          real Windows/Android screenshot against it) — see the comment
          above the AdvancedSearchFilter type for the full reasoning behind
          .advlabelrow/.advrow-label and the Category/Contact Name lookup
          fields. */}
      {advDialogOpen && (
        <>
          <div className="scrim" onClick={closeAdvancedSearch} />
          <div className="modal advsearch-modal" role="dialog" aria-modal="true" aria-labelledby="advsearch-title">
            <p className="modal-title" id="advsearch-title">
              Advanced Search Filters
            </p>

            <div className="fgroup">
              <div className="advlabelrow">
                <span className="advrow-label">Date Type</span>
                <div className="advcheckrow">
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      checked={advDraft.dateCreated}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, dateCreated: e.target.checked }))}
                    />
                    Created
                  </label>
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      checked={advDraft.dateDue}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, dateDue: e.target.checked }))}
                    />
                    Due
                  </label>
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      checked={advDraft.dateDone}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, dateDone: e.target.checked }))}
                    />
                    Done
                  </label>
                </div>
              </div>
              <div className="daterange-fields" style={{ marginTop: 6 }}>
                <label className="drfield">
                  <span className="drlabel">From</span>
                  <input
                    type="date"
                    value={advDraft.fromDate}
                    onChange={(e) => setAdvDraft((d) => ({ ...d, fromDate: e.target.value }))}
                    aria-label="Advanced search date from"
                  />
                </label>
                <label className="drfield">
                  <span className="drlabel">To</span>
                  <input
                    type="date"
                    value={advDraft.toDate}
                    onChange={(e) => setAdvDraft((d) => ({ ...d, toDate: e.target.value }))}
                    aria-label="Advanced search date to"
                  />
                </label>
              </div>
            </div>

            {/* Category (2026-11-14, owner: "I forgot to add Category," then
                "the Contact Name and Category should interact as is done on
                the Create Request and Create Todo - with a pull-down and/or
                lookup") — shown only if the account actually uses Private
                Category for at least one of Requests/ToDos. The dropdown is
                purely a picking convenience (LookupGlyph, .ffloat/.flabel/
                .lookup-results — the same components Create Request/Create
                ToDo already use for their own Category field); the actual
                match stays a plain substring against advDraft.category, so
                free-typed partial text still works with no exact match
                required. Never shown for Received regardless — that section
                never has a Category at all (PRD §2.3), so it's narrowed
                against Sent/ToDos only. */}
            {(sentCategoriesEnabled || todoCategoriesEnabled) && (
              <div className="fgroup">
                <div className="frow" style={{ position: 'relative' }}>
                  <span className="ffloat">
                    <input
                      className={`finput${advDraft.category.trim() === '' ? ' opt' : ''}`}
                      id="adv-category"
                      type="text"
                      autoComplete="off"
                      placeholder=" "
                      value={advDraft.category}
                      onChange={(e) => {
                        setAdvDraft((d) => ({ ...d, category: e.target.value }))
                        setAdvCategoryBrowsing(false)
                        setAdvCategoryResultsOpen(true)
                      }}
                      onFocus={(e) => {
                        e.target.select()
                        setAdvCategoryBrowsing(true)
                        setAdvCategoryResultsOpen(true)
                      }}
                      onBlur={() => setTimeout(() => setAdvCategoryResultsOpen(false), 120)}
                      aria-label="Advanced search category"
                    />
                    <label className="flabel" htmlFor="adv-category">
                      <LookupGlyph />
                      Private Category
                    </label>
                  </span>

                  {advCategoryResultsOpen && showAdvCategoryDropdown && (
                    <div className="lookup-results" role="listbox">
                      {advCategories === null ? (
                        <div className="lookup-empty">Loading…</div>
                      ) : filteredAdvCategories.length === 0 ? (
                        <div className="lookup-empty">No matching category.</div>
                      ) : (
                        filteredAdvCategories.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`lookup-item${c.name.toLowerCase() === advDraft.category.trim().toLowerCase() ? ' selected' : ''}`}
                            role="option"
                            aria-selected={c.name.toLowerCase() === advDraft.category.trim().toLowerCase()}
                            onMouseDown={() => selectAdvCategory(c.name)}
                          >
                            {c.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="fgroup stopgroup advstatus-inline">
              <span className="advrow-label">Status</span>
              {(['all', 'open', 'overdue', 'done'] as AdvancedStatusValue[]).map((s) => (
                <label className="stoprow" key={s}>
                  <input
                    type="radio"
                    name="advsearch-status"
                    checked={advDraft.status === s}
                    onChange={() => setAdvDraft((d) => ({ ...d, status: s }))}
                  />
                  <span>{s === 'all' ? 'All' : s === 'open' ? 'Open' : s === 'overdue' ? 'Overdue' : 'Done'}</span>
                </label>
              ))}
            </div>

            <div className="fgroup">
              <div className="advlabelrow">
                <span className="advrow-label">Text Type</span>
                <div className="advcheckrow">
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      checked={advDraft.textDialog}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, textDialog: e.target.checked }))}
                    />
                    Dialog
                  </label>
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      checked={advDraft.textDescription}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, textDescription: e.target.checked }))}
                    />
                    Description
                  </label>
                </div>
              </div>
              <input
                className="finput"
                type="text"
                style={{ marginTop: 6 }}
                placeholder="Search text"
                value={advDraft.searchText}
                onChange={(e) => setAdvDraft((d) => ({ ...d, searchText: e.target.value }))}
                aria-label="Advanced search text"
              />
            </div>

            <label className="checkrow" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={advDraft.requests} onChange={(e) => setAdvRequests(e.target.checked)} />
              <span className="checktext">Requests</span>
            </label>
            <div className={`fgroup adv-contacttype${advDraft.requests ? '' : ' is-disabled'}`}>
              <div className="advlabelrow">
                <span className="advrow-label">Contact Type</span>
                <div className="advcheckrow">
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      disabled={!advDraft.requests}
                      checked={advDraft.contactTo}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, contactTo: e.target.checked }))}
                    />
                    To
                  </label>
                  <label className="advcheck">
                    <input
                      type="checkbox"
                      disabled={!advDraft.requests}
                      checked={advDraft.contactFrom}
                      onChange={(e) => setAdvDraft((d) => ({ ...d, contactFrom: e.target.checked }))}
                    />
                    From
                  </label>
                </div>
              </div>
              <div className="frow" style={{ position: 'relative', marginTop: 6 }}>
                <span className="ffloat">
                  <input
                    className={`finput${advDraft.contactName.trim() === '' ? ' opt' : ''}`}
                    id="adv-contactname"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    disabled={!advDraft.requests}
                    value={advDraft.contactName}
                    onChange={(e) => {
                      setAdvDraft((d) => ({ ...d, contactName: e.target.value }))
                      setAdvContactBrowsing(false)
                      setAdvContactResultsOpen(true)
                    }}
                    onFocus={(e) => {
                      e.target.select()
                      setAdvContactBrowsing(true)
                      setAdvContactResultsOpen(true)
                    }}
                    onBlur={() => setTimeout(() => setAdvContactResultsOpen(false), 120)}
                    aria-label="Advanced search contact name"
                  />
                  <label className="flabel" htmlFor="adv-contactname">
                    <LookupGlyph />
                    Contact Name
                  </label>
                </span>

                {advDraft.requests && advContactResultsOpen && showAdvContactDropdown && (
                  <div className="lookup-results" role="listbox">
                    {advContacts === null ? (
                      <div className="lookup-empty">Loading…</div>
                    ) : filteredAdvContacts.length === 0 ? (
                      <div className="lookup-empty">No matching contact.</div>
                    ) : (
                      filteredAdvContacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`lookup-item${c.display_name.toLowerCase() === advDraft.contactName.trim().toLowerCase() ? ' selected' : ''}`}
                          role="option"
                          aria-selected={c.display_name.toLowerCase() === advDraft.contactName.trim().toLowerCase()}
                          onMouseDown={() => selectAdvContact(c.display_name)}
                        >
                          {c.display_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <label className="checkrow" style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={advDraft.todos}
                onChange={(e) => setAdvDraft((d) => ({ ...d, todos: e.target.checked }))}
              />
              <span className="checktext">ToDos</span>
            </label>

            {advError && <p className="ferror">{advError}</p>}

            <div className="modalacts" style={{ marginTop: 12 }}>
              <button className="btn-secondary" type="button" onClick={closeAdvancedSearch}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={advSearching} onClick={handleAdvancedSearch}>
                {advSearching ? 'Searching…' : 'Search'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Apple/Safari install-instructions modal (2026-09-03) — Jim's own
          request: Chromium's `beforeinstallprompt` (canInstall/promptInstall,
          PWAProvider.tsx) has no equivalent API on iOS/iPadOS/macOS Safari,
          so there's nothing to auto-trigger there; this walks the visitor
          through the platform's own real manual step instead. Numbered
          steps are plain bold-prefixed <p> tags rather than <ol>/<li> — this
          app has no confirmed-rendering precedent for list markers under its
          Tailwind v4 preflight (only .promo-features does, and it explicitly
          resets list-style itself), so plain paragraphs avoid depending on
          an unverified default. Reuses the app's own .scrim/.modal (§6.12)
          pattern verbatim, same as ContactDetailForm.tsx's Delete Contact
          dialog. */}
      {installHelpOpen && (
        <>
          <div className="scrim" onClick={() => setInstallHelpOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
            <div className="modalhead">
              <p className="modal-title" id="install-help-title">
                {installLabel === 'Homepage' ? 'Add to Home Screen' : 'Add to Desktop'}
              </p>
            </div>

            {installGuidance === 'ios-safari' && (
              <>
                <p className="subnote" style={{ marginTop: 10 }}>
                  <b>1.</b> Tap the Share icon in Safari&rsquo;s toolbar (a
                  square with an arrow pointing up).
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>2.</b> Scroll down and tap &ldquo;Add to Home Screen.&rdquo;
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>3.</b> Tap &ldquo;Add&rdquo; in the top-right corner.
                </p>
              </>
            )}

            {installGuidance === 'ios-other' && (
              <p className="subnote" style={{ marginTop: 10 }}>
                On an iPhone or iPad, only Safari can add a Home Screen icon
                — this browser doesn&rsquo;t support it. Open{' '}
                <b>wouldyouplease.com</b> in Safari, then use its Share icon
                and choose &ldquo;Add to Home Screen.&rdquo;
              </p>
            )}

            {installGuidance === 'mac-safari' && (
              <>
                <p className="subnote" style={{ marginTop: 10 }}>
                  <b>1.</b> In Safari&rsquo;s menu bar, open the{' '}
                  <b>File</b> menu.
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>2.</b> Choose &ldquo;Add to Dock&hellip;&rdquo;
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>3.</b> Click &ldquo;Add.&rdquo;
                </p>
              </>
            )}

            {installGuidance === 'desktop-chromium' && (
              <>
                <p className="subnote" style={{ marginTop: 10 }}>
                  Look for an install icon in the address bar (a small
                  monitor with a down arrow) and click it, or open your
                  browser&rsquo;s menu.
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>1.</b> Click the <b>⋮</b> (or <b>&middot;&middot;&middot;</b>)
                  menu in the top-right corner.
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>2.</b> Choose &ldquo;Install Would You Please&hellip;&rdquo;
                  (sometimes under &ldquo;Apps&rdquo; or &ldquo;Save and
                  share&rdquo;).
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>3.</b> Click &ldquo;Install.&rdquo;
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  If you don&rsquo;t see either option, your browser may not
                  support installing apps from the web.
                </p>
                <p className="subnote" style={{ marginTop: 8 }}>
                  <b>Only see &ldquo;Uninstall&rdquo;, not
                  &ldquo;Install&rdquo;?</b> Would You Please is already
                  installed in your browser, even if the icon is missing —
                  deleting a desktop icon doesn&rsquo;t remove the install
                  itself. Open <b>chrome://apps</b> in a browser tab,
                  right-click the Would You Please icon, and choose
                  &ldquo;Create shortcuts&hellip;&rdquo; to add a new
                  desktop icon without reinstalling. Or, if you&rsquo;d
                  rather start fresh, choose &ldquo;Uninstall&rdquo; first,
                  then revisit this site in a normal browser tab.
                </p>
              </>
            )}

            <div className="modalacts" style={{ marginTop: 12 }}>
              <button
                className="btn"
                type="button"
                onClick={() => setInstallHelpOpen(false)}
              >
                Got It
              </button>
            </div>
          </div>
        </>
      )}


      {/* Private Tester Feedback (2026-10-21, owner's own mockup) — see
          openFeedbackDialog's own comment above. Same .scrim/.modal
          pattern as the Install dialog just above. */}
      {feedbackDialogOpen && (
        <>
          <div className="scrim" onClick={() => setFeedbackDialogOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title">
            <div className="modalhead">
              <p className="modal-title" id="feedback-dialog-title">
                Private Tester Feedback
              </p>
            </div>
            <p className="subnote" style={{ marginTop: 10 }}>
              This is a temporary feedback channel for the private testing period only — it won&rsquo;t be part of
              the finished app.
            </p>
            <div className="metarow" style={{ marginTop: 10 }}>
              <b>From:</b>
              <span>{feedbackEmail ?? 'Loading…'}</span>
            </div>
            <div className="fgroup" style={{ marginTop: 10 }}>
              <label
                htmlFor="fb-subject"
                style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 4, color: 'var(--ink)' }}
              >
                Subject
              </label>
              <select
                id="fb-subject"
                className="finput"
                value={feedbackSubject}
                onChange={(e) => setFeedbackSubject(e.target.value)}
              >
                <option value="Error">Error</option>
                <option value="Something Awkward">Something Awkward</option>
                <option value="Something Missing">Something Missing</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="fgroup" style={{ marginTop: 10 }}>
              <div className="descwrap">
                <textarea
                  className="ftextarea ftextarea-plain"
                  placeholder="What happened? What did you expect instead?"
                  aria-label="Feedback message"
                  style={{ minHeight: 168 }}
                  value={feedbackBody}
                  onChange={(e) => setFeedbackBody(e.target.value)}
                />
                {feedbackDictation.supported && (
                  <button
                    type="button"
                    className={`micbtn${feedbackDictation.dictating ? ' listening' : ''}`}
                    aria-label={feedbackDictation.dictating ? 'Stop voice dictation' : 'Start voice dictation'}
                    onClick={feedbackDictation.toggle}
                  >
                    <MicIcon />
                  </button>
                )}
                {feedbackDictation.dictationNote && (
                  <span className="micnote">{feedbackDictation.dictationNote}</span>
                )}
              </div>
            </div>
            {feedbackError && (
              <p className="ferror" role="alert">
                {feedbackError}
              </p>
            )}
            {feedbackSent && <p className="noticeband">Thanks — your feedback was sent.</p>}
            <div className="modalacts" style={{ marginTop: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setFeedbackDialogOpen(false)}>
                {feedbackSent ? 'Close' : 'Cancel'}
              </button>
              {!feedbackSent && (
                <button type="button" className="btn" onClick={handleSendFeedback} disabled={feedbackSending}>
                  {feedbackSending ? 'Sending…' : 'Send'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
