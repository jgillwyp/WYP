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
  FREE_TIER_MAX_REPEAT_OCCURRENCES,
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
  /** Added 2026-08-27 when Repeat moved from subscriber-only to
   * free-with-limits. Free renders a note in the modal warning that
   * generation stops automatically after FREE_TIER_MAX_REPEAT_OCCURRENCES
   * occurrences regardless of the Stops Repeating choice below — the actual
   * enforcement lives server-side in cron Phase E
   * (app/api/cron/tick/route.ts), this is purely informational so a Free
   * user isn't surprised later. Omit/undefined shows no note (used nowhere
   * currently — every call site now passes a real tier). */
  tier?: 'free' | 'subscriber'
}

const TYPE_LABELS: Record<RepeatType, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }

function unitLabel(type: RepeatType, interval: number): string {
  const singular: Record<RepeatType, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }
  return interval === 1 ? singular[type] : `${singular[type]}s`
}

// Android Chrome bug fix, 2026-08-21 — Jim reported the "1" in every
// Repeats-every number field couldn't be cleared/retyped on his phone (only
// worked via the desktop-only spinner arrows, which Android doesn't render
// for number inputs at all — a platform default, not something this app
// controls). Root cause: every field clamped via clampInterval() on every
// keystroke, including the moment the field is emptied — Number('') is 0,
// not NaN, so the clamp immediately snapped the controlled value back to
// "1" before the person could type a replacement digit. Fixed by reading
// e.target.valueAsNumber (NaN for an empty/invalid field, unlike
// Number(e.target.value)) and deferring the clamp to onBlur — the field can
// sit empty mid-edit and only gets clamped back to a valid 1-99 value once
// editing is done, matching how every other numeric input in this app that
// allows temporary emptiness already behaves.
function numDisplay(n: number | null | undefined): number | string {
  return n === null || n === undefined || Number.isNaN(n) ? '' : n
}

export default function RepeatControl({ rule, dueDate, onSave, onRemove, disabled, disabledReason, tier }: Props) {
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
                    value={numDisplay(draft.interval)}
                    onChange={(e) => {
                      const raw = e.target.valueAsNumber
                      setDraft((d) => ({ ...d, interval: Number.isFinite(raw) ? clampInterval('day', raw) : raw }))
                    }}
                    onBlur={() => setDraft((d) => ({ ...d, interval: clampInterval('day', d.interval) }))}
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
                    value={numDisplay(draft.interval)}
                    onChange={(e) => {
                      const raw = e.target.valueAsNumber
                      setDraft((d) => ({ ...d, interval: Number.isFinite(raw) ? clampInterval('week', raw) : raw }))
                    }}
                    onBlur={() => setDraft((d) => ({ ...d, interval: clampInterval('week', d.interval) }))}
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
                    value={numDisplay(draft.interval)}
                    onChange={(e) => {
                      const raw = e.target.valueAsNumber
                      setDraft((d) => ({ ...d, interval: Number.isFinite(raw) ? clampInterval('month', raw) : raw }))
                    }}
                    onBlur={() => setDraft((d) => ({ ...d, interval: clampInterval('month', d.interval) }))}
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
                  value={numDisplay(draft.interval)}
                  onChange={(e) => {
                    const raw = e.target.valueAsNumber
                    setDraft((d) => ({ ...d, interval: Number.isFinite(raw) ? clampInterval('year', raw) : raw }))
                  }}
                  onBlur={() => setDraft((d) => ({ ...d, interval: clampInterval('year', d.interval) }))}
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
                  value={numDisplay(draft.stopCount ?? 1)}
                  onChange={(e) => setDraft((d) => ({ ...d, stopCount: e.target.valueAsNumber }))}
                  onBlur={() =>
                    setDraft((d) => ({
                      ...d,
                      stopCount: Number.isFinite(d.stopCount) && (d.stopCount as number) >= 1 ? Math.round(d.stopCount as number) : 1,
                    }))
                  }
                />
                <span>times</span>
              </label>
            </div>

            <p className="checknote repeat-invalid-note">
              <strong>Note:</strong> If a projected date doesn&rsquo;t exist (for
              example, the 31st in a 30-day month, or a 5th Wednesday in a
              month that only has four), the closest earlier date is used
              instead &mdash; the 30th, or the 4th Wednesday.
            </p>

            {tier === 'free' && (
              <p className="checknote repeat-invalid-note">
                <strong>Note:</strong> Free accounts stop Repeating
                automatically after {FREE_TIER_MAX_REPEAT_OCCURRENCES}{' '}
                occurrences, regardless of the Stops Repeating choice above.
                Subscribe for unlimited Repeats.
              </p>
            )}
          </div>
        </>
      )}
    </>
  )
}
