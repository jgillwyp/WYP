# Would You Please — Week 3 plan

## Closing out Week 2 first

Request description length is settled and already done, not just decided: every Description field (`CreateRequestForm.tsx`, `CreateTodoForm.tsx`, `RequestDetailForm.tsx`, `TodoDetailForm.tsx`) already carries `maxLength={500}`, matching the app-wide 500-char convention Notes and Dialog both use. No DB-level check constraint exists for it, but nothing else in the schema enforces text length that way either (Notes, Dialog body, Description all rely on the client-side `maxLength` alone) — so leaving it as a client-enforced convention is consistent with everything else here, not a gap. Nothing to build.

**Week 2 is now fully closed.** `WYP_Week2_Plan.md`'s open-questions section actually had three items, not one — `profiles.time_zone` and `contacts.time_zone` were the other two, flagged here as unresolved when this plan was first written. Both are now handled: migration 007 (drafted, `docs/Week3 - SQL history.txt`) adds the columns, and Add Contact/Contact Detail render a working required Time Zone lookup with the defaulting-and-write-back chain described in the decisions log's 2026-08-09 entry. Day 5 below no longer needs to carry this as a stretch item.

---

## Recommendation: build the secure recipient link (`/r/[token]`)

This is the one piece of the product that's been explicitly deferred since Week 1 on a stated condition — CLAUDE.md's Scope discipline section says outright: *"The secure recipient link is built only after the stack is proven on Add Contact."* That condition is now met several times over: Add Contact, Create Request, Create ToDo, Main Screen, all four Detail screens, and Contacts are live. The Database section of CLAUDE.md already describes the intended shape in detail — `digest(token,'sha256')`, enforced expiry/revocation inside a `SECURITY DEFINER` function, a generic failure message for every failure case, multi-use rather than single-use tokens, and `events` as the access log rather than consuming the token — which reads like groundwork laid for exactly this week, not a coincidence. The `events` table (migration 002) already has `'link'` as a valid `subject_type` and an `actor_label` column specifically for "recipient name for unauthenticated actors," both unused until now.

Received Requests and the Search Results screen are both explicitly out of scope this week — you've deferred Received until its own schema/RLS question gets a real design pass, and Search Results/PRD §3.1 until Received is functioning. Good call to keep those parked; the recipient link doesn't depend on either.

### Day 1 — Migration 008: token infrastructure — DRAFTED, ready to run

**Renumbered from 007** — this section originally called it migration 007, written before the Time Zone work claimed that number the same day. Now migration 008, in `docs/Week3 - SQL history.txt`.

Shape as recommended: three columns directly on `requests` (`link_token_hash` bytea, `link_expires_at`, `link_revoked_at`) rather than a separate `request_links` table — matches the app's existing preference for one table over a normalized split (§2.5's "ToDos are stored as Requests" reasoning), and nothing here needs link *history*, just one live, regenerable link per Request. The `events` read policy migration 002 deferred is added too, scoped to `request_id in (select id from requests where owner_id = auth.uid())` — and, since migration 002 also fully revoked table privileges from every client role, an explicit `grant select ... to authenticated` alongside the policy; either alone still denies everything.

Three `SECURITY DEFINER` functions — one more than originally planned:
- `issue_request_link(p_request_id uuid)` — owner-only. Generates a token, stores only its hash, sets a 30-day expiry, clears any prior revocation, returns the raw token once (never stored in plaintext). Regenerating silently invalidates whatever token existed before.
- `revoke_request_link(p_request_id uuid)` — owner-only. **Added beyond the original two-function plan**: `link_revoked_at` had no other way to ever get a value, so building the column without this would leave it permanently dead. Day 4's UI can decide later whether to actually expose a Revoke control — the capability existing doesn't force that decision now.
- `get_request_by_token(p_token text)` — the anonymous read path. Verifies the hash, checks expiry/revocation, logs an `events` row (`subject_type = 'link'`, `action = 'viewed'`) on every call (multi-use, never consumed), and returns a single `jsonb` payload — Request fields, Contact/Category names, full Dialog thread — so the Days 2–3 screen needs one RPC call. Same generic error for every failure — not found, expired, or revoked — so a bad guess can't be distinguished from an expired link. `set search_path = public, extensions` (`digest`/`gen_random_bytes` live in `extensions`); `revoke all ... from public` before granting `execute` (to `authenticated` for the two owner-only functions, to `anon, authenticated` for this one).

