# Would You Please — Calendar View Plan

## Goal

A single new screen showing Sent Requests, Received Requests, and ToDos
plotted on a real calendar (Day / Week / Month), reachable from Main
Screen. Grew directly out of the Add-to-Calendar-cleanup conversation
(2026-09-15): rather than push recipients toward external
Google/Outlook calendars — which then need cleaning up once a Request is
Done — give every account (free included) the same "see what's coming"
visibility natively inside WYP. Jim's own framing: this is meant partly as
a free-tier draw, not a Subscriber perk.

No new schema. Every item this screen plots already exists in `requests`
(Sent, Received via `get_received_requests()`, ToDos) with a `due_date`
already being fetched by Main Screen today. Repeat-generated occurrences
are already real, separately-dated rows (migrations 038–040) — nothing
calendar-specific needs to understand recurrence, each occurrence just
plots on its own `due_date` like any other item.

## Entry points

Three new calendar icons, one adjacent to each of Main Screen's existing
per-section Print icons (Sent, Received, ToDos) — not one central entry
point. Clicking one:

1. Pre-checks that section's Record Type in the new screen.
2. Carries that section's **currently active status chip** (All / Open /
   Overdue / Done) into the new screen as a fixed, read-only **Status**
   label shown at the top ("Status: Open") — not a re-clickable chip row
   inside Calendar itself. To see a different status, close Calendar,
   change the chip on Main Screen, and reopen it. Jim's own wording,
   twice: "shown in text at the top (that way the events are
   'consistent' in the view)" — the whole point is that every Record Type
   checked while in Calendar reads against the *same* status, so an "Open
   Sent + All ToDos" mismatch can't happen.
3. The user can then check additional Record Types (Sent/Received/ToDo)
   from inside Calendar — each newly-checked type is filtered by that
   same fixed Status, per the point above.

Route: new `/calendar`, a new `RequireAuth`-wrapped screen
(`app/components/CalendarView.tsx` / `app/calendar/page.tsx`), matching
every other authenticated route's convention. Entry state (which Record
Type, which Status) is handed off via `sessionStorage` on the way in —
not query params, matching this app's established round-trip pattern
(Archive's `ARCHIVE_ROUNDTRIP_KEY`, Main Screen's search round-trip)
rather than introducing URL-state for the first time.

## Record Type selection & Status

