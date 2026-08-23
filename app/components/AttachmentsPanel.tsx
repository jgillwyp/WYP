'use client'

import { useEffect, useRef, useState } from 'react'

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  fileExtension,
  formatBytes,
  isBlockedFileType,
  urlLocationHref,
  type AttachmentRow,
} from '@/lib/attachments'

const referenceNote = 'Locations are URLs or File paths.'

/**
 * Shared Attachments/Locations panel for every screen with an existing
 * Request/ToDo id — Request Detail, ToDo Detail, Request Response, Response
 * Detail (Week 5 Priority 3, 2026-08-14). Create Request/Create ToDo don't
 * use this: neither has a real id yet, so they stage entries client-side
 * instead (see CreateRequestForm.tsx/CreateTodoForm.tsx's own staged-list
 * code) and only ever call this feature's write paths once Save/Send
 * produces a real id.
 *
 * mode = 'file' (Requests): a real upload via /api/attachments/upload,
 * listed via /api/attachments/list, removed via /api/attachments/delete —
 * every one of those routes is the actual enforcement point (size, type,
 * the 10-item cap, the tier gate, the delete-permission rule); nothing here
 * is trusted on its own, see each route's own header comment.
 *
 * mode = 'reference' (ToDos): a typed "Location" (a file path or URL) plus
 * an optional Description — owner's own proposal, 2026-08-14 decisions log
 * — inserted directly via the Supabase client under RLS (migration 025's
 * insert policy allows a directly-inserted 'reference' row; a 'file' row is
 * refused the same way). No Storage, no API route, no delete route either:
 * ToDos have no recipient, so the owner-or-own-upload DELETE policy already
 * covers every case a plain `.delete()` call needs.
 */

type Props = {
  requestId: string
  mode: 'file' | 'reference'
  /** Whether Add Attachment/Add Location should be offered at all — the
   * caller has already resolved this from the relevant tier (their own for
   * an owner-side screen, the issuer's owner_tier for a recipient-side one)
   * before rendering this panel. Re-checked server-side regardless for
   * mode = 'file'; mode = 'reference' relies on RLS (owner-only insert). */
  canAdd: boolean
  /** Session access token — present for the owner and a signed-in
   * recipient, null for an anonymous Request Response visitor. */
  authToken: string | null
  /** The anonymous /r/[token] link's own token, null everywhere else. */
  recipientToken: string | null
  /** True if the caller owns this Request/ToDo — can delete any row on it
   * regardless of who added it. */
  isOwner: boolean
  /** The caller's own auth.users id, for "can delete my own upload" —
   * null for an anonymous visitor (who gets no delete UI at all here,
   * matching the scoping decided in the plan doc). */
  currentUserId: string | null
  /** Own display name / fallback label, used when inserting a 'reference'
   * row directly (mode = 'reference' only). */
  ownerLabel: string
  /** True on a screen with no `.form` wrapper (Request Response, Response
   * Detail) — those screens' own Dialog panel already pads its empty-state
   * `.frow` with an inline `style={{ padding: '0 var(--pad)' }}` for the
   * same reason (2026-08-11, §6.32's own comment: "No .form/.fgroup wrapper
   * on this screen, so the empty row needs its own var(--pad)"). Request
   * Detail/ToDo Detail wrap everything in `<form className="form">`, which
   * already supplies that inset via container padding — passing `standalone`
   * there would double it. Default false (assume a `.form` ancestor).
   * 2026-08-14, owner-reported misalignment fix. */
  standalone?: boolean
  /** True when this Request/ToDo currently has a Repeat set — shows a small
   * "Repeat" checkbox on each row, letting the owner pick which existing
   * Attachments/Locations should carry forward into future occurrences
   * (migration 038, 2026-08-21). Jim's own recommendation, confirmed:
   * surfaced here rather than only at initial Send, since Request Detail/
   * ToDo Detail already have real rows to toggle. Owner-only — never shown
   * on the two recipient-facing call sites (Request Response, Response
   * Detail), which never pass this prop. */
  showCarryToggle?: boolean
}

