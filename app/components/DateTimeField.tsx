'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * DateTimeField (2026-10-08) — shared Date field with an opt-in Time field,
 * replacing the old always-shown, side-by-side Due/Done Date+Time pair
 * across all six screens that have one (Create Request, Request Detail,
 * Response Detail, Request Response, Create ToDo, ToDo Detail).
 *
 * Built from a real iPhone 14 Pro Max / iOS 18.1.1 bug report: WebKit's own
 * native date/time control needs more rendering width than a 50/50-split
 * row can give it on a phone, confirmed (owner's own test) to render fine
 * on Android and desktop — so this isn't a cross-platform CSS problem, it's
 * that two native pickers sharing one row doesn't fit this control's real
 * needs. Jim's own proposed fix, refined over several rounds: Date renders
 * alone, full width; a small "+ Add Time" link reveals a genuinely separate,
 * empty Time field only when tapped, instead of a combined datetime-local
 * widget (which can't cleanly represent "date set, no time" without
 * defaulting to a value like midnight — Reminders/.ics/print reports all
 * treat "no Due Time" as a real, different state from "Due Time is
 * midnight", so silently defaulting one in was never acceptable). "+ Add
 * Time" shows only when timeEnabled is true (the account's own Show
 * Due/Done Time toggle) — unchanged from before, this field never existed
 * at all when that's off. Date and Time never share a row — stacked
 * vertically whenever Time is present, sidestepping the WebKit width issue
 * entirely rather than patching around it with per-platform CSS.
 *
 * The box stays on the input itself (2026-10-08, reverted a same-day
 * wrapper-ownership experiment) — an on-screen diagnostic (Jim had no Mac
 * for Safari Web Inspector) found that iOS Safari's own UA stylesheet
 * declares width/box-sizing on input[type="date"]/[type="time"] with a
 * priority an author `!important` can't beat. `-webkit-appearance:
 * textfield` was tried first and genuinely applied (confirmed via the
 * same diagnostic) but had zero effect on width; `-webkit-appearance:
 * none` — a more thorough native-chrome reset — turned out to be the
 * actual fix, confirmed full-width on a real device. See globals.css's
 * own `input[type="date"].finput`/`input[type="time"].finput` rule,
 * scoped to iOS Safari only via `@supports (-webkit-touch-callout: none)`
 * so Android/desktop (already correct) are untouched.
 */

function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget
  try {
    el.showPicker?.()
  } catch {
    // pre-16.4 Safari has no showPicker() — clicking still focuses the
    // input and opens the native picker via its own default behavior.
  }
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="10" width="34" height="32" rx="4" fill="none" stroke="#5A6675" strokeWidth="3.5" />
      <line x1="7" y1="19" x2="41" y2="19" stroke="#5A6675" strokeWidth="3.5" />
      <line x1="16" y1="5" x2="16" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="12" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="16" cy="27" r="2.2" fill="#5A6675" />
      <circle cx="24" cy="27" r="2.2" fill="#5A6675" />
      <circle cx="32" cy="27" r="2.2" fill="#5A6675" />
      <circle cx="16" cy="35" r="2.2" fill="#5A6675" />
      <circle cx="24" cy="35" r="2.2" fill="#5A6675" />
    </svg>
  )
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="17" fill="none" stroke="#5A6675" strokeWidth="3.5" />
      <line x1="24" y1="24" x2="24" y2="13" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="24" y1="24" x2="32" y2="28" stroke="#5A6675" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export default function DateTimeField({
  idPrefix,
  dateLabel,
  timeLabel,
  dateValue,
  onDateChange,
  timeValue,
  onTimeChange,
  timeEnabled,
  required = false,
  invalid = false,
  errorMessage,
  disabled = false,
  dateClassExtra = '',
  dateInputRef,
}: {
  idPrefix: string
  dateLabel: string
  timeLabel: string
  dateValue: string
  onDateChange: (value: string) => void
  timeValue: string
  onTimeChange: (value: string) => void
  timeEnabled: boolean
  required?: boolean
  invalid?: boolean
  errorMessage?: string
  disabled?: boolean
  /** Extra class on the date <input> itself — e.g. "overdue-date". */
  dateClassExtra?: string
  /** Access to the underlying date <input> DOM node — e.g. the quick-Done
   *  band's scrollIntoView() on Request Response/Response Detail. */
  dateInputRef?: React.RefObject<HTMLInputElement | null>
}) {
  // Starts expanded whenever a real Time value already exists (editing an
  // existing Request/ToDo) — a lazy initializer alone would miss a value
  // that arrives after an async load (Request Detail/ToDo Detail/etc. all
  // fetch their record post-mount), so the effect below also expands on a
  // later-arriving value. Only the explicit "+ Add Time" click opens the
  // native picker (addedByUser), so loading an existing time never pops a
  // picker open unprompted.
  const [timeExpanded, setTimeExpanded] = useState(timeValue.trim() !== '')
  const addedByUserRef = useRef(false)
  const timeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (timeValue.trim() === '') return
    // Deferred one microtask — same react-hooks/set-state-in-effect-
    // satisfying pattern used elsewhere in this app (e.g. CreateRequestForm's
    // own voiceSupported) rather than calling setState synchronously inside
    // the effect body.
    queueMicrotask(() => setTimeExpanded(true))
  }, [timeValue])

  useEffect(() => {
    if (timeExpanded && addedByUserRef.current) {
      addedByUserRef.current = false
      try {
        timeInputRef.current?.showPicker?.()
      } catch {
        timeInputRef.current?.focus()
      }
    }
  }, [timeExpanded])

  function handleAddTime() {
    addedByUserRef.current = true
    setTimeExpanded(true)
  }

  function handleRemoveTime() {
    onTimeChange('')
    setTimeExpanded(false)
  }

  const dateId = `${idPrefix}-date`
  const timeId = `${idPrefix}-time`

  return (
    <div className={`fgroup${invalid ? ' is-invalid' : ''}`}>
      <div className="ffloat picker native">
        <input
          ref={dateInputRef}
          className={`finput${required ? ' req' : dateValue.trim() === '' ? ' opt' : ''}${dateClassExtra ? ` ${dateClassExtra}` : ''}`}
          id={dateId}
          type="date"
          value={dateValue}
          onChange={(e) => onDateChange(e.target.value)}
          onClick={openPicker}
          disabled={disabled}
        />
        <label className="flabel" htmlFor={dateId}>
          <span className="lglyph" aria-hidden="true">
            <CalendarGlyph />
          </span>
          {dateLabel}
          {!required && <span className="subnote"> (optional)</span>}
        </label>
      </div>
      {invalid && errorMessage && <p className="ferror" style={{ marginTop: -8 }}>{errorMessage}</p>}

      {timeEnabled && (
        timeExpanded ? (
          <div className="ffloat picker native" style={{ marginTop: 8 }}>
            <input
              ref={timeInputRef}
              className={`finput${timeValue.trim() === '' ? ' opt' : ''}`}
              id={timeId}
              type="time"
              value={timeValue}
              onChange={(e) => onTimeChange(e.target.value)}
              onClick={openPicker}
              disabled={disabled}
            />
            <label className="flabel" htmlFor={timeId}>
              <span className="lglyph" aria-hidden="true">
                <ClockGlyph />
              </span>
              {timeLabel}
            </label>
            <button
              type="button"
              className="fclose"
              aria-label={`Close ${timeLabel} picker`}
              onClick={(e) => {
                e.stopPropagation()
                timeInputRef.current?.blur()
                e.currentTarget.blur()
              }}
            >
              &#10003;
            </button>
            <button
              type="button"
              className="fclear"
              aria-label={`Remove ${timeLabel}`}
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveTime()
              }}
              disabled={disabled}
            >
              &times;
            </button>
          </div>
        ) : (
          !disabled && (
            <button type="button" className="linkbtn" style={{ marginTop: 6 }} onClick={handleAddTime}>
              + Add {timeLabel}
            </button>
          )
        )
      )}
    </div>
  )
}
