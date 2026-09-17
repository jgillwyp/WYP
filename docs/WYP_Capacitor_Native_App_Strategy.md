# WYP Native App Strategy — Capacitor (Android/iOS)

Status: **planning only, nothing built.** Written 2026-09-17 at Jim's request,
to have on file before deciding whether/when to pursue an App Store/Play
Store presence. Not an instruction to start building — see "Recommended
build order" at the end for what a go-ahead would actually kick off.

## Why Capacitor, and why not something else

Three real paths exist for a "native" WYP app; see the decisions log's
2026-09-17 entry for the full comparison. Summary of why Capacitor is the
recommended one:

- **True separate native (Swift/SwiftUI + Kotlin/Compose)** — rebuilds this
  entire app's UI twice, in two languages, forever maintained as three
  parallel codebases (web + iOS + Android). Given how much is already built
  (every screen in this project's own history — Main Screen, Create/Detail
  screens for Requests and ToDos, Archive, Contacts, Account Options,
  Calendar View, Storage Management, and more), this is the largest and
  least justified cost unless there's a hard requirement the other two paths
  can't meet. There isn't one currently identified for WYP.
- **React Native rewrite** — one shared codebase for both mobile platforms,
  but still a near-total UI rewrite (HTML/CSS/Tailwind has no direct
  equivalent in React Native's own component/styling model) and a second
  codebase to maintain in parallel with the web app going forward.
- **Capacitor (this doc's subject)** — wraps the *existing*, already-built,
  already-tested Next.js web app inside a thin native shell per platform.
  Reuses 100% of the current UI, Supabase backend, RLS security model, and
  business logic verbatim. The real engineering is limited to: the wrapper
  project itself, a small number of native plugins for capabilities a
  browser can't reach (see below), and each store's submission/review
  process. This is the only one of the three paths that doesn't imply
  rebuilding WYP.

## What Capacitor actually is

An open-source project (Ionic) that packages a web app inside a native
WebView per platform, producing a real installable `.ipa` (iOS) or `.apk`/
`.aab` (Android) — not a browser tab, a genuine App Store/Play Store
listing with its own icon, splash screen, and native process. The web
app's own code doesn't need to be rewritten; Capacitor loads it (either
by bundling a built copy of the site inside the app, or by pointing the
WebView at the live deployed site — see "Bundled vs. remote" below) and
exposes a JS bridge (`@capacitor/core`) that lets the existing React code
call native plugins when it needs something a browser genuinely can't do.

### Bundled vs. remote content

Two configurations, not mutually exclusive:

- **Remote** — the WebView simply loads `https://wouldyouplease.com`, same
  as today. Every deploy to Vercel updates the app instantly, with zero app
  update/re-review needed for ordinary feature work. This is the natural
  starting point given WYP already deploys continuously.
- **Bundled** — a built copy of the Next.js static output ships inside the
  app binary, so it works fully offline and doesn't depend on network
  reachability to even load the shell. WYP has no offline-first requirement
  today (every screen already assumes a live Supabase connection), so this
  isn't obviously worth its added build complexity (a static export step,
  a mechanism to actually push data updates, an app-store re-review for
  every shell change) — flagged as a later "if reviewers push back" or "if
  offline shell-loading turns out to matter" option, not a starting
  recommendation.

## What stays exactly the same

- The entire web app — every screen, every API route, every Supabase table/
  function/RLS policy — is untouched. Capacitor loads it; it doesn't fork it.
- Magic-link auth, the RLS security model, the cron/reminder system, the
  Attachments/Storage system: all unchanged.
- Desktop (Windows/Mac browsers) and the existing PWA install path
  (Chrome's own `beforeinstallprompt`, and Safari's manual Add to Home
  Screen) are unaffected — Capacitor is additive, a third way to reach the
  same app, not a replacement for the first two.

## What's genuinely new work

1. **Two wrapper projects** (`ios/` and `android/` folders Capacitor
   generates), each pointed at the deployed site. Mechanical setup, low
   effort — days, not weeks.
2. **App identity assets** — icon (already exists, see the manifest/PWA
   icon work from 2026-08-18), splash screen, and each store's own
   metadata (description, screenshots, privacy nutrition label/Data Safety
   form — see "Store review considerations" below).
3. **Push notifications** (optional, but the main reason to prefer this
   over the existing PWA) — `@capacitor/push-notifications`, backed by
   Firebase Cloud Messaging (Android) and APNs (iOS, via Firebase or
   direct). Requires:
   - A new `device_tokens` table (owner id, platform, token, RLS owner-only)
     — comparable in shape to the existing `attachments`/`dialog` tables.
   - A send path — either extending `app/api/cron/tick/route.ts`'s existing
     reminder logic to also push a notification alongside (or instead of)
     the email it already sends, or a new dedicated send route. The
     eligibility/timing logic already built (Day before/Day of/Day after,
     per-request-type Reminder settings) carries over unchanged; only the
     delivery channel is new.
   - This is the feature that answers Jim's own "reminder beeps" question
     (see below) — a local OS notification, with sound, is the mechanism.
4. **"Add to Calendar," made graceful (optional)** — replacing the current
   client-side `.ics`-Blob-download mechanism (unreliable on Android, per
   this project's own 2026-08 investigation) with a native calendar plugin
   (`@capacitor-community/calendar` or equivalent), which calls iOS's
   EventKit and Android's CalendarContract directly: a real permission
   prompt, then the event lands in the calendar with no downloaded file and
   no "tap Add" step to silently fail. Not automatic from wrapping alone —
   this is its own small, well-scoped plugin-integration task, gated behind
   a native-platform check (`Capacitor.isNativePlatform()`) so the existing
   web/PWA `.ics` download path stays exactly as-is for browser users.
5. **Store submission and review** — see below.

## Store review considerations

- **Apple Developer Program**: $99/year, required to publish or even
  TestFlight-distribute an iOS build.
- **Google Play Console**: $25 one-time registration.
- **Apple's In-App Purchase requirement** (guideline 3.1.1): a digital
  subscription used inside an iOS app generally must be sold through
  Apple's own IAP, not an external processor like Stripe — this is a
  business/policy decision, not an engineering one, and the single biggest
  open question before committing to an iOS listing. Realistic options,
  not mutually exclusive:
  - Build Apple IAP as a second purchase path alongside Stripe, gated to iOS
    only — real engineering work (StoreKit integration, receipt validation,
    reconciling an Apple-purchased subscription with the same `profiles.
    tier`/`subscription_renewal_date` columns the web app already uses).
  - Ship the iOS app as a free download with no in-app purchase surface at
    all — a subscriber who bought through the website still gets full
    access (their account's `tier` is already server-side, not tied to
    where they paid), the iOS app simply never offers to sell one. This
    avoids Apple's IAP requirement entirely, at the cost of not being able
    to pitch/sell the subscription from inside the iOS app itself.
  - Skip the iOS App Store entirely and ship Android-only as a first step —
    Google's policy is comparably friendly to Apple's here but has more
    flexibility in practice, and Android already supports the PWA install
    prompt WYP already built. This is a legitimate way to get real
    Play Store presence without resolving the Apple IAP question at all.
- **Revenue share**: 15% (small business, under $1M/year) to 30%, on both
  stores, but *only* on purchases actually transacted through each store's
  own IAP/Billing system — irrelevant if the app never sells anything via
  IAP (see options above).
- **Privacy disclosures**: both stores require a data-safety/privacy-label
  form describing what's collected (email, name, request/contact content,
  attachments) and which third parties it's shared with (Supabase, Vercel,
  Hostinger — the same sub-processors already named in `/privacy`). Mostly
  a matter of transcribing what `/privacy` already discloses into each
  store's own form format, not new disclosure work.
