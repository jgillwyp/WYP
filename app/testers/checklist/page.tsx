'use client'

import RequireAuth from '../../RequireAuth'
import TesterChecklistForm from '../../components/TesterChecklistForm'

export default function TesterChecklistPage() {
  return (
    <RequireAuth>
      <TesterChecklistForm />
    </RequireAuth>
  )
}
