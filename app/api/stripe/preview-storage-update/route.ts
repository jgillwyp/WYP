import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { resolveSubscriptionCadence } from '../_shared'
import { STORAGE_BLOCK_GB } from '@/lib/subscriptionPricing'
import { getStorageAnnualPriceId, getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/preview-storage-update — the exact "charged now" dollar
 * amount for an annual Attachment Storage Capacity INCREASE (2026-11-11,
 * Jim's own spec: "Yes, please for an annual subscription capacity
 * increase calculate it to advise the user what the charge will be... if
 * it is easier to exactly calculate it - that is fine"). Body:
 * { targetTotalGb: number }, a multiple of STORAGE_BLOCK_GB, greater than
 * the account's current storageGb.
 *
 * Deliberately a real Stripe invoice preview (stripe.invoices.createPreview
 * with the same subscription_details.items + proration_behavior:
 * 'always_invoice' update-storage/route.ts would actually apply), not a
 * hand-rolled day-count proration — this is the one number this screen
 * shows that has to exactly match what Stripe is about to charge, and
 * Stripe's own preview endpoint is the authoritative source for that,
 * including however many days are left in the current billing period.
 * Never commits anything — update-storage/route.ts is still the only route
 * that actually applies the change, once the user confirms.
 *
 * Only ever meaningful for an annual INCREASE — a decrease's own prorated
 * invoice is zero or negative (Stripe applies it as account credit, never a
 * charge), and a monthly change never charges today at all
 * (proration_behavior: 'none') — both of those cases are already fully
 * known from the plain recurring-rate math client-side, so this route
 * isn't called for them. Same auth/profile/subscription/testing-account
 * gating as update-storage/route.ts (the server never trusts the client's
 * own belief about which case it's in).
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
    console.error('[stripe/preview-storage-update]', err)
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
    // No real subscription at all — a testing account with the checkbox
    // alone, or a genuinely stale profile row. Either way there's nothing
    // real to preview. Same message shape as update-storage/route.ts's own
    // no_subscription case.
    return Response.json({ error: 'no_subscription' }, { status: 404 })
  }

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  } catch (err) {
    console.error('[stripe/preview-storage-update] subscriptions.retrieve failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  const cadence = resolveSubscriptionCadence(subscription)
  if (cadence !== 'annual') {
    // The client only ever calls this for an annual increase — defensive,
    // not reachable from the live UI.
    return Response.json({ error: 'not_applicable' }, { status: 400 })
  }

  const storagePriceId = getStorageAnnualPriceId()
  const desiredBlocks = (targetTotalGb - STORAGE_BLOCK_GB) / STORAGE_BLOCK_GB
  const existingStorageItem = subscription.items.data.find((item) => item.price.id === storagePriceId)

  const items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[] = existingStorageItem
    ? [{ id: existingStorageItem.id, quantity: desiredBlocks }]
    : [{ price: storagePriceId, quantity: desiredBlocks }]

  let preview: Stripe.Invoice
  try {
    preview = await stripe.invoices.createPreview({
      subscription: subscriptionId,
      subscription_details: {
        items,
        proration_behavior: 'always_invoice',
      },
    })
  } catch (err) {
    console.error('[stripe/preview-storage-update] invoices.createPreview failed', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }

  // Clamp defensively — this route is only ever called for an increase, so
  // the real total should always be positive, but never show a negative
  // "charge" if Stripe's own math somehow disagrees. preview.total is
  // already whole cents, so this division is exact.
  const chargeNowAmount = Math.max(0, preview.total) / 100

  return Response.json({ ok: true, chargeNowAmount })
}
