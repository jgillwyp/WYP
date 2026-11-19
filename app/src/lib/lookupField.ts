'use client'

// Shared helper for every Contact/Category/Time Zone type-ahead field in the
// app (2026-11-17, owner-reported). On a phone, focusing one of these fields
// pops the on-screen keyboard, which — combined with AppFooter (the ad/
// buttons/copyright strip) still occupying its own space at the bottom of
// the flex column, and the field itself possibly sitting mid-screen with a
// data row still visible above it — can leave only a couple of lines of
// room for the dropdown/type-ahead list below the field. A tester with 14
// Private Categories reported being unable to reach the end of the list at
// all except by carefully scrolling the whole page by hand while the
// keyboard was up.
//
// This moves the just-focused field to the top of its nearest scrollable
// ancestor, right under the fixed header, so whatever room remains above
// the keyboard is spent entirely on the dropdown rather than split between
// the field's own position and an already-visible row above it. Paired with
// AppFooter's own `hidden` prop (set by each caller while its dropdown is
// actually open), this frees the dropdown the most room the screen can
// offer.
//
// Mobile-only (gated on isMobileDevice(), the same UX-only heuristic this
// app already uses for the Install row — never a security/data-access
// decision, so a wrong guess on an edge-case UA costs nothing worse than an
// unnecessary or missing scroll) — a desktop/mouse user clicking a field
// mid-page has no keyboard to make room for, so jumping the field to the
// top would be a surprise with no benefit.
//
// Deliberately delayed, not called immediately on focus — iOS/Android's own
// keyboard-open auto-scroll-into-view fires the instant a field is focused;
// scrolling again in the same tick races that native behavior and can
// produce a janky double-scroll. Waiting lets it settle first, then this
// makes the final correction.
// True on a touch device that pops a real on-screen keyboard (phone/
// tablet) — never a laptop/desktop with a mouse and a physical keyboard
// already always present. Used both to gate the scroll-to-top correction
// below and, by each screen, to gate whether AppFooter should actually
// hide itself while a dropdown is open — on a desktop there's no keyboard
// stealing vertical space, so the footer never needs to make room.
export function isKeyboardDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod|Android|Mobi/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

// `force` (2026-11-19, owner-reported — Advanced Search Filters' own
// Contact Name field): inside .advsearch-modal, the dropdown's real cutoff
// is the *modal's own* bounded max-height/overflow-y:auto (Main Screen's
// tallest dialog, confirmed via a real Windows screenshot showing the
// dropdown clipped at the dialog's own edge with its scrollbar sitting
// right there, unused). That's a different problem from the mobile-
// keyboard one this function was built for — a mouse/desktop user hits it
// exactly as much as a phone does, so the isKeyboardDevice() gate below is
// wrong for this one caller. `force: true` skips that gate while leaving
// every other call site's existing mobile-only behavior unchanged.
//
// Same-day fix, two real phones: the first version of `force` also skipped
// the keyboard-settle delay outright (0ms, unconditionally) — wrong on a
// phone, where this dialog is *also* a keyboard device: the forced scroll
// then raced the real keyboard-open animation exactly the way the comment
// above already warns against, and lost — confirmed via a real iPhone
// screenshot showing the field scrolled to roughly where it would land
// *before* the keyboard's final height was accounted for, leaving the
// dropdown hidden behind the keyboard rather than above it. The delay is
// now keyed on isKeyboardDevice() itself, not on `force` — a forced scroll
// on a real keyboard device still waits out the keyboard animation first,
// same as every non-forced mobile caller; only a forced scroll on a
// non-keyboard device (desktop/mouse, the original Windows case) skips the
// wait, since there's no animation there to race. Also narrowed the scroll
// target to `.frow` (falling back to `.fgroup`) — in this one dialog,
// Contact Name's `.fgroup` is the whole "Request Contact Type" panel
// (label row + To/From checkboxes + the field), not just the field's own
// wrapper the way `.fgroup` is everywhere else in the app; scrolling that
// whole panel to the top wasted room on the header row above the field,
// leaving less of the dialog's own limited height for the dropdown below
// it (the real cause of the owner's separate Android report, "could be
// scrolled up more to show all of the pulldown choices"). `.frow` wraps
// just the labeled field itself everywhere it's used, so this is a
// strictly tighter, equally-safe target for every existing caller too.
export function scrollLookupFieldToTop(field: HTMLElement | null, opts?: { force?: boolean }): void {
  if (!field) return
  const keyboardDevice = isKeyboardDevice()
  if (!opts?.force && !keyboardDevice) return

  // Scroll the whole labeled field (its wrapper, not just the bare <input>)
  // into view, so the label/button beside it comes along rather than being
  // left peeking above the scrolled-to input. scrollIntoView itself finds
  // and scrolls whichever ancestor is actually scrollable — the page's own
  // `.scroll` region for every mobile caller, or a bounded `.modal` (like
  // .advsearch-modal) for a `force` caller — no special-casing needed here.
  const target =
    (field.closest('.frow') as HTMLElement | null) ??
    (field.closest('.fgroup') as HTMLElement | null) ??
    field
  setTimeout(() => {
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, keyboardDevice ? 300 : 0)
}

// Owner-reported 2026-11-17 follow-up: typing the first character into a
// Category field that had no dropdown open yet (nothing browsable) made the
// field visibly jump *down* the screen the instant the dropdown appeared.
// Root cause: AppFooter unmounting at that same moment grows `.scroll`'s own
// clientHeight; if the document was already scrolled near its end, browsers
// clamp scrollTop back down so there's nothing to scroll past, which reads
// on screen as everything shifting toward the bottom of the document — i.e.
// down. Call this from a `useEffect` keyed on the same "is AppFooter hidden
// right now" boolean passed to AppFooter's own `hidden` prop, so the
// correction reapplies the instant that clamp could happen, undoing it in
// the same frame rather than leaving the field to visibly settle somewhere
// lower than where focus first put it. Reads the field from
// `document.activeElement` rather than needing a ref threaded in, since the
// dropdown can only be open while its own field still has focus.
export function scrollActiveLookupFieldToTop(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    scrollLookupFieldToTop(active)
  }
}
