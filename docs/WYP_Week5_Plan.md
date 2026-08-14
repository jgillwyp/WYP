# Would You Please — Week 5 plan

## Closing out Week 4 first

Both Week 4 migrations verified directly against the database, not just
trusted from the docs' own prior claims — the owner reported the Supabase
SQL editor's History view only showing entries through migration 011, worth
taking seriously rather than assuming stale. A `pg_proc` lookup confirmed
migration 012's four functions exist; an `information_schema.
column_privileges` lookup confirmed migration 013's grant is in place.
**Week 4 is fully closed** — Received Requests, column-header sorting, and
Expanded screens (dropped, not built) all resolved. Two items stay
explicitly flagged rather than closed, both by the owner's own choice: the
PRD/UI-spec formal revision for the dropped Expand/Contract feature and the
now-stale "Overdue doesn't apply to ToDos" wording ("We can leave the
document updates flagged for later").

---

## Ordering, and why

Owner: "It seems like the order of these items should be email sending,
account screen, real attachments (based on an account screen status of
subscribed)." Attachments' Add Attachment control already gates on
`profiles.tier` read live (Entitlements section, CLAUDE.md) — but there's
never been a live way to see or change that value anywhere in the app, so
testing the gate meaningfully needs the Account screen (or some way to set
`tier`) before Attachments work is worth doing. Email sending goes first
because PRD §7.3's templates are already fully specified and don't depend
on either of the other two.

---

## Priority 1: Email sending infrastructure

**Status, 2026-08-12: buildable-now parts done, provider switched to
Hostinger, credentials wired.** `app/src/lib/email.ts` (template rendering),
`app/api/email/send-request/route.ts` (the send path), the
`CreateRequestForm.tsx` call site, and the Tight-window advisory note are all
built and typecheck/lint clean. The owner signed up for Hostinger's mailbox
hosting rather than Resend (the placeholder this doc originally assumed) —
`notifications@wouldyouplease.com` — and the route now sends via `nodemailer`
over SMTP instead of Resend's REST API. Credentials are in `.env.local`
(git-ignored) as `EMAIL_SMTP_HOST`/`EMAIL_SMTP_PORT`/`EMAIL_SMTP_USER`/
`EMAIL_SMTP_PASSWORD`. **Not yet verified end-to-end** — this session's own
sandbox can't reach `smtp.hostinger.com` (network allowlist), so the actual
send needs to be tested from the owner's own machine (`npm run dev`) or from
Vercel once the same 4 env vars are added there under Settings ->
Environment Variables. Still open: the Reminder email's scheduled job
(Vercel Cron vs. `pg_cron`, below). See the decisions log's two 2026-08-12
entries for the full write-up.

PRD §7.3 (v12.9) already has literal to:/from:/subject:/body: templates for
an Initial Request email and a day-before Reminder email, plus the
Tight-window rule (a Request due in under 24 hours gets no Reminder; the
sender is advised at Send time instead) — see the decisions log, 2026-08-11.
(CLAUDE.md's Scope discipline section listed "email deliverability
(SPF/DKIM/DMARC)" as deliberately deferred until prompted — this is that
prompt.)

**Provider: Hostinger mailbox + SMTP (`nodemailer`), not Resend** — the
owner signed up for Hostinger's own mailbox hosting rather than a
transactional-email API, superseding this doc's original Resend
assumption below (kept for history, not current):
- ~~A Resend account and API key~~ — done differently: a Hostinger mailbox,
  `notifications@wouldyouplease.com`, with SMTP credentials now in
  `.env.local` (`EMAIL_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`).
- A sending domain with SPF/DKIM/DMARC — still applies regardless of
  provider, per the From-address deliverability conflict already flagged
  and resolved in the PRD (2026-08-11 decisions log entry); not yet
  confirmed done on Hostinger's end.

**Still needed from the owner**: add the same 4 `EMAIL_SMTP_*` values to
Vercel's own Environment Variables (Settings -> Environment Variables,
Production + Preview) so the deployed app can send, not just local dev —
not done from this session, since writing deployment settings wasn't asked
for. This session's own sandbox also can't reach `smtp.hostinger.com` to
verify the send actually works (network allowlist) — worth a real test from
`npm run dev` locally, or from Vercel once configured there.

**All built**: the email-sending module (template rendering from Request
data, matching PRD §7.3's literal wording), the send-on-create call site in
`CreateRequestForm.tsx`, the Tight-window rule's Send-time advisory UI, and
the actual `nodemailer`/SMTP send call — wired and typecheck/lint clean, not
yet verified against a real inbox (see above).

**Open decision, not yet made**: the day-before Reminder needs a scheduled
job — Vercel Cron (simplest, matches the existing Vercel-deploys-on-push
setup) vs. Supabase's own `pg_cron` (keeps the schedule next to the data it
reads). Vercel Cron is the likely default given this app's existing
infrastructure, but not confirmed.

**Also open**: PRD §7.3's 24-hour Tight-window threshold is flagged in its
own text as "a proposed default, unconfirmed" — worth confirming or
revising before the Reminder logic is actually built against it.

---

## Priority 2: Your Account screen, live

Currently mockup-only (`WYP_your_account_palette1_floating.html`) — there is
no `/account` route at all yet, unlike `/account/new` (Create Free Account),
which already went live in Week 4. Converts the existing mockup fields
(First/Last/Display Name, Phone, Notify Me By, Change Email button) the same
way Create Free Account did, plus one new piece not in the current mockup:
**a tier/subscription-status display**.

**Subscribe mechanism — resolved 2026-08-12, revised 2026-08-14.**
`profiles.tier` was deliberately not writable by a signed-in user (migration
002: `authenticated` never got column-level UPDATE on `tier`; only
`service_role` could change it, reserved for a future billing webhook) — so
there was no live path from this screen to `tier = 'subscriber'` without
either real payment processing or a stand-in. Originally planned as a
read-only tier display plus the owner flipping his own profile's `tier`
manually via the Supabase SQL editor. **Superseded, 2026-08-14**: Account
instead gained a real "Subscribed? (testing only)" `.checkrow` (migration
024, `AccountForm.tsx`) that writes `tier` directly from the UI — a
deliberate, flagged reopening of the grant migration 002 withheld, framed
explicitly as temporary and meant to be revoked or replaced once real
billing exists. See the decisions log's 2026-08-14 entry and
`docs/WYP_Attachments_Plan.md`. Real payment processing (Stripe or similar
— checkout flow, subscription lifecycle webhooks) stays explicitly
deferred.

**Change my email address** stays a `.btn-quiet` with no handler, same as
Create Free Account's mockup precedent — the actual change-email flow
(verification, confirming from both addresses) is intentionally undesigned
per the decisions log, not part of this priority's scope.

---

## Priority 3: Real Attachments, gated on subscriber tier

**Built and live, 2026-08-14** — see `docs/WYP_Attachments_Plan.md` (the
scoping pass this section's own "not yet scoped in detail" called for) and
the decisions log's "Real Attachments built" entry for what actually
shipped. Migrations 025/026/027 are confirmed run by the owner, 2026-08-14,
and `SUPABASE_SERVICE_ROLE_KEY` is confirmed set in both `.env.local` and
Vercel, 2026-08-14. Rest of this section retained for history.

The v1 "locked, paid feature" placeholder — `.donerow`/`.donenote`'s
"Attachments are a Subscription feature" note plus an inert `Add Attachment`
button — has existed on every screen that shows it (Create Request, Create
ToDo, Request Detail, ToDo Detail, Request Response, Response Detail) since
this app's earliest mockups, but no attachment has ever actually been
uploaded, stored, or displayed anywhere in the app. This priority makes it
real: file upload, storage, and the populated-state UI (`.attitem`/
`.attname`/`.attremove` already exist as CSS/markup patterns, reused from
Dialog's staged-entry list, but have never rendered a real file).

**Not yet scoped in detail** — storage provider (Supabase Storage is the
likely default, given everything else already lives there, but not
confirmed), file size/type limits, and how the Entitlements section's
existing rule ("Gates govern adding, never viewing — attachments already on
a request stay visible to everyone, permanently, whatever anyone's tier is
now") interacts with a lapsed subscriber's already-uploaded files, all need
a design pass before implementation starts. Comes after Priority 2 lands,
since testing the gate meaningfully depends on being able to see/set tier
at all.
