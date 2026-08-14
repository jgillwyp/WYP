# Would You Please — Attachments plan

**STATUS: Built and live, 2026-08-14 — see the decisions log's "Real
Attachments built (Week 5 Priority 3)" entry and CLAUDE.md's Known gaps for
what actually shipped.** Migrations 025/026/027 are confirmed run by the
owner, 2026-08-14, and `SUPABASE_SERVICE_ROLE_KEY` is confirmed set in both
`.env.local` and Vercel, 2026-08-14 — the feature is live, pending the
owner's own end-to-end test. This doc is kept as the historical scoping
record; the resolved answers below matched what was actually built.

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

**A new `public.attachments` table**, RLS-scoped the same way `dialog` is.
One table covers both real uploaded files (Requests) and the ToDo-only
"Location" references decided below (#6) — a `kind` column distinguishes
them rather than splitting into two tables:

```
id             uuid primary key default gen_random_uuid()
request_id     uuid not null references requests(id)   -- ToDos are rows in
                                                          -- requests too, so
                                                          -- this covers both
uploaded_by    uuid not null references auth.users(id)
kind           text not null default 'file'             -- 'file' | 'reference'
file_name      text                                      -- required, kind='file'
storage_path   text                                      -- required, kind='file'
size_bytes     bigint                                    -- required, kind='file'
mime_type      text                                      -- required, kind='file'
reference_url  text                                      -- optional, kind='reference'
reference_note text                                      -- optional, kind='reference'
created_at     timestamptz not null default now()
deleted_at     timestamptz          -- tombstone, not a hard delete, per
                                     -- CLAUDE.md's Entitlements section
```

A `check` constraint enforces the two shapes don't cross (`file_name`/
`storage_path`/`size_bytes`/`mime_type` all required when `kind = 'file'`
and all null otherwise; at least one of `reference_url`/`reference_note` set
when `kind = 'reference'`). Requests only ever produce `kind = 'file'` rows;
ToDos only ever produce `kind = 'reference'` rows — nothing in the schema
forces that split, it's enforced by which screens ever call insert with which
`kind`, matching the pattern `dialog.kind` already uses (Request/ToDo forms
never insert an Answer as a first entry; that's a client-side rule too, not a
constraint).

**Delete policy, resolved (#1 below): the Request/ToDo owner can always
delete any attachment on their own item; a non-owner uploader (a Request's
recipient) can only delete their own.** In SQL: `delete using (uploaded_by =
auth.uid() or request_id in (select id from requests where owner_id =
auth.uid()))`. For ToDos this collapses to just "owner can delete" — a ToDo
has no recipient, so `uploaded_by` is always the owner already. Recipient
reads/writes go through functions (`add_attachment_by_token`/
`add_attachment_as_recipient`, mirroring the Dialog pair), never a policy,
for the same category-hiding reason `get_request_by_token` already can't be
a plain `select`.

**Gating**, closing the gap noted above: Create Request, Request Detail,
Create ToDo, and ToDo Detail are sender-side screens, where the person
adding an attachment is the signed-in user — Add Attachment there should
read that user's own `profiles.tier` (a trivial addition to the `profiles`
fetch each of those four components already makes for
`display_name`/`private_category_enabled`/etc.), not `owner_tier`.
`owner_tier` stays correct as-is for the two recipient-side screens, where
the viewer's rights come from whoever sent the Request, not their own tier.

---

## Resolved decisions

