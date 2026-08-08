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
- Main screen and Your Account are mockups only. Add Contact is now Converted
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
  (`dialog.replies_to_id`) — not yet run.** On Respond to Request (mockup
  only) and, later, Request Detail, Answer unlocks dynamically — enabled only
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
- `npm run build` cannot be verified in this sandbox — the SWC native binary
  fails to load here (`Failed to load SWC binary for linux/x64`), unrelated to
  any code change. `npx tsc --noEmit` and `npm run lint` both pass clean; run
  `npm run build` locally before pushing, per the Commands section above.
