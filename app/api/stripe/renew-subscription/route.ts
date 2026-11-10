import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getServiceRoleClient as getAttachmentsServiceRoleClient } from '../../attachments/_shared'
import { getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/renew-subscription — the "Renew" link CancelRenewalLink
 * becomes once a subscription has cancel_at_period_end set (2026-11-11,
 * owner-asked: "I am not sure if this has to be a Stripe transaction with a
 * $0 charge or just a confirmation dialog and an api call to update
 * Stripe"). It's the latter — cancel_at_period_end merely un-schedules the
 * subscription's own already-scheduled non-renewal; no Checkout, no charge,
 * no payment method involved at all, since the subscription itself never
 * actually stopped (same distinction Stripe's own Billing Portal makes:
 * Cancel there only sets this flag, it doesn't end the subscription until
 * the period actually runs out).
 *
 * Forwarded-JWT, no service_role for the Stripe call itself — same posture
 * update-storage/route.ts already established; the one service_role use
 * here is the best-effort audit-log insert, identical to that file's own.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const user = userData.user

  let stripe: Stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/renew-subscription]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('stripe_subscription_id, tier')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (profile.tier !== 'subscriber') {
    return Response.json({ error: 'not_subscriber' }, { status: 403 })
  }
  const subscriptionId = profile.stripe_subscription_id as string | null
  if (!subscriptionId) {
    return Response.json({ error: 'no_subscription' }, { status: 404 })
  }

  try {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false })
  } catch (err) {
    console.error('[stripe/renew-subscription] subscriptions.update failed', err)
    return Response.json({ error: 'stripe_error', detail: 'Stripe could not complete this change.' }, { status: 502 })
  }

  // Direct write, not a wait-for-the-webhook race — same reasoning
  // update-storage/route.ts's own identical comment gives: this is exactly
  // what we just told Stripe, so the UI reflects it immediately rather than
  // however long the webhook round trip takes. The webhook's own
  // customer.subscription.updated handler will write the same value again
  // moments later, harmlessly.
  const admin = getAttachmentsServiceRoleClient()
  await admin.from('profiles').update({ stripe_cancel_at_period_end: false }).eq('id', user.id)

  try {
    await admin.from('stripe_billing_audit').insert({
      user_id: user.id,
      event_type: 'subscription_renewed',
      currency: 'usd',
      detail: { subscription_id: subscriptionId },
    })
  } catch (err) {
    console.error('[stripe/renew-subscription] audit insert failed', err)
  }

  return Response.json({ ok: true })
}
