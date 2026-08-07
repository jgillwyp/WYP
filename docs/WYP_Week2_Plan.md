# Would You Please — Week 2 plan

Your instinct is right, and it's worth sharpening one level further before writing any SQL: this isn't a `requests` table and a `todos` table. §2.5 of the PRD is explicit — **"ToDos are stored as Requests"** — one table, distinguished by which columns are null (no recipient, no required due date, a Priority number that Requests don't have). Reaching for two tables here would be the natural relational instinct and would quietly contradict a decision already made. Everything below assumes one unified table, called `requests` to match the PRD's own language.

The second thing worth surfacing before the plan: pulling up every screen's actual spec status (not just the mockup file list) turned up three real gaps, none of which block the SQL or Create Request, but all of which will block something you'll want to test this week. They're called out inline below rather than saved for the end.

---

## Recommendation: schema first, then Create Request, then Main Screen

That ordering matches how Week 1 went — prove the write path on one screen before the read path needs to display anything real. Create Request is the write; Main Screen is the read.

### Day 1 — Migration 003: `requests` and `categories`

Draft below, same shape as migration 002 (RLS enabled, phased policies, a verification block, append to `docs/SQL history .txt` once run). Two things it deliberately does *not* do yet, both flagged as follow-ups rather than silently skipped:

- **No recipient-side visibility.** RLS below only lets the owner (sender) see their own rows. A contact's `linked_user_id` (added in migration 002, still unused) is what will eventually let a signed-in recipient see a Request as Received — but that's the same shape of problem as the secure recipient link, and CLAUDE.md already says that work comes *after* the stack is proven further. Practical effect this week: **Received stays empty**, on purpose, same as Overdue not applying to ToDos — not a bug to chase.
- **No `time_zone` column on `profiles`.** §2.7 anchors Overdue to *the sender's* time zone, and `profiles` currently has nowhere to store it. Due Date/Due Time below are stored as the sender's local wall-clock values; Overdue evaluation needs the sender's zone to mean anything precise. Added as a follow-up column rather than guessed at here — worth 30 seconds to decide (IANA string like `America/Chicago`, browser-detected at signup) before Create Request's Send button needs it.

```sql
-- ============================================================================
-- WYP migration 003 — requests (unified Request/ToDo), categories
-- Run in the Supabase SQL editor, then append a note to "docs/SQL history .txt".
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. categories — owner-scoped labels, 20-cap enforced at the app layer
--    (matches contacts' existing owner-only shape; nothing new to explain here)
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- table-level `unique (...)` only accepts plain columns, not expressions
-- like lower(name) — a unique index is the correct form for a case-insensitive
-- constraint.
create unique index if not exists categories_owner_name_ci_idx
  on public.categories (owner_id, lower(name));

alter table public.categories enable row level security;

create policy "categories: owners select own"
  on public.categories for select to authenticated
  using (owner_id = auth.uid());
create policy "categories: owners insert own"
  on public.categories for insert to authenticated
  with check (owner_id = auth.uid());
create policy "categories: owners update own"
  on public.categories for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "categories: owners delete own"
  on public.categories for delete to authenticated
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. requests — PRD §2.5: "ToDos are stored as Requests." One table.
--    contact_id null            -> ToDo (no recipient)
--    contact_id not null        -> Request
--    priority is meaningful only when contact_id is null (ToDo); PRD gives
--    Requests no Priority field
--    due_date/due_time required by the app for a Request, optional for a ToDo
-- ----------------------------------------------------------------------------
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  category_id   uuid references public.categories(id) on delete set null,

  description   text not null,                 -- 500-char app-wide convention (§2.4) — confirm
  priority      smallint check (priority in (1,2,3)),  -- 1 ASAP / 2 SOON / 3 LATER; ToDo only

  due_date      date,
  due_time      time,                           -- sender's local wall-clock (§2.7)
  done_date     date,
  done_time     time,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.requests.contact_id is
  'Null = ToDo (PRD §2.5). Not null = Request, and this is the recipient.';
comment on column public.requests.priority is
  'ToDo-only per §2.1 core objects table. Requests have no Priority field.';

create index if not exists requests_owner_idx    on public.requests (owner_id);
create index if not exists requests_contact_idx  on public.requests (contact_id);
create index if not exists requests_category_idx on public.requests (category_id);

alter table public.requests enable row level security;

-- Owner (sender) only, for now — see the note above on recipient visibility.
create policy "requests: owners select own"
  on public.requests for select to authenticated
  using (owner_id = auth.uid());
create policy "requests: owners insert own"
  on public.requests for insert to authenticated
  with check (owner_id = auth.uid());
create policy "requests: owners update own"
  on public.requests for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "requests: owners delete own"
  on public.requests for delete to authenticated
  using (owner_id = auth.uid());

create trigger requests_touch_updated_at
  before update on public.requests
  for each row execute function public.touch_updated_at();  -- reused from migration 002

commit;

-- ============================================================================
-- Verify as a client, not here — same caution as migration 002: this
-- connection is superuser and auth.uid() is null, so every RLS-dependent
-- check below "succeeds" here without proving anything.
--
--   await supabase.from('requests').insert({ description: 'test todo' })
--        -> succeeds; owner_id must be set by the client (no default here,
--           same choice AddContactForm.tsx made over trusting a DB default)
--   await supabase.from('requests').select('*')
--        -> only rows owned by the signed-in user
--   Second account -> sees none of the first account's rows
-- ============================================================================
```

### Days 2–3 — Convert Create Request (§9.2, fully specified in v2.7)

Mockup already exists (`design/screens/WYP_create_request_palette1.html`) and is fully specified, so this is a conversion, not a design pass — same shape of work as Add Contact. Pieces, in the order they'll come up:

- Recipient row: two lookup fields (§6.16 type-ahead) over `contacts`, First/Last Name, with Add Contact alongside — reuse the no-contact interception modal (§9.9.5) here, since this is the screen that actually triggers it, and the modal shell (`.scrim`/`.modal`/`.modalacts`) is already in `components.css`.
- Due Date / Due Time: browser-native pickers, styled to palette 1 — the spec says this explicitly (§6.17's calendar/clock visual design is still a placeholder), so no custom picker to build.
- Category: type-ahead against `categories`, plus Add Category as a one-field modal (§6.12 again) enforcing the 20-cap with an inline error, matching §2.3's own description of the interaction.
- Description field, 500-char convention (confirm against Add Contact's Notes precedent).
- Attachments panel: render in the already-mocked locked "paid feature" state — no upload logic, this is a paid-tier feature deferred per the 2026-07-28 scope cut. The panel is a static, correct-looking dead end this week.
- Send inserts into `requests` with `contact_id` set (making it a Request, not a ToDo) and `owner_id` from `auth.getUser()`, same pattern as Add Contact's Save.

### Day 4 — Convert Main Screen (§9.1, fully specified, includes Housekeeping)

Read the signed-in user's own `requests`: rows with `contact_id` not null render as Sent, rows with `contact_id` null render as ToDos. Received renders empty — expected, per the RLS note above, not a bug worth chasing this week. Wire the filter chips and column sort against the fetched rows (client-side filtering of what's already loaded is the simplest correct version). Wire the two Housekeeping rows: Account Profile can point straight at the existing Your Account mockup (already designed, not yet converted — a good candidate to convert same-day if time allows, it's a form like Add Contact). My Contacts is blocked on a real decision — see below.

### Day 5 / stretch

Two small, fully-specified, self-contained pieces if the week has room: the duplicate-handling modal on Add Contact (§9.9.4 — reuses the same modal shell again), or starting the design pass for whichever of the two screens below you want to unblock first.

---

## Three screens that don't exist yet, surfaced now rather than mid-week

**Create / Edit ToDo (§9.4)** is a placeholder in the spec *and has no mockup file at all* — not "not converted," genuinely not designed. The Main Screen's "Create ToDo" button and tapping a ToDo row both need somewhere to go. For Day 4 this can be stubbed (button present, does nothing yet, or a bare unstyled form) without blocking the rest of Main Screen.

**Detailed Item (§9.6)** — also placeholder, no mockup. This is what tapping a Sent or Received row is supposed to open. Same treatment: stub for now.

**"My Contacts" has no destination.** This is the one that's a genuine reopening, not just an unbuilt screen: §9.8 explicitly retired a standalone contact-browse screen in v2.7, on the grounds that contacts are only ever reached through Add Contact directly or the Create Request type-ahead. Housekeeping's "My Contacts — view and edit" implies tapping it lands somewhere showing your contacts, which is exactly the screen that was retired. Worth a real decision, not a default: does it link straight into Add Contact (misleading label — nothing to "view" there), or does this get designed as a genuine list screen (reopening §9.8), or does the Housekeeping copy change to something that doesn't imply a list exists?

## Open questions

Request description length — assumed 500 chars in the migration draft above, matching the app-wide convention Notes and Dialog both cite (§2.4), but I didn't find an explicit limit stated for Request/ToDo description specifically. Worth a one-line confirmation before Create Request's textarea gets a `maxLength`.

`profiles.time_zone` — added as a follow-up above rather than guessed at. IANA string, browser-detected at signup, is the obvious default; flagging in case you'd rather set it a different way (e.g. deferred entirely, evaluate Overdue in UTC for now).

`contacts.time_zone` — new 2026-08-05, added to the Add Contact mockups (`WYP_add_contact_palette1_floating.html`, `WYP_add_contact_no_contact_dialog_palette1.html`) but not yet in migration 003 or `AddContactForm.tsx`. Defaulting resolved 2026-08-06: pre-fill from the owner's own `profiles.time_zone` on the Add Contact form, editable. This makes `profiles.time_zone` a prerequisite — Add Contact's conversion now needs that column populated (or a client-side `Intl.DateTimeFormat().resolvedOptions().timeZone` fallback if `profiles.time_zone` isn't set yet) before the contact-side default has anything to read. See decisions log, 2026-08-05/06 entries.

Whether Day 5 goes to the duplicate-handling modal (polish, fully specified, no new decisions) or to unblocking Create/Edit ToDo or My Contacts (a real design pass) — your call once you see how Days 1–4 actually go.
