'use client'

import RequireAuth from '../../RequireAuth'
import GettingStartedHelp from '../../components/help/GettingStartedHelp'

export default function GettingStartedHelpPage() {
  return (
    <RequireAuth>
      <GettingStartedHelp />
    </RequireAuth>
  )
}
