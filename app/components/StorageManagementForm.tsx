'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  formatBytes,
  isOfficeViewable,
  officeViewerUrl,
} from '@/lib/attachments'

/**
 * Storage Management (2026-09-03, §6.49 PROPOSED) — converts
 * design/screens/WYP_storage_maintenance_palette1.html to live. Reached
 * from Account Options ("Manage Storage" link in the Subscriber section)
 * and from Main Screen's own Housekeeping band. See app/api/attachments/
 * owner-summary/route.ts's own header comment for the data-source design
 * (owner-only, cross-Request/ToDo, service_role-backed).
 *
 * Three deliberate departures from the mockup, each already explained in
 * globals.css's own §6.49 header comment: no .sortrow/.pill/.autonote (this
 * screen instead reuses the app's existing .chips/.chip toggle, and drops
 * the auto-deletion note outright — no lapse-and-auto-delete job exists yet,
 * CLAUDE.md's own Known gaps section), and no .sumoffer "Subscribe" button
 * (replaced by the same .subbanner-row every other screen already ends
 * with). The confirm-delete modal also drops the mockup's own aspirational
 * "the Request will show that an attachment was removed" sentence — no such
 * audit trail exists in the real attachments table (a hard delete, per
 * CLAUDE.md's own Attachments section).
 *
 * Storage limit displayed/enforced here is whatever getOwnerStorageStatus()
 * computes — the real tier-based cap, or the private-testing-only
 * storage_limit_override_bytes override (migration 051) when set via
 * Account Options' own Test Storage Cap control. The two numbers can never
 * disagree, since both this screen and the upload route's own quota check
 * read the same function.
 *
 * View vs. Download (2026-09-04) — owner-reported: clicking "Download" on a
 * .jpg/.pdf/.html attachment opened it directly in the browser instead of
 * saving it, while .xlsx/.docx (unrenderable) correctly saved. Two separate
 * affordances now: the file NAME is a "View" link (same officeViewerUrl()
 * routing AttachmentsPanel.tsx's own name-click already uses for Office
 * types, a plain link elsewhere — a browser renders jpg/pdf/html inline on
 * its own, which is exactly what viewing wants); the "Download" link/api/
 * attachments/owner-summary's own `download_url` (see
 * app/api/attachments/_shared.ts's createAttachmentUrls) — a second signed
 * URL for the same object with Supabase's own `download` option set, which
 * adds a real `Content-Disposition: attachment` header, the one thing that
 * reliably overrides a browser's own inline-render default regardless of
 * file type or device (an anchor's own `download` attribute is silently
 * ignored cross-origin, so that alone was never going to work here).
 */

const MAX_ATTACHMENT_FOOTNOTE =
  `Attachment limits: ${formatBytes(MAX_ATTACHMENT_BYTES)} per file, ` +
  `${MAX_ATTACHMENTS_PER_ITEM} attachments per Request or ToDo.`

type SortMode = 'largest' | 'oldest'

type AttachmentRow = {
  id: string
  request_id: string
  file_name: string
  size_bytes: number
  mime_type: string | null
  uploaded_by_label: string | null
  created_at: string
  url: string | null
  download_url: string | null
  source: {
    kind: 'request' | 'todo'
    description: string
    contactName: string | null
  }
}

