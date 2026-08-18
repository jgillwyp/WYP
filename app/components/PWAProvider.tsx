'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

// BeforeInstallPromptEvent isn't part of TypeScript's DOM lib — it's a
// Chromium-only extension, not a web standard — so its shape is declared
// locally rather than pulling in a third-party types package for one event.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PWAInstallContextValue = {
  canInstall: boolean
  promptInstall: () => Promise<void>
}

const PWAInstallContext = createContext<PWAInstallContextValue>({
  canInstall: false,
  promptInstall: async () => {},
})

export function usePWAInstall() {
  return useContext(PWAInstallContext)
}

// Replaces the same-day ServiceWorkerRegister.tsx (never pushed, so renamed
// rather than deprecated) — registers public/sw.js and now also captures
// the browser's beforeinstallprompt event, both as early as possible at the
// root of the app. Registration has to happen here because Android won't
// offer a real install prompt without an active service worker;
// beforeinstallprompt has to be listened for here specifically because the
// browser fires it once, early, and only to a listener that's already
// attached — a component that mounts later (MainScreen's own Housekeeping
// row, added same day) could easily miss it. Wraps {children} rather than
// sitting beside them so the captured prompt is reachable from anywhere via
// usePWAInstall().
//
// Prompted by an owner report, 2026-08-18: he accepted the browser's own
// one-shot install offer during a magic-link sign-in and then couldn't find
// the resulting icon anywhere on his phone (see the decisions log — Android
// Chrome's "Install" typically adds the app to the app drawer like any
// other installed app, not directly to the home screen; the two are easy to
// conflate, and the browser's own install banner only ever appears once,
// opportunistically). MainScreen's new "Install" Housekeeping row is the
// deliberate, findable, repeatable alternative — only rendered when
// canInstall is true, so it never shows a dead control on a browser that
// doesn't support installation or a device that already has it installed.
export default function PWAProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort — a failed registration just means no install
        // prompt; the rest of the app is unaffected either way.
      })
    }

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    function handleAppInstalled() {
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  // Default standalone-window width (2026-08-18, owner-reported) — the
  // manifest itself has no field for a preferred launch size (confirmed via
  // web.dev's own PWA documentation: "There is no way to define your PWA's
  // preferred size and position within the manifest"); Chrome's own default
  // for a freshly-installed desktop PWA is "a percentage of the current
  // screen, with a maximum resolution of 1920x1080," which is far wider
  // than this app's own 480px .frame-none content column and left most of
  // the window as bare grey letterboxing on the owner's laptop. Chrome does
  // remember whatever size the user last leaves the window at (already
  // true before this change — the owner's own report confirmed it, "the
  // next time the WYP app is opened... it remembers the page width"), so a
  // one-time window.resizeTo() call on standalone launch is exactly the
  // sanctioned mechanism here, not a workaround — it just does automatically
  // what the owner was already doing by hand. 552×968 matches the pulled-in
  // size the owner's own screenshot demonstrated as comfortable, rather
  // than an arbitrary guess. Effect deps are `[]`, not re-run per route —
  // PWAProvider wraps the whole app in layout.tsx and only truly remounts
  // on a fresh window launch, so this fires once per open, the same moment
  // Chrome would otherwise apply its own oversized default. No-ops
  // harmlessly on mobile (resizeTo has no effect there, per the same
  // web.dev documentation) and inside a normal browser tab (gated on
  // display-mode: standalone) — never touches the tabbed, non-installed
  // experience most visitors still use.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(display-mode: standalone)').matches) return
    try {
      window.resizeTo(552, 968)
    } catch {
      // Some platforms refuse resizeTo outright — harmless to skip.
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    // The captured event can only be used once regardless of outcome —
    // Chrome fires a fresh beforeinstallprompt later if still eligible.
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return (
    <PWAInstallContext.Provider value={{ canInstall: deferredPrompt !== null, promptInstall }}>
      {children}
    </PWAInstallContext.Provider>
  )
}
