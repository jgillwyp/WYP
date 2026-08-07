'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

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
 * plain client-side draft state — an array of strings, nothing fancier —
 * and only written to the `dialog` table (migration 004) once Send succeeds
 * and the new Request has a real id to attach them to. Kind defaults to
 * 'comment' for everything entered at creation time, since no exchange has
 * happened yet to be a Question or Answer to; there's no kind picker in this
 * v1. `who` is a display-name snapshot, not a live join — see migration 004.
 */

type Contact = {
  id: string
  first_name: string | null
  last_name: string | null
  send_by: 'email' | 'text'
}

type Category = {
  id: string
  name: string
}

type RequestFormState = {
  firstName: string
  lastName: string
  dueDate: string
  dueTime: string
  categoryName: string
  description: string
}

const initialState: RequestFormState = {
  firstName: '',
  lastName: '',
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

export default function CreateRequestForm() {
  const router = useRouter()

  const [form, setForm] = useState<RequestFormState>(initialState)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [showContactResults, setShowContactResults] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const [dialogDraft, setDialogDraft] = useState('')
  const [dialogEntries, setDialogEntries] = useState<string[]>([])
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
    supabase
      .from('contacts')
      .select('id, first_name, last_name, send_by')
      .then(({ data }) => setContacts(data ?? []))

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
  }, [])

  function addDialogEntry() {
    const body = dialogDraft.trim()
    if (body === '') return
    setDialogEntries((entries) => [...entries, body])
    setDialogDraft('')
  }

  function removeDialogEntry(index: number) {
    setDialogEntries((entries) => entries.filter((_, i) => i !== index))
  }

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const contactQueryEmpty = form.firstName.trim() === '' && form.lastName.trim() === ''
  const contactsBrowsable = contacts.length < LOOKUP_BROWSE_THRESHOLD

  const filteredContacts = contactQueryEmpty
    ? (contactsBrowsable ? contacts : [])
    : contacts.filter((c) => {
        const fn = form.firstName.trim().toLowerCase()
        const ln = form.lastName.trim().toLowerCase()
        const cfn = (c.first_name ?? '').toLowerCase()
        const cln = (c.last_name ?? '').toLowerCase()
        return (fn === '' || cfn.includes(fn)) && (ln === '' || cln.includes(ln))
      })

  // Show the dropdown on focus when there's something to browse (query empty
  // but the list is short enough to just list) or once the user has typed
  // something to search for — not when the query is empty and the list is
  // too long to browse, since there'd be nothing useful to show yet.
  const showContactDropdown = !contactQueryEmpty || contactsBrowsable

  const categoryQueryEmpty = form.categoryName.trim() === ''
  const categoriesBrowsable = categories.length < LOOKUP_BROWSE_THRESHOLD

  const filteredCategories = categoryQueryEmpty
    ? (categoriesBrowsable ? categories : [])
    : categories.filter((c) => c.name.toLowerCase().includes(form.categoryName.trim().toLowerCase()))

  const showCategoryDropdown = !categoryQueryEmpty || categoriesBrowsable

  function selectContact(c: Contact) {
    setSelectedContact(c)
    setForm((f) => ({ ...f, firstName: c.first_name ?? '', lastName: c.last_name ?? '' }))
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
        dialogEntries.map((body) => ({
          request_id: newRequest.id,
          author_user_id: userData.user.id,
          who,
          body,
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

    setSaving(false)
    router.push('/')
  }

  function handleCancel() {
    router.push('/')
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Create a Request</span>
          <span className="bandcluster">
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Request"
              onClick={() => window.print()}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="17" cy="11" r="1" fill="currentColor" />
              </svg>
            </button>
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

            {/* Recipient row (§9.2.2) */}
            <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className="finput"
                    id="fn"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    value={form.firstName}
                    onChange={(e) => {
                      set('firstName', e.target.value)
                      setSelectedContact(null)
                      setShowContactResults(true)
                      if (contactInvalid) setContactInvalid(false)
                    }}
                    onFocus={() => setShowContactResults(true)}
                    onBlur={() => setTimeout(() => setShowContactResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="fn">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                      </svg>
                    </span>
                    First Name
                  </label>
                </span>
                <span className="ffloat">
                  <input
                    className="finput"
                    id="ln"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    value={form.lastName}
                    onChange={(e) => {
                      set('lastName', e.target.value)
                      setSelectedContact(null)
                      setShowContactResults(true)
                      if (contactInvalid) setContactInvalid(false)
                    }}
                    onFocus={() => setShowContactResults(true)}
                    onBlur={() => setTimeout(() => setShowContactResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="ln">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                      </svg>
                    </span>
                    Last Name
                  </label>
                </span>
                {/* No in-place "no contact found" interception (§9.9.5) yet —
                    that dialog is designed but not converted (design/README.md).
                    Add Contact just navigates away; anything typed here is
                    lost, which is a known limitation until that flow exists. */}
                <button className="btn" type="button" onClick={() => router.push('/contacts/new')}>
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
                          className="lookup-item"
                          role="option"
                          aria-selected={selectedContact?.id === c.id}
                          onMouseDown={() => selectContact(c)}
                        >
                          {[c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)'}
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
                  className="finput"
                  id="dd"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => {
                    set('dueDate', e.target.value)
                    if (dueDateInvalid) setDueDateInvalid(false)
                  }}
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
                  className="finput"
                  id="dt"
                  type="time"
                  value={form.dueTime}
                  onChange={(e) => set('dueTime', e.target.value)}
                />
                <label className="flabel" htmlFor="dt">
                  <span className="lglyph" aria-hidden="true">
                    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="24" cy="24" r="17" fill="none" stroke="#5A6675" strokeWidth="3.5" />
                      <line x1="24" y1="24" x2="24" y2="13" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                      <line x1="24" y1="24" x2="32" y2="28" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  Due Time (optional)
                </label>
              </span>
            </div>
            {dueDateInvalid && <p className="ferror" style={{ marginTop: -8 }}>Enter a Due Date.</p>}

            {/* Category row */}
            <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className="finput"
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
                      setShowCategoryResults(true)
                    }}
                    onFocus={() => setShowCategoryResults(true)}
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
                    Private Category (optional)
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
                          className="lookup-item"
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
                className="ftextarea ftextarea-desc"
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

            {/* Dialog — held as client-side draft state, written to the
                `dialog` table together with the Request on Send (see the
                file-level comment and migration 004). */}
            <div className="fgroup frow top">
              <span className="ffloat">
                <textarea
                  className="ftextarea ftextarea-dialog"
                  id="dlg"
                  maxLength={1000}
                  placeholder=" "
                  value={dialogDraft}
                  onChange={(e) => setDialogDraft(e.target.value)}
                />
                <label className="flabel" htmlFor="dlg">
                  Dialog (Questions, Answers, Comments)
                </label>
              </span>
              <button className="btn" type="button" onClick={addDialogEntry}>
                Add Dialog
              </button>
            </div>
            {dialogEntries.length > 0 && (
              <div className="dlgstaged">
                {dialogEntries.map((body, i) => (
                  <div className="attitem" key={i}>
                    <span className="attname">{body}</span>
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
            )}

            {/* Attachments panel — v1 locked "paid feature" state, static
                markup only, matching AddContactForm's Text-chip treatment. */}
            <div className="fgroup attachrow">
              <div className="attachpanel">
                <span className="plabel">Attachments</span>
                <div className="locked">
                  <svg className="lock" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <span className="lockttl">A subscription feature</span>
                  <span className="locknote">
                    Attach files to your Requests with a subscription &mdash; see the banner below.
                  </span>
                </div>
              </div>
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
      </div>
    </div>
  )
}
