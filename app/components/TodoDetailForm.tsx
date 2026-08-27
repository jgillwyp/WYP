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
 * ToDo Detail (§9.4) — converted from
 * design/screens/WYP_todo_detail_palette1.html. Started as a byte-for-byte
 * duplicate of Create ToDo (owner's original instruction); two deviations
 * were added going live (2026-08-09), both because this screen views an
 * EXISTING ToDo rather than drafting a new one — see that mockup's file
 * header comment for the fuller reasoning:
 *
 * 1. Done Date/Time — owner-confirmed via AskUserQuestion, since otherwise
 *    there'd be no way to mark a ToDo Done through the UI at all.
 * 2. Dialog panel shows the EXISTING thread (dynamic Answer unlocking, which-
 *    Question picker) instead of Create ToDo's blank staged list — same
 *    reasoning as Request Detail, applied without a separate ask since it
 *    follows directly from the same "Detail screens show real data" logic.
 *
 * HARD DEPENDENCY: selects `dialog.replies_to_id` (migration 006) — see
 * RequestDetailForm.tsx's identical note.
 *
 * profiles.todo_dates_enabled (migration 022, 2026-08-14) — off by default;
 * see CreateTodoForm.tsx's identical gate for the full reasoning. Off
 * collapses the quick-Done band and Due/Done Date row into a single §6.35
 * Status chip row (Open/Done). Unlike Create ToDo, this screen can load an
 * EXISTING done_date — the initial Status shown is derived from it once, on
 * load (Open if empty, Done if not); leaving Status on "Done" for an
 * already-done ToDo and saving preserves that original done_date rather
 * than overwriting it to today, matching the "hidden, not clobbered"
 * convention this app already uses for Category/Due Time elsewhere.
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

type TodoFormState = {
  priority: 1 | 2 | 3
  dueDate: string
  doneDate: string
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

// 2026-08-17 — single-item print's new Priority column needs the same
// label the chip UI already renders as literal text ("ASAP"/"SOON"/
// "LATER"); no shared constant existed for it in this file until now.
const PRIORITY_LABEL: Record<number, string> = { 1: 'ASAP', 2: 'SOON', 3: 'LATER' }

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

function categoryPrefix(name: string | null | undefined): string {
  return name ? `[${name}] ` : ''
}

// Same shape as MainScreen.tsx's own PrintAttachmentEntry — ToDos now use
// kind='file' real Attachments (2026-08-26), same as Requests, so this type
// is a byte-for-byte copy of RequestDetailForm.tsx's own rather than
// narrowed to the old reference-only shape.
type PrintAttachmentEntry = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  reference_url: string | null
  reference_note: string | null
}

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

// "Repeats: ..." print line — same shared builder and placement rule
// (preceding Dialog) as CreateRequestForm.tsx/RequestDetailForm.tsx's
// identical copies.
function PrintRepeatLine({ rule, dueDate }: { rule: RepeatRule | null; dueDate: string }) {
  if (!rule || !dueDate) return null
  return (
    <div className="prepeat">
      <span className="prepeathead">Repeats:</span> {describeRepeat(rule, dueDate)}
    </div>
  )
}

// Local calendar date as "YYYY-MM-DD", matching the native date input's own
// value format — mirrors CreateTodoForm.tsx's identical helper.
function todayISODate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

export default function TodoDetailForm() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const todoId = params.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [form, setForm] = useState<TodoFormState>({
    priority: 1,
    dueDate: '',
    doneDate: '',
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
  // §6.35 Status toggle (migration 022) — see the file-level comment.
  // todoStatus is derived from the loaded done_date once, in the load
  // effect below (open if empty, done if not) — it does not live-track
  // form.doneDate afterward, since when this is off the Due/Done Date
  // fields it would otherwise sync with aren't rendered at all.
  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)
  // profiles.todo_reminders_enabled (migration 041, 2026-08-22) — see
  // AccountForm.tsx's identical gate.
  const [todoRemindersEnabled, setTodoRemindersEnabled] = useState(false)
  // reminder_sent_at (shared with Requests, already read by the cron
  // route's own Phase A2) — "already sent" grey-out for Day before, same
  // rule as RequestDetailForm.tsx's identical addition. reminderDayOfSentAt
  // (migration 042, 2026-08-22) is the identical marker for "Day of."
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null)
  const [reminderDayOfSentAt, setReminderDayOfSentAt] = useState<string | null>(null)
  const [todoStatus, setTodoStatus] = useState<'open' | 'done'>('open')
  // Un-archive-on-clear (owner request, 2026-08-17) — the row's own
  // archived_at as loaded, carried unchanged through Save unless Done
  // Date is being cleared this Save (see handleSubmit). Not itself
  // editable — there's no Archive/Un-archive control on this screen,
  // only the side-effect of clearing Done Date (or, with Due/Done Dates
  // off, switching the Status chip back to Open).
  const [archivedAt, setArchivedAt] = useState<string | null>(null)
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

  const doneDateRef = useRef<HTMLInputElement>(null)

  // Auto-growing Description (2026-08-19, owner request) — see
  // RequestDetailForm.tsx's identical descRef effect for the full
  // reasoning (Create ToDo's fresh-typed-and-scrolls case is unaffected by
  // this, per the owner's own scoping).
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
  // profiles.tier). Dialog Text gets its own independent dictating/
  // recognitionRef pair further down, since the two fields could
  // theoretically both want to dictate.
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

  // Attachments (2026-08-26, formerly Locations) — AttachmentsPanel does
  // its own fetching once these are known.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  // Date created — read-only, print-only (2026-08-17). Not part of `form`
  // since it's never editable/saved; same pattern as ownerName/tier above.
  // Needed for the single-item print's new Priority/Date/[Due]/Done first
  // line, matching Main Screen's/Archive's own ToDos print redesign.
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  // Repeat (Jim's own recurrence-method design, 2026-08-21) — same
  // rule/occurrence-index pair as RequestDetailForm.tsx's own copy.
  const [repeatRule, setRepeatRule] = useState<RepeatRule | null>(null)
  const [repeatOccurrenceIndex, setRepeatOccurrenceIndex] = useState<number | null>(null)

  // Print (2026-08-15) — same reasoning/pattern as RequestDetailForm.tsx's
  // identical addition. dialogList already has everything Dialog needs;
  // Attachments need their own small fetch since AttachmentsPanel keeps its
  // own list private.
  const [printAttachments, setPrintAttachments] = useState<PrintAttachmentEntry[]>([])
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  function set<K extends keyof TodoFormState>(key: K, value: TodoFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Close/Cancel label (2026-08-20) — same pattern as RequestDetailForm.tsx/
  // ResponseDetailForm.tsx's identical addition: a snapshot of every field
  // Save actually writes, taken once on load, compared live on every
  // render. Includes todoStatus alongside form's own fields — when
  // todoDatesEnabled is off, that's the only thing the Status chips change;
  // when it's on, todoStatus never moves from its load-time value (nothing
  // else sets it while the chips aren't rendered), so it's a harmless
  // always-equal comparison in that case rather than a special-cased one.
  // Dialog/Attachments/Locations excluded — same reasoning as the other two
  // screens, both already write immediately and independently of Cancel.
  const initialFormRef = useRef<{
    priority: 1 | 2 | 3
    dueDate: string
    doneDate: string
    categoryId: string | null
    description: string
    todoStatus: 'open' | 'done'
    repeatRule: RepeatRule | null
    reminderEnabled: boolean
    reminderDayOfEnabled: boolean
    overdueReminderEnabled: boolean
  } | null>(null)
  const hasChanges =
    initialFormRef.current !== null &&
    (form.priority !== initialFormRef.current.priority ||
      form.dueDate !== initialFormRef.current.dueDate ||
      form.doneDate !== initialFormRef.current.doneDate ||
      form.description !== initialFormRef.current.description ||
      todoStatus !== initialFormRef.current.todoStatus ||
      (selectedCategory?.id ?? null) !== initialFormRef.current.categoryId ||
      JSON.stringify(repeatRule) !== JSON.stringify(initialFormRef.current.repeatRule) ||
      form.reminderEnabled !== initialFormRef.current.reminderEnabled ||
      form.reminderDayOfEnabled !== initialFormRef.current.reminderDayOfEnabled ||
      form.overdueReminderEnabled !== initialFormRef.current.overdueReminderEnabled)

  // Quick-Done band (§6.31) — added 2026-08-11, matching CreateTodoForm.tsx's
  // identical handleQuickDone: this screen never got the band ported over
  // when Create ToDo gained it 2026-08-10 (that batch was scoped to Create
  // ToDo only), a real gap the owner caught testing the live screen. Fills
  // Done Date with today only — no Done Time to leave untouched, ToDos
  // don't have one.
  function handleQuickDone() {
    set('doneDate', todayISODate())
    doneDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ToDo Reminders (migration 041, 2026-08-22) — same shape as
  // RequestDetailForm.tsx's own reminderBanner, minus the Contact-related
  // states a ToDo doesn't have. reminderArchived reuses this screen's own
  // archivedAt (already fetched for the un-archive-on-clear feature);
  // reminderAlreadySent reuses reminderSentAt, the same column the cron
  // route's own ToDo Reminder phase already reads/writes.
  const todoReminderArchived = archivedAt !== null
  const todoReminderPrereqsMissing = form.dueDate.trim() === ''
  const todoReminderIneligible = !todoReminderPrereqsMissing && !isReminderEligible(form.dueDate)
  const todoReminderAlreadySent = reminderSentAt !== null
  const todoReminderDisabled =
    todoReminderArchived || todoReminderPrereqsMissing || todoReminderIneligible || todoReminderAlreadySent
  const todoReminderTooltip = todoReminderArchived
    ? 'Reminders are not available for archived ToDos.'
    : todoReminderPrereqsMissing
      ? 'Please select a Due Date before modifying the Reminder.'
      : todoReminderIneligible
        ? 'A Reminder is not available due to the short lead time.'
        : todoReminderAlreadySent
          ? 'The day-before Reminder has already been sent for this ToDo.'
          : undefined

  // "Day of" (migration 042, 2026-08-22) — no lead-time eligibility floor;
  // the only prereqs are a Due Date and not-yet-archived. todoDayOfAlreadySent
  // mirrors todoReminderAlreadySent's own shape, keyed off the independent
  // reminder_day_of_sent_at column.
  const todoDayOfAlreadySent = reminderDayOfSentAt !== null
  const todoDayOfDisabled = todoReminderArchived || todoReminderPrereqsMissing || todoDayOfAlreadySent
  const todoDayOfTooltip = todoReminderArchived
    ? 'Reminders are not available for archived ToDos.'
    : todoReminderPrereqsMissing
      ? 'Please select a Due Date before modifying the Reminder.'
      : todoDayOfAlreadySent
        ? 'The day-of Reminder has already been sent for this ToDo.'
        : undefined

  const todoOverdueReminderDone = form.doneDate.trim() !== ''
  const todoOverdueReminderDisabled = todoReminderArchived || todoOverdueReminderDone
  const todoOverdueReminderTooltip = todoReminderArchived
    ? 'Reminders are not available for archived ToDos.'
    : todoOverdueReminderDone
      ? 'This ToDo is already marked Done.'
      : undefined

  function todoReminderBanner() {
    return (
      <div className="reminderbanner">
        <p className="reminderbanner-title">Reminders until Done</p>
        <div className="reminderbanner-items">
          <label
            className={`reminderitem${todoReminderDisabled ? ' reminderitem-disabled' : ''}`}
            title={todoReminderTooltip}
          >
            <input
              type="checkbox"
              checked={form.reminderEnabled}
              disabled={todoReminderDisabled}
              onChange={(e) => set('reminderEnabled', e.target.checked)}
            />
            <span>Day before</span>
          </label>
          <label
            className={`reminderitem${todoDayOfDisabled ? ' reminderitem-disabled' : ''}`}
            title={todoDayOfTooltip}
          >
            <input
              type="checkbox"
              checked={form.reminderDayOfEnabled}
              disabled={todoDayOfDisabled}
              onChange={(e) => set('reminderDayOfEnabled', e.target.checked)}
            />
            <span>Day of</span>
          </label>
          <label
            className={`reminderitem${todoOverdueReminderDisabled ? ' reminderitem-disabled' : ''}`}
            title={todoOverdueReminderTooltip}
          >
            <input
              type="checkbox"
              checked={form.overdueReminderEnabled}
              disabled={todoOverdueReminderDisabled}
              onChange={(e) => set('overdueReminderEnabled', e.target.checked)}
            />
            <span>Day after</span>
          </label>
        </div>
      </div>
    )
  }

  async function loadDialog() {
    const { data } = await supabase
      .from('dialog')
      .select('id, kind, body, who, created_at, replies_to_id')
      .eq('request_id', todoId)
      .order('id')
    setDialogList((data as unknown as DialogEntry[]) ?? [])
  }

  function startPrint() {
    setShowPrint(true)
    // See RequestDetailForm.tsx's identical fix for the full write-up —
    // printTick guarantees a real dependency change on every click, even
    // when showPrint was already stuck true from a previous print whose
    // 'afterprint' never fired.
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
    if (!todoId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [todoRes, catRes, ownerRes, attRes] = await Promise.all([
        supabase
          .from('requests')
          .select(
            'id, description, priority, due_date, done_date, created_at, category_id, archived_at, repeat_rule, repeat_occurrence_index, reminder_enabled, overdue_reminder_enabled, reminder_sent_at, reminder_day_of_enabled, reminder_day_of_sent_at, categories(name)'
          )
          .eq('id', todoId)
          .single(),
        supabase.from('categories').select('id, name').order('name'),
        supabase
          .from('profiles')
          .select('display_name, private_category_enabled, todo_dates_enabled, todo_reminders_enabled, tier')
          .single(),
        // Print (2026-08-15) — same reasoning as RequestDetailForm.tsx's
        // identical addition.
        supabase
          .from('attachments')
          .select('id, kind, file_name, reference_url, reference_note')
          .eq('request_id', todoId)
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

      if (todoRes.error || !todoRes.data) {
        setLoadError(todoRes.error?.message ?? 'Could not load this ToDo.')
        setLoading(false)
        return
      }

      type Row = {
        description: string
        priority: number | null
        due_date: string | null
        done_date: string | null
        created_at: string
        category_id: string | null
        archived_at: string | null
        repeat_rule: RepeatRule | null
        repeat_occurrence_index: number | null
        reminder_enabled: boolean
        overdue_reminder_enabled: boolean
        reminder_sent_at: string | null
        reminder_day_of_enabled: boolean
        reminder_day_of_sent_at: string | null
        categories: { name: string } | null
      }
      const row = todoRes.data as unknown as Row

      setForm({
        priority: (row.priority as 1 | 2 | 3) ?? 1,
        dueDate: row.due_date ?? '',
        doneDate: row.done_date ?? '',
        categoryName: row.categories?.name ?? '',
        description: row.description ?? '',
        reminderEnabled: row.reminder_enabled,
        reminderDayOfEnabled: row.reminder_day_of_enabled,
        overdueReminderEnabled: row.overdue_reminder_enabled,
      })
      setCreatedAt(row.created_at)
      if (row.category_id && row.categories) {
        setSelectedCategory({ id: row.category_id, name: row.categories.name })
      }
      setCategories(catRes.data ?? [])
      setOwnerName(ownerRes.data?.display_name ?? null)
      setCategoriesEnabled(ownerRes.data?.private_category_enabled ?? false)
      setTodoDatesEnabled(ownerRes.data?.todo_dates_enabled ?? false)
      setTodoRemindersEnabled(ownerRes.data?.todo_reminders_enabled ?? false)
      setReminderSentAt(row.reminder_sent_at)
      setReminderDayOfSentAt(row.reminder_day_of_sent_at)
      setTier(ownerRes.data?.tier === 'subscriber' ? 'subscriber' : 'free')
      const initialTodoStatus = row.done_date ? 'done' : 'open'
      setTodoStatus(initialTodoStatus)
      setArchivedAt(row.archived_at)
      setRepeatRule(row.repeat_rule)
      setRepeatOccurrenceIndex(row.repeat_occurrence_index)
      initialFormRef.current = {
        priority: (row.priority as 1 | 2 | 3) ?? 1,
        dueDate: row.due_date ?? '',
        doneDate: row.done_date ?? '',
        categoryId: row.category_id ?? null,
        description: row.description ?? '',
        todoStatus: initialTodoStatus,
        repeatRule: row.repeat_rule,
        reminderEnabled: row.reminder_enabled,
        reminderDayOfEnabled: row.reminder_day_of_enabled,
        overdueReminderEnabled: row.overdue_reminder_enabled,
      }

      await loadDialog()
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoId])

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
      request_id: todoId,
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!validate()) return

    setSaving(true)

    // §6.35 Status (migration 022) — when todoDatesEnabled is off, done_date
    // is driven by the Open/Done chip rather than the (unrendered) Done Date
    // field: Done sets it to today only if it wasn't already set (an
    // existing done_date is preserved as-is, not overwritten); Open clears
    // it. due_date is left completely untouched either way in this state —
    // it's simply not shown or editable, same "hidden, not cleared"
    // convention as Category/Due Time elsewhere in this app.
    const effectiveDoneDate = todoDatesEnabled
      ? (form.doneDate.trim() === '' ? null : form.doneDate)
      : (todoStatus === 'done' ? (form.doneDate.trim() === '' ? todayISODate() : form.doneDate) : null)

    const { error: updateError } = await supabase
      .from('requests')
      .update({
        priority: form.priority,
        due_date: form.dueDate.trim() === '' ? null : form.dueDate,
        done_date: effectiveDoneDate,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
        repeat_rule: repeatRule,
        repeat_occurrence_index: repeatRule ? (repeatOccurrenceIndex ?? 1) : null,
        reminder_enabled: form.reminderEnabled,
        reminder_day_of_enabled: form.reminderDayOfEnabled,
        overdue_reminder_enabled: form.overdueReminderEnabled,
        // Un-archive-on-clear (owner request, 2026-08-17): a ToDo that was
        // archived returns to active status the moment Done Date is
        // cleared — whether that happens via the plain Done Date field
        // (todoDatesEnabled on) or the Status chip switching back to Open
        // (todoDatesEnabled off), both of which effectiveDoneDate already
        // reduces to null. Preserved unchanged otherwise, including the
        // harmless case where archivedAt is already null.
        archived_at: effectiveDoneDate === null ? null : archivedAt,
      })
      .eq('id', todoId)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    // router.back(), not push('/') — see RequestDetailForm.tsx's identical
    // comment. This screen is only ever reached by clicking a ToDo row on
    // the Main Screen, so back() restores that screen's scroll position
    // instead of landing at the top.
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
              aria-label="Print ToDo"
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
          <span className="glabel">ToDo Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="todo-detail-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={saving}>
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
          </span>
        </div>

        <div className="scroll">
          <form className="form" id="todo-detail-form" onSubmit={handleSubmit} noValidate>

            <div className="fgroup">
              <span className="flabel" id="pri-label">Priority</span>
              <div className="chippair" role="radiogroup" aria-labelledby="pri-label">
                <button
                  className={`chip${form.priority === 1 ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={form.priority === 1}
                  onClick={() => set('priority', 1)}
                >
                  ASAP
                </button>
                <button
                  className={`chip${form.priority === 2 ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={form.priority === 2}
                  onClick={() => set('priority', 2)}
                >
                  SOON
                </button>
                <button
                  className={`chip${form.priority === 3 ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={form.priority === 3}
                  onClick={() => set('priority', 3)}
                >
                  LATER
                </button>
              </div>
            </div>

            {todoDatesEnabled ? (
              <>
                {/* Quick-Done band (§6.31, added here 2026-08-11) — same
                    "donerow"/"donenote" pattern as Create ToDo and Request
                    Response, purely reactive to whether Done Date already holds
                    a value, however it got there. Owner's own wording, verbatim,
                    matching Create ToDo's. */}
                <div className="donerow">
                  <span className="donenote">
                    {form.doneDate.trim() === '' ? (
                      <><b>Note:</b> To quickly complete this ToDo, click Done and Save.</>
                    ) : (
                      'This ToDo is now marked as Done.'
                    )}
                  </span>
                  <button
                    className="btn"
                    type="button"
                    onClick={handleQuickDone}
                    disabled={form.doneDate.trim() !== ''}
                  >
                    Done
                  </button>
                </div>

                {/* ToDo Reminders panel (migration 041, 2026-08-22) — shown
                    above the Due/Done Dates row, per the owner's own
                    instruction, only once the account has both Show
                    Due/Done Dates (ToDos) and Add Reminders (ToDos) turned
                    on. */}
                {todoRemindersEnabled && todoReminderBanner()}

                {/* Due Date + Done Date, combined into one row 2026-08-10 (owner's
                    own rough draft) — both optional (.opt, grey while empty,
                    white once filled, same §6.25 rule as every other optional
                    field), side by side rather than each on its own row. No
                    Done Time — "the ToDos do not need Done Time," unlike a
                    Request's Done Date/Time pair, which keeps its Time field. */}
                <div className="fgroup frow">
                  <span className="ffloat picker native">
                    <input
                      className={`finput${form.dueDate.trim() === '' ? ' opt' : ''}`}
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
                      Due Date <span className="subnote">(optional)</span>
                    </label>
                  </span>
                  <span className="ffloat picker native">
                    <input
                      ref={doneDateRef}
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
              </>
            ) : (
              /* §6.35 PROPOSED Status row (migration 022, 2026-08-14) — matches
                 the owner's pasted ToDo Detail mockup exactly. Reuses
                 .sendrow+.chippair+.gatenote verbatim, same combo
                 AddContactForm.tsx already uses for Send Requests By. */
              <div className="fgroup">
                <span className="flabel" id="status-label">Status</span>
                <div className="sendrow">
                  <div className="chippair" role="radiogroup" aria-labelledby="status-label">
                    <button
                      className={`chip${todoStatus === 'open' ? ' selected' : ''}`}
                      type="button"
                      aria-pressed={todoStatus === 'open'}
                      onClick={() => setTodoStatus('open')}
                    >
                      Open
                    </button>
                    <button
                      className={`chip${todoStatus === 'done' ? ' selected' : ''}`}
                      type="button"
                      aria-pressed={todoStatus === 'done'}
                      onClick={() => setTodoStatus('done')}
                    >
                      Done
                    </button>
                  </div>
                  <div className="gatenote">
                    <b>Note:</b> To complete this ToDo, click Done and Save.
                  </div>
                </div>
              </div>
            )}

            {/* Un-archive-on-clear advisory (owner request, 2026-08-17) —
                only shows when this ToDo was loaded already archived AND
                Done Date is about to be cleared on Save (via the plain
                field when todoDatesEnabled is on, or the Status chip
                reading Open when it's off). Save itself does the actual
                work — see handleSubmit's archived_at expression. */}
            {archivedAt !== null &&
              (todoDatesEnabled ? form.doneDate.trim() === '' : todoStatus === 'open') && (
                <p className="subnote">
                  This ToDo will be returned to active status and will appear in your lists again once saved.
                </p>
              )}

            {/* Repeat (§6.42 PROPOSED, 2026-08-21) — hidden entirely for free
                tier and when Due/Done Dates is off, same gate as ToDo Detail's
                own CreateTodoForm.tsx counterpart. Greyed when archived (no
                Due Date to anchor generation on while inactive) or before a
                Due Date has been entered. */}
            {tier === 'subscriber' && todoDatesEnabled && (
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
                    ? 'Repeats are not available for archived ToDos.'
                    : 'Please select a Due Date before adding a Repeat.'
                }
              />
            )}

            {/* Category row — only when the account has turned Private
                Category on (migration 018, 2026-08-13). See
                CreateRequestForm.tsx's identical gate for the full
                reasoning, and RequestDetailForm.tsx's note on the
                already-set-category edge case. */}
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
                  className="ftextarea ftextarea-desc ftextarea-plain ftextarea-autosize req"
                  id="desc"
                  maxLength={DESCRIPTION_MAX}
                  placeholder="ToDo Description"
                  aria-label="ToDo Description"
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

            {/* Simplified empty-state row (§6.32, 2026-08-11): with no
                entries, a single .frow — .actlabel + Add Dialog — replaces
                the old always-shown .panel with its "No Dialog entries
                yet." placeholder text. */}
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

            {/* Attachments (2026-08-26) — real file upload via
                AttachmentsPanel (mode="file"), same mechanism Requests
                already use; ToDos are just requests rows with
                contact_id = null, so no schema/permission change was
                needed. Supersedes the old mode="reference" Locations UI —
                migration 048 folds any pre-existing Locations into this
                ToDo's own Description before this switch takes effect. */}
            <AttachmentsPanel
              requestId={todoId}
              mode="file"
              canAdd={tier === 'subscriber'}
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
              direction="todo-to-request"
              sourceType="owned"
              sourceId={todoId}
              isDone={todoDatesEnabled ? form.doneDate.trim() !== '' : todoStatus === 'done'}
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

        <div className="subbanner" role="button" tabIndex={0}>
          See Subscription Features and Other Options
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

      {/* Single-item print, redesigned 2026-08-17 for consistency with Main
          Screen's and Archive's own ToDos print reports (same day's earlier
          batch) — supersedes the 2026-08-15 shape (Description first, no
          Priority column at all, Due/Done as a second .pr1.ptd line), which
          had the identical "missing Priority value" gap those two reports
          were just fixed for. Reuses .pcolbar.pdcols/.pr1.pdcols verbatim —
          same Priority/Date/[Due]/Done first line as the list reports, just
          without a sort arrow (nothing to sort with one record, same
          reasoning as RequestDetailForm.tsx's own header row). Date here is
          this ToDo's own created_at (newly fetched — see the `Row` type
          above), matching the list reports' "Date created is always shown"
          rule rather than being gated by todoDatesEnabled. */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">ToDo Detail</div>
          <div className={`pcolbar pdcols${todoDatesEnabled ? ' wide' : ''}`}>
            <span className="namecell">
              <span>Priority</span>
              <span className="c-desc">Description</span>
            </span>
            <span className="c-dt">Date</span>
            {todoDatesEnabled && <span className="c-due">Due</span>}
            <span className="c-dn">Done</span>
          </div>
          <div className="prows">
            {(() => {
              const status = todoDatesEnabled
                ? form.doneDate
                  ? 'done'
                  : form.dueDate && form.dueDate < todayISODate()
                    ? 'overdue'
                    : 'open'
                : todoStatus
              return (
                <div className={`prow${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                  <div className={`pr1 pdcols${todoDatesEnabled ? ' wide' : ''}`}>
                    <span className="ppri">{PRIORITY_LABEL[form.priority] ?? ''}</span>
                    <span className="pdt">{formatMDY(createdAt)}</span>
                    {todoDatesEnabled && <span className="pdue">{formatMDY(form.dueDate || null)}</span>}
                    <span className="pdn">{formatMDY(form.doneDate || null)}</span>
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
