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

// Chrome's own native Print dialog sizes its own preview pane off the
// browser/app window's current width at the moment print is invoked — no
// CSS or web API can make that dialog's preview pane bigger directly.
// Owner-reported 2026-09-16: printing from the installed desktop app (its
// own launch width is 552px, see PWAProvider.tsx) showed "primarily...
// printer settings and a very small and not readable version of the
// report," fixed by manually widening the window first — confirmed
// readable "at double-width of the normal app size." This automates that
// workaround: widen just before printing, restore on 'afterprint' (fires
// whether the person actually printed or hit Cancel). A no-op outside the
// installed standalone window — resizeTo is refused or ignored inside a
// normal tab, and mobile printing already reads full-page per the owner's
// own report, so this never touches the far more common tabbed/mobile
// experience.
//
// Position, not just size (2026-09-17, owner-reported) — window.screenX/
// screenY is how a script reads where its own window sits on the physical
// screen; there's no separate "which monitor/corner" API needed here.
// Widening the window doesn't move it — screenX is supposed to stay fixed
// and the window just grows rightward — but if the window is docked near
// the right edge of the screen, the OS/browser silently repositions it
// leftward first so the wider window still fits on-screen, changing its
// own screenX as a side effect of the widen. Restoring only width/height
// afterward then resizes from that shifted position, not the original one,
// which is exactly the "jumps to the left" symptom reported (docked left,
// with room to grow right, never triggered the clamp, so it was never
// seen there). Capturing and explicitly restoring screenX/screenY
// undoes that regardless of which edge the window started against.
export function printWithExpandedWindow(): void {
  if (typeof window === 'undefined') {
    return
  }
  if (!isStandaloneDisplay()) {
    window.print()
    return
  }

  const originalWidth = window.outerWidth
  const originalHeight = window.outerHeight
  const originalX = window.screenX
  const originalY = window.screenY

  function restore() {
    window.removeEventListener('afterprint', restore)
    try {
      window.resizeTo(originalWidth, originalHeight)
      window.moveTo(originalX, originalY)
    } catch {
      // Some platforms refuse resizeTo/moveTo outright — harmless to skip.
    }
  }

  try {
    window.resizeTo(originalWidth * 2, originalHeight)
  } catch {
    // If the widen itself is refused, still print — just without the fix.
  }
  window.addEventListener('afterprint', restore)
  window.print()
}
