'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { supabase } from '@/lib/supabaseClient'
import { printWithExpandedWindow } from '@/lib/platform'

/**
 * Private Categories (2026-09-28) — closes a real gap: Create Request/
 * Create ToDo's own Add Category modal can only ever add a category, never
 * rename or remove one, and nothing else in the app could either. Owner's
 * own mockup: a Contacts-list-shaped screen (Add Category + Close band,
 * plain-name rows) where clicking a row opens an Edit Category modal —
 * Category Name field, an "In use: N ToDos  N Requests" recap, and a
 * Delete Category button, all in one dialog rather than a separate confirm
 * step, since deleting a category is a much lower-stakes action than
 * deleting a Contact: `requests.category_id references categories(id) on
 * delete set null` (migration 003) already means a Category in use is
 * simply cleared from whatever Request/ToDo referenced it, never a
 * cascading delete of the item itself. The usage recap is itself the
 * warning — no second "are you sure" modal, matching the owner's own
 * mockup exactly.
 *
 * "Private Categories" (not "Categories") — the owner's own naming
 * correction, matching Account Options' existing "Show Private Category"
 * toggle wording (private_category_enabled, migration 018) rather than the
 * shorter "Categories" this screen's own mockup was captioned with. The
 * Housekeeping row is gated on that same toggle (see MainScreen.tsx) — a
 * category can only ever be created while the feature is on, so hiding
 * this management screen while it's off is consistent, not a loss.
 *
 * No new migration — categories already carries full owner-scoped RLS
 * (select/insert/update/delete, migration 003), so rename and delete are
 * both plain client calls, same posture as Create Request's own existing
 * Add Category insert.
 */

type Category = { id: string; name: string }
type CategoryCounts = { todos: number; requests: number }

const CATEGORY_CAP = 20

