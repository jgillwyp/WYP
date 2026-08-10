# Would You Please — Decisions Log

A chronological record of substantive product, design, and asset decisions taken outside the regular PRD/UI-spec revision flow, or that benefit from being captured in one place. Entries are newest-first.

The PRD and UI Design Specification remain the canonical source of truth for product requirements and design system details. This log captures the *reasoning* behind decisions, alternatives considered, and any follow-ups, so future revisions don't have to reconstruct the why from the what.

\---

## 2026-08-10 — Request Response: quick-Done band, tier-gated Attachments, "(name)" consistency in the which-Question picker; display_name data gap diagnosed

Owner's message covered several things at once, testing the live Request Response screen:

**1. Attachments segment shouldn't show for a free-tier issuer.** *"It seems that a Request Response does not need to display the non-usable Attachment segment unless the requestor is a subscriber and if the requestor is a subscriber... it should be shown because it is usable by the recipient... only when the recipient explores the free account features does the ability to subscribe... become of interest to them."* Added `owner_tier` to `get_request_by_token`'s payload (migration 011, drafted) and gated the whole Attachments `panelact`+`panelfull` block on `data.owner_tier === 'subscriber'`. **Flagged, not fully resolved**: real attachment storage/upload doesn't exist anywhere in this app yet — not on this screen, not on the issuer's own Request Detail, nowhere (still deferred per CLAUDE.md's Scope discipline). So even for a subscriber-issued Request, there's nothing actually usable behind the Add Attachment button today; I kept it locked and changed the copy from "A subscription feature" (wrong once the issuer already is one) to a plain "No attachments yet" / "not available in this preview yet," rather than making it look functional when it isn't. Real attachment infrastructure is still a separate, unscoped piece of work.

**2. `From:` was blank; Dialog entries by the signed-in owner show a raw email instead of a name.** Both trace to the same root cause: `profiles.display_name` has no live path to a value — Create Free Account isn't wired into the app (no separate first-run step exists; see CLAUDE.md Known gaps) and Account is intentionally undesigned. `RequestDetailForm.tsx`/`TodoDetailForm.tsx`'s own Dialog-save fallback is `ownerName ?? userData.user.email ?? 'Unknown'`, so a null `ownerName` falls all the way to a raw email. Not a code bug — a data gap, already flagged, now actually biting real usage rather than just Time Zone. One-time fix recorded in `docs/Week3 - SQL history.txt` (not a migration): `update profiles set display_name = 'Jim Gillon' where id = (select id from auth.users where email = 'jimgillon@gmail.com')`.

**3. Which-Question picker: show "(name)" not "name:".** *"In a Dialog Answer presentation, the person asking the question is shown with a following colon, it seems that repeating the use of parenthesis for the name would be more consistent with the full dialog list."* Reverted the bold `Name:` prefix added earlier today (`.qpicker-who`) in favor of the main Dialog list's existing `.dlgwho` convention — `(name)`, Ink-Soft, not bold — reused verbatim rather than keeping two ways of labeling who said something. `.qpicker-who` removed from `globals.css` and all three mockups.

**4. New: quick-Done band.** *"The Request Response recipient should be able to mark a Request as complete in as few keystrokes as possible."* Owner walked through and rejected two alternatives himself before landing on the shipped design: a Done/Add-Dialog/Add-Attachment chip picker (rejected — not mutually exclusive, a recipient may want more than one), and auto-filling Done Date on page load (rejected — forces anyone who only wants to add Dialog to clear it first). Shipped: a Strip band (§6.31, PROPOSED, `.donerow`/`.donenote`) above the Done Date/Done Time row, with a "Done" button that fills Done Date with today's date only (Done Time stays untouched — same optional-refinement role it has everywhere else). The band's own text and the button's disabled state are both purely reactive to whether Done Date currently holds a value, however it got there — clicking Done or typing directly into the field land in the identical state, so there's no separate "did they click Done" flag that could drift out of sync. This was the owner's own proposed resolution to the ambiguity he raised about whether clicking Done is required after a manual date entry — implemented as suggested, not modified.

Scope note: the quick-Done band and the tier-gated Attachments logic were added to the live component only; reconciling `WYP_respond_to_request_palette1.html`'s own demo (which still shows a full attachments file list and static Done Date/Time text, both already flagged as diverging from the live screen — see `design/README.md`) was judged lower value than answering the rest of this message and was skipped this round. Flagged, not silently dropped.

`npx tsc --noEmit` and `npx eslint` on the three changed components both pass clean.

\---

## 2026-08-10 — Which-Question picker: show who asked, default to Answer, and show even for a single open Question

Owner, first message: *"On the Request Response Add Dialog with two questions... 1) the two questions are shown but it would be helpful to show who asked the question [a person may choose to answer their own question so only showing questions by the other party would not be appropriate], 2) the default response for the chip in this instance is Question even though the only prior dialog entries are questions [it seems more appropriate to show the Answer chip as selected if there are any questions in the dialog which have not been answered yet]."*

Owner, follow-up: *"when I answered one of the two questions and subsequently selected the Answer chip, the remaining unanswered question was not shown."*

Three related fixes to the Add Dialog modal's Kind-selection and which-Question-picker logic, applied identically everywhere the pattern exists — `RequestResponseForm.tsx`, `RequestDetailForm.tsx`, `TodoDetailForm.tsx`, and their three source mockups (kept in sync per the project's standing convention):

1. **Each picker row now shows who asked**, not just the question text (`.qpicker-who`, bold, prefixed before the truncated body). Deliberately not filtered to "the other party" — the owner's own point was that a person can answer their own Question, so the asker's identity is informational, not a filter.
2. **Add Dialog now defaults to the Answer chip whenever at least one Question is open**, instead of always starting on Question. `openDialogModal()` now calls `selectKind(openQuestions.length > 0 ? 'answer' : 'question')` — reuses the existing default-question-selection logic inside `selectKind('answer')` unchanged, just changes which chip starts selected.
3. **The which-Question picker itself now renders for any open Question, not only for more than one.** This reverses the 2026-08-07 scoping decision recorded in `design/README.md`'s §6.27 entry ("it only needs to be presented if there is more than one question") — the owner's second message is direct field evidence that "links silently, no picker" left no visual confirmation of what a lone remaining Question even was once the picker disappeared. Superseded, not silently overwritten: the original entry stays on record, this entry is the correction. The underlying single-Question auto-select logic (`dlgSelectedQuestionId = open[open.length - 1].id`) needed no change — only the render condition (`openQuestions.length > 1` → `> 0`) did.

`npx tsc --noEmit` and `npx eslint` on the three changed components both pass clean.

\---

## 2026-08-10 — Migration 010 drafted: fixes `add_dialog_by_token`'s events insert (bug found by the owner testing Day 4's link)

Owner: *"I tried to add a Dialog Question to a Request Response and saw an error"* — screenshot showed `column "subject_id" is of type uuid but expression is of type bigint`.

Real bug in migration 009, not a data issue: `add_dialog_by_token` logged its `events` row as `('dialog', v_new_id, ...)`, using the new Dialog entry's own id as `subject_id` — but `dialog.id` is a plain `bigint` identity column (the same type `dialog.replies_to_id` already points at) and `events.subject_id` has been `uuid` since migration 002. No bigint value can be cast into it; the insert was always going to fail the first time this path actually ran. `get_request_by_token` and `set_response_done_by_token` both happened to log with the Request's own `uuid` as `subject_id` already, so neither ever exercised this bug — Add Dialog on `/r/[token]` was the first call to actually hit it, which is exactly what the owner's testing found.

**Fix (migration 010, drafted, not yet run)**: log with `subject_id = v_request_id` instead, matching the pattern the other two functions already use (and the precedent `subject_type = 'link'` already set — its "subject" is conceptually the link, but `subject_id` is still the Request's own uuid, since there's no separate link-row id to point to either). The new dialog entry's own id moves into `detail->>'dialog_id'` instead, preserved for later auditing without needing a uuid.

\---

## 2026-08-10 — Migrations 008 and 009 confirmed run

Owner: *"Migrations 008 and 009 have been run."*

Marked confirmed in `docs/Week3 - SQL history.txt`, `CLAUDE.md`, and `WYP_Week3_Plan.md`. The full recipient-link loop is now live and testable end to end: Request Detail's "Get Response Link" issues a real token, `/r/[token]` reads and responds through it. Migration 007 (Time Zone) is unaffected by this confirmation and stays flagged DRAFTED, not yet run — the owner's message named 008/009 specifically, and nothing here implies 007 was included.

\---

## 2026-08-10 — Response Link band added to Request Detail (Week 3, Day 4)

Owner: *"Please provide the testing link as described in: Day 4 — Surface the link somewhere a sender can reach it."*

Added a "Get Response Link" button to `RequestDetailForm.tsx`, directly under the existing recipient-notification notice band — calls `issue_request_link` (migration 008), then shows the resulting `/r/[token]` URL with Copy and Regenerate. New PROPOSED component, §6.30 (`.linkband`/`.linkval`) — Day 4 was scoped in the plan as "surface the link somewhere," with no mockup drawn for it, so this was built plain against the existing Strip/`.btn-secondary` vocabulary rather than left unbuilt for want of a design pass.

**Could not hand the owner an actual working link directly, and said so rather than fabricating one.** Two independent reasons: (1) migrations 008 and 009 are both still DRAFTED, not run — `issue_request_link` doesn't exist in the live database yet, so the button will error until the owner runs both. (2) Even once run, `issue_request_link` is owner-only (`auth.uid()` checked against the Request's `owner_id`) and its raw token is returned exactly once, never persisted anywhere — by design, only the salted hash is stored. There is no query, migration, or admin path that could produce a real token from outside the owner's own authenticated browser session; the button has to actually be clicked by the owner. Told the owner this plainly, with the two-step path to get one (run 008/009, then click Get Response Link on an existing Sent Request).

`npx tsc --noEmit` and `npm run lint` both pass clean.

\---

## 2026-08-10 — Request Response converted to live `/r/[token]` (Week 3, Days 2–3); migration 009 drafted

Owner: *"The Week3 plan for days 2-3 'Convert Request Response... is for the Respond to Request screen as accessed by the anon end-user recipient of the Request. This same screen (or a version of it) should also be presented to a free or paid subscriber when they click on an item in the Requests Received list on the main screen. The screen design is 'completed', please work on the anon access as described in the plan."*

Built `app/components/RequestResponseForm.tsx` and `app/r/[token]/page.tsx` — the one route in the app with no `RequireAuth` wrapper, since this is the anonymous recipient's own entry point. The signed-in-subscriber reuse of this screen (clicking a Received row) is explicitly not built now — Received itself is still non-functional (no schema/RLS path exists for a signed-in user to query "Requests sent to me"), so there's nothing yet to click through to it from. Noted for whenever Received gets its own schema pass.

**Migration 009 drafted, catching a real bug in my own migration 008 draft before it was ever run**: writing this screen's data-loading code surfaced that `get_request_by_token` (migration 008) selected and returned `category_name` — a direct violation of PRD §2.3, which states plainly that Category is a sender-side-only organizing label never shown to the recipient, "not on... the Respond to Request screen, the recipient's Detailed Item view, the non-registered web response view..." Fixed via `create or replace function` rather than silently editing migration 008's already-drafted text: migration 009 removes the `categories` join/field entirely and adds `owner_name`/`created_at` (needed for the meta block's Date:/From: rows, which migration 008 hadn't included either). Two new functions in the same migration: `set_response_done_by_token` (writes Done Date/Done Time) and `add_dialog_by_token` (writes a Dialog entry, `who` resolved server-side from the Request's own Contact — no name collection, matching the plan's already-settled "frictionless" decision). Both anon+authenticated callable, same hash/expiry/revocation-check and generic-error pattern as migration 008.

**Two deliberate divergences from the mockup, both flagged in code comments and in `design/README.md`:**
- Done Date/Done Time render as real editable pickers (Request Detail's `.fgroup.frow`+`.ffloat.picker.native` markup), not the mockup's boxed `.duo`/`.fieldval` static-text preview. The mockup's own `.panel.req` comment already flagged its border rule as unresolved ("should be conditional on Done Date equaling Due Date and a Due Time being part of the Request... not permanent") — rather than inventing that comparison now, both fields are treated as ordinary optional `.opt` fields, matching how Request Detail already treats the same two fields. `.panel.req` was not carried into the live screen; the mockup file itself is unchanged.
- Add Dialog's Save calls `add_dialog_by_token` and appends the RPC's returned `{id, created_at, who}` straight into local state, rather than re-running `get_request_by_token` — a re-fetch would log a second, semantically wrong `'viewed'` event for what was actually a write.

**Send/Cancel don't behave like every other Detail screen's.** Send shows an inline `.noticeband` confirmation ("Response saved.") instead of navigating anywhere, and Cancel resets the two editable fields to their last-saved values instead of calling `router.back()` — both because an anonymous visitor arriving from a mailed/texted link typically has no prior in-app history entry to return to, unlike every other screen's Cancel/Close, which is only ever reached by clicking a row on its own parent list.

CSS: `.meta`/`.metatop`/`.metacol`/`.seclabel`/`.respdesc`/`.grabber`/`.promo`* ported into `globals.css` in an earlier pass this session; `.panelact`/`.panelfull` (the stacked Add Dialog/Add Attachment action row, already named in the mockup and in the §6.26 spec entry) added this batch. `.duo`/`.fieldhead`/`.fieldval` were **not** ported — they belong to the static-text display this screen no longer uses live, and stay mockup-only.

`npx tsc --noEmit` and `npm run lint` both pass clean.

\---

## 2026-08-09 — Migration 008 drafted: secure recipient link token infrastructure (Week 3, Day 1)

Owner: *"Please work on the Day 1 — Migration 007: token infrastructure for the Week3 plan."*

**Renumbered 007 → 008.** The plan's Day 1 heading was written before the Time Zone work claimed migration 007 later the same day. Corrected in `WYP_Week3_Plan.md` and drafted under the right number in `docs/Week3 - SQL history.txt`, rather than either colliding with Time Zone or silently renumbering Time Zone instead (Time Zone was drafted first, chronologically, and already referenced as 007 in CLAUDE.md/decisions log — leaving it alone was the smaller change).

**Implemented exactly the shape already agreed**: three columns on `requests` (not a separate `request_links` table — see the "Settled" section of the Week 3 plan), `events`' missing read policy, and `issue_request_link`/`get_request_by_token` as `SECURITY DEFINER` functions following CLAUDE.md's Database section pattern (hashed token, generic failure message, multi-use logged via `events` rather than consumed).

**One addition beyond the plan: `revoke_request_link`.** The plan named two functions; a third followed from a gap noticed while writing the first two — `link_revoked_at` is a column `get_request_by_token` already checks, but nothing anywhere would ever set it without this. Added rather than left as a column with no path to a value. Day 4's actual UI can still decide later whether to expose a Revoke control to the owner; this only makes the capability exist.

**events grant, not just the policy.** Migration 002 fully revoked table-level privileges on `events` from every client role ("Supabase grants table privileges to anon/authenticated by default, so this must be explicit"). An RLS policy alone doesn't undo that — added `grant select on events to authenticated` alongside the new policy, or the policy would have been silently inert.

**30-day link expiry — flagged, not discovered.** Nothing in the PRD specifies a lifetime for this link (distinct from the 1-hour sign-in magic link). Chose 30 days because Dialog "continues over days or weeks" (CLAUDE.md's own wording) and a Request's Due Date is usually inside that window — a reasonable default, not a requirement anyone stated. Called out in both the migration's own header comment and `WYP_Week3_Plan.md` for confirmation before running.

**Scope held at Day 1.** No screen was touched — `get_request_by_token`/`issue_request_link` have no caller yet. `/r/[token]` (Days 2–3) and the Request Detail "get a link" affordance (Day 4) are still ahead, along with `submit_request_response`, which needs the response screen's actual fields decided first rather than being guessed at now.

\---

## 2026-08-09 — Time Zone browse-on-focus bug fixed

Owner: *"The time zones on Add Contact and Contact Detail are correctly selecting my time zone. However, if I wanted to change it for a contact, there are no other values shown in the pull-down except the selected one."*

Root cause: the field always arrives pre-filled with a real, non-empty value (the defaulted zone), unlike Category — the field this pattern was copied from — which always starts blank. The dropdown's filter, "show everything only when the query is empty," never saw an empty query in practice, so focusing the field filtered the full zone list against the already-selected zone's own name and showed only that one match.

Fixed the same way in all three affected places — `AddContactForm.tsx`, `ContactDetailForm.tsx`, and the Create Free Account mockup's demo script (the no-contact-dialog mockup was unaffected; its field starts genuinely blank) — with a `browsing` flag: true from focus (regardless of what's currently in the box) until the user types a character, at which point it drops and normal substring filtering takes over. Also select the field's text on focus, so the first keystroke replaces the prefilled value instead of appending to it and immediately filtering to nothing.

\---

## 2026-08-09 — PRD v12.8: §9.5 Archive Requests and ToDos added to the Future Features Roadmap

Owner: *"This should be added to a list of things yet to do: A capability not discussed yet... the ability to 'remove' completed Requests and ToDos from the list of items shown in the main screen, but keep them available when Searches are done..."* — followed by a fairly complete first-pass design (Archive screen, select-by-type-and-prior-to-date, pre-checked list, Detail-screen editability affecting eligibility, Archive Now / Remove Archive Status chips, and the schema need).

**Landed in the PRD, not a new backlog file.** §9 "Future Features Roadmap" already exists for exactly this purpose ("defined for future phases... not in scope... but architecturally considered to avoid rework") and already holds four sibling entries (§9.1–§9.4) in the same short-paragraph format. Adding §9.5 there uses the mechanism the project already has rather than starting a second, competing list.

**Marked "Not yet phased"** rather than guessing Phase 2 (the label most of §9.1–§9.3 carry) — nothing here was discussed against the phased roadmap in §10, so assigning a phase would be inventing a scope decision, not recording one.

**Version bumped to v12.8** — title page, both footers, and a new Schedule A revision-history line. TOC on page 1 still shows the pre-edit page numbers/entries (a cached field — Word regenerates it on Update Field / F9, not something worth hand-editing in the XML). `docs/WouldYouPlease_PRD_v12_7.docx` deleted (via the file-delete permission flow) now that v12.8 replaces it, matching the project's one-file-per-version convention; v12.7 was already committed to git, so nothing was lost. **The Project's own "Canonical sources" list still says v12.7 — that line lives in Claude.ai Project settings, not a repo file, so it needs updating by hand along with re-uploading the new docx to project knowledge**, per the Maintenance rule.

\---

## 2026-08-09 — Time Zone: migration 007 drafted, wired into Add Contact/Contact Detail, mockups upgraded

Closes the Week 2 open item flagged earlier the same day: *"`profiles.time_zone` and `contacts.time_zone` columns need to be added to their respective tables. `AddContactForm.tsx`/`ContactDetailForm.tsx` should render the Time Zone field (which is shown as required) with all available Time Zone names as a pull-down option, but default the selection to the time zone of the User (`profiles.time_zone`)."*

**Migration 007 (drafted, not yet run)** — `docs/Week3 - SQL history.txt`. Both columns nullable, no DB-level constraint: matches Category's existing precedent (§2.3's "must be selected from the list" rule is client-side, not a check constraint), and there's no data to backfill from the way `contacts.display_name` had (migration 005).

**Time Zone list**: `app/src/lib/timeZones.ts`, backed by `Intl.supportedValuesOf('timeZone')` — every IANA zone name, displayed and stored as the raw id ("America/Chicago"), not a friendly label. No standard-library mapping to a friendly label exists without hand-maintaining one for 400+ entries, and raw ids are what the mockup's own pre-existing comments already pointed at (`profiles.time_zone` / `contacts.time_zone`). This does diverge from the Create Free Account mockup's old decorative value ("Central Time (Chicago)") — flagged in that file's own comment, not silently changed.

**Field wired as a required §6.16 lookup**, same shape as Category — filtered text input with a `selectedTimeZone` guard, not a native `<select>`, for visual consistency with the Recipient/Category lookups already in the app. Always type-to-search (the list is far past the 12-item "browsable on focus" threshold used elsewhere).

**Defaulting chain, and the write-back decision.** Add Contact: the owner's own `profiles.time_zone` if set, else the browser's detected zone. Contact Detail: the contact's *own* stored zone takes priority (it may already have one from a previous Save); if not, same fallback chain as Add Contact. In both cases, if the chain had to fall all the way to browser detection, that value is also written back to `profiles.time_zone` — a decision made and flagged, not silently added: `profiles.time_zone` has no other live path to a value right now (see below), so without this write-back it would never settle into a stored value at all. Revisit if this feels like the wrong screen to own that side effect once a real Account screen exists.

**Create Free Account and the no-contact-dialog mockups got the matching demo-JS pull-down** for consistency, even though neither is a live React component. Flagged plainly, not silently discovered later: **Create Free Account is not reachable in the live app.** `/login` handles both sign-in and first-time account creation with no separate signup step — its own copy tells the user as much — so `/account/new` has no wiring path today. This means `profiles.time_zone` currently only ever gets a value via Add Contact/Contact Detail's fallback-and-write-back, never from a screen actually about the user's own profile, until Create Free Account is converted and wired into a real first-run step or the (explicitly deferred) Account screen is built.

