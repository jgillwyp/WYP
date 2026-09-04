// WYP — seed-test-attachments.mjs (2026-09-03)
//
// Creates a few small real attachment files (both a small file and one or
// more files sized to push the account near/over a tight test storage cap)
// on a couple of Jim's own existing Requests/ToDos, so the new Storage
// Management screen (/account/storage, StorageManagementForm.tsx) and the
// warning/critical usage-bar states can actually be exercised without
// uploading real, sizable files by hand through the app's own UI.
//
// This is a real end-to-end seed — actual bytes are uploaded to the real
// `attachments` Storage bucket (migration 026) and matching rows are
// inserted into the real `public.attachments` table (migration 025) via
// service_role, the same posture app/api/attachments/upload/route.ts
// already uses server-side. It does NOT go through that route (so it does
// NOT run the upload route's own quota/type/size checks) — that's
// deliberate: the point is to seed data that may already be at or past a
// tight test cap, which the real upload route would otherwise correctly
// refuse.
//
// Prerequisites (this script cannot run inside the Cowork sandbox — it has
// no network route to your live Supabase project. Run it on your own
// machine):
//   1. Your own .env.local at the repo root already has
//      NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (both already
//      required for `npm run dev` and the Attachments feature itself —
//      see CLAUDE.md's Known gaps entry on real Attachments).
//   2. Migration 051 (storage_limit_override_bytes) has been run, and
//      Account Options -> Subscriber section -> Test Storage Cap is set to
//      something small, e.g. 2 (MB), BEFORE you look at Storage Management
//      — otherwise these seeded files won't come anywhere near your real
//      100 MB free-tier cap and nothing will look "full."
//   3. You have at least one Sent Request and one ToDo already in the app
//      (the Week 2 seed script, docs/Week2 - SQL history.txt, already put
//      several in place under jimgillon@gmail.com if you haven't since
//      deleted them).
//
// Run from the repo root (the same directory as package.json/next.config.ts):
//
//   node --env-file=.env.local docs/seed-test-attachments.mjs
//
// Optional: pass a different account email as the first argument (defaults
// to jimgillon@gmail.com, the only account this app currently has real
// users on).
//
// Re-running this script adds another batch of test files rather than
// replacing the last batch — every seeded file is named with a
// "test-attachment-" prefix and a fresh timestamp, so re-runs are safe but
// cumulative. Remove them afterward from Storage Management's own Remove
// button (×) once you're done testing, the same as any real attachment —
// there is no separate "un-seed" script, on purpose: Remove already goes
// through the real, already-tested delete path.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[seed-test-attachments] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run with: node --env-file=.env.local seed-test-attachments.mjs'
  )
  process.exit(1)
}

const ownerEmail = process.argv[2] || 'jimgillon@gmail.com'

// Sized to matter against a small Test Storage Cap (Account Options ->
// Subscriber -> Test Storage Cap) — e.g. set the cap to 2 MB and this batch
// (0.9 + 0.9 + 0.9 = 2.7 MB) lands one file past it, so the usage bar shows
// critical/over-cap immediately after this script runs.
const SEED_FILES = [
  { label: 'small', bytes: 900_000, ext: 'txt', mime: 'text/plain' },
  { label: 'medium', bytes: 900_000, ext: 'txt', mime: 'text/plain' },
  { label: 'large', bytes: 900_000, ext: 'txt', mime: 'text/plain' },
]

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

function makeBuffer(bytes, label) {
  const header = `WYP test attachment ("${label}") — seeded by docs/seed-test-attachments.mjs on ${new Date().toISOString()}.\n`
  const filler = 'x'.repeat(Math.max(0, bytes - header.length))
  return Buffer.from(header + filler, 'utf8')
}

async function main() {
  // 1. Resolve the owner's account (auth.users, then profiles for a display
  //    name — same lookup shape docs/Week2 - SQL history.txt's own seed
  //    script already uses for Contacts/Requests).
  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (usersError) {
    console.error('[seed-test-attachments] Could not list users:', usersError.message)
    process.exit(1)
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase())
  if (!user) {
    console.error(`[seed-test-attachments] No auth user found for ${ownerEmail}.`)
    process.exit(1)
  }

  const { data: profile } = await admin.from('profiles').select('display_name').eq('id', user.id).single()
  const uploaderLabel = profile?.display_name || 'You'

  // 2. Find a Request (contact_id not null) and a ToDo (contact_id null)
  //    this account owns, preferring the most recently created of each so
  //    the seeded files show up somewhere Jim will actually look.
  const { data: requestRow } = await admin
    .from('requests')
    .select('id, description')
    .eq('owner_id', user.id)
    .not('contact_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: todoRow } = await admin
    .from('requests')
    .select('id, description')
    .eq('owner_id', user.id)
    .is('contact_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const targets = [requestRow, todoRow].filter(Boolean)
  if (targets.length === 0) {
    console.error(
      `[seed-test-attachments] ${ownerEmail} has no Requests or ToDos to attach test files to. ` +
        'Create at least one (or run docs/Week2 - SQL history.txt\'s own seed script) first.'
    )
    process.exit(1)
  }

  console.log(`[seed-test-attachments] Seeding onto ${targets.length} item(s) owned by ${ownerEmail}:`)
  for (const t of targets) console.log(`  - ${t.id} — "${(t.description ?? '').slice(0, 60)}"`)

  let fileIndex = 0
  let totalBytes = 0

  for (const target of targets) {
    for (const spec of SEED_FILES) {
      const id = randomUUID()
      const timestamp = Date.now()
      const fileName = `test-attachment-${spec.label}-${timestamp}.${spec.ext}`
      const storagePath = `${target.id}/${id}-${fileName}`
      const buffer = makeBuffer(spec.bytes, spec.label)

      const { error: uploadError } = await admin.storage
        .from('attachments')
        .upload(storagePath, buffer, { contentType: spec.mime, upsert: false })

      if (uploadError) {
        console.error(`[seed-test-attachments] Upload failed for ${fileName}:`, uploadError.message)
        continue
      }

      const { error: insertError } = await admin.from('attachments').insert({
        id,
        request_id: target.id,
        uploaded_by: user.id,
        uploaded_by_label: uploaderLabel,
        kind: 'file',
        file_name: fileName,
        storage_path: storagePath,
        size_bytes: buffer.length,
        mime_type: spec.mime,
      })

      if (insertError) {
        console.error(`[seed-test-attachments] Row insert failed for ${fileName}:`, insertError.message)
        await admin.storage.from('attachments').remove([storagePath])
        continue
      }

      fileIndex += 1
      totalBytes += buffer.length
      console.log(`  [${fileIndex}] ${fileName} — ${(buffer.length / 1024).toFixed(0)} KB -> ${target.id}`)
    }
    // Only seed the "large" batch onto the first target, to avoid piling
    // every file onto every item — the second target (if any) gets just the
    // first spec so there's still something to see there without doubling
    // the total seeded size.
    break
  }

  console.log(
    `[seed-test-attachments] Done. ${fileIndex} file(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MB total. ` +
      'Open /account/storage to see them (set a small Test Storage Cap first in Account Options to see the warning/blocked bar states).'
  )
}

main().catch((err) => {
  console.error('[seed-test-attachments] Unexpected error:', err)
  process.exit(1)
})
