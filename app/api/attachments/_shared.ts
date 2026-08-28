import { createClient } from '@supabase/supabase-js'

import { FREE_TIER_STORAGE_LIMIT_BYTES } from '@/lib/attachments'

/**
 * Shared helpers for app/api/attachments/{upload,list,delete}/route.ts.
 * Not a route itself (no GET/POST export, and Next's App Router only treats
 * files literally named route.ts as routes) — a plain module the three
 * routes import.
 *
 * See migration 025/026's own header comments (docs/Week5 - SQL history.txt)
 * for the full architecture reasoning: service_role is used here, server-
 * side only, specifically because an anonymous Request Response visitor has
 * no session for Storage RLS (which grants nothing to anon/authenticated at
 * all) to scope to. It is never used to DECIDE permission — resolvePermission
 * below always checks identity first, through the same RLS-scoped/RPC-scoped
 * paths the rest of the app already uses (a forwarded-JWT client for the
 * owner and signed-in recipient, the existing get_request_by_token/
 * get_received_request SECURITY DEFINER functions for the anonymous and
 * signed-in recipient cases respectively) — service_role only ever carries
 * out a Storage/table write that's already been approved.
 */

/**
 * Signed Storage URL lifetime, in seconds — shared by upload/route.ts and
 * list/route.ts's own createSignedUrl calls. Widened from 300 (5 min) to 900
 * (15 min), 2026-08-27, after an owner report tracing a phone's Excel
 * attachment straight to a plain OS download with no way to find the file
 * afterward: attachments.ts's new officeViewerUrl() now routes Office file
 * types through Microsoft's Office Online viewer instead, which fetches the
 * signed URL itself, server-side, on its own schedule — a slower mobile
 * connection or the viewer's own queueing has more room to still land inside
 * the window before the link goes stale. 15 minutes is still short enough
 * that a leaked link (e.g. pasted somewhere by accident) closes on its own
 * quickly.
 */
export const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 900

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

/** service_role — confined to this server-only module, never sent to the
 * browser. See header comment above for why it's needed at all. */
export function getServiceRoleClient() {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Same "forward the caller's own access token, run under their own RLS"
 * pattern app/api/email/send-request/route.ts already established. */
export function getForwardedClient(authHeader: string) {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })
}

/** No session at all — the anonymous Request Response path. Only ever calls
 * the anon-grantable get_request_by_token RPC. */
