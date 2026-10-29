import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor config for the native Android (and future iOS) wrapper —
 * 2026-10-16, see WYP_Capacitor_Native_App_Strategy.md for the full
 * rationale. This wraps the *existing*, already-deployed Next.js web app
 * in a thin native shell rather than rebuilding any UI.
 *
 * Remote-content configuration (`server.url`), not bundled: the WebView
 * loads the live site directly, same as a browser would. Every ordinary
 * Vercel deploy updates the app instantly with no store re-review needed
 * — only a change to this native shell itself (icon, a new plugin, a
 * permission) ever requires a new build. See the strategy doc's
 * "Bundled vs. remote" section for why bundled isn't worth it yet (WYP
 * has no offline-first requirement anywhere in the app today).
 *
 * `www` (capacitor-www/) is a near-empty placeholder — Capacitor's CLI
 * requires a `webDir` to exist on disk even in remote mode (it's what
 * `cap sync` copies into the native project as a fallback shown only if
 * the device has no network route to `server.url` at all), but its
 * content is never the primary UI.
 *
 * Points at the canonical `www.` host directly (not the bare apex, which
 * 308-redirects at the Vercel domain level — see CLAUDE.md's 2026-08-22
 * email-logo entry for the same redirect already traced there) so the
 * WebView's first request doesn't pay for a redirect hop.
 */
const config: CapacitorConfig = {
  appId: 'com.wouldyouplease.app',
  appName: 'Would You Please',
  webDir: 'capacitor-www',
  server: {
    url: 'https://www.wouldyouplease.com',
    androidScheme: 'https',
  },
  // iOS-only (2026-10-28, first real-device iOS test): without this, the
  // WKWebView ignores the status bar/notch safe area and renders content
  // starting from the very top physical edge of the screen, pushing the
  // app's own header up behind the status bar instead of below it.
  // 'automatic' makes WKWebView inset its content the same way Safari
  // does natively. Android is unaffected — this key only applies on iOS.
  ios: {
    contentInset: 'automatic',
  },
}

export default config
