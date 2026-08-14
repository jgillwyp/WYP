import { getServiceRoleClient, resolvePermission } from '../_shared'

export const runtime = 'nodejs'

/**
 * POST /api/attachments/delete — body `{ requestId, attachmentId }`,
 * requires an `Authorization: Bearer <token>` header. Anonymous
 * (token-only) deletes are out of scope for this pass — no delete UI is
 * offered on the anonymous Request Response screen at all, and this route
 * refuses without a session to attribute the action to (matches migration
 * 025's own DELETE policy, which likewise never matches a null
 * `uploaded_by` against anyone).
 *
 * Hard-deletes: removes the Storage object (kind = 'file' only) and the
 * row itself. Does NOT set deleted_at — that column is reserved for the
 * future lapse-and-auto-delete job (see migration 025's header comment).
 * Owner/uploader permission is re-checked here against the real row, not
 * assumed from whatever the Delete button's own visibility implied client-
 * side.
 */
export async function POST(request: Request) {
  let body: { requestId?: string; attachmentId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const requestId = body.requestId
  const attachmentId = body.attachmentId
  if (!requestId || !attachmentId) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const permission = await resolvePermission({ requestId, authHeader, token: null })
  if (!permission) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const admin = getServiceRoleClient()
  const { data: row, error: rowError } = await admin
    .from('attachments')
    .select('id, kind, storage_path, uploaded_by, request_id')
    .eq('id', attachmentId)
    .eq('request_id', permission.requestId)
    .single()

  if (rowError || !row) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Resolved delete rule (decisions log, 2026-08-14): the Request/ToDo
  // owner can always delete any attachment on their own item; a non-owner
  // uploader can only delete their own.
  const allowed = permission.role === 'owner' || row.uploaded_by === permission.uploaderId
  if (!allowed) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  if (row.kind === 'file' && row.storage_path) {
    await admin.storage.from('attachments').remove([row.storage_path])
  }

  const { error: deleteError } = await admin.from('attachments').delete().eq('id', row.id)
  if (deleteError) {
    return Response.json({ error: 'delete_failed', detail: deleteError.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