\---

## 2026-08-09 — Migration 006 confirmed run; Week 3 plan scoped and two design questions settled

**Migration 006 (`dialog.replies_to_id`) confirmed run by the owner.** This closes out the one unverified risk flagged repeatedly across Request Detail, ToDo Detail, and CLAUDE.md's Known gaps — both screens' Dialog panels were a hard, unconfirmed dependency on it. Language updated in CLAUDE.md and `design/README.md` from "hard dependency, not yet run" to confirmed.

**Week 3 recommendation: the secure recipient link (`/r/[token]`)**, on the grounds that CLAUDE.md's own Scope discipline already gated it on "the stack proven on Add Contact" — now true several times over — and the Database section already describes the intended shape in prose. Full plan in `docs/WYP_Week3_Plan.md`. Two of that plan's open questions were settled the same day it was written:

- **No name collected from the recipient before responding.** Owner: *"the response needs to be as frictionless as possible."* The anonymous responder's Dialog `who` will show the Request's own Contact name (already known server-side) rather than asking the visitor anything.
- **Token storage stays the simple shape — columns on `requests`, not a separate `request_links` table** — after talking through when a separate table would actually earn its keep: link *history* (a UI showing every link ever issued for a Request) or distinguishing, in the access log, which specific link-version a given open used. Neither is a stated requirement anywhere in the PRD, and an old, regenerated token already fails verification on its own (its hash no longer matches), which is the security property that actually matters. Revisit only if a link-history feature gets asked for later.

\---

## 2026-08-09 — Sixth round: Main Screen chip state persists across the round trip

Owner, following directly from the scroll-position fix above: *"It would be appropriate to return to the same chip state on the main screen."* This was the trade-off already flagged (not yet solved) in the Fifth round entry below — `router.back()` restores scroll position, but Main Screen still remounts, so its filter-chip `useState` was resetting to defaults on every trip to a Detail screen and back.

**sessionStorage over the two alternatives considered.** Lifting the state into the URL as search params (the fix floated when the trade-off was first flagged) would have worked but meant every chip click rewriting the URL/history — more moving parts than the ask required. Cache Components/`<Activity>` was re-considered and re-rejected for the same reason as the Fifth round entry: it would preserve chip state for free, but at the cost of Main Screen no longer re-fetching on return, which would show stale post-edit data — a worse bug than the one being fixed. Landed on `sessionStorage`, matching the existing precedent in `supabaseClient.ts` (`REMEMBER_KEY`/`hybridStorage`, which already routes the Supabase session between `sessionStorage` and `localStorage` depending on "Keep me signed in"). Used `sessionStorage` specifically, not `localStorage`: this is a within-session view preference, not a durable account setting, so resetting when the tab actually closes is correct behavior, not a compromise.

**Scope: the three chips, not the search box.** Persisted the Sent filter, ToDos filter, and Housekeeping's Tasks/How-to Videos tab — matching the owner's own wording, "chip state." The search text field is a separate control and was left unpersisted. This is a scoping call on my part, not something the owner confirmed either way — flagged in the code comment and in CLAUDE.md in case it turns out search should persist too.

**Implementation shape.** Three `sessionStorage` keys (`wyp.mainSentFilter`, `wyp.mainTodoFilter`, `wyp.mainHkTab`), read via a small `readStoredChip` helper used as each `useState`'s lazy initializer (guards `typeof window === 'undefined'` and falls back to the mockup's resting default — All-open-ToDos, All Sent, Tasks tab — for any missing or invalid stored value), and written back with a `useEffect` per chip whenever it changes.

\---

## 2026-08-09 — Fifth round: Contacts list Close button + rename, Add Contact's return destination, scroll-position restoration on Detail screens

**Close button on the Contacts list, plus a same-day rename.** Owner asked for a Close (secondary) button next to Add Contact, then reasoned through the consequence himself before I could: *"That will probably cause an undesired line break on my Android, so the screen title would need to drop the 'My' to be sure the line break does not occur."* Applied — title band now reads "Contacts", not "My Contacts". He then generalized the reasoning into a standing rule: *"I like to have a navigation always repeat exactly what the choice was named when selected."* Since the destination screen is now titled "Contacts," the Housekeeping row that opens it has to say "Contacts" too, not "My Contacts" — applied to `WYP_main_screen_palette1.html` and `MainScreen.tsx`. **And, for consistency, "My Account" → "Account"** — the owner's own words: *"from a consistency perspective, the Task 'My Account - view and edit' will also have to be changed to 'Account - view and edit.'"* This reverses the "Your Account" → "My Account" rename from earlier the same day, on entirely different grounds (nav-label-matches-destination-title, not "impersonal wording") — not a silent flip-flop, a second decision superseding the first for a different reason, both recorded here rather than only the latest one kept.

**Add Contact's post-Save destination.** Owner: *"When a contact is added from the Contacts list and saved, the process now returns to the main screen - it seems it should return to the Contacts list (as is done for an edit of a Contact from that list)."* Changed both Save and Cancel to return to the Contacts list. Reasoned past the literal ask to also fix Cancel, not just Save: the only current entry point to `/contacts/new` is the Contacts list's own Add Contact button, so Save landing on the list while Cancel landed on the Main Screen would have been a new inconsistency of its own. Flagged in code that this assumption breaks if a second entry point (Create Request's not-yet-built no-contact interception) starts reaching Add Contact — that path will need its own return address.

**Scroll position after editing a Request or ToDo — a genuinely new question, not implicit in anything asked before.** Owner: *"When I edited a ToDo I was returned to the top of the main screen instead of to where I have edited the ToDo."* Investigated two paths before choosing:

1. **Next 16's Cache Components / `<Activity>` feature** (`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`) — opt-in via `cacheComponents: true`, keeps a route's whole component tree mounted (hidden, not unmounted) across navigation, preserving both DOM and React state automatically. Rejected: it's an experimental, app-wide config flip with a broad blast radius for a single-screen complaint, and it would have made things *worse* here — a hidden, still-mounted Main Screen wouldn't re-run its data-fetching Effect on return, so the just-edited row would show its pre-edit values until some other refresh happened.
2. **`router.back()` instead of `router.push('/...')`** on Request Detail, ToDo Detail, and (by the same reasoning, applied without a separate ask) Contact Detail. Every one of these screens is reached exactly one way — clicking a row on its parent list — so `back()` always returns to the correct history entry. Next's browser-history-based scroll restoration is standard, always-on App Router behavior, unrelated to Cache Components, and the parent screen still fully remounts and refetches on the way back (no Cache Components enabled), so the edited data shows correctly rather than stale. Chosen over option 1 for being smaller, standard, and actually more correct for this specific "did the data change" scenario.

**Trade-off flagged, not silently absorbed**: `router.back()` restores scroll position but not Main Screen's filter-chip/search `useState`, since the component does remount (just not by reloading the URL from scratch) — those reset to their defaults each time. Not raised as a problem to solve now, since the owner's complaint was specifically about scroll position, but noted in CLAUDE.md in case it matters later (fix would be lifting that state into the URL as search params, which Cache Components' Activity model would also have handled automatically had rejecting it not cost the data-freshness property above).

\---

## 2026-08-09 — Fourth round: Create ToDo, Request/ToDo Detail, live filter/search, Contact Detail, My Contacts

Owner's ask, in order: finish the three items proposed at the end of the previous round (Create ToDo live, Sent/ToDo rows wired to their Detail screens, Main Screen's filter chips and search made functional), plus a new ask surfaced in the same message — a Contact Detail screen ("exactly the same as Create Contact except for the screen title"), a redesigned My Contacts list ("should show the name, notify method and related value... upon click open up a Contact Details screen for editing"), and a Housekeeping wording fix: *"'Your Account' — 'Account' seems a bit impersonal for this app. So, I think we should change 'Your Account - view and edit' to 'My Account - view and edit'."* The related "My Account" screen itself was explicitly deferred: *"should await further product evolution before being designed."*

**ToDo Detail's Done Date/Time — asked, not assumed.** Wiring ToDo Detail live as originally specified (a byte-for-byte duplicate of Create ToDo, no Done fields) would have meant a real screen with no way to mark a ToDo complete through the UI at all — the same gap Request Detail's Done Date/Time row was added to close a day earlier. Rather than silently repeat that fix or silently leave the gap, asked directly via AskUserQuestion; owner picked adding the row. Applied to both the mockup and `TodoDetailForm.tsx`.

**ToDo Detail's Dialog panel changed to the existing-thread pattern without a separate ask.** Once Done Date/Time was settled, converting the Dialog section from Create ToDo's blank staged list to Request Detail's real-thread-plus-dynamic-Answer pattern followed from the same underlying reasoning already accepted for Request Detail (a Detail screen views something that already exists, so its Dialog should too) — not something a reasonable reading of "add Done Date/Time" would leave out, but flagged clearly in both the mockup's header comment and this entry rather than folded in silently.

**Request Detail and ToDo Detail's Dialog panel: write-through, not staged.** Unlike Create Request/ToDo, where a Dialog entry can't be written until the parent row has an id, a Detail screen's Request or ToDo already exists — so Add Dialog's Save writes straight to the `dialog` table and the panel re-fetches, rather than waiting for the screen's own Send/Save. Chosen so a Dialog entry survives even if the user backs out of the rest of the edit with Cancel; the alternative (staging Dialog alongside the Detail form fields) would have made a real, already-visible conversation entry vanish on Cancel, which reads as data loss, not a discard.

**Create ToDo's missing Due Date — flagged, not fixed.** While building this out live, confirmed the Create ToDo mockup has never had a Due Date field, despite the PRD's core-objects table listing ToDos as having an optional due date and `requests.due_date` being a real, already-populated-by-seed-data nullable column. Left it out of `CreateTodoForm.tsx` to match the approved mockup — inventing a field the mockup doesn't draw would be the same mistake in the other direction — and surfaced the gap in `design/README.md` and `CLAUDE.md` instead of picking a side unasked.

**Contact Detail: Save + Close, not Save + Cancel.** The owner's instruction was "exactly the same as Create Contact except for the screen title," but Cancel's actual meaning throughout this app is "discard what I was about to create" — Storage Maintenance and Dialog Detail already use Close for "leave an existing/read screen," and Contact Detail is editing something that already exists. Applied Close instead of copying Cancel verbatim, since a literal reading here would have reused a button whose established meaning doesn't fit; flagged as an interpretive call rather than assumed to be exactly what "the same except the title" meant.

**Contact Detail surfaced a pre-existing, unrelated gap**: Add Contact's mockup has drawn a Time Zone field since 2026-08-05, but it was never wired into `AddContactForm.tsx` (no `contacts.time_zone` column exists in any migration) — a gap from a prior session, not this one. Rather than propagate it silently to a second mockup, `ContactDetailForm.tsx` mirrors `AddContactForm.tsx`'s actual live fields (Name/Email/Phone/Notes) and the gap is now flagged explicitly in both docs files, since it's more visible with two mockups showing a field that does nothing than one.

**My Contacts reuses the Housekeeping row component (§6.23) rather than inventing a new list style.** The owner's spec — name, notify method, the matching email-or-phone value, tap to open Detail — is structurally identical to what `.hkrow`/`.hktitle`/`.hknote` already does for Housekeeping's own navigational rows. Built as `<b>Name</b> — Email: address` (or `Text: phone`), sorted alphabetically by `display_name` like every other lookup in the app.

**Filter chips and search: client-side over already-fetched rows, no new queries.** Same reasoning as the Recipient/Category lookups elsewhere — both lists are personal-scale, so filtering and searching in memory avoids a round trip per click or keystroke. ToDos' filter defaults to Open selected (not All), matching the mockup's own resting state, which had been noted but not re-verified when the chips were first built inert.

**Scope button ("All ▼") stays visual-only.** It has never had a designed picker (see the 2026-08-07 "Main Screen's search bar kept exempt on purpose" entry), and since search now runs across both Sent and ToDos at once, there's nothing yet for a scope to actually narrow — making it interactive would mean designing a feature nobody asked for.

**"My Account" — wording only, screen still undesigned.** Owner's reasoning, verbatim: *"'Account' seems a bit impersonal for this app."* Applied to the Main Screen mockup and `MainScreen.tsx`; the row stays inert, since the owner explicitly said the Account screen itself should wait for further product evolution rather than be designed now on the back of a label change.

\---

## 2026-08-08 — Third round: Main Screen converted to React, the first Live landing screen

Owner's request: *"I think we are now ready to begin the REACT addition to the main screen... I would like to see the WYP app retain the device-login validation and be able to test it in a more normal way than needing to each time fill-in the URL after starting up and logging in each time."* `app/page.tsx` had been rendering a placeholder ("Logged in ✅") since the auth work was built — everything downstream of sign-in (magic link, `/auth/callback`, `RequireAuth`, "Keep me signed in") already worked, but there was nowhere real to land, so testing the login loop meant hand-typing a route every time.

**Received surfaced a real architectural gap, not a build task.** `requests` RLS (migration 003) is owner-only — `owner_id = auth.uid()` — and no column links a row to its recipient's own account, so there is currently no query a signed-in recipient could run to see "Requests sent to me." Raised this directly rather than faking it or silently building around it. Resolved by scoping this pass to Sent and ToDos only; Received renders a plain explanatory `.subempty` note (new, §6.29) instead of either fabricated demo rows or an empty space that would read as a loading bug. The actual fix — some combination of a recipient-side query path or a `SECURITY DEFINER` function, matching the pattern already used for the anonymous `/r/[token]` link — stays an open, unscheduled decision.

**Scope for this pass, settled over two rounds of questions rather than assumed:**
- Asked whether demo data would be seeded or the screen would start empty; the owner's answer doubled as the deciding vote for the next question — *"If there will be Requests and ToDos, then the sort pills would be helpful"* — so Sent/ToDos needed to be genuinely live, not just visually converted.
- Asked whether the search bar and the All/Open/Overdue/Done (ToDos: All/Open/Done) filter chips should also go live now. Owner picked **"Stay visual-only for now"** — they render but do nothing this pass.

**Sort pills are real, not decorative.** Sent's `Due ▼` pill reflects an actual `order('due_date', { ascending: false })` query; ToDos' `Priority ▼` reflects `order('priority', { ascending: true })`. No click-to-resort was requested or built — the owner asked only that the pills' claim match the data, which the default query order now does.

**Three controls are inert on purpose, not by oversight, because they have nowhere to go yet**: the ToDos band's Create ToDo button (`/todos/new` doesn't exist — Create ToDo is still Mockup-only per `design/README.md`), and Housekeeping's My Contacts / Your Account rows (no contacts list view and no `/account` route exist). Left visually normal rather than `.is-locked` — that treatment specifically means "unavailable because of the request's tier" (§6.22), which isn't the reason here, and using it would misstate why the control does nothing.

**Log Out was built live, not left inert like the rest of Housekeeping.** It's the one control that directly serves the reason this screen exists: without a working sign-out, there's no way to re-run the login loop the owner asked to be able to test "in a more normal way." `supabase.auth.signOut()` followed by a redirect to `/login`.

**Icons converted to inline SVG, matching every other screen** — the mockup's base64 PNG data-URIs were never going to carry over. Shapes came from the canonical `wyp_icon_*.svg` source (Dialog, Expand, Search, Voice Search — recolored to `currentColor` so `.iconbtn`/`.ii`'s existing hover/rest colors drive them, rather than the asset source's hardcoded brand-blue/grey), except Print, which reuses the exact icon already built for Create Request / Request Response rather than the asset source's own printer glyph — one printer icon in the app, not two slightly different ones. Attachment's info icon was not built: Attachments stays deferred app-wide (Scope discipline in CLAUDE.md), so there is nothing yet for that icon to indicate.

**Seed script, not fixture data baked into the component.** Wrote to `docs/Week2 - SQL history.txt` (Contacts, Sent Requests, ToDos, under `jimgillon@gmail.com` specifically, looked up by email inside the script) for the owner to run himself, matching how every schema migration in this project has been handled — nothing runs against the live database except by his own hand. Not a numbered migration, since nothing in it alters a table. Guarded to be safely re-runnable (existence-checked before each insert, since `contacts`/`requests` have no unique constraint to lean on the way `categories` does) and dated relative to `CURRENT_DATE` rather than hardcoded, so the Open/Overdue/Done mix stays meaningful whenever it's actually run.

**Alternative considered and rejected**: snapshotting a fake "Received" section from the same seed data, styled as if it were live, to make the screen look more finished. Rejected — it would have misrepresented a genuine schema gap as a solved one, and the first time a real second account tried to use it, it would silently show nothing.

\---

## 2026-08-08 — Second round: ToDo Detail; non-modifiable-as-text rule (§6.28) across four screens; Done Date/Time on Request Detail; Display Name wording; Change Email button; "Request Response" rename applied

Same day as the first Detail-screens round, after the owner reviewed the results and uploaded reference screenshots.

**"Request Response" — applied.** The owner's reason this time was explicit and unrelated to the earlier wrap finding: consistency with Request Detail / Response Detail / Dialog Detail's naming, stated directly as *"unrelated to word-wrapping."* That's a different justification than the one already tested and rejected on 2026-08-07, so this isn't a silent reversal — it's a new decision on new grounds, superseding the "flagged, not applied" entry above. Band label and `<title>` changed in `WYP_respond_to_request_palette1.html`; filename unchanged, same precedent as "Create a Request" → "Create Request." All README/decisions-log prose references updated to match.

**Non-modifiable values render as text with a field title, never inside a boxed field — new rule, §6.28.** Owner's instruction, referencing Request Response's own Date:/From:/Due: meta block as the existing proof this already worked: *"consistently show non-modifiable values as text with data field titles... as is now done for Respond to Request."* This retires the `.finput[readonly]` + dashed-border-and-`--locked`-fill variant introduced for Your Account's Email a few sessions back and copied to Create Free Account and (a day earlier) Request Detail's Recipient — all three now read as `.metarow`/`.mlabel`/`.mval`, reusing the exact component already sitting on Request Response rather than inventing a label:value component under a new name. The icon that used to justify Your Account's boxed-and-locked Email (a small padlock SVG next to the explanatory sentence) is dropped along with the box — an icon earns its place explaining *why a field looks disabled*; plain text next to plain text needs no such explanation. Request Detail's Recipient also drops its own explanatory `.lockrow` note ("The Recipient of a sent Request can't be changed") as redundant once there's no box to explain and the notice band above already says why an edit here matters.

**Dialog Detail rebuilt same day**, not just re-skinned: the owner reviewed the chip-row version (built read-only that morning, `<span>`s not `<button>`s) and called it *"very readable as originally designed"* but a break from the new text-only rule, since a chip row is still a field-shaped control regardless of what it's built from. Replaced with the value doubling as its own label — "Answer:" in bold Brand Blue — over a horizontal rule. The owner's own reference sketch used an underline under the word and offered the rule as an alternative explicitly: *"the underline... would probably be a horizontal rule."* Built as a full-width `.dlghr` line in the neutral Rule color, not Brand Blue — `.dlgtype` already carries the emphasis, and a second blue element felt like the rule repeating the label's job. Date/From converted to the same `.metarow` pattern used everywhere else in this round. Dialog Text's own label was dropped entirely — once the value sits directly under a rule with nothing beside it, a second "Dialog Text" caption above the actual text was reporting the obvious.

**Request Detail gains an editable Done Date/Done Time row.** Owner's reasoning: *"the requestor may want to update the request as completed."* Given the same box treatment as Due Date/Due Time immediately above it — both are genuinely settable here, unlike Recipient, so neither belongs in the new text-only pattern. Row-Tinted while empty like any other optional field; both labels carry "(optional)" for consistency with the rest of the screen's convention, even though the owner's own reference sketch showed "Done Date" without the suffix — a small, flagged deviation rather than a silent one.

**ToDo Detail built as a byte-for-byte duplicate of Create ToDo, retitled.** Owner's instruction was explicit: *"the only difference with the Create ToDo screen is the screen title."* Kept as its own file rather than any kind of shared template, matching how every other screen pair in this app (Create Request / Request Detail, Request Response / Response Detail) is two self-contained files, not one parameterized one.

**Wording fixes, applied verbatim from the owner's message**: "Recipients see this name on every request you send." → "Recipients see your Display Name on every request you send." (Create Free Account and Your Account, both — the caption under Display Name). Email's explanatory note also changed, on both screens, from the older two-sentence version ("This is where your sign-in links are sent. Changing it requires confirming from both addresses.") to the shorter "Your email address is also your sign-in ID." — matched to the owner's own uploaded reference images, which showed this exact wording on both screens; not separately called out in the numbered list, so flagging the match here in case it wasn't an intended change.

**Your Account gains a "Change my email address" button**, `.btn-quiet`, next to "Sign out on this device" — same low-emphasis treatment, same row. Not wired to anything: the owner was explicit that the actual change-email flow ("the related dialog/screen with appropriate explanations") is still to be designed. The detail that used to live in Email's old two-sentence note (confirming from both addresses) is exactly the kind of explanation that flow will need to carry once it exists — noted here so it isn't lost now that the sentence itself is gone.

**Main Screen**: Housekeeping's "Account Profile" task row renamed to "Your Account" — matches the screen it now points at.

\---

## 2026-08-08 — Detail screens (Request Detail, Response Detail, Dialog Detail); Main Screen Tasks/How-to Videos chips; "Respond to Request" rename flagged, not applied

