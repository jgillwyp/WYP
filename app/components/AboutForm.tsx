'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { APP_VERSION, BUILD_DATE } from '@/version'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'
import { useSpeechDictation } from '@/lib/useSpeechDictation'

function formatBuildDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Duplicated per-file, same convention as MainScreen.tsx's own MicIcon
// (built for this identical Feedback dialog, 2026-10-21).
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function AboutForm() {
  const router = useRouter()

  // Private Tester Feedback (2026-11-20) — the identical dialog/send path
  // MainScreen.tsx's own Private Tester chip already offers (its own
  // openFeedbackDialog/handleSendFeedback comments give the full
  // reasoning), duplicated here per this codebase's established
  // per-file-component convention rather than extracted to a shared file.
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const [feedbackEmail, setFeedbackEmail] = useState<string | null>(null)
  const [feedbackSubject, setFeedbackSubject] = useState('Error')
  const [feedbackBody, setFeedbackBody] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const feedbackDictation = useSpeechDictation(feedbackBody, setFeedbackBody)

  async function openFeedbackDialog() {
    setFeedbackDialogOpen(true)
    setFeedbackSent(false)
    setFeedbackError(null)
    if (!feedbackEmail) {
      const { data } = await getCurrentUser()
      setFeedbackEmail(data.user?.email ?? null)
    }
  }

  async function handleSendFeedback() {
    if (!feedbackBody.trim()) {
      setFeedbackError('Enter a message before sending.')
      return
    }
    setFeedbackSending(true)
    setFeedbackError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setFeedbackError('Not signed in.')
        return
      }
      const res = await fetch('/api/feedback/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ subject: feedbackSubject, body: feedbackBody }),
      })
      const json = (await res.json().catch(() => ({}))) as { sent?: boolean }
      if (json.sent) {
        setFeedbackSent(true)
        setFeedbackBody('')
      } else {
        setFeedbackError('Could not send feedback. Please try again.')
      }
    } catch {
      setFeedbackError('Could not send feedback. Please try again.')
    } finally {
      setFeedbackSending(false)
    }
  }

  return (
    <div className="frame-none">
      <div className="app about">
        <WypHeader />

        <div className="band">
          <span className="glabel">About</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={() => router.push('/')}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <div className="about-idblock">
            <div className="about-idrow">
              <span className="about-idlab">Version</span>
              <span className="about-idval">{APP_VERSION}</span>
            </div>
            <div className="about-idrow">
              <span className="about-idlab">Date</span>
              <time className="about-idval" dateTime={BUILD_DATE}>
                {formatBuildDate(BUILD_DATE)}
              </time>
            </div>
          </div>

          <section className="about-section">
            <h2 className="about-section-heading">Pre-Release Testing</h2>
            <p className="about-section-copy">
              Would You Please is currently in Pre-Release Testing, ahead of our full public
              launch. Signing up for a Free Account automatically makes you a Pre-Release
              Tester — use the &ldquo;Subscribed? (testing only)&rdquo; toggle in Account Options
              to try every Subscriber feature at no cost while you&apos;re testing, and if you
              choose to subscribe for real later, Pre-Release Testers get a discounted
              first-year rate.
            </p>
          </section>

          <section className="about-section">
            <h2 className="about-section-heading">Suggestions &amp; Feedback</h2>
            <p className="about-section-copy">
              You&apos;re a Pre-Release Tester — if you have a suggestion, question, or hit a problem,
              we&apos;d like to hear it.
            </p>
            <div className="about-feedback-row">
              <button className="btn" type="button" onClick={() => openFeedbackDialog()}>
                Send Feedback
              </button>
              <span>
                or email{' '}
                <a href="mailto:feedback@wouldyouplease.com">feedback@wouldyouplease.com</a>
              </span>
            </div>
          </section>

        </div>
        <AppFooter subscriptionDisabled={false} />

        {/* Private Tester Feedback (2026-11-20) — same .scrim/.modal dialog
            MainScreen.tsx's own Private Tester chip already offers, see
            openFeedbackDialog's own comment above. */}
        {feedbackDialogOpen && (
          <>
            <div className="scrim" onClick={() => setFeedbackDialogOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-feedback-dialog-title">
              <div className="modalhead">
                <p className="modal-title" id="about-feedback-dialog-title">
                  Pre-Release Tester Feedback
                </p>
              </div>
              <p className="subnote" style={{ marginTop: 10 }}>
                This is a temporary feedback channel for the private testing period only — it won&rsquo;t be part of
                the finished app.
              </p>
              <div className="metarow" style={{ marginTop: 10 }}>
                <b>From:</b>
                <span>{feedbackEmail ?? 'Loading…'}</span>
              </div>
              <div className="fgroup" style={{ marginTop: 10 }}>
                <label
                  htmlFor="about-fb-subject"
                  style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 4, color: 'var(--ink)' }}
                >
                  Subject
                </label>
                <select
                  id="about-fb-subject"
                  className="finput"
                  value={feedbackSubject}
                  onChange={(e) => setFeedbackSubject(e.target.value)}
                >
                  <option value="Error">Error</option>
                  <option value="Something Awkward">Something Awkward</option>
                  <option value="Something Missing">Something Missing</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="fgroup" style={{ marginTop: 10 }}>
                <div className="descwrap">
                  <textarea
                    className="ftextarea ftextarea-plain"
                    placeholder="What happened? What did you expect instead?"
                    aria-label="Feedback message"
                    style={{ minHeight: 168 }}
                    value={feedbackBody}
                    onChange={(e) => setFeedbackBody(e.target.value)}
                  />
                  {feedbackDictation.supported && (
                    <button
                      type="button"
                      className={`micbtn${feedbackDictation.dictating ? ' listening' : ''}`}
                      aria-label={feedbackDictation.dictating ? 'Stop voice dictation' : 'Start voice dictation'}
                      onClick={feedbackDictation.toggle}
                    >
                      <MicIcon />
                    </button>
                  )}
                  {feedbackDictation.dictationNote && (
                    <span className="micnote">{feedbackDictation.dictationNote}</span>
                  )}
                </div>
              </div>
              {feedbackError && (
                <p className="ferror" role="alert">
                  {feedbackError}
                </p>
              )}
              {feedbackSent && <p className="noticeband">Thanks — your feedback was sent.</p>}
              <div className="modalacts" style={{ marginTop: 12 }}>
                <button type="button" className="btn-secondary" onClick={() => setFeedbackDialogOpen(false)}>
                  {feedbackSent ? 'Close' : 'Cancel'}
                </button>
                {!feedbackSent && (
                  <button type="button" className="btn" onClick={handleSendFeedback} disabled={feedbackSending}>
                    {feedbackSending ? 'Sending…' : 'Send'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
