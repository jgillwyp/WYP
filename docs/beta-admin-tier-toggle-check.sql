-- ============================================================================
-- Beta allowlist / profiles / tier_toggle_allowlist / is_admin — diagnostic
-- and maintenance script (2026-09-11).
--
-- Not a numbered migration — nothing here alters a table (is_admin, migration
-- 053, and tier_toggle_allowlist, migration 035, already exist). This is an
-- operational script, same category as verify-migrations-034-041-044-048.sql
-- and seed-test-attachments.mjs: written for Jim to run himself in the
-- Supabase SQL editor, re-runnable any time a new participant needs checking.
--
-- Three separate, deliberately-independent permissions this script touches,
-- plus one data-population step (Step 4b) that isn't a permission at all:
--   1. beta_allowlist        — may this NEW email sign up at all (migration 015)
--   2. tier_toggle_allowlist — may this signed-in account self-grant Subscriber
--                              for testing, i.e. see the "Subscribed?" checkbox
--                              (migration 035)
--   3. profiles.is_admin     — may this account see cross-account Statistics
--                              aggregates (migration 053)
--   4b. profiles.display_name — populated in bulk from beta_allowlist.note,
--                              where Jim has been entering each participant's
--                              actual name (2026-09-14)
--
-- None of these imply each other. beta_allowlist membership does not create a
-- profiles row (that happens automatically, via the on_auth_user_created
-- trigger, the moment someone actually completes their first magic-link
-- sign-in) and does not grant tier_toggle_allowlist or is_admin — both of
-- those are separate, smaller, hand-managed lists on purpose.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — Diagnostic: where does every beta_allowlist email actually stand?
-- Run this first. Read the two null columns below before touching anything.
-- ----------------------------------------------------------------------------
select
  ba.email,
  u.id                              as auth_user_id,      -- null = never signed in yet; nothing to fix, will appear on their own first sign-in
  p.id                              as profiles_row,       -- null with auth_user_id set = a genuine gap, see Step 2
  p.is_admin,
  exists(
    select 1 from tier_toggle_allowlist tta where lower(tta.email) = lower(ba.email)
  )                                 as on_tier_toggle_allowlist
from beta_allowlist ba
left join auth.users u on lower(u.email) = lower(ba.email)
left join public.profiles p on p.id = u.id
order by ba.email;

-- ----------------------------------------------------------------------------
-- STEP 2 — Backfill a stub profiles row, ONLY for a row from Step 1 where
-- auth_user_id is set but profiles_row is null (should be rare — the
-- on_auth_user_created trigger, migration 014, is supposed to prevent this).
-- Safe to run even if no such row exists; on conflict makes it a no-op.
-- ----------------------------------------------------------------------------
insert into public.profiles (id)
select u.id
from auth.users u
where lower(u.email) = lower('someone@example.com')  -- EDIT: replace with the real email
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- STEP 3 — Grant "Subscribed?" self-toggle (tier_toggle_allowlist).
-- Requires no profiles row at all — can_toggle_tier() reads only auth.users
-- and this table. Add one row per email you want to grant this to.
-- ----------------------------------------------------------------------------
insert into tier_toggle_allowlist (email, note) values
  ('someone@example.com', 'testing Attachments/Subscriber features')
  -- , ('another@example.com', 'note here')
on conflict (email) do nothing;

-- Confirm the gate itself is still on (default true) — if it were ever
-- switched off, everyone signed in already sees the checkbox regardless of
-- this table:
--   select value from app_settings where key = 'tier_toggle_gate_enabled';

-- ----------------------------------------------------------------------------
-- STEP 4 — Grant is_admin (Statistics section access). Requires a real
-- profiles row to exist first (Step 2, if needed). Grant individually and
-- deliberately — this exposes cross-account aggregate data, a bigger grant
-- than either of the two lists above, so it should stay a short, intentional
-- list, not "everyone on beta_allowlist."
-- ----------------------------------------------------------------------------
update public.profiles set is_admin = true
where id = (select id from auth.users where lower(email) = lower('someone@example.com'));  -- EDIT

-- ----------------------------------------------------------------------------
-- STEP 4b (2026-09-14) — Bulk-populate profiles.display_name from
-- beta_allowlist.note, where that's where Jim has been entering each
-- participant's actual name. Requires a real profiles row to exist first
-- (Step 2 backfills any that are missing) — a person who hasn't signed in
-- yet has no auth.users row to join against, so they're simply skipped
-- here and will need this step re-run once they do sign in.
--
-- Non-destructive by design: only ever fills a display_name that is
-- currently NULL. Never overwrites a name someone already set for
-- themselves via Create Free Account, or a name you already set by hand —
-- if you want this batch to override an existing value too, drop the
-- `where public.profiles.display_name is null` line from the UPDATE below.
--
-- Preview first — review this before running the write below. Any row
-- whose note isn't actually a name (a stray comment, blank, etc.) will
-- otherwise get written verbatim as that account's display_name.
-- ----------------------------------------------------------------------------
select
  ba.email,
  ba.note                            as proposed_display_name,
  p.display_name                     as current_display_name,
  (p.display_name is null)           as would_change
from beta_allowlist ba
join auth.users u on lower(u.email) = lower(ba.email)
left join public.profiles p on p.id = u.id
where ba.note is not null and trim(ba.note) <> ''
order by ba.email;

-- The actual write — matches the preview above exactly (same join, same
-- non-empty-note filter, same "only when currently null" condition).
insert into public.profiles (id, display_name)
select u.id, ba.note
from beta_allowlist ba
join auth.users u on lower(u.email) = lower(ba.email)
where ba.note is not null and trim(ba.note) <> ''
on conflict (id) do update
  set display_name = excluded.display_name
  where public.profiles.display_name is null;

-- ----------------------------------------------------------------------------
-- STEP 5 — Verify everything landed:
-- ----------------------------------------------------------------------------
select
  ba.email,
  u.id is not null                 as has_signed_in,
  p.id is not null                 as has_profile,
  p.display_name,
  coalesce(p.is_admin, false)      as is_admin,
  exists(
    select 1 from tier_toggle_allowlist tta where lower(tta.email) = lower(ba.email)
  )                                 as on_tier_toggle_allowlist
from beta_allowlist ba
left join auth.users u on lower(u.email) = lower(ba.email)
left join public.profiles p on p.id = u.id
order by ba.email;
