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
| Start my Free Account / Sign In | `screens/WYP_signin_palette1_floating.html` | `/login` | Converted, **needs update** (React page lacks the two modes) |
| Create my Free Account — first run | `screens/WYP_create_free_account_palette1.html` | `/account/new` | Mockup |
| Your Account — returning | `screens/WYP_your_account_palette1_floating.html` | `/account` | Mockup |
| Add Contact | `screens/WYP_add_contact_palette1_floating.html` | `/contacts/new` | Mockup |
| Respond to Request | `screens/WYP_respond_to_request_palette1.html` | `/r/[token]` | Mockup |
| Create Request | `screens/WYP_create_request_palette1.html` | `/requests/new` | Mockup |
| Add Contact — no contact dialog | `screens/WYP_add_contact_no_contact_dialog_palette1.html` | `/contacts/new` | Mockup |
| Storage Maintenance | `screens/WYP_storage_maintenance_palette1.html` | `/storage` | Mockup |
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

| Class | Purpose | First used |
|---|---|---|
| `.btn-block` | Full-width primary action for auth screens, which have no band cluster | Sign In |
| `.checkrow` | Single persistent toggle; chips only cover either/or choices | Sign In |
| `.finput[readonly]` + `--locked` | Read-only field, for the email that is also the sign-in ID | Your Account |
| `.btn-quiet` | Global action that must stay reachable without competing with Create | Main screen — Log Out |
| `.is-locked` + `--locked-ink` / `--locked-border` | Action unavailable because of the request's tier | Respond to Request — Add Attachment |

## Entitlements

Settled 2026-08-03.

**Rights come from the request, set by its issuer.** A subscriber reading a
request sent by a free user gets the free feature set — attachments locked,
and so on. The recipient's own status is irrelevant; they did not create the
request.

**Capabilities are captured when the request is issued, and never re-evaluated.**
Store them on the request row as explicit flags, not by reading the issuer's
current subscription at display time. If the issuer later upgrades or lapses,
requests already sent keep the behaviour they were sent with — otherwise the
screen changes under the recipient between two visits to the same link.

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
