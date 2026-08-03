# Would You Please — Decisions Log

A chronological record of substantive product, design, and asset decisions taken outside the regular PRD/UI-spec revision flow, or that benefit from being captured in one place. Entries are newest-first.

The PRD and UI Design Specification remain the canonical source of truth for product requirements and design system details. This log captures the *reasoning* behind decisions, alternatives considered, and any follow-ups, so future revisions don't have to reconstruct the why from the what.

\---

## 2026-07-28 — v1 scope cuts (attachments → paid; voice search deferred; .ics kept; monetization deferred); offering/messaging rework; local + free-tier build approach adopted; PRD finalized to v12.7 (sales one-pager v3; UI spec §6.18/§9.19 still to update)

A roadmap-and-sequencing session. No UI-spec component anatomy changed, but the free/paid feature split was reworked, two mockups gained a locked "paid feature" attachments state, and the build path was set to a local + free-tier stack rather than the PRD §8.2 AWS target. Reasoning, alternatives, and document impacts below.

**Decisions taken**

1. **Attachments deferred out of v1 and repositioned as a paid-subscription feature.** They arrive with monetization, not at free launch. This removes the entire storage subsystem from the v1 critical path (S3, quotas, retention enforcement, the §6.18 warning strip, and the §9.19 Storage Maintenance screen all become paid-tier surfaces). Rationale: attachments are not the product's value proposition (which is send / track / follow through), and cutting them buys back the most build time of any single scope decision.

2. **In the Create Request and Respond mockups, the Attachments panel shows a locked "paid feature" state rather than being removed.** Owner decision, overriding the earlier recommendation to hide the panel entirely. The panel frame is kept; the functional file list and Add control are replaced with a lock glyph, an "A subscription feature" heading, and gating copy pointing to the subscription banner (§6.14) — mirroring the existing Request-Texting gating pattern. The Add Attachment button renders disabled. Rationale: the panel advertises the upcoming paid capability in place rather than hiding that attachments exist. Implemented as screen-local CSS (a new .locked treatment) reusing existing tokens; introduces no new token and no change to components.css.

3. **Voice search deferred from v1, to return later covering both the search bar and request-text composition.** The search bar ships without the voice glyph in v1; when voice returns it applies both to search entry and to dictating request text. The one-pager lists it under Coming soon.

4. **.ics / Add to Calendar is included in the initial offering.** Owner considers it a critical usage feature for request recipients — the due date drops onto the recipient's calendar in one tap. It is application-side code (generate the calendar file from the request's due date/time), with no infrastructure dependency, so it ships free in v1.

5. **Monetization deferred: the free tier alone is live at v1 launch.** The paid tier ($17.95/yr) is introduced later and unlocks attachments, Request Texting (SMS), perpetual retention, and ad-free. Free-tier ads remain deferred to 200 registered users (prior decision). Consequently the paid tier and its features are messaged as "coming with a subscription" at launch, not as live options.

6. **Build approach: a local + free-tier development stack, not the PRD §8.2 AWS architecture.** §8.2 (React SPA, NestJS/Go, RDS, S3, Redis, SES, SNS/Twilio, Stripe, AdSense on AWS) is confirmed as a sound production target but explicitly not a prerequisite to building. The this-week stack has a zero-cost stand-in for every production piece: Next.js + TypeScript locally, Vercel free for host and CI/CD, Supabase free for Postgres + Auth (magic links) + storage, Resend free for email (avoiding the SES sandbox), Sentry free for error tracking. Genuinely deferred to launch: SES with SPF/DKIM/DMARC and domain warming, Stripe live (test mode for all development), Twilio with its 10DLC lead time, S3, Redis, and AdSense. A Week 1 setup guide (repo → Supabase → Add Contact wired to real data) was produced to make the "this week" column concrete.

**Alternatives considered and rejected**

* *Removing the Attachments panel entirely from the v1 mockups* — the recommended option; owner chose the locked "paid feature" state instead, to keep the capability visible and advertised rather than absent.
* *Keeping attachments as a free feature, or launching with monetization live* — rejected; deferring both is what makes the solo 2–3-month timeline reachable and lets a free product validate before any billing, storage, or ad infrastructure exists.
* *Building on AWS from day one (with a credits application)* — rejected as slower and costlier for a solo developer with no benefit until there are users; AWS is sequenced last, after a beta proves the product and reveals real scale (which also strengthens the credits application).

**Follow-ups — documents**

* **Sales one-pager: done.** Rewritten to the free / coming-with-a-subscription / coming-soon split as WYP_Sales_OnePager_v3.pdf (with a rebuildable HTML source, onepager.html), superseding v2. Attachments and Request Texting moved to the subscription column; voice search and native apps to Coming soon; Add to Calendar highlighted as a free feature. The v2 claims that broke — "with attachments" in the free description, "reply with answers and files," voice search as a live feature, and "100 MB attachment storage" in the free tier — are removed.
* **PRD updated to v12.7 (done, 2026-07-28).** Sections changed: **§6** Monetization Model — added a "Launch sequencing" note (free tier only at launch; paid tier and its features activate at Phase 0+; ads deferred to 200 users) and reconciled the free/paid matrix (File attachments = paid, not free; Advertising = deferred). **§9** — added the base-subscription note ($17.95/yr unlocks attachments + Request Texting + perpetual retention + ad-free), distinct from the future business add-ons. **§10** — rewrote the Phase 0 scope (free tier; email; .ics; attachments locked; SMS/OAuth/voice deferred) and added a Phase 0+ — Monetization row. **§11** — added a "Two build paths" note (team basis vs the solo/AI/free-tier path), revised the §11.1 work breakdown (magic-link auth, email-only notifications, .ics row added; Attachment/Ad/Subscription streams deferred → Phase 0+; free-tier subtotal ≈ 20–30 wks) and the §11.3 budget (cloud/third-party → free-tier ≈ $0–$2,000; security-audit scope narrowed; TOTAL $118k–$319k). **§12** — UI-spec reference corrected v2.5 → v2.9. Title, footer, and Revision History bumped to v12.7. Old file WouldYouPlease_PRD_v12_6.docx superseded; Project Instructions Canonical-sources reference bumped. STILL OPEN: UI spec §6.18 (storage warning strip) and §9.19 (Storage Maintenance) become paid-tier-only surfaces — not yet edited in the UI spec.
* **UI spec §6.18 (storage warning strip) and §9.19 (Storage Maintenance)**: these govern attachment storage, now a paid-tier surface — note that they do not appear for free-tier users. §9.2.2 (Create Request attachments) and §9.3.2 (Respond attachments) should record the v1 locked "paid feature" presentation.
* **Component System Specification**: the locked attachments treatment is a candidate shared component — provisionally WYP-LockedFeature — once a second surface uses it (today it is screen-local in two mockups, consistent with the chip/pill deferral). Add it to the registry when promoted.
* **In-app gating copy**: the attachments panels now carry the same "available with a subscription" pattern as Request Texting; keep the wording consistent across both when the PRD copy is finalized.

**Deferred / open**

* **Recipient-facing attachment upsell**: a non-registered recipient responding via the secure web link sees the locked "subscription feature" attachments panel, but the upsell target is ambiguous for someone without an account. Revisit the recipient-facing copy (and whether the panel should appear at all in the recipient view) when the paid tier ships.
* **WYP-LockedFeature** shared component — promote from the two screen-local copies once a third surface needs it.
* **Voice search** return — search bar and request-text composition — tier and timing not yet set.
* **Security-review scope, recalibrated**: the owner's law-firm CRM secure-landing-page product (a provided server mapped to a firm's sensitive internal contact database via an iFrame on the firm's public site, reachable from email links, for firms up to 300+ attorneys) is directly analogous to WYP's token/link-mediated secure recipient-response flow. The earlier "single-user / trusted-environment" characterization was wrong. The pre-launch security review therefore narrows from "validate the whole model" to "confirm a known model is translated correctly into web-stack idioms" (Supabase RLS, signed URLs/JWTs, the browser threat model).

\---

## 2026-07-24 — Component system introduced (shared design-token and component stylesheets); WYP- identifier scheme adopted; token-name reconciliation; main-screen assets vectorized (no PRD or UI-spec content change; new Component System Specification v0.1)

The seven screen mockups were refactored from standalone HTML files — each carrying a full duplicated copy of the palette-1 CSS — into markup plus two shared stylesheets. No product requirement or design-system *semantic* changed this session; the single design-system-adjacent change is a token **name** reconciliation to the §3.1 label, with the value unchanged. Every collapsed screen was rendered and pixel-diffed against its pre-refactor original before delivery.

**Decisions taken**

1. **Design tokens centralized into one source of truth, `tokens.css`.** The palette-1 `:root` block — seventeen tokens — had been duplicated verbatim at the top of all seven mockups, so a token change meant seven edits. It now lives in one file every screen imports. The values written are the exact union of the seven files (verified equal across them). Treated as governed by the same change control as UI-spec §3.1, per the §3.3 rule that a new token requires a §3.1 revision.

2. **Shared component styles extracted into `components.css`.** The shell, header band (§6.8), group-label band (§6.7), primary and secondary buttons (§6.1/§6.11), base text input and floating-label behavior (§6.10), subscription banner and ad slot (§6.14/§6.15), and the modal frame (§6.12) are defined once and read their colors from `tokens.css`. Each screen now links, in order, Google Fonts → `tokens.css` → `components.css` → a small screen-specific `<style>`. Per-screen style blocks shrank sharply (e.g. Create Request 117 → 33 style lines). Verification: six screens render pixel-identical to their originals; the main screen differs only where its logo and icons were vectorized (decisions 7–8).

