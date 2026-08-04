-- ============================================================================
-- WYP migration 002 — profiles, contacts policies, contact→user link, events
-- 2026-08-03
--
-- Run in the Supabase SQL editor, then append a note to "docs/SQL history .txt".
--
-- REMINDER: the SQL editor runs as superuser and bypasses RLS entirely. Nothing
-- below is verified by succeeding here. Test the policies as `anon` or from the
-- browser before believing them.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. profiles — app-visible user data, one row per auth.users row
--
-- auth.users is Supabase's and already enforces unique email. profiles holds
-- what the app shows and what recipients see. Kept separate because auth.users
-- cannot take arbitrary columns and must not be written to directly.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  first_name    text,
  last_name     text,
  phone         text,
  tier          text        not null default 'free'
                            check (tier in ('free', 'subscriber')),
  notify_by     text        not null default 'email'
                            check (notify_by in ('email', 'text')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.tier is
  'Read live. Gates ADDING attachments and text delivery; never gates viewing. Writable only by service_role - see the column grants below.';

comment on column public.profiles.display_name is
  'Recipients see this on every request. NULL means account setup is incomplete, which is how /auth/callback decides whether to route to Create my Free Account.';

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy. Deleting a profile means deleting the account, which
-- cascades from auth.users.

-- CRITICAL: RLS controls which ROWS you may update, not which COLUMNS. Without
-- the grants below, "update own profile" lets any free user set
-- tier = 'subscriber' on themselves. Column grants are the fix.
revoke update on public.profiles from authenticated;
grant  update (display_name, first_name, last_name, phone, notify_by)
  on public.profiles to authenticated;
-- tier is therefore writable only by service_role (the billing webhook, later).

-- ----------------------------------------------------------------------------
-- 2. Auto-create a stub profile when an account is created
--
-- signInWithOtp creates the auth.users row; this guarantees a matching profile
-- exists immediately, so nothing has to cope with a user that owns no profile.
--
-- NOTE this changes the first-run test. "Does a profile row exist?" is now
-- always true. The test for a new user is `display_name is null`.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at honest
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. contacts — the missing policies
--
-- contacts had only an INSERT policy, so reads returned zero rows with no
-- error. RLS on with no matching policy denies; that is the whole bug.
-- ----------------------------------------------------------------------------
drop policy if exists "contacts: owners select own" on public.contacts;
create policy "contacts: owners select own"
  on public.contacts for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "contacts: owners update own" on public.contacts;
create policy "contacts: owners update own"
  on public.contacts for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "contacts: owners delete own" on public.contacts;
create policy "contacts: owners delete own"
  on public.contacts for delete to authenticated
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. contacts → users link
--
-- A contact row is per-owner by design: the same person added by three users is
-- three rows, which is what keeps nicknames independent. linked_user_id records
-- that this contact is also an account holder, so a recipient who is signed in
-- can be recognised instead of arriving through a token link.
--
-- Added now while unused, because backfilling it later means matching on
-- historical email addresses after people have changed them.
-- ----------------------------------------------------------------------------
alter table public.contacts
  add column if not exists linked_user_id uuid
    references auth.users (id) on delete set null;

create index if not exists contacts_owner_idx       on public.contacts (owner_id);
create index if not exists contacts_linked_user_idx on public.contacts (linked_user_id);

-- Optional, not applied. One owner listing the same address twice is usually a
-- mistake, but it is a judgement call and it would reject existing rows.
--   create unique index contacts_owner_email_uniq
--     on public.contacts (owner_id, lower(email));

-- ----------------------------------------------------------------------------
-- 5. events — append-only audit log
--
-- "All actions timestamped and logged, visible per request." Mutable rows
-- cannot satisfy that: a subscriber editing a dialog entry would destroy what
-- it previously said. Every state change is written here as a fact.
--
-- Nothing writes here from the browser. SECURITY DEFINER functions do the write
-- alongside the change itself, so a request cannot be modified without leaving
-- a trace.
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id            bigint      generated always as identity primary key,
  at            timestamptz not null default now(),

  actor_user    uuid        references auth.users (id) on delete set null,
  actor_label   text,        -- recipient name for unauthenticated actors

  subject_type  text        not null
                            check (subject_type in
                              ('request', 'todo', 'contact', 'profile',
                               'dialog', 'attachment', 'link')),
  subject_id    uuid        not null,
  request_id    uuid,        -- denormalised: "this request's log" is one index

  action        text        not null,
  detail        jsonb       not null default '{}'::jsonb
);

