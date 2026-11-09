# Universal Links / App Links — status and next steps

Written 2026-11-10. This corrects an in-session mistake: earlier the same
day Jim was told this was "not yet configured." That was wrong — real
work already exists, built across seven commits between 2026-10-21 and
2026-11-02, and was never recorded in CLAUDE.md. This doc exists so the
next session starts from the real state instead of re-discovering it, and
so the CLAUDE.md gap itself doesn't repeat.

## Why this matters

Tapping a `wouldyouplease.com` link from a text message or email should
open the already-installed native app (with its own signed-in session)
instead of the device's plain browser (always signed out). Confirmed
today via a real test: with no deep-linking working, the session is
genuinely absent in whatever opens the link, so controls that depend on
`isSignedIn` (e.g. the new Close button on Request Response) correctly
don't show — this isn't a separate bug, it's downstream of this one.

## What's already built (confirmed via git log + a live curl, 2026-11-10)

- `public/.well-known/assetlinks.json` — Android Digital Asset Links file.
  Live, correct, 200, right Content-Type. Contains one
  `sha256_cert_fingerprints` entry: Jim's own **debug keystore**
  fingerprint (`6516941`, 2026-10-21), not a release-signing cert.
- `public/.well-known/apple-app-site-association` — iOS AASA file. Live,
  correct, 200, right Content-Type (forced via `next.config.ts`, since the
  file's extensionless name defeats Vercel's normal content-type
  inference). `appID` is `4G59NPT4P2.com.wouldyouplease.app` — the real,
  paid Apple Individual Program Team ID, confirmed correct after one
  wrong-then-corrected detour (`e15eba3` → `995d9dd`). Scoped to
  `/r/*` and `/textmessaging/*` only.
- `android/app/src/main/AndroidManifest.xml` — `autoVerify="true"`
  intent-filter for `https://www.wouldyouplease.com` only. The apex host
  was deliberately dropped (`cc66008`): Vercel 308-redirects apex → www,
  and Android's Digital Asset Links check requires a direct 200 with no
  redirect at all — one host failing that check marks the *whole* filter
  unverified, taking the otherwise-correct www host down with it.
- `ios/App/App/App.entitlements` — `com.apple.developer.associated-domains`
  = `applinks:www.wouldyouplease.com`, wired into both Xcode build
  configs via `CODE_SIGN_ENTITLEMENTS`.
- `app/components/PWAProvider.tsx` — a `@capacitor/app` `appUrlOpen`
  listener (`d3ca205`), platform-agnostic (gated only on
  `Capacitor.isNativePlatform()`), that reassigns `window.location.href`
  to the intercepted URL once the OS hands it to the app. Without this,
  verified App Links/Universal Links would only ever land on the app's
  start page, never the actual tapped path.

## What's unconfirmed / likely broken, and why

**Android — most likely the actual culprit for today's test, if that's
what was tested on.** The commit trail ends right after the apex-host fix
(`cc66008`, 2026-10-21) with no record of a confirmed, successful retest.
Two real possibilities, not mutually exclusive:

1. The currently-installed APK predates that fix (hasn't been rebuilt
   since 10-21) — the manifest fix can't help an app that was never
   rebuilt with it.
2. The `sha256_cert_fingerprints` entry is a **debug** keystore
   fingerprint specifically — if the installed APK was signed by a
   *different* debug keystore (e.g. rebuilt on a different machine, or the
   debug keystore was regenerated), verification silently fails and
   Android falls back to the browser exactly as if nothing were
   configured, with no visible error anywhere.

**iOS — definitely not working yet, and that's expected, not a bug.**
The entitlement/AASA scaffolding was explicitly left "ready for the first
TestFlight archive" (`f522393`) and has never actually been compiled —
blocked on the same Mac/Xcode access gap documented elsewhere in this
project's iOS history (no Mac in this sandbox; Jim would need either his
own Mac access or a cloud rental, e.g. Scaleway, researched earlier).

## Next steps, in order

1. **Confirm which platform/device today's failing test was actually on**
   — not pinned down in this session. Changes everything about which half
   of this to chase first.
2. **Android diagnostic (no Mac needed, actionable immediately):**
   - On the test device (Android 12+): `adb shell pm get-app-links
     com.wouldyouplease.app` — gives a definitive verified/unverified
     answer straight from the OS, no guessing.
   - If unverified: get the *current* installed APK's real signing
     fingerprint via Android Studio's Gradle `signingReport` task (or
     `keytool -list -v -keystore <path> -alias <alias>`) and diff it
     against the `E2:23:B4:BC:...` value already in `assetlinks.json`.
     Update the file if it's genuinely a different debug keystore now: a
     plain web-only change, no app rebuild needed for *that* part.
   - Rebuild/reinstall the Android app regardless, to pick up the
     `cc66008` manifest fix if the installed build predates it.
   - Retest a real text-message link end to end once verified.
3. **iOS — not actionable until Mac access exists.** Once it does: open
   `ios/App/App.xcodeproj` (or the `.xcworkspace`), confirm the Associated
   Domains capability shows in Signing & Capabilities, archive, install via
   TestFlight, retest. Nothing code-side is missing for this step — it's
   purely a build-and-ship problem.
4. **Close the CLAUDE.md gap** — once the Android diagnostic lands on a
   real answer, record the actual end-to-end status (confirmed working /
   confirmed broken and why) in CLAUDE.md properly, the way every other
   feature in this project is tracked. This doc can be folded into that
   entry once the open questions above are answered, rather than kept
   as a separate file indefinitely.

## Open questions for Jim

- Which device/platform was today's failing test on?
- Has the Android app been rebuilt/reinstalled since 2026-10-21?
- Any progress on Mac access for the iOS side (Scaleway or otherwise)?
