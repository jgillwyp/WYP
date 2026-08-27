'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  stashConversionCarry,
  type ConversionCarryPayload,
  type ConversionDoneAction,
  type ConversionSourceType,
} from '@/lib/conversionCarry'

/**
 * Request<->ToDo conversion banner (2026-08-26) — a bottom-of-form
 * .donerow/.donenote row (same component the Send Reminder panel already
 * uses on Request Detail) offering "Create a ToDo from this Request" or
 * "Create a Request from this ToDo." Shared across Request Detail, ToDo
 * Detail, and Response Detail — the only three screens that ever show one
 * of these two directions (Response Detail is request-to-todo only, since
 * a signed-in recipient never has a ToDo of their own to convert back the
 * other way from this screen).
 *
 * Continue never touches the source item itself — it only stashes a
 * ConversionCarryPayload (app/src/lib/conversionCarry.ts) and navigates to
 * the other record type's Create screen, which applies both the
 * pre-fill and any queued Done/Archive side effect only once its own
 * Save/Send actually succeeds.
 */

type Direction = 'request-to-todo' | 'todo-to-request'

type Props = {
  direction: Direction
  sourceType: ConversionSourceType
  sourceId: string
  isDone: boolean
  description: string
  categoryName: string | null
  dueDate: string | null
}

const BANNER_LABEL: Record<Direction, string> = {
  'request-to-todo': 'Create a ToDo from this Request',
  'todo-to-request': 'Create a Request from this ToDo',
}

const TARGET_ROUTE: Record<Direction, string> = {
  'request-to-todo': '/todos/new',
  'todo-to-request': '/requests/new',
}

const SOURCE_NOUN: Record<Direction, string> = {
  'request-to-todo': 'Request',
  'todo-to-request': 'ToDo',
}

const TARGET_NOUN: Record<Direction, string> = {
  'request-to-todo': 'ToDo',
  'todo-to-request': 'Request',
}

export default function ConversionBanner({
  direction,
  sourceType,
  sourceId,
  isDone,
  description,
  categoryName,
  dueDate,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [markDone, setMarkDone] = useState(false)
  const [markDoneAndArchive, setMarkDoneAndArchive] = useState(false)
  const [archiveOnly, setArchiveOnly] = useState(false)

  function openModal() {
    setMarkDone(false)
    setMarkDoneAndArchive(false)
    setArchiveOnly(false)
    setOpen(true)
  }

  function handleContinue() {
    const doneAction: ConversionDoneAction = isDone
      ? archiveOnly
        ? 'archive_only'
        : 'none'
      : markDoneAndArchive
        ? 'done_archive'
        : markDone
          ? 'done'
          : 'none'

    const payload: ConversionCarryPayload = {
      sourceType,
      sourceId,
      description,
      categoryName,
      dueDate,
      doneAction,
    }
    stashConversionCarry(payload)
    setOpen(false)
    router.push(TARGET_ROUTE[direction])
  }

  return (
    <>
      {/* .donerow-stack (2026-08-27) — button on top, descriptive text
          below, rather than .donerow's plain row layout every other
          quick-Done band uses. See globals.css's own comment on
          .donerow-stack for why this one caller needed it. */}
      <div className="donerow donerow-stack">
        <button className="btn-secondary" type="button" onClick={openModal}>
          {BANNER_LABEL[direction]}
        </button>
        <span className="donenote">
          Carries this {SOURCE_NOUN[direction]}&rsquo;s Description, Category, and Due Date into a new{' '}
          {TARGET_NOUN[direction]}.
        </span>
      </div>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="convert-title">
            <div className="modalhead">
              <p className="modal-title" id="convert-title">
                {BANNER_LABEL[direction]}
              </p>
              <div className="modalacts">
                <button className="btn-secondary" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={handleContinue}>
                  Continue
                </button>
              </div>
            </div>
            {isDone ? (
              <label className="checkrow">
                <input type="checkbox" checked={archiveOnly} onChange={(e) => setArchiveOnly(e.target.checked)} />
                <span className="checktext">Archive this {SOURCE_NOUN[direction]}</span>
              </label>
            ) : (
              <>
                <label className="checkrow" style={{ marginBottom: 8 }}>
                  <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
                  <span className="checktext">Mark as Done</span>
                </label>
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={markDoneAndArchive}
                    onChange={(e) => setMarkDoneAndArchive(e.target.checked)}
                  />
                  <span className="checktext">Mark as Done and Archive this {SOURCE_NOUN[direction]}</span>
                </label>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
