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
