# Would You Please — Week 3 plan

## Closing out Week 2 first

Request description length is settled and already done, not just decided: every Description field (`CreateRequestForm.tsx`, `CreateTodoForm.tsx`, `RequestDetailForm.tsx`, `TodoDetailForm.tsx`) already carries `maxLength={500}`, matching the app-wide 500-char convention Notes and Dialog both use. No DB-level check constraint exists for it, but nothing else in the schema enforces text length that way either (Notes, Dialog body, Description all rely on the client-side `maxLength` alone) — so leaving it as a client-enforced convention is consistent with everything else here, not a gap. Nothing to build.

**Week 2 is now fully closed.** `WYP_Week2_Plan.md`'s open-questions section actually had three items, not one — `profiles.time_zone` and `contacts.time_zone` were the other two, flagged here as unresolved when this plan was first written. Both are now handled: migration 007 (drafted, `docs/Week3 - SQL history.txt`) adds the columns, and Add Contact/Contact Detail render a working required Time Zone lookup with the defaulting-and-write-back chain described in the decisions log's 2026-08-09 entry. Day 5 below no longer needs to carry this as a stretch item.

---

## Recommendation: build the secure recipient link (`/r/[token]`)

This is the one piece of the product that's been explicitly deferred since Week 1 on a stated condition — CLAUDE.md's Scope discipline section says outright: *"The secure recipient link is built only after the stack is proven on Add Contact."* That condition is now met several times over: Add Contact, Create Request, Create ToDo, Main Screen, all four Detail screens, and Contacts are live. The Database section of CLAUDE.md already describes the intended shape in detail — `digest(token,'sha256')`, enforced expiry/revocation inside a `SECURITY DEFINER` function, a generic failure message for every failure case, multi-use rather than single-use tokens, and `events` as the access log rather than consuming the token — which reads like groundwork laid for exactly this week, not a coincidence. The `events` table (migration 002) already has `'link'` as a valid `subject_type` and an `actor_label` column specifically for "recipient name for unauthenticated actors," both unused until now.

Received Requests and the Search Results screen are both explicitly out of scope this week — you've deferred Received until its own schema/RLS question gets a real design pass, and Search Results/PRD §3.1 until Received is functioning. Good call to keep those parked; the recipient link doesn't depend on either.

### Day 1 — Migration 007: token infrastructure

Recommended shape: three columns directly on `requests` (`link_token_hash`, `link_expires_at`, `link_revoked_at`) rather than a separate `request_links` table — matches the app's existing preference for one table over a normalized split (§2.5's "ToDos are stored as Requests" reasoning), and nothing here needs link *history*, just one live, regenerable link per Request. Plus the read policy `events` has been missing since migration 002 flagged it as deferred — add it now, scoped to `request_id in (select id from requests where owner_id = auth.uid())`, so a sender can finally see their own Request's access log.

Two `SECURITY DEFINER` functions:
- `issue_request_link(request_id uuid)` — generates a token, stores only its hash, sets an expiry, returns the raw token once (never stored in plaintext). Callable by the owner only.
- `get_request_by_token(token text)` — the anonymous read path. Verifies the hash, checks expiry/revocation, logs an `events` row (`subject_type = 'link'`, `action = 'viewed'`), and returns the Request + its Dialog thread. Same generic error for every failure — expired, revoked, or simply wrong — so a bad guess can't be distinguished from an expired one. `set search_path = public, extensions` (`digest` lives in `extensions`); `revoke all ... from public` before granting `execute` to `anon`.

A third function, `submit_request_response(...)`, is Day 3's concern once the response fields are known — sketched there, not here.

### Days 2–3 — Convert Request Response (`WYP_respond_to_request_palette1.html` → `/r/[token]`)

No `RequireAuth` — this is the one screen in the app an anonymous visitor reaches. Fetches through `get_request_by_token`, never a raw `select` on `requests` (there is no `anon` policy on that table, by design — see CLAUDE.md's Database section on why a client-supplied `WHERE` clause is not a permission check). Renders the existing Done Date/Time fields, the real Dialog thread with the same dynamic Answer/which-Question-picker logic already built for Request Detail and ToDo Detail, and Attachments in its existing locked/paid-tier state — no new attachment logic this week, matching the Scope discipline note that attachments stay deferred. Submitting calls `submit_request_response`, a `SECURITY DEFINER` write function that updates Done Date/Time and inserts Dialog entries on the recipient's behalf, and logs the write as its own `events` row.

**No name collection — settled.** *"The response needs to be as frictionless as possible."* The recipient isn't asked for anything before responding. Dialog entries written through this path show the Request's own Contact `display_name` as `who`, since that's already known server-side and costs the visitor nothing to supply. `events.actor_label` stays unset for this path rather than populated from a field that doesn't exist.

### Day 4 — Surface the link somewhere a sender can reach it

Real email delivery is explicitly deferred (SPF/DKIM/DMARC is called out by name in Scope discipline), so Week 3's version of "send" is a copy-link affordance rather than an actual email — recommend adding it to Request Detail, next to the existing notice band about recipient notification, calling `issue_request_link` and showing/copying the resulting URL. This is enough to test the full loop end to end — create a Request, get a link, open it as a "different person" in a private window, respond, see it reflected back on Request Detail — without needing SMTP this week.

### Day 5 / stretch

Time Zone is done (see above), so this is down to one small, already-open item: add the missing Due Date field to Create ToDo, flagged since it went live, so ToDos match the PRD's core-objects table instead of the mockup's current omission.

---

## Settled

**Recipient name — not collected.** See Days 2–3 above.

**Token storage — columns on `requests`, not a separate table.** The question of when a separate `request_links` table would actually be necessary: only if you want a UI showing every link ever issued for a Request (link history), or if the access log needs to distinguish which specific link-version a given open used. Neither is a stated product requirement, and the security property that actually matters — an old, regenerated token failing verification — falls out of overwriting the hash on regenerate; no history table needed to get it. Staying with the simple three-column shape from Day 1. Revisit if a link-history feature ever gets asked for.

**Migration 006 — confirmed run.** No longer a risk to check; Request Detail and ToDo Detail's Dialog panels are on solid ground.
