import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getServiceRoleClient as getAttachmentsServiceRoleClient } from '../../attachments/_shared'
import { findBaseSubscriptionItem, findStorageSubscriptionItem, resolveSubscriptionCadence } from '../_shared'
import {
  getAnnualPriceId,
  getFirstYearCouponId,
  getStorageAnnualPriceId,
  getStripeClient,
  getTesterFirstYearCouponId,
} from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/upgrade-to-annual — "Upgrade to 1st year discount"
 * (UpgradeToAnnualButton, SubscriptionPanels.tsx, 2026-11-12), confirmed via
 * preview-upgrade-to-annual/route.ts's own exact-math dialog first. Switches
 * the subscription's base item from Monthly to Annual in place (same item
 * id, just a different price) — never cancels and re-creates the
 * subscription, so Cancel/Renew's own stripe_subscription_id stays valid
 * throughout.
 *
 * billing_cycle_anchor: { type: 'now' } — Jim's own explicit instruction,
 * "start the annual period on the day of the upgrade" — combined with
 * proration_behavior: 'always_invoice', this both starts the new annual
 * year from today AND generates an immediate invoice crediting whatever
 * unused time remained on the old Monthly item. The same first-year coupon
 * a brand-new annual Sign Up gets (create-checkout-session/route.ts) is
 * applied here too via discounts, so the very first annual charge is still
 * $39 (or $19 for a beta_allowlist tester) before the unused-month credit,
 * not the full $49.
 *
 * If the account also carries an Additional Storage item, it's switched to
 * its own Annual price in the same update — carrying it forward at the old
 * Monthly storage rate would be wrong once the base plan is Annual.
 *
 * cancel_at_period_end is explicitly reset to false — upgrading implies
 * continuing, not canceling; harmless if it was already false.
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
    console.error('[stripe/upgrade-to-annual]', err)
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

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  } catch (err) {
    console.error('[stripe/upgrade-to-annual] subscriptions.retrieve failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  const cadence = resolveSubscriptionCadence(subscription)
  if (cadence !== 'monthly') {
    return Response.json({ error: 'not_applicable' }, { status: 400 })
  }
  const baseItem = findBaseSubscriptionItem(subscription)
  if (!baseItem) {
    console.error('[stripe/upgrade-to-annual] No recognizable base plan item on subscription', subscriptionId)
    return Response.json({ error: 'stripe_error', detail: 'Could not identify your subscription plan.' }, { status: 502 })
  }

  const { data: isTester } = await sb.rpc('is_beta_tester')
  const couponId = isTester ? getTesterFirstYearCouponId() : getFirstYearCouponId()

  const storageItem = findStorageSubscriptionItem(subscription)
  const items: Stripe.SubscriptionUpdateParams.Item[] = [{ id: baseItem.id, price: getAnnualPriceId() }]
  if (storageItem) {
    items.push({ id: storageItem.id, price: getStorageAnnualPriceId(), quantity: storageItem.quantity ?? undefined })
  }

  let updated: Stripe.Subscription
  try {
    updated = await stripe.subscriptions.update(subscriptionId, {
      items,
      proration_behavior: 'always_invoice',
      billing_cycle_anchor: { type: 'now' },
      discounts: [{ coupon: couponId }],
      cancel_at_period_end: false,
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice', 'items.data.price'],
    })
  } catch (err) {
    console.error('[stripe/upgrade-to-annual] subscriptions.update failed', err)
    const message =
      err instanceof Error && 'type' in err && (err as { type?: string }).type === 'StripeCardError'
        ? (err as Error).message
        : 'Stripe could not complete this change — your card may have been declined.'
    return Response.json({ error: 'stripe_error', detail: message }, { status: 402 })
  }

  // Direct write, not a wait-for-the-webhook race — same reasoning every
  // other Stripe route here already gives: this is exactly what we just
  // told Stripe, so the UI reflects it immediately. The webhook's own
  // customer.subscription.updated handler will write the same values again
  // moments later, harmlessly.
  const periodEndItem = updated.items.data[0]?.current_period_end
  const renewalDate = periodEndItem ? new Date(periodEndItem * 1000).toISOString().slice(0, 10) : null

  const admin = getAttachmentsServiceRoleClient()
  await admin
    .from('profiles')
    .update({
      stripe_subscription_status: updated.status,
      stripe_cancel_at_period_end: false,
      ...(renewalDate ? { subscription_renewal_date: renewalDate } : {}),
    })
    .eq('id', user.id)

  const invoiceId = typeof updated.latest_invoice === 'string' ? updated.latest_invoice : (updated.latest_invoice?.id ?? null)

  try {
    await admin.from('stripe_billing_audit').insert({
      user_id: user.id,
      event_type: 'subscription_upgraded_to_annual',
      currency: 'usd',
      detail: { subscription_id: subscriptionId, invoice_id: invoiceId },
    })
  } catch (err) {
    console.error('[stripe/upgrade-to-annual] audit insert failed', err)
  }

  return Response.json({ ok: true, renewalDate })
}
