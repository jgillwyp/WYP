@AGENTS.md

# Would You Please (WYP)

Request-and-ToDo tracking. A user sends a request to a contact; the contact
responds through a secure link without ever creating an account.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth) · Vercel · Inter via `next/font`.

Path alias: `@/*` → `app/src/*`.

## Commands

```bash
npm run dev              # local at http://localhost:3000
npm run build            # MUST pass before pushing — Vercel deploys every push to main
npx tsc --noEmit         # fast typecheck
npm run lint
```

## Repository layout

| Path | Holds | Rule |
|---|---|---|
| `app/` | Routes and components | **Only** things Next renders. Nothing else. |
| `app/src/lib/` | Client modules (`supabaseClient.ts`) | Conventional spot is root `src/lib`; moving it is deferred, not endorsed |
| `design/` | Mockups, screen map, UI spec | Not served, not typechecked. See `design/README.md` |
| `docs/` | SQL history, design notes, project notes | Excluded from tsconfig |
| `public/` | Publicly served assets | **Never** put mockups or internal docs here — everything is reachable from the live URL |

**Dead code never stays in `app/`.** On 2026-08-02 a retired `page - retired on
7-31-26.tsx` with a paste error failed `tsc`, which would have broken the Vercel
deploy. Delete superseded files — but **commit them first**. Git can only
restore what it has seen; deleting a file that was never committed destroys it.

## Design system — palette 1

Mockups are the source of truth. A screen is designed as static HTML in
`design/screens/`, approved, then converted to React. Do not invent UI directly
in TSX.

- Tokens live in `app/globals.css` `:root`. The `:root` block in every mockup
  must match it exactly. Never introduce a hex value that is not a token.
- Component classes are global (`.btn`, `.btn-secondary`, `.btn-quiet`,
  `.finput`, `.ffloat`, `.band`, `.chip`, `.checkrow`). Use them; do not
  re-style with Tailwind utilities.
- Floating-label markup order is load-bearing: `<input class="finput">` then
  `<label class="flabel">`. The float uses an adjacent-sibling selector, so
  reversing them silently breaks it. Inputs need `placeholder=" "`.
- `§` comments refer to the UI spec in `design/spec/`. When a screen needs a
  component the system lacks, add it with a `PROPOSED` comment and a `§` number,
  and record it in the `design/README.md` table.
- Palette 1 is **light-only**. Do not reintroduce a `prefers-color-scheme: dark`
  block; it inverts the page background and breaks every band and card.
- Screens render inside `.frame-none` (max-width 480px) — design mobile-first.
- An unavailable action uses `.is-locked` (§6.22) — never `.btn-secondary` or
  `.btn-quiet`, which both mean "available, lower emphasis". Locked controls
  carry a padlock, adjacent text saying what would unlock them, and
  `aria-disabled="true"` rather than `disabled` so screen readers still reach
  the explanation. See `design/WYP_component_states_palette1.html`.
- Control *states* are documented once in that reference. Only a layout or flow
  difference earns its own screen file.

## Entitlements

Rights on a request come from its **issuer**, never from whoever is reading it.
A subscriber responding to a request sent by a free user gets the free feature
set; the recipient's own tier is irrelevant, because they did not create the
request.

Revised 2026-08-03 — the earlier rule said to snapshot capability flags onto
each request row. That was driven by an assumption that a lapse would hide
existing attachments. It does not:

- **Tier lives on `profiles` as a single value, read live.** One place to
  update on subscribe or lapse. No per-request flags to drift when the
  definition of a tier changes.
- **Gates govern *adding*, never *viewing*.** Attachments already on a request
  stay visible to everyone forever, whatever anyone's tier is now. Only the
  Add Attachment control is gated. Files are reclaimed by lapse-and-auto-delete
  (PRD §6.3), which leaves a tombstone — not by hiding them.
- Accepted trade-off: a recipient part-way through a response loses Add
  Attachment if the issuer lapses at that moment. Chosen over snapshotting,
  which would let a cancelled subscriber keep granting the capability for the
  life of every request they ever sent.
- The locked button is a courtesy. The `SECURITY DEFINER` function must refuse
  the write regardless; assume the control was bypassed.