// Same local-time-getters pattern established 2026-09-03 for created_at
// (a timestamptz) — see the "UTC-vs-local date bug" fix elsewhere in this
// codebase for why formatMDY() (date-only columns) must not be reused here.
function formatCreatedDate(value: string): string {
  const d = new Date(value)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}-${dd}-${yy}`
}

function friendlyFileType(mimeType: string | null, fileName: string): string {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  if (mimeType?.startsWith('image/')) return 'Image'
  if (mimeType?.startsWith('video/')) return 'Video'
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'PDF'
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(ext ?? '')) return 'Spreadsheet'
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext ?? '')) return 'Document'
  if (['ppt', 'pptx'].includes(ext ?? '')) return 'Presentation'
  if (['zip', 'rar', '7z'].includes(ext ?? '')) return 'Archive'
  return ext ? ext.toUpperCase() : 'File'
}

function truncateDescription(text: string, max = 40): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

// Copyright-line year — see ContactDetailForm.tsx's identical helper for the
// full reasoning; duplicated per file per this codebase's own convention.
function losAngelesYear(): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(new Date())
}

export default function StorageManagementForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [usedBytes, setUsedBytes] = useState(0)
  const [limitBytes, setLimitBytes] = useState(0)
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])

  const [sortMode, setSortMode] = useState<SortMode>('largest')

  const [removeTarget, setRemoveTarget] = useState<AttachmentRow | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        if (!cancelled) {
          setLoadError('Not signed in.')
          setLoading(false)
        }
        return
      }

      try {
        const res = await fetch('/api/attachments/owner-summary', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || json.error) {
          setLoadError('Could not load your attachments. Please try again.')
          setLoading(false)
          return
        }
        setUsedBytes(json.usedBytes ?? 0)
        setLimitBytes(json.limitBytes ?? 0)
        setTier(json.tier === 'subscriber' ? 'subscriber' : 'free')
        setAttachments(json.attachments ?? [])
        setLoading(false)
      } catch {
        if (!cancelled) {
          setLoadError('Could not load your attachments. Please try again.')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const sortedAttachments = useMemo(() => {
    const copy = [...attachments]
    if (sortMode === 'largest') {
      copy.sort((a, b) => b.size_bytes - a.size_bytes)
    } else {
      copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return copy
  }, [attachments, sortMode])

  const usedPct = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 0
  const availableBytes = Math.max(0, limitBytes - usedBytes)
  const isCritical = limitBytes > 0 && usedBytes / limitBytes >= 0.9

  async function handleRemoveConfirmed() {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setRemoving(false)
      setRemoveError('Not signed in.')
      return
    }

    try {
      const res = await fetch('/api/attachments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: removeTarget.request_id, attachmentId: removeTarget.id }),
      })
      const json = await res.json().catch(() => ({}) as { ok?: boolean; error?: string })
      setRemoving(false)
      if (!res.ok || !json.ok) {
        setRemoveError(json.error || 'Could not remove this attachment.')
        return
      }
      setAttachments((prev) => prev.filter((a) => a.id !== removeTarget.id))
      setUsedBytes((prev) => Math.max(0, prev - removeTarget.size_bytes))
      setRemoveTarget(null)
    } catch {
      setRemoving(false)
      setRemoveError('Could not remove this attachment.')
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
        <WypHeader />

        <div className="band">
          <span className="glabel">Storage Management</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <div className="sum">
            <div className="sumtop">
              <span className="sumbig">{formatBytes(usedBytes)}</span>
              <span className="sumlab">of {formatBytes(limitBytes)} used</span>
            </div>
            <div className={`bar${isCritical ? ' crit' : ''}`}>
              <span style={{ width: `${usedPct}%` }} />
            </div>
            <div className="sumnote">
              {formatBytes(availableBytes)} available &#8212; {tier === 'subscriber' ? 'your Subscriber' : 'free tier'}{' '}
              limit. Attachments count against the sender of the Request, including files added by the recipient.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--strip)',
              padding: '7px var(--pad)',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span className="sortlab">Sort</span>
            <div className="chips">
              <button
                className={`chip${sortMode === 'largest' ? ' sel' : ''}`}
                type="button"
                onClick={() => setSortMode('largest')}
              >
                Largest first
              </button>
              <button
                className={`chip${sortMode === 'oldest' ? ' sel' : ''}`}
                type="button"
                onClick={() => setSortMode('oldest')}
              >
                Oldest first
              </button>
            </div>
          </div>

          {sortedAttachments.length === 0 && (
            <div className="subempty">No attachments yet.</div>
          )}

          {sortedAttachments.map((row) => (
            <div className="arow" key={row.id}>
              <span className="clip" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                  <path
                    d="M36,20 L20,36 Q14,42 8,36 Q2,30 8,24 L24,8 Q28,4 33,8 Q38,13 34,17 L18,33 Q16,35 14,33 Q12,31 14,29 L28,15"
                    fill="none"
                    stroke="#6B7280"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="ameta">
                <div className="aname">
                  {row.url ? (
                    <a
                      href={isOfficeViewable(row.file_name) ? officeViewerUrl(row.url) : row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.file_name}
                    </a>
                  ) : (
                    row.file_name
                  )}
                </div>
                <div className="asub">
                  {formatBytes(row.size_bytes)} &#183; {friendlyFileType(row.mime_type, row.file_name)} &#183;{' '}
                  {formatCreatedDate(row.created_at)}
                </div>
                <div className="asrc">
                  {row.source.kind === 'request'
                    ? `Request to ${row.source.contactName ?? 'Contact'}${
                        row.source.description ? ` — “${truncateDescription(row.source.description)}”` : ''
                      }`
                    : `ToDo${row.source.description ? ` — “${truncateDescription(row.source.description)}”` : ''}`}
                  <br />
                  Added by <b>{row.uploaded_by_label ?? 'Unknown'}</b>
                </div>
              </div>
              <div className="aacts">
                {(row.download_url || row.url) && (
                  <a className="dl" href={row.download_url ?? row.url ?? undefined} rel="noreferrer">
                    Download
                  </a>
                )}
                <button className="x" type="button" aria-label={`Remove ${row.file_name}`} onClick={() => setRemoveTarget(row)}>
                  &#215;
                </button>
              </div>
            </div>
          ))}

          <p className="subnote" style={{ padding: '10px var(--pad)' }}>
            Removing an attachment cannot be undone, and it removes the file for both you and the other party.
            Download anything you want to keep first.
            <br />
            <br />
            {MAX_ATTACHMENT_FOOTNOTE}
          </p>
        </div>

        {removeTarget && (
          <>
            <div className="scrim" onClick={() => (removing ? null : setRemoveTarget(null))} />
            <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-attachment-title">
              <div className="modalhead">
                <p className="modal-title" id="remove-attachment-title">
                  Remove &ldquo;{removeTarget.file_name}&rdquo;?
                </p>
              </div>
              <p className="subnote">
                This frees {formatBytes(removeTarget.size_bytes)} and cannot be undone.{' '}
                {removeTarget.uploaded_by_label ?? 'The other party'} will no longer see the file.
              </p>

              {removeError && (
                <p className="ferror" role="alert">
                  {removeError}
                </p>
              )}

              <div className="modalacts" style={{ marginTop: 12 }}>
                <button className="btn-secondary" type="button" onClick={() => setRemoveTarget(null)} disabled={removing}>
                  Cancel
                </button>
                <button className="btn-danger" type="button" onClick={handleRemoveConfirmed} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="subbanner-row">
          <button className="btn-secondary" type="button" onClick={() => router.push('/account/subscription')}>
            Subscription Features and Options
          </button>
          <button className="btn-secondary" type="button" onClick={() => router.push('/privacy')}>
            Privacy
          </button>
        </div>
        <p className="subcopyright">{`© ${losAngelesYear()} Would You Please, Inc. All rights reserved.`}</p>
        {tier !== 'subscriber' && (
          <div className="adslot" aria-hidden="true">
            <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
          </div>
        )}
      </div>
    </div>
  )
}
