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
 * Help chip), not from an external signed-out context. Close uses
 * `router.back()`, same convention as every Detail-type screen — returns to
 * Main Screen with its Help tab still selected (hkTab persists via
 * sessionStorage/main_chip_prefs regardless of which topic was open).
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
          <button className="btn" type="button" onClick={() => router.back()}>
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
