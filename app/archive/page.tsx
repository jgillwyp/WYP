'use client'

import RequireAuth from '../RequireAuth'
import ArchiveForm from '../components/ArchiveForm'

export default function ArchivePage() {
  return (
    <RequireAuth>
      <ArchiveForm />
    </RequireAuth>
  )
}
