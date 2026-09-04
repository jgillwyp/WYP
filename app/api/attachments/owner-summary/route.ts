import { ATTACHMENT_SIGNED_URL_TTL_SECONDS, getForwardedClient, getOwnerStorageStatus, getServiceRoleClient } from '../_shared'

export const runtime = 'nodejs'

/**
 * POST /api/attachments/owner-summary — the data source for the Storage
 * Management screen (app/components/StorageManagementForm.tsx, 2026-09-03),
 * converting design/screens/WYP_storage_maintenance_palette1.html to live.
 * Requires an `Authorization: Bearer <token>` header — owner-only, no
 * anonymous or recipient path (unlike the other attachments routes), since
 * this screen is reached only from the signed-in owner's own Account
 * Options.
 *
 * Returns every real `kind = 'file'` attachment across every Request/ToDo
 * the caller owns — not scoped to one requestId, unlike
 * app/api/attachments/list/route.ts — plus the same usedBytes/limitBytes/
 * tier getOwnerStorageStatus() already computes for the upload route, so
 * the screen's own usage bar and the server's own enforcement never
 * disagree.
 *
 * Identity is verified via the forwarded client's own getUser() (RLS-scoped,
 * same as every other route's owner path) before any service_role read
 * happens; service_role is then used for the actual data fetch and signed
 * URLs, matching this file's own established posture (attachments.uploaded_
 * by/owner data spans multiple tables in ways RLS's per-row policies don't
 * cleanly join, and Storage signed URLs need service_role regardless, since
 * migration 026 grants no Storage RLS to authenticated at all).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const forwarded = getForwardedClient(authHeader)
  const { data: userData } = await forwarded.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const ownerId = userData.user.id

  const admin = getServiceRoleClient()

  const { usedBytes, limitBytes, tier } = await getOwnerStorageStatus(admin, ownerId)

  const { data: ownedRequests } = await admin
    .from('requests')
    .select('id, description, contact_id, contacts(display_name)')
    .eq('owner_id', ownerId)

  type OwnedRequest = {
    id: string
    description: string | null
    contact_id: string | null
    contacts: { display_name: string | null } | { display_name: string | null }[] | null
  }
  const requestMap = new Map<string, OwnedRequest>()
  for (const r of (ownedRequests ?? []) as OwnedRequest[]) requestMap.set(r.id, r)
  const requestIds = Array.from(requestMap.keys())

  if (requestIds.length === 0) {
    return Response.json({ usedBytes, limitBytes, tier, attachments: [] })
  }

  const { data: rows, error } = await admin
    .from('attachments')
    .select('id, request_id, file_name, size_bytes, mime_type, uploaded_by_label, created_at, storage_path')
    .in('request_id', requestIds)
    .eq('kind', 'file')
    .is('deleted_at', null)

  if (error || !rows) {
    return Response.json({ error: 'read_failed' }, { status: 500 })
  }

  const attachments = await Promise.all(
    rows.map(async (row) => {
      let url: string | null = null
      if (row.storage_path) {
        const { data: signed } = await admin.storage
          .from('attachments')
          .createSignedUrl(row.storage_path, ATTACHMENT_SIGNED_URL_TTL_SECONDS)
        url = signed?.signedUrl ?? null
      }

      const owningRequest = requestMap.get(row.request_id)
      const contactField = owningRequest?.contacts
      const contactName = Array.isArray(contactField)
        ? (contactField[0]?.display_name ?? null)
        : (contactField?.display_name ?? null)

      return {
        id: row.id,
        request_id: row.request_id,
        file_name: row.file_name,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
        uploaded_by_label: row.uploaded_by_label,
        created_at: row.created_at,
        url,
        source: {
          kind: (owningRequest?.contact_id ? 'request' : 'todo') as 'request' | 'todo',
          description: owningRequest?.description ?? '',
          contactName,
        },
      }
    })
  )

  return Response.json({ usedBytes, limitBytes, tier, attachments })
}
