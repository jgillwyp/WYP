'use client'

import RequireAdmin from '../../RequireAdmin'
import AdminAdActivityForm from '../../components/AdminAdActivityForm'

export default function AdminAdActivityPage() {
  return (
    <RequireAdmin>
      <AdminAdActivityForm />
    </RequireAdmin>
  )
}
