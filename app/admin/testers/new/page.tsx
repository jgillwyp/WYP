'use client'

import RequireAdmin from '../../../RequireAdmin'
import AdminAddTesterForm from '../../../components/AdminAddTesterForm'

export default function AdminAddTesterPage() {
  return (
    <RequireAdmin>
      <AdminAddTesterForm />
    </RequireAdmin>
  )
}
