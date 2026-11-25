import { createClient } from '@supabase/supabase-js'

import { getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/account/delete — requires an `Authorization: Bearer <token>`
 * header (the signed-in caller's own access token); deletes THAT caller's
 * own account, nobody else's — there is no id in the request body to spoof.
 *
 * Built 2026-11-16 to satisfy Apple App Store Review Guideline 5.1.1(v): an
 * app that lets a person create an account must also let them initiate
 * deleting it from inside the app, not only "contact us" (which is all
 * `/privacy` offered before this). Account creation here has always meant
 * a real `auth.users` row (magic-link sign-in creates one on first use,
 * CLAUDE.md's own Auth section) — this is that row's own deletion path.
 *
 * What actually happens, in order:
 *
 * 1. Verify the caller via their own forwarded JWT (never service_role for
 *    this step — the identity check has to be the real, RLS-respecting
 *    session, same posture every other owner-only route in this app takes).
 * 2. Cancel any real Stripe subscription on file FIRST, using the exact
 *    same immediate-cancel/prorate:false sequence
 *    app/api/stripe/testing-downgrade/route.ts already established
 *    (2026-11-05/12) — an account that no longer exists has no screen left
 *    to cancel a subscription from, so leaving one running would create a
 *    zombie charge nobody can ever stop except Jim by hand in the Stripe
 *    Dashboard. Unlike that route, a genuine cancellation failure here
 *    BLOCKS the whole deletion (502) rather than proceeding anyway — the
 *    same reasoning testing-downgrade already applies to its own storage-
 *    over-cap guard: surface the problem now, not as an un-fixable zombie
 *    subscription later. Pending-invoice-item and payment-method cleanup
 *    stay best-effort (cosmetic), matching testing-downgrade exactly.
 * 3. Remove the real Storage objects for every file Attachment on a
 *    Request/ToDo THIS caller owns (service_role, same bucket/column names
 *    app/api/contacts/delete-cascade/route.ts already uses) — the DB rows
 *    themselves will cascade away for free in step 5, but a cascaded DB
 *    row never touches `storage.objects`, which lives outside the FK
 *    graph entirely; skipping this step would leave the actual files
 *    behind forever, silently contradicting the deletion this route
 *    claims to perform. Deliberately scoped to the caller's OWN Requests/
 *    ToDos only — a file this caller uploaded onto someone else's Request
 *    (`uploaded_by = caller`, `request_id` owned by someone else) is left
 *    untouched: that attachment is still part of the OTHER owner's record
 *    of their own Request, the same way a Dialog comment this caller left
 *    there is (see the next paragraph) — `uploaded_by`/`author_user_id`
 *    both `on delete set null` (migrations 002/025), never cascade, so
 *    deleting this caller's own `auth.users` row already leaves both
 *    completely alone on its own.
 * 4. Log one `events` row (subject_type 'profile', action 'deleted') —
 *    audit trail only, before the row that `actor_user` points at is
 *    gone; `events.actor_user` is itself `on delete set null`, so this
 *    survives the cascade in step 5 with its attribution nulled, same as
 *    every other audit row in this app once its own actor disappears.
 *    Best-effort — never blocks the actual deletion.
 * 5. `supabase.auth.admin.deleteUser(userId)` (service_role — the one
 *    genuine reason this route needs it, since no SQL function can delete
 *    an `auth.users` row). Every table this app has ever defined with
 *    `owner_id uuid ... references auth.users(id) on delete cascade`
 *    (profiles, contacts, requests, categories) cascades away
 *    automatically from there — dialog/attachments/request_links/
 *    reminder_minutes_before_queue all cascade a second time from
 *    `requests` itself. Confirmed by reading every `create table` in
 *    docs/Week1 through Week7+ SQL history before writing this route,
 *    not assumed — nothing in that graph is `on delete restrict`/"no
 *    action" against a row this deletion touches, so the admin call
 *    cannot fail on an unexpected FK violation. `beta_allowlist`/
 *    `tier_toggle_allowlist`/`app_settings` are all
 *    keyed by email, not a FK to `auth.users`, and are deliberately left
 *    alone — harmless if this same email ever signs up again.
 *
 * `events`/`ad_events`/`stripe_billing_audit` all keep their own rows with
 * just the `user_id`/`actor_user` reference nulled (same `on delete set
 * null` pattern throughout) — this app's audit trails are never meant to
 * disappear just because the account that generated them did.
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
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const sb = getForwardedClient(authHeader)
  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const userId = userData.user.id

  const admin = getServiceRoleClient()

  // Step 2 — cancel any real Stripe subscription first. See this file's
  // own header comment for why a failure here blocks the whole request
  // rather than proceeding anyway.
  const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', userId).single()
  const customerId = profile?.stripe_customer_id as string | null

  if (customerId) {
    let stripe
    try {
      stripe = getStripeClient()
    } catch (err) {
      console.error('[account/delete]', err)
      return Response.json({ error: 'server_misconfigured' }, { status: 500 })
    }

    try {
      for (const status of ['active', 'trialing', 'past_due', 'unpaid'] as const) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status, limit: 100 })
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id, { prorate: false })
        }
      }
    } catch (err) {
      console.error('[account/delete] subscription cancellation failed', err)
      return Response.json(
        {
          error: 'stripe_error',
          detail: 'Could not cancel an active subscription — please try again, or contact us if this keeps happening.',
        },
        { status: 502 }
      )
    }

    // Best-effort cosmetic cleanup — never blocks the deletion itself, same
    // posture as testing-downgrade/route.ts's identical two steps.
    try {
      const pendingItems = await stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 100 })
      for (const item of pendingItems.data) {
        await stripe.invoiceItems.del(item.id)
      }
    } catch (err) {
      console.error('[account/delete] pending invoice item cleanup failed', err)
    }
    try {
      const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 })
      for (const pm of paymentMethods.data) {
        await stripe.paymentMethods.detach(pm.id)
      }
    } catch (err) {
      console.error('[account/delete] payment method cleanup failed', err)
    }
  }

  // Step 3 — remove real Storage objects for file Attachments on a Request
  // this caller owns, before the DB rows disappear in step 5 (storage.
  // objects is outside the FK graph entirely, see header comment).
  const { data: ownedRequests } = await admin.from('requests').select('id').eq('owner_id', userId)
  const ownedRequestIds = (ownedRequests ?? []).map((r) => r.id as string)

  if (ownedRequestIds.length > 0) {
    const { data: fileRows } = await admin
      .from('attachments')
      .select('storage_path')
      .in('request_id', ownedRequestIds)
      .eq('kind', 'file')
      .not('storage_path', 'is', null)

    const paths = (fileRows ?? []).map((r) => r.storage_path as string).filter(Boolean)
    if (paths.length > 0) {
      await admin.storage.from('attachments').remove(paths)
    }
  }

  // Step 4 — best-effort audit row, before the referenced auth.users row
  // (and therefore actor_user) is gone.
  await admin.from('events').insert({
    actor_user: userId,
    subject_type: 'profile',
    subject_id: userId,
    request_id: null,
    action: 'deleted',
    detail: { cause: 'account_deleted' },
  })

  // Step 5 — the actual deletion. Everything owned by this user cascades
  // away from here (see header comment for the full FK graph).
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('[account/delete] deleteUser failed', deleteError)
    return Response.json({ error: 'delete_failed', detail: deleteError.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
