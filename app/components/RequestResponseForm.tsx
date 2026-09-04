'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

import WypHeader from './WypHeader'
import AttachmentsPanel from './AttachmentsPanel'
import Linkified from './Linkified'
import { supabase } from '@/lib/supabaseClient'
import { buildIcsContent, cameFromCalendarLink, todayISODate, truncate } from '@/lib/ics'
import { isReminderEligible } from '@/lib/email'
import { type RepeatRule, describeRepeat } from '@/lib/repeatRule'

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
 *
 * Reminders until Done banner (§6.41 PROPOSED, migration 037, 2026-08-20;
 * extended to three checkboxes with "Day of," migration 042, 2026-08-22) —
 * see RequestDetailForm.tsx's/ResponseDetailForm.tsx's identical file-header
 * paragraphs for the full reasoning. Same three-checkbox banner here: "Day
 * before" (renamed from "Morning before," reminder_enabled), "Day of"
 * (reminder_day_of_enabled), and "Day after" (renamed from "Daily
 * thereafter," migration 043, 2026-08-22 — see that migration's own header
 * comment; overdue_reminder_enabled, column unchanged, meaning simplified
 * from a recurring cron nudge to a single send the calendar day after Due
 * Date — Jim's own spam-complaint concern). "Day before" is greyed out
 * once reminder_sent_at is set, on top of the existing eligibility check.
 */

type Kind = 'question' | 'answer' | 'comment'

// See CreateRequestForm.tsx's identical constant for the full reasoning
// (globals.css's ftextarea-plain/.charcount comment; owner request
// 2026-08-16 to drop the floating label on scrollable text boxes and cap
// Dialog Text to 500, matching Description).
const DIALOG_MAX = 500

// Voice dictation for Dialog Text (2026-08-20) — same Web-Speech-API
// pattern as CreateRequestForm.tsx's own Description dictation, extended
// here per the owner's request. This screen has no editable Description
// (read-only issuer content), so Dialog Text is the only field that needs
// it. Gated on the Request's own issuer tier (data.owner_tier), never this
// anonymous visitor's own tier (which doesn't exist) — see CLAUDE.md's
// Entitlements section: rights on a Request come from its issuer, never
// from whoever is reading it. Duplicated per this codebase's established
// per-file convention.
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
  owner_request_time_enabled: boolean
  // Show Reminders (migration 044, 2026-08-23) — gates whether the
  // Reminders-until-Done banner below appears at all, read from the
  // issuer's own request_reminders_enabled. See ResponseDetailForm.tsx's
  // identical addition for the full reasoning.
  owner_request_reminders_enabled: boolean
  // Reminder opt-out (migration 036, 2026-08-19) — the single shared
  // requests.reminder_enabled column (migration 031), now readable and
  // writable from this anonymous token path too, not just the owner's own
  // Create Request/Request Detail. See ResponseDetailForm.tsx's identical
  // comment for the full reasoning.
  reminder_enabled: boolean
  // Reminders until Done banner (migration 037, 2026-08-20) — see
  // ResponseDetailForm.tsx's identical addition for the full reasoning.
  overdue_reminder_enabled: boolean
  reminder_sent_at: string | null
  // "Day of" (migration 042, 2026-08-22) — a third, independent
  // Reminders-until-Done checkbox; see ResponseDetailForm.tsx's identical
  // reasoning.
  reminder_day_of_enabled: boolean
  reminder_day_of_sent_at: string | null
  // Repeat, read-only recipient footnote (Jim's own design, 2026-08-21,
  // migration 039). Never editable here — only Request Detail's/ToDo
  // Detail's own RepeatControl on the owner's side can set or change it.
  repeat_rule: RepeatRule | null
  contact_name: string | null
  dialog: DialogEntry[]
}

// Copyright-line year (2026-09-02, owner request) — computed live in
// America/Los_Angeles rather than hardcoded, so the footer's "© YYYY"
// never goes stale. Duplicated per file that renders the .subbanner-row
// footer, matching this codebase's own small-helper convention.
function losAngelesYear(): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(new Date())
}

