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

export function scrollLookupFieldToTop(field: HTMLElement | null): void {
  if (!field || !isKeyboardDevice()) return

  // Scroll the whole labeled field (its wrapper, not just the bare <input>)
  // into view, so the label/button beside it comes along rather than being
  // left peeking above the scrolled-to input.
  const target = (field.closest('.fgroup') as HTMLElement | null) ?? field
  setTimeout(() => {
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, 300)
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
