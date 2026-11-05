import { createClient } from '@supabase/supabase-js'

import { computeAddlStoragePrice } from '@/lib/subscriptionPricing'
import { getSiteUrl, getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/create-storage-checkout-session — AttachmentStoragePanel's
 * "Buy Add'l" button. Body: { targetGb: 5 | 10 }. One-time payment, not a
 * subscription-item change — simpler to get right than a prorated addition
 * to an existing subscription, and matches the "Buy" wording (a purchase
 * action, not a plan change).
 *
 * Price is computed here, server-side, via the exact same
 * computeAddlStoragePrice() SubscriptionPanels.tsx uses to DISPLAY the
 * price — so what the button shows and what Checkout actually charges can
 * never drift apart. Never trusts a dollar amount from the client.
 */
export async function POST(request: Request) {
  let body: { targetGb?: number }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const targetGb = body.targetGb
  if (targetGb !== 5 && targetGb !== 10) {
    return Response.json({ error: 'bad_request', detail: 'targetGb must be 5 or 10.' }, { status: 400 })
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
    console.error('[stripe/create-storage-checkout-session]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('stripe_customer_id, subscription_renewal_date, tier')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (profile.tier !== 'subscriber') {
    // Buy Add'l Storage is a Subscriber-only add-on (AttachmentStoragePanel
    // only ever renders inside MySubscriptionSummary, which only renders
    // for tier === 'subscriber') — re-checked server-side regardless, same
    // "assume the control was bypassed" rule every other gated write here
    // already follows.
    return Response.json({ error: 'not_subscriber' }, { status: 403 })
  }

  let customerId = profile.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await sb.rpc('set_stripe_customer_id', { p_customer_id: customerId })
  }

  const unitAmountCents = Math.round(
    computeAddlStoragePrice(profile.subscription_renewal_date as string | null, targetGb) * 100
  )

  const siteUrl = getSiteUrl()

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: unitAmountCents,
            product_data: { name: `Additional ${targetGb} GB Attachment Storage` },
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/account/subscription?checkout=success`,
      cancel_url: `${siteUrl}/account/subscription?checkout=cancelled`,
      metadata: { supabase_user_id: user.id, kind: 'storage_addon', target_gb: String(targetGb) },
    })
    return Response.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/create-storage-checkout-session]', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }
}
