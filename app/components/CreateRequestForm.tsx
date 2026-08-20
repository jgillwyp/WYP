'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { isReminderEligible } from '@/lib/email'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  dedupeFileName,
  fileExtension,
  formatBytes,
  isBlockedFileType,
} from '@/lib/attachments'

/**
 * Create Request (§9.2) — converted by hand from
 * design/screens/WYP_create_request_palette1.html.
 *
 * Two mechanics here are new relative to AddContactForm.tsx:
 *
 * 1. Recipient and Category are §6.16 lookup fields. The mockup only shows
 *    their resting state ("selecting from either field's pull-down fills
 *    both fields" is a comment, not a drawn state), so there is no designed
 *    dropdown to convert. .lookup-results below is a minimal PROPOSED §6.24
 *    component built to match the app's existing Row Tint / Rule visual
 *    language rather than invent a new one — see globals.css and
 *    design/README.md's proposed-components table.
 * 2. Both lookups are filtered CLIENT-SIDE against the owner's full
 *    contacts/categories list, fetched once on mount. Both lists are small
 *    (contacts is personal-scale; categories is capped at 20 by §2.3), so a
 *    query per keystroke isn't worth the complexity yet — worth revisiting
 *    if either list grows large.
 *
 * Dialog entries are a third new mechanic (2026-08-06): composed here as
 * client-side draft state and only written to the `dialog` table (migration
 * 004) once Send succeeds and the new Request has a real id to attach them
 * to. `who` is a display-name snapshot, not a live join — see migration 004.
 *
 * Add Dialog modal (2026-08-07): composing an entry now opens a modal —
 * Kind chips (Question/Comment; Answer is always .chip.is-locked here, since
 * a Request or ToDo starts with an empty thread and there is nothing yet to
 * answer) plus a Dialog Text box — matching the existing Add Category modal
 * pattern rather than the old always-visible inline textarea. Answer, and
 * the "which Question" picker that comes with it (migration 006,
 * replies_to_id), exist only on Respond to Request / Request Detail, where a
 * thread can already be open — see that mockup's own comment.
 *
 * Initial Request email (PRD §7.3, Week 5 Priority 1, 2026-08-12): once the
 * Request (and any Dialog entries) save successfully, handleSubmit mints a
 * response-link token via issue_request_link and POSTs to
 * /api/email/send-request — best-effort, never awaited-to-block or allowed
 * to surface an error, since the Request itself is already saved by that
 * point. The route no-ops safely with RESEND_API_KEY unset, which is the
 * case until Jim's wouldyouplease.com domain DNS and Resend account are
 * ready — see docs/WYP_Week5_Plan.md.
 *
 * Reminder checkbox (§6.37 PROPOSED, migration 031, 2026-08-15) — owner's
 * own design, reviewed and refined in chat: "Reminder - send on the morning
 * before unless it is marked Done." Persists reminder_enabled on the new
 * Request; supersedes the old passive Tight-window advisory paragraph
 * (isTightWindow, removed) with an actual sender-controllable preference.
 * Placed beside Due Date when requestTimeEnabled is off (there's width to
 * spare in that .frow) or as its own standalone row after Attachments when
 * it's on. Disabled — plain greyed .checkrow-disabled, not .is-locked, this
 * isn't a subscription gate — until a Contact and Due Date are both
 * entered, then again if the Due Date is too soon for a day-before Reminder
 * to have a real day to send on (isReminderEligible, @/lib/email); a native
 * title tooltip on the row explains which. The actual day-before send is
 * still unbuilt (CLAUDE.md's Known gaps) — this only records the sender's
 * preference for whenever that job exists, and gates the Initial email's
 * own "a reminder will arrive" sentence (send-request/route.ts) in the
 * meantime, same as the two never being able to disagree that the old
 * tightWindow note relied on.
 *
 * Reminders until Done banner (§6.41 PROPOSED, migration 037, 2026-08-20) —
 * owner's own new design (two pasted mockups) pairs the checkbox above
 * ("Morning before") with a second, independent one ("Daily thereafter",
 * overdueReminderEnabled) inside one .reminderbanner box. "Daily thereafter"
 * gates the automatic post-Due-Date Overdue notification system (migrations
 * 032/033) for this Request — unchecking it silences the Recipient's
 * one-time "just became overdue" notice AND every recurring nudge after it,
 * confirmed with the owner via chat 2026-08-20. Always enabled here (no
 * eligibility rule of its own — this is a brand-new Request, nothing can be
 * overdue yet); Request Detail's own copy of this banner adds the
 * archived-Request grey-out that already existed for the single checkbox.
 */

