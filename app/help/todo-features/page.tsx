'use client'

import RequireAuth from '../../RequireAuth'
import TodoFeaturesHelp from '../../components/help/TodoFeaturesHelp'

export default function TodoFeaturesHelpPage() {
  return (
    <RequireAuth>
      <TodoFeaturesHelp />
    </RequireAuth>
  )
}
