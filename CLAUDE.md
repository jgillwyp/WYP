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
  than changed blind. **`.ics` fixed for Outlook, same day, live test on
  Vercel**: Outlook (mobile and web) rejected the emailed .ics —
  "Inbound Mime method and ICAL method mismatch" — because the email route
  declared `method=REQUEST` while `buildIcsContent` wrote no `METHOD` into
  the VCALENDAR body at all; Gmail didn't care, Outlook does. `ics.ts` now
  writes `METHOD:PUBLISH` (the correct iTIP method for a one-way
  informational entry, not a meeting invite) and the route's attachment
  `contentType` matches. **That investigation's tentative conclusion was
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
  see the decisions log). **Two badge fixes, 2026-08-13**: the "Get it
  Done!" badge's second line overflowed its rect (widened 128px -> 200px);
  both it and the Track It badge gained a 2px `#123B7A` border (matching
  the Send It badge's own fill) after the owner reported both blending
  into the background/dashboard art behind them.
- **Add to Calendar hides itself when reached via the calendar's own link
  (2026-08-13, `app/src/lib/ics.ts`, `RequestResponseForm.tsx`,
  `ResponseDetailForm.tsx`).** `buildIcsContent` stamps every link it
  embeds in the `.ics` (both `URL` and the inline link in `DESCRIPTION`)
  with `?src=calendar`; both response forms read it back via
  `cameFromCalendarLink()` on mount and hide their own "Add to Calendar"
  row when present, on the reasoning that a recipient who got there by
  clicking the event already has it on their calendar. Per-click, not
  persistent — Request links are multi-use, so the same recipient reaching
  the page via the original, unmarked email link still sees the button.
  See the decisions log for the full write-up.
- **Print Reports rebuilt with full Dialog/Attachments content, Category
  prefix, single-item print, and Archive print (2026-08-15) — migration 029
  DRAFTED, NOT YET CONFIRMED RUN.** Owner supplied three xlsx print mockups
  (Sent/Received/ToDos). Supersedes the 2026-08-13 icon-only Print Reports:
  each printed record now shows its full Dialog thread and full
  Attachments/Locations list, not just a count icon, fetched fresh at print
  time (`loadOwnedPrintDetail()`/`loadReceivedPrintDetail()`) rather than
  added to the always-loaded Main Screen queries — Received's fetch depends
  on **migration 029** (`get_received_print_detail()`,
  `docs/Week6 - SQL history.txt`), **not yet run**, so Received print will
  fail until the owner confirms it. Sent print gains a Category prefix
  (new `categories(name)` embed) per the owner's instruction, even though
  Sent has never shown Category on screen; Received print deliberately does
  not, since PRD §2.3 withholds Category from the recipient (already
  enforced by `get_received_requests()`/`get_received_print_detail()`
  returning no category field) — flagged as a literal-instruction-vs-PRD
  conflict, resolved in the PRD's favor. ToDos' print now drops both Due
  and Done columns together when `todo_dates_enabled` is off (previously
  only Due). Request Detail's and ToDo Detail's own Print icons now render
  the same detailed single-item report instead of `window.print()` on the
  live screen, with no sort-arrow header row (owner: "the up/down arrow for
  a selected sort would not be shown for a detail print of a single item").
  Archive gained its own Print icon, reusing the `.archcheck` checkbox in a
  new print-only column (`.archprow`) — **deliberately excludes selection
  criteria** (Recipient/Requestor, Before Done Date) from the printed
  header, since the owner flagged that as his own follow-up design task
  ("I will work on that next"), not built here. `npx tsc --noEmit`/`npm run
  lint` clean. No mockups updated. See the decisions log's 2026-08-15 entry
  for the full write-up, including a React Compiler
  memoization-preservation lint fix (`startPrint` had to move after the
  `sortedSent`/`sortedReceived`/`sortedTodos` `useMemo` calls in
  `MainScreen.tsx`).
- **Landing page is now the live, unauthenticated `/` route (2026-08-13,
  `app/components/LandingPage.tsx`, `app/components/landing.css`,
  `app/page.tsx`).** Owner: a new/signed-out visitor was being bounced
  straight to `/login`; wanted `design/marketing/WYP_landing_page.html`
  shown instead, same as any normal sales-first landing page — "my
  understanding is that a login is only needed on a per-device basis,"
  which is correct ("Keep Me Signed In" persists via `localStorage`, so a
  returning signed-in visitor is unaffected). `page.tsx` no longer wraps
  `/` in `RequireAuth` (whose no-session redirect is unconditional); it
  checks `supabase.auth.getUser()` itself and renders `MainScreen` or
  `LandingPage` accordingly — every other route still uses `RequireAuth`
  unchanged, this carve-out is `/`-only. `LandingPage.tsx` is a close
  mechanical port of the mockup (class->className, kebab-case SVG attrs->
  camelCase, `<a>`->`next/link`'s `Link`, no re-added Google Fonts link
  since Inter's already self-hosted app-wide via `next/font`). Styles live
  in `landing.css`, scoped under a `.wyp-landing` root class to avoid
  leaking into `globals.css`'s site-wide rules — the one real collision
  found (`.panel`, already the app's own Dialog/Attachments panel) is
  renamed `.lpanel` here rather than relying on scoping specificity alone;
  `:root` tokens are not redeclared, `landing.css` reads the same custom
  properties `globals.css` already defines. `npx tsc --noEmit`/`npm run
  lint` clean; not yet visually verified in a real browser (no headless
  browser reachable in this sandbox). See the decisions log for the full
  write-up, including the apostrophe/curly-quote JSX-escaping decision.
- **Landing page header/hero redesigned for phone; `/login?intent=signup`
  title variant (2026-08-13).** Owner testing on a phone: the header's one
  row (logo + wordmark + both CTA buttons) broke down narrow — logo didn't
  render, "Start Free Account" truncated mid-word, "Sign In" read as plain
  text easily mistaken for a caption. Fix: header now shows logo + wordmark
  + a "Tracking Requests and ToDos" tagline only (same tagline
  `WypHeader.tsx` already uses), no buttons; `Start Free Account`/`Sign In`
  moved into the hero, stacked (`.hero-btns`) beside three explicit
  headline lines ("Send it." / "Track it." / "Get it Done.", each its own
  line) rather than below the lede. `Start Free Account` here is light-blue
  (`.btn-tint`) and `Sign In` white (`.btn-white`, smaller) — owner's own
  reasoning: the light-blue version "looks better when on the same page as
  the larger white background version deeper in the text" (the final CTA
  band's own, larger, white Start Free Account button). `.brandmark svg`
  gained explicit `width`/`height` attributes as a defensive fix; header
  and hero-line sizes now scale up at the existing 600px/900px breakpoints
  instead of staying fixed at the original small mobile-only values.
  Landing page's Start Free Account links (hero-top and final CTA band) and
  Request Response's "Create your own Free Account" link now carry
  `?intent=signup`; `app/login/page.tsx` reads it via
  `window.location.search` (same precedent as `AddContactForm.tsx`'s
  `?from=create-request`, avoiding a `useSearchParams()` Suspense boundary)
  and shows "Sign In for Free Account" instead of "Sign In" when present —
  owner: clicking Start Free Account and landing on a plain "Sign In"
  screen was "a little jarring," though it's still the same one screen
  either way (no separate sign-up form exists). Ported into
  `design/marketing/WYP_landing_page.html` to stay in sync with the live
  component. `npx tsc --noEmit`/`npm run lint` clean; not yet visually
  verified on a real phone. See the decisions log for the full write-up.
  **Owner-reported not showing, same day, unresolved as of this writing**:
  testing after logging out and clicking Start Free Account from the
  landing page still showed plain "Sign In," not "Sign In for Free
  Account." The code read correctly on inspection (both landing-page links
  carry `?intent=signup`; `isSignupIntent`'s lazy `useState` initializer
  reads `window.location.search` correctly) — likely not yet deployed at
  the point he tested, since this shipped in the same batch as the
  header/hero redesign above; flagged rather than silently assumed fixed,
  pending the owner confirming he's on the latest deploy.
- **Open chip was excluding Overdue rows on Sent/Received/ToDos
  (2026-08-13, `MainScreen.tsx`).** Owner: "Open chip displayed items do
  not include Overdue items - which should be shown - because they are
  open." `statusFor()`'s three-way exclusive status (open/overdue/done)
  was compared to the Open filter with plain equality, so an Overdue row
  never matched. New shared `matchesStatusFilter()` helper: the Open chip
  now matches both `open` and `overdue`; the Overdue chip is unchanged
  (still narrows to just `overdue`). `npx tsc --noEmit`/`npm run lint`
  clean.
- **Private-testing signup gate — migration 015, drafted, NOT yet
  confirmed run** (`docs/Week5 - SQL history.txt`, `app/login/page.tsx`,
  2026-08-13). Owner: wants a small testing group without "an unexpected
  expansion" of self-serve signups. New `app_settings` (key/value control
  table — `update app_settings set value = false where key =
  'signup_gate_enabled';` turns the gate off, no redeploy) and
  `beta_allowlist` (one row per invited email, plain `insert`) tables, plus
  a `SECURITY DEFINER` function `can_create_account(p_email)` that anon can
  call. Always returns `true` for an email already in `auth.users` — a
  returning user, including the owner's own account, is never gated,
  matching his explicit scoping ("This should only apply to brand new
  signups") — otherwise `true` only if the gate is off or the email is
  allowlisted. `app/login/page.tsx`'s `handleSubmit` calls it before
  `signInWithOtp` (has to be before, since that call is what actually
  creates the account and sends a real email); a blocked email shows a new
  `gated` screen state with the owner's exact wording and a
  `mailto:notifications@wouldyouplease.com` link. See the decisions log for
  the full write-up, including the rejected Auth-Hook alternative.
  **Migration 015 confirmed run by the owner 2026-08-13** — the gate is
  live: any brand-new email not on `beta_allowlist` now sees the Private
  Testing screen instead of getting a magic link. `npx tsc --noEmit`/`npm
  run lint` clean.
- **Three small live-testing fixes (2026-08-13): dead Main Screen print
  icons, session-check flakiness, per-account chip persistence.** (1)
  Main Screen's Print Sent/Received/ToDos were `<span role="button">`s
  with no `onClick` at all — never actually wired, unlike Create Request's
  own working Print icon (`onClick={() => window.print()}`), which the
  owner correctly remembered working elsewhere. Fixed to match that
  pattern (`MainScreen.tsx`). (2) Owner-reported: closing the browser
  signed in, then reopening it later, sometimes showed the landing page
  instead of Main Screen, then correctly showed Main Screen again on a
  later visit with no action taken. `app/page.tsx` and `RequireAuth.tsx`
  both used `supabase.auth.getUser()` — a live round-trip to Supabase's
  Auth server — and treated any failure, including a transient network
  hiccup right after reopening, as "not signed in." Both switched to
  `supabase.auth.getSession()` (reads the already-initialized local
  session, no network call of its own), matching the pattern
  `app/login/page.tsx`'s own already-signed-in check already used — a
  UI-routing decision only, not a security change; real access control is
  still Supabase's RLS/JWT verification on every actual data call. (3)
  Owner: "keep track of the chip settings last-used for an account user...
  these defaults should only be used the first time an account user sees
  the main screen" — new scope, not a correction of the 2026-08-09
  sessionStorage decision. **Migration 016** (`docs/Week5 - SQL
  history.txt`, drafted, NOT yet confirmed run) adds
  `profiles.main_chip_prefs jsonb not null default '{}'::jsonb` plus a
  column-level `grant update (main_chip_prefs)` to `authenticated`, same
  pattern as migration 013's `time_zone` grant. `MainScreen.tsx` keeps its
  existing `sessionStorage` fast path unchanged (avoids a flash of default
  state on a quick Detail-screen round trip) and adds a one-time load of
  `main_chip_prefs` on mount, applied on top of whatever already rendered,
  plus a save-on-change effect gated so it can never fire before that
  initial load resolves. An empty `{}` (a brand-new account) is the only
  condition where the hardcoded defaults apply; any saved value is used
  from then on, on any device. `npx tsc --noEmit`/`npm run lint` clean.
- **Supabase Auth's own Custom SMTP is now configured (2026-08-13),
  separately from WYP's own Hostinger integration.** Owner was hitting
  Supabase's built-in mailer limits testing sign-up/login — 2 magic-link
  emails/hour, and more restrictively, delivery refused entirely to any
  address outside the Supabase project's own team. Fixed in the Supabase
  dashboard (Authentication → SMTP Settings) using the same Hostinger
  mailbox `app/api/email/send-request/route.ts` already sends from — a
  separate configuration, not the same setting, since Supabase Auth's own
  mailer and this repo's `nodemailer` transport are independent systems
  that happen to share a mailbox. Confirmed working (a sender-name typo the
  owner made while entering it showed up verbatim in a received magic-link
  email, then was corrected). No code or env var in this repo controls
  this — it's entirely a Supabase project setting.
- **`/login`'s `?intent=signup` fix from earlier the same day had a real
  bug — fixed with `useSearchParams()` (2026-08-13).** Owner-reported,
  screenshot: address bar showed `?intent=signup`, band still read plain
  "Sign In." The lazy-`useState`-on-`window.location.search` approach only
  reads once, on that component instance's original mount — stale once
  Next's client router reuses an already-mounted `/login` instance across a
  params-only navigation instead of remounting fresh. Fixed with
  `useSearchParams()` (`next/navigation`), which re-renders on every
  search-param change regardless of mount history; requires a `Suspense`
  boundary, so `app/login/page.tsx` now default-exports a thin
  `<Suspense>` wrapper around the real screen (`LoginScreen`).
  `AddContactForm.tsx`'s own `?from=create-request` read is unaffected —
  it's read live inside a click handler, never cached across renders.
  Private Testing's copy was also revised twice, both times to the owner's
  own wording verbatim — see the decisions log for both changes in full.
  `npx tsc --noEmit`/`npm run lint` clean.
- **Main Screen scroll position now survives Add/Edit ToDo (2026-08-13).**
  Owner: "back does not work as expected... returns to the top of the screen
  and shows Requests Sent." Real root cause: `.scroll` is an internally-
  scrolling `overflow-y: auto` div, not the window — the 2026-08-09
  `router.back()` convention only ever restores `window.scrollY`, which this
  screen never uses, so the div's own `scrollTop` was silently reset to 0 on
  every remount regardless of `back()` vs `push()`. Fixed with explicit
  `sessionStorage` persistence in `MainScreen.tsx` (`wyp.mainScrollTop`):
  saved on every scroll, restored once after `loading` first turns false on
  a fresh mount (so it lands against real row heights, not the "Loading…"
  placeholder). Separately, `CreateTodoForm.tsx`'s Save/Cancel were still
  `router.push('/')` — the one create-new-item screen that never got the
  2026-08-09 Detail-screen `back()` convention (that batch only touched
  *edit* screens, reached from an existing row; Create ToDo is reached from
  a button and was written on its own). Fixed to `router.back()` to match.
  `npx tsc --noEmit`/`npm run lint` clean.
- **Main Screen Print Reports (2026-08-13, §6.34 PROPOSED, not drawn in any
  mockup).** Owner: the existing Print buttons printed the live,
  internally-scrolling on-screen layout as-is — "only shows what can fit
  onto a page." Built from the owner's own uploaded xlsx mockup: a
  dedicated print-only layout per section (`.print-report`, shown via
  `@media print`, mutually exclusive with the live UI's new `.no-print`
  wrapper), driven by a `printSection`/`printGeneratedAt` state pair and an
  effect that calls `window.print()` once the report JSX has committed,
  resetting on the browser's `afterprint` event. Sourced from
  `sortedSent`/`sortedReceived`/`sortedTodos` — already filtered/sorted —
  per the owner's own confirmation: "The print should follow the chip and
  sort set for the section by the user." Full untruncated descriptions (no
  2-line clamp), the existing Dialog icon reused (Attachments has no data
  model yet, so no icon slot for it), red text for Overdue rows, and a Due
  Time sub-line when set. ToDos' print columns (Description/Due/Done)
  deliberately don't match its on-screen row (Priority/Category, no dates)
  — followed from the owner's own mockup rather than reconciled with the
  live layout. Due Time required adding `due_time` to `SentRow`/
  `ReceivedRow` (not `TodoRow`) and to the Sent query's `.select()`
  directly; Received needed **migration 017** (`get_received_requests()`
  extended to return `due_time`). **First draft failed when the owner ran
  it**: `create or replace function` cannot change a `RETURNS TABLE`
  function's OUT-parameter row shape at all (migration 011's `owner_tier`
  precedent only worked because it was appended last; `due_time` was
  inserted mid-list here) — Postgres's own error names the fix: `drop
  function` first, then `create function` fresh, re-granting `execute`
  afterward since the drop clears it too. Corrected in the migration file
  and **confirmed run by the owner 2026-08-13** — Print Received and the
  Received subcard can now show a Due Time sub-line. `npx tsc --noEmit`/`npm
  run lint` clean.
- **Private Category becomes an opt-in account preference (2026-08-13,
  migration 018, `profiles.private_category_enabled boolean not null
  default false`) — confirmed run by the owner 2026-08-13.** Owner: "I think the
  Private Category should be an account option, not a standard presented
  data element... available for Free Accounts, but only if they turn it
  on... A single option could control its availability for both Requests
  and ToDos." Not tier-gated — any account may turn it on. **Account is
  now live for the first time**, superseding every earlier "intentionally
  undesigned" note on it — offered a choice between building a minimal
  Account screen now vs. adding the toggle to Housekeeping instead, the
  owner picked Account. New `app/components/AccountForm.tsx` + `/account`
  route: one `.checkrow` toggle, auto-saves on change (optimistic, reverted
  on a failed write), nothing else from the `WYP_your_account_palette1_
  floating.html` mockup is built. Main Screen's Housekeeping "Account" row
  now navigates there instead of doing nothing. Gated everywhere Category
  appears — the entire `.fgroup` (lookup + Add Category) is unrendered, not
  locked, on Create Request/Create ToDo/Request Detail/ToDo Detail when
  off; Main Screen's ToDos colbar drops to plain "Description" (no longer
  clickable) and each row drops its `.cat` span, keeping the dash for
  readability. Sent/Received never showed Category on Main Screen or
  either print report, so nothing needed gating there. Each screen reads
  the flag off the same `profiles` round trip it already made for
  `display_name`/`main_chip_prefs`, no extra query. **Two edge cases
  flagged, not specially handled**: an existing `category_id` from before
  the toggle was turned off stays in the database, just hidden until
  turned back on; and a persisted ToDos sort state of `category` from
  before toggling off still technically sorts by the now-hidden name.
  **No mockups updated** — all five source mockups still draw Category as
  always-present; flagged in `design/README.md`, not silently skipped.
  `npx tsc --noEmit`/`npm run lint` clean.
- **Due/Done Time becomes an opt-in account preference on Requests
  (2026-08-13) — migrations 019/020/021 confirmed run by the owner
  2026-08-13.**
  Owner: "As another account option, when turned off the four-value
  two-line presentation of Due Date Due Time Done Date Done Time on
  Requests would become like a ToDo one-line two-value presentation of Due
  Date and Done Date." Broader than the owner's own estimate ("without much
  of a complication (I think)") — Due/Done Time also shows on
  recipient-facing screens (Request Response, Response Detail), and this
  file's own Entitlements rule ("rights on a request come from its issuer,
  never from whoever is reading it") means a consistent implementation has
  to gate those too, off the *sender's* setting. Offered owner-only vs.
  recipient-inclusive scope via AskUserQuestion; owner picked
  recipient-inclusive. **Migration 019** —
  `profiles.request_time_enabled boolean not null default true` (true, not
  false like Category's `private_category_enabled` — this is pre-existing,
  already-relied-upon behavior, e.g. Print Reports' Due Time sub-line and
  the `.ics` builder, so defaulting off would silently hide already-set
  data for every existing account). **Migration 020** adds
  `owner_request_time_enabled` to `get_request_by_token` and
  `get_received_request` — both `returns jsonb`, so a plain
  `create or replace function` is safe (no OUT-parameter constraint; see
  that migration's own header comment, which also corrects an earlier
  overstated claim about why migration 011's `owner_tier` addition worked —
  it was the `jsonb` return type all along, not "being appended last").
  **Migration 021** adds the same field to `get_received_requests()`, which
  *is* `RETURNS TABLE` — applying the migration-017 lesson proactively,
  this one is `drop function if exists` then a fresh `create function`.
  Second `.checkrow` toggle added to `AccountForm.tsx` ("Show Due/Done Time
  (Requests)"), sharing one generalized `handleToggle(field, next, setLocal)`
  helper with the existing Category toggle. Gated everywhere Due/Done Time
  appears: Create Request's Due Time field is simply unrendered when off;
  Request Detail's two two-value rows (Due Date/Due Time, Done Date/Done
  Time) collapse into one combined Due Date + Done Date row, reusing ToDo
  Detail's own combined-row markup; Request Response and Response Detail
  read `owner_request_time_enabled` from their RPC payload (not the
  viewer's own account) to drop the Due: metarow's time suffix and collapse
  the editable Done Date/Done Time row to Done Date alone; Print Reports
  gates Sent by the signed-in owner's own flag and Received per-row by each
  row's own `owner_request_time_enabled`, since different Received rows can
  have different senders. Same "existing value stays in the database, just
  hidden" convention as Category — a Request's `due_time`/`done_time`
  already set is never cleared, just not shown/edited until turned back on.
  **No mockups updated** — none of the affected screens' static HTML has a
  toggle-driven collapsed state to demonstrate; flagged in
  `design/README.md`, not silently skipped. `npx tsc --noEmit`/`npm run
  lint` clean.
- **Fixed, same day: a lone native date field (Create Request's Due Date
  with Due Time off; Request Response's/Response Detail's Done Date with
  the issuer's Due/Done Time off) rendered Safari's spelled-out date format
  ("Wednesday, September 30, 2026") instead of the app's usual short one.**
  Root cause: `.frow .ffloat`'s `flex: 1 1 0%` (2026-08-11) grows a
  field with no row sibling to ~400px+; Safari's native date control
  switches to a wider, verbose format past a certain width, matching mm/
  dd/yyyy at the ~200px two paired fields split evenly. Fixed with
  `.frow > .ffloat.picker.native:only-child { flex: 0 1 220px; }` in
  `app/globals.css` — caps a lone field to roughly what a paired field
  already gets, leaving the two-field case untouched. No mockup changes —
  none of the three affected screens' static HTML has a real
  `type="date"` input to trigger the same browser behavior.
- **Get Response Link removed from Request Detail (2026-08-14)** — the
  manual `.linkband` UI/state/handlers are gone from
  `RequestDetailForm.tsx` ("no longer needed for testing"); migration 008's
  `issue_request_link` function and its use inside `CreateRequestForm.tsx`'s
  automatic Initial Request email flow are unaffected.
- **"Keep It as Simple as Possible," round three (2026-08-14) — migrations
  022/023 DRAFTED, NOT YET CONFIRMED RUN; migration 024 CONFIRMED RUN by
  the owner 2026-08-14.** Migration 022 —
  `profiles.todo_dates_enabled boolean not null default false` — off
  collapses Create ToDo/ToDo Detail's Due Date/Done Date fields and
  quick-Done band into a single Open/Done Status chip pair (§6.35
  PROPOSED, reusing `.sendrow`+`.chippair`+`.gatenote`), reinterpreting the
  existing `done_date` column rather than storing anything new — Done sets
  it to today on Save only if unset, Open clears it, `due_date` stays
  hidden and untouched either way. Migration 023 —
  `alter column request_time_enabled set default false` — reverses
  migration 019's own true default, deliberately, now that this app has no
  real users besides the owner to worry about hiding existing data from;
  existing rows are unaffected, only future signups. Migration 024 —
  `grant update (tier) on profiles to authenticated`, **TESTING ONLY,
  FLAGGED CONFLICT**: migration 002 deliberately withheld this exact grant
  so no free user could self-upgrade ("writable only by service_role, the
  billing webhook, later"). Reopened here because the owner's own request
  explicitly frames it as temporary ("For the development and Attachments
  testing, perhaps an Account 'Subscribed?' option is appropriate...
  Later... only able to be set by opening a subscription page... a
  'Subscription Details' Task could replace the Account option") and he is
  the only account that exists to use it. **Must be revoked (or replaced
  by the real billing-webhook path) before any real second user or actual
  payment processing exists** — do not let this grant survive into a
  multi-user launch unexamined. `AccountForm.tsx` gained two more
  `.checkrow`s ("Show Due/Done Dates (ToDos)," "Subscribed? (testing
  only)") — the tier one uses its own `handleTierToggle`, since the
  underlying column is text-valued, not boolean, and doesn't share the
  other three toggles' `handleToggle` helper. **No mockups updated** — the
  Status chip pattern has no drawn precedent in any of the five ToDo/
  Request mockups; flagged in `design/README.md`. Deferred/logged only,
  not built this batch: incremental report printing (owner wants a wider,
  larger-font redesign first), Attachments delete-permission/duplicate-
  name/type-limit notes (Attachments itself still hasn't been started —
  task Priority 3), and an Archive UI the owner has designed and will
  present after Attachments ships. See the decisions log's three
  2026-08-14 entries for the full write-up.
- **Attachments plan doc (`docs/WYP_Attachments_Plan.md`) and its seven open
  questions, all resolved (2026-08-14).** Owner answered every question in
  one message plus a follow-up on the ToDo Locations UI; see the decisions
  log's own entry for the full write-up. Key resolutions: the Request/ToDo
  owner can always delete any attachment on their own item, a non-owner
  uploader only their own; a 10 MB per-file size recommendation (not an
  owner-specified number) and a blocklist of executable/installer/script
  extensions rather than an allowlist; no virus scanning in v1 (Supabase
  Storage has none built in, and a real scanner is out of scope); a 10-item
  cap per Request/ToDo; the lapse-and-auto-delete job deferred to its own
  later priority; ToDos get "Locations" (`kind = 'reference'` — a typed
  Description + path/URL, no real storage) instead of real file uploads,
  since a ToDo has no recipient; the Print Reports icon added immediately
  rather than deferred.
- **Real Attachments, built (2026-08-14, Week 5 Priority 3) — migrations
  025/026/027 all CONFIRMED RUN by the owner 2026-08-14.** Migration 025 adds
  `public.attachments` (one table for both a Request's real `kind = 'file'`
  uploads and a ToDo's `kind = 'reference'` Locations — a check constraint
  keeps the two shapes from crossing), with RLS narrow on purpose: SELECT is
  owner-only; INSERT only ever allows `kind = 'reference'` directly (a
  `kind = 'file'` row can only be created by the new
  `app/api/attachments/upload` route); DELETE matches the resolved rule
  (owner always, non-owner uploader only their own). `uploaded_by` is
  nullable — an anonymous Request Response visitor has no `auth.users` row,
  same shape of problem `dialog.author_user_id` already solved the same
  way — with a parallel `uploaded_by_label` display snapshot, always set.
  Migration 026 creates a private Storage bucket with **no**
  `storage.objects` RLS grants for `anon`/`authenticated` at all — every
  upload/list/delete of a real file goes through
  `app/api/attachments/{upload,list,delete}/route.ts` (Node runtime,
  server-only), which use `SUPABASE_SERVICE_ROLE_KEY` to talk to Storage
  directly, but only after independently verifying the caller's permission
  through the same RLS-scoped/RPC-scoped paths the rest of the app already
  uses (a forwarded-JWT client for the owner and a signed-in recipient, the
  existing `get_request_by_token`/`get_received_request` functions for the
  anonymous and signed-in recipient cases) — a deliberate, narrow, flagged
  exception to this file's own "service_role never goes near the browser"
  rule, justified the same way the SECURITY DEFINER functions already are:
  an anonymous visitor has no session for RLS to scope to, and this problem
  can't be solved with a SQL function since Storage's own API isn't
  reachable from one. Migration 027 adds `attachment_count` to
  `get_received_requests()` (drop-then-recreate, the migration
  017/021-established fix for a `RETURNS TABLE` function) for the new Print
  Reports icon. **`SUPABASE_SERVICE_ROLE_KEY` — confirmed set by the owner
  in both `.env.local` and Vercel, 2026-08-14** (a Supabase `sb_secret_...`
  key from the newer secret-key system, not the legacy `service_role` JWT —
  functionally equivalent as the second argument to `createClient()`, which
  is all these routes ever do with it); this key must never reach the
  browser (see the migration 026 header comment) and lives only in the
  three route files above.
  New shared `app/components/AttachmentsPanel.tsx` (existing-item screens:
  Request Detail, ToDo Detail, Request Response, Response Detail) and
  `app/src/lib/attachments.ts`/`attachmentsClient.ts` (constants/helpers,
  the direct-client `kind = 'reference'` insert/delete used only for
  ToDos). Create Request/Create ToDo don't use the panel — neither has a
  real id yet, so files/Locations are staged client-side (same pattern as
  staged Dialog entries) and only written once Save/Send succeeds. Gating:
  sender-side screens read the signed-in user's own `profiles.tier`;
  recipient-side screens read the issuer's `owner_tier` (already-existing
  plumbing, migrations 011/012) — never the recipient's own tier, per this
  file's own Entitlements section. Viewing an already-added attachment is
  never gated, only adding a new one (same section). No delete UI exists on
  the anonymous Request Response screen — there's no session to attribute a
  delete to, and `delete/route.ts` refuses without an `Authorization`
  header regardless of what the UI shows. **A build-time design call, not
  an explicit owner instruction, flagged here rather than silently
  assumed**: ToDo Locations are gated on the same subscriber `tier` as a
  Request's real Attachments, for one consistent "Attachments is a paid
  feature" mental model — revisit if the owner wants Locations free instead
  (it has no real storage cost, so the reasoning for gating it is weaker
  than for real file uploads). A manual Delete hard-deletes (removes the
  Storage object and the row) rather than setting `deleted_at` — that
  column is reserved for the future lapse-and-auto-delete job, which needs
  to tell "reclaimed by a tier lapse" apart from "the user removed it,"
  something a hard delete already achieves on its own. Print Reports gained
  a paperclip icon (`AttachmentIcon`) beside the existing Dialog icon on
  Sent/Received rows and print rows; ToDos' own Locations have no such icon
  yet. **No mockups updated** — none of the six affected screens' static
  HTML has real upload/list JS to convert; flagged in `design/README.md`.
  `npx tsc --noEmit`/`npm run lint` clean.
- **Locations UX refined, 2026-08-14** — a persistent `.donerow`/`.donenote`
  note ("Locations are URLs or File paths.") sits next to Add Location
  whether or not any exist yet; a saved URL renders as a real underlined
  link (`.attname a`, explicit color/underline since Tailwind's preflight
  strips the anchor default); a non-URL entry gets a "Copy" button instead
  of an attempted `file://` link, since a browser has no filesystem access
  to open one. **URL detection widened same day**: `urlLocationHref()` in
  `app/src/lib/attachments.ts` now recognizes a bare domain (`ft.com`,
  `www.ft.com`), not just a full `https://` URL, while excluding file-path
  shapes and common file extensions (`report.pdf` stays plain text). A
  live HEAD/ranged-GET/DNS-lookup reachability check was considered and
  rejected — a browser can't run one against an arbitrary third-party
  origin (CORS), proxying it through our own server opens an SSRF surface
  for user-typed text, and it answers a liveness question, not the syntax
  question this UI actually needs. See the decisions log for the full
  write-up of both batches.
- **Archive screen designed, mockup only — 2026-08-14
  (`design/screens/WYP_archive_palette1.html`).** Owner's own drafted UI
  strategy for PRD §9.5, with pasted-in reference screenshots. One file,
  three Record-Type states (Sent Requests/Received Requests/ToDos) switched
  by a chip row; starts empty until a Recipient/Requestor and/or Before
  Done Date filter is entered; a matching record's checkbox defaults
  checked, and unchecking it persists through further filter changes
  (per-Record-Type, real working demo JS, not just static markup — this
  was the one behavior worth actually proving out). New Housekeeping
  "Archive" row added to the Main Screen mockup only — **not** wired into
  `MainScreen.tsx`, and no `archives`/Archive-Status schema work has been
  done; this pass is the design step only, matching this project's own
  mockup-first convention. **Diverges from PRD §9.5 (v12.9) in three
  flagged ways** — no Archive Now/Remove Archive Status mode-chip pair (the
  owner deferred Un-Archive explicitly, "that can be done later"), a new
  Recipient/Requestor filter §9.5's text never mentioned, and an
  empty-until-filtered list rather than one pre-populated on Record Type
  selection alone. Exact proposed replacement §9.5 wording is in the
  decisions log, drafted for the owner's approval before it's merged into
  the actual `.docx` — not done in this pass. One row in the owner's own
  reference screenshot rendered in the app's red Overdue treatment; built
  instead as the existing grey Done treatment everywhere, since every row
  here is already Done and Overdue/Done are mutually exclusive — flagged as
  a likely copy-paste artifact in the reference, not reproduced as-is. New
  `.archrow`/`.archcheck`/`.archspacer`/`.archbody` (§6.36 PROPOSED).
- **Archive is now Live** (`app/components/ArchiveForm.tsx`, `/archive`,
  2026-08-14, migration 028 confirmed run by the owner 2026-08-14) — supersedes "mockup only"
  above. Per-viewer archive scope (owner-confirmed via AskUserQuestion):
  `requests.archived_at` (the row's own owner, plain-RLS-writable) and
  `requests.received_archived_at` (the recipient, via new SECURITY DEFINER
  `archive_received_request()`) are independent — archiving a Received item
  never touches the sender's own Sent view of the same row, and vice versa.
  Neither column is ever excluded from a query — `MainScreen.tsx` hides an
  archived row only while its search box is empty, matching the owner's own
  drafted §9.5 text ("no longer displayed... while remaining available
  through Search"). Un-Archive stays deferred, as before. Housekeeping's
  Archive row is now wired into `MainScreen.tsx` for real. **PRD §9.5's
  drafted replacement text (decisions log) is still not merged into the
  actual `.docx`** — attempted this batch, deferred: the title-page/footer
  version-number text in `WouldYouPlease_PRD_v12_9.docx` is split across XML
  runs in a way `merge_runs.py` doesn't fully coalesce, making a safe edit
  slower than the rest of the batch. Do on explicit owner go-ahead. See the
  decisions log's 2026-08-14 entry for the full write-up.
- **Print reports: three more iterations the same day (2026-08-15), each
  from the owner testing a real printout.** (1) Duplicate masthead removed
  — Chrome's own default print header already shows a date/time and page
  title, so `.pmast` (this app's own copy) was a literal duplicate; deleted
  from all four print reports along with the now-dead `printGeneratedAt`
  state and `formatPrintTimestamp` helper in each. (2) Font size went
  through three px-based passes (14/11 → 18/13 → 19/15, the last matching
  the owner's own Excel-pt-to-px conversion table) before switching to
  **`pt` units outright** — `.ptitle` 14pt, every other print class 11pt,
  the same physical unit Excel's own font picker uses, removing any
  px/DPI/rounding step entirely. A `replace_all` mid-sequence briefly
  corrupted 14 unrelated live-app rules to 13px — caught before shipping by
  grep-verifying occurrence counts; see the decisions log for the full
  incident writeup and the safer pattern used afterward. (3) Page
  background forced white in print (`html, body { background: #fff
  !important }`) — the on-screen desktop-frame letterboxing color was never
  scoped away from `@media print`, so a wide-enough printed page could tint
  grey. (4) Due/Done Time now renders **inline on the same line as the
  date** ("7/15/26  8:30 AM", new `formatMDYSlash` helper, print-only)
  instead of stacked beneath it — scoped to just the Due/Done columns that
  can carry a Time; the plain Date column and Archive/ToDo Detail's
  date-only columns keep the existing dash `MM-DD-YY` format, a flagged
  asymmetry, not resolved. Due/Done columns widened 92px → 150px to fit.
  **Deferred, per the owner's own explicit sequencing request**: Brand Blue
  title/column-header color, alternating Row Tint record shading, and rule
  lines above/below the column header — `--brand-blue`/`--row-tint`/
  `--strip` already match his Excel colors exactly, so this should be
  mechanical once the font-size fix is confirmed against a real printout.
  See the decisions log's three 2026-08-15 entries for the full sequence.
- **Print reports, round two: a real Archive blank-page bug, a stuck-print-
  state bug everywhere, missing column headers on Request Detail/ToDo
  Detail (2026-08-15).** `ArchiveForm.tsx` had a second, never-wired-up
  Print icon in its record-type band calling bare `window.print()` — the
  actual cause of the owner's original "blank page" report, not the
  empty-until-filtered explanation offered at the time; removed. All four
  print reports (`MainScreen.tsx`, `ArchiveForm.tsx`,
  `RequestDetailForm.tsx`, `TodoDetailForm.tsx`) had a second bug: clicking
  the same Print icon twice in a row did nothing, since the effect
  triggering `window.print()` was keyed on a value (`showPrint`/
  `printSection`) that doesn't change on a repeat click, and `afterprint`
  doesn't reliably fire to reset it — fixed with a strictly-incrementing
  `printTick` counter as the actual effect dependency everywhere. Request
  Detail and ToDo Detail's single-item prints gained the column-header row
  they'd been missing since the original redesign (that batch's "no
  sort-arrow" design call had been implemented as "no header row at all");
  fixing Request Detail's surfaced a real, separate layout bug — its
  3-field print row (To/Due/Done, no Date column) was silently misaligned
  in the shared 4-column `.pr1` grid, new `.pcolbar.detail3`/`.pr1.detail3`
  fixes it. **Font size remains unresolved** — confirmed via the Vercel MCP
  that the `pt`-unit fix was live in production ~13 minutes before the
  owner's "still unchanged" report, ruling out a stale deploy; current
  leading suspect is the print dialog's own Scale setting (not yet
  confirmed by the owner), since Chrome's Print Preview auto-fits the whole
  page to its pane regardless of point size, so a screenshot-to-screenshot
  comparison can't actually confirm or rule out a real change. See the
  decisions log's newest 2026-08-15 entry for the full write-up.
  **Resolved, same day**: not a WYP bug at all — the owner's Chrome print
  dialog had Scale stuck at "Custom, 75%" (confirmed by his own screenshot),
  unrelated to any code here. Setting it to 100% fixed both the preview and
  the actual printout immediately. All three font-size CSS passes above were
  real, correct fixes — they were simply invisible against a 75%-scaled
  page. See the decisions log's resolution note on its "stuck-print-state"
  entry.
- **Contacts print report + migration 030, both confirmed, 2026-08-15.** A
  Print icon on `ContactsList.tsx` (`/contacts`), built from the owner's own
  "Contacts list.xlsx": Name/Email/Phone/Time Zone plus italicized Sent/Rec'd
  counts, new `.pcon-` CSS namespace (six columns — doesn't reuse `.pr1`).
  Sent/Rec'd come from new `get_contact_request_counts()` — **migration 030,
  confirmed run by the owner 2026-08-15**. Sent is a plain owner-scoped
  count; Rec'd required joining `auth.users` inside the `SECURITY DEFINER`
  function to match a sender's real login email against the caller's own
  `contacts.email` (same `auth.users`-reading precedent as
  `can_create_account()`, migration 015) — `get_received_requests()`'s own
  email-match pattern had never needed the sender's actual account email
  before, only their display name. "Sent"/"Rec'd" meaning confirmed via
  `AskUserQuestion`: same vocabulary as Main Screen's own Sent/Received.
  Built with the `printTick` fix from the start, so this report never had
  the stuck-print-state bug above. No mockup change. See the decisions
  log's 2026-08-15 entry for the full write-up.
- **Request Response / Response Detail: donerow now distinguishes "already
  Done before this visit" from "just marked Done this session," 2026-08-15.**
  Owner-reported: opening a Request that was already Done showed "This
  Request is now marked as Done, just click Send." — worded as if the
  visitor had just taken an action. New `alreadyDoneOnLoad` flag, captured
  once from the RPC payload's `done_date` at load time, adds a fourth
  donerow branch: "This Request is reported as completed." when filled,
  not sent this session, and already Done on load. The existing "just click
  Send" wording is now reserved for quick-Done/manual edits made *during*
  the current visit. Applied identically to both screens. See the decisions
  log's 2026-08-15 entry.
- **Reminder checkbox on Create Request/Request Detail — migration 031
  confirmed run by the owner 2026-08-15.** Owner's own design,
  reviewed in chat before building: a `.checkrow` ("Reminder - send on the
  morning before unless it is marked Done.") persisting a new
  `requests.reminder_enabled` column, replacing the old passive Tight-window
  advisory paragraph outright. Supersedes `isTightWindow`/
  `TIGHT_WINDOW_HOURS` (clock-precise, PRD's own "proposed default, not yet
  confirmed" 24-hour figure) with `isReminderEligible()`/
  `MIN_DAYS_FOR_REMINDER` (`app/src/lib/email.ts`) — pure calendar-day
  arithmetic, Due Date must be more than two days out. Not a subscription
  gate — plain disabled `.checkrow-disabled`, never `.is-locked`; default
  checked. Disabled with a native title tooltip in one of two states: no
  Contact/Due Date yet ("Please select Contact and Due Date before
  modifying the Reminder." — Create Request only, Request Detail's
  Recipient is already fixed), or Due Date too soon ("A Reminder is not
  available due to the short lead time."). Placement diverges: Create
  Request puts it beside a lone Due Date field when Due Time is off
  (`.checkrow-inline`, `.due-with-reminder` reproducing the §6.33 220px
  Safari cap `:only-child` can no longer supply once the checkbox joins as
  a sibling) or standalone after Attachments when Due Time is on; Request
  Detail always uses the standalone placement, since its Due Date row is
  never alone (Done Date is always paired with it). **Nothing reads
  `reminder_enabled` to gate an actual send yet** — the day-before Reminder
  job itself remains the unbuilt piece flagged elsewhere in this section;
  `app/api/email/send-request/route.ts`'s own `reminderPromised` only
  governs whether the Initial email's "a reminder will arrive" sentence is
  honest. New §6.37 PROPOSED component, not drawn in any mockup. `npx tsc
  --noEmit`/`npm run lint` clean. See the decisions log's 2026-08-15 entry
  for the full write-up, including the five review questions the owner
  resolved before this was built.
- **Sign-in session persistence investigated, 2026-08-15 — no app bug
  found; remembered-email fallback shipped instead.** Owner-reported:
  closing the browser after signing in, then reopening it later, sometimes
  lands on the landing page rather than Main Screen, requiring a fresh
  magic-link click. Re-verified the entire chain — `supabaseClient.ts`'s
  `hybridStorage` (session persisted to `localStorage` whenever "Keep me
  signed in," checked by default, is on), `app/page.tsx` and
  `RequireAuth.tsx` (both already on `getSession()`, the 2026-08-13 fix for
  a related-but-different bug), `/auth/callback/page.tsx` — all correct as
  written. The likely causes are both outside this codebase and not
  fixable from here: a browser/extension setting that clears cookies and
  site data (which includes `localStorage`) on close, or a Supabase
  project-level Auth session setting (dashboard → Authentication →
  Sessions) time-boxing sessions independent of this app's own code.
  Flagged for the owner to check both directly. Shipped the fallback he
  asked for regardless: `/login`'s Email field now remembers the last-used
  address (`wyp.lastEmail`, `localStorage`), tied to the same "Keep me
  signed in" checkbox rather than a separate toggle, so an unchecked box
  still means "leave no trace." `npx tsc --noEmit`/`npm run lint` clean.
  **Follow-up, same day**: the owner's own screenshot of Supabase's
  Authentication → Sessions page narrows cause #2 to a specific setting —
  "Detect and revoke potentially compromised refresh tokens" (refresh
  token rotation/reuse detection) is ON with only a 10-second reuse
  interval, which is known to false-positive and kill the whole session
  when a browser reopens more than one previously-open tab at once (a
  common browser "restore tabs" default) and two tabs race their own
  token-refresh timers. Not a code fix — a Supabase dashboard setting;
  recommended the owner raise the reuse interval (e.g. 30–60s) and/or
  check his browser's tab-restore setting. **Owner raised it to 60s and
  confirmed it fixed his laptop** (closed the browser, reopened two
  minutes later, landed straight on Main Screen); his phone still bounced
  to login after two minutes on the same test, unconfirmed root cause,
  owner separately testing a full hour of laptop-closed time. See the
  decisions log's 2026-08-15 entry.
- **Main Screen: Done column header no longer sortable/colorized on Sent/Received
  unless All or Done chip is selected (2026-08-17).** Owner-reported: Open/Overdue
  never show a Done row, so the Done column's `.pill`/▲▼ indicator and click-to-
  toggle were describing an ordering nothing in the visible list could show.
  `ColSort` gained a `disabled` prop — renders inert plain text, native
  `disabled` button, no active-pill — passed as
  `disabled={<sentFilter|receivedFilter> !== 'all' && !== 'done'}`. The stored
  sort key itself is untouched (resumes when All/Done is reselected); new
  `.colbar button:disabled { opacity: .55 }` CSS.
- **Landing page final CTA band revised; new "Who benefits" section added to
  landing page and sales one-pager (2026-08-17).** Owner-supplied reference image
  and Word doc. `.ctaband`'s old "Start free today at wouldyouplease.com" headline
  dropped (redundant on the page that already is wouldyouplease.com) for two bold
  `.lead` lines ("No credit card. No download. No setup." / "Send your first
  request in under a minute."); price line reworded to match. New "Who benefits
  from Would You Please?" section added directly before Subscription/Coming soon
  on both the live landing page (`.benefits`, 14.5px) and `docs/WYP onepager.html`
  (`.who`, 11.5px — a fixed one-page print layout, sized compact on purpose). The
  one-pager's own CTA band is unchanged — the owner's "read at the site" reasoning
  doesn't apply to a printed piece. **Not visually re-verified** — no headless
  browser or Chrome extension reachable in this sandbox; flagged for the owner to
  confirm the one-pager still fits one printed page.
- **Archive: filters and checkbox selection reset on a fresh visit, but survive the
  Detail round trip (2026-08-16).** Owner-reported: after filtering to a Recipient +
  Before Done Date, hand-deselecting a few rows, closing back to Main Screen, and
  reopening Archive later in the same login session, the same filtered rows reappeared
  but none were checked — his stated preference was that Archive's filters/selection
  reset on a fresh visit, surviving only the single round trip into a row's own Detail
  screen and back. `ArchiveForm.tsx` gained `ARCHIVE_ROUNDTRIP_KEY`, set by `openDetail()`
  right before `router.push`, checked by the `recipientQuery`/`beforeDone`/`deselected`
  `useState` lazy initializers (present → restore from `sessionStorage`, absent → start
  blank) and cleared by a mount effect afterward. Record Type and sort order are
  untouched — the report was about the filter fields and selection only. `npx tsc
  --noEmit`/`npm run lint` clean.
- **Request Detail Date: line; `.ftextarea` fields drop floating labels app-wide; Dialog
  cap lowered to 500 with live `.charcount` feedback; Initial Request email and `.ics`
  redesigned (2026-08-16).** Request Detail now shows "Date: `<long date>`" above Recipient,
  matching Request Response/Response Detail — pulled from a new `created_at` select and the
  same `formatLongDateTime()` helper those two already had. Every `.ftextarea` field (12
  usages, 8 files — Description, Dialog Text, Notes) dropped its `.ffloat` wrapper/`<label>`
  for a plain `placeholder`+`aria-label` — the owner's own fix for a real bug: a floated
  label can't track a `<textarea>`'s internal scroll region, so long text scrolled up under
  and overlapped it. New `.ftextarea-plain` CSS class (10px top padding, no longer needs room
  for a label) and `.charcount` (persistent "N / MAX" under every capped textarea, red+bold at
  the cap) — the latter answers the owner's separate report that a paste past the limit
  silently truncated and typing at the limit silently stopped, neither with any feedback.
  Dialog Text's cap dropped from 999 to 500 everywhere it appears. `app/src/lib/email.ts`'s
  `buildRequestEmailBody` (plain-text, link-last) replaced by `buildRequestEmailHtml`/
  `buildRequestEmailText`, both call-to-action-link-first (a same-day owner correction — the
  first draft had Description first) then Description then conditional Reminder note then
  attachments/Dialog note then a closing signup link now pointing at the bare site root, not
  `/login`. `app/src/lib/ics.ts`'s `buildIcsDescription` mirrors the same order/content in
  plain TEXT; `buildIcsContent` gained an optional `{ reminderPromised }` param (only the
  server-side email route has a real value; the two client-side Add-to-Calendar call sites
  default to `false`) and now derives `siteUrl` from the link's own origin. `npx tsc --noEmit`/
  `npm run lint` clean.
- **PRD v12.10 — §9.6 My Phrases added to the Future Features Roadmap
  (owner request, 2026-08-15). Spec only; nothing built.** Up to 12
  reusable text-snippet phrases (optional Description + up to
  150-character Phrase Text, same two-field pattern as a ToDo's own
  Locations); a Housekeeping Phrases Task manages the list (same pattern
  as the Contacts Task); an optional per-phrase button above and to the
  right of Create Request's Description field copies the phrase's text to
  the clipboard — deliberately Copy, not auto-insert, after the owner
  simplified his own original cursor-position-insertion idea mid-thread —
  rather than the app guessing where to place it. "Not yet phased," same
  precedent as §9.5 Archive; base-subscription-vs-add-on packaging left
  open in the PRD text, though added to the Monetization-direction
  paragraph's own business-style-feature examples. `docs/
  WouldYouPlease_PRD_v12_9.docx` → `docs/WouldYouPlease_PRD_v12_10.docx`
  (old file kept alongside, same as v12.8/v12.9). **The Project's own
  Canonical-sources setting is confirmed updated to v12.10 by the owner,
  2026-08-15.** See the decisions log's 2026-08-15 entry for the full
  write-up.
- **Chron notification system built (2026-08-17) — migrations 032/033
  DRAFTED, NOT YET CONFIRMED RUN; un-archive-on-clear built first as a
  prerequisite (see that entry above).** Owner's original ask: a
  day-before Reminder email (Received-Request account holder or ToDo
  owner, and a Sent Request's Recipient), a free opt-in "your Reminders
  went out" daily digest to the Requestor, a daily "just became Overdue"
  digest to the Requestor, individual Overdue emails to Recipients, and an
  hourly first-nudge for Due-Time Overdue Requests followed by a daily
  cadence thereafter (Due-Date-only Overdue Requests go straight to
  daily). Every open design question was answered directly and is
  reflected in the build: digests report only newly-affected items, never
  a repeating stale list; the nudge cadence is exactly as above; ToDo
  Reminders gate on `todo_dates_enabled` only, no separate checkbox; the
  Reminders-sent digest is a free feature; "morning" and the
  Overdue-transition pass both run at the *owner's own* local hour (the
  Sent Request Reminder alone uses the *Recipient's* own zone instead —
  see below); archived items are exempt from every notification, which
  only holds together because un-archive-on-clear (above) now exists.
  **Discovered mid-build and raised with the owner via AskUserQuestion**:
  Vercel's Hobby plan caps Cron Jobs at once-per-day, conflicting with the
  hourly design — **the owner upgraded to Vercel Pro the same day**,
  unblocking the design as originally specified.
  **Built as one hourly route, not three** —
  `app/api/cron/tick/route.ts`, invoked by a single `vercel.json` entry
  (`0 * * * *`), runs all four phases (day-before Reminders, Overdue
  transition, recurring nudges, two Requestor digests) every hour,
  gating each candidate row's own action on that row's own local hour
  via new `app/src/lib/cronTime.ts` (pure `Intl.DateTimeFormat` helpers,
  no date library) — a fixed-UTC-time Vercel Cron schedule can't itself
  express "each owner's own morning," so the route re-derives local time
  per row instead. Recipient-facing Reminder timing uses the Recipient's
  own zone (`contacts.time_zone`, falling back to the owner's
  `profiles.time_zone`); every other phase uses the owner's own zone.
  service_role (`SUPABASE_SERVICE_ROLE_KEY`) is used throughout — the
  same justified, narrow exception already carved out for the
  attachments API routes, extended here since a cron run has no session
  for RLS to scope to at all; owner account emails are read via
  `auth.admin.getUserById()`, cached per run.
  **Migration 032** (`docs/Week6 - SQL history.txt`) adds
  `requests.reminder_sent_at`/`overdue_notified_at`/`last_overdue_nudge_at`
  (idempotency columns, the app's own established convention over
  reconstructing state from `events`) and
  `profiles.reminder_digest_enabled`, plus the `get_received_request`/
  `set_response_done_as_recipient` changes the un-archive feature needed.
  **Migration 033** adds `cron_issue_request_link()` — a service_role-only
  sibling of the owner-only `issue_request_link` (migration 008), since a
  cron run has no `auth.uid()` for that function's own check to pass;
  always mints a fresh token rather than attempting to reuse an
  already-valid one, since only the token's hash is ever persisted and
  the raw value can't be recovered — the same behavior `issue_request_link`
  itself already has on every call. **Migrations 032 and 033 confirmed run
  by the owner, 2026-08-17.** New Account toggle: "Notify Me When
  Reminders Are Sent" (`AccountForm.tsx`, free, off by default). New
  `CRON_SECRET` env var (`.env.local`, git-ignored) checked as a bearer
  token against every request to the route — **still needs adding to
  Vercel's own Environment Variables** before the real schedule can
  authenticate; this sandbox has no network route to either Supabase or
  the deployed Vercel app, so that step and the live end-to-end test
  (`curl -X POST .../api/cron/tick -H "Authorization: Bearer
  $CRON_SECRET"`) both have to happen on the owner's own machine. `npx tsc
  --noEmit`/`npm run lint` clean.
  **Live, confirmed working, 2026-08-17** — supersedes the paragraph
  above. The push carrying this batch never actually deployed on Vercel
  at first: `vercel.json`'s hourly schedule is rejected outright on the
  Hobby plan, which silently failed the deployment (visible only as a
  1/2 GitHub commit-status check, no entry in the Deployments list even
  with every status filter on) — not a code bug. **Owner upgraded to
  Vercel Pro**, then an empty-commit push triggered a clean
  Ready/Production build. `CRON_SECRET` was added to Vercel's
  Environment Variables, and a manual `Invoke-WebRequest ... -Method
  POST -Headers @{Authorization="Bearer $CRON_SECRET"} -UseBasicParsing`
  from the owner's own PowerShell returned `{"ok":true,"counts":{...all
  zero...}}` — a clean run confirming auth, the service-role DB queries,
  and SMTP are all correctly wired in production (all-zero counts are
  expected outside the exact local hour a row is actually due). The
  hourly `vercel.json` schedule is now live and unattended.
  **No bounce handling or suppression list anywhere in this system** —
  flagged, not built. `nodemailer.sendMail()` only confirms the SMTP
  server accepted a message for relay, not that it was actually
  delivered, so a send to an invalid address (most of the owner's own
  test Contacts are made-up, per his own 2026-08-17 note) still marks
  `reminder_sent_at`/`overdue_notified_at` as sent and counts as success
  — harmless during personal testing, but repeated hard bounces from a
  real send volume can damage a sending domain's reputation with its own
  mailbox provider (Hostinger here) over time. Revisit before any real
  second user exists — same "flag, don't silently build" posture as
  migration 024's testing-only tier toggle above.
- **Main Screen: greyed "Description" column heading + ToDos Date/Due/Done
  columns aligned with Requests (2026-08-17).** Two-part owner request with
  pasted mockups. All three colbars (Sent/Received/ToDos) now show a plain,
  non-interactive "Description" label — 55%-opacity, matching the existing
  disabled-Done-column look — right-aligned against the sortable To/From/
  Priority label on the left (`.namecell`/`.c-desc`, `app/globals.css`).
  ToDos' colbar and rows were reworked to mirror Sent/Received's own column
  grid exactly: Priority + Date(created) + Done always show; Due shows
  additionally when the Account screen's "Show Due/Done Dates (ToDos)"
  toggle is on (`.colbar.dcols`/`.colbar.dcols.wide`, `.trd`/`.trd.wide`, same
  `1fr 58px 58px(.58px)`/`10px`-gap grid as Sent/Received, so the columns
  line up pixel-for-pixel across sections). ToDo rows changed from the old
  single-flowing-line shape to a two-line shape (a `.trd` date-value row
  above a `.r2` description line), reusing Sent/Received's existing
  `.pri`/`.dt`/`.due`/`.dn`/`.r2`/`.desc`/`.cat` classes verbatim — the
  existing overdue/done red/grey row-state CSS already applies with no new
  rules needed. The Done column header greys out (via the existing
  `ColSort` `disabled` prop) unless All or Done is selected, matching
  Sent/Received. `TodoSortKey` dropped `'category'` (no longer a header
  column — Category still shows inline on the description line when the
  Private Category toggle is on) and gained `'date'`/`'due'`/`'done'`;
  `TodoRow`/the Supabase query gained `created_at`, since the Date-created
  column is now always shown regardless of the ToDo-Dates toggle. **`.colbar.
  td`/`.t1`/`.tdc`/`.pri`/`.cat` were deliberately left untouched** in this
  batch — `ArchiveForm.tsx` independently reused these exact class names for
  its own differently-shaped ToDos display at the time; all new CSS used
  non-colliding names instead. **Superseded the same day, see the entry
  below** — Archive's ToDos view was itself rebuilt onto the new pattern a
  few hours later, once the owner asked for the two screens to match; those
  old classes are now unused by any live screen (kept in `globals.css`
  rather than deleted, in case a future screen wants the plain flowing-line
  shape). Account screen's "Show Due/Done Dates (ToDos)" checknote updated
  to the owner's own new wording, ending with "Date created and Date Done
  are always captured and shown in the ToDos list view." **No mockups
  updated** — flagged in `design/README.md`, not silently skipped. `npx tsc
  --noEmit`/`npm run lint` clean.
- **ToDos colbar black-text bug; Archive matched to Main Screen's new ToDos
  layout; both print reports redesigned; Done-band wording (2026-08-17,
  same-day follow-up to the batch above).** The new colbar modifier class
  was accidentally named `.tdd`, colliding with a pre-existing, unrelated
  `.tdd` class (`color: var(--ink)`, ToDo row description text) — equal
  specificity, later source order won, silently painting the ToDos header
  black instead of white. Renamed to `.dcols` everywhere (code and docs).
  `ArchiveForm.tsx`'s ToDos view — colbar, rows, and print — was rebuilt
  onto this same `.colbar.dcols`/`.namecell`/`.c-desc`/`.trd` pattern,
  reading `profiles.todo_dates_enabled` for the first time (added a
  `loadPrefs()` effect, matching `MainScreen.tsx`'s own), so Archive's
  ToDos header/rows are now the literal same classes as Main Screen's, not
  just visually similar. `TodoSortKey` in `ArchiveForm.tsx` extended from
  `'priority'` alone to the same four keys Main Screen uses. Both ToDos
  print reports (Main Screen and Archive) gained a Priority column on their
  own first print line (`.pcolbar.pdcols`/`.pr1.pdcols`, new `.ppri` class),
  superseding the old `.pcolbar.ptdc`/`.ptdc-nodates` shape, which never
  showed Priority at all. `TodoDetailForm.tsx`'s own single-item ToDo print
  originally kept the old, Priority-less `.ptdc`/`.ptdc-nodates` shape —
  flagged as a known gap, then closed the same day on the owner's own
  follow-up ("apply the same fix... for consistency"): its query gained
  `created_at` (a new `createdAt` state, separate from `form` since it's
  never editable — same pattern as `ownerName`/`tier`), a local
  `PRIORITY_LABEL` map was added (no shared constant existed in this file
  before), and the print block now uses the identical `.pcolbar.pdcols`/
  `.pr1.pdcols` shape the list reports use, just without a sort arrow —
  nothing to sort with one record, same reasoning `RequestDetailForm.tsx`'s
  own single-item header already established. Done-band wording ("...just
  click Save.") changed to "This ToDo is now marked as Done." in both
  `TodoDetailForm.tsx` and `CreateTodoForm.tsx` — owner: the old wording
  read like Save was still needed for the Done status itself. `npx tsc
  --noEmit`/`npm run lint` clean.
- **Response Detail and Create Request converted off raw `window.print()`
  onto the detailed print-report format (2026-08-18)** — closes the last
  three screens still doing a plain screen print instead of the
  `.print-report`/`PrintDialogList`/`PrintAttachmentList` shape every other
  print button in the app now uses. `RequestDetailForm.tsx` is the
  confirmed reference template (owner: "Request Detail uses the new
  format"). `ResponseDetailForm.tsx` — added the same print infra
  (`formatMDYSlash`, `PrintAttachmentEntry`, `PrintDialogList`/
  `PrintAttachmentList`, `printAttachments`/`showPrint`/`printTick`,
  `startPrint()`) but, unlike the owner-side screens, can't select straight
  from `attachments` (RLS is owner-only, migration 025) — uses
  `get_received_print_detail` (migration 029, already granted to
  `authenticated`, already used by `ArchiveForm.tsx`) instead, fetched
  eagerly in the existing `load()` effect; `dialogList` needed no new fetch,
  already populated from `get_received_request`'s own payload. Print uses
  `.pcolbar.detail3`/`.pr1.detail3` with "From" instead of "To"; Due/Done
  Time gated by `data.owner_request_time_enabled` (the issuer's setting,
  never this viewer's — Entitlements section above). Archive's own
  Received-type print needed **no change** — its list-level report already
  used the full detailed format (2026-08-15 redesign), and its `openDetail()`
  already routes a clicked Received row to this same `ResponseDetailForm.tsx`
  component, so both of the owner's first two list items are now covered by
  one fix. `CreateRequestForm.tsx` is a different shape of problem — nothing
  is saved yet, so `startPrint()` is synchronous (no RPC/fetch) and
  `PrintDialogList`/`PrintAttachmentList` were rebuilt locally against this
  screen's own staged `dialogEntries`/`stagedFiles` shapes, keyed by array
  index. New `.pcolbar.detail2`/`.pr1.detail2` CSS (`1fr 150px`, To/Due
  only) — an unsaved Request has no `created_at` and no Done state for
  Request Detail's Date/Done columns to show. Titled "Request Preview," not
  "Request Detail" — a naming call, not an owner instruction, flagged in the
  decisions log rather than assumed uncontroversial. `npx tsc --noEmit`/`npm
  run lint` clean.
  **Bug in this same batch, caught by the owner from real printouts, fixed
  same day**: both files' outer `<div className="app">` was missing the
  `no-print` class every other working print screen carries — without it,
  `@media print`'s `.no-print { display: none }` rule had nothing to hide,
  so the live on-screen form printed directly above the new `.print-report`
  block instead of being replaced by it. Added `no-print` to the one
  live-render `.app` in each file.
- **Real web app manifest, service worker, and a cross-window auth-sync fix
  (2026-08-18)** — traced from Android Chrome showing an "open external app
  'Would You Please'" dialog on the magic-link click, which turned out to be
  Chrome's own ad hoc install of the site (using just the page `<title>`,
  no manifest existed) rather than anything this codebase built. New
  `app/manifest.ts` (Next.js's native manifest-route convention — no manual
  `<head>` edit needed) with a real name/icon/`display: "standalone"`;
  icons (`public/icons/icon-192.png`/`icon-512.png`, rasterized from
  `public/icons/icon-source.svg`) are a recolored, recentered version of
  the existing "checked request" brandmark already used in
  `LandingPage.tsx`'s header, not a new design. New minimal
  `public/sw.js` (no offline caching — deliberately just satisfies Android's
  install-prompt criterion), registered from new
  `app/components/ServiceWorkerRegister.tsx`, mounted once in
  `app/layout.tsx`. **The actual bug**, found via live testing (tapping the
  home-screen icon showed the landing page; the magic link completed
  correctly in a regular tab): `app/page.tsx` and `RequireAuth.tsx` both
  only ever checked `getSession()`/`getUser()` once, at mount — an
  already-open standalone window sitting on the landing page had nothing
  telling it a sign-in had completed elsewhere, even though supabase-js
  already broadcasts `SIGNED_IN`/`SIGNED_OUT` across same-origin tabs/windows
  internally (confirmed against Supabase's own GitHub issues, not assumed).
  Both files gained a `supabase.auth.onAuthStateChange` subscription
  alongside their existing one-time checks. **Explicitly rejected**:
  switching from magic link to a 6-digit email OTP (raised by an AI tool the
  owner consulted) — sidesteps the symptom but is a real architecture change
  against CLAUDE.md's own magic-link-only decision, not warranted once the
  actual gap turned out to be a missing subscription, not a storage
  architecture problem. `npx tsc --noEmit`/`npm run lint` clean.
- **Findable Install control; Archive wording fix; expired magic-link
  error surfaced (2026-08-18, same-day follow-up).** `PWAProvider.tsx`
  supersedes `ServiceWorkerRegister.tsx` (renamed, never pushed) — still
  registers `public/sw.js`, and now also captures `beforeinstallprompt`
  and exposes `usePWAInstall()` (`canInstall`/`promptInstall`) to any
  descendant via context, since the owner accepted the browser's own
  one-shot install offer and then couldn't find the resulting icon
  (Android's "Install" adds to the app drawer, not the home screen — easy
  to conflate, and the browser's own prompt can't be brought back once
  used). `MainScreen.tsx`'s Housekeeping now has an "Install" row, shown
  only when `canInstall` is true. Archive's own Housekeeping row wording
  fixed to "remove completed items from the above lists" (restored a
  dropped "from"). Separately, `app/page.tsx` now parses `#error=/
  error_code=/error_description=` out of the URL hash on mount (Supabase's
  own OTP-failure redirect target — used/expired/invalid magic links land
  here, not `app/auth/callback`, with the failure silently sitting in the
  hash) and surfaces it via a new `errorMessage` prop on `LandingPage.tsx`
  (rendered as a `.noticeband`), clearing the hash afterward. Computed via
  a lazy `useState` initializer, not inside a `useEffect` that calls
  `setState` — the latter tripped `react-hooks/set-state-in-effect` on
  first pass. `npx tsc --noEmit`/`npm run lint` clean.
- **Description column heading added to every print report, centered
  (2026-08-18).** Owner: several print reports had no "Description"
  heading at all, and where present it read right-aligned against the
  Date column rather than centered between the To/From and Date columns.
  `.namecell`/`.c-desc` (2026-08-17) had only reached 3 of the app's 8
  print colbars; added to the other 5 (`MainScreen.tsx` Sent/Received,
  `ArchiveForm.tsx`'s combined Sent/Received, `CreateRequestForm.tsx`'s
  `.detail2`, `RequestDetailForm.tsx`'s `.detail3`,
  `ResponseDetailForm.tsx`'s `.detail3`), preserving each colbar's own
  sort-arrow logic where present. New print-scoped CSS,
  `.pcolbar .namecell`/`.pcolbar .c-desc` (`app/globals.css`), overrides
  the on-screen `space-between` alignment with an absolutely-centered
  label instead — scoped under `.pcolbar` so the on-screen Main Screen
  colbars this component was originally built for are unaffected. `npx
  tsc --noEmit`/`npm run lint` clean.
- **`contacts.phone_ext` — migration 034, DRAFTED, NOT YET CONFIRMED RUN**
  (2026-08-18, `docs/Week6 - SQL history.txt`). E.164 (required by any SMS
  provider, raised while scoping Request Texting) has no room for a
  post-connect extension, so it was never possible to store one inside
  `contacts.phone`. New narrow Ext. field on `AddContactForm.tsx`/
  `ContactDetailForm.tsx`, immediately after Phone in the existing
  `.phone-row`. `ContactsList.tsx`'s new `phoneWithExt()` helper appends it
  to the phone number with a single space (owner's own wording — no "ext"/
  "x" label) in both the on-screen row note and the print report's Phone
  column, per the owner's explicit instruction that this needs a database
  column but not a separate printed column. `npx tsc --noEmit`/`npm run
  lint` clean.
- **Default standalone-window size on desktop PWA launch (2026-08-18).**
  No manifest field controls a PWA's preferred launch size (confirmed via
  web.dev's own docs) — Chrome's own default opens a freshly-installed
  desktop app very wide, mostly grey letterboxing around this app's
  480px-capped content. `PWAProvider.tsx` now calls `window.resizeTo(552,
  968)` once on launch, gated on `display-mode: standalone` (no-ops on a
  normal tab and on mobile). 552×968 matches the pulled-in size the owner
  demonstrated as comfortable, not a guess. Chrome remembers the size a
  window is left at afterward, so this just does automatically what manual
  resizing already achieved. `npx tsc --noEmit`/`npm run lint` clean.
- **Fixed: raw "JWT issued at future" Supabase error rendered as Main
  Screen list content (2026-08-18).** A known, previously-documented
  Supabase-infra clock-skew symptom (an access token's `iat` validated
  against a Postgrest edge node's own clock, self-correcting on retry —
  not an app-code or device-clock issue) was surfacing as the literal
  content of all three Main Screen sections, indefinitely, since the
  one-shot load effect had no retry and nothing else in the app ever
  re-triggered it. Now retries twice (600ms/1600ms) before giving up;
  persistent failure shows a generic message plus a Try Again button
  (`reloadTick` state) instead of the raw error text. `npx tsc --noEmit`/
  `npm run lint` clean.
- **Auto-growing Description on Request Detail / ToDo Detail (2026-08-19).**
  Owner: Create Request/Create ToDo's own Description "is scrolling as
  typed, so that is not an issue," but an existing (possibly long)
  Description loaded on the two Detail/edit screens should show in full.
  Both `RequestDetailForm.tsx`/`TodoDetailForm.tsx` gained a `descRef` +
  `useEffect` keyed on `form.description` that resets the textarea's
  `.style.height` to its `scrollHeight` on every change, including the
  initial async load. New `.ftextarea-autosize` CSS (`app/globals.css`)
  disables the fixed height/scrollbar/manual resize handle that would
  otherwise fight it — applied only to these two screens' Description
  field, not the shared `.ftextarea` base rule, so Create Request/Create
  ToDo and every other textarea (Dialog Text, Notes) are unaffected. `npx
  tsc --noEmit`/`npm run lint` clean.
- **"Subscribed?" toggle locked down, private-testing style — migration 035
  DRAFTED, NOT YET CONFIRMED RUN (2026-08-19).** Owner: "We should lock
  down the subscribe., but can we do it in a way which is similar to the
  Private Testing method in place for opening a Free Account?" — followed
  by "let the user know that the status will only be in effect during the
  testing - afterward, they can 'actually' subscribe." Mirrors migration
  015's shape: `app_settings.tier_toggle_gate_enabled` +
  `tier_toggle_allowlist` (a separate table from `beta_allowlist` — signup
  eligibility and self-grant-Subscriber-for-testing are different
  permissions), seeded with the owner's own email so this doesn't lock him
  out of Attachments testing. `can_toggle_tier()`/`set_tier_for_testing
  (p_tier)` are the only permitted read/write path; migration 024's
  blanket `grant update (tier) on profiles to authenticated` — the real
  security hole — is revoked in the same migration, not left alongside the
  new gated one. `AccountForm.tsx`'s Subscribed row is now wrapped in
  `{canToggleTier && (...)}` (hidden entirely for anyone not allowed,
  rather than shown and failing on click) and `handleTierToggle` calls the
  RPC instead of a raw table update; the `checknote` copy now says the
  status "only lasts for the testing period" and real subscription comes
  later through an actual Subscription Details/eCommerce page. `npx tsc
  --noEmit`/`npm run lint` clean. **Migration 035 confirmed run by the
  owner, 2026-08-19.**
- **Archive rows gain the Dialog/Attachments icons Main Screen's own rows
  already have (2026-08-19).** Owner: "the description does not have the
  Dialog and Attachments icons shown." `ArchiveForm.tsx`'s own Sent/
  Received/ToDos queries never selected the counts those icons key off of.
  Fixed by adding `dialog(count)`/`attachments(count)` to the Sent/ToDos
  queries (Received's `get_received_requests()` RPC already returns
  `dialog_count`/`attachment_count`, migration 027 — just needed adding to
  the type) and threading them through the shared `Row` type into both row-
  JSX branches, same icon-if-count-greater-than-zero pattern as
  `MainScreen.tsx`. ToDos get Dialog only, matching Main Screen's own
  TodoRow (no attachment/Locations icon exists anywhere yet).
  `DialogIcon`/`AttachmentIcon` duplicated verbatim into `ArchiveForm.tsx`,
  per this codebase's per-file-duplication convention. `npx tsc --noEmit`/
  `npm run lint` clean.
- **Search Mode redesign — results shown within Main Screen, Date Range
  scope, Archived badge, "Search Results" notice (2026-08-19, §6.39
  PROPOSED).** Owner had been designing a separate Search Results screen and
  reconsidered: "showing results within the main screen would be more
  logical." Confirmed via design discussion (recommendation → rejected
  alternatives → open questions): Sent and Received stay in their own
  separate sections during search (they always did — search was never
  blending them); Archived items are automatically included and badged, not
  opt-in ("at this point... maybe an 'Advanced' search option can be
  offered later"); status chips are replaced by a plain "Search Results"
  notice; and the text field auto-exits search mode the instant it's
  cleared by hand. `.scope` is now a real `<select>` (All / Date Range),
  replacing the old visual-only button — Date Range swaps the text field
  for paired From/To Due Date fields (`matchesDateRange`, either side alone
  valid). `isSearching` is derived from `searchText`/`fromDate`/`toDate`,
  never a stored mode flag — this is what makes the auto-exit instruction
  fall out for free. While searching: `matchesStatusFilter` is bypassed
  entirely in `filteredSent`/`filteredReceived`/`filteredTodos` rather than
  still narrowing results; the archived-row-hidden-at-rest check now keys
  off `!isSearching` instead of `query === ''`, so Date Range searches
  surface Archived rows too; each section's `.chips` row swaps to a plain
  `.searchnotice` span; a small `.archtag` badge marks matched Archived rows
  in `.r2`, keeping them inside their normal section rather than a separate
  list; and a `.clearsearch` "Clear Search ×" control appears next to the
  field(s) as one reliable exit regardless of scope, alongside the text
  field's own inline `.fclear` × in a new `.fieldwrap` wrapper. Both call
  `clearSearch()`, resetting text/dates/scope together. `npx tsc --noEmit`/
  `npm run lint` clean. No mockup updated — none of the existing mockups
  model Search at all; flagged in `design/README.md`.
- **Search bar relocated under Housekeeping; Housekeeping hidden while
  searching; voice-search icon dropped (2026-08-19).** Owner, testing the
  above on a phone: two/three-line search bar was eating too much scroll
  space. Moved the whole `.searchbar` block (scope select, fields, Clear
  Search, Search icon) from its old fixed position beside
  `.subbanner`/`.adslot` (outside `.scroll`) into a new Search band inside
  `.scroll`, right after Housekeeping — `.subbanner`/`.adslot` stay pinned
  outside `.scroll`, per the owner's explicit instruction only Search
  itself relocates. Housekeeping is now wrapped in `{!isSearching && (...)}`
  — hidden entirely while searching. `VoiceSearchIcon()` deleted outright
  (always decorative, never wired). Each section's `isSearching` chip row
  gained a `.searchresultsrow` modifier so a second `.clearsearch` sits
  opposite "Search Results" — owner: "having Clear Search in both places is
  useful." Floating labels on the Date Range fields held off, per the
  owner's own instruction. `npx tsc --noEmit`/`npm run lint` clean. No
  mockup updated.
- **Voice dictation for Description — subscriber-gated, Create Request +
  Create ToDo (2026-08-19, §6.4x PROPOSED).** Owner: "I see it as a good
  option for entry of the Description during a Create... it could be a
  subscription option." Browser-native Web Speech API
  (`SpeechRecognition`/`webkitSpeechRecognition`) — no vendor, no per-use
  cost, unlike Request Texting's Twilio dependency — gated off the signed-in
  owner's own live `profiles.tier`, same convention as Attachments/
  Locations. Minimal local structural types stand in for the API rather than
  `any` (duplicated per component: `CreateRequestForm.tsx`,
  `CreateTodoForm.tsx` — this codebase's established per-file convention).
  `voiceSupported` is set once in a mount effect (`getSpeechRecognition()
  !== null`), deferred one microtask before calling `setState` to satisfy
  `react-hooks/set-state-in-effect` — same shape `PWAProvider.tsx`'s
  `beforeinstallprompt` listener already satisfies via a real event, just
  with a microtask standing in since there's no event here. Starts `false`
  on both server and first client render (no hydration mismatch), flips
  true after mount if the browser actually supports it — lets the feature
  be described as "available if your browser supports it (and most do)"
  rather than assumed universal (owner's own framing). `toggleDictation()`
  starts/stops a `SpeechRecognition` instance and appends finalized results
  to `form.description` via the existing `set()` helper. Mic button
  (`.descwrap`/`.micbtn`, new CSS) sits in the Description textarea's own
  bottom-right corner, shown only when `tier === 'subscriber' &&
  voiceSupported`; `--alert-red` while listening, `--ink-soft` at rest.
  Scoped to Create Request/Create ToDo only (owner's own framing, "during a
  Create") — not on Request Detail/ToDo Detail or any recipient-facing
  screen. Cross-browser QA explicitly deferred to post-Private-Testing, per
  the owner ("Let's test for browser-support later"). `npx tsc --noEmit`/
  `npm run lint` clean. No mockup updated — neither source mockup has
  interactive Description JS to add a mic button to.
- **Reminder checkbox extended to Request Detail (relocated), Response
  Detail, and Request Response — migration 036 confirmed run by the owner
  2026-08-19.** Owner's own new design (three pasted screenshots),
  resolved via two AskUserQuestion calls before building: Request Detail's
  new top-band Reminder control **replaces** its old standalone
  bottom-of-form one (built 2026-08-15) rather than both coexisting, and
  every new control uses the existing **plain checked = on**
  `.checkrow`/`.checktext`/`.checknote` component and wording, not the
  mockup's own inverted "Turn off Reminders (Check and Send)" semantics.
  Migration 036 adds `reminder_enabled` to the two jsonb-returning read
  functions (`get_request_by_token`, `get_received_request`) and a new
  trailing `p_reminder_enabled boolean default null` parameter to both
  write functions (`set_response_done_by_token`,
  `set_response_done_as_recipient`), coalesced against the existing column
  so an unpassed value leaves it untouched. `RequestDetailForm.tsx`'s
  checkbox moved to right after its Date/Recipient `.metarow`;
  `ResponseDetailForm.tsx` and `RequestResponseForm.tsx` (the anonymous
  `/r/[token]` path) both gained the identical control for the first time,
  right after their own `.meta` block — every placement is its own
  full-width row below the metarow/meta block, never beside it, per the
  2026-08-10 `.metatop`/`.metacol` word-wrap precedent. `npx tsc --noEmit`/
  `npm run lint` clean. No mockup updated — none of the three source
  mockups (Request Detail, Response Detail, Respond to Request) draw this
  control.
- **Reminder-related email link text changed from generic "Request
  Detail"/"ToDo Detail" to action-oriented wording (2026-08-19)** — owner's
  own spam-risk concern. `buildOverdueRecipientEmailHtml`/`Text` and the
  two Requestor-facing digest row builders (`digestRowHtml`/`Text`), all of
  which link to the recipient's own `/r/[token]` response screen, now use
  "Open Request to mark Done or to turn off notifications" (owner's
  suggested wording, used verbatim). `buildTodoReminderEmailHtml`/`Text`,
  which links to the owner's own ToDo Detail (no per-ToDo Reminder toggle
  exists), uses the narrower "Open ToDo to mark Done" instead. The Sent
  Request's own day-before Reminder to its Recipient was already excluded
  — it reuses the Initial Request template's own link text ("Click to
  respond or mark as completed"), redesigned separately 2026-08-16. `npx
  tsc --noEmit`/`npm run lint` clean.
- **Reminder checkbox greyed out for archived Requests (2026-08-19)** —
  `RequestDetailForm.tsx`/`ResponseDetailForm.tsx` now disable the Reminder
  checkbox (and grey its text via the existing `.checkrow-disabled`) when
  the request is archived, gated on the already-fetched `archivedAt`/
  `receivedArchivedAt` columns rather than a new "came from Archive"
  navigation flag — covers every path that reaches an archived Request's
  Detail screen, not just a literal click from Archive's own list. `npx tsc
  --noEmit`/`npm run lint` clean.
- **Description auto-grow fixed with `field-sizing: content` (2026-08-19)**
  — owner reported Request Detail's Description was still a fixed-height
  scrolling box despite the auto-grow feature already being shipped;
  confirmed via git + the Vercel MCP that production was serving the exact
  latest commit, ruling out a stale deploy. Added `field-sizing: content` to
  `.ftextarea.ftextarea-autosize` (`app/globals.css`) as a belt-and-suspenders
  fix — this CSS property overrides any specified height, including one set
  via JS (`.style.height`), so it wins regardless of whatever was wrong with
  the existing `descRef` effect. Covers both Request Detail and ToDo Detail
  in one shot, since both already share the class.
- **Request Response Cancel removed + banner wording; Close/Cancel dynamic
  label on Detail screens; voice dictation extended to Detail Descriptions
  and all Dialog Text; Archived badge/search-text visibility bump
  (2026-08-20)** — see the decisions log's 2026-08-20 entry for the full
  write-up. Summary: `RequestResponseForm.tsx` no longer has a Cancel
  button (owner: it had no useful purpose, and he kept clicking it trying
  to close the tab); its post-Send banner now reads "Response sent." not
  "Response saved." `RequestDetailForm.tsx`/`ResponseDetailForm.tsx`/
  `TodoDetailForm.tsx` now show **Close** at rest and only switch to
  **Cancel** once real form-data changes have been made (a `useRef`
  snapshot taken at load time, deliberately excluding Dialog/Attachments/
  Locations, which already save independently of Cancel). Voice dictation
  (Web Speech API, same pattern as the Create screens' own 2026-08-19
  build) is now on Request Detail's and ToDo Detail's own Description
  field, and on Dialog Text everywhere it appears across all six
  Request/ToDo screens — gated on the signed-in owner's own `tier` on the
  four owner-side screens, and on `data.owner_tier === 'subscriber'` (the
  Request's own issuer, never the viewer) on the two recipient-facing
  screens, per the Entitlements rule above. `.archtag`/`.clearsearch`/
  `.searchnotice` got a pure font-size/contrast bump — the underlying
  Search-mode logic was already correct, just too subtle to notice. `npx
  tsc --noEmit`/`npm run lint` clean across the whole batch.
- **"Reminders until Done" banner — single Reminder checkbox replaced by
  two, plus a new Overdue-notification opt-out — migration 037 confirmed
  run by the owner 2026-08-20.** Owner's own mockups (Create Request,
  Response Detail): a "Reminders until Done" box holding "Morning before"
  (the existing day-before Reminder, `reminder_enabled`, migration 031/036,
  unchanged rules) and a new "Daily thereafter" (`overdue_reminder_enabled`,
  default `true` — behavior-preserving, since the automatic Overdue cron
  system built 2026-08-17 has been unconditional since then). Confirmed via
  `AskUserQuestion`: unchecking "Daily thereafter" stops the Recipient's
  Overdue emails **entirely**, including the first transition notice, not
  just the recurring nudges after it — `app/api/cron/tick/route.ts`'s Phase
  B and Phase C both gate on the new column, still advancing the state
  machine (`overdue_notified_at`/`last_overdue_nudge_at`) so the row doesn't
  get retried, just skipping the actual send. The owner's own described
  Overdue cadence (hour-after-Due-Time first nudge, not hourly all day —
  spam-risk concern; daily thereafter; no notice during a Due-Date-only
  Request's own Due Date) turned out to already match the shipped cron
  logic exactly — no cadence code changed, only the new opt-out. New
  `.reminderbanner`/`.reminderitem` CSS (§6.41 PROPOSED) — one flex-wrap
  container holding two `inline-flex`/`white-space:nowrap` items, satisfying
  the owner's explicit "wrap the checkbox and its label together" rule
  through CSS alone, no separate narrow/wide markup variants. "Morning
  before" gained a second, independent grey-out condition — `reminder_
  sent_at` (newly exposed by migration 037 on the two recipient-facing read
  functions) is not null — layered on the existing eligibility/archived
  checks; "Daily thereafter" has no eligibility gate of its own anywhere.
  Built on all four Request-facing screens (Create Request, Request Detail,
  Response Detail, Request Response); Request Detail's and Response
  Detail's existing Close/Cancel dirty-check snapshots extended to include
  the new field. See the decisions log's 2026-08-20 entry for the full
  write-up. `npx tsc --noEmit` clean; `npm run lint` not yet re-run for this
  specific batch.
- **Repeat (recurrence) for Requests and ToDos, built end to end
  (2026-08-21) — migrations 038/039/040 (`docs/Week6 - SQL history.txt`:
  `requests.repeat_rule jsonb`, `requests.repeat_next_generated_at`,
  `attachments.carry_into_repeats`, plus the read-function updates) all
  CONFIRMED RUN by the owner 2026-08-21.**
  Owner's own design doc (`WYP Repeat design.docx`), refined through a
  round of clarifying questions before any code was written; see the
  decisions log's 2026-08-21 entry for the full write-up, this is a
  summary. **Due Date, never Done Date, determines generation** — an
  incomplete Request/ToDo still spawns its next occurrence on schedule,
  per the owner's own explicit correction. Generation happens in a new
  cron Phase E (`app/api/cron/tick/route.ts`), firing once at the owner's
  own local midnight on the calendar day matching the row's `due_date`,
  distinct from Phase B/C's day-after Overdue trigger. No series table —
  each generated row is an ordinary `requests` row linked only by
  `repeat_occurrence_index` (1-based, original = 1); `describeRepeat(rule,
  dueDate)` in `app/src/lib/repeatRule.ts` is the one function every
  consumer (band, recipient footnote, print line) calls, joining clauses
  with a comma + non-breaking space so word-wrap can only happen between
  phrases, never mid-phrase — the owner's own explicit rule. Shared
  `RepeatControl` component (`app/components/RepeatControl.tsx`) wired
  into Create Request, Request Detail, Create ToDo, and ToDo Detail —
  gated `tier === 'subscriber'` and **hidden entirely** when not (not
  `.is-locked`, unlike Attachments — owner's explicit distinction), and on
  ToDo screens additionally gated on `todo_dates_enabled`. Mid-series edits
  are forward-only by construction — each row's `repeat_rule` is its own
  independent copy, not a pointer to a shared definition — and Request
  Detail/ToDo Detail both gained a Remove option. A carry-forward prompt
  ("Dialogs are not included with Request Repeats, Attachments can be.
  Please select any Attachments to use for Repeated Requests." — owner's
  wording verbatim) appears at Send/Save on Create Request/Create ToDo
  when a Repeat is set and staged Attachments/Locations exist; a real
  `kind='file'` attachment carried forward gets a **duplicated** Storage
  object per generated occurrence, not a shared reference. Recipient-facing
  display (Request Response, Response Detail) is read-only: a `.repeatmark`
  asterisk beside the Due Date/Time value, with the actual descriptive text
  moved to a footnote at the very bottom of the form — **owner's own
  mid-build correction**, originally placed above Dialog. Print Reports
  gained a "Repeats: ..." line preceding Dialog on every screen that prints
  Sent/Received/ToDo detail (Create Request's preview, Request Detail,
  Response Detail, Main Screen's three sections, Archive's three sections)
  — the Received-side report needed its own migration (040) since
  `get_received_requests()` is `RETURNS TABLE` and required the established
  drop-then-recreate pattern (migrations 017/021/027 precedent), unlike the
  two jsonb-returning functions migration 039 touches with a plain
  create-or-replace. **No mockup reflects any of this** — every screen
  above was built directly in its live component; see `design/README.md`
  §6.42/§6.43 for the flagged gap. `npx tsc --noEmit` clean through every
  file in this batch; `npm run lint` not yet run for this batch as of this
  entry.
- **Branded HTML emails (2026-08-22)** — `app/src/lib/email.ts` gained a
  shared `wrapEmailHtml()`/`emailButton()` pair; all six HTML email builders
  now render inside a brand-blue-header/white-body branded shell instead of
  bare `<p>` tags, with their one primary link styled as a filled button.
  New `public/email/wyp-logo-horizontal-dark.png` (+ `.svg` source),
  rasterized from the canonical `wyp_logo_horizontal_dark_bg.svg` markup
  already on file in the Project's own asset docs. The existing
  `multipart/alternative` text fallback (every builder already had a paired
  HTML/text version) is unchanged — confirmed with the owner it's still
  worth keeping for deliverability, not something the new branding replaces.
  See the decisions log's 2026-08-22 entry for the full write-up, including
  the header-style choice confirmed via `AskUserQuestion`. `npx tsc
  --noEmit`/`npm run lint` clean.
- **Branded emails, same-day redesign (2026-08-22)** — from Jim's own
  screenshots of the deployed result. Root-caused the broken logo: the bare
  apex `wouldyouplease.com` 308-redirects to `www.wouldyouplease.com` at
  the Vercel domain level (confirmed via the Vercel MCP's
  `web_fetch_vercel_url`, not guessed at), which a hotlinked `<img src>`
  doesn't reliably survive in Outlook Web even though a clicked link does.
  Fixed narrowly with `emailAssetUrl()` normalizing just the logo URL's
  host to `www` when `siteUrl`'s hostname is the bare apex — **the real,
  more complete fix is still open**: either `NEXT_PUBLIC_SITE_URL` itself
  or Vercel's own canonical-domain Setting, both outside this codebase,
  flagged for Jim rather than changed unprompted. Also widened
  `wrapEmailHtml()`'s card from 600px/centered to 1200px/left-aligned,
  switched its body background to Strip (`#E5ECF7`), added
  `emailDescriptionBox()` (a white highlight box around the Description
  text, three templates), and replaced the old inline signup sentence with
  `emailSignupFooter()` (a standalone Blue-Pressed `#1E4AA0` question plus
  its own button, two templates). See the decisions log's second
  2026-08-22 entry. `npx tsc --noEmit`/`npm run lint` clean.
- **Five itemized fixes from Jim's uploaded doc (2026-08-22) — migration 041
  DRAFTED, NOT YET CONFIRMED RUN.** `addl items as of 8-22-26.docx`: (1) Add
  Location converted from an inline box to a real modal, matching Add
  Dialog's `.scrim`/`.modal` pattern — `CreateTodoForm.tsx` (staged) and
  `AttachmentsPanel.tsx` (live-insert, used by ToDo Detail/Response
  Detail/Request Response/Request Detail) — fixes a real bug where a typed
  Location could be silently discarded on navigation without Save. (2)
  Create Request's Reminder "Morning before" checkbox no longer requires a
  Contact when Due Date alone is 4+ days out — new
  `hasAmpleReminderLeadTime()`/`MIN_DAYS_TO_SKIP_CONTACT_CHECK = 4`
  (`app/src/lib/email.ts`), separate from the existing 3-day
  `isReminderEligible()`; Request Detail unaffected (Recipient is already
  fixed there). (3) "Daily thereafter" greys out once a Request is marked
  Done — Request Detail, Response Detail, Request Response (not Create
  Request, which can't yet be Done). (4) Main Screen search no longer
  matches a hidden Category name or a ToDo's Due Date when the
  corresponding Account toggle (`private_category_enabled`/
  `todo_dates_enabled`) is off — `filteredTodos` in `MainScreen.tsx`; Sent/
  Received needed no change, neither ever matched Category text. (5) **New
  ToDo Reminders feature** — `profiles.todo_reminders_enabled` (migration
  041) gates a new Account toggle ("Add Reminders (ToDos)," greyed out
  until Show Due/Done Dates (ToDos) is on) and a `todoReminderBanner()` on
  Create ToDo/ToDo Detail, reusing the existing `.reminderbanner` CSS
  as-is — no new per-ToDo columns needed, since `reminder_enabled`/
  `overdue_reminder_enabled`/`reminder_sent_at`/`overdue_notified_at`/
  `last_overdue_nudge_at` already exist on the shared `requests` table.
  **Scope judgment call, flagged for Jim's review**: "Daily thereafter"
  implied ToDos needed a real recurring Overdue-nudge mechanism, which
  didn't exist before (only a one-time day-before Reminder did) — built as
  a genuine new cron Phase A3 in `app/api/cron/tick/route.ts` (daily-only
  cadence, no hourly branch since ToDos have no `due_time`), new
  `buildTodoOverdueEmailSubject/Html/Text` templates in `email.ts`, new
  `counts.todoOverdueNotices`/`todoOverdueNudges`. If Jim only wanted the
  checkbox with no send behind it yet, this is the piece to walk back.
  **No mockups updated for any of the five items** — flagged in
  `design/README.md`. `npx tsc --noEmit`/`npm run lint` clean. See the
  decisions log's 2026-08-22 entry for the full write-up.
- **"Day of" Reminder — third Reminders-until-Done checkbox, "Morning
  before" renamed "Day before", spam-conscious default flip — migration
  042 confirmed run by Jim, 2026-08-22.** New, fully independent third
  checkbox (`reminder_day_of_enabled`/`reminder_day_of_sent_at`) alongside
  "Day before" (`reminder_enabled`) and "Daily thereafter"
  (`overdue_reminder_enabled`) on all six Reminders-until-Done screens
  (Create Request, Request Detail, Response Detail, Request Response,
  Create ToDo, ToDo Detail) — same-day send, no lead-time floor (unlike
  "Day before"'s 3-day `isReminderEligible` minimum), Contact still
  required on Create Request regardless of Due Date lead time (unlike
  "Day before"'s `hasAmpleReminderLeadTime` waiver — short-lead-time
  zone shifts matter more for a same-day send, not less). New cron
  Phases A1b (Request, Recipient's own zone) and A2b (ToDo, owner's own
  zone) in `app/api/cron/tick/route.ts`, deliberately not touching Phase
  B/C or the existing ToDo Overdue Phase A3. **Default flipped, per
  Jim's own spam-risk instruction, applying to both Requests and
  ToDos**: "Day of" defaults unchecked; "Daily thereafter" — checked by
  default since migration 037 — now also defaults to unchecked for newly
  inserted rows only (`alter column ... set default false`, existing
  rows unaffected). **Genuinely unresolved**: Jim's opening message also
  suggested "Day of" should connect to the lapsed-Due-Time Overdue
  notice ("Reminder/Overdue are close in meaning") — a clarifying
  question was interrupted before he could answer and he stepped away;
  built as fully independent of Overdue/"Daily thereafter" in the
  meantime, flagged in both new cron phases' own comments for revisit.
  **Real pre-existing bug found and fixed in the same migration pass**:
  `reminder_sent_at` was read by `ResponseDetailForm.tsx`/
  `RequestResponseForm.tsx` since 2026-08-20 but was never actually
  added to `get_request_by_token`'s or `get_received_request`'s jsonb
  payload in any migration — `payload.reminder_sent_at` was always
  `undefined` at runtime, and `undefined !== null` is `true` in JS, so
  "Day before" has been permanently disabled/greyed-out on both
  recipient-facing screens since that feature shipped. Fixed in
  migration 042 alongside the new columns. **No mockups updated** — none
  of the six screens' static HTML models the Reminders-until-Done banner
  at all. `npx tsc --noEmit`/`npm run lint` clean. See the decisions
  log's 2026-08-22 entry for the full write-up.
- **Initial Request email's reminder sentence rewritten to describe the
  full Reminders-until-Done schedule, 2026-08-22 (third same-day
  follow-up)** — resolves the "Blocked" item this same section flagged
  above. New `buildReminderScheduleSentence(dueDate, dueTime, schedule)`
  in `app/src/lib/email.ts` replaces the old fixed
  `requestReminderSentence()`, covering all 8 combinations of the three
  Reminders-until-Done checkboxes per Jim's own literal structure: none
  ("...no Reminders."), one ("...Reminders only on the day before." /
  "...only on the day of." / "...only daily thereafter."), two
  ("...Reminders: `<A>` and `<B>`."), and all three ("...Reminders: the
  day before, the day of, and daily thereafter."). `RequestEmailBodyFields`'s
  old boolean `reminderPromised` is now `reminderSchedule?:
  ReminderSchedule | null` — `null`/omitted skips the sentence entirely
  (used by the actual day-before/day-of Reminder emails themselves,
  Phases A1/A1b in `app/api/cron/tick/route.ts`, which don't restate the
  schedule inside a reminder that's already part of it); a real
  `ReminderSchedule` always renders a sentence, including the "no
  Reminders" case, since only the Initial Request email
  (`app/api/email/send-request/route.ts`) currently supplies one.
  "Day before" is still gated on `isReminderEligible` (unchanged from
  before this batch) so a checkbox left checked-but-greyed after a Due
  Date edit isn't reported as active; "Day of" and "Daily thereafter"
  have no eligibility floor and are reported as their stored values
  directly. `app/src/lib/ics.ts`'s `buildIcsDescription` now imports and
  calls `buildReminderScheduleSentence` directly instead of carrying a
  second, separately-maintained copy of the same branching logic — this
  also removed `ics.ts`'s own now-unused local `formatMDY`/
  `formatTime12h` copies. Verified the full 8-combination output against
  Jim's literal quoted examples with a standalone script before shipping.
  `npx tsc --noEmit`/`npm run lint` clean. See the decisions log's
  2026-08-22 entry for the full write-up.
- **"Daily thereafter" replaced by a single one-time "Day after" notice
  (Requests and ToDos); Account-level Reminder defaults — migration 043
  confirmed run by Jim, 2026-08-22 (same day, fourth
  follow-up).** Jim, citing spam-complaint risk with no way to measure
  it: "The 'Daily thereafter' should be replaced by the 'Day after'...
  The same three Reminder options should be available for ToDos — and
  send the reminder to the Account holder. One Account option (or 3
  options) could be the default settings of the three checkboxes for
  Reminders (for both Requests and ToDos). I expect there will be other
  reasons for cron functionality in the app... so I wouldn't encourage
  dropping the underlying structure." Superseded an earlier, more
  complex two-gate "Send Day-of Reminders" account-toggle-as-kill-switch
  concept (synthesized and mocked up via the visualize tool, then
  explicitly rejected by Jim as too confusing for end users) — the
  shipped design is pre-fill-only defaults, never a live send-time gate.
  `cron/tick/route.ts`'s old Phase B (Request Overdue transition) and
  Phase C (recurring hourly/daily nudges) are collapsed into one
  simplified Phase B: a single "Day after" send, gated on
  `overdue_reminder_enabled` (column reused in place, not renamed),
  idempotent on `overdue_notified_at` alone — no catch-up if the
  checkbox is toggled after its own eligible day has passed. ToDo Phase
  A3 gets the identical single-shot treatment (new capability for
  ToDos, previously recurring-only). **Timing for Requests' "Day after"
  switched from the owner's own zone to the Recipient's own zone**, for
  consistency with "Day before"/"Day of" (both already Recipient-facing)
  — a reasoned change, not explicitly confirmed with Jim, flagged in the
  route's own header comment. `last_overdue_nudge_at` (migration 032)
  and `hoursSinceLocalDateTime` (`app/src/lib/cronTime.ts`) are now
  unused by this route — left in place per Jim's own "don't drop the
  underlying structure" instruction, not deleted. **Migration 043** adds
  `profiles.reminder_default_day_before`/`day_of`/`day_after` (booleans,
  defaults true/false/false — matching the existing per-item checkbox
  defaults), each with the standard per-column `grant update` to
  `authenticated`; read once by Create Request/Create ToDo on mount to
  pre-fill their own Reminders-until-Done checkboxes, never touching an
  already-created Request or ToDo. Applied across all six
  Reminders-until-Done screens (Create Request, Request Detail, Response
  Detail, Request Response, Create ToDo, ToDo Detail — "Daily
  thereafter" → "Day after" everywhere it appeared as a live label, with
  historical "renamed from" references left in place for context),
  `email.ts` (`ReminderSchedule.dailyThereafter` → `dayAfter`,
  `buildReminderScheduleSentence` simplified to a uniform "on the day
  ___" phrasing for all three types), `send-request/route.ts`,
  `globals.css`'s `.reminderbanner` doc comment, and `AccountForm.tsx`
  (three new toggles added after "Notify Me When Reminders Are Sent,"
  before the testing-only Subscribed toggle). **No mockups updated** —
  none of the six screens' static HTML models the Reminders-until-Done
  banner at all; flagged in `design/README.md`, not silently skipped.
  `npx tsc --noEmit`/`npm run lint` clean. See the decisions log's
  2026-08-22 entry for the full write-up.
- **Manual "Send Reminder" button on Request Detail, built (2026-08-22, same
  conversation as the "Day after" batch above) — §6.44 PROPOSED, no mockup.**
  Closes the item flagged as "still open" immediately above. Jim: "It will
  not fit on my phone as I suggested it to the right of the Date and
  Recipient. It could go after or before the Reminders in its own
  section/panel. The overdue Due Date in red would be a nice touch." New
  `app/api/email/send-reminder/route.ts` — same posture as
  `send-request/route.ts` (anon key + forwarded JWT, not service_role, since
  this is triggered by the signed-in owner from the browser, unlike the cron
  route) — reuses the exact Overdue notice template
  (`buildOverdueRecipientEmailSubject/Html/Text`) the automatic "Day after"
  send already uses, but deliberately does **not** touch
  `overdue_notified_at`: a manual send is independent of the automated
  system's own one-shot idempotency marker by design, so it can be clicked
  regardless of that state and never suppresses or fast-forwards it.
  `RequestDetailForm.tsx` gained `isOverdue` (same calendar-date-only
  comparison as every other overdue treatment in the app — `due_date <
  todayIso()`, Done/archived excluded) driving two things: a new
  `.finput.overdue-date` class (`color: var(--alert-red)`, `globals.css`)
  applied to both Due Date `<input type="date">` occurrences (with and
  without Due/Done Time enabled), and a new `sendReminderPanel()` — reusing
  `.donerow`/`.donenote` (no new CSS shape needed) — rendered directly after
  `{reminderBanner()}` and only while overdue. `handleSendReminder()` mints
  a fresh response-link token via the existing owner-only `issue_request_link`
  RPC (migration 008, same call `CreateRequestForm.tsx`'s own automatic
  Initial-email flow already makes), then POSTs it to the new route; result
  surfaces inline in the panel (success text, or red failure text — no
  separate `.ferror` markup, just an inline style override on `.donenote`).
  The route re-validates server-side (not Done, not archived) rather than
  trusting the button's own client-side gating. `npx tsc --noEmit`/`npm run
  lint` clean.
- **Account restructured into four collapsible sections; Request/ToDo
  Reminder defaults split; new "Show Reminders" and "Always show Send
  Reminder button" toggles; Close/Cancel bug fixed on Response Detail —
  migration 044 DRAFTED, NOT YET CONFIRMED RUN (2026-08-23).** Jim, with his
  own mockup screenshot: "I think it would be useful to allow separately
  specified reminder options for Requests and ToDos, e.g., I prefer to send
  out Requests with a day before reminder and ToDos are best for me with a
  day of reminder. This brings up the possibility of an unwieldy list of
  options in the Account screen. So, I have created a mockup of how these
  options can be presented within respective sections with show/hide chips
  (the default Account presentation per session should be Open for General
  Options and Hide for all other options... during a session, the Open/Hide
  status should remain as last-used." Plus a new "Always show Send Reminder
  button" toggle, several wording changes, a shortened Send Reminder panel
  description, and a separate bug report: after a signed-in recipient sets
  Done Date and Send on Response Detail, the confirmation banner already
  says "Response saved," but the buttons still read Send/Cancel — should be
  Send/Close. Three genuine ambiguities were asked and resolved directly in
  chat (not via the AskUserQuestion widget — Jim: "If I see and then move
  off of this UI before answering a question, the question disappears," so
  this one was asked and answered in plain text instead): the new "Show
  Reminders" toggle gates standalone, not conditioned on any other setting;
  the mockup's own checkbox states were a snapshot of Jim's live account,
  not a specification of new defaults, so both new columns' actual defaults
  were left to engineering judgment (flagged below); and the new toggle also
  hides the Reminders-until-Done banner on both recipient-facing screens
  (Response Detail, Request Response), per this file's own Entitlements
  rule that rights on a Request come from its issuer, never its viewer.
  `AccountForm.tsx` rebuilt around four `.subcard` sections (General/
  Request/ToDo/Subscriber Options, reusing Main Screen's existing
  `.subcard`/`.subhead`/`.chips`/`.chip` components verbatim, new
  `.subhead.acct-head` CSS modifier for the title-left/chips-right single
  row) with Show/Hide chips persisted to `sessionStorage`
  (`wyp.acctGeneralOpen`/`RequestOpen`/`TodoOpen`/`SubscriberOpen` — General
  defaults open, the other three default hidden), a session-only scope
  deliberately not promoted to a `profiles` column, since Jim's own wording
  was "per session," unlike Main Screen's own cross-session
  `main_chip_prefs` (migration 016). **Migration 044** adds 8 new
  `profiles` columns: `request_reminders_enabled boolean not null default
  true` (new standalone master toggle, Request Options section — hides the
  Reminders-until-Done banner on Create Request/Request Detail and, via a
  new `owner_request_reminders_enabled` field added to both
  `get_request_by_token`/`get_received_request`, on Request Response/
  Response Detail too), `always_show_send_reminder boolean not null default
  false` (Request Detail's §6.44 Send Reminder panel shows unconditionally
  instead of only-when-overdue), and two new split triplets —
  `request_reminder_default_day_before/day_of/day_after` and
  `todo_reminder_default_day_before/day_of/day_after` (same true/false/false
  defaults as before) — replacing migration 043's single shared
  `reminder_default_day_before/day_of/day_after` trio outright: backfilled
  into both new triplets, then dropped from the table entirely, since
  nothing reads it anymore (unlike `last_overdue_nudge_at`'s own deliberate
  "kept per Jim's don't-drop-structure instruction" precedent — this case
  has zero remaining readers, not preserved-for-later infrastructure).
  **Two default values are my own engineering judgment, not confirmed by
  Jim** — both chosen to preserve today's already-live behavior rather than
  change anything: `request_reminders_enabled` defaults `true` (reminders
  keep showing for every existing account) and `always_show_send_reminder`
  defaults `false` (the button stays only-when-overdue). Flagged for Jim's
  review once migration 044 is run. `CreateRequestForm.tsx`/
  `RequestDetailForm.tsx` read the new master toggle and gate their own
  `reminderBanner()` call sites on it; `RequestDetailForm.tsx` also reads
  `always_show_send_reminder` to change `sendReminderPanel()`'s render
  condition from `isOverdue` alone to `isOverdue || alwaysShowSendReminder`,
  and its panel text is now Jim's own shortened wording verbatim: "This
  action is unrelated to the Reminder schedule above." `CreateRequestForm.tsx`/
  `CreateTodoForm.tsx` now read the new split default columns
  (`request_reminder_default_*` / `todo_reminder_default_*` respectively)
  instead of the old shared trio to pre-fill their own Reminders-until-Done
  checkboxes — an existing Request or ToDo's own already-stored checkbox
  values are never touched by this change, matching Jim's own understanding
  ("changing the default settings only applies to newly-created items").
  `app/api/cron/tick/route.ts`'s Phase A1 (Request day-before), Phase A1b
  (Request day-of), and Phase B (Request day-after) are now each
  additionally AND-gated on `request_reminders_enabled === false` (profile
  read, defaulting to enabled if the column is somehow missing — mirrors the
  `coalesce(..., true)` convention the SQL functions already use) — this is
  the same double-gate pattern `todo_reminders_enabled` already established
  for ToDos (the account flag only ever hides the *UI banner*; the per-item
  checkbox is still submitted/stored regardless; the real safety net is this
  cron-time AND-gate). `ResponseDetailForm.tsx`'s Close/Cancel bug fixed:
  the button's label logic gained `sendConfirmed ||` ahead of the existing
  `!hasChanges` check, since `hasChanges` alone never resets after a
  successful Send (its dirty-check snapshot is taken once at load, not
  re-taken post-Send) — a Response with, say, a changed Done Date kept
  reading "Cancel" even after that change was already saved, with nothing
  left to actually cancel. **No mockups updated** — none of the six
  Reminders-until-Done screens' static HTML models the banner at all
  (unchanged from every earlier entry in this family), and `AccountForm.tsx`
  itself has never had a mockup of its own; flagged in `design/README.md`.
  `npx tsc --noEmit`/`npm run lint` clean. See the decisions log's
  2026-08-23 entry for the full write-up.
- **"Account" renamed to "Account Options" (Housekeeping row + band title);
  four Account section headers dropped their own " Options" suffix
  (2026-08-24).** Jim: "please change both the Housekeeping task 'Account'
  title and the page title to 'Account Options' and then drop the word
  ' Options' on each of the sections." `MainScreen.tsx`'s Housekeeping row
  and `AccountForm.tsx`'s band title now read "Account Options"; the four
  `sectionHead()` calls (General/Request/ToDo/Subscriber) dropped "Options"
  from their own labels, unchanged otherwise — `sectionHead()` itself needed
  no change, it was already a pass-through. Logged as a same-day follow-up
  in the decisions log's existing 2026-08-23 Account-restructure entry
  rather than a new one, since it's a pure wording correction to that same
  batch. `npx tsc --noEmit`/`npm run lint` clean.
- **Description column heading becomes Category (sortable) or disappears,
  depending on Private Category; Category now shown on Sent rows too;
  print reports match; Done-row print-heading bold+grey CSS bug fixed
  (2026-08-24).** Jim: "On the main screen and on the Archive screen, for
  Requests Sent and for ToDos, replace the column heading of 'Description'
  (when Private Categories are shown per Account Options) with Category
  (including it being a sort option). For Requests Sent and for ToDos,
  remove the column heading of 'Description' (when Private Categories are
  not shown per Account Options). For Requests Received, for consistency
  remove the column heading of 'Description'. Apply these same changes to
  the printed reports... Another printed reports tweak, for items marked as
  Done, the Dialog and Locations (and I presume Attachments) headings are
  not bolded in the grey font... When Private Categories are shown... the
  only place the Category is currently displayed... is on the main screen
  for ToDos, it should also be displayed on the main screen Requests Sent
  (and Category should similarly be displayed for Archive and for printed
  reports for Requests Sent and for ToDos)." Applied identically to
  `MainScreen.tsx` and `ArchiveForm.tsx`: the `.namecell`/`.c-desc` pair
  that used to hold a static "Description" span now holds either a
  sortable Category `ColSort` button (Sent/ToDos, gated
  `private_category_enabled`) or nothing at all — Received's own colbar
  drops the heading unconditionally, since Received never shows Category
  (PRD §2.3) and a heading with nothing under it read as inconsistent
  either way. Sent rows gained the same `.cat`/em-dash prefix ToDos'
  description line already had. `MainScreen.tsx` split its Sent/ToDo sort-key
  types (`SentSortKey`/`TodoSortKey` each gained `'category'`; Received's
  own `ReqSortKey` deliberately did not, so Received can never sort by a
  column it doesn't show) — `ArchiveForm.tsx` instead added `'category'` to
  its one shared `ReqSortKey` (Sent and Received already share one sort
  state/switch there), relying on the colbar simply never rendering a
  Category button for Received to keep the key practically unreachable from
  that side; flagged in both files' own code comments so the asymmetry
  reads as deliberate, not inconsistent. Print colbars/rows in both files
  got the identical heading and `categoryPrefix()`-prefix treatment (a
  `[Category] ` prefix on the description line, matching the existing
  Repeat-line/other print conventions) — `MainScreen.tsx` already had
  `categoryPrefix()` calls on its Sent/ToDos print rows from the 2026-08-15
  batch; `ArchiveForm.tsx` needed the helper built from scratch. **New
  secondary-sort rule, same day**: "For columnar sorting, if To, From, or
  Category is selected - secondarily sort the output by descending Due Date
  (except for ToDos if Due Dates are not shown - then for ToDos secondarily
  sort by descending Date)." New `compareDueDesc()` (always descending,
  independent of the primary column's own direction) in both files,
  consulted only as a tie-break when the primary comparator returns 0, for
  the `name` (To/From) and `category` keys — never `date`/`due`/`done` or
  ToDos' `priority`, which already carry their own meaningful order.
  **Print CSS bug, same day**: `.prow.done .pdlghead`/`.patthead` (the
  Dialog/Locations/Attachments section headings on a printed Done row) were
  losing their base `font-weight: 700` to a later, more-specific
  `.prow.done { ...; font-weight: 500 }` rule that also covers several
  other classes at once — `.pdlgkind` (each Dialog entry's own
  Question/Answer/Comment label) was never swept into that shared rule and
  so kept its own bold weight while inheriting the row's grey color,
  producing exactly the bold+grey Jim described wanting for the section
  headings too. Fixed with a more-specific override rule immediately after
  the existing one in `app/globals.css`. **A tool-call was rejected
  mid-batch** ("STOP what you are doing and wait for the user to tell you
  how to proceed") after the first `ArchiveForm.tsx` edit — work paused
  immediately and only resumed once Jim explicitly said "Yes" to a direct
  question about continuing. **No mockups updated** — none of the affected
  screens' static HTML has interactive Category-column JS to convert;
  flagged in `design/README.md`. `npx tsc --noEmit`/`npm run lint` clean.
- **Spam-folder investigation for the sign-in email; small in-app note
  added (2026-08-24).** Jim reported a tester's sign-in email landed in
  spam and ran MXToolbox against wouldyouplease.com, which came back clean
  aside from a Tor-exit-node entry MXToolbox itself scores "Ignore." A
  Google AI conversation he consulted recommended migrating off Hostinger
  SMTP, on the mistaken assumption WYP sends mail directly from client-side
  React with a hardcoded password and that Vercel's own IP reputation is
  what the recipient sees — neither is true here (every email route is
  server-side, `EMAIL_SMTP_PASSWORD` never leaves Vercel's environment
  variables, and Hostinger's own mail servers, not Vercel's IP, do the
  actual handoff to the recipient). Live DNS lookups (via `dns.google`'s
  DoH API, since this sandbox's own resolver has no network route) showed
  SPF and DKIM both correctly configured for the domain; DMARC exists but
  sits at `p=none` (monitoring only) — flagged as a minor, non-urgent gap,
  worth tightening once a few weeks of clean sending confirm nothing
  legitimate fails alignment. Concluded the actual cause is ordinary
  new-domain reputation, not fixable by a provider swap. Added a second
  `.sent-meta` paragraph to `/login`'s "Check your email" screen
  (`app/login/page.tsx`), after the existing "Nothing yet? Check spam..."
  line, naming the new-domain cause and asking the recipient to mark the
  message "Not spam" if found there — a real signal to Gmail/Outlook,
  unlike just telling them where to look. Scoped to the sign-in email only,
  per the report; the app's other outbound email shares the same domain/
  auth and carries the same risk but wasn't touched this batch. `npx tsc
  --noEmit`/`npm run lint` clean.
- **"Become a Subscriber" pitch built into Account Options' Subscriber
  section (2026-08-24).** Jim wrote the actual sales content himself
  (Subscriber Features list, Cost, a "Sign up for a 1st year discount"
  button) and asked for it to be built where he'd originally sketched it —
  "or, more likely, have it present when the Subscriber section of Account
  Options is opened," which is what got built, rather than a separate
  screen/route. The whole Subscriber section was previously gated behind
  `canToggleTier` (migration 035's private-testing allowlist) — un-gated,
  2026-08-24, so every signed-in user can now open it; only the testing-only
  "Subscribed?" checkbox inside stays gated. New `BecomeSubscriberPromo()`
  component in `AccountForm.tsx`, shown whenever `tier !== 'subscriber'`
  (a subscriber sees a one-line thank-you instead) — reuses the existing
  `.promo`/`.promo-h`/`.promo-p`/`.promo .btn` component Request Response's
  "Free Account Features" pitch already established, plus two new classes
  (`.promo-sub` for the "Subscriber Features"/"Cost" sub-headings,
  `.promo-features` for the feature list — a small brand-blue bullet dot,
  since nothing in the app used list bullets before this). **The CTA button
  has nowhere real to go** — there is no eCommerce/checkout page anywhere in
  this app, on purpose (CLAUDE.md's own Scope Discipline defers payments).
  Built as a real, clickable primary button rather than left silently
  inert: clicking it reveals a small "Subscription checkout isn't available
  yet" note in place, rather than doing nothing or navigating somewhere
  fake. Swap for a real link once a checkout page exists. Pricing quoted
  verbatim from Jim's own copy ($17.95 first year / $23.95 renewal, 5 GB
  storage included / $10 per 5 GB/year additional) — not verified against
  the PRD's own $17.95/yr flat figure, which this supersedes; see the
  updated cost/revenue model (below) and PRD follow-up. **No mockup** —
  `AccountForm.tsx` has never had one; flagged in `design/README.md`, not
  silently skipped. `npx tsc --noEmit`/`npm run lint` clean.
- **Subscribe page mockup drafted; Stripe chosen over Paddle; Show Reminders
  rewritten to a pure UI-visibility toggle, sending fully decoupled from it
  — migration 045 confirmed run by the owner, 2026-08-25.** Jim asked which
  hosted checkout to use for a $17.95 purchase (worked with WooCommerce
  before); researched Stripe (2.9% + $0.30/charge, +0.7% for Billing/
  auto-renewal) vs. Paddle (flat 5% + $0.50, bundles merchant-of-record tax
  handling) and recommended Stripe given Jim's own stated preference to
  avoid tax/renewal complexity — he agreed the same day. New
  `design/screens/WYP_subscribe_palette1.html` (§6.45 PROPOSED, mockup
  only, no live route) — first draft drew a raw card-entry form, flagged
  as putting WYP in PCI DSS scope; same-day revision replaced it with a
  single `.checkrow` ("Subscribe now") under the same "Payment Method"
  heading per Jim's own instruction, swap for a real Stripe Checkout/
  Payment Element redirect once his corporation/bank account are ready —
  never a custom card form. Reuses `AccountForm.tsx`'s own `BecomeSubscriberPromo`
  copy verbatim (`.promo`/`.planrow`) so the two screens never diverge.
  **Same-day wording fix**: the What's-included bullet for storage dropped
  "included" and switched to the same em-dash separator every other bullet
  uses ("5&nbsp;GB of storage &#8212; for attachments..."), applied to both
  `AccountForm.tsx`'s `BecomeSubscriberPromo` and this mockup.
  **Separately the same day — Show Reminders rewritten wording +
  decoupled from sending, migration 045.** Jim rewrote both "Show
  Reminders" checknotes (Request Options and ToDo Options) to near-verbatim
  new text ending "Without regard to whether Reminders are shown, Reminders
  are sent as indicated with Default (Day before / Day of / Day after)
  settings. Off by default," and asked to "align the Reminder sending
  actions and default settings accordingly." Two real behavior changes
  followed from that one sentence, not just a wording edit: (1)
  `app/api/cron/tick/route.ts`'s Request Phases A1/A1b/B and ToDo Phases
  A2/A2b/A3 had each been AND-gated on `request_reminders_enabled`/
  `todo_reminders_enabled` (the account-level Show Reminders flags) since
  migration 044 (Request side) and 2026-08-22 (ToDo side) — **all six gates
  removed**. Sending now depends solely on each row's own
  `reminder_enabled`/`reminder_day_of_enabled`/`overdue_reminder_enabled`
  columns, pre-filled from the owner's Default settings
  (`request_reminder_default_*`/`todo_reminder_default_*`, migration 044)
  at creation time regardless of whether the banner was ever shown —
  verified `CreateRequestForm.tsx`'s own pre-fill effect already writes
  these unconditionally, independent of the `requestRemindersEnabled` state
  that only gates `reminderBanner()`'s render, so no change was needed
  there beyond the default-value fix below. `todo_dates_enabled` stays as
  the ToDo phases' one remaining gate — a data-availability check (a ToDo's
  Due Date column has no meaning without it), not a visibility gate, so it
  was kept. (2) `profiles.request_reminders_enabled`'s own column default
  flips true -> false (migration 045) to match "Off by default" — ToDo's
  own `todo_reminders_enabled` was already false by default (migration
  041), unchanged. Existing rows are unaffected, only new signups; every
  `?? true` fallback reading this column client-side
  (`AccountForm.tsx`/`CreateRequestForm.tsx`/`RequestDetailForm.tsx`) was
  updated to `?? false` to match, and the two
  `owner_request_reminders_enabled` coalesce-if-null fallbacks inside
  `get_request_by_token`/`get_received_request` (migration 044) were
  updated `true` -> `false` for the same edge-case-only reasoning
  migration 044's own header gave for `owner_request_time_enabled`'s
  identical pattern. **Separate wording addition, same message**: each of
  the four Day Of/Day After Default checknotes (Request and ToDo) gained
  "Changing this setting never affects anything already created." — Jim's
  own instruction; previously only the two Day Before notes had it. `npx
  tsc --noEmit`/`npm run lint` clean. No mockup updated — none of the six
  Reminders-until-Done screens' static HTML models the banner or the
  Account Options screen at all (unchanged from every earlier entry in
  this family). See the decisions log's 2026-08-25 entry for the full
  write-up.
- **Cost/revenue model updated in place with the new subscriber pricing
  (2026-08-24, `docs/WYP_Hosting_Cost_Crossover_Model.xlsx`).** Jim asked
  to re-run the PRD §8.2/§11.3 cost/revenue estimates against his new
  pricing (above) including the new storage add-on. The prior
  cost-crossover model (built under tasks #305–310, an earlier session)
  was in fact already saved into `docs/` — patched in place rather than
  rebuilt from scratch, preserving its existing Assumptions/User
  Tiers/Vercel Cost Model/Supabase Cost Model/AWS (PRD sec 6.2)/Crossover
  Summary/AWS Activate Credits structure. Added: a 4th Assumptions section
  (Year 1/renewal price, storage included per subscriber, additional
  storage block size/price, % buying extra storage, free-to-paid
  conversion rate — each its own labeled input cell, referenced via
  openpyxl workbook-scoped defined names rather than hardcoded row
  references, to avoid the row-miscounting bug this file's own build
  history had already hit twice); a new "Subscriber Revenue" sheet (per
  tier: subscriber count, Year 1 vs. renewal-price revenue, storage
  add-on revenue, two TOTAL rows, and a separate storage-overage-cost line
  using the Supabase Cost Model sheet's own existing 100GB-pooled/
  $0.0213-per-GB convention); and four new Crossover Summary columns
  (Subscribers, Year 1 revenue, Renewal revenue, Renewal revenue minus
  Vercel+Supabase MID cost). **`recalc.py`'s LibreOffice pass could not
  complete in this sandbox session** — repeated attempts, including a
  bare `soffice --headless --terminate_after_init` with no document
  involved, hung or were killed by the tool harness's own ~178-second
  per-call cap; this reads as sandbox/environment instability, not a
  file problem. Verified instead with the `formulas` package (a pure-
  Python Excel formula engine, `pip install formulas`), which evaluated
  all 580 cells in the workbook with **zero formula errors** and produced
  sane, hand-checkable results (e.g. at the 10,000-user Pilot tier: 300
  subscribers, $5,535 Year 1 revenue, $7,335 renewal revenue, $357.84/yr
  storage-overage cost — all match a manual recompute of the formulas).
  Because openpyxl strips cached values on save, the file's cells will
  read blank in any viewer that doesn't itself recalculate — real Excel
  and Google Sheets both recalculate automatically on open (Automatic
  mode is the default), so this has no effect for Jim's actual use, but
  is why a LibreOffice-based preview/thumbnail of the file might show
  blanks. **Known gap, not yet wired into the model**: the storage
  overage cost (Subscriber Revenue row 17) is computed but not currently
  subtracted in Crossover Summary's "Renewal revenue minus cost" column —
  worth folding in if Jim wants a true net-of-storage figure, flagged
  rather than silently decided. See the decisions log's 2026-08-24 entry
  for the full pricing inputs, assumptions, and computed results across
  all five tiers.
- **Main Screen ad banner now gated by subscription tier; Archive gains a
  full UnArchive action — migration 046 confirmed run by Jim, 2026-08-25.**
  Jim: the `.adslot` ("AD — 320×50 RESERVED") on Main
  Screen "is not being gated by the Subscription status," plus a pasted
  mockup asking for an UnArchive action on `/archive` with the band's "xx
  Selected" button reflecting Archive vs. UnArchive. `MainScreen.tsx` had no
  tier-awareness anywhere — added a `tier` state (read off the same
  `profiles` round trip as `categoriesEnabled`/etc., no extra query) and
  wrapped `.adslot` in `tier !== 'subscriber'`; `.subbanner` stays
  unconditional, unaffected by the report. `ArchiveForm.tsx` gained a new
  `action` state (`'archive' | 'unarchive'`, `ARCHIVE_ACTION_KEY`
  sessionStorage-persisted like `currentType` — survives a fresh visit,
  unlike the filter/selection state) and a new Action chip row above Record
  Type, reusing the existing `.archtyperow` classes verbatim. The `rows`
  useMemo's candidate filter, `LIST_TITLE` (split into
  `LIST_TITLE_ARCHIVE`/`LIST_TITLE_UNARCHIVE`, consumed through one
  `listTitle` variable), the instruction paragraph, both empty-state
  messages, and the band button label are all now action-aware.
  `handleArchiveSelected` renamed `handleActionSelected`: Sent/ToDos'
  `archived_at` is already plain-RLS-writable either direction (no new SQL
  needed for UnArchive there); Received goes through new
  `unarchive_received_request()` (**migration 046**), a direct mirror of
  `archive_received_request()` (migration 028) with `received_archived_at`
  set to `null` instead of `now()` — its body was copied verbatim from
  migration 028's actual text (grepped fresh, not recalled from memory)
  after an earlier same-session incident where a guessed function body
  drifted from the original. UnArchive now works end to end for all three
  Record Types, Received included. No mockup updated —
  `design/screens/WYP_archive_palette1.html` still shows the original
  Archive-only flow; flagged in `design/README.md`. `npx tsc --noEmit`/`npm
  run lint` clean. See the decisions log's 2026-08-25 entry for the full
  write-up.
- **Search scope control replaced with chip buttons; scope chips relocated
  to the "Search" band header; ad banner gating extended to every screen
  that shows it (2026-08-25, same session as the batch above).** Jim
  reported the Search scope's native `<select>` (All/Dates) opened Android
  Chrome's own full-screen radio-button dialog rather than a compact
  dropdown — no CSS on a `<select>` can suppress that, it's OS picker
  chrome. Replaced with two `.chip` buttons (`.scopechips`, reusing the
  app's own `.chip.sel` selected-state convention) in `MainScreen.tsx`;
  `selectSearchScope()` needed no change. **Follow-up, same day**: those
  chips originally sat inside `.searchbar` itself, competing with the
  search field/Date Range fields/magnifying-glass icon for width — on a
  phone, selecting Dates wrapped the icon below the visible band. Moved
  into the "Search" `.band`'s own `.bandcluster` (right-aligned header
  slot, the pattern every other band with controls already uses), leaving
  `.searchbar` as just the field row. **Separately, same day**: the ad
  banner (`.adslot`) was gated on subscriber tier for Main Screen only in
  the batch above — Jim found it still showed everywhere else. Extended to
  all 8 remaining screens that render it: `CreateRequestForm.tsx`,
  `RequestDetailForm.tsx`, `CreateTodoForm.tsx`, `TodoDetailForm.tsx` (all
  four already had their own `tier` state from other gating, just wrapped
  `.adslot`); `ContactDetailForm.tsx`/`AddContactForm.tsx` (added a `tier`
  state each — `AddContactForm.tsx` piggybacks on its existing
  unconditional `profiles` fetch, `ContactDetailForm.tsx` needed a new
  always-run effect since its own `profiles` select only fires in a rare
  fallback branch); `ResponseDetailForm.tsx` (signed-in recipient — gated
  on a new `viewerTier`, the *viewer's own* `profiles.tier`, deliberately
  not `data.owner_tier` like this screen's other gates, since an ad-free
  benefit is personal to the viewer, not a property of the Request being
  viewed); `RequestResponseForm.tsx` (the anonymous `/r/[token]` path — no
  viewer identity exists, gated on `data.owner_tier` instead, matching this
  screen's own existing Attachments/voice-dictation precedent — a
  considered design call, flagged rather than assumed uncontroversial).
  `npx tsc --noEmit`/`npm run lint` clean across both fixes. See the
  decisions log's 2026-08-25 entry for the full write-up.
- **Search results now survive the round trip to a Detail screen and back
  (2026-08-26).** Jim: opening a Sent/Received/ToDo row from Search Results
  to view its Request/ToDo/Response Detail, then Close/Cancel back, dropped
  into a normal non-searching Main Screen instead of the same search
  results — "the app should instead return to the search results." Same
  root cause as this file's own 2026-08-09 scroll-position/filter-chip
  fixes (a Detail-screen round trip fully remounts `MainScreen.tsx`, and
  `searchText`/`searchScope`/`fromDate`/`toDate` were plain `useState` with
  no persistence at all). Fixed by mirroring `ArchiveForm.tsx`'s own
  `ARCHIVE_ROUNDTRIP_KEY` pattern (2026-08-14/16) exactly: four new
  `sessionStorage` keys for the four search fields plus a
  `wyp.mainSearchRoundTrip` marker; the four `useState` calls became lazy
  initializers that restore stored values only when the marker is present;
  a mount effect clears the marker afterward (consumed-once); a new
  `openDetailRow(path)` helper sets the marker immediately before
  `router.push`, replacing the bare `router.push` calls in all three
  sections' row `onClick`/`onKeyDown` handlers. Deliberately scoped to the
  one round trip, not permanent like the filter chips — a genuinely fresh
  visit still starts with Search cleared, preserving the 2026-08-09
  decision that search shouldn't persist indefinitely across visits. `npx
  tsc --noEmit`/`npm run lint` clean. See the decisions log's 2026-08-26
  entry for the full write-up.
- **"My Subscription" / "Become a Subscriber" screen pair, fully dynamic —
  migration 047 confirmed run by Jim, 2026-08-26.** New shared
  `app/components/SubscriptionPanels.tsx` (`SUBSCRIBER_FEATURES` data,
  `BecomeSubscriberPitch`, `MySubscriptionSummary`, plus Renewal Date/
  Attachment Storage/Plan Summary sub-panels), used at two call sites: the
  new full-page `/account/subscription` (`SubscriptionForm.tsx`), reached
  from `MainScreen.tsx`'s own `.subbanner` ("See Subscription Features and
  Other Options" — existed since 2026-08-13, was never wired to anything
  until now), and `AccountForm.tsx`'s own embedded Subscriber section,
  which now renders through the same components instead of its old local
  `BecomeSubscriberPromo`. Not caption-based — fully driven by the real
  `tier` value, which the "Subscribed? (testing only)" checkbox (top of
  both screens, `canToggleTier`-gated) controls live during testing.
  Migration 047 adds `profiles.subscription_renewal_date`/
  `subscription_storage_gb` — the former recomputed to `current_date + 365`
  every time `set_tier_for_testing('subscriber')` actually runs (Jim: "based
  on date of clicking the checkbox"), the latter always 5 (the account's
  real granted storage; no purchase path exists yet). Buy Add'l/Cancel
  Renewal/Sign Up all show the same inert "not available yet" note. New
  `.planrow`/`.plan-name`/`.plan-sub`/`.plan-price` CSS ported verbatim from
  `design/screens/WYP_subscribe_palette1.html`. No mockups updated — Jim's
  five reference screenshots for this batch aren't part of `design/
  screens/`. `npx tsc --noEmit`/`npm run lint` clean. See the decisions
  log's 2026-08-26 entry for the full write-up.
- **Request<->ToDo conversion banner; ToDo Attachments replace Locations;
  URL auto-linkify — migration 048 DRAFTED, NOT YET CONFIRMED RUN
  (2026-08-26).** Jim's own three-message design, refined to its final
  shape across the exchange: a shared bottom-of-form banner/modal
  (`app/components/ConversionBanner.tsx`) on Request Detail ("Create a
  ToDo from this Request"), ToDo Detail ("Create a Request from this
  ToDo"), and Response Detail (request-to-todo direction only — a
  signed-in recipient has no ToDo of their own to convert back the other
  way). If the source item isn't already Done, two independent, fully
  skippable checkboxes ("Mark as Done" / "Mark as Done and Archive this
  Request/ToDo"); if it's already Done, only "Archive this Request/ToDo"
  shows — Jim's own final refinement. Continue stashes a
  `ConversionCarryPayload` (`app/src/lib/conversionCarry.ts`, single-
  consumption `sessionStorage`, same round-trip pattern as
  `ArchiveForm.tsx`'s `ARCHIVE_ROUNDTRIP_KEY`) and navigates to the other
  record type's Create screen, which applies both the Description/
  Category/Due Date pre-fill and the queued Done/Archive side effect only
  once its own Save/Send actually succeeds — never at the moment Continue
  is clicked. The side effect branches on source: a plain `requests` table
  update for the signed-in owner (Request Detail/ToDo Detail), or the
  existing `set_response_done_as_recipient()`/`archive_received_request()`
  RPCs for Response Detail — never a raw table update from the recipient
  side, per the Entitlements section above.
  **ToDo Attachments now replace ToDo Locations entirely** — confirmed
  while reading `AttachmentsPanel.tsx` that a ToDo is simply a `requests`
  row with `contact_id = null`, and the Attachments RLS/API layer
  (migration 025) is already fully ownership-based with no Request-vs-ToDo
  distinction, so this needed no schema/security change: ToDo Detail's
  `AttachmentsPanel` call switched `mode="reference"` -> `mode="file"`,
  and Create ToDo's staged-Locations modal/state was replaced by a
  mechanical port of Create Request's own staged-file-upload pattern.
  **Migration 048** folds every existing `kind='reference'` row (in
  practice, always a ToDo Location) into its parent's own `description` as
  `" -- Location(s): xxxxx, yyyyyy, zzzzz"` (Jim's own "note: value" join
  format, approved unchanged), then deletes the reference rows outright —
  a one-time cutover before the app stops writing/reading them.
  **URL auto-linkify**: new `linkifySegments()` (`app/src/lib/
  attachments.ts`, refactored out of the existing `urlLocationHref()`) and
  a new shared `app/components/Linkified.tsx`, applied to read-only
  Description and Dialog-body display on Request Detail, ToDo Detail,
  Request Response, and Response Detail (never to an editable
  `<textarea>`, which would fight the cursor). **No mockups updated** —
  none of the affected screens' static HTML models any of this; flagged in
  `design/README.md`. `npx tsc --noEmit`/`npm run lint` clean. See the
  decisions log's 2026-08-26 entry for the full write-up.
- **`/auth/callback` now forwards a Supabase auth-failure hash to `/`
  instead of silently swallowing it (2026-08-27).** Owner-reported: signed
  out and back in, sign-in took longer than usual and produced two
  sign-in-link emails; the first worked, clicking the second's link bounced
  to a bare landing page with no explanation. `app/page.tsx`'s own
  `parseAuthError()` (2026-08-18) already turns a `#error=...` hash from a
  used/expired magic link into a friendly banner — but only if that hash
  actually reaches `/`. The 2026-08-18 write-up's own example showed
  Supabase's failure redirect landing on its project-level Site URL (a
  `*.vercel.app` address in that case); this occurrence landed the failure
  on `emailRedirectTo` (`/auth/callback`) instead, a route with zero error-
  hash awareness before this fix — it only ever checked `getSession()` and,
  finding none, sent the visitor to `/login` with the failure reason
  dropped. `/auth/callback/page.tsx` now checks for `error=` in the hash
  before calling `getSession()` at all, and if present, forwards to `/`
  with the hash intact, verbatim, so the existing `parseAuthError()`/banner
  logic picks it up regardless of which of the two targets Supabase
  actually used. **Root cause of the two emails themselves is unconfirmed**
  — the `/login` submit button is already `disabled` while sending (no
  client-side double-submit gap found), so the most likely explanations are
  either the SMTP relay being slow enough that Supabase's mailer/Hostinger
  retried the send (same underlying token, single-use — whichever link is
  opened first wins, the other then hits the now-fixed failure path), or a
  second manual resend by the owner. Flagged for the owner to note the
  exact address-bar contents if this recurs. `npx tsc --noEmit`/`npm run
  lint` clean.
- **Office attachments (.xlsx/.docx/.pptx) now open through Microsoft's
  Office Online viewer instead of downloading (2026-08-27).** Owner-
  reported, tracing a real phone test to its root cause across a short back-
  and-forth: tapping an Excel attachment correctly triggered Chrome's own
  "Download this file?" prompt (not a bug — a browser can't render .xlsx
  natively on any platform) and downloaded successfully, but a download's
  only destination is a device folder most users don't know how to find
  afterward, with no in-app confirmation once it completes. New
  `isOfficeViewable()`/`officeViewerUrl()` (`app/src/lib/attachments.ts`) —
  for `.doc/.docx/.xls/.xlsx/.xlsm/.ppt/.pptx/.rtf/.odt/.ods/.odp`,
  `AttachmentsPanel.tsx`'s attachment link now points at
  `view.officeapps.live.com/op/view.aspx?src=<signed URL>` instead of the
  signed URL directly — the document renders in-browser, no download,
  nothing to go looking for afterward. Confirmed with the owner before
  building it (`AskUserQuestion`) rather than assumed: this sends the
  attachment's temporary signed link to Microsoft's own servers to fetch
  and render, a real third-party dependency and a privacy consideration
  for sensitive file content, accepted in exchange for a phone experience
  that doesn't depend on which apps happen to be installed — replaces the
  download outright rather than sitting alongside it as a second option.
  Every other file type (PDFs, images, zips, ToDo Locations) is untouched.
  New shared `ATTACHMENT_SIGNED_URL_TTL_SECONDS` (`app/api/attachments/
  _shared.ts`, 900 — was a 300-second literal duplicated in both
  `list/route.ts` and `upload/route.ts`) gives the viewer's own server-side
  fetch more headroom on a slow mobile connection before the link goes
  stale. `npx tsc --noEmit`/`npm run lint` clean.
- **`AttachmentsPanel.tsx` now silently refreshes its signed URLs in the
  background before they expire (2026-08-27)** — owner-reported, same day
  as the Office-viewer fix above: "I have seen that failure a few times
  when I leave an item open and later try to see the attachment." A
  panel's `rows` (and each `kind = 'file'` row's signed `url`) were fetched
  once on mount and never again; leaving a Request/ToDo Detail screen open
  longer than `ATTACHMENT_SIGNED_URL_TTL_SECONDS` (900s/15 min) made a
  later click hit an expired-link error from Storage (or from the Office
  Online viewer trying to fetch it) instead of the file. New
  `fetchedAtRef` (a ref, not state — nothing renders off it, and updating
  it must not itself retrigger the fetch effect) records when the current
  batch of signed URLs was fetched; a `setInterval` checked once a minute
  re-fetches a fresh batch via `load({ silent: true })` once more than
  `REFRESH_THRESHOLD_MS` (10 minutes — a 5-minute safety margin under the
  15-minute TTL) has elapsed. `silent` mode deliberately never touches
  `loading` (would otherwise hide the whole panel behind `if (loading)
  return null` every ten minutes) or clear `rows`/`error` on a failed
  retry — a failed background refresh just leaves whatever's already on
  screen in place and tries again a minute later, rather than blanking a
  working panel over a background call that didn't matter yet. Matches the
  owner's own proposed mechanism verbatim ("a timestamp of initial
  attachment acquisition compared to the current time"). `npx tsc
  --noEmit`/`npm run lint` clean.
- **Conversion banner can now copy an existing Dialog thread and/or
  Attachments into the new item (2026-08-27).** Jim's own follow-up on the
  2026-08-26 Request<->ToDo conversion feature: "The create ToDo and
  Request from a Request and ToDo should have the ability to copy existing
  Dialog and Attachments if desired," plus a pasted mockup moving the
  banner's "Carries..." wording into the modal and adding a single combined
  "Include Attachments and Dialog" checkbox. `ConversionBanner.tsx`'s
  at-rest button is now a plain `.fieldact` row with no accompanying
  text — the sentence lives in the modal's own first line instead, with
  "Category" appearing only when a new `categoriesEnabled` prop is true
  (which also nulls `categoryName` in the payload when false, so a hidden
  Category is never copied either). `.donerow-stack` (added the day before
  for this exact text/button pairing) is now dead code, removed from
  `globals.css`. The two Mark-as-Done checkboxes were reworded to name the
  source item explicitly on both lines ("Mark ToDo as Done" / "Mark ToDo as
  Done and Archive it"). The Include checkbox only renders when there's
  something to include (`dialogEntries.length > 0` or
  `canCopyAttachments && attachmentCount > 0`) and only names whichever of
  Attachments/Dialog is actually present — `canCopyAttachments` is the
  *new* item's future owner's own tier (Response Detail's `viewerTier`;
  Request/ToDo Detail's own `tier`), never the source's issuer tier, since
  copying onto a brand-new item is "adding" there, gated on whoever will
  own it (CLAUDE.md's own Entitlements section). Dialog copies via a plain
  client insert in `conversionCarry.ts`'s new `applyConversionContentCopy()`
  — the source thread is snapshotted into the payload at Continue time
  (`ConversionDialogSnapshotEntry[]`, since a 'recipient' source has no RLS
  path to re-read someone else's dialog later from the target Create
  screen), inserted in original id order with an old-id -> new-id map so an
  Answer's `replies_to_id` still resolves correctly on the new thread.
  Attachments require a new server route, `app/api/attachments/copy/route.ts`
  (service_role, mirroring `/api/attachments/upload`'s posture — a
  `kind = 'file'` row can never be created by a direct client insert) —
  permission on the source resolved via the existing `resolvePermission()`,
  destination ownership verified via the caller's own forwarded client,
  gated on the caller's own tier (silent no-op if not a subscriber, per
  Jim's own scoping: "it for attachments will only be used for
  Subscribers"), duplicates the actual Storage object (`.copy()`, same call
  Repeat's own carry-forward already makes) rather than sharing a
  reference — an accepted trade-off, Jim's own words: "I also considered
  the duplication of attachments which results from this approach and
  would expect this process to be infrequently used." `uploaded_by`/
  `uploaded_by_label` are set to the *caller*, not the original uploader,
  so an unrelated original uploader never gains delete rights on the new
  item. `CreateRequestForm.tsx`/`CreateTodoForm.tsx` call the new
  `applyConversionContentCopy()` right alongside the existing
  `applyConversionSideEffect()` call, same post-Save timing. No mockup
  updated — this feature family has none; see `design/README.md`'s
  2026-08-27 entry. `npx tsc --noEmit`/`npm run lint` clean.
- **iOS PWA install — `apple-mobile-web-app` metadata added (2026-08-27).**
  Jim asked whether app-icon installation works on an iPhone like it does on
  Android/Windows. It doesn't, fully: `PWAProvider.tsx`'s
  `canInstall`/Install-Housekeeping-row mechanism depends on
  `beforeinstallprompt`, a Chromium-only event Safari never fires on iOS —
  a platform limitation, not a bug here. The manual path (Safari Share ->
  Add to Home Screen) does work and already picks up `app/manifest.ts`'s
  icons/`display: standalone` and `layout.tsx`'s `icons.apple`
  (`apple-touch-icon`). Closed the one remaining gap in that manual path:
  `layout.tsx`'s `metadata` gained `appleWebApp: { capable: true, title:
  "Would You Please", statusBarStyle: "default" }` — `capable: true` is
  what makes the launched icon open standalone (no Safari chrome) rather
  than as a bookmark tab; `statusBarStyle: "default"` (not
  `"black-translucent"`) was a deliberate choice, since this app has no
  safe-area-inset padding anywhere and the translucent variant draws
  content under the status bar/notch. `npx tsc --noEmit`/`npm run lint`
  clean.
- **Landing page subscription content caught up to real pricing/features
  (2026-08-27).** Jim: the landing page "needs to be caught up to the
  latest subscription/etc changes" — it still quoted a flat "$17.95 / yr"
  (predating the 2026-08-24/25 first-year-discount/renewal price split) and
  was missing 5 GB storage, Automatic Repeating, and Voice dictation from
  its feature list, while still pitching Voice dictation as "Coming soon"
  after it had already shipped as a live Subscriber feature. `LandingPage.tsx`
  now imports `SUBSCRIBER_FEATURES` directly from `SubscriptionPanels.tsx`
  (the same canonical list Account Options/`/account/subscription` already
  use) instead of hand-duplicating it a third time; badge/note/final-CTA
  pricing text updated to "$17.95 1st yr" / "$23.95/yr" throughout; the
  "Coming soon" Voice search bullet trimmed to just the still-unbuilt
  search-dictation piece. `design/marketing/WYP_landing_page.html` (the
  static mockup, kept hand-synced on every prior content change) got the
  identical literal content, with a comment pointing back at
  `SubscriptionPanels.tsx` as the source of truth. **Also answered**: Jim
  can't see the anonymous landing page on his own device because "Keep me
  signed in" persists via `localStorage` even after logging out on the same
  browser profile — a private/incognito window has none of that storage, so
  `getSession()` finds nothing there and `/` renders the landing page
  regardless of his normal window's signed-in state. No code change for
  that part. `npx tsc --noEmit`/`npm run lint` clean.
- **Free-tier feature expansion: Attachments (100 MB cap) and Repeat
  (5-occurrence cap); "Unlimited" prefix on the two Subscriber equivalents;
  landing/onepager/Subscribe pricing updates; $2.95/mo Monthly option
  (2026-08-27).** Jim: "I got some feedback that it would be better to let
  users get familiar with more features (with limits)." Attachments moved
  from fully `tier === 'subscriber'`-gated (all six Request/ToDo screens)
  to always-available, gated instead by a real server-side storage quota —
  new `getOwnerStorageStatus()` (`app/api/attachments/_shared.ts`) sums
  every `kind = 'file'` attachment across everything the *owner* (never the
  uploader) has, checked in `upload/route.ts` against a new
  `FREE_TIER_STORAGE_LIMIT_BYTES` (100 MB, `app/src/lib/attachments.ts`) for
  Free or `profiles.subscription_storage_gb` for Subscriber; no migration
  needed. `AttachmentsPanel.tsx` gained an `extraNote` prop surfacing
  "(optional, 100 MB total)" for Free. Repeat moved from hidden-entirely
  behind the same tier check (four call sites) to always rendered, capped
  instead at a new `FREE_TIER_MAX_REPEAT_OCCURRENCES = 5`
  (`app/src/lib/repeatRule.ts`) checked in `cron/tick/route.ts`'s Phase E
  generation loop alongside the rule's own Stops-Repeating check;
  `RepeatControl.tsx` gained an optional `tier` prop showing an
  informational cap note when Free. `ProfileRow` (cron route) gained
  `tier`/`subscription_storage_gb`, and Phase E's attachment
  carry-forward loop gained its own inline storage-quota safety net (same
  query shape as `getOwnerStorageStatus()`, duplicated per this codebase's
  established convention rather than imported) so an unattended Repeat
  can't silently carry a Free owner past their cap over several
  generations. **"Unlimited" prefix** — Jim's own annotation — added to
  `SUBSCRIBER_FEATURES`' "File attachments"/"Automatic Repeating" entries
  (`SubscriptionPanels.tsx`), propagating to Account Options, `/account/
  subscription`, the landing page, `WYP_subscribe_palette1.html`, and
  `docs/WYP onepager.html`. **New landing-page Free-tier card** — a new
  `FREE_TIER_ADVANCED_FEATURES` array backs a 7th "Advanced Subscription
  Features" card in the feature grid (`LandingPage.tsx` + its mockup +
  `docs/WYP onepager.html`). **Wording fixes**, Jim's own literal wording:
  the hero's "Nothing to install" line is now "No App to install*" with a
  new footnote about the home-screen icon; both ToDo↔Request conversion
  card sentences now read "in two taps" (was "in one tap," ToDo card only)
  and the Trackable Requests card gained its own converse sentence. **$2.95/mo
  Monthly option** — a third, informational row/line in `PlanSummaryPanel`
  and `BecomeSubscriberPitch` (`SubscriptionPanels.tsx`, so Account Options
  and `/account/subscription` picked it up automatically), ported by hand
  into `WYP_subscribe_palette1.html` and `docs/WYP onepager.html` — no
  plan-switching mechanism exists yet, same "checkout isn't available yet"
  posture as every other subscription control. **Flagged, not built**:
  "Storage Management" -> "Storage and Usage Management" (Jim's own
  tentative wording; no such screen is live — Storage Maintenance is
  mockup-only, see `design/README.md`). **Flagged inconsistency**: Conversion's
  `canCopyAttachments` (`RequestDetailForm.tsx`/`TodoDetailForm.tsx`) and
  `/api/attachments/copy/route.ts`'s own tier check are both still
  Subscriber-only — not mentioned in Jim's request, left as-is rather than
  assumed to expand. `docs/WYP onepager.html`'s one-pager remains
  **unverified against a real one-page print** (task blocked, no headless
  browser/Chrome extension reachable this session) — the new 7th feature
  card and expanded subscription-bullet list make this more likely to spill
  onto a second page than before; flagged for Jim to check. `npx tsc
  --noEmit`/`npm run lint` clean.
- **Merged File Attachments+Storage bullet, Title Case feature wording,
  Free vs. Subscriber Comparison table — supersedes the "Unlimited" prefix
  and resolves the onepager one-page flag above (2026-08-27).** Jim, with
  two pasted Account Options screenshots: merge File Attachments and
  Storage into one bullet (his own drafted wording); add a two-view toggle
  to Account Options' Subscriber section ("Subscriber Features" / "Free
  vs. Subscriber Comparison") sized so switching doesn't jump/pop the
  layout; rename "Cost" to "Subscription Cost" and keep it (and everything
  below — pricing, Sign Up button, cancel note) fixed regardless of view;
  apply exact Title Case everywhere the feature list appears: "Voice
  Dictation, File Attachments with 5 GB of Storage, Automatic Repeating,
  Request Texting, Ad-Free, and Priority Support" — supersedes the
  "Unlimited" prefix added the day before, now redundant since the merged
  bullet states "5 GB" directly and the new table itself carries the
  Free-vs-Subscribed contrast for Automatic Repeating. `SUBSCRIBER_FEATURES`
  rewritten accordingly (`SubscriptionPanels.tsx`); new exported
  `SubscriberComparisonTable`/`COMPARISON_ROWS` and `.comparetable`/
  `.viewtoggle` CSS (`app/globals.css`, reusing existing tokens only).
  `BecomeSubscriberPitch` gained a `view` state driving the toggle;
  `SubscriberFeatureList`'s `heading` prop is now optional (the toggle
  buttons serve as the heading there; `PlanSummaryPanel`'s own "What's
  included" call site is unaffected). `LandingPage.tsx` renders the same
  comparison table always-visible (no toggle there, per Jim's own
  instruction), directly under its own bullet list. Ported by hand into
  `WYP_subscribe_palette1.html` (wording only — no toggle on this
  checkout/Plan-Summary screen) and `design/marketing/WYP_landing_page.html`
  (wording plus table, with its own local CSS copy — this mockup is fully
  self-contained). **`docs/WYP onepager.html` reworked, not just
  re-worded** — resolves the prior entry's own "unverified against a
  real one-page print" flag by dropping the one-page goal outright, per
  Jim's own instruction ("it has extended past a page and does not
  easily reformat onto one page... it can follow the formatting of the
  landing page with a comparison table added"): the `.page` no longer
  targets `min-height:11in`, content is allowed to flow onto a second
  printed page via the browser's own pagination, and an eventual
  two-sided-print page-break point is explicitly left undecided ("to be
  determined later") rather than guessed at. The "Who benefits" paragraph
  reverted from an artificially undersized 11.5px back to 12.5px now that
  the one-page budget is gone. Both the free-tier "Advanced Subscription
  Features" card and the subscription bullet list were updated to the
  same merged/Title-Case wording, and the identical comparison table was
  added beneath the bullet list, with its own locally-duplicated
  `.comparetable`/`.promo-sub` CSS (no shared stylesheet to import from,
  same as the landing-page mockup). `npx tsc --noEmit`/`npm run lint`
  clean.
- **"Better disclose" subscription pricing; Private Testing dialog on Start
  Free Account; "canceled" spelling fix (2026-08-28).** Jim, with two
  pasted mockups: landing page's "Coming with a subscription" `.slabel`
  became plain "Subscription," with the 25%-discount/price/monthly cadence
  spelled out inline via new `.subline` spans flanking the existing
  `.badge.sub` pill, in `LandingPage.tsx`/`landing.css`, ported into
  `design/marketing/WYP_landing_page.html` and `docs/WYP onepager.html`.
  Subscription note gained "A month-to-month subscription is available for
  $2.95." (all three places — the onepager's own note previously folded an
  "or $2.95/mo" clause mid-sentence instead, normalized to match). The
  Free vs. Subscriber Comparison table's column-header background changed
  from `var(--strip)` to white (`app/globals.css`, plus both static
  copies). `BecomeSubscriberPitch`'s Subscription Cost paragraph
  (`SubscriptionPanels.tsx`) simplified — drops the repeated "subscription"
  suffix per line, states renewal behavior directly ("renews each
  year/month until canceled" instead of "thereafter"). **"cancelled" →
  "canceled"** audited codebase-wide: the vast majority of matches were the
  unrelated `let cancelled = false` async-effect-guard variable name (left
  untouched, not user-facing) or historical prose in `CLAUDE.md`/
  `design/README.md`/the decisions log itself (left untouched, per their
  own historical-record purpose); the two real user-facing occurrences —
  `PlanSummaryPanel`'s Monthly `.plan-sub` text and the identical text in
  `WYP_subscribe_palette1.html` — were fixed. **Private Testing dialog** —
  both landing page Start Free Account controls (hero-top, final CTA band)
  now open a `.scrim`/`.modal` (§6.12) dialog with Jim's own wording and a
  real `mailto:notifications@wouldyouplease.com` link, instead of
  navigating to `/login?intent=signup` — new `testingDialogOpen` state in
  `LandingPage.tsx`; with no `.app` ancestor on this page, the overlay
  correctly covers the full viewport rather than confining to a 480px
  frame. Sign In is unaffected; `RequestResponseForm.tsx`'s own
  differently-worded "Create your own Free Account" link (a different
  pitch, anonymous-recipient-only) is untouched. **Not ported into
  `design/marketing/WYP_landing_page.html`** — that mockup has no
  `<script>` anywhere; flagged with a header comment rather than adding a
  first script tag for one interaction. `npx tsc --noEmit`/`npm run lint`
  clean.
