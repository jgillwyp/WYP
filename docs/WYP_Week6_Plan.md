# Would You Please — Week 6 plan

## Closing out Week 5

All three priorities landed, plus two items pulled forward from later batches:

- **Priority 1 (email sending)** — templates, send-on-create, Tight-window
  advisory, and the SMTP send path are all live and confirmed working from a
  real test send. **The one open piece is the Reminder email's own scheduled
  job** — this is Week 6's Priority 1, below.
- **Priority 2 (Account screen)** — live, and grew past its original scope:
  four toggles now (tier/testing, Private Category, Due/Done Time, ToDo
  Due/Done Dates), not just the one tier display originally planned.
- **Priority 3 (Attachments)** — live: real file upload/storage/delete for
  Requests, Locations for ToDos, both gated on `profiles.tier`.
- **Bonus, not originally scoped for Week 5**: Archive is live end-to-end
  (migration 028), and the AWS-vs-Vercel hosting cost question is answered —
  see `docs/WYP_Hosting_Cost_Crossover_Model.xlsx` (2026-08-14). No cost
  crossover inside 1,000–1,000,000 users; Vercel+Supabase stays cheaper
  throughout. No action needed on hosting for the foreseeable future.

One item stays explicitly open from Week 5, not forgotten: **migration 024**
(`profiles.tier` writable by `authenticated`, for the testing-only Subscribed?
toggle) **must be revoked or replaced by a real billing webhook before any
real second user or actual payment processing exists** — worth keeping in
mind now that a funded-investor conversation is somewhere on the horizon;
nothing to do about it yet, just flagging it stays live in `CLAUDE.md`.

---

## Priority 1: Reminder email cron job

PRD §7.3 already fully specifies the Reminder email's content (subject/body,
Tight-window exclusion under 24 hours) and `app/src/lib/email.ts` already
renders it — the only missing piece is *something that runs once a day and
calls it* for every Request due tomorrow.

**Recommendation: Vercel Cron**, not Supabase `pg_cron`.

- The send path already lives in a Vercel-hosted Next.js API route
  (`nodemailer` over SMTP, same Hostinger credentials). A Vercel Cron entry
  in `vercel.json` hitting a new `/api/cron/send-reminders` route keeps
  everything — code, secrets, deploys, logs — on one platform.
- `pg_cron` would mean scheduling from inside Postgres, but Postgres can't
  send SMTP mail on its own — that path needs `pg_net` or a separate Supabase
  Edge Function (a second serverless runtime, Deno, with its own secret
  configuration) just to reach the same `nodemailer` logic that already
  exists. More moving parts for no real benefit here.
- Cron jobs are free on every Vercel plan (per current pricing), so this
  isn't a cost consideration either way.

**What building this actually needs, flagged before starting rather than
discovered mid-build:**

1. **A new migration** — `requests` needs a `reminder_sent_at timestamptz`
   column (or equivalent) so the daily job is idempotent. Without it, a
   redeploy or a slow run that overlaps the next day's trigger could send a
   Request's reminder twice, or the job has no way to know which Requests it
   already handled today.
2. **Route protection** — Vercel Cron calls the route with a bearer token
   (`CRON_SECRET`, an env var you set), and the route should reject any
   request without it — otherwise `/api/cron/send-reminders` is a public URL
   anyone could hit repeatedly.
3. **Time zone**, flagged as a real open question, not a detail: "due
   tomorrow" depends on whose day it's measured in. A Request's `due_date` is
   a plain date with no zone attached; the recipient's `contacts.time_zone`
   (or the sender's own `profiles.time_zone`) is the only zone information on
   record. Worth deciding once, explicitly, rather than silently picking
   UTC and having reminders arrive at odd local hours.
4. **The 24-hour Tight-window threshold** is still marked in the PRD's own
   text as "a proposed default, unconfirmed" (2026-08-11) — this is the
   natural moment to confirm it, since the Reminder job is the first thing
   that actually depends on it operationally (Create Request's advisory note
   already uses it, but only as UI copy).

Open question for you before I start: confirm (or revise) the 24-hour
threshold, and pick a time-zone convention for "day before" (recipient's,
sender's, or a fixed one like account owner's `profiles.time_zone`).

---

## Later Week 6 agenda — from your message, not yet scoped

Logged here so nothing gets lost, in the order you raised them. None of
these are started; each needs a design pass with you before any code.

- **Screens review** — which additional screens the app still needs, to
  review together.
- **Reporting layouts** — yours to work out; I'll build from whatever you
  bring.
- **Attachment storage duration and volume** — the PRD itself already flags
  this as unresolved: §11 (2026-07-22 owner note) says the Storage
  Maintenance screen and the Subscription/Upgrade screen "can promise only
  'more'" until real storage-cost numbers exist. The hosting cost model just
  built covers compute/request costs, not a per-GB storage-overage number —
  that's a separate, smaller calculation once you have a duration/volume
  target in mind.
- **Storage management screen** — already has a mockup and route reserved
  (`design/screens/WYP_storage_maintenance_palette1.html`, planned
  `/storage`; the companion warning-strip component at
  `WYP_storage_warning_strip_palette1.html`), never converted to live. A
  natural pairing with the storage duration/volume question above, since the
  screen's own copy depends on that number existing.
- **Optional paid items/charges** — not yet scoped anywhere; PRD currently
  models one flat $17.95/year tier only, no add-on pricing.
- **eCommerce subscription (real Stripe)** — replaces migration 024's
  testing-only toggle with real checkout and lifecycle webhooks. Biggest
  single item on this list; worth its own dedicated planning pass once the
  storage/pricing questions above are settled, since add-on pricing likely
  shapes what the checkout flow needs to support (single tier vs. tier +
  add-ons).
