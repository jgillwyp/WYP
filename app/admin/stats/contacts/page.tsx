'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminContactsStatsForm from '../../../components/AdminContactsStatsForm'

export default function AdminContactsStatsPage() {
  return (
    <RequireAdmin>
      <AdminContactsStatsForm />
    </RequireAdmin>
  )
}
