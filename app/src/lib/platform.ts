// Platform/browser detection for the Install Housekeeping row (2026-09-03,
// MainScreen.tsx). Small, stateless heuristics — duplicated-per-file isn't
// warranted here since there's exactly one consumer, but kept in its own
// module rather than inline since it's pure logic with no JSX. None of this
// is meant to be bulletproof against a deliberately spoofed User-Agent — it
// only ever chooses which install copy/affordance to show, never a security
// or data-access decision, so a wrong guess costs nothing worse than the
// wrong instructions.
//
// Every function guards on `typeof window/navigator === 'undefined'` so it's
// safe to import from a component that also renders on the server; each one
// should only actually be called from a mount effect (after hydration),
// matching the existing `voiceSupported` pattern elsewhere in this app.

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isClassicIOSUA = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports its own User-Agent as "MacIntel", indistinguishable
  // from a real Mac by UA string alone — the one reliable tell is touch
  // support, since no Mac has more than one touch point (0).
  const isModernIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return isClassicIOSUA || isModernIPadOS
}

export function isMacOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints <= 1
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

// Distinguishes a phone/tablet install (Home Screen icon) from a laptop/
// desktop one (Dock/Start Menu/taskbar icon) — Jim's own naming request
// (2026-09-03): the Install Housekeeping row should read "Homepage Icon
// Installation" on a phone/tablet and "Desktop Icon Installation" on a
// desktop OS, rather than one generic label for both. Covers Android and
// iOS/iPadOS (both already have their own detectors above) plus the
// generic UA "Mobi" token as a fallback for any other mobile browser.
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return isIOSDevice() || isAndroidDevice() || /Mobi/i.test(navigator.userAgent)
}

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Every other browser on an Apple platform (Chrome, Firefox, Edge) also
  // carries the literal "Safari" token in its own User-Agent string, since
  // they're all built on WebKit there — excluding their own distinguishing
  // tokens is the standard way to isolate real Safari.
  return /^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua)
}

// True once the app is already running as an installed PWA (opened from a
// Home Screen/Dock/Start Menu icon, not a normal browser tab) — on iOS
// Safari specifically via the legacy `navigator.standalone` boolean, every
// other platform via the standard `display-mode: standalone` media feature.
// The Install row's own mount effect checks this first and shows nothing at
// all when it's true, so a visitor who already added the icon is never
// offered a second one.
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}
