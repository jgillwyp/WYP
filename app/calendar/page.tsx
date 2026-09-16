'use client'

import RequireAuth from '../RequireAuth'
import CalendarView from '../components/CalendarView'

export default function CalendarPage() {
  return (
    <RequireAuth>
      <CalendarView />
    </RequireAuth>
  )
}