comment on table public.events is
  'Append-only. No UPDATE or DELETE is granted to any client role. Written only by SECURITY DEFINER functions, in the same transaction as the change.';

create index if not exists events_request_idx on public.events (request_id, at desc);
create index if not exists events_subject_idx on public.events (subject_type, subject_id, at desc);
create index if not exists events_actor_idx   on public.events (actor_user, at desc);

alter table public.events enable row level security;

-- Deny everything to client roles for now. Supabase grants table privileges to
-- anon/authenticated by default, so this must be explicit.
revoke all on public.events from anon, authenticated;

-- No policies yet on purpose: the read policy is "the owner of the request this
-- event belongs to", and `requests` does not exist until migration 003. RLS is
-- enabled with no policy, so the table denies everything until then — the safe
-- resting state.

commit;

-- ============================================================================
-- VERIFICATION
--
-- Running the checks in the SQL editor and seeing them pass proves nothing.
-- That connection is a SUPERUSER: it ignores RLS and it ignores column grants.
-- auth.uid() is also NULL there, because there is no JWT, so any policy or
-- predicate written as `= auth.uid()` matches zero rows and every statement
-- "succeeds" without touching anything.
--
-- ---------------------------------------------------------------------------
-- A. Prove the CONFIGURATION. Safe in the SQL editor, because these read the
--    catalog rather than relying on enforcement.
-- ---------------------------------------------------------------------------

-- Which columns may `authenticated` update? tier must NOT appear.
select column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and grantee      = 'authenticated'
  and privilege_type = 'UPDATE'
order by column_name;

-- Every policy on the three tables, and which command each covers.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'contacts', 'events')
order by tablename, cmd, policyname;

-- RLS actually on?  rowsecurity must be true for all three.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles', 'contacts', 'events');

-- ---------------------------------------------------------------------------
-- B. Prove the ENFORCEMENT by impersonating a real client. Still the SQL
--    editor, but as the `authenticated` role with a JWT claim in place.
--    Wrapped in a transaction that is rolled back, so nothing persists.
--    Substitute a real user id for <USER_UUID>.
-- ---------------------------------------------------------------------------

-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<USER_UUID>","role":"authenticated"}';
--
--   select auth.uid();                 -- must return <USER_UUID>, not null
--
--   update profiles set display_name = 'test' where id = auth.uid();
--                                      -- must SUCCEED (1 row)
--
--   update profiles set tier = 'subscriber' where id = auth.uid();
--                                      -- must FAIL: permission denied for
--                                      -- column tier of relation profiles
-- rollback;

-- If that UPDATE succeeds, the column grants did not take and the live-tier
-- design is unsound. Re-run the revoke/grant pair and check query A again.

-- ---------------------------------------------------------------------------
-- C. Prove it end to end from the browser, signed in, with the anon key.
-- ---------------------------------------------------------------------------
--
--   await supabase.from('profiles').update({ tier: 'subscriber' })
--                 .eq('id', (await supabase.auth.getUser()).data.user.id)
--                 .select()
--        -> error, code 42501, "permission denied for column tier"
--
--   await supabase.from('contacts').select('*')
--        -> only rows owned by the signed-in user
--
--   await supabase.from('events').select('*')
--        -> permission denied, or zero rows
--
-- Then sign in as a second account: it must see none of the first account's
-- contacts.
-- ============================================================================
