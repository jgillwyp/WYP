'use client'

import RequireAuth from '../RequireAuth'
import ContactsList from '../components/ContactsList'

export default function ContactsListPage() {
  return (
    <RequireAuth>
      <ContactsList />
    </RequireAuth>
  )
}
