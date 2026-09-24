'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import FullCalendar from '@fullcalendar/react'
import type { DatesSetArg, EventClickArg, EventContentArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { supabase } from '@/lib/supabaseClient'
import { printWithExpandedWindow } from '@/lib/platform'
import {
  fetchSentItems,
  fetchReceivedItems,
  fetchTodoItems,
  matchesStatusFilter,
  type CalendarItem,
  type StatusFilter,
} from '@/lib/calendarData'

/**
 * Calendar View (2026-09-16) — docs/WYP_Calendar_View_Plan.md. Plots Sent
 * Requests, Received Requests, and ToDos on a real Day/Week/Month calendar,
 * reached via a new calendar icon next to each Main Screen section's own
 * Print icon (see MainScreen.tsx's three new CalendarIcon buttons).
 *
 * Launch context arrives as `?section=sent|received|todo&status=all|open|
 * overdue|done` on a fresh navigation (read once via a lazy useState
 * initializer, same window.location.search convention as
 * AddContactForm.tsx's own `?from=create-request` — safe here because
 * /calendar is always a distinct pathname from whatever linked to it, never
 * a same-route params-only navigation like /login's own ?intent=signup case
 * that needed useSearchParams() instead). Only the launch section's own
 * Record Type checkbox starts checked and its own chip becomes the initial
 * Status filter; every control is freely changeable afterward.
 *
 * Round-trip: clicking a plotted item navigates to its own Detail screen
 * (mirrors ArchiveForm.tsx's ARCHIVE_ROUNDTRIP_KEY pattern) and back
 * restores Record Type/Status/View instead of re-reading the launch query
 * string a second time.
 */

const CALENDAR_ROUNDTRIP_KEY = 'wyp.calendarRoundTrip'
const CALENDAR_STATE_KEY = 'wyp.calendarRoundTripState'

type CalView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'

type RoundTripState = {
  sent: boolean
  received: boolean
  todo: boolean
  status: StatusFilter
  view: CalView
}

function readLaunchParams(): { section: 'sent' | 'received' | 'todo'; status: StatusFilter } {
  if (typeof window === 'undefined') return { section: 'sent', status: 'all' }
  const params = new URLSearchParams(window.location.search)
  const section = params.get('section')
  const status = params.get('status')
  return {
    section: section === 'received' || section === 'todo' ? section : 'sent',
    status: status === 'open' || status === 'overdue' || status === 'done' ? status : 'all',
  }
}

function readRoundTripState(): RoundTripState | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(CALENDAR_STATE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as RoundTripState
  } catch {
    return null
  }
}

function isRoundTrip(): boolean {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(CALENDAR_ROUNDTRIP_KEY) === '1'
}

