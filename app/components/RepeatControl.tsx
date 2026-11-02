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

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  type RepeatRule,
  type RepeatType,
  FREE_TIER_MAX_CONCURRENT_REPEATS,
  activeRepeatHeads,
  clampInterval,
  defaultRepeatRule,
  describeRepeat,
  dueDateWeekday,
  monthChipOptions,
} from '@/lib/repeatRule'

// Local date helpers — duplicated per file, this codebase's own established
// convention for small stateless helpers (see RequestDetailForm.tsx/
// MainScreen.tsx's own identical copies). formatMDY is for a plain `date`
// column (due_date/done_date); formatMDYFromTimestamp is for a real
// timestamptz column (created_at) — slicing an ISO string for the latter
// reads the wrong calendar day in a negative-UTC-offset zone once local
// time has crossed midnight but UTC hasn't yet (fixed app-wide 2026-09-03).
function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}
function formatMDYFromTimestamp(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}-${String(y).slice(2)}`
}

// Active-repeats row shape for the free-tier concurrent-cap check and its
// Review/modify Repeats dialog (2026-11-02 redesign — see
// FREE_TIER_MAX_CONCURRENT_REPEATS's own header comment in repeatRule.ts).
// contact_id null means a ToDo (same contact_id-null convention this whole
// app already uses to tell a ToDo from a Request); contacts(display_name)
// is only ever populated for a Request.
type ActiveRepeatRow = {
  id: string
  contact_id: string | null
  description: string
  due_date: string | null
  done_date: string | null
  created_at: string
  repeat_occurrence_index: number | null
  repeat_series_id: string | null
  contacts: { display_name: string } | null
}

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
   * free-with-limits. Redesigned 2026-11-02: Free is capped on how many
   * Requests/ToDos can be repeating AT ONCE (FREE_TIER_MAX_CONCURRENT_
   * REPEATS), not on how many occurrences one series can generate — this
   * component fetches and enforces that count itself (owner-scoped via
   * RLS, no extra prop needed) and shows its own greyed band + Review/
   * modify Repeats dialog when a Free owner is at the cap. Omit/undefined
   * disables the cap check entirely (used nowhere currently — every call
   * site passes a real tier). */
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

  // Free-tier concurrent-Repeat cap (2026-11-02) — null means "not yet
  // loaded" (or not applicable, tier !== 'free'), so atCap below never
  // falsely shows before the count is actually known. Fetched via a plain
  // owner-scoped select — `requests` RLS already restricts reads to the
  // signed-in owner's own rows, same as every other owner-scoped query in
  // this app, so no explicit owner_id filter or prop is needed here.
  const [activeRepeats, setActiveRepeats] = useState<ActiveRepeatRow[] | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [confirmRow, setConfirmRow] = useState<ActiveRepeatRow | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Bumped after a successful Remove (from the Review/modify Repeats list)
  // to re-trigger the fetch effect below — re-running the effect via a
  // dependency change, rather than calling its own fetch function directly
  // from the event handler, is what keeps the effect's async load() local
  // to the effect itself (same shape AccountForm.tsx's own load() already
  // uses) and satisfies react-hooks/set-state-in-effect.
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (tier !== 'free') return
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('requests')
        .select(
          'id, contact_id, description, due_date, done_date, created_at, repeat_occurrence_index, repeat_series_id, contacts(display_name)'
        )
        .not('repeat_rule', 'is', null)
        .is('archived_at', null)
      if (!cancelled) setActiveRepeats(activeRepeatHeads((data ?? []) as unknown as ActiveRepeatRow[]))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tier, refreshToken])

  // Only meaningful when adding a brand-new Repeat (rule === null) — editing
  // or removing an already-repeating item never needs a free slot, it
  // already has one. Stays false (never blocks) until the count actually
  // loads, and always false for a Subscriber (no cap at all).
  const atCap =
    rule === null && tier === 'free' && activeRepeats !== null && activeRepeats.length >= FREE_TIER_MAX_CONCURRENT_REPEATS

  async function handleRemoveFromList(row: ActiveRepeatRow) {
    setRemoving(true)
    setRemoveError(null)
    const { error } = await supabase
      .from('requests')
      .update({ repeat_rule: null, repeat_occurrence_index: null })
      .eq('id', row.id)
    setRemoving(false)
    if (error) {
      setRemoveError(error.message)
      return
    }
    setConfirmRow(null)
    setRefreshToken((n) => n + 1)
  }

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

  const bandDisabled = disabled || atCap

  return (
    <>
      <div className={`repeatband${bandDisabled ? ' is-disabled' : ''}`}>
        {/* Visible explanatory text while greyed for the plain disabled
            reasons (no Due Date yet, archived) — owner, 2026-11-02:
            "shown in parenthesis to the left of the 'Add Repeat' button"
            instead of the earlier below-the-band paragraph, which read
            disconnected from the button it was explaining. Appended after
            bandText (not a replacement for it) so an already-repeating,
            now-archived item still shows both its own description and why
            it can no longer be edited. atCap keeps its own separate,
            longer note below — a full sentence with an embedded link
            doesn't fit compactly inline next to the button. */}
        <span className="repeatband-text">
          {bandText}
          {!atCap && disabled && disabledReason && (
            <>
              {bandText ? ' ' : ''}({disabledReason})
            </>
          )}
        </span>
        <button
          className="btn"
          type="button"
          disabled={bandDisabled}
          title={!atCap && disabled ? disabledReason : undefined}
          onClick={openModal}
        >
          {buttonLabel}
        </button>
      </div>

      {atCap && (
        <p className="checknote repeatband-note">
          Free accounts can have up to {FREE_TIER_MAX_CONCURRENT_REPEATS} Requests/ToDos repeating at
          once.{' '}
          <button type="button" className="linkbtn" onClick={() => setReviewOpen(true)}>
            Review/modify Repeats
          </button>{' '}
          Subscribe for unlimited concurrent Repeats.
        </p>
      )}

      {reviewOpen && !confirmRow && (
        <>
          <div className="scrim" onClick={() => setReviewOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="review-repeats-title">
            <div className="modalhead">
              <p className="modal-title" id="review-repeats-title">
                Active Repeats
              </p>
              <div className="modalacts">
                <button className="btn-secondary" type="button" onClick={() => setReviewOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {(activeRepeats ?? []).map((row) => (
              <div key={row.id} className="repeatlistrow">
                <span className="repeatlistrow-text">
                  {row.contact_id ? 'Request' : 'ToDo'} &mdash;{' '}
                  {row.description.length > 60 ? `${row.description.slice(0, 60)}…` : row.description}
                </span>
                <button className="btn-secondary" type="button" onClick={() => setConfirmRow(row)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {reviewOpen && confirmRow && (
        <>
          <div className="scrim" onClick={() => setConfirmRow(null)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-remove-repeat-title">
            <div className="modalhead">
              <p className="modal-title" id="confirm-remove-repeat-title">
                Remove Repeat?
              </p>
              <div className="modalacts">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setConfirmRow(null)}
                  disabled={removing}
                >
                  Cancel
                </button>
                <button className="btn" type="button" onClick={() => handleRemoveFromList(confirmRow)} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
            <div className="metarow">
              <span className="mlabel">Date:</span>
              <span className="mval">{formatMDYFromTimestamp(confirmRow.created_at)}</span>
            </div>
            <div className="metarow">
              <span className="mlabel">Recipient:</span>
              <span className="mval">{confirmRow.contacts?.display_name ?? ''}</span>
            </div>
            <div className="metarow">
              <span className="mlabel">Last Due Date:</span>
              <span className="mval">{confirmRow.due_date ? formatMDY(confirmRow.due_date) : '—'}</span>
            </div>
            <div className="metarow">
              <span className="mlabel">Last Done Date:</span>
              <span className="mval">{confirmRow.done_date ? formatMDY(confirmRow.done_date) : '—'}</span>
            </div>
            <div className="metarow">
              <span className="mlabel">Description:</span>
              <span className="mval">{confirmRow.description}</span>
            </div>
            {removeError && <p className="ferror">{removeError}</p>}
          </div>
        </>
      )}

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
          </div>
        </>
      )}
    </>
  )
}
