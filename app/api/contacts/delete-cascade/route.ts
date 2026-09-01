import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/contacts/delete-cascade — body `{ contactId }`, requires an
 * `Authorization: Bearer <token>` header. Owner-only — there is no
 * recipient- or anonymous-facing path here at all.
 *
 * Jim, 2026-09-01: "when deleting a contact, the delete should include all
 * requests." Deleting a Contact row alone would NOT cascade its Requests —
 * `requests.contact_id` is `on delete set null` (migration 003), which
 * would silently turn every Request ever sent to that Contact into an
 * orphaned ToDo instead of removing it. This route deletes the Contact's
 * Requests FIRST (real hard delete — `dialog.request_id` and
 * `attachments.request_id` are both `on delete cascade`, migrations
 * 004/025, so their own rows disappear automatically), then deletes the
 * Contact row itself.
 *
 * Real file Attachments' underlying Storage objects are removed first,
 * before the cascade deletes their metadata rows out from under us — same
 * service_role posture as /api/attachments/delete/route.ts (the bucket
 * has no anon/authenticated grants at all, migration 026), duplicated here
 * per this codebase's own per-file convention rather than importing the
 * attachments folder's _shared.ts, which was scoped to that feature's own
 * three routes.
 *
 * Deliberately a HARD delete, not the deleted_at soft-delete originally
 * proposed to Jim (2026-09-01 decisions log) — reconsidered once building
 * this: both `contacts` and `requests` already carry an owner-only DELETE
 * RLS policy (migrations 002/003) and real cascading FKs, and this is an
 * explicit, confirmed, user-initiated action with its own recap/warning
 * shown first (ContactDetailForm.tsx's confirmation modal) — not a silent
 * or automated deletion, which is what would have motivated an undo-able
 * soft delete. Adopting deleted_at here would also mean touching every
 * existing read path (Main Screen, Archive, Search, Print Reports,
 * get_request_by_token, get_received_request, get_received_requests,
 * get_received_print_detail, every cron phase) for a feature Jim scoped
 * as Contact-triggered only. Flagged as a considered deviation from the
 * earlier recommendation, not a silent one.
 *
 * A deleted Request's response-link token (if one was ever issued) simply
 * stops resolving once the row is gone — get_request_by_token/
 * get_received_request already return the same generic "not available"
 * error for a token/id that matches no row, so no separate
 * revoke_request_link() call is needed here. Jim confirmed 2026-09-01 the
 * generic dead-link message should stay exactly as-is.
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
  let body: { contactId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const contactId = body.contactId
  if (!contactId) {
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

  // "contacts: owners select own" (migration 002) already scopes this to a
  // row the caller actually owns — a mismatched id just returns nothing,
  // same generic outcome as every other permission check in this app.
  const { data: contactRow, error: contactError } = await sb
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .single()

  if (contactError || !contactRow) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: reqRows, error: reqError } = await sb.from('requests').select('id').eq('contact_id', contactId)

  if (reqError) {
    return Response.json({ error: 'load_failed', detail: reqError.message }, { status: 500 })
  }

  const requestIds = (reqRows ?? []).map((r) => r.id as string)

  if (requestIds.length > 0) {
    const admin = getServiceRoleClient()
    const { data: fileRows } = await admin
      .from('attachments')
      .select('storage_path')
      .in('request_id', requestIds)
      .eq('kind', 'file')
      .not('storage_path', 'is', null)

    const paths = (fileRows ?? []).map((r) => r.storage_path as string).filter(Boolean)
    if (paths.length > 0) {
      await admin.storage.from('attachments').remove(paths)
    }

    const { error: deleteRequestsError } = await sb.from('requests').delete().in('id', requestIds)
    if (deleteRequestsError) {
      return Response.json(
        { error: 'delete_requests_failed', detail: deleteRequestsError.message },
        { status: 500 }
      )
    }
  }

  const { error: deleteContactError } = await sb.from('contacts').delete().eq('id', contactId)
  if (deleteContactError) {
    return Response.json({ error: 'delete_contact_failed', detail: deleteContactError.message }, { status: 500 })
  }

  return Response.json({ ok: true, deletedRequestCount: requestIds.length })
}
