'use client'

import HelpTopicShell from './HelpTopicShell'
import HelpNext from './HelpNext'
import HelpAccountLink from './HelpAccountLink'

/** Creating a Request (2026-09-03) — second Help-chip topic. See
 * GettingStartedHelp.tsx's own header comment for the sample-image
 * reasoning; same schematic-SVG approach here. */
export default function CreatingRequestHelp() {
  return (
    <HelpTopicShell title="Creating a Request">
      <p className="help-lead">
        A Request is a tracked ask, sent to a Contact with a Due Date. Once it&rsquo;s Sent, Would
        You Please can handle the follow-up for you — reminding the recipient, and telling you
        when it&rsquo;s overdue — so the fastest Request to create is often the one where you
        touch it once and never think about it again.
      </p>

      <div className="panel help-shot">
        <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Create Request form showing Recipient, Due Date, Reminders, and Repeat">
          <rect x="0.5" y="0.5" width="399" height="249" rx="10" fill="#fff" stroke="#E2E6EC" />
          <rect x="0.5" y="0.5" width="399" height="30" rx="10" fill="#2A5FC8" />
          <rect x="0.5" y="20" width="399" height="10.5" fill="#2A5FC8" />
          <text x="200" y="20" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Create Request</text>

          <rect x="16" y="42" width="368" height="26" rx="6" fill="#fff" stroke="#2A5FC8" strokeWidth="1.5" />
          <text x="24" y="59" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">Recipient</text>
          <text x="120" y="59" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">Dave Nguyen</text>

          <rect x="16" y="74" width="368" height="26" rx="6" fill="#fff" stroke="#2A5FC8" strokeWidth="1.5" />
          <text x="24" y="91" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">Due Date</text>
          <text x="120" y="91" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">09-18-26</text>

          <rect x="16" y="106" width="368" height="34" rx="6" fill="#fff" stroke="#2A5FC8" strokeWidth="1.5" />
          <text x="24" y="120" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">Description</text>
          <text x="24" y="134" fill="#1F2933" fontSize="10" fontFamily="Arial, sans-serif">Please send the updated slide deck…</text>

          {/* Reminders until Done */}
          <rect x="16" y="148" width="368" height="42" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="24" y="161" fill="#1F2933" fontSize="9.5" fontWeight="700" fontFamily="Arial, sans-serif">Reminders until Done</text>
          <rect x="24" y="167" width="9" height="9" rx="2" fill="#2A5FC8" />
          <text x="38" y="175" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day before</text>
          <rect x="112" y="167" width="9" height="9" rx="2" fill="#fff" stroke="#7E8A9A" />
          <text x="126" y="175" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day of</text>
          <rect x="188" y="167" width="9" height="9" rx="2" fill="#fff" stroke="#7E8A9A" />
          <text x="202" y="175" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day after</text>

          {/* Repeat */}
          <rect x="16" y="196" width="368" height="24" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="24" y="212" fill="#1F2933" fontSize="9.5" fontWeight="700" fontFamily="Arial, sans-serif">Repeat: Off</text>
          <rect x="316" y="200" width="60" height="16" rx="8" fill="#fff" stroke="#7E8A9A" />
          <text x="346" y="211" fill="#1F2933" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">Set Repeat</text>

          <rect x="300" y="228" width="84" height="16" rx="8" fill="#2A5FC8" />
          <text x="342" y="239" fill="#fff" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Send</text>
        </svg>
        <span className="help-shot-cap">Create Request — Recipient, Due Date, Reminders, and Repeat</span>
      </div>

      <h2>The Essentials</h2>
      <p>
        Pick a Recipient (type a few letters of a saved Contact&rsquo;s name, or add a new one
        on the spot), set a Due Date, and write the Description. That&rsquo;s a complete
        Request — everything else on the screen is optional.
      </p>

      <h2>Let Would You Please Do the Follow-Up</h2>
      <p>
        The <b>Reminders until Done</b>{' '}
        checkboxes control up to three emails sent on your
        behalf: the day before it&rsquo;s due, the day it&rsquo;s due, and the day after (if
        it&rsquo;s still open). Set your own defaults once in Account Options and every new
        Request starts pre-checked the way you like — no re-deciding each time. If a Request
        does go overdue, its own Detail screen also has a one-tap <b>Send Reminder</b>{' '}
        button for whenever you want to nudge the recipient yourself.
      </p>

      <h2>Repeating Requests</h2>
      <p>
        For anything you send on a schedule — rent, a weekly status update — turn on{' '}
        <b>Repeat</b>{' '}
        and Would You Please creates the next occurrence automatically once the
        current one&rsquo;s Due Date arrives. Free accounts can repeat up to 5 of the Requests
        and ToDos; subscribers can repeat without limit.
      </p>

      <h2>Attach What They&rsquo;ll Need</h2>
      <p>
        Add files right on the Request — a PDF, a spreadsheet, a photo — so the recipient has
        everything in one place instead of a separate email. Every account gets some free
        storage; subscribers get more. You can also stage a <b>Dialog</b>{' '}
        question or note before you even send, so it&rsquo;s waiting for the recipient the
        moment they open the link.
      </p>

      <HelpNext current="creating-a-request" />
      <HelpAccountLink section="request" label="See Account Options to Personalize Requests" />
    </HelpTopicShell>
  )
}
