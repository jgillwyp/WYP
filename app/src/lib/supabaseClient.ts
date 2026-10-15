// src/lib/supabaseClient.ts

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

/**
 * `NEXT_PUBLIC_*` variables are inlined into the bundle at BUILD time, so they
 * must be referenced as complete static expressions. `process.env[name]` does
 * not work — the compiler cannot see which variable is meant. Hence the switch
 * rather than a lookup.
 */
type PublicEnvName =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

function requireEnv(name: PublicEnvName): string {
  const value =
    name === 'NEXT_PUBLIC_SUPABASE_URL'
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!value) {
    throw new Error(
      `[WYP] Missing environment variable ${name}. ` +
        `Set it in Vercel under Settings -> Environment Variables with the ` +
        `Production and Preview scopes ticked, then redeploy; or add it to ` +
        `.env.local for local development. The name must match exactly — ` +
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a different variable. ` +
        `NEXT_PUBLIC_* values are baked in at build time, so an existing ` +
        `deployment will not pick up a newly added value without a rebuild.`
    )
  }
  return value
}

/**
 * The client is created lazily, on first property access, rather than when this
 * module is evaluated.
 *
 * Why: Next prerenders every route at build time, which evaluates this module.
 * Creating the client at module scope meant a missing environment variable
 * threw during prerender and failed the whole build with an opaque stack trace
 * ("supabaseKey is required", 2026-08-03). Deferring creation means a missing
 * variable surfaces in the browser, at the moment it is actually needed, with
 * the message above naming the variable.
 */
let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          storage: hybridStorage,
        },
      }
    )
  }
  return cached
}

/**
 * Keeps the familiar `supabase.auth.signInWithOtp(...)` call shape while
 * routing every access through `getSupabase()`. Methods are bound to the real
 * client so `this` stays correct when they are pulled off the proxy.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase() as unknown as Record<
      string | symbol,
      unknown
    >
    const value = client[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/**
 * `supabase.auth.getUser()` with a single refresh-and-retry on failure
 * (2026-10-15). `getUser()` is the right call wherever a trust-sensitive
 * operation needs a live, Auth-server-validated identity — Supabase's own
 * guidance recommends it over `getSession()` for exactly that reason — but
 * unlike `getSession()`, it does NOT auto-refresh an expired access token;
 * it just fails outright.
 *
 * Confirmed from a real Supabase Auth Logs incident (2026-10-13, two of
 * Jim's iPhones losing their signed-in state): 15 minutes of repeated 403
 * "token has invalid claims: token is expired" on `/user`, in bursts of
 * two or three roughly once a minute, with no refresh ever attempted in
 * between — until something else eventually triggered one and it
 * succeeded immediately. (Supabase's own refresh-token reuse-detection
 * was checked and ruled out: every `POST /token` in that same log, at
 * every timestamp across the whole range, showed the identical routine
 * "token revoked: request completed" success message — the ordinary
 * message for expected rotation, not a distinct reuse-detection error.)
 * Browsers throttling JS timers in a backgrounded tab can also delay
 * Supabase's own proactive auto-refresh (normally renews a few minutes
 * before the 1-hour access-token expiry), so by the time one of these
 * `getUser()` call sites runs again after the app sat idle, the stored
 * token may already be stale with nothing having tried to fix it yet.
 *
 * This wraps `getUser()` with exactly one retry: on any error, call
 * `getSession()` (which checks expiry and refreshes internally — the same
 * mechanism `app/page.tsx`/`RequireAuth.tsx` already rely on for their own
 * sign-in check) and try `getUser()` once more. If the visitor is
 * genuinely signed out, the retry fails the same harmless way the
 * original call would have — this only fixes the "the token was merely
 * stale" case, not "not signed in."
 */
export async function getCurrentUser() {
  const first = await supabase.auth.getUser()
  if (!first.error) return first
  await supabase.auth.getSession()
  return supabase.auth.getUser()
}
