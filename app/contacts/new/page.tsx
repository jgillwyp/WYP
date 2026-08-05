'use client'

import RequireAuth from '../../RequireAuth'
import AddContactForm from '../../components/AddContactForm'

export default function AddContactPage() {
  return (
    <RequireAuth>
      <AddContactForm />
    </RequireAuth>
  )
}
