'use client'

import RequireAuth from '../../RequireAuth'
import CreateTodoForm from '../../components/CreateTodoForm'

export default function CreateTodoPage() {
  return (
    <RequireAuth>
      <CreateTodoForm />
    </RequireAuth>
  )
}