## Auth — magic link only

Decided 2026-08-02. There are no passwords anywhere in this product.

- `signInWithOtp` creates the account on first use, so **there is no sign-up
  screen**. `/login` serves both. Do not add one.
- Never add a password field, a reset flow, or `signInWithPassword`.
- Links expire in 1 hour, are single-use, and are limited to one per user per
  60 seconds. The built-in email sender is heavily rate limited; raising it
  requires custom SMTP (Resend), not a dashboard setting.
- "Keep me signed in" is client storage, not a Supabase setting. The storage
  adapter in `supabaseClient.ts` routes the session to `localStorage` or
  `sessionStorage`; the preference itself must stay in `localStorage` because
  the emailed link usually opens a new tab.
- Redirect targets must be registered in Supabase → Authentication → URL
  Configuration, including `http://localhost:3000/**`.

## Database — RLS is the access model

The database enforces access, not application code. Never write an
"is this mine" check in TSX and call it security.

- Every new table: `enable row level security` **and** policies covering all
  four verbs. RLS on with no policy denies everything; a table with only an
  INSERT policy silently returns zero rows on read.
- The SQL editor runs as superuser and **bypasses RLS**. Verifying a policy
  there proves nothing. Test as `anon` or from the browser.
- Recipient links (unauthenticated access) use `SECURITY DEFINER` functions,
  never a permissive `anon` policy. A client-supplied `WHERE` clause is not a
  permission check. See `docs/` for the full pattern:
  store `digest(token,'sha256')` not the token; enforce expiry and revocation
  inside the function; return the same generic error for every failure;
  `set search_path = public, extensions` because `digest` lives in
  `extensions`; and `revoke all ... from public` before granting, since new
  functions grant EXECUTE to PUBLIC by default.
- **Request links are multi-use.** Corrected 2026-08-03. Single use is right
  for sign-in links and wrong here: the `.ics` file embeds the request link, and
  dialog continues over days or weeks, so the recipient opens it repeatedly.
  The token is a durable capability bounded by expiry and revocation. Record
  each access as an event rather than consuming the token.
- `service_role` never goes near the browser. If a design seems to need it
  client-side, the design is wrong.
- Record every migration in `docs/SQL history .txt`.

## Scope discipline

Deferred on purpose — do not build these unprompted: AWS, email deliverability
(SPF/DKIM/DMARC), attachments, payments, SMS/10DLC, ads. The secure recipient
link is built only after the stack is proven on Add Contact.

## Working style

- Read `node_modules/next/dist/docs/` before writing Next code (see AGENTS.md).
  This version differs from training data.
- Explain new mechanics rather than only generating them. The unfamiliar
  material is modern-web mechanics — the declarative UI model, the build
  toolchain, RLS idioms. Relational modeling, tenancy, and access control are
  not new here and don't need re-explaining.
- Prefer concise, direct answers. Flag tradeoffs; don't bury them.

## Known gaps

- The UI spec is `design/spec/WouldYouPlease_UI_Design_Specification_v2_9.docx`.
  All 27 `§` references in the repo resolve against it. §6 is fully occupied
  through §6.18, so newly proposed components take §6.19 and upward — check the
  spec's table of contents before assigning a number.
- `RequireAuth.tsx` imports `./src/lib/supabaseClient` while everything else
  uses `@/lib/supabaseClient`. Same file, works, inconsistent.
- Your Account is a mockup only. Add Contact is now Converted
  (`app/components/AddContactForm.tsx`, `/contacts/new`) but not yet Live: no
  list view reads `contacts` back, and the no-contact interception dialog
  (`design/screens/WYP_add_contact_no_contact_dialog_palette1.html`) isn't
  built. See the status table in `design/README.md`.
- Add Contact's phone country-code selector (`.ccode`) is visual only — it
  opens no picker. One fixed value, US +1, same as the mockup.
- Add Contact's Email chip has no click handler. It's the only legal `send_by`
  value while Text stays locked, so there's nothing to switch it to yet.
