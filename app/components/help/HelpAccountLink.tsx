'use client'

import { useRouter } from 'next/navigation'

/** The four AccountForm.tsx section chip-state sessionStorage keys — same
 * keys `readStoredOpen()` there already reads (see AccountForm.tsx's own
 * `wyp.acct*Open` constants). Duplicated here rather than imported, per
 * this codebase's own small-shared-constant convention (see e.g. every
 * `formatMDY` duplicate). */
const SECTION_KEYS = {
  general: 'wyp.acctGeneralOpen',
  request: 'wyp.acctRequestOpen',
  todo: 'wyp.acctTodoOpen',
  subscriber: 'wyp.acctSubscriberOpen',
} as const

/**
 * HelpAccountLink (2026-09-03) — closes each Help topic with a link into
 * Account Options, per Jim's own suggestion: "each help topic should end
 * with a link to the related Account Options, or just to Account Options
 * (and, for that 'excursion', come back to same Help screen)," refined to a
 * clickable banner per his own follow-up wording ("'See Account Options to
 * Personalize Would You Please' banner?") — reuses `.noticeband` (the same
 * light-Strip informational-banner component every Detail screen's own
 * "Note: ..." band already uses) as a full-width button rather than a plain
 * link, via the new `.help-acct-banner` modifier (globals.css). `section`
 * pre-opens the one Account Options section the topic actually discusses
 * by writing AccountForm.tsx's own sessionStorage key directly, immediately
 * before navigating — the same "write session state, then `router.push`"
 * pattern this codebase already uses elsewhere (e.g. ArchiveForm.tsx's own
 * round-trip markers), rather than a `next/link` `onClick`, so the write is
 * guaranteed to land before the navigation starts.
 *
 * No round-trip marker is needed for the "come back to same Help screen"
 * half of the request: navigating here is an ordinary forward
 * `router.push`, which pushes a new history entry, and AccountForm.tsx's
 * own Close button already calls `router.back()` — so ordinary browser
 * history already returns to this exact Help topic with no extra plumbing.
 */
export default function HelpAccountLink({
  section,
  label,
}: {
  section: keyof typeof SECTION_KEYS
  label: string
}) {
  const router = useRouter()

  function go() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SECTION_KEYS[section], '1')
    }
    router.push('/account')
  }

  return (
    <button className="noticeband help-acct-banner" type="button" onClick={go}>
      {label} →
    </button>
  )
}