export default function PrivateCategoriesList() {
  const router = useRouter()

  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, CategoryCounts>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Category | null>(null)
  const [editName, setEditName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  // Retry-with-backoff — same transient-clock-skew fix as ContactsList.tsx's
  // own identical effect (2026-09-11); see that file's comment for the full
  // reasoning. Usage counts are fetched separately and best-effort, same as
  // ContactsList.tsx's own get_contact_request_counts() call — a failure
  // there just leaves the counts blank rather than blocking the list.
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const delaysMs = [0, 600, 1600]
      for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))
        if (cancelled) return

        const { data, error } = await supabase.from('categories').select('id, name').order('name')
        if (cancelled) return

        if (!error) {
          setCategories(data ?? [])
          setLoading(false)
          break
        }

        console.error(`Private Categories load attempt ${i + 1} failed:`, error.message)
        if (i === delaysMs.length - 1) {
          setLoadError('Could not load Private Categories. Check your connection and try again.')
          setLoading(false)
        }
      }
    }

    load()

    // Usage counts — no RPC needed (unlike Contacts' Sent/Rec'd, which has
    // to cross-reference another user's own login email server-side):
    // requests.category_id is already owner-scoped by the same RLS this
    // screen's own categories select relies on, so a plain select and a
    // client-side tally is enough. contact_id is null only for a ToDo.
    supabase
      .from('requests')
      .select('category_id, contact_id')
      .not('category_id', 'is', null)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const map: Record<string, CategoryCounts> = {}
        for (const row of data as { category_id: string; contact_id: string | null }[]) {
          const entry = map[row.category_id] ?? { todos: 0, requests: 0 }
          if (row.contact_id === null) entry.todos += 1
          else entry.requests += 1
          map[row.category_id] = entry
        }
        setCounts(map)
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  function openAdd() {
    setNewName('')
    setAddError(null)
    setAddOpen(true)
  }

  async function handleAddSave() {
    const name = newName.trim()
    if (name === '') {
      setAddError('Enter a category name.')
      return
    }
    if (categories.length >= CATEGORY_CAP) {
      setAddError(`You've reached the ${CATEGORY_CAP}-category limit.`)
      return
    }

    setAddSaving(true)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setAddError('Your session has expired. Sign in again and retry.')
      setAddSaving(false)
      return
    }

    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ owner_id: userData.user.id, name })
      .select('id, name')
      .single()

    setAddSaving(false)

    if (insertError || !data) {
      setAddError(insertError?.message ?? 'Could not save category.')
      return
    }

    setCategories((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)))
    setAddOpen(false)
  }

  function openEdit(category: Category) {
    setEditing(category)
    setEditName(category.name)
    setEditError(null)
  }

  function closeEdit() {
    if (editSaving || deleting) return
    setEditing(null)
  }

  async function handleEditSave() {
    if (!editing) return
    const name = editName.trim()
    if (name === '') {
      setEditError('Enter a category name.')
      return
    }
    if (name === editing.name) {
      setEditing(null)
      return
    }

    setEditSaving(true)
    const { error: updateError } = await supabase.from('categories').update({ name }).eq('id', editing.id)
    setEditSaving(false)

    if (updateError) {
      setEditError(updateError.message)
      return
    }

    setCategories((list) =>
      list.map((c) => (c.id === editing.id ? { ...c, name } : c)).sort((a, b) => a.name.localeCompare(b.name))
    )
    setEditing(null)
  }

  async function handleDelete() {
    if (!editing) return
    setDeleting(true)
    const { error: deleteError } = await supabase.from('categories').delete().eq('id', editing.id)
    setDeleting(false)

    if (deleteError) {
      setEditError(deleteError.message)
      return
    }

    setCategories((list) => list.filter((c) => c.id !== editing.id))
    setEditing(null)
  }

  function startPrint() {
    setShowPrint(true)
    setPrintTick((t) => t + 1)
  }

  useEffect(() => {
    if (printTick === 0) return
    printWithExpandedWindow()
    function handleAfterPrint() {
      setShowPrint(false)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [printTick])

  const editCounts = editing ? counts[editing.id] ?? { todos: 0, requests: 0 } : { todos: 0, requests: 0 }

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Private Categories"
              onClick={startPrint}
              style={{ marginLeft: 'auto' }}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </button>
          }
        />

        <div className="band">
          <span className="glabel">Private Categories</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={openAdd}>
              Add&nbsp;Category
            </button>
            <button className="btn-secondary" type="button" onClick={() => router.push('/')}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          {loading && <div className="subempty">Loading…</div>}
          {!loading && loadError && (
            <div className="subempty">
              {loadError}
              <br />
              <button className="btn-secondary" type="button" onClick={() => setReloadTick((t) => t + 1)} style={{ marginTop: 8 }}>
                Try Again
              </button>
            </div>
          )}
          {!loading && !loadError && categories.length === 0 && (
            <div className="subempty">No Private Categories yet — use Add Category.</div>
          )}
          {!loading && !loadError && categories.length > 0 && (
            <div className="hkrows">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="hkrow"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openEdit(c) }}
                >
                  <span className="hktext">
                    <span className="hktitle">{c.name}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <AppFooter />

        {addOpen && (
          <>
            <div className="scrim" onClick={() => (addSaving ? null : setAddOpen(false))} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="addcat-title">
              <p className="modal-title" id="addcat-title">
                Add Category
              </p>
              <div className={`fgroup ffloat${addError ? ' is-invalid' : ''}`}>
                <input
                  className="finput"
                  id="newcat"
                  type="text"
                  autoComplete="off"
                  placeholder=" "
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value)
                    if (addError) setAddError(null)
                  }}
                  autoFocus
                />
                <label className="flabel" htmlFor="newcat">
                  Category Name
                </label>
              </div>
              {addError && <p className="ferror" style={{ marginTop: -8 }}>{addError}</p>}
              <div className="modalacts">
                <button className="btn-secondary" type="button" onClick={() => setAddOpen(false)} disabled={addSaving}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={handleAddSave} disabled={addSaving}>
                  {addSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}

        {editing && (
          <>
            <div className="scrim" onClick={closeEdit} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="editcat-title">
              <p className="modal-title" id="editcat-title">
                Edit Category
              </p>
              <div className={`fgroup ffloat${editError ? ' is-invalid' : ''}`}>
                <input
                  className="finput"
                  id="editcat"
                  type="text"
                  autoComplete="off"
                  placeholder=" "
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value)
                    if (editError) setEditError(null)
                  }}
                  autoFocus
                />
                <label className="flabel" htmlFor="editcat">
                  Category Name
                </label>
              </div>

              <div className="actsummary" role="group" aria-label="Category usage">
                <span className="actsummary-label">In use:</span>
                <span className="actsummary-stats">
                  {editCounts.todos} ToDos&nbsp;&nbsp;{editCounts.requests} Requests
                </span>
                <button className="btn-danger" type="button" onClick={handleDelete} disabled={editSaving || deleting}>
                  {deleting ? 'Deleting…' : 'Delete Category'}
                </button>
              </div>

              {editError && <p className="ferror" style={{ marginTop: 10 }}>{editError}</p>}

              <div className="modalacts" style={{ marginTop: 12 }}>
                <button className="btn-secondary" type="button" onClick={closeEdit} disabled={editSaving || deleting}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={handleEditSave} disabled={editSaving || deleting}>
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showPrint && (
        <div className="print-report">
          <div className="ptitle">Private Categories</div>
          <div className="pcat-colbar">
            <span>Category Name</span>
            <span className="pcat-c-count">ToDos</span>
            <span className="pcat-c-count">Requests</span>
          </div>
          <div className="pcat-rows">
            {categories.length === 0 && <div className="pempty">No Private Categories to print.</div>}
            {categories.map((c) => {
              const cnt = counts[c.id] ?? { todos: 0, requests: 0 }
              return (
                <div key={c.id} className="pcat-row">
                  <span className="pcat-name">{c.name}</span>
                  <span className="pcat-count">{cnt.todos}</span>
                  <span className="pcat-count">{cnt.requests}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
