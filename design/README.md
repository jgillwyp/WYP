# WYP — Design

Static HTML mockups for every app screen, in palette 1. These are the design
source of truth: a screen is designed here first, reviewed here, then converted
to a React component under `app/`.

**This folder is not served.** It sits outside `public/`, so nothing here is
reachable from the live Vercel URL. It is also in `tsconfig.json`'s `exclude`
list, so nothing here is typechecked or can break a build.

## Folders

| Folder | Holds |
|---|---|
| `screens/` | Canonical, approved mockup for each screen — one file per screen |
| `drafts/` | Variants under discussion, and superseded work kept for reference |
| `spec/` | The UI spec the `§` comments in each mockup refer to |

## Screen map

| Screen | Mockup | Route | Status |
|---|---|---|---|
| Main (Requests + ToDos) | `screens/WYP_main_screen_palette1.html` | `/` | Mockup |
| Start Free Account / Sign In | `screens/WYP_signin_palette1_floating.html` | `/login` | Converted, **needs update** (React page lacks the two modes; title shortened from "Start my Free Account" 2026-08-07) |
| Create Free Account — first run | `screens/WYP_create_free_account_palette1.html` | `/account/new` | Mockup (title shortened from "Create my Free Account" 2026-08-07; Phone Row-Tinted, §6.25) |
| Your Account — returning | `screens/WYP_your_account_palette1_floating.html` | `/account` | Mockup (Phone Row-Tinted 2026-08-07, §6.25) |
| Add Contact | `screens/WYP_add_contact_palette1_floating.html` | `/contacts/new` | Converted (Save wires to `contacts`; First/Last Name collapsed to a single Name field 2026-08-07, writes only `display_name` — migration 005, run; Phone Row-Tinted while `sendBy === 'email'`, §6.25) |
| Respond to Request | `screens/WYP_respond_to_request_palette1.html` | `/r/[token]` | Mockup (Dialog/Attachments Add buttons moved above their panels 2026-08-07 — see §6.26; Add Dialog now opens a modal with a dynamic Answer chip and which-Question picker, §6.27; Answer entries show a "Re:" quote + bold body) |
| Create Request | `screens/WYP_create_request_palette1.html` | `/requests/new` | Converted (Send wires to `requests`; Recipient is a single Name lookup against `contacts.display_name` as of 2026-08-07 — was First/Last; Category lookup and Add Category are functional; Print is `window.print()`; Add Dialog opens a modal, §6.27 — Kind chips Question/Comment, Answer always locked since a Request starts with an empty thread; entries staged client-side and written to `dialog` — migration 004, run 2026-08-06, migration 006 not yet run — together with the Request on Send; Due Time/Category carry Row Tint when empty, white once filled (2026-08-07); required fields (Recipient, Due Date, Description) carry an Ink border, §6.26; Add Dialog/Add Attachment sit above their full-width boxes rather than beside them (§6.26, 2026-08-07); title shortened from "Create a Request"; Attachments stays in the v1 locked state, permanently Row-Tinted; no in-place no-contact interception yet — see §6.24 below) |
| Add Contact — no contact dialog | `screens/WYP_add_contact_no_contact_dialog_palette1.html` | `/contacts/new` | Mockup |
| Create ToDo | `screens/WYP_create_todo_palette1.html` | `/todos/new` | Mockup (§9.4 had no mockup at all before 2026-08-06 — see decisions log; title shortened from "Create a ToDo", stacked Dialog/Attachments action rows and Ink-bordered required Description added 2026-08-07; Add Dialog opens a modal, §6.27, same Question/Comment-only rule as Create Request) |
| Storage Maintenance | `screens/WYP_storage_maintenance_palette1.html` | `/storage` | Mockup (Close corrected from `.btn-secondary` to `.btn` 2026-08-07 — it's the only button on the band, so Secondary's "lower emphasis than a Primary sibling" meaning didn't apply) |
| Storage warning strip (§6.18) | `screens/WYP_storage_warning_strip_palette1.html` | — | Component study |

`WYP_component_states_palette1.html` (this folder, not `screens/`) is the
reference for every control state. It is not a screen.

## Sign-up flow

There is no sign-up screen, because `signInWithOtp` creates the account on first
use and cannot tell whether the address already exists. Both entry points make
the identical call; they differ only in wording, and the paths diverge *after*
the link is clicked, based on whether the user has a profile row yet.

```
sales page ──→ "Start my Free Account" ─┐
                                        ├─→ email sent ─→ [link] ─→ /auth/callback
returning  ──→ "Sign In" ───────────────┘                              │
                                                  profile row? ──no──→ Create my Free Account ──→ main
                                                        │
                                                       yes ─────────────────────────────────────→ main
```

Band label, form caption, and the confirmation line all change with the mode —
three strings, one screen. Only the join path mentions Create my Free Account,
because only the join path leads there.

Recipients reach the same funnel from the "Create your own Free Account" block
on Respond to Request.

Two rules fall out of this, both settled 2026-08-02:

- **First run shows Save only.** No Cancel, no Sign out. The user is
  authenticated but has no profile row, so an exit at that moment leaves an auth
  user who owns nothing and lands back on the same screen next time.
- **First run suppresses the subscription banner and ad slot.** An upsell and an
  ad before the person has seen the product is a poor first impression. Both
  appear on every screen after this one.

Status values: **Mockup** (design only) → **Converted** (React component exists)
→ **Live** (deployed and wired to real data).

## Conventions

**Naming:** `WYP_<screen>_palette<N>[_variant].html`

**One canonical file per screen.** Git holds the history — do not keep
`_old` / `_retired_<date>` copies alongside the current one. A retired `.tsx`
copy with a paste error inside `app/` broke the build on 2026-08-02; that is
the failure mode this rule exists to prevent.

**Self-contained files.** Images are embedded as data URIs and the only
external reference is the Inter webfont, so a mockup can be opened directly
from disk with no build step and no missing assets.

**Tokens are copied, not invented.** The `:root` block in every mockup must
match `app/globals.css`. Two reconciliations, both settled 2026-08-03: the
focused-field fill is `--focus-tint` everywhere (it was `--field` in four older
mockups and in `globals.css`), and the locked-control treatment is `.is-locked`
everywhere (Create Request briefly used a solid `--ink-soft` `.btn-locked`,
which read as an active button). When a mockup needs a component the system does not
have, add it with a `PROPOSED` comment and a `§` number so it can be folded
into the spec deliberately.

## Proposed components awaiting spec entry

§6 of the spec is occupied through **§6.18**. Anything new starts at §6.19 —
check the spec's table of contents before assigning a number.

| § | Class | Purpose | First used |
|---|---|---|---|
| §6.19 | `.btn-block` | Full-width primary action for auth screens, which have no band cluster | Sign In |
| §6.20 | `.checkrow` | Single persistent toggle; chips only cover either/or choices | Sign In |
| §6.21 | `.btn-quiet` | Global action that must stay reachable without competing with Create | Main screen — Log Out |
| §6.22 | `.is-locked` + `--locked-ink` / `--locked-border` | Action unavailable because of the request's tier | Respond to Request — Add Attachment |
| §6.10 variant | `.finput[readonly]` + `--locked` | Read-only field, for the email that is also the sign-in ID | Your Account |
| §6.23 | `.hkrows`/`.hkrow`/`.hktitle`/`.hknote` | Navigational row — bold Brand-Blue title, em-dash, regular Ink description, 2-line clamp (same visual language as the §6.5 ToDo row, distinct class since the meaning isn't Priority). No chevron: tappable by the same row-context convention as every other list row in the app. First entry point for Contacts and Account Profile, which otherwise have none — see decisions log 2026-08-05 | Main screen — Housekeeping |
| §6.24 | `.lookup-results`/`.lookup-item`/`.lookup-empty` | Pull-down list under a §6.16 lookup field. Neither the mockup nor the spec draws this state — only the resting field is shown, and the mockup's own comment ("selecting from either field's pull-down fills both fields") implies a list without designing one. Kept plain: Row Tint hover, Rule dividers, no new visual language. Needs a real design pass if it earns a dedicated screen state later. Behavior rule added 2026-08-07: on focus, browse the full list immediately if it has fewer than 12 options; at 12 or more, wait for typed input before showing anything (matching search-vs-browse UX conventions) — see `LOOKUP_BROWSE_THRESHOLD` in `CreateRequestForm.tsx`, meant to apply to every §6.24 lookup, not just Create Request's | Create Request — Recipient, Category |
| §6.25 | `.opt` (`.finput.opt`, `.ftextarea.opt`, `.ccode.opt`) + companion `.req` (`.finput.req`, `.ftextarea.req`, `.panel.req` on Respond to Request) | Squint-test cue: Row Tint at rest on optional/inactive fields, Ink border at rest on required fields, both white otherwise, both focusing to Focus Tint / Brand Blue like every field — the class names, not new colors. Rule, settled 2026-08-07, extended 2026-08-07: a field carrying `.opt` shows Row Tint only while empty (or, on Add Contact's Phone, while its governing state — `sendBy === 'email'` — says it isn't yet the active channel); once it holds content (or becomes active) it renders white like a required field. `.req` is the fields that are *always* white and additionally need the Ink border to read as required rather than merely optional-and-filled — added 2026-08-07 once it became clear a white required field and a white filled-optional field were indistinguishable. Applies to the country-code selector (`.ccode`) too, not just `.finput`/`.ftextarea` — same rule, same reasoning, one more selector on the same class. Reuses `--row-tint`/`--focus-tint`/`--ink`, no new token; two of the three tinted surfaces §3.3 permits plus the existing Ink text color repurposed as a border. **Scoped exception, deliberate, not an oversight**: Main Screen's search bar (Search Type, Search text) stays white-on-Band, not Row-Tinted, even though neither field is required — see decisions log, 2026-08-07, for the reasoning (the rule exists to contrast required against optional fields *within one form's completion task*; the search bar isn't a form and has no required sibling to contrast against) | Create Request — Recipient/Due Date/Description (`.req`), Due Time/Category/Dialog (`.opt`); Create ToDo — Description (`.req`), Category/Dialog (`.opt`); Respond to Request — Done Date/Done Time (`.panel.req`); Sign In — Email (`.req`); Add Contact / Add Contact (no-contact dialog) — Name/Email/Time Zone (`.req`), Phone/country code (`.opt`); Create Free Account / Your Account — First/Last/Display Name(/Time Zone on Create Free Account) (`.req`), Phone/country code (`.opt`) |
| §6.26 | `.fieldact` (Create Request/Create ToDo) / `.panelact`+`.panelfull` (Respond to Request) — companion pair: `.finput.req`/`.ftextarea.req` | Two related fixes, both 2026-08-07, both from the same Android-width review. (1) **Stacked action row**: Add Dialog / Add Attachment move off to their own row, right-aligned, above a full-width box — replaces the earlier `.frow.top`/`.attachrow`/`.panelrow` side-by-side layout, which gave the button a fixed width and starved a full-paragraph textarea or file list of horizontal space. Costs one line of vertical space to recover most of the row's width for the box that needs it. Respond to Request has no `.form`/`.fgroup` wrapper, so its variant (`.panelact` for the button row, `.panelfull` for the panel below) carries its own `padding:0 var(--pad)` rather than inheriting it. (2) **Required-field border**: `.req` sets a resting Ink (`var(--ink)`) border instead of Input Border, so a required field is visually distinct from an optional field that's merely been filled in (both otherwise render white per §6.25's rule). Uses the existing Ink token, not a literal black — the system has no pure-black token and #1F2933 reads as black at 1px; focuses to Brand Blue like every other field. Not applied on Respond to Request, which has no bordered required inputs | Create Request — Recipient/Due Date/Description (`.req`), Dialog/Attachments (`.fieldact`); Create ToDo — Description (`.req`), Dialog/Attachments (`.fieldact`); Respond to Request — Dialog/Attachments (`.panelact`/`.panelfull`) |
| §6.27 | `.modalhead` (§6.12 variant) + `.chiprow` + `.qpicker`/`.lookup-item.selected` + `.dlgre`/`.dlgbody` | **Add Dialog modal**, 2026-08-07, replacing the old always-visible inline Dialog textarea on Create Request/Create ToDo (Respond to Request never had an inline compose field — Add Dialog there previously did nothing in the mockup). `.modalhead` is a second §6.12 header shape — title and Cancel/Save share the top row, instead of Add Category's title-then-bottom-`.modalacts` — used because that's what the owner's own mockup for this modal draws; both shapes are now valid, chosen per modal. `.chiprow` is `.sendrow`'s Strip-backdrop properties under a neutral name (a Kind picker has nothing to do with delivery channel) holding three `.chip`s — Question, Answer, Comment. **Kind availability is context-dependent, not fixed**: on Create Request/Create ToDo, Answer is always `.chip.is-locked` — a Request or ToDo starts with an empty thread, so there is never anything yet to answer; on Respond to Request (and, later, Request Detail), Answer unlocks dynamically, enabled only when at least one Question in the thread is still open (unanswered) — owner's rule, 2026-08-07: "the 'answer' could not be the 1st entry, but either a question or a comment could be." **Which-Question picker** (`.qpicker`, rows styled with `.lookup-item`/`.lookup-item.selected`): shown only when Answer is selected and more than one Question is open; a single open Question links silently, no picker, per the owner's explicit scoping ("it only needs to be presented if there is more than one question"). Defaults to the most recently created open Question. Needs `dialog.replies_to_id` (migration 006, not yet run) to know which Question an Answer answers — without it, "open" could only be tracked as one flag for the whole thread, which breaks with more than one Question open at once. **Display stays entry order, not re-threaded** — owner confirmed this explicitly ("That strategy would keep the 'order of entry' true"): an Answer still renders wherever it was posted in the newest-first list, not moved next to its Question. What changes is `.dlgre`/`.dlgbody`: an Answer row gets a small italic "Re: `<question, truncated>`" line (`.dlgre`, single-line ellipsis like `.attach`'s filename truncation, not the 2-line Description rule) plus a bolded body (`.dlgbody`) — the reader gets the link without the list itself moving. Bold was chosen over a new text color for the body: Brand Blue and Alert Red are both already committed to other meanings (§3.1), and reusing bold keeps this inside the emphasis language the system already has | Create Request, Create ToDo — Kind chips only (Answer permanently locked, no picker); Respond to Request — full dynamic Kind chips + which-Question picker + `.dlgre`/`.dlgbody` on Answer entries |

These were first written as §6.15–6.17, which collide with **Reserved ad slot**,
**Lookup and picker fields**, and **Calendar and clock pickers** in v2.9.
Renumbered 2026-08-03 once the spec was in the repo — the collision was
invisible while the spec lived outside it.

## Entitlements

Settled 2026-08-03.

**Rights come from the issuer, never from the reader.** A subscriber
responding to a request sent by a free user gets the free feature set. The
recipient's own status is irrelevant; they did not create the request.

**Tier lives on `profiles` and is read live.** Revised 2026-08-03. The earlier
rule snapshotted capability flags onto each request, to stop a lapse changing
the screen under a recipient. Narrowing the gate makes that unnecessary.

**Gates govern adding, not viewing.** Attachments already on a request stay
visible to everyone, permanently, whatever anyone's tier is now. Only the Add
Attachment control locks. Files are reclaimed by lapse-and-auto-delete
(PRD §6.3), which leaves a tombstone — never by hiding them from a reader.

This is why the gate note reads "Adding attachments is available on requests
sent by subscribers" rather than "Attachments are available…": the second
wording implies the files are hidden too, which they are not.

**A locked control is a courtesy, never a control.** The recipient path runs
through `SECURITY DEFINER` functions, so the function must refuse an attachment
write when the request's flags say no. Assume the button was bypassed.

See `WYP_component_states_palette1.html` for the visual treatment and the
accessibility rules that go with it.

## When a variant screen is warranted

- **A control changing state** — locked, read-only, invalid, gated — is
  documented once in the component states reference. Do not fork a screen file
  to show it; the layout is identical and the copy would drift.
- **A layout or flow difference** — an empty state, a dialog, a first-run
  variant that removes actions — gets its own screen file, because it cannot be
  read off a component gallery.

Rule of thumb: if the difference is "that control is in state X", it belongs in
the reference. If it is "the screen shows something else", it needs a file.

Where a screen has two meaningful modes that share a layout — Sign In's join and
returning modes, Respond to Request's free and subscriber tiers — put both in
one file behind a preview toggle rather than in two files.

## Notes

`drafts/WYP_requests_partial_SUPERSEDED.html` was built from a partial
screenshot before the full main screen existed. It shows only one Sent card and
no ToDos section. Kept only to explain the Log Out placement discussion; use
`screens/WYP_main_screen_palette1.html` instead.
