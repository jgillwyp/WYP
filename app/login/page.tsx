'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from '../components/WypHeader'
import { supabase, setRememberMe } from '@/lib/supabaseClient'

/** Supabase allows one magic link per user per 60 seconds. */
const RESEND_COOLDOWN_SECONDS = 60

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const router = useRouter()

  // Owner-reported, 2026-08-13: clicking "Start Free Account" on the
  // landing page and landing on a screen titled plain "Sign In" reads as
  // jarring/confusing — this is still the single dual-purpose auth screen
  // (no separate sign-up form exists; see the Auth section of CLAUDE.md),
  // so the fix is wording, not a second screen. LandingPage.tsx's Start
  // Free Account links carry `?intent=signup`; Sign In links (here and on
  // Request Response's "Create your own Free Account" block) don't. Read
  // via window.location.search rather than useSearchParams(), matching the
  // precedent set in AddContactForm.tsx — this value is only ever read
  // client-side already, so there's no SSR pass to guard and no reason to
  // force a Suspense boundary onto this page for it.
  const [isSignupIntent] = useState(() =>
    typeof window === 'undefined' ? false : new URLSearchParams(window.location.search).get('intent') === 'signup'
  )

  const [email, setEmail] = useState('')
  const [remember, setRemember] = useState(true)
  const [sent, setSent] = useState(false)
  const [gated, setGated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

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

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (sendError) {
      setError(sendError.message)
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

    const { data: allowed, error: gateError } = await supabase.rpc('can_create_account', {
      p_email: address,
    })

    if (gateError) {
      setLoading(false)
      setError(gateError.message)
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

  function startOver() {
    setSent(false)
    setGated(false)
    setError(null)
    setCooldown(0)
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
                If you would like to participate in this testing process, let us know how
                you heard about Would You Please and introduce yourself in an email to{' '}
                <a href="mailto:notifications@wouldyouplease.com?subject=Would%20You%20Please%20%E2%80%94%20Testing%20Access">
                  notifications@wouldyouplease.com
                </a>
                .
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
              <p className="sent-p">
                Open that email and click the link. You&rsquo;ll be signed in automatically.
              </p>

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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
