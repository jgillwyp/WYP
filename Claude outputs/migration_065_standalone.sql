
-- ============================================================================
-- Migration 065 (2026-09-07) -- Sum and Averages reformat: replaces the
-- Grand-Totals stat-tile block with an Entities table (Accounts, Contacts,
-- Req's Sent, Req's Received, ToDos -- Count Total, Avg Descr char's, and
-- an Open/Overdue/Done/Archived breakdown) and a new Volume table
-- (Dialogs, Attachments -- Count Total and Avg Descr/Size), and simplifies
-- the per-account Roster to Account/Contacts/Req Sent/Req Rec'd/ToDos/
-- Dialogs/Atch's/Avg Atch Size. Per
-- docs/WYP_Admin_Statistics_Specification_v1_0.docx (owner-approved
-- design, 2026-09-07). Percentages and the Volume table's four "average
-- count per" ratios are computed client-side from the raw counts this
-- migration returns (AdminSummaryStatsForm.tsx: pct()/ratio()), not baked
-- into the RPC, so the on-screen table, the print view, and the .xlsx
-- export share one rounding rule instead of three.
--
-- admin_stats_summary_totals() gains full Open/Overdue/Done/Archived raw
-- counts for Req's Sent, Req's Received, AND ToDos. ToDos never had any
-- of this in the totals RPC before, and the roster's own todos_* columns
-- never had an Overdue count either -- even though the main app's ToDos
-- filter chips have supported a real Overdue state since 2026-08-12
-- (ToDos gain an Overdue chip). ToDos Overdue here follows the exact same
-- "not archived, not done, due_date < current_date, and only ever
-- nonzero when p_asof = current_date" rule already used for Requests --
-- this closes a real gap between this screen and actual app behavior,
-- not just a cosmetic addition. (The PRD/UI spec text that still says
-- "Overdue does not apply to ToDos" is a separate, already-flagged
-- documentation correction -- not addressed by this migration.)
--
-- admin_stats_summary_roster() drops display_name (Account is shown as
-- email only, per owner decision) and the entire per-account Open/
-- Overdue/Done/Archived breakdown -- that detail remains available by
-- switching the existing Accounts filter to a specific account, which
-- re-scopes admin_stats_summary_totals() itself to that one account
-- instead of duplicating the breakdown in every roster row.
--
-- Dialogs/Attachments totals keep the pre-existing scope (entries on
-- Requests/ToDos OWNED by the cohort -- not entries on requests the
-- cohort merely received), matching migration 060's own original
-- semantics; this migration does not expand that scope.
--
-- Postgres refuses `create or replace function` when the OUT-parameter
-- row type changes (42P13: "cannot change return type of existing
-- function") -- both functions below change shape from their migration
-- 063 versions, so each needs an explicit drop first. Added after the
-- first run attempt hit exactly this error (owner action, 2026-09-07).
-- ============================================================================

drop function if exists public.admin_stats_summary_totals(date, text, uuid);

create or replace function public.admin_stats_summary_totals(
  p_asof date,
  p_cohort text,
  p_profile_id uuid default null
)
returns table (
  accounts_count bigint,
  contacts_count bigint,

  requests_sent_total bigint,
  requests_sent_open bigint,
  requests_sent_overdue bigint,
  requests_sent_done bigint,
  requests_sent_archived bigint,
  requests_sent_avg_description numeric,

  requests_received_total bigint,
  requests_received_open bigint,
  requests_received_overdue bigint,
  requests_received_done bigint,
  requests_received_archived bigint,
  requests_received_avg_description numeric,

  todos_total bigint,
  todos_open bigint,
  todos_overdue bigint,
  todos_done bigint,
  todos_archived bigint,
  todos_avg_description numeric,

  dialog_total bigint,
  dialog_avg_description numeric,

  attachments_total bigint,
  attachments_avg_size_kb numeric
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_is_admin boolean;
  v_overdue_computable boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Not authorized.';
  end if;
  if p_cohort not in ('all', 'beta', 'profile', 'free', 'subscriber') then
    raise exception 'Invalid cohort.';
  end if;

  v_overdue_computable := (p_asof = current_date);

  return query
  with cohort as (
    select u.id, u.email
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    where p_cohort = 'all'
       or (p_cohort = 'profile' and u.id = p_profile_id)
       or (p_cohort = 'beta' and lower(u.email) in (select lower(ba.email) from public.beta_allowlist ba))
       or (p_cohort = 'free' and coalesce(pr.tier, 'free') = 'free')
       or (p_cohort = 'subscriber' and pr.tier = 'subscriber')
  ),
  sent as (
    select r.* from public.requests r
    where r.owner_id in (select id from cohort)
      and r.contact_id is not null
      and r.created_at::date <= p_asof
  ),
  received as (
    select r.* from public.requests r
    join public.contacts c on c.id = r.contact_id
    where lower(trim(c.email)) in (select lower(email) from cohort)
      and r.created_at::date <= p_asof
  ),
  td as (
    select r.* from public.requests r
    where r.owner_id in (select id from cohort)
      and r.contact_id is null
      and r.created_at::date <= p_asof
  ),
  dlg as (
    select count(*) as n, coalesce(round(avg(length(d.body))), 0) as avg_len
    from public.dialog d
    where d.created_at::date <= p_asof
      and d.request_id in (select id from sent union select id from td)
  ),
  att as (
    select count(*) as n, coalesce(sum(a.size_bytes), 0) as bytes
    from public.attachments a
    where a.created_at::date <= p_asof
      and a.request_id in (select id from sent union select id from td)
  )
  select
    (select count(*) from cohort),
    (select count(*) from public.contacts c
      where c.owner_id in (select id from cohort) and c.created_at::date <= p_asof),

    (select count(*) from sent),
    (select count(*) from sent where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and not (v_overdue_computable and due_date < current_date)),
    (select case when not v_overdue_computable then 0 else count(*) end from sent
       where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and v_overdue_computable and due_date < current_date),
    (select count(*) from sent where done_date is not null and done_date <= p_asof
       and (archived_at is null or archived_at::date > p_asof)),
    (select count(*) from sent where archived_at is not null and archived_at::date <= p_asof),
    (select round(avg(length(description)), 0) from sent),

    (select count(*) from received),
    (select count(*) from received where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and not (v_overdue_computable and due_date < current_date)),
    (select case when not v_overdue_computable then 0 else count(*) end from received
       where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and v_overdue_computable and due_date < current_date),
    (select count(*) from received where done_date is not null and done_date <= p_asof
       and (archived_at is null or archived_at::date > p_asof)),
    (select count(*) from received where archived_at is not null and archived_at::date <= p_asof),
    (select round(avg(length(description)), 0) from received),

    (select count(*) from td),
    (select count(*) from td where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and not (v_overdue_computable and due_date < current_date)),
    (select case when not v_overdue_computable then 0 else count(*) end from td
       where (archived_at is null or archived_at::date > p_asof)
       and (done_date is null or done_date > p_asof)
       and v_overdue_computable and due_date < current_date),
    (select count(*) from td where done_date is not null and done_date <= p_asof
       and (archived_at is null or archived_at::date > p_asof)),
    (select count(*) from td where archived_at is not null and archived_at::date <= p_asof),
    (select round(avg(length(description)), 0) from td),

    (select n from dlg),
    (select avg_len from dlg),

    (select n from att),
    (select case when (select n from att) = 0 then null
       else round((select bytes from att)::numeric / (select n from att) / 1024, 0) end);
end;
$$;

revoke all on function public.admin_stats_summary_totals(date, text, uuid) from public;
grant execute on function public.admin_stats_summary_totals(date, text, uuid) to authenticated;

-- ============================================================================

drop function if exists public.admin_stats_summary_roster(date, text, uuid);

create or replace function public.admin_stats_summary_roster(
  p_asof date,
  p_cohort text,
  p_profile_id uuid default null
)
returns table (
  account_id uuid,
  email text,
  contact_count bigint,
  requests_sent_total bigint,
  requests_received_total bigint,
  todos_total bigint,
  dialog_count bigint,
  attachments_count bigint,
  attachments_avg_size_kb numeric
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Not authorized.';
  end if;
  if p_cohort not in ('all', 'beta', 'profile', 'free', 'subscriber') then
    raise exception 'Invalid cohort.';
  end if;

  return query
  with cohort as (
    select u.id, u.email
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    where p_cohort = 'all'
       or (p_cohort = 'profile' and u.id = p_profile_id)
       or (p_cohort = 'beta' and lower(u.email) in (select lower(ba.email) from public.beta_allowlist ba))
       or (p_cohort = 'free' and coalesce(pr.tier, 'free') = 'free')
       or (p_cohort = 'subscriber' and pr.tier = 'subscriber')
  )
  select
    u.id as account_id,
    u.email::text,

    (select count(*) from public.contacts c
      where c.owner_id = u.id and c.created_at::date <= p_asof),

    (select count(*) from public.requests r
      where r.owner_id = u.id and r.contact_id is not null and r.created_at::date <= p_asof),

    (select count(*) from public.requests r
      join public.contacts c on c.id = r.contact_id
      where lower(trim(c.email)) = lower(u.email) and r.created_at::date <= p_asof),

    (select count(*) from public.requests r
      where r.owner_id = u.id and r.contact_id is null and r.created_at::date <= p_asof),

    (select count(*) from public.dialog d
      join public.requests r on r.id = d.request_id
      where r.owner_id = u.id and d.created_at::date <= p_asof),

    (select count(*) from public.attachments a
      join public.requests r on r.id = a.request_id
      where r.owner_id = u.id and a.created_at::date <= p_asof),
    (select case when count(*) = 0 then null else round(sum(a.size_bytes)::numeric / count(*) / 1024, 0) end
      from public.attachments a join public.requests r on r.id = a.request_id
      where r.owner_id = u.id and a.created_at::date <= p_asof)

  from cohort u
  order by u.email;
end;
$$;

revoke all on function public.admin_stats_summary_roster(date, text, uuid) from public;
grant execute on function public.admin_stats_summary_roster(date, text, uuid) to authenticated;

-- ============================================================================