// formatMDYSlash — print-only "M/D/YY  h:mm AM" convention already
// established elsewhere (e.g. MainScreen.tsx's print reports); duplicated
// here per this codebase's per-file small-helper convention.
function formatMDYSlash(dateStr: string, timeStr: string | null): string {
  const [y, m, d] = dateStr.split('-')
  const datePart = `${Number(m)}/${Number(d)}/${y.slice(2)}`
  if (!timeStr) return datePart
  const [hStr, minStr] = timeStr.split(':')
  let h = Number(hStr)
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${datePart}  ${h}:${minStr} ${suffix}`
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="17" cy="11" r="1" fill="currentColor" />
    </svg>
  )
}

export default function CalendarView() {
  const router = useRouter()
  const calendarRef = useRef<FullCalendar | null>(null)

  const launch = useMemo(() => readLaunchParams(), [])
  const savedState = useMemo(() => (isRoundTrip() ? readRoundTripState() : null), [])

  const [sentOn, setSentOn] = useState(savedState ? savedState.sent : launch.section === 'sent')
  const [receivedOn, setReceivedOn] = useState(savedState ? savedState.received : launch.section === 'received')
  const [todoOn, setTodoOn] = useState(savedState ? savedState.todo : launch.section === 'todo')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(savedState ? savedState.status : launch.status)
  const [view, setView] = useState<CalView>(savedState ? savedState.view : 'dayGridMonth')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sentItems, setSentItems] = useState<CalendarItem[]>([])
  const [receivedItems, setReceivedItems] = useState<CalendarItem[]>([])
  const [todoItems, setTodoItems] = useState<CalendarItem[]>([])

  const [todoDatesEnabled, setTodoDatesEnabled] = useState(false)

  const [printTick, setPrintTick] = useState(0)

  // Week/Day view slot range (2026-09-24) — FullCalendar's time grid needs a
  // single continuous hour range; a default 6am-6pm window covers the common
  // case, widened only as far as needed to include an actual event that
  // falls earlier or later. datesSet fires whenever the visible range
  // changes (view switch, prev/next), so the range re-tightens per Day/Week
  // rather than staying pinned to whatever was widest across every item ever
  // loaded.
  const [visibleStart, setVisibleStart] = useState<Date | null>(null)
  const [visibleEnd, setVisibleEnd] = useState<Date | null>(null)

  function handleDatesSet(arg: DatesSetArg) {
    setVisibleStart(arg.start)
    setVisibleEnd(arg.end)
  }

  // Clear the round-trip marker once consumed, matching ArchiveForm.tsx's
  // own mount-effect pattern — the *next* fresh visit should read the
  // launch query string again, not a stale saved state.
  useEffect(() => {
    window.sessionStorage.removeItem(CALENDAR_ROUNDTRIP_KEY)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        if (!cancelled) setLoading(false)
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('todo_dates_enabled, todo_time_enabled')
        .eq('id', userData.user.id)
        .single()
      if (cancelled) return
      const tdEnabled = profile?.todo_dates_enabled ?? false
      setTodoDatesEnabled(tdEnabled)

      try {
        const [sentRes, receivedRes, todoRes] = await Promise.all([
          fetchSentItems(),
          fetchReceivedItems(),
          tdEnabled ? fetchTodoItems(profile?.todo_time_enabled ?? false) : Promise.resolve([]),
        ])
        if (cancelled) return
        setSentItems(sentRes)
        setReceivedItems(receivedRes)
        setTodoItems(todoRes)
      } catch {
        if (!cancelled) setLoadError('Could not load Calendar items. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredItems = useMemo(() => {
    const items: CalendarItem[] = []
    if (sentOn) items.push(...sentItems.filter((i) => matchesStatusFilter(i.status, statusFilter)))
    if (receivedOn) items.push(...receivedItems.filter((i) => matchesStatusFilter(i.status, statusFilter)))
    if (todoOn) items.push(...todoItems.filter((i) => matchesStatusFilter(i.status, statusFilter)))
    return items
  }, [sentOn, receivedOn, todoOn, statusFilter, sentItems, receivedItems, todoItems])

  const events = useMemo(
    () =>
      filteredItems.map((item) => ({
        id: `${item.type}-${item.id}`,
        title: item.label,
        start: item.hasTime && item.dueTime ? `${item.dueDate}T${item.dueTime}` : item.dueDate,
        allDay: !(item.hasTime && item.dueTime),
        classNames: [
          item.status === 'overdue' ? 'wypcal-overdue' : item.status === 'done' ? 'wypcal-done' : 'wypcal-open',
        ],
        extendedProps: { type: item.type, id: item.id },
      })),
    [filteredItems]
  )

  const { slotMinTime, slotMaxTime } = useMemo(() => {
    const DEFAULT_MIN = 6 * 60
    const DEFAULT_MAX = 18 * 60
    let minMinutes = DEFAULT_MIN
    let maxMinutes = DEFAULT_MAX
    for (const item of filteredItems) {
      if (!item.hasTime || !item.dueTime) continue
      if (visibleStart && visibleEnd) {
        const itemDate = new Date(`${item.dueDate}T00:00:00`)
        if (itemDate < visibleStart || itemDate >= visibleEnd) continue
      }
      const [h, m] = item.dueTime.split(':').map(Number)
      const minutes = h * 60 + m
      minMinutes = Math.min(minMinutes, Math.floor(minutes / 60) * 60)
      maxMinutes = Math.max(maxMinutes, Math.ceil((minutes + 60) / 60) * 60)
    }
    minMinutes = Math.max(0, minMinutes)
    maxMinutes = Math.min(24 * 60, maxMinutes)
    const fmt = (mins: number) =>
      `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`
    return { slotMinTime: fmt(minMinutes), slotMaxTime: fmt(maxMinutes) }
  }, [filteredItems, visibleStart, visibleEnd])

  function openItem(type: CalendarItem['type'], id: string) {
    const state: RoundTripState = { sent: sentOn, received: receivedOn, todo: todoOn, status: statusFilter, view }
    window.sessionStorage.setItem(CALENDAR_STATE_KEY, JSON.stringify(state))
    window.sessionStorage.setItem(CALENDAR_ROUNDTRIP_KEY, '1')
    if (type === 'sent') router.push(`/requests/${id}`)
    else if (type === 'received') router.push(`/requests/${id}/respond`)
    else router.push(`/todos/${id}`)
  }

  function handleEventClick(arg: EventClickArg) {
    const type = arg.event.extendedProps.type as CalendarItem['type']
    const id = arg.event.extendedProps.id as string
    openItem(type, id)
  }

  function changeView(next: CalView) {
    setView(next)
    calendarRef.current?.getApi().changeView(next)
  }

  const printRows = useMemo(() => {
    const list = filteredItems.slice().sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
      const at = a.dueTime ?? ''
      const bt = b.dueTime ?? ''
      return at < bt ? -1 : at > bt ? 1 : 0
    })
    return list
  }, [filteredItems])

  function startPrint() {
    setPrintTick((t) => t + 1)
  }

  useEffect(() => {
    if (printTick === 0) return
    printWithExpandedWindow()
  }, [printTick])

  // printTick is the deliberate trigger below: a fresh timestamp only needs
  // to compute again when Print is clicked again, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), [printTick])

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">Loading…</div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader />
        <div className="band">
          <span className="glabel">Calendar</span>
          <span className="bandcluster">
            <button className="btn-secondary" type="button" onClick={() => router.back()}>Close</button>
          </span>
        </div>

        <div className="scroll">
          <div className="subcard">
            {/* Row 1 — Record Type checkboxes + Print icon */}
            <div className="subhead-top">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: sentOn ? 700 : 400,
                    color: sentOn ? 'var(--brand-blue)' : 'var(--ink)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sentOn}
                    onChange={(e) => setSentOn(e.target.checked)}
                    style={{ accentColor: 'var(--brand-blue)' }}
                  />
                  Sent
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: receivedOn ? 700 : 400,
                    color: receivedOn ? 'var(--brand-blue)' : 'var(--ink)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.checked)}
                    style={{ accentColor: 'var(--brand-blue)' }}
                  />
                  Received
                </label>
                {todoDatesEnabled && (
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: todoOn ? 700 : 400,
                      color: todoOn ? 'var(--brand-blue)' : 'var(--ink)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={todoOn}
                      onChange={(e) => setTodoOn(e.target.checked)}
                      style={{ accentColor: 'var(--brand-blue)' }}
                    />
                    ToDos
                  </label>
                )}
              </div>
              <span className="subicons">
                <button className="iconbtn" type="button" aria-label="Print Calendar" onClick={startPrint}>
                  <PrintIcon />
                </button>
              </span>
            </div>

            {/* Row 2 — Status chips */}
            <div className="chips">
              <button className={`chip${statusFilter === 'all' ? ' sel' : ''}`} type="button" onClick={() => setStatusFilter('all')}>All</button>
              <button className={`chip${statusFilter === 'open' ? ' sel' : ''}`} type="button" onClick={() => setStatusFilter('open')}>Open</button>
              <button className={`chip over${statusFilter === 'overdue' ? ' sel' : ''}`} type="button" onClick={() => setStatusFilter('overdue')}>Overdue</button>
              <button className={`chip done${statusFilter === 'done' ? ' sel' : ''}`} type="button" onClick={() => setStatusFilter('done')}>Done</button>
            </div>

            {/* View chips */}
            <div className="chips" style={{ marginTop: 8 }}>
              <button className={`chip${view === 'dayGridMonth' ? ' sel' : ''}`} type="button" onClick={() => changeView('dayGridMonth')}>Month</button>
              <button className={`chip${view === 'timeGridWeek' ? ' sel' : ''}`} type="button" onClick={() => changeView('timeGridWeek')}>Week</button>
              <button className={`chip${view === 'timeGridDay' ? ' sel' : ''}`} type="button" onClick={() => changeView('timeGridDay')}>Day</button>
            </div>

            <div className="wypcal">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={view}
                headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
                height="auto"
                slotMinTime={slotMinTime}
                slotMaxTime={slotMaxTime}
                datesSet={handleDatesSet}
                events={events}
                eventClick={handleEventClick}
                eventContent={(arg: EventContentArg) => (
                  <div className="wypcal-event">{arg.event.title}</div>
                )}
              />
            </div>
          </div>
        </div>

        <AppFooter />
      </div>

      {/* Agenda-style Print (2026-09-16) — the visible calendar grid is
          intentionally not what prints; a plain sorted list of the same
          filtered items instead, per the owner's explicit answer. Reuses
          .pcolbar.detail2/.pr1.detail2 (1fr 150px, Item/Due) since that's
          exactly the two-column shape this needs. */}
      <div className="print-report">
        <div className="ptitle">Calendar — {printGeneratedAt}</div>
        <div className="pcolbar detail2">
          <span>Item</span>
          <span className="c-due">Due</span>
        </div>
        <div className="prows">
          {printRows.length === 0 ? (
            <div className="pempty">No items to show.</div>
          ) : (
            printRows.map((item) => (
              <div className="prow" key={`${item.type}-${item.id}`}>
                <div className="pr1 detail2">
                  <span>{item.fullLabel}</span>
                  <span className="c-due">{formatMDYSlash(item.dueDate, item.dueTime)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