**Flagged, not assumed**: the 30-day link expiry isn't specified anywhere in the PRD — chosen because Dialog "continues over days or weeks" (CLAUDE.md's own wording) and a Request's own Due Date is usually inside that window. Confirm or adjust before this is run.

A fourth function, `submit_request_response(...)`, is Day 3's concern once the response fields are known — sketched there, not here.

### Days 2–3 — Convert Request Response (`WYP_respond_to_request_palette1.html` → `/r/[token]`) — **DONE, 2026-08-10**

No `RequireAuth` — this is the one screen in the app an anonymous visitor reaches. Fetches through `get_request_by_token`, never a raw `select` on `requests` (there is no `anon` policy on that table, by design — see CLAUDE.md's Database section on why a client-supplied `WHERE` clause is not a permission check). Renders the real Done Date/Time fields (as live editable pickers, not the mockup's static preview — see decisions log 2026-08-10), the real Dialog thread with the same dynamic Answer/which-Question-picker logic already built for Request Detail and ToDo Detail, and Attachments in its existing locked/paid-tier state — no new attachment logic this week, matching the Scope discipline note that attachments stay deferred.

**Naming correction**: this section originally sketched a single write function, `submit_request_response`. What actually got built (migration 009) is two narrower functions instead — `set_response_done_by_token` (Done Date/Time) and `add_dialog_by_token` (Dialog entries) — each logging its own `events` row. Split rather than combined because Add Dialog writes immediately from its own modal (same "write-through" pattern as Request Detail), independent of when/whether Send is ever pressed.

**No name collection — settled.** *"The response needs to be as frictionless as possible."* The recipient isn't asked for anything before responding. Dialog entries written through this path show the Request's own Contact `display_name` as `who`, since that's already known server-side and costs the visitor nothing to supply. `events.actor_label` stays unset for this path rather than populated from a field that doesn't exist.

Built: `app/components/RequestResponseForm.tsx`, `app/r/[token]/page.tsx`. The signed-in-subscriber reuse of this same screen from a Received row (raised by the owner alongside this task) is explicitly deferred — Received has no live data path yet.

### Day 4 — Surface the link somewhere a sender can reach it — **DONE, 2026-08-10**

Real email delivery is explicitly deferred (SPF/DKIM/DMARC is called out by name in Scope discipline), so Week 3's version of "send" is a copy-link affordance rather than an actual email — added to Request Detail, directly under the existing notice band about recipient notification: a "Get Response Link" button that calls `issue_request_link`, then shows the resulting `/r/[token]` URL with Copy and Regenerate. This is enough to test the full loop end to end — create a Request, get a link, open it as a "different person" in a private window, respond, see it reflected back on Request Detail — without needing SMTP this week.

**Migrations 008 and 009 confirmed run by the owner, 2026-08-10.** The feature is live end to end: open any existing Sent Request (`/requests/[id]`) and click "Get Response Link" to get a real, working `/r/[token]` URL. `issue_request_link` is owner-only and its raw token is never stored anywhere — only its salted hash — so a link can only ever come from that button, not from a query or migration.

### Day 5 / stretch — **DONE, 2026-08-10**

Time Zone is done (see above), so this was down to one small, already-open item: add the missing Due Date field to Create ToDo, flagged since it went live, so ToDos match the PRD's core-objects table instead of the mockup's current omission. Added as a real, optional field — `requests.due_date` was already a plain nullable column, so no schema change or sentinel-value workaround was needed. Also added to ToDo Detail beyond the literal ask, so a Due Date set at creation isn't a dead end once saved. See the decisions log's 2026-08-10 entry for the full reasoning. **Week 3 is now fully closed.**

---

## Settled

**Recipient name — not collected.** See Days 2–3 above.

**Token storage — columns on `requests`, not a separate table.** The question of when a separate `request_links` table would actually be necessary: only if you want a UI showing every link ever issued for a Request (link history), or if the access log needs to distinguish which specific link-version a given open used. Neither is a stated product requirement, and the security property that actually matters — an old, regenerated token failing verification — falls out of overwriting the hash on regenerate; no history table needed to get it. Staying with the simple three-column shape from Day 1. Revisit if a link-history feature ever gets asked for.

**Migration 006 — confirmed run.** No longer a risk to check; Request Detail and ToDo Detail's Dialog panels are on solid ground.
