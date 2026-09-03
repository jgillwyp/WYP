'use client'

import HelpTopicShell from './HelpTopicShell'
import HelpNext from './HelpNext'

/**
 * Getting Started (2026-09-03) — first of four Help-chip topics. Jim: "an
 * introduction for Private Testing participants which gives them a quick
 * look at what is available with WYP — something focused on how to be more
 * efficient." Sample image is a schematic SVG built from the app's own
 * design tokens (app/globals.css :root), not a real screenshot — no headless
 * browser is reachable from this session to capture the live, authenticated
 * app, and a hand-drawn schematic can call out the specific things this
 * topic is about without the clutter of a literal 1:1 screenshot.
 */
export default function GettingStartedHelp() {
  return (
    <HelpTopicShell title="Getting Started">
      <p className="help-lead">
        Would You Please tracks two kinds of things: Requests you send to someone else, and
        ToDos you keep for yourself. Everything lives on one Main Screen, in three sections —
        Sent, Received, and ToDos — so there&rsquo;s nowhere else to check.
      </p>

      <div className="panel help-shot">
        <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Main Screen showing Sent, Received, and ToDos sections">
          <rect x="0.5" y="0.5" width="399" height="249" rx="10" fill="#fff" stroke="#E2E6EC" />
          <rect x="0.5" y="0.5" width="399" height="34" rx="10" fill="#2A5FC8" />
          <rect x="0.5" y="24" width="399" height="10.5" fill="#2A5FC8" />
          <text x="16" y="22" fill="#fff" fontSize="13" fontWeight="700" fontFamily="Arial, sans-serif">Would You Please</text>
          <circle cx="378" cy="17" r="8" fill="#3A70DC" />
          <text x="378" y="21" fill="#fff" fontSize="10" textAnchor="middle" fontFamily="Arial, sans-serif">⌕</text>

          {/* Sent band */}
          <rect x="10" y="44" width="380" height="18" rx="3" fill="#E7E7E7" />
          <text x="18" y="57" fill="#1F2933" fontSize="11" fontWeight="700" fontFamily="Arial, sans-serif">Sent</text>
          <rect x="290" y="47" width="34" height="12" rx="6" fill="#2A5FC8" />
          <text x="307" y="56" fill="#fff" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">All</text>
          <rect x="328" y="47" width="42" height="12" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="349" y="56" fill="#5A6675" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">Open</text>

          <text x="18" y="76" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">Ask Dave for the deck</text>
          <text x="335" y="76" fill="#1F2933" fontSize="10.5" fontWeight="700" textAnchor="end" fontFamily="Arial, sans-serif">09-12-26</text>

          <text x="18" y="92" fill="#D32F2F" fontSize="10.5" fontFamily="Arial, sans-serif">Return the ladder</text>
          <text x="335" y="92" fill="#D32F2F" fontSize="10.5" fontWeight="700" textAnchor="end" fontFamily="Arial, sans-serif">09-01-26</text>

          {/* Received band */}
          <rect x="10" y="104" width="380" height="18" rx="3" fill="#E7E7E7" />
          <text x="18" y="117" fill="#1F2933" fontSize="11" fontWeight="700" fontFamily="Arial, sans-serif">Received</text>
          <text x="18" y="136" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">Send the signed lease</text>
          <text x="335" y="136" fill="#1F2933" fontSize="10.5" fontWeight="700" textAnchor="end" fontFamily="Arial, sans-serif">09-06-26</text>

          {/* ToDos band */}
          <rect x="10" y="148" width="380" height="18" rx="3" fill="#E7E7E7" />
          <text x="18" y="161" fill="#1F2933" fontSize="11" fontWeight="700" fontFamily="Arial, sans-serif">ToDos</text>
          <circle cx="20" cy="177" r="4" fill="#D32F2F" />
          <text x="30" y="181" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">Renew car registration</text>

          {/* Housekeeping band */}
          <rect x="10" y="196" width="380" height="18" rx="3" fill="#E7E7E7" />
          <text x="18" y="209" fill="#1F2933" fontSize="11" fontWeight="700" fontFamily="Arial, sans-serif">Housekeeping</text>
          <rect x="290" y="199" width="46" height="12" rx="6" fill="#2A5FC8" />
          <text x="313" y="208" fill="#fff" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">Tasks</text>
          <rect x="340" y="199" width="40" height="12" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="360" y="208" fill="#5A6675" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">Help</text>
          <text x="18" y="230" fill="#5A6675" fontSize="9.5" fontFamily="Arial, sans-serif">Contacts   Account Options   Archive</text>
        </svg>
        <span className="help-shot-cap">Main Screen — Sent, Received, ToDos, and Housekeeping, all in one place</span>
      </div>

      <h2>Your Main Screen at a Glance</h2>
      <p>
        Each section shows filter chips (All / Open / Overdue / Done) so you can narrow the
        list without scrolling past what you don&rsquo;t need. Tap a column heading — To/From,
        Date, Due, Done, Category — to sort by it; tap it again to reverse the order. Would You
        Please remembers your chip and sort choices between visits.
      </p>
      <p>
        A row in red is overdue. A row you tap opens its Detail screen, where you can edit it,
        add Dialog or Attachments, mark it Done, or Archive it once you&rsquo;re finished with
        it — Archived items disappear from the main list but stay searchable forever.
      </p>

      <h2>Make It Yours: Account Options</h2>
      <p>
        Would You Please starts simple on purpose — most optional fields are hidden until you
        turn them on. Open Housekeeping&rsquo;s <b>Account Options</b> to turn on things like a
        private Category label, Due/Done Time on Requests, or Due/Done Dates on ToDos, and to
        set your own default Reminder schedule so you don&rsquo;t have to re-check the same
        boxes on every new Request or ToDo.
      </p>

      <h2>A Few Efficiency Tips</h2>
      <ul>
        <li><b>Add a Contact once.</b> After that, Create Request&rsquo;s Recipient field finds them by typing just a few letters.</li>
        <li><b>Use Search for anything older.</b> Search also finds Archived items, so Archiving a finished Request or ToDo doesn&rsquo;t mean losing track of it.</li>
        <li><b>Install the icon.</b> Housekeeping&rsquo;s Install row (when available) adds a Would You Please icon to your home screen, so it opens like any other app.</li>
        <li><b>Let Reminders do the follow-up.</b> See the Creating a Request topic for how Day-before/Day-of/Day-after Reminders keep a Request moving without you checking back manually.</li>
      </ul>

      <HelpNext current="getting-started" />
    </HelpTopicShell>
  )
}
