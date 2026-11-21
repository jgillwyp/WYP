'use client'

import { useRouter } from 'next/navigation'

// Welcome dialog (2026-11-21) — Jim: thank a brand-new Pre-Release Tester,
// point them at Housekeeping > Pre-Release Tester > Feedback, and suggest
// creating a Request and sending it to themselves so they see both sides of
// the app (the asker's view and the recipient's). First shown exactly once,
// right after a successful Save on CreateFreeAccountForm.tsx — that screen
// is itself only ever reached once per account (profiles.display_name still
// null, see its own header comment), so no separate "has this account seen
// the welcome message" flag is needed there.
//
// Jim's own same-turn follow-up: "add a button or underlined link on the
// About screen to 'See the Would You Please app Welcome message'" — a
// tester who dismissed it quickly, or just wants to re-read it, can pull it
// back up any time from About. That's a second, independent call site with
// different dismiss behavior (stay on About vs. continue to Main Screen
// after signup), which is why dismissLabel/onDismiss are the caller's own —
// everything else (title, copy, the Create a Request action) is identical
// and lives here once rather than duplicated, since this is reused
// identically by two very different screens.
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
