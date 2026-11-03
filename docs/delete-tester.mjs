// WYP — delete-tester.mjs (2026-11-03)
//
// Companion to add-tester.mjs: removes a private tester's testing-ACCESS
// setup — their beta_allowlist row, their tier_toggle_allowlist row, and
// any still-pending row in pending_tester_setup (migration 087).
//
// This does NOT delete the person's actual account or any of their data
// (Contacts, Requests, ToDos, Attachments) — only the access-control rows
// add-tester.mjs itself creates. If they've already signed up, they keep
// their account and everything in it; they just can no longer self-toggle
// Subscribed? (their tier_toggle_allowlist row is gone). If they haven't
// signed in yet, they're removed from the Private Testing allowlist
// entirely and can no longer create an account at all — removing an
// already-signed-up person from beta_allowlist has no effect on their
// existing ability to keep signing in, since can_create_account() only
// consults that table for a genuinely new email (see that function's own
// header comment, docs/Week5 - SQL history.txt).
//
// Optionally also reverts an already-granted Subscriber tier back to
// 'free' — asked separately, defaulting to No, since that's a more
// consequential change than just removing list membership and directly
// takes away paid-tier features (Attachments storage above the free cap,
// Receipt Confirmation, Voice Dictation, Request Texting, ad-free, etc.)
// from someone who may still be actively using the app.
//
// Does NOT delete the account or any of its data. If a real "remove this
// tester and everything they created" tool is ever needed, that's a
// separate, explicitly-requested, much more destructive script — not
// something this one does on its own.
//
// Prerequisites / how to run: identical to add-tester.mjs — .env.local at
// the repo root with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY,
// cannot run inside the Cowork sandbox (no network route to your live
// Supabase project).
//
//   node --env-file=.env.local docs/delete-tester.mjs
//
// Safe to re-run for an email already removed — every delete is a no-op if
// the row is already gone.

import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[delete-tester] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run with: node --env-file=.env.local docs/delete-tester.mjs'
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
    email = (await rl.question('Tester email to remove: ')).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) console.log('  Not a valid email address — try again.')
  }

  // Look up their account/tier, if any, purely to inform the prompt below
  // and the closing summary — this script never creates or deletes an
  // account, only acts on the access-control rows around one that may or
  // may not already exist.
  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (usersError) {
    console.error('[delete-tester] Could not list users:', usersError.message)
    process.exit(1)
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === email)

  let currentTier = null
  if (user) {
    const { data: profile } = await admin.from('profiles').select('tier').eq('id', user.id).maybeSingle()
    currentTier = profile?.tier ?? null
  }

  let revertTier = false
  if (user && currentTier === 'subscriber') {
    const revertInput = (
      await rl.question('This account is currently Subscriber tier — revert it to Free too? [y/N]: ')
    )
      .trim()
      .toLowerCase()
    revertTier = revertInput === 'y'
  }

  rl.close()

  console.log('')
  console.log(
    `[delete-tester] Removing testing access for ${email}` +
      `${user ? ' (has an existing account)' : ' (no account yet)'}${revertTier ? ', reverting to Free tier' : ''}...`
  )

  const { error: pendingError } = await admin.from('pending_tester_setup').delete().eq('email', email)
  if (pendingError) {
    console.error('[delete-tester] pending_tester_setup delete failed:', pendingError.message)
    process.exit(1)
  }

  const { error: tierAllowError } = await admin.from('tier_toggle_allowlist').delete().eq('email', email)
  if (tierAllowError) {
    console.error('[delete-tester] tier_toggle_allowlist delete failed:', tierAllowError.message)
    process.exit(1)
  }

  const { error: betaError } = await admin.from('beta_allowlist').delete().eq('email', email)
  if (betaError) {
    console.error('[delete-tester] beta_allowlist delete failed:', betaError.message)
    process.exit(1)
  }

  if (revertTier && user) {
    const { error: tierError } = await admin.from('profiles').update({ tier: 'free' }).eq('id', user.id)
    if (tierError) {
      console.error('[delete-tester] profiles tier revert failed:', tierError.message)
      process.exit(1)
    }
  }

  console.log(
    `[delete-tester] Done. ${email} removed from the testing allowlist/queue` +
      `${revertTier ? ' and reverted to Free tier' : ''}.` +
      (user
        ? ' Their account and all of their data (Contacts, Requests, Attachments, etc.) are untouched.'
        : ' They can no longer create a new account unless re-added with add-tester.mjs.')
  )
}

main().catch((err) => {
  console.error('[delete-tester] Unexpected error:', err)
  process.exit(1)
})
