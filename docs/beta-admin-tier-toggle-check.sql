-- ============================================================================
-- Beta allowlist / profiles / tier_toggle_allowlist / is_admin — private
-- tester setup and diagnostic script.
--
-- Not a numbered migration — nothing here alters a table (is_admin, migration
-- 053, and tier_toggle_allowlist, migration 035, already exist). This is an
-- operational script, same category as verify-migrations-034-041-044-048.sql
-- and seed-test-attachments.mjs: written for Jim to run himself in the
-- Supabase SQL editor, re-runnable any time a new participant needs adding
-- or checking. Reorganized 2026-09-16 around Jim's own before/after-sign-in
-- shorthand (previously ordered as five numbered steps) — same statements,
-- grouped by when each one is actually usable rather than by number.
--
-- Four separate, deliberately-independent permissions this script touches:
--   - beta_allowlist        — may this NEW email sign up at all (migration 015)
--   - tier_toggle_allowlist — may this signed-in account self-grant Subscriber
--                             for testing, i.e. see the "Subscribed?" checkbox
--                             (migration 035)
--   - profiles.is_admin     — may this account see cross-account Statistics
--                             aggregates (migration 053)
--   - profiles.display_name — normally typed by the tester themselves on
--                             Create Free Account; the fallback section at
--                             the bottom bulk-fills it from beta_allowlist.note
--                             for anyone who didn't.
--
-- None of these imply each other. beta_allowlist membership does not create a
-- profiles row (that happens automatically, via the on_auth_user_created
-- trigger, the moment someone actually completes their first magic-link
-- sign-in) and does not grant tier_toggle_allowlist or is_admin — both of
-- those are separate, smaller, hand-managed lists on purpose. A tester who
-- needs the "Subscribed?" checkbox has to be added to tier_toggle_allowlist
-- explicitly, even though beta_allowlist alone is enough to let them sign in
-- at all — this is the gap that produced a real "missing checkbox" report
-- from a tester who was never added to tier_toggle_allowlist.
--
-- Timing note: tier_toggle_allowlist needs no profiles row at all (can_
-- toggle_tier() reads only auth.users and this table) and is_admin only
-- needs a profiles row, created at first sign-in — before Create Free
-- Account is ever reached. "AFTER ADD FREE ACCOUNT" below is a safe,
-- easy-to-remember threshold (by then the row always exists), not the
-- strict minimum — both can be run as soon as you know a tester has signed
-- in once, even if they haven't finished Create Free Account yet.
-- ============================================================================

-- BEFORE ADD FREE ACCOUNT ====================================================

-- ADD PRIVATE TESTER
-- Lets this new email sign up at all (migration 015's gate). Run this first,
-- before the person ever tries to sign in.
--------------------------------------------------------------------------------------------
insert into beta_allowlist (email, note) values ('EMAIL', 'NAME');


-- AFTER ADD FREE ACCOUNT =====================================================

-- ADD SUBSCRIBER CHECKBOX
-- Grants the "Subscribed?" self-toggle on Account Options/Subscription
-- (testing only) — without this, the checkbox simply doesn't render, even
-- for a tester who doesn't need is_admin.
--------------------------------------------------------------------------------------------
insert into tier_toggle_allowlist (email, note) values
  ('EMAIL', 'testing Attachments/Subscriber features')
on conflict (email) do nothing;

-- Confirm the gate itself is still on (default true) — if it were ever
-- switched off, everyone signed in already sees the checkbox regardless of
-- this table:
--   select value from app_settings where key = 'tier_toggle_gate_enabled';

-- ADD STATISTICS CHIP
-- Grants is_admin (cross-account Statistics aggregates) — a bigger grant
-- than either list above, so add it individually and deliberately, not for
-- everyone on beta_allowlist.
--------------------------------------------------------------------------------------------
update public.profiles set is_admin = true
where id = (select id from auth.users where lower(email) = lower('EMAIL'));

-- VERIFY TESTER SETUPS
-- Summary view: has this tester signed in, do they have a profile, what's
-- their name, and which of the two extra grants (is_admin, tier_toggle_
-- allowlist) do they actually have.
--------------------------------------------------------------------------------------------
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

-- VERIFY KEYS/TABLES
-- Raw diagnostic view of the actual join keys — useful when the summary
-- above shows something unexpected and you need to see exactly where a row
-- is null (never signed in vs. signed in but no profile, etc.).
-------------------------------------------------------------------------------------------
select
  ba.email,
  u.id                              as auth_user_id,      -- null = never signed in yet; nothing to fix, will appear on their own first sign-in
  p.id                              as profiles_row,       -- null with auth_user_id set = a genuine gap, see "IF PROFILES ROW IS MISSING" below
  p.is_admin,
  exists(
    select 1 from tier_toggle_allowlist tta where lower(tta.email) = lower(ba.email)
  )                                 as on_tier_toggle_allowlist
from beta_allowlist ba
left join auth.users u on lower(u.email) = lower(ba.email)
left join public.profiles p on p.id = u.id
order by ba.email;


-- IF PRIVATE TESTER DID NOT ADD THEIR OWN NAME ===============================
-- Bulk-populate profiles.display_name from beta_allowlist.note, where
-- that's where Jim has been entering each participant's actual name. Only
-- needed as a fallback — normally a tester types their own name on Create
-- Free Account and this section can be skipped entirely. Requires the
-- tester to have signed in at least once (join against auth.users) —
-- anyone who hasn't yet is simply skipped and will need this re-run once
-- they do.
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
--------------------------------------------------------------------------------------------
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


-- IF PROFILES ROW IS MISSING (rare) ==========================================
-- Backfill a stub profiles row — should only ever be needed if the on_auth_
-- user_created trigger (migration 014) somehow didn't fire for someone who
-- has definitely signed in (auth_user_id set but profiles_row null in the
-- diagnostic above). Safe to run even if no such row exists; on conflict
-- makes it a no-op.
--------------------------------------------------------------------------------------------
insert into public.profiles (id)
select u.id
from auth.users u
where lower(u.email) = lower('EMAIL')
on conflict (id) do nothing;
