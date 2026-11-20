'use client'

import { useState, type ReactNode } from 'react'

import type { IcsAlarmOffset } from '@/lib/ics'

/**
 * Calendar-reminder picker (2026-09-17, owner's own idea) — shown at the
 * moment of "Add to Calendar" so the person can optionally choose one or
 * more RFC 5545 VALARM offsets to embed in the .ics event itself. Once
 * added, the reminder becomes the calendar app's own responsibility (its
 * own OS-integrated alarm system), independent of WYP being open at all —
 * see ics.ts's own IcsAlarmOffset comment for the full reasoning.
 *
 * Reuses the app's existing .scrim/.modal/.modalhead/.checkrow components
 * verbatim (same shape as ConversionBanner.tsx's own modal) — no new CSS.
 * All three options start unchecked every time the dialog opens ("The
 * default would be none checked" — owner's own instruction), not
 * remembered across opens.
 *
 * `guidance` (2026-11-20) — optional, platform-specific text shown above the
 * reminder-alarm note. Added for RequestResponseForm.tsx's own anonymous
 * `/r/[token]` recipient, who has never seen this app before and has no
 * reason to expect a browser download to produce a usable calendar event;
 * every other caller (ResponseDetailForm.tsx, CreateTodoForm.tsx,
 * TodoDetailForm.tsx — all reached only by a signed-in account holder who
 * already knows the drill) omits it, leaving this dialog unchanged there.
 *
 * `hasDueTime` (2026-11-20, owner-reported) — a Request/ToDo with no Due
 * Time set becomes an RFC 5545 all-day (VALUE=DATE) event (see
 * buildCalendarEventFields's own `allDay` field in ics.ts); "1 hour before"
 * and "At the scheduled time" both describe a specific clock moment that
 * simply doesn't exist on an all-day event — a calendar app can only
 * compute them relative to DTSTART's own implied midnight, which isn't what
 * either label promises. When false, those two are dropped and "1 day
 * before" is joined by "Day of" instead — the same zero-offset `attime`
 * TRIGGER as "At the scheduled time" (fires at the start of DTSTART, i.e.
 * the day itself), just labeled for what that actually means without a
 * time component. Required, not optional, so every caller has to supply
 * the real answer rather than silently defaulting to the time-bearing set.
 *
 * `reminderSummary` (2026-11-20, owner-reported) — WYP's own "Reminders
 * until Done" emails/texts (reminder_enabled/day_of/day_after/minutes_
 * before) are completely independent of the calendar-app alarms this
 * dialog adds, and can keep firing on their own schedule regardless of
 * what's picked here — owner: "if the requestor had already set reminder
 * options, the calendar reminder dialog should show that, otherwise the
 * user may be surprised or unhappy about what subsequently occurs." Only
 * `RequestResponseForm.tsx`/`ResponseDetailForm.tsx` pass one (built by
 * each screen's own `calendarReminderSummaryText()`, already excluding
 * anything ineligible/already-sent/Done) — on a ToDo the same person who
 * configured its own Reminders is the one adding the calendar entry, with
 * no separate "requestor" to be surprised by, so `CreateTodoForm.tsx`/
 * `TodoDetailForm.tsx` don't pass this.
 */

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: (alarms: IcsAlarmOffset[]) => void
  confirmLabel?: string
  guidance?: ReactNode
  hasDueTime: boolean
  reminderSummary?: string
}

function alarmOptionsFor(hasDueTime: boolean): { value: IcsAlarmOffset; label: string }[] {
  if (!hasDueTime) {
    return [
      { value: '1day', label: '1 day before' },
      { value: 'attime', label: 'Day of' },
    ]
  }
  return [
    { value: '1day', label: '1 day before' },
    { value: '1hour', label: '1 hour before' },
    { value: 'attime', label: 'At the scheduled time' },
  ]
}

export default function AddToCalendarAlarmsDialog({
  open,
  onCancel,
  onConfirm,
  confirmLabel = 'Add to Calendar',
  guidance,
  hasDueTime,
  reminderSummary,
}: Props) {
  const [selected, setSelected] = useState<Set<IcsAlarmOffset>>(new Set())

  if (!open) return null

  const alarmOptions = alarmOptionsFor(hasDueTime)

  function toggle(value: IcsAlarmOffset) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function handleCancel() {
    setSelected(new Set())
    onCancel()
  }

  function handleConfirm() {
    const alarms = Array.from(selected)
    setSelected(new Set())
    onConfirm(alarms)
  }

  return (
    <>
      <div className="scrim" onClick={handleCancel} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="calendar-alarms-title">
        <div className="modalhead">
          <p className="modal-title" id="calendar-alarms-title">Calendar Reminder</p>
          <div className="modalacts">
            <button className="btn-secondary" type="button" onClick={handleCancel}>Cancel</button>
            <button className="btn" type="button" onClick={handleConfirm}>{confirmLabel}</button>
          </div>
        </div>
        {guidance && (
          <p className="checknote" style={{ marginBottom: 10 }}>
            {guidance}
          </p>
        )}
        {reminderSummary && (
          <p className="checknote" style={{ marginBottom: 10 }}>
            {reminderSummary}
          </p>
        )}
        <p className="checknote" style={{ marginBottom: 10 }}>
          Optionally add a reminder alarm inside the calendar event itself — your calendar app
          will alert you, whether or not Would You Please is open. None selected by default.
        </p>
        {alarmOptions.map((opt) => (
          <label className="checkrow" key={opt.value} style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
            <span className="checktext">{opt.label}</span>
          </label>
        ))}
      </div>
    </>
  )
}