- Three checkboxes at the top: **Requests: ☐ Sent ☐ Received  ToDos ☐**
  (Jim's own literal layout). Exactly one pre-checked on entry, per above.
- **Status** label directly below/beside it, read-only, echoing the
  launch chip.
- A separate **"Exclude Done"** checkbox, checked by default (Jim's own
  ask) — narrows whatever Status already selected by additionally hiding
  `done` items. Meaningful only when Status is `all` or `done` (Open/
  Overdue already exclude Done by construction, per `statusFor()`'s
  existing three-way exclusive model) — a no-op the rest of the time,
  which is fine to leave visible either way.
  - **Flagged open question**: if the launch chip itself is *Done* ("Exclude
    Done" defaulting checked would show an empty calendar). Proposed
    resolution: default this checkbox to **unchecked** specifically when
    Status = Done, checked by default in every other case. Needs Jim's
    sign-off before building, not assumed.
- **Archived items never appear** — no toggle, unconditional exclusion,
  matching Jim's own answer ("Archived do not need to appear").
- ToDos checkbox is disabled/hidden when the account's own
  `todo_dates_enabled` is off — a ToDo without that setting on has no
  `due_date` to plot at all, so there's nothing calendar-worthy about it.
  (Not something Jim was asked directly; it follows mechanically from
  existing data availability, not a new design call.)

## Item rendering

Plotted on **Due Date**, always — including Done items, which stay under
their original Due Date rather than jumping to Done Date, matching how
every other list/print view in the app already treats a completed item.

Label format, per Jim's own spec:

| Type | Label |
|---|---|
| Sent | `To: <Contact display_name>, <Description, first 30 chars>` |
| Received | `From: <Contact display_name>, <Description, first 30 chars>` |
| ToDo | `ToDo <Description, first 30 chars>` |

**Flagged interpretation**: Jim's own message wrote the ToDo format as
`"ToDo ",Descr [1st 30 chars]` — read here as list notation (the "ToDo "
tag, then the description), not a literal comma character in the
rendered label, since a ToDo has no name to precede a comma the way
Sent/Received do. Flagging rather than assuming, in case a literal
"ToDo, <descr>" was actually intended.

- **No Category** in the label even when Private Category is on — Jim's
  explicit answer ("Exclude it").
- Color: reuse the app's existing overdue-red / done-grey / default-ink
  row treatment (the same convention Main Screen, Archive, and every
  print report already use) so a glance at Calendar reads consistently
  with the rest of the app — no new color language invented for this
  screen.
- Truncation reuses the existing `truncate()` pattern already duplicated
  elsewhere in this codebase (`app/src/lib/ics.ts`'s own copy) rather than
  a new implementation.

## View types & navigation

Day / Week / Month, as `.chip`/`.chip.sel` toggle buttons — the same
component/visual language Admin Statistics' own Weekly/Monthly toggle and
Requests' Sent/Received toggle already use, not a new control type.
Prev/Next arrows plus a **Today** button to snap back to the current
date. **Proposed default: Month** (broadest single-glance overview) —
flagged, not explicitly specified by Jim.

- **Month view**: day-cells, each listing that day's items (label text
  only, no time-of-day positioning — the simpler, lower-risk view to
  build first).
- **Week/Day views**: an hourly time-grid. An item with a Due Time *and*
  Time tracking on for its owner (`request_time_enabled`/
  `owner_request_time_enabled`, matching the existing per-account/
  per-issuer entitlement already gating Due/Done Time everywhere else in
  the app) is positioned at that hour; everything else (no Due Time, or
  Time tracking off) renders in an "all day" row at the top of its day
  column — the standard calendar-app convention, not a new one invented
  here. **Flagged**: hourly rows are the proposed granularity (vs.
  half-hour); either is a small, late decision, not something that
  changes the shape of this plan.
- **Flagged**: since Month view has no vertical position to convey a Due
  Time, proposing the item label additionally show the time
  (`h:mm am/pm`) only in Month view, where Week/Day's own grid position
  already communicates it. Not asked directly; a reasonable inference,
  not a silent assumption — noted here for Jim to confirm or correct.

## Interaction — click-through with return

Clicking any item navigates to its real Detail screen — no new detail UI,
no inline editing from the calendar grid itself (see Out of scope below):

- Sent → `/requests/[id]` (`RequestDetailForm.tsx`)
- Received → `/requests/[id]/respond` (`ResponseDetailForm.tsx`)
- ToDo → `/todos/[id]` (`TodoDetailForm.tsx`)

Uses the same round-trip `sessionStorage` marker convention already
established twice in this app (Archive's `ARCHIVE_ROUNDTRIP_KEY`, Main
Screen's search round-trip): a new `CALENDAR_ROUNDTRIP_KEY`, set right
before navigating to the Detail screen, preserving the current date/view
type, checked Record Types, and Status/Exclude-Done state — so Close/
Cancel returns to the exact same Calendar view rather than a reset one.

## Calendar grid: hand-built vs. a library — the one real architecture call

Everything else in this app is deliberately dependency-free (the Admin
Statistics charts and every print report are hand-rolled inline SVG/CSS,
per that plan's own "Chart treatment" section). A real Day/Week/Month
grid is a materially bigger problem than a bar chart: correct date math,
DST handling, week/day time-grid layout, overlapping-event positioning,
and keyboard/accessibility behavior are all real, fiddly surface area
that a small hand-rolled component risks getting subtly wrong in ways a
maintained library already handles.

This is the actual Next.js app, not an Artifact — an npm dependency is a
legitimate option here, unlike the Artifact CDN restriction elsewhere in
this project. **Recommendation: use a well-maintained calendar-grid
library** (something in the FullCalendar family, or an equivalent
lightweight alternative evaluated at build time) rather than hand-roll
month/week/day grid math from scratch, as the one deliberate exception to
this app's usual zero-dependency convention. **Flagged for Jim's explicit
sign-off before work starts** — this is the single biggest deviation from
how the rest of the app has been built, and deserves an explicit decision
rather than a default.

## Gating / entitlements

- **Free feature, no tier check anywhere** — Jim's explicit answer.
  Available to every signed-in account regardless of `profiles.tier`.
- ToDos Record Type gated on `todo_dates_enabled` (data availability, not
  a business-model gate — see above).
- Due/Done Time display in Week/Day positioning and the Month-view label
  gated on `request_time_enabled`/`owner_request_time_enabled`, matching
  every other screen that already respects this per-issuer setting
  (Entitlements section, CLAUDE.md: rights come from the issuer, never
  the viewer).
- Category is never shown regardless of `private_category_enabled` — see
  above, Jim's explicit answer.

## Out of scope / deferred for v1

Named explicitly so nothing here reads as a silently-dropped ask:

- No print output for Calendar.
- No inline editing, drag-to-reschedule, or quick-Done from the calendar
  grid itself — every item click goes to its real Detail screen for any
  change, same as today.
- No `.xlsx` export.
- No year view.
- No timezone selector — same floating-local-time assumption the `.ics`
  builder already uses (Requests/ToDos carry no stored time zone of their
  own).
- Un-archiving or otherwise surfacing Archived items from within
  Calendar — they simply never appear here, full stop.

## Build order (proposed, not yet started)

1. Shared primitives: month/week/day date-grid math, the item-fetch
   queries (reusing Main Screen's existing Sent/Received/ToDos queries
   verbatim), and a shared status/color helper reused from
   `MainScreen.tsx` rather than re-derived.
2. Month view end to end: Record Type checkboxes, Status label, Exclude
   Done, item rendering, click-through-with-return. The simplest view,
   proves the whole data/interaction model before the harder grid work.
3. Week/Day views: the hourly time-grid and all-day row.
4. Wire up the three entry-point icons on Main Screen (Sent/Received/
   ToDos sections).
5. Polish: Today button, empty states, loading/error states — matching
   this app's existing conventions (retry-with-backoff on load errors,
   per the 2026-09-11 Main Screen/Archive/Contacts fix, rather than a
   fourth, differently-behaved loading pattern).

## Open questions carried forward

Each of these has a proposed default in this doc, flagged rather than
silently assumed — confirm or correct before or during build:

1. "Exclude Done" defaulting unchecked specifically when Status = Done
   (else the initial view is empty).
2. Default view type on first entry (proposed: Month).
3. ToDo label's comma — read as list notation, not literal punctuation
   (proposed: "ToDo `<descr>`", no comma).
4. **Calendar grid: library vs. hand-built** — proposed: use a
   maintained library, the one deliberate exception to this app's
   zero-dependency convention. The biggest single decision in this plan.
5. Week/Day time-grid granularity (proposed: hourly rows).
6. Showing Due Time in the Month-view label only, since Week/Day's own
   grid position already conveys it (proposed, not explicitly asked).