Owner's presumption: clicking an entry to edit its detail opens screens shaped like the ones already built — Add Dialog → **Dialog Detail**, Create Request (Sent) → **Request Detail**, Respond to Request (Received) → **Response Detail**. Built all three as new mockups.

**Request Detail** (`screens/WYP_request_detail_palette1.html`) is Create Request's mockup with the Recipient field switched to read-only (§6.10 locked variant, ported from Your Account's Email — dashed border, `--locked` fill, a `.lockrow` note explaining why, same pattern, not layered with `.req` since the locked treatment is already the stronger, more specific signal) and every other field pre-filled with demo data instead of blank. New notice band directly under the title band, Strip background — the owner's own comparison ("like a chips background"): **"Note: The Request Recipient is notified of changes."** Action buttons stay Send/Cancel, unchanged, per the owner's explicit instruction — Send still means "commit this change (and notify)," not merely "save." One thing worked out rather than asked: Request Detail's Add Dialog uses the *dynamic* Kind-locking (open-Question rule, migration 006) from Respond to Request, not Create Request's permanent Answer-lock — a Request already sent can already have an open Question waiting on the issuer, so Answer has to be reachable here, unlike at creation time when the thread is provably empty.

**Response Detail** (`screens/WYP_response_detail_palette1.html`) is Respond to Request's mockup, retitled, for a signed-in user reached from inside the app rather than the anonymous `/r/[token]` link. Same fields, same dynamic Add Dialog. Dropped the "Create your own Free Account" `.promo` block — whoever's looking at this screen already has an account, so the pitch has no one to persuade. Kept the subscription-upsell `.subbanner`, which isn't specific to the anonymous flow. Shares its demo Dialog thread verbatim with Request Detail (same four entries, same ids) so the one demo Request reads identically from both the sender's and recipient's side.

**Dialog Detail** (`screens/WYP_dialog_detail_palette1.html`) is deliberately **read-only**, not just unfinished. The owner asked for something shaped like Add Dialog; the `dialog` table has no UPDATE or DELETE policy — append-only by design since migration 004, specifically so a past Question/Answer/Comment can't be quietly rewritten. Editing an existing entry from a "Dialog Detail" screen isn't something the schema supports today, so this was built as a viewer: the same Dialog Entry Type chip row and Dialog Text box as Add Dialog, but chips are plain `<span>`s (not `<button>`s — nothing here is clickable, and a disabled-looking button still invites a tap) with only the entry's actual kind marked, and Dialog Text renders in the same locked/dashed treatment as a readonly field. Single Close button, Primary (same "only button on the band" call as Storage Maintenance, 2026-08-07). **Flagging this rather than silently deciding it**: if Dialog entries should become editable, that's a schema decision (an UPDATE policy — probably versioned/audited rather than a plain overwrite, given the whole point of append-only was an honest thread) that needs to be made on purpose, not backed into by building a form.

