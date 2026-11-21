'use client'

import { useRouter } from 'next/navigation'

// Welcome dialog (2026-11-21) — Jim: thank a brand-new Pre-Release Tester,
// point them at Housekeeping > Pre-Release Tester > Feedback, and suggest
// creating a Request and sending it to themselves so they see both sides of
// the app (the asker's view and the recipient's).
//
// Jim's own same-day follow-up: "add a button or underlined link on the
// About screen to 'See the Would You Please app Welcome message'" — a
// tester who dismissed it quickly, or just wants to re-read it, can pull it
// back up any time from About. That's a second, independent call site,
// which is why dismissLabel/onDismiss are the caller's own — everything
// else (title, copy, the Create a Request action) is identical and lives
// here once rather than duplicated, since this is reused identically by
// two very different screens.
//
// First-shown trigger moved from Create Free Account to MainScreen.tsx,
// 2026-11-22 — Jim, after testing it himself and clicking straight through
// without reading: "it seems more natural to add it in the app for the 1st
// time it is opened - since it is then part of the app instead of part of
// the installation." Shown right after Create Free Account, it read as one
// more step of account setup rather than a real welcome to the app itself.
// Main Screen's own first real load is now the actual one-time trigger
// (profiles.welcome_dialog_shown_at, migration 102) — see MainScreen.tsx's
// own loadPrefs() comment for the mechanism; this component itself didn't
// need to change at all, since both call sites already only ever differed
// in dismissLabel/onDismiss.
export default function WelcomeDialog({
  open,
  dismissLabel,
  onDismiss,
}: {
  open: boolean
  dismissLabel: string
  onDismiss: () => void
}) {
  const router = useRouter()

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onDismiss} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="welcome-dialog-title">
        <p className="modal-title" id="welcome-dialog-title">
          Welcome, Pre-Release Tester!
        </p>
        <p className="promo-p" style={{ margin: '0 0 12px' }}>
          Thanks for being part of the Would You Please Pre-Release Testers community — we&rsquo;re
          excited to have you trying it out this early.
        </p>
        <p className="promo-p" style={{ margin: '0 0 12px' }}>
          If anything feels off, missing, or confusing, we&rsquo;d love to hear about it:
          Housekeeping &rarr; Pre-Release Tester &rarr; Feedback, right from the Main Screen.
        </p>
        <p className="promo-p" style={{ margin: '0 0 12px' }}>
          A good way to get a feel for the app: create a Request and send it to yourself.
          You&rsquo;ll see what it&rsquo;s like on both sides — as the person asking, and as the
          person being asked.
        </p>
        <div className="modalacts">
          <button type="button" className="btn-secondary" onClick={onDismiss}>
            {dismissLabel}
          </button>
          <button type="button" className="btn" onClick={() => router.push('/requests/new')}>
            Create a Request
          </button>
        </div>
      </div>
    </>
  )
}
