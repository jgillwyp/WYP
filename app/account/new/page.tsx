'use client'

import RequireAuth from '../../RequireAuth'
import CreateFreeAccountForm from '../../components/CreateFreeAccountForm'

export default function CreateFreeAccountPage() {
  return (
    <RequireAuth>
      <CreateFreeAccountForm />
    </RequireAuth>
  )
}
