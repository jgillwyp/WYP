'use client'

import HelpTopicShell from './HelpTopicShell'
import HelpNext from './HelpNext'
import HelpAccountLink from './HelpAccountLink'

/** Responding to a Request (2026-09-03) — third Help-chip topic. See
 * GettingStartedHelp.tsx's own header comment for the sample-image
 * reasoning; same schematic-SVG approach here. */
export default function RespondingRequestHelp() {
  return (
    <HelpTopicShell title="Responding to a Request">
      <p className="help-lead">
        When someone sends you a Request, you don&rsquo;t need a Would You Please account to
        respond. The email links straight to a secure page for that one Request — open it, do
        what&rsquo;s asked, and you&rsquo;re done.
      </p>

      <div className="panel help-shot">
        <svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Request Response page showing quick-Done and Dialog">
          <rect x="0.5" y="0.5" width="399" height="219" rx="10" fill="#fff" stroke="#E2E6EC" />
          <rect x="0.5" y="0.5" width="399" height="30" rx="10" fill="#2A5FC8" />
          <rect x="0.5" y="20" width="399" height="10.5" fill="#2A5FC8" />
          <text x="200" y="20" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Request Response</text>

          <text x="16" y="48" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">From: Jim Gillon &nbsp; Due: 09-12-26</text>
          <rect x="16" y="56" width="368" height="30" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="24" y="75" fill="#1F2933" fontSize="10" fontFamily="Arial, sans-serif">Please send the updated slide deck by Friday.</text>

          {/* quick-Done band */}
          <rect x="16" y="92" width="368" height="26" rx="6" fill="#EDF2FD" />
          <text x="24" y="109" fill="#1F2933" fontSize="9.5" fontFamily="Arial, sans-serif">Not yet marked Done.</text>
          <rect x="316" y="97" width="60" height="16" rx="8" fill="#2A5FC8" />
          <text x="346" y="108" fill="#fff" fontSize="8.5" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Done</text>

          {/* Dialog */}
          <rect x="16" y="124" width="368" height="52" rx="6" fill="#fff" stroke="#E2E6EC" />
          <text x="24" y="138" fill="#2A5FC8" fontSize="9.5" fontWeight="700" fontFamily="Arial, sans-serif">Dialog</text>
          <text x="24" y="151" fill="#5A6675" fontSize="8.5" fontFamily="Arial, sans-serif">Question (Jim Gillon)</text>
          <text x="24" y="163" fill="#1F2933" fontSize="9" fontWeight="700" fontFamily="Arial, sans-serif">Can you use the new logo on slide 1?</text>

          <rect x="300" y="186" width="84" height="16" rx="8" fill="#2A5FC8" />
          <text x="342" y="197" fill="#fff" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Send</text>
        </svg>
        <span className="help-shot-cap">Request Response — the recipient&rsquo;s no-account-needed page</span>
      </div>

      <h2>Your Secure Link</h2>
      <p>
        The link in the Request email works every time you open it — it&rsquo;s not a
        one-time-use link like a sign-in email, so you can come back to the same Request as
        many times as the conversation needs.
      </p>

      <h2>The Fast Path: Quick Done</h2>
      <p>
        If there&rsquo;s nothing more to say, tap <b>Done</b> — it fills in today&rsquo;s date and
        you can Send right away. No need to type anything unless you want to.
      </p>

      <h2>Dialog: Ask or Answer</h2>
      <p>
        Use Dialog to ask a question, leave a comment, or answer a question the sender already
        asked. Entries are threaded, so an Answer shows which Question it replies to — handy
        once a Request has gone back and forth a few times.
      </p>

      <h2>Add to Calendar</h2>
      <p>
        The <b>Add to Calendar</b> link downloads an event file for the Due Date, so it shows up
        alongside everything else on your calendar without any manual re-entry.
      </p>

      <h2>Turning Reminders Off</h2>
      <p>
        If the sender turned Reminders on for this Request, you&rsquo;ll see the same Day
        before/Day of/Day after checkboxes here — you&rsquo;re free to turn any of them off for
        yourself without affecting how the sender sees their own copy.
      </p>

      <h2>Already Have an Account?</h2>
      <p>
        Responding works exactly the same way, and your response is saved to your own Received
        list too — see the Getting Started topic for a look at that list and the rest of your
        Main Screen.
      </p>

      <HelpNext current="responding-to-a-request" />
      <HelpAccountLink section="general" label="See Account Options to Personalize Would You Please" />
    </HelpTopicShell>
  )
}
