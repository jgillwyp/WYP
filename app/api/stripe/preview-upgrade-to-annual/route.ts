import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { findBaseSubscriptionItem, findStorageSubscriptionItem, resolveSubscriptionCadence } from '../_shared'
import { ANNUAL_FIRST_YEAR_PRICE, TESTER_FIRST_YEAR_PRICE } from '@/lib/subscriptionPricing'
import {
  getAnnualPriceId,
  getFirstYearCouponId,
  getStorageAnnualPriceId,
  getStripeClient,
  getTesterFirstYearCouponId,
} from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/preview-upgrade-to-annual — the confirm dialog behind
 * "Upgrade to 1st year discount" (UpgradeToAnnualButton, SubscriptionPanels.tsx,
 * 2026-11-12), only ever shown to a real Monthly subscriber. Switches the
 * subscription's base item from Monthly to Annual, resets the billing cycle
 * anchor to today (Jim: "start the annual period on the day of the
 * upgrade"), and applies the same first-year coupon a brand-new annual Sign
 * Up would get ($39 public rate, $19 tester rate) — Stripe's own invoice
 * preview nets the whole thing out: the full annual price, minus the
 * coupon, minus a credit for the unused remainder of the current monthly
 * period. A genuine Stripe calculation, not hand-rolled day-count math, same
 * reasoning preview-storage-update/route.ts already gives for its own
 * identical pattern.
 *
 * creditAmount is derived from the preview's own negative proration line(s)
 * — whatever unused time Stripe is crediting back for the item(s) being
 * replaced (the base plan, and the storage item too if one exists) — not a
 * hand-rolled subtraction. If the account also carries an Additional
 * Storage item, that item is switched to its own Annual price in the same
 * preview, so chargeNowAmount can be higher than firstYearPrice minus
 * creditAmount alone in that case; the dialog states both real numbers
 * rather than implying they're the only two components.
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
    console.error('[stripe/preview-upgrade-to-annual]', err)
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
    console.error('[stripe/preview-upgrade-to-annual] subscriptions.retrieve failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  const cadence = resolveSubscriptionCadence(subscription)
  if (cadence !== 'monthly') {
    // The client only ever calls this when already on a real Monthly
    // subscription — defensive, not reachable from the live UI.
    return Response.json({ error: 'not_applicable' }, { status: 400 })
  }
  const baseItem = findBaseSubscriptionItem(subscription)
  if (!baseItem) {
    console.error('[stripe/preview-upgrade-to-annual] No recognizable base plan item on subscription', subscriptionId)
    return Response.json({ error: 'stripe_error', detail: 'Could not identify your subscription plan.' }, { status: 502 })
  }

  const { data: isTester } = await sb.rpc('is_beta_tester')
  const couponId = isTester ? getTesterFirstYearCouponId() : getFirstYearCouponId()
  const firstYearPrice = isTester ? TESTER_FIRST_YEAR_PRICE : ANNUAL_FIRST_YEAR_PRICE

  const storageItem = findStorageSubscriptionItem(subscription)
  const items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[] = [
    { id: baseItem.id, price: getAnnualPriceId() },
  ]
  if (storageItem) {
    items.push({ id: storageItem.id, price: getStorageAnnualPriceId(), quantity: storageItem.quantity ?? undefined })
  }

  let preview: Stripe.Invoice
  try {
    preview = await stripe.invoices.createPreview({
      subscription: subscriptionId,
      subscription_details: {
        items,
        proration_behavior: 'always_invoice',
        billing_cycle_anchor: { type: 'now' },
      },
      discounts: [{ coupon: couponId }],
    })
  } catch (err) {
    console.error('[stripe/preview-upgrade-to-annual] invoices.createPreview failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  const chargeNowAmount = Math.max(0, preview.total) / 100
  // Sum of every negative (credit) proration line — the unused-time credit
  // for whichever item(s) are being replaced. Never includes the coupon
  // discount itself, which Stripe applies separately (total_discount_amounts),
  // not as a line item.
  const creditCents = preview.lines.data
    .filter((line) => (line.amount ?? 0) < 0)
    .reduce((sum, line) => sum + (line.amount ?? 0), 0)
  const creditAmount = Math.abs(creditCents) / 100

  return Response.json({ ok: true, chargeNowAmount, creditAmount, firstYearPrice })
}