const emptyLabel = { file: 'Attachments', reference: 'Locations' } as const
const addLabel = { file: 'Add Attachment', reference: 'Add Location' } as const

export default function AttachmentsPanel({
  requestId,
  mode,
  canAdd,
  authToken,
  recipientToken,
  isOwner,
  currentUserId,
  ownerLabel,
  standalone = false,
  showCarryToggle = false,
}: Props) {
  const [rows, setRows] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [refFormOpen, setRefFormOpen] = useState(false)
  const [refDescription, setRefDescription] = useState('')
  const [refLocation, setRefLocation] = useState('')
  const [refError, setRefError] = useState<string | null>(null)
  const [refSaving, setRefSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/attachments/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ requestId, token: recipientToken }),
        })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError('Could not load Attachments.')
          setRows([])
        } else {
          setRows(body.attachments ?? [])
        }
      } catch {
        if (!cancelled) setError('Could not load Attachments.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [requestId, authToken, recipientToken])

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return

    for (const f of picked) {
      if (rows.filter((r) => r.kind === 'file').length >= MAX_ATTACHMENTS_PER_ITEM) {
        setError(`You can attach up to ${MAX_ATTACHMENTS_PER_ITEM} files.`)
        break
      }
      if (isBlockedFileType(f.name)) {
        setError(`${fileExtension(f.name) || 'That file type'} isn't supported.`)
        continue
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setError(`${f.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`)
        continue
      }

      setUploading(true)
      setError(null)
      const body = new FormData()
      body.append('file', f)
      body.append('requestId', requestId)
      if (recipientToken) body.append('token', recipientToken)

      try {
        const res = await fetch('/api/attachments/upload', {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          body,
        })
        const resBody = await res.json()
        if (!res.ok) {
          setError(
            resBody.error === 'limit_reached'
              ? `Attachment limit reached (${MAX_ATTACHMENTS_PER_ITEM}).`
              : `Could not upload ${f.name}.`
          )
        } else {
          setRows((current) => [resBody.attachment, ...current])
        }
      } catch {
        setError(`Could not upload ${f.name}.`)
      } finally {
        setUploading(false)
      }
    }
  }

  async function handleDelete(id: string) {
    if (!authToken) return // no delete UI is offered without a session — see file header comment
    if (mode === 'reference') {
      // Direct client delete under RLS — no Storage object to clean up, and
      // ToDos have no recipient, so "owner or own-upload" always resolves
      // to just "owner" here.
      const { deleteAttachmentReference } = await import('@/lib/attachmentsClient')
      const ok = await deleteAttachmentReference(id)
      if (ok) setRows((current) => current.filter((r) => r.id !== id))
      else setError('Could not remove this Location.')
      return
    }
    try {
      const res = await fetch('/api/attachments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ requestId, attachmentId: id }),
      })
      if (res.ok) setRows((current) => current.filter((r) => r.id !== id))
      else setError('Could not remove this attachment.')
    } catch {
      setError('Could not remove this attachment.')
    }
  }

  async function handleToggleCarry(id: string, checked: boolean) {
    const { updateCarryIntoRepeats } = await import('@/lib/attachmentsClient')
    const ok = await updateCarryIntoRepeats(id, checked)
    if (ok) {
      setRows((current) => current.map((r) => (r.id === id ? { ...r, carry_into_repeats: checked } : r)))
    } else {
      setError('Could not update the Repeat selection.')
    }
  }

  async function handleSaveReference() {
    const description = refDescription.trim()
    const location = refLocation.trim()
    if (description === '' && location === '') {
      setRefError('Enter a Location or Cancel.')
      return
    }
    setRefSaving(true)
    setRefError(null)
    const { insertAttachmentReference } = await import('@/lib/attachmentsClient')
    const result = await insertAttachmentReference({
      requestId,
      uploadedByLabel: ownerLabel,
      referenceNote: description === '' ? null : description,
      referenceUrl: location === '' ? null : location,
    })
    setRefSaving(false)
    if (!result) {
      setRefError('Could not save this Location.')
      return
    }
    setRows((current) => [result, ...current])
    setRefDescription('')
    setRefLocation('')
    setRefFormOpen(false)
  }

  // Closed via Cancel or the scrim — same reset as a successful Save, minus
  // the insert. 2026-08-22: Add Location converted from an always-visible
  // inline card to a real modal, matching CreateTodoForm.tsx's identical
  // conversion (see that file's closeLocationModal comment for the full
  // reasoning) — this panel is the shared Locations UI for every existing-
  // item screen (ToDo Detail, and mode='file' Attachments on Request
  // Detail/Response/Response Detail, which keeps its own separate file-
  // picker flow untouched by this change).
  function closeRefForm() {
    setRefFormOpen(false)
    setRefDescription('')
    setRefLocation('')
    setRefError(null)
  }

  const items = rows
  const label = emptyLabel[mode]
  const addText = addLabel[mode]

  async function handleCopyLocation(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — nothing
      // else to do here; the path is still fully visible to select/copy by hand.
    }
  }

  if (loading) return null // avoid a flash of the empty state while the first fetch resolves

  // Screens with no `.form` wrapper (Request Response, Response Detail) need
  // each row's own horizontal inset — see the `standalone` prop comment.
  // `.frow`/`.fieldact` are plain flex rows (padding insets their content
  // directly); `.dlgstaged` is a bordered/background card, so it needs
  // margin instead — padding would shrink the box rather than shift it.
  const rowPad = standalone ? { paddingLeft: 'var(--pad)', paddingRight: 'var(--pad)' } : undefined
  // The zero-entries unlocked row (.actlabel + button) matches Dialog's own
  // empty-state row on these same two screens exactly, inline style and
  // all (`padding: '0 var(--pad)', marginBottom: 12`) — the first pass of
  // this fix only carried the horizontal padding over, not the bottom
  // margin, which the owner's own follow-up screenshots still showed as a
  // misalignment against the Dialog row above it (2026-08-14, second
  // report). Scoped to this one row, not folded into rowPad above — rowPad
  // is shared with the populated-state .fieldact row, which already has
  // its own margin-bottom baked into that CSS class and would double up.
  const emptyRowStyle = standalone ? { padding: '0 var(--pad)', marginBottom: 12 } : undefined
  const cardMargin = standalone ? { marginLeft: 'var(--pad)', marginRight: 'var(--pad)' } : undefined

  return (
    <div className="fgroup">
      {items.length === 0 ? (
        canAdd ? (
          // Same bordered .actlabel box for both modes now (2026-08-14,
          // owner-reported, screenshots comparing ToDo Detail's tinted
          // "Note:" band against Create ToDo's own bordered-box rendering,
          // annotated "Preferred method") — mode='reference' previously
          // routed through a separate .donerow/.donenote treatment here,
          // the only place Locations' empty state actually looked different
          // from Attachments' own (which has always used this same box).
          // Attachments keeps its short "Attachments (optional)" label;
          // Locations shows the fuller descriptive referenceNote text
          // instead, un-bolded — plain descriptive copy, same register as
          // Dialog's own "Questions, Answers, Comments" box, not a "Note:"-
          // prefixed callout.
          <div className="frow" style={emptyRowStyle}>
            <span className="actlabel">
              {mode === 'file' ? (
                <>
                  {label} <span className="subnote">(optional)</span>
                </>
              ) : (
                referenceNote
              )}
            </span>
            <button
              className="btn"
              type="button"
              onClick={() => (mode === 'file' ? fileInputRef.current?.click() : setRefFormOpen(true))}
            >
              {addText}
            </button>
          </div>
        ) : (
          <div className="donerow">
            <span className="donenote">
              <b>Note:</b> {label} are a Subscription feature.
            </span>
            <button className="btn is-locked" type="button" aria-disabled="true">
              <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              {addText}
            </button>
          </div>
        )
      ) : (
        <>
          {canAdd && mode === 'file' && (
            <div className="fieldact" style={rowPad}>
              <button
                className="btn"
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {addText}
              </button>
            </div>
          )}
          {canAdd && mode === 'reference' && items.length > 0 && (
            <div className="fieldact" style={rowPad}>
              <button className="btn" type="button" onClick={() => setRefFormOpen(true)}>
                {addText}
              </button>
            </div>
          )}
          <div className="dlgstaged" style={cardMargin}>
            {items.map((row) => {
              const canDelete = !!authToken && (isOwner || (currentUserId && row.uploaded_by === currentUserId))
              if (row.kind === 'file') {
                return (
                  <div className="attitem" key={row.id}>
                    <span className="attname">
                      {row.url ? (
                        <a href={row.url} target="_blank" rel="noopener noreferrer">
                          {row.file_name}
                        </a>
                      ) : (
                        row.file_name
                      )}{' '}
                      <span className="subnote">
                        ({formatBytes(row.size_bytes ?? 0)}
                        {isOwner ? ` — ${row.uploaded_by_label}` : ''})
                      </span>
                    </span>
                    {showCarryToggle && (
                      <label className="carrytoggle" title="Carry this Attachment into future Repeats">
                        <input
                          type="checkbox"
                          checked={!!row.carry_into_repeats}
                          onChange={(e) => handleToggleCarry(row.id, e.target.checked)}
                        />
                        <span>Repeat</span>
                      </label>
                    )}
                    {canDelete && (
                      <button
                        className="attremove"
                        type="button"
                        aria-label={`Remove ${row.file_name}`}
                        onClick={() => handleDelete(row.id)}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                )
              }
              const url = row.reference_url
              const href = url ? urlLocationHref(url) : null
              return (
                <div className="attitem" key={row.id}>
                  <span className="attname">
                    {row.reference_note && (
                      <>
                        <b>{row.reference_note}</b>
                        <br />
                      </>
                    )}
                    {url ? (
                      href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {url}
                        </a>
                      ) : (
                        url
                      )
                    ) : null}
                  </span>
                  {url && !href && (
                    <button className="linkbtn" type="button" onClick={() => handleCopyLocation(row.id, url)}>
                      {copiedId === row.id ? 'Copied' : 'Copy'}
                    </button>
                  )}
                  {showCarryToggle && (
                    <label className="carrytoggle" title="Carry this Location into future Repeats">
                      <input
                        type="checkbox"
                        checked={!!row.carry_into_repeats}
                        onChange={(e) => handleToggleCarry(row.id, e.target.checked)}
                      />
                      <span>Repeat</span>
                    </label>
                  )}
                  {canDelete && (
                    <button
                      className="attremove"
                      type="button"
                      aria-label="Remove this Location"
                      onClick={() => handleDelete(row.id)}
                    >
                      &times;
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      {mode === 'file' && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFilesSelected}
        />
      )}
      {error && <p className="ferror">{error}</p>}

      {/* Add Location modal (mode='reference' only) — converted from an
          always-visible inline card to a real modal, 2026-08-22, matching
          CreateTodoForm.tsx's identical conversion. See closeRefForm's own
          comment above for the full reasoning. */}
      {refFormOpen && (
        <>
          <div className="scrim" onClick={closeRefForm} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="addloc-title">
            <div className="modalhead">
              <p className="modal-title" id="addloc-title">
                Add Location
              </p>
              <div className="modalacts">
                <button className="btn-secondary" type="button" onClick={closeRefForm}>
                  Cancel
                </button>
                <button className="btn" type="button" disabled={refSaving} onClick={handleSaveReference}>
                  {refSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <div className="fgroup ffloat">
              <input
                className="finput"
                placeholder=" "
                value={refDescription}
                onChange={(e) => setRefDescription(e.target.value)}
                autoFocus
              />
              <label className="flabel">Description</label>
            </div>
            <div className="fgroup ffloat">
              <input
                className="finput"
                placeholder=" "
                value={refLocation}
                onChange={(e) => setRefLocation(e.target.value)}
              />
              <label className="flabel">Location (path or URL)</label>
            </div>
            {refError && <p className="ferror" style={{ marginTop: -8 }}>{refError}</p>}
          </div>
        </>
      )}
    </div>
  )
}
