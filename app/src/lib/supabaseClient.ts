// src/lib/supabaseClient.ts

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * "Keep me signed in" is a client-side storage decision, not a Supabase
 * setting. supabase-js persists the session in localStorage by default, which
 * survives closing the browser. When the user unchecks the box we route the
 * session to sessionStorage instead, so it dies with the tab.
 *
 * The preference itself lives in localStorage (it is not a secret) so that the
 * choice survives the round trip through the emailed link, which typically
 * opens a brand-new tab with empty sessionStorage.
 */
const REMEMBER_KEY = 'wyp.remember'

export function setRememberMe(remember: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')
}

function shouldRemember(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(REMEMBER_KEY) !== 'false'
}

const hybridStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null
    return (
      window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
    )
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return
    if (shouldRemember()) {
      window.sessionStorage.removeItem(key)
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
      window.sessionStorage.setItem(key, value)
    }
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    storage: hybridStorage,
  },
})
