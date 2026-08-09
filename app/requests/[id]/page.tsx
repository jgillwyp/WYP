'use client'

import RequireAuth from '../../RequireAuth'
import RequestDetailForm from '../../components/RequestDetailForm'

export default function RequestDetailPage() {
  return (
    <RequireAuth>
      <RequestDetailForm />
    </RequireAuth>
  )
}
