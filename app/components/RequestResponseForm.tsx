'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Request Response (§9.3) — converted from
 * design/screens/WYP_respond_to_request_palette1.html. This is the ONE
 * screen in the app an anonymous, unauthenticated visitor reaches: the
 * recipient of a Request, following the secure link mailed/texted to them.
 * No `RequireAuth` wrapper — see app/r/[token]/page.tsx.
 *
 * All data in and out goes through the three `SECURITY DEFINER` functions
 * from migrations 008/009 — never a raw `select`/`update`/`insert` on
 * `requests`/`dialog`, since there is deliberately no `anon` policy on
 * those tables (CLAUDE.md's Database section: "a client-supplied WHERE
 * clause is not a permission check"):
 *   - get_request_by_token   — read (multi-use, logs an 'events' row every call)
 *   - set_response_done_by_token — write Done Date/Done Time
 *   - add_dialog_by_token    — write a Dialog entry, `who` resolved server-side
 *     from the Request's own Contact, never supplied by the client. Recipient
 *     name collection was explicitly rejected — "the response needs to be as
 *     frictionless as possible" — so there is nothing to ask for up front.
 *
 * Category is never fetched or rendered anywhere on this screen — PRD §2.3:
 * Category is a sender-side-only organizing label, never shown to the
 * recipient. migration 009 exists specifically because an earlier draft of
 * get_request_by_token violated this by including category_name; caught and
 * corrected before that migration was ever run.
 *
 * Done Date/Done Time are optional here (no required-field validation blocks
 * Send) even though Request Detail's own .req styling treats them as
 * required in some states — the mockup's static "req" borders describe a
 * demo snapshot, not a universal rule, and an anonymous recipient should
 * always be able to respond with Dialog alone.
 */

type Kind = 'question' | 'answer' | 'comment'

type DialogEntry = {
  id: number
  kind: Kind
  body: string
  who: string
  created_at: string
  replies_to_id: number | null
}

type ResponsePayload = {
  id: string
  description: string
  created_at: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  done_time: string | null
  owner_name: string | null
  owner_tier: 'free' | 'subscriber' | null
  contact_name: string | null
  dialog: DialogEntry[]
}

function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

// due_date/done_date come back as plain "YYYY-MM-DD" — build the Date from
// its own Y/M/D components rather than passing the string straight to
// `new Date(...)`, which parses date-only strings as UTC midnight and can
// display a day early in negative-UTC-offset time zones.
function formatLongDate(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// created_at is a real timestamptz — `new Date(iso)` is correct here,
// unlike the date-only fields above.
function formatLongDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime12h(value: string | null): string {
  if (!value) return ''
  const [hStr, mStr] = value.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${ampm}`
}

// Local calendar date as "YYYY-MM-DD", matching the native date input's own
// value format — built from Y/M/D components (not toISOString(), which is
// UTC and can land on the wrong day near midnight in most US time zones).
function todayISODate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Owner's ask, 2026-08-10: "Add to Calendar" downloads a real .ics for the
// Request's Due Date/Time, generated entirely client-side — every field it
// needs (Description, owner name, Due Date/Time, and the response link,
// which is just this page's own URL) is already loaded, so there's no
// server round trip to add.
//
// No stored Due Time defaults to 9:00 AM. Owner: "we can use 9am as a
// standard - probably later offer an Account profile for default time of
// day" — flagged, not built; profiles has no such column or UI yet.
const ICS_DEFAULT_DUE_TIME = '09:00'
const ICS_DURATION_MINUTES = 30

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// DTSTAMP is always UTC per RFC 5545.
function formatIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  )
}

// DTSTART/DTEND use "floating" local time (no trailing Z, no TZID) — the
// Request has no stored time zone of its own, so the calendar app importing
// the file interprets the time in whatever zone the recipient is actually
// in, which is the closest match to "9am, wherever you are" without a real
// TZID to offer.
function formatIcsLocal(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

// RFC 5545 §3.3.11 TEXT escaping — backslash first, so the escapes just
// added for the other characters don't get re-escaped.
function icsEscapeText(s: string): string {
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
function foldIcsLine(line: string): string {
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
// nonsensical — matches the on-screen From: row's own '—' treatment in
// spirit, without literally printing an em dash into a sentence.
function buildIcsDescription(ownerName: string | null, description: string, link: string): string {
  const from = ownerName ? `A Would You Please Request from ${ownerName}: ` : 'A Would You Please Request: '
  return `${from}${description} To mark it completed, click: ${link}`
}

function buildIcsContent(payload: ResponsePayload, link: string): string {
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

export default function RequestResponseForm() {
  const params = useParams<{ token: string }>()
  const token = params.token

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<ResponsePayload | null>(null)

  const [doneDate, setDoneDate] = useState('')
  const [doneTime, setDoneTime] = useState('')
  const [savedDoneDate, setSavedDoneDate] = useState('')
  const [savedDoneTime, setSavedDoneTime] = useState('')

  const [dialogList, setDialogList] = useState<DialogEntry[]>([])

  const [dialogModalOpen, setDialogModalOpen] = useState(false)
  const [dialogModalKind, setDialogModalKind] = useState<Kind>('question')
  const [dialogModalBody, setDialogModalBody] = useState('')
  const [dialogModalError, setDialogModalError] = useState<string | null>(null)
  const [dialogSelectedQuestionId, setDialogSelectedQuestionId] = useState<number | null>(null)
  const [dialogSaving, setDialogSaving] = useState(false)
  const dialogTextRef = useRef<HTMLTextAreaElement>(null)
  const doneDateRef = useRef<HTMLInputElement>(null)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendConfirmed, setSendConfirmed] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_request_by_token', {
        p_token: token,
      })

      if (cancelled) return

      if (rpcError || !rpcData) {
        // get_request_by_token returns one generic message for every failure
        // (not found / expired / revoked) so a bad guess can't be
        // distinguished from an expired link — shown to the visitor as-is.
        setLoadError(rpcError?.message ?? 'This link is no longer valid.')
        setLoading(false)
        return
      }

      const payload = rpcData as ResponsePayload
      setData(payload)
      setDoneDate(payload.done_date ?? '')
      setDoneTime(payload.done_time ?? '')
      setSavedDoneDate(payload.done_date ?? '')
      setSavedDoneTime(payload.done_time ?? '')
      setDialogList(payload.dialog ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token])

  const openQuestions = useMemo(() => {
    const answered = new Set<number>()
    for (const e of dialogList) {
      if (e.kind === 'answer' && e.replies_to_id != null) answered.add(e.replies_to_id)
    }
    return dialogList.filter((e) => e.kind === 'question' && !answered.has(e.id))
  }, [dialogList])

  const sortedDialog = useMemo(
    () => dialogList.slice().sort((a, b) => b.id - a.id),
    [dialogList]
  )

  function questionById(id: number): DialogEntry | undefined {
    return dialogList.find((e) => e.id === id)
  }

  // Owner-reported (2026-08-10): opening Add Dialog always defaulted to the
  // Question chip, even when every existing entry was itself an unanswered
  // Question — "it seems more appropriate to show the Answer chip as
  // selected if there are any questions in the dialog which have not been
  // answered yet." selectKind('answer') already knows how to pick the right
  // Question (or show the picker for more than one); this just changes
  // which chip starts selected.
  function openDialogModal() {
    setDialogModalBody('')
    setDialogModalError(null)
    selectKind(openQuestions.length > 0 ? 'answer' : 'question')
    setDialogModalOpen(true)
  }

  function selectKind(kind: Kind) {
    if (kind === 'answer' && openQuestions.length === 0) return
    setDialogModalKind(kind)
    if (kind === 'answer' && openQuestions.length > 1) {
      setDialogSelectedQuestionId(openQuestions[openQuestions.length - 1].id)
    } else if (kind === 'answer' && openQuestions.length === 1) {
      setDialogSelectedQuestionId(openQuestions[0].id)
    } else {
      setDialogSelectedQuestionId(null)
    }
    // Owner-reported (2026-08-10): the default chip on open gets focus in
    // Dialog Text (the textarea's own `autoFocus`), but clicking a
    // different chip afterward didn't move focus there too — `autoFocus`
    // only fires on mount, not on every re-render. This call is a no-op
    // during openDialogModal's own selectKind call (the textarea hasn't
    // mounted yet at that point, so the ref is still null and `autoFocus`
    // handles that case as before); it only does something on a later,
    // in-modal chip click, which is exactly the case that needed it.
    dialogTextRef.current?.focus()
  }

  async function handleDialogModalSave() {
    const body = dialogModalBody.trim()
    if (body === '') {
      // Owner-reported, 2026-08-10: after this error, the Dialog Text field
      // showed its full-size placeholder with no focus rather than the
      // usual floated-label/focused state — same underlying focus-
      // management gap as the chip-switch fix above, just on a different
      // trigger (Save-with-empty-body instead of a chip click).
      setDialogModalError('Enter Dialog Text or Cancel.')
      dialogTextRef.current?.focus()
      return
    }

    setDialogSaving(true)
    const { data: rpcData, error: rpcError } = await supabase.rpc('add_dialog_by_token', {
      p_token: token,
      p_kind: dialogModalKind,
      p_body: body,
      p_replies_to_id: dialogModalKind === 'answer' ? dialogSelectedQuestionId : null,
    })
    setDialogSaving(false)

    if (rpcError || !rpcData) {
      setDialogModalError(rpcError?.message ?? 'Could not save this Dialog entry.')
      return
    }

    // Append the RPC's returned {id, created_at, who} locally rather than
    // re-running get_request_by_token — a re-fetch here would log a second,
    // semantically wrong 'viewed' event for what was actually a write.
    const returned = rpcData as { id: number; created_at: string; who: string }
    setDialogList((list) => [
      ...list,
      {
        id: returned.id,
        kind: dialogModalKind,
        body,
        who: returned.who,
        created_at: returned.created_at,
        replies_to_id: dialogModalKind === 'answer' ? dialogSelectedQuestionId : null,
      },
    ])
    setDialogModalOpen(false)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setSendError(null)
    setSendConfirmed(false)
    setSending(true)

    const { error: rpcError } = await supabase.rpc('set_response_done_by_token', {
      p_token: token,
      p_done_date: doneDate.trim() === '' ? null : doneDate,
      p_done_time: doneTime.trim() === '' ? null : doneTime,
    })

    setSending(false)

    if (rpcError) {
      setSendError(rpcError.message)
      return
    }

    setSavedDoneDate(doneDate)
    setSavedDoneTime(doneTime)
    setSendConfirmed(true)
  }

  // Owner's ask (2026-08-10): mark a Request Done in as few keystrokes as
  // possible, without forcing Done/Add Dialog/Add Attachment into a
  // mutually-exclusive choice (a recipient may want more than one). Sets
  // Done Date only — Done Time stays untouched, same "optional refinement,
  // not required" role it has everywhere else in the app. Purely a local
  // field fill; Send is still the actual write (set_response_done_by_token).
  // Owner's own flagged concern, 2026-08-10, resolved as he suggested: moving
  // Add to Calendar above the Date/From/Due block (below) pushes Done
  // Date/Done Time further down the screen, so scroll the just-filled Done
  // Date field into view rather than leaving it stranded below the fold.
  function handleQuickDone() {
    setDoneDate(todayISODate())
    doneDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Owner's ask, 2026-08-10 — see buildIcsContent above for the field
  // mapping and the boilerplate-text flag. The link is just this page's own
  // URL (the /r/[token] the recipient is already looking at), so there's
  // nothing to fetch — the whole file is built and downloaded locally.
  function handleAddToCalendar() {
    if (!data) return
    const link = window.location.href
    const content = buildIcsContent(data, link)
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'would-you-please-request.ics'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Discards in-progress edits back to the last successfully loaded/saved
  // values. Not router.back() — every other Detail screen's Cancel returns
  // to the Main Screen history entry it was reached from, but an anonymous
  // visitor arriving via a mailed/texted link typically has no such prior
  // in-app entry to return to.
  function handleCancel() {
    setDoneDate(savedDoneDate)
    setDoneTime(savedDoneTime)
    setSendError(null)
    setSendConfirmed(false)
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

  if (loadError || !data) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError ?? 'This link is no longer valid.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Request"
              onClick={() => window.print()}
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
          <span className="glabel">Request Response</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="request-response-form" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={sending}>
              Cancel
            </button>
          </span>
        </div>

        {sendConfirmed && <div className="noticeband"><b>Response saved.</b> Your update has been recorded.</div>}

        <div className="scroll">
          <form id="request-response-form" onSubmit={handleSend} noValidate>

            {/* Owner-reported, 2026-08-10, testing live on a narrow Android
                phone: pairing the Date/From/Due column with Add to Calendar
                beside it squeezed the column enough that "Monday, August 10,"
                wrapped before the year, and left unused space under the
                button and to the right of From/Due. Moved the button to its
                own row above (.panelact, the same pattern already used for
                Add Dialog/Add Attachment on this screen) so Date/From/Due get
                the full row width instead — chosen over reformatting the date
                string itself, which is the identical verbose weekday format
                used across Request Detail/ToDo Detail/Response Detail/Dialog
                Detail's own label:value date displays and would go out of
                step with those screens for a problem this layout change
                already solves. Costs one extra row of vertical space, same
                trade-off §6.26 already made. */}
            <div className="panelact panelact-top">
              {/* Was deliberately inert (Days 2-3 covered response
                  read/write only); .ics generation built 2026-08-10 — see
                  buildIcsContent/handleAddToCalendar above. */}
              <button className="btn" type="button" onClick={handleAddToCalendar}>
                Add to Calendar
              </button>
            </div>
            <div className="meta">
              <div className="metarow"><span className="mlabel">Date:</span><span className="mval">{formatLongDateTime(data.created_at)}</span></div>
              <div className="metarow"><span className="mlabel">From:</span><span className="mval">{data.owner_name ?? '—'}</span></div>
              <div className="metarow">
                <span className="mlabel">Due:</span>
                <span className="mval">
                  {data.due_date ? formatLongDate(data.due_date) : '—'}
                  {data.due_time && <>&nbsp;&nbsp;{formatTime12h(data.due_time)}</>}
                </span>
              </div>
            </div>

            <div className="seclabel">Request Description</div>
            <div className="respdesc">{data.description}</div>

            <div className="grabber" aria-hidden="true"></div>

            {/* Editable Done Date/Done Time — not the mockup's boxed .duo/
                .fieldval static display (that's a read-only preview state;
                the mockup's own comment flags its .panel.req border rule as
                an unresolved "should be conditional... not permanent"
                question). Reuses Request Detail's exact
                .fgroup.frow + .ffloat.picker.native editable markup instead,
                already proven there. */}
            {/* Quick-Done band (§6.31, PROPOSED, 2026-08-10) — owner's ask:
                mark a Request Done in as few keystrokes as possible. Not a
                Done/Add-Dialog/Add-Attachment chip picker (rejected: those
                aren't mutually exclusive — a recipient may want more than
                one). Not an auto-filled Done Date on page load either
                (rejected: forces anyone who only wants to add Dialog to
                first clear it). Purely reactive to whether Done Date already
                holds a value, however it got there — clicking Done here, or
                typing directly into the field below both land in the same
                state, so there's no separate "did they click Done" flag to
                get out of sync. */}
            <div className="donerow">
              <span className="donenote">
                {doneDate.trim() === '' ? (
                  <><b>Note:</b> For a quick response, click Done and Send.</>
                ) : (
                  'This Request is now marked as Done, just click Send.'
                )}
              </span>
              <button
                className="btn"
                type="button"
                onClick={handleQuickDone}
                disabled={doneDate.trim() !== ''}
              >
                Done
              </button>
            </div>

            {/* This screen has no shared .form wrapper (matching the mockup's
                own flat, per-block-padded .scroll children) — pad this one
                editable row directly with --pad, same as every sibling block
                below (.meta/.seclabel/.respdesc/.panelact/.panelfull/.promo
                all carry their own var(--pad) the same way). */}
            <div className="fgroup frow" style={{ padding: '0 var(--pad)' }}>
              <span className="ffloat picker native">
                <input
                  ref={doneDateRef}
                  className={`finput${doneDate.trim() === '' ? ' opt' : ''}`}
                  id="dnd"
                  type="date"
                  value={doneDate}
                  onChange={(e) => setDoneDate(e.target.value)}
                />
                <label className="flabel" htmlFor="dnd">
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
                  Done Date <span className="subnote">(optional)</span>
                </label>
              </span>
              <span className="ffloat picker native">
                <input
                  className={`finput${doneTime.trim() === '' ? ' opt' : ''}`}
                  id="dnt"
                  type="time"
                  value={doneTime}
                  onChange={(e) => setDoneTime(e.target.value)}
                />
                <label className="flabel" htmlFor="dnt">
                  <span className="lglyph" aria-hidden="true">
                    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="24" cy="24" r="17" fill="none" stroke="#5A6675" strokeWidth="3.5" />
                      <line x1="24" y1="24" x2="24" y2="13" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                      <line x1="24" y1="24" x2="32" y2="28" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  Done Time <span className="subnote">(optional)</span>
                </label>
              </span>
            </div>

            <div className="panelact">
              <button className="btn" type="button" onClick={openDialogModal}>
                Add Dialog
              </button>
            </div>
            <div className="panelfull">
              <div className="panel">
                <div className="panelhead">Dialog (Questions, Answers, Comments)</div>
                {sortedDialog.length === 0 && (
                  <div className="dlg" style={{ color: 'var(--ink-soft)' }}>No Dialog entries yet.</div>
                )}
                {sortedDialog.map((e) => {
                  const kindLabel = e.kind === 'question' ? 'Question' : e.kind === 'answer' ? 'Answer' : 'Comment'
                  const q = e.kind === 'answer' && e.replies_to_id != null ? questionById(e.replies_to_id) : null
                  return (
                    <div className="dlg" key={e.id}>
                      <span className="dlgdate">{formatMDY(e.created_at)}</span>{' '}
                      <span className="dlgkind">{kindLabel}</span> <span className="dlgwho">({e.who})</span>
                      {e.kind === 'answer' ? (
                        <>
                          {q && <span className="dlgre">Re: {truncate(q.body)}</span>}
                          <span className="dlgbody">{e.body}</span>
                        </>
                      ) : (
                        <> {e.body}</>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Owner's ask (2026-08-10): don't show a locked, non-usable
                Attachments segment when the Request's issuer is a free
                user — a free-tier promo hits the recipient elsewhere on
                this screen already (the Free Account Features block below),
                and this panel offers no path to act on it either way.
                Reads owner_tier (migration 011) rather than assuming.
                For a subscriber-issued Request, the segment stays visible —
                but real attachment storage/upload doesn't exist anywhere in
                this app yet (still deferred per CLAUDE.md's Scope
                discipline, true on every screen including the issuer's own
                Request Detail), so the copy is changed to a plain "not
                built yet" note rather than the free-tier upsell wording,
                which would be wrong once the issuer already IS a
                subscriber. Add Attachment stays locked either way, since
                there's genuinely nothing behind it yet — flagged rather
                than faked as usable. */}
            {data.owner_tier === 'subscriber' && (
              <>
                <div className="panelact">
                  <button className="btn is-locked" type="button" aria-disabled="true">
                    <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                      <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    Add Attachment
                  </button>
                </div>
                <div className="panelfull">
                  <div className="attachpanel">
                    <span className="plabel">Attachments</span>
                    <div className="locked">
                      <svg className="lock" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <span className="lockttl">No attachments yet</span>
                      <span className="locknote">
                        Attachment upload isn&rsquo;t available in this preview yet.
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Owner-reported, 2026-08-10: dropped the "Free Account
                Features" kicker line — the button's own label already says
                "Free Account", so it was redundant, and removing it
                shortens this block by a line. Also moved the button above
                the descriptive sentence: with the sentence first, it read
                as something to read before clicking, which isn't the
                intent. */}
            <div className="promo">
              <div className="promo-h">Send it, Track it, Get it Done</div>
              <Link href="/login" className="btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Create your own Free Account
              </Link>
              <p className="promo-p">The simple way to ask anyone for anything, and actually see it through.</p>
            </div>

            {sendError && (
              <p className="ferror" role="alert" style={{ margin: '0 var(--pad) 12px' }}>
                {sendError}
              </p>
            )}
          </form>
        </div>

        <div className="subbanner" role="button" tabIndex={0}>
          See Subscription Features and Other Options
        </div>
        <div className="adslot" aria-hidden="true">
          <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
        </div>

        {dialogModalOpen && (
          <>
            <div className="scrim" onClick={() => setDialogModalOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="adddlg-title">
              <div className="modalhead">
                <p className="modal-title" id="adddlg-title">
                  Add Dialog
                </p>
                <div className="modalacts">
                  <button className="btn-secondary" type="button" onClick={() => setDialogModalOpen(false)} disabled={dialogSaving}>
                    Cancel
                  </button>
                  <button className="btn" type="button" onClick={handleDialogModalSave} disabled={dialogSaving}>
                    {dialogSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="fgroup">
                <span className="flabel" id="dlgkind-label">
                  Dialog Entry Type
                </span>
                <div className="chiprow" role="radiogroup" aria-labelledby="dlgkind-label">
                  <button
                    className={`chip${dialogModalKind === 'question' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={dialogModalKind === 'question'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectKind('question')}
                  >
                    Question
                  </button>
                  <button
                    className={`chip${dialogModalKind === 'answer' ? ' selected' : ''}${openQuestions.length === 0 ? ' is-locked' : ''}`}
                    type="button"
                    aria-pressed={dialogModalKind === 'answer'}
                    aria-disabled={openQuestions.length === 0}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectKind('answer')}
                  >
                    Answer
                  </button>
                  <button
                    className={`chip${dialogModalKind === 'comment' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={dialogModalKind === 'comment'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectKind('comment')}
                  >
                    Comment
                  </button>
                </div>
              </div>

              {/* Owner-reported (2026-08-10): after answering one of two
                  open Questions, reopening Add Dialog and picking Answer
                  showed nothing — the remaining single open Question was
                  linked silently, with no visual confirmation of which one.
                  Originally scoped (2026-08-07) to show only when more than
                  one Question was open; relaxed to any open Question (>0),
                  so composing an Answer always confirms what it's answering.
                  Follow-up (same day): with exactly one open Question, its
                  row already renders .selected — but that's the identical
                  visual treatment a multi-row picker uses for "the one
                  you've clicked," so a person could read it as needing a
                  click. The .subnote "(The only question is selected
                  below.)" only appears in the single-question case, where
                  it's true and disambiguating; it would be redundant noise
                  once there's an actual choice to make. */}
              {dialogModalKind === 'answer' && openQuestions.length > 0 && (
                <div>
                  <span className="flabel">
                    Which Question?
                    {openQuestions.length === 1 && (
                      <span className="subnote"> (The only question is selected below.)</span>
                    )}
                  </span>
                  <div className="qpicker" role="radiogroup" aria-label="Which Question this Answer responds to">
                    {openQuestions.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className={`lookup-item${dialogSelectedQuestionId === q.id ? ' selected' : ''}`}
                        role="radio"
                        aria-checked={dialogSelectedQuestionId === q.id}
                        onClick={() => setDialogSelectedQuestionId(q.id)}
                      >
                        <span className="dlgwho">({q.who})</span> {truncate(q.body)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={`fgroup ffloat${dialogModalError ? ' is-invalid' : ''}`}>
                <textarea
                  ref={dialogTextRef}
                  className="ftextarea"
                  id="dlgtext"
                  maxLength={1000}
                  placeholder=" "
                  value={dialogModalBody}
                  onChange={(e) => {
                    setDialogModalBody(e.target.value)
                    if (dialogModalError) setDialogModalError(null)
                  }}
                  autoFocus
                />
                <label className="flabel" htmlFor="dlgtext">
                  Dialog Text
                </label>
              </div>
              {dialogModalError && <p className="ferror" style={{ marginTop: -8 }}>{dialogModalError}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
