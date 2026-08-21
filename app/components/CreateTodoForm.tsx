'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import RepeatControl from './RepeatControl'
import { supabase } from '@/lib/supabaseClient'
import { insertAttachmentReference } from '@/lib/attachmentsClient'
import { urlLocationHref } from '@/lib/attachments'
import { type RepeatRule } from '@/lib/repeatRule'

/**
 * Create ToDo (§9.4) — converted by hand from
 * design/screens/WYP_create_todo_palette1.html, following CreateRequestForm.tsx's
 * conventions exactly (Category lookup + Add Category modal, Add Dialog modal
 * with staged entries written on Save) minus what a ToDo doesn't have —
 * Recipient — plus what only a ToDo has: the Priority chip row.
 *
 * Due Date added 2026-08-10, closing out Week 3's last open item — optional,
 * unlike a Request's required Due Date: `requests.due_date` is already a
 * plain nullable `date` column (no `not null`, confirmed in
 * `docs/Week2 - SQL history.txt`), and every screen that reads it already
 * handles a null value correctly (Main Screen's sort/format, Request
 * Detail/ToDo Detail's own display) — no sentinel value or SQL workaround
 * needed for "no due date" to mean exactly that in the database. Uses the
 * same `.opt` Row-Tint-while-empty treatment as Done Date elsewhere, not the
 * Ink-bordered `.req` styling Create Request's own (required) Due Date uses.
 *
 * Done Date added the same day, alongside Due Date — owner: "the reason a
 * Create ToDo should allow a Done Date is to allow completed ToDos to be
 * entered if desired." Both fields sit in one combined row (owner's own
 * rough draft), both `.opt`. No Done Time — "the ToDos do not need Done
 * Time" — unlike a Request's Done Date/Time pair, which keeps its Time
 * field; ToDo Detail's own Done Time was removed the same day for the same
 * reason.
 *
 * Quick-Done band added 2026-08-10 (owner's own rough draft, pasted in) —
 * mirrors Request Response's `.donerow`/`.donenote` (§6.31): a "Done" button
 * that fills Done Date with today, purely reactive to whether Done Date
 * already holds a value however it got there. Owner's own wording, used
 * verbatim: active "Note: To quickly complete this ToDo, click Done and
 * Save." / inactive "This ToDo is now marked as Done." (reworded 2026-08-17
 * — owner-reported, "just click Save" read as if the user still needed to
 * take a Save-related action; the state is already saved once Done Date
 * holds a value). Sets Done Date only — there's no Done Time on a ToDo to
 * touch.
 *
 * profiles.todo_dates_enabled (migration 022, 2026-08-14) — off by default,
 * continuing the "Keep It as Simple as Possible" path started by migrations
 * 018/019. Off collapses the quick-Done band and Due/Done Date row above
 * into a single §6.35 Status chip row (Open/Done, `.sendrow`+`.chippair`+
 * `.gatenote` — the same combo AddContactForm.tsx already uses for its
 * Send Requests By picker, not a new component) — owner: "the Status
 * element as an Open or Done chip and an accompanying Note... it does not
 * seem that any database changes are needed" — Status is a UI-only
 * reinterpretation of done_date (Done sets it to today on Save if not
 * already set; Open clears it), not a new fact to store. due_date itself
 * is simply never shown or touched here in the off state — a brand-new
 * ToDo just has no Due Date until the account turns this back on. See
 * AccountForm.tsx.
 */

type Category = {
  id: string
  name: string
}

type TodoFormState = {
  priority: 1 | 2 | 3
  dueDate: string
  doneDate: string
  categoryName: string
  description: string
}

const initialState: TodoFormState = {
  // Owner: "the Create a ToDo should default the the 'Soon' Priority... the
  // appropriate Priority for a 'normal' ToDo — which can be changed by the
  // end-user to either ASAP or Later as they desire." 2 = SOON, matching
  // PRIORITY_LABEL's own numbering (MainScreen.tsx: 1=ASAP, 2=SOON, 3=LATER).
  priority: 2,
  dueDate: '',
  doneDate: '',
  categoryName: '',
  description: '',
}

