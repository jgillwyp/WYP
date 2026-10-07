'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import WypHeader from '../components/WypHeader'
import { supabase, setRememberMe } from '@/lib/supabaseClient'
import { isIOSDevice, isStandaloneDisplay } from '@/lib/platform'

/** Supabase allows one magic link per user per 60 seconds. */
const RESEND_COOLDOWN_SECONDS = 60

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Raw browser fetch-failure text, friendlied up (2026-10-02, owner-reported
// — a private tester on an institutional domain, ourdds.org, saw the literal
// "TypeError: NetworkError when attempting to fetch resource." in the error
// area). supabase-js catches the underlying thrown exception and surfaces it
// as error.message verbatim rather than a real Supabase-returned rejection —
// correct error-handling on the library's part, just not something a
// non-technical person can act on. Matches across browsers' own differently-
// worded phrasing for the same failure class (Firefox: "NetworkError when
// attempting to fetch resource"; Chrome: "Failed to fetch"; Safari: "Load
// failed") — most likely cause is the visitor's own network/firewall
// blocking the request to Supabase's domain, not anything this app controls,
// so the message points them at checking their connection/network rather
// than implying an app bug.
function isNetworkFetchError(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('networkerror') || m.includes('failed to fetch') || m.includes('load failed')
}

// A raw/empty error body leaking through as literal text (2026-10-07,
// owner-reported — saw "{}" rendered in red after firing off several OTP
// requests in a short window). supabase-js falls back to stringifying the
// response body when a failure doesn't carry the usual error_description/
// msg fields, which some Supabase Auth responses do for a rate-limited
// request — so this is deliberately worded to name that as the likely
// cause (distinct from the 60-second per-user cooldown this app already
// enforces, Supabase also has its own project-level email-sending rate
// limit) rather than show the unreadable raw body.
function isUnhelpfulErrorMessage(message: string): boolean {
  const m = message.trim()
  if (!m || m === '{}' || m === '[object Object]') return true
  return m.startsWith('{') && m.endsWith('}')
}

function friendlyAuthErrorMessage(message: string): string {
  if (isNetworkFetchError(message)) {
    return 'Could not reach the sign-in service. Check your internet connection — a work or school network sometimes blocks this — and try again, or try a different network.'
  }
  if (isUnhelpfulErrorMessage(message)) {
    return 'Something went wrong sending the sign-in email. If you just requested several sign-in emails in a row, please wait a few minutes and try again.'
  }
  return message
}

// Remembered email address, 2026-08-15 — owner asked for this as a
// fallback while investigating why a signed-in session doesn't always
// survive a full browser close/reopen (see the decisions log's 2026-08-15
// entry for the full diagnosis — this app's own session-persistence code
// was found to already be correct; the likely causes are outside this
// codebase, e.g. a browser's own "clear cookies/site data on close"
// setting or Supabase's own session/refresh-token expiry, neither of which
// this fix touches). Tied to the same "Keep me signed in" checkbox the app
// already has, not a separate toggle — an unchecked box already means
// "leave no trace on this device," so remembering the email too when it's
// unchecked would contradict that promise on a shared/public computer.
const LAST_EMAIL_KEY = 'wyp.lastEmail'

function getLastEmail(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(LAST_EMAIL_KEY) ?? ''
}

// Bug fix, 2026-08-13 — owner-reported, screenshot of the address bar
// showing /login?intent=signup while the band still read plain "Sign In".
// The original fix (same day, earlier) read `?intent=signup` once via a
// lazy useState initializer on window.location.search, on the reasoning
// that this page is only ever reached client-side anyway. That reasoning
// missed a real case: Next's client-side router can keep a `/login` page
// instance alive/reused across a same-route navigation that only changes
// the search string (e.g. following a prefetched or previously-visited
// `/login` with a fresh `?intent=signup` click) — a lazy useState
// initializer only ever runs once, on that instance's original mount, so a
// later, param-only navigation left it stuck on whatever it read the first
// time. `useSearchParams()` is the actual fix: it subscribes to the
// router's own search-params state and re-renders on every change, mount
// or not. It requires a Suspense boundary around anything that calls it,
// so the page default-exports a thin wrapper and the real screen moved to
// `LoginScreen` below.
export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <LoginScreen />
    </Suspense>
  )
}

function LoginScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isSignupIntent = searchParams.get('intent') === 'signup'

  const [email, setEmail] = useState(getLastEmail)
  const [remember, setRemember] = useState(true)
  const [sent, setSent] = useState(false)
  const [gated, setGated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // 6-digit code fallback (2026-09-29, owner-reported — a private tester's
  // iPhone home-screen icon: Supabase's own sign-in email always includes a
  // 6-digit code alongside the link (Authentication -> Email Templates ->
  // Magic Link, {{ .Token }} — a Supabase dashboard setting, confirm it's
  // actually in the template being sent, not something this codebase
  // controls). A tapped link on iOS opens in whatever the device's default
  // browser is, never back inside an already-open home-screen icon — a
  // documented WebKit/iOS limitation (a home-screen web app has its own
  // isolated storage, separate from any full browser app), not something
  // fixable from here. Typing the code instead never leaves the icon's own
  // window, so the session it establishes lands in that same window's own
  // storage — the one thing a tapped link structurally cannot do on iOS.
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // iOS home-screen icon detection (2026-09-29, owner-reported follow-up —
  // "is there a way to only offer the method that works to iPhone users").
  // Standalone iOS is the one case diagnosed above where the mailed link is
  // guaranteed to fail (it always opens the external browser, never this
  // window) — every other context (a normal iOS Safari/Chrome tab, or any
  // non-iOS platform) has the link working fine, so this is scoped exactly
  // to the broken case rather than assuming "iPhone" broadly. Starts false
  // on both server and first client render (no hydration mismatch), flips
  // after mount — same pattern as CreateRequestForm.tsx's own
  // `voiceSupported`. Not security-relevant: a wrong guess only changes
  // which instructions are shown, never what verifyOtp() itself accepts.
  const [iosStandalone, setIosStandalone] = useState(false)
  useEffect(() => {
    queueMicrotask(() => {
      setIosStandalone(isIOSDevice() && isStandaloneDisplay())
    })
  }, [])

  const emailRef = useRef<HTMLInputElement>(null)

  // Someone already signed in has no business on this screen.
  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace('/')
    })
    return () => {
      active = false
    }
  }, [router])

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function sendLink(address: string) {
    setLoading(true)
    setError(null)

    // Record the preference before the request, so the storage adapter routes
    // the session correctly when the user returns via the emailed link.
    setRememberMe(remember)

    // Remember (or forget) the email address itself, in step with the same
    // checkbox — see this file's LAST_EMAIL_KEY comment above.
    if (remember) {
      window.localStorage.setItem(LAST_EMAIL_KEY, address)
    } else {
      window.localStorage.removeItem(LAST_EMAIL_KEY)
    }

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (sendError) {
      setError(friendlyAuthErrorMessage(sendError.message))
      return false
    }

    setCooldown(RESEND_COOLDOWN_SECONDS)
    return true
  }

  // Private-testing signup gate (2026-08-13, migration 015) — owner: "the
  // app testing group will not [be at] risk [of] an unexpected expansion."
  // can_create_account() is the only thing the client asks: it always
  // returns true for an email already in auth.users (a returning user is
  // never gated, matching the owner's own scoping — "This should only
  // apply to brand new signups"), and only checks the allowlist for a
  // genuinely new email while the gate is on. Checked before
  // signInWithOtp is ever called, not after — Supabase creates the
  // auth.users row and sends a real email the moment signInWithOtp runs,
  // so the gate has to sit in front of that call, not clean up after it.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()

    if (!EMAIL_RE.test(address)) {
      setInvalid(true)
      emailRef.current?.focus()
      return
    }
    setInvalid(false)
    setError(null)
    setLoading(true)

    // Retried on a genuine network-level failure only (2026-10-02,
    // owner-reported) — can_create_account is a pure read with no side
    // effects, so retrying it is always safe, unlike signInWithOtp below
    // (a retry there risks a second real email if the first request
    // actually reached Supabase and only the response was lost — see
    // /auth/callback's own history on duplicate sign-in emails). A
    // non-network rejection (the gate itself refusing) returns immediately,
    // no retry — that answer won't change on a second try.
    let allowed: boolean | null = null
    let gateError: { message: string } | null = null
    for (const delayMs of [0, 600, 1600]) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      const result = await supabase.rpc('can_create_account', { p_email: address })
      allowed = result.data ?? null
      gateError = result.error
      if (!gateError || !isNetworkFetchError(gateError.message)) break
    }

    if (gateError) {
      setLoading(false)
      setError(friendlyAuthErrorMessage(gateError.message))
      return
    }

    if (!allowed) {
      setLoading(false)
      setGated(true)
      return
    }

    if (await sendLink(address)) setSent(true)
  }

  async function handleResend() {
    if (cooldown > 0 || loading) return
    await sendLink(email.trim())
  }

  // verifyOtp with type: 'email' is the correct pairing for a code
  // generated by signInWithOtp({ email }) above — Supabase's own
  // magiclink/email-OTP verification, not the SMS/'sms' variant. Success
  // establishes and persists the session exactly the same way a clicked
  // magic link does (both go through the same underlying supabase-js
  // storage adapter, see hybridStorage/setRememberMe in
  // src/lib/supabaseClient.ts) — the only difference is this happens
  // without ever leaving the current window.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    const token = code.trim()
    if (!/^\d{4,10}$/.test(token)) {
      setVerifyError('Enter the sign-in code from the email.')
      return
    }
    setVerifying(true)
    setVerifyError(null)

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    })

    setVerifying(false)

    if (verifyErr) {
      setVerifyError(verifyErr.message)
      return
    }

    router.replace('/')
  }

  function startOver() {
    setSent(false)
    setGated(false)
    setError(null)
    setCooldown(0)
    setCode('')
    setVerifyError(null)
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">
            {gated ? 'Private Testing' : isSignupIntent ? 'Sign In for Free Account' : 'Sign In'}
          </span>
        </div>

        {gated ? (
          <div className="scroll">
            <div className="sent" aria-live="polite">
              <div className="sent-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10.5" width="14" height="10" rx="2" stroke="#2A5FC8" strokeWidth="2" />
                  <path
                    d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
                    stroke="#2A5FC8"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <h2 className="sent-h">Private Testing</h2>
              <p className="sent-p">
                This app is currently in a private testing mode with a limited number of
                users.
              </p>
              <p className="sent-p">
                If you would like to participate in this testing process, let us know in
                an email to{' '}
                <a href="mailto:notifications@wouldyouplease.com?subject=Would%20You%20Please%20%E2%80%94%20Testing%20Access">
                  notifications@wouldyouplease.com
                </a>{' '}
                the following information: your first name, how you heard about Would You
                Please, and a short introduction.
              </p>
              <p className="sent-p">
                If your participation is approved, you will receive an email explaining the
                Private Testing process, related limitations, the expected testing
                duration, and a &ldquo;Start a Free Account&rdquo; link to click.
              </p>

              <p className="sent-meta">
                Entered the wrong address?{' '}
                <button className="linkbtn" type="button" onClick={startOver}>
                  Try a different email
                </button>
                .
              </p>
            </div>
          </div>
        ) : !sent ? (
          <div className="scroll">
            <form className="form" onSubmit={handleSubmit} noValidate>
              <div className={`fgroup ffloat${invalid ? ' is-invalid' : ''}`}>
                <input
                  ref={emailRef}
                  className="finput"
                  id="em"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (invalid) setInvalid(false)
                  }}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder=" "
                  aria-invalid={invalid}
                  aria-describedby={invalid ? 'em-error' : undefined}
                />
                <label className="flabel" htmlFor="em">
                  Email
                </label>
                {invalid && (
                  <p className="ferror" id="em-error">
                    Enter a valid email address.
                  </p>
                )}
              </div>

              <label className="checkrow">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="checktext">
                  Keep me signed in on this device
                  <span className="checknote">
                    Leave unchecked on a shared or public computer.
                  </span>
                </span>
              </label>

              {error && (
                <p className="ferror" role="alert" style={{ marginBottom: 12 }}>
                  {error}
                </p>
              )}

              <button className="btn btn-block" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>

            <div className="minreq">
              <b>No password needed</b>&nbsp; We email you a one-time link instead. If this
              is your first time, entering your email creates your account &mdash; there is
              no separate sign-up.
            </div>
          </div>
        ) : (
          <div className="scroll">
            <div className="sent" aria-live="polite">
              <div className="sent-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="2"
                    y="4.5"
                    width="20"
                    height="15"
                    rx="2.5"
                    stroke="#2A5FC8"
                    strokeWidth="2"
                  />
                  <path
                    d="M3 6.5l9 6.5 9-6.5"
                    stroke="#2A5FC8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <h2 className="sent-h">Check your email</h2>
              <p className="sent-p">
                We sent a sign-in link to
                <br />
                <span className="sent-addr">{email.trim()}</span>
              </p>
              {iosStandalone ? (
                <p className="sent-p">
                  Tapping the link in that email will open a separate browser tab instead
                  of signing you in here — enter the sign-in code from that same email
                  below instead.
                </p>
              ) : (
                <p className="sent-p">
                  Open that email and click the link. You&rsquo;ll be signed in automatically.
                </p>
              )}

              {/* Sign-in code fallback (2026-09-29) — see the state
                  declarations above for the full iOS home-screen-icon
                  reasoning. Requires the Supabase project's own Magic Link
                  email template to actually include {{ .Token }} — a
                  dashboard setting, not something this codebase controls.
                  Deliberately not hardcoded to a specific digit count —
                  Jim's own account, 2026-09-29, showed this project's actual
                  code is 8 digits, not Supabase's documented 6-digit
                  default; the field now accepts 4-10 digits and lets
                  verifyOtp() itself be the authority on correctness.
                  Same-day follow-up: on a detected iOS home-screen icon, the
                  paragraph above already explains the link won't work here,
                  so this line drops the redundant "On a Home Screen icon and
                  the link doesn't sign you in?" framing and just asks for
                  the code directly. */}
              <form onSubmit={handleVerifyCode} noValidate>
                <p className="sent-meta" style={{ marginTop: 4 }}>
                  {iosStandalone
                    ? 'Enter the sign-in code from that email:'
                    : "On a Home Screen icon and the link doesn't sign you in? Enter the sign-in code from that same email instead:"}
                </p>
                <div className={`fgroup ffloat${verifyError ? ' is-invalid' : ''}`} style={{ marginTop: 10 }}>
                  <input
                    className="finput"
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    placeholder=" "
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 10))
                      if (verifyError) setVerifyError(null)
                    }}
                  />
                  <label className="flabel" htmlFor="otp">
                    Sign-in code
                  </label>
                </div>
                {verifyError && (
                  <p className="ferror" role="alert">
                    {verifyError}
                  </p>
                )}
                <button
                  className="btn-secondary btn-block"
                  type="submit"
                  disabled={verifying || code.length < 4}
                  style={{ marginTop: 10 }}
                >
                  {verifying ? 'Verifying…' : 'Verify code'}
                </button>
              </form>

              {error && (
                <p className="ferror" role="alert">
                  {error}
                </p>
              )}

              <p className="sent-meta">
                The link expires in 1 hour and works once.
                <br />
                Nothing yet? Check spam,{' '}
                {cooldown > 0 ? (
                  <>resend in {cooldown}s</>
                ) : (
                  <button className="linkbtn" type="button" onClick={handleResend} disabled={loading}>
                    send it again
                  </button>
                )}
                , or{' '}
                <button className="linkbtn" type="button" onClick={startOver}>
                  use a different email
                </button>
                .
              </p>
              {/* Owner-reported, 2026-08-24: a tester's sign-in email landed
                  in spam. SPF/DKIM/DMARC checked out fine on investigation —
                  this is ordinary new-domain reputation, which First mail
                  from any sender can trip regardless of clean auth records.
                  Marking it "Not spam" is the one action that actually helps
                  (it's a real signal to Gmail/Outlook), so it's called out
                  explicitly rather than folded into the terser note above,
                  which just says where to look. */}
              <p className="sent-meta">
                First time signing in? This is a new sending address, so some
                inboxes may file it under spam or junk the first time. If you
                find it there, marking it &ldquo;Not spam&rdquo; helps future
                emails land in your inbox.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
