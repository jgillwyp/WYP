-- ============================================================================
-- One-time backfill: assign a shared repeat_series_id to existing repeat
-- chains that predate migration 068 (2026-09-23).
--
-- Not a numbered migration — nothing here alters a table (repeat_series_id
-- already exists). This is an operational script, same category as
-- beta-admin-tier-toggle-check.sql and seed-test-attachments.mjs: written
-- for Jim to run himself in the Supabase SQL editor, once, for the small
-- number of private testers who already have a few repeating items.
--
-- Why this is needed: migration 068 deliberately shipped with no backfill
-- (see that migration's own header comment) — any pre-existing repeat chain
-- has repeat_series_id = null on every row, which the "Repeating" chip's
-- own grouping logic (MainScreen.tsx's repeatingHeadIds()) treats as "each
-- row is its own one-row series," falling back to the row's own id. Nothing
-- is broken by that — Repeat generation itself never depended on this
-- column — but the chip shows every individual occurrence of an old chain
-- instead of the one compact "most recent" row it shows for a chain created
-- after the migration.
--
-- Grouping key: owner_id + contact_id + description, among rows that still
-- have repeat_rule is not null and repeat_series_id is null. contact_id is
-- included (not just owner_id + description) so two different Requests
-- sent to different Contacts, or a Request and a ToDo, that happen to share
-- identical description text are never merged into one series by mistake —
-- every row Phase E ever generates from a given chain keeps the same
-- owner_id/contact_id as its predecessor, so this is a reliable, real
-- fingerprint of "the same chain," not a guess.
--
-- What this can still get wrong: if the SAME owner ran two genuinely
-- separate repeat series, sent to the same Contact (or both ToDos), with
-- the exact same Description text, at different points in time (e.g. an
-- earlier fully-archived test batch and a newer one), this would merge them
-- into one series. Given how few testers/items are involved right now, the
-- Preview step below is meant to be read, not skipped — check that the
-- due_date values for each group actually look like one contiguous chain
-- before running the Write step.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — Preview: every group this script would assign a shared id to,
-- with each row's own due_date/repeat_occurrence_index/created_at so you
-- can eyeball whether it's really one chain. Run this first.
-- ----------------------------------------------------------------------------
select
  owner_id,
  contact_id,
  description,
  count(*) as rows_in_group,
  array_agg(due_date order by created_at)                 as due_dates_in_order,
  array_agg(repeat_occurrence_index order by created_at)   as occurrence_indexes_in_order,
  array_agg(id order by created_at)                        as row_ids_in_order
from public.requests
where repeat_rule is not null
  and repeat_series_id is null
group by owner_id, contact_id, description
order by owner_id, contact_id, description;

-- ----------------------------------------------------------------------------
-- STEP 2 — The actual write. Matches Step 1's own grouping exactly (same
-- owner_id/contact_id/description, same repeat_rule/repeat_series_id
-- filter) — generates one fresh id per group and assigns it to every row in
-- that group.
-- ----------------------------------------------------------------------------
with groups as (
  -- Postgres has no built-in min()/max() for uuid (no default ordering
  -- operator class) — (array_agg(... order by ...))[1] picks the
  -- earliest-created row's id per group instead, which is all "anchor_id"
  -- ever needed to be: any single deterministic representative per group to
  -- join the freshly-generated id back against.
  select owner_id, contact_id, description, (array_agg(id order by created_at))[1] as anchor_id
  from public.requests
  where repeat_rule is not null
    and repeat_series_id is null
  group by owner_id, contact_id, description
),
group_ids as (
  select anchor_id, gen_random_uuid() as new_series_id
  from groups
)
update public.requests r
set repeat_series_id = gi.new_series_id
from groups g
join group_ids gi on gi.anchor_id = g.anchor_id
where r.owner_id = g.owner_id
  and r.contact_id is not distinct from g.contact_id
  and r.description = g.description
  and r.repeat_rule is not null
  and r.repeat_series_id is null;

-- ----------------------------------------------------------------------------
-- STEP 3 — Verify: confirm every previously-null-series_id repeating row now
-- has one, grouped the same way, so you can compare against Step 1's own
-- output.
-- ----------------------------------------------------------------------------
select
  owner_id,
  contact_id,
  description,
  repeat_series_id,
  count(*) as rows_in_group,
  array_agg(due_date order by created_at) as due_dates_in_order
from public.requests
where repeat_rule is not null
group by owner_id, contact_id, description, repeat_series_id
order by owner_id, contact_id, description;
