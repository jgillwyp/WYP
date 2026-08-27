import { randomUUID } from 'crypto'

import { getForwardedClient, getServiceRoleClient, resolvePermission } from '../_shared'
import { MAX_ATTACHMENTS_PER_ITEM, dedupeFileName } from '@/lib/attachments'

export const runtime = 'nodejs'

/**
 * POST /api/attachments/copy — body `{ sourceRequestId, newRequestId }`,
 * requires an `Authorization: Bearer <token>` header. Built 2026-08-27 for
 * the Request<->ToDo conversion feature's "Include Attachments and Dialog"
 * checkbox (ConversionBanner.tsx, conversionCarry.ts's own
 * applyConversionContentCopy) — Dialog copies through a plain client insert
 * under RLS (the new item is always owned by the caller), but a `kind =
 * 'file'` attachment can only ever be created here, server-side, the same
 * restriction /api/attachments/upload already lives under (migration 025's
 * insert policy refuses a client-inserted 'file' row outright).
 *
 * sourceRequestId is resolved through the same resolvePermission() every
 * other attachments route uses — covers both an owned source (Request
 * Detail/ToDo Detail converting their own item) and a recipient source
 * (Response Detail converting a Request sent to the signed-in caller by
 * someone else). newRequestId's ownership is verified independently via the
 * caller's own forwarded client: RLS's "requests: owners select own" already
 * returns nothing for a row the caller doesn't own, which is exactly the
 * check this route needs — the new item this route ever writes onto is
 * always owned by whoever is calling it.
 *
 * Gated on the caller's own tier, not the source's issuer tier — copying an
 * attachment onto the new item is "adding" a new attachment there (CLAUDE.md's
 * Entitlements section), and the new item's owner is the caller, not
 * whoever originally sent the source Request. Jim's own words scoping this:
 * "it for attachments will only be used for Subscribers." A free-tier caller
 * gets a silent no-op (200, copied: 0) rather than an error — this route is
 * only ever invoked automatically, post-Save, never from a visible button of
 * its own for the caller to retry.
 *
 * Deliberately duplicates the actual Storage object (`.copy()`, same call
 * Repeat's own carry-forward already makes in app/api/cron/tick/route.ts)
 * rather than sharing a reference — accepted by Jim alongside the whole
 * feature ("I also considered the duplication of attachments which results
 * from this approach... would expect this process to be infrequently used").
 * uploaded_by/uploaded_by_label are set to the caller, not the original
 * uploader — preserving the original uploader's id on a row now living under
 * a different owner would hand that unrelated person delete rights (via
 * migration 025's "owner or own-uploads" policy) on an item they have no
 * other connection to.
 */
export async function POST(request: Request) {
  let body: { sourceRequestId?: string; newRequestId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const sourceRequestId = body.sourceRequestId
  const newRequestId = body.newRequestId
  if (!sourceRequestId || !newRequestId) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const permission = await resolvePermission({ requestId: sourceRequestId, authHeader, token: null })
  if (!permission) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const fwd = getForwardedClient(authHeader)
  const { data: userData } = await fwd.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { data: destRow } = await fwd.from('requests').select('id').eq('id', newRequestId).single()
  if (!destRow) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: profile } = await fwd.from('profiles').select('tier, display_name').single()
  if (profile?.tier !== 'subscriber') {
    return Response.json({ ok: true, copied: 0, skipped: 'not_subscriber' })
  }

  const callerLabel = profile?.display_name ?? userData.user.email ?? 'You'
  const admin = getServiceRoleClient()

  const { data: sourceRows } = await admin
    .from('attachments')
    .select('id, kind, file_name, storage_path, mime_type, size_bytes, reference_note, reference_url')
    .eq('request_id', permission.requestId)
    .is('deleted_at', null)
    .order('created_at')

  const { data: existingRows } = await admin
    .from('attachments')
    .select('file_name')
    .eq('request_id', destRow.id)
    .eq('kind', 'file')

  const existingNames = (existingRows ?? []).map((r) => r.file_name as string)

  // existingNames.push() below grows on every successful file copy, so its
  // own .length already reflects the running total (pre-existing + copied
  // so far) — checking it alone is correct; adding `copied` on top of that
  // would double-count every file this loop has already copied. The cap
  // only ever applied to `kind = 'file'` counts elsewhere in this app
  // (upload/route.ts's own count query is likewise `.eq('kind', 'file')`),
  // so a still-lingering 'reference' row is never blocked by it.
  let copied = 0
  for (const att of sourceRows ?? []) {
    if (att.kind === 'file' && att.storage_path && att.file_name) {
      if (existingNames.length >= MAX_ATTACHMENTS_PER_ITEM) continue
      const finalName = dedupeFileName(att.file_name, existingNames)
      const newId = randomUUID()
      const newPath = `${destRow.id}/${newId}-${finalName}`
      const { error: copyError } = await admin.storage.from('attachments').copy(att.storage_path, newPath)
      if (copyError) continue

      const { error: insertError } = await admin.from('attachments').insert({
        id: newId,
        request_id: destRow.id,
        uploaded_by: userData.user.id,
        uploaded_by_label: callerLabel,
        kind: 'file',
        file_name: finalName,
        storage_path: newPath,
        size_bytes: att.size_bytes,
        mime_type: att.mime_type,
      })
      if (insertError) {
        await admin.storage.from('attachments').remove([newPath])
        continue
      }
      existingNames.push(finalName)
      copied += 1
    } else if (att.kind === 'reference') {
      // Legacy ToDo Locations rows, pre-migration-048 — no Storage object to
      // duplicate, a plain insert suffices. Retired going forward (ToDo
      // Attachments switched to real 'file' uploads, 2026-08-26), kept here
      // only so an as-yet-unmigrated row isn't silently dropped by a copy.
      const { error: insertError } = await admin.from('attachments').insert({
        request_id: destRow.id,
        uploaded_by: userData.user.id,
        uploaded_by_label: callerLabel,
        kind: 'reference',
        reference_note: att.reference_note,
        reference_url: att.reference_url,
      })
      if (!insertError) copied += 1
    }
  }

  return Response.json({ ok: true, copied })
}
