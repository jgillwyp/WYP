'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminAccountsStatsForm from '../../../components/AdminAccountsStatsForm'

export default function AdminAccountsStatsPage() {
  return (
    <RequireAdmin>
      <AdminAccountsStatsForm />
    </RequireAdmin>
  )
}