3. **Token-name reconciliation: `--field` → `--focus-tint`.** §3.1 names this token "Focus Tint" (#EDF2FD). Four form mockups defined it as `--field` while the two storage mockups already used `--focus-tint`; standardized on `--focus-tint` everywhere — the name that matches §3.1 and the majority of files. Pure rename: the value #EDF2FD is unchanged, so nothing renders differently. Closes the latent drift first flagged when the mockups were consolidated.

4. **`--scrim` tokenization gap closed.** The modal scrims (Add Contact no-contact dialog, Storage Maintenance) hardcoded `rgba(31,41,51,.45)` inline although §3.1 defines a Scrim token; `components.css` now applies `var(--scrim)`, so the overlay is governed in one place like every other color.

5. **`WYP-` component-identifier scheme adopted (owner, 2026-07-24), specified in the new Component System Specification v0.1.** Stable identifiers — PascalCase under the `WYP-` prefix (e.g. `WYP-Button`, `WYP-LookupField`) — map one-to-one onto the eighteen UI-spec §6 components, so one name denotes the same part in the spec, in the eventual code, and in working conversation. The identifier is the durable handle; the §6 section number stays where the anatomy lives. Identifiers are set in monospace and never quoted, keeping a component name distinct from a verbatim on-screen label (which §1.5 reserves quotes for). Consequent to adoption, §6 entries carry their identifier as each is next revised (prospectively, per the §1.5 conformance rule), and the Component System Specification becomes a companion to the UI spec in the Canonical sources block.

6. **Self-contained copies produced for viewing.** Because the linked files reference `tokens.css`/`components.css` by relative path, they render unstyled in an isolated preview (no sibling files) and locally only when all three files share one folder with exact names. A parallel set with both stylesheets inlined into each `<head>` was produced; these render anywhere with no setup. Working model: edit the linked set (single source of truth), view and share the standalone set, regenerate the standalone set from the canonical CSS after any change.

7. **Main-screen logo converted from a base64 PNG to the canonical inline SVG.** The main screen alone embedded its logo as a raster data-URI (~13 KB); the other six draw it as inline SVG, and those six were verified byte-identical to one another. The main screen now carries that same SVG — crisper on high-DPI, lighter, and consistent. Only the logo pixels change; nothing else on the screen moves. Judged an iteration artifact (owner concurred), not an intentional divergence.

8. **Main-screen icons converted from base64 PNGs to inline SVG from the project icon files.** All seventeen raster icons (three Expand, three Print, Search, Voice Search, six Attachment glyphs, three Dialog glyphs) were replaced with the `wyp\_icon\_*.svg` assets. Decorative inline SVGs are marked `aria-hidden`; the accessible name stays on each wrapping control (`role="button"`, `aria-label`), so screen-reader behavior is unchanged. Sizing rules retargeted to the inline SVG (`.iconbtn svg`, `.sb .iconbtn svg`, `svg.iico`). The main-screen file dropped from ~157 KB to ~22 KB. `wyp\_icon\_contract.svg` is present in the asset set but unused in the pilot mockups — it belongs to the not-yet-mocked expanded-list view (the collapse counterpart to Expand).

**Alternatives considered and rejected**

* *Keeping the `--field` name, or minting a new token* — `--focus-tint` already matches §3.1 and was already used by two screens; renaming the four outliers is the smaller, drift-closing change.
* *Promoting the chip and sort-pill styles into `components.css` now* — their definitions genuinely diverge across screens (main uses `.sel`/`.over`/`.done`; Add Contact uses `.selected`; Storage uses simpler variants; the main and storage `.pill` differ in size). A shared definition would risk a visual change and presupposes a single canonical chip spec, which is a design decision, not a mechanical extraction. Left local; the main screen is now the reference implementation for §6.2/§6.3.
* *Leaving the raster logo and icons in place* — they read as iteration artifacts, not intent; the spec already names these as SVG assets (§5.1, §6.16). Vector is crisper, far lighter, and consistent with the other screens.
* *Combining all seven screens into one multi-screen file with a switcher* — offered as a viewing convenience; not adopted, left available.

**Follow-ups — documents**

* **Component System Specification** — completed to v1.0 (2026-07-24): all eighteen §6 components carry a full anatomy entry (Purpose / Anatomy / States / Composition / Reference implementation). Filed as `WYP_Component_System_Specification_v1_0.docx`, part of the canonical set and the Project Instructions Canonical sources block. Its token table still reads "Focus Tint (`--field` in mockups)" — update to `--focus-tint` when next touched.
* **UI spec §3.1**: when next revised, cite the CSS name `--focus-tint` alongside the "Focus Tint" label, and record `tokens.css` as the canonical token file (same change control as §3.1, per §3.3). No value or semantic change.
* **UI spec §6**: add each component's `WYP-` identifier as each §6 entry is next touched — prospectively per §1.5, not as a sweep.
* **Canonical sources block (project instructions)**: updated this session — adds `tokens.css`, `components.css`, and the Component System Specification, and records that the seven mockups now exist as a linked set (depending on the two stylesheets) plus a standalone inlined set for viewing.
* **Mockups in project knowledge**: the main-screen mockup is now updated (logo and icons vectorized) — this supplies the file the 2026-07-22 entry recorded as *missing* from project knowledge. Upload the current seven (both forms). The 2026-07-22 note that `WYP\_storage\_maintenance\_palette1.html` is one revision behind still stands and is unaffected by this session.

**Deferred / open**

* **`WYP-ChipRow` and the sort-pill component**: unify the divergent chip/pill definitions into shared components once the single canonical spec is decided (§6.2/§6.3). Main screen is the reference.
* **Unused tokens `--btn-top` and `--icon-grey`**: defined but never referenced through `var()`; `--icon-grey` (#6B7280) is also misleading, since the information-only glyphs actually render in `--ink-soft` (#5A6675). Retire once confirmed unused in the build; carried in `tokens.css` under a "deprecated / unused" note meanwhile.
* **Icon components / sprite**: with the glyphs now defined once as files, the shared layer can absorb them (a small icon-component set, or a sprite) rather than pasting SVG per screen — do this alongside the chip/pill unification.
* **Spacing scale**: only `--pad` is tokenized; the full §7.2 scale is not yet in `tokens.css`. Add `--space-*` mirroring §7.2 when convenient (a design decision, so not invented here).


\---

## 2026-07-23 — Sales one-pager refreshed to $17.95 pricing; callout panels auto-sized; collateral given a rebuildable source (no PRD or UI spec change)

**Decisions taken**

1. **Paid-tier price on the one-pager corrected to $17.95 / year.** The approved 2026-06-11 PDF still carried **$11.99**, a figure superseded when PRD v12.0 fixed annual-only billing at $17.95 — the number used throughout PRD §6.2.3, §13, and §15.1. Recorded here as a stale-artifact correction rather than a pricing decision: nothing about the price changed, only the collateral that misstated it.

2. **The monthly framing is "Only $1.50 a month — a fraction of team tools,"** replacing "Less than $1 a month — a fraction of team tools." $17.95 ÷ 12 = $1.496, so $1.50 is accurate to the cent under normal rounding. "Less than $2" was rejected as technically true but read as rounding *up* to make a point. PRD §13's "under a nickel a day" framing stays in the PRD only; on the one-pager this line does double duty as the per-month comparison against per-seat team tools, and a per-day figure loses the comparison.

3. **The two accent-bar callout panels are auto-sized from their content, with equal padding above and below.** Both the light-blue "Nothing to install" panel and the manilla "Coming soon" panel had been drawn at fixed heights that ended on the last text baseline: the light-blue panel's final descenders crossed its bottom edge by roughly 0.4 pt, and the manilla panel cleared its own by 0.1 pt. The tint therefore read as cut off rather than as a panel containing text. Padding is now **9 pt top and bottom**, measured from the first line's ascent and the last line's descent rather than from baselines, so the text block is optically centered.

4. **The extra height is absorbed by shifting the lower half of the page down 9 pt**, not by reducing type size, leading, or copy. The light-blue panel grows from 46 pt to 54.7 pt and the manilla panel from 44 pt to 52.4 pt; everything from the "Everything you need to follow through" heading downward moves 9 pt lower. White space above the footer band falls from 64 pt to 47 pt, which is still generous. Column grid, card geometry, gutters, and every type size are unchanged.

5. **The solid blue pricing card and the header and footer bands are left alone.** Measured padding is 11.4 pt above and 13.2 pt below the text on the pricing cards, and 17.0 / 15.2 pt in the footer band — already balanced, and not what the eye was reading as clipped. Only the two panels that were genuinely clipped were touched, so the rest of the approved composition carries forward unmodified.

6. **The collateral now has a source of record: `build\_onepager.py` (ReportLab).** The page was transcribed from the drawing operations of the approved PDF — identical coordinates, color values, Helvetica sizes, and vector checked-request mark — and verified two ways: a layout text diff showing only the two intended pricing lines changed, and a side-by-side render at 150 dpi. Copy, palette, and geometry are now editable in one place, and the callout helper re-centers automatically when a line of copy changes length. This mirrors the practice already established for screens, where the HTML mockups are the source and the figures are exports.

7. **Deliverable is `WYP\_Sales\_OnePager\_v2.pdf`.** The "FinalLogo" qualifier is dropped: it marked the one-time asset milestone of 2026-06-28, not a document version, and reads as a version once a second version exists.

**Alternatives considered and rejected**

* *Patching the existing PDF content stream in place* — the price swap alone would have worked, since both replacement strings are left-aligned at a fixed origin. Re-centering the panels, though, means moving every coordinate below y≈518 in a 14 KB stream by hand, where a single arithmetic slip renders plausibly and silently wrong.

* *Rebuilding the one-pager as HTML to match the mockup family* — the screen mockups are HTML because they specify on-screen UI. Print collateral needs fixed page geometry and a PDF handoff, and browser print pipelines differ in margins, hyphenation, and color handling. ReportLab produces the artifact directly, with no render step to disagree about.

* *Adding fill below the last line only, as literally requested* — restores the missing tint but leaves the text block sitting high in the panel, which is the same defect a few points smaller. Centering costs the same edit and fixes the cause.

* *Enlarging the pricing card and the two bands to match* — change for symmetry's sake on elements that already read correctly, and it would have cost another vertical shift on an already-full page.

* *Re-flowing or trimming copy to reclaim the vertical space instead of shifting content down* — the page carried 64 pt of unused white above the footer. Spending that is cheaper than re-breaking approved lines and re-reviewing the copy.

**Confirmed**

* The 2026-06-28 follow-up — *"The Sales One-Pager PDF (in project knowledge) is presumed to use the dark-background mark in its header/footer bands. Confirm at the next sales-collateral refresh."* — is **confirmed and closed**. Both bands draw the dark-background variant: white bubble, pale-blue rules (#A7BCE8), navy check (#1A3A75) over a white keyline, at full size in the header and 0.533 scale in the footer.

**Follow-ups**

* Owner: replace **WYP\_Sales\_OnePager\_FinalLogo.pdf** in project knowledge with **WYP\_Sales\_OnePager\_v2.pdf**, add **build\_onepager.py** alongside it as the collateral's source of record, and update the Canonical sources block to list both. Note that the copy of the one-pager currently in project knowledge is **not a readable PDF** — it has no trailer dictionary and no readable cross-reference table — so it needs replacing on those grounds alone; this refresh worked from the owner-supplied upload.

* The free-tier card states 100 MB; the paid card still promises only "Keep your requests and files forever" with no storage figure. Consistent with the PRD §15.2 open item and the no-number rule adopted for §9.19 (2026-07-22, decision 25). When the paid-tier figure is set, the paid card gains a fourth line and the layout absorbs it without a manual re-measure.

* Sweep the other outward-facing surfaces for the stale $11.99 — website copy, any deck or listing draft, and anything already sent to a reader outside the project. The one-pager was caught by inspection, not by a sweep, so it is unlikely to be the only place.

* At the next refresh, re-check "Now available in your web browser" and "Coming soon: native apps for iPhone, Android, and Windows" against the phase language in PRD §11.1, so the collateral's promises and the roadmap's phases stay in step.


\---

## 2026-07-22 — Screen-name normalization; tier-scoped contact minimum; subscription-lapse policy; attachment storage warning strip and Storage Maintenance screen (UI spec v2.9; PRD v12.6 — both cut 2026-07-22)

**Decisions taken**

1. **Button label shortened to "Save"** on Add Contact, replacing "Save Contact." Matches the verb-only convention already used for Send on Create Request and Respond to Request. Buttons remain padding-sized, so the Primary is now visibly narrower than the adjacent Cancel — the same relationship those two screens already show, so it reads as the established pattern rather than an anomaly.
2. **Screen name is "Add Contact"**, not "Add a Contact." Side benefit: the recipient-row control on Create Request already read "Add Contact," so the button and the screen it opens now carry one name.
3. **Screen name is "Create Request"**, not "Create a Request." The article is dropped only where the phrase *names the screen*. Where the PRD describes the *action* — "Creating a Request when the user has zero contacts," "to create a Request" — the lowercase phrasing stands unchanged. §9.9.5's modal copy carries both forms in one sentence by design: it opens "To create a Request, a Contact is needed" (action) and closes "you'll be returned to Create Request" (screen).
4. **"Respond to Request" is retained** over "Request Response." It is a verb phrase that tells a first-time recipient — often a non-registered user in the secure web view — what to do; the noun form names an object and loses the instruction.
5. **Contact minimum is tier-scoped.** Name clause unchanged for both tiers: either a First or a Last Name. Reachability clause now depends on tier — the free tier requires an **Email**; a subscriber requires an **Email or a Phone**, with §9.9.3's save-time channel validation unchanged, so the field matching the selected delivery channel must be populated. Rationale: subscribers can send by text and have no reason to hold an email address for a text-only contact, while free-tier delivery is email-only and a phone-only contact would be unsendable. This also resolves a latent conflict — §9.9.3's auto-follow switches a subscriber's delivery selection to Text when Phone is filled and Email is empty, a state an always-Email rule would have failed on Save. The mockup's caption string is correct as written for the free tier; §9.9.2 and §9.9.3's "either Email or Phone" text was the stale side of the divergence.
6. **Lapsed subscribers are prompted, not blocked.** A free-tier user (lapsed or never subscribed) opening an existing contact that has a Phone and no Email sees a persistent inline notice in Ink Soft beneath the Email field: "Add an email address to send Requests to this contact." **Save still succeeds without one.** Rationale: a record valid when created must not fail validation later because the tier changed, and blocking Save would trap someone who opened the form to fix a phone number. Contacts whose delivery channel was Text revert to Email display at lapse, the free tier having only one channel.
7. **The phone-only count appears in two places, framed as incentive before lapse and as instruction after.** Pre-lapse renewal reminder: "Renewing keeps Request Texting for the 36 contacts you reach by text." Post-lapse Account banner (§6.14), suppressed when the count is zero: "36 of your contacts have no email address. Requests are sent by email on the free tier, so you'll need to add an address before you can send to them." Both count contacts *lacking an email* rather than contacts "with only phone numbers" — identical sets today, but the first states the condition that actually gates sending.
8. **Subscription lapse carries a 30-day grace window.** Ads resume on day 31. Attachments are auto-deleted **oldest-first** down to the free 100 MB limit on day 31. Incremental email notices during the window carry the count, the megabytes over, and a **download link** — the user must be able to keep a file rather than only watch it expire.
9. **Storage warning strip (new UI spec §6.18)** — a full-width strip flush beneath the header band, above the first heading band; the whole strip is one control opening Storage Maintenance. Two severities, both from existing tokens: **Caution** at 20% or less remaining (Brand Blue on Focus Tint #EDF2FD with a Brand Blue bottom rule, main screen only) and **Critical** at 10% or less, or full (Alert Red on white between hairline Alert Red rules, every screen). The lapse countdown uses the Critical treatment.
10. **No amber token.** The owner's mockup used an amber chip; adopting it would have required amending §3.1 (which names Sort Highlight #FFE34D "the sole yellow in the system from v2.5"), §3.2, and §3.3 (which states Brand Blue and Alert Red are the only saturated colors used at scale, that additional accent colors are not part of the system, and which closes the list of permitted tinted backgrounds). Impending irreversible deletion is an error condition, so Alert Red carries it under a single extended clause in §3.1's usage cell instead. Red stays off Row Tint, so it never enters the visual register that means Overdue.
11. **Strip placement is not a header chip.** PRD §3.1 records that the user name and the date/time were removed from the header in v10 because the clock overlapped the tagline on a Galaxy S24+; a chip beside the wordmark reoccupies exactly that reclaimed space and reintroduces the overflow. A full-width strip has no overflow failure mode and carries longer copy plus a right-aligned action.
12. **Warning copy states the condition, not the gesture.** "Click to fix" is mouse-specific in a touch-first product. Caution: "Attachment storage is 82% full." Critical: "Attachment storage is full. New attachments will fail." Lapse: "Your subscription ended. Attachments over 100 MB are removed in 12 days, on Wednesday, September 8." Action text "Free up space ›" / "Review ›". Sentence case per §6.13.
13. **Storage Maintenance screen (new UI spec §9.19)**, appended after §9.18 — §9.8's retired number is preserved. Composition: header band; "Storage Maintenance" heading band with Close; summary block (used / limit / available with a proportional bar in Brand Blue that switches to Alert Red at the Critical threshold); sort strip; attachment rows; footer note; then the standard §6.14 banner and free-tier ad slot. Rows reuse the §9.2.2 attachments-panel anatomy — filename truncated mid-string, then size, type, and date — so no new component is introduced.
14. **Rows identify the attachment's source**: the parent Request, Dialog entry, or ToDo, plus who added the file, rendered "Added by Roman Atley" or "Added by you."
15. **Sort defaults to largest-first**, with an oldest-first option, and a caption noting that auto-deletion removes oldest first. The two orders differ deliberately: auto-deletion runs oldest-first, but manual cleanup is only efficient largest-first, and the screen optimizes for the user's task rather than mirroring the machine's rule.
16. **Each row carries a Download control.** Without it, the only way to comply with a storage warning is to lose the file permanently. Rendered as text in Brand Blue, not an icon — the icon family has ten members and no download glyph, and adding one would mean an eleventh asset plus a new §5.1 group. (Consistent with the 2026-07-21 rejection of a download icon on §9.3 attachment rows.)
17. **Storage is charged to the requestor**, and includes attachments added by the recipient. Stated on the screen in the summary note so it is not a surprise.
18. **Attachment caps: 25 MB per file and 50 MB per Request**, alongside the existing v7.0 count limit of ten per Request, per Response, and per Dialog entry. Necessary because decision 17 lets a third party consume a free-tier sender's quota, and nothing previously capped an individual file — a single recipient video could have exceeded the sender's entire allowance.
19. **Refusal to a blocked recipient upload is neutral**: "This Request can't accept more attachments." It does not name the cause, since the alternative discloses the sender's account state and tier to someone who may be a stranger. Consistent with the Category-privacy reasoning of 2026-07-21.
20. **Close returns to the immediately prior screen; Enter does the same** when focus is not in a field. Stated generally in **§10.3 Keyboard navigation**, which already specifies Enter and Escape, rather than in §8 (which carries no keyboard content) or locally in §9.19: on a screen with no form to submit, Enter activates the heading band's dismissive control — Close, or Cancel where no Close is present.
21. **Removed attachments leave a tombstone.** Because decision 17 means senders will routinely delete files their recipients uploaded, removal must not silently alter the recipient's record. Rendered on the item (§9.6) as a single Ink Soft line — "1 attachment removed by Jim Kelley on Sep 8, 2027" — aggregated rather than one line per file, so clearing twenty files does not leave twenty tombstones on one Request.
22. **§4.3 gains a weekday exception for deadline dates within thirty days**, permitting "Wednesday, September 8" on the lapse strip. Narrow by construction: §4.3's M-D-YY list rows and locale-aware long form elsewhere are otherwise unchanged. The year is dropped on the strip (the window is never more than 30 days out, so it carries no information and costs a line wrap at 360 px) and retained in the Storage Maintenance summary and the notice emails, which may be read weeks later.
23. **The countdown is stated as days remaining, on a named date** — "removed in 12 days, on Wednesday, September 8" — not as days elapsed since lapse. At day 18 of a 30-day window there are 12 days left, not 12 days since.
24. **A contextual subscription offer sits at the foot of the summary block**: "Subscribe for more attachment storage" on the free tier, "Renew to keep these attachments" in the lapse state. Rendered as a tappable line in Brand Blue at 13 px / 700 with a 40 px target — the §6.14 banner's treatment — on its own line. Deliberately *not* bolded inside the note, and deliberately not a verbatim quotation of the banner's own label: emphasis without an affordance produces a phrase that reads as a control but isn't, and the duplicated string would read as a repeated element rather than two placements. The persistent banner is retained; the two now say different things, the contextual one naming the specific benefit at the moment it is legible.
25. **No storage figure is promised.** PRD §6 gives the free tier as up to 100 MB but states the paid tier only as perpetual retention with add-ons available, and §15.2 lists add-on increments and pricing as an owner decision. Copy therefore says "more," with no number, until cost estimates are run (owner, 2026-07-22). The missing paid-tier figure is now recorded as its own open item in PRD §15.2. *Correction to an earlier note in this session:* the subscription screen is **§9.14 Subscription / Upgrade**, not §9.17, which is the banners section.
26. **Screen names are set in plain title case; the convention is written down rather than marked up.** New §1.5: title case names a screen or component, lowercase names the action, a section reference accompanies the first mention of a screen within a section, and double quotes are reserved for verbatim product copy. Applied prospectively — sections conform as they are touched, not by a sweep of both documents.

**Alternatives considered and rejected**

* *Quotes, italics, bold, or color for screen names in the documents* — quotes already mean verbatim UI copy, so quoting a screen name makes "Create Request" ambiguous between the name and the button's literal label, which is the confusion the markup was meant to remove; italics collide with figure captions, which are set fully in italic; bold collides with table lead-ins and adds noise to running prose; color fails in print and greyscale, is an accessibility problem on its own, and drifts the first time a paragraph is reformatted in Word. A written convention is the proportionate fix.
* *Requiring an Email of every contact regardless of tier* — taxes exactly the users who paid to avoid email; a subscriber reaching someone only by text would have to invent an address.
* *"Email or Phone" for both tiers* — reintroduces the problem the always-Email rule prevented: a free user saving a phone-only contact they can never send to.
* *Deferring the reachability check to send time* — surfaces the failure mid-compose, the worst moment, and leaves unusable records in the contact list.
* *Forcing a contact cleanup pass at lapse* — punishes the user at the moment of downgrade; the compose-time prompt of decision 6 catches the same problem at the point of use.
* *Adding a Warn Amber token* — costs amendments to §3.1, §3.2, and §3.3 to buy a convention users do not need once red is available; see decision 10.
* *Taking over the §6.14 banner for the storage warning* — that strip is the paid-conversion lever, and displacing it during a lapse is precisely backwards.
* *A modal on entry* — a recurring blocking dialog for a condition persisting for weeks trains people to dismiss it unread.
* *Making the offer sentence itself the link, inside the note* — buries the action in an explanatory paragraph where its tap target is an irregular multi-line shape.
* *A Primary button in the summary block* — competes with the heading band's control and would be the screen's only Primary button pointing away from the screen's own task.
* *Dropping the bottom banner in favor of the contextual line* — loses the persistent lever on every other screen for no gain.

**Corrections made during the cut**

Four pre-existing errors were found in the masters while cutting and are recorded in the v2.9 Schedule A entry rather than fixed silently. §9.1.2 (both the Requests and the ToDos band) and §9.9.2 still described heading bands as Field-Yellow, a token retired in v2.5 and replaced by Band #E7E7E7 — the Figure 9.9.1 caption two paragraphs above already said Band, so the section contradicted its own figure. The §9.9.5 figure caption omitted the `\\\\\\\_palette1` suffix from the mockup filename. The §3.2 note recording Field Yellow's retirement, and the v2.0, v2.3, and v2.5 history entries that describe it as current at the time, stand as written.

**Follow-ups**

* Owner: replace canonical files in project knowledge with **WouldYouPlease\_PRD\_v12\_6.docx** and **WouldYouPlease\_UI\_Design\_Specification\_v2\_9.docx**, and update the Canonical sources block to v12.6 / v2.9. The mockups in project knowledge are current except **WYP\_storage\_maintenance\_palette1.html**, which is one revision behind — the copy there predates the contextual offer line (decision 24).
* Owner: **WYP\_main\_screen\_palette1.html is missing from project knowledge**, though the Canonical sources block lists it. It was present at the start of this session and absent by the end.
* Owner: open v2.9 and v12.6 in Word and press F9 once so each table of contents picks up the new sections (§1.5, §6.18, §9.19; PRD §6.3). The TOC fields are flagged dirty and should offer to refresh on open.
* Owner: run cost estimates, then set the paid-tier storage figure in PRD §6 and add-on increments and pricing in §11. Blocks both the §9.19 offer copy and the §9.17 subscription-features screen, neither of which can state a number until then.
* **Applied in v2.9**: §6.11.1, §9.9.1, §9.9.2, §9.9.3, §9.9.5 (Save / Add Contact); §9.2 heading and TOC line, §9.2.1 caption, §9.2.2, §6.16 Notes, §9.8 retirement note (Create Request); §9.9.2 and §9.9.3 (tier-scoped minimum); new §1.5, §6.18, §9.19; §3.1 Alert Red usage cell and Band token; §4.3 weekday exception; §10.3 Enter-key behavior; §9.6 tombstone paragraph; §9.2.3 and a new §9.2.5 edge case for the size caps; Schedule A v2.9. Figures 9.2.1, 9.9.1, and 9.9.2 re-rendered from the updated mockups; Figure 9.19.1 added. Version-history entries for v2.0, v2.3, v2.5, v2.7, and v2.8 stand as history.
* **Applied in v12.6**: §2.1 caps and the storage-accounting and neutral-refusal rules; §2.6 Email and Phone field definitions made tier-scoped, plus the closing sentence; six screen-name instances; new §6.3 Subscription Lapse; §14.1 and §14.2 entries; §15.2 paid-tier storage figure. The v12.4 history entry stands as history.
* Confirm the deletion hour, **written into §6.3 as end of day in the account holder's profile time zone** to match §2.7's Overdue anchor. Flagged rather than assumed: nothing in the PRD previously specified it.
* Confirm whether the 30-day clock also governs the retention reversion from perpetual to one year. Recorded as an open item inside §6.3 itself. If it does, day 31 removes far more than attachments and the notices need a corresponding line.
* Confirm whether editing a phone-only contact is the only prompt point, or whether selecting such a contact on Create Request should also prompt inline.
* Open: does the §9.19 list support multi-select for bulk removal? Ties to the bulk-actions question already open in §9.7.
* Open: destination for the contextual offer — §9.17 whole, or a storage section within it once that screen is structured.
* Open: §9.19's Close is a placeholder for whatever back affordance §9 eventually adopts; the spec defines none.
* ~~Confirm the §2.6 sentence.~~ **Confirmed by the owner, 2026-07-22.** Its closing paragraph reads "routes through Add Contact ... returned to Create Request," renaming both screens, with the action phrasing "Creating a Request" left lowercase. An earlier instruction in this session said that paragraph needed no change; a later one directed the PRD renames generally, and renaming only one would have left the sentence mixing conventions. As shipped in v12.6. No further action.
* Still open from prior entries: §6.17 calendar and clock picker visual design (queued 2026-07-21); the 2026-07-21 confirmations, if not yet given.



## 2026-07-21 — Respond to Request fully designed; Category made sender-private; §6.16 picker exception (UI spec v2.7 → v2.8; PRD v12.4 → v12.5 pending)

**Decisions taken**

1. **Respond to Request fully designed** from the owner mockups (Rerspond\_to\_Request.png, Rerspond\_to\_Request\_v2.png) and specified as UI spec §9.3, replacing its placeholder. Layout follows the Create a Request pattern: "Respond to Request" group label on the Band heading band with Send (Primary) and Cancel (Secondary) right-aligned; read-only request header; form fields on Row Tint; Subscription banner and free-tier ad slot at bottom. Canonical mockup: **WYP\_respond\_to\_request\_palette1.html** (Figure 9.3.1 embedded from the 480-px render, 2x).
2. **No dedicated free-text response field.** The recipient's reply is carried by three existing channels — the Done state, the Dialog thread, and response attachments. Rationale: a separate response box duplicates the Comment type in Dialog and splits the conversation across two places with different notification and audit behavior; Dialog entries are already immutable and threaded (PRD §4).
3. **Category is private to the sender.** On a Request the Category is a sender-side organizing label only. It is never shown to the recipient: not on Received rows, not on Respond to Request, not on the recipient's Detailed Item view, not in the non-registered web response view, and not in the notification email or its .ics attachment. The sender keeps Category display, search, and filtering on Sent. ToDos are unaffected (no recipient). Consequence: the Create a Request field label becomes **"Private Category (optional)"** so the sender knows the label is not transmitted.
4. **Done Date and Done Time are selected, not auto-filled.** Opening the screen leaves both empty; the recipient sets each with its picker. Rationale: auto-filling today's date on arrival would mark items Done merely by opening them, and would make "respond without completing" impossible to express. Empty Done fields at rest are therefore the resting state, and Send never marks an item Done implicitly.
5. **Done Date renders in the locale-aware weekday-long form** (e.g. "Monday, October 19, 2026"), matching the Due line so the two read as a matched pair; the Done Date field is widened and **Done Time narrowed** to accommodate it.
6. **Done Time is conditional**: shown only while the selected Done Date equals the Request's Due Date *and* the Request carries a Due Time; hidden on any other Done Date and on date-only Requests. Evaluated live as the Done Date changes. Rationale: time of day changes the on-time / Overdue outcome only on the due date itself (PRD §2.7), so on every other day the field is noise.
7. **§6.16 gains a picker-field exception.** The Calendar and Clock affordance glyphs **persist** beside the floated label whenever the field holds a value, because a picker field has no text to retype and the glyph is the only visible cue that the picker can be re-opened. Type-ahead **Lookup** fields keep the default rule (glyph hidden once a value is present) since they are edited by typing — preserving the Category-filled-without-glyph state shown in Figure 9.2.1. The exception also applies to Due Date / Due Time on Create a Request (§9.2); the figure is unaffected because those fields are shown empty. *Reasoning correction logged:* the exception was briefly assessed as moot once auto-fill was dropped (empty fields already show the glyph under the default rule); that was wrong — the exception governs the **filled** state, which is exactly the state the owner's v1 mockup and the "editable with the respective icons" note called for.
8. **Request attachments are read-only but downloadable; no overwrite.** The recipient can download the sender's files, edit them locally, and re-upload the edited copy as a *new* response attachment; the sender's original is never replaced or removed. Request attachment rows therefore carry no remove (×) control — the filename itself is the download affordance in Brand Blue — while the recipient's own uploads render as removable rows. The 10-attachment cap (PRD §2.1) applies to the combined count.
9. **Read-only detail field labels are app (Brand) blue**, with Ink values. §3.1's Brand Blue usage cell is extended accordingly. Applies to the Date / From / Due header and the panel labels on this screen.
10. **Add to Calendar** is a Primary button beside the request header, downloading an .ics for the due date and, where present, the Due Time (PRD §7.3).

**Alternatives considered and rejected**

* *A dedicated Response text field* — duplicates the Dialog Comment type and fragments the thread; rejected per decision 2.
* *Auto-filling Done Date/Time on open, editable afterwards* — silently completes items and removes the participate-without-completing path; rejected per decision 4.
* *Showing Done Time always* — presents a control that cannot affect the outcome on any day but the due date; rejected per decision 6.
* *Dropping the §6.16 exception once auto-fill was dropped* — conflates the empty and filled states; see the correction in decision 7.
* *A dedicated download icon on attachment rows* — would require a twelfth icon asset and a new group in §5.1/§11.1 for a single screen; the filename-as-link affordance carries the same meaning with no asset change. Revisit if download appears on other screens.
* *Showing the Category read-only to the recipient* — rejected as decision 3; a sender's private filing label ("Chase later", "Cheap vendor") is not recipient-facing content.

**Process note — document regeneration**

The v2.8 cut was first regenerated from the markdown extraction held in project knowledge. That file is a text extraction, not the Word master, so the rebuilt document lost the type ramp, heading colors, table borders and header shading, and **all sixteen embedded images** (the four figures plus the §3.1 swatch cells and §5.1 icon cells). Corrected by editing the uploaded v2.7 master's XML in place, which preserves every unedited byte of formatting. **Rule going forward: cuts are made against the uploaded Word master, never regenerated from the project-knowledge extraction.** The PRD cut is held for the same reason until the v12.4 master is uploaded.

**Follow-ups**

* Owner: replace canonical files in project knowledge (UI spec v2.8, WYP\_respond\_to\_request\_palette1.html, updated WYP\_create\_request\_palette1.html, this log); update the Canonical sources block to UI spec v2.8.
* Owner: upload WouldYouPlease\_PRD\_v12\_4.docx (the Word master) so PRD v12.5 can be cut — §2.3 Category-privacy bullet, §5 and §14.1 pointers to §9.3, Schedule A entry, and a correction to the stale §5 line that still calls Category "a free-text field with autocomplete" (contradicts the v12.4 selection-or-Add-Category rule).
* Owner: open v2.8 in Word and press F9 once so the TOC picks up §9.3.1–§9.3.5 (the field is flagged dirty and should refresh on open).
* Confirm the three items built to recommended defaults: Done fields shown filled in Figure 9.3.1 (illustrative, as Category is on Figure 9.2.1) rather than empty; "(optional)" kept lowercase to match Due Time and Attachments; panel labels Brand Blue on Respond where Create a Request uses Ink.
* Confirm the assumption that the header's "Date:" is the Request's **sent** date.
* Next design task (still queued): §6.17 calendar and clock picker visual design.
* Still open from prior entries: none outstanding.



## 2026-07-20 — Create a Request fully designed; lookup/picker glyph convention; Due Time added; §9.8 retired (UI spec v2.6 → v2.7; PRD v12.3 → v12.4)

**Decisions taken**

1. **Create a Request fully designed** from the owner mockup (Create\_a\_Request\_-\_new\_format.png) and specified as UI spec §9.2, replacing its placeholder. Layout follows the Add a Contact pattern: "Create a Request" group label on the Band heading band with Send (Primary) and Cancel (Secondary) right-aligned; floating-label fields on Row Tint; Subscription banner and free-tier ad slot at bottom. Screen title standardized as **"Create a Request"** — sending is part of creating, and "Create \& Send" makes the label too long. Canonical mockup: **WYP\_create\_request\_palette1.html** (Figure 9.2.1 embedded from the 480-px render, 2x).
2. **Label-affordance glyph convention adopted (new component §6.16; §6.17 placeholder for the pickers).** Type-ahead and picker fields carry a leading glyph inside the resting floating label; the glyph disappears when the label floats. Glyphs render at **≈120% of the resting label font size (≈17 px against the 14-px label), vertically centered on the label text** (owner sizing decision, this date; centering chosen over baseline alignment because the three shapes have different visual weights). Component numbering note: drafted as §6.15/§6.16, renumbered to §6.16/§6.17 because v2.6 already used §6.15 for the Reserved ad slot.
3. **Lookup glyph final design (rev. c, two owner mockups this date):** faded-grey magnifier in **Input Border #7E8A9A** overlaid by a **solid Ink #1F2933 down-pointer**, with a **white knockout halo** breaking the lens stroke around the pointer — the same white-behind-dark technique as the logo's check mark — so the two elements read as an overlay, not one shape. Iteration history: (a) stroked down-caret beside the lens — rejected, caret too small to recognize; (b) solid Ink pointer protruding at the lens's right — rejected, read as an extension of the magnifier rather than an overlay. Calendar and clock glyphs remain Ink Soft #5A6675. The plain magnifier (wyp\_icon\_search.svg) retains its single meaning: execute a search. Assets: wyp\_icon\_lookup.svg, wyp\_icon\_calendar.svg, wyp\_icon\_clock.svg (knockout assumes a light field background).
4. **Recipient picker is inline type-ahead.** First Name field lists/sorts "First Last"; Last Name lists/sorts "Last, First"; left-to-right prefix match with the matched prefix highlighted; selecting from either list fills both fields. No-match state offers "Add '{typed}' as a new contact…" → §9.9 pre-filled. After selection, a caption shows the delivery channel ("Will be sent by Email" / "Will be sent by Request Texting").
5. **§9.8 Find / Select / Add Contact retired** (heading retained for numbering; duplicate detection stays in §9.9.4; the Phase 2 contact-import consent question moves to PRD §9.3).
6. **Due Time (optional) added to the Request data model** (PRD §2.1; new §2.7). A Request with a Due Time becomes **Overdue at the stated time**; date-only Requests become Overdue at end of the due date (11:59 PM), **anchored to the sender's time zone**; times are entered in the sender's time zone and displayed in each viewer's local time zone. On the main screen, **rows carrying a Due Time gain a third line: the time renders beneath the date in the Due column**, inheriting the row's bold/red treatment (PRD §3.2; UI spec §6.4.1); description truncation (2 lines) is unaffected. ToDos unchanged: no Due Time, Overdue still does not apply.
7. **Add Category confirmed as a one-field dialog** (§6.12) that creates the category (20-cap enforced inline) and selects it; rename/delete remain Settings-only. The compose Category field accepts list selection or dialog creation, not raw free text.
8. **Request Type selector deliberately omitted** from the pilot screen; it ships with the Phase 2 Custom Data Fields bundle.
9. **Compose behavior details:** required fields are recipient, Due Date, Description (optional fields explicitly labeled); Send is never disabled, failures marked inline; confirm-discard dialog on Cancel when the form is dirty; description counter appears past 400 of 500 characters; attachments panel is a fixed-height list with per-row remove and a vertical elevator, Add Attachment disabled at the 10-file cap; Due Time inert until a Due Date is set; month-forward calendar / now-forward clock (visual design deferred to §6.17; pilot uses browser-native pickers styled to palette 1).
10. **v2.7 / v12.4 cut and accepted.** Tracked redlines (author "Claude") were produced against the uploaded v2.6 / v12.3 originals and validated (schema-valid; every change tracked); clean versions were then generated with the post-redline wording agreed this date (glyph sizing/coloring, Due Time third line) already applied: WouldYouPlease\_UI\_Design\_Specification\_v2\_7.docx, WouldYouPlease\_PRD\_v12\_4.docx. Remaining manual steps in Word: refresh the PRD table of contents (F9) so §2.7 appears, and embed Figure 9.2.1 from the browser render of the canonical mockup.

**Alternatives considered and rejected**

* *Reusing wyp\_icon\_search.svg for lookup fields* — one glyph, two behaviors (executes a search vs. announces focus behavior) collides with the documented search-bar meaning.
* *Unicode character (e.g. ⌕ U+2315) instead of an SVG* — glyph coverage and rendering weight vary across Windows/iOS/Android/web fonts; an SVG is the only controllable rendering.
* *Trailing chevron only* — standard combobox cue but reads as a plain pull-down and undersells the type-ahead.
* *"Create \& Send Request" title* — sending is inherent to creating; label too long.
* *Full-width third line for the Due Time* — breaks four-column scanning; time beneath the date in the Due column keeps the grid aligned.
* *Pure #000 pointer* — Ink #1F2933 is visually identical at size and stays inside the palette.

**Follow-ups**

* Owner: replace canonical files in project knowledge (PRD v12.4, UI spec v2.7, WYP\_create\_request\_palette1.html, the three glyph SVGs, this log); update the Canonical sources block per wyp\_project\_instructions\_update.md (PRD v12.4, UI spec v2.7 docx, nine icons, retire the Excel sheet/row/column preference).
* Owner: on-device legibility check of the three glyphs at 17 px inside resting labels; F9 the PRD TOC; visual pass over Figures 5.1, 9.1, 9.2.1, 9.9.1, 9.9.2 (image references were rebuilt after an accept-step fault mispaired pictures, and Figure 9.2.1 was rendered in-environment rather than in Chrome).
* Next design task (owner-queued): §6.17 calendar and clock picker visual design.
* Still open from prior entries: ToDos chips strip color.

\---

## 2026-07-17 (later) — Readability restructure of both documents

Both redlines reorganized per owner request: (1) a Contents section (two levels, Word TOC field over Heading 1/2) inserted at the front of each document — the field populates on open in Word (auto-update enabled) or via F9; (2) the version history moved out of the front matter into a new "Schedule A — Revision History" at the end of each document, split into one entry per version for readability (UI spec: 7 entries; PRD: 18). A schedule was chosen over a numbered section before the open-questions/issues sections to avoid renumbering §12/§13+ and breaking cross-references. Title-page and footer version strings bumped to v2.5 / v12.3 (footer edits are outside Word's tracked-changes scope; all body changes remain tracked). Both documents revalidated against their originals.

\---

## 2026-07-17 — Figures embedded, §12 restructure, banner label finalized

**Decisions taken**

1. **Screen layouts live only in the UI Specification** (owner decision). PRD §12 is restructured to a pointer: the embedded main-screen figure, its caption, and the §12.1 design-decision bullets are removed; §12 now states that all screen designs, renders, and design commentary are specified only in the companion spec, with functional behavior remaining in PRD §3. Before deletion, every §12.1 rule was verified as already present elsewhere (filter independence PRD §3.3; sort defaults and tap-to-reverse §3.2/§3.4; overdue-red rows §3.2; print Dialog prompt §3.6; truncation §2.4) — nothing orphaned. The §14.2 cross-reference to Figure 12.1 now points to spec Figure 9.1. Rationale: recurring update hiccups and the stale "radio buttons" bullet showed duplicated design detail rots in place; the documents' own separation-of-concerns statement argues for single-homing.
2. **Free-tier banner label finalized: "See Subscription Features and Other Options"** (renamed from "See Subscription Options and Features"), making non-subscription settings discoverable behind the free-tier banner and resolving the open question logged 2026-07-16. Subscriber label unchanged. Updated in both redlines, both mockups, and the §12 open-questions list (question removed).
3. **Figures embedded in the UI spec** from the canonical mockups at 480-px width (2x): Figure 9.1 from WYP\_main\_screen\_palette1.html; Figure 9.9.1 from WYP\_add\_contact\_palette1\_floating.html; Figure 9.9.2 from the new WYP\_add\_contact\_no\_contact\_dialog\_palette1.html (palette-1 form under the §6.12 acknowledge-only dialog and Scrim), which replaces WYP\_add\_contact\_no\_contact\_dialog.html as the canonical dialog mockup. Image swaps are not trackable as Word revisions; captions carry the tracked source references.
4. **UI spec §11.1**: the wyp\_icon\_settings.svg bullet is tracked-deleted (retirement was already recorded in §5.1 and the version histories).

**Follow-ups**

* Owner: replace canonical files in project knowledge (both redlines after accept, three mockups, this log); update the Canonical sources block (UI spec v2.5, PRD v12.3, mockup filenames); add "Request Texting" to the terminology list; correct the instructions-block price to $17.95/year; add the new maintenance sentence (screen renders and design detail belong to the UI spec only).
* Still open: on-device check of Band #E7E7E7; ToDos chips strip color.

\---

## 2026-07-16 (later) — v2.5 / v12.3 redlines cut

UI spec v2.5 and PRD v12.3 produced as tracked-changes documents (author "Claude"): WouldYouPlease\_UI\_Design\_Specification\_v2\_5\_tracked.docx, WouldYouPlease\_PRD\_v12\_3\_tracked.docx, per the change manifest (WYP\_v2.5\_v12.3\_change\_manifest.md). Owner approved the three flagged items before the cut: band hairlines dropped, banner attention wash moved to Focus Tint, and the stale "radio buttons" bullet in PRD §12.1 corrected to chips. Figure 12.1 / 9.1 image re-embeds remain pending (requires rendering the HTML mockups to images). After review/accept: replace the canonical files in project knowledge, update the Canonical sources block version numbers, add "Request Texting" to the terminology list, and correct the instructions-block price to $17.95/year (PRD wins per precedence rule).

\---

## 2026-07-16 — Floating labels, Focus Halo, and blue focus tint adopted; Band darkened to #E7E7E7

**Decisions taken**

1. **Floating-label input pattern adopted** (closes the 2026-07-15 open question). §6.10 anatomy becomes: label inside the field at rest (14 px/500, Ink Soft), rising above the value on focus or when a value is present (≈11 px/600; Brand Blue while focused, Ink otherwise); field minimum height 50 px; transition suppressed under prefers-reduced-motion per §8.9.
2. **Focus Halo adopted.** `--focus-halo: 0 0 0 3px rgba(42,95,200,.22)` is promoted from proposed to canonical (§3.1). Full focus state for text inputs: #EDF2FD fill, 1-px Brand Blue border, 3-px halo.
3. **Blue focus tint #EDF2FD confirmed** as the merged behavior of the floating-label exploration (which predated palette 1 and used Field Yellow) and palette 1's retirement of yellow fills.
4. **Band darkened: #EFF1F4 → #E7E7E7.** The lighter grey read too weak, most visibly on Add a Contact where the band sits directly against the #F6F7F9 form surface with no white gap; owner judged it too light even on the main screen where white space intervenes. #E7E7E7 was the owner's darkness reference and is adopted exactly: a *pure neutral* grey, deliberately not a cool grey, so the group-level Band is unmistakably distinct from the blue-family Strip #E5ECF7 (one hue step per hierarchy level). Owner notes the hex is approximate to the intended darkness; confirm on device.
5. **Compressed "Send Requests by" row adopted** (owner mockup, this date). The chip pair and the gating notice share one full-width Strip row (chips left, notice right, vertically centered, \~44-px min height), replacing the v2.4 fit-content Strip island with the notice below. Rationale: the fit-content tint existed only to keep the white unselected chip visible and read as arbitrary; full-width, Strip reads as an intentional control row, consistent with the search bar's Strip-tinted Settings segment. The notice sits adjacent to the Text chip it explains, and its appearance can never reflow the form.
6. **Gating notice is persistent, both tiers** — supersedes 2026-07-06 decision 2's reactive behavior (notice appeared only when a free user tapped Text). The reactive design existed to avoid vertical cost, which the side-by-side layout eliminates; a persistent notice also upsells before the failed tap and keeps the row identical across tiers. On narrow screens the notice may wrap to three lines and the row grows — accepted by owner; no stack-back breakpoint.
7. **Notice text: Ink Soft #5A6675 at 12 px** (≈4.9:1 on Strip, clears AA 4.5:1). Owner's mockup grey was lighter; no new grey token introduced. Escalate to Ink if faint on device.
8. **Tier-differentiated notice wording adopted.** Free user: "Texting a Request is available with a subscription — see the banner below." Subscriber: "Your subscription includes Request Texting — see the banner below for other options." Line breaks fall naturally after "subscription" (free) and "Texting" (subscriber) at the standard 480-px width. *Unresolved conflict, flagged:* §6.14 hides the subscription banner for subscribers, so the subscriber string's "see the banner below" currently points at nothing — resolve before v2.5 (reword, or change §6.14 to show subscribers an options banner).
9. **Banner strategy revised: the bottom banner shows for both tiers** (owner mockups, this date), with tier wording — free user: "See Subscription Options and Features"; subscriber: "Account Options and Features". This resolves decision 8's flagged conflict: the subscriber notice's "banner below" reference now points at a real surface. §6.14's "subscribers: hidden" rule is superseded. The ad slot remains free-tier only per the PRD freemium constant (paid = ad-free); the subscriber mockup showed the ad slot, treated as a mockup artifact pending owner confirmation.
10. **Settings gear removed from the main-screen search bar**; remaining search-bar content (scope pull-down, field, voice, search icons) shifts left. Settings/account functions are assumed to live behind the banner destination for both tiers. §6.6 "part 0" Settings segment is retired. The wyp\_icon set is unaffected (the gear was not one of the six canonical icons).
11. **"Request Texting" locked as the feature's proper name** — add to the project terminology list. Both notice strings now use it (decision 12), replacing the mixed "Texting a Request"/"Request Texting" phrasing.
12. **Notice strings revised (supersede decision 8's strings).** Free user: "Request Texting is available with a subscription — see the banner below." Subscriber: "Request Texting is included in your subscription — see the Account banner below for other options."

**Alternatives considered and rejected**

* *Cool grey at the same darkness (≈#E3E7EC)* — sits within 1–2 steps of both Rule #E2E6EC and Strip #E5ECF7; the band would read as a wide hairline or a faded Strip, re-collapsing the two-level cue the palette work just sharpened.
* *Keeping #EFF1F4 and adding a white gap on Add a Contact instead* — treats the symptom on one screen; owner confirmed the band was too light even with the gap.

**Consequence to note**

* The band's 1-px Rule hairlines (#E2E6EC on #E7E7E7) are now effectively invisible. Harmless — the fill self-defines the band edge against white above and #F6F7F9 below — but v2.5 should either drop the band hairlines or leave them documented as vestigial. Recommendation at cut time: drop.

**Mockup files**

* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_palette1.html`, `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html` — both updated in place with Band #E7E7E7. The Add a Contact variant is now the approved reference for §6.10.
* *Dropping the Strip and giving unselected chips the Input Border* — compresses equally but bordered white chips read as buttons/fields rather than a selector, and discards Strip-means-control-surface.

**Follow-ups**

* Confirm the ad slot stays free-tier only (subscriber mockup showed it; PRD says paid = ad-free).
* Confirm where free users reach non-subscription settings now that the gear is gone (assumed: the banner destination page carries account options for both tiers).
* Add "Request Texting" to the terminology list in the Project instructions block.
* On-device check of #E7E7E7 before the v2.5 cut (owner flagged the hex as approximate).
* Still open from 2026-07-15: ToDos chips strip — Strip blue vs neutral.
* Cut UI spec v2.5 with tracked changes (list in the 2026-07-15 entry, plus: §3.1 Focus Halo row and Band #E7E7E7; §6.10 floating-label anatomy and 50-px height; band hairline decision; §6.2/§9.9 compressed send-by row and persistent notice with decision-12 strings; §6.6 gear removal; §6.14 both-tier banner with tier wording; §9.1 figure regenerated without the gear).

\---



## 2026-07-15 — Palette 1 ("modernize around Brand Blue") adopted; entry-field visibility resolved; floating-label exploration continued (UI spec v2.4 → v2.5 cut pending)

*Recovery note: the three palette options were designed in the "Color palette design for screen…" conversation, which hit the per-conversation length limit and could no longer accept input. The option text was recovered by copy-paste and is recorded here in full so the reasoning is not lost. Lesson applied: palette-level decisions now land in this log the day they are made.*

**Decisions taken**

1. **Palette option 1 adopted.** Keep Brand Blue #2A5FC8 exactly as is (protects the nine logo/icon SVGs, the sales one-pager, and the domain's identity) and modernize everything around it: primary buttons go flat (solid Brand Blue; hover/pressed at Blue Pressed #1E4AA0; no gradient, no 2-px bevel shadow); Row Tint moves from blue #EFF4FC to neutral near-white **#F6F7F9**; Field Yellow retires as a fill; the focus state becomes a soft blue tint **#EDF2FD** under a 1-px Brand Blue border and the proposed Focus Halo; red becomes exclusively a status color. Owner confirmed after reviewing the applied main-screen mockup.
2. **Heading bands survive, in neutral.** The Requests / ToDos heading bands keep their structural job (quick visual reference to the two major screen regions — the original purpose of the yellow) but the fill moves to a new neutral **Band** token **#EFF1F4** and the group labels move from Alert Red to Ink. This resolves palette option 1's own open question ("bands neutral, or keep a yellow accent?") toward neutral.
3. **Strip stays blue.** Palette 1 retired the blue Row Tint canvas, not Strip #E5ECF7. The Sent/Received/ToDos sub-heading and chips strips (and the search bar's Settings segment) keep Strip, preserving the second-level cue — blue-tinted strip = section chrome — and Strip becomes the only blue-tinted surface, which sharpens the cue.
4. **Sort Highlight #FFE34D is the single surviving yellow**, used for the active-sort pill only. Field Yellow's heading-band job passes to Band (decision 2); its focus-fill job passes to #EDF2FD (decision 1). The Field Yellow token is retired from §3.1.
5. **New Input Border token #7E8A9A.** With near-white surfaces, a white field with the 1-px Rule border (#E2E6EC, ≈1.3:1 on white) effectively disappears — the owner's concern for Add a Contact and all future entry screens, confirmed by contrast math. Text inputs, the scope pull-down, the search field, and the country-code selector take a 1-px **Input Border #7E8A9A** boundary (≈3.5:1 on white, clearing the WCAG 2.1 §1.4.11 3:1 non-text minimum). Rule remains for hairlines, dividers, and card borders only. This settles field visibility once at the token level.
6. **Focus system unifies on one color family.** Focused fields: #EDF2FD fill, 1-px Brand Blue border, 3-px Focus Halo (proposed token `--focus-halo: 0 0 0 3px rgba(42,95,200,.22)`). The yellow-means-active convention (2026-07-05 decision 8) is superseded: blue-tint-means-active, matching the Brand Blue focus rings already in §10.3.
7. **Alert Red is status-only.** Overdue rows, the Overdue chip, and inline error messages keep red; group labels lose it (decision 2). This strengthens the PRD's existing rule that red = Overdue by making red mean exactly one thing app-wide.
8. **Floating-label input pattern applied to Add a Contact for review (not yet adopted).** Per the recovered exploration: label floats inside the field, rising on focus or when a value is present; field minimum height 50 px (up from 40 px) to seat the risen label; label transition suppressed under prefers-reduced-motion per §8.9. Under palette 1 the floating pattern's focus fill is #EDF2FD (the exploration predated the palette decision and used Field Yellow). The two questions remain separable and open: halo yes/no, floating label yes/no.

**Palette options recorded (recovered text, condensed)**

* *Option 1 — adopted (above).* "Cheapest change with the biggest perceived-age effect"; touches no PRD design constants except the Field Yellow references in the UI spec.
* *Option 2 — deep teal.* Suits the courteous product personality; rejected as second choice: full asset repaint, abandons blue equity, and teal pairs poorly with a red status color at equal prominence.
* *Option 3 — iris violet.* Current productivity-app vernacular (Linear, Notion accents); rejected: fashionable in the way the 2012 gradient buttons were — most likely to date soonest.
* *Rejected outright:* warm cream + terracotta (this year's most overused AI-generated look); dark-mode-first with a neon accent (poor for a data-dense list app whose web-respond view opens for unregistered recipients in default light contexts); any green accent (collides with the natural semantic for Done).

**Alternatives considered and rejected (application decisions)**

* *Dropping the heading bands entirely* — fails the squint-test grouping of the two major regions, the bands' stated purpose.
* *Keeping the bands yellow as "the single yellow accent"* — competes with the Sort pill and keeps two yellows alive.
* *Blue-tinted (Strip) heading bands* — collapses the two-level hierarchy; group band and section strip would read as the same surface.
* *Grey-filled resting fields instead of a stronger border* — conflicts with white-at-rest (2026-07-05 decision 8's structure, which survives) and grey fills read as disabled.
* *Keeping Rule as the input border* — fails 3:1 on the new near-white surfaces; Rule was already ≈1.3:1 on white and was carried by the old tinted form background.

**Mockup files**

* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_palette1.html` — new; main screen with palette 1 applied (neutral bands, Ink group labels, flat buttons, #F6F7F9 zebra, Input Border on the search bar). Candidate Figure 9.1 for v2.5.
* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html` — new; Add a Contact with palette 1 plus the floating-label pattern (Email pre-filled to show the risen-label state). Review pending — floating label and halo are separate open decisions.
* The three existing v2.4 mockups remain canonical until v2.5 is cut.

**Documents to update (pending — UI spec v2.4 → v2.5 with tracked changes)**

* §3.1: Row Tint hex → #F6F7F9; Field Yellow row retired; new rows Band #EFF1F4, Input Border #7E8A9A, and (if adopted) Focus Halo; Strip usage note extended.
* §3.2: "Brand Blue on Field Yellow" verification mooted; re-verify Alert Red on the new Row Tint (passes — lighter surface, contrast improves); add Input Border 3:1 non-text verification.
* §3.3: tinted-background list updated (Band replaces Field Yellow; focus tint #EDF2FD noted as a state fill, not a surface).
* §6.1 Primary button: flat anatomy, pressed = Blue Pressed fill.
* §6.3 sort pill note: Sort Highlight is the sole yellow.
* §6.6 Search bar: field border → Input Border; bar surface → Band.
* §6.7 Group label: Ink on Band.
* §6.10 Text input: rest = white + Input Border; focus = #EDF2FD + Brand Blue border (+ halo if adopted); floating-label anatomy and 50-px height if adopted.
* §9.1 / §9.9 figures regenerated from the new mockups.
* PRD: Figure 12.1 regeneration; §12.1 key-decisions bullets touching yellow bands and red labels.

**Follow-ups**

* Owner review of `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_palette1\\\\\\\_floating.html`: decide halo yes/no and floating label yes/no (separable).
* Decide whether the ToDos chips strip keeps Strip blue or goes neutral to extend the color-coding logic (Sent/Received = Requests family).
* Confirm the Band grey #EFF1F4 after on-device review (warmer/cooler/darker).
* Cut UI spec v2.5 with tracked changes per the list above; then replace mockups in project knowledge and update the Canonical sources block.
* Web-respond emails already in flight render with the old palette; no action needed, but note for support if recipients report a mismatch during rollout.

\---



## 2026-07-06 — Per-contact Request delivery channel, subscription gating, Subscription banner, ad slot, Settings icon (UI spec v2.3 → v2.4; PRD v12.1.1 → v12.2 pending)

**Decisions taken**

1. **Per-contact delivery channel on Add / Edit Contact.** A "Send Requests by" field — a two-chip single-select row (Email / Text) in the §6.2 chip anatomy on a Strip surface — sits directly after Phone, before Notes (Notes stays last, preserving the 2026-07-05 field order). Email is the default; until the user taps a chip explicitly, the selection auto-follows data entry (filling Phone while Email is empty switches to Text, subscribers only, and vice versa); once tapped, the choice sticks.
2. **Text delivery is a subscriber feature.** For free users, tapping Text does not change the selection; an inline Ink Soft notice appears beneath the chip row — "Sending Requests by Text is available with a subscription — see the banner below." — and the Subscription banner washes Field Yellow for \~2 s (no wash under reduced motion). Rationale: Twilio/SNS per-message SMS cost is then incurred only by revenue-generating accounts, consistent with the 2026-07-02 decision to monetize via optional paid add-on features.
3. **Validation follows the selection.** On Save the field matching the delivery selection is required. Because a free user's selection is always Email, free-tier contacts effectively require an Email; Phone remains optional "for later subscription use — or just for reference" (owner wording). This narrows the 2026-07-05 either-Email-or-Phone minimum for the free tier; confirmed by the owner. Free-tier caption: "Minimum required — Either First or Last Name, and an Email. Phone is optional and can be used for Text delivery with a subscription." Subscriber caption: "…and the Email or Phone that matches your Send Requests by choice."
4. **Subscription banner (§6.14), free tier only, all screens.** Full-width, min 40-px, white, 1-px Rule top hairline, centered 13-px/700 Brand Blue label "See Subscription Options and Features"; the whole strip opens Subscription/Upgrade (§9.14). Subscribers never see it (owner decision this date, superseding the earlier all-users intent) and manage their plan through Settings instead.
5. **Settings icon and search-bar segment.** Eighth icon `wyp\\\\\\\_icon\\\\\\\_settings.svg` (gear, house style: 48 viewBox, #2A5FC8, 2.5-px strokes, round caps). Lives in a new leading Strip-tinted segment of the search bar (§6.6): full bar height, 46-px wide, 1-px Rule right hairline. Strip chosen over the owner mockup's darker-yellow segment — Strip already means "interactive chrome surface," avoids a new §3.1 token, and a darker yellow risks reading as a focused field. Icon renders at 24 px matching Voice Search and Search (initial 22-px draft corrected after owner review; glyph extent also enlarged to match optical weight). Settings is main-screen-only; task screens carry no Settings entry.
6. **AdSense shares the bottom edge (free tier).** Reserved fixed 50-px slot (320×50 unit) at the true bottom edge, below the banner (§6.15). Stack order search bar → banner → ad keeps the banner as a buffer against accidental ad taps. Free-tier bottom chrome ≈ 148 px on the main screen; subscribers carry only the \~56-px search bar. 320×100 rejected (≈30% of a small-phone viewport).
7. **Figures regenerated.** Figures 9.9.1/9.9.2 re-rendered from the updated mockups (free-tier state, gating notice shown for documentation); Figure 9.1 re-rendered from the updated main-screen mockup at the original 480×1391 aspect — this also clears the v2.3 flag that Figure 9.1 still showed the removed header rule.

**Alternatives considered and rejected**

* *Owner-mockup presentation* — two wide verb-labeled pills ("Send Requests by Email" / "Send Requests by Text") below Notes: the selected pill is visually identical to the Secondary button (§6.11), verb-led labels read as immediate actions, and the control sits away from the fields it validates. Replaced by a labeled noun-chip pair after Phone.
* *New darker background token* for the chip strip and settings segment — Strip (#E5ECF7) already serves the purpose; §3.3 restricts new tinted backgrounds.
* *Hiding the Text chip from free users* — invisible features don't upsell.
* *Modal upsell on tapping Text* — heavier than the moment warrants; inline notice + banner wash chosen.
* *Toast for the gating notice* — auto-dismisses before the user finds the banner.
* *Radio buttons / dropdown* for the channel choice — radios retired in v2.1; a dropdown hides a two-option choice.
* *No control (auto email-else-SMS)* — the pre-existing PRD §7.3 rule; defeats the stated intent.
* *Header-band Settings placement* — owner judged it visually distracting; the band was deliberately stripped in v2.0.
* *Dismissible banner for subscribers* — mooted once the banner became free-tier-only.
* *320×100 ad unit* — excessive fixed chrome on small phones.

**Mockup and asset files**

* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_screen.html`, `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_no\\\\\\\_contact\\\\\\\_dialog.html` — chip pair, gating notice, updated minimum-required caption, banner + ad slot. Supersede prior copies.
* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` — settings segment, banner, ad slot. Supersedes prior copy.
* `wyp\\\\\\\_icon\\\\\\\_settings.svg` — new; source block added to `wyp\\\\\\\_assets\\\\\\\_source.md` (icon table now 8 entries). Add to `wyp\\\\\\\_assets\\\\\\\_reference.pdf` at next regeneration.

**Documents updated / pending**

* UI spec v2.3 → v2.4 cut with tracked changes: title page, version history, §3.3, §5 intro (icon count corrected Six → Eight — "Six" was already stale in v2.3, predating the v2.1 Contract icon), §5.1 table row, §6.2 Notes, §6.6 anatomy and notes, new §6.14 Subscription banner and §6.15 Reserved ad slot, §9.9 (composition, behavior, captions, open question on a per-Request channel override), §9.13/§9.14 entry points, §11.1, footers; Figures 9.1/9.9.1/9.9.2 images replaced.
* PRD v12.1.1 → v12.2 **blocked on upload of the true .docx** — project knowledge holds a text extraction, not the Word container (same situation as the UI spec before 2026-07-05). Required edits (exact wording drafted in chat): §3.8 contact delivery-method field; §6 feature table ("Send Requests by Text" paid; banner + ad stack free); §6.2 SMS-cost note; §7.3 pilot note reword (free senders deliver by email; SMS for subscriber senders per contact setting, and as fallback for non-registered recipients without a known email); §14.3 icon inventory 7 → 8.
* Project instructions "Canonical sources" block refreshed this date (see chat) — replaces the stale block citing PRD v11, the Excel UI spec, 6 icons, 3 logos, and $11.99/year.

**Follow-ups**

* Upload true PRD v12.1.1 .docx; cut v12.2 with tracked changes.
* Accept v2.4 tracked changes; replace UI spec v2.3 with v2.4 in project knowledge; replace the three HTML mockups and `wyp\\\\\\\_assets\\\\\\\_source.md`; regenerate `wyp\\\\\\\_assets\\\\\\\_reference.pdf` to include the settings icon.
* Open question carried in §9.9: per-Request one-off override of the contact's delivery channel (Phase 2 candidate).
* Pilot analytics: track gating-notice impressions → subscription conversions as a first-class metric alongside the §16 set.

\---



## 2026-07-05 — Add/Edit Contact screen design finalized (UI spec v2.2 → v2.3 cut pending)

**Decisions taken**

1. **Notes field retained** per PRD §3.8: multi-line, optional, 500-character limit consistent with the app-wide text convention.
2. **Minimum-required rule** per owner mockup: either First or Last Name, and either Email or Phone.
3. **Field order:** First Name, Last Name, Email, Phone, Notes (First Name first — matches North American entry habit and browser autofill order).
4. **Phone field uses a country-code selector** that defaults to a *visible* "+1" from browser locale — never blank. Stored values are E.164, required for SMS invitations via SNS/Twilio; Canada is also +1, so the default is not US-specific.
5. **Duplicate handling on Save:** if the entered email or phone matches an existing contact, a modal offers "This email matches your existing contact \[Name]." with actions Update that contact / Save as new / Cancel. Resolves the open duplicate question in UI spec §9.8.
6. **No-contact interception flow:** tapping Create Request with zero contacts routes to Add a Contact with an acknowledge-only modal ("To create a Request, a Contact is needed. Click anywhere to proceed. After you click Save Contact, you'll be returned to Create a Request."). Save returns to Create Request with the new contact selected; Cancel returns to the main screen with toast "Without adding at least one Contact, Requests cannot be created."
7. **New design-system items:** Scrim token (Ink #1F2933 at 45% opacity, §3.1); Text input (§6.10, including the phone country-code variant); Secondary button (§6.11 — white fill, 1.5-px Brand Blue outline); Modal dialog (§6.12); Toast (§6.13).
8. **Resting inputs are white with a Rule border;** Field Yellow marks only the focused field, preserving the yellow-means-active convention established by the search bar.
9. **Header bottom rule removed on all screens;** the first Field-Yellow heading band sits flush beneath the header with no top margin or top hairline (recovers 12 px). Subsequent heading bands on the same screen keep the 11-px top margin and hairline. Implemented in all three HTML mockups via `.hdr + .band{margin-top:0;border-top:none;}`.

**Alternatives considered and rejected**

* *First-Name-required rule* — stricter than the owner's stated minimum; rejected in favor of either-name.
* *Cancel returning to Create Request* — would immediately re-trigger the interception modal; main screen chosen instead.
* *"OK"-buttoned interception dialog* — click-anywhere dismissal is faster and matches the owner mockup.
* *Second filled-blue Cancel button* — equal visual weight for opposite actions; secondary style introduced instead.
* *Blank country-code display for the US default* — reads as unset/broken, hides that international entry is possible, and E.164 storage needs the code regardless.
* *Bottom-of-form button placement* — top placement matches the owner mockup and the established heading-band-plus-button pattern, and keeps Save visible without scrolling.
* *Disabling Save until the minimum is met* — hides why the button won't work; always-enabled with inline errors is more discoverable and screen-reader friendly.
* *Keeping the first band's top hairline at the header junction* — would visually reproduce the removed header rule.

**Mockup files**

* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_screen.html` — new; intended as Figure 9.9.1 in UI spec v2.3.
* `WYP\\\\\\\_add\\\\\\\_contact\\\\\\\_no\\\\\\\_contact\\\\\\\_dialog.html` — new; intended as Figure 9.9.2.
* `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` — updated (header rule removed, Requests band raised); **supersedes the copy in project knowledge**, which must be replaced or Figure 9.1 will show a line the spec no longer describes.

**Documents to update (pending)**

* UI spec v2.2 → v2.3 with tracked changes: §3.1 Scrim token; §6.8 header note ("no bottom rule; first heading band sits flush"); new §6.10–6.13; §9.8 duplicate cross-reference; §9.9 placeholder replaced with the full design; title page, version history, and footer. **Blocked on upload of the true v2.2 .docx** — project knowledge holds a text extraction, not the Word container.
* Project instructions "Canonical sources" block is stale (cites PRD v11, Excel UI spec, 6 icons, 3 logos, $11.99/year); refresh to PRD v12.1.1, UI spec v2.3 once cut, 7 icons, 4 logos, $17.95/year at the same time.

**Follow-ups**

* Toast microcopy sentence-case convention rolls into the existing §12 open question.
* Consider listing the three HTML mockup filenames in the canonical-sources block so they are formally part of the asset inventory.

\---

2026-07-05  v12.1 — PRD restyled to v11.x template after v12.0 formatting loss; title-page tagline corrected to 'Tracking Requests and ToDos'; file format flag updated so Word 365 no longer prompts to upgrade on save."

\---

2026-07-02 — Section 6.2 cost/revenue model corrections and monetization direction (PRD v11.1 → next revision)
Decisions taken

1. Long-term volumes corrected to linear per-user scaling. The prior Long-Term figures (5M items/day, 3M Dialog/day at 1M users) implied a 10x jump in per-user activity versus Pilot/Year 1. Per-user rates are now held constant (\~0.5 items, \~0.3 Dialog/day), giving 500,000 items and 300,000 Dialog entries/day at 1M users. 500,000/day is a planning figure; owner expects volumes may ramp well beyond it. Section 7.2 updated to match. Long-term annualized infrastructure drops from $410K–$660K to \~$100K–$180K.
2. Ad revenue now applies only to monthly-active users, at a 50–70% active share (owner selected the higher band). Long-term ad revenue $215K–$605K. No revenue from ad-driven purchases is assumed — owner has no basis for such an assumption.
3. Usage split assumption: \~50/50 personal/business, with most users doing both. Consequently, no personal/business flag at signup — users won't self-classify cleanly. Business-oriented monetization instead comes from optional paid add-on features drawn from the Section 9 roadmap.
4. Pricing held at $17.95/year, annual billing only, through the pilot. Monthly billing rejected: Stripe's $0.30 fixed fee is \~23% of a \~$1.50 monthly charge. Quarterly identified as the lowest practical recurring period (\~9% fee load) but deferred — it adds churn/dunning complexity for unproven demand. Corrected cost base no longer forces a price increase; revisit after pilot conversion data.
Alternatives rejected: personal/business signup flag; immediate price increase; quarterly SKU at launch; modeling ad-to-purchase uplift.
Follow-ups: add-on packaging/pricing added to PRD §15.2 open items; pilot analytics should track ad RPM and paid conversion as first-class metrics (already in §16).

\---

## 2026-06-28 — Logo asset finalization (PRD v11.1 / UI spec v2.2)

**Decisions taken**

1. **Horizontal lockup completed in matched light- and dark-background variants.** Two SVG files: `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_light\\\\\\\_bg.svg` (mark + brand-blue wordmark + grey tagline) and `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_dark\\\\\\\_bg.svg` (mark + white wordmark + light-blue tagline). Proportions match the main-screen header rendering in `WYP\\\\\\\_main\\\\\\\_screen\\\\\\\_content\\\\\\\_only.html` (40-px mark height in the live mockup); the lockup viewBox is 820×220 with the mark seated at x=0 and the text block left-aligned at x=240.
2. **Stacked lockup format dropped.** Previously listed in PRD §14.3 and UI spec §11.2 as "to be regenerated." No longer needed; the horizontal lockup covers the use cases the stacked format was reserved for.
3. **Tagline canonical wording confirmed: "Tracking Requests and ToDos."** This matches the existing usage in PRD §12.1, UI spec §6.8, and the main-screen header mockup. Intermediate variants that surfaced during design exploration ("For Request Tracking and ToDos" in `wyp\\\\\\\_logo\\\\\\\_final\\\\\\\_overview.svg`, "Request and ToDo Tracking" considered briefly during horizontal lockup design) are explicitly non-canonical and should not be reintroduced. Capitalization is "ToDos" (capital T, capital D) wherever the term appears.
4. **`wyp\\\\\\\_icon\\\\\\\_only.svg` removed from the canonical inventory.** The prior speech-bubble mark was carried as "superseded" in PRD §14.3 since v7.2. It is no longer part of the asset bundle and is not maintained. If a future project needs the prior mark for historical context, it can be retrieved from git history of the asset source file.
5. **Naming convention for logo variants:** `wyp\\\\\\\_logo\\\\\\\_<format>\\\\\\\_<background>.svg`, where `<background>` is either `light\\\\\\\_bg` or `dark\\\\\\\_bg`. The existing `wyp\\\\\\\_logo\\\\\\\_checked\\\\\\\_request\\\\\\\_light\\\\\\\_bg.svg` / `wyp\\\\\\\_logo\\\\\\\_checked\\\\\\\_request\\\\\\\_dark\\\\\\\_bg.svg` pair already followed this; the new horizontal lockup files extend it. Future lockup formats, if any, should follow the same pattern.

**Asset bundle layout**

The canonical assets now live in two project-knowledge files:

* `wyp\\\\\\\_assets\\\\\\\_reference.pdf` — visual reference with every icon and logo rendered, including dark-background variants shown on illustrative brand-blue and navy panels.
* `wyp\\\\\\\_assets\\\\\\\_source.md` — markdown file with the raw SVG source for every asset in fenced code blocks. SVG is plain XML text, so any asset can be recovered by copying the relevant code block into a `.svg` file.

This pattern exists because the project knowledge base does not accept direct `.svg` uploads. The PDF and markdown together replace what would otherwise be a folder of nine standalone SVG files.

**Documents updated**

* PRD v11.0 → v11.1 (title page, version history, §14.3 asset inventory, page footer).
* UI Design Specification v2.1 → v2.2 (title page, version history, §6.3 logo narrative, §11.2 asset inventory, page footer corrected from a stale v1.0 to v2.2).
* Project instructions: "Canonical sources" block replaced to reference the new asset bundle files and the updated 7-icon / 4-logo inventory.

**Alternatives considered and rejected**

* *Single horizontal lockup file with no light/dark distinction.* Rejected because the dark variant needs different fill on the bubble (white instead of outlined) and different text colors (white wordmark, light-blue tagline). Trying to express both in one SVG would have required either inline CSS that responds to the host context (fragile across renderers) or runtime swapping (adds complexity for no clear gain). Two files is cleaner and matches the precedent set by the mark-only pair.
* *Keeping `wyp\\\\\\\_logo\\\\\\\_horizontal.svg` as a third lockup file alongside the light- and dark-background variants.* Rejected because there was no defined use case for an "unspecified background" lockup that wasn't already covered by one of the two background-specific variants.
* *Retaining `wyp\\\\\\\_icon\\\\\\\_only.svg` in the inventory as a historical reference.* Rejected because the canonical inventory should reflect current assets only. Historical references belong in the decisions log (this file) or git history, not in the active asset list.
* *Producing partial doc revisions per change rather than waiting for a version cut.* Rejected at the time and reversed by the explicit ask for tracked-changes docs. Decided that for substantive asset changes that affect multiple sections across both docs, doing a clean v11.1 / v2.2 cut with tracked changes is preferable to partial in-place revisions that would have left a v11.0 / v2.1 document inconsistent with the new canonical sources block in the project instructions.

**Follow-ups**

* After accepting tracked changes in both docs, regenerate the PDF exports if any external readers receive them.
* The main-screen mockup (PRD Figure 12.1, UI spec Figure 9.1) currently renders the mark plus separately-positioned wordmark and tagline text rather than the horizontal lockup SVG. No change required — the mockup composition still matches the design intent — but if Figure 12.1 / 9.1 is ever regenerated, consider whether dropping in `wyp\\\\\\\_logo\\\\\\\_horizontal\\\\\\\_light\\\\\\\_bg.svg` as a single asset would simplify the markup.
* The Sales One-Pager PDF (in project knowledge) is presumed to use the dark-background mark in its header/footer bands. Confirm at the next sales-collateral refresh.

