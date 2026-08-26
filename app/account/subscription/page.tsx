'use client'

import RequireAuth from '../../RequireAuth'
import SubscriptionForm from '../../components/SubscriptionForm'

export default function SubscriptionPage() {
  return (
    <RequireAuth>
      <SubscriptionForm />
    </RequireAuth>
  )
}
