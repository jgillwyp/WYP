// Calendar View (2026-09-16) — data fetching, status, and item-label
// helpers shared by nothing else, but kept in their own module (rather
// than inline in CalendarView.tsx) so the component file stays focused on
// rendering. See docs/WYP_Calendar_View_Plan.md for the full design.

import { supabase } from './supabaseClient'

export type RecordType = 'sent' | 'received' | 'todo'
export type StatusFilter = 'all' | 'open' | 'overdue' | 'done'
export type ItemStatus = 'open' | 'overdue' | 'done'

export type CalendarItem = {
  id: string
  type: RecordType
  label: string
  dueDate: string
  dueTime: string | null
  status: ItemStatus
  hasTime: boolean
}

// Same three-way exclusive status and "Open includes Overdue" matching
// rule as MainScreen.tsx's own statusFor()/matchesStatusFilter() —
// duplicated per this codebase's established per-file convention rather
// than imported (MainScreen.tsx doesn't export these).
export function statusFor(due_date: string | null, done_date: string | null): ItemStatus {
  if (done_date) return 'done'
  if (due_date && due_date < todayIso()) return 'overdue'
  return 'open'
}

export function matchesStatusFilter(status: ItemStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return status === 'open' || status === 'overdue'
  return status === filter
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// truncate — same helper already duplicated in app/src/lib/ics.ts; kept
// here too rather than imported, since ics.ts's own copy is scoped to
// that module's RFC 5545 concerns, not a general-purpose shared util.
function truncate(s: string, n = 30): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

type SentRawRow = {
  id: string
  description: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  archived_at: string | null
  contacts: { display_name: string } | null
}

type ReceivedRawRow = {
  id: string
  description: string
  due_date: string | null
  due_time: string | null
  done_date: string | null
  owner_name: string | null
  owner_request_time_enabled: boolean
  received_archived_at: string | null
}

type TodoRawRow = {
  id: string
  description: string
  due_date: string | null
  done_date: string | null
  archived_at: string | null
}

// Sent — identical select shape to MainScreen.tsx's own Sent query, minus
// the columns Calendar doesn't need (created_at, dialog/attachments
// counts, categories — Category is never shown here per Jim's own
// explicit answer).
export async function fetchSentItems(): Promise<CalendarItem[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('id, description, due_date, due_time, done_date, archived_at, contacts(display_name)')
    .not('contact_id', 'is', null)
    .not('due_date', 'is', null)
  if (error || !data) return []
  return (data as unknown as SentRawRow[])
    .filter((r) => r.archived_at === null)
    .map((r) => ({
      id: r.id,
      type: 'sent' as const,
      label: `To: ${r.contacts?.display_name ?? '—'}, ${truncate(r.description)}`,
      dueDate: r.due_date as string,
      dueTime: r.due_time,
      status: statusFor(r.due_date, r.done_date),
      hasTime: r.due_time != null && r.due_time.trim() !== '',
    }))
}

// Received — same get_received_requests() RPC MainScreen.tsx already
// uses (no plain-select path exists — see that function's own comment).
// owner_request_time_enabled is the issuer's own setting, not the
// viewer's — CLAUDE.md's Entitlements section.
export async function fetchReceivedItems(): Promise<CalendarItem[]> {
  const { data, error } = await supabase.rpc('get_received_requests')
  if (error || !data) return []
  return (data as unknown as ReceivedRawRow[])
    .filter((r) => r.received_archived_at === null && r.due_date !== null)
    .map((r) => ({
      id: r.id,
      type: 'received' as const,
      label: `From: ${r.owner_name ?? '—'}, ${truncate(r.description)}`,
      dueDate: r.due_date as string,
      dueTime: r.owner_request_time_enabled ? r.due_time : null,
      status: statusFor(r.due_date, r.done_date),
      hasTime: r.owner_request_time_enabled && r.due_time != null && r.due_time.trim() !== '',
    }))
}

// ToDos — same plain select MainScreen.tsx uses (contact_id is null).
// due_time is only meaningful when the account has both todo_dates_enabled
// and todo_time_enabled on (migration 067) — callers pass todoTimeEnabled
// through since that's an account-level setting this module has no
// session of its own to read.
export async function fetchTodoItems(todoTimeEnabled: boolean): Promise<CalendarItem[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('id, description, due_date, due_time, done_date, archived_at')
    .is('contact_id', null)
    .not('due_date', 'is', null)
  if (error || !data) return []
  return (data as unknown as (TodoRawRow & { due_time: string | null })[])
    .filter((r) => r.archived_at === null)
    .map((r) => ({
      id: r.id,
      type: 'todo' as const,
      label: `ToDo ${truncate(r.description)}`,
      dueDate: r.due_date as string,
      dueTime: todoTimeEnabled ? r.due_time : null,
      status: statusFor(r.due_date, r.done_date),
      hasTime: todoTimeEnabled && r.due_time != null && r.due_time.trim() !== '',
    }))
}
