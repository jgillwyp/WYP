'use client'

import RequireAdmin from '../../RequireAdmin'
import AdminTestStripeForm from '../../components/AdminTestStripeForm'

export default function AdminTestStripePage() {
  return (
    <RequireAdmin>
      <AdminTestStripeForm />
    </RequireAdmin>
  )
}
