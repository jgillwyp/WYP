'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AttachmentsPanel from './AttachmentsPanel'
import RepeatControl from './RepeatControl'
import Linkified from './Linkified'
import ConversionBanner from './ConversionBanner'
import { supabase } from '@/lib/supabaseClient'
import { isReminderEligible } from '@/lib/email'
import { type RepeatRule, describeRepeat } from '@/lib/repeatRule'

/**
 * Request Detail (§9.3) — converted from
 * design/screens/WYP_request_detail_palette1.html. The issuer's own view of
 * a Request already sent: Recipient is non-modifiable (`.metarow`, §6.28);
 * Due Date/Time, Done Date/Time, Category, and Description stay editable and
 * pre-filled from the database. Action buttons stay Send/Cancel, unchanged
 * from the mockup — Send here means "commit this change (and notify)."
 *
 * Dialog is NOT staged like Create Request's blank thread: this Request
 * already exists, so each Add Dialog Save writes straight to the `dialog`
 * table and the panel re-fetches, rather than waiting for a top-level Send.
 * Answer unlocks dynamically (only when a Question in the thread is still
 * open) with a which-Question picker when more than one is open — same
 * open-Question logic as the mockup's demo JS, ported to React state.
 *
 * HARD DEPENDENCY: this screen's Dialog panel selects `dialog.replies_to_id`
 * (migration 006). If migration 006 hasn't been run yet, the dialog fetch
 * below will error — see CLAUDE.md Known gaps.
 *
 * Reminder checkbox (§6.37 PROPOSED, migration 031, 2026-08-15) — same
 * control and eligibility rules as CreateRequestForm.tsx's own (see that
 * file's header comment for the full reasoning), persisted/reloaded here on
 * Save. **Relocated 2026-08-19** (owner's own new design, mirrored onto
 * Request Response/Response Detail — migration 036) from its original
 * standalone row after Attachments to its own full-width row directly under
 * the Date/Recipient metarow block, replacing that older placement rather
 * than adding a second control — still not placed beside the metarow block
 * (a side-by-side Date/Recipient + control layout was tried and reverted
 * here once already, .metatop/.metacol, 2026-08-10, over Android word-wrap).
 *
 * Reminders until Done banner (§6.41 PROPOSED, migration 037, 2026-08-20;
 * extended to three checkboxes with "Day of," migration 042, 2026-08-22) —
 * the single Reminder checkbox above is superseded by a "Reminders until
 * Done" banner (.reminderbanner/.reminderitem, globals.css): "Day before"
 * (renamed from "Morning before") is the existing day-before Reminder
 * (reminder_enabled, unchanged rules), "Day of" fires the same morning as
 * Due Date (reminder_day_of_enabled), and "Day after" (renamed from "Daily
 * thereafter," migration 043, 2026-08-22 — see that migration's own header
 * comment) fires once, the calendar day following Due Date
 * (overdue_reminder_enabled, column unchanged, meaning simplified from a
 * recurring cron nudge to a single send — Jim's own spam-complaint
 * concern). "Day before" gains a second, independent grey-out condition
 * here — reminder_sent_at (fetched below) is not null, i.e. it has already
 * gone out for this Request — layered on top of the existing eligibility
 * checks; "Day of" and "Day after" have no eligibility gate of their own on
 * this screen beyond the shared archived-Request grey-out.
 */

type Kind = 'question' | 'answer' | 'comment'

type Category = {
  id: string
  name: string
}

type DialogEntry = {
  id: number
  kind: Kind
  body: string
  who: string
  created_at: string
  replies_to_id: number | null
}

// Same shape as MainScreen.tsx's own PrintAttachmentEntry (2026-08-15).
type PrintAttachmentEntry = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  reference_url: string | null
  reference_note: string | null
}

type RequestFormState = {
  dueDate: string
  dueTime: string
  doneDate: string
  doneTime: string
  categoryName: string
  description: string
  reminderEnabled: boolean
  reminderDayOfEnabled: boolean
  overdueReminderEnabled: boolean
}

const CATEGORY_CAP = 20
const LOOKUP_BROWSE_THRESHOLD = 12

// See CreateRequestForm.tsx's identical constants for the full reasoning
// (globals.css's ftextarea-plain/.charcount comment; owner request
// 2026-08-16).
const DESCRIPTION_MAX = 500
const DIALOG_MAX = 500

// Voice dictation (2026-08-20) — same Web-Speech-API pattern as
// CreateRequestForm.tsx's own Description dictation, ported here per the
// owner's request to extend it to the Detail screens. Duplicated per this
// codebase's established per-file convention rather than extracted to a
// shared lib/hook.
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