export function getAnonClient() {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Owner's current total Attachment storage usage and allowance, by tier —
 * added 2026-08-27 when Attachments moved from a subscriber-only feature to
 * free-with-limits. A two-step query (the owner's own request ids, then
 * attachments summed over those ids) rather than one joined query — the
 * supabase-js client has no clean way to express "sum over a subquery," and
 * this is fine at personal/testing scale, the same reasoning this codebase
 * already accepts elsewhere (e.g. CreateRequestForm.tsx's fetch-all-then-
 * filter-client-side contacts/categories lookups). Always computed against
 * the REQUEST OWNER's account, never the uploader — CLAUDE.md's own
 * Entitlements section ("gates govern adding... rights come from its
 * issuer") applies to a storage allowance exactly as it already does to
 * feature availability. Subscriber limit reads profiles.subscription_
 * storage_gb (migration 047) — the account's real granted storage, not a
 * fixed number, since it's meant to grow via the (not yet built) storage
 * add-on purchase; defaults to 5 if somehow null.
 */
export async function getOwnerStorageStatus(
  admin: ReturnType<typeof getServiceRoleClient>,
  ownerId: string
): Promise<{ usedBytes: number; limitBytes: number; tier: string }> {
  const { data: profile } = await admin
    .from('profiles')
    .select('tier, subscription_storage_gb')
    .eq('id', ownerId)
    .single()

  const tier = profile?.tier === 'subscriber' ? 'subscriber' : 'free'
  const limitBytes =
    tier === 'subscriber'
      ? (profile?.subscription_storage_gb ?? 5) * 1024 * 1024 * 1024
      : FREE_TIER_STORAGE_LIMIT_BYTES

  const { data: ownedRequests } = await admin.from('requests').select('id').eq('owner_id', ownerId)
  const requestIds = (ownedRequests ?? []).map((r) => r.id as string)

  let usedBytes = 0
  if (requestIds.length > 0) {
    const { data: rows } = await admin
      .from('attachments')
      .select('size_bytes')
      .in('request_id', requestIds)
      .eq('kind', 'file')
      .is('deleted_at', null)
    usedBytes = (rows ?? []).reduce((sum, r) => sum + (r.size_bytes ?? 0), 0)
  }

  return { usedBytes, limitBytes, tier }
}

export type Permission = {
  role: 'owner' | 'recipient' | 'anonymous'
  requestId: string
  uploaderId: string | null
  uploaderLabel: string
  ownerTier: string | null
}

/**
 * Resolves who's calling and whether they may see requestId at all, without
 * ever trusting the client's own claim of ownership — the requestId in the
 * response is always the id confirmed by the RLS-scoped select or RPC
 * result, not blindly the caller's own param. Returns null if nobody is
 * authorized to see this Request/ToDo at all. Callers apply any further
 * gating themselves (upload additionally requires ownerTier === 'subscriber';
 * list/download deliberately don't — an attachment already added stays
 * visible to everyone who could always see it, whatever anyone's tier is
 * now, per CLAUDE.md's Entitlements section).
 */
export async function resolvePermission(opts: {
  requestId: string
  authHeader: string | null
  token: string | null
}): Promise<Permission | null> {
  const { requestId, authHeader, token } = opts

  if (authHeader) {
    const sb = getForwardedClient(authHeader)
    const { data: userData } = await sb.auth.getUser()
    if (!userData.user) return null

    // Owner path: "requests: owners select own" (migration 003) already
    // scopes this to rows the caller actually owns.
    const { data: ownRow } = await sb.from('requests').select('id').eq('id', requestId).single()

    if (ownRow) {
      const { data: profile } = await sb.from('profiles').select('tier, display_name').single()
      return {
        role: 'owner',
        requestId: ownRow.id,
        uploaderId: userData.user.id,
        uploaderLabel: profile?.display_name ?? userData.user.email ?? 'You',
        ownerTier: profile?.tier ?? null,
      }
    }

    // Not the owner — try the signed-in recipient path. get_received_request
    // (migration 012) is SECURITY DEFINER and itself verifies the caller's
    // session email matches the Request's Contact email; it raises on any
    // mismatch, which the try/catch below just treats as "not a recipient
    // either," same generic outcome as every other failure here.
    try {
      const { data: recv, error: recvError } = await sb.rpc('get_received_request', {
        p_request_id: requestId,
      })
      if (recvError || !recv) return null
      const payload = recv as { id: string; owner_tier: string | null }

      const { data: profile } = await sb.from('profiles').select('display_name').single()
      return {
        role: 'recipient',
        requestId: payload.id,
        uploaderId: userData.user.id,
        uploaderLabel: profile?.display_name ?? userData.user.email ?? 'Recipient',
        ownerTier: payload.owner_tier ?? null,
      }
    } catch {
      return null
    }
  }

  if (token) {
    // Anonymous path — get_request_by_token is the same anon-reachable
    // function /r/[token] itself already calls; no session at all here, so
    // uploaderId stays null (see migration 025's header comment on why
    // attachments.uploaded_by is nullable).
    const sb = getAnonClient()
    try {
      const { data, error } = await sb.rpc('get_request_by_token', { p_token: token })
      if (error || !data) return null
      const payload = data as { id: string; owner_tier: string | null; contact_name: string | null }
      return {
        role: 'anonymous',
        requestId: payload.id,
        uploaderId: null,
        uploaderLabel: payload.contact_name ?? 'Recipient',
        ownerTier: payload.owner_tier ?? null,
      }
    } catch {
      return null
    }
  }

  return null
}
