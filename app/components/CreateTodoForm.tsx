'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Create ToDo (§9.4) — converted by hand from
 * design/screens/WYP_create_todo_palette1.html, following CreateRequestForm.tsx's
 * conventions exactly (Category lookup + Add Category modal, Add Dialog modal
 * with staged entries written on Save) minus what a ToDo doesn't have —
 * Recipient — plus what only a ToDo has: the Priority chip row.
 *
 * FLAGGED, not silently resolved: the mockup has no Due Date field, even
 * though the PRD's core-objects table lists ToDos as having an optional due
 * date and `requests.due_date` is a real, nullable column the seed script
 * already populates for ToDos. This component matches the approved mockup as
 * it stands — no Due Date input — rather than inventing a field the mockup
 * doesn't draw. Worth a decision: add Due Date to this mockup (and ToDo
 * Detail) or leave ToDos due-date-less through the UI.
 */

type Category = {
  id: string
  name: string
}

type TodoFormState = {
  priority: 1 | 2 | 3
  categoryName: string
  description: string
}

const initialState: TodoFormState = {
  priority: 1,
  categoryName: '',
  description: '',
}

const CATEGORY_CAP = 20
const LOOKUP_BROWSE_THRESHOLD = 12

export default function CreateTodoForm() {
  const router = useRouter()

  const [form, setForm] = useState<TodoFormState>(initialState)

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)

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

  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name')
      .order('name')
      .then(({ data }) => setCategories(data ?? []))

    supabase
      .from('profiles')
      .select('display_name')
      .single()
      .then(({ data }) => setOwnerName(data?.display_name ?? null))
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
      setDialogModalError('Enter Dialog Text.')
      return
    }
    setDialogEntries((entries) => [...entries, { kind: dialogModalKind, body }])
    setDialogModalOpen(false)
  }

  function removeDialogEntry(index: number) {
    setDialogEntries((entries) => entries.filter((_, i) => i !== index))
  }

  function set<K extends keyof TodoFormState>(key: K, value: TodoFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const categoryQueryEmpty = form.categoryName.trim() === ''
  const categoriesBrowsable = categories.length < LOOKUP_BROWSE_THRESHOLD

  const filteredCategories = categoryQueryEmpty
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

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('Your session has expired. Sign in again and retry.')
      setSaving(false)
      return
    }

    const { data: newTodo, error: insertError } = await supabase
      .from('requests')
      .insert({
        owner_id: userData.user.id,
        contact_id: null,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
        priority: form.priority,
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

            {/* ToDo Description (§6.10): 500-char limit, the only required field */}
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
                ToDo Description
              </label>
              {descInvalid && <p className="ferror">Enter a Description.</p>}
            </div>

            {/* Dialog — Add Dialog modal, Answer always locked (empty thread) */}
            <div className="fgroup">
              <div className="fieldact">
                <button className="btn" type="button" onClick={openDialogModal}>
                  Add Dialog
                </button>
              </div>
              {dialogEntries.length > 0 && (
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
              )}
            </div>

            {/* Attachments panel — v1 locked "paid feature" state */}
            <div className="fgroup">
              <div className="fieldact">
                <button className="btn is-locked" type="button" aria-disabled="true">
                  <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                    <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                  Add Attachment
                </button>
              </div>
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
            </div>

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
