import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/requests/delete-many — body `{ requestIds: string[] }`,
 * requires an `Authorization: Bearer <token>` header. Owner-only — mirrors
 * /api/contacts/delete-cascade/route.ts's own posture and reasoning almost
 * exactly (see that file's header comment for the full write-up on hard
 * delete vs. `deleted_at`), but keyed directly by request ids rather than
 * derived from a Contact.
 *
 * Backs ArchiveForm.tsx's new Delete action (2026-09-01, Jim's own follow-up
 * ask the same day as the Contact-cascade-delete batch: "For the Archive
 * screen, I don't see a Delete chip alongside Archive and UnArchive").
 * Permanently removes one or more already-Archived Sent Requests or ToDos
 * (and, via `dialog`/`attachments`' own `on delete cascade` FKs, their
 * Dialog and Attachments) chosen from Archive's own checkbox list.
 *
 * Deliberately NOT offered for Received Requests — the RLS-scoped delete
 * below only ever matches rows the caller actually owns ("requests: owners
 * delete own", migration 003), and a recipient never owns the Request
 * they're viewing. ArchiveForm.tsx hides the Delete chip entirely when
 * Record Type is Received, rather than presenting a control that would
 * silently delete nothing (any id the caller doesn't own is just dropped
 * from `ownedIds` below, the same defensive pattern delete-cascade uses).
 */

function must(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[WYP] Missing environment variable ${name}. Set it in Vercel under ` +
        `Settings -> Environment Variables (Production and Preview scopes), ` +
        `then redeploy; or add it to .env.local for local development.`
    )
  }
  return value
}

function getForwardedClient(authHeader: string) {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })
}

function getServiceRoleClient() {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export async function POST(request: Request) {
  let body: { requestIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const requestIds = Array.isArray(body.requestIds) ? body.requestIds.filter((id) => typeof id === 'string') : []
  if (requestIds.length === 0) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const sb = getForwardedClient(authHeader)
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // "requests: owners select own" (migration 003) already scopes this to
  // rows the caller actually owns — any id in the client's own list that
  // doesn't belong to them (or doesn't exist) simply drops out here rather
  // than being trusted blindly.
  const { data: ownRows, error: ownError } = await sb.from('requests').select('id').in('id', requestIds)
  if (ownError) {
    return Response.json({ error: 'load_failed', detail: ownError.message }, { status: 500 })
  }

  const ownedIds = (ownRows ?? []).map((r) => r.id as string)
  if (ownedIds.length === 0) {
    return Response.json({ ok: true, deletedCount: 0 })
  }

  // Real file Attachments' underlying Storage objects removed first, before
  // the cascade deletes their metadata rows out from under us — same
  // service_role posture as delete-cascade/route.ts.
  const admin = getServiceRoleClient()
  const { data: fileRows } = await admin
    .from('attachments')
    .select('storage_path')
    .in('request_id', ownedIds)
    .eq('kind', 'file')
    .not('storage_path', 'is', null)

  const paths = (fileRows ?? []).map((r) => r.storage_path as string).filter(Boolean)
  if (paths.length > 0) {
    await admin.storage.from('attachments').remove(paths)
  }

  const { error: deleteError } = await sb.from('requests').delete().in('id', ownedIds)
  if (deleteError) {
    return Response.json({ error: 'delete_failed', detail: deleteError.message }, { status: 500 })
  }

  return Response.json({ ok: true, deletedCount: ownedIds.length })
}
