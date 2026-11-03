// WYP — add-tester.mjs (2026-11-03)
//
// Interactive replacement for hand-editing docs/add-private-tester.sql's
// EMAIL/NAME variables each time. Owner: "create a prompted version to make
// it easier for me to add testers." Asks for Email / Display Name / Time
// Zone / Subscriber access, then:
//
//   1. Runs the "before sign-up" half immediately — inserts into
//      beta_allowlist (so the person can actually create an account) and,
//      if Subscriber access was requested, tier_toggle_allowlist (so they
//      CAN self-toggle Subscribed? later even if the automated grant below
//      hasn't run yet).
//   2. Queues the "after sign-up" half into public.pending_tester_setup
//      (migration 087) — profiles.display_name/time_zone, and tier/
//      subscription_renewal_date if Subscriber access was requested. This
//      can't happen yet if the person hasn't signed in (no auth.users row,
//      no profiles row to update), so it's queued rather than attempted
//      directly here.
//
// The old second manual step — re-running docs/add-private-tester.sql after
// the person actually signs in — is gone: app/api/cron/tick/route.ts's own
// Phase F calls provision_pending_testers() every hour, so the queued row
// gets picked up and finished automatically the first time it runs after
// the person's first sign-in. Nothing to remember, nothing to re-run.
//
// Prerequisites (same as docs/seed-test-attachments.mjs — this script
// cannot run inside the Cowork sandbox, no network route to your live
// Supabase project; run it on your own machine):
//   1. .env.local at the repo root already has NEXT_PUBLIC_SUPABASE_URL and
//      SUPABASE_SERVICE_ROLE_KEY (both already required for `npm run dev`).
//   2. Migration 087 (pending_tester_setup, provision_pending_testers()) has
//      been confirmed run.
//
// Run from the repo root:
//   node --env-file=.env.local docs/add-tester.mjs
//
// Safe to re-run for the same email — every insert is idempotent
// (beta_allowlist/tier_toggle_allowlist use ON CONFLICT DO NOTHING;
// pending_tester_setup is a real upsert, deliberately resetting
// provisioned_at back to null each time, so correcting a typo'd name or
// time zone before the person has signed in yet re-queues cleanly instead
// of being silently ignored).

import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[add-tester] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run with: node --env-file=.env.local docs/add-tester.mjs'
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function main() {
  const rl = createInterface({ input: stdin, output: stdout })

  let email = ''
  while (!EMAIL_RE.test(email)) {
    email = (await rl.question('Tester email: ')).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) console.log('  Not a valid email address — try again.')
  }

  let displayName = ''
  while (!displayName) {
    displayName = (await rl.question('Display name: ')).trim()
    if (!displayName) console.log('  Required — try again.')
  }

  const timeZoneInput = (
    await rl.question('Time zone (IANA name, e.g. America/Los_Angeles — leave blank to skip): ')
  ).trim()
  const timeZone = timeZoneInput || null

  const subscriberInput = (await rl.question('Grant Subscriber access? [Y/n]: ')).trim().toLowerCase()
  const grantSubscriber = subscriberInput !== 'n'

  rl.close()

  console.log('')
  console.log(
    `[add-tester] Setting up ${email} (${displayName})` +
      `${timeZone ? `, ${timeZone}` : ''}${grantSubscriber ? ', Subscriber access' : ', Free tier'}...`
  )

  // 1. "Before sign-up" half — takes effect immediately.
  const { error: betaError } = await admin
    .from('beta_allowlist')
    .upsert({ email, note: displayName }, { onConflict: 'email', ignoreDuplicates: true })
  if (betaError) {
    console.error('[add-tester] beta_allowlist insert failed:', betaError.message)
    process.exit(1)
  }

  if (grantSubscriber) {
    const { error: tierError } = await admin
      .from('tier_toggle_allowlist')
      .upsert(
        { email, note: 'Private tester — set up via add-tester.mjs' },
        { onConflict: 'email', ignoreDuplicates: true }
      )
    if (tierError) {
      console.error('[add-tester] tier_toggle_allowlist insert failed:', tierError.message)
      process.exit(1)
    }
  }

  // 2. "After sign-up" half — queued for the hourly cron job (Phase F) to
  //    finish once the person has actually signed in.
  const { error: pendingError } = await admin.from('pending_tester_setup').upsert(
    {
      email,
      display_name: displayName,
      time_zone: timeZone,
      grant_subscriber: grantSubscriber,
      provisioned_at: null,
    },
    { onConflict: 'email' }
  )
  if (pendingError) {
    console.error('[add-tester] pending_tester_setup insert failed:', pendingError.message)
    process.exit(1)
  }

  console.log(
    `[add-tester] Done. ${email} can sign in now. Their name${timeZone ? '/time zone' : ''}` +
      `${grantSubscriber ? '/Subscriber access' : ''} will be set automatically within the hour of their first sign-in.`
  )
}

main().catch((err) => {
  console.error('[add-tester] Unexpected error:', err)
  process.exit(1)
})
