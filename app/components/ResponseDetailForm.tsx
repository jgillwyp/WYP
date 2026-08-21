'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AttachmentsPanel from './AttachmentsPanel'
import { supabase } from '@/lib/supabaseClient'
import { buildIcsContent, cameFromCalendarLink, todayISODate, truncate } from '@/lib/ics'
import { isReminderEligible } from '@/lib/email'
import { type RepeatRule, describeRepeat } from '@/lib/repeatRule'

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
 *
 * Reminders until Done banner (§6.41 PROPOSED, migration 037, 2026-08-20) —
 * see RequestDetailForm.tsx's identical file-header paragraph for the full
 * reasoning. Same two-checkbox banner here, recipient-facing: "Morning
 * before" (reminder_enabled) and "Daily thereafter" (overdue_reminder_
 * enabled, the Overdue-notification opt-out — unchecking it stops this
 * recipient's Overdue emails entirely, confirmed with the owner). "Morning
 * before" is greyed out once reminder_sent_at is set, on top of the
 * existing eligibility checks.
 */

type Kind = 'question' | 'answer' | 'comment'

// See CreateRequestForm.tsx's identical constant for the full reasoning
// (globals.css's ftextarea-plain/.charcount comment; owner request
// 2026-08-16).
const DIALOG_MAX = 500

// Voice dictation for Dialog Text (2026-08-20) — same Web-Speech-API
// pattern as CreateRequestForm.tsx's own Description dictation, extended
// here per the owner's request. This screen has no editable Description
// (read-only issuer content), so Dialog Text is the only field that needs
// it. Gated on the Request's own issuer tier (data.owner_tier), never this
// signed-in recipient's own tier — see CLAUDE.md's Entitlements section:
// rights on a Request come from its issuer, never from whoever is reading
// it. Duplicated per this codebase's established per-file convention.
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: { [index: number]: { transcript: string } } }
}
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
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
  owner_request_time_enabled: boolean
  // Reminder opt-out (migration 036, 2026-08-19) — the single shared
  // requests.reminder_enabled column (migration 031), now readable and
  // writable from here too, not just the owner's own Create Request/
  // Request Detail. See the file-header comment for the full reasoning.
  reminder_enabled: boolean
  // Reminders until Done banner (migration 037, 2026-08-20) — see
  // RequestDetailForm.tsx's identical file-header paragraph for the full
  // reasoning. overdue_reminder_enabled is the "Daily thereafter" opt-out;
  // reminder_sent_at drives "Morning before"'s second grey-out condition.
  overdue_reminder_enabled: boolean
  reminder_sent_at: string | null
  // Un-archive-on-clear (owner request, 2026-08-17, migration 032) — the
  // recipient's own archive state for this Request, as loaded. See the
  // matching state var below.
  received_archived_at: string | null
  // Repeat, read-only recipient footnote (Jim's own design, 2026-08-21,
  // migration 039). See RequestResponseForm.tsx's identical field comment.
  repeat_rule: RepeatRule | null
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

