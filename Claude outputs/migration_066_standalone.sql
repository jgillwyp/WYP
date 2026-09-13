-- ============================================================================
-- Migration 066 (2026-09-13) -- fixes a real grant bug on
-- profiles.reminder_digest_enabled (migration 032, 2026-08-17) and adds
-- profiles.notify_owner_on_done, gating the new "Notify Me When Requests
-- Are Marked Done" Account Option checkbox.
--
-- Bug: migration 032 added reminder_digest_enabled with no accompanying
-- `grant update (reminder_digest_enabled) on profiles to authenticated` --
-- the same class of gap this file has already hit and fixed twice before
-- (migration 013's time_zone grant; migration 007's own column predating
-- its later-added companion). AccountForm.tsx's handleToggle() does a
-- plain client-side `.from('profiles').update(...)`, so every attempt to
-- flip "Notify Me When Reminders Are Sent" has been failing with
-- "permission denied for table profiles" since the day it shipped (SELECT
-- was unaffected, which is what masked it -- same masking pattern
-- migration 013's own header comment already documented for time_zone).
--
-- New feature: profiles.notify_owner_on_done -- gates a per-event email to
-- the Requester/owner whenever one of their Sent
-- Requests is marked Done by its Recipient (send-request-update-to-owner/
-- route.ts, the recipient-to-owner direction of the 2026-09-02 change-
-- notification feature). Default true ("On by default," Jim's own
-- wording). Two things this setting deliberately does NOT do, per Jim's
-- own review of the first draft: (1) it never gates the owner-to-Recipient
-- direction (send-request-update/route.ts) -- when the owner themselves
-- marks a Request Done via Request Detail, the Recipient is always
-- notified, unconditionally, same as every other owner-side edit; (2) even
-- when this setting is on, the notification is still suppressed if the
-- person marking the Request Done IS the owner's own account (a self-sent
-- Request, marked Done via the signed-in-recipient screen on their own
-- Request) -- notifying someone about their own action is never useful
-- regardless of the toggle. Both exceptions are enforced in
-- send-request-update-to-owner/route.ts itself, not in SQL -- this
-- migration only adds the column and its column-level grant.
-- ============================================================================

-- Fix: the missing grant migration 032 should have included.
grant update (reminder_digest_enabled) on public.profiles to authenticated;

alter table public.profiles
  add column if not exists notify_owner_on_done boolean not null default true;

comment on column public.profiles.notify_owner_on_done is
  'Opt-in (default true) -- email the owner/Requester when a Recipient marks one of the owner''s own Sent Requests Done, via send-request-update-to-owner/route.ts. Suppressed regardless of this flag when the actor marking it Done is the owner''s own account (a self-sent Request marked Done via the signed-in-recipient screen) -- see that route''s own header comment.';

grant update (notify_owner_on_done) on public.profiles to authenticated;

-- Verify (superuser, proves creation/grants only -- the real check is
-- calling AccountForm.tsx's own toggle as a signed-in user from the
-- browser):
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_name = 'profiles'
--     and column_name in ('reminder_digest_enabled', 'notify_owner_on_done')
--     and grantee = 'authenticated';
--        -> both rows should show UPDATE
-- ============================================================================
