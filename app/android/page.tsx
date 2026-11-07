import WypHeader from '../components/WypHeader'

// Android direct-install download page (2026-11-02) — Jim: "Could we add a
// download for it at wouldyouplease.com/android? It wouldn't email
// (typically) as an executable of some sort." APK attachments are commonly
// stripped or blocked by email providers the same way a raw .exe would be,
// so a direct link here is the reliable alternative to attaching the file.
// No RequireAuth — reached straight from an emailed link to a tester who
// isn't signed in yet, same posture as /privacy, /r/[token], and
// /textmessaging. No Close/back button either, matching
// RequestResponseForm.tsx's own reasoning for an anonymous, link-only
// visitor: there's no prior in-app history to return to.
//
// Not linked from anywhere in the app or the public landing page — reachable
// only by whoever has this exact URL, the same unlisted-but-not-secret
// exposure the TestFlight invite link already has. The real APK file isn't
// something this sandbox can produce or copy in (it's a binary Jim builds
// locally in Android Studio); it has to be copied into
// public/android/would-you-please.apk and committed/pushed from his own
// checkout for the Download link below to actually resolve.
//
// Content mirrors the tester email's own wording (flush-the-old-PWA-icon
// step, the "unknown sources" install warning, the numeric-sign-in-code
// note) so a tester who lands here from a different path than the email —
// or re-visits later for an updated APK — gets the same instructions either
// way.
//
// Rewritten as explicit numbered steps, 2026-11-07 — owner-reported: his
// wife visited this exact URL and "it only opened a WYP Chrome session -
// did not prompt for or install the app." The page was never going to
// install anything on its own — visiting it just shows these instructions;
// installing takes two separate taps (Download, then open the downloaded
// file to actually trigger Android's install prompt), and the original
// prose buried that second, easy-to-miss step inside a sentence about the
// "unknown sources" warning rather than calling it out as its own step. A
// visitor who only ever did the first tap (or who, like her, landed on the
// page without yet tapping Download at all) would see exactly this: a
// normal web page in Chrome, nothing more. Numbered so each action is its
// own line rather than something to extract from a paragraph.
//
// Step 2 widened + a new Step 3 added, 2026-11-08, same owner, finishing
// that same install: "it stepped me to a Google/Chrome/Android setting
// which I turned off - it did not work - I had to separately unlock a
// 'block' on installing non-store apps and allowed it to revert after 30
// minutes" — the single "unknown sources" permission the old copy
// described is only the first of two separate Android checks on a
// sideloaded app; Google Play Protect can block the install a second time
// on top of it, with its own separate "allow anyway" and its own
// short-lived, auto-reverting exception, which the old copy never
// mentioned at all. And: "no desktop icon [my son has one from his
// install]" — confirmed this isn't something the app controls; some
// phones/launchers add a newly-installed app's icon straight to the Home
// Screen, others only add it to the App Drawer and leave placing it on the
// Home Screen to the person, and that behavior is a per-device/launcher
// setting, not something an APK can request or guarantee.
export default function AndroidDownloadPage() {
  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Android App</span>
        </div>

        <div className="scroll">
          <div className="form">
            <p>
              Would You Please isn&rsquo;t on the Google Play Store yet &mdash; this is the
              direct install file for private testers. Installing takes two steps below &mdash;
              just opening this page doesn&rsquo;t install anything by itself.
            </p>

            <div className="noticeband">
              <b>Note:</b>{' '}
              If you ever added a Would You Please icon to your Home Screen
              straight from Chrome, delete it first (press and hold it, then Remove) &mdash;
              this avoids ending up with two icons that look identical. No need to sign out
              first, and nothing is lost either way.
            </div>

            <p style={{ margin: '20px 0 4px' }}>
              <b>Step 1:</b> Tap the button below. Android will download the install file &mdash;
              you&rsquo;ll see a &ldquo;Downloading&rdquo; notification, then a
              &ldquo;Download complete&rdquo; one once it&rsquo;s done.
            </p>
            <p style={{ textAlign: 'center', margin: '4px 0 20px' }}>
              <a className="btn" href="/android/would-you-please.apk" download>
                Download the Android App
              </a>
            </p>

            <p className="subnote">
              <b>Step 2:</b> Open that &ldquo;Download complete&rdquo; notification (or open your
              Downloads/Files app and tap &ldquo;would-you-please.apk&rdquo;) to actually install
              it &mdash; this is the step that&rsquo;s easy to miss. Android will warn you about
              installing something from outside the Play Store; that&rsquo;s expected, go ahead
              and allow it (it may send you to a Chrome settings screen to turn that on, then
              bring you back here &mdash; just tap Install again once you&rsquo;re back). You may
              then see a <i>second</i>, separate warning from Google Play Protect about an
              unrecognized app &mdash; if so, tap &ldquo;More details&rdquo; or &ldquo;Install
              anyway&rdquo; to get past that one too. Either allowance is temporary and reverts on
              its own after a short while, which is normal &mdash; it doesn&rsquo;t need to be
              turned back off by hand.
            </p>

            <p className="subnote">
              <b>Step 3:</b> Once it&rsquo;s installed, open it from its own app icon, not from
              Chrome. If you don&rsquo;t see a new icon on your Home Screen, check your App Drawer
              (the full list of installed apps) &mdash; some phones only add new app icons there,
              leaving it up to you to drag one to the Home Screen if you want it there too. This
              varies by phone/launcher and isn&rsquo;t something this install file controls.
            </p>

            <p className="subnote">
              If you ever sign out and back in from inside the app, the link in the sign-in
              email usually won&rsquo;t open the app itself &mdash; it&rsquo;ll land in Chrome
              instead. Use the numeric code from that same email instead.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
