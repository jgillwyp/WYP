
-- ============================================================================
-- Migration 067 (2026-09-16) -- profiles.todo_time_enabled, mirroring
-- request_time_enabled's identical role for ToDos.
--
-- Owner's own request, with pasted mockup wording: a genuine motivating use
-- case ("taking certain pills") wants a ToDo that carries a real Due Time,
-- feeds Reminders precisely, and can be added to a calendar with a real
-- timed event rather than an all-day one. ToDos have never had Due/Done
-- Time before this -- due_time/done_time already exist on the shared
-- requests table (ToDos are just requests rows with contact_id null), so no
-- new columns are needed for the data itself, only this one gating flag.
--
-- Off by default, unlike request_time_enabled's own history (which
-- defaulted true, then was flipped false by migration 023 once real users
-- existed to worry about hiding data from) -- ToDos have zero existing rows
-- with a meaningful due_time/done_time to protect, so there's no equivalent
-- "existing behavior" to preserve; off-by-default is simply the right
-- starting point for a feature nobody has used yet.
--
-- Follows migration 022's own todo_dates_enabled precedent exactly: gated
-- in the client (AccountForm.tsx disables/greys the checkbox until
-- todo_dates_enabled is on -- there's no Due/Done Date row to attach a Time
-- field to otherwise), not enforced in SQL. This column has no gating
-- relationship to todo_dates_enabled at the database level; a client could
-- theoretically set todo_time_enabled = true with todo_dates_enabled =
-- false, and the app simply wouldn't render anything as a result, the same
-- "harmless, meaningless combination" the request_time_enabled/
-- todo_dates_enabled columns already tolerate elsewhere in this schema.
-- ============================================================================

alter table public.profiles
  add column if not exists todo_time_enabled boolean not null default false;

comment on column public.profiles.todo_time_enabled is
  'Opt-in (default false) -- when todo_dates_enabled is also on, adds Due Time and Done Time fields next to a ToDo''s Due Date and Done Date on Create ToDo/ToDo Detail. Off by default; ToDos never had Due/Done Time before this. See AccountForm.tsx''s "Show Due/Done Time" checkbox.';

grant update (todo_time_enabled) on public.profiles to authenticated;

-- Verify (superuser, proves creation/grant only -- the real check is
-- toggling the checkbox as a signed-in user from the browser):
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_name = 'profiles'
--     and column_name = 'todo_time_enabled'
--     and grantee = 'authenticated';
--        -> should show UPDATE
-- ============================================================================
