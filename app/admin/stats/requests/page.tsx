'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminRequestsStatsForm from '../../../components/AdminRequestsStatsForm'

export default function AdminRequestsStatsPage() {
  return (
    <RequireAdmin>
      <AdminRequestsStatsForm />
    </RequireAdmin>
  )
}
