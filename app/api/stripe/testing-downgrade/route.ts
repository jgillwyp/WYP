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
      for (const status of ['active', 'trialing', 'past_due', 'unpaid'] as const) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status, limit: 100 })
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id)
        }
      }
    } catch (err) {
      console.error('[stripe/testing-downgrade] subscription cleanup failed', err)
      return Response.json({ error: 'stripe_error' }, { status: 502 })
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