- Add Contact and Create Request's Recipient field were both First/Last Name
  until 2026-08-07; both now collect a single Name and write/read only
  `contacts.display_name`. **Migration 005 has been run** (confirmed by the
  owner 2026-08-07). `first_name`/`last_name` stay in the table but nothing in
  the app populates or reads them going forward — see the decisions log for
  why they were kept rather than dropped.
- Create Request is now Converted (`app/components/CreateRequestForm.tsx`,
  `/requests/new`). Its Recipient and Category fields use a lookup dropdown
  (`.lookup-results`, proposed §6.24 — design/README.md) that neither the
  mockup nor the spec actually draws; built plain (Row Tint/Rule) rather than
  invented from nothing. Recipient and Category lists are fetched once on
  mount and filtered client-side — fine at personal/20-item scale, worth
  revisiting if either list grows. Contacts sort alphabetically by
  `display_name`, categories by `name` — every lookup/pull-down in the app
  sorts alphabetically except the Housekeeping task list's Log Out entry
  (2026-08-07 rule). Clicking Add Contact from this screen just navigates to
  `/contacts/new` and drops whatever was typed — the real §9.9.5 no-contact
  interception dialog still isn't built (same gap noted above for Add Contact
  itself).
- Header wordmark (`.word`) is 23px app-wide as of 2026-08-07 (was 27px) — it
  was wrapping to two lines on narrow Android widths. Four screen titles
  shortened the same day for the same reason: "Create Request" (was "Create a
  Request"), "Create ToDo" (was "Create a ToDo", mockup only), "Create Free
  Account" and "Start Free Account" (both mockup only, "my" dropped).
  "Respond to Request" is unchanged — confirmed it would still wrap either
  way. Dialog and Attachments on Create Request/Create ToDo/Respond to
  Request now put their Add button on its own row above a full-width box
  (§6.26, `.fieldact`/`.panelact`+`.panelfull`) instead of beside it — see
  design/README.md's proposed-components table. Create Request's Recipient,
  Due Date, and Description (and Create ToDo's Description) carry an
  Ink-colored border (`.req`) at rest to read as required against
  optional-but-filled fields, which are also white under §6.25's rule.
- Create Request's Dialog field (2026-08-06) writes to a `dialog` table —
  **migration 004 has been run** (confirmed by the owner 2026-08-06), so Send
  succeeds on the Dialog insert step. As of 2026-08-07, Add Dialog opens a
  modal (§6.27, `design/README.md`) instead of the old always-visible inline
  textarea — Kind chips Question/Comment (Answer is always `.chip.is-locked`
  here; a Request/ToDo's thread is always empty at creation, so there is
  never anything yet to answer), a Dialog Text box, Save appends to the
  staged list below. `kind` is now written explicitly on insert, not left to
  the table's `default 'comment'`. Create ToDo's own Dialog field
  (`design/screens/WYP_create_todo_palette1.html`) is mockup-only and not
  wired to anything yet, but got the identical modal for consistency.
- **Add Dialog modal, which-Question picker, and migration 006
  (`dialog.replies_to_id`) — run, confirmed by the owner 2026-08-09.** On
  Respond to Request (mockup only) and, later, Request Detail, Answer unlocks
  dynamically — enabled only
  when a Question in the thread is still open (no Answer pointing at it via
  `replies_to_id`). Composing an Answer shows a which-Question picker only
  when more than one Question is open (defaults to the most recent); a single
  open Question links silently. Display order is unchanged — still
  newest-first by entry, never re-threaded — but an Answer row now shows a
  small italic "Re: `<question>`" line (`.dlgre`) and a bolded body
  (`.dlgbody`). Respond to Request's mockup demonstrates all of this with
  real (if in-memory) state via inline `<script>`, seeded with two open
  Questions by default so the multi-question picker branch is visible without
  clicking through several Adds first. See `design/README.md` §6.27 and the
  decisions log's 2026-08-07 "Seventh round" entry for the full reasoning,
  including why Answer can never be a Create Request/ToDo first entry and why
  the answer body is bolded rather than given a new text color.
- Due Time and Category on Create Request (and Category on the Create ToDo
  mockup) carry Row Tint while empty and switch to white once they hold
  content (§6.25, `.opt` — 2026-08-07); Dialog no longer has an `.opt` state
  of its own since 2026-08-07 (it's a button + staged list, not a field). The
  Attachments panel is permanently Row-Tinted everywhere it appears, since it
  can never hold real content in the v1 locked state. `.btn-secondary` now
  rests on Strip (`var(--strip)`), not white, so it doesn't visually join the
  white required/filled-field group.
- Four new mockup-only screens (2026-08-08), none wired or routed yet:
  `design/screens/WYP_request_detail_palette1.html` (Request Detail — Create
  Request's layout with Recipient shown as non-modifiable text, an added
  Done Date/Done Time row, and a Strip-background notice band about
  Recipient notification), `WYP_response_detail_palette1.html` (Response
  Detail — Request Response's layout for a signed-in in-app user),
  `WYP_todo_detail_palette1.html` (ToDo Detail — a byte-for-byte duplicate of
  Create ToDo, retitled only), and `WYP_dialog_detail_palette1.html` (Dialog
  Detail — deliberately **read-only**: `dialog` has no UPDATE/DELETE policy,
  so a past entry can be viewed, never edited, from any screen). See
  `design/README.md` §6.28 and the decisions log's two 2026-08-08 entries.
- **Non-modifiable values render as label:value text, never a boxed field**
  (§6.28, 2026-08-08) — retires the `.finput[readonly]`/`--locked`
  dashed-box variant everywhere it had spread (Your Account's and Create
  Free Account's Email, Request Detail's Recipient), all now `.metarow`
  (reused from Request Response's existing Date:/From:/Due: block, not a new
  component). Dialog Detail's Kind display is the same rule applied further:
  no chip row, just the Kind itself as a bold label-as-value ("Answer:")
  over a horizontal rule (`.dlgtype`/`.dlghr`).
- "Respond to Request" is now titled **"Request Response"** (band label and
  `<title>` in `WYP_respond_to_request_palette1.html`; filename unchanged,
  same precedent as "Create a Request" → "Create Request"). This supersedes
  the 2026-08-07 finding that the rename wraps on Android — the owner
  re-requested it on different grounds (naming consistency with the Detail
  screens, "unrelated to word-wrapping"), so it's applied, not overridden
  silently.
- Your Account has a "Change my email address" button next to "Sign out on
  this device" — `.btn-quiet`, not wired to anything. The actual change-email
  flow (verification, confirming from both addresses) is intentionally
  undesigned; see the decisions log.
- `npm run build` cannot be verified in this sandbox — the SWC native binary
  fails to load here (`Failed to load SWC binary for linux/x64`), unrelated to
  any code change. `npx tsc --noEmit` and `npm run lint` both pass clean; run
  `npm run build` locally before pushing, per the Commands section above.
- **Main Screen is now Live** (`app/components/MainScreen.tsx`, `/`, 2026-08-08)
  — `app/page.tsx` renders it inside `RequireAuth`, so signing in now lands on
  a real screen instead of the placeholder "Logged in ✅" div. This was the
  point of the exercise: "I would like to see the WYP app retain the
  device-login validation and be able to test it in a more normal way than
  needing to each time fill-in the URL." Sent and ToDos are real `requests`
  rows with their default sort pills actually driving the query (`due_date`
  descending / `priority` ascending) — RLS already scopes both to the signed-in
  owner, same as every other converted screen, so no client-side owner filter
  was added. **Received is not live and has no path to becoming live without
  a schema change**: `requests` RLS is owner-only (migration 003) and no
  column links a row to its recipient's own account, so there is currently no
  way for a signed-in user to query "Requests sent to me." The Received
  subcard renders a `.subempty` explanatory note (§6.29) instead. Log Out is
  real (`supabase.auth.signOut()`, then redirect to `/login`) — it's what
  actually makes the sign-in loop testable, which is the whole reason this
  screen got built now. **Superseded by the entry below**: search bar and
  filter chips are now functional, and Sent/ToDo rows navigate to their
  Detail screens, so the "visual-only" and "inert placeholder" notes that
  used to be here no longer apply to those pieces.
- **Seed script for the Main Screen's demo data** — `docs/Week2 - SQL
  history.txt`, appended 2026-08-08, not yet run. Not a numbered migration
  (nothing in it alters a table); inserts Contacts, Sent Requests, and ToDos
  under `jimgillon@gmail.com` specifically (looked up by email inside the
  script, never a hardcoded uuid), with CURRENT_DATE-relative due dates so the
  Open/Overdue/Done mix stays believable whenever it's actually run. Every
  insert is existence-checked first, so re-running the whole block is safe.
  Run it once, in the Supabase SQL editor, to see the live Sent/ToDos sections
  populated.
- **Create ToDo is now Live** (`app/components/CreateTodoForm.tsx`,
  `/todos/new`, 2026-08-09) — Main Screen's Create ToDo button now goes
  somewhere. Same Category lookup / Add Category / Add Dialog modal pattern
  as Create Request, no Recipient, plus the Priority chip row. **Flagged,
  not resolved**: the mockup (and this component) has no Due Date field, even
  though the PRD lists ToDos as having an optional due date and
  `requests.due_date` is a real nullable column the seed script already
  populates for ToDos. Worth a decision — add Due Date to the mockup (and
  ToDo Detail) or leave ToDos due-date-less through the UI.
- **Request Detail and ToDo Detail are now Live**
  (`app/components/RequestDetailForm.tsx` / `TodoDetailForm.tsx`,
  `/requests/[id]` / `/todos/[id]`, 2026-08-09) — Main Screen's Sent and
  ToDo rows now navigate somewhere instead of doing nothing. Both fetch the
  existing row, both update it on Save/Send, both show their Dialog panel as
  the real existing thread (not a staged list) with dynamic Answer
  unlocking and a which-Question picker. Both select `dialog.replies_to_id`
  (migration 006, confirmed run by the owner 2026-08-09) — the earlier
  "hard dependency, unconfirmed" flag on this is resolved. ToDo Detail
  gained a Done Date/Time row that wasn't part of the original "byte-for-
  byte duplicate of Create ToDo" instruction — owner-confirmed via
  AskUserQuestion once it became clear a live ToDo Detail with no Done
  fields would leave ToDos permanently uncompletable through the UI.
- **Contact Detail and My Contacts are now Live**
  (`app/components/ContactDetailForm.tsx` / `ContactsList.tsx`,
  `/contacts/[id]` / `/contacts`, 2026-08-09), both new screens. My Contacts
  lists every contact (name, notify method, and the matching email/phone)
  and is reached from Main Screen's Housekeeping "My Contacts" row; clicking
  a row opens Contact Detail, which is Create Contact's fields (Name/Email/
  Phone/Notes/Time Zone) with Save + Close instead of Save + Cancel. Add
  Contact from My Contacts routes through the existing `/contacts/new`.
- **Time Zone gap closed (2026-08-09, migration 007 — DRAFTED, not yet run;
  see `docs/Week3 - SQL history.txt`).** `profiles.time_zone` and
  `contacts.time_zone` are real columns now (once the migration is run), and
  the Time Zone field on Add Contact and Contact Detail is a working required
  §6.16 lookup (`app/src/lib/timeZones.ts`, every IANA zone name via
  `Intl.supportedValuesOf('timeZone')`), not a decorative mockup field. It
  defaults to the contact's own stored zone if editing one that has it, else
  the owner's own `profiles.time_zone`, else the browser's detected zone —
  and if it had to fall all the way to browser detection, that value is also
  written back to `profiles.time_zone` (a deliberate side effect, not an
  accident — see the next bullet for why). Create Free Account's and the
  no-contact-dialog's own Time Zone fields got the matching demo-JS pull-down
  for consistency, even though neither has a live React component yet.
  **Browse-on-focus bug fixed same day** (owner-reported: "there are no
  other values shown in the pull-down except the selected one") — the field
  always starts pre-filled, so the old "show everything only when the query
  is empty" rule never triggered; a `timeZoneBrowsing` flag now shows the
  full list on focus regardless of the current value, dropping to normal
  filtering the moment the user types. Fixed in `AddContactForm.tsx`,
  `ContactDetailForm.tsx`, and Create Free Account's demo script.
- **Flag: `profiles.time_zone` still has no path to a value from the actual
  live sign-in flow.** Create Free Account is mockup-only, and `/login`
  explicitly serves both sign-in and first-time account creation with no
  separate signup step ("there is no separate sign-up," shown to the user on
  that screen) — so Create Free Account is never reached in the live app as
  it stands today. Until either Create Free Account is converted and wired
  into a real first-run step, or the Account screen (explicitly deferred, see
  the entry above) is built, `profiles.time_zone` only ever gets a value via
  Add Contact/Contact Detail's browser-detected fallback described above, not
  from a screen actually about the user's own profile.
- **Main Screen's filter chips and search are now functional** (2026-08-09):
  All/Open/Overdue/Done on Sent and All/Open/Done on ToDos filter the
  already-fetched rows client-side; search matches description/contact-name/
  category, case-insensitive substring, across both sections at once. The
  scope button ("All ▼") stays visual-only — it has never had a designed
  picker and there's nothing yet for a scope to narrow.
- **Housekeeping's "Your Account" row is now "My Account"** (2026-08-09,
  Main Screen mockup + `MainScreen.tsx`) — wording consistency with "My
  Contacts" ("'Account' seems a bit impersonal for this app," owner's words).
  Still inert: the actual Account screen is intentionally undesigned,
  awaiting further product evolution per the owner's explicit instruction —
  do not design it unprompted. **Superseded same day, see below** — both
  Housekeeping rows dropped "My" entirely a few hours later.
- **My Contacts retitled "Contacts"; gained a Close button** (2026-08-09,
  same day as the row above) — the owner's ask was a Close button next to
  Add Contact; adding it would wrap "My Contacts" on Android, and separately
  the owner's rule is that a Housekeeping row's label must repeat its
  destination screen's own title exactly once selected. Both point the same
  direction, so the Housekeeping row (and "My Account" alongside it, for
  consistency) also dropped "My": **"Contacts"** and **"Account"** are the
  final wording, in `WYP_main_screen_palette1.html`, `MainScreen.tsx`,
  `WYP_contacts_list_palette1.html`, and `ContactsList.tsx`. "Account" is
  still inert — the screen itself remains undesigned. The list's band is now
  `.bandcluster`-wrapped (Add Contact + Close) rather than a single
  right-margined `.btn`.
- **Add Contact returns to the Contacts list, not the Main Screen**
  (`AddContactForm.tsx`, 2026-08-09) — both Save and Cancel now call
  `router.back()`. The only route that currently links to `/contacts/new`
  is the Contacts list's own Add Contact button, so this returns to wherever
  the person actually came from and restores that screen's scroll position.
  Revisit if a second entry point (e.g. Create Request's no-contact
  interception, §6.24, not yet built) starts reaching this screen — that
  path will want its own return destination, not a blanket `back()`.
- **Request Detail, ToDo Detail, and Contact Detail all use `router.back()`
  instead of `router.push('/...')`** (2026-08-09) — owner-reported: "When I
  edited a ToDo I was returned to the top of the main screen instead of to
  where I have edited the ToDo." Each of these screens is only ever reached
  by clicking a row on its parent list (Main Screen's Sent/ToDo rows, or the
  Contacts list), so `back()` returns to that exact history entry and Next
  restores its scroll position automatically — no Cache Components/Activity
  needed (that Next 16 feature is opt-in, off in this app; see
  `next.config.ts`), and in fact not wanted here: the parent screen still
  fully remounts and refetches on the way back, which is what makes the
  just-edited row show its new data rather than a stale cached one. The
  trade-off: Main Screen's filter-chip and search selections reset to their
  defaults on the way back too, since they're plain `useState` and the
  component does remount — only scroll position is preserved. **Chip state
  fixed same day, see below; search box trade-off still stands.**
- **Main Screen's filter chips now survive the round trip too**
  (2026-08-09 — "It would be appropriate to return to the same chip state on
  the main screen") — Sent filter, ToDos filter, and Housekeeping's
  Tasks/How-to Videos tab are persisted to `sessionStorage`
  (`wyp.mainSentFilter` / `wyp.mainTodoFilter` / `wyp.mainHkTab`), read back
  via lazy `useState` initializers on mount. `sessionStorage`, not
  `localStorage` (`supabaseClient.ts`'s `REMEMBER_KEY` pattern uses the
  latter for "Keep me signed in," a durable account setting; this is a
  within-session view preference, fine to reset once the tab closes).
  **Scoped to the chips only — the search text box is deliberately not
  persisted**, matching the owner's own wording ("chip state"); flagged as a
  scoping call rather than a confirmed instruction, easy to extend if it
  turns out to matter.
- **Migration 008 — secure recipient link token infrastructure, confirmed
  run by the owner 2026-08-10** (`docs/Week3 - SQL history.txt`, drafted
  2026-08-09). `requests` gains
  `link_token_hash`/`link_expires_at`/`link_revoked_at`; `events` finally
  gets the read policy migration 002 deferred (plus the table-level `GRANT`
  that policy alone doesn't supply, since migration 002 revoked all client
  privileges on it). Three `SECURITY DEFINER` functions: `issue_request_link`
  and `revoke_request_link` (owner-only), and `get_request_by_token` (anon +
  authenticated) — the pattern the Database section above already described
  in prose, now actually written: hashed token, generic error for every
  failure, multi-use and logged rather than consumed. `revoke_request_link`
  is one function more than `WYP_Week3_Plan.md`'s Day 1 originally scoped,
  added so `link_revoked_at` isn't a column with no way to ever get a value.
  **Flagged for confirmation, not assumed**: the 30-day link expiry has no
  source in the PRD — see the migration's own header comment for the
  reasoning behind that specific number.
- **`/r/[token]` is now Live** (`app/components/RequestResponseForm.tsx`,
  `app/r/[token]/page.tsx`, 2026-08-10, Week 3 Days 2–3) — **superseding the
  "no screen reads or writes yet" note above.** No `RequireAuth`: this is the
  one route in the app an anonymous, unauthenticated visitor reaches. All
  data access goes through migration 008/009's `SECURITY DEFINER` functions,
  never a raw table query. **Migration 009, drafted the same day**, corrects
  a real bug in migration 008's `get_request_by_token` — an early draft
  selected and returned `category_name`, violating PRD §2.3 (Category is
  sender-side-only, never shown to the recipient); caught before migration
  008 was ever run, fixed via `create or replace function` rather than
  editing 008's already-presented text. Migration 009 also adds
  `set_response_done_by_token` and `add_dialog_by_token` — the two write
  functions the plan had originally sketched as one, `submit_request_response`
  (see `WYP_Week3_Plan.md`'s Days 2–3 section for the naming correction).
  **Diverges from the mockup, both flagged**: Done Date/Done Time are real
  `.fgroup.frow`+`.ffloat.picker.native` editable pickers (Request Detail's
  pattern), not the mockup's boxed `.duo`/`.fieldval` static-text preview,
  and drop `.panel.req` entirely — the mockup's own comment already flagged
  that border rule as unresolved; both fields are ordinary optional `.opt`
  fields instead. Add to Calendar is present but inert (`.ics` generation is
  out of scope this batch). Send shows an inline `.noticeband` confirmation
  rather than navigating anywhere; Cancel resets the two editable fields to
  their last-saved values rather than `router.back()` — an anonymous visitor
  has no prior in-app history entry to return to, unlike every other
  Detail-type screen's Cancel/Close. **Still unbuilt**: the
  signed-in-subscriber reuse of this same screen from a Received row (raised
  by the owner alongside this task, explicitly deferred — Received has no
  live data path yet, see the Main Screen entry above).
- **Request Detail's Response Link band is now Live** (2026-08-10, Week 3
  Day 4) — a "Get Response Link" button under the existing notice band,
  calling `issue_request_link` and showing the resulting `/r/[token]` URL
  with Copy/Regenerate (`.linkband`/`.linkval`, §6.30 PROPOSED, not drawn in
  any mockup). **Migrations 008 and 009 confirmed run by the owner
  2026-08-10** — the feature is now actually testable: open any existing
  Sent Request (`/requests/[id]`) and click "Get Response Link." No one but
  the signed-in owner can ever produce a real token, by design — the
  function is owner-only (`auth.uid()` checked against the Request's
  `owner_id`) and the raw token is returned exactly once, never stored
  anywhere; only its salted hash is persisted.
- **Migration 010 — fixes a real bug in `add_dialog_by_token`, confirmed run
  by the owner 2026-08-10** (`docs/Week3 - SQL history.txt`, drafted
  2026-08-10). Owner-reported: an Add Dialog Question on `/r/[token]` failed
  with `column "subject_id" is of type uuid but expression is of type
  bigint`. Migration 009's `add_dialog_by_token` logged its `events` row
  using the new dialog entry's own `bigint` id as `subject_id`, which has
  been `uuid`-typed since migration 002 — a real bug, not a data issue; the
  other two migration 009 functions both happened to log with the Request's
  own `uuid` already, so this path had never actually run before the
  owner's test. Fix: log with `subject_id = v_request_id` (the Request's
  own uuid, same pattern as the other functions and as `subject_type =
  'link'`'s existing precedent), moving the dialog entry's own id into
  `detail->>'dialog_id'` instead.
- **Which-Question picker: show who asked, default to Answer, show for any
  open Question** (2026-08-10, `RequestResponseForm.tsx`,
  `RequestDetailForm.tsx`, `TodoDetailForm.tsx`, and their three mockups).
  Owner testing Request Response live found three related gaps: (1) picker
  rows didn't say who asked each Question — added, using `.dlgwho`'s
  existing `(name)` convention (first shipped as a bold `Name:` prefix,
  corrected same day per the owner's direct follow-up for consistency with
  the main Dialog list). (2) Add Dialog always defaulted to the Question
  chip even when every existing entry was itself an unanswered Question —
  now defaults to Answer whenever one is open. (3) The picker only rendered
  for more than one open Question, so answering the last remaining one
  linked it silently with no visual confirmation — **supersedes the
  2026-08-07 scoping decision** ("it only needs to be presented if there is
  more than one question"); now shows for any open Question. See the
  decisions log's two 2026-08-10 entries for full reasoning.
- **Migration 011 — adds `owner_tier` to `get_request_by_token`, DRAFTED,
  not yet run** (`docs/Week3 - SQL history.txt`, 2026-08-10). Lets Request
  Response gate its Attachments segment by the issuer's tier rather than
  always showing it. Not a privacy concern the way `category_name` was
  (migration 009) — tier is exactly what this screen's own free/subscriber
  upsell is already about.
- **Request Response: Attachments gated by issuer tier; new quick-Done
  band** (2026-08-10, `RequestResponseForm.tsx`). Owner: showing a locked,
  non-actionable Attachments segment for every Request was pointless friction
  when the issuer is free-tier (the Free Account Features block already
  covers that pitch); gated on `owner_tier === 'subscriber'` (migration
  011). **Even when shown, Add Attachment stays inert** — real attachment
  storage/upload doesn't exist anywhere in this app yet, on any screen, so
  the copy changed from "A subscription feature" (wrong once the issuer
  already is one) to a plain "No attachments yet," rather than presenting a
  button that would do nothing if clicked. Separately, added a **quick-Done
  band** (§6.31 PROPOSED, `.donerow`/`.donenote`) above the Done Date/Done
  Time row — a "Done" button that fills Done Date with today only (Done
  Time untouched); the band's text and the button's disabled state both
  react purely to whether Done Date currently holds a value, regardless of
  whether that happened via the button or manual entry — the owner's own
  proposed resolution to an ambiguity he raised, implemented as suggested.
  **Neither change has been ported into the mockup yet** — flagged in
  `design/README.md`, not silently skipped.
- **`profiles.display_name` has no live path to a value — now visibly
  affecting real usage, not just Time Zone's old fallback chain.**
  Owner-observed: Request Response's `From:` row showed "—", and Dialog
  entries composed by the signed-in owner showed a raw email address
  instead of a name. Same root cause as the Time Zone gap already noted
  above — Create Free Account isn't wired into the live app and Account is
  intentionally undesigned, so nothing ever writes `profiles.display_name`.
  One-time SQL fix (not a migration) recorded in `docs/Week3 - SQL
  history.txt`.
