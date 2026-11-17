'use client'

import RequireAdmin from '../../RequireAdmin'
import AdminTrialCloseForm from '../../components/AdminTrialCloseForm'

export default function AdminTrialClosePage() {
  return (
    <RequireAdmin>
      <AdminTrialCloseForm />
    </RequireAdmin>
  )
}
