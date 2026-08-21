'use client'

// Shared Repeat band + Add/Edit Repeat modal — Jim's own recurrence-method
// design ("WYP Repeat design.docx", uploaded 2026-08-21). Used by Create
// Request, Request Detail, Create ToDo, and ToDo Detail (§6.42 PROPOSED —
// the band; §6.43 PROPOSED — the modal's new Stops Repeating radio group,
// this app's first use of a native <input type="radio">: every other
// either/or choice elsewhere uses the .chip/.chiprow pattern instead, but
// Stops Repeating pairs each option with its own inline field (a date, a
// count) that only makes sense once that option is selected — a shape
// .chip's compact pill buttons don't fit, and "choose exactly one" is
// exactly what a radio input means semantically.
//
// This component only edits the RepeatRule itself (Type/fields/Stops/
// Remove) — it does NOT handle the Attachments/Locations carry-forward
// picker, which has two different shapes depending on the screen (a
// one-time prompt at Send on Create Request/Create ToDo, since neither has
// a real id yet to attach a boolean to; an inline checklist inside this
// same modal on Request Detail/ToDo Detail, where real attachments rows
// already exist) — each screen builds that piece itself and composes it
// alongside <RepeatControl>.
//
// See app/src/lib/repeatRule.ts for the pure recurrence math and the single
// descriptive-text builder every consumer (this band, the recipient's
// read-only footnote, print reports) shares verbatim.

import { useState } from 'react'
import {
  type RepeatRule,
  type RepeatType,
  clampInterval,
  defaultRepeatRule,
  describeRepeat,
  dueDateWeekday,
  monthChipOptions,
} from '@/lib/repeatRule'

type Props = {
  rule: RepeatRule | null
  dueDate: string
  onSave: (rule: RepeatRule) => void
  onRemove: () => void
  /** True when the Due Date hasn't been set yet, or the Request/ToDo is
   * archived — Jim's own spec: "greyed-out ... until a Due Date is entered
   * and when viewing archived Request." Same posture as the Reminder
   * checkbox's own disabled/tooltip pattern. */
  disabled: boolean
  disabledReason?: string
}

const TYPE_LABELS: Record<RepeatType, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }

function unitLabel(type: RepeatType, interval: number): string {
  const singular: Record<RepeatType, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }
  return interval === 1 ? singular[type] : `${singular[type]}s`
}

