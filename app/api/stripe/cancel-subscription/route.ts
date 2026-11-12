import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getServiceRoleClient as getAttachmentsServiceRoleClient } from '../../attachments/_shared'
import { getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/cancel-subscription — the "Cancel" link CancelRenewalLink
 * (SubscriptionPanels.tsx), direct in-app action replacing a redirect to
 * Stripe's own hosted Billing Portal entirely (2026-11-11, owner-reported:
 * "It would be a better UI to just return to the app with a dialog
 * confirming the cancellation" — the Portal's own multi-step survey/
 * confirmation/manual "Return to..." flow was the complaint). Exact mirror
 * of renew-subscription/route.ts's own shape and reasoning, just the
 * opposite direction: cancel_at_period_end only ever schedules the
 * subscription to NOT renew — no Checkout, no charge, no payment method
 * involved, since the subscription itself keeps running through the
 * already-paid-for period either way. No payment is collected by this
 * action, so Apple's Guideline 3.1.1 External Purchase Link requirement
 * (the reason Sign Up and a real storage-capacity increase route through
 * Safari on native iOS, see SubscriptionPanels.tsx's own startStripeFlow()
 * comment) does not apply here — nothing about canceling, or un-canceling
 * via Renew, is a purchase.
 *
 * create-portal-session/route.ts is removed in the same batch — this was
 * its only caller. The one thing that redirect also incidentally offered
 * (updating a saved payment method, viewing invoice history) has no
 * replacement yet; flagged, not silently dropped — add a separate "Manage
 * Billing" link back to the Portal later if that's ever actually needed.
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
    console.error('[stripe/cancel-subscription]', err)
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
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  } catch (err) {
    console.error('[stripe/cancel-subscription] subscriptions.update failed', err)
    return Response.json({ error: 'stripe_error', detail: 'Stripe could not complete this change.' }, { status: 502 })
  }

  // Direct write, not a wait-for-the-webhook race — same reasoning
  // renew-subscription/route.ts's own identical comment gives: the UI
  // reflects the change immediately rather than however long the webhook
  // round trip takes. The webhook's own customer.subscription.updated
  // handler will write the same value again moments later, harmlessly.
  const admin = getAttachmentsServiceRoleClient()
  await admin.from('profiles').update({ stripe_cancel_at_period_end: true }).eq('id', user.id)

  try {
    await admin.from('stripe_billing_audit').insert({
      user_id: user.id,
      event_type: 'subscription_cancel_scheduled',
      currency: 'usd',
      detail: { subscription_id: subscriptionId },
    })
  } catch (err) {
    console.error('[stripe/cancel-subscription] audit insert failed', err)
  }

  return Response.json({ ok: true })
}
