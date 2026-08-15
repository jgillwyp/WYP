'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

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
 *   (Received) / category name (ToDos), case-insensitive substring. The
 *   scope button ("All ▼") stays visual-only — it has never had a designed
 *   picker (see CLAUDE.md) and search already runs across all three sections
 *   at once, so there's nothing yet for a scope to narrow.
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
}

type TodoRow = {
  id: string
  description: string
  priority: number | null
  due_date: string | null
  done_date: string | null
  categories: { name: string } | null
  dialog: { count: number }[] | null
  // archived_at — same reasoning as SentRow above. A ToDo has no recipient,
  // so this is its only archive state (there is no received_archived_at
  // counterpart for ToDos).
  archived_at: string | null
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
type ReqSortKey = 'name' | 'date' | 'due' | 'done'
type TodoSortKey = 'priority' | 'category'

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

const TODO_SORT_DEFAULT_DIR: Record<TodoSortKey, SortDir> = {
  priority: 'asc',
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
}: {
  className: string
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  // aria-sort is only valid on elements with role="columnheader"/"rowheader"
  // (or a native <th>) per jsx-a11y/role-supports-aria-props — this is a
  // plain <button> (implicit role="button"), so the sort state is conveyed
  // via aria-label instead. The visible ▲/▼ inside .pill already carries
  // the same information sighted users get.
  const stateLabel = active ? `, currently sorted ${dir === 'asc' ? 'ascending' : 'descending'}` : ''
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={`Sort by ${label}${stateLabel}`}
    >
      {active ? <span className="pill">{label}&nbsp;{dir === 'asc' ? '▲' : '▼'}</span> : label}
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

function VoiceSearchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="16" y="4" width="16" height="24" rx="8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10,24 Q10,36 24,36 Q38,36 38,24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <line x1="24" y1="36" x2="24" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="44" x2="32" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export default function MainScreen() {
  const router = useRouter()

  const [sent, setSent] = useState<SentRow[]>([])
  const [received, setReceived] = useState<ReceivedRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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
  // Full Dialog/Attachments content for whatever's currently being printed
  // (2026-08-15) — see loadOwnedPrintDetail/loadReceivedPrintDetail above
  // for why this is a print-time fetch rather than part of the main list
  // queries. Keyed by request id; printSection only flips (triggering the
  // print effect below) once this has actually resolved, so the report
  // never renders — and window.print() never fires — against stale/empty
  // detail.
  const [printDetail, setPrintDetail] = useState<PrintDetailMap>({})

  useEffect(() => {
    if (!printSection) return
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
  }, [printSection])

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

  const [sentSort, setSentSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(SENT_SORT_KEY, ['name', 'date', 'due', 'done'] as const, { key: 'due', dir: 'desc' })
  )
  const [receivedSort, setReceivedSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(RECEIVED_SORT_KEY, ['name', 'date', 'due', 'done'] as const, { key: 'due', dir: 'desc' })
  )
  const [todoSort, setTodoSort] = useState<{ key: TodoSortKey; dir: SortDir }>(() =>
    readStoredSort(TODO_SORT_KEY, ['priority', 'category'] as const, { key: 'priority', dir: 'asc' })
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


  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [sentRes, receivedRes, todoRes] = await Promise.all([
        supabase
          .from('requests')
          .select('id, description, due_date, due_time, done_date, created_at, contacts(display_name), dialog(count), attachments(count), categories(name), archived_at')
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
          .select('id, description, priority, due_date, done_date, categories(name), dialog(count), archived_at')
          .is('contact_id', null)
          .order('priority', { ascending: true, nullsFirst: false }),
      ])

      if (cancelled) return

      if (sentRes.error || receivedRes.error || todoRes.error) {
        setLoadError(
          (sentRes.error ?? receivedRes.error ?? todoRes.error)?.message ?? 'Could not load requests.'
        )
      } else {
        setSent((sentRes.data as unknown as SentRow[]) ?? [])
        setReceived((receivedRes.data as unknown as ReceivedRow[]) ?? [])
        setTodos((todoRes.data as unknown as TodoRow[]) ?? [])
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

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
  // show-when-searching split happens only here, client-side. An archived
  // row still has to pass the status chip filter like any other row; only
  // the "hidden at rest" behavior is special-cased.
  const filteredSent = useMemo(() => {
    return sent.filter((r) => {
      if (r.archived_at && query === '') return false
      if (!matchesStatusFilter(sentStatus(r), sentFilter)) return false
      if (query === '') return true
      return (
        r.description.toLowerCase().includes(query) ||
        (r.contacts?.display_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [sent, sentFilter, query])

  const filteredReceived = useMemo(() => {
    return received.filter((r) => {
      if (r.received_archived_at && query === '') return false
      if (!matchesStatusFilter(receivedStatus(r), receivedFilter)) return false
      if (query === '') return true
      return (
        r.description.toLowerCase().includes(query) ||
        (r.owner_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [received, receivedFilter, query])

  const filteredTodos = useMemo(() => {
    return todos.filter((t) => {
      if (t.archived_at && query === '') return false
      if (!matchesStatusFilter(todoStatus(t), todoFilter)) return false
      if (query === '') return true
      return (
        t.description.toLowerCase().includes(query) ||
        (t.categories?.name ?? '').toLowerCase().includes(query)
      )
    })
  }, [todos, todoFilter, query])

  // Sorted on top of the already-filtered rows — filtering and sorting are
  // independent concerns (which rows show vs. what order they show in), so
  // this stays a second pass rather than folding sort comparisons into the
  // filter predicates above.
  const sortedSent = useMemo(() => {
    const list = [...filteredSent]
    list.sort((a, b) => {
      switch (sentSort.key) {
        case 'name':
          return compareNullable(a.contacts?.display_name ?? null, b.contacts?.display_name ?? null, sentSort.dir, compareStrings)
        case 'date':
          return compareNullable(a.created_at, b.created_at, sentSort.dir, compareStrings)
        case 'due':
          return compareNullable(a.due_date, b.due_date, sentSort.dir, compareStrings)
        case 'done':
          return compareNullable(a.done_date, b.done_date, sentSort.dir, compareStrings)
      }
    })
    return list
  }, [filteredSent, sentSort])

  const sortedReceived = useMemo(() => {
    const list = [...filteredReceived]
    list.sort((a, b) => {
      switch (receivedSort.key) {
        case 'name':
          return compareNullable(a.owner_name, b.owner_name, receivedSort.dir, compareStrings)
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
      if (todoSort.key === 'priority') {
        return compareNullable(a.priority, b.priority, todoSort.dir, compareNumbers)
      }
      return compareNullable(a.categories?.name ?? null, b.categories?.name ?? null, todoSort.dir, compareStrings)
    })
    return list
  }, [filteredTodos, todoSort])

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
  }

  function sortSent(key: ReqSortKey) {
    setSentSort((s) => toggleSort(s, key, REQ_SORT_DEFAULT_DIR))
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
              <div className="chips">
                <button className={`chip${sentFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('all')}>All</button>
                <button className={`chip${sentFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('open')}>Open</button>
                <button className={`chip over${sentFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('overdue')}>Overdue</button>
                <button className={`chip done${sentFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setSentFilter('done')}>Done</button>
              </div>
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <ColSort className="c-nm" label="To" active={sentSort.key === 'name'} dir={sentSort.dir} onClick={() => sortSent('name')} />
                <ColSort className="c-dt" label="Date" active={sentSort.key === 'date'} dir={sentSort.dir} onClick={() => sortSent('date')} />
                <ColSort className="c-due" label="Due" active={sentSort.key === 'due'} dir={sentSort.dir} onClick={() => sortSent('due')} />
                <ColSort className="c-dn" label="Done" active={sentSort.key === 'done'} dir={sentSort.dir} onClick={() => sortSent('done')} />
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && <div className="subempty">{loadError}</div>}
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
                        {dialogCount(r.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        {attachmentCount(r.attachments) > 0 && (
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
              <div className="chips">
                <button className={`chip${receivedFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('all')}>All</button>
                <button className={`chip${receivedFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('open')}>Open</button>
                <button className={`chip over${receivedFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('overdue')}>Overdue</button>
                <button className={`chip done${receivedFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setReceivedFilter('done')}>Done</button>
              </div>
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <ColSort className="c-nm" label="From" active={receivedSort.key === 'name'} dir={receivedSort.dir} onClick={() => sortReceived('name')} />
                <ColSort className="c-dt" label="Date" active={receivedSort.key === 'date'} dir={receivedSort.dir} onClick={() => sortReceived('date')} />
                <ColSort className="c-due" label="Due" active={receivedSort.key === 'due'} dir={receivedSort.dir} onClick={() => sortReceived('due')} />
                <ColSort className="c-dn" label="Done" active={receivedSort.key === 'done'} dir={receivedSort.dir} onClick={() => sortReceived('done')} />
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && <div className="subempty">{loadError}</div>}
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
              <div className="chips">
                <button className={`chip${todoFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('all')}>All</button>
                <button className={`chip${todoFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('open')}>Open</button>
                {todoDatesEnabled && (
                  <button className={`chip over${todoFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('overdue')}>Overdue</button>
                )}
                <button className={`chip done${todoFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setTodoFilter('done')}>Done</button>
              </div>
              <span className="subicons">
                <button className="iconbtn" type="button" aria-label="Print ToDos" onClick={() => startPrint('todos')}><PrintIcon /></button>
              </span>
            </div>
            <div className="subbody">
              <div className="colbar td">
                <ColSort className="c-pri" label="Priority" active={todoSort.key === 'priority'} dir={todoSort.dir} onClick={() => sortTodos('priority')} />
                {categoriesEnabled ? (
                  <ColSort className="c-cat" label="Category — Description" active={todoSort.key === 'category'} dir={todoSort.dir} onClick={() => sortTodos('category')} />
                ) : (
                  <span className="c-cat">Description</span>
                )}
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && <div className="subempty">{loadError}</div>}
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
                      <div className="t1">
                        {dialogCount(t.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        <span className="tdc">
                          <span className="pri">{t.priority ? PRIORITY_LABEL[t.priority] : ''}</span>{' '}
                          {categoriesEnabled && (
                            <>
                              <span className="cat">{t.categories?.name ?? '—'}</span>{' '}
                            </>
                          )}
                          — <span className="tdd">{t.description}</span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- Housekeeping */}
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
                      <span className="hktitle">Account</span>
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
                      <span className="hknote"> — remove completed items from these lists</span>
                    </span>
                  </div>
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

          <div className="scroll-pad" />
        </div>

        {/* Search bar — visual only this pass, see file header comment */}
        <div className="searchbar sb">
          <button className="scope" type="button">All&nbsp;▼</button>
          <input
            className="field"
            type="text"
            placeholder="Search Would You Please"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <span className="iconbtn" role="button" tabIndex={0} aria-label="Voice search"><VoiceSearchIcon /></span>
          <span className="iconbtn" role="button" tabIndex={0} aria-label="Search"><SearchIcon /></span>
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
                <span className="c-nm">To</span>
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
                          {formatMDY(r.due_date)}
                          {/* Due Time sub-line — gated by the signed-in
                              owner's own request_time_enabled (migration 019),
                              since every Sent row is this account's own. */}
                          {requestTimeEnabled && r.due_time && (
                            <span className="ptime">{formatTime12h(r.due_time)}</span>
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
                <span className="c-nm">From</span>
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
                          {formatMDY(r.due_date)}
                          {/* Gated per-row by that row's own sender's setting
                              (migration 021) — Received rows can come from
                              different accounts, each with its own
                              request_time_enabled. */}
                          {r.owner_request_time_enabled && r.due_time && (
                            <span className="ptime">{formatTime12h(r.due_time)}</span>
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
              <div className={`pcolbar ${todoDatesEnabled ? 'ptdc' : 'ptdc-nodates'}`}>
                <span className="c-desc">Description</span>
                {/* Due/Done columns dropped entirely when the account's own
                    todo_dates_enabled (migration 022) is off — a ToDo has no
                    due_date/done_date to show in that state (Create ToDo/ToDo
                    Detail collapse to the Open/Done Status chip pair
                    instead), so there's nothing for these columns to display.
                    Owner's own comment #2 only mentioned dropping Due; Done
                    is dropped along with it here since both fields are governed
                    by the same single toggle. */}
                {todoDatesEnabled && (
                  <>
                    <span className="c-due">Due</span>
                    <span className="c-dn">Done</span>
                  </>
                )}
              </div>
              <div className="prows">
                {sortedTodos.length === 0 && <div className="pempty">No ToDos match this report.</div>}
                {sortedTodos.map((t) => {
                  const status = todoDatesEnabled ? todoStatus(t) : 'open'
                  const detail = printDetail[t.id]
                  return (
                    <div key={t.id} className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                      <div className="pr2">
                        <span className="pdesc">
                          {categoriesEnabled && categoryPrefix(t.categories?.name)}
                          {t.description}
                        </span>
                      </div>
                      {todoDatesEnabled && (
                        <div className="pr1 ptd">
                          <span className="pdue">{formatMDY(t.due_date)}</span>
                          <span className="pdn">{formatMDY(t.done_date)}</span>
                        </div>
                      )}
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
