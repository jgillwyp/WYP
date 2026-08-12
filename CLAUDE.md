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
| `app/src/lib/` | Client modules (`supabaseClient.ts`, `timeZones.ts`, `ics.ts`) | Conventional spot is root `src/lib`; moving it is deferred, not endorsed |
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
  history.txt`, appended 2026-08-08, confirmed run by the owner 2026-08-11.
  Not a numbered migration (nothing in it alters a table); inserts Contacts,
  Sent Requests, and ToDos under `jimgillon@gmail.com` specifically (looked
  up by email inside the script, never a hardcoded uuid), with
  CURRENT_DATE-relative due dates so the Open/Overdue/Done mix stays
  believable. Every insert is existence-checked first, so re-running the
  whole block is safe.
- **Create ToDo is now Live** (`app/components/CreateTodoForm.tsx`,
  `/todos/new`, 2026-08-09) — Main Screen's Create ToDo button now goes
  somewhere. Same Category lookup / Add Category / Add Dialog modal pattern
  as Create Request, no Recipient, plus the Priority chip row. **Due Date
  gap closed 2026-08-10** — closing out Week 3's last open item. Optional
  (`.opt`, not Create Request's required `.req` border), written as `null`
  when empty; `requests.due_date` was already a plain nullable column (no
  `not null`), so no schema change or sentinel-date workaround was needed —
  every screen already reading it (Main Screen, Request Detail) already
  handles `null` correctly. Also added to ToDo Detail beyond the literal
  ask, so a Due Date set at creation isn't a dead end once saved. Ported to
  both mockups (`WYP_create_todo_palette1.html`,
  `WYP_todo_detail_palette1.html`). **Extended same day, owner's own rough
  draft**: Due Date and Done Date combined into one side-by-side row on
  both screens, Done Time removed from ToDo Detail entirely ("the ToDos do
  not need Done Time" — unlike a Request's Done Date/Time pair, which keeps
  its Time field; `requests.done_time` stays in the schema, ToDo screens
  just stop touching it), and Done Date added to Create ToDo ("to allow
  completed ToDos to be entered if desired").
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
- **Time Zone gap closed (2026-08-09, migration 007 — confirmed run by the
  owner 2026-08-11; see `docs/Week3 - SQL history.txt`).** `profiles.time_zone`
  and `contacts.time_zone` are real columns now, and
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
- **Create Free Account is now live and wired as the mandatory first-run
  step (2026-08-11, `app/components/CreateFreeAccountForm.tsx`,
  `/account/new`) — superseding every earlier "no live path" flag on
  `profiles.display_name`/`profiles.time_zone` below and above.** Owner
  asked to build it for limited testing. `app/auth/callback/page.tsx` now
  checks `profiles.display_name` after a successful sign-in and routes to
  `/account/new` when it's null, exactly the behavior the original Week 1
  schema comment on that column already described as the plan. Not a
  sign-up screen — Email is read-only from the session, and the account/
  stub `profiles` row (via `handle_new_user`) already exist by the time this
  screen is reached; no conflict with the magic-link-only Auth section.
  **Depended on migration 013** (grant `UPDATE(time_zone)` on `profiles` to
  `authenticated`, `docs/Week4 - SQL history.txt`) — **confirmed run by the
  owner, verified 2026-08-12** via a direct `information_schema.
  column_privileges` query (`authenticated` holds `UPDATE` on
  `profiles.time_zone`), after the Supabase SQL editor's own History view
  was reported showing entries only through migration 011 and couldn't be
  trusted on its own. A real bug had been found while scoping this screen:
  the Week 1 column-specific UPDATE grant predates `time_zone` (added
  later, migration 007) and was never extended to include it, so every
  write to `profiles.time_zone` — including Add Contact/Contact Detail's
  own browser-detected fallback write-back — had been silently failing
  since migration 007 (SELECT was unaffected, which is what masked it).
  Save on Create Free Account now writes Time Zone successfully. See
  decisions log for the full write-up.
- **PRD §7.3 "Notification Email Templates" (2026-08-11, `docs/
  WouldYouPlease_PRD_v12_9.docx`) — spec only, nothing built.** Owner gave
  literal to:/from:/subject:/body: templates for an Initial Request email and
  a day-before Reminder email, wanting to test the Request process further.
  No mail infrastructure exists yet to send either — no Resend/SMTP package,
  no `RESEND_API_KEY`, no scheduled job — so, offered a choice, the owner
  scoped this batch to documentation only. See the decisions log for the full
  write-up, including three flagged-and-resolved conflicts with existing PRD
  content (From address deliverability, keeping the .ics attachment rather
  than a link-only alternative, leaving the Push "approaching due date" row
  unchanged) and a new "Tight-window rule" (a Request due in under 24 hours
  gets no Reminder email; the sender is advised at Send time instead, and the
  Initial Request email's own wording drops the reminder promise) — 24 hours
  is a proposed default, unconfirmed. Priority/sequencing for actually
  building this (Resend integration, send-on-create, the reminder's
  scheduled job, the Send-time advisory UI) has not been discussed. **The
  Create Free Account dependency this entry originally flagged is resolved**
  — see the entry above; `profiles.display_name` now has a live path, and
  migration 013 is confirmed run, so Create Free Account's Save works
  end to end.
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
- **Migration 011 — adds `owner_tier` to `get_request_by_token`, confirmed
  run by the owner 2026-08-11** (`docs/Week3 - SQL history.txt`, 2026-08-10). Lets Request
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
- **Add to Calendar is now real** (`RequestResponseForm.tsx`, 2026-08-10) —
  `handleAddToCalendar()`/`buildIcsContent()` generate an RFC 5545 `.ics`
  entirely client-side (no new migration or endpoint — every field it needs
  is already loaded by `get_request_by_token`) and trigger a `Blob`
  download. Two pieces are deliberately hardcoded and flagged as "will be
  done" rather than built: the description's boilerplate wrapper text ("A
  Would You Please Request from `<name>`:" / "To mark it completed,
  click:") has no admin surface yet to edit it from, and a Request with no
  Due Time defaults to 9:00 AM (`ICS_DEFAULT_DUE_TIME`) rather than a real
  per-account default — `profiles` has no such column, and Account is still
  intentionally undesigned (see the `display_name` gap above). Ported into
  `WYP_respond_to_request_palette1.html`'s and `WYP_response_detail_palette1.html`'s
  own demo JS. Response Detail itself stays mockup-only — the owner
  confirmed via AskUserQuestion that porting the feature into the mockup's
  demo, not building the screen live, was the intent; going live would
  reopen the deferred "Received Requests have no live data path" gap.
  **Two small fixes same day, from live testing**: the "from `<name>`:"
  clause is now omitted entirely when `owner_name` is null, rather than
  falling back to the app's own name ("A Would You Please Request from
  Would You Please" — a test-data artifact, not reproducible once
  `profiles.display_name` has a real value); and Add Dialog's empty-body
  validation now refocuses Dialog Text (same gap as the chip-switch focus
  fix, different trigger) and reads "Enter Dialog Text or Cancel." instead
  of "Enter Dialog Text." everywhere it appears.
- **Type-ahead lookups: exact-match click now shows the full list, not just
  the match** (2026-08-10). Owner-reported: clicking a filled lookup field
  re-filtered to the one row already in it, so picking a different value
  required erasing the field first. Fixed by generalizing Time Zone's
  existing `browsing`-on-focus flag (2026-08-09) to Category
  (`CreateRequestForm.tsx`, `CreateTodoForm.tsx`, `TodoDetailForm.tsx`,
  `RequestDetailForm.tsx`) and Contact/Recipient (`CreateRequestForm.tsx`):
  focus shows the full list regardless of the field's current content, any
  keystroke narrows it as before. Also added the `.lookup-item.selected`
  visual highlight the owner asked for ("preferably with the exact match
  displayed as selected") everywhere a lookup dropdown renders, including
  Time Zone's own (`AddContactForm.tsx`, `ContactDetailForm.tsx`), which had
  the browsing fix already but no visual highlight. The `LOOKUP_BROWSE_THRESHOLD`
  gate is unchanged and still governs only the empty-field case. **Mockup
  scope checked file-by-file**: Create Request/Create ToDo/Request
  Detail/ToDo Detail's mockups have no interactive Category/Recipient JS at
  all (static demo fields), so none needed changes; of the two mockups with
  real Time Zone lookup JS, both (`WYP_create_free_account_palette1.html`,
  `WYP_add_contact_no_contact_dialog_palette1.html`) got the `.selected`
  treatment — `WYP_add_contact_palette1_floating.html` has no `<script>` at
  all, and `WYP_contact_detail_palette1.html`'s Time Zone field is flagged
  in its own header comment as never wired. See decisions log for full
  reasoning.
- **Create ToDo gets its own quick-Done band** (2026-08-10,
  `CreateTodoForm.tsx`, `WYP_create_todo_palette1.html`). Owner, with a
  pasted rough draft: "we can save the end-user a keystroke for completing
  a ToDo by adding a Done button and message similar to the Request
  Response." Mirrors Request Response's `.donerow`/`.donenote` (§6.31)
  exactly — fills Done Date with today, no Done Time to touch (ToDos don't
  have one). Owner's exact wording used verbatim for both states. Notably
  ported into this mockup's own demo JS (`quickDone()`), even though
  Request Response's own mockup still hasn't gotten the feature (flagged
  above) — Create ToDo's Due Date/Done Date fields already exist as visible
  targets for the demo to fill.
- **Received Requests is now live (2026-08-11, migration 012, confirmed run
  by the owner 2026-08-11)** —
  the deferred piece flagged repeatedly since Main Screen went live. No new
  columns: `contacts.email` (already required) is the match key against the
  signed-in caller's own session email (`auth.jwt() ->> 'email'`). A
  `recipient_user_id` column resolved at send time was considered and
  rejected — a recipient almost never has an account yet when a Request is
  sent, so it would sit null for nearly every real case, reopening the
  snapshot-vs-live argument this file's own Entitlements section already
  settled once for `tier`. Four new `SECURITY DEFINER` functions, parallel to
  the `/r/[token]` set (migrations 008/009/010) but keyed by session identity:
  `get_received_requests()` (Main Screen's list), `get_received_request`,
  `set_response_done_as_recipient`, `add_dialog_as_recipient` — functions
  rather than RLS policies, since RLS can't hide Category (PRD §2.3) from an
  otherwise-visible row, the same reasoning this section already gives above
  for the anonymous link case. Self-sent Requests are NOT excluded — owner:
  "I would not exclude it... I can imagine circumstances where a person might
  choose to send themselves requests instead of using ToDos." `MainScreen.tsx`
  fetches and renders real Received rows (replacing the old placeholder),
  routing to the new `/requests/[id]/respond` (`ResponseDetailForm.tsx`, new,
  wrapped in `RequireAuth`) rather than `/requests/[id]`. The `.ics` builder
  moved to `app/src/lib/ics.ts` so this new screen could reuse
  `RequestResponseForm.tsx`'s existing logic verbatim rather than duplicate
  it. See decisions log and `docs/WYP_Week4_Plan.md` for full reasoning.
- **Main Screen column-header sorting is now live (2026-08-11,
  `MainScreen.tsx`).** Every `.colbar` header (To/From, Date, Due, Done on
  Sent/Received; Priority, Category — Description on ToDos) is a real
  `<button>` — click to sort by that column in its own default direction,
  click again to reverse. The active column renders the `.pill` (`--sort`
  yellow token) with its label plus a ▲/▼ arrow; previously only Due
  (Sent/Received) and Priority (ToDos) ever showed the pill, and it was a
  static default, not interactive. Sort state persists per-section to
  `sessionStorage`, same pattern as the filter chips (2026-08-09). `aria-sort`
  isn't valid on a plain `<button>` (implicit `role="button"`, not
  `columnheader`) — used `aria-label` instead. See decisions log,
  2026-08-11, for the full write-up. Mockup unchanged (static `<span>`s, no
  click handlers).
- **Simplified empty-state Dialog/Attachments row (§6.32, 2026-08-11).**
  Owner, with a pasted-in reference mockup: Create Request, Request Detail,
  Request Response, Response Detail, Create ToDo, and ToDo Detail each showed
  a different empty-state treatment for Dialog and Attachments, and the
  descriptive text next to Add Dialog/Add Attachment was only needed while
  there were no entries yet. New CSS component `.actlabel`/`.actlabel.locked`
  in `app/globals.css`: a single `.frow` pairing a label with the Add button
  at zero entries — `.actlabel` (bordered box, "Questions, Answers,
  Comments") for Dialog, `.actlabel.locked` (plain muted text, "Subscription
  feature") for Attachments — replacing whatever heavier empty-state markup
  each screen used before (staged-entry screens' bare button, or
  existing-thread screens' always-rendered `.panel`+`.panelhead` with a "No
  Dialog entries yet." placeholder). Reverts to each screen's existing
  populated-state markup once entries exist; Attachments has no populated
  state anywhere in the app yet, so it stays the compact row unconditionally
  (Request Response/Response Detail's `owner_tier === 'subscriber'` gate is
  unchanged around it). Applied to `CreateRequestForm.tsx`,
  `RequestDetailForm.tsx`, `RequestResponseForm.tsx`, `ResponseDetailForm.tsx`,
  `CreateTodoForm.tsx`, `TodoDetailForm.tsx`, and all six mockups — Create
  Request/Create ToDo's mockups got a real functional empty/populated JS
  toggle (their Dialog demos actually go from empty to populated); the other
  four mockups' Dialog threads are permanently seeded with demo data, so
  their empty state is documented in a comment rather than built as
  unreachable toggle JS. See `design/README.md` §6.32 and the decisions log's
  2026-08-11 entry.
- **ToDo Detail's missing quick-Done band; date/time click-anywhere-opens-
  picker on desktop (2026-08-11).** Two owner-reported bugs testing the live
  app. (1) `TodoDetailForm.tsx` never got the §6.31 quick-Done band Create
  ToDo gained 2026-08-10 — that batch was scoped to Create ToDo only, unlike
  Response Detail, which did get Request Response's quick-Done band carried
  over the same day it went live. Fixed by porting `todayISODate`/
  `handleQuickDone`/`doneDateRef`/the `.donerow` JSX in verbatim; not yet
  ported into the ToDo Detail mockup (same as Response Detail's own still-
  unported band). (2) On desktop, clicking a `type="date"`/`type="time"`
  input only opened its native picker via the calendar/clock icon — the rest
  of the field did nothing, unlike mobile, where tapping anywhere opens it.
  Since hand-typing a date or time was never a supported input method here
  (§6.16's label-affordance glyph means "focus opens a picker," not "type
  here"), a click anywhere in the field should open the picker on desktop
  too. Fixed with a small `openPicker` handler (`el.showPicker()`, feature-
  detected and try/caught — pre-16.4 Safari has no `showPicker()`) wired to
  `onClick` on all 14 native date/time `.finput`s across `CreateRequestForm.tsx`,
  `RequestDetailForm.tsx`, `RequestResponseForm.tsx`, `ResponseDetailForm.tsx`,
  `CreateTodoForm.tsx`, and `TodoDetailForm.tsx` — duplicated per component,
  not extracted to a shared lib file, matching the `todayISODate`/`formatMDY`
  convention for short stateless helpers. No mockup changes needed: none of
  the six Dialog/Attachments-batch screens use real `type="date"`/`type="time"`
  inputs (Create Request/Request Detail/Create ToDo/ToDo Detail render these
  as CSS-styled `type="text"`; Request Response/Response Detail have no
  `<input>` for them at all, only static `.fieldval` text), so `showPicker()`
  has nothing to attach to in the mockups. See the decisions log's 2026-08-11
  entry.
- **Due/Done Date-Time row width imbalance; Clear affordance for Time
  fields (§6.33, 2026-08-11).** Two more owner-reported bugs. (1) On Request
  Detail/ToDo Detail, Due Date rendered wider than the field beside it and
  squeezed its label text off the edge on a phone; Create Request/Create
  ToDo's identical rows scaled evenly. Root cause: `.frow .ffloat` was
  `flex: 1 1 auto` — with a percentage-width `.finput` child, the flex-basis
  falls back to the input's own intrinsic content width when it can't
  resolve the percentage, and a native `type="date"`/`type="time"` control's
  intrinsic width can vary with whether it holds a value (most visibly on
  mobile). Request/ToDo Detail load an existing record with one field
  typically pre-filled and the other still empty; Create Request/Create ToDo
  start every field empty, so both sides match and the imbalance never
  showed. Fixed by changing `.frow .ffloat` to `flex: 1 1 0%` — a zero basis
  makes both fields grow equally regardless of content, the standard fix for
  equal-width flex columns. One CSS rule in `app/globals.css`, fixes every
  two-`.ffloat` `.frow` in the app at once (Due Date/Due Time, Done
  Date/Done Time, Due Date/Done Date across all six affected screens); rows
  with a single `.ffloat` beside a `.btn` (Recipient, Category) are
  unaffected. (2) Due/Done Time fields had no way to clear a set value,
  unlike Due/Done Date, which do (a platform affordance some browsers give
  `type="date"` but not `type="time"` — not something WYP controls). New
  component `.fclear` (§6.33 PROPOSED): a small "×" styled like the existing
  `.attremove`, shown only once the field holds a value, positioned after
  `.flabel` in markup (never between `.finput` and `.flabel`, which would
  break the load-bearing floating-label adjacent-sibling selector). Wired to
  every Due Time/Done Time field: `CreateRequestForm.tsx`,
  `RequestDetailForm.tsx` (both), `RequestResponseForm.tsx`,
  `ResponseDetailForm.tsx` — 5 fields, 4 files. Date fields untouched by
  design — the owner's own report frames Date as already working. No mockup
  changes needed for either fix, same reasoning as `openPicker`: none of the
  affected screens have real `type="date"`/`type="time"` inputs in their
  static HTML. See the decisions log's 2026-08-11 entry.
- **Main Screen To/From column-gap tightened; Add Contact's return path
  from Create Request fixed (2026-08-11).** Two more owner-reported items.
  (1) A long contact first name ("Maximillan") truncated to "Maximilla…" in
  the To/From column on a phone. Not a font problem — `.dt`/`.due`/`.dn`
  already use Inter, proportional, same as everywhere else; no monospace
  declaration existed to remove. The real constraint was `.r1`/`.colbar.sr`'s
  `grid-template-columns: 1fr 58px 58px 58px` spending 48px across three
  16px gaps. Cut `column-gap` to `10px` in both (they have to move
  together, since the header row's labels sit directly above the data
  columns) — CSS Grid hands the freed 18px straight to the name column's
  `1fr` track. The 58px date-column widths themselves are untouched;
  "MM-DD-YY" already fits them tightly at 11px. (2) Add Contact, opened
  from Create Request's own Add Contact button, always returned to the
  Contacts list rather than back to the Request with the new contact
  selected — a gap `AddContactForm.tsx`'s own 2026-08-09 comment had
  already flagged as coming ("revisit if a second entry point... starts
  reaching this screen"). Fixed with a `?from=create-request` query param
  on Create Request's Add Contact link: `AddContactForm.tsx` now redirects
  Save to `/requests/new?newContactId=<id>` in that case (the insert
  gained a `.select('id').single()` to produce that id) and Cancel to
  `/requests/new` empty-handed, instead of `/contacts` either way.
  `CreateRequestForm.tsx`'s mount effect selects the matching contact once
  its own contacts fetch resolves, then `router.replace('/requests/new')`
  strips the query string. Read via `window.location.search`, not
  `useSearchParams()` — every read happens inside a click handler or a
  mount effect, already client-side only, so the hook's Suspense-boundary
  requirement had nothing to protect against here and would only have
  forced an unrelated change to the page shell. **Not fixed**: every other
  field on Create Request (Due Date, Description, staged Dialog, Category)
  is still lost on this round trip — the full fix is the real §6.24/§9.9.5
  in-place interception dialog, still not built; this change only corrects
  the return destination and restores the one field (Recipient) the
  complaint was actually about. Neither fix touches any mockup — Create
  Request's own Add Contact button has no interactive JS to update, and
  Main Screen's gap values were ported into `WYP_main_screen_palette1.html`
  directly. See the decisions log's 2026-08-11 entry.
- **Done-band wording after Send (2026-08-11).** Request Response and
  Response Detail's quick-Done band already had two reactive states (empty
  Done Date, or filled-but-not-sent); owner asked for a third once Send
  actually succeeds, since the only existing confirmation was the
  `.noticeband` banner at the top of the screen, not anything next to the
  Done button itself. Added, reactive to the same `sendConfirmed` state that
  already drives the banner: "This Request is now marked as Done and has
  been Sent." Applied to both `RequestResponseForm.tsx` and
  `ResponseDetailForm.tsx` — identical donerow, identical fix. No mockup
  change: the quick-Done band has never been ported into either screen's
  static HTML.
- **Stylesheets organized and realigned (2026-08-12) — corrects an earlier
  wrong claim in this same file's history.** Owner: "please organize and
  realign the style sheets as needed." A prior answer in this session had
  told the owner the mockups "link a shared `components.css`... read-only
  from this session," so that day's `.actlabel`/`.donerow` fix couldn't be
  ported into any mockup. **That was wrong** — re-verified while scoping
  this task and found none of the 17 `design/screens/*.html` files has a
  real `<link rel="stylesheet">` to `tokens.css`/`components.css`; every
  apparent match was a docstring pasted inside a mockup's own `<style>`
  comment, not an active tag. All 17 mockups are, and always have been,
  fully self-contained. Regenerated `design/screens/tokens.css` (49 lines)
  and `design/screens/components.css` (2,100+ lines) from `app/globals.css`
  — the file that's actually been kept current every session — as the
  reference for keeping each mockup's embedded `<style>` in sync by hand;
  no mockup was converted to link them (a separate, bigger architectural
  change, not requested). Audited class coverage across all 17 mockups
  against the regenerated copy and found five with real pre-existing gaps:
  `WYP_create_request_palette1.html` was missing `.actlabel`/`.dlgstaged`/
  `.ferror`, and separately (missed by the first coverage pass) `.chip`/
  `.chip.selected` entirely — its Add Dialog Kind chips have been rendering
  as unstyled native buttons; `WYP_create_todo_palette1.html` was missing
  `.actlabel`/`.ferror` and, more notably, `.donerow`/`.donenote` — the
  quick-Done band shipped 2026-08-10 has been rendering unstyled ever
  since; `WYP_request_detail_palette1.html` and `WYP_todo_detail_palette1.html`
  needed `.donerow`/`.donenote` for the Attachments conversion below;
  `WYP_respond_to_request_palette1.html` was missing `.subnote`. Added each
  rule verbatim from the new canonical `components.css`. Ported the same
  day's Dialog `(optional)`/Row-Tint fix and Attachments `.donerow`/
  `.donenote` conversion into the four mockups using the current `.actlabel`
  pattern (the two just named above, plus Create Request and Create ToDo)
  — deliberately not into Request Response/Response Detail's mockups, which
  still use the older `.panel`-based Dialog/Attachments markup, a separate
  and already-flagged conversion gap. Checked, and confirmed not a bug:
  Main Screen mockup's `c-cat`/`c-nm`/`c-pri` column classes have no CSS
  rule of their own in the live app either — only the date columns
  (`.c-dt`/`.c-due`/`.c-dn`) ever needed one. See the decisions log's
  2026-08-12 entry for the full write-up.
- **ToDos gain an Overdue chip; Expand icon dropped app-wide (2026-08-12).**
  Owner: "Now that ToDos have Due and Done Dates, we need to add the
  Overdue chip for ToDos to match the chips order for Requests Sent and
  Received... ToDos without a Due Date would be ignored for the Overdue
  chip." `todoFilter` is now All/Open/Overdue/Done, same order and same
  `statusFor(due_date, done_date)` helper Sent/Received already used — a
  null `due_date` already read as never-overdue there, exactly the owner's
  own rule, so no new logic was needed beyond fetching `due_date` for ToDos
  at all (Main Screen's ToDos query never had before). Row-level red text
  needed its own CSS pass, added after the owner's direct follow-up ("The
  overdue items in the ToDo list should follow the red-display of text to
  match the Requests"): `.row.overdue`/`.row.done` previously only targeted
  Sent/Received's own child classes (`.nm`/`.dt`/`.due`/`.dn`/`.desc`); new
  rules target ToDo's own (`.pri`/`.cat`/`.tdd`) the same way. **Same
  message, separate reasoning: the Expand icon is gone, app-wide.** Owner's
  stated premise for it — each section has a limited "elevator" view, Expand
  opens the rest full-screen — doesn't match how Sent/Received/ToDos
  actually shipped (every selected item already shows under its own
  section, judged the practically correct behavior, not a shortfall), and
  an expanded view's only remaining value (more Description lines) was
  judged minimal utility on its own. Removed from `MainScreen.tsx` (three
  `.subicons` clusters, plus the now-dead `ExpandIcon()`) and from
  `WYP_main_screen_palette1.html` (three icon `<span>`s plus a stale
  header comment). Contract was never built anywhere, so nothing to remove
  for it. This drops the "Priority 3: Expanded screens" phase
  `docs/WYP_Week4_Plan.md` had reserved — that doc's own entry updated to
  record the reversal. **Both changes leave PRD/UI spec content stale,
  flagged together rather than silently diverged from**: PRD §3.7 and UI
  spec §8.7/§9.7/§5.1/§11.1 still document the Expand/Contract feature in
  detail; PRD and UI spec §6.2 both still say Overdue doesn't apply to
  ToDos "since due date is optional" (true before ToDos had a due_date
  column at all — the owner's own request already reasons past this).
  Neither doc edited here — open question for the owner on whether/when to
  do the formal revision. See the decisions log's 2026-08-12 entry.
- **Week 5 Priority 1 (email sending) started — template module, send
  route, and the Tight-window advisory built; the actual send path is not
  yet live (2026-08-12).** Owner confirmed wouldyouplease.com is his real
  domain and will set up Resend/DNS himself: "Please start on the part you
  suggested and await my real MX information to proceed." New
  `app/src/lib/email.ts` — pure, no env var access — renders PRD §7.3's
  Initial Request and Reminder email subject/body from a Request's own
  data, matching the PRD's literal wording (extracted verbatim from
  `docs/WouldYouPlease_PRD_v12_9.docx`, same zipfile+regex technique used
  elsewhere in this file's history), plus `isTightWindow` (24-hour
  threshold, missing Due Time falls back to `ics.ts`'s own
  `ICS_DEFAULT_DUE_TIME` rather than a second convention for the same
  ambiguity). New `app/api/email/send-request/route.ts` is the only place
  `RESEND_API_KEY` is read — **re-derives the Request's description, Due
  Date/Time, and the recipient's stored email from Supabase itself, scoped
  by the caller's own forwarded JWT** (anon key + `Authorization` header
  passthrough, no `service_role` anywhere in this file — same posture
  CLAUDE.md's Database section already takes), rather than trusting
  whatever the client posts; only the Request id and an already-minted
  `issue_request_link` token/link come from the client. Every failure
  path, including the no-SMTP-configured case (`reason: 'not_configured'`),
  returns 200 with `sent: false` — this must never surface as an error
  against a Request that already saved successfully. Wired into
  `CreateRequestForm.tsx`'s `handleSubmit`: after Send succeeds, mints a
  response-link token (the same owner-only `issue_request_link` RPC,
  migration 008, that `RequestDetailForm.tsx`'s "Get Response Link" band
  already calls manually) and POSTs to the new route, fire-and-forget,
  wrapped so nothing in that block can undo or block the already-saved
  Request. A Tight-window advisory note (reusing `isTightWindow`) shows
  near Due Date/Time on Create Request only — **not** ported to Request
  Detail, since whether re-editing an existing Request's Due Date there
  should re-trigger the Initial email at all is a genuinely open question,
  flagged rather than silently decided.
  **Send path switched from Resend to Hostinger SMTP, same day** — the
  owner signed up for Hostinger's mailbox hosting (`notifications@would
  youplease.com`, his own choice after being asked what local-part to
  use) rather than Resend, the placeholder provider `docs/WYP_Week5_Plan.md`
  had assumed. `app/api/email/send-request/route.ts` now sends via
  `nodemailer` over SMTP (`smtp.hostinger.com:465`) instead of a Resend
  `fetch` call; `export const runtime = 'nodejs'` added explicitly since
  `nodemailer` needs Node's `net`/`tls`, unavailable on Edge. Env vars are
  now `EMAIL_SMTP_HOST`/`EMAIL_SMTP_PORT`/`EMAIL_SMTP_USER`/
  `EMAIL_SMTP_PASSWORD` (replacing `RESEND_API_KEY`) — the real mailbox
  password lives only in `.env.local` (git-ignored) and, once the owner
  adds it there himself, Vercel's own Environment Variables; never in a
  committed file. **Verification blocked by this session's own sandbox
  network allowlist, not a credentials problem** — `transporter.verify()`
  failed with a DNS resolution error (`EAI_AGAIN`) before authentication
  was ever attempted; `.env.local` was written into the owner's own real
  project folder, so `npm run dev` on his machine (or the deployed Vercel
  app, once configured there) should be able to verify this for real. See
  the decisions log's two 2026-08-12 entries for the full write-up.
  **Still open, from `docs/WYP_Week5_Plan.md`**: the Reminder email's own
  day-before scheduled job (Vercel Cron vs. `pg_cron`, undecided).
  **Live test, 2026-08-13**: `.ics` events with no Due Time now render as
  RFC 5545 all-day (`VALUE=DATE`) events instead of defaulting to a
  fabricated 9:00 AM slot — the old default made Gmail/Outlook offer
  "Invite Others" on what was never a meeting (`buildIcsContent`,
  `app/src/lib/ics.ts`; a Due Time the sender actually sets is unaffected).
  The same test's email Subject was missing "from `<name>`" — traced to
  `profiles.display_name` likely being empty for the test account, not a
  route bug (the omit-when-null behavior is exactly what PRD §7.3
  specifies); flagged for the owner to confirm via a direct query rather
  than changed blind. **That investigation's tentative conclusion was
  wrong — see the decisions log's next 2026-08-13 entry.** `profiles` was
  found completely empty (zero rows, not just missing the owner's own),
  because `CreateFreeAccountForm.tsx`'s `handleSubmit` only ever ran a
  plain `UPDATE ... WHERE id = X`, and Postgrest doesn't treat "matched
  zero rows" as an error — every prior Save had silently done nothing while
  reporting success. Fixed: the UPDATE now chains `.select('id')` to detect
  a zero-row result, and falls back to a plain `INSERT` (same field set,
  safe under the existing `"profiles: insert own"` RLS policy) when it
  finds one. Self-healing regardless of whether `handle_new_user`'s trigger
  (Week 1 SQL history) is ever confirmed working — not yet verified either
  way; the owner has a direct verification query and a one-time backfill
  for his own row. **Confirmed fixed, live** — the owner redid Create Free
  Account (not the manual backfill) and his name now shows correctly on
  Received Requests, exercising the new INSERT-fallback path for real.
  Trigger status was genuinely unconfirmed (only `handle_new_user`'s own
  existence had been verified, not the trigger itself), so **migration 014**
  (`docs/Week5 - SQL history.txt`, confirmed run by the owner 2026-08-13)
  recreated `on_auth_user_created` idempotently rather than leave it open —
  protects future sign-ups regardless of whether the trigger really was
  missing before.
- **Marketing landing page drafted, mobile-first — `design/marketing/WYP_landing_page.html`, new 2026-08-12.** A new
  category in `design/` (see that folder's own README), separate from the
  480px app-screen mockups — this is a full-width, responsive sales page
  for an unauthenticated, no-parameter visit to wouldyouplease.com, not an
  app screen. Owner: "a landing page... as a sales pitch to set up a Free
  Account... The action item from the page would be the login/create
  account screen" — both CTAs point to `/login`. Copy reused from the
  owner's own sales one-pager; hero illustration is a hand-built SVG of the
  app's own real Main Screen rather than the owner's AI-generated reference
  photo, which had garbled placeholder text and no way to regenerate in
  this session — see the decisions log for the full reasoning, including
  why the palette stays strictly on-token. **Mobile-first**, per the
  owner's own follow-up correction — every rule outside two `@media`
  breakpoints (600px/900px) targets a phone by default; not yet wired to a
  route or reviewed in an actual browser (no headless browser reachable in
  this session's sandbox to screenshot it — verified structurally instead,
  see the decisions log).
