'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { isTightWindow } from '@/lib/email'

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
 * ready — see docs/WYP_Week5_Plan.md. tightWindow (isTightWindow, @/lib/email)
 * drives the inline advisory note near Due Date/Time, computed the same way
 * the send-request route itself decides whether to omit the Reminder
 * sentence, so the two can never disagree.
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
}

const initialState: RequestFormState = {
  recipientName: '',
  dueDate: '',
  dueTime: '',
  categoryName: '',
  description: '',
}

const CATEGORY_CAP = 20

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

export default function CreateRequestForm() {
  const router = useRouter()

  const [form, setForm] = useState<RequestFormState>(initialState)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [showContactResults, setShowContactResults] = useState(false)
  const [contactBrowsing, setContactBrowsing] = useState(false)

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

  const [contactInvalid, setContactInvalid] = useState(false)
  const [dueDateInvalid, setDueDateInvalid] = useState(false)
  const [descInvalid, setDescInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    supabase
      .from('profiles')
      .select('display_name')
      .single()
      .then(({ data }) => setOwnerName(data?.display_name ?? null))
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

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Tight-window advisory (PRD §7.3, Week 5 Priority 1) — a Request due in
  // under 24 hours gets no day-before Reminder email; this note tells the
  // sender that at Send time rather than leaving it a silent gap. Purely
  // informational — isTightWindow is also what the send-request route
  // itself uses to decide whether to omit the Initial email's own reminder
  // sentence, so this note and that behavior can never disagree.
  const tightWindow = form.dueDate.trim() !== '' && isTightWindow(form.dueDate, form.dueTime || null)

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
              <span className={`ffloat picker native${dueDateInvalid ? ' is-invalid' : ''}`}>
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
            {dueDateInvalid && <p className="ferror" style={{ marginTop: -8 }}>Enter a Due Date.</p>}
            {/* Tight-window advisory (PRD §7.3, Week 5 Priority 1, 2026-08-12) —
                a Due Date under 24 hours away gets no day-before Reminder
                email; told here at compose time rather than left a silent
                gap. Not an error — doesn't block Send. */}
            {tightWindow && !dueDateInvalid && (
              <p className="subnote" style={{ marginTop: -8 }}>
                This Due Date is less than 24 hours away — no day-before Reminder email will be sent.
              </p>
            )}

            {/* Category row */}
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

            {/* Request Description (§6.10): 500-char limit */}
            <div className={`fgroup ffloat${descInvalid ? ' is-invalid' : ''}`}>
              <textarea
                className="ftextarea ftextarea-desc req"
                id="desc"
                maxLength={500}
                placeholder=" "
                value={form.description}
                onChange={(e) => {
                  set('description', e.target.value)
                  if (descInvalid) setDescInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="desc">
                Request Description
              </label>
              {descInvalid && <p className="ferror">Enter a Description.</p>}
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

            {/* Attachments — v1 locked "paid feature" state. Simplified
                empty-state row (§6.32, 2026-08-11), replacing the old
                always-shown .fieldact+.attachpanel: attachment storage
                doesn't exist anywhere in the app yet, so there's no code
                path to a populated state to revert to — unlike Dialog,
                this stays the compact row unconditionally until that's
                built. */}
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
                      answer. See Respond to Request for the dynamic version. */}
                  <button className="chip is-locked" type="button" aria-disabled="true" aria-pressed={false} onMouseDown={(e) => e.preventDefault()}>
                    <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                      <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
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
