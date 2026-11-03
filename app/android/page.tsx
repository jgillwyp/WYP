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
              direct install file for private testers.
            </p>

            <div className="noticeband">
              <b>Note:</b> If you ever added a Would You Please icon to your Home Screen
              straight from Chrome, delete it first (press and hold it, then Remove) &mdash;
              this avoids ending up with two icons that look identical. No need to sign out
              first, and nothing is lost either way.
            </div>

            <p style={{ textAlign: 'center', margin: '20px 0' }}>
              <a className="btn" href="/android/would-you-please.apk" download>
                Download the Android App
              </a>
            </p>

            <p className="subnote">
              Android will warn you about installing something from outside the Play Store
              &mdash; that&rsquo;s expected, go ahead and allow it for this one. Once it&rsquo;s
              installed, open it from its own app icon, not from Chrome.
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
