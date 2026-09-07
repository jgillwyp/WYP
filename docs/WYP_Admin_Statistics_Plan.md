# Would You Please — Admin Statistics Plan

## Goal

A `/admin`-style set of screens, visible only to designated accounts, for
tracking utilization: how many Contacts/Requests/ToDos get created, changed,
completed, archived, and deleted, and what the current base looks like in
aggregate. Nothing here is customer-facing; it exists so you can see how the
app is actually being used during Private Testing (and later).

## Access

**Recommendation: a single `profiles.is_admin boolean not null default
false` column**, set only by you via direct SQL — not a new allowlist table.
This repo already made this call once: migration 051 explicitly reused the
`tier_toggle_allowlist` gate "rather than standing up a third parallel
allowlist table, since both are the same shape of concern." A boolean column
handles "one or more designated profiles" fine — any number of rows can have
it true — and needs no new table, RLS policy, or admin UI to manage.

Housekeeping (`MainScreen.tsx`) gains a third chip — **Statistics**, next to
Tasks and Help — rendered only when the signed-in profile's `is_admin` is
true. It lists four `.hkrow` nav rows, matching the existing Contacts /
Account Options / Storage Management rows exactly: **Contacts**,
**Requests**, **ToDos**, **Sum and Averages**.

The chip's visibility is UX only. Every aggregate-query RPC re-checks
`is_admin` server-side before returning anything cross-account — the same
"never trust that the client already checked" posture `can_toggle_tier()`
already established — so a hidden chip is not the real security boundary.

## Data foundation: extending `events`, not inventing a parallel log

`public.events` already exists (migration 002) — append-only, written only
by `SECURITY DEFINER` functions, `subject_type` / `action` / `at` / `detail
jsonb`. It's live and actively used today, but only for the recipient/secure-
link side (viewed, responded, dialog-by-recipient, archived/revoked). It does
**not** currently log: a Contact being added or deleted, a ToDo being
created or completed, or an owner-side Request being created, edited, marked
Done, archived, or unarchived.

