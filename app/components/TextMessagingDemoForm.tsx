'use client'

import { useState } from 'react'
import Link from 'next/link'

import WypHeader from './WypHeader'

/**
 * Text Messaging — public demo (2026-10-13), for Twilio's A2P 10DLC
 * campaign review. Rendered at /textmessaging/demo (app/textmessaging/
 * demo/page.tsx), a plain Server Component with no searchParams and no
 * Suspense boundary — unlike TextMessagingForm.tsx (the real /textmessaging
 * flow), nothing here is async or client-only-derived, so this component's
 * full markup is present in the very first HTML response, before any
 * client JS runs. That's the actual fix for Twilio's repeated "we couldn't
 * verify it automatically" message: the real page's content only exists
 * after a client-side RPC resolves, behind a Suspense boundary required by
 * useSearchParams() — a crawler that doesn't execute JS, or doesn't wait
 * out a streamed Suspense fallback, would see nothing but "Loading…"
 * either way. This page needs neither.
 *
 * Fixed placeholder data only (DEMO_OWNER_NAME/DEMO_PHONE_DISPLAY, a 555
 * number, never a real one) — no Supabase import, no RPC call anywhere in
 * this file, on load or on Activate, so it can neither read nor write real
 * Contact data. The Activate/Stop interactivity (useState only, no effect)
 * exists so Jim can still click all the way through to the "Text Messaging
 * is now active" confirmation screen himself and screenshot it, matching
 * Twilio's own literal field instructions for a non-live/gated form:
 * "include a screenshot of the form and what customers see after the form
 * is submitted."
 *
 * Carrier-audit disclosure wording must stay byte-for-byte identical to
 * TextMessagingForm.tsx's own pending-form JSX — this is what Twilio is
 * actually reviewing.
 */

const DEMO_OWNER_NAME = 'Jane Smith'
const DEMO_PHONE_DISPLAY = '(555) 123-4567'

export default function TextMessagingDemoForm() {
  const [phoneInput, setPhoneInput] = useState(DEMO_PHONE_DISPLAY)
  const [consentChecked, setConsentChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [activated, setActivated] = useState(false)
  const [stopped, setStopped] = useState(false)

  function handleActivate() {
    setFormError(null)
    if (!consentChecked) {
      setFormError('Please check the box to agree before activating Text Messaging.')
      return
    }
    setActivated(true)
  }

  function handleStop() {
    setStopped(true)
  }

  if (stopped) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="band">
            <span className="glabel">Text Messaging</span>
          </div>
          <div className="scroll">
            <div style={{ padding: '18px var(--pad)' }}>
              <p className="promo-p">
                Text messaging from {DEMO_OWNER_NAME} has been stopped. You will not receive any further text
                messages.
              </p>
              <p className="promo-p" style={{ marginTop: 12 }}>
                Questions? <a href="mailto:help@wouldyouplease.com">help@wouldyouplease.com</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (activated) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="band">
            <span className="glabel">Text Messaging</span>
          </div>
          <div className="scroll">
            <div style={{ padding: '18px var(--pad)' }}>
              <div className="noticeband" style={{ marginBottom: 14 }}>
                Text Messaging is now active.
              </div>
              <p className="promo-p">
                You are set up to receive task requests, task updates, and reminders by text message from{' '}
                {DEMO_OWNER_NAME} at {phoneInput}.
              </p>
              <button type="button" className="btn-secondary" style={{ marginTop: 14 }} onClick={handleStop}>
                Stop all text messages
              </button>
              <p className="promo-p" style={{ marginTop: 12 }}>
                Questions? <a href="mailto:help@wouldyouplease.com">help@wouldyouplease.com</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Pending — the carrier-compliant opt-in form. Keep byte-for-byte in
  // sync with TextMessagingForm.tsx's own identical block.
  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />
        <div className="band">
          <span className="glabel">Text Messaging</span>
        </div>
        <div className="scroll">
          <div style={{ padding: '18px var(--pad)' }}>
            <p className="promo-p" style={{ marginBottom: 16 }}>
              {DEMO_OWNER_NAME} uses Would You Please to track Requests and ToDos, and would like to send you
              Request updates and reminders by text message.
            </p>

            <div className="fgroup">
              <span className="ffloat" style={{ display: 'block' }}>
                <input
                  className="finput"
                  id="tm-phone"
                  type="tel"
                  autoComplete="tel-national"
                  inputMode="tel"
                  placeholder=" "
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
                <label className="flabel" htmlFor="tm-phone">
                  Phone Number
                </label>
              </span>
            </div>

            <div className="checkrow" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                id="tm-consent"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <label htmlFor="tm-consent" className="checktext">
                By checking this box and approving or modifying my phone number above, I agree to receive
                task requests, task updates, and reminders from Would You Please on behalf of {DEMO_OWNER_NAME}.
                Consent is not a condition of purchase. Message and data rates may apply. Message frequency
                varies based on task requests from {DEMO_OWNER_NAME}.
              </label>
            </div>

            {formError && <p className="ferror" style={{ marginTop: 6 }}>{formError}</p>}

            <button
              type="button"
              className="btn"
              style={{ width: '100%', marginTop: 16 }}
              onClick={handleActivate}
            >
              Activate Text Messaging
            </button>

            <p className="promo-p" style={{ marginTop: 12, textAlign: 'center' }}>
              <Link href="/privacy">Terms and Privacy Policy</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
