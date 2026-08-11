'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { buildIcsContent, todayISODate, truncate } from '@/lib/ics'

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

// todayISODate, truncate, and the full .ics builder (buildIcsContent et al.,
// including ICS_DEFAULT_DUE_TIME/ICS_DURATION_MINUTES) moved to
// app/src/lib/ics.ts, 2026-08-11 — see that file's own header comment for
// why this earned an exception to the app's usual no-shared-lib convention
// (ResponseDetailForm.tsx needed the identical logic verbatim).

// Desktop browsers only open a date/time input's native picker when the
// calendar/clock icon itself is clicked — unlike mobile, where tapping
// anywhere in the field does. Hand-typing a value isn't a supported way to
// fill these fields (§6.16's label-affordance glyph signals "focus opens a
// picker," not "type here"), so a click anywhere in the field should open
// the picker on desktop too, not just the icon. Owner-reported 2026-08-11.
// showPicker() needs a user gesture and isn't implemented pre-16.4 Safari —
// feature-detected and swallowed; the icon still works as a fallback either
// way. Duplicated per component (short helper, same convention as
// todayISODate/formatMDY) rather than extracted to a shared lib file.
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker()
    } catch {
      // ignore — calendar/clock icon still opens it
    }
  }
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
                  onClick={openPicker}
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
                  onClick={openPicker}
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

            {/* Simplified empty-state row (§6.32, 2026-08-11): with no
                entries, a single .frow — .actlabel + Add Dialog — replaces
                the old always-shown .panelfull/.panel with its "No Dialog
                entries yet." placeholder text. No .form/.fgroup wrapper on
                this screen, so the empty row needs its own var(--pad),
                matching .panelact's own convention. */}
            {sortedDialog.length === 0 ? (
              <div className="frow" style={{ padding: '0 var(--pad)', marginBottom: 12 }}>
                <span className="actlabel">Questions, Answers, Comments</span>
                <button className="btn" type="button" onClick={openDialogModal}>
                  Add Dialog
                </button>
              </div>
            ) : (
              <>
                <div className="panelact">
                  <button className="btn" type="button" onClick={openDialogModal}>
                    Add Dialog
                  </button>
                </div>
                <div className="panelfull">
                  <div className="panel">
                    <div className="panelhead">Dialog (Questions, Answers, Comments)</div>
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
              </>
            )}

            {/* Owner's ask (2026-08-10): don't show a locked, non-usable
                Attachments segment when the Request's issuer is a free
                user — a free-tier promo hits the recipient elsewhere on
                this screen already (the Free Account Features block below),
                and this panel offers no path to act on it either way.
                Reads owner_tier (migration 011) rather than assuming.
                Gating unchanged 2026-08-11 — simplified empty-state row
                (§6.32) inside it, replacing the old .panelact+.panelfull:
                attachment storage doesn't exist anywhere in the app yet, so
                there's no populated state to revert to. */}
            {data.owner_tier === 'subscriber' && (
              <div className="frow" style={{ padding: '0 var(--pad)', marginBottom: 12 }}>
                <span className="actlabel locked">Subscription feature</span>
                <button className="btn is-locked" type="button" aria-disabled="true">
                  <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                    <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                  Add Attachment
                </button>
              </div>
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
