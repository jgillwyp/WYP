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
 */

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: (alarms: IcsAlarmOffset[]) => void
  confirmLabel?: string
  guidance?: ReactNode
}

const ALARM_OPTIONS: { value: IcsAlarmOffset; label: string }[] = [
  { value: '1day', label: '1 day before' },
  { value: '1hour', label: '1 hour before' },
  { value: 'attime', label: 'At the scheduled time' },
]

export default function AddToCalendarAlarmsDialog({
  open,
  onCancel,
  onConfirm,
  confirmLabel = 'Add to Calendar',
  guidance,
}: Props) {
  const [selected, setSelected] = useState<Set<IcsAlarmOffset>>(new Set())

  if (!open) return null

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
        <p className="checknote" style={{ marginBottom: 10 }}>
          Optionally add a reminder alarm inside the calendar event itself — your calendar app
          will alert you, whether or not Would You Please is open. None selected by default.
        </p>
        {ALARM_OPTIONS.map((opt) => (
          <label className="checkrow" key={opt.value} style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
            <span className="checktext">{opt.label}</span>
          </label>
        ))}
      </div>
    </>
  )
}
