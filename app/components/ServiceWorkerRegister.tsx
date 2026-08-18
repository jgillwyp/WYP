'use client'

import { useEffect } from 'react'

// Registers public/sw.js (2026-08-18) — required by Android Chrome before
// it will offer a real install prompt; see that file's own header comment
// for why it deliberately does nothing beyond satisfying that requirement.
// Rendered once from app/layout.tsx (a server component, so this small
// client component is the mount point) rather than duplicated per screen.
// Renders nothing — this is a side-effect-only component.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort — a failed registration just means no install
        // prompt; the rest of the app is unaffected either way.
      })
    }
  }, [])

  return null
}
