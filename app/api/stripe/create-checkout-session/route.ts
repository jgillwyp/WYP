import { createClient } from '@supabase/supabase-js'

import {
  getAnnualPriceId,
  getFirstYearCouponId,
  getMonthlyPriceId,
  getSiteUrl,
  getStripeClient,
  getTesterFirstYearCouponId,
} from '@/lib/stripe'

// Stripe's Node SDK needs real network sockets — not available on Next's
// Edge runtime, same reasoning every other Node-dependent route in this
// app already states (nodemailer, service_role).
export const runtime = 'nodejs'

/**
 * POST /api/stripe/create-checkout-session — the Sign Up button on the Free
 * Account Status state (FreeStatus, SubscriptionPanels.tsx — renamed from
 * BecomeSubscriberPitch, 2026-11-06), shown on both Account Options' own
 * Account Status section and /account/subscription. Body:
 * { plan: 'annual' | 'monthly' }.
 *
 * Forwarded-JWT, no service_role — same posture app/api/email/send-request/
 * route.ts already established: every query runs as the caller, under
 * their own RLS, so nothing here can act on anyone else's account. The one
 * write this route makes directly (set_stripe_customer_id) goes through a
 * SECURITY DEFINER function rather than a raw column UPDATE, per migration
 * 088's own header comment — the value itself always comes back from
 * Stripe's own customers.create() call in this same request, never from
 * the client, but the function's refusal to ever overwrite an existing
 * linkage is a second layer of protection regardless.
 *
 * The $19 tester-only price (vs. the general public's $39) is decided
 * here, server-side, via is_beta_tester() — never trusted from the client,
 * same "the locked button is a courtesy" posture this app already takes
 * for every other gated write.
 */
export async function POST(request: Request) {
  let body: { plan?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const plan = body.plan
  if (plan !== 'annual' && plan !== 'monthly') {
    return Response.json({ error: 'bad_request', detail: "plan must be 'annual' or 'monthly'." }, { status: 400 })
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

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/create-checkout-session]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  // RLS already scopes this select to the caller's own row (migration 003).
  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let customerId = profile.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    // Refuses to overwrite an existing linkage (migration 088) — harmless
    // here since we just confirmed the column was null, but keeps every
    // caller of this function honest the same way regardless.
    await sb.rpc('set_stripe_customer_id', { p_customer_id: customerId })
  } else {
    // Guard against a second, concurrent real Stripe subscription for the
    // same customer (2026-11-05, Jim-reported — repeated Sign Up testing,
    // crossed with the "Subscribed? (testing only)" checkbox flipping tier
    // back to 'free' without canceling the real one underneath, left
    // several live orphaned subscriptions in the Stripe Dashboard). This
    // app only ever tracks ONE stripe_subscription_id per profile, so a
    // second live subscription is never something this account can
    // correctly manage afterward — refused outright rather than created.
    try {
      const existing = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 })
      if (existing.data.length === 0) {
        const trialing = await stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 1 })
        existing.data.push(...trialing.data)
      }
      if (existing.data.length > 0) {
        return Response.json(
          {
            error: 'already_subscribed',
            detail: 'You already have an active subscription — use Cancel Renewal to manage it instead.',
          },
          { status: 409 }
        )
      }
    } catch (err) {
      console.error('[stripe/create-checkout-session] subscriptions.list check failed', err)
      return Response.json({ error: 'stripe_error' }, { status: 502 })
    }
  }

  // /stripe-return, not /account/subscription directly (2026-11-10,
  // owner-reported) -- see that page's own header comment for why a direct
  // redirect bounced to a sign-in screen on native iOS.
  const siteUrl = getSiteUrl()
  const successUrl = `${siteUrl}/stripe-return?checkout=success`
  const cancelUrl = `${siteUrl}/stripe-return?checkout=cancelled`

  try {
    if (plan === 'monthly') {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: getMonthlyPriceId(), quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: { metadata: { supabase_user_id: user.id } },
        metadata: { supabase_user_id: user.id, plan: 'monthly' },
      })
      return Response.json({ url: session.url })
    }

    // annual — $39 for everyone's first year, $19 for a beta_allowlist
    // tester's first year, via a duration:'once' coupon that only ever
    // discounts the very first invoice; every renewal after that bills the
    // plain $49/yr price with no coupon involved at all.
    const { data: isTester } = await sb.rpc('is_beta_tester')
    const couponId = isTester ? getTesterFirstYearCouponId() : getFirstYearCouponId()

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: getAnnualPriceId(), quantity: 1 }],
      discounts: [{ coupon: couponId }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { supabase_user_id: user.id } },
      metadata: { supabase_user_id: user.id, plan: 'annual', tester: String(Boolean(isTester)) },
    })
    return Response.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/create-checkout-session]', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }
}
