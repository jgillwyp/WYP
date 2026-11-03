-- Add a Private Tester — consolidated, 2026-09-30.
-- Replaces the four separate statements Jim ran by hand each time (ADD
-- PRIVATE TESTER / ADD SUBSCRIBER CHECKBOX / ADD NAME / ADD A VALID
-- SUBSCRIPTION EXPIRATION DATE). Edit the three variables below, then run
-- the whole block.
--
-- SUPERSEDED as the primary path, 2026-11-03 (migration 087) — docs/
-- add-tester.mjs now does this interactively (prompts instead of editing
-- SQL variables) and automatically finishes the "after sign-up" half via
-- the hourly cron job, instead of needing this file run a second time by
-- hand. This file is kept as a manual fallback (e.g. if Node isn't
-- available) — still fully correct, just no longer the first choice.
--
-- v_renewal_date is a small addition beyond what was literally asked for
-- (only Display Name and Email were requested as variables) — folded in
-- since it was already part of the same four-statement routine and costs
-- nothing to parameterize alongside the other two. Defaults to one year
-- from today; override it to a specific date if needed.
--
-- Safe to re-run: beta_allowlist's insert now has its own ON CONFLICT
-- (matching tier_toggle_allowlist's, which already had one) — re-running
-- for an email already on the list is a no-op there instead of an error.
-- The two profiles UPDATEs are plain updates and were always safe to
-- re-run. If the person hasn't signed in yet, the two profiles UPDATEs
-- affect zero rows (there is no profiles row yet) — re-run this script
-- after their first sign-in to set Display Name/Renewal Date for real.

do $$
declare
  v_email text := 'EMAIL';
  v_display_name text := 'NAME';
  v_renewal_date date := current_date + interval '1 year';
begin
  v_email := lower(trim(v_email));

  -- ADD PRIVATE TESTER
  insert into public.beta_allowlist (email, note)
    values (v_email, v_display_name)
    on conflict (email) do nothing;

  -- ADD SUBSCRIBER CHECKBOX
  insert into public.tier_toggle_allowlist (email, note)
    values (v_email, 'testing Attachments/Subscriber features')
    on conflict (email) do nothing;

  -- ADD NAME
  update public.profiles set display_name = v_display_name
    where id = (select id from auth.users where lower(email) = v_email);

  -- ADD A VALID SUBSCRIPTION EXPIRATION DATE
  update public.profiles set subscription_renewal_date = v_renewal_date
    where id = (select id from auth.users where lower(email) = v_email);
end $$;

-- Verify:
--   select * from public.beta_allowlist where email = lower('EMAIL');
--   select * from public.tier_toggle_allowlist where email = lower('EMAIL');
--   select display_name, subscription_renewal_date from public.profiles
--     where id = (select id from auth.users where lower(email) = lower('EMAIL'));