// Print-only Due/Done date format (2026-08-15) — see MainScreen.tsx's own
// copy of this helper for the full write-up. "7/15/26  8:30 AM", the
// owner's own xlsx example, vs. formatMDY's dash convention used everywhere
// else on this screen.
function formatMDYSlash(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(2)}`
}

// Same shape as RequestDetailForm.tsx's/MainScreen.tsx's own
// PrintAttachmentEntry (2026-08-15).
type PrintAttachmentEntry = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  reference_url: string | null
  reference_note: string | null
}

// Same rendering as RequestDetailForm.tsx's own PrintDialogList/
// PrintAttachmentList (2026-08-15) — duplicated per this codebase's
// established convention for small stateless print helpers.
function PrintDialogList({ entries }: { entries: DialogEntry[] }) {
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

function PrintAttachmentList({ entries }: { entries: PrintAttachmentEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="patt">
      <div className="patthead">Attachments</div>
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

  // Reminder checkbox (migration 036, 2026-08-19) — same shared column,
  // same plain checked=on .checkrow component as Request Detail's own;
  // loaded from data.reminder_enabled, written on Send via
  // set_response_done_as_recipient's new p_reminder_enabled argument.
  const [reminderEnabled, setReminderEnabled] = useState(true)
  // "Daily thereafter" opt-out (migration 037, 2026-08-20) — see
  // RequestDetailForm.tsx's identical addition.
  const [overdueReminderEnabled, setOverdueReminderEnabled] = useState(true)
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null)

  // Close/Cancel label (2026-08-20) — same reasoning/pattern as
  // RequestDetailForm.tsx's identical addition: a snapshot of the fields
  // this screen can actually write (Done Date, Done Time, both Reminder
  // checkboxes), taken once on load, compared live against the editable
  // state below. Dialog/Attachments deliberately excluded — both write
  // immediately and independently of Send/Cancel here, so Cancel was never
  // going to discard them regardless of the label.
  const initialFormRef = useRef<{
    doneDate: string
    doneTime: string
    reminderEnabled: boolean
    overdueReminderEnabled: boolean
  } | null>(null)
  const hasChanges =
    initialFormRef.current !== null &&
    (doneDate !== initialFormRef.current.doneDate ||
      doneTime !== initialFormRef.current.doneTime ||
      reminderEnabled !== initialFormRef.current.reminderEnabled ||
      overdueReminderEnabled !== initialFormRef.current.overdueReminderEnabled)

  // Un-archive-on-clear (owner request, 2026-08-17) — the row's own
  // received_archived_at as loaded. Not itself editable, and no
  // client-side write is needed for it: migration 032's
  // set_response_done_as_recipient already clears received_archived_at
  // server-side whenever p_done_date is null, so this state exists only
  // to drive the advisory note below, not to build the Save payload.
  const [receivedArchivedAt, setReceivedArchivedAt] = useState<string | null>(null)

  // Owner-reported, 2026-08-15 — see RequestResponseForm.tsx's identical
  // comment; this screen mirrors that fix verbatim.
  const [alreadyDoneOnLoad, setAlreadyDoneOnLoad] = useState(false)

  const [dialogList, setDialogList] = useState<DialogEntry[]>([])

  const [dialogModalOpen, setDialogModalOpen] = useState(false)
  const [dialogModalKind, setDialogModalKind] = useState<Kind>('question')
  const [dialogModalBody, setDialogModalBody] = useState('')
  const [dialogModalError, setDialogModalError] = useState<string | null>(null)
  const [dialogSelectedQuestionId, setDialogSelectedQuestionId] = useState<number | null>(null)
  const [dialogSaving, setDialogSaving] = useState(false)
  const dialogTextRef = useRef<HTMLTextAreaElement>(null)
  const doneDateRef = useRef<HTMLInputElement>(null)

  // Voice dictation for Dialog Text (2026-08-20) — see the module-level
  // comment above getSpeechRecognition() for the full reasoning.
  const [dlgDictating, setDlgDictating] = useState(false)
  const dlgRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setVoiceSupported(getSpeechRecognition() !== null)
    })
    return () => {
      cancelled = true
      dlgRecognitionRef.current?.stop()
    }
  }, [])

  function toggleDialogDictation() {
    if (dlgDictating) {
      dlgRecognitionRef.current?.stop()
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let addition = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        addition += event.results[i][0].transcript
      }
      if (addition.trim() === '') return
      setDialogModalBody((b) => (b ? `${b} ${addition.trim()}` : addition.trim()))
    }
    recognition.onerror = () => setDlgDictating(false)
    recognition.onend = () => setDlgDictating(false)
    dlgRecognitionRef.current = recognition
    recognition.start()
    setDlgDictating(true)
  }

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendConfirmed, setSendConfirmed] = useState(false)

  // Attachments (Week 5 Priority 3, 2026-08-14) — this signed-in recipient
  // can delete their own uploads, unlike the anonymous Request Response
  // screen, so both are needed (AttachmentsPanel's canDelete check).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  // Owner's ask, 2026-08-13 — see cameFromCalendarLink's own comment in
  // @/lib/ics and RequestResponseForm.tsx's identical use of it.
  const [cameFromCalendar] = useState(() =>
    typeof window === 'undefined' ? false : cameFromCalendarLink(window.location.search)
  )

  // Print (2026-08-18) — brings this screen up to the detailed
  // .print-report/.prow/.pdlg/.patt format RequestDetailForm.tsx already
  // uses, replacing the old raw window.print() of the live screen. dialogList
  // above already has everything Dialog needs; Attachments needs its own
  // fetch — but unlike RequestDetailForm.tsx (the owner, plain owner-scoped
  // RLS SELECT on attachments), this is a signed-in RECIPIENT, and
  // `attachments` RLS is owner-only (migration 025), so a raw select would
  // return nothing here. Uses get_received_print_detail (migration 029,
  // granted to `authenticated`) instead — the same recipient-safe RPC
  // ArchiveForm.tsx's own loadReceivedPrintDetail() already calls, here for
  // a single id.
  const [printAttachments, setPrintAttachments] = useState<PrintAttachmentEntry[]>([])
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  function startPrint() {
    setShowPrint(true)
    // Always bump printTick so the effect below re-fires even if showPrint
    // was already true — see RequestDetailForm.tsx's identical comment for
    // the full reasoning (afterprint doesn't fire reliably in every
    // browser/print-flow, so showPrint alone can get stuck true).
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
      setReminderEnabled(payload.reminder_enabled)
      setOverdueReminderEnabled(payload.overdue_reminder_enabled)
      setReminderSentAt(payload.reminder_sent_at)
      initialFormRef.current = {
        doneDate: payload.done_date ?? '',
        doneTime: payload.done_time ?? '',
        reminderEnabled: payload.reminder_enabled,
        overdueReminderEnabled: payload.overdue_reminder_enabled,
      }
      setAlreadyDoneOnLoad(!!payload.done_date)
      setDialogList(payload.dialog ?? [])
      setReceivedArchivedAt(payload.received_archived_at)

      // Print (2026-08-18) — fetched alongside the main RPC, same
      // eager-on-load convention RequestDetailForm.tsx uses for its own
      // owner-scoped attachments fetch.
      const { data: printDetailData } = await supabase.rpc('get_received_print_detail', {
        p_ids: [requestId],
      })
      if (!cancelled) {
        type PrintDetailRow = { request_id: string; attachments: PrintAttachmentEntry[] }
        const rows = (printDetailData as unknown as PrintDetailRow[]) ?? []
        setPrintAttachments(rows[0]?.attachments ?? [])
      }

      const { data: sessionData } = await supabase.auth.getSession()
      if (!cancelled) {
        setCurrentUserId(sessionData.session?.user.id ?? null)
        setAuthToken(sessionData.session?.access_token ?? null)
      }

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

  // Reminder checkbox (migration 036, 2026-08-19) — same plain checked=on
  // .checkrow component as RequestDetailForm.tsx's own; eligibility mirrors
  // that screen's rule (isReminderEligible on the Due Date) but there's no
  // "select Contact/Due Date first" prerequisite here — Due Date isn't
  // editable on this screen at all, it's whatever the owner already set.
  //
  // Archived state added same day (owner: greyed out when viewed via
  // Archive) — reuses `receivedArchivedAt` (already fetched for the
  // un-archive-on-clear feature above), same reasoning as
  // RequestDetailForm.tsx's identical addition: this is the recipient's own
  // archived flag, independent of the owner's `archived_at`, and gating on
  // the real persisted column covers every path that reaches an archived
  // Received Request, not just a literal click from Archive.
  const reminderArchived = receivedArchivedAt !== null
  const reminderIneligible = !reminderArchived && !isReminderEligible(data?.due_date ?? null)
  // "has been sent already" (owner, 2026-08-20) — see
  // RequestDetailForm.tsx's identical addition; a second, independent
  // grey-out for "Morning before" only.
  const reminderAlreadySent = reminderSentAt !== null
  const reminderDisabled = reminderArchived || reminderIneligible || reminderAlreadySent
  const reminderTooltip = reminderArchived
    ? 'Reminders are not available for archived Requests.'
    : reminderIneligible
      ? data?.due_date
        ? 'A Reminder is not available due to the short lead time.'
        : 'A Reminder is not available without a Due Date.'
      : reminderAlreadySent
        ? 'The morning-before Reminder has already been sent for this Request.'
        : undefined

  function reminderBanner() {
    return (
      <div className="reminderbanner">
        <p className="reminderbanner-title">Reminders until Done</p>
        <div className="reminderbanner-items">
          <label
            className={`reminderitem${reminderDisabled ? ' reminderitem-disabled' : ''}`}
            title={reminderTooltip}
          >
            <input
              type="checkbox"
              checked={reminderEnabled}
              disabled={reminderDisabled}
              onChange={(e) => setReminderEnabled(e.target.checked)}
            />
            <span>Morning before</span>
          </label>
          <label className="reminderitem">
            <input
              type="checkbox"
              checked={overdueReminderEnabled}
              onChange={(e) => setOverdueReminderEnabled(e.target.checked)}
            />
            <span>Daily thereafter</span>
          </label>
        </div>
      </div>
    )
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
      p_reminder_enabled: reminderEnabled,
      p_overdue_reminder_enabled: overdueReminderEnabled,
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
      <div className="app no-print">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Request"
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
          <span className="glabel">Response Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="response-detail-form" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={sending}>
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
          </span>
        </div>

        {sendConfirmed && <div className="noticeband"><b>Response saved.</b> Your update has been recorded.</div>}

        <div className="scroll">
          <form id="response-detail-form" onSubmit={handleSend} noValidate>

            {/* Hidden when cameFromCalendar — see RequestResponseForm.tsx's
                identical block and @/lib/ics's cameFromCalendarLink comment. */}
            {!cameFromCalendar && (
              <div className="panelact panelact-top">
                <button className="btn" type="button" onClick={handleAddToCalendar}>
                  Add to Calendar
                </button>
              </div>
            )}
            <div className="meta">
              <div className="metarow"><span className="mlabel">Date:</span><span className="mval">{formatLongDateTime(data.created_at)}</span></div>
              <div className="metarow"><span className="mlabel">From:</span><span className="mval">{data.owner_name ?? '—'}</span></div>
              <div className="metarow">
                <span className="mlabel">Due:</span>
                <span className="mval">
                  {data.due_date ? formatLongDate(data.due_date) : '—'}
                  {/* Due Time suffix — only when the issuer has Due/Done Time
                      turned on (migration 019/020, 2026-08-13). See
                      RequestResponseForm.tsx's identical gate. */}
                  {data.owner_request_time_enabled && data.due_time && (
                    <>&nbsp;&nbsp;{formatTime12h(data.due_time)}</>
                  )}
                  {/* Repeat footnote marker — see RequestResponseForm.tsx's
                      identical addition for the full reasoning. */}
                  {data.repeat_rule && (
                    <sup className="repeatmark" aria-hidden="true">*</sup>
                  )}
                </span>
              </div>
            </div>

            {/* Reminders until Done banner (migration 036/037,
                2026-08-19/20) — new capability, owner's own design
                (mirrored onto Request Detail/Request Response too): the
                recipient can now opt out of the shared day-before Reminder
                and/or the recurring Overdue notices for this Request. Own
                full-width row below .meta, not beside it — see
                RequestDetailForm.tsx's identical comment on the
                2026-08-10 .metatop/.metacol wrap precedent this avoids. */}
            {reminderBanner()}

            <div className="seclabel">Request Description</div>
            <div className="respdesc">{data.description}</div>

            <div className="grabber" aria-hidden="true"></div>

            <div className="donerow">
              <span className="donenote">
                {/* Third state added 2026-08-11 — see RequestResponseForm.tsx's
                    identical comment; this screen mirrors that one's donerow
                    verbatim. */}
                {doneDate.trim() === '' ? (
                  <><b>Note:</b> For a quick response, click Done and Send.</>
                ) : sendConfirmed ? (
                  'This Request is now marked as Done and has been Sent.'
                ) : alreadyDoneOnLoad ? (
                  'This Request is reported as completed.'
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

            {/* Done Date/Done Time — collapses to Done Date alone when the
                issuer has Due/Done Time turned off. See
                RequestResponseForm.tsx's identical gate. */}
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
              {data.owner_request_time_enabled && (
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
                  {doneTime.trim() !== '' && (
                    <button
                      type="button"
                      className="fclear"
                      aria-label="Clear Done Time"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDoneTime('')
                      }}
                    >
                      &times;
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* Un-archive-on-clear advisory (owner request, 2026-08-17) —
                only shows when this Request was loaded already archived
                (in the recipient's own Archive, independent of the
                owner's) AND Done Date is currently empty (about to be
                cleared on Save/Send). migration 032's
                set_response_done_as_recipient does the actual clearing
                server-side. */}
            {receivedArchivedAt !== null && doneDate.trim() === '' && (
              <p className="subnote" style={{ padding: '0 var(--pad)' }}>
                This Request will be returned to active status and will appear in your lists again once saved.
              </p>
            )}

            {/* Simplified empty-state row (§6.32, 2026-08-11): with no
                entries, a single .frow — .actlabel + Add Dialog — replaces
                the old always-shown .panelfull/.panel with its "No Dialog
                entries yet." placeholder text. No .form/.fgroup wrapper on
                this screen, so the empty row needs its own var(--pad),
                matching .panelact's own convention. */}
            {sortedDialog.length === 0 ? (
              <div className="frow" style={{ padding: '0 var(--pad)', marginBottom: 12 }}>
                <span className="actlabel">
                  Questions, Answers, Comments <span className="subnote">(optional)</span>
                </span>
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

            {/* owner_tier gating unchanged. Real Add/list/delete via
                AttachmentsPanel as of Week 5 Priority 3 (2026-08-14) — this
                signed-in recipient can delete their own uploads (unlike the
                anonymous Request Response screen), never the owner's. */}
            {data.owner_tier === 'subscriber' && (
              <AttachmentsPanel
                requestId={requestId}
                mode="file"
                canAdd={true}
                authToken={authToken}
                recipientToken={null}
                isOwner={false}
                currentUserId={currentUserId}
                ownerLabel="You"
                standalone
              />
            )}

            {sendError && (
              <p className="ferror" role="alert" style={{ margin: '0 var(--pad) 12px' }}>
                {sendError}
              </p>
            )}

            {/* Repeat footnote — see RequestResponseForm.tsx's identical
                addition, including Jim's own "at the bottom, not above
                Dialog" placement correction. */}
            {data.repeat_rule && data.due_date && (
              <p className="subnote" style={{ margin: '0 var(--pad) 12px' }}>
                * This Request — {describeRepeat(data.repeat_rule, data.due_date)}.
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

              <div className={`fgroup${dialogModalError ? ' is-invalid' : ''}`}>
                <div className="descwrap">
                  <textarea
                    ref={dialogTextRef}
                    className="ftextarea ftextarea-plain"
                    id="dlgtext"
                    maxLength={DIALOG_MAX}
                    placeholder="Dialog Text"
                    aria-label="Dialog Text"
                    value={dialogModalBody}
                    onChange={(e) => {
                      setDialogModalBody(e.target.value)
                      if (dialogModalError) setDialogModalError(null)
                    }}
                    autoFocus
                  />
                  {data.owner_tier === 'subscriber' && voiceSupported && (
                    <button
                      type="button"
                      className={`micbtn${dlgDictating ? ' listening' : ''}`}
                      aria-label={dlgDictating ? 'Stop voice dictation' : 'Start voice dictation'}
                      onClick={toggleDialogDictation}
                    >
                      <MicIcon />
                    </button>
                  )}
                </div>
                <p className={`charcount${dialogModalBody.length >= DIALOG_MAX ? ' limit' : ''}`}>
                  {dialogModalBody.length} / {DIALOG_MAX}
                </p>
              </div>
              {dialogModalError && <p className="ferror" style={{ marginTop: -8 }}>{dialogModalError}</p>}
            </div>
          </>
        )}
      </div>

      {/* Single-item print (2026-08-18) — brings this screen up to the same
          .print-report/.prow shape RequestDetailForm.tsx already uses (that
          screen is the confirmed reference — "Request Detail uses the new
          format," owner). "From" replaces "To" (this is the recipient's own
          view of who sent it); Due/Done Time gated by the issuer's own
          owner_request_time_enabled, never this viewer's own account
          setting — same Entitlements rule CLAUDE.md's Database section
          already states (rights on a Request come from its issuer). No
          sort-arrow header row — nothing to sort with only one record, same
          as every other single-item print in this app. */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">Response Detail</div>
          <div className="pcolbar detail3">
            <span className="namecell">
              <span className="c-nm">From</span>
              <span className="c-desc">Description</span>
            </span>
            <span className="c-due">Due</span>
            <span className="c-dn">Done</span>
          </div>
          <div className="prows">
            {(() => {
              const status = doneDate
                ? 'done'
                : data.due_date && data.due_date < todayISODate()
                  ? 'overdue'
                  : 'open'
              return (
                <div className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                  <div className="pr1 detail3">
                    <span className="pnm">{data.owner_name || '—'}</span>
                    <span className="pdue">
                      {formatMDYSlash(data.due_date)}
                      {data.owner_request_time_enabled && data.due_time && (
                        <span className="ptime">{'  '}{formatTime12h(data.due_time)}</span>
                      )}
                    </span>
                    <span className="pdn">
                      {formatMDYSlash(doneDate || null)}
                      {data.owner_request_time_enabled && doneTime && (
                        <span className="ptime">{'  '}{formatTime12h(doneTime)}</span>
                      )}
                    </span>
                  </div>
                  <div className="pr2">
                    <span className="pdesc">{data.description}</span>
                  </div>
                  <PrintDialogList entries={dialogList} />
                  <PrintAttachmentList entries={printAttachments} />
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
