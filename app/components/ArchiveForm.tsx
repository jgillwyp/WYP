'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Archive (2026-08-14) — live conversion of
 * design/screens/WYP_archive_palette1.html. Lets a Done Sent Request,
 * Received Request, or ToDo be removed from the Main Screen's lists while
 * staying reachable through Search — matches the owner's own drafted PRD
 * §9.5 replacement text (decisions log, 2026-08-14, not yet merged into the
 * docx — see CLAUDE.md's Known gaps).
 *
 * Per-viewer archive scope (2026-08-14, owner-confirmed via AskUserQuestion:
 * "Per-viewer" over "Shared"). A Request is one row viewed by two different
 * accounts; archiving it from one side must not affect the other. Two
 * independent nullable columns (migration 028):
 *   - archived_at — the row's own owner archiving it from Sent (a Request)
 *     or their only list (a ToDo). Plain-RLS-writable ("requests: owners
 *     update own", migration 002) — no function needed, just a normal
 *     `.update()`.
 *   - received_archived_at — the recipient archiving their own copy from
 *     Received. RLS is owner-only, so this goes through the new
 *     archive_received_request() SECURITY DEFINER function (migration 028),
 *     same email-match-through-contacts pattern as
 *     set_response_done_as_recipient/add_dialog_as_recipient (migration
 *     012), called once per id.
 *
 * "Still findable through Search" (2026-08-14 PRD text) means neither column
 * is ever excluded from a query — MainScreen.tsx fetches Sent/Received/ToDos
 * in full and hides an archived row only while the search box is empty (see
 * that file's filteredSent/filteredReceived/filteredTodos). This screen does
 * the mirror-image job: it only ever shows a Done record that is NOT yet
 * archived (an already-archived record has nothing further to do here since
 * Un-Archive is deferred — see below).
 *
 * Selection-persistence rule (owner's own worked example, 2026-08-14): each
 * Record Type keeps its own `deselected` id set. Unchecking a record excludes
 * it from the next Archive Selected click; that deselection survives further
 * narrowing or widening of the Recipient/Requestor and/or Before Done Date
 * filters, as long as the record keeps matching. Switching Record Type is a
 * different list/context, not a filter refinement — deselection state is
 * kept separately per type and never carries across.
 *
 * The list starts empty until at least one filter is entered (ToDos has no
 * Recipient/Requestor field, so Before Done Date alone gates it) — matches
 * the mockup and the owner's own description ("would open with no Sent
 * Requests displayed").
 *
 * Before Done Date uses the app's standard `.ffloat.picker.native` date
 * field (unlike the mockup's own `.plaingroup`/`.finput.plain` workaround —
 * that substitution existed only because the standalone mockup file has no
 * Tailwind preflight reset; this live component has the real one, so the
 * normal pattern works here without modification). Calendar-picker-only
 * (2026-08-14, owner-reported on the mockup: manual m/d/y typing let
 * month/day roll over uncontrolled, never validated Feb 29, and accepted a
 * year like "276750") — a keydown listener blocks every key but Tab, so the
 * only way to set a value is the native picker, which can't produce an
 * invalid date. This is the one date field in the app with this behavior;
 * every other date/time field still allows typing plus a click-to-open
 * affordance (openPicker, 2026-08-11) — flagged as a deliberate, scoped
 * exception, not a retroactive app-wide change to the other 14 fields.
 *
 * Un-Archive is out of scope this batch (owner, 2026-08-14: "I did not
 * tackle an 'Un-Archive' feature - that can be done later") — no reverse
 * action exists yet; an archived record simply drops out of this screen's
 * own eligible list once archived_at/received_archived_at is set.
 *
 * Print (2026-08-15) reuses Main Screen's own detailed print-report layout
 * verbatim — full Dialog thread, full Attachments/Locations list per
 * record, not just an icon — plus a Selection Criteria line built from this
 * screen's own filter state, and the .archcheck checkbox reused in a
 * dedicated narrow print column. See the Print helpers and criteriaText
 * further down this file. (Originally scoped as a plain window.print() when
 * this screen first went live 2026-08-14 — superseded the next day once the
 * owner asked for the same detailed layout here too.)
 *
 * Column-header sorting (2026-08-14, owner-reported: "the sorting does not
 * work for column headings in the displayed search results... it would be
 * helpful to have it react to users as they have learned to expect") — the
 * colbar's To/From, Date, Due, Done (Sent/Received) and Priority (ToDos)
 * headers are now real sort buttons, mirroring Main Screen's own ColSort
 * feature (2026-08-11) exactly, duplicated here rather than imported per
 * this app's small-stateless-helper convention. Sort state persists to
 * sessionStorage per Record Type, same pattern as currentType/
 * recipientQuery/beforeDone/deselected above. ToDos here has only Priority
 * to sort by — this screen never shows Category at all, unlike Main
 * Screen's own ToDos list.
 */

type RecordType = 'sent' | 'received' | 'todos'

type SentCandidate = {
  id: string
  description: string
  due_date: string | null
  done_date: string | null
  created_at: string
  archived_at: string | null
  contacts: { display_name: string } | null
}

type ReceivedCandidate = {
  id: string
  description: string
  due_date: string | null
  done_date: string | null
  created_at: string
  owner_name: string | null
  received_archived_at: string | null
}

type TodoCandidate = {
  id: string
  description: string
  priority: number | null
  done_date: string | null
  archived_at: string | null
}

const PRIORITY_LABEL: Record<number, string> = { 1: 'ASAP', 2: 'SOON', 3: 'LATER' }

function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

// Print (2026-08-15) — same shapes/helpers as MainScreen.tsx's own Print
// Reports, duplicated per this app's established convention. Owner: "the
// same formats would work along with the insertion of a checkbox in its own
// narrow column as is done with the on-screen view" — reuses the identical
// .print-report/.prow/.pdlg/.patt layout, with .archcheck's own checkbox
// added as a fourth column. The printed header now also shows the Selection
// Criteria line (added same day, once the owner's own three follow-up xlsx
// mockups supplied its exact wording/format) — see criteriaText() below,
// built from this component's own noun/query/beforeDone state, the same
// values driving the on-screen filter.
type PrintDialogEntry = { id: string; kind: string; body: string; who: string | null; replies_to_id: string | null }
type PrintAttachmentEntry = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  reference_url: string | null
  reference_note: string | null
}
type PrintDetail = { dialog: PrintDialogEntry[]; attachments: PrintAttachmentEntry[] }
type PrintDetailMap = Record<string, PrintDetail>

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

// Sent/ToDos: owner-scoped, plain RLS access, same as MainScreen.tsx's own
// loadOwnedPrintDetail(). Received: migration 029's get_received_print_detail
// RPC, same as MainScreen.tsx's own loadReceivedPrintDetail().
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

// Same helper as CreateRequestForm.tsx/RequestDetailForm.tsx etc. — see this
// app's established convention for small stateless formatters duplicated
// per component rather than centralized in a shared lib file.
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker()
    } catch {
      // ignore — calendar icon still opens it
    }
  }
}

// Column-header sorting (2026-08-14, owner-reported: "the sorting does not
// work for column headings in the displayed search results... it would be
// helpful to have it react to users as they have learned to expect").
// Duplicated from MainScreen.tsx's own ColSort/toggleSort/compareNullable/
// etc. rather than shared — this app's established convention for small
// stateless helpers (see openPicker above, formatMDY). Sent/Received share
// one Req sort (name/date/due/done, mirroring Main Screen's own To-From/
// Date/Due/Done columns); ToDos here has only Priority to sort by — unlike
// Main Screen's ToDos, this screen never shows Category at all, so there's
// no second sortable column.
type SortDir = 'asc' | 'desc'
type ReqSortKey = 'name' | 'date' | 'due' | 'done'
type TodoSortKey = 'priority'

const REQ_SORT_DEFAULT_DIR: Record<ReqSortKey, SortDir> = {
  name: 'asc',
  date: 'desc',
  due: 'desc',
  done: 'desc',
}

const TODO_SORT_DEFAULT_DIR: Record<TodoSortKey, SortDir> = {
  priority: 'asc',
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

const ARCHIVE_SENT_SORT_KEY = 'wyp.archiveSentSort'
const ARCHIVE_RECEIVED_SORT_KEY = 'wyp.archiveReceivedSort'
const ARCHIVE_TODO_SORT_KEY = 'wyp.archiveTodoSort'

const NOUN: Record<RecordType, string | null> = { sent: 'Recipient', received: 'Requestor', todos: null }
const COL: Record<RecordType, string | null> = { sent: 'To', received: 'From', todos: null }
const LIST_TITLE: Record<RecordType, string> = {
  sent: 'Sent Requests (Done)',
  received: 'Received Requests (Done)',
  todos: 'ToDos (Done)',
}
const DETAIL_LABEL: Record<RecordType, string> = {
  sent: 'Request Detail',
  received: 'Response Detail',
  todos: 'ToDo Detail',
}

// State persistence (2026-08-14, owner-reported: "I was able to see the
// detail for a Request, but when I returned to the Archive screen, all of
// the entries and the search logic was cleared"). A row click navigates
// away via router.push, and Request/ToDo/Response Detail all return via
// router.back() (their own established convention) — this component fully
// remounts on the way back (no Cache Components/<Activity> enabled, same
// reasoning already documented on MainScreen.tsx), so every piece of
// useState here was resetting to its default on every round trip. Same
// fix, same sessionStorage-not-localStorage reasoning as Main Screen's own
// 2026-08-09 chip-persistence fix: a within-session view/selection state,
// not a durable account setting.
//
// Narrowed 2026-08-16 (owner-reported): the fix above unintentionally also
// persisted the Recipient/Requestor query, Before Done Date, and checkbox
// selection across a full Close-to-Main-Screen-and-back round trip, later
// in the same login session — the owner's own example: filter to a
// Recipient + Before Done Date, hand-deselect a few matching rows, Close,
// come back to Archive later, and find the same records shown but no
// longer checked, which he judged illogical ("they should be [selected]... Or,
// the Archive 'Session' could be just for the duration of having the
// Archive screen open... reset the selection criteria variables and show
// nothing selected — this would be my preference"). Took the stated
// preference: filters and selection now reset to empty on any fresh visit
// to /archive, and only survive the one round trip this section's original
// fix was built for — opening a single record's own Detail screen and
// coming straight back via router.back(). ARCHIVE_ROUNDTRIP_KEY is the
// marker distinguishing the two: openDetail() sets it immediately before
// navigating away; the mount effect below consumes (reads and clears) it —
// present means "this mount is that same return trip, keep what's stored,"
// absent means "this is a fresh arrival at Archive, reset to blank." Record
// Type (ARCHIVE_TYPE_KEY) is untouched by this — the owner's report was
// about the filter fields and selection only, and an empty filter already
// shows nothing regardless of which Record Type chip is active.
const ARCHIVE_TYPE_KEY = 'wyp.archiveType'
const ARCHIVE_QUERY_KEY = 'wyp.archiveRecipientQuery'
const ARCHIVE_BEFORE_KEY = 'wyp.archiveBeforeDone'
const ARCHIVE_DESELECTED_KEY = 'wyp.archiveDeselected'
const ARCHIVE_ROUNDTRIP_KEY = 'wyp.archiveDetailRoundTrip'

function readStoredType(): RecordType {
  if (typeof window === 'undefined') return 'sent'
  const v = window.sessionStorage.getItem(ARCHIVE_TYPE_KEY)
  return v === 'sent' || v === 'received' || v === 'todos' ? v : 'sent'
}

function readStoredString(key: string): string {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(key) ?? ''
}

function readStoredDeselected(): Record<RecordType, Set<string>> {
  const empty = { sent: new Set<string>(), received: new Set<string>(), todos: new Set<string>() }
  if (typeof window === 'undefined') return empty
  try {
    const raw = window.sessionStorage.getItem(ARCHIVE_DESELECTED_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Record<RecordType, string[]>
    return {
      sent: new Set(parsed.sent ?? []),
      received: new Set(parsed.received ?? []),
      todos: new Set(parsed.todos ?? []),
    }
  } catch {
    return empty
  }
}

// Read-only check of the round-trip marker openDetail() sets — used by the
// three useState lazy initializers below to decide whether to read the
// stored filters/selection or start blank. Deliberately checked inside each
// initializer (which React guarantees runs exactly once per mount, before
// first paint) rather than via a setState call in a useEffect — the latter
// would cause an extra render and trips this codebase's
// react-hooks/set-state-in-effect lint rule for no benefit here, since the
// value is already known synchronously at mount time.
function isArchiveRoundTrip(): boolean {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(ARCHIVE_ROUNDTRIP_KEY) === '1'
}

export default function ArchiveForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [sentData, setSentData] = useState<SentCandidate[]>([])
  const [receivedData, setReceivedData] = useState<ReceivedCandidate[]>([])
  const [todoData, setTodoData] = useState<TodoCandidate[]>([])

  const [currentType, setCurrentType] = useState<RecordType>(readStoredType)
  const [recipientQuery, setRecipientQuery] = useState(() =>
    isArchiveRoundTrip() ? readStoredString(ARCHIVE_QUERY_KEY) : ''
  )
  const [recipientBrowsing, setRecipientBrowsing] = useState(false)
  const [showRecipientResults, setShowRecipientResults] = useState(false)
  const [beforeDone, setBeforeDone] = useState(() => (isArchiveRoundTrip() ? readStoredString(ARCHIVE_BEFORE_KEY) : ''))

  const [deselected, setDeselected] = useState<Record<RecordType, Set<string>>>(() =>
    isArchiveRoundTrip()
      ? readStoredDeselected()
      : { sent: new Set<string>(), received: new Set<string>(), todos: new Set<string>() }
  )

  useEffect(() => {
    window.sessionStorage.setItem(ARCHIVE_TYPE_KEY, currentType)
  }, [currentType])

  useEffect(() => {
    window.sessionStorage.setItem(ARCHIVE_QUERY_KEY, recipientQuery)
  }, [recipientQuery])

  useEffect(() => {
    window.sessionStorage.setItem(ARCHIVE_BEFORE_KEY, beforeDone)
  }, [beforeDone])

  useEffect(() => {
    window.sessionStorage.setItem(
      ARCHIVE_DESELECTED_KEY,
      JSON.stringify({
        sent: [...deselected.sent],
        received: [...deselected.received],
        todos: [...deselected.todos],
      })
    )
  }, [deselected])

  // The three useState initializers above already read isArchiveRoundTrip()
  // synchronously at mount to decide whether to restore stored state or
  // start blank — this effect just consumes (clears) the marker afterward,
  // so the *next* mount defaults to "fresh" unless openDetail() sets it
  // again. No setState call here, so no cascading extra render.
  useEffect(() => {
    window.sessionStorage.removeItem(ARCHIVE_ROUNDTRIP_KEY)
  }, [])

  const [sentSort, setSentSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(ARCHIVE_SENT_SORT_KEY, ['name', 'date', 'due', 'done'] as const, { key: 'due', dir: 'desc' })
  )
  const [receivedSort, setReceivedSort] = useState<{ key: ReqSortKey; dir: SortDir }>(() =>
    readStoredSort(ARCHIVE_RECEIVED_SORT_KEY, ['name', 'date', 'due', 'done'] as const, { key: 'due', dir: 'desc' })
  )
  const [todoSort, setTodoSort] = useState<{ key: TodoSortKey; dir: SortDir }>(() =>
    readStoredSort(ARCHIVE_TODO_SORT_KEY, ['priority'] as const, { key: 'priority', dir: 'asc' })
  )

  useEffect(() => {
    writeStoredSort(ARCHIVE_SENT_SORT_KEY, sentSort)
  }, [sentSort])

  useEffect(() => {
    writeStoredSort(ARCHIVE_RECEIVED_SORT_KEY, receivedSort)
  }, [receivedSort])

  useEffect(() => {
    writeStoredSort(ARCHIVE_TODO_SORT_KEY, todoSort)
  }, [todoSort])

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)

  // Print (2026-08-15) — same afterprint-driven pattern as MainScreen.tsx's
  // own Print Reports; printDetail is fetched fresh for whichever Record
  // Type's currently visible matches are being printed. No own masthead/
  // timestamp is rendered (dropped the same day it shipped) — the browser's
  // own print header already shows one, so ours was a literal duplicate,
  // "repeated... in reverse order" per the owner's own report comparing a
  // real printout against the design.
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)
  const [printDetail, setPrintDetail] = useState<PrintDetailMap>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [sentRes, receivedRes, todoRes] = await Promise.all([
        supabase
          .from('requests')
          .select('id, description, due_date, done_date, created_at, archived_at, contacts(display_name)')
          .not('contact_id', 'is', null)
          .order('done_date', { ascending: false, nullsFirst: false }),
        // get_received_requests() (migration 012, +received_archived_at via
        // migration 028) — same reasoning as MainScreen.tsx: no column links
        // a requests row to its recipient's own account, only to the
        // sender's Contact record for them.
        supabase.rpc('get_received_requests'),
        supabase
          .from('requests')
          .select('id, description, priority, done_date, archived_at')
          .is('contact_id', null)
          .order('done_date', { ascending: false, nullsFirst: false }),
      ])

      if (cancelled) return

      if (sentRes.error || receivedRes.error || todoRes.error) {
        setLoadError((sentRes.error ?? receivedRes.error ?? todoRes.error)?.message ?? 'Could not load records.')
      } else {
        setSentData((sentRes.data as unknown as SentCandidate[]) ?? [])
        setReceivedData((receivedRes.data as unknown as ReceivedCandidate[]) ?? [])
        setTodoData((todoRes.data as unknown as TodoCandidate[]) ?? [])
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Normalized shape shared by all three record types below — name is null
  // for ToDos (no recipient), due/date are null for ToDos (never shown).
  // dueISO/dateISO/priority are the raw sortable values alongside the
  // already-formatted display strings (due/date/priLabel) — MM-DD-YY isn't
  // safely string-sortable, so sorting reads these instead (2026-08-14,
  // column-header sorting).
  type Row = {
    id: string
    name: string | null
    desc: string
    due: string | null
    date: string | null
    dueISO: string | null
    dateISO: string | null
    doneDisp: string
    doneISO: string
    priLabel: string
    priority: number | null
  }

  const rows: Row[] = useMemo(() => {
    if (currentType === 'sent') {
      return sentData
        .filter((r) => r.done_date && !r.archived_at)
        .map((r) => ({
          id: r.id,
          name: r.contacts?.display_name ?? null,
          desc: r.description,
          due: formatMDY(r.due_date),
          date: formatMDY(r.created_at),
          dueISO: r.due_date ? r.due_date.slice(0, 10) : null,
          dateISO: r.created_at ? r.created_at.slice(0, 10) : null,
          doneDisp: formatMDY(r.done_date),
          doneISO: (r.done_date ?? '').slice(0, 10),
          priLabel: '',
          priority: null,
        }))
    }
    if (currentType === 'received') {
      return receivedData
        .filter((r) => r.done_date && !r.received_archived_at)
        .map((r) => ({
          id: r.id,
          name: r.owner_name ?? null,
          desc: r.description,
          due: formatMDY(r.due_date),
          date: formatMDY(r.created_at),
          dueISO: r.due_date ? r.due_date.slice(0, 10) : null,
          dateISO: r.created_at ? r.created_at.slice(0, 10) : null,
          doneDisp: formatMDY(r.done_date),
          doneISO: (r.done_date ?? '').slice(0, 10),
          priLabel: '',
          priority: null,
        }))
    }
    return todoData
      .filter((t) => t.done_date && !t.archived_at)
      .map((t) => ({
        id: t.id,
        name: null,
        desc: t.description,
        due: null,
        date: null,
        dueISO: null,
        dateISO: null,
        doneDisp: formatMDY(t.done_date),
        doneISO: (t.done_date ?? '').slice(0, 10),
        priLabel: t.priority ? PRIORITY_LABEL[t.priority] : '',
        priority: t.priority ?? null,
      }))
  }, [currentType, sentData, receivedData, todoData])

  const noun = NOUN[currentType]
  const query = recipientQuery.trim()
  const noFilters = currentType === 'todos' ? beforeDone === '' : query === '' && beforeDone === ''

  // Selection Criteria print line (2026-08-15) — exact wording/format from
  // the owner's own "Archive - ..." xlsx mockups: "Recipient <value or
  // (blank)>     Before Done Date <value or (blank)>" for Sent/Received
  // ("Requestor" in place of "Recipient" for Received, via NOUN — the
  // owner confirmed via AskUserQuestion that the two uploaded xlsx files
  // being byte-identical was a mistaken duplicate, not an intent to use
  // "Recipient" for both), "Before Done Date <value or (blank)>" alone for
  // ToDos, which has no name field to filter by at all.
  const criteriaText =
    currentType === 'todos'
      ? `Before Done Date ${beforeDone ? formatMDY(beforeDone) : '(blank)'}`
      : `${noun} ${query || '(blank)'}     Before Done Date ${beforeDone ? formatMDY(beforeDone) : '(blank)'}`

  const matches = useMemo(() => {
    if (noFilters) return []
    return rows.filter((r) => {
      const matchesName = !noun || query === '' || (r.name ?? '').toLowerCase().includes(query.toLowerCase())
      const matchesDate = beforeDone === '' || r.doneISO < beforeDone
      return matchesName && matchesDate
    })
  }, [rows, noFilters, noun, query, beforeDone])

  // Applies the active Record Type's own sort state on top of the already-
  // filtered matches — a second pass, same reasoning as MainScreen.tsx's own
  // sortedSent/sortedReceived/sortedTodos (filtering and ordering are
  // independent concerns).
  const sortedMatches = useMemo(() => {
    const list = [...matches]
    if (currentType === 'todos') {
      list.sort((a, b) => compareNullable(a.priority, b.priority, todoSort.dir, compareNumbers))
      return list
    }
    const sort = currentType === 'received' ? receivedSort : sentSort
    list.sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return compareNullable(a.name, b.name, sort.dir, compareStrings)
        case 'date':
          return compareNullable(a.dateISO, b.dateISO, sort.dir, compareStrings)
        case 'due':
          return compareNullable(a.dueISO, b.dueISO, sort.dir, compareStrings)
        case 'done':
          return compareNullable(a.doneISO, b.doneISO, sort.dir, compareStrings)
      }
    })
    return list
  }, [matches, currentType, sentSort, receivedSort, todoSort])

  function sortReqColumn(key: ReqSortKey) {
    if (currentType === 'received') {
      setReceivedSort((s) => toggleSort(s, key, REQ_SORT_DEFAULT_DIR))
    } else {
      setSentSort((s) => toggleSort(s, key, REQ_SORT_DEFAULT_DIR))
    }
  }

  function sortTodoColumn(key: TodoSortKey) {
    setTodoSort((s) => toggleSort(s, key, TODO_SORT_DEFAULT_DIR))
  }

  const currentReqSort = currentType === 'received' ? receivedSort : sentSort

  const currentDeselected = deselected[currentType]
  const selectedCount = matches.filter((r) => !currentDeselected.has(r.id)).length

  // Distinct names present in the current Record Type's own (unfiltered)
  // data — same "minimal type-ahead over already-loaded candidate data"
  // approach as the mockup, not the full Contacts table: a Received row's
  // "Requestor" is a sender's profiles.display_name, not a Contact at all.
  const nameOptions = useMemo(() => {
    if (!noun) return []
    const names = new Set(rows.map((r) => r.name).filter((n): n is string => !!n))
    return [...names].sort()
  }, [rows, noun])

  const filteredNameOptions = recipientBrowsing || query === ''
    ? nameOptions
    : nameOptions.filter((n) => n.toLowerCase().includes(query.toLowerCase()))

  // Recipient/Requestor query and Before Done Date deliberately do NOT reset
  // here (2026-08-14, owner: "it would be useful to make entries for
  // contact name (Recipient or Requestor) and the Before Done Date remain
  // until changed within a session of the Archive screen being open
  // regardless of which chip is selected") — a user filtering for a
  // particular contact or cutoff date across Sent/Received/ToDos shouldn't
  // have to re-type either on every chip click; they persist until the user
  // explicitly edits or clears them. confirmMessage/archiveError still
  // reset — those are action feedback tied to whatever was just archived,
  // not a filter, and are stale the moment the list underneath changes.
  function selectType(type: RecordType) {
    setCurrentType(type)
    setConfirmMessage(null)
    setArchiveError(null)
  }

  function toggleChecked(id: string, checked: boolean) {
    setDeselected((prev) => {
      const next = new Set(prev[currentType])
      if (checked) next.delete(id)
      else next.add(id)
      return { ...prev, [currentType]: next }
    })
  }

  async function startPrint() {
    const ids = sortedMatches.map((r) => r.id)
    const detail = currentType === 'received' ? await loadReceivedPrintDetail(ids) : await loadOwnedPrintDetail(ids)
    setPrintDetail(detail)
    setShowPrint(true)
    // See RequestDetailForm.tsx's identical fix (2026-08-15) for the full
    // write-up — printTick guarantees a real dependency change on every
    // click, even when showPrint was already stuck true from a previous
    // print whose 'afterprint' never fired (owner-reported: a second click
    // on the same Print icon did nothing, but worked again after printing
    // from a different screen and back — that navigation remounted this
    // component, resetting showPrint to false, which is what "fixed" it).
    setPrintTick((t) => t + 1)
  }

  useEffect(() => {
    if (printTick === 0) return
    window.print()
    function handleAfterPrint() {
      setShowPrint(false)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [printTick])

  async function handleArchiveSelected() {
    const toArchive = matches.filter((r) => !currentDeselected.has(r.id))
    if (toArchive.length === 0) return // nothing checked — quiet no-op

    setArchiving(true)
    setArchiveError(null)

    const ids = toArchive.map((r) => r.id)
    const nowIso = new Date().toISOString()

    if (currentType === 'received') {
      const results = await Promise.all(
        ids.map((id) => supabase.rpc('archive_received_request', { p_request_id: id }))
      )
      const failed = results.find((r) => r.error)
      if (failed?.error) {
        setArchiving(false)
        setArchiveError(failed.error.message)
        return
      }
      setReceivedData((prev) =>
        prev.map((r) => (ids.includes(r.id) ? { ...r, received_archived_at: nowIso } : r))
      )
    } else {
      const { error: updateError } = await supabase
        .from('requests')
        .update({ archived_at: nowIso })
        .in('id', ids)

      if (updateError) {
        setArchiving(false)
        setArchiveError(updateError.message)
        return
      }
      if (currentType === 'sent') {
        setSentData((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, archived_at: nowIso } : r)))
      } else {
        setTodoData((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, archived_at: nowIso } : r)))
      }
    }

    setDeselected((prev) => {
      const next = new Set(prev[currentType])
      ids.forEach((id) => next.delete(id)) // no longer meaningful once archived
      return { ...prev, [currentType]: next }
    })

    setArchiving(false)
    setConfirmMessage(
      `${toArchive.length} ${toArchive.length === 1 ? 'record' : 'records'} archived. ` +
      'No longer shown here or on the Main Screen — still included when a Search is done.'
    )
  }

  function openDetail(id: string) {
    // Marks this as the one round trip whose filters/selection should
    // survive the remount on the way back — see ARCHIVE_ROUNDTRIP_KEY's
    // own comment above.
    window.sessionStorage.setItem(ARCHIVE_ROUNDTRIP_KEY, '1')
    if (currentType === 'sent') router.push(`/requests/${id}`)
    else if (currentType === 'received') router.push(`/requests/${id}/respond`)
    else router.push(`/todos/${id}`)
  }

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">Loading…</div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Archive"
              onClick={startPrint}
              style={{ marginLeft: 'auto' }}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="17" cy="11" r="1" fill="currentColor" />
              </svg>
            </button>
          }
        />

        <div className="band">
          <span className="glabel">Archive</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={handleArchiveSelected} disabled={archiving}>
              {selectedCount > 0 ? `Archive Selected (${selectedCount})` : 'Archive Selected'}
            </button>
            <button className="btn-secondary" type="button" onClick={() => router.push('/')}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <div className="archtyperow">
            <span className="archtypelabel">Record Type</span>
            <div className="archtypechips">
              <button
                className={`chip${currentType === 'sent' ? ' sel' : ''}`}
                type="button"
                onClick={() => selectType('sent')}
              >
                Sent Requests
              </button>
              <button
                className={`chip${currentType === 'received' ? ' sel' : ''}`}
                type="button"
                onClick={() => selectType('received')}
              >
                Received Requests
              </button>
              <button
                className={`chip${currentType === 'todos' ? ' sel' : ''}`}
                type="button"
                onClick={() => selectType('todos')}
              >
                ToDos
              </button>
            </div>
          </div>

          <p className="archnote">
            <b>
              {currentType === 'todos'
                ? 'Select records to Archive by the Before Done Date.'
                : `Select records to Archive by ${noun} and/or Before Done Date.`}
            </b>{' '}
            You can uncheck any you do not want to Archive. Although Archived records are no longer displayed,
            they are included when a Search is done.
          </p>

          {archiveError && (
            <p className="ferror" role="alert">
              {archiveError}
            </p>
          )}

          <div className="form" style={{ paddingTop: 8 }}>
            {noun && (
              <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className="finput"
                    id="archRecipient"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value)
                      setRecipientBrowsing(false)
                      setShowRecipientResults(true)
                    }}
                    onFocus={(e) => {
                      e.target.select()
                      setRecipientBrowsing(true)
                      setShowRecipientResults(true)
                    }}
                    onBlur={() => setTimeout(() => setShowRecipientResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="archRecipient">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                      </svg>
                    </span>
                    {noun}
                  </label>
                </span>
                {showRecipientResults && (query !== '' || recipientBrowsing) && (
                  <div className="lookup-results" role="listbox">
                    {filteredNameOptions.length === 0 ? (
                      <div className="lookup-empty">No matches</div>
                    ) : (
                      filteredNameOptions.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`lookup-item${n.toLowerCase() === query.toLowerCase() ? ' selected' : ''}`}
                          role="option"
                          aria-selected={n.toLowerCase() === query.toLowerCase()}
                          onMouseDown={() => {
                            setRecipientQuery(n)
                            setShowRecipientResults(false)
                          }}
                        >
                          {n}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              </div>
            )}

            {/* Before Done Date — real .ffloat.picker.native field (the
                mockup's own .plaingroup/.finput.plain substitution was only
                needed there for a Tailwind-preflight reason that doesn't
                apply to this live component, see file header comment).
                Calendar-picker-only: a keydown listener blocks every key but
                Tab, so a value can only ever come from the native picker. */}
            <div className="fgroup">
              <div className="frow">
              <span className="ffloat picker native">
                <input
                  className="finput"
                  id="archBeforeDone"
                  type="date"
                  inputMode="none"
                  autoComplete="off"
                  value={beforeDone}
                  onChange={(e) => setBeforeDone(e.target.value)}
                  onClick={openPicker}
                  onKeyDown={(e) => {
                    if (e.key !== 'Tab') e.preventDefault()
                  }}
                />
                <label className="flabel" htmlFor="archBeforeDone">
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
                  Before Done Date
                </label>
              </span>
              </div>
            </div>
          </div>

          {/* Stray duplicate Print icon removed 2026-08-15 — this band had its
              own leftover `onClick={() => window.print()}` button, never
              wired to startPrint()/showPrint at all. Clicking it opened the
              print dialog while .print-report was never mounted (showPrint
              stayed false) and everything else was hidden by .no-print,
              producing a genuinely blank page — almost certainly the exact
              bug the owner first reported ("the Archive report first
              printed a blank page"). WypHeader's own "Print Archive" icon
              (above, wired to the real startPrint) is the only Print
              control this screen needs; this one was a confusing, broken
              duplicate, not a second intentional entry point. */}
          <div className="band" style={{ marginTop: 0 }}>
            <span className="glabel" style={{ fontSize: 17 }}>{LIST_TITLE[currentType]}</span>
          </div>

          <div style={{ padding: '8px var(--pad) 0' }}>
            <div className="archrow">
              <span className="archspacer" aria-hidden="true" />
              <div className="archbody">
                {currentType === 'todos' ? (
                  <div className="colbar td">
                    <ColSort
                      className="c-pri"
                      label="Priority"
                      active={todoSort.key === 'priority'}
                      dir={todoSort.dir}
                      onClick={() => sortTodoColumn('priority')}
                    />
                    <span>Description</span>
                  </div>
                ) : (
                  <div className="colbar sr">
                    <ColSort
                      className="c-nm"
                      label={COL[currentType] ?? ''}
                      active={currentReqSort.key === 'name'}
                      dir={currentReqSort.dir}
                      onClick={() => sortReqColumn('name')}
                    />
                    <ColSort
                      className="c-dt"
                      label="Date"
                      active={currentReqSort.key === 'date'}
                      dir={currentReqSort.dir}
                      onClick={() => sortReqColumn('date')}
                    />
                    <ColSort
                      className="c-due"
                      label="Due"
                      active={currentReqSort.key === 'due'}
                      dir={currentReqSort.dir}
                      onClick={() => sortReqColumn('due')}
                    />
                    <ColSort
                      className="c-dn"
                      label="Done"
                      active={currentReqSort.key === 'done'}
                      dir={currentReqSort.dir}
                      onClick={() => sortReqColumn('done')}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rows">
            {noFilters && (
              <p className="subempty">
                Enter {currentType === 'todos' ? 'a Before Done Date' : `${noun} and/or a Before Done Date`} above to
                see eligible records.
              </p>
            )}
            {!noFilters && matches.length === 0 && <p className="subempty">No Done records match.</p>}
            {!noFilters &&
              sortedMatches.map((r) => {
                const checked = !currentDeselected.has(r.id)
                return (
                  <div key={r.id} className="row done archrow">
                    <input
                      className="archcheck"
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleChecked(r.id, e.target.checked)}
                    />
                    <div
                      className="archbody"
                      role="button"
                      tabIndex={0}
                      title={`Opens ${DETAIL_LABEL[currentType]}`}
                      onClick={() => openDetail(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openDetail(r.id)
                        }
                      }}
                    >
                      {currentType === 'todos' ? (
                        <>
                          <div className="t1">
                            <span className="tdc">
                              <span className="pri">{r.priLabel}</span> — {r.desc}
                            </span>
                          </div>
                          <div className="t1" style={{ marginTop: 2 }}>
                            <span className="tdc" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                              Done {r.doneDisp}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="r1">
                            <span className="nm">{r.name ?? '—'}</span>
                            <span className="dt">{r.date}</span>
                            <span className="due">{r.due}</span>
                            <span className="dn">{r.doneDisp}</span>
                          </div>
                          <div className="r2">
                            <span className="desc">{r.desc}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>

          {confirmMessage && <div className="archconfirm">{confirmMessage}</div>}
        </div>
      </div>

      {/* Print (2026-08-15) — same .print-report/.prow shape as
          MainScreen.tsx's own Print Reports, plus a checkbox column
          ("insertion of a checkbox in its own narrow column as is done with
          the on-screen view," owner) reusing .archcheck's own styling. Prints
          exactly sortedMatches — the currently visible, filtered-and-sorted
          set for the active Record Type — same "prints what you see"
          principle as every other Print button in the app. Selection
          Criteria line below the title (criteriaText, added same day). No
          own masthead — see the comment above the removed pmast/
          printGeneratedAt state further up this file. */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">{LIST_TITLE[currentType]}</div>
          <div className="pcriteria">
            <b>Selection Criteria:</b> {criteriaText}
          </div>
          {/* Column-header row, added 2026-08-15 — was missing entirely
              (owner-reported: "the Archive reports all do not show the
              column heading"), unlike Main Screen's own Sent/Received/ToDos
              print reports, which this screen's print layout otherwise
              mirrors. Static text with the current sort's arrow, matching
              Main Screen's print pcolbar convention — not interactive
              buttons, since nothing on a printed page can be clicked. */}
          {currentType === 'todos' ? (
            <div className="pcolbar ptdc-nodates">
              <span>Description{todoSort.key === 'priority' ? (todoSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
            </div>
          ) : (
            <div className="pcolbar psr">
              <span className="c-nm">{COL[currentType]}{currentReqSort.key === 'name' ? (currentReqSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              <span className="c-dt">Date{currentReqSort.key === 'date' ? (currentReqSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              <span className="c-due">Due{currentReqSort.key === 'due' ? (currentReqSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
              <span className="c-dn">Done{currentReqSort.key === 'done' ? (currentReqSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
            </div>
          )}
          <div className="prows">
            {sortedMatches.length === 0 && <div className="pempty">No records match.</div>}
            {sortedMatches.map((r) => {
              const checked = !currentDeselected.has(r.id)
              const detail = printDetail[r.id]
              return (
                <div key={r.id} className="prow done archprow">
                  <div className="pr0">
                    <input className="archcheck" type="checkbox" checked={checked} readOnly disabled />
                  </div>
                  <div className="pbody">
                    {currentType === 'todos' ? (
                      <div className="pr2">
                        <span className="pdesc">
                          {r.priLabel ? `${r.priLabel} — ` : ''}
                          {r.desc}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="pr1">
                          <span className="pnm">{r.name ?? '—'}</span>
                          <span className="pdt">{r.date}</span>
                          <span className="pdue">{r.due}</span>
                          <span className="pdn">{r.doneDisp}</span>
                        </div>
                        <div className="pr2">
                          <span className="pdesc">{r.desc}</span>
                        </div>
                      </>
                    )}
                    {detail && <PrintDialogList entries={detail.dialog} />}
                    {detail && (
                      <PrintAttachmentList entries={detail.attachments} heading={currentType === 'todos' ? 'Locations' : 'Attachments'} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
