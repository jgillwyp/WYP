'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminTodosStatsForm from '../../../components/AdminTodosStatsForm'

export default function AdminTodosStatsPage() {
  return (
    <RequireAdmin>
      <AdminTodosStatsForm />
    </RequireAdmin>
  )
}
