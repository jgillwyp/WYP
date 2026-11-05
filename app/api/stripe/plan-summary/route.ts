import { createClient } from '@supabase/supabase-js'

import { resolveSubscriptionCadence } from '../_shared'
import { getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/plan-summary — the data source for the simplified
 * "Your Plan Summary" shown to an already-subscribed account (2026-11-05,
 * Jim's own request: "showing all of the plans to a subscriber is not
 * needed... I would like to make the presentation of what is subscribed-to
 * easier to see/understand"). The only thing this adds beyond what the
 * profile already carries (renewalDate, storageGb) is which base plan
 * (Annual or Monthly) the account's real subscription is actually on — not
 * persisted anywhere, so it's read live from Stripe, the same way
 * update-storage/route.ts already has to.
 *
 * Deliberately degrades to { cadence: null } on anything short of a clean
 * answer (no subscription on file, Stripe unreachable, misconfigured env) —
 * this is a presentational nicety only; the caller falls back to a generic
 * plan-options list rather than erroring the whole screen over it.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ cadence: null })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ cadence: null })
  }

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) {
    return Response.json({ cadence: null })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('stripe_subscription_id, tier')
    .eq('id', userData.user.id)
    .single()

  if (!profile || profile.tier !== 'subscriber' || !profile.stripe_subscription_id) {
    return Response.json({ cadence: null })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/plan-summary]', err)
    return Response.json({ cadence: null })
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id as string, {
      expand: ['items.data.price'],
    })
    return Response.json({ cadence: resolveSubscriptionCadence(subscription) })
  } catch (err) {
    console.error('[stripe/plan-summary] retrieve failed', err)
    return Response.json({ cadence: null })
  }
}