type Contact = {
  id: string
  display_name: string
  send_by: 'email' | 'text'
}

type Category = {
  id: string
  name: string
}

type RequestFormState = {
  recipientName: string
  dueDate: string
  dueTime: string
  categoryName: string
  description: string
  reminderEnabled: boolean
  // "Daily thereafter" (§6.41, migration 037, 2026-08-20) — see the
  // Reminders-until-Done banner comment below for the full reasoning.
  overdueReminderEnabled: boolean
}

const initialState: RequestFormState = {
  recipientName: '',
  dueDate: '',
  dueTime: '',
  categoryName: '',
  description: '',
  // Default checked, matching the owner's own mockup — see the file-level
  // comment on the Reminder checkbox.
  reminderEnabled: true,
  overdueReminderEnabled: true,
}

const CATEGORY_CAP = 20

// Character caps for the two free-text boxes on this screen — kept as named
// constants (2026-08-16) so the maxLength attribute and the .charcount
// display always agree; see globals.css's ftextarea-plain/.charcount
// comment for why these fields dropped the floating-label pattern.
// DIALOG_MAX lowered from 1000 to match DESCRIPTION_MAX, owner request
// 2026-08-16 ("I think it was supposed to be limited to 150 - but having it
// be 500 would be alright").
const DESCRIPTION_MAX = 500
const DIALOG_MAX = 500

// §6.24 lookup fields (2026-08-07): with a short list, making the user type
// before seeing anything is friction for no reason — show the whole list on
// focus instead, and only fall back to type-to-search once there are enough
// options that showing all of them stops being useful. Owner's rule, meant
// to apply to every §6.24 lookup in the app, not just these two — see
// design/README.md's proposed-components table.
const LOOKUP_BROWSE_THRESHOLD = 12

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

