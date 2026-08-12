# Would You Please — Week 4 plan

## Closing out Week 3 first

Migrations 007 (`profiles.time_zone`/`contacts.time_zone`) and 011 (`owner_tier` on `get_request_by_token`) were both still marked "DRAFTED — NOT YET RUN" in their own file headers as of the end of Week 3, with no confirmation elsewhere in the docs — a real open risk, not just a stale-header nit like migration 004's. Owner confirmed 2026-08-11: both have been run, along with the Week 2 demo seed script. CLAUDE.md's Known gaps updated accordingly. **Week 3 is now fully closed**, including this trailing verification.

---

## Priority 1: Received Requests

The one deferred piece flagged repeatedly since Main Screen went live: `requests` RLS is owner-only (migration 003) and no column links a row to its recipient's own account, so there was no way for a signed-in user to query "Requests sent to me." Design proposed and confirmed 2026-08-11 (see decisions log).

**No new columns.** `contacts.email` (already required, not null) is the match key against the signed-in recipient's own auth email (`auth.jwt() ->> 'email'`, lower/trim-normalized). A `recipient_user_id` column resolved at send time was considered and rejected — a recipient almost never has an account yet when a Request is sent (magic-link auth creates the account on first sign-in), so the column would sit null for nearly every real case, and it reopens the exact snapshot-vs-live argument the Entitlements section already settled once for `tier`.

**Migration 012 — four `SECURITY DEFINER` functions, confirmed run by the owner 2026-08-11**, parallel to the existing `/r/[token]` set but keyed by session identity instead of a token:

- `get_received_requests()` — list shape for Main Screen's Received section (id, description, due_date, due_time, priority, done_date, done_time, created_at, owner_name). Category excluded, same PRD §2.3 rule migration 009 already had to fix once on the token path.
- `get_received_request(p_request_id uuid)` — single-row detail shape (same fields plus the Dialog thread) for the live Response Detail screen.
- `set_response_done_as_recipient(p_request_id uuid, p_done_date date, p_done_time time)` — write, verifies the email match server-side before touching anything.
- `add_dialog_as_recipient(p_request_id uuid, p_kind text, p_body text)` — same verification.

Each grants `execute` to `authenticated` only, not `anon`. Each logs an `events` row with `actor_user = auth.uid()`; no constraint change needed, `subject_type` already allows `'request'`/`'dialog'`.

**Why functions, not RLS policies.** RLS is row-level, not column-level: a permissive SELECT/UPDATE policy on `requests` scoped by a contact-email subquery would let a signed-in recipient read or write columns that must stay sender-only (Category) — the same class of bug migration 009 already fixed once on the token path. A function allow-lists exactly what a recipient is entitled to touch.

**Self-sent Requests are included, not excluded.** Owner: *"I can imagine circumstances where a person might choose to send themselves requests instead of using ToDos."* No `owner_id <> auth.uid()` filter in `get_received_requests()`.

**Main Screen**: fetch `get_received_requests()` alongside the existing Sent/ToDo queries, render Received rows in the existing `.reqrow` style (bold/red-if-overdue Due Date, same convention), filter chips matching Sent's All/Open/Overdue/Done. Row click routes to `/requests/[id]/respond` — the route Response Detail's own mockup already proposed; confirmed as the live route, no further decision needed.

**Response Detail** (`WYP_response_detail_palette1.html`) converts from mockup to live at that route, using the four functions above in place of RequestResponseForm.tsx's token-based calls; Add to Calendar, quick-Done band, and the Dialog panel's dynamic Answer/which-Question-picker logic are all directly reusable.

**Rejected alternative**: reusing `/r/[token]` literally for a signed-in user (mint them a link, drop them into RequestResponseForm.tsx) — already deferred once when the owner raised it earlier; shows "Create your own Free Account" to someone who has one, and Response Detail's mockup exists specifically to be the correct, distinct screen.

---

## Priority 2: Main Screen column-header sorting

Once Received has real rows to sort. Currently the `.colbar` column headers (To/From, Date, Due, Done on Sent/Received; Category — Description on ToDos) are mostly static labels — only Due (Sent/Received) and Priority (ToDos) render as a `.pill` (the `--sort` yellow token, §3.1 design constant) indicating the current sort column and direction, and that pill doesn't move: it reflects the fixed default sort MainScreen.tsx already implements (Due descending / Priority ascending), not a live, clickable control. Owner: *"the various column headings and the ascending and descending sort options with the yellow background for the selected column title."* Scope: every sortable column header becomes clickable, toggles ascending/descending on repeat clicks, and the `.pill` moves to whichever column is currently selected. Not yet designed in detail — which columns are sortable beyond Due/Priority (Date? Done?) is an open question for when this starts.

---

## Priority 3: Expanded screens — dropped, 2026-08-12

Was: owner's stated next phase after Received and sorting are both done, scope not yet defined. **Dropped, not designed.** Owner: the Expand icon's whole premise assumed each Main Screen section had its own scrollable "elevator" showing only some of its items, with the full-page Expanded view existing to show the rest. That's not how Sent/Received/ToDos were actually built — every selected item already renders under its own section on the Main Screen itself, which the owner also flagged as the practically correct behavior for normal use, not a bug to fix. A full-page or in-place expansion would only have offered more lines of Request Description per row, which he judged minimal utility given items are already fully visible. Directs dropping the Expand/Contract icon's use in the app entirely, rather than building the screen this priority was reserved for. See decisions log, 2026-08-12, and CLAUDE.md's Known gaps — this also leaves the PRD (§3.7 "Expanded Full-Page View") and UI spec (§8.7, §9.7, §5.1/§11.1 icon inventory) documenting a feature the app no longer offers; flagged to the owner as a separate open question about whether/when to formally revise those two documents.
