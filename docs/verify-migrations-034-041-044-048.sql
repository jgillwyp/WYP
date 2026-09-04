-- Would You Please: verify migrations 034 / 041 / 044 / 048 actually ran
-- ---------------------------------------------------------------------
-- Written 2026-09-04. Supabase's own SQL Editor History view has been
-- truncating (reported at 1,600 lines, was previously above 3,000), so it
-- can no longer be trusted to confirm these four migrations were run —
-- this checks the database's own catalogs directly instead, the same way
-- the 2026-08-12 migration-013 investigation did.
--
-- Run this whole block once in the Supabase SQL editor (as yourself /
-- postgres — this is read-only schema introspection via
-- information_schema/pg_catalog, not a data-access test, so running as
-- superuser is fine here, unlike testing an RLS policy). Every row should
-- read OK. Any row reading MISSING / NEEDS ATTENTION means that migration
-- (or part of it) never actually ran, and the feature it backs will likely
-- error the first time a tester touches it.

with checks as (

  -- Migration 034 — contacts.phone_ext (Ext. field on Add Contact / Contact Detail)
  select 'migration 034: contacts.phone_ext column exists' as check_name,
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'contacts' and column_name = 'phone_ext'
         ) as ok

  union all
  select 'migration 034: authenticated can UPDATE contacts.phone_ext',
         exists (
           select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'contacts'
             and column_name = 'phone_ext' and grantee = 'authenticated' and privilege_type = 'UPDATE'
         )

  -- Migration 041 — profiles.todo_reminders_enabled (Account Options: Add Reminders (ToDos))
  union all
  select 'migration 041: profiles.todo_reminders_enabled column exists',
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'todo_reminders_enabled'
         )

  union all
  select 'migration 041: authenticated can UPDATE profiles.todo_reminders_enabled',
         exists (
           select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'profiles'
             and column_name = 'todo_reminders_enabled' and grantee = 'authenticated' and privilege_type = 'UPDATE'
         )

  -- Migration 044 — Account Options restructure (8 new profiles columns +
  -- function updates), and the old shared reminder-default trio it replaced
  union all
  select 'migration 044: profiles.request_reminders_enabled column exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'request_reminders_enabled')

  union all
  select 'migration 044: profiles.always_show_send_reminder column exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'always_show_send_reminder')

  union all
  select 'migration 044: profiles.request_reminder_default_day_before exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'request_reminder_default_day_before')

  union all
  select 'migration 044: profiles.request_reminder_default_day_of exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'request_reminder_default_day_of')

  union all
  select 'migration 044: profiles.request_reminder_default_day_after exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'request_reminder_default_day_after')

  union all
  select 'migration 044: profiles.todo_reminder_default_day_before exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'todo_reminder_default_day_before')

  union all
  select 'migration 044: profiles.todo_reminder_default_day_of exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'todo_reminder_default_day_of')

  union all
  select 'migration 044: profiles.todo_reminder_default_day_after exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'todo_reminder_default_day_after')

  union all
  select 'migration 044: old shared profiles.reminder_default_day_before was dropped',
         not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'reminder_default_day_before')

  union all
  select 'migration 044: old shared profiles.reminder_default_day_of was dropped',
         not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'reminder_default_day_of')

  union all
  select 'migration 044: old shared profiles.reminder_default_day_after was dropped',
         not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'reminder_default_day_after')

  union all
  select 'migration 044: authenticated can UPDATE profiles.request_reminders_enabled',
         exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and column_name = 'request_reminders_enabled' and grantee = 'authenticated' and privilege_type = 'UPDATE')

  union all
  select 'migration 044: authenticated can UPDATE profiles.always_show_send_reminder',
         exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and column_name = 'always_show_send_reminder' and grantee = 'authenticated' and privilege_type = 'UPDATE')

  union all
  select 'migration 044: authenticated can UPDATE all 6 reminder-default columns',
         (select count(*) from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'profiles'
              and column_name in (
                'request_reminder_default_day_before', 'request_reminder_default_day_of', 'request_reminder_default_day_after',
                'todo_reminder_default_day_before', 'todo_reminder_default_day_of', 'todo_reminder_default_day_after'
              )
              and grantee = 'authenticated' and privilege_type = 'UPDATE') = 6

  union all
  select 'migration 044: get_request_by_token() returns owner_request_reminders_enabled',
         exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_request_by_token'
             and pg_get_functiondef(p.oid) ilike '%owner_request_reminders_enabled%'
         )

  union all
  select 'migration 044: get_received_request() returns owner_request_reminders_enabled',
         exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_received_request'
             and pg_get_functiondef(p.oid) ilike '%owner_request_reminders_enabled%'
         )

  -- Migration 048 — Locations-to-Description merge + retirement of kind='reference'.
  -- This one is a DATA migration, not a schema change, so it has no column
  -- to check for existence. The best available signal: no attachments row
  -- should still be sitting at kind='reference' afterward (the migration
  -- both rewrites them into the parent's own description and deletes the
  -- row). Caveat: this reads OK either way if you never had any ToDo
  -- Locations to begin with, so treat a MISSING here as a real red flag,
  -- but don't treat OK alone as ironclad proof this migration ran.
  union all
  select 'migration 048: no attachments rows still using the retired kind=''reference''',
         not exists (select 1 from public.attachments where kind = 'reference')

)
select check_name,
       case when ok then 'OK' else 'MISSING / NEEDS ATTENTION' end as status
from checks
order by check_name;
