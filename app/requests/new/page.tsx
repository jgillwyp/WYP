'use client'

import RequireAuth from '../../RequireAuth'
import CreateRequestForm from '../../components/CreateRequestForm'

export default function CreateRequestPage() {
  return (
    <RequireAuth>
      <CreateRequestForm />
    </RequireAuth>
  )
}
