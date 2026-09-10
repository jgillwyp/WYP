'use client'

import RequireAuth from '../RequireAuth'
import AboutForm from '../components/AboutForm'

export default function AboutPage() {
  return (
    <RequireAuth>
      <AboutForm />
    </RequireAuth>
  )
}