export default function RepeatControl({ rule, dueDate, onSave, onRemove, disabled, disabledReason }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RepeatRule>(rule ?? defaultRepeatRule())

  function openModal() {
    setDraft(rule ?? defaultRepeatRule())
    setOpen(true)
  }

  function handleSave() {
    onSave(draft)
    setOpen(false)
  }

  function handleRemove() {
    onRemove()
    setOpen(false)
  }

  const bandText = rule && dueDate ? describeRepeat(rule, dueDate) : ''
  const buttonLabel = rule ? 'Edit Repeat' : 'Add Repeat'
  const monthOptions = dueDate ? monthChipOptions(dueDate) : { dayLabel: 'Day', weekdayLabel: 'Weekday' }

  return (
    <>
      <div className={`repeatband${disabled ? ' is-disabled' : ''}`}>
        <span className="repeatband-text">{bandText}</span>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={openModal}
        >
          {buttonLabel}
        </button>
      </div>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="repeat-title">
            <div className="modalhead">
              <p className="modal-title" id="repeat-title">
                {rule ? 'Edit Repeat' : 'Add Repeat'}
              </p>
              <div className="modalacts">
                {rule && (
                  <button className="btn-secondary" type="button" onClick={handleRemove}>
                    Remove
                  </button>
                )}
                <button className="btn-secondary" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={handleSave}>
                  Save
                </button>
              </div>
            </div>

            <div className="fgroup">
              <div className="chiprow" role="radiogroup" aria-label="Repeat Type">
                {(['day', 'week', 'month', 'year'] as RepeatType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${draft.type === t ? ' selected' : ''}`}
                    aria-pressed={draft.type === t}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        type: t,
                        interval: clampInterval(t, d.interval),
                        monthMode: t === 'month' ? d.monthMode ?? 'day' : d.monthMode,
                      }))
                    }
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {draft.type === 'day' && (
              <>
                <div className="fgroup repeat-interval-row">
                  <span>Repeats every</span>
                  <input
                    type="number"
                    className="repeat-number"
                    min={1}
                    max={99}
                    value={draft.interval}
                    onChange={(e) => setDraft((d) => ({ ...d, interval: clampInterval('day', Number(e.target.value)) }))}
                  />
                  <span>{unitLabel('day', draft.interval)}</span>
                </div>
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={!!draft.weekdaysOnly}
                    onChange={(e) => setDraft((d) => ({ ...d, weekdaysOnly: e.target.checked }))}
                  />
                  <span className="checktext">Monday through Friday only</span>
                </label>
              </>
            )}

            {draft.type === 'week' && (
              <>
                <div className="fgroup repeat-interval-row">
                  <span>Repeats every</span>
                  <input
                    type="number"
                    className="repeat-number"
                    min={1}
                    max={99}
                    value={draft.interval}
                    onChange={(e) => setDraft((d) => ({ ...d, interval: clampInterval('week', Number(e.target.value)) }))}
                  />
                  <span>{unitLabel('week', draft.interval)}</span>
                </div>
                <p className="checknote">Repeats on {dueDate ? dueDateWeekday(dueDate) : '—'}</p>
              </>
            )}

            {draft.type === 'month' && (
              <>
                <div className="fgroup repeat-interval-row">
                  <span>Repeats every</span>
                  <input
                    type="number"
                    className="repeat-number"
                    min={1}
                    max={99}
                    value={draft.interval}
                    onChange={(e) => setDraft((d) => ({ ...d, interval: clampInterval('month', Number(e.target.value)) }))}
                  />
                  <span>{unitLabel('month', draft.interval)}</span>
                </div>
                <div className="fgroup">
                  <span className="flabel">Repeats on</span>
                  <div className="chiprow" role="radiogroup" aria-label="Repeats on">
                    <button
                      type="button"
                      className={`chip${(draft.monthMode ?? 'day') === 'day' ? ' selected' : ''}`}
                      aria-pressed={(draft.monthMode ?? 'day') === 'day'}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDraft((d) => ({ ...d, monthMode: 'day' }))}
                    >
                      {monthOptions.dayLabel}
                    </button>
                    <button
                      type="button"
                      className={`chip${draft.monthMode === 'weekday' ? ' selected' : ''}`}
                      aria-pressed={draft.monthMode === 'weekday'}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDraft((d) => ({ ...d, monthMode: 'weekday' }))}
                    >
                      {monthOptions.weekdayLabel}
                    </button>
                  </div>
                </div>
              </>
            )}

            {draft.type === 'year' && (
              <div className="fgroup repeat-interval-row">
                <span>Repeats every</span>
                <input
                  type="number"
                  className="repeat-number"
                  min={1}
                  max={10}
                  value={draft.interval}
                  onChange={(e) => setDraft((d) => ({ ...d, interval: clampInterval('year', Number(e.target.value)) }))}
                />
                <span>{unitLabel('year', draft.interval)}</span>
              </div>
            )}

            <div className="stopgroup">
              <p className="stopgroup-title">Stops Repeating</p>
              <label className="stoprow">
                <input
                  type="radio"
                  name="repeat-stop"
                  checked={draft.stopType === 'never'}
                  onChange={() => setDraft((d) => ({ ...d, stopType: 'never' }))}
                />
                <span>Never</span>
              </label>
              <label className="stoprow">
                <input
                  type="radio"
                  name="repeat-stop"
                  checked={draft.stopType === 'on'}
                  onChange={() => setDraft((d) => ({ ...d, stopType: 'on', stopDate: d.stopDate ?? dueDate }))}
                />
                <span>On</span>
                <input
                  type="date"
                  className="stop-date-field"
                  disabled={draft.stopType !== 'on'}
                  value={draft.stopDate ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, stopDate: e.target.value }))}
                />
              </label>
              <label className="stoprow">
                <input
                  type="radio"
                  name="repeat-stop"
                  checked={draft.stopType === 'after'}
                  onChange={() => setDraft((d) => ({ ...d, stopType: 'after', stopCount: d.stopCount ?? 1 }))}
                />
                <span>After</span>
                <input
                  type="number"
                  className="repeat-number"
                  min={1}
                  disabled={draft.stopType !== 'after'}
                  value={draft.stopCount ?? 1}
                  onChange={(e) => setDraft((d) => ({ ...d, stopCount: Math.max(1, Number(e.target.value) || 1) }))}
                />
                <span>times</span>
              </label>
            </div>
          </div>
        </>
      )}
    </>
  )
}