1. **Delete permission** — confirmed: the Request/ToDo owner has full
   delete control over every attachment on their own item, including ones a
   recipient added; a non-owner (a Request's recipient) can only delete
   their own. See the schema section above for the exact policy shape.
2. **File size limit** — no number was specified; recommending 10 MB per
   file as a starting default (comfortably covers scans, photos, most
   office docs), enforced via a single constant so it's trivial to raise
   later. This is a recommendation, not a confirmed number — say the word
   if a different limit is wanted.
3. **Allowed file types** — no restriction wanted beyond avoiding types
   that shouldn't be supported. Recommending a small blocklist rather than
   an allowlist: reject executable/installer/script extensions (`.exe`,
   `.msi`, `.bat`, `.cmd`, `.com`, `.scr`, `.ps1`, `.sh`, `.jar`, `.app`,
   `.dmg`) since Request Response accepts uploads from anonymous,
   unauthenticated recipients; everything else — documents, images, PDFs,
   archives, media, anything else — is allowed. On the virus-scanning
   question: Supabase Storage has no built-in scanning; a real answer would
   mean wiring in a third-party scanning service (e.g. an API like
   VirusTotal, or a hosted ClamAV), which is meaningfully more
   infrastructure than this pass is scoped for. Recommending that stay out
   of scope for v1 — the extension blocklist is the practical mitigation,
   and the recipient's own device security is the remaining line of
   defense, consistent with how most products this size operate before
   real scale. Worth revisiting if this app ever takes uploads at volume.
4. **Max attachments per Request/ToDo** — 10.
5. **Lapse-and-auto-delete job** — deferred to a later priority, as
   suggested; tracked here and in the build order below so it isn't lost,
   not built this pass.
6. **ToDos: Attachment References ("Locations") instead of real storage**
   — yes, practical, and a real improvement over storing a redundant copy
   of something the owner already has somewhere else. Recommending it reuse
   the same `attachments` table (see the `kind` column above) rather than a
   second table or a second set of list/delete/count-cap components — a
   ToDo's Add Attachment becomes "Add Location," its list becomes locations
   instead of files, but the delete rule, the 10-item cap, and the
   panel/empty-state markup are all identical either way.

   Add Location prompts for two fields: an optional **Description** and the
   **Location** itself (a file path or URL). Description is captured first
   and, when present, renders before the location value in the list — a
   short label line above the (possibly long, possibly cryptic) path or
   link, the same relationship Dialog's own `.dlgre`/`.dlgbody` pairing
   already uses for a reply's context line above its body. An entry with no
   Description just shows the location value alone.

   One practical note worth flagging: a typed-in local file path
   (`C:\Users\...`) is only ever meaningful text to whoever reads it back
   later — the app has no access to the user's filesystem and can't open,
   verify, or even confirm the path still exists. Only a well-formed
   `http(s)://` value should render as an actual clickable link; anything
   else displays as plain, unlinked text. Alternative considered and
   rejected: a separate `todo_references` table, which would cleanly
   separate the two concepts but duplicates nearly every column and every
   UI component for no real benefit, and would foreclose ever giving a
   Request a lightweight reference-style entry later (e.g. a sender linking
   to a Google Doc instead of uploading a copy) without a third table down
   the line.
7. **Print Reports icon slot** — add it now, alongside Dialog's existing
   icon.

---

## Suggested build order

1. Migration: `attachments` table (with `kind`, the two-shape check
   constraint, and the delete policy above), Storage bucket + policies for
   `kind = 'file'` uploads, and the two new `SECURITY DEFINER` functions
   for recipient access (list + signed URL).
2. Sender-side upload/list/delete on Create Request + Request Detail — the
   most-used flow, and proves the pipeline end to end against the owner's
   own account before touching the recipient path. Includes the
   print-report icon slot for Sent/Received at the same time, since both
   draw from the same row data.
3. Locations on Create ToDo + ToDo Detail — same panel, `kind = 'reference'`
   instead, Add Attachment relabeled Add Location with the
   Description-then-Location field order above.
4. Recipient-side: Request Response (anonymous token) + Response Detail
   (signed-in recipient) — read via signed URL; upload via the
   `_by_token`/`_as_recipient` function pair, matching Dialog's existing
   precedent.
5. Lapse-and-auto-delete scheduled job — its own follow-up priority, not
   bundled into this pass, given it's a different shape of work (a cron
   job, not a UI feature) and depends on whichever scheduler gets picked
   for the Reminder email.