function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Same helpers as MainScreen.tsx's own Print Reports (2026-08-13/2026-08-15)
// — duplicated per this codebase's established convention for small
// stateless formatters rather than extracted to a shared lib file.
function formatTime12h(value: string | null): string {
  if (!value) return ''
  const [hStr, mStr] = value.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${ampm}`
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

// created_at is a real timestamptz — new Date(iso) is correct here, unlike
// the date-only due_date/done_date fields above (formatMDY/formatMDYSlash),
// which build the Date from its own Y/M/D components to avoid a UTC-parsing
// day-early bug. Same helper as ResponseDetailForm.tsx/RequestResponseForm.tsx.
function formatLongDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

function categoryPrefix(name: string | null | undefined): string {
  return name ? `[${name}] ` : ''
}

// Same rendering as MainScreen.tsx's own PrintDialogList/PrintAttachmentList
// (2026-08-15) — duplicated per this codebase's established convention.
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

// "Repeats: ..." print line (Jim's own instruction, 2026-08-21, "preceding
// the Dialog") — same describeRepeat() builder the live Repeat band uses.
function PrintRepeatLine({ rule, dueDate }: { rule: RepeatRule | null; dueDate: string }) {
  if (!rule || !dueDate) return null
  return (
    <div className="prepeat">
      <span className="prepeathead">Repeats:</span> {describeRepeat(rule, dueDate)}
    </div>
  )
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

export default function RequestDetailForm() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const requestId = params.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recipientName, setRecipientName] = useState('')
  // Issuance date (owner request, 2026-08-16) — matches the "Date:" metarow
  // Request Response/Response Detail already show; Request Detail never had
  // one, so created_at was never even fetched here before now.
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  // Un-archive-on-clear (owner request, 2026-08-17) — the row's own
  // archived_at as loaded, carried unchanged through Save unless Done Date
  // is being cleared this Save (see handleSubmit). Not itself editable —
  // there's no Archive/Un-archive control on this screen, only the
  // side-effect of clearing Done Date.
  const [archivedAt, setArchivedAt] = useState<string | null>(null)
  // Reminders until Done banner (2026-08-20) — when "Day before" already
  // went out for this Request, per the owner's own new grey-out rule. Not
  // itself editable; loaded once and compared against, same shape as
  // archivedAt above. reminderDayOfSentAt (migration 042, 2026-08-22) is the
  // identical idempotency marker for the new "Day of" checkbox — independent
  // of reminderSentAt, since the two Reminders fire on different days.
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null)
  const [reminderDayOfSentAt, setReminderDayOfSentAt] = useState<string | null>(null)

  // Repeat (Jim's own recurrence-method design, 2026-08-21) — loaded from
  // the row itself, edited via RepeatControl's own modal, written back on
  // Save alongside everything else in `form`. Not itself part of the
  // RequestFormState union — RepeatControl manages its own draft state
  // internally and only calls back on Save/Remove, same shape as
  // selectedCategory below.
  const [repeatRule, setRepeatRule] = useState<RepeatRule | null>(null)
  const [repeatOccurrenceIndex, setRepeatOccurrenceIndex] = useState<number | null>(null)

  const [form, setForm] = useState<RequestFormState>({
    dueDate: '',
    dueTime: '',
    doneDate: '',
    doneTime: '',
    categoryName: '',
    description: '',
    reminderEnabled: true,
    reminderDayOfEnabled: false,
    overdueReminderEnabled: true,
  })

  // Private Category is now an opt-in account preference (migration 018,
  // 2026-08-13), off by default — see AccountForm.tsx and
  // CreateRequestForm.tsx's identical gate.
  const [categoriesEnabled, setCategoriesEnabled] = useState(false)
  // Due/Done Time is now an opt-in account preference too (migration 019,
  // 2026-08-13) — see AccountForm.tsx and CreateRequestForm.tsx's identical
  // gate. On by default. When off, the two two-value rows below (Due
  // Date/Due Time, Done Date/Done Time) collapse into one combined row
  // (Due Date, Done Date), matching ToDo Detail's own combined-row pattern
  // exactly — owner's own stated goal for this feature.
  const [requestTimeEnabled, setRequestTimeEnabled] = useState(true)
  // Show Reminders (migration 044, 2026-08-23) — standalone master toggle
  // for the Reminders-until-Done banner; see AccountForm.tsx and
  // CreateRequestForm.tsx's identical gate. Default flipped true -> false,
  // migration 045, 2026-08-25 — see AccountForm.tsx's header comment.
  const [requestRemindersEnabled, setRequestRemindersEnabled] = useState(false)
  // Always show Send Reminder button (migration 044) — when true,
  // sendReminderPanel() below renders even when the Request isn't overdue.
  // Off by default (preserves §6.44's original only-when-overdue behavior).
  const [alwaysShowSendReminder, setAlwaysShowSendReminder] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)
  const [categoryBrowsing, setCategoryBrowsing] = useState(false)

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const [dialogList, setDialogList] = useState<DialogEntry[]>([])
  const [ownerName, setOwnerName] = useState<string | null>(null)

  const [dialogModalOpen, setDialogModalOpen] = useState(false)
  const [dialogModalKind, setDialogModalKind] = useState<Kind>('question')
  const [dialogModalBody, setDialogModalBody] = useState('')
  const [dialogModalError, setDialogModalError] = useState<string | null>(null)
  const [dialogSelectedQuestionId, setDialogSelectedQuestionId] = useState<number | null>(null)
  const [dialogSaving, setDialogSaving] = useState(false)
  const dialogTextRef = useRef<HTMLTextAreaElement>(null)

  const [descInvalid, setDescInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Manual "Send Reminder" (owner, 2026-08-22): "The reminder would go out
  // either immediately or in the next cron cycle. This would accommodate a
  // Requestor who does not want automated notifications sent out." —
  // independent of the three automated Reminder checkboxes above; mints its
  // own response-link token and posts to /api/email/send-reminder, which
  // deliberately does not touch overdue_notified_at (see that route's own
  // header comment). sendingReminder guards the button against a double
  // click; reminderResult surfaces the outcome inline (.donenote on
  // success, .ferror on failure) rather than a toast, matching this
  // screen's existing inline-message conventions.
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderResult, setReminderResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Auto-growing Description (2026-08-19, owner request) — this screen
  // loads an existing, possibly long Description the moment the record
  // fetches, unlike Create Request's own fresh-typed-and-scrolls case
  // (owner's own framing: "not an issue" there). Resizing on every render
  // where form.description changed — rather than only in the textarea's
  // own onChange — covers both the async load and manual editing with one
  // effect. .ftextarea-autosize (globals.css) turns off the fixed height/
  // scrollbar/resize-handle this would otherwise fight.
  const descRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [form.description])

  // Voice dictation (2026-08-20) — extended from Create Request/Create ToDo
  // to this screen's own Description field, per the owner's request. Gated
  // on this screen's existing `tier` state below (signed-in owner's own
  // profiles.tier — this screen has no anonymous visitor). Dialog Text gets
  // its own independent dictating/recognitionRef pair further down, since
  // the two fields could theoretically both want to dictate.
  const [descDictating, setDescDictating] = useState(false)
  const descRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
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
      descRecognitionRef.current?.stop()
      dlgRecognitionRef.current?.stop()
    }
  }, [])

  function toggleDescDictation() {
    if (descDictating) {
      descRecognitionRef.current?.stop()
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
      set('description', form.description ? `${form.description} ${addition.trim()}` : addition.trim())
    }
    recognition.onerror = () => setDescDictating(false)
    recognition.onend = () => setDescDictating(false)
    descRecognitionRef.current = recognition
    recognition.start()
    setDescDictating(true)
  }

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

  // Attachments (Week 5 Priority 3, 2026-08-14) — AttachmentsPanel does its
  // own fetching once these are known.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  // Print (2026-08-15) — reuses the exact per-record layout MainScreen.tsx's
  // own Print Reports use (.print-report/.prow/.pdlg/.patt), for one Request
  // instead of a whole section — "the same format can be used for the single
  // item" (owner). No sort-arrow header row here (owner, same day: "Obviously
  // the up/down arrow for a selected sort would not be shown for a detail
  // print of a single item") — nothing to sort when there's only one record.
  // dialogList above already has everything Dialog needs; Attachments needs
  // its own small fetch since AttachmentsPanel keeps its own list private.
  const [printAttachments, setPrintAttachments] = useState<PrintAttachmentEntry[]>([])
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Close/Cancel label (2026-08-20, owner request) — "the Cancel button
  // would be enhanced by initially showing the label to be 'Close' and only
  // changing the label to 'Cancel' after any changes have been made to
  // form data" — a snapshot of every field Save actually writes, taken once
  // when the record loads (set alongside setForm/setSelectedCategory in
  // load() below), compared against the live form on every render. A ref,
  // not state — it's read during render, never needs to trigger one of its
  // own. Deliberately excludes Dialog and Attachments: the owner's own
  // words — "additional Dialog or Attachments currently are kept even if
  // the Cancel button is clicked... so making either of those changes
  // would not result in the button being renamed 'Cancel'" — both already
  // write immediately and independently of Save/Cancel on this screen, so
  // clicking Cancel was never going to discard them anyway; the label
  // should only warn about what Cancel actually can discard.
  const initialFormRef = useRef<{
    dueDate: string
    dueTime: string
    doneDate: string
    doneTime: string
    categoryId: string | null
    description: string
    reminderEnabled: boolean
    reminderDayOfEnabled: boolean
    overdueReminderEnabled: boolean
    repeatRule: RepeatRule | null
  } | null>(null)
  const hasChanges =
    initialFormRef.current !== null &&
    (form.dueDate !== initialFormRef.current.dueDate ||
      form.dueTime !== initialFormRef.current.dueTime ||
      form.doneDate !== initialFormRef.current.doneDate ||
      form.doneTime !== initialFormRef.current.doneTime ||
      form.description !== initialFormRef.current.description ||
      form.reminderEnabled !== initialFormRef.current.reminderEnabled ||
      form.reminderDayOfEnabled !== initialFormRef.current.reminderDayOfEnabled ||
      form.overdueReminderEnabled !== initialFormRef.current.overdueReminderEnabled ||
      (selectedCategory?.id ?? null) !== initialFormRef.current.categoryId ||
      JSON.stringify(repeatRule) !== JSON.stringify(initialFormRef.current.repeatRule))

  async function loadDialog() {
    const { data } = await supabase
      .from('dialog')
      .select('id, kind, body, who, created_at, replies_to_id')
      .eq('request_id', requestId)
      .order('id')
    setDialogList((data as unknown as DialogEntry[]) ?? [])
  }

  function startPrint() {
    setShowPrint(true)
    // Always bump printTick so the effect below re-fires even if showPrint
    // was already true (owner-reported 2026-08-15: clicking the same Print
    // icon a second time in a row did nothing, but it worked again after
    // printing from a different screen and coming back — that navigation
    // remounted this component, resetting showPrint to false; without it,
    // a second click here set showPrint(true) again while it was still
    // true from the first click, which is a no-op for React — same value,
    // no re-render, effect never re-runs. Root cause: 'afterprint' doesn't
    // fire reliably in every browser/print-flow, so showPrint can get stuck
    // true. printTick strictly increases on every click, guaranteeing a
    // real dependency change regardless of whether 'afterprint' ever fired.
    setPrintTick((t) => t + 1)
  }

  useEffect(() => {
    if (printTick === 0) return
    // Same afterprint-driven pattern as MainScreen.tsx's own Print Reports —
    // fires after the .print-report JSX below has committed to the DOM.
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

      const [reqRes, catRes, ownerRes, attRes] = await Promise.all([
        supabase
          .from('requests')
          .select('id, description, created_at, due_date, due_time, done_date, done_time, category_id, reminder_enabled, overdue_reminder_enabled, reminder_sent_at, reminder_day_of_enabled, reminder_day_of_sent_at, archived_at, repeat_rule, repeat_occurrence_index, contacts(display_name), categories(name)')
          .eq('id', requestId)
          .single(),
        supabase.from('categories').select('id, name').order('name'),
        supabase
          .from('profiles')
          .select(
            'display_name, private_category_enabled, request_time_enabled, request_reminders_enabled, always_show_send_reminder, tier'
          )
          .single(),
        // Print (2026-08-15) — same owner-scoped RLS access MainScreen.tsx's
        // own loadOwnedPrintDetail() uses; fetched unconditionally on load
        // rather than only-on-print-click, since a single Detail screen's
        // own attachment list is small (unlike Main Screen's whole-section
        // fetch, which is deliberately deferred to the Print click itself).
        supabase
          .from('attachments')
          .select('id, kind, file_name, reference_url, reference_note')
          .eq('request_id', requestId)
          .is('deleted_at', null)
          .order('created_at'),
      ])
      if (!cancelled) setPrintAttachments((attRes.data as unknown as PrintAttachmentEntry[]) ?? [])

      const { data: sessionData } = await supabase.auth.getSession()
      if (!cancelled) {
        setCurrentUserId(sessionData.session?.user.id ?? null)
        setAuthToken(sessionData.session?.access_token ?? null)
      }

      if (cancelled) return

      if (reqRes.error || !reqRes.data) {
        setLoadError(reqRes.error?.message ?? 'Could not load this Request.')
        setLoading(false)
        return
      }

      type Row = {
        description: string
        created_at: string
        due_date: string | null
        due_time: string | null
        done_date: string | null
        done_time: string | null
        category_id: string | null
        reminder_enabled: boolean
        overdue_reminder_enabled: boolean
        reminder_sent_at: string | null
        reminder_day_of_enabled: boolean
        reminder_day_of_sent_at: string | null
        archived_at: string | null
        repeat_rule: RepeatRule | null
        repeat_occurrence_index: number | null
        contacts: { display_name: string } | null
        categories: { name: string } | null
      }
      const row = reqRes.data as unknown as Row

      setRecipientName(row.contacts?.display_name ?? '—')
      setCreatedAt(row.created_at)
      setArchivedAt(row.archived_at)
      setReminderSentAt(row.reminder_sent_at)
      setReminderDayOfSentAt(row.reminder_day_of_sent_at)
      setRepeatRule(row.repeat_rule)
      setRepeatOccurrenceIndex(row.repeat_occurrence_index)
      setForm({
        dueDate: row.due_date ?? '',
        dueTime: row.due_time ?? '',
        doneDate: row.done_date ?? '',
        doneTime: row.done_time ?? '',
        categoryName: row.categories?.name ?? '',
        description: row.description ?? '',
        reminderEnabled: row.reminder_enabled,
        reminderDayOfEnabled: row.reminder_day_of_enabled,
        overdueReminderEnabled: row.overdue_reminder_enabled,
      })
      initialFormRef.current = {
        dueDate: row.due_date ?? '',
        dueTime: row.due_time ?? '',
        doneDate: row.done_date ?? '',
        doneTime: row.done_time ?? '',
        categoryId: row.category_id ?? null,
        description: row.description ?? '',
        reminderEnabled: row.reminder_enabled,
        reminderDayOfEnabled: row.reminder_day_of_enabled,
        overdueReminderEnabled: row.overdue_reminder_enabled,
        repeatRule: row.repeat_rule,
      }
      if (row.category_id && row.categories) {
        setSelectedCategory({ id: row.category_id, name: row.categories.name })
      }
      setCategories(catRes.data ?? [])
      setOwnerName(ownerRes.data?.display_name ?? null)
      setCategoriesEnabled(ownerRes.data?.private_category_enabled ?? false)
      setRequestTimeEnabled(ownerRes.data?.request_time_enabled ?? true)
      setRequestRemindersEnabled(ownerRes.data?.request_reminders_enabled ?? false)
      setAlwaysShowSendReminder(ownerRes.data?.always_show_send_reminder ?? false)
      setTier(ownerRes.data?.tier === 'subscriber' ? 'subscriber' : 'free')

      await loadDialog()
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Owner-reported (2026-08-10, found testing Request Response, same logic
  // applies here): opening Add Dialog always defaulted to the Question
  // chip, even when every existing entry was itself an unanswered Question
  // — "it seems more appropriate to show the Answer chip as selected if
  // there are any questions in the dialog which have not been answered
  // yet." selectKind('answer') already knows how to pick the right Question
  // (or show the picker for more than one); this just changes which chip
  // starts selected.
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
      // Owner-reported, 2026-08-10: same focus-management gap as the
      // chip-switch fix, on this different trigger (Save with an empty
      // body rather than a chip click).
      setDialogModalError('Enter Dialog Text or Cancel.')
      dialogTextRef.current?.focus()
      return
    }

    setDialogSaving(true)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setDialogModalError('Your session has expired. Sign in again and retry.')
      setDialogSaving(false)
      return
    }

    const { error: insertError } = await supabase.from('dialog').insert({
      request_id: requestId,
      author_user_id: userData.user.id,
      who: ownerName ?? userData.user.email ?? 'Unknown',
      kind: dialogModalKind,
      body,
      replies_to_id: dialogModalKind === 'answer' ? dialogSelectedQuestionId : null,
    })

    setDialogSaving(false)

    if (insertError) {
      setDialogModalError(insertError.message)
      return
    }

    await loadDialog()
    setDialogModalOpen(false)
  }

  const categoryQueryEmpty = form.categoryName.trim() === ''
  const categoriesBrowsable = categories.length < LOOKUP_BROWSE_THRESHOLD
  // Owner-reported, 2026-08-10, on Create Request's identical lookup —
  // ported here: clicking a field with an exact match re-filtered to that
  // one match instead of showing the whole list. categoryBrowsing (same
  // pattern as Time Zone's browse-on-focus fix) shows the full list from
  // focus until the first keystroke.
  const filteredCategories = categoryBrowsing
    ? categories
    : categoryQueryEmpty
      ? (categoriesBrowsable ? categories : [])
      : categories.filter((c) => c.name.toLowerCase().includes(form.categoryName.trim().toLowerCase()))
  const showCategoryDropdown = !categoryQueryEmpty || categoriesBrowsable

  function selectCategory(c: Category) {
    setSelectedCategory(c)
    set('categoryName', c.name)
    setShowCategoryResults(false)
  }

  function openAddCategory() {
    setNewCategoryName(form.categoryName.trim())
    setCategoryError(null)
    setAddCategoryOpen(true)
  }

  async function handleAddCategorySave() {
    const name = newCategoryName.trim()
    if (name === '') {
      setCategoryError('Enter a category name.')
      return
    }
    if (categories.length >= CATEGORY_CAP) {
      setCategoryError(`You've reached the ${CATEGORY_CAP}-category limit.`)
      return
    }

    setCategorySaving(true)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setCategoryError('Your session has expired. Sign in again and retry.')
      setCategorySaving(false)
      return
    }

    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ owner_id: userData.user.id, name })
      .select('id, name')
      .single()

    setCategorySaving(false)

    if (insertError || !data) {
      setCategoryError(insertError?.message ?? 'Could not save category.')
      return
    }

    setCategories((cats) => [...cats, data].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedCategory(data)
    set('categoryName', data.name)
    setAddCategoryOpen(false)
  }

  function validate(): boolean {
    const hasDesc = form.description.trim() !== ''
    setDescInvalid(!hasDesc)
    return hasDesc
  }

  // Reminder checkbox availability — same rule as CreateRequestForm.tsx's
  // own (see this file's header comment for why placement differs). The
  // Contact prerequisite from that screen doesn't apply here — Recipient is
  // already fixed and always present on an existing Request — so only the
  // Due Date itself gates state 1.
  //
  // Archived state added 2026-08-19 (owner: greyed out when viewed via
  // Archive) — takes priority over the other two states in the tooltip,
  // since an archived Request's Reminder is moot regardless of Due Date.
  // Reuses `archivedAt` (already fetched/round-tripped for the
  // un-archive-on-clear feature above) rather than a new "came from
  // Archive" navigation flag — ArchiveForm.tsx's own openDetail() passes no
  // query param, and gating on the real persisted archived_at is both
  // simpler and correct for every path that reaches an archived Request
  // (Archive's own list, or a Main Screen search result showing the
  // .archtag badge), not just a literal click from Archive.
  const reminderArchived = archivedAt !== null
  const reminderPrereqsMissing = form.dueDate.trim() === ''
  const reminderIneligible = !reminderPrereqsMissing && !isReminderEligible(form.dueDate)
  // "has been sent already for today" (owner, 2026-08-20) — a second,
  // independent grey-out for "Day before" only: once reminder_sent_at is
  // set, re-checking the box wouldn't undo an email that already went out.
  const reminderAlreadySent = reminderSentAt !== null
  const reminderDisabled = reminderArchived || reminderPrereqsMissing || reminderIneligible || reminderAlreadySent
  const reminderTooltip = reminderArchived
    ? 'Reminders are not available for archived Requests.'
    : reminderPrereqsMissing
      ? 'Please select Contact and Due Date before modifying the Reminder.'
      : reminderIneligible
        ? 'A Reminder is not available due to the short lead time.'
        : reminderAlreadySent
          ? 'The day-before Reminder has already been sent for this Request.'
          : undefined

  // "Day of" (migration 042, 2026-08-22) — no lead-time eligibility floor;
  // Recipient/Contact is already fixed on this screen, so the only prereqs
  // are Due Date and not-yet-archived. dayOfAlreadySent mirrors
  // reminderAlreadySent's own shape, keyed off the independent
  // reminder_day_of_sent_at column.
  const dayOfPrereqsMissing = form.dueDate.trim() === ''
  const dayOfAlreadySent = reminderDayOfSentAt !== null
  const dayOfDisabled = reminderArchived || dayOfPrereqsMissing || dayOfAlreadySent
  const dayOfTooltip = reminderArchived
    ? 'Reminders are not available for archived Requests.'
    : dayOfPrereqsMissing
      ? 'Please select Contact and Due Date before modifying the Reminder.'
      : dayOfAlreadySent
        ? 'The day-of Reminder has already been sent for this Request.'
        : undefined

  // "Day after" grey-out, 2026-08-22 (owner) — once a Request is marked
  // Done, there's nothing left to notify the Recipient about, so the
  // checkbox itself should stop being editable rather than just going inert
  // server-side. reminderArchived still layers on top, same as "Day
  // before" — an archived Request's Reminders are moot regardless of Done.
  const overdueReminderDone = form.doneDate.trim() !== ''
  const overdueReminderDisabled = reminderArchived || overdueReminderDone
  const overdueReminderTooltip = reminderArchived
    ? 'Reminders are not available for archived Requests.'
    : overdueReminderDone
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
              checked={form.reminderEnabled}
              disabled={reminderDisabled}
              onChange={(e) => set('reminderEnabled', e.target.checked)}
            />
            <span>Day before</span>
          </label>
          <label
            className={`reminderitem${dayOfDisabled ? ' reminderitem-disabled' : ''}`}
            title={dayOfTooltip}
          >
            <input
              type="checkbox"
              checked={form.reminderDayOfEnabled}
              disabled={dayOfDisabled}
              onChange={(e) => set('reminderDayOfEnabled', e.target.checked)}
            />
            <span>Day of</span>
          </label>
          <label
            className={`reminderitem${overdueReminderDisabled ? ' reminderitem-disabled' : ''}`}
            title={overdueReminderTooltip}
          >
            <input
              type="checkbox"
              checked={form.overdueReminderEnabled}
              disabled={overdueReminderDisabled}
              onChange={(e) => set('overdueReminderEnabled', e.target.checked)}
            />
            <span>Day after</span>
          </label>
        </div>
      </div>
    )
  }

  // Overdue Due Date (owner, 2026-08-22: "The overdue Due Date in red would
  // be a nice touch.") — same calendar-date-only comparison as every other
  // overdue treatment in this app (Main Screen rows, print reports' `status`
  // at line ~1668), not the cron route's own timezone-aware precision. A
  // Done Request or an archived one is never "overdue" regardless of Due
  // Date, matching the Reminder checkboxes' own grey-out reasoning above.
  const isOverdue =
    archivedAt === null && form.doneDate.trim() === '' && form.dueDate.trim() !== '' && form.dueDate < todayIso()

  // Manual "Send Reminder" (owner, 2026-08-22) — mints a fresh response-link
  // token (issue_request_link, migration 008, same owner-only RPC
  // CreateRequestForm.tsx's own automatic Initial-email flow already calls)
  // and posts it to /api/email/send-reminder, which reuses the automatic
  // "Day after" notice's own template. Deliberately does not touch any of
  // the three Reminder checkboxes or their _sent_at columns above — this is
  // an independent, in-the-moment override, not a substitute for or a
  // trigger of the automated system.
  async function handleSendReminder() {
    setReminderResult(null)
    setSendingReminder(true)

    const { data: linkToken, error: linkError } = await supabase.rpc('issue_request_link', {
      p_request_id: requestId,
    })

    if (linkError || !linkToken) {
      setSendingReminder(false)
      setReminderResult({ ok: false, text: 'Could not create a response link. Please try again.' })
      return
    }

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setSendingReminder(false)
      setReminderResult({ ok: false, text: 'Your session has expired. Please sign in again.' })
      return
    }

    try {
      const res = await fetch('/api/email/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          requestId,
          link: `${window.location.origin}/r/${linkToken}`,
        }),
      })
      const json: { sent?: boolean; reason?: string } = await res.json()

      setSendingReminder(false)
      if (json.sent) {
        setReminderResult({ ok: true, text: 'Reminder sent.' })
      } else if (json.reason === 'not_configured') {
        setReminderResult({ ok: false, text: 'Email sending is not configured yet.' })
      } else if (json.reason === 'not_overdue') {
        setReminderResult({ ok: false, text: 'This Request is no longer overdue.' })
      } else {
        setReminderResult({ ok: false, text: 'The Reminder could not be sent. Please try again.' })
      }
    } catch {
      setSendingReminder(false)
      setReminderResult({ ok: false, text: 'The Reminder could not be sent. Please try again.' })
    }
  }

  // §6.44 PROPOSED — reuses .donerow/.donenote (the same "Strip-tint box,
  // text left, button right" component already used for quick-Done bands
  // and the Repeat band) rather than a new shape. Rendered while the
  // Request is actually overdue (see isOverdue above), or unconditionally
  // when the owner's own "Always show Send Reminder button" account
  // preference (migration 044, alwaysShowSendReminder) is on. Note text
  // was Jim's own exact wording, 2026-08-23 ("This action is unrelated to
  // the Reminder schedule above.") — revised 2026-09-01, same batch as the
  // Archive Delete chip: "above" assumed the Reminders-until-Done banner is
  // always visible on this screen, which isn't true once the owner's own
  // "Show Reminders" toggle (request_reminders_enabled) is off — the panel
  // can render with nothing "above" it to refer to. Now reads "This action
  // is unrelated to scheduled Reminders." unconditionally, regardless of
  // whether the banner is currently shown.
  function sendReminderPanel() {
    if (!isOverdue && !alwaysShowSendReminder) return null
    return (
      <div className="donerow">
        <span className="donenote" style={reminderResult && !reminderResult.ok ? { color: 'var(--alert-red)' } : undefined}>
          {reminderResult ? reminderResult.text : 'This action is unrelated to scheduled Reminders.'}
        </span>
        <button
          className="btn-secondary"
          type="button"
          onClick={handleSendReminder}
          disabled={sendingReminder}
        >
          {sendingReminder ? 'Sending…' : 'Send Reminder'}
        </button>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!validate()) return

    setSaving(true)

    const { error: updateError } = await supabase
      .from('requests')
      .update({
        due_date: form.dueDate.trim() === '' ? null : form.dueDate,
        due_time: form.dueTime.trim() === '' ? null : form.dueTime,
        done_date: form.doneDate.trim() === '' ? null : form.doneDate,
        done_time: form.doneTime.trim() === '' ? null : form.doneTime,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
        reminder_enabled: form.reminderEnabled,
        reminder_day_of_enabled: form.reminderDayOfEnabled,
        overdue_reminder_enabled: form.overdueReminderEnabled,
        repeat_rule: repeatRule,
        repeat_occurrence_index: repeatRule ? (repeatOccurrenceIndex ?? 1) : null,
        // Un-archive-on-clear (owner request, 2026-08-17): clearing Done
        // Date on a Request that was archived returns it to active status
        // — preserved unchanged in every other case (including a non-
        // archived Request's Done Date being cleared, where archivedAt is
        // already null and this is a harmless no-op).
        archived_at: form.doneDate.trim() === '' ? null : archivedAt,
      })
      .eq('id', requestId)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    // router.back(), not push('/') — this screen is only ever reached by
    // clicking a Sent row on the Main Screen, so back() returns to that
    // exact history entry. Next restores its scroll position automatically
    // on back navigation; push('/') would instead mount a fresh Main Screen
    // at the top. The Main Screen still remounts and refetches either way
    // (no Cache Components/Activity in this app yet — see CLAUDE.md), so the
    // edited due date/done date/etc. show correctly, not stale.
    router.back()
  }

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
          <span className="glabel">Request Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="request-detail-form" disabled={saving || !hasChanges}>
              {saving ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={saving}>
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
          </span>
        </div>

        <div className="noticeband"><b>Note:</b> The Request Recipient is notified of changes.</div>

        <div className="scroll">
          <form className="form" id="request-detail-form" onSubmit={handleSubmit} noValidate>

            <div className="fgroup">
              <div className="metarow"><span className="mlabel">Date:</span><span className="mval">{formatLongDateTime(createdAt)}</span></div>
              <div className="metarow"><span className="mlabel">Recipient:</span><span className="mval">{recipientName}</span></div>
            </div>

            {/* Reminders until Done banner — moved here from its old
                standalone bottom-of-form row (2026-08-19, owner's own new
                design: Date/Recipient plus a quick-access Reminder control
                near the top, mirrored onto Request Response/Response Detail
                too), then expanded from a single checkbox into the two-item
                banner (2026-08-20, §6.41). Own full-width row below the
                metarow block, not beside it — a side-by-side Date/Recipient
                + control layout was tried and reverted here once already
                (.metatop/.metacol, 2026-08-10, word-wrapped "Wednesday,
                August 10," on a narrow Android phone); staying full-width
                avoids repeating that. */}
            {requestRemindersEnabled && reminderBanner()}

            {/* Manual "Send Reminder" (§6.44 PROPOSED, 2026-08-22) — placed
                directly after the automated Reminders-until-Done banner:
                automated options first, then the manual override, both in
                the same "Reminders" area of the screen rather than scattered
                (owner: "It could go after or before the Reminders in its own
                section/panel."). Renders while overdue, or unconditionally
                once the owner's own "Always show Send Reminder button"
                Account preference is on (migration 044, 2026-08-23). */}
            {sendReminderPanel()}

            {requestTimeEnabled ? (
              <>
                <div className="fgroup frow">
                  <span className="ffloat picker native">
                    <input
                      className={`finput req${isOverdue ? ' overdue-date' : ''}`}
                      id="dd"
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => set('dueDate', e.target.value)}
                      onClick={openPicker}
                    />
                    <label className="flabel" htmlFor="dd">
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
                      Due Date
                    </label>
                  </span>
                  <span className="ffloat picker native">
                    <input
                      className={`finput${form.dueTime.trim() === '' ? ' opt' : ''}`}
                      id="dt"
                      type="time"
                      value={form.dueTime}
                      onChange={(e) => set('dueTime', e.target.value)}
                      onClick={openPicker}
                    />
                    <label className="flabel" htmlFor="dt">
                      <span className="lglyph" aria-hidden="true">
                        <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="24" cy="24" r="17" fill="none" stroke="#5A6675" strokeWidth="3.5" />
                          <line x1="24" y1="24" x2="24" y2="13" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                          <line x1="24" y1="24" x2="32" y2="28" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                        </svg>
                      </span>
                      Due Time <span className="subnote">(optional)</span>
                    </label>
                    {form.dueTime.trim() !== '' && (
                      <button
                        type="button"
                        className="fclear"
                        aria-label="Clear Due Time"
                        onClick={(e) => {
                          e.stopPropagation()
                          set('dueTime', '')
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                </div>

                <div className="fgroup frow">
                  <span className="ffloat picker native">
                    <input
                      className={`finput${form.doneDate.trim() === '' ? ' opt' : ''}`}
                      id="dnd"
                      type="date"
                      value={form.doneDate}
                      onChange={(e) => set('doneDate', e.target.value)}
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
                      className={`finput${form.doneTime.trim() === '' ? ' opt' : ''}`}
                      id="dnt"
                      type="time"
                      value={form.doneTime}
                      onChange={(e) => set('doneTime', e.target.value)}
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
                    {form.doneTime.trim() !== '' && (
                      <button
                        type="button"
                        className="fclear"
                        aria-label="Clear Done Time"
                        onClick={(e) => {
                          e.stopPropagation()
                          set('doneTime', '')
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                </div>
              </>
            ) : (
              /* Due/Done Time turned off (migration 019, 2026-08-13) — the
                 two two-value rows above collapse into one combined row,
                 matching ToDo Detail's own Due Date/Done Date row exactly.
                 due_time/done_time already on the record, if any, stay in
                 the database untouched — same "hidden, not dropped"
                 convention as Category — they just aren't shown or edited
                 here until the account turns this back on. */
              <div className="fgroup frow">
                <span className="ffloat picker native">
                  <input
                    className={`finput req${isOverdue ? ' overdue-date' : ''}`}
                    id="dd"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => set('dueDate', e.target.value)}
                    onClick={openPicker}
                  />
                  <label className="flabel" htmlFor="dd">
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
                    Due Date
                  </label>
                </span>
                <span className="ffloat picker native">
                  <input
                    className={`finput${form.doneDate.trim() === '' ? ' opt' : ''}`}
                    id="dnd"
                    type="date"
                    value={form.doneDate}
                    onChange={(e) => set('doneDate', e.target.value)}
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
              </div>
            )}

            {/* Un-archive-on-clear advisory (owner request, 2026-08-17) —
                only shows when this Request was loaded already archived AND
                Done Date is currently empty (about to be cleared on Save).
                Save itself does the actual work — see handleSubmit's
                archived_at expression. */}
            {archivedAt !== null && form.doneDate.trim() === '' && (
              <p className="subnote">
                This Request will be returned to active status and will appear in your lists again once saved.
              </p>
            )}

            {/* Repeat (§6.42 PROPOSED) — available to every tier as of
                2026-08-27 (Jim's own wording: "up to 5 available, a
                subscription is unlimited"); Free's own occurrence cap is
                enforced server-side in cron Phase E, RepeatControl's tier
                prop only adds an informational note. Greyed until a Due
                Date is entered, or when this Request is archived — Jim's
                own spec. */}
            <RepeatControl
              rule={repeatRule}
              dueDate={form.dueDate}
              onSave={(rule) => {
                setRepeatRule(rule)
                setRepeatOccurrenceIndex((current) => current ?? 1)
              }}
              onRemove={() => setRepeatRule(null)}
              disabled={form.dueDate.trim() === '' || archivedAt !== null}
              disabledReason={
                archivedAt !== null
                  ? 'Repeats are not available for archived Requests.'
                  : 'Please select a Due Date before adding a Repeat.'
              }
              tier={tier}
            />

            {/* Category row — only when the account has turned Private
                Category on (migration 018, 2026-08-13). See
                CreateRequestForm.tsx's identical gate for the full
                reasoning. Note: if this particular Request already has a
                category_id from before the account turned it off, that
                value stays in the database untouched — it just isn't
                shown or editable here until Category is turned back on. */}
            {categoriesEnabled && (
              <div className="fgroup">
                <div className="frow" style={{ position: 'relative' }}>
                  <span className="ffloat">
                    <input
                      className={`finput${form.categoryName.trim() === '' ? ' opt' : ''}`}
                      id="cat"
                      type="text"
                      autoComplete="off"
                      placeholder=" "
                      value={form.categoryName}
                      onChange={(e) => {
                        set('categoryName', e.target.value)
                        if (selectedCategory && e.target.value !== selectedCategory.name) {
                          setSelectedCategory(null)
                        }
                        setCategoryBrowsing(false)
                        setShowCategoryResults(true)
                      }}
                      onFocus={(e) => {
                        e.target.select()
                        setCategoryBrowsing(true)
                        setShowCategoryResults(true)
                      }}
                      onBlur={() => setTimeout(() => setShowCategoryResults(false), 120)}
                    />
                    <label className="flabel" htmlFor="cat">
                      <span className="lglyph" aria-hidden="true">
                        <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                          <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                          <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                          <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                        </svg>
                      </span>
                      Private Category <span className="subnote">(optional)</span>
                    </label>
                  </span>
                  <button className="btn" type="button" onClick={openAddCategory}>
                    Add Category
                  </button>

                  {showCategoryResults && showCategoryDropdown && (
                    <div className="lookup-results" role="listbox">
                      {filteredCategories.length === 0 ? (
                        <div className="lookup-empty">
                          {categoryQueryEmpty ? 'No categories yet — use Add Category.' : 'No matching category — use Add Category.'}
                        </div>
                      ) : (
                        filteredCategories.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`lookup-item${selectedCategory?.id === c.id ? ' selected' : ''}`}
                            role="option"
                            aria-selected={selectedCategory?.id === c.id}
                            onMouseDown={() => selectCategory(c)}
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

            <div className={`fgroup${descInvalid ? ' is-invalid' : ''}`}>
              <div className="descwrap">
                <textarea
                  ref={descRef}
                  className="ftextarea ftextarea-plain ftextarea-autosize req"
                  id="desc"
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Request Description"
                  aria-label="Request Description"
                  value={form.description}
                  onChange={(e) => {
                    set('description', e.target.value)
                    if (descInvalid) setDescInvalid(false)
                  }}
                />
                {tier === 'subscriber' && voiceSupported && (
                  <button
                    type="button"
                    className={`micbtn${descDictating ? ' listening' : ''}`}
                    aria-label={descDictating ? 'Stop voice dictation' : 'Start voice dictation'}
                    onClick={toggleDescDictation}
                  >
                    <MicIcon />
                  </button>
                )}
              </div>
              {descInvalid && <p className="ferror">Enter a Description.</p>}
              <p className={`charcount${form.description.length >= DESCRIPTION_MAX ? ' limit' : ''}`}>
                {form.description.length} / {DESCRIPTION_MAX}
              </p>
            </div>

            {/* Dialog — existing thread, read live from the database. Add
                Dialog writes immediately (not staged for Send) since this
                Request already exists. Simplified empty-state row (§6.32,
                2026-08-11): with no entries, a single .frow — .actlabel +
                Add Dialog — replaces the old always-shown .panel with its
                "No Dialog entries yet." placeholder text. */}
            <div className="fgroup">
              {sortedDialog.length === 0 ? (
                <div className="frow">
                  <span className="actlabel">
                    Questions, Answers, Comments <span className="subnote">(optional)</span>
                  </span>
                  <button className="btn" type="button" onClick={openDialogModal}>
                    Add Dialog
                  </button>
                </div>
              ) : (
                <>
                  <div className="fieldact">
                    <button className="btn" type="button" onClick={openDialogModal}>
                      Add Dialog
                    </button>
                  </div>
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
                </>
              )}
            </div>

            {/* Attachments (Week 5 Priority 3, 2026-08-14) — real upload/
                list/delete via AttachmentsPanel. Free-with-a-storage-cap
                as of 2026-08-27 (was subscriber-only) — canAdd is now
                always true; extraNote surfaces the Free-tier 100 MB
                allowance before the owner hits it (re-checked server-side
                regardless). */}
            <AttachmentsPanel
              requestId={requestId}
              mode="file"
              canAdd={true}
              extraNote={tier !== 'subscriber' ? '100 MB total' : null}
              authToken={authToken}
              recipientToken={null}
              isOwner={true}
              currentUserId={currentUserId}
              ownerLabel={ownerName ?? 'You'}
              showCarryToggle={repeatRule !== null}
            />

            {/* Request<->ToDo conversion (2026-08-26) — see
                ConversionBanner.tsx's own header comment. */}
            <ConversionBanner
              direction="request-to-todo"
              sourceType="owned"
              sourceId={requestId}
              isDone={form.doneDate.trim() !== ''}
              description={form.description}
              categoryName={selectedCategory?.name ?? null}
              categoriesEnabled={categoriesEnabled}
              dueDate={form.dueDate.trim() === '' ? null : form.dueDate}
              dialogEntries={dialogList.map((e) => ({
                id: e.id,
                kind: e.kind,
                body: e.body,
                who: e.who,
                repliesToId: e.replies_to_id,
              }))}
              attachmentCount={printAttachments.length}
              canCopyAttachments={tier === 'subscriber'}
            />

            {error && (
              <p className="ferror" role="alert" style={{ marginTop: 4 }}>
                {error}
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
        {tier !== 'subscriber' && (
          <div className="adslot" aria-hidden="true">
            <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
          </div>
        )}

        {addCategoryOpen && (
          <>
            <div className="scrim" onClick={() => setAddCategoryOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="addcat-title">
              <p className="modal-title" id="addcat-title">
                Add Category
              </p>
              <div className={`fgroup ffloat${categoryError ? ' is-invalid' : ''}`}>
                <input
                  className="finput"
                  id="newcat"
                  type="text"
                  autoComplete="off"
                  placeholder=" "
                  value={newCategoryName}
                  onChange={(e) => {
                    setNewCategoryName(e.target.value)
                    if (categoryError) setCategoryError(null)
                  }}
                  autoFocus
                />
                <label className="flabel" htmlFor="newcat">
                  Category Name
                </label>
              </div>
              {categoryError && <p className="ferror" style={{ marginTop: -8 }}>{categoryError}</p>}
              <div className="modalacts">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setAddCategoryOpen(false)}
                  disabled={categorySaving}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleAddCategorySave}
                  disabled={categorySaving}
                >
                  {categorySaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
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

              {/* Owner-reported (2026-08-10, found testing Request Response,
                  same logic applies here): after answering one of two open
                  Questions, reopening Add Dialog and picking Answer showed
                  nothing — the remaining single open Question was linked
                  silently, with no visual confirmation of which one.
                  Originally scoped (2026-08-07) to show only when more than
                  one Question was open; relaxed to any open Question (>0),
                  so composing an Answer always confirms what it's answering.
                  Follow-up (same day, same source): a single open Question's
                  row already renders .selected, the identical treatment a
                  multi-row picker uses for "the one you've clicked" — so the
                  .subnote below only appears in the single-question case,
                  where it's true and disambiguating. */}
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
                  {tier === 'subscriber' && voiceSupported && (
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

      {/* Single-item print (2026-08-15) — same .print-report/.prow shape
          MainScreen.tsx's own Print Reports use for a whole section, "the
          same format... used for the single item" (owner). Column-header
          row added same day (owner-reported missing entirely) — plain
          static labels, no sort arrow, since there's nothing to sort with
          only one record. Uses .detail3 (To/Due/Done, no separate Date
          column) rather than .pcolbar.psr's 4-column template — see that
          class's own comment in globals.css for the layout bug this also
          fixed. .no-print/@media print above make this the only thing
          visible when printing, same mechanism as Main Screen. */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">Request Detail</div>
          <div className="pcolbar detail3">
            <span className="namecell">
              <span className="c-nm">To</span>
              <span className="c-desc">Description</span>
            </span>
            <span className="c-due">Due</span>
            <span className="c-dn">Done</span>
          </div>
          <div className="prows">
            {(() => {
              const status = form.doneDate ? 'done' : form.dueDate && form.dueDate < todayIso() ? 'overdue' : 'open'
              return (
                <div className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                  <div className="pr1 detail3">
                    <span className="pnm">{recipientName || '—'}</span>
                    <span className="pdue">
                      {formatMDYSlash(form.dueDate || null)}
                      {requestTimeEnabled && form.dueTime && <span className="ptime">{'  '}{formatTime12h(form.dueTime)}</span>}
                    </span>
                    <span className="pdn">
                      {formatMDYSlash(form.doneDate || null)}
                      {requestTimeEnabled && form.doneTime && <span className="ptime">{'  '}{formatTime12h(form.doneTime)}</span>}
                    </span>
                  </div>
                  <div className="pr2">
                    <span className="pdesc">
                      {categoriesEnabled && categoryPrefix(form.categoryName)}
                      {form.description}
                    </span>
                  </div>
                  <PrintRepeatLine rule={repeatRule} dueDate={form.dueDate} />
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
