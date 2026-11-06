// WYP — add-tester.mjs (2026-11-03; updated 2026-11-06)
//
// Command-line fallback for adding a private tester — the primary path is
// now the in-app Admin tab's "Add Private Tester" screen (Main Screen →
// Housekeeping → Admin, admin_add_private_tester() RPC, migration 091), no
// longer this script. Jim, looking at a real run of this exact script: "The
// entry of the time zone is really awkward, the Grant Subscriber access is
// not required (I think all testers can grant themselves Subscriber
// status)." Both of those are fixed here too, so this still behaves the
// same way the in-app screen does if you ever need to run it (e.g. no
// network route to the app itself, or just prefer the terminal):
//
//   - Time Zone is now validated against the real list of IANA zone names
//     (Intl.supportedValuesOf('timeZone'), same source
//     app/src/lib/timeZones.ts uses) instead of being accepted as free text
//     — a typo like "america/l" is rejected with the closest matches shown,
//     rather than silently stored and failing later.
//   - "Grant Subscriber access?" is gone. Every tester added here now
//     ALWAYS gets added to tier_toggle_allowlist (so they can self-toggle
//     Subscribed? in Account Options whenever they want), and nobody is
//     auto-set to Subscriber tier at first sign-in — see migration 091's
//     own header comment for the full reasoning.
//
// What it still does:
//
//   1. Runs the "before sign-up" half immediately — inserts into
//      beta_allowlist (so the person can actually create an account) and
//      tier_toggle_allowlist (so they can self-toggle Subscribed? whenever
//      they want).
//   2. Queues the "after sign-up" half into public.pending_tester_setup
//      (migration 087) — profiles.display_name/time_zone. This can't happen
//      yet if the person hasn't signed in (no auth.users row, no profiles
//      row to update), so it's queued rather than attempted directly here.
//      app/api/cron/tick/route.ts's own Phase F calls
//      provision_pending_testers() every hour, so the queued row gets
//      picked up and finished automatically the first time it runs after
//      the person's first sign-in.
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
//
// Companion script: docs/delete-tester.mjs removes everything this script
// adds (allowlist/queue rows, optionally an already-granted Subscriber
// tier) — it does not touch the person's account or any of their data.

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

// Same source app/src/lib/timeZones.ts uses — duplicated here rather than
// imported, since this script can't load a .ts file without a build step
// (this project's established small-helper-duplication convention).
function getAllTimeZones() {
  try {
    return [...Intl.supportedValuesOf('timeZone')]
  } catch {
    return []
  }
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout })
  const allZones = getAllTimeZones()

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

  let timeZone = null
  let timeZoneDone = false
  while (!timeZoneDone) {
    const timeZoneInput = (
      await rl.question('Time zone (IANA name, e.g. America/Los_Angeles — leave blank to skip): ')
    ).trim()
    if (!timeZoneInput) {
      timeZoneDone = true
      break
    }
    const exact = allZones.find((z) => z.toLowerCase() === timeZoneInput.toLowerCase())
    if (exact) {
      timeZone = exact
      timeZoneDone = true
      break
    }
    const close = allZones.filter((z) => z.toLowerCase().includes(timeZoneInput.toLowerCase())).slice(0, 10)
    console.log(`  Not a recognized IANA time zone.${close.length ? ' Did you mean:' : ''}`)
    close.forEach((z) => console.log(`    ${z}`))
    console.log('  Try again, or leave blank to skip.')
  }

  rl.close()

  console.log('')
  console.log(`[add-tester] Setting up ${email} (${displayName})${timeZone ? `, ${timeZone}` : ''}...`)

  // 1. "Before sign-up" half — takes effect immediately. Every tester added
  //    this way is always given self-toggle access (tier_toggle_allowlist) —
  //    see migration 091's header comment for the full reasoning.
  const { error: betaError } = await admin
    .from('beta_allowlist')
    .upsert({ email, note: displayName }, { onConflict: 'email', ignoreDuplicates: true })
  if (betaError) {
    console.error('[add-tester] beta_allowlist insert failed:', betaError.message)
    process.exit(1)
  }

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

  // 2. "After sign-up" half — queued for the hourly cron job (Phase F) to
  //    finish once the person has actually signed in. grant_subscriber is
  //    always false now — nobody is auto-set to Subscriber tier through
  //    this path; they flip Account Options' own "Subscribed? (testing
  //    only)" checkbox themselves, now that the step above always gives
  //    them the ability to.
  const { error: pendingError } = await admin.from('pending_tester_setup').upsert(
    {
      email,
      display_name: displayName,
      time_zone: timeZone,
      grant_subscriber: false,
      provisioned_at: null,
    },
    { onConflict: 'email' }
  )
  if (pendingError) {
    console.error('[add-tester] pending_tester_setup insert failed:', pendingError.message)
    process.exit(1)
  }

  console.log(
    `[add-tester] Done. ${email} can sign in now. Their name${timeZone ? '/time zone' : ''} will be set ` +
      'automatically within the hour of their first sign-in, and they can grant themselves Subscriber access ' +
      "anytime via Account Options' \"Subscribed? (testing only)\" checkbox."
  )
}

main().catch((err) => {
  console.error('[add-tester] Unexpected error:', err)
  process.exit(1)
})
