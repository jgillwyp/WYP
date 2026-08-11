'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

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

type RequestFormState = {
  dueDate: string
  dueTime: string
  doneDate: string
  doneTime: string
  categoryName: string
  description: string
}

const CATEGORY_CAP = 20
const LOOKUP_BROWSE_THRESHOLD = 12

function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

export default function RequestDetailForm() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const requestId = params.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recipientName, setRecipientName] = useState('')

  const [form, setForm] = useState<RequestFormState>({
    dueDate: '',
    dueTime: '',
    doneDate: '',
    doneTime: '',
    categoryName: '',
    description: '',
  })

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [showCategoryResults, setShowCategoryResults] = useState(false)

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

  // Response Link (Week 3 Day 4) — calls issue_request_link (migration 008;
  // DRAFTED, not yet run as of 2026-08-10, see CLAUDE.md Known gaps). The raw
  // token is returned once, by design, and never stored anywhere (only its
  // hash is persisted) — so there is no way to recover an already-issued
  // link later. Regenerating silently invalidates whatever token existed
  // before, matching the function's own documented behavior.
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function loadDialog() {
    const { data } = await supabase
      .from('dialog')
      .select('id, kind, body, who, created_at, replies_to_id')
      .eq('request_id', requestId)
      .order('id')
    setDialogList((data as unknown as DialogEntry[]) ?? [])
  }

  useEffect(() => {
    if (!requestId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [reqRes, catRes, ownerRes] = await Promise.all([
        supabase
          .from('requests')
          .select('id, description, due_date, due_time, done_date, done_time, category_id, contacts(display_name), categories(name)')
          .eq('id', requestId)
          .single(),
        supabase.from('categories').select('id, name').order('name'),
        supabase.from('profiles').select('display_name').single(),
      ])

      if (cancelled) return

      if (reqRes.error || !reqRes.data) {
        setLoadError(reqRes.error?.message ?? 'Could not load this Request.')
        setLoading(false)
        return
      }

      type Row = {
        description: string
        due_date: string | null
        due_time: string | null
        done_date: string | null
        done_time: string | null
        category_id: string | null
        contacts: { display_name: string } | null
        categories: { name: string } | null
      }
      const row = reqRes.data as unknown as Row

      setRecipientName(row.contacts?.display_name ?? '—')
      setForm({
        dueDate: row.due_date ?? '',
        dueTime: row.due_time ?? '',
        doneDate: row.done_date ?? '',
        doneTime: row.done_time ?? '',
        categoryName: row.categories?.name ?? '',
        description: row.description ?? '',
      })
      if (row.category_id && row.categories) {
        setSelectedCategory({ id: row.category_id, name: row.categories.name })
      }
      setCategories(catRes.data ?? [])
      setOwnerName(ownerRes.data?.display_name ?? null)

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

    const { error: updateError } = await supabase
      .from('requests')
      .update({
        due_date: form.dueDate.trim() === '' ? null : form.dueDate,
        due_time: form.dueTime.trim() === '' ? null : form.dueTime,
        done_date: form.doneDate.trim() === '' ? null : form.doneDate,
        done_time: form.doneTime.trim() === '' ? null : form.doneTime,
        category_id: selectedCategory?.id ?? null,
        description: form.description.trim(),
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

  async function handleGetLink() {
    setLinkError(null)
    setLinkCopied(false)
    setLinkLoading(true)

    const { data, error: rpcError } = await supabase.rpc('issue_request_link', {
      p_request_id: requestId,
    })

    setLinkLoading(false)

    if (rpcError || !data) {
      setLinkError(rpcError?.message ?? 'Could not create a Response Link.')
      return
    }

    setLinkUrl(`${window.location.origin}/r/${data as string}`)
  }

  async function handleCopyLink() {
    if (!linkUrl) return
    try {
      await navigator.clipboard.writeText(linkUrl)
      setLinkCopied(true)
    } catch {
      setLinkError('Could not copy automatically — select and copy the link text instead.')
    }
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
          <span className="glabel">Request Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="request-detail-form" disabled={saving}>
              {saving ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </span>
        </div>

        <div className="noticeband"><b>Note:</b> The Request Recipient is notified of changes.</div>

        {/* Response Link (§6.30, PROPOSED, Week 3 Day 4) — the copy-link
            affordance standing in for real email delivery this week (SPF/
            DKIM/DMARC stays out of scope, per CLAUDE.md's Scope discipline).
            Not part of the Send/Cancel band: issuing a link is independent
            of saving the form's other edits. */}
        <div className="linkband">
          {!linkUrl ? (
            <button className="btn-secondary" type="button" onClick={handleGetLink} disabled={linkLoading}>
              {linkLoading ? 'Creating Link…' : 'Get Response Link'}
            </button>
          ) : (
            <>
              <span className="linkval">{linkUrl}</span>
              <button className="btn-secondary" type="button" onClick={handleCopyLink}>
                {linkCopied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn-secondary" type="button" onClick={handleGetLink} disabled={linkLoading}>
                {linkLoading ? 'Regenerating…' : 'Regenerate'}
              </button>
            </>
          )}
          {linkError && <span className="ferror" style={{ margin: 0 }}>{linkError}</span>}
        </div>

        <div className="scroll">
          <form className="form" id="request-detail-form" onSubmit={handleSubmit} noValidate>

            <div className="fgroup">
              <div className="metarow"><span className="mlabel">Recipient:</span><span className="mval">{recipientName}</span></div>
            </div>

            <div className="fgroup frow">
              <span className="ffloat picker native">
                <input
                  className="finput req"
                  id="dd"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set('dueDate', e.target.value)}
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

            <div className={`fgroup ffloat${descInvalid ? ' is-invalid' : ''}`}>
              <textarea
                className="ftextarea req"
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

            {/* Dialog — existing thread, read live from the database. Add
                Dialog writes immediately (not staged for Send) since this
                Request already exists. */}
            <div className="fgroup">
              <div className="fieldact">
                <button className="btn" type="button" onClick={openDialogModal}>
                  Add Dialog
                </button>
              </div>
              <div className="panel">
                <div className="panelhead">Dialog (Questions, Answers, Comments)</div>
                {sortedDialog.length === 0 && (
                  <div className="dlg" style={{ color: 'var(--ink-soft)' }}>No Dialog entries yet.</div>
                )}
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
