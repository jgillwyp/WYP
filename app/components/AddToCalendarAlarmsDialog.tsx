'use client'

import { useState } from 'react'

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
 */

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: (alarms: IcsAlarmOffset[]) => void
  confirmLabel?: string
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
