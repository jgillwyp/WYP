-- WYP — Tester Management SQL Snippets (2026-11-03, trimmed 2026-11-25)
--
-- Small, reusable queries worth saving as named Supabase SQL Editor
-- snippets (SQL Editor -> write/paste -> Ctrl+S -> name it as shown below).
--
-- 2026-11-25: Admin > Add Pre-Release Tester, add-tester.mjs/
-- delete-tester.mjs, and pending_tester_setup/provision_pending_testers()
-- were all removed (migration 106). Signup is open, and handle_new_user()
-- (migration 100) adds every new account to beta_allowlist and
-- tier_toggle_allowlist automatically — there is no "add a tester" step
-- anymore. The Force-Run and Add snippets that lived here are gone with it.

-- ============================================================================
-- Snippet name: Check Tester Status
-- Edit the EMAIL on the line below, then run.
-- ============================================================================
select
  v.email,
  exists(select 1 from public.beta_allowlist b where b.email = v.email) as on_beta_allowlist,
  exists(select 1 from public.tier_toggle_allowlist t where t.email = v.email) as can_toggle_subscriber,
  (u.id is not null) as has_account,
  pr.display_name,
  pr.tier,
  pr.time_zone,
  pr.subscription_renewal_date
from (select lower(trim('EMAIL')) as email) v
left join auth.users u on lower(u.email) = v.email
left join public.profiles pr on pr.id = u.id;

-- ============================================================================
-- Snippet name: List All Testers
-- No editing needed — everyone on the allowlist, most recently added first.
-- ============================================================================
select
  b.email,
  b.note,
  b.added_at,
  exists(select 1 from public.tier_toggle_allowlist t where t.email = b.email) as can_toggle_subscriber,
  (u.id is not null) as has_account,
  pr.display_name,
  pr.tier
from public.beta_allowlist b
left join auth.users u on lower(u.email) = b.email
left join public.profiles pr on pr.id = u.id
order by b.added_at desc;

-- ============================================================================
-- Snippet name: Remove Tester Access
-- Edit EMAIL, then run. Removes the Pre-Release Tester extras (Beta cohort,
-- Subscribed? toggle) from one account. Does NOT touch the account or its
-- data. Uncomment the last line to also revert a granted Subscriber tier.
-- ============================================================================
do $$
declare
  v_email text := lower(trim('EMAIL'));
begin
  delete from public.tier_toggle_allowlist where email = v_email;
  delete from public.beta_allowlist where email = v_email;
  -- update public.profiles set tier = 'free'
  --   where id = (select id from auth.users where lower(email) = v_email);
end $$;

-- ============================================================================
-- Snippet name: Orphan Allowlist Rows
-- Allowlist rows with no account behind them (cleaned up 2026-11-25).
-- ============================================================================
select b.email, b.note
from public.beta_allowlist b
where not exists (select 1 from auth.users u where lower(u.email) = b.email)
order by b.email;
