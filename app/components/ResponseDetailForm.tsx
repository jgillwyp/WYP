'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { buildIcsContent, todayISODate, truncate } from '@/lib/ics'

/**
 * Response Detail (§6.28) — converted from
 * design/screens/WYP_response_detail_palette1.html, 2026-08-11. The
 * signed-in equivalent of Request Response (RequestResponseForm.tsx): a
 * recipient who already has a Would You Please account, viewing/continuing
 * a Request someone else sent them from inside the app, at
 * /requests/[id]/respond — reached by clicking a row in Main Screen's now-
 * live Received section (migration 012).
 *
 * All data in and out goes through the four `SECURITY DEFINER` functions
 * from migration 012 — never a raw select/update/insert on requests/dialog,
 * mirroring the reasoning CLAUDE.md's Database section already gives for
 * the anonymous /r/[token] path (migrations 008/009/010), extended here to
 * the signed-in case for the same reason: a plain owner-scoped or
 * RLS-policy-based approach can't hide Category from an otherwise-visible
 * row (RLS is row-level, not column-level), so a function allow-lists
 * exactly what a recipient may read or write instead:
 *   - get_received_request        — read, verifies the caller's own session
 *     email against the linked Contact's email before returning anything;
 *     logs an 'events' row every call (multi-use, mirrors the token path)
 *   - set_response_done_as_recipient — write Done Date/Done Time
 *   - add_dialog_as_recipient     — write a Dialog entry. Unlike the token
 *     path, `who` is the caller's OWN profile display_name (falling back to
 *     their session email) — this is a real signed-in person, not an
 *     anonymous visitor with no account to draw a name from.
 *
 * Category is never fetched or rendered here — same PRD §2.3 rule as
 * Request Response, enforced inside get_received_request itself.
 *
 * Diverges from RequestResponseForm.tsx in three deliberate ways:
 *   1. No "Create your own Free Account" promo block — this visitor already
 *      has an account. (Matches the mockup's own header comment: "the
 *      .promo block from Respond to Request is dropped... whoever's
 *      looking at this screen already has an account.")
 *   2. Cancel uses router.back(), not a local-state reset — unlike an
 *      anonymous /r/[token] visitor (who has no prior in-app history entry
 *      to return to), this screen is only ever reached by clicking a row on
 *      Main Screen, same as every other signed-in Detail screen
 *      (Request Detail, ToDo Detail, Contact Detail all use router.back()
 *      for the identical reason).
 *   3. The quick-Done band (§6.31) and owner_tier-gated Attachments segment
 *      — both built for Request Response on 2026-08-10 — are included here
 *      too, even though the static mockup file predates both and hasn't
 *      been updated to show them (same situation Create ToDo's mockup was
 *      in before it caught up). Flagged in design/README.md, not silently
 *      diverged from without a trace.
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

type ReceivedDetailPayload = {
  id: string
  description: string
  created_at: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  done_time: string | null
  owner_name: string | null
  owner_tier: 'free' | 'subscriber' | null
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

export default function ResponseDetailForm() {
  const params = useParams<{ id: string }>()
  const requestId = params.id
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<ReceivedDetailPayload | null>(null)

  // No savedDoneDate/savedDoneTime pair here, unlike RequestResponseForm.tsx
  // — that screen's Cancel resets in-place to the last-saved values because
  // an anonymous visitor has nothing to navigate back to; this screen's
  // Cancel uses router.back() instead (file header comment, point 2), so
  // there's nothing that needs remembering.
  const [doneDate, setDoneDate] = useState('')
  const [doneTime, setDoneTime] = useState('')

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
    if (!requestId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_received_request', {
        p_request_id: requestId,
      })

      if (cancelled) return

      if (rpcError || !rpcData) {
        // Same generic failure message whether the id is wrong or just not
        // this signed-in user's to see — matches get_request_by_token's own
        // "don't distinguish not-found from not-yours" shape.
        setLoadError(rpcError?.message ?? 'Request not found.')
        setLoading(false)
        return
      }

      const payload = rpcData as ReceivedDetailPayload
      setData(payload)
      setDoneDate(payload.done_date ?? '')
      setDoneTime(payload.done_time ?? '')
      setDialogList(payload.dialog ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [requestId])

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

  // Same defaulting/focus rules as Request Response's identical function —
  // see that file's own comment.
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
    dialogTextRef.current?.focus()
  }

  async function handleDialogModalSave() {
    const body = dialogModalBody.trim()
    if (body === '') {
      setDialogModalError('Enter Dialog Text or Cancel.')
      dialogTextRef.current?.focus()
      return
    }

    setDialogSaving(true)
    const { data: rpcData, error: rpcError } = await supabase.rpc('add_dialog_as_recipient', {
      p_request_id: requestId,
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
    // re-running get_received_request — a re-fetch here would log a second,
    // semantically wrong 'viewed_by_recipient' event for what was actually
    // a write.
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

    const { error: rpcError } = await supabase.rpc('set_response_done_as_recipient', {
      p_request_id: requestId,
      p_done_date: doneDate.trim() === '' ? null : doneDate,
      p_done_time: doneTime.trim() === '' ? null : doneTime,
    })

    setSending(false)

    if (rpcError) {
      setSendError(rpcError.message)
      return
    }

    setSendConfirmed(true)
  }

  // Same quick-Done band as Request Response (§6.31, built 2026-08-10) —
  // fills Done Date with today only, Done Time stays untouched, purely a
  // local field fill (Send/set_response_done_as_recipient is still the
  // actual write).
  function handleQuickDone() {
    setDoneDate(todayISODate())
    doneDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Link is this page's own URL — a signed-in user re-opening this same
  // /requests/[id]/respond page later still lands on the same event, unlike
  // the token path's one-time-mailed link, but it's the closest equivalent
  // available and matches what Request Response already does.
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

  // router.back(), not a local-state reset — see file header comment
  // point 2. Restores Main Screen's Received row and scroll position, same
  // as Request Detail/ToDo Detail/Contact Detail's own Cancel/Close.
  function handleCancel() {
    router.back()
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
          <div className="subempty">{loadError ?? 'Request not found.'}</div>
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
          <span className="glabel">Response Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="response-detail-form" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={sending}>
              Cancel
            </button>
          </span>
        </div>

        {sendConfirmed && <div className="noticeband"><b>Response saved.</b> Your update has been recorded.</div>}

        <div className="scroll">
          <form id="response-detail-form" onSubmit={handleSend} noValidate>

            <div className="panelact panelact-top">
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

            {/* owner_tier gating unchanged — simplified empty-state row
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
