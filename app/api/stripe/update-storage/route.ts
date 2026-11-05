import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getOwnerStorageStatus, getServiceRoleClient as getAttachmentsServiceRoleClient } from '../../attachments/_shared'
import {
  MONTHLY_PRICE,
  ANNUAL_RENEWAL_PRICE,
  STORAGE_BLOCK_GB,
  minAllowedStorageGb,
  storageRatePerBlock,
  type SubscriptionCadence,
} from '@/lib/subscriptionPricing'
import {
  getAnnualPriceId,
  getMonthlyPriceId,
  getStorageAnnualPriceId,
  getStorageMonthlyPriceId,
  getStripeClient,
} from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/update-storage — AttachmentStoragePanel's storage
 * stepper (2026-11-04, supersedes the one-time create-storage-checkout-
 * session route). Body: { targetTotalGb: number }, a multiple of 5.
 *
 * Unlike the old route, this never opens a Checkout redirect — it modifies
 * the caller's EXISTING Stripe Subscription directly (adding, updating, or
 * removing a second "Additional Storage" subscription item riding the same
 * billing cycle as the base plan), since the customer already has a payment
 * method on file. Stripe prorates the change immediately
 * (proration_behavior: 'always_invoice') and bills that proration right
 * away; every subsequent regular invoice then simply includes the new
 * quantity at the normal per-block rate — no separate periodic charge for
 * storage, no cron job, matching Jim's own design: "That way the period
 * doesn't matter and there are no periodic incremental charges - there is
 * just a higher rate."
 *
 * A reduction is allowed (Jim, 2026-11-04) but never below whatever is
 * actually in use right now — enforced server-side via
 * minAllowedStorageGb(), never trusted from the client.
 */
export async function POST(request: Request) {
  let body: { targetTotalGb?: number }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const targetTotalGb = body.targetTotalGb
  if (
    typeof targetTotalGb !== 'number' ||
    !Number.isInteger(targetTotalGb) ||
    targetTotalGb < STORAGE_BLOCK_GB ||
    targetTotalGb % STORAGE_BLOCK_GB !== 0
  ) {
    return Response.json(
      { error: 'bad_request', detail: `targetTotalGb must be a multiple of ${STORAGE_BLOCK_GB}.` },
      { status: 400 }
    )
  }

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
    console.error('[stripe/update-storage]', err)
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

  // Floor: never let a reduction go below what's actually occupied, via the
  // same getOwnerStorageStatus() every enforcement point in the app already
  // reads usedBytes from.
  const admin = getAttachmentsServiceRoleClient()
  const { usedBytes } = await getOwnerStorageStatus(admin, user.id)
  const minGb = minAllowedStorageGb(usedBytes)
  if (targetTotalGb < minGb) {
    return Response.json(
      {
        error: 'below_usage',
        detail: `Storage can't be reduced below ${minGb} GB — that's already in use.`,
      },
      { status: 409 }
    )
  }

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  } catch (err) {
    console.error('[stripe/update-storage] subscriptions.retrieve failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  const annualPriceId = getAnnualPriceId()
  const monthlyPriceId = getMonthlyPriceId()
  const baseItem = subscription.items.data.find(
    (item) => item.price.id === annualPriceId || item.price.id === monthlyPriceId
  )
  if (!baseItem) {
    console.error('[stripe/update-storage] No recognizable base plan item on subscription', subscriptionId)
    return Response.json({ error: 'stripe_error', detail: 'Could not identify your subscription plan.' }, { status: 502 })
  }
  const cadence: SubscriptionCadence = baseItem.price.id === annualPriceId ? 'annual' : 'monthly'
  const storagePriceId = cadence === 'annual' ? getStorageAnnualPriceId() : getStorageMonthlyPriceId()

  const desiredBlocks = (targetTotalGb - STORAGE_BLOCK_GB) / STORAGE_BLOCK_GB
  const existingStorageItem = subscription.items.data.find((item) => item.price.id === storagePriceId)

  try {
    if (desiredBlocks === 0) {
      if (existingStorageItem) {
        await stripe.subscriptionItems.del(existingStorageItem.id, { proration_behavior: 'always_invoice' })
      }
      // Else: already at the base 5 GB with no storage item — nothing to do
      // on the Stripe side.
    } else if (existingStorageItem) {
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: existingStorageItem.id, quantity: desiredBlocks }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
      })
    } else {
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ price: storagePriceId, quantity: desiredBlocks }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
      })
    }
  } catch (err) {
    console.error('[stripe/update-storage] Stripe update failed', err)
    const message =
      err instanceof Error && 'type' in err && (err as { type?: string }).type === 'StripeCardError'
        ? (err as Error).message
        : 'Stripe could not complete this change — your card may have been declined.'
    return Response.json({ error: 'stripe_error', detail: message }, { status: 402 })
  }

  // Direct write, not a wait-for-the-webhook race — this value is exactly
  // what we just told Stripe, and the account's own explicit action here
  // always wins over a passive resync (webhook/route.ts's own
  // handleSubscriptionUpsert only ever raises subscription_storage_gb, never
  // lowers it, specifically so it never fights an explicit reduction like
  // this one — see that file's own comment).
  await admin.from('profiles').update({ subscription_storage_gb: targetTotalGb }).eq('id', user.id)

  const basePrice = cadence === 'annual' ? ANNUAL_RENEWAL_PRICE : MONTHLY_PRICE
  const ratePerBlock = storageRatePerBlock(cadence)
  const newRecurringTotal = basePrice + desiredBlocks * ratePerBlock

  return Response.json({
    ok: true,
    newStorageGb: targetTotalGb,
    cadence,
    ratePerBlock,
    newRecurringTotal,
  })
}
