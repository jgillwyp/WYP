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
 * Print is a plain window.print() (matching the pre-Print-Reports precedent
 * elsewhere in this app) rather than a dedicated print-report layout —
 * Main Screen's own Print Reports feature (2026-08-13) was scoped to Sent/
 * Received/ToDos specifically and was not asked to extend here.
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
const ARCHIVE_TYPE_KEY = 'wyp.archiveType'
const ARCHIVE_QUERY_KEY = 'wyp.archiveRecipientQuery'
const ARCHIVE_BEFORE_KEY = 'wyp.archiveBeforeDone'
const ARCHIVE_DESELECTED_KEY = 'wyp.archiveDeselected'

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

export default function ArchiveForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [sentData, setSentData] = useState<SentCandidate[]>([])
  const [receivedData, setReceivedData] = useState<ReceivedCandidate[]>([])
  const [todoData, setTodoData] = useState<TodoCandidate[]>([])

  const [currentType, setCurrentType] = useState<RecordType>(readStoredType)
  const [recipientQuery, setRecipientQuery] = useState(() => readStoredString(ARCHIVE_QUERY_KEY))
  const [recipientBrowsing, setRecipientBrowsing] = useState(false)
  const [showRecipientResults, setShowRecipientResults] = useState(false)
  const [beforeDone, setBeforeDone] = useState(() => readStoredString(ARCHIVE_BEFORE_KEY))

  const [deselected, setDeselected] = useState<Record<RecordType, Set<string>>>(readStoredDeselected)

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

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)

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
  type Row = {
    id: string
    name: string | null
    desc: string
    due: string | null
    date: string | null
    doneDisp: string
    doneISO: string
    priLabel: string
  }

  const rows: Row[] = useMemo(() => {
    if (currentType === 'sent') {
      return sentData
        .filter((r) => r.done_date && !r.archived_at)
        .map((r) => ({
          id: r.id,
          name: r.contacts?.display_name ?? '—',
          desc: r.description,
          due: formatMDY(r.due_date),
          date: formatMDY(r.created_at),
          doneDisp: formatMDY(r.done_date),
          doneISO: (r.done_date ?? '').slice(0, 10),
          priLabel: '',
        }))
    }
    if (currentType === 'received') {
      return receivedData
        .filter((r) => r.done_date && !r.received_archived_at)
        .map((r) => ({
          id: r.id,
          name: r.owner_name ?? '—',
          desc: r.description,
          due: formatMDY(r.due_date),
          date: formatMDY(r.created_at),
          doneDisp: formatMDY(r.done_date),
          doneISO: (r.done_date ?? '').slice(0, 10),
          priLabel: '',
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
        doneDisp: formatMDY(t.done_date),
        doneISO: (t.done_date ?? '').slice(0, 10),
        priLabel: t.priority ? PRIORITY_LABEL[t.priority] : '',
      }))
  }, [currentType, sentData, receivedData, todoData])

  const noun = NOUN[currentType]
  const query = recipientQuery.trim()
  const noFilters = currentType === 'todos' ? beforeDone === '' : query === '' && beforeDone === ''

  const matches = useMemo(() => {
    if (noFilters) return []
    return rows.filter((r) => {
      const matchesName = !noun || query === '' || (r.name ?? '').toLowerCase().includes(query.toLowerCase())
      const matchesDate = beforeDone === '' || r.doneISO < beforeDone
      return matchesName && matchesDate
    })
  }, [rows, noFilters, noun, query, beforeDone])

  const currentDeselected = deselected[currentType]
  const selectedCount = matches.filter((r) => !currentDeselected.has(r.id)).length

  // Distinct names present in the current Record Type's own (unfiltered)
  // data — same "minimal type-ahead over already-loaded candidate data"
  // approach as the mockup, not the full Contacts table: a Received row's
  // "Requestor" is a sender's profiles.display_name, not a Contact at all.
  const nameOptions = useMemo(() => {
    if (!noun) return []
    const names = new Set(rows.map((r) => r.name).filter((n): n is string => !!n && n !== '—'))
    return [...names].sort()
  }, [rows, noun])

  const filteredNameOptions = recipientBrowsing || query === ''
    ? nameOptions
    : nameOptions.filter((n) => n.toLowerCase().includes(query.toLowerCase()))

  function selectType(type: RecordType) {
    setCurrentType(type)
    setRecipientQuery('')
    setBeforeDone('')
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
      <div className="app">
        <WypHeader />

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
            <span className="archtypelabel">Record Type:</span>
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

          <div className="band" style={{ marginTop: 0 }}>
            <span className="glabel" style={{ fontSize: 17 }}>{LIST_TITLE[currentType]}</span>
            <span className="bandcluster">
              <button className="iconbtn" type="button" aria-label="Print" onClick={() => window.print()}>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </button>
            </span>
          </div>

          <div style={{ padding: '8px var(--pad) 0' }}>
            <div className="archrow">
              <span className="archspacer" aria-hidden="true" />
              <div className="archbody">
                {currentType === 'todos' ? (
                  <div className="colbar td">
                    <span className="pill">Priority ▲</span>
                    <span>Description</span>
                  </div>
                ) : (
                  <div className="colbar sr">
                    <span>{COL[currentType]}</span>
                    <span className="c-dt">Date</span>
                    <span className="c-due pill">Due ▼</span>
                    <span className="c-dn">Done</span>
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
              matches.map((r) => {
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
                            <span className="nm">{r.name}</span>
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
    </div>
  )
}
