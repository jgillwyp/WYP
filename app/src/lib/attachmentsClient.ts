// src/lib/attachmentsClient.ts
//
// Client-side attachments helpers shared across AttachmentsPanel.tsx,
// CreateRequestForm.tsx, and CreateTodoForm.tsx. Two different shapes:
//
// - insertAttachmentReference/deleteAttachmentReference/
//   updateCarryIntoRepeats below are direct-client (RLS-scoped, no API
//   route) calls for `kind = 'reference'` rows — ToDo "Locations" (Week 5
//   Priority 3, 2026-08-14). `kind = 'file'` rows never go through these —
//   migration 025's insert policy refuses a direct 'file' insert on
//   purpose; see app/api/attachments/upload/route.ts.
// - uploadAttachmentWithRetry (2026-09-15) is the other shape: a real
//   `kind = 'file'` upload, which has to go through that API route, plus
//   the retry-with-backoff this app's other write paths didn't have
//   either until this file's own comment on it below.

import { supabase } from './supabaseClient'
import { MAX_ATTACHMENTS_PER_ITEM, type AttachmentRow } from './attachments'

export async function insertAttachmentReference(opts: {
  requestId: string
  uploadedByLabel: string
  referenceNote: string | null
  referenceUrl: string | null
  // Repeat carry-forward (migration 038, 2026-08-21) — optional, defaults to
  // false via the column's own default; only ever passed true from
  // CreateTodoForm.tsx's staged-Locations carry-forward prompt.
  carryIntoRepeats?: boolean
}): Promise<AttachmentRow | null> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      request_id: opts.requestId,
      uploaded_by: userData.user.id,
      uploaded_by_label: opts.uploadedByLabel,
      kind: 'reference',
      reference_note: opts.referenceNote,
      reference_url: opts.referenceUrl,
      carry_into_repeats: opts.carryIntoRepeats ?? false,
    })
    .select('id, kind, file_name, size_bytes, mime_type, reference_url, reference_note, uploaded_by, uploaded_by_label, created_at')
    .single()

  if (error || !data) return null
  return data as AttachmentRow
}

export async function deleteAttachmentReference(id: string): Promise<boolean> {
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  return !error
}

/**
 * Repeat carry-forward toggle (migration 038, 2026-08-21) — works on either
 * kind ('file' or 'reference'), unlike the two functions above. Needs its
 * own narrow RLS UPDATE policy + column-level GRANT — migration 025 left
 * attachments with no UPDATE policy at all ("added or removed, never
 * edited in place"), so this is the one column carved out as an
 * exception, not a general edit capability.
 */
export async function updateCarryIntoRepeats(id: string, carry: boolean): Promise<boolean> {
  const { error } = await supabase.from('attachments').update({ carry_into_repeats: carry }).eq('id', id)
  return !error
}

export type UploadAttachmentOptions = {
  authToken?: string | null
  recipientToken?: string | null
  // Repeat carry-forward selection — only meaningful when a Repeat rule is
  // set, but harmless to send either way; omitted entirely (rather than
  // sent false) preserves the exact FormData shape every pre-2026-09-15
  // caller already sent.
  carryIntoRepeats?: boolean
}

export type UploadAttachmentResult =
  | { ok: true; attachment: AttachmentRow }
  | { ok: false; message: string }

/**
 * Real `kind = 'file'` upload via /api/attachments/upload, with retry-
 * with-backoff (2026-09-15, owner-reported — a 1.9 MB attachment failed to
 * upload on a weak cellular connection, iPhone). Same three-attempt
 * (immediate, 600ms, 1600ms) shape as the load-retry fix already applied
 * to Main Screen/Archive/Contacts (2026-09-11) — this was the one write
 * path in the app that still had none.
 *
 * Only retries a failure that's plausibly transient: a network-level
 * exception (fetch itself threw — the connection dropped mid-upload,
 * exactly the shape of a weak-signal mobile upload) or a 5xx from the
 * server (upload_failed/insert_failed, a real Storage/DB hiccup). A 4xx
 * (blocked_type/too_large/limit_reached/storage_limit/not_found) is a
 * deterministic answer the server will give again identically, so it
 * fails immediately with the real reason rather than wasting two more
 * attempts on an answer that can't change.
 *
 * Accepted risk, not fully eliminated: if the server actually finishes
 * (Storage object + DB row both created) but the response never reaches
 * the client — the narrow window between the server sending success and
 * the client receiving it — a retry creates a second, duplicate
 * attachment. Judged worth it: that window is far narrower than "the
 * connection drops before the server ever finishes" (what actually
 * happens on a weak connection), and a duplicate is a harmless,
 * manually-deletable nuisance next to a Request that saved with an
 * attachment silently missing and no automatic way back in.
 */
export async function uploadAttachmentWithRetry(
  file: File,
  requestId: string,
  opts: UploadAttachmentOptions = {}
): Promise<UploadAttachmentResult> {
  const delaysMs = [0, 600, 1600]
  let lastMessage = `Could not upload ${file.name}.`

  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i] > 0) await new Promise((r) => setTimeout(r, delaysMs[i]))

    const body = new FormData()
    body.append('file', file)
    body.append('requestId', requestId)
    if (opts.recipientToken) body.append('token', opts.recipientToken)
    if (opts.carryIntoRepeats !== undefined) {
      body.append('carryIntoRepeats', opts.carryIntoRepeats ? 'true' : 'false')
    }

    try {
      const res = await fetch('/api/attachments/upload', {
        method: 'POST',
        headers: opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {},
        body,
      })
      const resBody = await res.json().catch(() => ({}))

      if (res.ok) {
        return { ok: true, attachment: resBody.attachment as AttachmentRow }
      }

      if (resBody.error === 'limit_reached') {
        return { ok: false, message: `Attachment limit reached (${MAX_ATTACHMENTS_PER_ITEM}).` }
      }
      if (resBody.error === 'storage_limit') {
        return { ok: false, message: resBody.detail ?? 'This would exceed the storage allowance.' }
      }
      if (res.status < 500) {
        return {
          ok: false,
          message: resBody.detail ? `Could not upload ${file.name}: ${resBody.detail}` : `Could not upload ${file.name}.`,
        }
      }

      lastMessage = resBody.detail
        ? `Could not upload ${file.name}: ${resBody.detail}`
        : `Could not upload ${file.name}.`
      console.error(`Attachment upload attempt ${i + 1} failed (status ${res.status}):`, resBody)
    } catch (err) {
      lastMessage = `Could not upload ${file.name}. Check your connection and try again.`
      console.error(`Attachment upload attempt ${i + 1} failed:`, err)
    }
  }

  return { ok: false, message: lastMessage }
}
