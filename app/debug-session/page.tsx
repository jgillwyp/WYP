'use client'

import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabaseClient'

/**
 * Temporary diagnostic page (2026-09-22) — Chrome-for-iOS is effectively
 * un-debuggable remotely (no chrome://inspect support the way Chrome-
 * Android has, and Safari's Web Inspector can't attach to it either, since
 * it's Apple's own WebKit under a Chrome skin), so this exists purely to
 * let a tester screenshot their own device's actual local session state —
 * no dev tools needed. Built to chase an owner-reported iPhone Chrome bug:
 * a signed-in session is lost after force-quitting and reopening the
 * browser, even with "Keep me signed in" checked, even with every relevant
 * Supabase session-expiry setting ruled out. Deliberately NOT wrapped in
 * RequireAuth — the whole point is inspecting state even when the app
 * itself thinks there's no session.
 *
 * Shows structure/metadata only, never raw token strings — this page's
 * whole purpose is to be screenshotted and shared, and a live bearer token
 * has no business landing in a chat transcript or a screenshot passed
 * around. Remove this route once the underlying bug is found.
 */

type LocalStorageEntry = {
  key: string
  looksLikeSupabaseToken: boolean
  parsed: {
    hasAccessToken: boolean
    hasRefreshToken: boolean
    expiresAt: string | null
    tokenType: string | null
  } | null
  parseError: string | null
  rawLength: number
}

export default function DebugSessionPage() {
  const [entries, setEntries] = useState<LocalStorageEntry[]>([])
  const [rememberValue, setRememberValue] = useState<string | null>(null)
  const [lastEmailValue, setLastEmailValue] = useState<string | null>(null)
  const [userAgent, setUserAgent] = useState('')
  const [getSessionResult, setGetSessionResult] = useState<string>('checking…')
  const [getUserResult, setGetUserResult] = useState<string>('checking…')

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Deferred one microtask, same pattern as this app's other mount-time
    // setState-from-a-synchronous-read effects (e.g. CreateRequestForm.tsx's
    // voiceSupported) — satisfies react-hooks/set-state-in-effect.
    queueMicrotask(runDiagnostics)

    function runDiagnostics() {
    setUserAgent(window.navigator.userAgent)
    setRememberValue(window.localStorage.getItem('wyp.remember'))
    setLastEmailValue(window.localStorage.getItem('wyp.lastEmail'))

    const found: LocalStorageEntry[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key) continue
      const looksLikeSupabaseToken = key.startsWith('sb-') || key.includes('auth-token')
      if (!looksLikeSupabaseToken) continue
      const raw = window.localStorage.getItem(key) ?? ''
      try {
        const obj = JSON.parse(raw)
        const expiresAtRaw = obj?.expires_at
        const expiresAt =
          typeof expiresAtRaw === 'number'
            ? `${new Date(expiresAtRaw * 1000).toISOString()} (${
                expiresAtRaw * 1000 < Date.now() ? 'ALREADY EXPIRED' : 'still valid'
              })`
            : null
        found.push({
          key,
          looksLikeSupabaseToken,
          parsed: {
            hasAccessToken: typeof obj?.access_token === 'string' && obj.access_token.length > 0,
            hasRefreshToken: typeof obj?.refresh_token === 'string' && obj.refresh_token.length > 0,
            expiresAt,
            tokenType: obj?.token_type ?? null,
          },
          parseError: null,
          rawLength: raw.length,
        })
      } catch (err) {
        found.push({
          key,
          looksLikeSupabaseToken,
          parsed: null,
          parseError: err instanceof Error ? err.message : 'unknown parse error',
          rawLength: raw.length,
        })
      }
    }
    setEntries(found)

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setGetSessionResult(`ERROR: ${error.message}`)
      } else if (data.session) {
        setGetSessionResult(
          `session found — expires_at ${new Date(data.session.expires_at! * 1000).toISOString()}`
        )
      } else {
        setGetSessionResult('no session (null)')
      }
    })

    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        setGetUserResult(`ERROR: ${error.message}`)
      } else if (data.user) {
        setGetUserResult(`user found — id ${data.user.id}`)
      } else {
        setGetUserResult('no user (null)')
      }
    })
    }
  }, [])

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>WYP Session Debug (temporary)</h1>
      <p style={{ marginBottom: 16 }}>Screenshot this whole page and send it back. No token values are shown, only structure/metadata.</p>

      <h2 style={{ fontSize: 14 }}>navigator.userAgent</h2>
      <div style={{ marginBottom: 12 }}>{userAgent || '(loading…)'}</div>

      <h2 style={{ fontSize: 14 }}>localStorage[&quot;wyp.remember&quot;]</h2>
      <div style={{ marginBottom: 12 }}>{JSON.stringify(rememberValue)}</div>

      <h2 style={{ fontSize: 14 }}>localStorage[&quot;wyp.lastEmail&quot;]</h2>
      <div style={{ marginBottom: 12 }}>{JSON.stringify(lastEmailValue)}</div>

      <h2 style={{ fontSize: 14 }}>Supabase-looking localStorage keys ({entries.length} found)</h2>
      {entries.length === 0 && <div style={{ marginBottom: 12 }}>(none found)</div>}
      {entries.map((e) => (
        <div key={e.key} style={{ marginBottom: 12, border: '1px solid #ccc', padding: 8 }}>
          <div><b>key:</b> {e.key}</div>
          <div><b>raw length:</b> {e.rawLength}</div>
          {e.parseError && <div><b>parse error:</b> {e.parseError}</div>}
          {e.parsed && (
            <>
              <div><b>has access_token:</b> {String(e.parsed.hasAccessToken)}</div>
              <div><b>has refresh_token:</b> {String(e.parsed.hasRefreshToken)}</div>
              <div><b>token_type:</b> {e.parsed.tokenType ?? '(none)'}</div>
              <div><b>expires_at:</b> {e.parsed.expiresAt ?? '(none)'}</div>
            </>
          )}
        </div>
      ))}

      <h2 style={{ fontSize: 14 }}>supabase.auth.getSession()</h2>
      <div style={{ marginBottom: 12 }}>{getSessionResult}</div>

      <h2 style={{ fontSize: 14 }}>supabase.auth.getUser() (live round-trip)</h2>
      <div style={{ marginBottom: 12 }}>{getUserResult}</div>
    </div>
  )
}