// formatMDYFromTimestamp (2026-09-02, owner-reported: Dialog entries showing
// tomorrow's date) — for a real timestamptz like dialog.created_at. Slicing
// the ISO string's first 10 characters (correct for a date-only column with
// no time/zone to misread) reads a timestamptz's UTC calendar date, which
// has already rolled to the next day whenever local time is evening or
// later in a negative-UTC-offset zone. new Date(value)'s getFullYear/
// getMonth/getDate are local-time-based, so they read the correct calendar
// day for the viewer.
function formatMDYFromTimestamp(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}-${String(y).slice(2)}`
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
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<ResponsePayload | null>(null)

  const [doneDate, setDoneDate] = useState('')
  const [doneTime, setDoneTime] = useState('')

  // Change-notification email to the owner (2026-09-02) — see
  // RequestDetailForm.tsx's identical addition for the full reasoning. This
  // screen never had a hasChanges/Cancel-button snapshot at all (removed
  // outright 2026-08-20, having no purpose for an anonymous visitor with no
  // prior history entry to return to), so initialFormRef exists here purely
  // to feed computeChangedFieldLabels below, not any button-disabled state.
  // The three reminder booleans were added 2026-09-04 for a second, narrower
  // purpose — remindersOnlyChanged below, which only swaps the Send button's
  // label to "Save"; this screen still has no disabled-gating at all.
  const initialFormRef = useRef<{
    doneDate: string
    doneTime: string
    reminderEnabled: boolean
    reminderDayOfEnabled: boolean
    overdueReminderEnabled: boolean
  } | null>(null)
  const [dialogChanged, setDialogChanged] = useState(false)
  const [attachmentsChanged, setAttachmentsChanged] = useState(false)

  // Owner-reported, 2026-08-15: opening a Request that was ALREADY marked
  // Done before this visit showed "This Request is now marked as Done, just
  // click Send." — worded as if the visitor had just done something that
  // still needs sending, when in fact nothing has changed yet. Set once,
  // from the payload as first loaded, and never touched again — a Send in
  // this session (sendConfirmed) still takes priority in the donerow below,
  // and quick-Done/manual edits during this same visit still fall through
  // to the original "just click Send" wording, since only the load-time
  // snapshot means "already done before I got here."
  const [alreadyDoneOnLoad, setAlreadyDoneOnLoad] = useState(false)

  // Reminder checkbox (migration 036, 2026-08-19) — same shared column,
  // same plain checked=on .checkrow component as Request Detail/Response
  // Detail's own; loaded from data.reminder_enabled, written on Send via
  // set_response_done_by_token's new p_reminder_enabled argument.
  const [reminderEnabled, setReminderEnabled] = useState(true)
  // "Day of" (migration 042, 2026-08-22) — a third, independent Reminders-
  // until-Done checkbox; see ResponseDetailForm.tsx's identical reasoning.
  const [reminderDayOfEnabled, setReminderDayOfEnabled] = useState(false)
  // "Day after" opt-out (renamed from "Daily thereafter," migration 043,
  // 2026-08-22 — column unchanged, meaning simplified to a single send;
  // migration 037, 2026-08-20) — see ResponseDetailForm.tsx's identical
  // addition.
  const [overdueReminderEnabled, setOverdueReminderEnabled] = useState(true)
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null)
  const [reminderDayOfSentAt, setReminderDayOfSentAt] = useState<string | null>(null)

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

  // remindersOnlyChanged (2026-09-04, Jim's own note on the Responding to a
  // Request Help topic) — true when the visitor has touched one of the
  // three Reminder checkboxes but nothing else (Done Date/Time unchanged,
  // no new Dialog/Attachments). The band button reads "Save" instead of
  // "Send" in that case, matching ResponseDetailForm.tsx's identical
  // addition — this screen still has no disabled-gating of its own (see
  // initialFormRef's own comment above), only the label changes.
  const remindersOnlyChanged =
    initialFormRef.current !== null &&
    doneDate === initialFormRef.current.doneDate &&
    doneTime === initialFormRef.current.doneTime &&
    !dialogChanged &&
    !attachmentsChanged &&
    (reminderEnabled !== initialFormRef.current.reminderEnabled ||
      reminderDayOfEnabled !== initialFormRef.current.reminderDayOfEnabled ||
      overdueReminderEnabled !== initialFormRef.current.overdueReminderEnabled)

  // Owner's ask, 2026-08-13 — see cameFromCalendarLink's own comment in
  // @/lib/ics: hide the Add to Calendar button when the visitor arrived by
  // clicking the event's own link from inside their calendar app, since
  // they already have it there. Read once, lazily, same
  // typeof-window-guarded pattern this app already uses for its
  // sessionStorage lazy initializers (see readStoredChip in MainScreen.tsx)
  // — window.location.search never changes after mount for this screen.
  const [cameFromCalendar] = useState(() =>
    typeof window === 'undefined' ? false : cameFromCalendarLink(window.location.search)
  )

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
        // (not found / expired / revoked / deleted) so a bad guess can't be
        // distinguished from an expired link — shown to the visitor as-is.
        // Reworded 2026-09-02 (migration 049) so a recipient reads a dead
        // link as the sender's own action rather than the app being
        // unreliable — the fallback here only fires on a network-level
        // failure with no message at all, so it's kept in sync with the
        // SQL function's own wording rather than left stale.
        setLoadError(rpcError?.message ?? 'This link is no longer active. The sender has removed the Request it pointed to.')
        setLoading(false)
        return
      }

      const payload = rpcData as ResponsePayload
      setData(payload)
      setDoneDate(payload.done_date ?? '')
      setDoneTime(payload.done_time ?? '')
      setAlreadyDoneOnLoad(!!payload.done_date)
      setReminderEnabled(payload.reminder_enabled)
      setReminderDayOfEnabled(payload.reminder_day_of_enabled)
      setOverdueReminderEnabled(payload.overdue_reminder_enabled)
      setReminderSentAt(payload.reminder_sent_at)
      setReminderDayOfSentAt(payload.reminder_day_of_sent_at)
      setDialogList(payload.dialog ?? [])
      initialFormRef.current = {
        doneDate: payload.done_date ?? '',
        doneTime: payload.done_time ?? '',
        reminderEnabled: payload.reminder_enabled,
        reminderDayOfEnabled: payload.reminder_day_of_enabled,
        overdueReminderEnabled: payload.overdue_reminder_enabled,
      }
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
    setDialogChanged(true)
    setDialogModalOpen(false)
  }

  // Change-notification email to the owner (2026-09-02) — see
  // RequestDetailForm.tsx's identical addition for the full reasoning.
  // Excludes the Reminder checkboxes (this visitor's own opt-outs, not
  // meaningful to the owner) and Repeat (owner-only, not editable here).
  function computeChangedFieldLabels(): string[] {
    if (!initialFormRef.current) return []
    const snap = initialFormRef.current
    const labels: string[] = []
    if (doneDate !== snap.doneDate) labels.push('Done Date')
    if (doneTime !== snap.doneTime) labels.push('Done Time')
    if (dialogChanged) labels.push('Dialog')
    if (attachmentsChanged) labels.push('Attachments')
    return labels
  }

  // Fire-and-forget, mirrors RequestDetailForm.tsx's own
  // sendChangeNotification — uses the owner-facing route
  // (send-request-update-to-owner), verified by this visitor's own token,
  // never an Authorization header (there is no session on this path).
  async function sendChangeNotification(changedFieldLabels: string[]) {
    if (changedFieldLabels.length === 0) return
    try {
      await fetch('/api/email/send-request-update-to-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, changedFields: changedFieldLabels }),
      })
    } catch {
      // Best-effort — the response itself already saved successfully.
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setSendError(null)
    setSendConfirmed(false)

    const changedFieldLabels = computeChangedFieldLabels()
    setSending(true)

    const { error: rpcError } = await supabase.rpc('set_response_done_by_token', {
      p_token: token,
      p_done_date: doneDate.trim() === '' ? null : doneDate,
      p_done_time: doneTime.trim() === '' ? null : doneTime,
      p_reminder_enabled: reminderEnabled,
      p_overdue_reminder_enabled: overdueReminderEnabled,
      p_reminder_day_of_enabled: reminderDayOfEnabled,
    })

    setSending(false)

    if (rpcError) {
      setSendError(rpcError.message)
      return
    }

    void sendChangeNotification(changedFieldLabels)

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

  // Reminder checkbox (migration 036, 2026-08-19) — same plain checked=on
  // .checkrow component as Request Detail/Response Detail's own; eligibility
  // mirrors those screens' rule (isReminderEligible on the Due Date). No
  // "select Contact/Due Date first" prerequisite here either — Due Date
  // isn't editable on this screen at all, it's whatever the owner already
  // set.
  const reminderIneligible = !isReminderEligible(data?.due_date ?? null)
  // "has been sent already" (owner, 2026-08-20) — see
  // ResponseDetailForm.tsx's identical addition; a second, independent
  // grey-out for "Day before" only.
  const reminderAlreadySent = reminderSentAt !== null
  const reminderDisabled = reminderIneligible || reminderAlreadySent
  const reminderTooltip = reminderIneligible
    ? data?.due_date
      ? 'A Reminder is not available due to the short lead time.'
      : 'A Reminder is not available without a Due Date.'
    : reminderAlreadySent
      ? 'The day-before Reminder has already been sent for this Request.'
      : undefined

  // "Day of" (migration 042, 2026-08-22) — no lead-time eligibility floor;
  // the only prereq is a Due Date, same as elsewhere on this screen.
  // dayOfAlreadySent mirrors reminderAlreadySent's own shape, keyed off the
  // independent reminder_day_of_sent_at column.
  const dayOfAlreadySent = reminderDayOfSentAt !== null
  const dayOfDisabled = !data?.due_date || dayOfAlreadySent
  const dayOfTooltip = !data?.due_date
    ? 'A Reminder is not available without a Due Date.'
    : dayOfAlreadySent
      ? 'The day-of Reminder has already been sent for this Request.'
      : undefined

  // "Day after" grey-out, 2026-08-22 — same addition as Request
  // Detail/Response Detail's identical fix: once Done Date holds a value,
  // there's nothing left to nudge about. No archived state on this
  // anonymous screen (Archive is an owner/signed-in-recipient concept), so
  // Done Date is the only gate here.
  const overdueReminderDisabled = doneDate.trim() !== ''
  const overdueReminderTooltip = overdueReminderDisabled
    ? 'This Request is already marked Done.'
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
            <span>Day before</span>
          </label>
          <label
            className={`reminderitem${dayOfDisabled ? ' reminderitem-disabled' : ''}`}
            title={dayOfTooltip}
          >
            <input
              type="checkbox"
              checked={reminderDayOfEnabled}
              disabled={dayOfDisabled}
              onChange={(e) => setReminderDayOfEnabled(e.target.checked)}
            />
            <span>Day of</span>
          </label>
          <label
            className={`reminderitem${overdueReminderDisabled ? ' reminderitem-disabled' : ''}`}
            title={overdueReminderTooltip}
          >
            <input
              type="checkbox"
              checked={overdueReminderEnabled}
              disabled={overdueReminderDisabled}
              onChange={(e) => setOverdueReminderEnabled(e.target.checked)}
            />
            <span>Day after</span>
          </label>
        </div>
      </div>
    )
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
          <div className="subempty">{loadError ?? 'This link is no longer active. The sender has removed the Request it pointed to.'}</div>
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

        {/* Cancel removed, 2026-08-20 — owner: it had no useful purpose here
            ("all it does... is remove the banner"), and in his own
            experience he'd click it expecting it to close the browser tab,
            which it never could. Unlike every other Detail screen's Cancel
            (Request Detail/Response Detail/ToDo Detail), this screen never
            writes anything until Send, so there was never a saved value to
            revert to — the button's only real effect (dismissing
            sendConfirmed) wasn't worth keeping a control around for. Send
            is now the band's only button. */}
        <div className="band">
          <span className="glabel">Request Response</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="request-response-form" disabled={sending}>
              {sending ? 'Sending…' : remindersOnlyChanged ? 'Save' : 'Send'}
            </button>
          </span>
        </div>

        {/* "sent," not "saved" — same day, same report: this is the anonymous
            recipient's own confirmation after clicking Send, and "saved"
            undersold what actually happened (a write plus, when eligible,
            downstream Reminder/notification behavior keyed off it). */}
        {sendConfirmed && <div className="noticeband"><b>Response sent.</b> Your update has been recorded.</div>}

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
            {/* Hidden entirely, not just disabled, when cameFromCalendar —
                the visitor already has this on their calendar (that's how
                they got here), so the row would just be dead space. See
                cameFromCalendarLink's comment in @/lib/ics. */}
            {!cameFromCalendar && (
              <div className="panelact panelact-top">
                {/* Was deliberately inert (Days 2-3 covered response
                    read/write only); .ics generation built 2026-08-10 — see
                    buildIcsContent/handleAddToCalendar above. */}
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
                      turned on (migration 019/020, 2026-08-13). Rights on a
                      Request come from its issuer, never the viewer — same
                      precedent as owner_tier/Attachments gating above. */}
                  {data.owner_request_time_enabled && data.due_time && (
                    <>&nbsp;&nbsp;{formatTime12h(data.due_time)}</>
                  )}
                  {/* Repeat footnote marker (Jim's own design, 2026-08-21) —
                      "an adjacent-top-right asterisk," pointing at the
                      read-only Repeat note near the bottom of this screen.
                      Read-only here — see the ResponsePayload comment above. */}
                  {data.repeat_rule && (
                    <sup className="repeatmark" aria-hidden="true">*</sup>
                  )}
                </span>
              </div>
            </div>

            {/* Reminders until Done banner (migration 036/037,
                2026-08-19/20) — new capability, owner's own design
                (mirrored onto Request Detail/Response Detail too): the
                recipient can now opt out of the shared day-before Reminder
                and/or the recurring Overdue notices for this Request. Own
                full-width row below .meta, not beside it — see
                RequestDetailForm.tsx's identical comment on the 2026-08-10
                .metatop/.metacol wrap precedent this avoids. Padded
                directly with --pad, matching every other block on this
                screen's flat, per-block-padded .scroll layout (see the
                comment further down on the editable Done Date row). */}
            <div style={{ padding: '0 var(--pad)', marginBottom: 12 }}>
              {data.owner_request_reminders_enabled && reminderBanner()}
            </div>

            <div className="seclabel">Request Description</div>
            <div className="respdesc">
              <Linkified text={data.description} />
            </div>

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
                {/* Third state added 2026-08-11 — owner: once Send succeeds,
                    the wording next to the Done button itself should say so
                    too, not just the .noticeband confirmation at the top of
                    the screen. Reactive to sendConfirmed the same way the
                    other two states are reactive to doneDate — no separate
                    flag, so it can't drift out of sync with what actually
                    happened. */}
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

            {/* This screen has no shared .form wrapper (matching the mockup's
                own flat, per-block-padded .scroll children) — pad this one
                editable row directly with --pad, same as every sibling block
                below (.meta/.seclabel/.respdesc/.panelact/.panelfull/.promo
                all carry their own var(--pad) the same way). */}
            {/* Done Date/Done Time — collapses to Done Date alone when the
                issuer has Due/Done Time turned off (migration 019/020,
                2026-08-13; see the Due: metarow above for the same gate).
                doneTime itself stays whatever was loaded (or blank) and is
                simply never sent — set_response_done_by_token still accepts
                p_done_time null either way. */}
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
                          <span className="dlgdate">{formatMDYFromTimestamp(e.created_at)}</span>{' '}
                          <span className="dlgkind">{kindLabel}</span> <span className="dlgwho">({e.who})</span>
                          {e.kind === 'answer' ? (
                            <>
                              {q && <span className="dlgre">Re: {truncate(q.body)}</span>}
                              <span className="dlgbody">
                                <Linkified text={e.body} />
                              </span>
                            </>
                          ) : (
                            <>
                              {' '}
                              <Linkified text={e.body} />
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Attachments now shown regardless of the issuer's tier
                (2026-08-27) — the segment used to disappear entirely for a
                free-tier issuer, since Attachments was subscriber-only; now
                every account gets a real, capped allowance (100 MB free,
                profiles.subscription_storage_gb for a Subscriber), so
                there's always something real to offer here. extraNote
                reads the issuer's own tier (owner_tier, migration 011),
                never the viewer's — the storage allowance is the Request
                owner's, per CLAUDE.md's Entitlements section. Real Add/list
                via AttachmentsPanel as of Week 5 Priority 3 (2026-08-14) —
                no delete UI here (see app/api/attachments/delete/route.ts's
                own header comment: an anonymous visitor has no session to
                attribute a delete to). */}
            <AttachmentsPanel
              requestId={data.id}
              mode="file"
              canAdd={true}
              extraNote={data.owner_tier !== 'subscriber' ? '100 MB total' : null}
              authToken={null}
              recipientToken={token}
              isOwner={false}
              currentUserId={null}
              ownerLabel="Recipient"
              standalone
              onContentChange={() => setAttachmentsChanged(true)}
            />

            {/* Owner-reported, 2026-08-10: dropped the "Free Account
                Features" kicker line — the button's own label already says
                "Free Account", so it was redundant, and removing it
                shortens this block by a line. Also moved the button above
                the descriptive sentence: with the sentence first, it read
                as something to read before clicking, which isn't the
                intent. */}
            <div className="promo">
              <div className="promo-h">Send it, Track it, Get it Done</div>
              <Link href="/login?intent=signup" className="btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Create your own Free Account
              </Link>
              <p className="promo-p">The simple way to ask anyone for anything, and actually see it through.</p>
            </div>

            {sendError && (
              <p className="ferror" role="alert" style={{ margin: '0 var(--pad) 12px' }}>
                {sendError}
              </p>
            )}

            {/* Repeat footnote (Jim's own design, 2026-08-21) — read-only
                recurrence note for the Recipient, placed "at the bottom, not
                above Dialog" (Jim's own correction, superseding an earlier
                above-Dialog placement suggestion). The very last thing on
                this screen, below Attachments and the Free Account promo. */}
            {data.repeat_rule && data.due_date && (
              <p className="subnote" style={{ margin: '0 var(--pad) 12px' }}>
                * This Request — {describeRepeat(data.repeat_rule, data.due_date)}.
              </p>
            )}
          </form>
        </div>

        <div className="subbanner-row">
          <button className="btn-secondary" type="button" onClick={() => router.push('/account/subscription')}>
            Subscription Features and Options
          </button>
          <button className="btn-secondary" type="button" onClick={() => router.push('/privacy')}>
            Privacy
          </button>
        </div>
        <p className="subcopyright">
          {`© ${losAngelesYear()} Would You Please, Inc. All rights reserved.`}
        </p>
        {/* Gated on data.owner_tier (2026-08-25), not a viewer tier — this
            anonymous screen has no signed-in identity of its own for an
            ad-free benefit to attach to (unlike ResponseDetailForm.tsx's
            identical-looking gate, which uses the signed-in recipient's own
            profiles.tier). Consistent with this screen's existing
            Attachments/voice-dictation gates just above, both already keyed
            off the Request's issuer per this file's own Entitlements
            precedent — extended here on the same reasoning: if the issuer is
            a subscriber, the response experience they've sent out is
            ad-free too. */}
        {data.owner_tier !== 'subscriber' && (
          <div className="adslot" aria-hidden="true">
            <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
          </div>
        )}

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
    </div>
  )
}
