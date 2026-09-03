'use client'

import RequireAuth from '../../RequireAuth'
import RespondingRequestHelp from '../../components/help/RespondingRequestHelp'

export default function RespondingRequestHelpPage() {
  return (
    <RequireAuth>
      <RespondingRequestHelp />
    </RequireAuth>
  )
}
