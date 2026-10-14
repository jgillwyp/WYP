'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Text Messaging — Verification & Approval Screen (2026-10-13, migration
 * 079). The one other anonymous, unauthenticated-reachable page in this
 * app besides /r/[token] — a Contact clicks a link from the "please
 * approve text messaging" email (see app/src/lib/email.ts's
 * buildSmsConsentEmailHtml) and lands here with no session. All data in
 * and out goes through the token-scoped SECURITY DEFINER functions from
 * migration 079 — never a raw query against `contacts`, which has no anon
 * policy at all (same posture CLAUDE.md's Database section already
 * documents for /r/[token]).
 *
 * The SAME token drives two different states once visited, branched on
 * what get_contact_for_sms_consent returns — not two separate routes:
 *   - pending (no consent_given_at yet): the carrier-compliant opt-in form
 *   - already consented: a "Manage Text Messaging" screen with a Stop
 *     button — the web-link half of "both" (native STOP/HELP keyword
 *     handling via Twilio is the other half, see app/api/sms/inbound)
 * A third, terminal state (opted_out_at set) shows a plain confirmation.
 *
 * Carrier-audit disclosure text and layout are Jim's own literal spec
 * (docs/Twilio info.txt) — do not reword without checking with him first;
 * carriers check for specific exact phrasing in this kind of form.
 *
 * A public, crawler-friendly preview of this same form for Twilio's A2P
 * 10DLC campaign review lives at app/textmessaging/demo/page.tsx — a
 * separate, dedicated static route, not a query-param mode on this
 * component. An earlier ?demo=1 attempt bolted onto this client component
 * was abandoned: this whole page sits behind both an async RPC call and a
 * Suspense boundary (required for useSearchParams()), so its real content
 * never appears in the server-rendered HTML — only after client JS runs
 * and the RPC resolves. Twilio's own automated opt-in checker kept
 * reporting it couldn't verify the page even after that attempt, which
 * fits exactly that failure mode (a non-JS-executing crawler, or one that
 * doesn't wait out Suspense's streamed fallback, sees nothing but
 * "Loading…"). See TextMessagingDemoForm.tsx's own header comment for the
 * fix: a route with no searchParams/RPC dependency at all, so its full
 * markup is present in the very first HTML response.
 */

type ConsentData = {
  phone: string | null
  owner_name: string | null
  consent_given_at: string | null
  opted_out_at: string | null
}

// US-only (+1), same single-fixed-country-code posture Add Contact/Contact
// Detail's own .ccode already takes. Returns E.164 (+1XXXXXXXXXX) or null
// if the input doesn't resolve to exactly 10 US digits.
function normalizeUsPhoneToE164(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function formatE164ForDisplay(e164: string): string {
  const digits = e164.replace(/^\+1/, '')
  if (digits.length !== 10) return e164
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export default function TextMessagingForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<ConsentData | null>(null)

  const [phoneInput, setPhoneInput] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [activated, setActivated] = useState(false)
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    let cancelled = false
    // No special-cased synchronous branch for a missing token — an empty
    // string simply matches no row server-side, hitting the exact same
    // generic "This link is no longer valid" exception every other failure
    // mode already does (get_contact_for_sms_consent, migration 079). One
    // async path for every outcome, which also avoids a synchronous
    // setState-in-effect lint error the early-return branch used to trigger.
    supabase
      .rpc('get_contact_for_sms_consent', { p_token: token })
      .then(({ data: rpcData, error }) => {
        if (cancelled) return
        if (error || !rpcData) {
          setLoadError('This link is no longer valid.')
        } else {
          const consent = rpcData as ConsentData
          setData(consent)
          if (consent.phone) setPhoneInput(formatE164ForDisplay(consent.phone))
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleActivate() {
    setFormError(null)
    const normalized = normalizeUsPhoneToE164(phoneInput)
    if (!normalized) {
      setFormError('Enter a valid 10-digit US phone number.')
      return
    }
    if (!consentChecked) {
      setFormError('Please check the box to agree before activating Text Messaging.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.rpc('set_sms_consent', { p_token: token, p_phone: normalized })
    setSubmitting(false)
    if (error) {
      setFormError('Something went wrong activating Text Messaging. Please try again.')
      return
    }
    // Reflects what was just submitted, not data's original pre-fill value
    // (which the visitor may have edited before Activating) — the
    // confirmation screen below reads data.phone.
    setData((d) => (d ? { ...d, phone: normalized } : d))
    setActivated(true)
  }

  async function handleStop() {
    setSubmitting(true)
    const { error } = await supabase.rpc('set_sms_opt_out', { p_token: token })
    setSubmitting(false)
    if (error) {
      setFormError('Something went wrong. Please try again.')
      return
    }
    setStopped(true)
  }

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">Loading…</div>
        </div>
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError ?? 'This link is no longer valid.'}</div>
        </div>
      </div>
    )
  }

  const ownerName = data.owner_name ?? 'this Would You Please user'

  // Terminal state: already opted out (either via this page's own Stop
  // button, or via a STOP reply caught by app/api/sms/inbound).
  if (stopped || data.opted_out_at) {
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
                Text messaging from {ownerName} has been stopped. You will not receive any further text
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

  // Already consented — Manage Text Messaging / Stop state. Also reached
  // right after a successful Activate on this same visit.
  if (activated || data.consent_given_at) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="band">
            <span className="glabel">Text Messaging</span>
          </div>
          <div className="scroll">
            <div style={{ padding: '18px var(--pad)' }}>
              {activated && (
                <div className="noticeband" style={{ marginBottom: 14 }}>
                  Text Messaging is now active.
                </div>
              )}
              <p className="promo-p">
                You are set up to receive task requests, task updates, and reminders by text message from{' '}
                {ownerName}
                {data.phone ? ` at ${formatE164ForDisplay(data.phone)}` : ''}.
              </p>
              {formError && <p className="ferror" style={{ marginTop: 10 }}>{formError}</p>}
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 14 }}
                disabled={submitting}
                onClick={handleStop}
              >
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

  // Pending — the carrier-compliant opt-in form.
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
              {ownerName} uses Would You Please to track Requests and ToDos, and would like to send you
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
                task requests, task updates, and reminders from Would You Please on behalf of {ownerName}.
                Consent is not a condition of purchase. Message and data rates may apply. Message frequency
                varies based on task requests from {ownerName}.
              </label>
            </div>

            {formError && <p className="ferror" style={{ marginTop: 6 }}>{formError}</p>}

            <button
              type="button"
              className="btn"
              style={{ width: '100%', marginTop: 16 }}
              disabled={submitting}
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
