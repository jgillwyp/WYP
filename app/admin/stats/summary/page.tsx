'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminSummaryStatsForm from '../../../components/AdminSummaryStatsForm'

export default function AdminSummaryStatsPage() {
  return (
    <RequireAdmin>
      <AdminSummaryStatsForm />
    </RequireAdmin>
  )
}
