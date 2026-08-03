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
| Sign In | `screens/WYP_signin_palette1_floating.html` | `/login` | **Converted** |
| Your Account | `screens/WYP_your_account_palette1_floating.html` | `/account` | Mockup |
| Add Contact | `screens/WYP_add_contact_palette1_floating.html` | `/contacts/new` | Mockup |

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
match `app/globals.css`. When a mockup needs a component the system does not
have, add it with a `PROPOSED` comment and a `§` number so it can be folded
into the spec deliberately.

## Proposed components awaiting spec entry

| Class | Purpose | First used |
|---|---|---|
| `.btn-block` | Full-width primary action for auth screens, which have no band cluster | Sign In |
| `.checkrow` | Single persistent toggle; chips only cover either/or choices | Sign In |
| `.finput[readonly]` + `--locked` | Read-only field, for the email that is also the sign-in ID | Your Account |
| `.btn-quiet` | Global action that must stay reachable without competing with Create | Main screen — Log Out |

## Notes

`drafts/WYP_requests_partial_SUPERSEDED.html` was built from a partial
screenshot before the full main screen existed. It shows only one Sent card and
no ToDos section. Kept only to explain the Log Out placement discussion; use
`screens/WYP_main_screen_palette1.html` instead.
