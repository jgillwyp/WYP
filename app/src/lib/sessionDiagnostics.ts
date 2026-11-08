// Session diagnostics log (2026-11-09) — owner-reported: "it has been
// several days since I used the app on the iPhone" and had to sign in
// again, with no way afterward to tell *why*. By the time he notices and
// signs back in, whatever the stored session's own state actually was is
// already gone — there's nothing left to inspect. `/debug-session`
// (app/debug-session/page.tsx, 2026-09-22) only ever shows a live
// snapshot, which needs catching the problem in the act, before
// re-signing-in destroys the evidence, to be useful at all.
//
// This instead keeps a small, persistent (localStorage, not
// sessionStorage — it has to survive the exact multi-day gaps it's trying
// to explain) ring buffer of session-lifecycle events: every
// supabase.auth.onAuthStateChange event, and every time the app/tab comes
// back to the foreground. The next time a session unexpectedly requires
// re-sign-in, /debug-session can show the trail leading up to that moment
// — e.g. whether the last known expiry had already passed, whether a
// refresh was ever attempted, how long the device actually sat idle —
// without needing to reproduce the bug live.
//
// Deliberately structure/metadata only, same posture as /debug-session
// itself — never a raw token value, so this is safe to leave in place
// indefinitely and safe to screenshot.
//
// Wired in from supabaseClient.ts's own getSupabase() (attached exactly
// once, the same "only on first access" guard that function already uses
// for creating the client itself), not from any individual page — that
// way the log keeps recording regardless of which screen happens to be
// mounted when the real event fires.

const LOG_KEY = 'wyp.sessionLog'
const LAST_SEEN_KEY = 'wyp.sessionLastSeen'
const MAX_ENTRIES = 80

export type SessionLogEntry = {
  ts: string
  kind: 'auth-event' | 'resume'
  event?: string
  hasSession: boolean
  expiresAt: string | null
  /** Only set on a 'resume' entry: ms since the previous logged entry of
   *  any kind — a rough "how long was this device actually idle" figure,
   *  since a backgrounded tab/app stops running its own JS timers and so
   *  logs nothing on its own while away. */
  idleMs?: number
}

function readLog(): SessionLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SessionLogEntry[]) : []
  } catch {
    return []
  }
}

function appendEntry(entry: SessionLogEntry) {
  try {
    const next = [...readLog(), entry].slice(-MAX_ENTRIES)
    window.localStorage.setItem(LOG_KEY, JSON.stringify(next))
    window.localStorage.setItem(LAST_SEEN_KEY, entry.ts)
  } catch {
    // Private window or blocked storage — nothing to log to, harmless;
    // same posture as every other best-effort localStorage write in this
    // app (e.g. the tester checklist's own saveChecked).
  }
}

function expiresAtIso(expiresAt: number | null | undefined): string | null {
  return typeof expiresAt === 'number' ? new Date(expiresAt * 1000).toISOString() : null
}

/** Call from the one central supabase.auth.onAuthStateChange listener. */
export function logAuthEvent(event: string, hasSession: boolean, expiresAt: number | null | undefined) {
  if (typeof window === 'undefined') return
  appendEntry({
    ts: new Date().toISOString(),
    kind: 'auth-event',
    event,
    hasSession,
    expiresAt: expiresAtIso(expiresAt),
  })
}

/** Call whenever the tab/app returns to the foreground. */
export function logResume(hasSession: boolean, expiresAt: number | null | undefined) {
  if (typeof window === 'undefined') return
  const lastSeenRaw = window.localStorage.getItem(LAST_SEEN_KEY)
  const idleMs = lastSeenRaw ? Date.now() - new Date(lastSeenRaw).getTime() : undefined
  appendEntry({
    ts: new Date().toISOString(),
    kind: 'resume',
    hasSession,
    expiresAt: expiresAtIso(expiresAt),
    idleMs,
  })
}

export function readSessionLog(): SessionLogEntry[] {
  if (typeof window === 'undefined') return []
  return readLog()
}

export function clearSessionLog() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LOG_KEY)
    window.localStorage.removeItem(LAST_SEEN_KEY)
  } catch {
    // see appendEntry
  }
}