const CATEGORY_CAP = 20
const LOOKUP_BROWSE_THRESHOLD = 12

// See CreateRequestForm.tsx's identical constants for the full reasoning
// (globals.css's ftextarea-plain/.charcount comment; owner request
// 2026-08-16 to drop the floating label on scrollable text boxes and cap
// Dialog Text to match Description).
const DESCRIPTION_MAX = 500
const DIALOG_MAX = 500

// Local calendar date as "YYYY-MM-DD", matching the native date input's own
// value format — built from Y/M/D components (not toISOString(), which is
// UTC and can land on the wrong day near midnight in most US time zones).
// Mirrors RequestResponseForm.tsx's identical helper.
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

// Voice dictation for Description (2026-08-19) — owner: "I see it as a good
// option for entry of the Description during a Create... it could be a
// subscription option." Browser-native (Web Speech API — Chrome/Edge/Safari
// ship SpeechRecognition or webkitSpeechRecognition; no vendor, no per-use
// cost), gated the same way Attachments/Locations already are, off the
// signed-in owner's own live `tier`. A minimal local type stands in for the
// real (non-standard, not part of TS's default DOM lib) SpeechRecognition
// API rather than reaching for `any`. Browser-support testing/fallback
// polish is deliberately deferred to post-Private-Testing (owner's own
// call) — for now the mic icon simply doesn't render when the API isn't
// present (voiceSupported below), computed in an effect rather than during
// render so server and first client render agree (no hydration mismatch),
// letting the feature honestly be described as "available if your browser
// supports it (and most do)" rather than assumed present. Duplicated per
// component (CreateRequestForm.tsx has its own copy) — same convention as
// openPicker/todayISODate above.
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

