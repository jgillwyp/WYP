'use client'

import RequireAdmin from '../../RequireAdmin'
import AdminStripeAuditForm from '../../components/AdminStripeAuditForm'

export default function AdminStripeAuditPage() {
  return (
    <RequireAdmin>
      <AdminStripeAuditForm />
    </RequireAdmin>
  )
}
