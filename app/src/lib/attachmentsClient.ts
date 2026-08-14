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
