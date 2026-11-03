-- WYP — Tester Management SQL Snippets (2026-11-03)
--
-- Five small, reusable queries worth saving as named Supabase SQL Editor
-- snippets (SQL Editor -> write/paste -> Ctrl+S -> name it as shown below
-- -> it then sits in the Editor's own sidebar, one click away, instead of
-- being copy-pasted from this file or scrolled to in the "WeekN - SQL
-- history.txt" migration logs each time).
--
-- These are read-only or clearly-scoped helpers around the tester-
-- provisioning system (migration 087, add-tester.mjs/delete-tester.mjs) —
-- nothing here replaces those two scripts for actually adding or removing
-- a tester; these are for checking status and for the one manual-fallback
-- case (no Node available) of each.

-- ============================================================================
-- Snippet name: Check Tester Status
-- Edit the EMAIL on the line below, then run. Shows everything about one
-- person's current state in one query: whether they're allowlisted, can
-- self-toggle Subscriber, have a queued (not-yet-provisioned) setup row,
-- already have an account, and what their profile currently looks like.
-- ============================================================================
select
  v.email,
  exists(select 1 from public.beta_allowlist b where b.email = v.email) as on_beta_allowlist,
  exists(select 1 from public.tier_toggle_allowlist t where t.email = v.email) as can_toggle_subscriber,
  pts.display_name as queued_display_name,
  pts.grant_subscriber as queued_grant_subscriber,
  pts.provisioned_at as queued_provisioned_at,
  (u.id is not null) as has_account,
  pr.display_name,
  pr.tier,
  pr.time_zone,
  pr.subscription_renewal_date
from (select lower(trim('EMAIL')) as email) v
left join auth.users u on lower(u.email) = v.email
left join public.profiles pr on pr.id = u.id
left join public.pending_tester_setup pts on pts.email = v.email;

-- ============================================================================
-- Snippet name: List All Testers
-- No editing needed — lists everyone on the Private Testing allowlist, most
-- recently added first, with their current account/tier/queue status.
-- ============================================================================
select
  b.email,
  b.note as display_name_note,
  b.added_at,
  exists(select 1 from public.tier_toggle_allowlist t where t.email = b.email) as can_toggle_subscriber,
  (u.id is not null) as has_account,
  pr.display_name,
  pr.tier,
  pts.provisioned_at as queued_provisioned_at
from public.beta_allowlist b
left join auth.users u on lower(u.email) = b.email
left join public.profiles pr on pr.id = u.id
left join public.pending_tester_setup pts on pts.email = b.email
order by b.added_at desc;

-- ============================================================================
-- Snippet name: Force-Run Tester Provisioning
-- No editing needed. Manually runs the same backfill the hourly cron job
-- (Phase F, app/api/cron/tick/route.ts) already runs on its own — useful if
-- you don't want to wait up to an hour after someone's first sign-in.
-- Returns the number of testers it just finished provisioning.
-- ============================================================================
select public.provision_pending_testers();

-- ============================================================================
-- Snippet name: Add Private Tester (manual fallback)
-- Edit EMAIL/NAME/v_renewal_date, then run. Same as docs/add-private-
-- tester.sql / add-tester.mjs's "before sign-up" half — use this only if
-- add-tester.mjs isn't available (no Node on hand). Grants Subscriber tier
-- directly rather than only unlocking the checkbox, matching add-tester.mjs's
-- own default. Safe to re-run.
-- ============================================================================
do $$
declare
  v_email text := lower(trim('EMAIL'));
  v_display_name text := 'NAME';
  v_renewal_date date := current_date + interval '1 year';
begin
  insert into public.beta_allowlist (email, note)
    values (v_email, v_display_name)
    on conflict (email) do nothing;

  insert into public.tier_toggle_allowlist (email, note)
    values (v_email, 'Private tester — added via SQL Editor snippet')
    on conflict (email) do nothing;

  update public.profiles
    set display_name = v_display_name,
        tier = 'subscriber',
        subscription_renewal_date = v_renewal_date
    where id = (select id from auth.users where lower(email) = v_email);
end $$;

-- ============================================================================
-- Snippet name: Remove Private Tester (manual fallback)
-- Edit EMAIL, then run. Same as docs/delete-tester.mjs — use this only if
-- add-tester.mjs/delete-tester.mjs aren't available. Does NOT touch the
-- person's account or data. Uncomment the last line to also revert an
-- already-granted Subscriber tier back to Free (off by default, same
-- reasoning delete-tester.mjs's own prompt uses).
-- ============================================================================
do $$
declare
  v_email text := lower(trim('EMAIL'));
begin
  delete from public.pending_tester_setup where email = v_email;
  delete from public.tier_toggle_allowlist where email = v_email;
  delete from public.beta_allowlist where email = v_email;
  -- update public.profiles set tier = 'free'
  --   where id = (select id from auth.users where lower(email) = v_email);
end $$;
