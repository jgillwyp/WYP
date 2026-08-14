import { getServiceRoleClient, resolvePermission } from '../_shared'

export const runtime = 'nodejs'

/**
 * POST /api/attachments/list — body `{ requestId, token? }`, optional
 * `Authorization: Bearer <token>` header. Returns every attachment (both
 * kinds) on a Request/ToDo the caller is allowed to see, with a fresh
 * 5-minute signed Storage URL on each `kind = 'file'` row.
 *
 * Deliberately does NOT gate on ownerTier — an attachment already added
 * stays visible to everyone who could always see it, whatever anyone's tier
 * is now (CLAUDE.md's Entitlements section: "gates govern adding, never
 * viewing"). ownerTier is still returned in the response so the calling
 * screen knows whether to offer Add Attachment/Add Location, without a
 * second round trip.
 *
 * POST rather than GET specifically so the anonymous token never has to
 * travel in a URL/query string.
 */
export async function POST(request: Request) {
  let body: { requestId?: string; token?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const requestId = body.requestId
  if (!requestId) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  const permission = await resolvePermission({
    requestId,
    authHeader,
    token: body.token ?? null,
  })

  if (!permission) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const admin = getServiceRoleClient()
  const { data: rows, error } = await admin
    .from('attachments')
    .select(
      'id, kind, file_name, size_bytes, mime_type, reference_url, reference_note, uploaded_by, uploaded_by_label, created_at, storage_path'
    )
    .eq('request_id', permission.requestId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error || !rows) {
    return Response.json({ error: 'read_failed' }, { status: 500 })
  }

  const attachments = await Promise.all(
    rows.map(async (row) => {
      let url: string | null = null
      if (row.kind === 'file' && row.storage_path) {
        const { data: signed } = await admin.storage
          .from('attachments')
          .createSignedUrl(row.storage_path, 300)
        url = signed?.signedUrl ?? null
      }
      return {
        id: row.id,
        kind: row.kind,
        file_name: row.file_name,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
        reference_url: row.reference_url,
        reference_note: row.reference_note,
        uploaded_by: row.uploaded_by,
        uploaded_by_label: row.uploaded_by_label,
        created_at: row.created_at,
        url,
      }
    })
  )

  return Response.json({
    attachments,
    ownerTier: permission.ownerTier,
    role: permission.role,
    uploaderId: permission.uploaderId,
  })
}
