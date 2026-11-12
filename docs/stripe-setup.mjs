// WYP — stripe-setup.mjs (2026-11-04)
//
// One-time setup for the real Stripe integration (migration 088,
// app/api/stripe/*). Creates (idempotently) the Product, the two real
// recurring Prices, and the two first-year discount Coupons this app's
// checkout routes reference by id — then prints the env vars to paste into
// .env.local and Vercel.
//
// Same "written here, run by you on your own machine" posture as
// docs/add-tester.mjs/docs/seed-test-attachments.mjs — this sandbox has no
// network route to Stripe's API.
//
// Prerequisites:
//   1. A real Stripe account exists (stripe.com — your CA C-Corp info,
//      bank account for payouts). Start in TEST MODE first (the toggle in
//      the Dashboard's left sidebar) — test-mode keys start with sk_test_,
//      and every Checkout/Portal flow works identically in test mode with
//      Stripe's published test card numbers (4242 4242 4242 4242, any
//      future expiry, any CVC). Switch to live keys only once you've
//      actually clicked through a Sign Up end to end in test mode.
//   2. Dashboard -> Developers -> API keys -> copy the Secret key into
//      .env.local as STRIPE_SECRET_KEY (and, once ready, into Vercel's
//      Environment Variables for production).
//
// Run from the repo root:
//   node --env-file=.env.local docs/stripe-setup.mjs
//
// Safe to re-run — every object is looked up by its own wyp_setup_key
// metadata tag before being created, so running this twice reuses what's
// already there instead of creating duplicates.
//
// This script does NOT create the webhook endpoint itself — Stripe
// webhooks are registered through the Dashboard (Developers -> Webhooks
// -> Add endpoint), not the API, because the signing secret it generates
// is only ever shown once, in that same UI flow. See the printed
// instructions at the end of this script for the exact URL/events to use.

import Stripe from 'stripe'

const SECRET_KEY = process.env.STRIPE_SECRET_KEY
if (!SECRET_KEY) {
  console.error(
    '[stripe-setup] Missing STRIPE_SECRET_KEY.\n' +
      'Run with: node --env-file=.env.local docs/stripe-setup.mjs\n' +
      '(after adding STRIPE_SECRET_KEY to .env.local — see this file\'s own header comment)'
  )
  process.exit(1)
}

const stripe = new Stripe(SECRET_KEY)
const isTestMode = SECRET_KEY.startsWith('sk_test_')

const PRODUCT_SETUP_KEY = 'wyp_subscription_v1'
const PRICE_ANNUAL_KEY = 'wyp_price_annual_v1'
const PRICE_MONTHLY_KEY = 'wyp_price_monthly_v1'
const COUPON_FIRST_YEAR_KEY = 'wyp_coupon_first_year_v1'
const COUPON_TESTER_FIRST_YEAR_KEY = 'wyp_coupon_tester_first_year_v1'
const PRICE_STORAGE_MONTHLY_KEY = 'wyp_price_storage_monthly_v1'
const PRICE_STORAGE_ANNUAL_KEY = 'wyp_price_storage_annual_v1'

async function findByMetadata(list, key, value) {
  for await (const item of list) {
    if (item.metadata?.[key] === value) return item
  }
  return null
}

