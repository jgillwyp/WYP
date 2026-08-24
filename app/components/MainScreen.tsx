'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { usePWAInstall } from './PWAProvider'
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
 *   scope button is now a real two-item picker (a plain `<select>`, styled
 *   to match): "All" (the text search above) or "Date Range," which swaps
 *   the text field for paired From/To Due Date fields — either side alone is
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
  // feature below — Requests have always had a category_id (same as ToDos,
  // gated by the same categoriesEnabled toggle), but Main Screen's own Sent
  // row has never surfaced it on screen, unlike ToDos' .cat column. Fetched
  // here only because Print now needs it; the on-screen Sent row is
  // unchanged and still shows no Category.
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
function matchesStatusFilter(
  status: 'open' | 'overdue' | 'done',
  filter: 'all' | 'open' | 'overdue' | 'done'
): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return status === 'open' || status === 'overdue'
  return status === filter
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

type FilterValue = 'all' | 'open' | 'overdue' | 'done'
const FILTER_VALUES = ['all', 'open', 'overdue', 'done'] as const

type MainChipPrefs = {
  sentFilter?: FilterValue
  receivedFilter?: FilterValue
  todoFilter?: FilterValue
  hkTab?: 'tasks' | 'videos'
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="2.5" />
      <line x1="30" y1="30" x2="44" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// VoiceSearchIcon removed 2026-08-19 — owner: drop the mic icon from Search
// now, both to reclaim horizontal space and because it was never wired to
// anything (always decorative); voice input on Description fields, where it
// would actually matter, is its own separate, not-yet-scoped idea.

export default function MainScreen() {
  const router = useRouter()
  const { canInstall, promptInstall } = usePWAInstall()

  const [sent, setSent] = useState<SentRow[]>([])
  const [received, setReceived] = useState<ReceivedRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped by the loadError block's own "Try Again" button (2026-08-18) —
  // see the main load() effect's own header comment for why a manual retry
  // needed to exist at all.
  const [reloadTick, setReloadTick] = useState(0)
  const [hkTab, setHkTab] = useState<'tasks' | 'videos'>(() =>
    readStoredChip(HK_TAB_KEY, ['tasks', 'videos'] as const, 'tasks')
  )
  const [signingOut, setSigningOut] = useState(false)

  const [sentFilter, setSentFilter] = useState<FilterValue>(() =>
    readStoredChip(SENT_FILTER_KEY, FILTER_VALUES, 'all')
  )
  const [receivedFilter, setReceivedFilter] = useState<FilterValue>(() =>
    readStoredChip(RECEIVED_FILTER_KEY, FILTER_VALUES, 'all')
  )
  const [todoFilter, setTodoFilter] = useState<FilterValue>(() =>
    readStoredChip(TODO_FILTER_KEY, FILTER_VALUES, 'open')
  )
  const [searchText, setSearchText] = useState('')

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
  const [searchScope, setSearchScope] = useState<'all' | 'daterange'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  function selectSearchScope(next: 'all' | 'daterange') {
    setSearchScope(next)
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
  // inclusion) reverts on the very next render.
  const isSearching = searchScope === 'all' ? searchText.trim() !== '' : fromDate !== '' || toDate !== ''

  function clearSearch() {
    setSearchText('')
    setFromDate('')
    setToDate('')
    setSearchScope('all')
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
    window.print()
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

  // Private Category is now an opt-in account preference (migration 018,
  // 2026-08-13), off by default — see AccountForm.tsx. Read on the same
  // profiles round trip as main_chip_prefs above, rather than a separate
  // call. Governs only the ToDos colbar's Category segment and each ToDo
  // row's own Category text (see the .colbar.td / .t1 JSX below) — Sent
  // and Received have never shown Category on Main Screen at all, so
  // there's nothing to gate on those two sections.
  const [categoriesEnabled, setCategoriesEnabled] = useState(false)

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
    readStoredSort(SENT_SORT_KEY, ['name', 'date', 'due', 'done', 'category'] as const, { key: 'due', dir: 'desc' })
  )
  const [receivedSort, setReceivedSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(RECEIVED_SORT_KEY, ['name', 'date', 'due', 'done'] as const, { key: 'due', dir: 'desc' })
  )
  const [todoSort, setTodoSort] = useState<{ key: TodoSortKey; dir: SortDir }>(() =>
    readStoredSort(TODO_SORT_KEY, ['priority', 'date', 'due', 'done', 'category'] as const, { key: 'priority', dir: 'asc' })
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
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id ?? null
      if (cancelled) return
      setUserId(uid)

      if (!uid) {
        setPrefsLoaded(true)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('main_chip_prefs, private_category_enabled, request_time_enabled, todo_dates_enabled')
        .eq('id', uid)
        .single()
      if (cancelled) return

      setCategoriesEnabled(data?.private_category_enabled ?? false)
      setRequestTimeEnabled(data?.request_time_enabled ?? true)
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
      if (prefs.hkTab === 'tasks' || prefs.hkTab === 'videos') {
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
  useEffect(() => {
    let cancelled = false

    async function attempt() {
      return Promise.all([
        supabase
          .from('requests')
          .select('id, description, due_date, due_time, done_date, created_at, contacts(display_name), dialog(count), attachments(count), categories(name), archived_at, repeat_rule')
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
          .select('id, description, priority, due_date, done_date, created_at, categories(name), dialog(count), archived_at, repeat_rule')
          .is('contact_id', null)
          .order('priority', { ascending: true, nullsFirst: false }),
      ])
    }

    async function load() {
      setLoading(true)
      setLoadError(null)

      const delaysMs = [0, 600, 1600]
      for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))
        if (cancelled) return

        const [sentRes, receivedRes, todoRes] = await attempt()
        if (cancelled) return

        const firstError = sentRes.error ?? receivedRes.error ?? todoRes.error
        if (!firstError) {
          setSent((sentRes.data as unknown as SentRow[]) ?? [])
          setReceived((receivedRes.data as unknown as ReceivedRow[]) ?? [])
          setTodos((todoRes.data as unknown as TodoRow[]) ?? [])
          setLoading(false)
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

  async function handleLogOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.replace('/login')
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
  const filteredSent = useMemo(() => {
    return sent.filter((r) => {
      if (!isSearching) {
        if (r.archived_at) return false
        return matchesStatusFilter(sentStatus(r), sentFilter)
      }
      if (searchScope === 'daterange') return matchesDateRange(r.due_date, fromDate, toDate)
      return (
        r.description.toLowerCase().includes(query) ||
        (r.contacts?.display_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [sent, sentFilter, query, isSearching, searchScope, fromDate, toDate])

  const filteredReceived = useMemo(() => {
    return received.filter((r) => {
      if (!isSearching) {
        if (r.received_archived_at) return false
        return matchesStatusFilter(receivedStatus(r), receivedFilter)
      }
      if (searchScope === 'daterange') return matchesDateRange(r.due_date, fromDate, toDate)
      return (
        r.description.toLowerCase().includes(query) ||
        (r.owner_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [received, receivedFilter, query, isSearching, searchScope, fromDate, toDate])

  // Hidden fields excluded from search (2026-08-22, owner) — a ToDo's
  // due_date/category_id can still hold a value from before the owner
  // turned Show Due/Done Dates (ToDos) or Private Category off (CLAUDE.md's
  // own documented convention: the underlying data stays put, only the UI
  // stops showing/editing it). Matching against a field the account can't
  // currently see would surface a ToDo the searcher has no way to make
  // sense of. Sent/Received never matched Category at all (neither screen
  // shows it, matching PRD §2.3's own recipient-visibility rule), so no
  // change needed there.
  const filteredTodos = useMemo(() => {
    return todos.filter((t) => {
      if (!isSearching) {
        if (t.archived_at) return false
        return matchesStatusFilter(todoStatus(t), todoFilter)
      }
      if (searchScope === 'daterange') return todoDatesEnabled && matchesDateRange(t.due_date, fromDate, toDate)
      return (
        t.description.toLowerCase().includes(query) ||
        (categoriesEnabled && (t.categories?.name ?? '').toLowerCase().includes(query))
      )
    })
  }, [todos, todoFilter, query, isSearching, searchScope, fromDate, toDate, todoDatesEnabled, categoriesEnabled])

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
                </span>
              </div>
              {isSearching ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${sentFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('all')}>All</button>
                  <button className={`chip${sentFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('open')}>Open</button>
                  <button className={`chip over${sentFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('overdue')}>Overdue</button>
                  <button className={`chip done${sentFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('done')}>Done</button>
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
                  {categoriesEnabled && (
                    <ColSort className="c-desc" label="Category" active={sentSort.key === 'category'} dir={sentSort.dir} onClick={() => sortSent('category')} />
                  )}
                </span>
                <ColSort className="c-dt" label="Date" active={sentSort.key === 'date'} dir={sentSort.dir} onClick={() => sortSent('date')} />
                <ColSort className="c-due" label="Due" active={sentSort.key === 'due'} dir={sentSort.dir} onClick={() => sortSent('due')} />
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={sentSort.key === 'done'}
                  dir={sentSort.dir}
                  onClick={() => sortSent('done')}
                  disabled={!isSearching && sentFilter !== 'all' && sentFilter !== 'done'}
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
                  <div className="subempty">No Sent Requests yet.</div>
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
                      onClick={() => router.push(`/requests/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/requests/${r.id}`) }}
                    >
                      <div className="r1">
                        <span className="nm">{r.contacts?.display_name ?? '—'}</span>
                        <span className="dt">{formatMDY(r.created_at)}</span>
                        <span className="due">{formatMDY(r.due_date)}</span>
                        <span className={`dn${late ? ' late' : ''}`}>{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="r2">
                        {r.archived_at && <span className="archtag">Archived</span>}
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
                          {categoriesEnabled && (
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
                </span>
              </div>
              {isSearching ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${receivedFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('all')}>All</button>
                  <button className={`chip${receivedFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('open')}>Open</button>
                  <button className={`chip over${receivedFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('overdue')}>Overdue</button>
                  <button className={`chip done${receivedFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('done')}>Done</button>
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
                <ColSort className="c-dt" label="Date" active={receivedSort.key === 'date'} dir={receivedSort.dir} onClick={() => sortReceived('date')} />
                <ColSort className="c-due" label="Due" active={receivedSort.key === 'due'} dir={receivedSort.dir} onClick={() => sortReceived('due')} />
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={receivedSort.key === 'done'}
                  dir={receivedSort.dir}
                  onClick={() => sortReceived('done')}
                  disabled={!isSearching && receivedFilter !== 'all' && receivedFilter !== 'done'}
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
                  <div className="subempty">No Received Requests yet.</div>
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
                      onClick={() => router.push(`/requests/${r.id}/respond`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/requests/${r.id}/respond`) }}
                    >
                      <div className="r1">
                        <span className="nm">{r.owner_name ?? '—'}</span>
                        <span className="dt">{formatMDY(r.created_at)}</span>
                        <span className="due">{formatMDY(r.due_date)}</span>
                        <span className={`dn${late ? ' late' : ''}`}>{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="r2">
                        {r.received_archived_at && <span className="archtag">Archived</span>}
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
              {isSearching ? (
                <div className="chips searchresultsrow">
                  <span className="searchnotice">Search Results</span>
                  <button className="clearsearch" type="button" onClick={clearSearch}>
                    Clear&nbsp;Search&nbsp;×
                  </button>
                </div>
              ) : (
                <div className="chips">
                  <button className={`chip${todoFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('all')}>All</button>
                  <button className={`chip${todoFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('open')}>Open</button>
                  {todoDatesEnabled && (
                    <button className={`chip over${todoFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('overdue')}>Overdue</button>
                  )}
                  <button className={`chip done${todoFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('done')}>Done</button>
                </div>
              )}
              <span className="subicons">
                <button className="iconbtn" type="button" aria-label="Print ToDos" onClick={() => startPrint('todos')}><PrintIcon /></button>
              </span>
            </div>
            <div className="subbody">
              <div className={`colbar dcols${todoDatesEnabled ? ' wide' : ''}`}>
                <span className="namecell">
                  <ColSort className="c-pri" label="Priority" active={todoSort.key === 'priority'} dir={todoSort.dir} onClick={() => sortTodos('priority')} />
                  {/* Description -> Category, sortable, when Private
                      Category is on; removed entirely when off — 2026-08-24,
                      owner. Category was a plain static colbar heading here
                      through 2026-08-17's redesign; this reinstates it as a
                      live sort column (retired 2026-08-17, see TodoSortKey's
                      own comment above). */}
                  {categoriesEnabled && (
                    <ColSort className="c-desc" label="Category" active={todoSort.key === 'category'} dir={todoSort.dir} onClick={() => sortTodos('category')} />
                  )}
                </span>
                <ColSort className="c-dt" label="Date" active={todoSort.key === 'date'} dir={todoSort.dir} onClick={() => sortTodos('date')} />
                {todoDatesEnabled && (
                  <ColSort className="c-due" label="Due" active={todoSort.key === 'due'} dir={todoSort.dir} onClick={() => sortTodos('due')} />
                )}
                <ColSort
                  className="c-dn"
                  label="Done"
                  active={todoSort.key === 'done'}
                  dir={todoSort.dir}
                  onClick={() => sortTodos('done')}
                  disabled={!isSearching && todoFilter !== 'all' && todoFilter !== 'done'}
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
                  <div className="subempty">No ToDos yet.</div>
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
                      onClick={() => router.push(`/todos/${t.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/todos/${t.id}`) }}
                    >
                      <div className={`trd${todoDatesEnabled ? ' wide' : ''}`}>
                        <span className="pri">{t.priority ? PRIORITY_LABEL[t.priority] : ''}</span>
                        <span className="dt">{formatMDY(t.created_at)}</span>
                        {todoDatesEnabled && <span className="due">{formatMDY(t.due_date)}</span>}
                        <span className="dn">{formatMDY(t.done_date)}</span>
                      </div>
                      <div className="r2">
                        {t.archived_at && <span className="archtag">Archived</span>}
                        {dialogCount(t.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        <span className="desc">
                          {categoriesEnabled && (
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
          <div className="band">
            <span className="glabel">Housekeeping</span>
            <button className="btn-quiet" type="button" onClick={handleLogOut} disabled={signingOut}>
              {signingOut ? 'Logging out…' : 'Log Out'}
            </button>
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
                    How-to Videos
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
                    onClick={() => router.push('/contacts')}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/contacts') }}
                  >
                    <span className="hktext">
                      <span className="hktitle">Contacts</span>
                      <span className="hknote"> — view and edit</span>
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
                      <span className="hknote"> — view and edit</span>
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
                      <span className="hknote"> — remove completed items from the above lists</span>
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
                      installed. */}
                  {canInstall && (
                    <div
                      className="hkrow"
                      role="button"
                      tabIndex={0}
                      onClick={() => { promptInstall() }}
                      onKeyDown={(e) => { if (e.key === 'Enter') promptInstall() }}
                    >
                      <span className="hktext">
                        <span className="hktitle">Install</span>
                        <span className="hknote"> — add a Would You Please icon to your home screen</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="subbody">
                <div className="hkrows">
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Getting Started</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
                    </span>
                  </div>
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Creating a Request</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
                    </span>
                  </div>
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Responding to a Request</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
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
          </div>

          <div className="searchbar sb">
            <select
              className="scope"
              value={searchScope}
              onChange={(e) => selectSearchScope(e.target.value as 'all' | 'daterange')}
              aria-label="Search scope"
            >
              <option value="all">All</option>
              <option value="daterange">Dates</option>
            </select>

            {searchScope === 'all' ? (
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
                  <span className="drlabel">From</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    aria-label="Search Due Date from"
                  />
                </label>
                <label className="drfield">
                  <span className="drlabel">To</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label="Search Due Date to"
                  />
                </label>
              </div>
            )}

            {isSearching && (
              <button className="clearsearch" type="button" onClick={clearSearch}>
                Clear&nbsp;Search&nbsp;×
              </button>
            )}

            <span className="iconbtn" role="button" tabIndex={0} aria-label="Search"><SearchIcon /></span>
          </div>

          <div className="scroll-pad" />
        </div>

        <div className="subbanner" role="button" tabIndex={0}>See Subscription Features and Other Options</div>
        <div className="adslot" aria-hidden="true"><span className="adbox">AD — 320×50 RESERVED</span></div>
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
                  {categoriesEnabled && (
                    <span className="c-desc">Category{sentSort.key === 'category' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  )}
                </span>
                <span className="c-dt">Date{sentSort.key === 'date' ? (sentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
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
                        <span className="pdt">{formatMDY(r.created_at)}</span>
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
                          {categoriesEnabled && categoryPrefix(r.categories?.name)}
                          {r.description}
                        </span>
                      </div>
                      <PrintRepeatLine rule={r.repeat_rule} dueDate={r.due_date} />
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
                <span className="c-dt">Date{receivedSort.key === 'date' ? (receivedSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
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
                        <span className="pdt">{formatMDY(r.created_at)}</span>
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
                  {categoriesEnabled && (
                    <span className="c-desc">Category{todoSort.key === 'category' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  )}
                </span>
                <span className="c-dt">Date{todoSort.key === 'date' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
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
                        <span className="pdt">{formatMDY(t.created_at)}</span>
                        {todoDatesEnabled && <span className="pdue">{formatMDY(t.due_date)}</span>}
                        <span className="pdn">{formatMDY(t.done_date)}</span>
                      </div>
                      <div className="pr2">
                        <span className="pdesc">
                          {categoriesEnabled && categoryPrefix(t.categories?.name)}
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
    </div>
  )
}
