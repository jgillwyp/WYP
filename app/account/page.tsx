'use client'

import RequireAuth from '../RequireAuth'
import AccountForm from '../components/AccountForm'

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountForm />
    </RequireAuth>
  )
}
