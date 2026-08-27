// src/lib/conversionCarry.ts
//
// Shared client-side carry-through for the Request<->ToDo conversion feature
// (2026-08-26, Jim's own Request/ToDo-symmetry proposal — see the decisions
// log's 2026-08-26 entry for the full design). A bottom banner on Request
// Detail, ToDo Detail, and Response Detail ("Create a ToDo from this
// Request" / "Create a Request from this ToDo") opens a small modal, then
// navigates to the other record type's own Create screen with the source
// item's Description/Category/Due Date carried forward and an optional
// Mark-as-Done/Archive side effect queued against the *source* item.
//
// The side effect is applied only once the new item is actually saved —
// never at the moment Continue is clicked — so abandoning the new Create
// screen (closing the tab, navigating away) never touches the source. This
// is why the payload is stashed in sessionStorage rather than applied
// immediately: the Create screen reads it back after its own Save/Send
// succeeds.
//
// sourceType distinguishes *how* the source item is reached, because the
// actual database write differs: 'owned' is a plain owner-side requests
// table update (Request Detail, ToDo Detail — the signed-in user owns the
// row); 'recipient' is the signed-in recipient of somebody else's Request
// (Response Detail), which must go through the same SECURITY DEFINER RPCs
// (set_response_done_as_recipient, archive_received_request) every other
// recipient-side write already uses — CLAUDE.md's own Entitlements
// section applies here exactly as it does everywhere else in this app: a
// plain table update would either be refused by RLS or isn't the correct
// permission model for the recipient side to begin with.

import { supabase } from './supabaseClient'
import { todayISODate } from './ics'

export type ConversionSourceType = 'owned' | 'recipient'

/** 'none' — no change to the source. 'done' — mark the source Done today
 * (only offered when the source isn't already Done). 'done_archive' — mark
 * Done and Archive in one step (only offered when the source isn't already
 * Done). 'archive_only' — Archive without touching Done Date (only offered
 * when the source is already Done, per Jim's own instruction: "if marked
 * as done, the only option should be 'Archive this [ToDo, Request]'"). */
export type ConversionDoneAction = 'none' | 'done' | 'done_archive' | 'archive_only'

export type ConversionCarryPayload = {
  sourceType: ConversionSourceType
  sourceId: string
  description: string
  categoryName: string | null
  dueDate: string | null
  doneAction: ConversionDoneAction
}

const CARRY_KEY = 'wyp.conversionCarry'

export function stashConversionCarry(payload: ConversionCarryPayload) {
  window.sessionStorage.setItem(CARRY_KEY, JSON.stringify(payload))
}

/** Reads and immediately clears the pending payload — single-consumption,
 * same convention as this app's other sessionStorage round-trip markers
 * (ArchiveForm.tsx's ARCHIVE_ROUNDTRIP_KEY, MainScreen.tsx's search
 * round-trip keys), so a leftover payload from an abandoned conversion
 * never silently pre-fills or acts on an unrelated later visit to the same
 * Create screen. The caller is expected to hold onto the returned value
 * itself (in state/a ref) for as long as it still needs it — e.g. until
 * Save succeeds and the side effect can actually be applied. */
export function takeConversionCarry(): ConversionCarryPayload | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(CARRY_KEY)
  if (!raw) return null
  window.sessionStorage.removeItem(CARRY_KEY)
  try {
    return JSON.parse(raw) as ConversionCarryPayload
  } catch {
    return null
  }
}

/** Applies the queued Done/Archive side effect to the *source* item — call
 * only after the new item has actually saved. Errors are swallowed
 * (logged to console) rather than surfaced to the user: the new item is
 * already saved successfully by the time this runs, so a failure here is a
 * partial, secondary problem, not something that should read as "your new
 * item wasn't saved." */
export async function applyConversionSideEffect(payload: ConversionCarryPayload): Promise<void> {
  if (payload.doneAction === 'none') return
  const today = todayISODate()

  try {
    if (payload.sourceType === 'owned') {
      const updates: Record<string, unknown> = {}
      if (payload.doneAction === 'done' || payload.doneAction === 'done_archive') {
        updates.done_date = today
      }
      if (payload.doneAction === 'done_archive' || payload.doneAction === 'archive_only') {
        updates.archived_at = new Date().toISOString()
      }
      await supabase.from('requests').update(updates).eq('id', payload.sourceId)
      return
    }

    // 'recipient' — Response Detail is the only source screen that reaches
    // here, and it only ever converts a Request into a ToDo, never the
    // reverse, so payload.sourceId is always a Request id here.
    if (payload.doneAction === 'done' || payload.doneAction === 'done_archive') {
      await supabase.rpc('set_response_done_as_recipient', {
        p_request_id: payload.sourceId,
        p_done_date: today,
        p_done_time: null,
      })
    }
    if (payload.doneAction === 'done_archive' || payload.doneAction === 'archive_only') {
      await supabase.rpc('archive_received_request', { p_request_id: payload.sourceId })
    }
  } catch (err) {
    console.error('Conversion side effect failed:', err)
  }
}
