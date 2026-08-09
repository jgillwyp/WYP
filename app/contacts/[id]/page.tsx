'use client'

import RequireAuth from '../../RequireAuth'
import ContactDetailForm from '../../components/ContactDetailForm'

export default function ContactDetailPage() {
  return (
    <RequireAuth>
      <ContactDetailForm />
    </RequireAuth>
  )
}
