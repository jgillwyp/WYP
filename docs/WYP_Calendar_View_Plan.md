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
   Overdue / Done) into the new screen as the starting selection of a
   real, clickable chip row — see Header controls below for the full
   design. (Supersedes an earlier fixed-text-label version of this same
   idea, 2026-09-16 — see that section's own note.)
3. The user can then check additional Record Types (Sent/Received/ToDo)
   and change the Status chip freely from inside Calendar.

Route: new `/calendar`, a new `RequireAuth`-wrapped screen
(`app/components/CalendarView.tsx` / `app/calendar/page.tsx`), matching
every other authenticated route's convention. Entry state (which Record
Type, which Status) is handed off via `sessionStorage` on the way in —
not query params, matching this app's established round-trip pattern
(Archive's `ARCHIVE_ROUNDTRIP_KEY`, Main Screen's search round-trip)
rather than introducing URL-state for the first time.

## Header controls — Record Type, Status, Print

**Redesigned 2026-09-16** from Jim's own reference screenshot — a
two-row Strip-tinted header band sitting directly above the calendar
grid, replacing the original fixed-text-label design entirely:

- **Row 1** — Record Type checkboxes: **Received, Sent, ToDos** (the
  screenshot's own order and wording), plus a **Print icon** at the
  right end of this same row (see Printing below). A checked type's
  label renders bold, in brand-blue; an unchecked type renders as plain
  text — the screenshot's own visual distinction. Exactly one is
  pre-checked on entry, matching whichever section's calendar icon was
  clicked (see Entry points); the user may check additional types
  afterward.
- **Row 2** — the **exact same All / Open / Overdue / Done chip row**
  Main Screen and Archive already use, reused as-is, not a new control.
  Initialized to whichever chip was active in the launching section, and
  freely clickable/changeable from inside Calendar afterward (Jim's own
  correction, 2026-09-16 — a real filter now, not a read-only echo).
  There is still only one such filter, shared across every currently-
  checked Record Type, so an "Open Sent + All ToDos" mismatch still
  can't happen — the original consistency goal, now met by reusing a
  familiar control instead of a read-only label plus a separate
  checkbox. **Retires the earlier flagged edge case** (a separate
  "Exclude Done" checkbox defaulting off only when launched from the
  Done chip) — there's nothing left for it to apply to.
- **Archived items never appear** — no toggle, unconditional exclusion,
  unchanged from the original decision ("Archived do not need to
  appear").
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
type, checked Record Types, and Status chip selection — so Close/Cancel
returns to the exact same Calendar view rather than a reset one.

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

## Printing

**Added 2026-09-16** (supersedes the original "no print output for v1"
deferral). A Print icon sits in the header band's own Row 1 (see Header
controls above) — same `.no-print`/`.print-report` split and strictly-
incrementing `printTick`-counter pattern every other print button in
this app already uses (`MainScreen.tsx`/`ArchiveForm.tsx`/
`RequestDetailForm.tsx`/`TodoDetailForm.tsx` all hit and fixed the same
"a boolean re-trigger doesn't reliably fire `window.print()` on a
second click" bug once already — no reason to reintroduce it here).

Output is an **agenda-style list**, not the visual grid itself (Jim's
own confirmed choice, 2026-09-16) — the same convention every other
print report in this app already follows: Admin Statistics dropped its
own charts for print outright, and Main Screen/Archive/the detail
screens all print a plain table rather than reproducing the live
widget. Avoids the real risk of a CSS grid — especially Week/Day's own
hourly time-grid — breaking awkwardly across printed page boundaries.
Reflects whichever Record Types and Status chip are currently selected
and whichever date range is currently visible (the visible month, the
visible week, or the single visible day, matching the current view
type) — one row per item, sorted by date, reusing this app's own
established print-table look (`.pcolbar`/`.pr1` conventions) rather than
inventing a new print layout.

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

## Status: built, 2026-09-16

Built end to end in one pass per this doc's own defaults (FullCalendar
6.1.21, Month default, no comma in the ToDo label, hourly time-grid via
FullCalendar's own `timeGridWeek`/`timeGridDay`, Due Time shown in
FullCalendar's default Month-view event-time prefix only) — Jim asked to
proceed without intermediate approval and review only at commit/push.
`app/src/lib/calendarData.ts` (fetch/status/label helpers), `app/components/
CalendarView.tsx` (the screen), `app/calendar/page.tsx` (route), and three
new Calendar-icon entry points on `MainScreen.tsx` next to each section's
own Print icon. Record Type is three checkboxes (Sent/Received/ToDos —
ToDos hidden when `todo_dates_enabled` is off), bold+blue when checked;
Status is the same real `.chip`/`.chip.sel` All/Open/Overdue/Done row Main
Screen/Archive already use, initialized from the launching section's own
current chip via a `?section=&status=` query string on first visit, freely
changeable afterward. View switching (Month/Week/Day) is a third `.chip`
row wired to `FullCalendar`'s `changeView()`. A `CALENDAR_ROUNDTRIP_KEY`
sessionStorage marker (mirrors `ArchiveForm.tsx`'s own pattern) restores
Record Type/Status/View across a click-through-and-back round trip to a
Detail screen. Printing reuses the existing `.print-report`/`.pcolbar.
detail2`/`.pr1.detail2` (1fr 150px, Item/Due) two-column shape rather than
new CSS, listing the currently-filtered items sorted by Due Date/Time.
`npx tsc --noEmit`/`npm run lint`/`npm run build` all clean. No mockup —
this feature has none, per the plan's own scope.

## Build order (proposed, not yet started)

1. Shared primitives: month/week/day date-grid math, the item-fetch
   queries (reusing Main Screen's existing Sent/Received/ToDos queries
   verbatim), and a shared status/color helper reused from
   `MainScreen.tsx` rather than re-derived.
2. Month view end to end: Record Type checkboxes, Status chip row, item
   rendering, click-through-with-return. The simplest view, proves the
   whole data/interaction model before the harder grid work.
3. Week/Day views: the hourly time-grid and all-day row.
4. Wire up the three entry-point icons on Main Screen (Sent/Received/
   ToDos sections).
5. Printing: the agenda-style print output, once Month view and the
   header controls are solid.
6. Polish: Today button, empty states, loading/error states — matching
   this app's existing conventions (retry-with-backoff on load errors,
   per the 2026-09-11 Main Screen/Archive/Contacts fix, rather than a
   fourth, differently-behaved loading pattern).

## Open questions carried forward

Each of these has a proposed default in this doc, flagged rather than
silently assumed — confirm or correct before or during build. Two
earlier open items are now resolved and dropped from this list: the
"Exclude Done" default-unchecked edge case (the whole control is
retired, per the 2026-09-16 header redesign above), and the print
output format (agenda-style list, confirmed directly).

1. Default view type on first entry (proposed: Month).
2. ToDo label's comma — read as list notation, not literal punctuation
   (proposed: "ToDo `<descr>`", no comma).
3. **Calendar grid: library vs. hand-built** — proposed: use a
   maintained library, the one deliberate exception to this app's
   zero-dependency convention. The biggest single decision in this plan.
4. Week/Day time-grid granularity (proposed: hourly rows).
5. Showing Due Time in the Month-view label only, since Week/Day's own
   grid position already conveys it (proposed, not explicitly asked).
