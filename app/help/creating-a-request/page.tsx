'use client'

import RequireAuth from '../../RequireAuth'
import CreatingRequestHelp from '../../components/help/CreatingRequestHelp'

export default function CreatingRequestHelpPage() {
  return (
    <RequireAuth>
      <CreatingRequestHelp />
    </RequireAuth>
  )
}
