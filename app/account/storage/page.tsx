'use client'

import RequireAuth from '../../RequireAuth'
import StorageManagementForm from '../../components/StorageManagementForm'

export default function StoragePage() {
  return (
    <RequireAuth>
      <StorageManagementForm />
    </RequireAuth>
  )
}
