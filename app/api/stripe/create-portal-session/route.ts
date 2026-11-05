import { createClient } from '@supabase/supabase-js'

import { getSiteUrl, getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/stripe/create-portal-session — RenewalDatePanel's "Cancel
 * Renewal" button. Redirects to Stripe's own hosted Billing Portal rather
 * than a custom cancellation screen: it already shows the renewal date,
 * offers Cancel (effective at period end, matching this app's own "stays
 * active through the end of the period you've already paid for" promise),
 * lets the person update their payment method, and shows invoice history —
 * all for free, with no custom UI to build or get wrong.
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

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userData.user.id)
    .single()
  if (profileError || !profile?.stripe_customer_id) {
    return Response.json({ error: 'no_subscription' }, { status: 404 })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    console.error('[stripe/create-portal-session]', err)
    return Response.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id as string,
      return_url: `${getSiteUrl()}/account/subscription`,
    })
    return Response.json({ url: portalSession.url })
  } catch (err) {
    console.error('[stripe/create-portal-session]', err)
    return Response.json({ error: 'stripe_error' }, { status: 502 })
  }
}
