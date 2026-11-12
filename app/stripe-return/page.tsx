'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from '../components/WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { sanitizeStripeReturnPath } from '@/lib/subscriptionPricing'

/**
 * /stripe-return — the one redirect target for every real Stripe hand-off
 * that still happens (create-checkout-session's success_url/cancel_url),
 * replacing a direct redirect to /account/subscription (2026-11-10,
 * owner-reported real bug). Cancel no longer redirects to Stripe at all as
 * of 2026-11-11 (cancel-subscription/route.ts, a direct in-app action) —
 * Sign Up is this page's only remaining real-world trigger.
 *
 * On web/Android, Stripe's redirect happens in the same browsing context the
 * app's own session already lives in (plain window.location.href, see
 * SubscriptionPanels.tsx's startStripeFlow()) — landing straight on
 * /account/subscription there always worked fine. But on native iOS,
 * startStripeFlow() opens Stripe via @capacitor/browser's Browser.open(),
 * which presents a genuinely separate browsing context (its own storage, no
 * shared Supabase session with the app's own WKWebView) — Stripe's redirect
 * landing there hit RequireAuth with no session and bounced to /login,
 * showing a blank-email sign-in form inside what the owner reasonably read
 * as "the app." /account/subscription isn't in the Universal Links path list
 * (public/.well-known/apple-app-site-association only covers /r/* and
 * /textmessaging/*), so there's no guarantee a programmatic (non-tapped)
 * redirect would be intercepted back into the real, already-signed-in app
 * the way a tapped link already is.
 *
 * This page is NOT wrapped in RequireAuth — it checks the session itself and
 * branches: signed in (the ordinary same-context case) replaces straight to
 * whichever screen actually started the flow (returnTo, below); signed out
 * (the separate-context iOS case) shows a plain, form-free confirmation
 * instead of a sign-in prompt — there is nothing to sign into here, and the
 * real app (already signed in) already picks up the change via its own
 * browserFinished-triggered reload the moment this view is closed.
 *
 * returnTo (2026-11-11, owner-reported: "private tester Stripe session
 * returns to Account Options instead of to the private tester 'account'
 * screen") carries back whichever of the three AccountStatusSection call
 * sites (Account Options, /account/subscription, Admin's Test Stripe
 * Payments) actually started the flow — create-checkout-session/
 * create-portal-session route.ts both embed it in the URL they hand to
 * Stripe. Re-validated here against the same allowlist those routes already
 * check, rather than trusted as a redirect target straight from the URL.
 */
export default function StripeReturnPage() {
  const router = useRouter()

  const [checkoutStatus] = useState<'success' | 'cancelled' | null>(() => {
    if (typeof window === 'undefined') return null
    const value = new URLSearchParams(window.location.search).get('checkout')
    return value === 'success' || value === 'cancelled' ? value : null
  })
  const [returnPath] = useState<string>(() => {
    if (typeof window === 'undefined') return '/account/subscription'
    return sanitizeStripeReturnPath(new URLSearchParams(window.location.search).get('returnTo'))
  })
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSignedIn(Boolean(data.session))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (signedIn) {
      router.replace(checkoutStatus ? `${returnPath}?checkout=${checkoutStatus}` : returnPath)
    }
  }, [signedIn, checkoutStatus, returnPath, router])

  if (signedIn === null || signedIn) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="scroll">
            <p style={{ padding: 'var(--pad)' }}>Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">
            {checkoutStatus === 'cancelled' ? 'Checkout Cancelled' : 'Payment Complete'}
          </span>
        </div>

        <div className="scroll">
          <div className="sent" aria-live="polite">
            <div className="sent-icon" aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12l5 5L20 6"
                  stroke="#2A5FC8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 className="sent-h">
              {checkoutStatus === 'cancelled' ? 'No changes were made.' : "You're all set."}
            </h2>
            <p className="sent-p">
              {checkoutStatus === 'cancelled'
                ? 'Checkout was cancelled — nothing on your account changed.'
                : 'Your subscription change has been received.'}
            </p>
            <p className="sent-p">You can close this and return to the Would You Please app.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
