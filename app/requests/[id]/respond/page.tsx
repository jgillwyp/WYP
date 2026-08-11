'use client'

import RequireAuth from '../../../RequireAuth'
import ResponseDetailForm from '../../../components/ResponseDetailForm'

export default function ResponseDetailPage() {
  return (
    <RequireAuth>
      <ResponseDetailForm />
    </RequireAuth>
  )
}
