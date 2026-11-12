import { createClient } from '@supabase/supabase-js'

import { FREE_TIER_STORAGE_LIMIT_BYTES } from '@/lib/attachments'
import { getOwnerStorageStatus, getServiceRoleClient as getAttachmentsServiceRoleClient } from '../../attachments/_shared'
import { STORAGE_BLOCK_GB } from '@/lib/subscriptionPricing'
import { getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/testing-downgrade — unchecking "Subscribed? (testing
 * only)" on Account Options/SubscriptionForm.tsx, built 2026-11-05 after
 * Jim's own live testing surfaced the real problem: the checkbox only ever
 * flipped the local tier flag, leaving any real Stripe subscription(s)
 * created along the way (via the real Sign Up button, which the pitch shows
 * again once tier flips back to 'free') to sit active and uncanceled —
 * several of them, since nothing stopped a second Sign Up from creating yet
 * another one. Jim's own words: "a more complete reset... flush any pending
 * Stripe activity - if possible."
 *
 * This is why unchecking goes through a route rather than the plain
 * set_tier_for_testing() RPC directly (checking it back on still does —
 * that direction never touches Stripe): canceling a subscription needs the
 * Stripe API, which SQL can't reach.
 *
 * Also detaches every payment method left on the customer (2026-11-05,
 * same conversation — Jim noticed the 4242 test card listed 5 times in
 * Stripe's Payment Methods: each test Sign Up's Checkout session attaches a
 * new PaymentMethod even for an identical card number, and canceling a
 * subscription never detaches the card it was billed on) — best-effort,
 * logged but never fails the request, since this is cosmetic cleanup, not
 * something a real reset should block on.
 *
 * Also enforces Jim's own described guard: a tester with more than the
 * Free-tier 100 MB actually in use can't downgrade blind into being over
 * their new cap — refused with a message pointing at Storage Management,
 * rather than silently leaving them over-limit (new uploads would already
 * be blocked either way, per this app's own "block new uploads, never
 * auto-delete" convention, but Jim wants this surfaced at the point of
 * unchecking, not discovered later as an upload failure).
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

  // Re-verified here, not trusted from the client having shown the checkbox
  // at all — same posture as every other can_toggle_tier()-gated write.
  const { data: canToggle } = await sb.rpc('can_toggle_tier')
  if (!canToggle) {
    return Response.json({ error: 'not_allowed' }, { status: 403 })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/testing-downgrade]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const admin = getAttachmentsServiceRoleClient()

  const { usedBytes } = await getOwnerStorageStatus(admin, user.id)
  if (usedBytes > FREE_TIER_STORAGE_LIMIT_BYTES) {
    const usedMb = Math.ceil(usedBytes / (1024 * 1024))
    return Response.json(
      {
        error: 'over_free_limit',
        detail: `You're using ${usedMb} MB of storage, over the 100 MB Free Account limit. Remove enough attachments in Storage Management first, then try again.`,
      },
      { status: 409 }
    )
  }

  const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  const customerId = profile?.stripe_customer_id as string | null

  if (customerId) {
    try {
      // Immediate cancellation (not cancel_at_period_end) — this is testing
      // cleanup, not a real customer letting a paid period run out.
      //
      // prorate: false (2026-11-12, owner-reported: "for monthly
      // subscriptions the Stripe interaction incorrectly shows '$0 charge
      // then $5/mo'") — Stripe's default on an immediate cancel is
      // prorate: true, which generates a negative "unused time" invoice
      // item for the canceled subscription. That credit doesn't vanish; it
      // sits as a pending invoice item on the CUSTOMER (not the now-gone
      // subscription) until the next invoice for that customer picks it
      // up — which, after a later test Sign Up creates a brand-new
      // subscription, is that new subscription's own first invoice. A
      // large leftover credit from canceling an earlier Annual test then
      // silently zeroes out (or deeply discounts) the new Monthly plan's
      // first charge, exactly the reported symptom. Testing cleanup has no
      // reason to generate this credit in the first place.
      for (const status of ['active', 'trialing', 'past_due', 'unpaid'] as const) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status, limit: 100 })
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id, { prorate: false })
        }
      }
    } catch (err) {
      console.error('[stripe/testing-downgrade] subscription cleanup failed', err)
      return Response.json({ error: 'stripe_error' }, { status: 502 })
    }

    // Belt-and-suspenders (2026-11-12): also clear any pending (not yet
    // invoiced) invoice items already sitting on the customer from BEFORE
    // this fix — a stray credit or charge from an earlier test cycle would
    // otherwise still corrupt the very next real Sign Up's first invoice,
    // even with the prorate: false fix above only preventing NEW ones.
    // Best-effort, matches the payment-method cleanup below — this is
    // cosmetic/preventive cleanup, never worth failing the whole reset over.
    try {
      const pendingItems = await stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 100 })
      for (const item of pendingItems.data) {
        await stripe.invoiceItems.del(item.id)
      }
    } catch (err) {
      console.error('[stripe/testing-downgrade] pending invoice item cleanup failed', err)
    }

    // Each test Sign Up's Checkout session attaches a fresh PaymentMethod to
    // the customer even when it's the identical 4242 test card — Checkout has
    // no way to know it's "the same card" unless it's picked from the
    // customer's own saved list. Repeated test cycles pile these up with no
    // subscription left pointing at any of them, so detach them all here too
    // — a best-effort cleanup, never worth failing the whole reset over.
    try {
      const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 })
      for (const pm of paymentMethods.data) {
        await stripe.paymentMethods.detach(pm.id)
      }
    } catch (err) {
      console.error('[stripe/testing-downgrade] payment method cleanup failed', err)
    }
  }

  await admin
    .from('profiles')
    .update({
      tier: 'free',
      subscription_storage_gb: STORAGE_BLOCK_GB,
      subscription_renewal_date: null,
      stripe_subscription_id: null,
      stripe_subscription_status: null,
      stripe_cancel_at_period_end: false,
    })
    .eq('id', user.id)

  return Response.json({ ok: true })
}