// Print-only Due date format (2026-08-18) — see RequestDetailForm.tsx's own
// copy of this helper for the full write-up. "7/15/26", the owner's own
// xlsx example, vs. the plain "YYYY-MM-DD" form.dueDate value used
// everywhere else on this screen.
function formatMDYSlash(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(2)}`
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

function categoryPrefix(name: string): string {
  return name ? `[${name}] ` : ''
}

// Print (2026-08-18) — same .pdlg/.pdlghead/.pdlgitem rendering as every
// other screen's PrintDialogList (RequestDetailForm.tsx etc.), adapted to
// this screen's own staged, not-yet-saved DialogEntry shape (kind/body
// only — no id/who/created_at, since nothing has been written to the
// `dialog` table yet). Keyed by array index for the same reason the staged
// list below already is.
function PrintDialogList({ entries }: { entries: { kind: 'question' | 'comment'; body: string }[] }) {
  if (entries.length === 0) return null
  return (
    <div className="pdlg">
      <div className="pdlghead">Dialog</div>
      {entries.map((e, i) => (
        <div className="pdlgitem" key={i}>
          <span className="pdlgkind">{e.kind === 'question' ? 'Question' : 'Comment'}</span> {e.body}
        </div>
      ))}
    </div>
  )
}

// Same idea, for staged File objects — nothing has been uploaded yet
// (upload only happens in handleSubmit, once Send succeeds and a real
// request id exists), so this just lists the pending file names.
function PrintAttachmentList({ files }: { files: File[] }) {
  if (files.length === 0) return null
  return (
    <div className="patt">
      <div className="patthead">Attachments</div>
      {files.map((f, i) => (
        <div className="pattitem" key={i}>
          {f.name}
        </div>
      ))}
    </div>
  )
}

// Voice dictation for Description (2026-08-19) — owner: "I see it as a good
// option for entry of the Description during a Create... it could be a
// subscription option." Browser-native (Web Speech API — Chrome/Edge/Safari
// ship SpeechRecognition or webkitSpeechRecognition; no vendor, no per-use
// cost, unlike a hosted transcription service), gated the same way
// Attachments already is, off the signed-in owner's own live `tier`, not
// anything baked into the Request itself. A minimal local type stands in
// for the real (non-standard, not part of TS's default DOM lib)
// SpeechRecognition API rather than reaching for `any`. Browser-support
// testing/fallback polish is deliberately deferred to post-Private-Testing
// (owner's own call) — for now the mic icon simply doesn't render when the
// API isn't present (voiceSupported below), computed in an effect rather
// than during render so server and first client render agree (no
// hydration mismatch) and the feature can honestly be described as
// "available if your browser supports it (and most do)" rather than
// assumed present. Duplicated per component (CreateTodoForm.tsx has its
// own copy) — same convention as openPicker/formatMDYSlash above.
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

export default function CreateRequestForm() {
  const router = useRouter()

  const [form, setForm] = useState<RequestFormState>(initialState)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [showContactResults, setShowContactResults] = useState(false)
  const [contactBrowsing, setContactBrowsing] = useState(false)

  // Private Category is now an opt-in account preference (migration 018,
  // 2026-08-13), off by default — see AccountForm.tsx. false until the
  // profiles read below resolves, same as every other gate in this app
  // that starts closed and only opens once its real value is known.
  const [categoriesEnabled, setCategoriesEnabled] = useState(false)
  // Due/Done Time is now an opt-in account preference too (migration 019,
  // 2026-08-13) — see AccountForm.tsx. On by default (true until the
  // profiles read below resolves), unlike Category, since this is
  // pre-existing behavior being made optional, not a new feature starting
  // closed. When off, the Due row below collapses to just Due Date.
  const [requestTimeEnabled, setRequestTimeEnabled] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)
  const [categoryBrowsing, setCategoryBrowsing] = useState(false)

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  // Answer is deliberately absent from this union — see the file-level
  // comment. Only Question/Comment are ever legal here.
  type DialogEntry = { kind: 'question' | 'comment'; body: string }
  const [dialogEntries, setDialogEntries] = useState<DialogEntry[]>([])
  const [dialogModalOpen, setDialogModalOpen] = useState(false)
  const [dialogModalKind, setDialogModalKind] = useState<'question' | 'comment'>('question')
  const [dialogModalBody, setDialogModalBody] = useState('')
  const [dialogModalError, setDialogModalError] = useState<string | null>(null)
  const dialogTextRef = useRef<HTMLTextAreaElement>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)

  // Attachments (Week 5 Priority 3, 2026-08-14) — staged as real File
  // objects, same "hold as client-side draft state, write once Send
  // succeeds and there's a real request id" pattern dialogEntries already
  // uses above; uploaded via /api/attachments/upload in handleSubmit, not
  // written directly (that route is the only place a kind = 'file' row can
  // be created at all — see migration 025). tier gates whether this panel
  // or the locked one renders; re-checked server-side regardless.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Voice dictation for Description (2026-08-19) — see the module-level
  // comment above getSpeechRecognition() for the full reasoning. dictating
  // drives the mic button's visual/aria state; recognitionRef holds the
  // live instance so toggleDictation can stop() it without re-creating one;
  // voiceSupported is set once, client-side only, in a mount effect below —
  // never read directly during render, to keep server/first-client render
  // in agreement (no hydration mismatch).
  const [dictating, setDictating] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)

  // Dialog Text gets its own independent dictating/recognitionRef pair
  // (2026-08-20) — extended from Description-only per the owner's request.
  // Shares voiceSupported above (one browser-capability check covers both
  // fields) but needs a separate live-recognition instance since the two
  // textareas are never the same input.
  const [dlgDictating, setDlgDictating] = useState(false)
  const dlgRecognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const [contactInvalid, setContactInvalid] = useState(false)
  const [dueDateInvalid, setDueDateInvalid] = useState(false)
  const [descInvalid, setDescInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Print (2026-08-18) — brings this screen up to the detailed
  // .print-report/.prow shape every other print report in the app now uses,
  // replacing the old raw window.print() of the live screen. Everything it
  // needs (form, dialogEntries, stagedFiles) is already local React state —
  // nothing has been saved to Supabase yet, so unlike every other screen's
  // print conversion, there is no fetch to do here; startPrint is
  // synchronous. Uses .detail2 (To/Due only, no Date/Done columns) rather
  // than Request Detail's .detail3 — an unsaved Request has no created_at
  // and no Done state yet for either column to show.
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  function startPrint() {
    setShowPrint(true)
    // See RequestDetailForm.tsx's identical comment for the full reasoning
    // (afterprint doesn't fire reliably in every browser/print-flow, so
    // showPrint alone can get stuck true; printTick strictly increases on
    // every click, guaranteeing a real dependency change regardless).
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

  // Voice dictation support check (2026-08-19) — runs once, client-only, so
  // voiceSupported starts false on both the server render and the first
  // client render (no hydration mismatch), then flips true a tick later if
  // the browser actually has the API. Stop any live recognition on unmount
  // (navigating away mid-dictation shouldn't leave the mic listening).
  useEffect(() => {
    // Deferred a tick (not called synchronously in the effect body) — same
    // shape PWAProvider.tsx's own beforeinstallprompt listener already
    // satisfies react-hooks/set-state-in-effect with, just via a microtask
    // instead of a browser event, since there's no event to listen for
    // here.
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

  // Load the owner's own contacts and categories once. RLS already scopes
  // both to owner_id = auth.uid() (migration 002 / 003) — no client-side
  // "is this mine" filter is added on top of that.
  useEffect(() => {
    // Returning from Add Contact (2026-08-11) — owner-reported: saving a
    // contact from here used to always land back on the Contacts list, not
    // this screen, and never selected the contact just added. AddContactForm.tsx
    // now redirects here with ?newContactId=<id> when it was opened from this
    // screen's own Add Contact button (?from=create-request, see below); once
    // the contacts list has loaded, find that id and select it, then strip
    // the query string via router.replace so a refresh or back-navigation
    // doesn't re-select it. Read via window.location.search inside this
    // effect (not the useSearchParams() hook) specifically to avoid the
    // Suspense-boundary requirement that hook imposes on the page — this
    // effect only ever runs client-side after mount, so window is safe here.
    const newContactId = new URLSearchParams(window.location.search).get('newContactId')

    // Alphabetical, not creation order (owner's rule, 2026-08-07) — applies
    // to every pull-down/lookup list in the app except the Housekeeping task
    // list's Log Out entry.
    supabase
      .from('contacts')
      .select('id, display_name, send_by')
      .order('display_name')
      .then(({ data }) => {
        const list = data ?? []
        setContacts(list)
        if (newContactId) {
          const created = list.find((c) => c.id === newContactId)
          if (created) selectContact(created)
          router.replace('/requests/new')
        }
      })

    supabase
      .from('categories')
      .select('id, name')
      .order('name')
      .then(({ data }) => setCategories(data ?? []))

    // For dialog.who — see migration 004's note on why this is a snapshot,
    // not a live join, taken once here rather than re-read at Send time.
    // private_category_enabled (migration 018, 2026-08-13) rides along on
    // the same read rather than a separate round trip — RLS's own
    // "profiles: read own" policy already scopes .single() to the caller's
    // row with no .eq('id', ...) needed, same as this call already relied
    // on for display_name.
    supabase
      .from('profiles')
      .select('display_name, private_category_enabled, request_time_enabled, tier')
      .single()
      .then(({ data }) => {
        setOwnerName(data?.display_name ?? null)
        setCategoriesEnabled(data?.private_category_enabled ?? false)
        setRequestTimeEnabled(data?.request_time_enabled ?? true)
        setTier(data?.tier === 'subscriber' ? 'subscriber' : 'free')
      })
    // router is stable across renders (Next's useRouter()) and this effect
    // must run once on mount only, same as every other "load once" effect
    // in this file — same pattern TodoDetailForm.tsx already uses for its
    // own mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Attachments — client-side checks are a courtesy; app/api/attachments/
  // upload/route.ts re-verifies size, type, and the 10-item cap regardless
  // (see that route's own header comment).
  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // lets the same filename be picked again later
    if (picked.length === 0) return

    setAttachError(null)
    setStagedFiles((current) => {
      const next = [...current]
      for (const f of picked) {
        if (next.length >= MAX_ATTACHMENTS_PER_ITEM) {
          setAttachError(`You can attach up to ${MAX_ATTACHMENTS_PER_ITEM} files.`)
          break
        }
        if (isBlockedFileType(f.name)) {
          setAttachError(`${fileExtension(f.name) || 'That file type'} isn't supported.`)
          continue
        }
        if (f.size > MAX_ATTACHMENT_BYTES) {
          setAttachError(`${f.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`)
          continue
        }
        const finalName = dedupeFileName(f.name, next.map((x) => x.name))
        next.push(finalName === f.name ? f : new File([f], finalName, { type: f.type }))
      }
      return next
    })
  }

  function removeStagedFile(index: number) {
    setStagedFiles((files) => files.filter((_, i) => i !== index))
  }

  async function uploadStagedFiles(requestId: string) {
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) throw new Error('Your session has expired.')

    for (const file of stagedFiles) {
      const body = new FormData()
      body.append('file', file)
      body.append('requestId', requestId)
      const res = await fetch('/api/attachments/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(
          detail.error === 'limit_reached'
            ? `Attachment limit reached (${MAX_ATTACHMENTS_PER_ITEM}).`
            : `Could not upload ${file.name}.`
        )
      }
    }
  }

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Voice dictation toggle (2026-08-19) — starts/stops a single
  // SpeechRecognition instance. continuous + interimResults so it keeps
  // listening across pauses rather than stopping after one phrase; only
  // the newest final result (event.resultIndex onward) is appended, so a
  // browser that re-sends earlier results as they firm up doesn't
  // duplicate text already appended. onerror/onend both reset dictating —
  // a real error and a natural stop (e.g. silence timeout) look the same
  // from this button's point of view.
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

  // Reminder checkbox availability (PRD §7.3, revised 2026-08-15) — three
  // states: (1) no Contact and/or Due Date yet, so there's nothing to
  // evaluate eligibility against; (2) both present but the Due Date is too
  // soon (isReminderEligible, @/lib/email — more than two calendar days out
  // required); (3) available. Only state 3 lets the checkbox be toggled;
  // states 1 and 2 grey it out with a different native title tooltip each,
  // per the owner's own exact wording.
  const reminderPrereqsMissing = !selectedContact || form.dueDate.trim() === ''
  const reminderIneligible = !reminderPrereqsMissing && !isReminderEligible(form.dueDate)
  const reminderDisabled = reminderPrereqsMissing || reminderIneligible
  const reminderTooltip = reminderPrereqsMissing
    ? 'Please select Contact and Due Date before modifying the Reminder.'
    : reminderIneligible
      ? 'A Reminder is not available due to the short lead time.'
      : undefined

  // Reminders until Done banner (§6.41 PROPOSED, 2026-08-20) — replaces the
  // single reminderCheckbox() with two independent .reminderitem toggles in
  // one .reminderbanner box. "Daily thereafter" has no eligibility rule of
  // its own on this screen (a brand-new Request, nothing can be overdue
  // yet) — always enabled, default checked.
  function reminderBanner(inline: boolean) {
    return (
      <div className={`reminderbanner${inline ? ' reminderbanner-inline' : ''}`}>
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
            <span>Morning before</span>
          </label>
          <label className="reminderitem">
            <input
              type="checkbox"
              checked={form.overdueReminderEnabled}
              onChange={(e) => set('overdueReminderEnabled', e.target.checked)}
            />
            <span>Daily thereafter</span>
          </label>
        </div>
      </div>
    )
  }

  const contactQueryEmpty = form.recipientName.trim() === ''
  const contactsBrowsable = contacts.length < LOOKUP_BROWSE_THRESHOLD

  // Owner-reported, 2026-08-10: clicking a field that already holds an exact
  // match (e.g. after selecting a Recipient) re-filtered the dropdown down
  // to that one match instead of showing the whole list to pick from again
  // or choose something else — "technically correct... but if they're
  // clicking on the value, they want to be able to select a different
  // value." `contactBrowsing` (same pattern as Time Zone's own
  // browse-on-focus fix, 2026-08-09) shows the full list, unfiltered and
  // regardless of size, from focus until the first keystroke — at which
  // point normal substring filtering (and, for a large list, the
  // empty-query size gate) takes back over.
  const filteredContacts = contactBrowsing
    ? contacts
    : contactQueryEmpty
      ? (contactsBrowsable ? contacts : [])
      : contacts.filter((c) =>
          c.display_name.toLowerCase().includes(form.recipientName.trim().toLowerCase())
        )

  // Show the dropdown on focus when there's something to browse (query empty
  // but the list is short enough to just list) or once the user has typed
  // something to search for — not when the query is empty and the list is
  // too long to browse, since there'd be nothing useful to show yet.
  const showContactDropdown = !contactQueryEmpty || contactsBrowsable

  const categoryQueryEmpty = form.categoryName.trim() === ''
  const categoriesBrowsable = categories.length < LOOKUP_BROWSE_THRESHOLD

  // Same fix as Recipient above.
  const filteredCategories = categoryBrowsing
    ? categories
    : categoryQueryEmpty
      ? (categoriesBrowsable ? categories : [])
      : categories.filter((c) => c.name.toLowerCase().includes(form.categoryName.trim().toLowerCase()))

  const showCategoryDropdown = !categoryQueryEmpty || categoriesBrowsable

  function selectContact(c: Contact) {
    setSelectedContact(c)
    setForm((f) => ({ ...f, recipientName: c.display_name }))
    setShowContactResults(false)
    setContactInvalid(false)
  }

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
    const hasContact = selectedContact !== null
    const hasDueDate = form.dueDate.trim() !== ''
    const hasDesc = form.description.trim() !== ''

    setContactInvalid(!hasContact)
    setDueDateInvalid(!hasDueDate)
    setDescInvalid(!hasDesc)

    return hasContact && hasDueDate && hasDesc
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setSaving(true)

    // Same pattern as AddContactForm: owner_id is set here to populate the
    // row correctly, not as the security check. "requests: owners insert
    // own" (migration 003) enforces owner_id = auth.uid() regardless.
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('Your session has expired. Sign in again and retry.')
      setSaving(false)
      return
    }

    const { data: newRequest, error: insertError } = await supabase
      .from('requests')
      .insert({
        owner_id: userData.user.id,
        contact_id: selectedContact!.id,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
        due_date: form.dueDate,
        due_time: form.dueTime.trim() === '' ? null : form.dueTime,
        reminder_enabled: form.reminderEnabled,
        overdue_reminder_enabled: form.overdueReminderEnabled,
      })
      .select('id')
      .single()

    if (insertError || !newRequest) {
      setSaving(false)
      setError(insertError?.message ?? 'Could not save the Request.')
      return
    }

    // Dialog entries write second, against the id the insert above just
    // returned — see migration 004 and the file-level comment on why these
    // were held as draft state until now instead of written as they were
    // typed.
    if (dialogEntries.length > 0) {
      const who = ownerName ?? userData.user.email ?? 'Unknown'
      const { error: dialogError } = await supabase.from('dialog').insert(
        dialogEntries.map((entry) => ({
          request_id: newRequest.id,
          author_user_id: userData.user.id,
          who,
          kind: entry.kind,
          body: entry.body,
        }))
      )

      if (dialogError) {
        setSaving(false)
        // The Request itself is already saved at this point — this is a
        // partial-failure case, not "nothing happened." Surface it plainly
        // rather than silently dropping the Dialog entries or pretending the
        // whole Send failed.
        setError(
          `Request saved, but Dialog entries could not be saved: ${dialogError.message}`
        )
        return
      }
    }

    // Attachments write third, same "hold as draft state until there's a
    // real request id" reasoning as Dialog above — /api/attachments/upload
    // is the only path that can create a kind = 'file' row (migration 025).
    if (stagedFiles.length > 0) {
      try {
        await uploadStagedFiles(newRequest.id)
      } catch (err) {
        setSaving(false)
        setError(
          `Request saved, but attachments could not be uploaded: ${
            err instanceof Error ? err.message : 'unknown error'
          }`
        )
        return
      }
    }

    // Initial Request email (PRD §7.3, Week 5 Priority 1, 2026-08-12) —
    // best-effort, fire-and-forget: a failure anywhere in this block must
    // never undo or block the Request that's already saved above, so
    // everything here is wrapped and swallowed rather than surfaced via
    // setError. issue_request_link (migration 008) is owner-only and
    // multi-use — minting a token here is the same call RequestDetailForm's
    // own "Get Response Link" band already makes, just triggered
    // automatically at Send instead of by a manual click.
    try {
      const { data: linkToken } = await supabase.rpc('issue_request_link', {
        p_request_id: newRequest.id,
      })
      if (linkToken) {
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token
        if (accessToken) {
          fetch('/api/email/send-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              requestId: newRequest.id,
              link: `${window.location.origin}/r/${linkToken}`,
            }),
          }).catch(() => {
            // Best-effort — see comment above. app/api/email/send-request's
            // own route already no-ops safely (RESEND_API_KEY isn't set
            // yet, 2026-08-12) rather than erroring in the common case;
            // this catch only guards the network call itself.
          })
        }
      }
    } catch {
      // Best-effort — see comment above.
    }

    setSaving(false)
    router.push('/')
  }

  function handleCancel() {
    router.push('/')
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
          <span className="glabel">Create Request</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="create-request-form" disabled={saving}>
              {saving ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </span>
        </div>

        <div className="scroll">
          <form className="form" id="create-request-form" onSubmit={handleSubmit} noValidate>

            {/* Recipient row (§9.2.2) — single Name lookup (2026-08-07,
                merged from First/Last Name; matches Add Contact and reads
                contacts.display_name, see migration 005). */}
            <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className="finput req"
                    id="rn"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    value={form.recipientName}
                    onChange={(e) => {
                      set('recipientName', e.target.value)
                      setSelectedContact(null)
                      setContactBrowsing(false)
                      setShowContactResults(true)
                      if (contactInvalid) setContactInvalid(false)
                    }}
                    onFocus={(e) => {
                      e.target.select()
                      setContactBrowsing(true)
                      setShowContactResults(true)
                    }}
                    onBlur={() => setTimeout(() => setShowContactResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="rn">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                      </svg>
                    </span>
                    Recipient
                  </label>
                </span>
                {/* No in-place "no contact found" interception (§9.9.5) yet —
                    that dialog is designed but not converted (design/README.md).
                    Add Contact still navigates away, and every other field
                    typed on this screen is still lost, which remains a known
                    limitation until that flow exists — but 2026-08-11, the
                    round trip itself was fixed: ?from=create-request tells
                    AddContactForm.tsx to send the owner back here (with the
                    new contact selected) on Save, or back here empty-handed
                    on Cancel, instead of always landing on the Contacts list. */}
                <button className="btn" type="button" onClick={() => router.push('/contacts/new?from=create-request')}>
                  Add Contact
                </button>

                {showContactResults && showContactDropdown && (
                  <div className="lookup-results" role="listbox">
                    {filteredContacts.length === 0 ? (
                      <div className="lookup-empty">
                        {contactQueryEmpty ? 'No contacts yet — use Add Contact.' : 'No matching contact — use Add Contact.'}
                      </div>
                    ) : (
                      filteredContacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`lookup-item${selectedContact?.id === c.id ? ' selected' : ''}`}
                          role="option"
                          aria-selected={selectedContact?.id === c.id}
                          onMouseDown={() => selectContact(c)}
                        >
                          {c.display_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className={`chancap${selectedContact ? ' is-visible' : ''}`}>
                {selectedContact && `Will be sent by ${selectedContact.send_by === 'text' ? 'Text' : 'Email'}`}
              </div>
              {contactInvalid && (
                <p className="ferror">Select a recipient from the list, or use Add Contact.</p>
              )}
            </div>

            {/* Due row (§9.2.2 / §6.16) */}
            <div className="fgroup frow">
              <span className={`ffloat picker native${dueDateInvalid ? ' is-invalid' : ''}${!requestTimeEnabled ? ' due-with-reminder' : ''}`}>
                <input
                  className="finput req"
                  id="dd"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => {
                    set('dueDate', e.target.value)
                    if (dueDateInvalid) setDueDateInvalid(false)
                  }}
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
              {/* Due Time — only when the account has Due/Done Time turned on
                  (migration 019, 2026-08-13, see AccountForm.tsx). Off
                  collapses this row to just Due Date, matching ToDo's
                  one-line Due Date presentation — owner: "when turned off
                  the four-value two-line presentation of Due Date Due Time
                  Done Date Done Time on Requests would become like a ToDo
                  one-line two-value presentation of Due Date and Done
                  Date." (Create Request has no Done Date/Time fields at
                  all — those only exist once a Request has been sent — so
                  here the effect is simply dropping Due Time.) When Due
                  Time is off, the Reminder checkbox (below) takes this
                  row's spare width instead — see the file-level comment. */}
              {requestTimeEnabled ? (
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
              ) : (
                reminderBanner(true)
              )}
            </div>
            {dueDateInvalid && <p className="ferror" style={{ marginTop: -8 }}>Enter a Due Date.</p>}

            {/* Category row — only when the account has turned Private
                Category on (migration 018, 2026-08-13). Off by default:
                owner — "I think the Private Category should be an account
                option, not a standard presented data element... A single
                option could control its availability for both Requests and
                ToDos." Not rendered at all when off, not just disabled —
                genuinely simpler, matching the owner's own stated goal,
                rather than a locked/upsell-style control. */}
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

            {/* Request Description (§6.10): 500-char limit. Plain
                placeholder, not a floating label — see globals.css's
                ftextarea-plain comment. */}
            <div className={`fgroup${descInvalid ? ' is-invalid' : ''}`}>
              {/* descwrap positions the mic button in the textarea's own
                  bottom-right corner (2026-08-19) — subscriber-only voice
                  dictation of the Description field, owner: "I see it as a
                  good option for entry of the Description during a
                  Create... it could be a subscription option." Only
                  rendered when the API is actually present
                  (voiceSupported) — see the module-level comment on
                  getSpeechRecognition() for why this can honestly be
                  described as "available if your browser supports it (and
                  most do)" rather than assumed universal. */}
              <div className="descwrap">
                <textarea
                  className="ftextarea ftextarea-desc ftextarea-plain req"
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

            {/* Dialog — Add Dialog opens a modal (2026-08-07, see file-level
                comment) instead of the old always-visible inline textarea.
                Entries are held as client-side draft state and written to
                the `dialog` table together with the Request on Send (see
                migration 004). Simplified empty-state row (§6.32,
                2026-08-11): with nothing staged yet, a single .frow —
                .actlabel + Add Dialog — replaces the old bare-button
                .fieldact. Once an entry is staged, reverts to the stacked
                action row (§6.26): button alone above the list. */}
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

            {/* Attachments (Week 5 Priority 3, 2026-08-14) — subscriber-gated,
                re-checked server-side regardless of what this renders.
                Staged as real File objects, same pattern as Dialog above,
                uploaded via /api/attachments/upload once Send has a real
                request id. Free-tier keeps the original locked row. */}
            {tier === 'subscriber' ? (
              <div className="fgroup">
                {stagedFiles.length === 0 ? (
                  <div className="frow">
                    <span className="actlabel">
                      Attachments <span className="subnote">(optional)</span>
                    </span>
                    <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>
                      Add Attachment
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="fieldact">
                      <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>
                        Add Attachment
                      </button>
                    </div>
                    <div className="dlgstaged">
                      {stagedFiles.map((f, i) => (
                        <div className="attitem" key={i}>
                          <span className="attname">
                            {f.name} <span className="subnote">({formatBytes(f.size)})</span>
                          </span>
                          <button
                            className="attremove"
                            type="button"
                            aria-label={`Remove ${f.name}`}
                            onClick={() => removeStagedFile(i)}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFilesSelected}
                />
                {attachError && <p className="ferror">{attachError}</p>}
              </div>
            ) : (
              <div className="donerow">
                <span className="donenote">
                  <b>Note:</b> Attachments are a Subscription feature.
                </span>
                <button className="btn is-locked" type="button" aria-disabled="true">
                  <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                    <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                  Add Attachment
                </button>
              </div>
            )}

            {/* Reminders until Done banner, standalone-row placement — only
                when Due Time is on (the inline placement above already
                covers the off case; see the file-level comment). */}
            {requestTimeEnabled && reminderBanner(false)}

            {error && (
              <p className="ferror" role="alert" style={{ marginTop: 4 }}>
                {error}
              </p>
            )}
          </form>

          <div className="minreq">
            <b>Minimum required</b>&nbsp; A recipient selected from the lookup, a Due Date, and a Description.
          </div>
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

        {/* Add Dialog modal (2026-08-07) — title + Cancel/Save on the same
            top row (.modalhead), a different §6.12 variant than Add
            Category's title-then-bottom-buttons layout, matching the owner's
            mockup for this modal specifically. Answer is always
            .chip.is-locked here — see the file-level comment on why this
            screen never offers it. */}
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
                  {/* Locked, not just unselected — a Request/ToDo's thread is
                      always empty at this point, so there is nothing yet to
                      answer. See Respond to Request for the dynamic version.
                      No lockglyph icon here (2026-08-19 fix) — matches the
                      dynamically-locked Answer chip on Request Detail/Request
                      Response/Response Detail/ToDo Detail, none of which show
                      one; the icon's extra width was pushing Comment onto a
                      second line on a phone, a wrap none of those other four
                      screens ever had. aria-disabled carries the same meaning
                      without it. */}
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
      </div>

      {/* Single-item print (2026-08-18) — brings this screen up to the same
          .print-report/.prow shape RequestDetailForm.tsx uses (the
          confirmed reference — "Request Detail uses the new format,"
          owner). "Request Preview" rather than "Request Detail" — nothing
          has actually been saved/sent yet, so this is a preview of what's
          been filled in so far, not a record of something that exists.
          .detail2 (To/Due only — see that class's own comment in
          globals.css) rather than .detail3, since there is no Date/Done to
          show for an unsaved Request. No sort-arrow header row — nothing to
          sort with only one record, same as every other single-item print
          in this app. */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">Request Preview</div>
          <div className="pcolbar detail2">
            <span className="namecell">
              <span className="c-nm">To</span>
              <span className="c-desc">Description</span>
            </span>
            <span className="c-due">Due</span>
          </div>
          <div className="prows">
            <div className="prow">
              <div className="pr1 detail2">
                <span className="pnm">{form.recipientName || '—'}</span>
                <span className="pdue">
                  {formatMDYSlash(form.dueDate || null)}
                  {requestTimeEnabled && form.dueTime && <span className="ptime">{'  '}{formatTime12h(form.dueTime)}</span>}
                </span>
              </div>
              <div className="pr2">
                <span className="pdesc">
                  {categoriesEnabled && categoryPrefix(form.categoryName)}
                  {form.description}
                </span>
              </div>
              <PrintDialogList entries={dialogEntries} />
              <PrintAttachmentList files={stagedFiles} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
