# Would You Please — Attachments plan

Scoping pass for Week 5 Priority 3 ("Real Attachments, gated on subscriber
tier"), which `WYP_Week5_Plan.md` left explicitly "not yet scoped in detail."
Nothing in this doc is built yet — it's the design pass that priority itself
called for, written up before touching code so the storage-policy and
size/type-limit decisions are settled once rather than discovered mid-build.

---

## Where this picks up

Priority 2 (Account, live) and the two follow-on account-simplification
batches are done, which changes one assumption `WYP_Week5_Plan.md` made:
that doc's Priority 2 section says the owner would flip his own
`profiles.tier` manually via the Supabase SQL editor to test Attachments.
That's superseded — Account now has a real "Subscribed? (testing only)"
`.checkrow` (migration 024, `AccountForm.tsx`) that does the same thing from
the UI. `WYP_Week5_Plan.md`'s own note should be corrected to point here
rather than left stale; not changed as part of this doc since it's a
one-line fix, easy to do alongside whenever that file is next touched.

## What already exists

The locked placeholder — `.donerow`/`.donenote`'s "Attachments are a
Subscription feature" note plus an inert `Add Attachment` button — is on six
screens: Create Request, Request Detail, Create ToDo, ToDo Detail, Request
Response, Response Detail. `.attitem`/`.attname`/`.attremove` already exist
as CSS/markup, reused from Dialog's staged-entry list, but have never
rendered a real file.

The entitlements principle is already settled, in CLAUDE.md, not something
this doc needs to re-decide: rights on a Request come from its issuer, never
the viewer; gates govern *adding*, never *viewing* — an attachment already on
a Request stays visible to everyone who can see that Request, permanently,
regardless of anyone's tier at the moment they look; and a lapsed
subscriber's files are reclaimed by lapse-and-auto-delete (PRD §6.3), which
leaves a tombstone rather than silently hiding the row.

Request Response and Response Detail already read `owner_tier` (migrations
011/012) and gate their Attachments segment on it — that plumbing is real,
just pointed at a feature that doesn't exist yet. The other four screens
(Create Request, Request Detail, Create ToDo, ToDo Detail) don't gate on
tier at all right now — they show the locked note unconditionally, which is
a gap this build needs to close (see Gating below).

Duplicate-name handling, delete permission, and the file-picker-first/
paste-as-enhancement interaction model are already decided — see the
decisions log's 2026-08-14 entries. They aren't re-litigated here, just
folded into the build.

---

## Recommendation: storage and schema

**Storage: Supabase Storage, one private bucket** (e.g. `attachments`), not
public. Consistent with everything else this app already runs on, and
matches the app's existing security posture — hashed tokens, `SECURITY
DEFINER` functions, "a client-supplied WHERE clause is not a permission
check" (CLAUDE.md's Database section) — better than a public bucket relying
on unguessable paths. Files stored under a path keyed by request, e.g.
`{request_id}/{attachment_id}-{file_name}`, with Storage policies scoped to
`authenticated` uploads for the Request's own owner. A signed-in recipient
(Response Detail) and an anonymous token recipient (Request Response) both
read via a signed URL issued by a new `SECURITY DEFINER` function —
mirroring `issue_request_link`'s own shape — rather than direct bucket
access, so the same "owner_tier read live, recipient identity verified
server-side" pattern this app already uses for Dialog and the response link
extends to file access too.

**A new `public.attachments` table**, RLS-scoped the same way `dialog` is:

```
id            uuid primary key default gen_random_uuid()
request_id    uuid not null references requests(id)
uploaded_by   uuid not null references auth.users(id)
file_name     text not null
storage_path  text not null
size_bytes    bigint not null
mime_type     text not null
created_at    timestamptz not null default now()
deleted_at    timestamptz          -- tombstone, not a hard delete, per
                                    -- CLAUDE.md's Entitlements section
```

Owner can select/insert on their own Requests' rows, same as `dialog`.
Delete needs its own policy shaped around the question flagged below — "only
the person who added an attachment should be able to delete it" is already
decided in principle, but exactly who that excludes needs confirming before
the policy is written (see Open questions, #1). Recipient reads/writes go
through functions (`add_attachment_by_token`/`add_attachment_as_recipient`,
mirroring the Dialog pair), never a policy, for the same category-hiding
reason `get_request_by_token` already can't be a plain `select`.

**Gating**, closing the gap noted above: Create Request, Request Detail,
Create ToDo, and ToDo Detail are sender-side screens, where the person
adding an attachment is the signed-in user — Add Attachment there should
read that user's own `profiles.tier` (a trivial addition to the `profiles`
fetch each of those four components already makes for
`display_name`/`private_category_enabled`/etc.), not `owner_tier`.
`owner_tier` stays correct as-is for the two recipient-side screens, where
the viewer's rights come from whoever sent the Request, not their own tier.

---

## Open questions for the owner

1. **Delete permission scope.** "Only the person who added an attachment
   should be able to delete it" — does that mean literally only the
   uploader, to the point that a Request's own owner can't delete a file a
   recipient attached to their own Request? That's an unusual rule (the
   owner can't remove content on something they sent) and worth confirming
   deliberately rather than assumed either way.
2. **File size limit.** No number has been discussed. Needs one before the
   upload UI can show/enforce it.
3. **Allowed file types.** Restrict to common types (PDF, images, Office
   docs) or allow anything? If restricted, the limitation needs to be
   explained to the end user (already noted in the decisions log) — the
   exact copy depends on what the actual list is.
4. **Max attachments per Request/ToDo.** Not discussed at all so far —
   worth an explicit cap rather than defaulting to unlimited by omission.
5. **Lapse-and-auto-delete job.** PRD §6.3 already describes the policy;
   nothing schedules it yet. Build it as part of this same priority, or
   treat it as its own later piece of work? It's a scheduled job (Vercel
   Cron vs. `pg_cron`), the same open shape of question already flagged for
   the Reminder email in `WYP_Week5_Plan.md` — could plausibly share
   whichever mechanism gets picked there.
6. **ToDos.** The locked placeholder appears on Create ToDo/ToDo Detail too,
   but a ToDo has no recipient to share a file with — only the owner's own
   later reference. Confirm Attachments on ToDos is still wanted as part of
   this build, not just on Requests.
7. **Print Reports icon slot.** Dialog already gets an icon next to a
   printed row when a Request has entries; add the equivalent for
   Attachments now, or defer until attachments are common enough to be
   worth the print real estate?

---

## Suggested build order, once the above is answered

1. Migration: `attachments` table, RLS, Storage bucket + policies, and the
   two new `SECURITY DEFINER` functions for recipient access (list + signed
   URL).
2. Sender-side upload/list/delete on Create Request + Request Detail — the
   most-used flow, and proves the pipeline end to end against the owner's
   own account before touching the recipient path.
3. Same for Create ToDo + ToDo Detail, if question #6 confirms ToDos are in
   scope.
4. Recipient-side: Request Response (anonymous token) + Response Detail
   (signed-in recipient) — read via signed URL; upload via the
   `_by_token`/`_as_recipient` function pair, matching Dialog's existing
   precedent.
5. Print Reports icon slot (question #7) and, if wanted, a Main Screen row
   indicator mirroring the existing Dialog count.
6. Lapse-and-auto-delete scheduled job (question #5) — likely its own
   follow-up priority rather than bundled into the first pass, given it's a
   different shape of work (a cron job, not a UI feature) and depends on
   whichever scheduler gets picked for the Reminder email.