- **Review turnaround**: Apple's review is typically 24–48 hours per
  submission (can be longer on first submission or if flagged); Google's is
  usually faster, often same-day to a few days. Both re-review any build
  update — this is one more reason the "remote" content configuration is
  attractive: ordinary web-only feature work never triggers a re-review,
  only changes to the native shell itself (a new plugin, an icon change,
  a permissions change) do.

## Does Capacitor let us issue reminder "beeps"?

Yes. Two Capacitor plugins cover this, and they're not mutually exclusive:

- **`@capacitor/local-notifications`** — schedules a notification entirely
  on-device (no server round-trip at the moment it fires), with a title,
  body, and a sound — either the OS default alert sound or a custom bundled
  sound file. Could be scheduled at the moment a Reminder-eligible Request/
  ToDo is created or edited, entirely client-side, mirroring the existing
  `reminder_enabled`/`reminder_day_of_enabled`/`overdue_reminder_enabled`
  logic without needing the cron job to know about it at all — though this
  has a real limitation: it only fires if the phone the reminder was
  scheduled on still has the app installed and the OS hasn't cleared the
  scheduled alarm, and it can't reach a *different* device than the one
  that scheduled it (a Reminder set on a phone won't also alert a desktop).
- **`@capacitor/push-notifications`** — server-triggered via Firebase Cloud
  Messaging/APNs, matching how the existing email cron system already
  works today (`app/api/cron/tick/route.ts` already knows exactly when each
  Reminder is due). This is the better fit for WYP's actual architecture,
  since the eligibility/timing logic is already centralized server-side and
  already reaches whichever device(s) a person is signed into — extending
  it to also push a notification (with sound) alongside, or instead of, the
  email it already sends is additive, not a redesign.

Either plugin can produce an audible alert ("beep") plus a vibration and a
badge count, matching normal phone notification behavior — this genuinely
isn't reachable from the current PWA on iOS with the same reliability (iOS
web push exists since Safari 16.4 but has real limitations: it requires the
PWA to already be installed to the Home Screen, and historically has been
less consistent than native push). Android's own web push support is
already fairly solid, for what it's worth — this gap is mostly an iOS one.

## Windows/Mac desktop — out of scope, and that's fine

Capacitor targets Android and iOS specifically; there's no Capacitor
"desktop" target relevant here (Electron exists for that but isn't in
scope — nothing about WYP's desktop experience needs it). Windows/Mac
users already have a fully working experience through the browser/PWA,
including Add to Calendar, which — per live testing — already works
correctly there. Nothing described in this document changes anything
about the Windows or Mac desktop experience.

## Recommended build order, if/when this is greenlit

1. Capacitor project setup (`ios/`/`android/` wrappers), remote-content
   configuration, pointed at the live deployed site. Confirm the existing
   app runs correctly inside both WebViews with zero code changes — this
   alone is enough to get a real TestFlight/Internal Testing build in
   front of Jim and a few testers.
2. Resolve the Apple IAP question (pick one of the three options above)
   before submitting to the App Store — this blocks iOS specifically, not
   Android.
3. Push notifications: `device_tokens` table + send-path extension to the
   existing cron reminder system. The single highest-value addition this
   whole effort unlocks.
4. Native Add to Calendar plugin, replacing the `.ics`-download path on
   native builds only (web/PWA path unchanged).
5. Store listing assets, privacy/data-safety forms, submission.

Nothing above needs to happen in this exact order except step 2 gating
step 5 for iOS specifically — Android could proceed through steps 1, 3, 4,
and its own store submission independently of any iOS decision.