export default function CreateTodoForm() {
  const router = useRouter()

  const [form, setForm] = useState<TodoFormState>(initialState)

  // Private Category is now an opt-in account preference (migration 018,
  // 2026-08-13), off by default — see AccountForm.tsx and
  // CreateRequestForm.tsx's identical gate.
  const [categoriesEnabled, setCategoriesEnabled] = useState(false)
  // §6.35 Status toggle (migration 022) — see the file-level comment. A
  // brand-new ToDo always starts Open, matching form.doneDate's own empty
  // initial state; there's no existing done_date to derive an initial
  // 'done' status from here, unlike TodoDetailForm.tsx.
  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)
  const [todoStatus, setTodoStatus] = useState<'open' | 'done'>('open')
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)
  const [categoryBrowsing, setCategoryBrowsing] = useState(false)

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  type DialogEntry = { kind: 'question' | 'comment'; body: string }
  const [dialogEntries, setDialogEntries] = useState<DialogEntry[]>([])
  const [dialogModalOpen, setDialogModalOpen] = useState(false)
  const [dialogModalKind, setDialogModalKind] = useState<'question' | 'comment'>('question')
  const [dialogModalBody, setDialogModalBody] = useState('')
  const [dialogModalError, setDialogModalError] = useState<string | null>(null)
  const dialogTextRef = useRef<HTMLTextAreaElement>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)

  const [descInvalid, setDescInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Locations (Week 5 Priority 3, 2026-08-14) — a ToDo's own "Attachment
  // References" instead of real storage (owner's own proposal, decisions
  // log 2026-08-14): staged client-side, same reasoning as dialogEntries
  // above, then inserted directly (kind = 'reference' rows are allowed by
  // migration 025's RLS insert policy — no API route needed, unlike a
  // Request's real file uploads).
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  type LocationEntry = { description: string; location: string }
  const [stagedLocations, setStagedLocations] = useState<LocationEntry[]>([])
  const [locationFormOpen, setLocationFormOpen] = useState(false)
  const [locationDescription, setLocationDescription] = useState('')
  const [locationValue, setLocationValue] = useState('')
  const [locationError, setLocationError] = useState<string | null>(null)
  const [copiedLocationIndex, setCopiedLocationIndex] = useState<number | null>(null)

  // Repeat (Jim's own recurrence-method design, 2026-08-21) — same staged
  // pattern as CreateRequestForm.tsx's own copy. Gated on todoDatesEnabled
  // as well as tier — a ToDo with Due/Done Dates turned off has no Due Date
  // field for Repeat to anchor on. The carry-forward prompt asks about
  // staged Locations instead of staged Attachments, same "Dialog never
  // carries forward" wording.
  const [repeatRule, setRepeatRule] = useState<RepeatRule | null>(null)
  const [carryPromptOpen, setCarryPromptOpen] = useState(false)
  const [carryLocationIndexes, setCarryLocationIndexes] = useState<Set<number>>(new Set())

  // Voice dictation for Description (2026-08-19) — same feature and
  // reasoning as CreateRequestForm.tsx's own copy; see the module-level
  // comment on getSpeechRecognition() above for the full write-up.
  const [dictating, setDictating] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)

  // Dialog Text gets its own independent dictating/recognitionRef pair
  // (2026-08-20) — see CreateRequestForm.tsx's identical addition for the
  // full reasoning.
  const [dlgDictating, setDlgDictating] = useState(false)
  const dlgRecognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const doneDateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name')
      .order('name')
      .then(({ data }) => setCategories(data ?? []))

    supabase
      .from('profiles')
      .select('display_name, private_category_enabled, todo_dates_enabled, tier')
      .single()
      .then(({ data }) => {
        setOwnerName(data?.display_name ?? null)
        setCategoriesEnabled(data?.private_category_enabled ?? false)
        setTodoDatesEnabled(data?.todo_dates_enabled ?? false)
        setTier(data?.tier === 'subscriber' ? 'subscriber' : 'free')
      })
  }, [])

  // Voice dictation support check (2026-08-19) — see CreateRequestForm.tsx's
  // identical effect for the SSR/hydration reasoning. Stops any live
  // recognition on unmount.
  useEffect(() => {
    // Deferred a tick — see CreateRequestForm.tsx's identical effect for
    // why (react-hooks/set-state-in-effect, same fix PWAProvider.tsx's own
    // beforeinstallprompt listener satisfies via a real browser event).
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setVoiceSupported(getSpeechRecognition() !== null)
    })
    return () => {
      cancelled = true
      recognitionRef.current?.stop()
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

  function openDialogModal() {
    setDialogModalKind('question')
    setDialogModalBody('')
    setDialogModalError(null)
    setDialogModalOpen(true)
  }

  // Owner-reported (2026-08-10, on Request Response's Add Dialog, same
  // pattern here): the default chip on open gets focus in Dialog Text (the
  // textarea's own `autoFocus`), but clicking a different chip afterward
  // didn't move focus there too — `autoFocus` only fires on mount, not on
  // every re-render. This call is a no-op while the modal is still opening
  // (the textarea hasn't mounted yet, so the ref is null and `autoFocus`
  // handles that case as before); it only does something on a later,
  // in-modal chip click, which is exactly the case that needed it.
  function selectDialogKind(kind: 'question' | 'comment') {
    setDialogModalKind(kind)
    dialogTextRef.current?.focus()
  }

  function handleDialogModalSave() {
    const body = dialogModalBody.trim()
    if (body === '') {
      // Owner-reported, 2026-08-10: same focus-management gap as the
      // chip-switch fix, on this different trigger (Save with an empty
      // body rather than a chip click).
      setDialogModalError('Enter Dialog Text or Cancel.')
      dialogTextRef.current?.focus()
      return
    }
    setDialogEntries((entries) => [...entries, { kind: dialogModalKind, body }])
    setDialogModalOpen(false)
  }

  function removeDialogEntry(index: number) {
    setDialogEntries((entries) => entries.filter((_, i) => i !== index))
  }

  function saveStagedLocation() {
    const description = locationDescription.trim()
    const location = locationValue.trim()
    if (description === '' && location === '') {
      setLocationError('Enter a Location or Cancel.')
      return
    }
    setStagedLocations((entries) => [...entries, { description, location }])
    setLocationDescription('')
    setLocationValue('')
    setLocationError(null)
    setLocationFormOpen(false)
  }

  function removeStagedLocation(index: number) {
    setStagedLocations((entries) => entries.filter((_, i) => i !== index))
  }

  async function copyStagedLocation(index: number, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedLocationIndex(index)
      setTimeout(() => setCopiedLocationIndex((current) => (current === index ? null : current)), 1500)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — the path
      // is still fully visible to select/copy by hand.
    }
  }

  function set<K extends keyof TodoFormState>(key: K, value: TodoFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Voice dictation toggle (2026-08-19) — see CreateRequestForm.tsx's
  // identical handler for the full reasoning.
  function toggleDictation() {
    if (dictating) {
      recognitionRef.current?.stop()
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
      setForm((f) => ({
        ...f,
        description: f.description
          ? `${f.description} ${addition.trim()}`
          : addition.trim(),
      }))
    }
    recognition.onerror = () => {
      setDictating(false)
    }
    recognition.onend = () => {
      setDictating(false)
    }
    recognitionRef.current = recognition
    recognition.start()
    setDictating(true)
  }

  // Quick-Done band (2026-08-10) — same pattern as Request Response's
  // handleQuickDone: fills Done Date with today only, purely a local field
  // fill (Save is still the actual write). No Done Time to leave untouched
  // here — ToDos don't have one.
  function handleQuickDone() {
    set('doneDate', todayISODate())
    doneDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

    // Repeat carry-forward gate — same pattern as CreateRequestForm.tsx's
    // own copy, asking about staged Locations instead of staged Attachments.
    // Only interrupts Save once, and only when there's something to ask
    // about; carryPromptOpen guards against re-showing after the user has
    // already confirmed a selection and re-clicked Save.
    if (repeatRule && stagedLocations.length > 0 && !carryPromptOpen) {
      setCarryLocationIndexes(new Set(stagedLocations.map((_, i) => i)))
      setCarryPromptOpen(true)
      return
    }

    await doSubmit()
  }

  async function doSubmit() {
    setSaving(true)

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('Your session has expired. Sign in again and retry.')
      setSaving(false)
      return
    }

    // §6.35 Status (migration 022) — when todoDatesEnabled is off, done_date
    // is driven by the Open/Done chip rather than the (unrendered) Done Date
    // field: Done sets it to today only if it isn't already set (nothing to
    // preserve here on a brand-new ToDo), Open leaves it null. due_date
    // stays null too — there's no way to set one in this simplified state.
    const effectiveDoneDate = todoDatesEnabled
      ? (form.doneDate.trim() === '' ? null : form.doneDate)
      : (todoStatus === 'done' ? (form.doneDate.trim() === '' ? todayISODate() : form.doneDate) : null)

    const { data: newTodo, error: insertError } = await supabase
      .from('requests')
      .insert({
        owner_id: userData.user.id,
        contact_id: null,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
        priority: form.priority,
        due_date: form.dueDate.trim() === '' ? null : form.dueDate,
        done_date: effectiveDoneDate,
        repeat_rule: repeatRule,
        repeat_occurrence_index: repeatRule ? 1 : null,
      })
      .select('id')
      .single()

    if (insertError || !newTodo) {
      setSaving(false)
      setError(insertError?.message ?? 'Could not save the ToDo.')
      return
    }

    if (dialogEntries.length > 0) {
      const who = ownerName ?? userData.user.email ?? 'Unknown'
      const { error: dialogError } = await supabase.from('dialog').insert(
        dialogEntries.map((entry) => ({
          request_id: newTodo.id,
          author_user_id: userData.user.id,
          who,
          kind: entry.kind,
          body: entry.body,
        }))
      )

      if (dialogError) {
        setSaving(false)
        setError(
          `ToDo saved, but Dialog entries could not be saved: ${dialogError.message}`
        )
        return
      }
    }

    // Locations write third, same "hold as draft state until there's a
    // real id" reasoning as Dialog above — a direct client insert
    // (kind = 'reference' is allowed by migration 025's RLS policy).
    if (stagedLocations.length > 0) {
      const who = ownerName ?? userData.user.email ?? 'You'
      for (let i = 0; i < stagedLocations.length; i++) {
        const entry = stagedLocations[i]
        const result = await insertAttachmentReference({
          requestId: newTodo.id,
          uploadedByLabel: who,
          referenceNote: entry.description === '' ? null : entry.description,
          referenceUrl: entry.location === '' ? null : entry.location,
          carryIntoRepeats: carryLocationIndexes.has(i),
        })
        if (!result) {
          setSaving(false)
          setError('ToDo saved, but Locations could not be saved.')
          return
        }
      }
    }

    setSaving(false)
    // router.back(), not push('/') — matches Request/ToDo/Contact Detail's
    // own convention (2026-08-09) and, combined with MainScreen.tsx's new
    // scrollTop restore (2026-08-13), returns to Main Screen at the same
    // scroll position instead of a fresh top-of-page load. This was the one
    // create-a-new-item screen still using push('/'), which is what the
    // owner was actually seeing when he reported "add or edit a ToDo"
    // together — Detail's edit path already used back() but had no scroll
    // restore to rely on either, until now.
    router.back()
  }

  function handleCancel() {
    router.back()
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print ToDo"
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
          <span className="glabel">Create ToDo</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="create-todo-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </span>
        </div>

        <div className="scroll">
          <form className="form" id="create-todo-form" onSubmit={handleSubmit} noValidate>

            {/* Priority (§2.1 core object field — ToDo-only). */}
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
                {/* Quick-Done band (§6.31, 2026-08-10) — same "donerow"/"donenote"
                    pattern as Request Response, purely reactive to whether Done
                    Date already holds a value, however it got there (clicking
                    Done here or typing directly into the field below both land
                    in the same state — no separate "did they click Done" flag).
                    Owner's own wording, verbatim. */}
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

                {/* Due Date + Done Date, combined into one row (owner's own rough
                    draft) — both optional, so no .req border and no
                    submit-blocking validation; same .opt Row-Tint-while-empty
                    treatment as everywhere else. No Done Time — owner: "the
                    ToDos do not need Done Time." Done Date's purpose here:
                    "the reason a Create ToDo should allow a Done Date is to
                    allow completed ToDos to be entered if desired." */}
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
              /* §6.35 PROPOSED Status row (migration 022, 2026-08-14) — Due/Done
                 Dates turned off collapses the quick-Done band and Due/Done Date
                 row above into a single Open/Done chip pair, matching the
                 owner's pasted ToDo Detail mockup. Reuses .sendrow+.chippair+
                 .gatenote verbatim — the same combo AddContactForm.tsx already
                 uses for Send Requests By — rather than inventing new markup. */
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

            {/* Repeat (§6.42 PROPOSED, 2026-08-21) — hidden entirely for free
                tier, same posture as Locations' own tier gate above. Also
                gated on todoDatesEnabled: with Due/Done Dates turned off
                there's no Due Date field for Repeat to anchor generation on
                (Jim's own confirmed rule — "the Due Date should be the
                determinant"). Greyed with its own reason once Due/Done Dates
                is on but no Due Date has been entered yet. */}
            {tier === 'subscriber' && todoDatesEnabled && (
              <RepeatControl
                rule={repeatRule}
                dueDate={form.dueDate}
                onSave={setRepeatRule}
                onRemove={() => setRepeatRule(null)}
                disabled={form.dueDate.trim() === ''}
                disabledReason="Please select a Due Date before adding a Repeat."
              />
            )}

            {/* Category row — only when the account has turned Private
                Category on (migration 018, 2026-08-13). See
                CreateRequestForm.tsx's identical gate for the full
                reasoning. */}
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

            {/* ToDo Description (§6.10): 500-char limit, the only required
                field. Plain placeholder, not a floating label — see
                globals.css's ftextarea-plain comment. */}
            <div className={`fgroup${descInvalid ? ' is-invalid' : ''}`}>
              {/* descwrap positions the mic button in the textarea's own
                  bottom-right corner (2026-08-19) — subscriber-only voice
                  dictation, same feature as CreateRequestForm.tsx's
                  identical block. Only rendered when the API is actually
                  present (voiceSupported). */}
              <div className="descwrap">
                <textarea
                  className="ftextarea ftextarea-desc ftextarea-plain req"
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
                    className={`micbtn${dictating ? ' listening' : ''}`}
                    aria-label={dictating ? 'Stop voice dictation' : 'Start voice dictation'}
                    onClick={toggleDictation}
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

            {/* Dialog — Add Dialog modal, Answer always locked (empty
                thread). Simplified empty-state row (§6.32, 2026-08-11):
                with nothing staged yet, a single .frow — .actlabel + Add
                Dialog — replaces the old bare-button .fieldact. Once an
                entry is staged, reverts to the stacked action row (§6.26):
                button alone above the list. */}
            <div className="fgroup">
              {dialogEntries.length === 0 ? (
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
                  <div className="dlgstaged">
                    {dialogEntries.map((entry, i) => (
                      <div className="attitem" key={i}>
                        <span className="attname">
                          <b>{entry.kind === 'question' ? 'Question' : 'Comment'}:</b> {entry.body}
                        </span>
                        <button
                          className="attremove"
                          type="button"
                          aria-label="Remove this Dialog entry"
                          onClick={() => removeDialogEntry(i)}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Locations (Week 5 Priority 3, 2026-08-14) — a ToDo's own
                "Attachment References": a typed path or URL plus an
                optional Description, staged here and inserted once Save
                has a real id. Subscriber-gated, same as a Request's real
                Attachments; free-tier keeps the original locked row.
                Empty/populated split matches Add Dialog and AttachmentsPanel.tsx's
                own mode='reference' behavior (2026-08-14, owner-reported:
                "the Create ToDo and the ToDo Detail should have the Add
                Location behave like the Add Dialog to include erasing the
                'placeholder' box and explanation... when a Location is
                added") — the box+button shows only while nothing is staged
                yet and the inline form isn't open; once a Location exists,
                only a bare Add Location button remains. Empty-state box is
                the same bordered .actlabel treatment as Add Dialog's own
                (2026-08-14, second report, owner screenshots comparing this
                screen's own rendering, annotated "Preferred method", against
                ToDo Detail's tinted "Note:" band) — not .donerow/.donenote,
                which stays reserved for the locked (free-tier) case below. */}
            {tier === 'subscriber' ? (
              <div className="fgroup">
                {stagedLocations.length === 0 && !locationFormOpen && (
                  <div className="frow">
                    <span className="actlabel">Locations are URLs or File paths.</span>
                    <button className="btn" type="button" onClick={() => setLocationFormOpen(true)}>
                      Add Location
                    </button>
                  </div>
                )}
                {stagedLocations.length > 0 && !locationFormOpen && (
                  <div className="fieldact">
                    <button className="btn" type="button" onClick={() => setLocationFormOpen(true)}>
                      Add Location
                    </button>
                  </div>
                )}
                {(stagedLocations.length > 0 || locationFormOpen) && (
                  <>
                    {locationFormOpen && (
                      <div className="dlgstaged">
                        <div className="fgroup ffloat">
                          <input
                            className="finput"
                            placeholder=" "
                            value={locationDescription}
                            onChange={(e) => setLocationDescription(e.target.value)}
                          />
                          <label className="flabel">Description</label>
                        </div>
                        <div className="fgroup ffloat">
                          <input
                            className="finput"
                            placeholder=" "
                            value={locationValue}
                            onChange={(e) => setLocationValue(e.target.value)}
                          />
                          <label className="flabel">Location (path or URL)</label>
                        </div>
                        {locationError && <p className="ferror">{locationError}</p>}
                        <div className="bandcluster">
                          <button className="btn" type="button" onClick={saveStagedLocation}>
                            Save
                          </button>
                          <button
                            className="btn-secondary"
                            type="button"
                            onClick={() => {
                              setLocationFormOpen(false)
                              setLocationDescription('')
                              setLocationValue('')
                              setLocationError(null)
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="dlgstaged">
                      {stagedLocations.map((entry, i) => {
                        const href = urlLocationHref(entry.location)
                        return (
                          <div className="attitem" key={i}>
                            <span className="attname">
                              {entry.description && (
                                <>
                                  <b>{entry.description}</b>
                                  <br />
                                </>
                              )}
                              {href ? (
                                <a href={href} target="_blank" rel="noopener noreferrer">
                                  {entry.location}
                                </a>
                              ) : (
                                entry.location
                              )}
                            </span>
                            {!href && entry.location && (
                              <button
                                className="linkbtn"
                                type="button"
                                onClick={() => copyStagedLocation(i, entry.location)}
                              >
                                {copiedLocationIndex === i ? 'Copied' : 'Copy'}
                              </button>
                            )}
                            <button
                              className="attremove"
                              type="button"
                              aria-label="Remove this Location"
                              onClick={() => removeStagedLocation(i)}
                            >
                              &times;
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="donerow">
                <span className="donenote">
                  <b>Note:</b> Locations are a Subscription feature.
                </span>
                <button className="btn is-locked" type="button" aria-disabled="true">
                  <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                    <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                  Add Location
                </button>
              </div>
            )}

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
        <div className="adslot" aria-hidden="true">
          <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
        </div>

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
                  <button className="btn-secondary" type="button" onClick={() => setDialogModalOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn" type="button" onClick={handleDialogModalSave}>
                    Save
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
                    onClick={() => selectDialogKind('question')}
                  >
                    Question
                  </button>
                  {/* No lockglyph icon (2026-08-19 fix) — see
                      CreateRequestForm.tsx's identical Answer chip for the
                      full reasoning; the icon's extra width was pushing
                      Comment onto a second line on a phone. */}
                  <button className="chip is-locked" type="button" aria-disabled="true" aria-pressed={false} onMouseDown={(e) => e.preventDefault()}>
                    Answer
                  </button>
                  <button
                    className={`chip${dialogModalKind === 'comment' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={dialogModalKind === 'comment'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectDialogKind('comment')}
                  >
                    Comment
                  </button>
                </div>
              </div>

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

        {/* Repeat carry-forward prompt — same pattern and wording as
            CreateRequestForm.tsx's own copy, asking about staged Locations
            instead of staged Attachments. Shown once, at Save, only when a
            Repeat is set and there are staged Locations to ask about. */}
        {carryPromptOpen && (
          <>
            <div className="scrim" onClick={() => setCarryPromptOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="carry-title">
              <div className="modalhead">
                <p className="modal-title" id="carry-title">
                  Carry Locations into Repeats
                </p>
                <div className="modalacts">
                  <button className="btn-secondary" type="button" onClick={() => setCarryPromptOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setCarryPromptOpen(false)
                      doSubmit()
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
              <p className="checknote" style={{ marginBottom: 10 }}>
                Dialog is not carried into repeated ToDos. Select any Locations that should be
                included with each repeat.
              </p>
              <div className="dlgstaged">
                {stagedLocations.map((entry, i) => (
                  <label
                    className="checkrow"
                    key={i}
                    style={{ marginBottom: i === stagedLocations.length - 1 ? 0 : 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={carryLocationIndexes.has(i)}
                      onChange={(e) =>
                        setCarryLocationIndexes((current) => {
                          const next = new Set(current)
                          if (e.target.checked) next.add(i)
                          else next.delete(i)
                          return next
                        })
                      }
                    />
                    <span className="checktext">{entry.description || entry.location}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
