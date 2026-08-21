// src/lib/attachmentsClient.ts
//
// Direct-client (RLS-scoped, no API route) helpers for `kind = 'reference'`
// attachments rows — ToDo "Locations" (Week 5 Priority 3, 2026-08-14).
// Only ever used by AttachmentsPanel.tsx and CreateTodoForm.tsx's own
// staged-Locations code. `kind = 'file'` rows never go through here —
// migration 025's insert policy refuses a direct 'file' insert on purpose;
// see app/api/attachments/upload/route.ts.

import { supabase } from './supabaseClient'
import type { AttachmentRow } from './attachments'

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
