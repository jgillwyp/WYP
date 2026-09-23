
-- ============================================================================
-- Migration 068 (2026-09-23) -- requests.repeat_series_id: lets the
-- "Repeating" chip (Main Screen, 2026-09-18) show the current, active
-- occurrence of a series instead of requiring occurrence_index = 1
-- specifically.
--
-- Owner-reported: a repeat series' original occurrence (occurrence_index 1)
-- can lose its own repeat_rule over time -- either because it was explicitly
-- removed on that specific row, or simply because Phase E's own generation
-- never clears repeat_rule from any row it processes (only ever sets
-- repeat_next_generated_at) -- so occurrence 1 staying the sole anchor was
-- fragile. repeat_series_id is a plain nullable uuid, set once when a repeat
-- is first added to a brand-new occurrence and copied forward onto every
-- occurrence cron Phase E generates from it (app/api/cron/tick/route.ts) --
-- the chip's own filter (MainScreen.tsx) now groups rows by this id and
-- shows, per group, whichever non-archived row currently has the highest
-- repeat_occurrence_index and still carries an active repeat_rule -- "the
-- most recent item in the series," per the owner's own framing, since
-- that's also the row future generation and any Repeat edits should
-- actually be made on.
--
-- No backfill for existing rows -- this is private-testing data only, and a
-- reliable backfill would need a fragile owner+description+due-date-
-- proximity heuristic with no real guarantee of correctness. Existing
-- repeat chains simply read as repeat_series_id = null, which the chip's
-- own grouping already treats as "this row is its own one-row series"
-- (falls back to the row's own id) -- an accepted, flagged limitation for
-- pre-existing test data; every new repeat created going forward gets a
-- real shared id.
-- ============================================================================

alter table public.requests
  add column if not exists repeat_series_id uuid;

comment on column public.requests.repeat_series_id is
  'Shared across every occurrence of one repeat series, set once when Repeat is first added to a brand-new occurrence and copied forward by cron Phase E on each generated successor. Null for a non-repeating row, and for any repeat series created before migration 068 (no backfill -- see this migration''s own header comment).';

-- Verify (superuser, proves creation only):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'requests' and column_name = 'repeat_series_id';
-- ============================================================================