async function main() {
  console.log(`[stripe-setup] Running in ${isTestMode ? 'TEST' : 'LIVE'} mode.\n`)

  // 1. Product
  let product = await findByMetadata(stripe.products.list({ limit: 100 }), 'wyp_setup_key', PRODUCT_SETUP_KEY)
  if (!product) {
    product = await stripe.products.create({
      name: 'Would You Please Subscription',
      metadata: { wyp_setup_key: PRODUCT_SETUP_KEY },
    })
    console.log(`[stripe-setup] Created Product ${product.id}`)
  } else {
    console.log(`[stripe-setup] Reusing existing Product ${product.id}`)
  }

  // 2. Annual Price — $49/yr recurring. The $39 "1st year" figure is NOT a
  // separate price; it's this same $49/yr price with a duration:'once'
  // coupon applied at Checkout time (see the two coupons below), so every
  // renewal after the first bills the plain $49 with no coupon involved.
  let priceAnnual = await findByMetadata(
    stripe.prices.list({ limit: 100, product: product.id }),
    'wyp_setup_key',
    PRICE_ANNUAL_KEY
  )
  if (!priceAnnual) {
    priceAnnual = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 4900,
      recurring: { interval: 'year' },
      metadata: { wyp_setup_key: PRICE_ANNUAL_KEY },
    })
    console.log(`[stripe-setup] Created annual Price ${priceAnnual.id} ($49.00/yr)`)
  } else {
    console.log(`[stripe-setup] Reusing existing annual Price ${priceAnnual.id}`)
  }

  // 3. Monthly Price — $5/mo recurring, flat, no discount ever.
  let priceMonthly = await findByMetadata(
    stripe.prices.list({ limit: 100, product: product.id }),
    'wyp_setup_key',
    PRICE_MONTHLY_KEY
  )
  if (!priceMonthly) {
    priceMonthly = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 500,
      recurring: { interval: 'month' },
      metadata: { wyp_setup_key: PRICE_MONTHLY_KEY },
    })
    console.log(`[stripe-setup] Created monthly Price ${priceMonthly.id} ($5.00/mo)`)
  } else {
    console.log(`[stripe-setup] Reusing existing monthly Price ${priceMonthly.id}`)
  }

  // 4. First-year coupon (general public) — $10 off the $49 annual price's
  // very first invoice only, landing on exactly $39.00.
  let couponFirstYear = await findByMetadata(
    stripe.coupons.list({ limit: 100 }),
    'wyp_setup_key',
    COUPON_FIRST_YEAR_KEY
  )
  if (!couponFirstYear) {
    couponFirstYear = await stripe.coupons.create({
      amount_off: 1000,
      currency: 'usd',
      duration: 'once',
      name: 'WYP 1st Year Discount',
      metadata: { wyp_setup_key: COUPON_FIRST_YEAR_KEY },
    })
    console.log(`[stripe-setup] Created Coupon ${couponFirstYear.id} ($10 off, once — $39.00 1st year)`)
  } else {
    console.log(`[stripe-setup] Reusing existing Coupon ${couponFirstYear.id}`)
  }

  // 5. Tester-only first-year coupon — $30 off, landing on exactly $19.00.
  // Only ever applied by app/api/stripe/create-checkout-session/route.ts
  // when the signed-in caller's own email is on beta_allowlist
  // (is_beta_tester(), migration 088) — Stripe itself has no notion of
  // "tester," this coupon is just a deeper discount this app chooses to
  // apply for that cohort specifically.
  let couponTester = await findByMetadata(
    stripe.coupons.list({ limit: 100 }),
    'wyp_setup_key',
    COUPON_TESTER_FIRST_YEAR_KEY
  )
  if (!couponTester) {
    couponTester = await stripe.coupons.create({
      amount_off: 3000,
      currency: 'usd',
      duration: 'once',
      name: 'WYP Private Tester 1st Year Discount',
      metadata: { wyp_setup_key: COUPON_TESTER_FIRST_YEAR_KEY },
    })
    console.log(`[stripe-setup] Created Coupon ${couponTester.id} ($30 off, once — $19.00 1st year, testers only)`)
  } else {
    console.log(`[stripe-setup] Reusing existing Coupon ${couponTester.id}`)
  }

  // 6. Additional Storage — monthly increment, $1/mo per 5 GB block. Recurs
  // on the SAME subscription/billing cycle as whichever base plan the
  // account already has (see app/api/stripe/update-storage/route.ts) —
  // this is not a separate purchase or a separate billing cadence of its
  // own, just a second subscription item.
  let priceStorageMonthly = await findByMetadata(
    stripe.prices.list({ limit: 100, product: product.id }),
    'wyp_setup_key',
    PRICE_STORAGE_MONTHLY_KEY
  )
  if (!priceStorageMonthly) {
    priceStorageMonthly = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 100,
      recurring: { interval: 'month' },
      nickname: 'Additional Storage (per 5 GB, monthly)',
      metadata: { wyp_setup_key: PRICE_STORAGE_MONTHLY_KEY },
    })
    console.log(`[stripe-setup] Created monthly storage Price ${priceStorageMonthly.id} ($1.00/mo per 5 GB)`)
  } else {
    console.log(`[stripe-setup] Reusing existing monthly storage Price ${priceStorageMonthly.id}`)
  }

  // 7. Additional Storage — annual increment, $12/yr per 5 GB block. Jim's
  // own design deliberately relies on Stripe's native day-by-day proration
  // for a mid-cycle add (e.g. ~$6 with 6 months left) rather than a second,
  // separate "reduced rate" Price — recommended over hand-rolling that math,
  // and confirmed with Jim, 2026-11-04.
  let priceStorageAnnual = await findByMetadata(
    stripe.prices.list({ limit: 100, product: product.id }),
    'wyp_setup_key',
    PRICE_STORAGE_ANNUAL_KEY
  )
  if (!priceStorageAnnual) {
    priceStorageAnnual = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 1200,
      recurring: { interval: 'year' },
      nickname: 'Additional Storage (per 5 GB, annual)',
      metadata: { wyp_setup_key: PRICE_STORAGE_ANNUAL_KEY },
    })
    console.log(`[stripe-setup] Created annual storage Price ${priceStorageAnnual.id} ($12.00/yr per 5 GB)`)
  } else {
    console.log(`[stripe-setup] Reusing existing annual storage Price ${priceStorageAnnual.id}`)
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wouldyouplease.com'

  console.log('\n[stripe-setup] Done. Add these to .env.local (and, once ready, Vercel):\n')
  console.log(`STRIPE_PRICE_ANNUAL=${priceAnnual.id}`)
  console.log(`STRIPE_PRICE_MONTHLY=${priceMonthly.id}`)
  console.log(`STRIPE_COUPON_FIRST_YEAR=${couponFirstYear.id}`)
  console.log(`STRIPE_COUPON_TESTER_FIRST_YEAR=${couponTester.id}`)
  console.log(`STRIPE_PRICE_STORAGE_MONTHLY=${priceStorageMonthly.id}`)
  console.log(`STRIPE_PRICE_STORAGE_ANNUAL=${priceStorageAnnual.id}`)

  console.log('\n[stripe-setup] One more manual step — Stripe only shows a webhook signing')
  console.log('secret once, in the Dashboard, so this script cannot create it for you:')
  console.log('  1. Dashboard -> Developers -> Webhooks -> Add endpoint')
  console.log(`  2. Endpoint URL: ${siteUrl}/api/stripe/webhook`)
  console.log('  3. Select these events:')
  console.log('       checkout.session.completed')
  console.log('       customer.subscription.updated')
  console.log('       customer.subscription.deleted')
  console.log('       invoice.paid')
  console.log('  4. Copy the "Signing secret" (starts with whsec_) into')
  console.log('     .env.local / Vercel as STRIPE_WEBHOOK_SECRET.')
  console.log(
    '\n[stripe-setup] Test mode reminder: use card 4242 4242 4242 4242 (any future expiry/CVC) to click through Sign Up end to end before switching to live keys.'
  )
}

main().catch((err) => {
  console.error('[stripe-setup] Unexpected error:', err)
  process.exit(1)
})
