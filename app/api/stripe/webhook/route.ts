import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getStorageAnnualPriceId, getStorageMonthlyPriceId, getStripeClient } from '@/lib/stripe'
import { STORAGE_BLOCK_GB } from '@/lib/subscriptionPricing'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/webhook — the one place profiles.tier/
 * subscription_renewal_date/stripe_subscription_* ever get written once a
 * real (not testing-toggle) subscription exists. Registered in the Stripe
 * Dashboard against this route's own full URL
 * (NEXT_PUBLIC_SITE_URL + /api/stripe/webhook) — see docs/stripe-setup.mjs,
 * which prints that URL as a reminder.
 *
 * service_role, by necessity: a webhook call carries no user session for
 * RLS to scope to at all — same justified, narrow exception to "service_
 * role never goes near the browser" this app's cron routes and attachments
 * API already use (CLAUDE.md's Database section). Every write here is keyed
 * off identity Stripe itself already verified (the event's own signature,
 * checked below), never anything read from the request body alone.
 *
 * Signature verification needs the RAW request body, not the parsed JSON —
 * request.text() gives that directly in a Next.js App Router route handler
 * (unlike the old Pages API, which needed a config flag to disable its own
 * automatic body parsing).
 */
function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[stripe/webhook] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

type SupabaseAdmin = ReturnType<typeof getServiceRoleClient>

// Resolves which profiles row an event is about. Prefers metadata.
// supabase_user_id (stamped onto every Checkout Session and, via
// subscription_data.metadata, onto the Subscription object itself, by
// create-checkout-session/route.ts) — present on every event this webhook
// cares about except a bare customer.subscription.* event fired by Stripe
// itself outside of our own metadata (e.g. a dashboard-initiated change),
// where the stripe_customer_id lookup is the fallback.
async function resolveUserId(
  sb: SupabaseAdmin,
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null | undefined
): Promise<string | null> {
  const fromMetadata = metadata?.supabase_user_id
  if (fromMetadata) return fromMetadata

  if (!customerId) return null
  const { data } = await sb.from('profiles').select('id').eq('stripe_customer_id', customerId).single()
  return data?.id ?? null
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

async function handleSubscriptionUpsert(
  sb: SupabaseAdmin,
  subscription: Stripe.Subscription,
  fallbackCustomerId?: string | null
) {
  const userId = await resolveUserId(sb, subscription.metadata, subscription.customer as string ?? fallbackCustomerId)
  if (!userId) {
    console.error('[stripe/webhook] Could not resolve a profiles row for subscription', subscription.id)
    return
  }

  const activeLike = subscription.status === 'active' || subscription.status === 'trialing'
  const periodEndItem = subscription.items.data[0]?.current_period_end
  const currentPeriodEnd = periodEndItem ?? null

  // Resync subscription_storage_gb from the subscription's own live
  // Additional Storage item quantity (update-storage/route.ts's own doing,
  // most of the time — but this also catches a change made directly in the
  // Stripe Dashboard). Deliberately MAX'd against whatever is already
  // stored, never simply overwritten: a passive event like this must never
  // claw back a value an account holder reached some other way (e.g. a
  // historical one-time storage grant with no subscription item behind it
  // at all). An explicit reduction through update-storage/route.ts already
  // writes the lower value directly and synchronously — by the time this
  // webhook event arrives, the stored value already matches what's computed
  // here, so maxing the two is a no-op for that case, not a fight against it.
  // Env-var lookups are wrapped, not called via the throwing must()-backed
  // getters directly — a webhook event (tier/renewal-date updates included)
  // must never fail outright just because the newer storage price ids
  // haven't been added to the environment yet.
  let storageGbFromItems = STORAGE_BLOCK_GB
  try {
    const storageMonthlyId = getStorageMonthlyPriceId()
    const storageAnnualId = getStorageAnnualPriceId()
    const storageItem = subscription.items.data.find(
      (item) => item.price.id === storageMonthlyId || item.price.id === storageAnnualId
    )
    storageGbFromItems += (storageItem?.quantity ?? 0) * STORAGE_BLOCK_GB
  } catch (err) {
    console.error('[stripe/webhook] Storage price ids not configured — skipping storage resync', err)
  }

  const { data: currentProfile } = await sb
    .from('profiles')
    .select('subscription_storage_gb')
    .eq('id', userId)
    .single()
  const resolvedStorageGb = Math.max(currentProfile?.subscription_storage_gb ?? STORAGE_BLOCK_GB, storageGbFromItems)

  await sb
    .from('profiles')
    .update({
      stripe_subscription_id: subscription.id,
      stripe_subscription_status: subscription.status,
      stripe_cancel_at_period_end: subscription.cancel_at_period_end,
      ...(currentPeriodEnd ? { subscription_renewal_date: toIsoDate(currentPeriodEnd) } : {}),
      tier: activeLike ? 'subscriber' : 'free',
      subscription_storage_gb: resolvedStorageGb,
    })
    .eq('id', userId)
}

async function handleSubscriptionDeleted(sb: SupabaseAdmin, subscription: Stripe.Subscription) {
  const userId = await resolveUserId(sb, subscription.metadata, subscription.customer as string)
  if (!userId) {
    console.error('[stripe/webhook] Could not resolve a profiles row for deleted subscription', subscription.id)
    return
  }

  await sb
    .from('profiles')
    .update({
      stripe_subscription_status: 'canceled',
      stripe_cancel_at_period_end: false,
      tier: 'free',
    })
    .eq('id', userId)

  await logBillingAudit(sb, userId, 'subscription_canceled', null, null, {
    stripe_subscription_id: subscription.id,
  })
}

async function handleCheckoutSessionCompleted(sb: SupabaseAdmin, stripe: Stripe, session: Stripe.Checkout.Session) {
  // Additional Storage no longer goes through Checkout at all (2026-11-04)
  // — it's a direct subscription-item change via
  // app/api/stripe/update-storage/route.ts, so the only mode this webhook
  // still needs to handle here is 'subscription' (Sign Up).
  if (session.mode !== 'subscription' || !session.subscription) return
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  await handleSubscriptionUpsert(sb, subscription, session.customer as string | null)

  const userId = await resolveUserId(sb, session.metadata, session.customer as string | null)
  if (userId) {
    await logBillingAudit(sb, userId, 'checkout_completed', session.amount_total, session.currency, {
      plan: session.metadata?.plan ?? null,
      tester: session.metadata?.tester ?? null,
      stripe_subscription_id: subscription.id,
      stripe_checkout_session_id: session.id,
    })
  }
}

async function handleInvoicePaid(sb: SupabaseAdmin, invoice: Stripe.Invoice) {
  // The authoritative "money changed hands" signal (migration 092,
  // 2026-11-06) — Jim: "There should be an audit file posted for all
  // Stripe charges." Fires for every real charge this app's subscriptions
  // ever produce: the Sign Up checkout's own first invoice, every renewal,
  // and an Annual-plan storage change's immediate prorated invoice (a
  // Monthly-plan storage change deliberately produces NO invoice here at
  // all until its own next regular renewal — see update-storage/route.ts's
  // own audit insert for that case instead).
  // Stripe's 2025-03-31+ API moved this link under invoice.parent.
  // subscription_details.subscription (no top-level invoice.subscription
  // field anymore on this SDK version).
  const subscriptionRef = invoice.parent?.subscription_details?.subscription
  const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : (subscriptionRef?.id ?? null)
  const userId = await resolveUserId(sb, null, invoice.customer as string | null)
  if (!userId) {
    console.error('[stripe/webhook] Could not resolve a profiles row for paid invoice', invoice.id)
    return
  }

  await logBillingAudit(sb, userId, 'invoice_paid', invoice.amount_paid, invoice.currency, {
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    billing_reason: invoice.billing_reason,
  })
}

// Audit trail (migration 092, 2026-11-06) — see that migration's own header
// comment and stripe_billing_audit's table comment for the full reasoning.
// Best-effort: a failed audit insert must never fail or retry the whole
// webhook delivery (Stripe would just redeliver the same event into this
// same code path, which already ran its real side effects above).
async function logBillingAudit(
  sb: SupabaseAdmin,
  userId: string,
  eventType: 'checkout_completed' | 'invoice_paid' | 'subscription_canceled',
  amountCents: number | null,
  currency: string | null,
  detail: Record<string, unknown>
) {
  try {
    await sb.from('stripe_billing_audit').insert({
      user_id: userId,
      event_type: eventType,
      amount_cents: amountCents,
      currency,
      detail,
    })
  } catch (err) {
    console.error('[stripe/webhook] audit insert failed', eventType, err)
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !webhookSecret) {
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const rawBody = await request.text()

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/webhook]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed', err)
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }

  const sb = getServiceRoleClient()

  // Idempotency — Stripe can and does redeliver the same event (retries,
  // dashboard resend). Insert the event id first; if it's already there,
  // this is a redelivery and every side effect below has already run.
  const { error: dedupeError } = await sb
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, event_type: event.type })
  if (dedupeError) {
    // Unique-violation on event_id = already processed. Any other error
    // (table missing, migration 088 not yet run) still returns 200 so
    // Stripe doesn't retry forever on a misconfigured-but-reachable
        // endpoint — but it's logged loudly either way.
    console.error('[stripe/webhook] dedupe insert failed (already processed, or a real error)', dedupeError)
    if (dedupeError.code === '23505') {
      return Response.json({ received: true, deduped: true })
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(sb, stripe, event.data.object as Stripe.Checkout.Session)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(sb, event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(sb, event.data.object as Stripe.Subscription)
        break
      case 'invoice.paid':
        await handleInvoicePaid(sb, event.data.object as Stripe.Invoice)
        break
      default:
        // Unhandled event type — fine to ignore (Stripe sends many we
        // don't act on, e.g. invoice.created, payment_intent.succeeded).
        break
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error for event', event.type, err)
    // Still 200 — Stripe's own retry-on-non-2xx would just redeliver the
    // identical event into the same code path; a real bug needs a code
    // fix, not an automatic retry storm. Logged above for Jim to notice.
  }

  return Response.json({ received: true })
}