Both Contact deletion (`delete-cascade/route.ts`) and Request/ToDo deletion
(`delete-many/route.ts`, the Archive screen's Delete action) are **genuine
hard deletes** — the row is gone, not soft-flagged. That means:

- Any query that reconstructs "Added"/"Created" by scanning the *current*
  table silently undercounts anything since deleted.
- "Deleted" cannot be reconstructed at all for anything already gone before
  logging exists.

**Decision (confirmed): no retroactive estimation.** Weeks/months before the
relevant event type starts being logged show blank for that metric, not an
approximate or "quietly wrong" number. Once instrumentation lands, every
number from that point forward is exact.

Per-metric instrumentation, in order of how much new code each needs:

- **Cheapest — one more `events` insert in code that already runs
  server-side:** Contact deleted (`delete-cascade/route.ts`); Request/ToDo
  deleted (`delete-many/route.ts`); Request/ToDo "changed" (the two existing
  `send-request-update` / `send-request-update-to-owner` routes — see
  below); Request/ToDo Done (wherever `done_date` is set); ToDo created;
  Contact created.
- **New, but small — no existing route to extend:** Archive / Unarchive.
  Today `ArchiveForm.tsx` does a plain client-side
  `.update({ archived_at })` directly against `requests` under normal RLS —
  there is no server code path at all to hook a log write into. This needs
  a small `SECURITY DEFINER` function (or thin API route) that does the
  update and writes the event together, replacing that plain client update.
  Flagged explicitly: this is genuinely more work than the others, which are
  one added line inside code that already exists.

**"Changed" definition (confirmed):** one `events` row per change-
notification actually sent, regardless of how many fields changed in that
edit — not a per-field diff, not a count tied to `updated_at`. This maps
directly onto the existing `CHANGED_FIELD_LABELS` vocabulary already used by
the "UPDATED:" email feature (`app/src/lib/email.ts`): Due Date, Due Time,
Description, Category, Done Date, Done Time, Dialog, Attachments. Log the
event from inside `send-request-update/route.ts` (owner edits → recipient
notified) and `send-request-update-to-owner/route.ts` (recipient edits →
owner notified), with the triggering field list captured in `detail`.

**Known, permanent limitation — Overdue.** Open, Done, and Archived can be
reconstructed for a past date from stored timestamps (`done_date`,
`archived_at`). Overdue cannot: it's derived from `due_date`/`due_time`
compared against the clock, and due dates can be edited after the fact, so
"Overdue as of last month" would silently mean "today's due dates, evaluated
as if it were last month" — not what was actually true then. **Overdue
stays a today-only figure, never trended historically**, even though the
other three statuses could be.

## Screens

Four per-entity **Activity** screens (Contacts, Requests, ToDos, Accounts)
plus one cross-entity **Sum and Averages** screen. Every screen shares a
From/To month range and a Weekly (Sun–Sat) vs. Monthly granularity toggle.
Four of the five screens (Contacts, Requests, ToDos, Sum and Averages) also
share the same five-value cohort filter (All accounts / Beta allowlist /
Free accounts / Subscribed accounts / one specific profile) — one filter
dimension applied consistently, not a separate drill-down mode per screen.
When the cohort narrows to one profile, any "average per user" figure
collapses to a no-op (average of one) and is suppressed in favor of just the
total. Everywhere else, "average per user" divides by **every account in
the selected cohort**, including ones with zero activity in scope — not
just accounts with at least one item — so a growing, mostly-inactive test
base pulls the average down rather than being silently excluded. The
Accounts screen narrows this to just All accounts / Beta allowlist (see
below) since the other three values are either redundant with or
meaningless for a "new accounts per period" metric.

### Contacts — Activity

Per period (week or month): **Added**, **Deleted**, **Added − Deleted**
(one diverging bar — net change, positive/negative around a zero baseline),
**With Phone**, **With Notes**, **Total** (cumulative running total —
rendered as a line, since it's inherently a running stock, not a per-period
count, unlike everything else on this screen).

### Requests — Activity

Per period: **Created**, **Changed** (see definition above), **Done**,
**Deleted**, **Created − Deleted** (diverging net), **Archived**,
**Unarchived**, **Archived − Unarchived** (diverging net), **Attachments**
(count), **Dialog** (count). Avg Attachment size moves to Sum and Averages
(see below), per the 2026-09-07 revision. A **Sent / Received** toggle or
split applies to the metrics that have both sides (Created, Changed, Done,
Attachments, Dialog) — Received matched by the same recipient-matching logic
`get_received_requests()` already uses, since "Received" isn't a stored
column. Archived/Unarchived/Deleted are **Sent-only** — Received items
aren't owned by this account, so there's nothing to archive or delete from
that side.

### ToDos — Activity

Same shape as Requests, minus the Sent/Received split (no recipient exists):
**Created**, **Changed**, **Done**, **Deleted**, **Created − Deleted**
(diverging net), **Archived**, **Unarchived**, **Archived − Unarchived**
(diverging net), **Attachments**, **Dialog**.

### Accounts — Activity

Per period (week or month): **New Free**, **New Subscribed**, **Total**
(New Free + New Subscribed for the period — rendered as a bar, not a line,
since unlike Contacts' Total this is a per-period count, not a cumulative
running stock). Cohort is narrowed to **All accounts / Beta allowlist**
only — Free/Subscribed as a cohort filter would be redundant with the
screen's own New Free/New Subscribed columns, and "one specific profile" is
degenerate for a screen whose entire subject is the rate of new accounts
being created. Reads directly from `auth.users.created_at` (joined to
`profiles.tier` for the Free/Subscribed split) with **no dependency on
`events`**, unlike the other three Activity screens — accounts have no
delete path in this app, so there's no undercount risk from a live table
scan. Same tier-history limitation as the Free/Subscribed cohort filter
elsewhere (`profiles.tier` has no history, only a current value): an
account counted as "New Subscribed" in the period it was created stays
counted there even if it later changes tier — the metric reflects tier at
the time of read, not tier at the time of signup, for periods other than
the very latest.

### Sum and Averages

Two layers, per the 2026-09-07 revision:

**Grand totals** (KPI tile row, cohort-wide, as of the selected To-date):
User count total; Requests total count; Dialog total count; average Dialog
per Request; average Dialog per ToDo; Attachments total count and total
size; average Request Description size; ToDos total count and average
Description size.

**Per-user roster** (one table row per account): Contact count; Requests
Sent total (+ status-chip split: Open/Overdue/Done/Archived); Requests
Received total (+ status-chip split); Dialog count; Attachments count and
average size; ToDos total (+ status-chip split: Open/Done/Archived — no
Overdue, per the app's own terminology rule).

## Chart treatment

Per period-bucketed metric: a single-hue bar chart (sequential color job —
one hue, more-is-darker is not needed here since it's one series, just one
accent color), one metric per row, stacked vertically, all sharing one
horizontal period axis, scrolled in sync — small multiples, not one combo
chart, because the metrics live on incompatible scales (counts vs. KB) and
combining them would mean a banned dual-axis chart. The Added/Deleted and
Archived/Unarchived pairs each also get one diverging bar chart layered on
top of (not instead of) their two standalone bars, since a plus/minus pair
is exactly what a diverging chart is for and the standalone bars alone would
hide the gross scale of churn behind a small net number.

Every chart carries a hover tooltip (exact period + value) by default. The
underlying weekly/monthly table already satisfies the "a table view exists"
accessibility requirement — it's the same query the charts render, not a
separate build. Hand-rolled inline SVG bars, no charting library — small,
uniform bars are simple enough to build directly and this keeps the app
dependency-free, consistent with how every other screen here is built.
Sum and Averages' grand totals render as stat tiles, not bars (a cumulative
snapshot isn't a "this many happened in week X" figure); the per-user roster
renders as a plain table (many accounts × many columns is a table's job, not
a chart's).

## Printing

Every screen gets a Print button using the existing print icon and the
existing pattern already live on the main screen: a print-only rendering of
what's currently on screen, `window.print()`, `.no-print` / `@media print`
rules in `globals.css`. Nothing new to design.

## .xlsx export

One shared aggregation function per entity feeds the on-screen table, the
print view, and the export alike, so there's one source of truth rather than
three implementations that can drift. Export itself: a small
`/api/admin/stats/export` route using a lightweight library (e.g.
`exceljs`), gated by the same `is_admin` check as the query RPCs.

**Decided (2026-09-07):** a separate export per screen, one workbook each —
not a single combined multi-sheet file. Each export mirrors whatever is
currently on screen (the active date range, granularity, and cohort
filter) exactly; there's no separate "full range regardless of filter"
option.

## Build order (proposed, not yet started)

1. Migration: `profiles.is_admin`; Housekeeping's Statistics chip (gated,
   empty screens to start).
2. Extend `events` logging at the cheap sites first (Contact created/deleted,
   Request/ToDo deleted, Request/ToDo changed via the two existing update-
   notification routes, Request/ToDo Done, ToDo created) — all additions to
   code that already runs server-side.
3. The new Archive/Unarchive function (the one genuinely new server code
   path) and its own event logging.
4. The four query screens themselves: aggregation RPCs (all `SECURITY
   DEFINER`, all re-checking `is_admin`), the small-multiples chart stack,
   the Sum and Averages KPI tiles + roster table, Print, then the .xlsx
   export once the two open questions above are answered.

## Open questions carried forward

None remaining — both prior open items (the .xlsx export shape, and the
roster's per-user-average divisor) are decided above.
