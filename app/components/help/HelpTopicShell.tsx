'use client'

import { useRouter } from 'next/navigation'

import WypHeader from '../WypHeader'

/**
 * HelpTopicShell (2026-09-03) — shared frame for the four Help-chip topic
 * screens (Getting Started / Creating a Request / Responding to a Request /
 * ToDo Features), per Jim's own request for "one or several HTML pages under
 * the Help chip." Reuses the standard in-app screen shell every other
 * authenticated screen already uses — `.frame-none`/`.app`/`.band`+
 * `.glabel`/`.scroll` (see AccountForm.tsx/ArchiveForm.tsx for the identical
 * pattern) — rather than Privacy's own wide reading-width layout, since this
 * content is reached from inside the mobile app UI (Main Screen's Housekeeping
 * Help chip), not from an external signed-out context.
 *
 * Close navigates straight to Main Screen (`router.push('/')`), not
 * `router.back()` (2026-09-03, owner-reported) — the "what to try next" nav
 * (HelpNext.tsx) pushes a fresh history entry every time it's followed, so
 * `back()` after walking through several Next-Up hops took multiple clicks
 * to actually leave Help. Main Screen's own scroll-position persistence
 * (`MAIN_SCROLL_KEY`, saved on every scroll and restored on every mount,
 * not gated behind a round-trip marker the way Search/Archive's own state
 * is) already lands back wherever the visitor last scrolled — the
 * Housekeeping Help section, since that's what they scrolled to in order to
 * reach a Help row in the first place — so jumping straight to `/` needs no
 * extra scroll-restore logic of its own, and the Help tab itself stays
 * selected via the same `hkTab` persistence every other tab switch already
 * uses.
 */
export default function HelpTopicShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">{title}</span>
          <button className="btn" type="button" onClick={() => router.push('/')}>
            Close
          </button>
        </div>

        <div className="scroll">
          <div className="help">{children}</div>
        </div>
      </div>
    </div>
  )
}
