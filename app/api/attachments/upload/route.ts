import { randomUUID } from 'crypto'

import { ATTACHMENT_SIGNED_URL_TTL_SECONDS, getServiceRoleClient, resolvePermission } from '../_shared'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  dedupeFileName,
  fileExtension,
  isBlockedFileType,
} from '@/lib/attachments'

// service_role needs Node's net/tls, same reasoning as
// app/api/email/send-request/route.ts's own runtime declaration.
export const runtime = 'nodejs'

/**
 * POST /api/attachments/upload — the only place a `kind = 'file'` row can
 * ever be created (migration 025's insert policy refuses one from any
 * direct client insert). multipart/form-data: `file`, `requestId`, and
 * either an `Authorization: Bearer <token>` header (owner or signed-in
 * recipient) or a `token` field (anonymous Request Response visitor).
 *
 * Every check here is real, not a courtesy on top of a client-side one —
 * size, extension, the 10-item cap, and the ownerTier === 'subscriber' gate
 * are all re-verified server-side even though CreateRequestForm.tsx/
 * RequestDetailForm.tsx/etc. already check most of these before ever
 * calling this route, matching CLAUDE.md's "the locked button is a
 * courtesy... assume the control was bypassed" rule for every gated write
 * in this app.
 */
export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const file = form.get('file')
  const requestId = form.get('requestId')
  const token = form.get('token')
  // Repeat carry-forward selection (Jim's own design, 2026-08-21, migration
  // 038) — optional; absent on every caller that predates Repeat, so this
  // defaults to false rather than requiring every existing call site to
  // start sending it.
  const carryIntoRepeats = form.get('carryIntoRepeats') === 'true'

  if (!(file instanceof File) || typeof requestId !== 'string' || !requestId) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  const permission = await resolvePermission({
    requestId,
    authHeader,
    token: typeof token === 'string' && token ? token : null,
  })

  if (!permission) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Rights on a Request come from its issuer, never the uploader — same
  // entitlements principle CLAUDE.md's own section already establishes.
  // Gates govern adding only; this is the "adding" gate.
  if (permission.ownerTier !== 'subscriber') {
    return Response.json({ error: 'not_subscriber' }, { status: 403 })
  }

  if (isBlockedFileType(file.name)) {
    return Response.json(
      { error: 'blocked_type', detail: `${fileExtension(file.name) || 'that file type'} isn't supported.` },
      { status: 400 }
    )
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 400 })
  }

  const admin = getServiceRoleClient()

  const { count } = await admin
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', permission.requestId)
    .eq('kind', 'file')

  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
    return Response.json({ error: 'limit_reached' }, { status: 400 })
  }

  const { data: existingRows } = await admin
    .from('attachments')
    .select('file_name')
    .eq('request_id', permission.requestId)
    .eq('kind', 'file')

  const existingNames = (existingRows ?? []).map((r) => r.file_name as string)
  const finalName = dedupeFileName(file.name, existingNames)

  const id = randomUUID()
  const storagePath = `${permission.requestId}/${id}-${finalName}`

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    return Response.json({ error: 'upload_failed', detail: uploadError.message }, { status: 500 })
  }

  const { data: newRow, error: insertError } = await admin
    .from('attachments')
    .insert({
      id,
      request_id: permission.requestId,
      uploaded_by: permission.uploaderId,
      uploaded_by_label: permission.uploaderLabel,
      kind: 'file',
      file_name: finalName,
      storage_path: storagePath,
      size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream',
      carry_into_repeats: carryIntoRepeats,
    })
    .select('id, file_name, size_bytes, mime_type, uploaded_by, uploaded_by_label, created_at')
    .single()

  if (insertError || !newRow) {
    // Clean up the orphaned Storage object rather than leave bytes with no
    // row pointing at them.
    await admin.storage.from('attachments').remove([storagePath])
    return Response.json(
      { error: 'insert_failed', detail: insertError?.message },
      { status: 500 }
    )
  }

  const { data: signed } = await admin.storage
    .from('attachments')
    .createSignedUrl(storagePath, ATTACHMENT_SIGNED_URL_TTL_SECONDS)

  return Response.json({
    attachment: {
      ...newRow,
      kind: 'file' as const,
      reference_url: null,
      reference_note: null,
      url: signed?.signedUrl ?? null,
    },
  })
}
