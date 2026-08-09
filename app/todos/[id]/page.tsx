'use client'

import RequireAuth from '../../RequireAuth'
import TodoDetailForm from '../../components/TodoDetailForm'

export default function TodoDetailPage() {
  return (
    <RequireAuth>
      <TodoDetailForm />
    </RequireAuth>
  )
}