**Main Screen: Housekeeping's "Tasks" label became a two-chip toggle** — "Tasks" (default-selected) and "How-to Videos" — reusing the screen's own existing `.chips`/`.chip`/`.chip.sel` pattern already used for the ToDos filter row (this screen predates the app-wide `.chip.selected` naming and wasn't otherwise being touched, so `.sel` was kept rather than reconciled). Tasks' content (My Contacts, Account Profile) is unchanged. How-to Videos is new and currently placeholder titles only ("Getting Started," "Creating a Request," "Responding to a Request") with no real video content or links — out of scope for this pass, flagged in the row markup and here so it isn't mistaken for finished content later.

**Flagged, not applied: renaming "Respond to Request" to "Request Response."** The owner asked for this "for consistency with the new [Detail] screen names." This is the exact rename tested and rejected on 2026-08-07: *"'Respond to Request' is unchanged — confirmed it would still wrap either way"* (the owner's own on-device finding, Android, current 23px wordmark). Nothing about title width has changed since. Rather than silently reintroduce a known wrap or silently ignore the request, left "Respond to Request" as titled and surfaced the conflict for a decision — accept the wrap, explore the wordmark/title sizing further, or leave it as-is for naming-consistency's sake despite the mismatch with the three new Detail-screen names.

\---

## 2026-08-07 — Seventh round: Add Dialog modal, dynamic Answer locking, which-Question picker, migration 006

Owner pasted a rough mockup of an "Add Dialog" modal (title + Cancel/Save on one row, a Question/Answer/Comment chip row, a Dialog Text box) meant for Create Request, Create ToDo, and Respond to Request, and later Request Detail. Resolved over several messages into the following.

**Kind availability is per-screen, not one fixed rule.** Asked the owner directly (two-part AskUserQuestion) rather than guess: on Create Request/Create ToDo, all three chips were first said to be "unlocked" — refined immediately after to Answer being *always* locked there specifically, not just unlocked-with-nothing-to-answer, since "the 'answer' could not be the 1st entry, but either a question or a comment could be" and a Request/ToDo's thread is always empty at creation. On Respond to Request (and later Request Detail), Answer is dynamic: locked unless at least one Question in the thread is still open.

**"Open" needed a real definition once more than one Question could be in play.** A single flag ("has the most recent Question been answered") only works for one open Question at a time; with two or three open at once it can't say which is which. Added `dialog.replies_to_id` (migration 006, SQL in `docs/Week2 - SQL history.txt`, not yet run) — nullable, CHECK-constrained to answer-kind rows only, `on delete set null`. A Question now counts as open exactly when no Answer's `replies_to_id` points at it.

**Which-Question picker, scoped exactly as asked**: "it does not make using the app harder for an end-user — however it only needs to be presented if there is more than one question in the dialog. And, if there is more than one question, the last question should default to the selection." Implemented literally — one open Question links silently (no picker, no extra tap); two or more shows `.qpicker` (rows styled with `.lookup-item`, new `.selected` variant since this list stays visible after a pick rather than closing like a lookup dropdown), defaulting to the most recently created open Question. Read "more than one question" as "more than one *open* question" — the only reading that stays consistent with Answer's own locking rule, since a fully-answered Question is never a candidate for a new Answer to point at in the first place; flagged here in case a different reading was meant.

**Display order does not change.** Confirmed with the owner before building anything ("That strategy would keep the 'order of entry' true...") — an Answer still renders wherever it was actually posted in the newest-first list (2026-08-05's sort rule, untouched), not moved next to the Question it answers. The link is informational, not structural.

**Answer entries get a "Re:" quote and a bolded body**, per the owner's own suggestion: "smaller font repetition of the question, as a 'Re: ...' with a different colored/bolded or sized answer text." Built as `.dlgre` (11px italic Ink Soft, single-line ellipsis — matching `.attach`'s filename truncation, not the 2-line/3-char Description rule, since this is a compact inline quote) followed by `.dlgbody` (bold). **Bold chosen over color**: Brand Blue already carries dates, links, and (via `.dlgkind`'s weight) kind labels; Alert Red is status-only from v2.5 (§3.1). Adding a fourth meaning to an existing color risked diluting one of those; bold reuses emphasis language the system already has. Flagging the alternative in case color was actually wanted.

**Modal gained a second header shape.** `.modalhead` — title and Cancel/Save share the top row — sits alongside Add Category's existing title-then-bottom-`.modalacts` layout as a second valid §6.12 variant, not a replacement; used because that's what the owner's own Add Dialog mockup draws. Chosen per modal going forward rather than forcing one shape everywhere.

**Create Request's Dialog field changed shape**, not just gained a modal: the old always-visible inline textarea (Add Dialog appended its text directly, 2026-08-06) is gone. Add Dialog now opens the modal, matching how Add Category already works; a saved entry appears in the `.dlgstaged` list below, now labeled with its Kind (`<b>Question:</b> ...`). `CreateRequestForm.tsx`'s `dialogEntries` changed from `string[]` to `{kind, body}[]`, and the Send handler now writes `kind` explicitly on each insert instead of relying on the table's `default 'comment'`. Create ToDo's mockup got the identical change for consistency, even though it isn't live yet.

**Addendum, same day**: the chip row's label reads "Dialog Entry Type," not "Kind" — owner's correction after reviewing the built modal. Visible label only; the underlying `kind` column/variable name is unchanged (`dialogModalKind` in `CreateRequestForm.tsx`, `dlgKind` in the mockups' JS, `dialog.kind` in the schema) since none of those are user-facing.

**Respond to Request's demo data was rewritten to actually exercise the feature** — two open Questions by default (`"Should I also include George?"`, already answered; `"Do you have enough time next week to accomplish this request?"` — the owner's own example wording, kept verbatim; `"Should the meeting be in-person or a video call?"`) — so a reviewer opening the mockup sees the which-Question picker's multi-question branch immediately rather than only after clicking through several Adds. The whole flow (chip locking, picker, staged Answer, `.dlgre`/`.dlgbody`) is real vanilla-JS state in this mockup, not static markup, since a picker that only exists in a comment isn't demonstrable.

\---

## 2026-08-07 — Sixth round, small: Add Contact's Notes field was missed in the §6.25 sweep

Owner caught one the previous round's audit didn't: Notes (optional) on Add Contact was still plain white — the decisions log's own note from two entries back ("not applied to Add Contact's Notes... left alone rather than changed speculatively") turned out to be the gap, not a considered exception. Given `.opt` is now the established rule for every other optional field on this screen (Phone, country code), there was no remaining reason to leave Notes out. Added `.opt` to the textarea in `AddContactForm.tsx`, both Add Contact mockups, and extended each mockup's local `.opt` rule to cover `.ftextarea` (it previously only listed `.finput`/`.ccode` — `globals.css` already covered `.ftextarea.opt` from Create Request, so only the mockups needed the selector added).

\---

## 2026-08-07 — Fifth round: rule-consistency sweep — country-code selector Row-Tinted, required-field Ink borders filled in on four more screens, Done Date/Time on Respond to Request, Sign In's Email; Main Screen's search bar kept exempt on purpose

Owner audit against the §6.25 rule (Row Tint = optional/inactive, Ink border = required) turned up places it had been applied halfway — Phone got Row Tint in the last round but the *required* fields on the same screens never got their Ink border, an omission rather than a decision.

**Country-code selector (`.ccode`) goes Row Tint.** It's a fixed, non-required value (one legal choice, US +1, no picker wired yet) sitting right next to Phone, which already reads as optional — leaving `.ccode` white made it look like the more important of the two. `.opt`/`.opt:focus` extended to include `.ccode` in `globals.css` and all four mockups that have one (Add Contact, its no-contact-dialog variant, Create Free Account, Your Account).

**Required fields on those same four screens get the Ink border they were missing**: Add Contact's Name/Email/Time Zone (mockup and, where live, `AddContactForm.tsx`); Create Free Account's First/Last/Display Name and Time Zone; Your Account's First/Last/Display Name. **Not applied to any readonly Email field** (Add Contact has none; Create Free Account's and Your Account's sign-in-ID Email is `.finput[readonly]`) — that field already carries its own locked/dashed treatment, a stronger and more specific signal than a border color, and layering `.req` on top would muddy two different meanings ("required" vs. "not editable here").

**Respond to Request's Done Date/Done Time get the Ink border in the state the mockup shows.** These aren't `.finput`s — they're read-only `.panel`/`.fieldval` boxes — so a new `.panel.req{border-color:var(--ink)}` was added alongside the existing `.panel{border-color:var(--rule)}` rather than reusing `.finput.req`. This is exactly the "conditionally required" case flagged as a future example in the first Row Tint entry (2026-08-07: "a Done Time if the Done Date is the same as the Due Date and a Due Time was part of the Request") — the mockup's demo data happens to be in precisely that state (Due: Monday, October 19, 2026, 9:00 AM; Done Date: the same Monday), so both panels are `.req` as shown. Flagged in a comment that once Done Date/Done Time become live pickers, `.req` needs to be conditional on that date/time comparison, not permanent.

**Sign In's Email field gets the Ink border.** It's the only field on the screen; `.finput.req` added alongside the existing `.fgroup.is-invalid` rule (which still wins on validation failure — its selector is more specific, same as everywhere else this pattern is used).

**Main Screen's search bar (Search Type, Search text) stays white-on-Band — deliberate exception, not left half-finished.** Owner's own instinct, asked for a second opinion before locking it in. Agreed, for three reasons: (1) the whole point of the Row Tint / Ink Border pair is to let a required field visually win against optional siblings *within one form a person is completing* — the search bar has no Send/Save it's gating, no required sibling to contrast against, and isn't a form at all, so the rule has nothing to apply itself to. (2) Row Tint (`#F6F7F9`) sits close in lightness to the search bar's own Band background (`#E7E7E7`) — tinting the fields would blur their edges against the bar they sit in, weakening the very affordance ("this is a tappable/typeable control") that white currently provides, for a signal ("optional") nobody's asking. (3) The search bar already reads as its own component, not a form field in the §6.10 sense — precedent exists for controls sitting outside the required/optional binary entirely (`.is-locked`, `.btn-quiet`). Recorded as a scoped exception in the §6.25 entry in `design/README.md` rather than left implicit, so a future pass doesn't "fix" it by mistake.

\---

## 2026-08-07 — Fourth round: Dialog label bug fixed, Phone gets Row Tint on three more screens, Storage Maintenance's Close button corrected to Primary

Owner review of the §6.26 restructure (previous entry) turned up a real bug plus three smaller consistency fixes.

**Bug — Dialog's floating label rendered below the box, not overlaid.** Root cause: `.ffloat` on Dialog was a `<span>`, and a `<span>` is inline by default. It worked fine before §6.26 because Dialog's `.ffloat` was a flex child of `.frow.top` — flex children are blockified regardless of their own `display` value, which is what made the absolutely-positioned label sit correctly over the textarea. Moving Add Dialog into its own `.fieldact` row took the `.ffloat` out of any flex container, so the span reverted to genuinely inline, and the label's containing block came out wrong. Every other `.ffloat` on Create Request still lives inside a `.frow` (Recipient, Due Date/Time, Category), so none of them showed this. Fixed by changing Dialog's wrapper from `<span class="ffloat">` to `<div class="ffloat">`, matching how Request Description (never in a `.frow`) was already written — `CreateRequestForm.tsx`, and the Create Request and Create ToDo mockups.

**Dialog's label collapsed back to one line, same font as "Dialog."** The two-line `.subnote` treatment existed to fit "(Questions, Answers, Comments)" in a box that used to share its row with the Add Dialog button. Now that the box is full-width, "Dialog (Questions, Answers, Comments)" fits on one line at the ordinary label size — owner confirmed by comparing it to the wordmark's own width, now 23px, which is roughly the same. Reverted `.ftextarea-dialog`'s extra `padding-top:36px` to the base value (no longer needs clearance for a second line) and removed `.flabel.twoline`, which nothing else in the app used.

**Phone gets Row Tint while it isn't the send-by channel — Create Free Account, Your Account, and (retroactively, for consistency) Add Contact.** Create Free Account and Your Account hadn't adopted `.opt` at all yet; added the rule and applied it to their one optional field, Phone. **Add Contact's case is state-driven, not static**: Phone is genuinely skippable today because Email is the only `send_by` that works (Text stays `.is-locked`), so `AddContactForm.tsx` now reads `sendBy === 'email' ? ' opt' : ''` rather than a hardcoded class — the day Text unlocks and a user actually selects it, Phone becomes the delivery channel and should read as required-in-practice (white, Input Border), which the existing §6.25 empty/filled logic already expresses without a new rule. Both Add Contact mockups (`_floating` and the no-contact-dialog variant) show the current single legal state — Email selected, Phone Row-Tinted — same as Respond to Request's tier demo shows only what today's real states can be, not a speculative one.

**Storage Maintenance's Close button corrected from Secondary to Primary.** It's the only button on the band. `.btn-secondary` means "available, lower emphasis *than a Primary also present*" — Add Category's Cancel next to Save is the paradigm case. With no Primary sibling to be lower emphasis than, the blue-outline Secondary treatment was simply wrong, not a deliberate de-emphasis; changed to `.btn`.

\---

## 2026-08-07 — Header wordmark shrunk to stop wrapping; four screen titles shortened; Dialog/Attachments Add buttons moved above their boxes (§6.26); required fields get an Ink border

Third round of Android-width fixes today, from an owner mockup pasted in against a live screenshot of Create Request. Two things were wrapping that hadn't before: the "Would You Please" wordmark itself (not just the tagline, which was already expected to wrap) and the "Create a Request" screen title.

**Wordmark shrunk 27px → 23px, tagline pulled up 3px → 1px margin-top.** `.word`/`.tag` in `globals.css` plus all eleven live mockups (not the superseded draft). 23px was picked to match `.glabel` — the wordmark and a screen title now read at the same scale, which also reads as more consistent than an arbitrary in-between size. Applies everywhere at once since every live screen already reads these two classes through `WypHeader.tsx`; only the mockups needed a direct edit.

**Four screen titles shortened**, continuing the article-dropping convention already established 2026-07-22 ("Create Request," not "Create a Request," is the name; the shorter form applies where the phrase *names the screen*):

- "Create a Request" → "Create Request" — mockup and the live `CreateRequestForm.tsx` band label. (This was already the documented decision from 2026-07-22; the band label had just never actually been updated to match — a gap, not a new call.)
- "Create a ToDo" → "Create ToDo" — mockup only (ToDo isn't converted yet).
- "Create my Free Account" → "Create Free Account" — mockup, including the quoted screen-name references on the Sign In mockup that point to it.
- "Start my Free Account" → "Start Free Account" — Sign In mockup's band label, its JS mode-toggle, and the demo-switcher button label.

**"Respond to Request" stays as-is** — owner confirmed it would still wrap even as "Request Response," so a rename buys nothing there; not touched.

**Add Dialog / Add Attachment moved off to their own row, above a full-width box — new §6.26, `.fieldact` (Create Request/Create ToDo) and `.panelact`+`.panelfull` (Respond to Request).** The previous side-by-side layout (`.frow.top`, `.attachrow`, `.panelrow`) gave the Add button a fixed width and handed the Dialog textarea or the Attachments file list whatever was left, which starves a full-paragraph field on a narrow phone the same way two name fields did last round. Stacking costs one line of vertical space and returns most of the row's width to the box that actually needs it. Recipient and Category keep their existing `.frow` — a single-line input doesn't have this problem, so only Dialog and Attachments moved. Respond to Request has no `.form`/`.fgroup` wrapper the way the two Create screens do, so its version of the pattern (`.panelact` for the button, `.panelfull` for the panel) carries its own `padding:0 var(--pad)` instead of inheriting it; functionally the same idea, named for what it actually wraps.

**Required fields get an Ink-colored border — `.req`, bundled into §6.26.** Row Tint on optional fields (2026-08-07, earlier entry) didn't make required fields "pop" the way intended, because a *filled* optional field is also white under that rule — required and optional-but-filled were visually identical. `.req` sets the resting border to `var(--ink)` instead of Input Border; still focuses to Brand Blue like every field. **Used the existing Ink token rather than literal black** — the system has no pure-black token, `--alert-red` is reserved for Overdue/error/impending-loss and wasn't a fit, and #1F2933 reads as black at 1px, so this needed no new hex and no §3.1 change. Flagging the substitution here in case a literal `#000` was actually wanted. `.fgroup.is-invalid .finput{border-color:var(--alert-red)}` still wins over `.req` on validation failure — its selector is more specific ((0,3,0) vs `.finput.req`'s (0,2,0)), so no conflict. Applied to Create Request's Recipient, Due Date, and Description (the three fields `validate()` actually requires) and to Create ToDo's Description (its only required field — Priority is chip-based, not bordered, and Due Date is intentionally absent). Not applied to Add Contact, which hasn't adopted the Row Tint/`.opt` scheme at all yet (2026-08-07 note: "not applied to Add Contact's Notes... left alone rather than changed speculatively") — extending `.req` there without `.opt` first would create a required/optional distinction on a screen that doesn't otherwise draw one, so left out rather than expanding scope unprompted. Not applicable to Respond to Request, which has no bordered required inputs.

\---

## 2026-08-07 — Optional-field shading adopted app-wide; secondary buttons re-colored; Log Out relocated again; contacts gain Display Name (migration 005); Add Contact and Create Request's Recipient collapse to a single Name field

Follow-on session, same day as the layout-fixes entry below. Owner confirmed the Row Tint preview worked and gave a full rule plus several more fixes in one message.

**Optional-field shading adopted, with a rule: empty optional → Row Tint, has content → white, required → always white.** Previously only previewed. `.opt` is now a real toggled class, not a static mockup treatment — `.finput.opt`/`.ftextarea.opt` in `globals.css` (Row Tint at rest, Focus Tint on focus, inserted so the focus rule still wins). In the live `CreateRequestForm.tsx`, Due Time, Category, and Dialog each compute `opt` from their own current value (`field.trim() === '' ? ' opt' : ''`) rather than being permanently classed — the background now genuinely tracks content, not just field identity. Applied the same class logic to Create ToDo's mockup (Category, Dialog — that screen has no live component yet). **Consequence caught along the way**: both mockups had Category pre-filled with "Personal Fin" to demonstrate the risen-label state, which under the new rule means it should render *white*, not tinted — directly contradicts Jim's ask to see Category Row-Tinted on Create ToDo. Emptied the field in both mockups instead of leaving the contradiction; the risen-label demo is a lesser loss than a mockup that visibly violates its own stated rule.

**Respond to Request needed no Attachments/Dialog change.** It doesn't use `.attachpanel` at all — both its Dialog and Attachments panels are a separate `.panel{background:#fff;...}` component, already white, and both already carry example content. Matches the has-content-→-white rule with zero edits; confirmed by reading the file rather than assumed.

**Log Out moved a second time**, out of its own row (2026-08-07, previous entry) and into the Housekeeping band header itself, right-aligned via `.btn-quiet`'s existing `margin-left:auto` — the same slot Create/Send buttons occupy in every other band row. Chosen over showing it as the first Housekeeping task-list row: a band-header control reads as "available here," not as a task, and Jim's own framing ("not something the app expects end-users to do unless on a public computer") fits a low-emphasis header control better than a list entry.

**Attachments panel Row-Tinted everywhere it appears** (`globals.css`, Create Request mockup, Create ToDo mockup) — it can never hold real content in this v1 locked state, so under the empty/filled rule it's permanently in the "optional and empty" bucket, not a one-off exception.

**Create ToDo: print icon moved to the header**, out of the band cluster, matching Create Request and Respond to Request — same reasoning as the earlier print-icon moves (a right-aligned control competing with title text for width).

**Secondary buttons (`.btn-secondary`) recolored from white to Strip.** Once white started meaning "required, or optional-with-content" (the shading rule above), a white secondary button read as part of that same group and visually "popped" next to it. Rejected literally copying the chip's `rgba(255,255,255,.5)` value: a chip only reads as light blue because it composites translucent white over the Strip-tinted `.sendrow` container; a `.btn-secondary` doesn't sit on that container; the same rgba over Row Tint or white would barely register. Used `var(--strip)` as an opaque fill instead — no new token, Strip is already one of the three tinted surfaces §3.3 permits. Updated in `globals.css` and every mockup that duplicates the rule (Create Request, Create ToDo, Respond to Request, both Add Contact mockups, component-states reference, Your Account, both Storage mockups) — left the superseded `design/drafts/WYP_requests_partial_SUPERSEDED.html` untouched, since it's a frozen draft, not a live surface.

**Pull-downs/lookups sort alphabetically, not by creation order** — owner's rule, app-wide, with the Housekeeping task list's Log Out entry as the sole named exception. Categories were already `.order('name')`; contacts previously had no `.order()` at all — added (now `.order('display_name')` after the Name-field merge below).

**Contacts gain `display_name`; migration 005 written, not yet run.** Resolves the open question Jim left me: whether to keep or drop `contacts.first_name`/`last_name`. **Kept**, matching Jim's own more detailed proposal over the alternative he also offered (dropping them) — the deciding asymmetry is that a `comment on column` explaining "preserved, not populated" costs nothing, while dropping and later wanting them back means re-adding the columns and re-migrating. `display_name` is backfilled from `trim(concat_ws(' ', first_name, last_name))`, falling back to `email` for the handful of rows with neither name (see Week1 SQL history's email-only test inserts), then constrained not-null and non-blank. This is a different object from `profiles`/Create My Free Account, which explicitly keeps its separate First Name / Last Name / Display Name three-field structure — Jim reaffirmed that design after initially proposing to unify it with contacts, then reconsidering. The two forms now diverge on purpose: a contact is entered by the request-sender about someone else and needs no legal-name precision; a profile is self-entered at signup and different rules can apply if a Request recipient signs up (their contact's Display Name seeds the new profile's Display Name field, then they must add a First or Last Name of their own).

**Add Contact's First/Last Name fields collapsed into one Name field**, writing only `display_name` — `AddContactForm.tsx` and both Add Contact mockups (`WYP_add_contact_palette1_floating.html`, `WYP_add_contact_no_contact_dialog_palette1.html`). Validation changed from "First or Last Name" to a single non-blank Name. `first_name`/`last_name` are simply never written by this form going forward — the columns exist per migration 005 but sit inert.

**Create Request's Recipient row collapsed the same way**, into a single Name lookup — `CreateRequestForm.tsx` (`Contact` type now `{ id, display_name, send_by }`; the old `firstName`/`lastName` split-field filter logic replaced with one substring match against `display_name`) and the Create Request mockup. Field id changed `fn`/`ln` → `rn`; label changed "First Name"/"Last Name" → "Recipient".

**Follow-up — the `Week2 - SQL history.txt` header comment on migration 004 still says "Not yet run"**, though Jim confirmed running it 2026-08-06. Left as-is rather than rewritten silently; a documentation-accuracy nit, not a functional gap, flagged here so it isn't lost.

\---

## 2026-08-07 — Android layout fixes (Create Request, Respond to Request, Main Screen); optional-field shading previewed

Owner reviewed Create Request on an S24+ and found several issues that a desktop-width mockup review hadn't caught: the print icon crowded Send/Cancel and wrapped "Create a Request"; "(optional)" overflowed narrow fields (Category, Due Time); Dialog's "(Questions, Answers, Comments)" did too; the Attachments panel's fixed height clipped its own copy; and on Main Screen, Log Out's `margin-left:auto` pushed against the wordmark and wrapped "Would You Please."

**Print icon moved to the header, right-aligned.** Out of the band cluster (`.bandcluster`) and into `.hdr`, roughly where Log Out used to sit on Main Screen — the two moves are opposite directions for the same underlying reason (a right-aligned control competing with title text for width). Applied to Create Request and Respond to Request mockups, and to the live `CreateRequestForm.tsx`. `WypHeader.tsx` gained an optional `action` prop (a right-aligned slot) rather than duplicating header markup per screen — Respond to Request will use the same prop once it's converted.

**Log Out moved out of Main Screen's header**, into its own thin row below (`.logoutrow`). Opposite fix, same cause: freeing header width so the wordmark doesn't wrap.

**`.subnote` — small parenthetical label text, PROPOSED, no § yet.** "(optional)" (Category, Due Time) and Dialog's subtitle now render at 11px, matching the size a risen/floated label settles at (14px × the existing 0.79 scale ≈ 11px), so it reads as "the same label, just settled" rather than a new visual language. Dialog's subtitle also moves to its own line (`.flabel.twoline`, since the default `.flabel` is a flex row for the §6.16 glyph case and won't wrap on its own); its textarea gained `padding-top:36px` to clear the taller two-line label. Applied to Create Request (mockup + live) and Create ToDo (mockup). Not applied to Add Contact's "Notes (optional)" — not reported as a problem, left alone rather than changed speculatively.

**Attachments panel: `height` → `min-height`.** The fixed 118px height clipped `.locknote`'s copy on narrow widths or larger Android font-scale settings; letting it grow avoids the clip. `globals.css` plus both mockups that use the panel (Create Request, Create ToDo).

**Optional-field shading — previewed, not adopted yet.** Owner's own idea: tint optional fields so required ones (left plain white) are what the eye catches without an asterisk or a legend — and asked for a color, having tried a light green as a placeholder and ruled out light blue himself (already carries focus/chip-strip meaning). Recommended and applied as a preview on Create Request's mockup only: reuse `--row-tint` rather than introduce a new token. Reasoning: Row Tint is already the `.form` page background, so a Row-Tint-filled optional field visually recedes toward the page while a white required field pops — the exact effect being asked for — and it's one of the only three tinted backgrounds §3.3 permits (Band, Row Tint, Strip), so this needed no new color at all. A pale yellow was also considered and rejected: `--sort` is documented as "the sole yellow in the system," reserved for the active sort pill; a second, diluted yellow use would undercut that. Fields shaded: Due Time, Category, Dialog (the three actually-optional fields on this screen) — not Due Date, which is required, even though the owner's own rough mockup appeared to shade it too (read as an inconsistency in a quick draft, not a stated intent to make Due Date optional). Still switches to `--focus-tint` on focus, same as every field. **Open**: whether to adopt this app-wide, and whether Row Tint is the right final answer — flagged as a preview, not locked in.

\---

## 2026-08-07 — §6.24 lookup fields: browse a short list on focus, search a long one

Owner noticed Category's lookup on Create Request shows nothing until a character is typed, which is unnecessary friction when the whole list would fit on screen. Rule adopted, meant to apply to every §6.24 lookup app-wide, not just this one: on focus, if the field's full option list has fewer than 12 entries, show all of them immediately; at 12 or more, wait for typed input before showing anything, same as before. `LOOKUP_BROWSE_THRESHOLD = 12` in `CreateRequestForm.tsx`; applied to both Recipient (contacts) and Category (categories). Recorded against the §6.24 component definition in `design/README.md` rather than only in code, so it isn't rediscovered per-field. Empty-list messaging was split too: "No contacts yet" when browsing an empty list vs. "No matching contact" when a typed query has no hits — different situations, shouldn't read the same.

\---

## 2026-08-06 — Dialog added to Create Request (live); migration 004; chancap overlap bug fixed

**Dialog field.** Added to both the Create Request mockup and the live `CreateRequestForm.tsx`, matching Create ToDo's field exactly (floating label, top-aligned Add Dialog, same `.frow.top` fix). Entries are staged as plain client-side draft state (an array of strings — no kind picker in this v1) and written to a new `dialog` table together with the Request when Send succeeds, using the new row's id. Reuses `.attitem`/`.attname`/`.attremove` for the staged-entries list (new `.dlgstaged` wrapper, since the fixed-height `.attachpanel` frame doesn't fit a list that grows with entries) rather than inventing a second list treatment.

**Migration 004 — `dialog` table, not yet run.** `request_id` covers both Requests and ToDos uniformly, since ToDos are rows in `requests` too (§2.5). `who` is a display-name **snapshot** taken at post time, not a live join to `profiles` — matches the immutable-fact reasoning already used for `events` (migration 002): a later name change shouldn't rewrite what a past Dialog entry showed. `id` is a plain sequential `bigint`, deliberately, so it doubles as the sort key alongside `created_at` when two entries land on the same day — this is the mechanism the 2026-08-05 entry called for ("if internal IDs are sequentially assigned, they could be used for this sort"). No UPDATE or DELETE policy: append-only, same reasoning as `events`. Full SQL in `docs/Week2 - SQL history.txt`; **owner needs to run this in the Supabase SQL editor before Send will succeed on a Request with any Dialog entries** — until then, Send fails at the Dialog insert step with the Request already saved (handled as a distinct partial-failure error message, not a silent loss).

**Attachments alignment carried over.** Add Attachment stays top-aligned on Create Request too, for the same reasoning worked out on Create ToDo (2026-08-06 entry above) — it was already correct there and untouched by this change.

**Bug found and fixed — `.chancap` overlap.** The "Will be sent by Email" caption under Recipient used `margin: -8px 0 12px 2px`, copied verbatim from the mockup. The mockup never actually renders this caption (`display:none` always, since the mockup has no live contact-selection state), so the negative margin was never visually checked — live, it overlapped the bottom edge of the First/Last Name row. Fixed to a small positive top margin (`4px`, matching `.ferror`'s spacing convention) in both `globals.css` and the mockup's duplicate rule. Worth remembering as a general risk: CSS ported from a mockup for a state the mockup itself never actually shows isn't verified by the mockup looking right.

\---

## 2026-08-06 — Create ToDo designed (§9.4 had no mockup); Dialog/Attachments held as client-side draft state rather than a staging table

Owner mocked up Create ToDo by hand and pasted it in — the first design pass this screen has ever had; §9.4 was a placeholder with no mockup at all (Week 2 plan, "three screens that don't exist yet"). Built as `design/screens/WYP_create_todo_palette1.html`, reusing Create Request's structure (band cluster, Category lookup, Attachments locked panel) rather than inventing new patterns.

**Priority — caught before building, not after.** The pasted mockup omitted Priority (ASAP/SOON/LATER), which is the one field that actually distinguishes a ToDo from a Request in the unified `requests` table (§2.5), and Main Screen's default ToDo sort is Priority ascending — without it, every ToDo would sort identically. Added as a one-of-three chip row, reusing the §6.2 chip-row pattern already established for Send Requests by (previously only ever used as a two-way choice).

**Due Date — confirmed intentionally absent.** PRD lists Due Date as optional for ToDos; owner confirmed omitting the field entirely from this screen (rather than including it as an optional picker) is deliberate, not an oversight.

**Description and Dialog use the floating-label pattern (§6.10)**, not the fixed top-left `.plabel` caption style Attachments uses. Owner's call, given both styles exist in the system and the pasted mockup was ambiguous between them.

**Dialog and Attachments on an unsaved ToDo — client-side draft state, not a staging table.** Owner raised a real concern from prior CRM work (law-firm systems where users were blocked by database sequencing from entering data in the order they expected) and described a pattern used there: a temporary table, one row per user per draft "kind," holding entries not yet linked to a master record, reconciled to the real row on save.

Recommendation given and accepted: for Create ToDo specifically, Dialog entries (and, later, Attachments) are held as ordinary client-side form state — the same mechanism already used for every other field on this form — and written to the database together with the ToDo row itself, using its just-created id, in one Save. This avoids inventing a new persistent table for state that only needs to survive one browser tab, one sitting.

The staging-table pattern is *not* rejected outright — it's the right tool for a different screen. Once a Request exists and Dialog is added to it over time by two different people (owner and recipient, separate sessions, no single overarching Save action — the Detailed Item / Respond to Request case), there's no browser tab to hold that state in, and something server-side is required there. That's a decision for whenever Detailed Item (§9.6) gets designed, not for Create ToDo.

**Follow-up — abandoned-form data loss.** Owner noted that if a session times out or the tab is abandoned mid-entry, losing unsaved Dialog/Description work without warning is standard behavior across most software, but a `beforeunload` "you have unsaved changes" browser prompt would be a cheap, standard way to soften it. Not built yet — Supabase's session in this app is long-lived (no idle-timeout mechanism exists currently), so the realistic failure mode is closing the tab or navigating away, which `beforeunload` does address. Flagged as a small, deferred enhancement rather than built unprompted, per CLAUDE.md's scope-discipline convention.

**Add Attachment alignment — top, not centered.** Briefly changed to vertically centered on the panel, then reverted. Top-aligned is correct: the panel's 118px height is an artifact of the locked v1 state, not real content, so a top-anchored button stays consistent once the panel becomes content-driven and its height changes; a centered button would drift with it. Matches Add Dialog's existing top alignment, and matches Create Request's Attachments row, which was already top-aligned and untouched throughout this back-and-forth.

\---

## 2026-08-05 — Print icon (Create/Respond), Dialog order + color fix, Time Zone field added across three mockups

**Print icon.** Added a print icon (`.iconbtn`, inline SVG, 40×40 touch target) to the band cluster on Create Request and Respond to Request, first child before Send/Cancel, per owner's rough mockups.

**Dialog panel fix (Respond to Request).** Two changes, both in `WYP_respond_to_request_palette1.html`:

1. Entries reordered to descending/newest-first (was ascending). The demo data has no real ordering field yet, so this is a manual reorder of the two mocked entries, flagged in an HTML comment for the real implementation.
2. `.dlgdate` color changed from `var(--alert-red)` to `var(--brand-blue)`. Red is reserved for Overdue and other status/error use (§3.1); decorative use on Dialog dates was a mismatch. Dialog type label stays bold black, unchanged.

**Follow-up — Dialog needs a real ordering field.** Owner's observation: a Question and Answer landing on the same date is ambiguous under date-only sort. If entries carry a sequentially-assigned internal ID (or a timestamp used only for ordering, not display), that resolves it without exposing time-of-day in the UI, which isn't meant to matter. No `dialog` table exists yet (Week 2 plan doesn't include it), so this is a schema note for whenever Dialog is designed, not an open bug: **the `dialog` table's primary key or a `created_at` timestamptz should double as the sort key**, not the display date.

**Time Zone field.** Added a §6.16 lookup/picker field labeled "Time Zone" to three mockups:

- `WYP_add_contact_palette1_floating.html` — after Phone, before Send Requests by. Empty (no default rendered in the mockup).
- `WYP_add_contact_no_contact_dialog_palette1.html` — same position, propagated to match (this file didn't yet have `.lglyph` CSS; added it here).
- `WYP_create_free_account_palette1.html` — after the Display Name note, before Phone. Pre-filled with "Central Time (Chicago)" to match this screen's convention of showing example data throughout.

**Defaulting — answering owner's question directly.** These are two different fields with two different answers:

- **Create My Free Account's Time Zone is the signed-in user's own** — browser-detectable (`Intl.DateTimeFormat().resolvedOptions().timeZone`), so defaulting it is correct and is what the mockup's pre-filled value implies. This also becomes `profiles.time_zone`, already an open item in `WYP_Week2_Plan.md` for §2.7 Overdue evaluation.
- **Add Contact's Time Zone is the *contact's*, not the user's.** Resolved 2026-08-06: default it to the owner's own profile time zone (`profiles.time_zone`) at Add Contact's initial render — most contacts share the owner's zone often enough that this is a reasonable starting guess, and the field stays editable so the owner can correct it when they know otherwise. This makes `profiles.time_zone` a dependency for populating the default (not just for Overdue evaluation), and it's the reason `contacts.time_zone` should default from the *client-side* value already on hand rather than a second lookup. Mockup comments in both Add Contact files updated to reflect this.

**Schema follow-up — `contacts` needs the same column `profiles` needs.** `WYP_Week2_Plan.md`'s open-questions section already flags `profiles.time_zone` as undecided; this now needs a `contacts.time_zone` counterpart for the same reason (§2.7-adjacent: knowing a contact's zone matters for showing them times/dates meaningfully, even though Overdue itself is anchored to the sender). Not yet added to the migration 003 draft.

**Live-component gap.** `app/components/AddContactForm.tsx` and the `contacts` table (migration 002) do not have a Time Zone field or column — Add Contact is the one screen among those touched here that's already Converted/Live, so this mockup change is now ahead of the live component. Flagging rather than silently adding a column: the field needs the defaulting question above resolved first, and touching the live form/table for a still-open design question isn't the right order.

\---

## 2026-08-05 — Housekeeping section added to Main Screen mockup (Contacts and Account Profile gain an entry point); new §6.23 row component

Neither Contacts nor Account Profile had a way in. §9.8 retired the standalone contact-browse screen in v2.7 (contacts are reached only via Add/Edit Contact or the Create Request type-ahead), and §6.14's Subscription/Account banner opens Settings for subscribers but reads as an upsell strip, not an "edit your profile" entry point. Owner mocked up a "Housekeeping" section at the bottom of the Main Screen scroll, below ToDos, to hold both.

**Decisions taken**

1. **Housekeeping is a new top-level section on the Main Screen**, structured identically to Requests and ToDos: a `.band`/`.glabel` heading ("Housekeeping", no button — nothing to create) followed by a `.subcard` with a `.subhead`/`.subname` label ("Tasks").
2. **New row component, §6.23: `.hkrows`/`.hkrow`/`.hktitle`/`.hknote`.** Bold Brand-Blue title, em-dash, regular Ink description, 2-line clamp — the same visual language as the §6.5 ToDo row's Priority/description pairing, in its own classes rather than reused `.pri`/`.tdd`, since the meaning here is navigation, not Priority. No chevron or other new affordance glyph: every list row in the app (Sent, Received, ToDo) already signals "tappable" by row context and convention alone, and Housekeeping stays consistent with that rather than introducing a new one.
3. **Two rows shipped in the mockup: "My Contacts — view and edit" and "Account Profile — view and edit".** Both carry a description even though the title alone would likely read fine, so the pattern is established consistently from the first two items — future rows (Storage Maintenance is the obvious next candidate, and already has a screen with no entry point either) follow the same shape without a new styling decision.
4. **Punctuation is the em-dash from §6.5's convention** ("—", not a hyphen), for consistency with the row style being reused.

**Alternatives considered and rejected**

* *Restoring the Settings gear to the search bar* — owner's first instinct, self-rejected before proposing Housekeeping. §6.6.1 already states the gear was removed in v2.5 in favor of the bottom banner; reintroducing it would reopen a settled decision and bury the entry point behind an icon rather than plain-language text.
* *Underlined link-style text for each row* — owner's original sketch. Reads as inline hypertext inside a paragraph, not a navigational list row, and doesn't hold a two-line title-plus-description gracefully.
* *Stacked `.btn`/`.btn-secondary` per item* — rejected; buttons in this system are single-line, fixed-emphasis controls, would compete visually with the actual primary actions on the same screen (Create Request, Create ToDo), and have no room for a description line.
* *Reusing `.checkrow`, checkbox included* — rejected; there's no on/off state being represented, and a checkbox implies one that isn't there.

**Follow-ups**

* §9.13 Settings' Purpose line still describes the retired gear-icon entry point rather than the bottom banner (§6.14) — stale, needs a correction pass independent of this change.
* Whether Account Profile via Housekeeping duplicates or supplements the existing banner→Settings path is intentionally left as two entry points to the same destination (owner confirmed comfortable with that), not resolved as a single canonical path.
* Not yet promoted to the UI spec proper (§6 fully occupied through §6.22 plus this §6.23) or converted to React — Main Screen remains Mockup status.

**Confirmed** — owner reviewed the rendered mockup (`WYP_main_screen_palette1.html`) and approved it as-is, 2026-08-05, including the `.subname` blue heading treatment on the Tasks subcard. §6.23 and the Housekeeping section are locked; further changes go through a new entry rather than editing this one.

\---

## 2026-07-28 — v1 scope cuts (attachments → paid; voice search deferred; .ics kept; monetization deferred); offering/messaging rework; local + free-tier build approach adopted; PRD finalized to v12.7 (sales one-pager v3; UI spec §6.18/§9.19 still to update)

A roadmap-and-sequencing session. No UI-spec component anatomy changed, but the free/paid feature split was reworked, two mockups gained a locked "paid feature" attachments state, and the build path was set to a local + free-tier stack rather than the PRD §8.2 AWS target. Reasoning, alternatives, and document impacts below.

**Decisions taken**

1. **Attachments deferred out of v1 and repositioned as a paid-subscription feature.** They arrive with monetization, not at free launch. This removes the entire storage subsystem from the v1 critical path (S3, quotas, retention enforcement, the §6.18 warning strip, and the §9.19 Storage Maintenance screen all become paid-tier surfaces). Rationale: attachments are not the product's value proposition (which is send / track / follow through), and cutting them buys back the most build time of any single scope decision.

2. **In the Create Request and Respond mockups, the Attachments panel shows a locked "paid feature" state rather than being removed.** Owner decision, overriding the earlier recommendation to hide the panel entirely. The panel frame is kept; the functional file list and Add control are replaced with a lock glyph, an "A subscription feature" heading, and gating copy pointing to the subscription banner (§6.14) — mirroring the existing Request-Texting gating pattern. The Add Attachment button renders disabled. Rationale: the panel advertises the upcoming paid capability in place rather than hiding that attachments exist. Implemented as screen-local CSS (a new .locked treatment) reusing existing tokens; introduces no new token and no change to components.css.

3. **Voice search deferred from v1, to return later covering both the search bar and request-text composition.** The search bar ships without the voice glyph in v1; when voice returns it applies both to search entry and to dictating request text. The one-pager lists it under Coming soon.

4. **.ics / Add to Calendar is included in the initial offering.** Owner considers it a critical usage feature for request recipients — the due date drops onto the recipient's calendar in one tap. It is application-side code (generate the calendar file from the request's due date/time), with no infrastructure dependency, so it ships free in v1.

5. **Monetization deferred: the free tier alone is live at v1 launch.** The paid tier ($17.95/yr) is introduced later and unlocks attachments, Request Texting (SMS), perpetual retention, and ad-free. Free-tier ads remain deferred to 200 registered users (prior decision). Consequently the paid tier and its features are messaged as "coming with a subscription" at launch, not as live options.

6. **Build approach: a local + free-tier development stack, not the PRD §8.2 AWS architecture.** §8.2 (React SPA, NestJS/Go, RDS, S3, Redis, SES, SNS/Twilio, Stripe, AdSense on AWS) is confirmed as a sound production target but explicitly not a prerequisite to building. The this-week stack has a zero-cost stand-in for every production piece: Next.js + TypeScript locally, Vercel free for host and CI/CD, Supabase free for Postgres + Auth (magic links) + storage, Resend free for email (avoiding the SES sandbox), Sentry free for error tracking. Genuinely deferred to launch: SES with SPF/DKIM/DMARC and domain warming, Stripe live (test mode for all development), Twilio with its 10DLC lead time, S3, Redis, and AdSense. A Week 1 setup guide (repo → Supabase → Add Contact wired to real data) was produced to make the "this week" column concrete.

**Alternatives considered and rejected**

* *Removing the Attachments panel entirely from the v1 mockups* — the recommended option; owner chose the locked "paid feature" state instead, to keep the capability visible and advertised rather than absent.
* *Keeping attachments as a free feature, or launching with monetization live* — rejected; deferring both is what makes the solo 2–3-month timeline reachable and lets a free product validate before any billing, storage, or ad infrastructure exists.
* *Building on AWS from day one (with a credits application)* — rejected as slower and costlier for a solo developer with no benefit until there are users; AWS is sequenced last, after a beta proves the product and reveals real scale (which also strengthens the credits application).

**Follow-ups — documents**

* **Sales one-pager: done.** Rewritten to the free / coming-with-a-subscription / coming-soon split as WYP_Sales_OnePager_v3.pdf (with a rebuildable HTML source, onepager.html), superseding v2. Attachments and Request Texting moved to the subscription column; voice search and native apps to Coming soon; Add to Calendar highlighted as a free feature. The v2 claims that broke — "with attachments" in the free description, "reply with answers and files," voice search as a live feature, and "100 MB attachment storage" in the free tier — are removed.
* **PRD updated to v12.7 (done, 2026-07-28).** Sections changed: **§6** Monetization Model — added a "Launch sequencing" note (free tier only at launch; paid tier and its features activate at Phase 0+; ads deferred to 200 users) and reconciled the free/paid matrix (File attachments = paid, not free; Advertising = deferred). **§9** — added the base-subscription note ($17.95/yr unlocks attachments + Request Texting + perpetual retention + ad-free), distinct from the future business add-ons. **§10** — rewrote the Phase 0 scope (free tier; email; .ics; attachments locked; SMS/OAuth/voice deferred) and added a Phase 0+ — Monetization row. **§11** — added a "Two build paths" note (team basis vs the solo/AI/free-tier path), revised the §11.1 work breakdown (magic-link auth, email-only notifications, .ics row added; Attachment/Ad/Subscription streams deferred → Phase 0+; free-tier subtotal ≈ 20–30 wks) and the §11.3 budget (cloud/third-party → free-tier ≈ $0–$2,000; security-audit scope narrowed; TOTAL $118k–$319k). **§12** — UI-spec reference corrected v2.5 → v2.9. Title, footer, and Revision History bumped to v12.7. Old file WouldYouPlease_PRD_v12_6.docx superseded; Project Instructions Canonical-sources reference bumped. STILL OPEN: UI spec §6.18 (storage warning strip) and §9.19 (Storage Maintenance) become paid-tier-only surfaces — not yet edited in the UI spec.
* **UI spec §6.18 (storage warning strip) and §9.19 (Storage Maintenance)**: these govern attachment storage, now a paid-tier surface — note that they do not appear for free-tier users. §9.2.2 (Create Request attachments) and §9.3.2 (Respond attachments) should record the v1 locked "paid feature" presentation.
* **Component System Specification**: the locked attachments treatment is a candidate shared component — provisionally WYP-LockedFeature — once a second surface uses it (today it is screen-local in two mockups, consistent with the chip/pill deferral). Add it to the registry when promoted.
* **In-app gating copy**: the attachments panels now carry the same "available with a subscription" pattern as Request Texting; keep the wording consistent across both when the PRD copy is finalized.

**Deferred / open**

* **Recipient-facing attachment upsell**: a non-registered recipient responding via the secure web link sees the locked "subscription feature" attachments panel, but the upsell target is ambiguous for someone without an account. Revisit the recipient-facing copy (and whether the panel should appear at all in the recipient view) when the paid tier ships.
* **WYP-LockedFeature** shared component — promote from the two screen-local copies once a third surface needs it.
* **Voice search** return — search bar and request-text composition — tier and timing not yet set.
* **Security-review scope, recalibrated**: the owner's law-firm CRM secure-landing-page product (a provided server mapped to a firm's sensitive internal contact database via an iFrame on the firm's public site, reachable from email links, for firms up to 300+ attorneys) is directly analogous to WYP's token/link-mediated secure recipient-response flow. The earlier "single-user / trusted-environment" characterization was wrong. The pre-launch security review therefore narrows from "validate the whole model" to "confirm a known model is translated correctly into web-stack idioms" (Supabase RLS, signed URLs/JWTs, the browser threat model).

\---

## 2026-07-24 — Component system introduced (shared design-token and component stylesheets); WYP- identifier scheme adopted; token-name reconciliation; main-screen assets vectorized (no PRD or UI-spec content change; new Component System Specification v0.1)

The seven screen mockups were refactored from standalone HTML files — each carrying a full duplicated copy of the palette-1 CSS — into markup plus two shared stylesheets. No product requirement or design-system *semantic* changed this session; the single design-system-adjacent change is a token **name** reconciliation to the §3.1 label, with the value unchanged. Every collapsed screen was rendered and pixel-diffed against its pre-refactor original before delivery.

**Decisions taken**

1. **Design tokens centralized into one source of truth, `tokens.css`.** The palette-1 `:root` block — seventeen tokens — had been duplicated verbatim at the top of all seven mockups, so a token change meant seven edits. It now lives in one file every screen imports. The values written are the exact union of the seven files (verified equal across them). Treated as governed by the same change control as UI-spec §3.1, per the §3.3 rule that a new token requires a §3.1 revision.

2. **Shared component styles extracted into `components.css`.** The shell, header band (§6.8), group-label band (§6.7), primary and secondary buttons (§6.1/§6.11), base text input and floating-label behavior (§6.10), subscription banner and ad slot (§6.14/§6.15), and the modal frame (§6.12) are defined once and read their colors from `tokens.css`. Each screen now links, in order, Google Fonts → `tokens.css` → `components.css` → a small screen-specific `<style>`. Per-screen style blocks shrank sharply (e.g. Create Request 117 → 33 style lines). Verification: six screens render pixel-identical to their originals; the main screen differs only where its logo and icons were vectorized (decisions 7–8).

3. **Token-name reconciliation: `--field` → `--focus-tint`.** §3.1 names this token "Focus Tint" (#EDF2FD). Four form mockups defined it as `--field` while the two storage mockups already used `--focus-tint`; standardized on `--focus-tint` everywhere — the name that matches §3.1 and the majority of files. Pure rename: the value #EDF2FD is unchanged, so nothing renders differently. Closes the latent drift first flagged when the mockups were consolidated.

4. **`--scrim` tokenization gap closed.** The modal scrims (Add Contact no-contact dialog, Storage Maintenance) hardcoded `rgba(31,41,51,.45)` inline although §3.1 defines a Scrim token; `components.css` now applies `var(--scrim)`, so the overlay is governed in one place like every other color.

5. **`WYP-` component-identifier scheme adopted (owner, 2026-07-24), specified in the new Component System Specification v0.1.** Stable identifiers — PascalCase under the `WYP-` prefix (e.g. `WYP-Button`, `WYP-LookupField`) — map one-to-one onto the eighteen UI-spec §6 components, so one name denotes the same part in the spec, in the eventual code, and in working conversation. The identifier is the durable handle; the §6 section number stays where the anatomy lives. Identifiers are set in monospace and never quoted, keeping a component name distinct from a verbatim on-screen label (which §1.5 reserves quotes for). Consequent to adoption, §6 entries carry their identifier as each is next revised (prospectively, per the §1.5 conformance rule), and the Component System Specification becomes a companion to the UI spec in the Canonical sources block.

6. **Self-contained copies produced for viewing.** Because the linked files reference `tokens.css`/`components.css` by relative path, they render unstyled in an isolated preview (no sibling files) and locally only when all three files share one folder with exact names. A parallel set with both stylesheets inlined into each `<head>` was produced; these render anywhere with no setup. Working model: edit the linked set (single source of truth), view and share the standalone set, regenerate the standalone set from the canonical CSS after any change.

7. **Main-screen logo converted from a base64 PNG to the canonical inline SVG.** The main screen alone embedded its logo as a raster data-URI (~13 KB); the other six draw it as inline SVG, and those six were verified byte-identical to one another. The main screen now carries that same SVG — crisper on high-DPI, lighter, and consistent. Only the logo pixels change; nothing else on the screen moves. Judged an iteration artifact (owner concurred), not an intentional divergence.

8. **Main-screen icons converted from base64 PNGs to inline SVG from the project icon files.** All seventeen raster icons (three Expand, three Print, Search, Voice Search, six Attachment glyphs, three Dialog glyphs) were replaced with the `wyp\_icon\_*.svg` assets. Decorative inline SVGs are marked `aria-hidden`; the accessible name stays on each wrapping control (`role="button"`, `aria-label`), so screen-reader behavior is unchanged. Sizing rules retargeted to the inline SVG (`.iconbtn svg`, `.sb .iconbtn svg`, `svg.iico`). The main-screen file dropped from ~157 KB to ~22 KB. `wyp\_icon\_contract.svg` is present in the asset set but unused in the pilot mockups — it belongs to the not-yet-mocked expanded-list view (the collapse counterpart to Expand).

**Alternatives considered and rejected**

* *Keeping the `--field` name, or minting a new token* — `--focus-tint` already matches §3.1 and was already used by two screens; renaming the four outliers is the smaller, drift-closing change.
* *Promoting the chip and sort-pill styles into `components.css` now* — their definitions genuinely diverge across screens (main uses `.sel`/`.over`/`.done`; Add Contact uses `.selected`; Storage uses simpler variants; the main and storage `.pill` differ in size). A shared definition would risk a visual change and presupposes a single canonical chip spec, which is a design decision, not a mechanical extraction. Left local; the main screen is now the reference implementation for §6.2/§6.3.
* *Leaving the raster logo and icons in place* — they read as iteration artifacts, not intent; the spec already names these as SVG assets (§5.1, §6.16). Vector is crisper, far lighter, and consistent with the other screens.
* *Combining all seven screens into one multi-screen file with a switcher* — offered as a viewing convenience; not adopted, left available.

**Follow-ups — documents**

* **Component System Specification** — completed to v1.0 (2026-07-24): all eighteen §6 components carry a full anatomy entry (Purpose / Anatomy / States / Composition / Reference implementation). Filed as `WYP_Component_System_Specification_v1_0.docx`, part of the canonical set and the Project Instructions Canonical sources block. Its token table still reads "Focus Tint (`--field` in mockups)" — update to `--focus-tint` when next touched.
* **UI spec §3.1**: when next revised, cite the CSS name `--focus-tint` alongside the "Focus Tint" label, and record `tokens.css` as the canonical token file (same change control as §3.1, per §3.3). No value or semantic change.
* **UI spec §6**: add each component's `WYP-` identifier as each §6 entry is next touched — prospectively per §1.5, not as a sweep.
* **Canonical sources block (project instructions)**: updated this session — adds `tokens.css`, `components.css`, and the Component System Specification, and records that the seven mockups now exist as a linked set (depending on the two stylesheets) plus a standalone inlined set for viewing.
* **Mockups in project knowledge**: the main-screen mockup is now updated (logo and icons vectorized) — this supplies the file the 2026-07-22 entry recorded as *missing* from project knowledge. Upload the current seven (both forms). The 2026-07-22 note that `WYP\_storage\_maintenance\_palette1.html` is one revision behind still stands and is unaffected by this session.

**Deferred / open**

* **`WYP-ChipRow` and the sort-pill component**: unify the divergent chip/pill definitions into shared components once the single canonical spec is decided (§6.2/§6.3). Main screen is the reference.
* **Unused tokens `--btn-top` and `--icon-grey`**: defined but never referenced through `var()`; `--icon-grey` (#6B7280) is also misleading, since the information-only glyphs actually render in `--ink-soft` (#5A6675). Retire once confirmed unused in the build; carried in `tokens.css` under a "deprecated / unused" note meanwhile.
* **Icon components / sprite**: with the glyphs now defined once as files, the shared layer can absorb them (a small icon-component set, or a sprite) rather than pasting SVG per screen — do this alongside the chip/pill unification.
* **Spacing scale**: only `--pad` is tokenized; the full §7.2 scale is not yet in `tokens.css`. Add `--space-*` mirroring §7.2 when convenient (a design decision, so not invented here).


\---

## 2026-07-23 — Sales one-pager refreshed to $17.95 pricing; callout panels auto-sized; collateral given a rebuildable source (no PRD or UI spec change)

**Decisions taken**

1. **Paid-tier price on the one-pager corrected to $17.95 / year.** The approved 2026-06-11 PDF still carried **$11.99**, a figure superseded when PRD v12.0 fixed annual-only billing at $17.95 — the number used throughout PRD §6.2.3, §13, and §15.1. Recorded here as a stale-artifact correction rather than a pricing decision: nothing about the price changed, only the collateral that misstated it.

2. **The monthly framing is "Only $1.50 a month — a fraction of team tools,"** replacing "Less than $1 a month — a fraction of team tools." $17.95 ÷ 12 = $1.496, so $1.50 is accurate to the cent under normal rounding. "Less than $2" was rejected as technically true but read as rounding *up* to make a point. PRD §13's "under a nickel a day" framing stays in the PRD only; on the one-pager this line does double duty as the per-month comparison against per-seat team tools, and a per-day figure loses the comparison.

3. **The two accent-bar callout panels are auto-sized from their content, with equal padding above and below.** Both the light-blue "Nothing to install" panel and the manilla "Coming soon" panel had been drawn at fixed heights that ended on the last text baseline: the light-blue panel's final descenders crossed its bottom edge by roughly 0.4 pt, and the manilla panel cleared its own by 0.1 pt. The tint therefore read as cut off rather than as a panel containing text. Padding is now **9 pt top and bottom**, measured from the first line's ascent and the last line's descent rather than from baselines, so the text block is optically centered.

4. **The extra height is absorbed by shifting the lower half of the page down 9 pt**, not by reducing type size, leading, or copy. The light-blue panel grows from 46 pt to 54.7 pt and the manilla panel from 44 pt to 52.4 pt; everything from the "Everything you need to follow through" heading downward moves 9 pt lower. White space above the footer band falls from 64 pt to 47 pt, which is still generous. Column grid, card geometry, gutters, and every type size are unchanged.

5. **The solid blue pricing card and the header and footer bands are left alone.** Measured padding is 11.4 pt above and 13.2 pt below the text on the pricing cards, and 17.0 / 15.2 pt in the footer band — already balanced, and not what the eye was reading as clipped. Only the two panels that were genuinely clipped were touched, so the rest of the approved composition carries forward unmodified.

6. **The collateral now has a source of record: `build\_onepager.py` (ReportLab).** The page was transcribed from the drawing operations of the approved PDF — identical coordinates, color values, Helvetica sizes, and vector checked-request mark — and verified two ways: a layout text diff showing only the two intended pricing lines changed, and a side-by-side render at 150 dpi. Copy, palette, and geometry are now editable in one place, and the callout helper re-centers automatically when a line of copy changes length. This mirrors the practice already established for screens, where the HTML mockups are the source and the figures are exports.

7. **Deliverable is `WYP\_Sales\_OnePager\_v2.pdf`.** The "FinalLogo" qualifier is dropped: it marked the one-time asset milestone of 2026-06-28, not a document version, and reads as a version once a second version exists.

**Alternatives considered and rejected**

* *Patching the existing PDF content stream in place* — the price swap alone would have worked, since both replacement strings are left-aligned at a fixed origin. Re-centering the panels, though, means moving every coordinate below y≈518 in a 14 KB stream by hand, where a single arithmetic slip renders plausibly and silently wrong.

* *Rebuilding the one-pager as HTML to match the mockup family* — the screen mockups are HTML because they specify on-screen UI. Print collateral needs fixed page geometry and a PDF handoff, and browser print pipelines differ in margins, hyphenation, and color handling. ReportLab produces the artifact directly, with no render step to disagree about.

* *Adding fill below the last line only, as literally requested* — restores the missing tint but leaves the text block sitting high in the panel, which is the same defect a few points smaller. Centering costs the same edit and fixes the cause.

* *Enlarging the pricing card and the two bands to match* — change for symmetry's sake on elements that already read correctly, and it would have cost another vertical shift on an already-full page.

* *Re-flowing or trimming copy to reclaim the vertical space instead of shifting content down* — the page carried 64 pt of unused white above the footer. Spending that is cheaper than re-breaking approved lines and re-reviewing the copy.

**Confirmed**

* The 2026-06-28 follow-up — *"The Sales One-Pager PDF (in project knowledge) is presumed to use the dark-background mark in its header/footer bands. Confirm at the next sales-collateral refresh."* — is **confirmed and closed**. Both bands draw the dark-background variant: white bubble, pale-blue rules (#A7BCE8), navy check (#1A3A75) over a white keyline, at full size in the header and 0.533 scale in the footer.

**Follow-ups**

* Owner: replace **WYP\_Sales\_OnePager\_FinalLogo.pdf** in project knowledge with **WYP\_Sales\_OnePager\_v2.pdf**, add **build\_onepager.py** alongside it as the collateral's source of record, and update the Canonical sources block to list both. Note that the copy of the one-pager currently in project knowledge is **not a readable PDF** — it has no trailer dictionary and no readable cross-reference table — so it needs replacing on those grounds alone; this refresh worked from the owner-supplied upload.

* The free-tier card states 100 MB; the paid card still promises only "Keep your requests and files forever" with no storage figure. Consistent with the PRD §15.2 open item and the no-number rule adopted for §9.19 (2026-07-22, decision 25). When the paid-tier figure is set, the paid card gains a fourth line and the layout absorbs it without a manual re-measure.

* Sweep the other outward-facing surfaces for the stale $11.99 — website copy, any deck or listing draft, and anything already sent to a reader outside the project. The one-pager was caught by inspection, not by a sweep, so it is unlikely to be the only place.

* At the next refresh, re-check "Now available in your web browser" and "Coming soon: native apps for iPhone, Android, and Windows" against the phase language in PRD §11.1, so the collateral's promises and the roadmap's phases stay in step.


\---

## 2026-07-22 — Screen-name normalization; tier-scoped contact minimum; subscription-lapse policy; attachment storage warning strip and Storage Maintenance screen (UI spec v2.9; PRD v12.6 — both cut 2026-07-22)

**Decisions taken**

1. **Button label shortened to "Save"** on Add Contact, replacing "Save Contact." Matches the verb-only convention already used for Send on Create Request and Respond to Request. Buttons remain padding-sized, so the Primary is now visibly narrower than the adjacent Cancel — the same relationship those two screens already show, so it reads as the established pattern rather than an anomaly.
2. **Screen name is "Add Contact"**, not "Add a Contact." Side benefit: the recipient-row control on Create Request already read "Add Contact," so the button and the screen it opens now carry one name.
3. **Screen name is "Create Request"**, not "Create a Request." The article is dropped only where the phrase *names the screen*. Where the PRD describes the *action* — "Creating a Request when the user has zero contacts," "to create a Request" — the lowercase phrasing stands unchanged. §9.9.5's modal copy carries both forms in one sentence by design: it opens "To create a Request, a Contact is needed" (action) and closes "you'll be returned to Create Request" (screen).
4. **"Respond to Request" is retained** over "Request Response." It is a verb phrase that tells a first-time recipient — often a non-registered user in the secure web view — what to do; the noun form names an object and loses the instruction.
5. **Contact minimum is tier-scoped.** Name clause unchanged for both tiers: either a First or a Last Name. Reachability clause now depends on tier — the free tier requires an **Email**; a subscriber requires an **Email or a Phone**, with §9.9.3's save-time channel validation unchanged, so the field matching the selected delivery channel must be populated. Rationale: subscribers can send by text and have no reason to hold an email address for a text-only contact, while free-tier delivery is email-only and a phone-only contact would be unsendable. This also resolves a latent conflict — §9.9.3's auto-follow switches a subscriber's delivery selection to Text when Phone is filled and Email is empty, a state an always-Email rule would have failed on Save. The mockup's caption string is correct as written for the free tier; §9.9.2 and §9.9.3's "either Email or Phone" text was the stale side of the divergence.
6. **Lapsed subscribers are prompted, not blocked.** A free-tier user (lapsed or never subscribed) opening an existing contact that has a Phone and no Email sees a persistent inline notice in Ink Soft beneath the Email field: "Add an email address to send Requests to this contact." **Save still succeeds without one.** Rationale: a record valid when created must not fail validation later because the tier changed, and blocking Save would trap someone who opened the form to fix a phone number. Contacts whose delivery channel was Text revert to Email display at lapse, the free tier having only one channel.
7. **The phone-only count appears in two places, framed as incentive before lapse and as instruction after.** Pre-lapse renewal reminder: "Renewing keeps Request Texting for the 36 contacts you reach by text." Post-lapse Account banner (§6.14), suppressed when the count is zero: "36 of your contacts have no email address. Requests are sent by email on the free tier, so you'll need to add an address before you can send to them." Both count contacts *lacking an email* rather than contacts "with only phone numbers" — identical sets today, but the first states the condition that actually gates sending.
8. **Subscription lapse carries a 30-day grace window.** Ads resume on day 31. Attachments are auto-deleted **oldest-first** down to the free 100 MB limit on day 31. Incremental email notices during the window carry the count, the megabytes over, and a **download link** — the user must be able to keep a file rather than only watch it expire.
9. **Storage warning strip (new UI spec §6.18)** — a full-width strip flush beneath the header band, above the first heading band; the whole strip is one control opening Storage Maintenance. Two severities, both from existing tokens: **Caution** at 20% or less remaining (Brand Blue on Focus Tint #EDF2FD with a Brand Blue bottom rule, main screen only) and **Critical** at 10% or less, or full (Alert Red on white between hairline Alert Red rules, every screen). The lapse countdown uses the Critical treatment.
10. **No amber token.** The owner's mockup used an amber chip; adopting it would have required amending §3.1 (which names Sort Highlight #FFE34D "the sole yellow in the system from v2.5"), §3.2, and §3.3 (which states Brand Blue and Alert Red are the only saturated colors used at scale, that additional accent colors are not part of the system, and which closes the list of permitted tinted backgrounds). Impending irreversible deletion is an error condition, so Alert Red carries it under a single extended clause in §3.1's usage cell instead. Red stays off Row Tint, so it never enters the visual register that means Overdue.
11. **Strip placement is not a header chip.** PRD §3.1 records that the user name and the date/time were removed from the header in v10 because the clock overlapped the tagline on a Galaxy S24+; a chip beside the wordmark reoccupies exactly that reclaimed space and reintroduces the overflow. A full-width strip has no overflow failure mode and carries longer copy plus a right-aligned action.
12. **Warning copy states the condition, not the gesture.** "Click to fix" is mouse-specific in a touch-first product. Caution: "Attachment storage is 82% full." Critical: "Attachment storage is full. New attachments will fail." Lapse: "Your subscription ended. Attachments over 100 MB are removed in 12 days, on Wednesday, September 8." Action text "Free up space ›" / "Review ›". Sentence case per §6.13.
13. **Storage Maintenance screen (new UI spec §9.19)**, appended after §9.18 — §9.8's retired number is preserved. Composition: header band; "Storage Maintenance" heading band with Close; summary block (used / limit / available with a proportional bar in Brand Blue that switches to Alert Red at the Critical threshold); sort strip; attachment rows; footer note; then the standard §6.14 banner and free-tier ad slot. Rows reuse the §9.2.2 attachments-panel anatomy — filename truncated mid-string, then size, type, and date — so no new component is introduced.
14. **Rows identify the attachment's source**: the parent Request, Dialog entry, or ToDo, plus who added the file, rendered "Added by Roman Atley" or "Added by you."
15. **Sort defaults to largest-first**, with an oldest-first option, and a caption noting that auto-deletion removes oldest first. The two orders differ deliberately: auto-deletion runs oldest-first, but manual cleanup is only efficient largest-first, and the screen optimizes for the user's task rather than mirroring the machine's rule.
16. **Each row carries a Download control.** Without it, the only way to comply with a storage warning is to lose the file permanently. Rendered as text in Brand Blue, not an icon — the icon family has ten members and no download glyph, and adding one would mean an eleventh asset plus a new §5.1 group. (Consistent with the 2026-07-21 rejection of a download icon on §9.3 attachment rows.)
17. **Storage is charged to the requestor**, and includes attachments added by the recipient. Stated on the screen in the summary note so it is not a surprise.
18. **Attachment caps: 25 MB per file and 50 MB per Request**, alongside the existing v7.0 count limit of ten per Request, per Response, and per Dialog entry. Necessary because decision 17 lets a third party consume a free-tier sender's quota, and nothing previously capped an individual file — a single recipient video could have exceeded the sender's entire allowance.
19. **Refusal to a blocked recipient upload is neutral**: "This Request can't accept more attachments." It does not name the cause, since the alternative discloses the sender's account state and tier to someone who may be a stranger. Consistent with the Category-privacy reasoning of 2026-07-21.
20. **Close returns to the immediately prior screen; Enter does the same** when focus is not in a field. Stated generally in **§10.3 Keyboard navigation**, which already specifies Enter and Escape, rather than in §8 (which carries no keyboard content) or locally in §9.19: on a screen with no form to submit, Enter activates the heading band's dismissive control — Close, or Cancel where no Close is present.
21. **Removed attachments leave a tombstone.** Because decision 17 means senders will routinely delete files their recipients uploaded, removal must not silently alter the recipient's record. Rendered on the item (§9.6) as a single Ink Soft line — "1 attachment removed by Jim Kelley on Sep 8, 2027" — aggregated rather than one line per file, so clearing twenty files does not leave twenty tombstones on one Request.
22. **§4.3 gains a weekday exception for deadline dates within thirty days**, permitting "Wednesday, September 8" on the lapse strip. Narrow by construction: §4.3's M-D-YY list rows and locale-aware long form elsewhere are otherwise unchanged. The year is dropped on the strip (the window is never more than 30 days out, so it carries no information and costs a line wrap at 360 px) and retained in the Storage Maintenance summary and the notice emails, which may be read weeks later.
23. **The countdown is stated as days remaining, on a named date** — "removed in 12 days, on Wednesday, September 8" — not as days elapsed since lapse. At day 18 of a 30-day window there are 12 days left, not 12 days since.
24. **A contextual subscription offer sits at the foot of the summary block**: "Subscribe for more attachment storage" on the free tier, "Renew to keep these attachments" in the lapse state. Rendered as a tappable line in Brand Blue at 13 px / 700 with a 40 px target — the §6.14 banner's treatment — on its own line. Deliberately *not* bolded inside the note, and deliberately not a verbatim quotation of the banner's own label: emphasis without an affordance produces a phrase that reads as a control but isn't, and the duplicated string would read as a repeated element rather than two placements. The persistent banner is retained; the two now say different things, the contextual one naming the specific benefit at the moment it is legible.
25. **No storage figure is promised.** PRD §6 gives the free tier as up to 100 MB but states the paid tier only as perpetual retention with add-ons available, and §15.2 lists add-on increments and pricing as an owner decision. Copy therefore says "more," with no number, until cost estimates are run (owner, 2026-07-22). The missing paid-tier figure is now recorded as its own open item in PRD §15.2. *Correction to an earlier note in this session:* the subscription screen is **§9.14 Subscription / Upgrade**, not §9.17, which is the banners section.
26. **Screen names are set in plain title case; the convention is written down rather than marked up.** New §1.5: title case names a screen or component, lowercase names the action, a section reference accompanies the first mention of a screen within a section, and double quotes are reserved for verbatim product copy. Applied prospectively — sections conform as they are touched, not by a sweep of both documents.

**Alternatives considered and rejected**

* *Quotes, italics, bold, or color for screen names in the documents* — quotes already mean verbatim UI copy, so quoting a screen name makes "Create Request" ambiguous between the name and the button's literal label, which is the confusion the markup was meant to remove; italics collide with figure captions, which are set fully in italic; bold collides with table lead-ins and adds noise to running prose; color fails in print and greyscale, is an accessibility problem on its own, and drifts the first time a paragraph is reformatted in Word. A written convention is the proportionate fix.
* *Requiring an Email of every contact regardless of tier* — taxes exactly the users who paid to avoid email; a subscriber reaching someone only by text would have to invent an address.
* *"Email or Phone" for both tiers* — reintroduces the problem the always-Email rule prevented: a free user saving a phone-only contact they can never send to.
* *Deferring the reachability check to send time* — surfaces the failure mid-compose, the worst moment, and leaves unusable records in the contact list.
* *Forcing a contact cleanup pass at lapse* — punishes the user at the moment of downgrade; the compose-time prompt of decision 6 catches the same problem at the point of use.
* *Adding a Warn Amber token* — costs amendments to §3.1, §3.2, and §3.3 to buy a convention users do not need once red is available; see decision 10.
* *Taking over the §6.14 banner for the storage warning* — that strip is the paid-conversion lever, and displacing it during a lapse is precisely backwards.
* *A modal on entry* — a recurring blocking dialog for a condition persisting for weeks trains people to dismiss it unread.
* *Making the offer sentence itself the link, inside the note* — buries the action in an explanatory paragraph where its tap target is an irregular multi-line shape.
* *A Primary button in the summary block* — competes with the heading band's control and would be the screen's only Primary button pointing away from the screen's own task.
* *Dropping the bottom banner in favor of the contextual line* — loses the persistent lever on every other screen for no gain.

**Corrections made during the cut**

Four pre-existing errors were found in the masters while cutting and are recorded in the v2.9 Schedule A entry rather than fixed silently. §9.1.2 (both the Requests and the ToDos band) and §9.9.2 still described heading bands as Field-Yellow, a token retired in v2.5 and replaced by Band #E7E7E7 — the Figure 9.9.1 caption two paragraphs above already said Band, so the section contradicted its own figure. The §9.9.5 figure caption omitted the `\\\\\\\_palette1` suffix from the mockup filename. The §3.2 note recording Field Yellow's retirement, and the v2.0, v2.3, and v2.5 history entries that describe it as current at the time, stand as written.

**Follow-ups**

* Owner: replace canonical files in project knowledge with **WouldYouPlease\_PRD\_v12\_6.docx** and **WouldYouPlease\_UI\_Design\_Specification\_v2\_9.docx**, and update the Canonical sources block to v12.6 / v2.9. The mockups in project knowledge are current except **WYP\_storage\_maintenance\_palette1.html**, which is one revision behind — the copy there predates the contextual offer line (decision 24).
* Owner: **WYP\_main\_screen\_palette1.html is missing from project knowledge**, though the Canonical sources block lists it. It was present at the start of this session and absent by the end.
* Owner: open v2.9 and v12.6 in Word and press F9 once so each table of contents picks up the new sections (§1.5, §6.18, §9.19; PRD §6.3). The TOC fields are flagged dirty and should offer to refresh on open.
* Owner: run cost estimates, then set the paid-tier storage figure in PRD §6 and add-on increments and pricing in §11. Blocks both the §9.19 offer copy and the §9.17 subscription-features screen, neither of which can state a number until then.
* **Applied in v2.9**: §6.11.1, §9.9.1, §9.9.2, §9.9.3, §9.9.5 (Save / Add Contact); §9.2 heading and TOC line, §9.2.1 caption, §9.2.2, §6.16 Notes, §9.8 retirement note (Create Request); §9.9.2 and §9.9.3 (tier-scoped minimum); new §1.5, §6.18, §9.19; §3.1 Alert Red usage cell and Band token; §4.3 weekday exception; §10.3 Enter-key behavior; §9.6 tombstone paragraph; §9.2.3 and a new §9.2.5 edge case for the size caps; Schedule A v2.9. Figures 9.2.1, 9.9.1, and 9.9.2 re-rendered from the updated mockups; Figure 9.19.1 added. Version-history entries for v2.0, v2.3, v2.5, v2.7, and v2.8 stand as history.
* **Applied in v12.6**: §2.1 caps and the storage-accounting and neutral-refusal rules; §2.6 Email and Phone field definitions made tier-scoped, plus the closing sentence; six screen-name instances; new §6.3 Subscription Lapse; §14.1 and §14.2 entries; §15.2 paid-tier storage figure. The v12.4 history entry stands as history.
* Confirm the deletion hour, **written into §6.3 as end of day in the account holder's profile time zone** to match §2.7's Overdue anchor. Flagged rather than assumed: nothing in the PRD previously specified it.
* Confirm whether the 30-day clock also governs the retention reversion from perpetual to one year. Recorded as an open item inside §6.3 itself. If it does, day 31 removes far more than attachments and the notices need a corresponding line.
* Confirm whether editing a phone-only contact is the only prompt point, or whether selecting such a contact on Create Request should also prompt inline.
* Open: does the §9.19 list support multi-select for bulk removal? Ties to the bulk-actions question already open in §9.7.
* Open: destination for the contextual offer — §9.17 whole, or a storage section within it once that screen is structured.
* Open: §9.19's Close is a placeholder for whatever back affordance §9 eventually adopts; the spec defines none.
* ~~Confirm the §2.6 sentence.~~ **Confirmed by the owner, 2026-07-22.** Its closing paragraph reads "routes through Add Contact ... returned to Create Request," renaming both screens, with the action phrasing "Creating a Request" left lowercase. An earlier instruction in this session said that paragraph needed no change; a later one directed the PRD renames generally, and renaming only one would have left the sentence mixing conventions. As shipped in v12.6. No further action.
* Still open from prior entries: §6.17 calendar and clock picker visual design (queued 2026-07-21); the 2026-07-21 confirmations, if not yet given.



## 2026-07-21 — Respond to Request fully designed; Category made sender-private; §6.16 picker exception (UI spec v2.7 → v2.8; PRD v12.4 → v12.5 pending)

**Decisions taken**

1. **Respond to Request fully designed** from the owner mockups (Rerspond\_to\_Request.png, Rerspond\_to\_Request\_v2.png) and specified as UI spec §9.3, replacing its placeholder. Layout follows the Create a Request pattern: "Respond to Request" group label on the Band heading band with Send (Primary) and Cancel (Secondary) right-aligned; read-only request header; form fields on Row Tint; Subscription banner and free-tier ad slot at bottom. Canonical mockup: **WYP\_respond\_to\_request\_palette1.html** (Figure 9.3.1 embedded from the 480-px render, 2x).
2. **No dedicated free-text response field.** The recipient's reply is carried by three existing channels — the Done state, the Dialog thread, and response attachments. Rationale: a separate response box duplicates the Comment type in Dialog and splits the conversation across two places with different notification and audit behavior; Dialog entries are already immutable and threaded (PRD §4).
3. **Category is private to the sender.** On a Request the Category is a sender-side organizing label only. It is never shown to the recipient: not on Received rows, not on Respond to Request, not on the recipient's Detailed Item view, not in the non-registered web response view, and not in the notification email or its .ics attachment. The sender keeps Category display, search, and filtering on Sent. ToDos are unaffected (no recipient). Consequence: the Create a Request field label becomes **"Private Category (optional)"** so the sender knows the label is not transmitted.
4. **Done Date and Done Time are selected, not auto-filled.** Opening the screen leaves both empty; the recipient sets each with its picker. Rationale: auto-filling today's date on arrival would mark items Done merely by opening them, and would make "respond without completing" impossible to express. Empty Done fields at rest are therefore the resting state, and Send never marks an item Done implicitly.
5. **Done Date renders in the locale-aware weekday-long form** (e.g. "Monday, October 19, 2026"), matching the Due line so the two read as a matched pair; the Done Date field is widened and **Done Time narrowed** to accommodate it.
6. **Done Time is conditional**: shown only while the selected Done Date equals the Request's Due Date *and* the Request carries a Due Time; hidden on any other Done Date and on date-only Requests. Evaluated live as the Done Date changes. Rationale: time of day changes the on-time / Overdue outcome only on the due date itself (PRD §2.7), so on every other day the field is noise.
7. **§6.16 gains a picker-field exception.** The Calendar and Clock affordance glyphs **persist** beside the floated label whenever the field holds a value, because a picker field has no text to retype and the glyph is the only visible cue that the picker can be re-opened. Type-ahead **Lookup** fields keep the default rule (glyph hidden once a value is present) since they are edited by typing — preserving the Category-filled-without-glyph state shown in Figure 9.2.1. The exception also applies to Due Date / Due Time on Create a Request (§9.2); the figure is unaffected because those fields are shown empty. *Reasoning correction logged:* the exception was briefly assessed as moot once auto-fill was dropped (empty fields already show the glyph under the default rule); that was wrong — the exception governs the **filled** state, which is exactly the state the owner's v1 mockup and the "editable with the respective icons" note called for.
8. **Request attachments are read-only but downloadable; no overwrite.** The recipient can download the sender's files, edit them locally, and re-upload the edited copy as a *new* response attachment; the sender's original is never replaced or removed. Request attachment rows therefore carry no remove (×) control — the filename itself is the download affordance in Brand Blue — while the recipient's own uploads render as removable rows. The 10-attachment cap (PRD §2.1) applies to the combined count.
9. **Read-only detail field labels are app (Brand) blue**, with Ink values. §3.1's Brand Blue usage cell is extended accordingly. Applies to the Date / From / Due header and the panel labels on this screen.
10. **Add to Calendar** is a Primary button beside the request header, downloading an .ics for the due date and, where present, the Due Time (PRD §7.3).

**Alternatives considered and rejected**

* *A dedicated Response text field* — duplicates the Dialog Comment type and fragments the thread; rejected per decision 2.
* *Auto-filling Done Date/Time on open, editable afterwards* — silently completes items and removes the participate-without-completing path; rejected per decision 4.
* *Showing Done Time always* — presents a control that cannot affect the outcome on any day but the due date; rejected per decision 6.
* *Dropping the §6.16 exception once auto-fill was dropped* — conflates the empty and filled states; see the correction in decision 7.
* *A dedicated download icon on attachment rows* — would require a twelfth icon asset and a new group in §5.1/§11.1 for a single screen; the filename-as-link affordance carries the same meaning with no asset change. Revisit if download appears on other screens.
* *Showing the Category read-only to the recipient* — rejected as decision 3; a sender's private filing label ("Chase later", "Cheap vendor") is not recipient-facing content.

**Process note — document regeneration**

The v2.8 cut was first regenerated from the markdown extraction held in project knowledge. That file is a text extraction, not the Word master, so the rebuilt document lost the type ramp, heading colors, table borders and header shading, and **all sixteen embedded images** (the four figures plus the §3.1 swatch cells and §5.1 icon cells). Corrected by editing the uploaded v2.7 master's XML in place, which preserves every unedited byte of formatting. **Rule going forward: cuts are made against the uploaded Word master, never regenerated from the project-knowledge extraction.** The PRD cut is held for the same reason until the v12.4 master is uploaded.

**Follow-ups**

* Owner: replace canonical files in project knowledge (UI spec v2.8, WYP\_respond\_to\_request\_palette1.html, updated WYP\_create\_request\_palette1.html, this log); update the Canonical sources block to UI spec v2.8.
* Owner: upload WouldYouPlease\_PRD\_v12\_4.docx (the Word master) so PRD v12.5 can be cut — §2.3 Category-privacy bullet, §5 and §14.1 pointers to §9.3, Schedule A entry, and a correction to the stale §5 line that still calls Category "a free-text field with autocomplete" (contradicts the v12.4 selection-or-Add-Category rule).
* Owner: open v2.8 in Word and press F9 once so the TOC picks up §9.3.1–§9.3.5 (the field is flagged dirty and should refresh on open).
* Confirm the three items built to recommended defaults: Done fields shown filled in Figure 9.3.1 (illustrative, as Category is on Figure 9.2.1) rather than empty; "(optional)" kept lowercase to match Due Time and Attachments; panel labels Brand Blue on Respond where Create a Request uses Ink.
* Confirm the assumption that the header's "Date:" is the Request's **sent** date.
* Next design task (still queued): §6.17 calendar and clock picker visual design.
* Still open from prior entries: none outstanding.



## 2026-07-20 — Create a Request fully designed; lookup/picker glyph convention; Due Time added; §9.8 retired (UI spec v2.6 → v2.7; PRD v12.3 → v12.4)

**Decisions taken**

1. **Create a Request fully designed** from the owner mockup (Create\_a\_Request\_-\_new\_format.png) and specified as UI spec §9.2, replacing its placeholder. Layout follows the Add a Contact pattern: "Create a Request" group label on the Band heading band with Send (Primary) and Cancel (Secondary) right-aligned; floating-label fields on Row Tint; Subscription banner and free-tier ad slot at bottom. Screen title standardized as **"Create a Request"** — sending is part of creating, and "Create \& Send" makes the label too long. Canonical mockup: **WYP\_create\_request\_palette1.html** (Figure 9.2.1 embedded from the 480-px render, 2x).
2. **Label-affordance glyph convention adopted (new component §6.16; §6.17 placeholder for the pickers).** Type-ahead and picker fields carry a leading glyph inside the resting floating label; the glyph disappears when the label floats. Glyphs render at **≈120% of the resting label font size (≈17 px against the 14-px label), vertically centered on the label text** (owner sizing decision, this date; centering chosen over baseline alignment because the three shapes have different visual weights). Component numbering note: drafted as §6.15/§6.16, renumbered to §6.16/§6.17 because v2.6 already used §6.15 for the Reserved ad slot.
3. **Lookup glyph final design (rev. c, two owner mockups this date):** faded-grey magnifier in **Input Border #7E8A9A** overlaid by a **solid Ink #1F2933 down-pointer**, with a **white knockout halo** breaking the lens stroke around the pointer — the same white-behind-dark technique as the logo's check mark — so the two elements read as an overlay, not one shape. Iteration history: (a) stroked down-caret beside the lens — rejected, caret too small to recognize; (b) solid Ink pointer protruding at the lens's right — rejected, read as an extension of the magnifier rather than an overlay. Calendar and clock glyphs remain Ink Soft #5A6675. The plain magnifier (wyp\_icon\_search.svg) retains its single meaning: execute a search. Assets: wyp\_icon\_lookup.svg, wyp\_icon\_calendar.svg, wyp\_icon\_clock.svg (knockout assumes a light field background).
4. **Recipient picker is inline type-ahead.** First Name field lists/sorts "First Last"; Last Name lists/sorts "Last, First"; left-to-right prefix match with the matched prefix highlighted; selecting from either list fills both fields. No-match state offers "Add '{typed}' as a new contact…" → §9.9 pre-filled. After selection, a caption shows the delivery channel ("Will be sent by Email" / "Will be sent by Request Texting").
5. **§9.8 Find / Select / Add Contact retired** (heading retained for numbering; duplicate detection stays in §9.9.4; the Phase 2 contact-import consent question moves to PRD §9.3).
6. **Due Time (optional) added to the Request data model** (PRD §2.1; new §2.7). A Request with a Due Time becomes **Overdue at the stated time**; date-only Requests become Overdue at end of the due date (11:59 PM), **anchored to the sender's time zone**; times are entered in the sender's time zone and displayed in each viewer's local time zone. On the main screen, **rows carrying a Due Time gain a third line: the time renders beneath the date in the Due column**, inheriting the row's bold/red treatment (PRD §3.2; UI spec §6.4.1); description truncation (2 lines) is unaffected. ToDos unchanged: no Due Time, Overdue still does not apply.
7. **Add Category confirmed as a one-field dialog** (§6.12) that creates the category (20-cap enforced inline) and selects it; rename/delete remain Settings-only. The compose Category field accepts list selection or dialog creation, not raw free text.
8. **Request Type selector deliberately omitted** from the pilot screen; it ships with the Phase 2 Custom Data Fields bundle.
9. **Compose behavior details:** required fields are recipient, Due Date, Description (optional fields explicitly labeled); Send is never disabled, failures marked inline; confirm-discard dialog on Cancel when the form is dirty; description counter appears past 400 of 500 characters; attachments panel is a fixed-height list with per-row remove and a vertical elevator, Add Attachment disabled at the 10-file cap; Due Time inert until a Due Date is set; month-forward calendar / now-forward clock (visual design deferred to §6.17; pilot uses browser-native pickers styled to palette 1).
10. **v2.7 / v12.4 cut and accepted.** Tracked redlines (author "Claude") were produced against the uploaded v2.6 / v12.3 originals and validated (schema-valid; every change tracked); clean versions were then generated with the post-redline wording agreed this date (glyph sizing/coloring, Due Time third line) already applied: WouldYouPlease\_UI\_Design\_Specification\_v2\_7.docx, WouldYouPlease\_PRD\_v12\_4.docx. Remaining manual steps in Word: refresh the PRD table of contents (F9) so §2.7 appears, and embed Figure 9.2.1 from the browser render of the canonical mockup.

**Alternatives considered and rejected**

* *Reusing wyp\_icon\_search.svg for lookup fields* — one glyph, two behaviors (executes a search vs. announces focus behavior) collides with the documented search-bar meaning.
* *Unicode character (e.g. ⌕ U+2315) instead of an SVG* — glyph coverage and rendering weight vary across Windows/iOS/Android/web fonts; an SVG is the only controllable rendering.
* *Trailing chevron only* — standard combobox cue but reads as a plain pull-down and undersells the type-ahead.
* *"Create \& Send Request" title* — sending is inherent to creating; label too long.
* *Full-width third line for the Due Time* — breaks four-column scanning; time beneath the date in the Due column keeps the grid aligned.
* *Pure #000 pointer* — Ink #1F2933 is visually identical at size and stays inside the palette.

**Follow-ups**

* Owner: replace canonical files in project knowledge (PRD v12.4, UI spec v2.7, WYP\_create\_request\_palette1.html, the three glyph SVGs, this log); update the Canonical sources block per wyp\_project\_instructions\_update.md (PRD v12.4, UI spec v2.7 docx, nine icons, retire the Excel sheet/row/column preference).
* Owner: on-device legibility check of the three glyphs at 17 px inside resting labels; F9 the PRD TOC; visual pass over Figures 5.1, 9.1, 9.2.1, 9.9.1, 9.9.2 (image references were rebuilt after an accept-step fault mispaired pictures, and Figure 9.2.1 was rendered in-environment rather than in Chrome).
* Next design task (owner-queued): §6.17 calendar and clock picker visual design.
* Still open from prior entries: ToDos chips strip color.

\---

## 2026-07-17 (later) — Readability restructure of both documents

Both redlines reorganized per owner request: (1) a Contents section (two levels, Word TOC field over Heading 1/2) inserted at the front of each document — the field populates on open in Word (auto-update enabled) or via F9; (2) the version history moved out of the front matter into a new "Schedule A — Revision History" at the end of each document, split into one entry per version for readability (UI spec: 7 entries; PRD: 18). A schedule was chosen over a numbered section before the open-questions/issues sections to avoid renumbering §12/§13+ and breaking cross-references. Title-page and footer version strings bumped to v2.5 / v12.3 (footer edits are outside Word's tracked-changes scope; all body changes remain tracked). Both documents revalidated against their originals.

\---

## 2026-07-17 — Figures embedded, §12 restructure, banner label finalized

**Decisions taken**

1. **Screen layouts live only in the UI Specification** (owner decision). PRD §12 is restructured to a pointer: the embedded main-screen figure, its caption, and the §12.1 design-decision bullets are removed; §12 now states that all screen designs, renders, and design commentary are specified only in the companion spec, with functional behavior remaining in PRD §3. Before deletion, every §12.1 rule was verified as already present elsewhere (filter independence PRD §3.3; sort defaults and tap-to-reverse §3.2/§3.4; overdue-red rows §3.2; print Dialog prompt §3.6; truncation §2.4) — nothing orphaned. The §14.2 cross-reference to Figure 12.1 now points to spec Figure 9.1. Rationale: recurring update hiccups and the stale "radio buttons" bullet showed duplicated design detail rots in place; the documents' own separation-of-concerns statement argues for single-homing.
2. **Free-tier banner label finalized: "See Subscription Features and Other Options"** (renamed from "See Subscription Options and Features"), making non-subscription settings discoverable behind the free-tier banner and resolving the open question logged 2026-07-16. Subscriber label unchanged. Updated in both redlines, both mockups, and the §12 open-questions list (question removed).
3. **Figures embedded in the UI spec** from the canonical mockups at 480-px width (2x): Figure 9.1 from WYP\_main\_screen\_palette1.html; Figure 9.9.1 from WYP\_add\_contact\_palette1\_floating.html; Figure 9.9.2 from the new WYP\_add\_contact\_no\_contact\_dialog\_palette1.html (palette-1 form under the §6.12 acknowledge-only dialog and Scrim), which replaces WYP\_add\_contact\_no\_contact\_dialog.html as the canonical dialog mockup. Image swaps are not trackable as Word revisions; captions carry the tracked source references.
4. **UI spec §11.1**: the wyp\_icon\_settings.svg bullet is tracked-deleted (retirement was already recorded in §5.1 and the version histories).

**Follow-ups**

* Owner: replace canonical files in project knowledge (both redlines after accept, three mockups, this log); update the Canonical sources block (UI spec v2.5, PRD v12.3, mockup filenames); add "Request Texting" to the terminology list; correct the instructions-block price to $17.95/year; add the new maintenance sentence (screen renders and design detail belong to the UI spec only).
* Still open: on-device check of Band #E7E7E7; ToDos chips strip color.

\---

## 2026-07-16 (later) — v2.5 / v12.3 redlines cut

UI spec v2.5 and PRD v12.3 produced as tracked-changes documents (author "Claude"): WouldYouPlease\_UI\_Design\_Specification\_v2\_5\_tracked.docx, WouldYouPlease\_PRD\_v12\_3\_tracked.docx, per the change manifest (WYP\_v2.5\_v12.3\_change\_manifest.md). Owner approved the three flagged items before the cut: band hairlines dropped, banner attention wash moved to Focus Tint, and the stale "radio buttons" bullet in PRD §12.1 corrected to chips. Figure 12.1 / 9.1 image re-embeds remain pending (requires rendering the HTML mockups to images). After review/accept: replace the canonical files in project knowledge, update the Canonical sources block version numbers, add "Request Texting" to the terminology list, and correct the instructions-block price to $17.95/year (PRD wins per precedence rule).

\---

## 2026-07-16 — Floating labels, Focus Halo, and blue focus tint adopted; Band darkened to #E7E7E7

**Decisions taken**

1. **Floating-label input pattern adopted** (closes the 2026-07-15 open question). §6.10 anatomy becomes: label inside the field at rest (14 px/500, Ink Soft), rising above the value on focus or when a value is present (≈11 px/600; Brand Blue while focused, Ink otherwise); field minimum height 50 px; transition suppressed under prefers-reduced-motion per §8.9.
2. **Focus Halo adopted.** `--focus-halo: 0 0 0 3px rgba(42,95,200,.22)` is promoted from proposed to canonical (§3.1). Full focus state for text inputs: #EDF2FD fill, 1-px Brand Blue border, 3-px halo.
3. **Blue focus tint #EDF2FD confirmed** as the merged behavior of the floating-label exploration (which predated palette 1 and used Field Yellow) and palette 1's retirement of yellow fills.
4. **Band darkened: #EFF1F4 → #E7E7E7.** The lighter grey read too weak, most visibly on Add a Contact where the band sits directly against the #F6F7F9 form surface with no white gap; owner judged it too light even on the main screen where white space intervenes. #E7E7E7 was the owner's darkness reference and is adopted exactly: a *pure neutral* grey, deliberately not a cool grey, so the group-level Band is unmistakably distinct from the blue-family Strip #E5ECF7 (one hue step per hierarchy level). Owner notes the hex is approximate to the intended darkness; confirm on device.
5. **Compressed "Send Requests by" row adopted** (owner mockup, this date). The chip pair and the gating notice share one full-width Strip row (chips left, notice right, vertically centered, \~44-px min height), replacing the v2.4 fit-content Strip island with the notice below. Rationale: the fit-content tint existed only to keep the white unselected chip visible and read as arbitrary; full-width, Strip reads as an intentional control row, consistent with the search bar's Strip-tinted Settings segment. The notice sits adjacent to the Text chip it explains, and its appearance can never reflow the form.
6. **Gating notice is persistent, both tiers** — supersedes 2026-07-06 decision 2's reactive behavior (notice appeared only when a free user tapped Text). The reactive design existed to avoid vertical cost, which the side-by-side layout eliminates; a persistent notice also upsells before the failed tap and keeps the row identical across tiers. On narrow screens the notice may wrap to three lines and the row grows — accepted by owner; no stack-back breakpoint.
7. **Notice text: Ink Soft #5A6675 at 12 px** (≈4.9:1 on Strip, clears AA 4.5:1). Owner's mockup grey was lighter; no new grey token introduced. Escalate to Ink if faint on device.
8. **Tier-differentiated notice wording adopted.** Free user: "Texting a Request is available with a subscription — see the banner below." Subscriber: "Your subscription includes Request Texting — see the banner below for other options." Line breaks fall naturally after "subscription" (free) and "Texting" (subscriber) at the standard 480-px width. *Unresolved conflict, flagged:* §6.14 hides the subscription banner for subscribers, so the subscriber string's "see the banner below" currently points at nothing — resolve before v2.5 (reword, or change §6.14 to show subscribers an options banner).
9. **Banner strategy revised: the bottom banner shows for both tiers** (owner mockups, this date), with tier wording — free user: "See Subscription Options and Features"; subscriber: "Account Options and Features". This resolves decision 8's flagged conflict: the subscriber notice's "banner below" reference now points at a real surface. §6.14's "subscribers: hidden" rule is superseded. The ad slot remains free-tier only per the PRD freemium constant (paid = ad-free); the subscriber mockup showed the ad slot, treated as a mockup artifact pending owner confirmation.
10. **Settings gear removed from the main-screen search bar**; remaining search-bar content (scope pull-down, field, voice, search icons) shifts left. Settings/account functions are assumed to live behind the banner destination for both tiers. §6.6 "part 0" Settings segment is retired. The wyp\_icon set is unaffected (the gear was not one of the six canonical icons).
11. **"Request Texting" locked as the feature's proper name** — add to the project terminology list. Both notice strings now use it (decision 12), replacing the mixed "Texting a Request"/"Request Texting" phrasing.
12. **Notice strings revised (supersede decision 8's strings).** Free user: "Request Texting is available with a subscription — see the banner below." Subscriber: "Request Texting is included in your subscription — see the Account banner below for other options."

**Alternatives considered and rejected**

* *Cool grey at the same darkness (≈#E3E7EC)* — sits within 1–2 steps of both Rule #E2E6EC and Strip #E5ECF7; the band would read as a wide hairline or a faded Strip, re-collapsing the two-level cue the palette work just sharpened.
* *Keeping #EFF1F4 and adding a white gap on Add a Contact instead* — treats the symptom on one screen; owner confirmed the band was too light even with the gap.

**Consequence to note**

* The band's 1-px Rule hairlines (#E2E6EC on #E7E7E7) are now effectively invisible. Harmless — the fill self-defines the band edge against white above and #F6F7F9 below — but v2.5 should either drop the band hairlines or leave them documented as vestigial. Recommendation at cut time: drop.

**Mockup files**

* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_palette1.html`, `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html` — both updated in place with Band #E7E7E7. The Add a Contact variant is now the approved reference for §6.10.
* *Dropping the Strip and giving unselected chips the Input Border* — compresses equally but bordered white chips read as buttons/fields rather than a selector, and discards Strip-means-control-surface.

**Follow-ups**

* Confirm the ad slot stays free-tier only (subscriber mockup showed it; PRD says paid = ad-free).
* Confirm where free users reach non-subscription settings now that the gear is gone (assumed: the banner destination page carries account options for both tiers).
* Add "Request Texting" to the terminology list in the Project instructions block.
* On-device check of #E7E7E7 before the v2.5 cut (owner flagged the hex as approximate).
* Still open from 2026-07-15: ToDos chips strip — Strip blue vs neutral.
* Cut UI spec v2.5 with tracked changes (list in the 2026-07-15 entry, plus: §3.1 Focus Halo row and Band #E7E7E7; §6.10 floating-label anatomy and 50-px height; band hairline decision; §6.2/§9.9 compressed send-by row and persistent notice with decision-12 strings; §6.6 gear removal; §6.14 both-tier banner with tier wording; §9.1 figure regenerated without the gear).

\---



## 2026-07-15 — Palette 1 ("modernize around Brand Blue") adopted; entry-field visibility resolved; floating-label exploration continued (UI spec v2.4 → v2.5 cut pending)

*Recovery note: the three palette options were designed in the "Color palette design for screen…" conversation, which hit the per-conversation length limit and could no longer accept input. The option text was recovered by copy-paste and is recorded here in full so the reasoning is not lost. Lesson applied: palette-level decisions now land in this log the day they are made.*

**Decisions taken**

1. **Palette option 1 adopted.** Keep Brand Blue #2A5FC8 exactly as is (protects the nine logo/icon SVGs, the sales one-pager, and the domain's identity) and modernize everything around it: primary buttons go flat (solid Brand Blue; hover/pressed at Blue Pressed #1E4AA0; no gradient, no 2-px bevel shadow); Row Tint moves from blue #EFF4FC to neutral near-white **#F6F7F9**; Field Yellow retires as a fill; the focus state becomes a soft blue tint **#EDF2FD** under a 1-px Brand Blue border and the proposed Focus Halo; red becomes exclusively a status color. Owner confirmed after reviewing the applied main-screen mockup.
2. **Heading bands survive, in neutral.** The Requests / ToDos heading bands keep their structural job (quick visual reference to the two major screen regions — the original purpose of the yellow) but the fill moves to a new neutral **Band** token **#EFF1F4** and the group labels move from Alert Red to Ink. This resolves palette option 1's own open question ("bands neutral, or keep a yellow accent?") toward neutral.
3. **Strip stays blue.** Palette 1 retired the blue Row Tint canvas, not Strip #E5ECF7. The Sent/Received/ToDos sub-heading and chips strips (and the search bar's Settings segment) keep Strip, preserving the second-level cue — blue-tinted strip = section chrome — and Strip becomes the only blue-tinted surface, which sharpens the cue.
4. **Sort Highlight #FFE34D is the single surviving yellow**, used for the active-sort pill only. Field Yellow's heading-band job passes to Band (decision 2); its focus-fill job passes to #EDF2FD (decision 1). The Field Yellow token is retired from §3.1.
5. **New Input Border token #7E8A9A.** With near-white surfaces, a white field with the 1-px Rule border (#E2E6EC, ≈1.3:1 on white) effectively disappears — the owner's concern for Add a Contact and all future entry screens, confirmed by contrast math. Text inputs, the scope pull-down, the search field, and the country-code selector take a 1-px **Input Border #7E8A9A** boundary (≈3.5:1 on white, clearing the WCAG 2.1 §1.4.11 3:1 non-text minimum). Rule remains for hairlines, dividers, and card borders only. This settles field visibility once at the token level.
6. **Focus system unifies on one color family.** Focused fields: #EDF2FD fill, 1-px Brand Blue border, 3-px Focus Halo (proposed token `--focus-halo: 0 0 0 3px rgba(42,95,200,.22)`). The yellow-means-active convention (2026-07-05 decision 8) is superseded: blue-tint-means-active, matching the Brand Blue focus rings already in §10.3.
7. **Alert Red is status-only.** Overdue rows, the Overdue chip, and inline error messages keep red; group labels lose it (decision 2). This strengthens the PRD's existing rule that red = Overdue by making red mean exactly one thing app-wide.
8. **Floating-label input pattern applied to Add a Contact for review (not yet adopted).** Per the recovered exploration: label floats inside the field, rising on focus or when a value is present; field minimum height 50 px (up from 40 px) to seat the risen label; label transition suppressed under prefers-reduced-motion per §8.9. Under palette 1 the floating pattern's focus fill is #EDF2FD (the exploration predated the palette decision and used Field Yellow). The two questions remain separable and open: halo yes/no, floating label yes/no.

**Palette options recorded (recovered text, condensed)**

* *Option 1 — adopted (above).* "Cheapest change with the biggest perceived-age effect"; touches no PRD design constants except the Field Yellow references in the UI spec.
* *Option 2 — deep teal.* Suits the courteous product personality; rejected as second choice: full asset repaint, abandons blue equity, and teal pairs poorly with a red status color at equal prominence.
* *Option 3 — iris violet.* Current productivity-app vernacular (Linear, Notion accents); rejected: fashionable in the way the 2012 gradient buttons were — most likely to date soonest.
* *Rejected outright:* warm cream + terracotta (this year's most overused AI-generated look); dark-mode-first with a neon accent (poor for a data-dense list app whose web-respond view opens for unregistered recipients in default light contexts); any green accent (collides with the natural semantic for Done).

**Alternatives considered and rejected (application decisions)**

* *Dropping the heading bands entirely* — fails the squint-test grouping of the two major regions, the bands' stated purpose.
* *Keeping the bands yellow as "the single yellow accent"* — competes with the Sort pill and keeps two yellows alive.
* *Blue-tinted (Strip) heading bands* — collapses the two-level hierarchy; group band and section strip would read as the same surface.
* *Grey-filled resting fields instead of a stronger border* — conflicts with white-at-rest (2026-07-05 decision 8's structure, which survives) and grey fills read as disabled.
* *Keeping Rule as the input border* — fails 3:1 on the new near-white surfaces; Rule was already ≈1.3:1 on white and was carried by the old tinted form background.

**Mockup files**

* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_palette1.html` — new; main screen with palette 1 applied (neutral bands, Ink group labels, flat buttons, #F6F7F9 zebra, Input Border on the search bar). Candidate Figure 9.1 for v2.5.
* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html` — new; Add a Contact with palette 1 plus the floating-label pattern (Email pre-filled to show the risen-label state). Review pending — floating label and halo are separate open decisions.
* The three existing v2.4 mockups remain canonical until v2.5 is cut.

**Documents to update (pending — UI spec v2.4 → v2.5 with tracked changes)**

* §3.1: Row Tint hex → #F6F7F9; Field Yellow row retired; new rows Band #EFF1F4, Input Border #7E8A9A, and (if adopted) Focus Halo; Strip usage note extended.
* §3.2: "Brand Blue on Field Yellow" verification mooted; re-verify Alert Red on the new Row Tint (passes — lighter surface, contrast improves); add Input Border 3:1 non-text verification.
* §3.3: tinted-background list updated (Band replaces Field Yellow; focus tint #EDF2FD noted as a state fill, not a surface).
* §6.1 Primary button: flat anatomy, pressed = Blue Pressed fill.
* §6.3 sort pill note: Sort Highlight is the sole yellow.
* §6.6 Search bar: field border → Input Border; bar surface → Band.
* §6.7 Group label: Ink on Band.
* §6.10 Text input: rest = white + Input Border; focus = #EDF2FD + Brand Blue border (+ halo if adopted); floating-label anatomy and 50-px height if adopted.
* §9.1 / §9.9 figures regenerated from the new mockups.
* PRD: Figure 12.1 regeneration; §12.1 key-decisions bullets touching yellow bands and red labels.

**Follow-ups**

* Owner review of `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html`: decide halo yes/no and floating label yes/no (separable).
* Decide whether the ToDos chips strip keeps Strip blue or goes neutral to extend the color-coding logic (Sent/Received = Requests family).
* Confirm the Band grey #EFF1F4 after on-device review (warmer/cooler/darker).
* Cut UI spec v2.5 with tracked changes per the list above; then replace mockups in project knowledge and update the Canonical sources block.
* Web-respond emails already in flight render with the old palette; no action needed, but note for support if recipients report a mismatch during rollout.

\---



## 2026-07-06 — Per-contact Request delivery channel, subscription gating, Subscription banner, ad slot, Settings icon (UI spec v2.3 → v2.4; PRD v12.1.1 → v12.2 pending)

**Decisions taken**

1. **Per-contact delivery channel on Add / Edit Contact.** A "Send Requests by" field — a two-chip single-select row (Email / Text) in the §6.2 chip anatomy on a Strip surface — sits directly after Phone, before Notes (Notes stays last, preserving the 2026-07-05 field order). Email is the default; until the user taps a chip explicitly, the selection auto-follows data entry (filling Phone while Email is empty switches to Text, subscribers only, and vice versa); once tapped, the choice sticks.
2. **Text delivery is a subscriber feature.** For free users, tapping Text does not change the selection; an inline Ink Soft notice appears beneath the chip row — "Sending Requests by Text is available with a subscription — see the banner below." — and the Subscription banner washes Field Yellow for \~2 s (no wash under reduced motion). Rationale: Twilio/SNS per-message SMS cost is then incurred only by revenue-generating accounts, consistent with the 2026-07-02 decision to monetize via optional paid add-on features.
3. **Validation follows the selection.** On Save the field matching the delivery selection is required. Because a free user's selection is always Email, free-tier contacts effectively require an Email; Phone remains optional "for later subscription use — or just for reference" (owner wording). This narrows the 2026-07-05 either-Email-or-Phone minimum for the free tier; confirmed by the owner. Free-tier caption: "Minimum required — Either First or Last Name, and an Email. Phone is optional and can be used for Text delivery with a subscription." Subscriber caption: "…and the Email or Phone that matches your Send Requests by choice."
4. **Subscription banner (§6.14), free tier only, all screens.** Full-width, min 40-px, white, 1-px Rule top hairline, centered 13-px/700 Brand Blue label "See Subscription Options and Features"; the whole strip opens Subscription/Upgrade (§9.14). Subscribers never see it (owner decision this date, superseding the earlier all-users intent) and manage their plan through Settings instead.
5. **Settings icon and search-bar segment.** Eighth icon `wyp\\\\\\\_icon\\\\\\\_settings.svg` (gear, house style: 48 viewBox, #2A5FC8, 2.5-px strokes, round caps). Lives in a new leading Strip-tinted segment of the search bar (§6.6): full bar height, 46-px wide, 1-px Rule right hairline. Strip chosen over the owner mockup's darker-yellow segment — Strip already means "interactive chrome surface," avoids a new §3.1 token, and a darker yellow risks reading as a focused field. Icon renders at 24 px matching Voice Search and Search (initial 22-px draft corrected after owner review; glyph extent also enlarged to match optical weight). Settings is main-screen-only; task screens carry no Settings entry.
6. **AdSense shares the bottom edge (free tier).** Reserved fixed 50-px slot (320×50 unit) at the true bottom edge, below the banner (§6.15). Stack order search bar → banner → ad keeps the banner as a buffer against accidental ad taps. Free-tier bottom chrome ≈ 148 px on the main screen; subscribers carry only the \~56-px search bar. 320×100 rejected (≈30% of a small-phone viewport).
7. **Figures regenerated.** Figures 9.9.1/9.9.2 re-rendered from the updated mockups (free-tier state, gating notice shown for documentation); Figure 9.1 re-rendered from the updated main-screen mockup at the original 480×1391 aspect — this also clears the v2.3 flag that Figure 9.1 still showed the removed header rule.

**Alternatives considered and rejected**

* *Owner-mockup presentation* — two wide verb-labeled pills ("Send Requests by Email" / "Send Requests by Text") below Notes: the selected pill is visually identical to the Secondary button (§6.11), verb-led labels read as immediate actions, and the control sits away from the fields it validates. Replaced by a labeled noun-chip pair after Phone.
* *New darker background token* for the chip strip and settings segment — Strip (#E5ECF7) already serves the purpose; §3.3 restricts new tinted backgrounds.
* *Hiding the Text chip from free users* — invisible features don't upsell.
* *Modal upsell on tapping Text* — heavier than the moment warrants; inline notice + banner wash chosen.
* *Toast for the gating notice* — auto-dismisses before the user finds the banner.
* *Radio buttons / dropdown* for the channel choice — radios retired in v2.1; a dropdown hides a two-option choice.
* *No control (auto email-else-SMS)* — the pre-existing PRD §7.3 rule; defeats the stated intent.
* *Header-band Settings placement* — owner judged it visually distracting; the band was deliberately stripped in v2.0.
* *Dismissible banner for subscribers* — mooted once the banner became free-tier-only.
* *320×100 ad unit* — excessive fixed chrome on small phones.

**Mockup and asset files**

* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_screen.html`, `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_no\\\\\\\_contact\\\\\\\_dialog.html` — chip pair, gating notice, updated minimum-required caption, banner + ad slot. Supersede prior copies.
* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` — settings segment, banner, ad slot. Supersedes prior copy.
* `wyp\\\\\\\_icon\\\\\\\_settings.svg` — new; source block added to `wyp\\\\\\\_assets\\\\\\\_source.md` (icon table now 8 entries). Add to `wyp\\\\\\\_assets\\\\\\\_reference.pdf` at next regeneration.

**Documents updated / pending**

* UI spec v2.3 → v2.4 cut with tracked changes: title page, version history, §3.3, §5 intro (icon count corrected Six → Eight — "Six" was already stale in v2.3, predating the v2.1 Contract icon), §5.1 table row, §6.2 Notes, §6.6 anatomy and notes, new §6.14 Subscription banner and §6.15 Reserved ad slot, §9.9 (composition, behavior, captions, open question on a per-Request channel override), §9.13/§9.14 entry points, §11.1, footers; Figures 9.1/9.9.1/9.9.2 images replaced.
* PRD v12.1.1 → v12.2 **blocked on upload of the true .docx** — project knowledge holds a text extraction, not the Word container (same situation as the UI spec before 2026-07-05). Required edits (exact wording drafted in chat): §3.8 contact delivery-method field; §6 feature table ("Send Requests by Text" paid; banner + ad stack free); §6.2 SMS-cost note; §7.3 pilot note reword (free senders deliver by email; SMS for subscriber senders per contact setting, and as fallback for non-registered recipients without a known email); §14.3 icon inventory 7 → 8.
* Project instructions "Canonical sources" block refreshed this date (see chat) — replaces the stale block citing PRD v11, the Excel UI spec, 6 icons, 3 logos, and $11.99/year.

**Follow-ups**

* Upload true PRD v12.1.1 .docx; cut v12.2 with tracked changes.
* Accept v2.4 tracked changes; replace UI spec v2.3 with v2.4 in project knowledge; replace the three HTML mockups and `wyp\\\\\\\_assets\\\\\\\_source.md`; regenerate `wyp\\\\\\\_assets\\\\\\\_reference.pdf` to include the settings icon.
* Open question carried in §9.9: per-Request one-off override of the contact's delivery channel (Phase 2 candidate).
* Pilot analytics: track gating-notice impressions → subscription conversions as a first-class metric alongside the §16 set.

\---



## 2026-07-05 — Add/Edit Contact screen design finalized (UI spec v2.2 → v2.3 cut pending)

**Decisions taken**

1. **Notes field retained** per PRD §3.8: multi-line, optional, 500-character limit consistent with the app-wide text convention.
2. **Minimum-required rule** per owner mockup: either First or Last Name, and either Email or Phone.
3. **Field order:** First Name, Last Name, Email, Phone, Notes (First Name first — matches North American entry habit and browser autofill order).
4. **Phone field uses a country-code selector** that defaults to a *visible* "+1" from browser locale — never blank. Stored values are E.164, required for SMS invitations via SNS/Twilio; Canada is also +1, so the default is not US-specific.
5. **Duplicate handling on Save:** if the entered email or phone matches an existing contact, a modal offers "This email matches your existing contact \[Name]." with actions Update that contact / Save as new / Cancel. Resolves the open duplicate question in UI spec §9.8.
6. **No-contact interception flow:** tapping Create Request with zero contacts routes to Add a Contact with an acknowledge-only modal ("To create a Request, a Contact is needed. Click anywhere to proceed. After you click Save Contact, you'll be returned to Create a Request."). Save returns to Create Request with the new contact selected; Cancel returns to the main screen with toast "Without adding at least one Contact, Requests cannot be created."
7. **New design-system items:** Scrim token (Ink #1F2933 at 45% opacity, §3.1); Text input (§6.10, including the phone country-code variant); Secondary button (§6.11 — white fill, 1.5-px Brand Blue outline); Modal dialog (§6.12); Toast (§6.13).
8. **Resting inputs are white with a Rule border;** Field Yellow marks only the focused field, preserving the yellow-means-active convention established by the search bar.
9. **Header bottom rule removed on all screens;** the first Field-Yellow heading band sits flush beneath the header with no top margin or top hairline (recovers 12 px). Subsequent heading bands on the same screen keep the 11-px top margin and hairline. Implemented in all three HTML mockups via `.hdr + .band{margin-top:0;border-top:none;}`.

**Alternatives considered and rejected**

* *First-Name-required rule* — stricter than the owner's stated minimum; rejected in favor of either-name.
* *Cancel returning to Create Request* — would immediately re-trigger the interception modal; main screen chosen instead.
* *"OK"-buttoned interception dialog* — click-anywhere dismissal is faster and matches the owner mockup.
* *Second filled-blue Cancel button* — equal visual weight for opposite actions; secondary style introduced instead.
* *Blank country-code display for the US default* — reads as unset/broken, hides that international entry is possible, and E.164 storage needs the code regardless.
* *Bottom-of-form button placement* — top placement matches the owner mockup and the established heading-band-plus-button pattern, and keeps Save visible without scrolling.
* *Disabling Save until the minimum is met* — hides why the button won't work; always-enabled with inline errors is more discoverable and screen-reader friendly.
* *Keeping the first band's top hairline at the header junction* — would visually reproduce the removed header rule.

**Mockup files**

* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_screen.html` — new; intended as Figure 9.9.1 in UI spec v2.3.
* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_no\\\\\\\_contact\\\\\\\_dialog.html` — new; intended as Figure 9.9.2.
* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` — updated (header rule removed, Requests band raised); **supersedes the copy in project knowledge**, which must be replaced or Figure 9.1 will show a line the spec no longer describes.

**Documents to update (pending)**

* UI spec v2.2 → v2.3 with tracked changes: §3.1 Scrim token; §6.8 header note ("no bottom rule; first heading band sits flush"); new §6.10–6.13; §9.8 duplicate cross-reference; §9.9 placeholder replaced with the full design; title page, version history, and footer. **Blocked on upload of the true v2.2 .docx** — project knowledge holds a text extraction, not the Word container.
* Project instructions "Canonical sources" block is stale (cites PRD v11, Excel UI spec, 6 icons, 3 logos, $11.99/year); refresh to PRD v12.1.1, UI spec v2.3 once cut, 7 icons, 4 logos, $17.95/year at the same time.

**Follow-ups**

* Toast microcopy sentence-case convention rolls into the existing §12 open question.
* Consider listing the three HTML mockup filenames in the canonical-sources block so they are formally part of the asset inventory.

\---

2026-07-05  v12.1 — PRD restyled to v11.x template after v12.0 formatting loss; title-page tagline corrected to 'Tracking Requests and ToDos'; file format flag updated so Word 365 no longer prompts to upgrade on save."

\---

2026-07-02 — Section 6.2 cost/revenue model corrections and monetization direction (PRD v11.1 → next revision)
Decisions taken

1. Long-term volumes corrected to linear per-user scaling. The prior Long-Term figures (5M items/day, 3M Dialog/day at 1M users) implied a 10x jump in per-user activity versus Pilot/Year 1. Per-user rates are now held constant (\~0.5 items, \~0.3 Dialog/day), giving 500,000 items and 300,000 Dialog entries/day at 1M users. 500,000/day is a planning figure; owner expects volumes may ramp well beyond it. Section 7.2 updated to match. Long-term annualized infrastructure drops from $410K–$660K to \~$100K–$180K.
2. Ad revenue now applies only to monthly-active users, at a 50–70% active share (owner selected the higher band). Long-term ad revenue $215K–$605K. No revenue from ad-driven purchases is assumed — owner has no basis for such an assumption.
3. Usage split assumption: \~50/50 personal/business, with most users doing both. Consequently, no personal/business flag at signup — users won't self-classify cleanly. Business-oriented monetization instead comes from optional paid add-on features drawn from the Section 9 roadmap.
4. Pricing held at $17.95/year, annual billing only, through the pilot. Monthly billing rejected: Stripe's $0.30 fixed fee is \~23% of a \~$1.50 monthly charge. Quarterly identified as the lowest practical recurring period (\~9% fee load) but deferred — it adds churn/dunning complexity for unproven demand. Corrected cost base no longer forces a price increase; revisit after pilot conversion data.
Alternatives rejected: personal/business signup flag; immediate price increase; quarterly SKU at launch; modeling ad-to-purchase uplift.
Follow-ups: add-on packaging/pricing added to PRD §15.2 open items; pilot analytics should track ad RPM and paid conversion as first-class metrics (already in §16).

\---

## 2026-06-28 — Logo asset finalization (PRD v11.1 / UI spec v2.2)

**Decisions taken**

1. **Horizontal lockup completed in matched light- and dark-background variants.** Two SVG files: `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_light\\\\\\\_bg.svg` (mark + brand-blue wordmark + grey tagline) and `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_dark\\\\\\\_bg.svg` (mark + white wordmark + light-blue tagline). Proportions match the main-screen header rendering in `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` (40-px mark height in the live mockup); the lockup viewBox is 820×220 with the mark seated at x=0 and the text block left-aligned at x=240.
2. **Stacked lockup format dropped.** Previously listed in PRD §14.3 and UI spec §11.2 as "to be regenerated." No longer needed; the horizontal lockup covers the use cases the stacked format was reserved for.
3. **Tagline canonical wording confirmed: "Tracking Requests and ToDos."** This matches the existing usage in PRD §12.1, UI spec §6.8, and the main-screen header mockup. Intermediate variants that surfaced during design exploration ("For Request Tracking and ToDos" in `wyp\\\\\\\_logo\\\\\\\_final\\\\\\\_overview.svg`, "Request and ToDo Tracking" considered briefly during horizontal lockup design) are explicitly non-canonical and should not be reintroduced. Capitalization is "ToDos" (capital T, capital D) wherever the term appears.
4. **`wyp\\\\\\\_icon\\\\\\\_only.svg` removed from the canonical inventory.** The prior speech-bubble mark was carried as "superseded" in PRD §14.3 since v7.2. It is no longer part of the asset bundle and is not maintained. If a future project needs the prior mark for historical context, it can be retrieved from git history of the asset source file.
5. **Naming convention for logo variants:** `wyp\\\\\\\_logo\\\\\\\_<format>\\\\\\\_<background>.svg`, where `<background>` is either `light\\\\\\\_bg` or `dark\\\\\\\_bg`. The existing `wyp\\\\\\\_logo\\\\\\\_checked\\\\\\\_request\\\\\\\_light\\\\\\\_bg.svg` / `wyp\\\\\\\_logo\\\\\\\_checked\\\\\\\_request\\\\\\\_dark\\\\\\\_bg.svg` pair already followed this; the new horizontal lockup files extend it. Future lockup formats, if any, should follow the same pattern.

**Asset bundle layout**

The canonical assets now live in two project-knowledge files:

* `wyp\\\\\\\_assets\\\\\\\_reference.pdf` — visual reference with every icon and logo rendered, including dark-background variants shown on illustrative brand-blue and navy panels.
* `wyp\\\\\\\_assets\\\\\\\_source.md` — markdown file with the raw SVG source for every asset in fenced code blocks. SVG is plain XML text, so any asset can be recovered by copying the relevant code block into a `.svg` file.

This pattern exists because the project knowledge base does not accept direct `.svg` uploads. The PDF and markdown together replace what would otherwise be a folder of nine standalone SVG files.

**Documents updated**

* PRD v11.0 → v11.1 (title page, version history, §14.3 asset inventory, page footer).
* UI Design Specification v2.1 → v2.2 (title page, version history, §6.3 logo narrative, §11.2 asset inventory, page footer corrected from a stale v1.0 to v2.2).
* Project instructions: "Canonical sources" block replaced to reference the new asset bundle files and the updated 7-icon / 4-logo inventory.

**Alternatives considered and rejected**

* *Single horizontal lockup file with no light/dark distinction.* Rejected because the dark variant needs different fill on the bubble (white instead of outlined) and different text colors (white wordmark, light-blue tagline). Trying to express both in one SVG would have required either inline CSS that responds to the host context (fragile across renderers) or runtime swapping (adds complexity for no clear gain). Two files is cleaner and matches the precedent set by the mark-only pair.
* *Keeping `wyp\\\\\\\_logo\\\\\\\_horizontal.svg` as a third lockup file alongside the light- and dark-background variants.* Rejected because there was no defined use case for an "unspecified background" lockup that wasn't already covered by one of the two background-specific variants.
* *Retaining `wyp\\\\\\\_icon\\\\\\\_only.svg` in the inventory as a historical reference.* Rejected because the canonical inventory should reflect current assets only. Historical references belong in the decisions log (this file) or git history, not in the active asset list.
* *Producing partial doc revisions per change rather than waiting for a version cut.* Rejected at the time and reversed by the explicit ask for tracked-changes docs. Decided that for substantive asset changes that affect multiple sections across both docs, doing a clean v11.1 / v2.2 cut with tracked changes is preferable to partial in-place revisions that would have left a v11.0 / v2.1 document inconsistent with the new canonical sources block in the project instructions.

**Follow-ups**

* After accepting tracked changes in both docs, regenerate the PDF exports if any external readers receive them.
* The main-screen mockup (PRD Figure 12.1, UI spec Figure 9.1) currently renders the mark plus separately-positioned wordmark and tagline text rather than the horizontal lockup SVG. No change required — the mockup composition still matches the design intent — but if Figure 12.1 / 9.1 is ever regenerated, consider whether dropping in `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_light\\\\\\\_bg.svg` as a single asset would simplify the markup.
* The Sales One-Pager PDF (in project knowledge) is presumed to use the dark-background mark in its header/footer bands. Confirm at the next sales-collateral refresh.

