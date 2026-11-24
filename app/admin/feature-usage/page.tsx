'use client'

import RequireAdmin from '../../RequireAdmin'
import AdminFeatureUsageForm from '../../components/AdminFeatureUsageForm'

export default function AdminFeatureUsagePage() {
  return (
    <RequireAdmin>
      <AdminFeatureUsageForm />
    </RequireAdmin>
  )
}
